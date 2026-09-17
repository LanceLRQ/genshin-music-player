import { listen } from '@tauri-apps/api/event';
import { IPC_UNAVAILABLE_MESSAGE, hasTauriRuntime, toAppError } from './commands';
import { AppError, type PlayerState, type Progress, type Summary } from './types';

export const PLAYER_EVENTS = {
  state: 'player://state',
  progress: 'player://progress',
  summary: 'player://summary',
} as const;

export type Unlisten = () => void;

async function subscribe<T>(event: string, handler: (payload: T) => void): Promise<Unlisten> {
  if (!hasTauriRuntime()) throw new AppError('IPC_UNAVAILABLE', IPC_UNAVAILABLE_MESSAGE);
  let active = true;
  try {
    const unlisten = await listen<T>(event, ({ payload }) => {
      if (active) handler(payload);
    });
    return () => {
      if (!active) return;
      active = false;
      // 卸载时后端可能已经不可用（窗口正在关闭、测试已清理 mock），取消订阅失败不影响界面
      Promise.resolve(unlisten()).catch(() => undefined);
    };
  } catch (error) {
    throw toAppError(error);
  }
}

/** 状态变化时触发 */
export function onPlayerState(handler: (state: PlayerState) => void): Promise<Unlisten> {
  return subscribe(PLAYER_EVENTS.state, handler);
}

/** 演奏中约 30Hz */
export function onPlayerProgress(handler: (progress: Progress) => void): Promise<Unlisten> {
  return subscribe(PLAYER_EVENTS.progress, handler);
}

/** 自然播完或停止时（发送过按键才会触发） */
export function onPlayerSummary(handler: (summary: Summary) => void): Promise<Unlisten> {
  return subscribe(PLAYER_EVENTS.summary, handler);
}
