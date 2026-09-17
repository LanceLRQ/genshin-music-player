import { Midi } from '@tonejs/midi';
import { describe, expect, it } from 'vitest';
import {
  allAssets,
  buildChordsAsset,
  buildDrumAsset,
  buildEnsembleAsset,
  buildLongMelodyAsset,
  buildRepeatAsset,
  buildScaleAsset,
} from './generators';

/** @tonejs/midi 导出后重新解析会多出一条只含 tempo 的头音轨，只统计有音符的音轨 */
function reparse(bytes: Uint8Array) {
  const midi = new Midi(bytes);
  const tracks = midi.tracks.filter((t) => t.notes.length > 0);
  const notes = tracks.flatMap((t) => t.notes);
  return { midi, tracks, notes };
}

describe('buildScaleAsset', () => {
  it('C3–C6 上行再下行，共 43 个音，单音轨', () => {
    const { tracks, notes } = reparse(buildScaleAsset().bytes);
    expect(tracks).toHaveLength(1);
    expect(notes).toHaveLength(43);
    expect(Math.min(...notes.map((n) => n.midi))).toBe(48);
    expect(Math.max(...notes.map((n) => n.midi))).toBe(84);
    expect(notes[0].midi).toBe(48);
    expect(notes[21].midi).toBe(84);
    expect(notes[22].midi).toBe(83);
    expect(notes[notes.length - 1].midi).toBe(48);
  });
});

describe('buildChordsAsset', () => {
  it('8 个三和弦，每个 3 音，共 24 个音，音域落在风物之诗琴范围内', () => {
    const { notes } = reparse(buildChordsAsset().bytes);
    expect(notes).toHaveLength(24);
    for (const note of notes) {
      expect(note.midi).toBeGreaterThanOrEqual(48);
      expect(note.midi).toBeLessThanOrEqual(83);
    }
    const startTimes = [...new Set(notes.map((n) => n.time))].sort((a, b) => a - b);
    expect(startTimes).toHaveLength(8);
  });
});

describe('buildRepeatAsset', () => {
  it('9 档间隔各连打 5 次，共 45 个音，音高恒定', () => {
    const { notes } = reparse(buildRepeatAsset().bytes);
    expect(notes).toHaveLength(45);
    expect(new Set(notes.map((n) => n.midi))).toEqual(new Set([69]));
    // MIDI 是按 tick 量化的整数时间格式，往返编解码后毫秒级的值允许 ±2ms 误差
    const gapsWithinFirstGroupMs = notes.slice(1, 5).map((n, i) => (n.time - notes[i].time) * 1000);
    for (const gap of gapsWithinFirstGroupMs) expect(gap).toBeGreaterThan(198);
    for (const gap of gapsWithinFirstGroupMs) expect(gap).toBeLessThan(202);
    const gapsWithinLastGroupMs = notes.slice(41, 45).map((n, i) => (n.time - notes[40 + i].time) * 1000);
    for (const gap of gapsWithinLastGroupMs) expect(gap).toBeGreaterThan(18);
    for (const gap of gapsWithinLastGroupMs) expect(gap).toBeLessThan(22);
  });
});

describe('buildLongMelodyAsset', () => {
  it('1200 个音，时长约 300 秒，音域落在风物之诗琴范围内', () => {
    const { notes } = reparse(buildLongMelodyAsset().bytes);
    expect(notes).toHaveLength(1200);
    const totalMs = (notes[notes.length - 1].time + notes[notes.length - 1].duration) * 1000;
    expect(totalMs).toBeGreaterThan(299_000);
    expect(totalMs).toBeLessThanOrEqual(300_000);
    for (const note of notes) {
      expect(note.midi).toBeGreaterThanOrEqual(48);
      expect(note.midi).toBeLessThanOrEqual(83);
    }
  });
});

describe('buildEnsembleAsset', () => {
  it('三条音轨，第 6–10 个音分叉、其余时刻同音或低八度加倍', () => {
    const { tracks } = reparse(buildEnsembleAsset().bytes);
    expect(tracks).toHaveLength(3);
    expect(tracks.map((t) => t.notes.length)).toEqual([15, 15, 8]);
    const [melody, harmony, doubling] = tracks;
    // 前 5 个音同音
    for (let i = 0; i < 5; i += 1) expect(harmony.notes[i].midi).toBe(melody.notes[i].midi);
    // 第 6–10 个音（下标 5–9）分叉，高 4 半音
    for (let i = 5; i < 10; i += 1) expect(harmony.notes[i].midi).toBe(melody.notes[i].midi + 4);
    // 第三声部只覆盖前 8 个音，低八度
    for (let i = 0; i < 8; i += 1) expect(doubling.notes[i].midi).toBe(melody.notes[i].midi - 12);
  });
});

describe('buildDrumAsset', () => {
  it('8 小节鼓点，底鼓/军鼓/闭镲共 96 个音，通道 9', () => {
    const { tracks, notes } = reparse(buildDrumAsset().bytes);
    expect(tracks[0].channel).toBe(9);
    expect(notes).toHaveLength(96);
    const byPitch = new Map<number, number>();
    for (const note of notes) byPitch.set(note.midi, (byPitch.get(note.midi) ?? 0) + 1);
    expect(byPitch.get(36)).toBe(16); // 底鼓：8 小节 × 2
    expect(byPitch.get(38)).toBe(16); // 军鼓：8 小节 × 2
    expect(byPitch.get(42)).toBe(64); // 闭镲：8 小节 × 8
  });
});

describe('allAssets', () => {
  it('返回 6 个测试素材，文件名互不重复', () => {
    const assets = allAssets();
    expect(assets).toHaveLength(6);
    expect(new Set(assets.map((a) => a.fileName)).size).toBe(6);
    for (const asset of assets) expect(asset.bytes.length).toBeGreaterThan(0);
  });
});
