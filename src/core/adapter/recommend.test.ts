import { describe, expect, it } from 'vitest';
import { BUILTIN_INSTRUMENTS } from '../instruments/registry';
import { InstrumentProfileSchema } from '../model/instrument';
import type { Note, Score, Track } from '../model/score';
import { DEFAULT_ADAPT_OPTIONS } from '../model/timeline';
import { defaultTrackIds, recommendOptions, recommendShift, trackHitRates } from './recommend';

const builtin = (id: string) => BUILTIN_INSTRUMENTS.find((p) => p.id === id)!;
const lyre = builtin('windsong-lyre');
const drum = builtin('festive-drum');
const narrow = InstrumentProfileSchema.parse({
  schemaVersion: 1,
  id: 'narrow',
  name: '窄音域',
  kind: 'pitched',
  status: 'unverified',
  rows: [
    {
      label: '行',
      keys: [
        { pitch: 60, code: 'KeyA' },
        { pitch: 62, code: 'KeyS' },
      ],
    },
  ],
  timing: { holdMs: 30, minRepeatGapMs: 40 },
});

const note = (startMs: number, pitch: number): Note => ({ startMs, durationMs: 100, pitch, velocity: 0.8 });
const track = (id: string, notes: Note[], isDrum = false): Track => ({ id, name: id, isDrum, notes });
const scoreOf = (...tracks: Track[]): Score => ({ meta: { title: '测试', source: 'json' }, tracks });
const melody = (pitches: number[]) => scoreOf(track('t0', pitches.map((p, i) => note(i * 500, p))));

describe('recommendShift', () => {
  it('C 大调旋律不移调', () => {
    expect(recommendShift(melody([60, 62, 64, 65, 67, 69, 71]), lyre, ['t0'])).toEqual({ transpose: 0, octaveShift: 0 });
  });

  it('D 大调旋律推荐移调 -2', () => {
    expect(recommendShift(melody([62, 64, 66, 67, 69, 71, 73]), lyre, ['t0'])).toEqual({ transpose: -2, octaveShift: 0 });
  });

  it('音域过高时降八度，同分时取偏移量更小的方案', () => {
    expect(recommendShift(melody([96, 98, 100, 101, 103, 105, 107]), lyre, ['t0'])).toEqual({
      transpose: 0,
      octaveShift: -2,
    });
  });

  it('没有八度能让中位数落进音域时，取最接近音域中心的八度', () => {
    // 窄音域只有 60、62：中位数 127 在 ±5 个八度内都落不进 60–62，
    // 退而取 round((61 − 127) / 12) = −5；该八度下只有移调 −5（127 − 60 − 5 = 62）能命中
    expect(recommendShift(melody([127]), narrow, ['t0'])).toEqual({ transpose: -5, octaveShift: -5 });
  });

  it('和弦里的最高音算作旋律，得分加倍', () => {
    // 两个和弦 [60, 61] 与 [62, 64]：移调 0 和移调 −2 都命中 3 个音，只比命中数会选移调 0；
    // 但移调 −2 时两个旋律音（61→59、64→62）都命中，得 5 分，高于移调 0 的 4 分
    const score = scoreOf(track('t0', [note(0, 60), note(0, 61), note(500, 62), note(500, 64)]));
    expect(recommendShift(score, lyre, ['t0'])).toEqual({ transpose: -2, octaveShift: 0 });
  });

  it('没有音高音符或目标是敲击类乐器时不移调', () => {
    expect(recommendShift(scoreOf(track('t0', [])), lyre, ['t0'])).toEqual({ transpose: 0, octaveShift: 0 });
    expect(recommendShift(melody([62, 64, 66]), drum, ['t0'])).toEqual({ transpose: 0, octaveShift: 0 });
  });
});

describe('defaultTrackIds', () => {
  it('音高类乐器默认选中非鼓轨，敲击类乐器选中全部音轨', () => {
    const score = scoreOf(track('t0', [note(0, 60)]), track('t1', [note(0, 36)], true));
    expect(defaultTrackIds(score, lyre)).toEqual(['t0']);
    expect(defaultTrackIds(score, drum)).toEqual(['t0', 't1']);
  });
});

describe('recommendOptions', () => {
  it('合并默认参数与推荐的移调', () => {
    expect(recommendOptions(melody([62, 64, 66, 67, 69, 71, 73]), lyre)).toEqual({
      ...DEFAULT_ADAPT_OPTIONS,
      tracks: ['t0'],
      transpose: -2,
      octaveShift: 0,
    });
  });

  it('来源乐器与目标乐器相同时不做移调推荐', () => {
    const options = recommendOptions(melody([62, 64, 66, 67, 69, 71, 73]), lyre, 'windsong-lyre');
    expect([options.transpose, options.octaveShift]).toEqual([0, 0]);
  });
});

describe('trackHitRates', () => {
  it('逐轨单独适配计算命中率，没有可处理音符的音轨为 0', () => {
    const score = scoreOf(
      track('t0', [note(0, 60), note(500, 62)]),
      track('t1', [note(0, 61), note(500, 63)]),
      track('t2', [note(0, 36)], true),
    );
    const options = { ...DEFAULT_ADAPT_OPTIONS, tracks: ['t0', 't1', 't2'] };
    expect(trackHitRates(score, lyre, options)).toEqual({ t0: 1, t1: 0, t2: 0 });
  });
});
