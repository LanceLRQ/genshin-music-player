import { Midi } from '@tonejs/midi';
import type { Score, Track } from '../model/score';
import { ScoreParseError } from './errors';

const DRUM_CHANNEL = 9;

/** GM 打击乐标准音域 */
const GM_PITCH_MIN = 35;
const GM_PITCH_MAX = 81;

/**
 * 按音符分布猜测一条非鼓通道的轨道是否是鼓谱：全部音高落在 GM 打击乐音域、
 * 只用少数几个固定音高、时值短。Splice 等音源把鼓写在普通通道上，靠这组
 * 启发式补漏；猜错时用户可在音轨列表手动切换轨道类型。
 */
export function looksLikeDrumTrack(notes: readonly { pitch?: number; durationMs: number }[]): boolean {
  if (notes.length < 16) return false;
  const pitches = new Set<number>();
  const durations: number[] = [];
  for (const note of notes) {
    if (note.pitch === undefined || note.pitch < GM_PITCH_MIN || note.pitch > GM_PITCH_MAX) return false;
    pitches.add(note.pitch);
    durations.push(note.durationMs);
  }
  if (pitches.size > 8) return false;
  durations.sort((a, b) => a - b);
  return durations[Math.floor(durations.length / 2)] <= 300;
}

export function parseMidi(data: ArrayBuffer | Uint8Array, title: string): Score {
  let midi: Midi;
  try {
    midi = new Midi(data);
  } catch (error) {
    throw new ScoreParseError(`MIDI 文件无法解析：${error instanceof Error ? error.message : String(error)}`);
  }

  const tracks: Track[] = [];
  midi.tracks.forEach((track, index) => {
    if (track.notes.length === 0) return;
    const notes = track.notes
      .map((note) => ({
        startMs: note.time * 1000,
        durationMs: note.duration * 1000,
        pitch: note.midi,
        velocity: note.velocity,
      }))
      .sort((a, b) => a.startMs - b.startMs);
    tracks.push({
      id: `t${index}`,
      name: track.name.trim() || `音轨 ${index + 1} · ${track.instrument.name}`,
      isDrum: track.channel === DRUM_CHANNEL || looksLikeDrumTrack(notes),
      notes,
    });
  });

  return { meta: { title, source: 'midi', bpm: midi.header.tempos[0]?.bpm }, tracks };
}
