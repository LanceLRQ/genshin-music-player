/**
 * 前后端共享的数据类型，与 docs/_internal/design/02-执行核心与IPC接口设计.md 第 3、7.1、10、11 节逐字段对应。
 * Rust 端一律 camelCase 序列化；KeyTimeline / Press 直接复用 M1 的 src/core/model/timeline.ts。
 */

export type { KeyTimeline, Press } from '@/core/model/timeline';

export interface Humanize {
  /** 0..30，0 表示关闭 */
  maxJitterMs: number;
  /** 0..2^31 范围内的整数，避免超出 JS 安全整数 */
  seed: number;
}

/** 单位是乐谱时间 */
export interface PlayRange {
  startMs: number;
  endMs: number;
  loop: boolean;
}

export interface ExecutionParams {
  /** 0.5..2.0 */
  speed: number;
  humanize: Humanize;
  range: PlayRange;
}

/** 同一时刻先处理 up 再处理 down */
export interface TimelineEvent {
  tMs: number;
  up: string[];
  down: string[];
}

export interface ExecutionTimeline {
  instrumentId: string;
  /** tMs 从 0 开始、升序、互不相同 */
  events: TimelineEvent[];
  /** 最后一个事件的时间；range.endMs 有限时至少为 (endMs − startMs) / speed（保留尾部休止，循环周期才正确）；空时间线为 0 */
  durationMs: number;
  sourceStartMs: number;
  speed: number;
  loop: boolean;
  /** 变速后同键过密被丢弃的按键数 */
  dropped: number;
}

export type PauseReason = 'user' | 'focusLost';

export type PlayerState =
  | { kind: 'idle' }
  | { kind: 'countdown'; remainingSec: number }
  | { kind: 'waitingFocus' }
  | { kind: 'playing' }
  | { kind: 'paused'; reason: PauseReason; positionMs: number }
  | { kind: 'error'; code: string; message: string };

export interface Progress {
  /** 执行时间（从 0 开始） */
  positionMs: number;
  /** 乐谱时间 = sourceStartMs + positionMs × speed */
  sourcePositionMs: number;
}

export interface Summary {
  /** 自然播完为 true，被停止为 false */
  completed: boolean;
  eventsSent: number;
  latenessP50Ms: number;
  latenessP95Ms: number;
  latenessMaxMs: number;
  dropped: number;
  logPath: string | null;
}

export type Platform = 'windows' | 'macos' | 'linux';
export type BackendKind = 'windows' | 'macos' | 'mock';

export interface EnvInfo {
  platform: Platform;
  backend: BackendKind;
  /** 只有 Windows 上有值 */
  elevated: boolean | null;
  /** 只有 macOS 上有值：是否已授予辅助功能权限（CGEvent 发键的前提） */
  trusted: boolean | null;
  appVersion: string;
  dataDir: string;
  logsDir: string;
  startupWarnings: string[];
}

/** list_custom_instruments 的返回值：profiles 是未经校验的原始 JSON，由前端用 zod 校验 */
export interface CustomInstrumentList {
  profiles: unknown[];
  warnings: string[];
}

export interface Hotkeys {
  toggle: string;
  stop: string;
}

export interface Shortcuts {
  openFile: string;
  previewToggle: string;
  previewStop: string;
}

export interface WindowRule {
  className: string;
  titles: string[];
}

export interface Settings {
  /** 全局热键，由 Rust 注册 */
  hotkeys: Hotkeys;
  /** 窗口内快捷键，由前端监听 */
  shortcuts: Shortcuts;
  /** 0..10 */
  countdownSec: number;
  targetWindow: WindowRule;
  /** 0..30 */
  defaultHumanizeMs: number;
  writeExecutionLog: boolean;
  /** 模拟发声：开启后"演奏"不向游戏发键，改由本窗口的合成音色播放 */
  simulateSound: boolean;
}

/** 与 Rust 端 Settings::default() 一致 */
export const DEFAULT_SETTINGS: Settings = {
  hotkeys: { toggle: 'F9', stop: 'F10' },
  shortcuts: { openFile: 'CmdOrCtrl+O', previewToggle: 'Space', previewStop: 'Escape' },
  countdownSec: 3,
  targetWindow: { className: 'UnityWndClass', titles: ['原神', 'Genshin Impact'] },
  defaultHumanizeMs: 0,
  writeExecutionLog: true,
  simulateSound: false,
};

export const BACKEND_ERROR_CODES = [
  'TIMELINE_INVALID',
  'UNKNOWN_KEY_CODE',
  'PARAMS_INVALID',
  'NO_EXECUTION',
  'PLAYER_BUSY',
  'INVALID_STATE',
  'INPUT_SEND_FAILED',
  'PLAYER_PANIC',
  'NOT_SUPPORTED',
  'ELEVATION_FAILED',
  'INSTRUMENT_INVALID',
  'INSTRUMENT_ID_CONFLICT',
  'INSTRUMENT_NOT_FOUND',
  'SETTINGS_INVALID',
  'HOTKEY_REGISTER_FAILED',
  'STORAGE_IO',
] as const;

export type BackendErrorCode = (typeof BACKEND_ERROR_CODES)[number];

/**
 * 前端补充的错误码：
 * - IPC_UNAVAILABLE：不在 Tauri 窗口中运行（例如直接在浏览器里打开 pnpm dev 的页面）；
 * - UNKNOWN：后端返回了无法识别的错误。
 */
export type FrontendErrorCode = 'IPC_UNAVAILABLE' | 'UNKNOWN';

export type ErrorCode = BackendErrorCode | FrontendErrorCode;

export function isBackendErrorCode(value: unknown): value is BackendErrorCode {
  return typeof value === 'string' && (BACKEND_ERROR_CODES as readonly string[]).includes(value);
}

/** 所有 IPC 调用失败时抛出的错误；message 是给用户看的中文 */
export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}
