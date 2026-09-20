import { beforeEach, describe, expect, it } from 'vitest';
import type { Score } from '@/core/model/score';
import { useScoreStore } from './scoreStore';

const score: Score = {
  meta: { title: '测试曲', source: 'midi', bpm: 90 },
  tracks: [
    { id: 't0', name: '音轨 1', isDrum: false, notes: [{ startMs: 0, durationMs: 500, pitch: 60, velocity: 0.8 }] },
  ],
};

beforeEach(() => {
  useScoreStore.setState(useScoreStore.getInitialState(), true);
});

describe('scoreStore', () => {
  it('setScore 保存乐谱、文件名和键盘谱来源乐器', () => {
    useScoreStore.getState().setScore(score, { fileName: 'demo.mid', sourceInstrumentId: 'windsong-lyre' });
    expect(useScoreStore.getState()).toMatchObject({ score, fileName: 'demo.mid', sourceInstrumentId: 'windsong-lyre' });
  });

  it('不带来源信息时清空上一次的值', () => {
    useScoreStore.getState().setScore(score, { fileName: 'demo.mid', sourceInstrumentId: 'windsong-lyre' });
    useScoreStore.getState().setScore({ ...score, meta: { ...score.meta, source: 'jianpu' } });
    expect(useScoreStore.getState()).toMatchObject({ fileName: null, sourceInstrumentId: null });
  });

  it('clear 清空乐谱', () => {
    useScoreStore.getState().setScore(score);
    useScoreStore.getState().clear();
    expect(useScoreStore.getState().score).toBeNull();
  });
});

describe('setTrackDrum', () => {
  it('切换指定轨道的 isDrum，不影响其他轨道', () => {
    useScoreStore.getState().setScore({
      ...score,
      tracks: [
        score.tracks[0],
        { id: 't1', name: '音轨 2', isDrum: false, notes: [{ startMs: 0, durationMs: 100, pitch: 36, velocity: 0.8 }] },
      ],
    });
    useScoreStore.getState().setTrackDrum('t1', true);
    const tracks = useScoreStore.getState().score!.tracks;
    expect(tracks.map((t) => t.isDrum)).toEqual([false, true]);
    // 其他字段原样
    expect(tracks[1].notes[0].pitch).toBe(36);
    useScoreStore.getState().setTrackDrum('t1', false);
    expect(useScoreStore.getState().score!.tracks[1].isDrum).toBe(false);
  });

  it('没有乐谱时是空操作', () => {
    useScoreStore.getState().clear();
    useScoreStore.getState().setTrackDrum('t0', true);
    expect(useScoreStore.getState().score).toBeNull();
  });
});
