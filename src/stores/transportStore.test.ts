import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerState, Summary } from '@/ipc/types';
import { type TransportState, useTransportStore } from './transportStore';

const progress = { positionMs: 500, sourcePositionMs: 1100 };
const summary: Summary = {
  completed: false,
  eventsSent: 12,
  latenessP50Ms: 0.4,
  latenessP95Ms: 2.1,
  latenessMaxMs: 9,
  dropped: 1,
  logPath: '/data/logs/exec-1.jsonl',
};

function recordIPC() {
  const calls: { cmd: string; args: unknown }[] = [];
  mockIPC((cmd, args) => {
    calls.push({ cmd, args });
    return null;
  });
  return calls;
}

beforeEach(() => {
  useTransportStore.setState(useTransportStore.getInitialState(), true);
});

afterEach(() => {
  clearMocks();
  vi.restoreAllMocks();
});

describe('transportStore', () => {
  it('初始为空闲，没有进度和演奏统计', () => {
    expect(useTransportStore.getState()).toMatchObject({ playerState: { kind: 'idle' }, progress: null, summary: null });
  });

  it('进入空闲、出错、倒计时时清空进度，演奏中和暂停时保留', () => {
    const { setPlayerState, setProgress } = useTransportStore.getState();
    const keeps: PlayerState[] = [{ kind: 'playing' }, { kind: 'paused', reason: 'user', positionMs: 500 }, { kind: 'waitingFocus' }];
    const clears: PlayerState[] = [
      { kind: 'idle' },
      { kind: 'error', code: 'PLAYER_PANIC', message: '播放线程异常退出，已松开所有按键' },
      { kind: 'countdown', remainingSec: 3 },
    ];
    for (const state of keeps) {
      setProgress(progress);
      setPlayerState(state);
      expect(useTransportStore.getState()).toMatchObject({ playerState: state, progress });
    }
    for (const state of clears) {
      setProgress(progress);
      setPlayerState(state);
      expect(useTransportStore.getState()).toMatchObject({ playerState: state, progress: null });
    }
  });

  it('setSummary 保存最近一次演奏统计', () => {
    useTransportStore.getState().setSummary(summary);
    expect(useTransportStore.getState().summary).toEqual(summary);
  });

  it('play 调用 play 命令并带上倒计时', async () => {
    const calls = recordIPC();
    await expect(useTransportStore.getState().play(0)).resolves.toBe(true);
    expect(calls).toEqual([{ cmd: 'play', args: { countdownSec: 0 } }]);
  });

  it.each<[keyof Pick<TransportState, 'pause' | 'resume' | 'stop'>]>([['pause'], ['resume'], ['stop']])(
    '%s 调用同名命令',
    async (action) => {
      const calls = recordIPC();
      await expect(useTransportStore.getState()[action]()).resolves.toBe(true);
      expect(calls.map((call) => call.cmd)).toEqual([action]);
    },
  );

  it('命令失败时用 toast 提示并返回 false', async () => {
    mockIPC(() => Promise.reject({ code: 'PLAYER_BUSY', message: '正在演奏中，请先停止' }));
    const spy = vi.spyOn(toast, 'error');
    await expect(useTransportStore.getState().play()).resolves.toBe(false);
    expect(spy).toHaveBeenCalledWith('无法开始演奏：正在演奏中，请先停止');
  });
});
