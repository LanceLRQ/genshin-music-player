import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ExecutionTimeline } from '@/ipc/types';
import { useScoreStore } from '@/stores/scoreStore';
import { useTransportStore } from '@/stores/transportStore';
import type { Score } from '@/core/model/score';
import { TimelineBar } from './TimelineBar';

const score: Score = {
  meta: { title: '测试曲', source: 'midi' },
  tracks: [
    {
      id: 't0',
      name: '旋律',
      isDrum: false,
      notes: [{ startMs: 0, durationMs: 4000, pitch: 60, velocity: 0.8 }],
    },
  ],
};

const execution: ExecutionTimeline = {
  instrumentId: 'windsong-lyre',
  events: [{ tMs: 0, up: [], down: ['KeyA'] }],
  durationMs: 1000,
  sourceStartMs: 500,
  speed: 2,
  loop: false,
  dropped: 0,
};

beforeEach(() => {
  useScoreStore.setState(useScoreStore.getInitialState(), true);
  useTransportStore.setState(useTransportStore.getInitialState(), true);
  useScoreStore.getState().setScore(score);
  useTransportStore.getState().setRange({ startMs: 1000, endMs: 3000 });
});

describe('TimelineBar', () => {
  it('演奏时指针位置来自后端进度（乐谱时间），区间高亮与两端时间正确', () => {
    useTransportStore.setState({ progress: { positionMs: 250, sourcePositionMs: 1000 } });
    render(<TimelineBar />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuemax', '4000');
    expect(bar).toHaveAttribute('aria-valuenow', '1000');
    expect(bar.firstElementChild).toHaveStyle({ left: '25%', width: '50%' });
    expect(screen.getByText('0:01.0')).toBeInTheDocument();
    expect(screen.getByText('0:04.0')).toBeInTheDocument();
  });

  it('试听时指针位置由执行时间换算回乐谱时间', () => {
    useTransportStore.setState({ execution, previewing: true, previewPositionMs: 1000 });
    render(<TimelineBar />);
    // 乐谱时间 = sourceStartMs(500) + 1000 × speed(2) = 2500 → 62.5%
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2500');
  });
});
