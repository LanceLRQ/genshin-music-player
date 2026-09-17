import type { Note, Score } from '../model/score';
import { pitchOffsetFromName } from '../music/pitch';
import { type TextPosition, TextCursor, isBlank, readDirective } from './textCursor';

export interface JianpuOptions {
  title: string;
}

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const DEFAULT_BPM = 90;
const DEFAULT_OCTAVE = 4;
const DEFAULT_TRACK_NAME = '旋律';
const TRIPLET_RATIO = 2 / 3;
const VELOCITY = 0.8;

interface TrackState {
  name: string;
  notes: Note[];
  timeMs: number;
  lastGroup: Note[];
}

interface DurationMarks {
  halves: number;
  dots: number;
}

const isNoteStart = (ch: string) => ch === '#' || ch === 'b' || /^[0-7]$/.test(ch);

export function parseJianpu(text: string, options: JianpuOptions): Score {
  const cursor = new TextCursor(text);
  let bpm = DEFAULT_BPM;
  let tonic = 0;
  let baseOctave = DEFAULT_OCTAVE;
  let tripletAt: TextPosition | null = null;
  let firstNoteBpm: number | undefined;
  let track: TrackState = { name: DEFAULT_TRACK_NAME, notes: [], timeMs: 0, lastGroup: [] };
  const tracks: TrackState[] = [track];

  const beatMs = () => 60000 / bpm;
  const beatsOf = ({ halves, dots }: DurationMarks) =>
    0.5 ** halves * (2 - 0.5 ** dots) * (tripletAt ? TRIPLET_RATIO : 1);

  const emit = (pitches: number[], marks: DurationMarks) => {
    const durationMs = beatsOf(marks) * beatMs();
    const group: Note[] = [...new Set(pitches)].map((pitch) => ({
      startMs: track.timeMs,
      durationMs,
      pitch,
      velocity: VELOCITY,
    }));
    track.notes.push(...group);
    track.lastGroup = group;
    track.timeMs += durationMs;
    firstNoteBpm ??= bpm;
  };

  const setKey = (value: string, at: TextPosition) => {
    const offset = pitchOffsetFromName(value);
    if (offset === undefined) throw cursor.error(`调号写法错误「${value}」`, at);
    tonic = offset;
  };

  const readMarks = (allowOctave: boolean, allowDuration: boolean) => {
    let octave = 0;
    const marks: DurationMarks = { halves: 0, dots: 0 };
    for (;;) {
      const ch = cursor.peek();
      const isOctave = ch === "'" || ch === ',';
      const isDuration = ch === '_' || ch === '.';
      if (!isOctave && !isDuration) break;
      if (isOctave && !allowOctave) throw cursor.error('八度标记要写在和弦内的音上');
      if (isDuration && !allowDuration) throw cursor.error('和弦内不能写时值，请写在「]」后面');
      cursor.next();
      if (ch === "'") octave += 1;
      else if (ch === ',') octave -= 1;
      else if (ch === '_') marks.halves += 1;
      else marks.dots += 1;
    }
    return { octave, marks };
  };

  /** 读取一个音或休止符；返回 pitch 为 null 表示休止 */
  const readNote = (inChord: boolean): { pitch: number | null; marks: DurationMarks } => {
    const at = cursor.position();
    let accidental = 0;
    if (cursor.peek() === '#') {
      accidental = 1;
      cursor.next();
    } else if (cursor.peek() === 'b') {
      accidental = -1;
      cursor.next();
    }
    const digit = cursor.peek();
    if (!/^[0-7]$/.test(digit)) throw cursor.error('升降号后面应该是 1–7 的数字');
    cursor.next();
    const { octave, marks } = readMarks(true, !inChord);
    if (digit === '0') {
      if (inChord) throw cursor.error('和弦内不能包含休止符', at);
      if (accidental !== 0 || octave !== 0) throw cursor.error('休止符不能带升降号或八度标记', at);
      return { pitch: null, marks };
    }
    const pitch = 12 * (baseOctave + 1) + tonic + MAJOR_SCALE[Number(digit) - 1] + accidental + 12 * octave;
    if (pitch < 0 || pitch > 127) throw cursor.error('音高超出 MIDI 范围（0–127）', at);
    return { pitch, marks };
  };

  const readChord = () => {
    const at = cursor.position();
    cursor.next();
    const pitches: number[] = [];
    for (;;) {
      if (cursor.done) throw cursor.error('和弦没有闭合', at);
      const ch = cursor.peek();
      if (ch === ']') {
        cursor.next();
        break;
      }
      if (isBlank(ch)) {
        cursor.next();
        continue;
      }
      if (!isNoteStart(ch)) throw cursor.error(`和弦内不能出现「${ch}」`);
      const { pitch } = readNote(true);
      if (pitch !== null) pitches.push(pitch);
    }
    if (pitches.length === 0) throw cursor.error('和弦不能为空', at);
    const { marks } = readMarks(false, true);
    emit(pitches, marks);
  };

  const applyDirective = () => {
    const { name, value, at } = readDirective(cursor);
    if (name === 'bpm') {
      const parsed = Number(value);
      if (!(parsed > 0)) throw cursor.error(`@bpm 必须是正数：「${value}」`, at);
      bpm = parsed;
    } else if (name === 'key') {
      setKey(value, at);
    } else if (name === 'octave') {
      const parsed = Number(value);
      if (value === '' || !Number.isInteger(parsed) || parsed < -1 || parsed > 8) {
        throw cursor.error(`@octave 应为 -1 到 8 的整数：「${value}」`, at);
      }
      baseOctave = parsed;
    } else if (name === 'track') {
      if (value === '') throw cursor.error('@track 需要名称', at);
      if (track.notes.length === 0 && track.timeMs === 0) {
        track.name = value;
      } else {
        track = { name: value, notes: [], timeMs: 0, lastGroup: [] };
        tracks.push(track);
      }
    } else {
      throw cursor.error(`未知指令「@${name}」`, at);
    }
  };

  while (!cursor.done) {
    const ch = cursor.peek();
    if (isBlank(ch) || ch === '|') {
      cursor.next();
    } else if (cursor.startsWith('//')) {
      cursor.skipLine();
    } else if (ch === '@') {
      applyDirective();
    } else if (ch === '1' && cursor.peek(1) === '=') {
      const at = cursor.position();
      cursor.next();
      cursor.next();
      setKey(cursor.readWhile((c) => !isBlank(c)), at);
    } else if (ch === '{') {
      if (tripletAt) throw cursor.error('不支持嵌套三连音');
      tripletAt = cursor.position();
      cursor.next();
    } else if (ch === '}') {
      if (!tripletAt) throw cursor.error('多余的「}」');
      tripletAt = null;
      cursor.next();
    } else if (ch === '[') {
      readChord();
    } else if (ch === '-') {
      if (tripletAt) throw cursor.error('三连音内不能使用增时线「-」');
      cursor.next();
      const ms = beatMs();
      for (const note of track.lastGroup) note.durationMs += ms;
      track.timeMs += ms;
    } else if (isNoteStart(ch)) {
      const { pitch, marks } = readNote(false);
      if (pitch === null) {
        track.timeMs += beatsOf(marks) * beatMs();
        track.lastGroup = [];
      } else {
        emit([pitch], marks);
      }
    } else {
      throw cursor.error(`无法识别的符号「${ch}」`);
    }
  }
  if (tripletAt) throw cursor.error('三连音没有闭合', tripletAt);

  return {
    meta: { title: options.title, source: 'jianpu', bpm: firstNoteBpm ?? bpm },
    tracks: tracks
      .filter((t) => t.notes.length > 0)
      .map((t, index) => ({ id: `t${index}`, name: t.name, isDrum: false, notes: t.notes })),
  };
}
