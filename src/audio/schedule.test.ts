import { describe, expect, it } from 'vitest';
import type { ExecutionTimeline, TimelineEvent } from '@/ipc/types';
import { activeCodesAt, eventsInWindow, heldCodesAtEnd, planLookahead, previewPositionMs, toSourcePositionMs } from './schedule';

const ev = (tMs: number, down: string[] = [], up: string[] = []): TimelineEvent => ({ tMs, up, down });

function execution(events: TimelineEvent[], overrides: Partial<ExecutionTimeline> = {}): ExecutionTimeline {
  return {
    instrumentId: 'windsong-lyre',
    events,
    durationMs: events.at(-1)?.tMs ?? 0,
    sourceStartMs: 0,
    speed: 1,
    loop: false,
    dropped: 0,
    ...overrides,
  };
}

// KeyA 在 0 按下、30 松开；KeyS 在 100 按下、400 松开；KeyA 在 200 再次按下、230 松开
const sample = execution([
  ev(0, ['KeyA']),
  ev(30, [], ['KeyA']),
  ev(100, ['KeyS']),
  ev(200, ['KeyA']),
  ev(230, [], ['KeyA']),
  ev(400, [], ['KeyS']),
]);
const times = (events: TimelineEvent[]) => events.map((event) => event.tMs);

describe('eventsInWindow', () => {
  it('取 [fromMs, toMs) 内的事件', () => {
    expect(times(eventsInWindow(sample, 0, 100))).toEqual([0, 30]);
    expect(times(eventsInWindow(sample, 30, 230))).toEqual([30, 100, 200]);
    expect(times(eventsInWindow(sample, 401, 1000))).toEqual([]);
  });

  it('窗口为空或反向时返回空数组', () => {
    expect(eventsInWindow(sample, 100, 100)).toEqual([]);
    expect(eventsInWindow(sample, 200, 100)).toEqual([]);
  });
});

describe('activeCodesAt', () => {
  it('从按下到松开期间高亮，松开后至少保持 80ms', () => {
    expect([...activeCodesAt(sample, 0)]).toEqual(['KeyA']);
    expect([...activeCodesAt(sample, 79)]).toEqual(['KeyA']);
    expect([...activeCodesAt(sample, 80)]).toEqual([]);
    expect([...activeCodesAt(sample, 150)]).toEqual(['KeyS']);
    expect([...activeCodesAt(sample, 390)]).toEqual(['KeyS']);
    expect([...activeCodesAt(sample, 400)]).toEqual([]);
  });

  it('同一个键再次按下时以最近一次为准', () => {
    expect([...activeCodesAt(sample, 250)].sort()).toEqual(['KeyA', 'KeyS']);
    expect([...activeCodesAt(sample, 280)]).toEqual(['KeyS']);
  });

  it('第一个事件之前没有高亮；minVisibleMs 为 0 时松开即熄灭', () => {
    expect(activeCodesAt(execution([ev(50, ['KeyA']), ev(80, [], ['KeyA'])]), 10).size).toBe(0);
    expect([...activeCodesAt(sample, 30, 0)]).toEqual([]);
  });
});

describe('toSourcePositionMs / previewPositionMs', () => {
  it('执行时间按速度换算回乐谱时间', () => {
    expect(toSourcePositionMs(execution([ev(0)], { sourceStartMs: 1000, speed: 1.5 }), 200)).toBe(1300);
  });

  it('位置限制在 0 到 durationMs 之间；循环时把提前排程的下一轮换算回当前一轮', () => {
    const cursor = { cycleStartMs: 1000, scheduledUntilMs: 0 };
    expect(previewPositionMs(sample, cursor, 900)).toBe(0);
    expect(previewPositionMs(sample, cursor, 1150)).toBe(150);
    expect(previewPositionMs(sample, cursor, 2000)).toBe(400);
    expect(previewPositionMs({ ...sample, loop: true }, cursor, 950)).toBe(350);
  });
});

describe('planLookahead', () => {
  it('只排程时钟 now + lookahead 之前的事件，并记住排程到的位置', () => {
    const first = planLookahead(sample, { cycleStartMs: 1000, scheduledUntilMs: 0 }, 1000, 100);
    expect(first.events.map((item) => [item.atMs, item.event.tMs])).toEqual([
      [1000, 0],
      [1030, 30],
    ]);
    expect(first.cursor).toEqual({ cycleStartMs: 1000, scheduledUntilMs: 100 });
    expect(first.ended).toBe(false);

    const second = planLookahead(sample, first.cursor, 1025, 100);
    expect(second.events.map((item) => item.event.tMs)).toEqual([100]);
  });

  it('不循环时排到最后一个事件为止，时钟走过结尾后 ended 为 true', () => {
    const cursor = { cycleStartMs: 0, scheduledUntilMs: 250 };
    const tail = planLookahead(sample, cursor, 380, 100);
    expect(tail.events.map((item) => item.event.tMs)).toEqual([400]);
    expect(tail.ended).toBe(false);
    const done = planLookahead(sample, tail.cursor, 400, 100);
    expect(done.events).toEqual([]);
    expect(done.ended).toBe(true);
  });

  it('循环时越过结尾的部分从下一轮开头继续排程', () => {
    const looped = { ...sample, loop: true };
    const plan = planLookahead(looped, { cycleStartMs: 0, scheduledUntilMs: 250 }, 380, 100);
    expect(plan.events.map((item) => [item.atMs, item.event.tMs])).toEqual([
      [400, 400],
      [400, 0],
      [430, 30],
    ]);
    expect(plan.cursor).toEqual({ cycleStartMs: 400, scheduledUntilMs: 80 });
    expect(plan.ended).toBe(false);
  });

  it('没有事件时直接结束', () => {
    const empty = execution([]);
    expect(planLookahead(empty, { cycleStartMs: 0, scheduledUntilMs: 0 }, 0, 100)).toEqual({
      events: [],
      cursor: { cycleStartMs: 0, scheduledUntilMs: 0 },
      ended: true,
    });
  });
});

describe('heldCodesAtEnd', () => {
  it('结尾仍在持续的键被列出，已松开的不算', () => {
    expect(heldCodesAtEnd(execution([ev(0, ['KeyA']), ev(30, [], ['KeyA']), ev(100, ['KeyS'])]))).toEqual(['KeyS']);
    expect(heldCodesAtEnd(execution([ev(0, ['KeyA'])]))).toEqual(['KeyA']);
  });

  it('再次按下又松开的不算；没有事件时为空', () => {
    expect(heldCodesAtEnd(sample)).toEqual([]);
    expect(heldCodesAtEnd(execution([]))).toEqual([]);
  });
});
