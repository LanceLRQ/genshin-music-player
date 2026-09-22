import { create } from 'zustand';
import type { ThemeMode } from '@/lib/theme';

/** 主题模式保存在 localStorage 的键名 */
export const THEME_MODE_STORAGE_KEY = 'themeMode';

const MODE_CYCLE: ThemeMode[] = ['system', 'light', 'dark'];

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

function readMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_MODE_STORAGE_KEY);
    return isThemeMode(raw) ? raw : 'system';
  } catch {
    return 'system';
  }
}

export interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  /** 循环切换：跟随系统 → 浅色 → 深色 → 跟随系统 */
  cycleMode: () => void;
}

export const useThemeStore = create<ThemeState>()((set, get) => ({
  mode: readMode(),
  setMode: (mode) => {
    try {
      localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
    } catch {
      // 本地存储不可用时只在本次运行中生效
    }
    set({ mode });
  },
  cycleMode: () => {
    const current = get().mode;
    const next = MODE_CYCLE[(MODE_CYCLE.indexOf(current) + 1) % MODE_CYCLE.length];
    get().setMode(next);
  },
}));
