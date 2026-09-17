import { beforeEach, describe, expect, it } from 'vitest';
import { BUILTIN_INSTRUMENTS } from '@/core/instruments/registry';
import type { Score } from '@/core/model/score';
import { DEFAULT_INSTRUMENT_ID, useAdaptStore } from './adaptStore';

const lyre = BUILTIN_INSTRUMENTS[0];
const vintage = BUILTIN_INSTRUMENTS[2];
const drum = BUILTIN_INSTRUMENTS[4];
const score: Score = {
  meta: { title: '测试曲', source: 'midi', bpm: 60 },
  tracks: [
    { id: 't0', name: '旋律', isDrum: false, notes: [{ startMs: 0, durationMs: 500, pitch: 72, velocity: 0.8 }] },
    { id: 't1', name: '鼓', isDrum: true, notes: [{ startMs: 0, durationMs: 200, pitch: 36, velocity: 0.8 }] },
  ],
};

beforeEach(() => {
  useAdaptStore.setState(useAdaptStore.getInitialState(), true);
});

describe('adaptStore', () => {
  it('初始选中默认乐器，还没有适配参数', () => {
    expect(useAdaptStore.getState()).toMatchObject({ targetId: 'windsong-lyre', options: null, manual: false });
    expect(DEFAULT_INSTRUMENT_ID).toBe('windsong-lyre');
  });

  it('setOptions 保存参数并标记为手动调整', () => {
    useAdaptStore.getState().resetToRecommended(score, lyre);
    const options = useAdaptStore.getState().options!;
    useAdaptStore.getState().setOptions({ ...options, transpose: 2 });
    expect(useAdaptStore.getState().options?.transpose).toBe(2);
    expect(useAdaptStore.getState().manual).toBe(true);
  });

  it('resetToRecommended 音高类乐器默认选非鼓轨并复位手动标记，目标乐器不变', () => {
    useAdaptStore.getState().setTarget('vintage-lyre');
    useAdaptStore.getState().resetToRecommended(score, vintage, 'windsong-lyre');
    const state = useAdaptStore.getState();
    expect(state.targetId).toBe('vintage-lyre');
    expect(state.options?.tracks).toEqual(['t0']);
    expect(state.manual).toBe(false);
  });

  it('敲击类乐器默认选中全部音轨', () => {
    useAdaptStore.getState().resetToRecommended(score, drum);
    expect(useAdaptStore.getState().options?.tracks).toEqual(['t0', 't1']);
  });
});
