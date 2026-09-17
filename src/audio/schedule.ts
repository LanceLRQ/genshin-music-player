import type { ExecutionTimeline, TimelineEvent } from '@/ipc/types';

/** 按键高亮至少保持的时长，太短看不清 */
export const MIN_VISIBLE_MS = 80;

/** 让 durationMs 上的最后一个事件落进左闭右开的窗口 */
const END_INCLUSIVE_MS = 0.001;

/** 第一个 tMs >= timeMs 的事件下标 */
function lowerBound(events: readonly TimelineEvent[], timeMs: number): number {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (events[mid].tMs < timeMs) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** 取出执行时间在 [fromMs, toMs) 内的事件 */
export function eventsInWindow(execution: ExecutionTimeline, fromMs: number, toMs: number): TimelineEvent[] {
  if (toMs <= fromMs) return [];
  return execution.events.slice(lowerBound(execution.events, fromMs), lowerBound(execution.events, toMs));
}

/**
 * positionMs 时刻应该高亮的键：从 down 开始到对应的 up 为止，视觉上至少保持 minVisibleMs。
 * 同一个键再次按下时以最近一次按下为准。
 */
export function activeCodesAt(
  execution: ExecutionTimeline,
  positionMs: number,
  minVisibleMs: number = MIN_VISIBLE_MS,
): Set<string> {
  const lastDown = new Map<string, number>();
  const lastUp = new Map<string, number>();
  const end = lowerBound(execution.events, positionMs + END_INCLUSIVE_MS);
  for (let index = 0; index < end; index += 1) {
    const event = execution.events[index];
    for (const code of event.up) lastUp.set(code, event.tMs);
    for (const code of event.down) lastDown.set(code, event.tMs);
  }
  const active = new Set<string>();
  for (const [code, downMs] of lastDown) {
    const upMs = lastUp.get(code);
    const held = upMs === undefined || upMs < downMs;
    if (held || positionMs < downMs + minVisibleMs) active.add(code);
  }
  return active;
}

/** 执行时间 → 乐谱时间（进度条使用） */
export function toSourcePositionMs(execution: ExecutionTimeline, positionMs: number): number {
  return execution.sourceStartMs + positionMs * execution.speed;
}

export interface LookaheadCursor {
  /** 当前一轮在时钟上的起点（毫秒，AudioContext.currentTime × 1000） */
  cycleStartMs: number;
  /** 当前一轮中已经排程到的执行时间（不含） */
  scheduledUntilMs: number;
}

export interface ScheduledEvent {
  /** 时钟时间（毫秒） */
  atMs: number;
  event: TimelineEvent;
}

export interface LookaheadPlan {
  events: ScheduledEvent[];
  cursor: LookaheadCursor;
  /** 不循环且当前时钟已经走过结尾 */
  ended: boolean;
}

/**
 * lookahead 调度的一步：把时钟时间 nowMs + lookaheadMs 之前、还没排程的事件取出来。
 * 循环播放时越过结尾的部分从下一轮的开头继续排程，下一轮的起点 = 上一轮起点 + durationMs。
 */
export function planLookahead(
  execution: ExecutionTimeline,
  cursor: LookaheadCursor,
  nowMs: number,
  lookaheadMs: number,
): LookaheadPlan {
  const events: ScheduledEvent[] = [];
  if (execution.events.length === 0) return { events, cursor, ended: true };

  const duration = execution.durationMs;
  const loop = execution.loop && duration > 0;
  let { cycleStartMs, scheduledUntilMs } = cursor;
  const horizonMs = nowMs + lookaheadMs;
  for (;;) {
    const windowEnd = Math.min(horizonMs - cycleStartMs, duration + END_INCLUSIVE_MS);
    if (windowEnd > scheduledUntilMs) {
      for (const event of eventsInWindow(execution, scheduledUntilMs, windowEnd)) {
        events.push({ atMs: cycleStartMs + event.tMs, event });
      }
      scheduledUntilMs = windowEnd;
    }
    if (!loop || horizonMs - cycleStartMs <= duration) break;
    cycleStartMs += duration;
    scheduledUntilMs = 0;
  }
  const ended = !loop && nowMs - cycleStartMs >= duration;
  return { events, cursor: { cycleStartMs, scheduledUntilMs }, ended };
}

/** 当前时钟对应的执行时间；循环时下一轮可能已经提前排程，需要换算回正在播放的那一轮 */
export function previewPositionMs(execution: ExecutionTimeline, cursor: LookaheadCursor, nowMs: number): number {
  const duration = execution.durationMs;
  let position = nowMs - cursor.cycleStartMs;
  if (execution.loop && duration > 0) {
    while (position < 0) position += duration;
  }
  return Math.min(Math.max(position, 0), duration);
}
