import { emit } from '@tauri-apps/api/event';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { act, renderHook } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { previewPlayer } from '@/audio/previewPlayer';
import { BUILTIN_INSTRUMENTS } from '@/core/instruments/registry';
import { DEFAULT_SETTINGS, type ExecutionTimeline } from '@/ipc/types';
import { useAdaptStore } from '@/stores/adaptStore';
import { useInstrumentStore } from '@/stores/instrumentStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTransportStore } from '@/stores/transportStore';
import { useSoundModeHotkeys } from './useSoundModeHotkeys';

vi.mock('@/audio/previewPlayer', () => ({
  previewPlayer: { start: vi.fn(), stop: vi.fn(), playKey: vi.fn(), setVolume: vi.fn(), playing: false },
}));

const lyre = BUILTIN_INSTRUMENTS[0];
const execution: ExecutionTimeline = {
  instrumentId: 'windsong-lyre',
  events: [{ tMs: 0, up: [], down: ['KeyA'] }],
  durationMs: 1000,
  sourceStartMs: 0,
  speed: 1,
  loop: false,
  dropped: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  useSettingsStore.setState(useSettingsStore.getInitialState(), true);
  useInstrumentStore.setState(useInstrumentStore.getInitialState(), true);
  useAdaptStore.setState(useAdaptStore.getInitialState(), true);
  useTransportStore.setState(useTransportStore.getInitialState(), true);
});

afterEach(() => {
  clearMocks();
  vi.restoreAllMocks();
});

/** mockIPC 记录所有后端命令，同时启用事件 mock 让 emit 能到达已订阅的 handler */
function mockBackend() {
  const calls: string[] = [];
  mockIPC(
    (cmd) => {
      calls.push(cmd);
      return null;
    },
    { shouldMockEvents: true },
  );
  return calls;
}

describe('useSoundModeHotkeys', () => {
  it('模拟发声关闭时收到 toggle 不启动试听、不发任何命令', async () => {
    const calls = mockBackend();
    useSettingsStore.setState({ settings: DEFAULT_SETTINGS });
    renderHook(() => useSoundModeHotkeys());
    await emit('hotkey://action', 'toggle');
    expect(vi.mocked(previewPlayer.start)).not.toHaveBeenCalled();
    // keys 模式下后端自己处理热键
    expect(calls).not.toContain('stop');
  });

  it('模拟发声开启时空闲收到 toggle：兜底停后端并开始试听', async () => {
    const calls = mockBackend();
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, simulateSound: true } });
    useTransportStore.setState({ execution });
    renderHook(() => useSoundModeHotkeys());
    await emit('hotkey://action', 'toggle');
    expect(vi.mocked(previewPlayer.start)).toHaveBeenCalledWith(
      execution,
      lyre,
      expect.objectContaining({ onPosition: expect.any(Function), onEnded: expect.any(Function) }),
    );
    expect(useTransportStore.getState().previewing).toBe(true);
    expect(calls).toContain('stop');
  });

  it('模拟发声开启时试听中收到 toggle：只停止试听，不重开也不发命令', async () => {
    const calls = mockBackend();
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, simulateSound: true } });
    act(() => useTransportStore.setState({ execution, previewing: true }));
    renderHook(() => useSoundModeHotkeys());
    await emit('hotkey://action', 'toggle');
    expect(useTransportStore.getState().previewing).toBe(false);
    expect(vi.mocked(previewPlayer.stop)).toHaveBeenCalled();
    expect(vi.mocked(previewPlayer.start)).not.toHaveBeenCalled();
    expect(calls).not.toContain('stop');
  });

  it('模拟发声开启时收到 stop：试听停止并兜底向后端发 stop', async () => {
    const calls = mockBackend();
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, simulateSound: true } });
    act(() => useTransportStore.setState({ execution, previewing: true }));
    renderHook(() => useSoundModeHotkeys());
    await emit('hotkey://action', 'stop');
    expect(useTransportStore.getState().previewing).toBe(false);
    expect(vi.mocked(previewPlayer.stop)).toHaveBeenCalled();
    expect(calls).toContain('stop');
  });

  it('卸载后收到热键动作不再响应', async () => {
    mockBackend();
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, simulateSound: true } });
    useTransportStore.setState({ execution });
    // mock 在取消订阅后仍可能尝试回调并打印警告，这里屏蔽掉
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { unmount } = renderHook(() => useSoundModeHotkeys());
    // 等订阅 promise 链 resolve，确保卸载时拿到取消订阅函数
    await new Promise((resolve) => setTimeout(resolve, 0));
    unmount();
    await emit('hotkey://action', 'toggle');
    expect(vi.mocked(previewPlayer.start)).not.toHaveBeenCalled();
  });

  it('不在 Tauri 窗口中运行时静默跳过，不弹出提示', async () => {
    const spy = vi.spyOn(toast, 'error');
    renderHook(() => useSoundModeHotkeys());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(spy).not.toHaveBeenCalled();
    expect(useTransportStore.getState().previewing).toBe(false);
  });
});
