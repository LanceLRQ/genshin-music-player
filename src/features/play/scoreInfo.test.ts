import { describe, expect, it } from 'vitest';
import type { Score, Track } from '@/core/model/score';
import {
  DROPPED_ITEMS,
  formatTimeShort,
  guessTextFormat,
  parseTimeInput,
  pitchHistogram,
  rateBgClass,
  rateTextClass,
  scoreDurationMs,
  sourceLabel,
  trackStats,
  voiceLabel,
} from './scoreInfo';

const track: Track = {
  id: 't0',
  name: '音轨 1',
  isDrum: false,
  notes: [
    { startMs: 20000, durationMs: 500, pitch: 60, velocity: 0.8 },
    { startMs: 20500, durationMs: 500, voice: 'don', velocity: 0.8 },
    { startMs: 21000, durationMs: 500, pitch: 81, velocity: 0.8 },
  ],
};

describe('trackStats', () => {
  it('统计音符数、音域（只看有音高的音）和首音时间', () => {
    expect(trackStats(track)).toEqual({ count: 3, minPitch: 60, maxPitch: 81, hasPitch: true, firstMs: 20000 });
  });

  it('没有音高音的音轨 hasPitch 为 false', () => {
    const voiceOnly: Track = { ...track, notes: [{ startMs: 0, durationMs: 100, voice: 'don', velocity: 0.8 }] };
    expect(trackStats(voiceOnly)).toMatchObject({ count: 1, hasPitch: false });
  });

  it('空音轨返回 null', () => {
    expect(trackStats({ ...track, notes: [] })).toBeNull();
  });
});

describe('scoreDurationMs', () => {
  it('取所有音符结束时间的最大值', () => {
    const score: Score = {
      meta: { title: 'x', source: 'midi' },
      tracks: [
        { ...track, notes: [{ startMs: 0, durationMs: 500, pitch: 60, velocity: 0.8 }] },
        { ...track, notes: [{ startMs: 1000, durationMs: 2500, pitch: 60, velocity: 0.8 }] },
      ],
    };
    expect(scoreDurationMs(score)).toBe(3500);
  });

  it('空乐谱为 0', () => {
    expect(scoreDurationMs({ meta: { title: 'x', source: 'midi' }, tracks: [] })).toBe(0);
  });
});

describe('formatTimeShort', () => {
  it.each([
    [0, '0:00'],
    [61234, '1:01'],
    [235000, '3:55'],
  ])('%d ms → %s', (ms, text) => {
    expect(formatTimeShort(ms)).toBe(text);
  });
});

describe('sourceLabel / voiceLabel', () => {
  it.each([
    ['midi', 'MIDI'],
    ['keyscore', '键盘谱'],
    ['jianpu', '简谱'],
    ['json', 'JSON 谱'],
  ] as const)('%s → %s', (source, label) => {
    expect(sourceLabel(source)).toBe(label);
  });

  it('咚咔显示中文，带序号变体也翻译，其他音色原样', () => {
    expect([voiceLabel('don'), voiceLabel('ka'), voiceLabel('crash')]).toEqual(['咚', '咔', 'crash']);
    expect([voiceLabel('don-2'), voiceLabel('ka-3'), voiceLabel('don-4')]).toEqual(['咚-2', '咔-3', '咚-4']);
  });
});

describe('parseTimeInput', () => {
  it('解析 m:ss.s 和纯秒数，并夹到 maxMs', () => {
    expect(parseTimeInput('1:23.4', 999999)).toBe(83400);
    expect(parseTimeInput('90', 999999)).toBe(90000);
    expect(parseTimeInput('5:00', 200000)).toBe(200000);
  });

  it('负数、空串、超界秒数和乱码返回 null', () => {
    expect(parseTimeInput('-1:00', 999999)).toBeNull();
    expect(parseTimeInput('', 999999)).toBeNull();
    expect(parseTimeInput('1:60', 999999)).toBeNull();
    expect(parseTimeInput('abc', 999999)).toBeNull();
  });
});

describe('guessTextFormat', () => {
  it('数字 0–7 占一半以上猜为简谱，否则猜为键盘谱', () => {
    expect(guessTextFormat('@bpm=90 @key=C\n1 1 5 5 | 6 6 5 -')).toBe('jianpu');
    expect(guessTextFormat('@bpm=100\nQ W E (QE) - T')).toBe('keyscore');
  });

  it('去掉注释、指令和语法符号后没有内容时猜为键盘谱', () => {
    expect(guessTextFormat('@bpm=90\n// 只有注释')).toBe('keyscore');
  });
});

describe('rateTextClass / rateBgClass', () => {
  it.each([
    [1, 'text-emerald-600 dark:text-emerald-500', 'bg-emerald-500'],
    [0.95, 'text-emerald-600 dark:text-emerald-500', 'bg-emerald-500'],
    [0.9, 'text-amber-600 dark:text-amber-500', 'bg-amber-500'],
    [0.5, 'text-red-600 dark:text-red-500', 'bg-red-500'],
  ])('%d → %s / %s', (rate, text, bg) => {
    expect(rateTextClass(rate)).toBe(text);
    expect(rateBgClass(rate)).toBe(bg);
  });
});

describe('DROPPED_ITEMS', () => {
  it('覆盖 AdaptReport 的五类丢音，每条都有说明', () => {
    expect(DROPPED_ITEMS.map((item) => item.key)).toEqual([
      'blackKey',
      'outOfRange',
      'polyphony',
      'tooDense',
      'unmappedDrum',
    ]);
    expect(DROPPED_ITEMS.every((item) => item.label.length > 0 && item.tooltip.length > 0)).toBe(true);
  });
});

describe('pitchHistogram', () => {
  it('只统计勾选音轨、按音高升序，数量为 0 的音高不出现', () => {
    const score = {
      meta: { title: 't', source: 'midi' as const },
      tracks: [
        { id: 't0', name: 'a', isDrum: false, notes: [
          { startMs: 0, durationMs: 100, pitch: 60, velocity: 1 },
          { startMs: 100, durationMs: 100, pitch: 72, velocity: 1 },
          { startMs: 200, durationMs: 100, pitch: 60, velocity: 1 },
        ] },
        { id: 't1', name: 'b', isDrum: false, notes: [
          { startMs: 0, durationMs: 100, pitch: 67, velocity: 1 },
        ] },
      ],
    };
    expect(pitchHistogram(score, ['t0'])).toEqual([
      { pitch: 60, count: 2 },
      { pitch: 72, count: 1 },
    ]);
    expect(pitchHistogram(score, ['t0', 't1'])).toEqual([
      { pitch: 60, count: 2 },
      { pitch: 67, count: 1 },
      { pitch: 72, count: 1 },
    ]);
    expect(pitchHistogram(score, [])).toEqual([]);
  });
});
