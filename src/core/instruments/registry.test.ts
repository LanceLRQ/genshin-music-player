import { describe, expect, it } from 'vitest';
import type { InstrumentProfile } from '../model/instrument';
import { BUILTIN_INSTRUMENTS, findInstrument, isBuiltinInstrumentId, mergeInstruments } from './registry';

const builtin = (id: string) => BUILTIN_INSTRUMENTS.find((p) => p.id === id)!;
const pitchesOf = (profile: InstrumentProfile) => profile.rows.flatMap((row) => row.keys.map((key) => key.pitch as number));

describe('内置乐器', () => {
  it('按固定顺序提供 5 种乐器', () => {
    expect(BUILTIN_INSTRUMENTS.map((p) => p.id)).toEqual([
      'windsong-lyre',
      'floral-zither',
      'vintage-lyre',
      'two-row-prototype',
      'festive-drum',
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

  it('老旧的诗琴待实测，上排为 C 弗里几亚音阶', () => {
    const vintage = builtin('vintage-lyre');
    expect(vintage.status).toBe('unverified');
    expect(vintage.rows[0].keys.map((k) => k.pitch)).toEqual([72, 73, 75, 77, 79, 80, 82]);
  });

  it('两行乐器 14 键，低音行 la 对应 N，待实测', () => {
    const twoRow = builtin('two-row-prototype');
    expect(twoRow.rows).toHaveLength(2);
    expect(pitchesOf(twoRow)).toHaveLength(14);
    expect(twoRow.rows[1].keys[5]).toEqual({ pitch: 57, code: 'KeyN' });
    expect(twoRow.status).toBe('unverified');
  });

  it('节庆鼓是敲击类：咚 = F，咔 = J', () => {
    const drum = builtin('festive-drum');
    expect(drum.kind).toBe('percussion');
    expect(drum.rows[0].keys).toEqual([
      { voice: 'don', code: 'KeyF' },
      { voice: 'ka', code: 'KeyJ' },
    ]);
    expect(drum.percussionMap?.splitPitch).toBe('auto');
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
      ['my-lyre', false],
    ]);
    expect(warnings).toEqual([]);
  });

  it('自定义乐器与内置 id 冲突时跳过并警告', () => {
    const { entries, warnings } = mergeInstruments([custom('windsong-lyre', '山寨琴')]);
    expect(entries).toHaveLength(5);
    expect(warnings).toEqual(['自定义乐器「山寨琴」的 id「windsong-lyre」与内置乐器重复，已跳过']);
  });

  it('自定义乐器之间 id 重复时保留第一个', () => {
    const { entries, warnings } = mergeInstruments([custom('my-lyre', '甲'), custom('my-lyre', '乙')]);
    expect(entries.filter((e) => !e.builtin).map((e) => e.profile.name)).toEqual(['甲']);
    expect(warnings).toEqual(['自定义乐器 id「my-lyre」重复，已跳过「乙」']);
  });

  it('findInstrument 与 isBuiltinInstrumentId', () => {
    const { entries } = mergeInstruments([custom('my-lyre')]);
    expect(findInstrument(entries, 'my-lyre')?.name).toBe('my-lyre');
    expect(findInstrument(entries, 'nope')).toBeUndefined();
    expect(isBuiltinInstrumentId('festive-drum')).toBe(true);
    expect(isBuiltinInstrumentId('my-lyre')).toBe(false);
  });
});
