import { beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_MODE_STORAGE_KEY, useThemeStore } from './themeStore';

beforeEach(() => {
  localStorage.clear();
  useThemeStore.setState(useThemeStore.getInitialState(), true);
});

describe('themeStore', () => {
  it('默认跟随系统', () => {
    expect(useThemeStore.getState().mode).toBe('system');
  });

  it('setMode 更新状态并持久化到 localStorage', () => {
    useThemeStore.getState().setMode('dark');
    expect(useThemeStore.getState().mode).toBe('dark');
    expect(localStorage.getItem(THEME_MODE_STORAGE_KEY)).toBe('dark');
  });

  it('cycleMode 按 system → light → dark → system 循环', () => {
    expect(useThemeStore.getState().mode).toBe('system');
    useThemeStore.getState().cycleMode();
    expect(useThemeStore.getState().mode).toBe('light');
    useThemeStore.getState().cycleMode();
    expect(useThemeStore.getState().mode).toBe('dark');
    useThemeStore.getState().cycleMode();
    expect(useThemeStore.getState().mode).toBe('system');
  });

  it('启动时读取已保存的模式', async () => {
    localStorage.setItem(THEME_MODE_STORAGE_KEY, 'dark');
    vi.resetModules();
    const { useThemeStore: freshStore } = await import('./themeStore');
    expect(freshStore.getState().mode).toBe('dark');
  });

  it('读取到非法值时回退到 system', async () => {
    localStorage.setItem(THEME_MODE_STORAGE_KEY, 'purple');
    vi.resetModules();
    const { useThemeStore: freshStore } = await import('./themeStore');
    expect(freshStore.getState().mode).toBe('system');
  });

  it('localStorage 不可用时 setMode 不抛错，只在本次运行中生效', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('存储不可用');
    };
    try {
      expect(() => useThemeStore.getState().setMode('light')).not.toThrow();
      expect(useThemeStore.getState().mode).toBe('light');
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});
