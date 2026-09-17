import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedValue } from './useDebouncedValue';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDebouncedValue', () => {
  it('首次渲染直接返回原值', () => {
    const { result } = renderHook(() => useDebouncedValue('a', 100));
    expect(result.current).toBe('a');
  });

  it('延迟时间内多次变化，只在最后一次变化满 delayMs 后更新', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 100), {
      initialProps: { value: 1 },
    });
    rerender({ value: 2 });
    act(() => vi.advanceTimersByTime(60));
    rerender({ value: 3 });
    act(() => vi.advanceTimersByTime(60));
    expect(result.current).toBe(1);
    act(() => vi.advanceTimersByTime(40));
    expect(result.current).toBe(3);
  });
});
