import { Midi } from '@tonejs/midi';
import type { Score, Track } from '../model/score';
import { ScoreParseError } from './errors';

const DRUM_CHANNEL = 9;

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
    tracks.push({
      id: `t${index}`,
      name: track.name.trim() || `音轨 ${index + 1} · ${track.instrument.name}`,
      isDrum: track.channel === DRUM_CHANNEL,
      notes: track.notes
        .map((note) => ({
          startMs: note.time * 1000,
          durationMs: note.duration * 1000,
          pitch: note.midi,
          velocity: note.velocity,
        }))
        .sort((a, b) => a.startMs - b.startMs),
    });
  });

  return { meta: { title, source: 'midi', bpm: midi.header.tempos[0]?.bpm }, tracks };
}
