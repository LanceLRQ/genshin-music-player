import { create } from 'zustand';
import { BUILTIN_INSTRUMENTS, type InstrumentEntry, mergeInstruments } from '@/core/instruments/registry';
import { type InstrumentProfile, validateInstrumentProfile } from '@/core/model/instrument';
import { listCustomInstruments, toAppError } from '@/ipc/commands';
import type { AppError } from '@/ipc/types';
import type { LoadStatus } from './common';

export const DEFAULT_INSTRUMENT_ID = BUILTIN_INSTRUMENTS[0].id;

export interface MergedInstruments {
  entries: InstrumentEntry[];
  warnings: string[];
}

/**
 * 校验 list_custom_instruments 返回的原始 JSON，并与内置乐器合并：
 * 校验失败的文件、与内置或其他自定义乐器 id 冲突的配置都会被跳过，原因写进 warnings（排在后端 warnings 之后）。
 */
export function mergeCustomProfiles(rawProfiles: readonly unknown[], fileWarnings: readonly string[]): MergedInstruments {
  const warnings = [...fileWarnings];
  const valid: InstrumentProfile[] = [];
  rawProfiles.forEach((raw, index) => {
    const result = validateInstrumentProfile(raw);
    if (result.ok) valid.push(result.value);
    else warnings.push(`自定义乐器「${describeRawProfile(raw, index)}」校验失败：${result.errors.join('；')}`);
  });
  const merged = mergeInstruments(valid);
  return { entries: merged.entries, warnings: [...warnings, ...merged.warnings] };
}

function describeRawProfile(raw: unknown, index: number): string {
  if (typeof raw === 'object' && raw !== null && 'id' in raw && typeof raw.id === 'string' && raw.id !== '') return raw.id;
  return `第 ${index + 1} 个文件`;
}

/**
 * 合并后的乐器列表。保存、删除、导入由乐器页的计划（M3d）在本文件中扩展，扩展时保留这里的字段和 load、select 的行为。
 */
export interface InstrumentState {
  /** 内置乐器在前、自定义乐器在后；加载前和加载失败时只有内置乐器 */
  entries: InstrumentEntry[];
  /** 无法读取、校验失败或 id 冲突的自定义乐器文件，每条一句话 */
  warnings: string[];
  status: LoadStatus;
  /** list_custom_instruments 调用本身失败的原因 */
  error: AppError | null;
  /** 乐器页当前选中的乐器 id */
  selectedId: string;
  load: () => Promise<void>;
  /** 不存在的 id 会被忽略 */
  select: (id: string) => void;
}

/** 选中的乐器不在新列表中时回到默认乐器 */
function keepSelection(entries: readonly InstrumentEntry[], selectedId: string): string {
  return entries.some((entry) => entry.profile.id === selectedId) ? selectedId : DEFAULT_INSTRUMENT_ID;
}

export const useInstrumentStore = create<InstrumentState>()((set) => ({
  entries: mergeInstruments([]).entries,
  warnings: [],
  status: 'idle',
  error: null,
  selectedId: DEFAULT_INSTRUMENT_ID,
  load: async () => {
    set({ status: 'loading', error: null });
    let next: Pick<InstrumentState, 'entries' | 'warnings' | 'status' | 'error'>;
    try {
      const { profiles, warnings } = await listCustomInstruments();
      next = { ...mergeCustomProfiles(profiles, warnings), status: 'ready', error: null };
    } catch (error) {
      next = { entries: mergeInstruments([]).entries, warnings: [], status: 'error', error: toAppError(error) };
    }
    set((state) => ({ ...next, selectedId: keepSelection(next.entries, state.selectedId) }));
  },
  select: (id) =>
    set((state) => (state.entries.some((entry) => entry.profile.id === id) ? { selectedId: id } : {})),
}));
