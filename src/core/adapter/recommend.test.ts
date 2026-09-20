import { describe, expect, it } from 'vitest';
import { BUILTIN_INSTRUMENTS } from '../instruments/registry';
import { InstrumentProfileSchema } from '../model/instrument';
import type { Note, Score, Track } from '../model/score';
import { DEFAULT_ADAPT_OPTIONS } from '../model/timeline';
import { defaultTrackIds, recommendOptions, recommendShift, trackHitRates } from './recommend';
import { recommendDrumVoiceNotes } from './percussionMap';

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
  it('默认只选中第一条有音符的合规音轨', () => {
    const score = scoreOf(track('t0', [note(0, 60)]), track('t1', [note(0, 62)]));
    expect(defaultTrackIds(score, lyre)).toEqual(['t0']);
  });

  it('音高类乐器跳过鼓轨与没有音符的音轨', () => {
    const score = scoreOf(
      track('t0', [note(0, 36)], true),
      track('t1', []),
      track('t2', [note(0, 60)]),
      track('t3', [note(0, 62)]),
    );
    expect(defaultTrackIds(score, lyre)).toEqual(['t2']);
  });

  it('敲击类乐器从全部音轨里选第一条有音符的', () => {
    const score = scoreOf(track('t0', []), track('t1', [note(0, 36)], true), track('t2', [note(0, 38)], true));
    expect(defaultTrackIds(score, drum)).toEqual(['t1']);
  });

  it('没有合规音轨时返回空数组', () => {
    expect(defaultTrackIds(scoreOf(track('t0', [note(0, 36)], true)), lyre)).toEqual([]);
    expect(defaultTrackIds(scoreOf(track('t0', [])), drum)).toEqual([]);
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

describe('敲击类推荐：鼓轨优先与音色指定预填', () => {
  const juju = builtin('juju-drum');

  it('敲击类默认优先勾选鼓轨，没有鼓轨时退回第一条有音符的轨', () => {
    const mixed = scoreOf(track('t0', [note(0, 60)]), track('t1', [note(0, 36)], true));
    expect(defaultTrackIds(mixed, juju)).toEqual(['t1']);
    expect(defaultTrackIds(mixed, drum)).toEqual(['t1']);
    const melodyOnly = scoreOf(track('t0', [note(0, 60)]));
    expect(defaultTrackIds(melodyOnly, juju)).toEqual(['t0']);
  });

  it('recommendDrumVoiceNotes：GM 表命中的音高沿用音色，表外音高按音高序分给剩余音色', () => {
    // 36→bass-2、38→snare-2、42→ride-2 都在聚聚鼓 GM 表内；99 表外 → 剩余音色里排最前的 bass
    const notes = [...Array.from({ length: 10 }, () => note(0, 36)), ...Array.from({ length: 6 }, () => note(0, 38)), ...Array.from({ length: 4 }, () => note(0, 99))];
    expect(recommendDrumVoiceNotes(notes, juju)).toEqual({ bass: 99, 'bass-2': 36, 'snare-2': 38 });
  });

  it('音高多于音色时只保留数量最多的前 N 个（聚聚鼓 8 个音色）', () => {
    // 10 个不同音高，数量从多到少；只有前 8 个能分到音色，最少的两个被舍弃
    const pitches = [36, 38, 42, 41, 43, 48, 49, 50, 51, 57];
    const many = pitches.flatMap((pitch, weight) => Array.from({ length: 10 - weight }, () => note(0, pitch)));
    const result = recommendDrumVoiceNotes(many, juju)!;
    expect(Object.keys(result)).toHaveLength(8);
    expect(Object.values(result)).toContain(36);
    // 57 在 GM 表里独立映射 snare（未被占用）照样命中；撞车落到 unmapped 的 50/51 没有剩余音色才被舍弃
    expect(Object.values(result)).toContain(57);
    expect(Object.values(result)).not.toContain(50);
    expect(Object.values(result)).not.toContain(51);
  });

  it('recommendOptions 为敲击类预填 drumVoiceNotes，音高类不填', () => {
    const drumScore = scoreOf(track('t0', Array.from({ length: 8 }, () => note(0, 36)), true));
    const pitchedScore = scoreOf(track('t0', [note(0, 60)]));
    expect(recommendOptions(drumScore, juju).drumVoiceNotes).toBeDefined();
    expect(recommendOptions(pitchedScore, lyre).drumVoiceNotes).toBeUndefined();
  });
});
