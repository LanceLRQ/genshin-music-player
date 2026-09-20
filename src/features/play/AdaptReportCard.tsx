import { BarChart3, Info } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { hitRate } from '@/core/adapter/adapt';
import { drumNoteLabel } from '@/core/adapter/percussionMap';
import type { AdaptReport } from '@/core/model/timeline';
import { midiToNoteName } from '@/core/music/pitch';
import { formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';
import { type PitchCount, DROPPED_ITEMS, rateBgClass, rateTextClass } from './scoreInfo';

interface AdaptReportCardProps {
  report: AdaptReport | null;
  /** 是否至少勾选了一条音轨 */
  hasTracks: boolean;
  /** 勾选音轨的源音高直方图（pitchHistogram 的结果），驱动「音符统计」弹层 */
  pitchStats: PitchCount[];
  /** 敲击类乐器的音高按 GM 打击乐名称显示 */
  percussion: boolean;
}

type StatsSort = 'pitch' | 'count';

/** 音符统计弹层：每个音高一行（音名 + 条形 + 数量），内容多时滚动；默认按音高排序，可切按数量 */
function NoteStatsDialog({ open, onOpenChange, stats, percussion }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stats: PitchCount[];
  percussion: boolean;
}) {
  const [sortBy, setSortBy] = useState<StatsSort>('pitch');
  const entries = useMemo(() => {
    // 不依赖调用方传入顺序：音高序先排好，数量序在其基础上按数量降序（同数量按音高升序）
    const byPitch = [...stats].sort((a, b) => a.pitch - b.pitch);
    return sortBy === 'pitch' ? byPitch : [...byPitch].sort((a, b) => b.count - a.count || a.pitch - b.pitch);
  }, [stats, sortBy]);
  const max = entries.reduce((peak, item) => Math.max(peak, item.count), 1);
  const total = entries.reduce((sum, item) => sum + item.count, 0);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>音符统计</DialogTitle>
          <DialogDescription>勾选音轨的源音高分布，共 {total} 个音。</DialogDescription>
        </DialogHeader>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={sortBy}
          onValueChange={(value) => {
            if (value === 'pitch' || value === 'count') setSortBy(value);
          }}
          aria-label="统计排序"
        >
          <ToggleGroupItem value="pitch">按音高</ToggleGroupItem>
          <ToggleGroupItem value="count">按数量</ToggleGroupItem>
        </ToggleGroup>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">勾选的音轨里没有带音高的音符。</p>
        ) : (
          <div className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto pr-1" data-testid="note-stats-rows">
            {entries.map(({ pitch, count }) => (
              <div key={pitch} className="flex items-center gap-2">
                <span className="w-28 shrink-0 truncate text-xs tabular-nums" title={String(pitch)}>
                  {percussion ? drumNoteLabel(pitch) : midiToNoteName(pitch)}
                </span>
                <div className="h-3 min-w-0 flex-1 overflow-hidden rounded-sm bg-muted">
                  <div
                    data-count-bar
                    className="h-full rounded-sm bg-primary"
                    style={{ width: `${Math.max((count / max) * 100, 2)}%` }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-xs tabular-nums">{count}</span>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** 适配结果内容片段（设计 01 第 4.6 节）：由左栏底部容器承载分隔，不再自带卡片样式 */
export function AdaptReportCard({ report, hasTracks, pitchStats, percussion }: AdaptReportCardProps) {
  const [statsOpen, setStatsOpen] = useState(false);
  const rate = report === null ? 0 : hitRate(report);
  const droppedItems = report === null ? [] : DROPPED_ITEMS.filter((item) => report.dropped[item.key] > 0);
  const chordAttempts = report === null ? 0 : report.chordHits + report.chordFallbacks;
  const chordRate = chordAttempts === 0 ? 0 : report!.chordHits / chordAttempts;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">适配结果</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          disabled={pitchStats.length === 0}
          onClick={() => setStatsOpen(true)}
        >
          <BarChart3 className="size-3.5" />
          音符统计
        </Button>
      </div>
      {!hasTracks ? (
        <p className="text-sm text-muted-foreground">请至少勾选一条音轨。</p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span className="text-sm">命中率</span>
            <span className={cn('text-base font-semibold tabular-nums', rateTextClass(rate))}>{formatPercent(rate)}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div data-rate-bar className={cn('h-full rounded-full', rateBgClass(rate))} style={{ width: `${rate * 100}%` }} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            弹出 {report?.played} · 合并
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="mx-1 cursor-default underline decoration-dotted underline-offset-2">{report?.merged}</span>
              </TooltipTrigger>
              <TooltipContent className="max-w-72">同一时刻映射到同一个键的音只按一次，常见于多轨齐奏，不算丢音。</TooltipContent>
            </Tooltip>
            {report !== null && report.folded > 0 && <> · 折回 {report.folded}</>}
          </p>
          {chordAttempts > 0 && (
            <p className="text-xs text-muted-foreground">
              和弦键 命中 {report!.chordHits}/{chordAttempts}（{formatPercent(chordRate)}）·
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="mx-1 cursor-default underline decoration-dotted underline-offset-2">回退 {report!.chordFallbacks}</span>
                </TooltipTrigger>
                <TooltipContent className="max-w-72">
                  同时发声且含 3 个以上不同音级的音组会尝试匹配乐器的和弦键，整组收成一次按键；没匹配上的组回退为逐音按下。可在设置的「演奏」分组里关闭。
                </TooltipContent>
              </Tooltip>
            </p>
          )}
          {droppedItems.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {droppedItems.map((item) => (
                <span key={item.key} className="flex items-center gap-1">
                  <span>
                    丢弃 {report?.dropped[item.key]}：{item.label}
                  </span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="size-3" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-72">{item.tooltip}</TooltipContent>
                  </Tooltip>
                </span>
              ))}
            </div>
          )}
        </>
      )}
      <NoteStatsDialog open={statsOpen} onOpenChange={setStatsOpen} stats={pitchStats} percussion={percussion} />
    </div>
  );
}
