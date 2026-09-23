import { create } from 'zustand';
import { THEME_MODES, type ThemeMode } from '@/lib/theme';

/** 主题模式保存在 localStorage 的键名 */
export const THEME_MODE_STORAGE_KEY = 'themeMode';

function isThemeMode(value: string | null): value is ThemeMode {
  return value !== null && (THEME_MODES as readonly string[]).includes(value);
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
  /** 循环切换：跟随系统 → 浅色 → 深色 → 跟随系统（循环顺序即 THEME_MODES 数组顺序） */
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
    const next = THEME_MODES[(THEME_MODES.indexOf(current) + 1) % THEME_MODES.length];
    get().setMode(next);
  },
}));
