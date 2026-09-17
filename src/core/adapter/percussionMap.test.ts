import { describe, expect, it } from 'vitest';
import { BUILTIN_INSTRUMENTS } from '../instruments/registry';
import type { Note } from '../model/score';
import { DEFAULT_DRUM_NOTES, buildVoiceKeyMap, median, resolveVoice } from './percussionMap';

const note = (fields: Partial<Note>): Note => ({ startMs: 0, durationMs: 100, velocity: 1, ...fields });
const drumContext = { isDrum: true, drumNotes: DEFAULT_DRUM_NOTES, splitPitch: 60 };
const melodyContext = { ...drumContext, isDrum: false };

describe('resolveVoice', () => {
  it('音符自带 voice 时直接使用', () => {
    expect(resolveVoice(note({ voice: 'ka', pitch: 36 }), drumContext)).toBe('ka');
  });

  it('鼓轨按映射表转换：底鼓 → 咚，军鼓 → 咔，未映射 → undefined', () => {
    expect(resolveVoice(note({ pitch: 36 }), drumContext)).toBe('don');
    expect(resolveVoice(note({ pitch: 38 }), drumContext)).toBe('ka');
    expect(resolveVoice(note({ pitch: 99 }), drumContext)).toBeUndefined();
  });

  it('非鼓轨按分界音高：低于分界为咚，其余为咔', () => {
    expect(resolveVoice(note({ pitch: 59 }), melodyContext)).toBe('don');
    expect(resolveVoice(note({ pitch: 60 }), melodyContext)).toBe('ka');
  });

  it('既没有 pitch 也没有 voice 时返回 undefined', () => {
    expect(resolveVoice(note({}), melodyContext)).toBeUndefined();
  });
});

describe('buildVoiceKeyMap', () => {
  it('返回音色到键码的映射', () => {
    const drum = BUILTIN_INSTRUMENTS.find((p) => p.id === 'festive-drum')!;
    expect([...buildVoiceKeyMap(drum)]).toEqual([
      ['don', 'KeyF'],
      ['ka', 'KeyJ'],
    ]);
  });
});

describe('median', () => {
  it('奇数个取中间值，偶数个取中间两个的平均值', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('空数组报错', () => {
    expect(() => median([])).toThrow('median 需要至少一个值');
  });
});
