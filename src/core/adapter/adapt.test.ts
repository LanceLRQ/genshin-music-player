import { describe, expect, it } from 'vitest';
import { BUILTIN_INSTRUMENTS } from '../instruments/registry';
import { InstrumentProfileSchema } from '../model/instrument';
import type { Note, Score, Track } from '../model/score';
import { type AdaptOptions, type AdaptReport, DEFAULT_ADAPT_OPTIONS } from '../model/timeline';
import { adapt, emptyReport, hitRate } from './adapt';

const builtin = (id: string) => BUILTIN_INSTRUMENTS.find((p) => p.id === id)!;
const lyre = builtin('windsong-lyre');
const drum = builtin('festive-drum');

const note = (startMs: number, pitch: number, durationMs = 100): Note => ({ startMs, durationMs, pitch, velocity: 0.8 });
const track = (id: string, notes: Note[], isDrum = false): Track => ({ id, name: id, isDrum, notes });
const scoreOf = (...tracks: Track[]): Score => ({ meta: { title: '测试', source: 'json' }, tracks });
const options = (overrides: Partial<AdaptOptions> = {}): AdaptOptions => ({
  ...DEFAULT_ADAPT_OPTIONS,
  tracks: ['t0'],
  ...overrides,
});
const droppedTotal = (report: AdaptReport) => Object.values(report.dropped).reduce((sum, n) => sum + n, 0);
const codesOf = (result: ReturnType<typeof adapt>) => result.timeline.presses.map((p) => p.codes);

describe('adapt：音高类乐器', () => {
  it('逐个音映射成按键，holdMs 取乐器配置', () => {
    const result = adapt(scoreOf(track('t0', [note(0, 60), note(500, 62)])), lyre, options());
    expect(result.timeline).toEqual({
      instrumentId: 'windsong-lyre',
      durationMs: 530,
      minRepeatGapMs: 75,
      presses: [
        { tMs: 0, codes: ['KeyA'], holdMs: 30 },
        { tMs: 500, codes: ['KeyS'], holdMs: 30 },
      ],
    });
    expect(result.report).toEqual({
      total: 2,
      played: 2,
      folded: 0,
      merged: 0,
      dropped: { blackKey: 0, outOfRange: 0, polyphony: 0, tooDense: 0, unmappedDrum: 0 },
    });
  });

  it('应用移调和八度偏移', () => {
    const result = adapt(scoreOf(track('t0', [note(0, 48), note(500, 58)])), lyre, options({ transpose: 2, octaveShift: 1 }));
    expect(codesOf(result)).toEqual([['KeyS'], ['KeyQ']]);
  });

  it('和弦窗口内的音合并为一次按键，按音高从高到低排列', () => {
    const result = adapt(
      scoreOf(track('t0', [note(0, 60), note(10, 64), note(14, 67), note(20, 72)])),
      lyre,
      options(),
    );
    expect(result.timeline.presses.map((p) => [p.tMs, p.codes])).toEqual([
      [0, ['KeyG', 'KeyD', 'KeyA']],
      [20, ['KeyQ']],
    ]);
  });

  it('超过复音上限时保留最高的音', () => {
    const result = adapt(scoreOf(track('t0', [note(0, 60), note(0, 64), note(0, 67)])), lyre, options({ maxPolyphony: 1 }));
    expect(codesOf(result)).toEqual([['KeyG']]);
    expect(result.report.dropped.polyphony).toBe(2);
    expect(result.report.played).toBe(1);
  });

  it('同组映射到同一个键时只按一次，计入 merged 而不是丢音', () => {
    const result = adapt(scoreOf(track('t0', [note(0, 72), note(0, 84)])), lyre, options());
    expect(codesOf(result)).toEqual([['KeyQ']]);
    expect(result.report.merged).toBe(1);
    expect(result.report.dropped.polyphony).toBe(0);
    expect(result.report.folded).toBe(1);
  });

  it('合并多轨：齐唱的同音只按一次，各轨独有的音都保留', () => {
    const score = scoreOf(track('t0', [note(0, 60), note(500, 62)]), track('t1', [note(0, 60), note(1000, 64)]));
    const merged = adapt(score, lyre, options({ tracks: ['t0', 't1'] }));
    expect(merged.timeline.presses.map((p) => [p.tMs, p.codes])).toEqual([
      [0, ['KeyA']],
      [500, ['KeyS']],
      [1000, ['KeyD']],
    ]);
    expect(merged.report).toMatchObject({ total: 4, played: 3, merged: 1 });
    expect(hitRate(merged.report)).toBe(1);

    const solo = adapt(score, lyre, options({ tracks: ['t1'] }));
    expect(solo.timeline.presses.map((p) => [p.tMs, p.codes])).toEqual([
      [0, ['KeyA']],
      [1000, ['KeyD']],
    ]);
  });

  it('hitRate = (played + merged) / total，total 为 0 时为 0', () => {
    expect(hitRate(emptyReport())).toBe(0);
    expect(hitRate({ ...emptyReport(), total: 4, played: 2, merged: 1 })).toBe(0.75);
  });

  it('同一个键间隔小于 minRepeatGapMs 时丢弃后一次', () => {
    const result = adapt(scoreOf(track('t0', [note(0, 60), note(30, 60), note(80, 60)])), lyre, options());
    expect(result.timeline.presses.map((p) => p.tMs)).toEqual([0, 80]);
    expect(result.report.dropped.tooDense).toBe(1);
  });

  it('按策略统计丢音，total = played + merged + 各类丢音之和', () => {
    const result = adapt(
      scoreOf(track('t0', [note(0, 61), note(500, 90), note(1000, 60)])),
      lyre,
      options({ outOfRangePolicy: 'drop' }),
    );
    expect(result.report.dropped.blackKey).toBe(1);
    expect(result.report.dropped.outOfRange).toBe(1);
    expect(result.report.played).toBe(1);
    expect(result.report.total).toBe(result.report.played + result.report.merged + droppedTotal(result.report));
  });

  it('只处理选中的音轨，鼓轨不参与音高类适配', () => {
    const score = scoreOf(track('t0', [note(0, 60)]), track('t1', [note(0, 62)]), track('t2', [note(0, 36)], true));
    const result = adapt(score, lyre, options({ tracks: ['t1', 't2'] }));
    expect(codesOf(result)).toEqual([['KeyS']]);
    expect(result.report.total).toBe(1);
  });

  it('sustain 乐器的 holdMs 取组内最长时值，且不小于配置值', () => {
    const sustainLyre = InstrumentProfileSchema.parse({
      ...lyre,
      id: 'sustain-lyre',
      timing: { ...lyre.timing, sustain: true },
    });
    const result = adapt(
      scoreOf(track('t0', [note(0, 60, 400), note(5, 64, 10), note(1000, 62, 10)])),
      sustainLyre,
      options(),
    );
    expect(result.timeline.presses.map((p) => p.holdMs)).toEqual([400, 30]);
  });

  it('带 voice 的音符在音高类乐器上计入 unmappedDrum', () => {
    const voiced: Note = { startMs: 0, durationMs: 100, voice: 'don', velocity: 1 };
    const result = adapt(scoreOf(track('t0', [voiced])), lyre, options());
    expect(result.timeline.presses).toEqual([]);
    expect(result.report.dropped.unmappedDrum).toBe(1);
  });

  it('没有选中音轨时返回空时间线', () => {
    const result = adapt(scoreOf(track('t0', [note(0, 60)])), lyre, options({ tracks: [] }));
    expect(result.timeline.presses).toEqual([]);
    expect(result.timeline.durationMs).toBe(0);
    expect(result.report.total).toBe(0);
  });
});

describe('adapt：敲击类乐器', () => {
  it('鼓轨按映射表转换，未映射的音计入 unmappedDrum', () => {
    const result = adapt(scoreOf(track('t0', [note(0, 36), note(500, 38), note(1000, 99)], true)), drum, options());
    expect(result.timeline.presses).toEqual([
      { tMs: 0, codes: ['KeyF'], holdMs: 30 },
      { tMs: 500, codes: ['KeyJ'], holdMs: 30 },
    ]);
    expect(result.report.dropped.unmappedDrum).toBe(1);
    expect(result.report.total).toBe(3);
  });

  it('非鼓轨默认以音高中位数分界', () => {
    const result = adapt(scoreOf(track('t0', [note(0, 50), note(500, 70)])), drum, options());
    expect(codesOf(result)).toEqual([['KeyF'], ['KeyJ']]);
  });

  it('percussionSplitPitch 覆盖分界音高', () => {
    const result = adapt(scoreOf(track('t0', [note(0, 50), note(500, 70)])), drum, options({ percussionSplitPitch: 80 }));
    expect(codesOf(result)).toEqual([['KeyF'], ['KeyF']]);
  });

  it('乐器配置中的数值分界音高优先于中位数', () => {
    const splitDrum = InstrumentProfileSchema.parse({
      ...drum,
      id: 'split-drum',
      percussionMap: { ...drum.percussionMap!, splitPitch: 40 },
    });
    const result = adapt(scoreOf(track('t0', [note(0, 50), note(500, 70)])), splitDrum, options());
    expect(codesOf(result)).toEqual([['KeyJ'], ['KeyJ']]);
  });

  it('敲击类乐器不应用移调', () => {
    const result = adapt(scoreOf(track('t0', [note(0, 36)], true)), drum, options({ transpose: 5 }));
    expect(codesOf(result)).toEqual([['KeyF']]);
  });
});

describe('adapt：和弦键匹配（M6）', () => {
  const chordLyre = {
    ...structuredClone(lyre),
    rows: [
      {
        label: '和弦',
        keys: [
          { chord: [48, 52, 55], label: 'C', code: 'KeyQ' },
          { chord: [50, 53, 57], label: 'Dm', code: 'KeyW' },
        ],
      },
      ...lyre.rows,
    ],
  } as typeof lyre;

  it('C 大三和弦簇收成一个和弦键', () => {
    const result = adapt(
      scoreOf(track('t0', [note(0, 60), note(0, 64), note(0, 67)])),
      chordLyre,
      options(),
    );
    expect(result.timeline.presses).toHaveLength(1);
    expect(result.timeline.presses[0].codes).toEqual(['KeyQ']);
  });

  it('D 小三和弦簇命中 Dm 键；单音与二音组不受影响', () => {
    const dm = adapt(scoreOf(track('t0', [note(0, 62), note(0, 65), note(0, 69)])), chordLyre, options());
    expect(dm.timeline.presses[0]?.codes).toEqual(['KeyW']);
    const single = adapt(scoreOf(track('t0', [note(0, 60)])), chordLyre, options());
    expect(single.timeline.presses[0]?.codes).toEqual(['KeyA']);
    const dyad = adapt(scoreOf(track('t0', [note(0, 60), note(0, 64)])), chordLyre, options());
    expect(dyad.timeline.presses[0]?.codes).toHaveLength(2);
  });

  it('不匹配的簇回退逐音映射', () => {
    const off = adapt(scoreOf(track('t0', [note(0, 60), note(0, 62), note(0, 64)])), chordLyre, options());
    expect(off.timeline.presses[0]?.codes.length).toBeGreaterThan(1);
  });
});
