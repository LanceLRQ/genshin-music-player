import { useMemo, useRef } from 'react';
import { toSourcePositionMs } from '@/audio/schedule';
import { formatTime } from '@/lib/format';
import { isPlayerActive } from '@/lib/playerStatus';
import { cn } from '@/lib/utils';
import { useScoreStore } from '@/stores/scoreStore';
import { useTransportStore } from '@/stores/transportStore';
import { scoreDurationMs } from './scoreInfo';
import { clampRange } from './RangeControls';

/** 热力图的分桶数；桶宽按百分比均分，窗口缩放时无需重新计算 */
const BUCKET_COUNT = 100;
/** 键盘定位的步长（毫秒） */
const KEY_SEEK_STEP_MS = 2000;

/** 把主时间线的按键按时间分桶，返回每桶的相对密度（0..1）；没有按键时返回 null */
function heatBuckets(presses: readonly { tMs: number; codes: string[] }[] | undefined, total: number): number[] | null {
  if (!total || !presses || presses.length === 0) return null;
  const weights = new Array<number>(BUCKET_COUNT).fill(0);
  for (const press of presses) {
    const index = Math.min(Math.floor((press.tMs / total) * BUCKET_COUNT), BUCKET_COUNT - 1);
    weights[index] += Math.max(press.codes.length, 1);
  }
  const max = Math.max(...weights);
  if (max <= 0) return null;
  return weights.map((weight) => weight / max);
}

/**
 * 进度条（设计 01 第 4.8 节）：按键密度热力图 + 指针，可点击 / 拖动 / 键盘定位——
 * 试听中实时跳转，空闲时定位演奏起点（即区间起点）；演奏进行中锁定。
 */
export function TimelineBar() {
  const score = useScoreStore((state) => state.score);
  const execution = useTransportStore((state) => state.execution);
  const progress = useTransportStore((state) => state.progress);
  const playerState = useTransportStore((state) => state.playerState);
  const previewing = useTransportStore((state) => state.previewing);
  const previewPositionMs = useTransportStore((state) => state.previewPositionMs);
  const range = useTransportStore((state) => state.range);
  const mainTimeline = useTransportStore((state) => state.mainTimeline);
  const trackRef = useRef<HTMLDivElement>(null);

  const total = score ? scoreDurationMs(score) : 0;
  const locked = isPlayerActive(playerState);
  const interactive = !locked && total > 0;
  const sourcePositionMs =
    previewing && execution ? toSourcePositionMs(execution, previewPositionMs) : (progress?.sourcePositionMs ?? range.startMs);
  const percent = total > 0 ? Math.min(Math.max((sourcePositionMs / total) * 100, 0), 100) : 0;
  const buckets = useMemo(() => heatBuckets(mainTimeline?.presses, total), [mainTimeline, total]);

  /** 定位到乐谱时间的 ms 处：试听中跳转试听，空闲时把它设为演奏起点（区间起点） */
  const applySeek = (ms: number) => {
    if (!interactive) return;
    const clampedMs = Math.min(Math.max(ms, 0), total);
    const transport = useTransportStore.getState();
    if (transport.previewing && transport.execution) {
      const executionTimeline = transport.execution;
      transport.seekPreview((clampedMs - executionTimeline.sourceStartMs) / executionTimeline.speed);
      return;
    }
    const current = transport.range;
    const next = clampRange([clampedMs, current.endMs], 'start', total, [current.startMs, current.endMs]);
    transport.setRange({ startMs: next[0], endMs: next[1] });
  };

  const seekFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    applySeek(ratio * total);
  };

  if (!score) return null;

  return (
    <div className="flex flex-col gap-1">
      <div
        ref={trackRef}
        role="slider"
        aria-label="进度定位"
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(sourcePositionMs)}
        aria-valuetext={formatTime(sourcePositionMs)}
        aria-disabled={!interactive || undefined}
        tabIndex={interactive ? 0 : -1}
        title={locked ? '演奏进行中不能定位' : undefined}
        className={cn(
          'relative h-7 touch-none select-none overflow-hidden rounded-md',
          interactive ? 'cursor-pointer' : 'cursor-not-allowed',
        )}
        onPointerDown={(event) => {
          if (!interactive) return;
          event.preventDefault();
          seekFromClientX(event.clientX);
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // 指针已不在激活状态时捕获失败无碍：拖动仍通过 pointermove + buttons 判断生效
          }
        }}
        onPointerMove={(event) => {
          if (interactive && event.buttons === 1) seekFromClientX(event.clientX);
        }}
        onKeyDown={(event) => {
          if (!interactive) return;
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            applySeek(sourcePositionMs + (event.key === 'ArrowRight' ? KEY_SEEK_STEP_MS : -KEY_SEEK_STEP_MS));
          } else if (event.key === 'Home') {
            event.preventDefault();
            applySeek(0);
          } else if (event.key === 'End') {
            event.preventDefault();
            applySeek(total);
          }
        }}
      >
        {buckets ? (
          <div data-testid="timeline-heat" aria-hidden className="pointer-events-none absolute inset-0 flex items-end gap-px px-0.5">
            {buckets.map((density, index) => {
              const bucketMs = ((index + 0.5) / BUCKET_COUNT) * total;
              const inRange = bucketMs >= range.startMs && bucketMs < range.endMs;
              return (
                <div
                  key={index}
                  className={cn('min-w-0 flex-1 rounded-t-[2px]', inRange ? 'bg-sky-500/60' : 'bg-muted-foreground/20')}
                  style={{ height: `${Math.max(density * 100, 6)}%` }}
                />
              );
            })}
          </div>
        ) : (
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-1.5 rounded-full bg-muted" />
        )}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0.5 z-10 w-0.5 -translate-x-1/2 rounded-full bg-sky-500"
          style={{ left: `${percent}%` }}
        />
      </div>
      <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
        <span>{formatTime(sourcePositionMs)}</span>
        <span>{formatTime(total)}</span>
      </div>
    </div>
  );
}
