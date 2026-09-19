import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_INSTRUMENTS } from '@/core/instruments/registry';
import type { Score } from '@/core/model/score';
import { DEFAULT_SETTINGS } from '@/ipc/types';
import { useAdaptStore } from '@/stores/adaptStore';
import { useScoreStore } from '@/stores/scoreStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAdaptation } from './useAdaptation';

const lyre = BUILTIN_INSTRUMENTS[0];
const yuco = BUILTIN_INSTRUMENTS.find((profile) => profile.id === 'yuco-lyre')!;
const score: Score = {
  meta: { title: '测试曲', source: 'midi', bpm: 60 },
  tracks: [
    {
      id: 't0',
      name: '旋律',
      isDrum: false,
      notes: [
        { startMs: 0, durationMs: 500, pitch: 72, velocity: 0.8 },
        { startMs: 500, durationMs: 500, pitch: 74, velocity: 0.8 },
      ],
    },
  ],
};
const chordScore: Score = {
  meta: { title: '和弦曲', source: 'json', bpm: 60 },
  tracks: [
    {
      id: 't0',
      name: '和弦',
      isDrum: false,
      notes: [
        { startMs: 0, durationMs: 500, pitch: 60, velocity: 0.8 },
        { startMs: 0, durationMs: 500, pitch: 64, velocity: 0.8 },
        { startMs: 0, durationMs: 500, pitch: 67, velocity: 0.8 },
      ],
    },
  ],
};

beforeEach(() => {
  vi.useFakeTimers();
  useScoreStore.setState(useScoreStore.getInitialState(), true);
  useAdaptStore.setState(useAdaptStore.getInitialState(), true);
  useSettingsStore.setState(useSettingsStore.getInitialState(), true);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useAdaptation', () => {
  it('没有乐谱或参数时返回空结果', () => {
    const { result } = renderHook(() => useAdaptation());
    expect(result.current).toEqual({ timeline: null, report: null, rates: {} });
  });

  it('有乐谱时计算时间线、报告与逐轨命中率', () => {
    const { result } = renderHook(() => useAdaptation());
    act(() => {
      useScoreStore.getState().setScore(score);
      useAdaptStore.getState().resetToRecommended(score, lyre);
    });
    act(() => vi.advanceTimersByTime(100));
    const { timeline, report, rates } = result.current;
    expect(timeline?.instrumentId).toBe('windsong-lyre');
    expect(timeline?.presses).toHaveLength(2);
    expect(report?.total).toBe(2);
    expect(rates).toEqual({ t0: 1 });
  });

  it('参数变化后防抖 100ms 才重新计算', () => {
    const { result } = renderHook(() => useAdaptation());
    act(() => {
      useScoreStore.getState().setScore(score);
      useAdaptStore.getState().resetToRecommended(score, lyre);
    });
    act(() => vi.advanceTimersByTime(100));
    const first = result.current.timeline;
    expect(first).not.toBeNull();
    act(() => {
      const options = useAdaptStore.getState().options!;
      useAdaptStore.getState().setOptions({ ...options, transpose: -2 });
    });
    act(() => vi.advanceTimersByTime(60));
    expect(result.current.timeline).toBe(first);
    act(() => vi.advanceTimersByTime(40));
    expect(result.current.timeline).not.toBe(first);
  });

  it('设置的 useChordKeys 接入适配：默认开时和弦簇收成一个键，关闭后逐音', () => {
    const { result } = renderHook(() => useAdaptation());
    act(() => {
      useScoreStore.getState().setScore(chordScore);
      useAdaptStore.getState().setTarget(yuco.id);
      useAdaptStore.getState().resetToRecommended(chordScore, yuco);
    });
    act(() => vi.advanceTimersByTime(100));
    expect(result.current.timeline?.presses[0]?.codes).toEqual(['KeyQ']);
    expect(result.current.report?.chordHits).toBe(1);
    // 切换设置后立即重新计算（不经过防抖）
    act(() => {
      useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, useChordKeys: false } });
    });
    expect(result.current.timeline?.presses[0]?.codes.length).toBe(3);
    expect(result.current.report?.chordHits).toBe(0);
    expect(result.current.report?.chordFallbacks).toBe(0);
  });
});
