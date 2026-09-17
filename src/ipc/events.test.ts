import { emit } from '@tauri-apps/api/event';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLAYER_EVENTS, onPlayerProgress, onPlayerState, onPlayerSummary } from './events';
import type { PlayerState, Progress, Summary } from './types';

afterEach(() => {
  clearMocks();
  vi.restoreAllMocks();
});

const summary: Summary = {
  completed: true,
  eventsSent: 6,
  latenessP50Ms: 0.5,
  latenessP95Ms: 1.5,
  latenessMaxMs: 3,
  dropped: 0,
  logPath: null,
};

describe('播放器事件', () => {
  it('事件名与后端约定一致', () => {
    expect(PLAYER_EVENTS).toEqual({
      state: 'player://state',
      progress: 'player://progress',
      summary: 'player://summary',
    });
  });

  it('三个事件都把负载原样交给处理函数', async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    const onState = vi.fn();
    const onProgress = vi.fn();
    const onSummary = vi.fn();
    await onPlayerState(onState);
    await onPlayerProgress(onProgress);
    await onPlayerSummary(onSummary);

    const state: PlayerState = { kind: 'paused', reason: 'focusLost', positionMs: 1200.5 };
    const progress: Progress = { positionMs: 500, sourcePositionMs: 1100 };
    await emit(PLAYER_EVENTS.state, state);
    await emit(PLAYER_EVENTS.progress, progress);
    await emit(PLAYER_EVENTS.summary, summary);

    expect(onState).toHaveBeenCalledWith(state);
    expect(onProgress).toHaveBeenCalledWith(progress);
    expect(onSummary).toHaveBeenCalledWith(summary);
  });

  it('取消订阅后不再调用处理函数', async () => {
    mockIPC(() => null, { shouldMockEvents: true });
    // mock 在取消订阅后仍会尝试回调并打印警告，这里屏蔽掉
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onState = vi.fn();
    const unlisten = await onPlayerState(onState);
    unlisten();
    await emit(PLAYER_EVENTS.state, { kind: 'playing' });
    expect(onState).not.toHaveBeenCalled();
  });

  it('没有 Tauri 运行时时报 IPC_UNAVAILABLE', async () => {
    await expect(onPlayerState(() => undefined)).rejects.toMatchObject({ code: 'IPC_UNAVAILABLE' });
  });
});
