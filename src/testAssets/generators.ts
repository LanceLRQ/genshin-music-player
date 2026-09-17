import { createRequire } from 'node:module';

// 本文件会被 scripts/gen-test-assets.ts 用 node 直接执行（Node 24 原生类型剥离，不经过 tsx/ts-node 之类的转译器），
// 而 @tonejs/midi 是 UMD/CommonJS 包，Node 原生 ESM 加载器无法静态分析出具名导出，
// 用 createRequire 走 CommonJS 加载可以拿到真正的具名导出；vitest（打包器环境）下同样可用。
const require = createRequire(import.meta.url);
const { Midi } = require('@tonejs/midi') as typeof import('@tonejs/midi');

export interface GeneratedAsset {
  fileName: string;
  description: string;
  bytes: Uint8Array;
}

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];

function secondsPerBeat(bpm: number): number {
  return 60 / bpm;
}

/** C 大调音阶：C3 到 C6 上行再下行，四分音符，bpm 90 */
export function buildScaleAsset(): GeneratedAsset {
  const bpm = 90;
  const beat = secondsPerBeat(bpm);
  const midi = new Midi();
  midi.header.setTempo(bpm);
  const track = midi.addTrack();
  track.name = 'C 大调音阶';

  const ascending: number[] = [];
  for (const octave of [3, 4, 5]) {
    for (const degree of MAJOR_SCALE) ascending.push(12 * (octave + 1) + degree);
  }
  ascending.push(84); // C6
  const descending = ascending.slice(0, -1).toReversed();
  const pitches = [...ascending, ...descending];

  pitches.forEach((pitch, index) => {
    track.addNote({ midi: pitch, time: index * beat, duration: beat * 0.95, velocity: 0.8 });
  });

  return { fileName: 'scale-c-major.mid', description: 'C 大调音阶，C3–C6 上行再下行，用于验证键盘谱/简谱导入与音高映射的基础音域覆盖', bytes: midi.toArray() };
}

/** C 大调音阶级数排出的 8 个三和弦，每个占 1 小节（4 拍），bpm 90 */
export function buildChordsAsset(): GeneratedAsset {
  const bpm = 90;
  const beat = secondsPerBeat(bpm);
  const bar = beat * 4;
  const midi = new Midi();
  midi.header.setTempo(bpm);
  const track = midi.addTrack();
  track.name = 'C 大调三和弦';

  const roots = [0, 1, 2, 3, 4, 5, 6, 0];
  const octaveOfIndex = (i: number) => (i === 7 ? 5 : 4);
  const chords = roots.map((degreeIndex, i) => {
    const octave = octaveOfIndex(i);
    const base = 12 * (octave + 1);
    const third = MAJOR_SCALE[(degreeIndex + 2) % 7] + (degreeIndex + 2 >= 7 ? 12 : 0);
    const fifth = MAJOR_SCALE[(degreeIndex + 4) % 7] + (degreeIndex + 4 >= 7 ? 12 : 0);
    return [base + MAJOR_SCALE[degreeIndex], base + third, base + fifth];
  });

  chords.forEach((chord, i) => {
    for (const pitch of chord) track.addNote({ midi: pitch, time: i * bar, duration: bar * 0.9, velocity: 0.8 });
  });

  return { fileName: 'chords-triads.mid', description: 'C 大调音阶级数排出的 8 个三和弦，每小节一个，用于验证和弦窗口分组与复音映射', bytes: midi.toArray() };
}

/** 单音 A4 逐步加快的连打，间隔从 200ms 缩短到 20ms，每档 5 次 */
export function buildRepeatAsset(): GeneratedAsset {
  const bpm = 120;
  const midi = new Midi();
  midi.header.setTempo(bpm);
  const track = midi.addTrack();
  track.name = '连打测试';

  const gapsMs = [200, 150, 100, 80, 60, 50, 40, 30, 20];
  let tMs = 0;
  for (const gap of gapsMs) {
    for (let i = 0; i < 5; i += 1) {
      track.addNote({ midi: 69, time: tMs / 1000, duration: (gap * 0.6) / 1000, velocity: 0.9 });
      tMs += gap;
    }
    tMs += 500;
  }

  return { fileName: 'repeat-accelerating.mid', description: '单音连打，间隔从 200ms 逐档缩短到 20ms，用于寻找乐器 minRepeatGapMs 的可靠下限', bytes: midi.toArray() };
}

const MOTIF_OFFSETS = [0, 4, 7, 4, 0, 4, 7, 11, 7, 4, 0, 4, 7, 11, 7, 4];
const GROUP_OCTAVE_OFFSETS = [-12, 0, 12];

/** 约 5 分钟的长曲：16 音动机循环 75 次，每 16 音一组按 -12/0/+12 循环移调，八分音符 bpm 120 */
export function buildLongMelodyAsset(): GeneratedAsset {
  const bpm = 120;
  const noteDuration = secondsPerBeat(bpm) / 2; // 八分音符 = 0.25s
  const totalNotes = 1200; // 1200 * 0.25s = 300s
  const midi = new Midi();
  midi.header.setTempo(bpm);
  const track = midi.addTrack();
  track.name = '长曲测试';

  for (let i = 0; i < totalNotes; i += 1) {
    const group = Math.floor(i / MOTIF_OFFSETS.length);
    const pitch = 60 + MOTIF_OFFSETS[i % MOTIF_OFFSETS.length] + GROUP_OCTAVE_OFFSETS[group % 3];
    track.addNote({ midi: pitch, time: i * noteDuration, duration: noteDuration * 0.9, velocity: 0.8 });
  }

  return { fileName: 'long-melody-5min.mid', description: '约 5 分钟的循环动机长曲，用于验证长时间演奏的计时稳定性与命中率', bytes: midi.toArray() };
}

/** 三条音轨模拟多轨齐奏：主旋律、部分同音部分和声的第二声部、前半段低八度加倍的第三声部 */
export function buildEnsembleAsset(): GeneratedAsset {
  const bpm = 100;
  const beat = secondsPerBeat(bpm);
  const midi = new Midi();
  midi.header.setTempo(bpm);

  const melody = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60];
  const t1 = midi.addTrack();
  t1.name = '声部一 · 主旋律';
  melody.forEach((pitch, i) => t1.addNote({ midi: pitch, time: i * beat, duration: beat * 0.95, velocity: 0.8 }));

  const t2 = midi.addTrack();
  t2.name = '声部二 · 部分和声';
  melody.forEach((pitch, i) => {
    const harmonized = i >= 5 && i <= 9 ? pitch + 4 : pitch;
    t2.addNote({ midi: harmonized, time: i * beat, duration: beat * 0.95, velocity: 0.7 });
  });

  const t3 = midi.addTrack();
  t3.name = '声部三 · 低八度加倍';
  melody.slice(0, 8).forEach((pitch, i) => t3.addNote({ midi: pitch - 12, time: i * beat, duration: beat * 0.95, velocity: 0.6 }));

  return { fileName: 'ensemble-multitrack.mid', description: '三条音轨的多轨齐奏样例，部分时刻同音、部分时刻分叉，用于验证多轨合并时的 merged 统计', bytes: midi.toArray() };
}

const DRUM_PITCHES = { kick: 36, snare: 38, hihat: 42 };

/** 8 小节鼓点：底鼓落在 1、3 拍，军鼓落在 2、4 拍，闭镲每八分音符一次，bpm 100，通道 9 */
export function buildDrumAsset(): GeneratedAsset {
  const bpm = 100;
  const beat = secondsPerBeat(bpm);
  const midi = new Midi();
  midi.header.setTempo(bpm);
  const track = midi.addTrack();
  track.name = '鼓点测试';
  track.channel = 9;

  for (let bar = 0; bar < 8; bar += 1) {
    const barStart = bar * beat * 4;
    track.addNote({ midi: DRUM_PITCHES.kick, time: barStart, duration: 0.08, velocity: 0.9 });
    track.addNote({ midi: DRUM_PITCHES.kick, time: barStart + beat * 2, duration: 0.08, velocity: 0.9 });
    track.addNote({ midi: DRUM_PITCHES.snare, time: barStart + beat, duration: 0.08, velocity: 0.85 });
    track.addNote({ midi: DRUM_PITCHES.snare, time: barStart + beat * 3, duration: 0.08, velocity: 0.85 });
    for (let eighth = 0; eighth < 8; eighth += 1) {
      track.addNote({ midi: DRUM_PITCHES.hihat, time: barStart + eighth * (beat / 2), duration: 0.05, velocity: 0.6 });
    }
  }

  return { fileName: 'drum-pattern.mid', description: '8 小节鼓点，覆盖底鼓、军鼓、闭镲，用于验证敲击类乐器的音色映射与连打耐受度', bytes: midi.toArray() };
}

export function allAssets(): GeneratedAsset[] {
  return [
    buildScaleAsset(),
    buildChordsAsset(),
    buildRepeatAsset(),
    buildLongMelodyAsset(),
    buildEnsembleAsset(),
    buildDrumAsset(),
  ];
}
