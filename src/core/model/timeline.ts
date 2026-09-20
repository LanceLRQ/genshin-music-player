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
}

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
}

export interface KeyTimeline {
  instrumentId: string;
  durationMs: number;
  minRepeatGapMs: number;
  /** 按 tMs 升序 */
  presses: Press[];
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
