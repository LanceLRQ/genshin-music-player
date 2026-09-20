import { Midi } from '@tonejs/midi';
import { describe, expect, it } from 'vitest';
import { ScoreParseError } from './errors';
import { looksLikeDrumTrack, parseMidi } from './midi';

function buildMidi(): Uint8Array {
  const midi = new Midi();
  midi.header.setTempo(120);

  const melody = midi.addTrack();
  melody.name = 'Melody';
  melody.addNote({ midi: 64, time: 0.5, duration: 1, velocity: 0.5 });
  melody.addNote({ midi: 60, time: 0, duration: 0.5, velocity: 0.8 });

  const drums = midi.addTrack();
  drums.name = 'Drums';
  drums.channel = 9;
  drums.addNote({ midi: 36, time: 0, duration: 0.25 });

  midi.addTrack();

  const unnamed = midi.addTrack();
  unnamed.addNote({ midi: 72, time: 1.5, duration: 0.5 });

  return midi.toArray();
}

describe('parseMidi', () => {
  const score = parseMidi(buildMidi(), 'demo');

  it('读取标题、来源和首个 tempo', () => {
    expect(score.meta).toEqual({ title: 'demo', source: 'midi', bpm: 120 });
  });

  it('只保留有音符的音轨，无名音轨用序号和乐器名命名', () => {
    expect(score.tracks.map((t) => t.name)).toEqual([
      'Melody',
      'Drums',
      expect.stringMatching(/^音轨 \d+ · acoustic grand piano$/),
    ]);
    expect(new Set(score.tracks.map((t) => t.id)).size).toBe(3);
  });

  it('时间换算为毫秒，音符按开始时间排序', () => {
    const melody = score.tracks[0];
    expect(melody.notes.map((n) => [n.startMs, n.durationMs, n.pitch])).toEqual([
      [0, 500, 60],
      [500, 1000, 64],
    ]);
    expect(melody.notes[0].velocity).toBeCloseTo(0.8, 1);
  });

  it('第 10 通道的音轨标记为鼓轨', () => {
    expect(score.tracks.map((t) => t.isDrum)).toEqual([false, true, false]);
    expect(score.tracks[1].notes[0].pitch).toBe(36);
  });

  it('无法解析的数据抛出 ScoreParseError', () => {
    expect(() => parseMidi(new Uint8Array([1, 2, 3]), 'bad')).toThrow(ScoreParseError);
    expect(() => parseMidi(new Uint8Array([1, 2, 3]), 'bad')).toThrow(/^MIDI 文件无法解析：/);
  });
});

describe('looksLikeDrumTrack（写在普通通道的鼓谱启发式）', () => {
  const note = (pitch: number, durationMs = 120) => ({ pitch, durationMs });

  it('音高都在 GM 音域、只用少数音高、时值短、数量足够时判为鼓', () => {
    const notes = [note(36), note(36), note(42), note(38), ...Array.from({ length: 20 }, () => note(42))];
    expect(looksLikeDrumTrack(notes)).toBe(true);
  });

  it('旋律特征（时值长）不判为鼓', () => {
    const notes = [note(60, 500), note(62, 500), note(64, 500), ...Array.from({ length: 20 }, () => note(60, 480))];
    expect(looksLikeDrumTrack(notes)).toBe(false);
  });

  it('音高超出 GM 音域或音高种类过多时不判为鼓', () => {
    expect(looksLikeDrumTrack([...Array.from({ length: 20 }, () => note(30))])).toBe(false);
    expect(looksLikeDrumTrack(Array.from({ length: 24 }, (_, i) => note(35 + (i % 12))))).toBe(false);
  });

  it('音符太少不猜测', () => {
    expect(looksLikeDrumTrack([note(36), note(38)])).toBe(false);
  });

  it('parseMidi 对普通通道上的鼓谱按启发式标记 isDrum', () => {
    const midi = new Midi();
    const splice = midi.addTrack();
    splice.channel = 0;
    for (let index = 0; index < 32; index += 1) {
      splice.addNote({ midi: [36, 38, 42][index % 3], time: index * 0.25, duration: 0.1, velocity: 0.8 });
    }
    const score = parseMidi(midi.toArray(), 'splice');
    expect(score.tracks[0].isDrum).toBe(true);
  });
});
