import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { AdaptReport } from '@/core/model/timeline';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AdaptReportCard } from './AdaptReportCard';

const stats = [
  { pitch: 72, count: 5 },
  { pitch: 60, count: 9 },
  { pitch: 67, count: 2 },
];

const report: AdaptReport = {
  total: 10,
  played: 7,
  folded: 0,
  merged: 1,
  dropped: { blackKey: 12, outOfRange: 0, polyphony: 2, tooDense: 0, unmappedDrum: 0 },
  chordHits: 0,
  chordFallbacks: 0,
};

describe('AdaptReportCard', () => {
  it('没有勾选音轨时提示', () => {
    render(
      <TooltipProvider>
        <AdaptReportCard report={null} hasTracks={false} pitchStats={[]} percussion={false} />
      </TooltipProvider>,
    );
    expect(screen.getByText('请至少勾选一条音轨。')).toBeInTheDocument();
  });

  it('显示命中率与进度条，合并带说明', () => {
    render(
      <TooltipProvider>
        <AdaptReportCard report={report} hasTracks pitchStats={stats} percussion={false} />
      </TooltipProvider>,
    );
    expect(screen.getByText('80%')).toBeInTheDocument();
    const bar = screen.getByText('命中率').parentElement!.querySelector('[data-rate-bar]') as HTMLElement;
    expect(bar.style.width).toBe('80%');
    expect(screen.getByText(/弹出 7 · 合并/)).toBeInTheDocument();
  });

  it('丢弃明细只列出不为 0 的项', () => {
    render(
      <TooltipProvider>
        <AdaptReportCard report={report} hasTracks pitchStats={stats} percussion={false} />
      </TooltipProvider>,
    );
    expect(screen.getByText(/丢弃 12：黑键/)).toBeInTheDocument();
    expect(screen.getByText(/丢弃 2：复音超限/)).toBeInTheDocument();
    expect(screen.queryByText(/超音域/)).not.toBeInTheDocument();
    expect(screen.queryByText(/未映射/)).not.toBeInTheDocument();
    // 每个非零项都有 ⓘ 说明图标（Tooltip 内容走 Portal，图标是相邻兄弟节点）
    expect(screen.getByText(/丢弃 12：黑键/).parentElement!.querySelector('svg')).not.toBeNull();
  });

  it('有和弦命中或回退时展示和弦键命中率，全为 0 时不展示', () => {
    const chordReport: AdaptReport = { ...report, chordHits: 3, chordFallbacks: 1 };
    const { rerender } = render(
      <TooltipProvider>
        <AdaptReportCard report={chordReport} hasTracks pitchStats={stats} percussion={false} />
      </TooltipProvider>,
    );
    expect(screen.getByText(/和弦键 命中 3\/4（75%）/)).toBeInTheDocument();
    expect(screen.getByText(/回退 1/)).toBeInTheDocument();
    rerender(
      <TooltipProvider>
        <AdaptReportCard report={report} hasTracks pitchStats={stats} percussion={false} />
      </TooltipProvider>,
    );
    expect(screen.queryByText(/和弦键/)).not.toBeInTheDocument();
  });
});

describe('AdaptReportCard：音符统计', () => {
  it('点击音符统计打开弹层，默认按音高升序，数量为 0 的音高不出现', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <AdaptReportCard report={report} hasTracks pitchStats={stats} percussion={false} />
      </TooltipProvider>,
    );
    await user.click(screen.getByRole('button', { name: '音符统计' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const rows = screen.getByTestId('note-stats-rows');
    expect([...rows.querySelectorAll('span')].filter((el) => /^(C4|G4|C5)$/.test(el.textContent ?? '')).map((el) => el.textContent)).toEqual(['C4', 'G4', 'C5']);
  });

  it('切换「按数量」后按数量降序排列', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <AdaptReportCard report={report} hasTracks pitchStats={stats} percussion={false} />
      </TooltipProvider>,
    );
    await user.click(screen.getByRole('button', { name: '音符统计' }));
    await user.click(screen.getByRole('radio', { name: '按数量' }));
    const rows = screen.getByTestId('note-stats-rows');
    const counts = [...rows.querySelectorAll('span')].map((el) => el.textContent).filter((t) => /^\d$/.test(t ?? ''));
    expect(counts).toEqual(['9', '5', '2']);
  });

  it('敲击类乐器用 GM 打击乐名称显示音高，条形宽度按最大值归一', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <AdaptReportCard report={report} hasTracks pitchStats={[{ pitch: 36, count: 4 }, { pitch: 38, count: 2 }]} percussion />
      </TooltipProvider>,
    );
    await user.click(screen.getByRole('button', { name: '音符统计' }));
    expect(screen.getByText('C2 · 底鼓')).toBeInTheDocument();
    expect(screen.getByText('D2 · 原声军鼓')).toBeInTheDocument();
    const bars = [...screen.getByTestId('note-stats-rows').querySelectorAll('[data-count-bar]')] as HTMLElement[];
    expect(bars[0].style.width).toBe('100%');
    expect(bars[1].style.width).toBe('50%');
  });

  it('没有统计数据时按钮禁用', () => {
    render(
      <TooltipProvider>
        <AdaptReportCard report={report} hasTracks pitchStats={[]} percussion={false} />
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: '音符统计' })).toBeDisabled();
  });
});
