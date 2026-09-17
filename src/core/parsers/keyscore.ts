import type { InstrumentProfile } from '../model/instrument';
import { codeFromChar } from '../model/keycodes';
import type { Note, Score } from '../model/score';
import { ScoreParseError } from './errors';
import { parseFraction } from './fraction';
import { type TextPosition, TextCursor, isBlank, readDirective } from './textCursor';

export interface KeyscoreOptions {
  title: string;
  /** 文本中没有 @instrument 时使用的来源乐器 */
  defaultInstrumentId: string;
  resolveInstrument: (id: string) => InstrumentProfile | undefined;
  /** 默认 90 */
  bpm?: number;
  /** 每个符号占几拍，默认 0.5 */
  step?: number;
  /** 每个空格占一个步长，默认 false */
  spaceAsRest?: boolean;
}

export interface KeyscoreResult {
  score: Score;
  sourceInstrumentId: string;
}

const DEFAULT_BPM = 90;
const DEFAULT_STEP = 0.5;
const VELOCITY = 0.8;

export function parseKeyscore(text: string, options: KeyscoreOptions): KeyscoreResult {
  const cursor = new TextCursor(text);
  let instrument = requireInstrument(options, options.defaultInstrumentId, cursor.position());
  let bpm = options.bpm ?? DEFAULT_BPM;
  let step = options.step ?? DEFAULT_STEP;
  let timeMs = 0;
  let firstNoteBpm: number | undefined;
  let lastGroup: Note[] = [];
  const notes: Note[] = [];

  const stepMs = () => (60000 / bpm) * step;

  const readKey = (): string => {
    const at = cursor.position();
    const ch = cursor.next();
    const code = codeFromChar(ch);
    if (code === undefined) throw cursor.error(`无法识别的字符「${ch}」`, at);
    if (!instrument.rows.some((row) => row.keys.some((key) => key.code === code))) {
      throw cursor.error(`来源乐器「${instrument.name}」没有按键「${ch.toUpperCase()}」`, at);
    }
    return code;
  };

  const readChord = (): string[] => {
    const at = cursor.position();
    const close = cursor.next() === '(' ? ')' : ']';
    const codes: string[] = [];
    for (;;) {
      if (cursor.done) throw cursor.error('和弦没有闭合', at);
      const ch = cursor.peek();
      if (ch === close) {
        cursor.next();
        break;
      }
      if (isBlank(ch)) {
        cursor.next();
        continue;
      }
      codes.push(readKey());
    }
    if (codes.length === 0) throw cursor.error('和弦不能为空', at);
    return codes;
  };

  const readMultiplier = (): number => {
    if (cursor.peek() !== ':') return 1;
    const at = cursor.position();
    cursor.next();
    const raw = cursor.readWhile((ch) => /[0-9./]/.test(ch));
    const value = parseFraction(raw);
    if (value === undefined || value <= 0) throw cursor.error(`时值写法错误「:${raw}」`, at);
    return value;
  };

  const emit = (codes: string[], multiplier: number) => {
    const durationMs = stepMs() * multiplier;
    const group = [...new Set(codes)].map((code) => noteForKey(instrument, code, timeMs, durationMs));
    notes.push(...group);
    lastGroup = group;
    timeMs += durationMs;
    firstNoteBpm ??= bpm;
  };

  const applyDirective = () => {
    const { name, value, at } = readDirective(cursor);
    if (name === 'bpm') {
      const parsed = Number(value);
      if (!(parsed > 0)) throw cursor.error(`@bpm 必须是正数：「${value}」`, at);
      bpm = parsed;
    } else if (name === 'step') {
      const parsed = parseFraction(value);
      if (parsed === undefined || parsed <= 0) throw cursor.error(`@step 写法错误：「${value}」`, at);
      step = parsed;
    } else if (name === 'instrument') {
      if (notes.length > 0 || timeMs > 0) throw cursor.error('@instrument 必须写在第一个音符之前', at);
      instrument = requireInstrument(options, value, at);
    } else {
      throw cursor.error(`未知指令「@${name}」`, at);
    }
  };

  while (!cursor.done) {
    const ch = cursor.peek();
    if (ch === ' ') {
      cursor.next();
      if (options.spaceAsRest) {
        timeMs += stepMs();
        lastGroup = [];
      }
    } else if (isBlank(ch) || ch === '|') {
      cursor.next();
    } else if (cursor.startsWith('//')) {
      cursor.skipLine();
    } else if (ch === '/') {
      cursor.next();
      timeMs += stepMs();
      lastGroup = [];
    } else if (ch === '-') {
      cursor.next();
      const ms = stepMs();
      for (const note of lastGroup) note.durationMs += ms;
      timeMs += ms;
    } else if (ch === '@') {
      applyDirective();
    } else if (ch === '(' || ch === '[') {
      const codes = readChord();
      emit(codes, readMultiplier());
    } else {
      const code = readKey();
      emit([code], readMultiplier());
    }
  }

  const tracks = notes.length > 0 ? [{ id: 't0', name: instrument.name, isDrum: false, notes }] : [];
  return {
    score: { meta: { title: options.title, source: 'keyscore', bpm: firstNoteBpm ?? bpm }, tracks },
    sourceInstrumentId: instrument.id,
  };
}

function requireInstrument(options: KeyscoreOptions, id: string, at: TextPosition): InstrumentProfile {
  const profile = options.resolveInstrument(id);
  if (!profile) throw new ScoreParseError(`找不到来源乐器「${id}」`, at);
  return profile;
}

function noteForKey(instrument: InstrumentProfile, code: string, startMs: number, durationMs: number): Note {
  const key = instrument.rows.flatMap((row) => row.keys).find((k) => k.code === code);
  if (key?.pitch !== undefined) return { startMs, durationMs, pitch: key.pitch, velocity: VELOCITY };
  return { startMs, durationMs, voice: key?.voice, velocity: VELOCITY };
}
