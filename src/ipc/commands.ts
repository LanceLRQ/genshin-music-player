import { type InvokeArgs, invoke } from '@tauri-apps/api/core';
import {
  AppError,
  type CustomInstrumentList,
  type EnvInfo,
  type ExecutionParams,
  type ExecutionTimeline,
  type KeyTimeline,
  type PlayerState,
  type Settings,
  isBackendErrorCode,
} from './types';

export const IPC_UNAVAILABLE_MESSAGE = '未连接到桌面端后端，当前页面不在应用窗口中运行';

/** 是否运行在 Tauri 窗口中（测试里由 mockIPC 模拟） */
export function hasTauriRuntime(): boolean {
  const internals = (globalThis as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__;
  return typeof internals?.invoke === 'function';
}

/** 把 invoke 抛出的任意值统一转成 AppError */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    const code = 'code' in error && isBackendErrorCode(error.code) ? error.code : 'UNKNOWN';
    return new AppError(code, error.message);
  }
  return new AppError('UNKNOWN', typeof error === 'string' ? error : String(error));
}

async function call<T>(command: string, args?: InvokeArgs): Promise<T> {
  if (!hasTauriRuntime()) throw new AppError('IPC_UNAVAILABLE', IPC_UNAVAILABLE_MESSAGE);
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toAppError(error);
  }
}

export function getEnv(): Promise<EnvInfo> {
  return call('get_env');
}

/** 成功后应用会立即退出 */
export function restartAsAdmin(): Promise<void> {
  return call('restart_as_admin');
}

export function listCustomInstruments(): Promise<CustomInstrumentList> {
  return call('list_custom_instruments');
}

/** 同 id 直接覆盖，是否确认覆盖由调用方负责 */
export function saveCustomInstrument(profile: unknown): Promise<void> {
  return call('save_custom_instrument', { profile });
}

export function deleteCustomInstrument(id: string): Promise<void> {
  return call('delete_custom_instrument', { id });
}

export function getSettings(): Promise<Settings> {
  return call('get_settings');
}

/** 返回后端校验、重新注册热键后实际保存的设置 */
export function saveSettings(settings: Settings): Promise<Settings> {
  return call('save_settings', { settings });
}

/** 同时在后端缓存为"当前演奏" */
export function buildExecution(timeline: KeyTimeline, params: ExecutionParams): Promise<ExecutionTimeline> {
  return call('build_execution', { timeline, params });
}

/** 不传 countdownSec 时使用设置里的倒计时 */
export function play(countdownSec?: number): Promise<void> {
  return call('play', countdownSec === undefined ? {} : { countdownSec });
}

export function pause(): Promise<void> {
  return call('pause');
}

export function resume(): Promise<void> {
  return call('resume');
}

export function stop(): Promise<void> {
  return call('stop');
}

export function getPlayerState(): Promise<PlayerState> {
  return call('get_player_state');
}
