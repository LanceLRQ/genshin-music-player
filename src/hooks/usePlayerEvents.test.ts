import { emit } from '@tauri-apps/api/event';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { renderHook, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerState, Summary } from '@/ipc/types';
import { useTransportStore } from '@/stores/transportStore';
import { usePlayerEvents } from './usePlayerEvents';

const paused: PlayerState = { kind: 'paused', reason: 'user', positionMs: 800 };
const summary: Summary = {
  completed: true,
  eventsSent: 3,
  latenessP50Ms: 0,
  latenessP95Ms: 1,
  latenessMaxMs: 1,
  dropped: 0,
  resyncCount: 0,
  logPath: null,
};

/** 反复发出统计事件，直到最后订阅的 player://summary 生效，说明三个事件都已订阅 */
async function waitForSubscriptions() {
  await waitFor(async () => {
    await emit('player://summary', summary);
    expect(useTransportStore.getState().summary).toEqual(summary);
  });
}

beforeEach(() => {
  useTransportStore.setState(useTransportStore.getInitialState(), true);
});

afterEach(() => {
  clearMocks();
  vi.restoreAllMocks();
});

describe('usePlayerEvents', () => {
  it('挂载时先订阅三个事件，再读取后端的播放器状态', async () => {
    const calls: string[] = [];
    mockIPC((cmd, args) => {
      calls.push(cmd === 'plugin:event|listen' ? `listen ${(args as { event: string }).event}` : cmd);
      return cmd === 'get_player_state' ? paused : calls.length;
    });
    renderHook(() => usePlayerEvents());
    await waitFor(() => expect(calls).toHaveLength(4));
    expect(calls).toEqual([
      'listen player://state',
      'listen player://progress',
      'listen player://summary',
      'get_player_state',
    ]);
    expect(useTransportStore.getState().playerState).toEqual(paused);
  });

  it('读取快照前已收到状态事件时，迟到的快照不会覆盖事件结果', async () => {
    const calls: string[] = [];
    mockIPC(
      (cmd) => {
        calls.push(cmd);
        if (cmd === 'get_player_state') {
          return new Promise<PlayerState>((resolve) => setTimeout(() => resolve({ kind: 'idle' }), 30));
        }
        return null;
      },
      { shouldMockEvents: true },
    );
    renderHook(() => usePlayerEvents());
    await waitFor(() => expect(calls).toContain('get_player_state'));
    await emit('player://state', { kind: 'playing' });
    // 等待迟到的快照 resolve（它不应写入 store）
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(useTransportStore.getState().playerState).toEqual({ kind: 'playing' });
  });

  it('把状态、进度和演奏统计事件写入 transportStore', async () => {
    mockIPC((cmd) => (cmd === 'get_player_state' ? { kind: 'idle' } : null), { shouldMockEvents: true });
    renderHook(() => usePlayerEvents());
    await waitForSubscriptions();

    await emit('player://state', { kind: 'playing' });
    await emit('player://progress', { positionMs: 100, sourcePositionMs: 250 });
    expect(useTransportStore.getState()).toMatchObject({
      playerState: { kind: 'playing' },
      progress: { positionMs: 100, sourcePositionMs: 250 },
      summary,
    });
  });

  it('卸载后不再写入 transportStore', async () => {
    mockIPC((cmd) => (cmd === 'get_player_state' ? { kind: 'idle' } : null), { shouldMockEvents: true });
    // mock 在取消订阅后仍会尝试回调并打印警告，这里屏蔽掉
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { unmount } = renderHook(() => usePlayerEvents());
    await waitForSubscriptions();
    unmount();
    await emit('player://state', { kind: 'playing' });
    expect(useTransportStore.getState().playerState).toEqual({ kind: 'idle' });
  });

  it('不在 Tauri 窗口中运行时不报错，也不弹出提示', async () => {
    const spy = vi.spyOn(toast, 'error');
    renderHook(() => usePlayerEvents());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(spy).not.toHaveBeenCalled();
    expect(useTransportStore.getState().playerState).toEqual({ kind: 'idle' });
  });

  it('后端返回其他错误时用 toast 提示', async () => {
    mockIPC(() => Promise.reject({ code: 'STORAGE_IO', message: '读写文件失败' }));
    const spy = vi.spyOn(toast, 'error');
    renderHook(() => usePlayerEvents());
    await waitFor(() => expect(spy).toHaveBeenCalledWith('无法同步播放器状态：读写文件失败'));
  });

  it('订阅中途失败时，取消已经建立的订阅并提示错误', async () => {
    // mock 取消订阅后仍可能尝试回调并打印警告，这里屏蔽掉
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const calls: { cmd: string; event?: string }[] = [];
    mockIPC((cmd, args) => {
      const event = (args as { event?: string } | undefined)?.event;
      calls.push({ cmd, event });
      if (cmd === 'plugin:event|listen' && event === 'player://progress') {
        return Promise.reject(new Error('boom'));
      }
      return cmd === 'get_player_state' ? { kind: 'idle' } : 1;
    });
    const spy = vi.spyOn(toast, 'error');
    renderHook(() => usePlayerEvents());
    await waitFor(() => expect(spy).toHaveBeenCalledWith('无法同步播放器状态：boom'));
    expect(calls.some((call) => call.cmd === 'plugin:event|unlisten' && call.event === 'player://state')).toBe(true);
    expect(calls.some((call) => call.cmd === 'plugin:event|unlisten' && call.event === 'player://summary')).toBe(false);
  });
});
