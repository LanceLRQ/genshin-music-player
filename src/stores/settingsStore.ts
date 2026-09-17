import { create } from 'zustand';
import { getSettings, toAppError } from '@/ipc/commands';
import type { AppError, Settings } from '@/ipc/types';
import type { LoadStatus } from './common';

/**
 * 已保存的设置。编辑草稿与保存由设置页的计划（M3d）在本文件中扩展，扩展时保留这里的字段和 load 的行为。
 */
export interface SettingsState {
  /** 后端返回的已保存设置；加载成功前为 null */
  settings: Settings | null;
  status: LoadStatus;
  error: AppError | null;
  load: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>()((set) => ({
  settings: null,
  status: 'idle',
  error: null,
  load: async () => {
    set({ status: 'loading', error: null });
    try {
      const settings = await getSettings();
      set({ settings, status: 'ready' });
    } catch (error) {
      set({ status: 'error', error: toAppError(error) });
    }
  },
}));
