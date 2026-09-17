import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Score } from '@/core/model/score';
import { useScoreStore } from '@/stores/scoreStore';
import { useTransportStore } from '@/stores/transportStore';
import { clampRange, RangeControls } from './RangeControls';

const score: Score = {
  meta: { title: '测试曲', source: 'midi' },
  tracks: [
    { id: 't0', name: '旋律', isDrum: false, notes: [{ startMs: 0, durationMs: 4000, pitch: 60, velocity: 0.8 }] },
  ],
};

beforeEach(() => {
  useScoreStore.setState(useScoreStore.getInitialState(), true);
  useTransportStore.setState(useTransportStore.getInitialState(), true);
  useScoreStore.getState().setScore(score);
});

describe('clampRange', () => {
  it.each([
    [[0, 4000], 3950, 4000, 'start', [3900, 4000]],
    [[0, 4000], 0, 50, 'end', [0, 100]],
    [[3000, 4000], 2000, 4000, 'start', [2000, 4000]],
  ] as const)('%o 起点 %d 终点 %d 从%s 端拖动 → %o', (prev, start, end, changed, expected) => {
    expect(clampRange([start, end], changed, prev[1], prev)).toEqual(expected);
  });
});

describe('RangeControls', () => {
  it('渲染区间时间与循环开关', () => {
    useTransportStore.getState().setRange({ startMs: 1000, endMs: 3000 });
    render(<RangeControls locked={false} />);
    expect(screen.getByLabelText('区间开始时间')).toHaveValue('0:01.0');
    expect(screen.getByLabelText('区间结束时间')).toHaveValue('0:03.0');
    expect(screen.getByRole('switch', { name: '循环播放' })).not.toBeChecked();
  });

  it('重置区间恢复整曲', async () => {
    useTransportStore.getState().setRange({ startMs: 1000, endMs: 3000 });
    const user = userEvent.setup();
    render(<RangeControls locked={false} />);
    await user.click(screen.getByRole('button', { name: '重置区间' }));
    expect(useTransportStore.getState().range).toEqual({ startMs: 0, endMs: 4000 });
  });

  it('开始时间输入非法时标红并保留原值', async () => {
    useTransportStore.getState().setRange({ startMs: 1000, endMs: 3000 });
    const user = userEvent.setup();
    render(<RangeControls locked={false} />);
    const input = screen.getByLabelText('区间开始时间');
    await user.clear(input);
    await user.type(input, 'abc');
    await user.tab();
    expect(input).toHaveClass('border-destructive');
    expect(useTransportStore.getState().range).toEqual({ startMs: 1000, endMs: 3000 });
  });

  it('循环开关切换后写入 store', async () => {
    const user = userEvent.setup();
    render(<RangeControls locked={false} />);
    await user.click(screen.getByRole('switch', { name: '循环播放' }));
    expect(useTransportStore.getState().loop).toBe(true);
  });
});
