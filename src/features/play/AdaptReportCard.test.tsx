import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AdaptReport } from '@/core/model/timeline';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AdaptReportCard } from './AdaptReportCard';

const report: AdaptReport = {
  total: 10,
  played: 7,
  folded: 0,
  merged: 1,
  dropped: { blackKey: 12, outOfRange: 0, polyphony: 2, tooDense: 0, unmappedDrum: 0 },
};

describe('AdaptReportCard', () => {
  it('没有勾选音轨时提示', () => {
    render(
      <TooltipProvider>
        <AdaptReportCard report={null} hasTracks={false} />
      </TooltipProvider>,
    );
    expect(screen.getByText('请至少勾选一条音轨。')).toBeInTheDocument();
  });

  it('显示命中率与进度条，合并带说明', () => {
    render(
      <TooltipProvider>
        <AdaptReportCard report={report} hasTracks />
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
        <AdaptReportCard report={report} hasTracks />
      </TooltipProvider>,
    );
    expect(screen.getByText(/丢弃 12：黑键/)).toBeInTheDocument();
    expect(screen.getByText(/丢弃 2：复音超限/)).toBeInTheDocument();
    expect(screen.queryByText(/超音域/)).not.toBeInTheDocument();
    expect(screen.queryByText(/未映射/)).not.toBeInTheDocument();
    // 每个非零项都有 ⓘ 说明图标（Tooltip 内容走 Portal，图标是相邻兄弟节点）
    expect(screen.getByText(/丢弃 12：黑键/).parentElement!.querySelector('svg')).not.toBeNull();
  });
});
