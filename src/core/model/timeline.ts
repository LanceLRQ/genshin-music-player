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
  /** 覆盖乐器配置中的非鼓轨分界音高 */
  percussionSplitPitch?: number;
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
 * merged：同一时刻映射到同一个键、被合并为一次按键的音（合并多轨齐唱时常见），不算丢音。
 * folded：played 中被按八度折回的音数。
 */
export interface AdaptReport {
  total: number;
  played: number;
  folded: number;
  merged: number;
  dropped: DropCounts;
}
