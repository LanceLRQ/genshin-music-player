import { describe, expect, it } from 'vitest';
import { adapt } from '../adapter/adapt';
import type { InstrumentProfile } from '../model/instrument';
import type { Score } from '../model/score';
import type { AdaptOptions } from '../model/timeline';
import {
  BUILTIN_INSTRUMENTS,
  CUSTOM_GROUP_KEY,
  findInstrument,
  groupInstrumentEntries,
  isBuiltinInstrumentId,
  mergeInstruments,
  stripHoldControlOptions,
  supportsHoldControl,
} from './registry';

const builtin = (id: string) => BUILTIN_INSTRUMENTS.find((p) => p.id === id)!;
const pitchesOf = (profile: InstrumentProfile) => profile.rows.flatMap((row) => row.keys.map((key) => key.pitch as number));

describe('内置乐器', () => {
  it('按固定顺序提供 12 种乐器', () => {
    expect(BUILTIN_INSTRUMENTS.map((p) => p.id)).toEqual([
      'windsong-lyre',
      'floral-zither',
      'vintage-lyre',
      'two-row-prototype',
      'festive-drum',
      'yuco-lyre',
      'harmony-clavier',
      'sprightly-lyre',
      'lingering-echo',
      'evening-horn',
      'juju-drum',
      'banquet-drum',
    ]);
  });

  it('风物之诗琴 21 键，覆盖 C3–B5，上排 Q 为 C5', () => {
    const lyre = builtin('windsong-lyre');
    const pitches = pitchesOf(lyre);
    expect(pitches).toHaveLength(21);
    expect(Math.min(...pitches)).toBe(48);
    expect(Math.max(...pitches)).toBe(83);
    expect(lyre.rows[0].keys[0]).toEqual({ pitch: 72, code: 'KeyQ' });
    expect(lyre.status).toBe('verified');
  });

  it('镜花之琴与风物之诗琴键位相同', () => {
    expect(builtin('floral-zither').rows).toEqual(builtin('windsong-lyre').rows);
  });

  it('老旧的诗琴已验证（2026-09-19 游戏内实测），上排为 C 弗里几亚音阶', () => {
    const vintage = builtin('vintage-lyre');
    expect(vintage.status).toBe('verified');
    expect(vintage.rows[0].keys.map((k) => k.pitch)).toEqual([72, 73, 75, 77, 79, 80, 82]);
  });

  it('沃雅妮莎（两行人声乐器）14 键，低音行 la=H、ti=J（2026-09-23 用户实测：下排 ASDFGHJ）', () => {
    const twoRow = builtin('two-row-prototype');
    expect(twoRow.name).toBe('沃雅妮莎');
    expect(twoRow.rows).toHaveLength(2);
    expect(pitchesOf(twoRow)).toHaveLength(14);
    expect(twoRow.rows[1].keys[5]).toEqual({ pitch: 57, code: 'KeyH' });
    expect(twoRow.rows[1].keys[6]).toEqual({ pitch: 59, code: 'KeyJ' });
    expect(twoRow.status).toBe('verified');
  });

  it('荒泷·盛世豪鼓是敲击类：咚 = S，咔 = A（2026-09-19 游戏内确认，另 K/L 为同音色备用键）', () => {
    const drum = builtin('festive-drum');
    expect(drum.name).toBe('荒泷·盛世豪鼓');
    expect(drum.kind).toBe('percussion');
    expect(drum.rows[0].keys).toEqual([
      { voice: 'don', code: 'KeyS' },
      { voice: 'ka', code: 'KeyA' },
    ]);
    expect(drum.percussionMap?.splitPitch).toBe('auto');
    expect(drum.status).toBe('verified');
  });

  it('悠可琴/余音为和弦吉他：Q 排 7 个和弦键 + 下两排单音（M6）', () => {
    for (const id of ['yuco-lyre', 'lingering-echo']) {
      const guitar = builtin(id);
      expect(guitar.rows).toHaveLength(3);
      const chordRow = guitar.rows[0].keys;
      expect(chordRow.map((k) => k.label)).toEqual(['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim']);
      expect(chordRow[0].chord).toEqual([48, 52, 55]);
      expect(guitar.rows[1].keys.map((k) => k.pitch)).toEqual([60, 62, 64, 65, 67, 69, 71]);
      expect(guitar.rows[2].keys.map((k) => k.pitch)).toEqual([48, 50, 52, 53, 55, 57, 59]);
    }
  });

  it('谐律键琴/跃律琴与风物之诗琴键位相同', () => {
    for (const id of ['harmony-clavier', 'sprightly-lyre']) {
      expect(builtin(id).rows).toEqual(builtin('windsong-lyre').rows);
    }
  });

  it('晚风圆号 14 键两行（QWERTYU/ASDFGHJ，各一个八度，2026-09-19 游戏内实测修正）', () => {
    const horn = builtin('evening-horn');
    expect(horn.rows).toHaveLength(2);
    expect(horn.rows.flatMap((row) => row.keys.map((k) => k.code))).toEqual([
      'KeyQ',
      'KeyW',
      'KeyE',
      'KeyR',
      'KeyT',
      'KeyY',
      'KeyU',
      'KeyA',
      'KeyS',
      'KeyD',
      'KeyF',
      'KeyG',
      'KeyH',
      'KeyJ',
    ]);
    expect(pitchesOf(horn)).toEqual([60, 62, 64, 65, 67, 69, 71, 48, 50, 52, 53, 55, 57, 59]);
  });

  it('聚聚鼓 8 键（上排 QWIO / 下排 ASKL，键帽 B/T/S/R；声音 底鼓/军鼓/擦/三连音，2026-09-20 复测修正）', () => {
    const drum = builtin('juju-drum');
    expect(drum.kind).toBe('percussion');
    expect(drum.rows.flatMap((row) => row.keys.map((k) => k.code))).toEqual([
      'KeyQ',
      'KeyW',
      'KeyI',
      'KeyO',
      'KeyA',
      'KeyS',
      'KeyK',
      'KeyL',
    ]);
    expect(drum.rows[0].keys.map((k) => k.voice)).toEqual(['bass', 'snare', 'hi-hat', 'triplet']);
    expect(drum.rows[1].keys.map((k) => k.voice)).toEqual(['bass-2', 'snare-2', 'hi-hat-2', 'triplet-2']);
  });

  it('绮筵之鼓 4 键（A 咔 / S 咚 / K 咚备用 / L 咔备用，与荒泷鼓同布局，2026-09-19 游戏内确认）', () => {
    const drum = builtin('banquet-drum');
    expect(drum.kind).toBe('percussion');
    expect(drum.rows).toHaveLength(1);
    expect(drum.rows[0].keys.map((k) => k.code)).toEqual(['KeyA', 'KeyS', 'KeyK', 'KeyL']);
    expect(drum.rows[0].keys.map((k) => k.voice)).toEqual(['ka', 'don', 'don-2', 'ka-2']);
  });
});

describe('内置乐器的 timing.sustain', () => {
  it('晚风圆号、沃雅妮莎（游戏里按住持续发声）timing.sustain 为 true，其余内置乐器为 false（沃雅妮莎 2026-09-23 实测按音长效果最好，改回默认开）', () => {
    for (const profile of BUILTIN_INSTRUMENTS) {
      const expectSustain = profile.id === 'evening-horn' || profile.id === 'two-row-prototype';
      expect(profile.timing.sustain, profile.id).toBe(expectSustain);
    }
  });

  it('默认 options（不设 useNoteDuration）演奏晚风圆号 / 沃雅妮莎：跟随乐器 sustain，音长超过 holdMs 的音带 sustainMs', () => {
    const defaultOptions: AdaptOptions = {
      tracks: ['t0'],
      transpose: 0,
      octaveShift: 0,
      blackKeyPolicy: 'skip',
      outOfRangePolicy: 'fold',
      maxPolyphony: 3,
      chordWindowMs: 15,
    };
    for (const id of ['evening-horn', 'two-row-prototype']) {
      const profile = builtin(id);
      const pitch = profile.rows[0].keys[0].pitch!;
      const longNoteMs = profile.timing.holdMs + 200;
      const score: Score = {
        meta: { title: '测试', source: 'json' },
        tracks: [{ id: 't0', name: 't0', isDrum: false, notes: [{ startMs: 0, durationMs: longNoteMs, pitch, velocity: 0.8 }] }],
      };
      const result = adapt(score, profile, defaultOptions);
      expect(result.timeline.presses).toHaveLength(1);
      expect(result.timeline.presses[0].holdMs).toBe(profile.timing.holdMs);
      expect(result.timeline.presses[0].sustainMs, id).toBe(longNoteMs);
    }
  });
});

describe('mergeInstruments', () => {
  const custom = (id: string, name = id): InstrumentProfile => ({ ...builtin('windsong-lyre'), id, name, status: 'unverified' });

  it('内置在前、自定义在后', () => {
    const { entries, warnings } = mergeInstruments([custom('my-lyre')]);
    expect(entries.map((e) => [e.profile.id, e.builtin])).toEqual([
      ['windsong-lyre', true],
      ['floral-zither', true],
      ['vintage-lyre', true],
      ['two-row-prototype', true],
      ['festive-drum', true],
      ['yuco-lyre', true],
      ['harmony-clavier', true],
      ['sprightly-lyre', true],
      ['lingering-echo', true],
      ['evening-horn', true],
      ['juju-drum', true],
      ['banquet-drum', true],
      ['my-lyre', false],
    ]);
    expect(warnings).toEqual([]);
  });

  it('自定义乐器与内置 id 冲突时跳过并警告', () => {
    const { entries, warnings } = mergeInstruments([custom('windsong-lyre', '山寨琴')]);
    expect(entries).toHaveLength(12);
    expect(warnings).toEqual(['自定义乐器「山寨琴」的 id「windsong-lyre」与内置乐器重复，已跳过']);
  });

  it('自定义乐器之间 id 重复时保留第一个', () => {
    const { entries, warnings } = mergeInstruments([custom('my-lyre', '甲'), custom('my-lyre', '乙')]);
    expect(entries.filter((e) => !e.builtin).map((e) => e.profile.name)).toEqual(['甲']);
    expect(warnings).toEqual(['自定义乐器 id「my-lyre」重复，已跳过「乙」']);
  });

  it('内置敲击乐器的鼓映射覆盖 GM 全音域（35–81），音色都存在于键位', () => {
    for (const profile of BUILTIN_INSTRUMENTS) {
      if (profile.kind !== 'percussion') continue;
      const voices = new Set(profile.rows.flatMap((row) => row.keys.map((key) => key.voice).filter((v) => v !== undefined)));
      const drumNotes = profile.percussionMap?.drumNotes ?? {};
      for (let note = 35; note <= 81; note += 1) {
        const voice = drumNotes[String(note)];
        expect(voice, `${profile.id} 缺少 GM ${note} 的映射`).toBeDefined();
        expect(voices.has(voice), `${profile.id} 的 GM ${note} 映射到不存在的音色 ${voice}`).toBe(true);
      }
    }
  });

  it('findInstrument 与 isBuiltinInstrumentId', () => {
    const { entries } = mergeInstruments([custom('my-lyre')]);
    expect(findInstrument(entries, 'my-lyre')?.name).toBe('my-lyre');
    expect(findInstrument(entries, 'nope')).toBeUndefined();
    expect(isBuiltinInstrumentId('festive-drum')).toBe(true);
    expect(isBuiltinInstrumentId('my-lyre')).toBe(false);
  });
});

describe('groupInstrumentEntries', () => {
  const custom = (id: string, name = id): InstrumentProfile => ({ ...builtin('windsong-lyre'), id, name, status: 'unverified' });

  it('内置乐器按分类分组（琴类 → 鼓类 → 圆号 → 人声），组内保持原顺序', () => {
    const { entries } = mergeInstruments([]);
    const groups = groupInstrumentEntries(entries);
    expect(groups.map((g) => [g.key, g.label, g.entries.length])).toEqual([
      ['lyre', '琴类', 7],
      ['drum', '鼓类', 3],
      ['horn', '圆号', 1],
      ['vocal', '人声', 1],
    ]);
    expect(groups[0].entries.map((e) => e.profile.id)).toEqual([
      'windsong-lyre',
      'floral-zither',
      'vintage-lyre',
      'yuco-lyre',
      'harmony-clavier',
      'sprightly-lyre',
      'lingering-echo',
    ]);
    expect(groups[1].entries.map((e) => e.profile.id)).toEqual(['festive-drum', 'juju-drum', 'banquet-drum']);
    expect(groups[2].entries.map((e) => e.profile.id)).toEqual(['evening-horn']);
    expect(groups[3].entries.map((e) => e.profile.id)).toEqual(['two-row-prototype']);
  });

  it('没有自定义乐器时省略自定义组', () => {
    const { entries } = mergeInstruments([]);
    const groups = groupInstrumentEntries(entries);
    expect(groups.some((g) => g.key === CUSTOM_GROUP_KEY)).toBe(false);
  });

  it('自定义乐器统一归入自定义组（组 key 为 CUSTOM_GROUP_KEY，与内置分类 custom 区分），即使复制自琴类内置乐器也不进入琴类组', () => {
    const { entries } = mergeInstruments([custom('my-lyre', '甲'), custom('my-lyre-2', '乙')]);
    const groups = groupInstrumentEntries(entries);
    const lyreGroup = groups.find((g) => g.key === 'lyre')!;
    expect(lyreGroup.entries.map((e) => e.profile.id)).not.toContain('my-lyre');
    const customGroup = groups.at(-1)!;
    expect(customGroup).toEqual({ key: CUSTOM_GROUP_KEY, label: '自定义', entries: expect.any(Array) });
    expect(customGroup.entries.map((e) => e.profile.id)).toEqual(['my-lyre', 'my-lyre-2']);
  });
});

describe('supportsHoldControl', () => {
  it('自定义乐器始终支持，不论分类', () => {
    expect(supportsHoldControl({ profile: builtin('windsong-lyre'), builtin: false })).toBe(true);
    expect(supportsHoldControl({ profile: builtin('evening-horn'), builtin: false })).toBe(true);
  });

  it('内置圆号 / 人声乐器支持，其余内置乐器不支持', () => {
    expect(supportsHoldControl({ profile: builtin('evening-horn'), builtin: true })).toBe(true);
    expect(supportsHoldControl({ profile: builtin('two-row-prototype'), builtin: true })).toBe(true);
    expect(supportsHoldControl({ profile: builtin('windsong-lyre'), builtin: true })).toBe(false);
    expect(supportsHoldControl({ profile: builtin('festive-drum'), builtin: true })).toBe(false);
  });
});

describe('stripHoldControlOptions', () => {
  const baseOptions: AdaptOptions = {
    tracks: ['t0'],
    transpose: 0,
    octaveShift: 0,
    blackKeyPolicy: 'skip',
    outOfRangePolicy: 'fold',
    maxPolyphony: 3,
    chordWindowMs: 15,
    useNoteDuration: true,
    holdMsOverride: 80,
    releaseGapMs: 100,
  };

  it('不支持按住控制的乐器：剥离 useNoteDuration / holdMsOverride / releaseGapMs', () => {
    const stripped = stripHoldControlOptions(baseOptions, { profile: builtin('windsong-lyre'), builtin: true });
    expect(stripped.useNoteDuration).toBeUndefined();
    expect(stripped.holdMsOverride).toBeUndefined();
    expect(stripped.releaseGapMs).toBeUndefined();
    expect(stripped).not.toBe(baseOptions);
  });

  it('支持按住控制的乐器：原样返回（同一引用）', () => {
    const entry = { profile: builtin('evening-horn'), builtin: true };
    expect(stripHoldControlOptions(baseOptions, entry)).toBe(baseOptions);
  });

  it('不支持按住控制但本来就没有这三项时，原样返回（同一引用）', () => {
    const clean: AdaptOptions = { ...baseOptions, useNoteDuration: undefined, holdMsOverride: undefined, releaseGapMs: undefined };
    const entry = { profile: builtin('windsong-lyre'), builtin: true };
    expect(stripHoldControlOptions(clean, entry)).toBe(clean);
  });
});
