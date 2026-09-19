import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { previewPlayer } from '@/audio/previewPlayer';
import type { KeyTimeline } from '@/core/model/timeline';
import type { ExecutionTimeline } from '@/ipc/types';
import { useScoreStore } from '@/stores/scoreStore';
import { useTransportStore } from '@/stores/transportStore';
import type { Score } from '@/core/model/score';
import { TimelineBar } from './TimelineBar';

vi.mock('@/audio/previewPlayer', () => ({
  previewPlayer: { seek: vi.fn() },
}));

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

const mainTimeline: KeyTimeline = {
  instrumentId: 'windsong-lyre',
  durationMs: 4000,
  minRepeatGapMs: 40,
  presses: [
    { tMs: 0, codes: ['KeyA'], holdMs: 30 },
    { tMs: 500, codes: ['KeyS'], holdMs: 30 },
  ],
};

function mockTrackRect(width = 400) {
  return vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockReturnValue({ x: 0, y: 0, width, height: 28, top: 0, left: 0, right: width, bottom: 28, toJSON: () => ({}) } as DOMRect);
}

beforeEach(() => {
  vi.mocked(previewPlayer.seek).mockClear();
  useScoreStore.setState(useScoreStore.getInitialState(), true);
  useTransportStore.setState(useTransportStore.getInitialState(), true);
  useScoreStore.getState().setScore(score);
  useTransportStore.getState().setRange({ startMs: 1000, endMs: 3000 });
});

describe('TimelineBar', () => {
  it('演奏时指针位置来自后端进度（乐谱时间），两端时间正确', () => {
    useTransportStore.setState({ progress: { positionMs: 250, sourcePositionMs: 1000 } });
    render(<TimelineBar />);
    const bar = screen.getByRole('slider');
    expect(bar).toHaveAttribute('aria-valuemax', '4000');
    expect(bar).toHaveAttribute('aria-valuenow', '1000');
    expect(screen.getByText('0:01.0')).toBeInTheDocument();
    expect(screen.getByText('0:04.0')).toBeInTheDocument();
  });

  it('试听时指针位置由执行时间换算回乐谱时间', () => {
    useTransportStore.setState({ execution, previewing: true, previewPositionMs: 1000 });
    render(<TimelineBar />);
    // 乐谱时间 = sourceStartMs(500) + 1000 × speed(2) = 2500 → 62.5%
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '2500');
  });

  it('空闲时点击进度条把演奏起点（区间起点）定位到点击处', () => {
    const rectSpy = mockTrackRect();
    render(<TimelineBar />);
    fireEvent.pointerDown(screen.getByRole('slider'), { clientX: 200 });
    // 400px 轨道的 50% → 2000ms
    expect(useTransportStore.getState().range).toEqual({ startMs: 2000, endMs: 3000 });
    rectSpy.mockRestore();
  });

  it('试听中点击进度条换算成执行时间跳转试听', () => {
    const rectSpy = mockTrackRect();
    useTransportStore.setState({ execution, previewing: true, previewPositionMs: 0 });
    render(<TimelineBar />);
    fireEvent.pointerDown(screen.getByRole('slider'), { clientX: 300 });
    // 75% → 乐谱 3000ms → 执行 (3000 − 500) / 2 = 1250，收敛到时长 1000
    expect(previewPlayer.seek).toHaveBeenCalledWith(1000);
    expect(useTransportStore.getState().previewPositionMs).toBe(1000);
    rectSpy.mockRestore();
  });

  it('演奏进行中锁定：不可定位，点击无效', () => {
    const rectSpy = mockTrackRect();
    useTransportStore.setState({ playerState: { kind: 'playing' } });
    render(<TimelineBar />);
    const bar = screen.getByRole('slider');
    expect(bar).toHaveAttribute('aria-disabled', 'true');
    fireEvent.pointerDown(bar, { clientX: 200 });
    expect(useTransportStore.getState().range).toEqual({ startMs: 1000, endMs: 3000 });
    rectSpy.mockRestore();
  });

  it('主时间线有按键时渲染热力图分桶，没有按键时退回细轨道', () => {
    const { unmount } = render(<TimelineBar />);
    expect(screen.queryByTestId('timeline-heat')).not.toBeInTheDocument();
    unmount();
    useTransportStore.setState({ mainTimeline });
    render(<TimelineBar />);
    const heat = screen.getByTestId('timeline-heat');
    expect(heat.childElementCount).toBe(100);
  });
});
