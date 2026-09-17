import { create } from 'zustand';
import * as commands from '@/ipc/commands';
import type { PlayerState, Progress, Summary } from '@/ipc/types';
import { notifyError } from '@/lib/notify';

/**
 * 后端播放器的镜像状态和演奏控制。区间、速度、试听、单轨等其余字段由演奏页的计划（M3c）在本文件中扩展，
 * 扩展时保留这里的字段、setter 和 play / pause / resume / stop 的行为。
 */
export interface TransportState {
  /** 由 usePlayerEvents 从 player://state 同步 */
  playerState: PlayerState;
  /** 由 player://progress 同步；进入空闲、出错、倒计时时清空 */
  progress: Progress | null;
  /** 最近一次 player://summary */
  summary: Summary | null;
  setPlayerState: (state: PlayerState) => void;
  setProgress: (progress: Progress) => void;
  setSummary: (summary: Summary) => void;
  /** 以下四个操作失败时用 toast 提示，返回是否成功；状态变化以后端推送的事件为准 */
  play: (countdownSec?: number) => Promise<boolean>;
  pause: () => Promise<boolean>;
  resume: () => Promise<boolean>;
  stop: () => Promise<boolean>;
}

async function attempt(action: () => Promise<void>, context: string): Promise<boolean> {
  try {
    await action();
    return true;
  } catch (error) {
    notifyError(error, context);
    return false;
  }
}

export const useTransportStore = create<TransportState>()((set) => ({
  playerState: { kind: 'idle' },
  progress: null,
  summary: null,
  setPlayerState: (playerState) =>
    set(
      playerState.kind === 'idle' || playerState.kind === 'error' || playerState.kind === 'countdown'
        ? { playerState, progress: null }
        : { playerState },
    ),
  setProgress: (progress) => set({ progress }),
  setSummary: (summary) => set({ summary }),
  play: (countdownSec) => attempt(() => commands.play(countdownSec), '无法开始演奏'),
  pause: () => attempt(commands.pause, '无法暂停'),
  resume: () => attempt(commands.resume, '无法继续'),
  stop: () => attempt(commands.stop, '无法停止'),
}));
