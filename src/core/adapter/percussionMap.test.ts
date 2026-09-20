import { describe, expect, it } from 'vitest';
import { BUILTIN_INSTRUMENTS } from '../instruments/registry';
import type { Note } from '../model/score';
import { DEFAULT_DRUM_NOTES, applyDrumVoiceNotes, buildVoiceKeyMap, drumNoteLabel, median, resolveVoice } from './percussionMap';

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

  it('非鼓轨上用户指定的音符优先于分界音高（纠正写在普通通道的鼓谱）', () => {
    const context = { ...drumContext, isDrum: false, voiceNotePitches: { bass: 36, snare: 38 } };
    expect(resolveVoice(note({ pitch: 36 }), context)).toBe('bass');
    expect(resolveVoice(note({ pitch: 38 }), context)).toBe('snare');
    // 未指定的音高仍按分界音高
    expect(resolveVoice(note({ pitch: 59 }), context)).toBe('don');
    expect(resolveVoice(note({ pitch: 60 }), context)).toBe('ka');
    // 鼓轨不受影响：仍走鼓映射表
    expect(resolveVoice(note({ pitch: 36 }), { ...drumContext, voiceNotePitches: { bass: 36 } })).toBe('don');
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
      ['don', 'KeyS'],
      ['ka', 'KeyA'],
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

describe('applyDrumVoiceNotes 与 drumNoteLabel', () => {
  it('指定的音符覆盖鼓映射表，未指定部分保持原样', () => {
    const merged = applyDrumVoiceNotes(DEFAULT_DRUM_NOTES, { don: 41 });
    expect(merged['41']).toBe('don');
    expect(merged['38']).toBe(DEFAULT_DRUM_NOTES['38']);
  });

  it('没有指定时返回等价的新表', () => {
    expect(applyDrumVoiceNotes(DEFAULT_DRUM_NOTES, undefined)).toEqual(DEFAULT_DRUM_NOTES);
  });

  it('GM 音域的标签带音名与通用名，区外只有音名', () => {
    expect(drumNoteLabel(35)).toBe('B1 · 原声底鼓');
    expect(drumNoteLabel(90)).toBe('F#6');
  });
});
