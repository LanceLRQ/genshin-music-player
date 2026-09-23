export type BlackKeyPolicy = 'skip' | 'nearest';
export type OutOfRangePolicy = 'fold' | 'drop';

export interface AdaptOptions {
  tracks: string[];
  transpose: number;
  octaveShift: number;
  blackKeyPolicy: BlackKeyPolicy;
  outOfRangePolicy: OutOfRangePolicy;
  /** 同一时刻最多保留几个音，>= 1 */
  maxPolyphony: number;
  /** 起音间隔在此范围内的音算作同一个和弦 */
  chordWindowMs: number;
  /** 是否启用乐器和弦键匹配（M6，默认开，取值来自全局设置 useChordKeys）；关闭后全走逐音 */
  useChordKeys?: boolean;
  /** 覆盖乐器配置中的非鼓轨分界音高 */
  percussionSplitPitch?: number;
  /** 敲击类乐器按音色直接指定鼓音符号（音色 → MIDI 音高号）；被指定的音符优先于乐器鼓映射表 */
  drumVoiceNotes?: Record<string, number>;
  /** 按 MIDI 音长按键；未设置时跟随乐器 timing.sustain（仅自定义乐器、圆号 / 人声类内置乐器生效，资格判断见 supportsHoldControl） */
  useNoteDuration?: boolean;
  /** 固定时长模式（useNoteDuration 关闭）下的按住时长（10–4000ms），生效范围同 useNoteDuration */
  holdMsOverride?: number;
  /** 长音模式下同键再次按下前至少提前松开的毫秒数（0–200），避免游戏漏读紧跟着的下一次按下；生效范围同 useNoteDuration */
  releaseGapMs?: number;
}

/** 约 60 帧下 2 帧 */
export const DEFAULT_RELEASE_GAP_MS = 40;

export const DEFAULT_ADAPT_OPTIONS: Omit<AdaptOptions, 'tracks' | 'percussionSplitPitch'> = {
  transpose: 0,
  octaveShift: 0,
  blackKeyPolicy: 'skip',
  outOfRangePolicy: 'fold',
  maxPolyphony: 3,
  chordWindowMs: 15,
};

/** 一次按键动作；codes 有多个时表示和弦，需要原子发送 */
export interface Press {
  tMs: number;
  codes: string[];
  holdMs: number;
  /** 需要按音长按住时的目标音长（未经变速）；只在音长大于 holdMs 时设置 */
  sustainMs?: number;
}

export interface KeyTimeline {
  instrumentId: string;
  durationMs: number;
  minRepeatGapMs: number;
  /** 按 tMs 升序 */
  presses: Press[];
  /** 仅长音模式下设置，语义见 AdaptOptions.releaseGapMs */
  releaseGapMs?: number;
}

export interface DropCounts {
  blackKey: number;
  outOfRange: number;
  polyphony: number;
  tooDense: number;
  unmappedDrum: number;
}

/**
 * total = played + merged + dropped 各项之和。
 * merged：同一时刻映射到同一个键、被合并为一次按键的音（合并多轨齐奏时常见），不算丢音。
 * folded：played 中被按八度折回的音数。
 * chordHits / chordFallbacks（M6）：同一时刻的音组按音级集合与乐器和弦键匹配，
 * chordHits 是整组收成一个和弦键的组数，chordFallbacks 是含 ≥3 个不同音级但没匹配上、
 * 回退逐音的组数；乐器没有和弦键或 useChordKeys 关闭时恒为 0。
 */
export interface AdaptReport {
  total: number;
  played: number;
  folded: number;
  merged: number;
  dropped: DropCounts;
  chordHits: number;
  chordFallbacks: number;
}
