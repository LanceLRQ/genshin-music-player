import type { Note } from '@minagishl/react-piano-roll';
import type { InstrumentKey, InstrumentProfile } from '@/core/model/instrument';
import type { ExecutionTimeline } from '@/ipc/types';

/**
 * 落音视图的列不按真实音高排（风物之诗琴是 C 大调全音阶，半音阶键盘会出现一排永远不亮的黑键列；
 * 敲击类乐器根本没有音高），而是按乐器键序号一列一键。为了复用 NoteCanvas 的半音阶横向定位，
 * 给每列分配一个"合成音高"：从 C4 起依次取白键音高，这样每列等宽、没有黑键空列。
 */
const SYNTHETIC_START_PITCH = 60;
const WHITE_SEMITONES = [0, 2, 4, 5, 7, 9, 11] as const;

/** 按住时长太短的音在画布上几乎不可见，保底一个最小显示时长 */
const MIN_DURATION_SEC = 0.04;

/** 落音视图的列顺序：音高类乐器按音高升序（低音在左、高音在右），敲击类按配置行序 */
export function orderedPreviewKeys(profile: InstrumentProfile): InstrumentKey[] {
  const keys = profile.rows.flatMap((row) => row.keys);
  if (profile.kind === 'pitched') {
    return [...keys].sort((a, b) => (a.pitch ?? 0) - (b.pitch ?? 0));
  }
  return keys;
}

/** 第 index 列的合成音高：从 C4 起的第 index 个白键（0→60, 1→62, 2→64, 3→65, …） */
export function syntheticPitch(index: number): number {
  const offset = WHITE_SEMITONES[index % WHITE_SEMITONES.length];
  return SYNTHETIC_START_PITCH + Math.floor(index / WHITE_SEMITONES.length) * 12 + offset;
}

/**
 * 执行时间线 → 落音音符：down 事件开音、配对的 up 事件关音，一直没关上的收到时间线结尾。
 * 事件里同一时刻先处理 up 再处理 down（与后端、试听一致），所以同帧的重按不会配错对。
 * columnOf 缺失的键码直接跳过，防御执行时间线与乐器配置不一致的极端情况。
 */
export function executionToNotes(execution: ExecutionTimeline, columnOf: ReadonlyMap<string, number>): Note[] {
  const notes: Note[] = [];
  const open = new Map<string, number>();
  const close = (code: string, endMs: number) => {
    const startMs = open.get(code);
    if (startMs === undefined) return;
    open.delete(code);
    const column = columnOf.get(code);
    if (column === undefined) return;
    notes.push({
      pitch: syntheticPitch(column),
      startTime: startMs / 1000,
      duration: Math.max((endMs - startMs) / 1000, MIN_DURATION_SEC),
    });
  };
  for (const { tMs, up, down } of execution.events) {
    for (const code of up) close(code, tMs);
    for (const code of down) {
      if (!open.has(code)) open.set(code, tMs);
    }
  }
  for (const code of [...open.keys()]) close(code, execution.durationMs);
  return notes.sort((a, b) => a.startTime - b.startTime);
}
