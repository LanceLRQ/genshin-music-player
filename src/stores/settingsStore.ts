import { create } from 'zustand';
import { getSettings, saveSettings, toAppError } from '@/ipc/commands';
import { notifyError } from '@/lib/notify';
import type { AppError, Settings } from '@/ipc/types';
import type { LoadStatus } from './common';

/**
 * 已保存的设置与设置页的编辑草稿。草稿为 null 表示没有未保存的修改；
 * 页面修改控件时以 draft ?? settings 为基值调用 setDraft，保存 / 撤销由设置页的显式按钮触发。
 */
export interface SettingsState {
  /** 后端返回的已保存设置；加载成功前为 null */
  settings: Settings | null;
  status: LoadStatus;
  error: AppError | null;
  /** 编辑中的草稿；null 表示没有未保存的修改 */
  draft: Settings | null;
  /** saveDraft 请求进行中 */
  saving: boolean;
  load: () => Promise<void>;
  setDraft: (draft: Settings) => void;
  /** 保存草稿；成功后以后端实际保存的设置为准并清空草稿，返回是否成功 */
  saveDraft: () => Promise<boolean>;
  resetDraft: () => void;
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  settings: null,
  status: 'idle',
  error: null,
  draft: null,
  saving: false,
  load: async () => {
    set({ status: 'loading', error: null });
    try {
      const settings = await getSettings();
      set({ settings, status: 'ready' });
    } catch (error) {
      const appError = toAppError(error);
      // 浏览器中打开时静默：顶部横幅已经提示无法连接后端
      if (appError.code !== 'IPC_UNAVAILABLE') notifyError(appError, '读取设置失败');
      set({ status: 'error', error: appError });
    }
  },
  setDraft: (draft) => set({ draft }),
  saveDraft: async () => {
    const { draft } = get();
    if (!draft) return false;
    set({ saving: true });
    try {
      const saved = await saveSettings(draft);
      set({ settings: saved, draft: null, saving: false });
      return true;
    } catch (error) {
      set({ saving: false });
      notifyError(error, '保存设置失败');
      return false;
    }
  },
  resetDraft: () => set({ draft: null }),
}));
