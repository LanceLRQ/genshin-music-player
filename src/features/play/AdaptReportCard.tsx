import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { hitRate } from '@/core/adapter/adapt';
import type { AdaptReport } from '@/core/model/timeline';
import { formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DROPPED_ITEMS, rateBgClass, rateTextClass } from './scoreInfo';

interface AdaptReportCardProps {
  report: AdaptReport | null;
  /** 是否至少勾选了一条音轨 */
  hasTracks: boolean;
}

/** 适配结果内容片段（设计 01 第 4.6 节）：由左栏底部容器承载分隔，不再自带卡片样式 */
export function AdaptReportCard({ report, hasTracks }: AdaptReportCardProps) {
  const rate = report === null ? 0 : hitRate(report);
  const droppedItems = report === null ? [] : DROPPED_ITEMS.filter((item) => report.dropped[item.key] > 0);
  const chordAttempts = report === null ? 0 : report.chordHits + report.chordFallbacks;
  const chordRate = chordAttempts === 0 ? 0 : report!.chordHits / chordAttempts;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium">适配结果</span>
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
    </div>
  );
}
