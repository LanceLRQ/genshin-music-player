import { create } from 'zustand';
import { getEnv, toAppError } from '@/ipc/commands';
import type { AppError, EnvInfo } from '@/ipc/types';
import type { LoadStatus } from './common';

export interface EnvState {
  env: EnvInfo | null;
  status: LoadStatus;
  /** 读取失败的原因；不在 Tauri 窗口中运行时为 IPC_UNAVAILABLE */
  error: AppError | null;
  /** 启动警告横幅是否已被关闭 */
  warningsDismissed: boolean;
  load: () => Promise<void>;
  dismissWarnings: () => void;
}

export const useEnvStore = create<EnvState>()((set) => ({
  env: null,
  status: 'idle',
  error: null,
  warningsDismissed: false,
  load: async () => {
    set({ status: 'loading', error: null });
    try {
      const env = await getEnv();
      set({ env, status: 'ready' });
    } catch (error) {
      set({ status: 'error', error: toAppError(error) });
    }
  },
  dismissWarnings: () => set({ warningsDismissed: true }),
}));
