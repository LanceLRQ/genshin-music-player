import { describe, expect, it } from 'vitest';
import { BUILTIN_INSTRUMENTS } from '../instruments/registry';
import { InstrumentProfileSchema } from '../model/instrument';
import type { Note, Score, Track } from '../model/score';
import { type AdaptOptions, type AdaptReport, DEFAULT_ADAPT_OPTIONS, DEFAULT_RELEASE_GAP_MS } from '../model/timeline';
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
      chordHits: 0,
      chordFallbacks: 0,
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

  it('sustain 乐器的按住时长仍取配置值，音长超过配置值的音额外带 sustainMs', () => {
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
    expect(result.timeline.presses.map((p) => p.holdMs)).toEqual([30, 30]);
    expect(result.timeline.presses.map((p) => p.sustainMs)).toEqual([400, undefined]);
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
      { tMs: 0, codes: ['KeyS'], holdMs: 30 },
      { tMs: 500, codes: ['KeyA'], holdMs: 30 },
    ]);
    expect(result.report.dropped.unmappedDrum).toBe(1);
    expect(result.report.total).toBe(3);
  });

  it('按音色指定的音符优先于鼓映射表', () => {
    // 41 在内置映射里是「咔」，指定咚 = F2(41) 后应按 KeyS（咚）弹出
    const result = adapt(
      scoreOf(track('t0', [note(0, 41), note(500, 38)], true)),
      drum,
      options({ drumVoiceNotes: { don: 41 } }),
    );
    expect(codesOf(result)).toEqual([['KeyS'], ['KeyA']]);
    expect(result.report.dropped.unmappedDrum).toBe(0);
  });

  it('同一声音的对称键左右轮流：聚聚鼓 bass 连打在 Q/A 间交替', () => {
    const juju = builtin('juju-drum');
    const result = adapt(
      scoreOf(track('t0', [note(0, 36), note(100, 36), note(200, 36), note(300, 36)], true)),
      juju,
      options(),
    );
    expect(codesOf(result)).toEqual([['KeyQ'], ['KeyA'], ['KeyQ'], ['KeyA']]);
  });

  it('轮流按声音独立计数：bass 与擦交错时各自保持相位', () => {
    const juju = builtin('juju-drum');
    const result = adapt(
      scoreOf(track('t0', [note(0, 36), note(50, 42), note(100, 36), note(150, 42)], true)),
      juju,
      options(),
    );
    expect(codesOf(result)).toEqual([['KeyQ'], ['KeyI'], ['KeyA'], ['KeyK']]);
  });

  it('指定音符到变体音色时同样归并轮流（bass-2 与 bass 同组）', () => {
    const banquet = builtin('banquet-drum');
    const result = adapt(
      scoreOf(track('t0', [note(0, 35), note(100, 35), note(200, 35)], true)),
      banquet,
      options(),
    );
    // 35 → don；banquet 的 don = KeyS、don-2 = KeyK，三连击交替 S/K/S
    expect(codesOf(result)).toEqual([['KeyS'], ['KeyK'], ['KeyS']]);
  });

  it('对称键轮流把同键连打间隔翻倍：60ms 间隔连打不再触发 96ms 过密丢弃', () => {
    const juju = builtin('juju-drum');
    // 8 次连打、间隔 60ms：单键时后 7 次都会被 96ms 的 minRepeatGapMs 丢弃；
    // 左右交替后同键实际间隔 120ms，全部保留
    const notes = Array.from({ length: 8 }, (_, index) => note(index * 60, 36));
    const result = adapt(scoreOf(track('t0', notes, true)), juju, options());
    expect(result.timeline.presses).toHaveLength(8);
    expect(result.report.dropped.tooDense).toBe(0);
    expect(codesOf(result)).toEqual([['KeyQ'], ['KeyA'], ['KeyQ'], ['KeyA'], ['KeyQ'], ['KeyA'], ['KeyQ'], ['KeyA']]);
  });

  it('同一声音在同一时刻的重音合并成一次击打，不占用两个对称键', () => {
    const juju = builtin('juju-drum');
    // 两条鼓轨在同一时刻各有一个底鼓（MIDI 叠层与多轨合并都会出现）：
    // 轮流击打不能把它们拆成左右键同时按下，那在游戏里是一次双倍力度的击打
    const result = adapt(
      scoreOf(track('t0', [note(0, 36)], true), track('t1', [note(0, 36)], true)),
      juju,
      options({ tracks: ['t0', 't1'] }),
    );
    expect(codesOf(result)).toEqual([['KeyQ']]);
    expect(result.report.merged).toBe(1);
    expect(result.report.played).toBe(1);
    expect(result.report.total).toBe(2);
  });

  it('被合并的重音不占用轮流计数，后续击打仍从另一侧继续', () => {
    const juju = builtin('juju-drum');
    // t=0 与 t=5 在 chordWindowMs(15) 内属同一次击打，合并后只消耗一个计数，
    // 因此 t=200 的下一击应落在 KeyA 而不是跳回 KeyQ
    const result = adapt(
      scoreOf(track('t0', [note(0, 36), note(5, 36), note(200, 36)], true)),
      juju,
      options(),
    );
    expect(codesOf(result)).toEqual([['KeyQ'], ['KeyA']]);
    expect(result.report.merged).toBe(1);
  });

  it('多轨合并时轮流按时间顺序推进，而非按轨道先后', () => {
    const juju = builtin('juju-drum');
    // 轨 t0 在 0/200/400、轨 t1 在 100/300：按时间序应严格左右交替，
    // 若按「先走完 t0 再走 t1」分配，会出现 100/200 连着两次 KeyA
    const result = adapt(
      scoreOf(
        track('t0', [note(0, 36), note(200, 36), note(400, 36)], true),
        track('t1', [note(100, 36), note(300, 36)], true),
      ),
      juju,
      options({ tracks: ['t0', 't1'] }),
    );
    expect(codesOf(result)).toEqual([['KeyQ'], ['KeyA'], ['KeyQ'], ['KeyA'], ['KeyQ']]);
  });

  it('非鼓轨（如写在普通通道的鼓谱）上按音色指定的音符生效，不再全数丢弃', () => {
    const juju = builtin('juju-drum');
    // 模拟「不问天-鼓」：644 个音全在 36/38/42，但写在通道 1（isDrum = false）
    const result = adapt(
      scoreOf(track('t0', [note(0, 36), note(50, 38), note(100, 42)], false)),
      juju,
      options({ drumVoiceNotes: { bass: 36, snare: 38, 'hi-hat': 42 } }),
    );
    expect(codesOf(result)).toEqual([['KeyQ'], ['KeyW'], ['KeyI']]);
    expect(result.report.dropped.unmappedDrum).toBe(0);
  });

  it('非鼓轨默认以音高中位数分界', () => {
    const result = adapt(scoreOf(track('t0', [note(0, 50), note(500, 70)])), drum, options());
    expect(codesOf(result)).toEqual([['KeyS'], ['KeyA']]);
  });

  it('percussionSplitPitch 覆盖分界音高', () => {
    const result = adapt(scoreOf(track('t0', [note(0, 50), note(500, 70)])), drum, options({ percussionSplitPitch: 80 }));
    expect(codesOf(result)).toEqual([['KeyS'], ['KeyS']]);
  });

  it('乐器配置中的数值分界音高优先于中位数', () => {
    const splitDrum = InstrumentProfileSchema.parse({
      ...drum,
      id: 'split-drum',
      percussionMap: { ...drum.percussionMap!, splitPitch: 40 },
    });
    const result = adapt(scoreOf(track('t0', [note(0, 50), note(500, 70)])), splitDrum, options());
    expect(codesOf(result)).toEqual([['KeyA'], ['KeyA']]);
  });

  it('敲击类乐器不应用移调', () => {
    const result = adapt(scoreOf(track('t0', [note(0, 36)], true)), drum, options({ transpose: 5 }));
    expect(codesOf(result)).toEqual([['KeyS']]);
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

  it('chordHits / chordFallbacks 分别统计命中与回退的音组数', () => {
    const hit = adapt(scoreOf(track('t0', [note(0, 60), note(0, 64), note(0, 67)])), chordLyre, options());
    expect(hit.report.chordHits).toBe(1);
    expect(hit.report.chordFallbacks).toBe(0);
    const fallback = adapt(scoreOf(track('t0', [note(0, 60), note(0, 62), note(0, 64)])), chordLyre, options());
    expect(fallback.report.chordHits).toBe(0);
    expect(fallback.report.chordFallbacks).toBe(1);
    // 单音与二音组不参与统计
    const single = adapt(scoreOf(track('t0', [note(0, 60)])), chordLyre, options());
    expect(single.report.chordHits).toBe(0);
    expect(single.report.chordFallbacks).toBe(0);
  });

  it('useChordKeys 关闭后不做和弦匹配，统计为 0', () => {
    const result = adapt(
      scoreOf(track('t0', [note(0, 60), note(0, 64), note(0, 67)])),
      chordLyre,
      options({ useChordKeys: false }),
    );
    expect(result.report.chordHits).toBe(0);
    expect(result.report.chordFallbacks).toBe(0);
    expect(result.timeline.presses).toHaveLength(1);
    expect(result.timeline.presses[0].codes.length).toBe(3);
  });

  it('乐器没有和弦键时统计恒为 0', () => {
    const result = adapt(scoreOf(track('t0', [note(0, 60), note(0, 64), note(0, 67)])), lyre, options());
    expect(result.report.chordHits).toBe(0);
    expect(result.report.chordFallbacks).toBe(0);
  });
});

describe('adapt：按住时长与音长按键', () => {
  it('holdMsOverride 覆盖乐器配置的按住时长', () => {
    const result = adapt(scoreOf(track('t0', [note(0, 60), note(500, 62)])), lyre, options({ holdMsOverride: 80 }));
    expect(result.timeline.presses.map((p) => p.holdMs)).toEqual([80, 80]);
  });

  it('useNoteDuration 打开后，音长超过按住时长的音附带 sustainMs，未超过的不带', () => {
    const result = adapt(
      scoreOf(track('t0', [note(0, 60, 400), note(500, 62, 10)])),
      lyre,
      options({ useNoteDuration: true }),
    );
    expect(result.timeline.presses).toEqual([
      { tMs: 0, codes: ['KeyA'], holdMs: 30, sustainMs: 400 },
      { tMs: 500, codes: ['KeyS'], holdMs: 30 },
    ]);
  });

  it('按音长模式忽略 holdMsOverride：兜底取乐器配置的按住时长', () => {
    const result = adapt(
      scoreOf(track('t0', [note(0, 60, 80), note(500, 62, 200)])),
      lyre,
      options({ useNoteDuration: true, holdMsOverride: 100 }),
    );
    expect(result.timeline.presses).toEqual([
      { tMs: 0, codes: ['KeyA'], holdMs: 30, sustainMs: 80 },
      { tMs: 500, codes: ['KeyS'], holdMs: 30, sustainMs: 200 },
    ]);
  });

  it('sustain 乐器默认按音长；useNoteDuration 显式关闭后改为固定按住时长', () => {
    const sustainLyre = InstrumentProfileSchema.parse({
      ...lyre,
      id: 'sustain-lyre-override',
      timing: { ...lyre.timing, sustain: true },
    });
    const score = scoreOf(track('t0', [note(0, 60, 500)]));
    expect(adapt(score, sustainLyre, options({ holdMsOverride: 100 })).timeline.presses).toEqual([
      { tMs: 0, codes: ['KeyA'], holdMs: 30, sustainMs: 500 },
    ]);
    expect(adapt(score, sustainLyre, options({ useNoteDuration: false, holdMsOverride: 100 })).timeline.presses).toEqual([
      { tMs: 0, codes: ['KeyA'], holdMs: 100 },
    ]);
  });

  it('和弦键路径不设置 sustainMs：固定时长模式取覆盖值，按音长模式取乐器配置值', () => {
    const chordLyre = {
      ...structuredClone(lyre),
      rows: [{ label: '和弦', keys: [{ chord: [48, 52, 55], label: 'C', code: 'KeyQ' }] }, ...lyre.rows],
    } as typeof lyre;
    const score = scoreOf(track('t0', [note(0, 60, 999), note(0, 64, 999), note(0, 67, 999)]));
    expect(adapt(score, chordLyre, options({ holdMsOverride: 50 })).timeline.presses).toEqual([
      { tMs: 0, codes: ['KeyQ'], holdMs: 50 },
    ]);
    expect(adapt(score, chordLyre, options({ useNoteDuration: true, holdMsOverride: 50 })).timeline.presses).toEqual([
      { tMs: 0, codes: ['KeyQ'], holdMs: 30 },
    ]);
  });

  it('durationMs 取 tMs + max(holdMs, sustainMs)', () => {
    const result = adapt(scoreOf(track('t0', [note(0, 60, 500)])), lyre, options({ useNoteDuration: true }));
    expect(result.timeline.durationMs).toBe(500);
  });

  it('长音模式下 timeline.releaseGapMs 默认取 DEFAULT_RELEASE_GAP_MS，显式传入时优先生效', () => {
    const score = scoreOf(track('t0', [note(0, 60, 500)]));
    const withDefault = adapt(score, lyre, options({ useNoteDuration: true }));
    expect(withDefault.timeline.releaseGapMs).toBe(DEFAULT_RELEASE_GAP_MS);
    const withOverride = adapt(score, lyre, options({ useNoteDuration: true, releaseGapMs: 80 }));
    expect(withOverride.timeline.releaseGapMs).toBe(80);
  });

  it('固定时长模式下 timeline 不带 releaseGapMs 这个 key', () => {
    const result = adapt(scoreOf(track('t0', [note(0, 60, 500)])), lyre, options({ useNoteDuration: false }));
    expect('releaseGapMs' in result.timeline).toBe(false);
  });
});
