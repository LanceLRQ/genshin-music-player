import { describe, expect, it } from 'vitest';
import { BUILTIN_INSTRUMENTS } from '../instruments/registry';
import { InstrumentProfileSchema } from '../model/instrument';
import { buildPitchKeyMap, resolvePitch } from './pitchMap';

const builtin = (id: string) => BUILTIN_INSTRUMENTS.find((p) => p.id === id)!;
const lyre = buildPitchKeyMap(builtin('windsong-lyre'));

describe('buildPitchKeyMap', () => {
  it('音域取最低音和最高音', () => {
    expect([lyre.min, lyre.max]).toEqual([48, 83]);
    expect(lyre.pitches).toHaveLength(21);
  });

  it('没有音高键的乐器报错', () => {
    expect(() => buildPitchKeyMap(builtin('festive-drum'))).toThrow('乐器「节庆鼓」没有可用的音高键');
  });
});

describe('resolvePitch', () => {
  it('精确命中', () => {
    expect(resolvePitch(lyre, 60, 'skip', 'fold')).toEqual({ kind: 'hit', code: 'KeyA', folded: false });
  });

  it('黑键在 skip 策略下丢弃', () => {
    expect(resolvePitch(lyre, 61, 'skip', 'fold')).toEqual({ kind: 'drop', reason: 'blackKey' });
  });

  it('黑键在 nearest 策略下取最近的音，距离相等取低音', () => {
    expect(resolvePitch(lyre, 61, 'nearest', 'fold')).toEqual({ kind: 'hit', code: 'KeyA', folded: false });
    expect(resolvePitch(lyre, 66, 'nearest', 'fold')).toEqual({ kind: 'hit', code: 'KeyF', folded: false });
  });

  it('超出音域在 fold 策略下按八度折回', () => {
    expect(resolvePitch(lyre, 84, 'skip', 'fold')).toEqual({ kind: 'hit', code: 'KeyQ', folded: true });
    expect(resolvePitch(lyre, 36, 'skip', 'fold')).toEqual({ kind: 'hit', code: 'KeyZ', folded: true });
  });

  it('超出音域在 drop 策略下丢弃', () => {
    expect(resolvePitch(lyre, 84, 'skip', 'drop')).toEqual({ kind: 'drop', reason: 'outOfRange' });
  });

  it('折回后仍是黑键时，继续按黑键策略处理', () => {
    expect(resolvePitch(lyre, 85, 'skip', 'fold')).toEqual({ kind: 'drop', reason: 'blackKey' });
    expect(resolvePitch(lyre, 85, 'nearest', 'fold')).toEqual({ kind: 'hit', code: 'KeyQ', folded: true });
  });

  it('两行乐器音域 48–71，72 折回到 60', () => {
    const twoRow = buildPitchKeyMap(builtin('two-row-prototype'));
    expect([twoRow.min, twoRow.max]).toEqual([48, 71]);
    expect(resolvePitch(twoRow, 72, 'skip', 'fold')).toEqual({ kind: 'hit', code: 'KeyQ', folded: true });
  });

  it('音域不足一个八度、折回不到音域内时丢弃', () => {
    const narrow = buildPitchKeyMap(
      InstrumentProfileSchema.parse({
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
      }),
    );
    // 70 下折到 58、51 上折到 63，都落不进 60–62；50 上折到 62 则可以命中
    expect(resolvePitch(narrow, 70, 'skip', 'fold')).toEqual({ kind: 'drop', reason: 'outOfRange' });
    expect(resolvePitch(narrow, 51, 'skip', 'fold')).toEqual({ kind: 'drop', reason: 'outOfRange' });
    expect(resolvePitch(narrow, 50, 'skip', 'fold')).toEqual({ kind: 'hit', code: 'KeyS', folded: true });
  });
});
