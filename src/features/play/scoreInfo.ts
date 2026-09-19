import type { Score, ScoreSource, Track } from '@/core/model/score';
import type { DropCounts } from '@/core/model/timeline';

/** 音轨的展示信息：音符数、音域、首音时间 */
export interface TrackStats {
  count: number;
  minPitch: number;
  maxPitch: number;
  hasPitch: boolean;
  firstMs: number;
}

/** 没有音符的音轨返回 null；音域只统计有音高的音（敲击音符的 voice 没有 pitch） */
export function trackStats(track: Track): TrackStats | null {
  const notes = track.notes;
  if (notes.length === 0) return null;
  let minPitch = 127;
  let maxPitch = 0;
  for (const note of notes) {
    if (note.pitch === undefined) continue;
    minPitch = Math.min(minPitch, note.pitch);
    maxPitch = Math.max(maxPitch, note.pitch);
  }
  return { count: notes.length, minPitch, maxPitch, hasPitch: maxPitch >= minPitch, firstMs: notes[0].startMs };
}

/** 乐谱总时长：所有音符结束时间的最大值；空乐谱为 0 */
export function scoreDurationMs(score: Score): number {
  return score.tracks.reduce(
    (max, track) => track.notes.reduce((trackMax, note) => Math.max(trackMax, note.startMs + note.durationMs), max),
    0,
  );
}

/** m:ss（乐谱头部、音轨首音时间用） */
export function formatTimeShort(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

const SOURCE_LABELS: Record<ScoreSource, string> = {
  midi: 'MIDI',
  keyscore: '键盘谱',
  jianpu: '简谱',
  json: 'JSON 谱',
};

export function sourceLabel(source: ScoreSource): string {
  return SOURCE_LABELS[source];
}

/** 敲击音色的显示名（设计 01 第 4.7 节）：don 显示"咚"、ka 显示"咔"，含带序号变体，其他原样 */
export { voiceLabel } from '@/core/model/instrument';

export type TextFormat = 'keyscore' | 'jianpu';

/** 文本乐谱的格式猜测（设计 01 第 4.2 节）：去掉注释、指令和语法符号后，数字 0–7 占一半以上猜为简谱 */
export function guessTextFormat(text: string): TextFormat {
  const cleaned = text
    .replace(/@[\w]+=[^\s]+/g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/[\s|\-()[\]{}.:#b',_]/g, '');
  if (cleaned.length === 0) return 'keyscore';
  let digits = 0;
  for (const ch of cleaned) if (ch >= '0' && ch <= '7') digits += 1;
  return digits >= cleaned.length / 2 ? 'jianpu' : 'keyscore';
}

/** "1:23.4" 或 "90"（按秒）→ 毫秒，四舍五入并夹到 [0, maxMs]；无法解析时返回 null */
export function parseTimeInput(text: string, maxMs: number): number | null {
  const trimmed = text.trim();
  const match = /^(\d+):([0-5]?\d(?:\.\d+)?)$/.exec(trimmed);
  const asSeconds = /^\d+(\.\d+)?$/.exec(trimmed);
  if (!match && !asSeconds) return null;
  const seconds = match ? Number(match[1]) * 60 + Number(match[2]) : Number(trimmed);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(Math.round(seconds * 1000), maxMs);
}

/** 命中率的文字颜色，≥ 95% 绿色、≥ 80% 琥珀色、其余红色（设计 01 第 4.4 节） */
export function rateTextClass(rate: number): string {
  if (rate >= 0.95) return 'text-emerald-600 dark:text-emerald-500';
  if (rate >= 0.8) return 'text-amber-600 dark:text-amber-500';
  return 'text-red-600 dark:text-red-500';
}

/** 命中率进度条的填充颜色，规则同 rateTextClass */
export function rateBgClass(rate: number): string {
  if (rate >= 0.95) return 'bg-emerald-500';
  if (rate >= 0.8) return 'bg-amber-500';
  return 'bg-red-500';
}

/** 适配结果里丢弃明细的说明与建议（设计 01 第 4.6 节的表） */
export interface DroppedItemInfo {
  key: keyof DropCounts;
  label: string;
  tooltip: string;
}

export const DROPPED_ITEMS: readonly DroppedItemInfo[] = [
  {
    key: 'blackKey',
    label: '黑键',
    tooltip: '乐器上没有这个音。试试「恢复自动推荐」、调整移调，或改为「就近取音」。',
  },
  { key: 'outOfRange', label: '超音域', tooltip: '超出乐器音域。调整八度，或改为「按八度折回」。' },
  { key: 'polyphony', label: '复音超限', tooltip: '同一时刻的音超过复音上限。在「高级」中调高复音上限。' },
  {
    key: 'tooDense',
    label: '过密',
    tooltip: '同一个键连续按下的间隔太短。降低速度，或检查乐器配置里的最小重复间隔。',
  },
  {
    key: 'unmappedDrum',
    label: '未映射',
    tooltip: '敲击音色找不到对应的键，或音高类乐器遇到了敲击音符。换用敲击类乐器，或编辑乐器配置里的鼓映射表。',
  },
];
