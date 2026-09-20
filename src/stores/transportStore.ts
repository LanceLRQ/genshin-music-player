import { create } from 'zustand';
import { previewPlayer } from '@/audio/previewPlayer';
import type { InstrumentProfile } from '@/core/model/instrument';
import type { KeyTimeline } from '@/core/model/timeline';
import * as commands from '@/ipc/commands';
import type { ExecutionParams, ExecutionTimeline, PlayerState, Progress, Summary } from '@/ipc/types';
import { notifyError } from '@/lib/notify';

/** 试听音量保存在 localStorage 的键名 */
export const VOLUME_STORAGE_KEY = 'previewVolume';

/** 单轨试听或单轨演奏 */
export interface SoloRun {
  mode: 'preview' | 'play';
  trackId: string;
}

function readVolume(): number {
  try {
    // getItem 对缺失键返回 null，而 Number(null) === 0 会把"从未设置"误读成音量 0（试听天生静音）
    const raw = localStorage.getItem(VOLUME_STORAGE_KEY);
    if (raw === null) return 0.7;
    const value = Number(raw);
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0.7;
  } catch {
    return 0.7;
  }
}

/** 由乐谱时间线和播放参数组装 build_execution 的参数；整曲的区间终点收敛到时间线时长（设计 02 第 4.2 节） */
export function executionParams(
  timeline: KeyTimeline,
  transport: Pick<TransportState, 'speed' | 'humanizeMs' | 'seed' | 'range' | 'loop'>,
): ExecutionParams {
  const { startMs, endMs } = transport.range;
  return {
    speed: transport.speed,
    humanize: { maxJitterMs: transport.humanizeMs, seed: transport.seed },
    range: { startMs, endMs: Math.min(Math.max(endMs, startMs + 1), timeline.durationMs), loop: transport.loop },
  };
}

export interface TransportState {
  /** 由 usePlayerEvents 从 player://state 同步 */
  playerState: PlayerState;
  /** 由 player://progress 同步；进入空闲、出错、倒计时时清空 */
  progress: Progress | null;
  /** 最近一次 player://summary */
  summary: Summary | null;
  /** 最近一次 build_execution 的结果；虚拟琴键高亮与试听都使用它 */
  execution: ExecutionTimeline | null;
  /** 主音轨选择对应的时间线；单轨结束后用它恢复后端缓存（设计 01 第 4.10 节） */
  mainTimeline: KeyTimeline | null;
  /** 演奏区间，乐谱时间（毫秒） */
  range: { startMs: number; endMs: number };
  loop: boolean;
  /** 0.5..2.0 */
  speed: number;
  /** 0..30 */
  humanizeMs: number;
  /** 人性化随机种子；导入乐谱时随机生成一次，之后保持不变（设计 01 第 4.8 节） */
  seed: number;
  /** 0..1，只影响试听，保存在 localStorage */
  volume: number;
  /** 非空表示正在单轨试听或单轨演奏 */
  solo: SoloRun | null;
  /** 前端试听是否进行中 */
  previewing: boolean;
  /** 试听的当前执行时间（毫秒），由试听播放器约 30fps 回写 */
  previewPositionMs: number;
  setPlayerState: (state: PlayerState) => void;
  setProgress: (progress: Progress) => void;
  setSummary: (summary: Summary) => void;
  /** 以下四个操作失败时用 toast 提示，返回是否成功；状态变化以后端推送的事件为准 */
  play: (countdownSec?: number) => Promise<boolean>;
  pause: () => Promise<boolean>;
  resume: () => Promise<boolean>;
  stop: () => Promise<boolean>;
  /** 用主时间线生成执行时间线（防抖由调用方负责）；时间线为空或没有按键时只清空 execution */
  syncExecution: (timeline: KeyTimeline | null) => Promise<void>;
  /** 开始单轨：生成并缓存单轨时间线，再标记 solo；单轨没有可弹的音时返回 false */
  startSolo: (solo: SoloRun, timeline: KeyTimeline) => Promise<boolean>;
  /** 单轨结束（停止、播完、出错）后调用：清标记并用主时间线恢复后端缓存 */
  endSolo: () => Promise<void>;
  /** 开始试听当前 execution */
  startPreview: (profile: InstrumentProfile) => void;
  /** 停止试听 */
  stopPreview: () => Promise<void>;
  /** 试听中跳转到执行时间轴的指定位置（毫秒）；不在试听时忽略 */
  seekPreview: (positionMs: number) => void;
  /** 试听自然结束时由播放器回调 */
  finishPreview: () => Promise<void>;
  setPreviewPosition: (positionMs: number) => void;
  setVolume: (volume: number) => void;
  setRange: (range: { startMs: number; endMs: number }) => void;
  setLoop: (loop: boolean) => void;
  setSpeed: (speed: number) => void;
  setHumanizeMs: (humanizeMs: number) => void;
  /** 导入乐谱时重置：区间整曲、速度 1、按设置给默认人性化、重新生成种子，清空试听、单轨与统计 */
  resetForScore: (range: { startMs: number; endMs: number }, humanizeMs: number) => void;
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

/** 并发构建序号：只应用最后一次构建的结果，慢的旧响应被丢弃 */
let buildSequence = 0;

export const useTransportStore = create<TransportState>()((set, get) => ({
  playerState: { kind: 'idle' },
  progress: null,
  summary: null,
  execution: null,
  mainTimeline: null,
  range: { startMs: 0, endMs: 0 },
  loop: false,
  speed: 1,
  humanizeMs: 0,
  seed: 1,
  volume: readVolume(),
  solo: null,
  previewing: false,
  previewPositionMs: 0,
  setPlayerState: (playerState) => {
    const clearProgress =
      playerState.kind === 'idle' || playerState.kind === 'error' || playerState.kind === 'countdown';
    set(clearProgress ? { playerState, progress: null } : { playerState });
    if (playerState.kind === 'idle' || playerState.kind === 'error') {
      // 演奏结束或出错：结束试听状态；单轨演奏结束后恢复主时间线
      set({ previewing: false, previewPositionMs: 0 });
      previewPlayer.stop();
      if (get().solo) void get().endSolo();
    }
  },
  setProgress: (progress) => set({ progress }),
  setSummary: (summary) => set({ summary }),
  play: (countdownSec) => attempt(() => commands.play(countdownSec), '无法开始演奏'),
  pause: () => attempt(commands.pause, '无法暂停'),
  resume: () => attempt(commands.resume, '无法继续'),
  stop: () => attempt(commands.stop, '无法停止'),
  syncExecution: async (timeline) => {
    if (!timeline || timeline.presses.length === 0) {
      buildSequence += 1;
      set({ execution: null, mainTimeline: timeline });
      return;
    }
    const sequence = ++buildSequence;
    set({ mainTimeline: timeline });
    try {
      const execution = await commands.buildExecution(timeline, executionParams(timeline, get()));
      if (sequence !== buildSequence) return;
      set({ execution });
    } catch (error) {
      if (sequence !== buildSequence) return;
      set({ execution: null });
      notifyError(error, '无法生成执行时间线');
    }
  },
  startSolo: async (solo, timeline) => {
    if (timeline.presses.length === 0) return false;
    const sequence = ++buildSequence;
    try {
      const execution = await commands.buildExecution(timeline, executionParams(timeline, get()));
      if (sequence !== buildSequence) return false;
      set({ execution, solo });
      return true;
    } catch (error) {
      if (sequence === buildSequence) {
        set({ execution: null });
        notifyError(error, '无法生成单轨时间线');
      }
      return false;
    }
  },
  endSolo: async () => {
    if (!get().solo) return;
    set({ solo: null });
    await get().syncExecution(get().mainTimeline);
  },
  startPreview: (profile) => {
    const { execution, previewing } = get();
    if (!execution || execution.events.length === 0 || previewing) return;
    set({ previewing: true, previewPositionMs: 0 });
    previewPlayer.start(execution, profile, {
      onPosition: (positionMs) => get().setPreviewPosition(positionMs),
      onEnded: () => void get().finishPreview(),
    });
  },
  stopPreview: async () => {
    if (!get().previewing) return;
    previewPlayer.stop();
    set({ previewing: false, previewPositionMs: 0 });
    if (get().solo?.mode === 'preview') await get().endSolo();
  },
  seekPreview: (positionMs) => {
    const { execution, previewing } = get();
    if (!execution || !previewing) return;
    const clamped = Math.min(Math.max(positionMs, 0), execution.durationMs);
    previewPlayer.seek(clamped);
    set({ previewPositionMs: clamped });
  },
  finishPreview: async () => {
    if (!get().previewing) return;
    set({ previewing: false, previewPositionMs: 0 });
    if (get().solo?.mode === 'preview') await get().endSolo();
  },
  setPreviewPosition: (previewPositionMs) => set({ previewPositionMs }),
  setVolume: (volume) => {
    try {
      localStorage.setItem(VOLUME_STORAGE_KEY, String(volume));
    } catch {
      // 本地存储不可用时只在本次运行中生效
    }
    previewPlayer.setVolume(volume);
    set({ volume });
  },
  setRange: (range) => set({ range }),
  setLoop: (loop) => set({ loop }),
  setSpeed: (speed) => set({ speed }),
  setHumanizeMs: (humanizeMs) => set({ humanizeMs }),
  resetForScore: (range, humanizeMs) => {
    set({
      range,
      loop: false,
      speed: 1,
      humanizeMs,
      seed: Math.floor(Math.random() * 2 ** 31),
      execution: null,
      mainTimeline: null,
      solo: null,
      previewing: false,
      previewPositionMs: 0,
      summary: null,
      progress: null,
    });
    // 旧乐谱的试听可能仍在进行：先停掉，避免换谱后幽灵声播放到自然结束
    previewPlayer.stop();
  },
}));
