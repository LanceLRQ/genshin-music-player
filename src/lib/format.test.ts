import { describe, expect, it } from 'vitest';
import { formatMs, formatPercent, formatSigned, formatSpeed, formatTime } from './format';

describe('formatTime', () => {
  it.each([
    [0, '0:00.0'],
    [20000, '0:20.0'],
    [61234, '1:01.2'],
    [59960, '1:00.0'],
    [235000, '3:55.0'],
    [-5, '0:00.0'],
    [Number.NaN, '0:00.0'],
  ])('%d ms → %s', (ms, text) => {
    expect(formatTime(ms)).toBe(text);
  });
});

describe('formatPercent', () => {
  it.each([
    [1, '100%'],
    [0.9756, '97.6%'],
    [0.5, '50%'],
    [0, '0%'],
  ])('%d → %s', (ratio, text) => {
    expect(formatPercent(ratio)).toBe(text);
  });
});

describe('formatMs / formatSigned / formatSpeed', () => {
  it('毫秒保留一位小数，末尾的 .0 省略', () => {
    expect(formatMs(3.24)).toBe('3.2ms');
    expect(formatMs(11)).toBe('11ms');
    expect(formatMs(-0.01)).toBe('0ms');
  });

  it('带符号整数使用 + 和 − 号', () => {
    expect([formatSigned(2), formatSigned(-3), formatSigned(0)]).toEqual(['+2', '−3', '0']);
  });

  it('速度保留两位小数并带 × 号', () => {
    expect([formatSpeed(1), formatSpeed(0.5), formatSpeed(1.25)]).toEqual(['1.00×', '0.50×', '1.25×']);
  });
});
