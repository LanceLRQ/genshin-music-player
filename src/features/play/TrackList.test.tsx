import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Score } from '@/core/model/score';
import { TrackList } from './TrackList';

const score: Score = {
  meta: { title: '测试曲', source: 'midi', bpm: 60 },
  tracks: [
    {
      id: 't0',
      name: '音轨 1 · bright acoustic piano',
      isDrum: false,
      notes: [
        { startMs: 0, durationMs: 500, pitch: 60, velocity: 0.8 },
        { startMs: 500, durationMs: 500, pitch: 69, velocity: 0.8 },
        { startMs: 20000, durationMs: 500, pitch: 72, velocity: 0.8 },
      ],
    },
    { id: 't1', name: '鼓轨', isDrum: true, notes: [{ startMs: 0, durationMs: 200, pitch: 36, velocity: 0.8 }] },
    {
      id: 't2',
      name: '无音轨',
      isDrum: false,
      notes: [{ startMs: 0, durationMs: 100, voice: 'don', velocity: 0.8 }],
    },
  ],
};

function renderList(overrides: Partial<Parameters<typeof TrackList>[0]> = {}) {
  const props = {
    tracks: score.tracks,
    checkedIds: ['t0'],
    rates: { t0: 1, t1: 0.9, t2: null } as Record<string, number | null>,
    pitched: true,
    locked: false,
    onSetChecked: vi.fn(),
    onSolo: vi.fn(),
    ...overrides,
  };
  render(
    <TooltipProvider>
      <TrackList {...props} />
    </TooltipProvider>,
  );
  return props;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TrackList', () => {
  it('渲染音轨名称、音符数、音域、首音时间与命中率', () => {
    renderList();
    const first = screen.getByText('音轨 1 · bright acoustic piano').closest<HTMLElement>('[data-slot=item]')!;
    expect(within(first).getByText('3 音 · C4–C5 · 首音 0:00')).toBeInTheDocument();
    expect(within(first).getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('鼓')).toBeInTheDocument();
  });

  it('点击复选框回调新的勾选集合', async () => {
    const props = renderList();
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: '选择 无音轨' }));
    expect(props.onSetChecked).toHaveBeenCalledWith(['t0', 't2']);
    await user.click(screen.getByRole('checkbox', { name: '选择 音轨 1 · bright acoustic piano' }));
    expect(props.onSetChecked).toHaveBeenCalledWith([]);
  });

  it('全选（音高类不含鼓轨）与全不选', async () => {
    const props = renderList();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '全选' }));
    expect(props.onSetChecked).toHaveBeenCalledWith(['t0', 't2']);
    await user.click(screen.getByRole('button', { name: '全不选' }));
    expect(props.onSetChecked).toHaveBeenCalledWith([]);
  });

  it('音高类乐器下鼓轨的复选框与单轨按钮禁用', () => {
    renderList();
    expect(screen.getByRole('checkbox', { name: '选择 鼓轨' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '单独试听 鼓轨' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '单独演奏 鼓轨' })).toBeDisabled();
  });

  it('单轨按钮触发 onSolo', async () => {
    const props = renderList();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '单独试听 音轨 1 · bright acoustic piano' }));
    expect(props.onSolo).toHaveBeenCalledWith('preview', 't0');
    await user.click(screen.getByRole('button', { name: '单独演奏 音轨 1 · bright acoustic piano' }));
    expect(props.onSolo).toHaveBeenCalledWith('play', 't0');
  });

  it('未勾选的音轨单轨按钮禁用', () => {
    renderList({ checkedIds: [] });
    expect(screen.getByRole('button', { name: '单独试听 音轨 1 · bright acoustic piano' })).toBeDisabled();
  });

  it('没有可处理音的音轨命中率显示 —', () => {
    renderList();
    const item = screen.getByText('无音轨').closest<HTMLElement>('[data-slot=item]')!;
    expect(within(item).getByText('—')).toBeInTheDocument();
  });
});
