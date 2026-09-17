import { describe, expect, it } from 'vitest';
import { parseFraction } from './fraction';

describe('parseFraction', () => {
  it.each([
    ['1/2', 0.5],
    ['0.25', 0.25],
    ['2', 2],
    [' 3/4 ', 0.75],
  ])('「%s」→ %d', (raw, value) => {
    expect(parseFraction(raw)).toBe(value);
  });

  it.each(['', 'abc', '1/0', '1//2', '-1', '1/'])('「%s」→ undefined', (raw) => {
    expect(parseFraction(raw)).toBeUndefined();
  });
});
