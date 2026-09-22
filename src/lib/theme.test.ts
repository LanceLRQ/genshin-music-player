import { describe, expect, it } from 'vitest';
import { applyTheme } from './theme';

/** 可以手动切换 matches 并触发 change 事件的 matchMedia */
function fakeView(initiallyDark: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: initiallyDark,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  const view = { matchMedia: () => query } as unknown as Window;
  const setDark = (dark: boolean) => {
    query.matches = dark;
    for (const listener of listeners) listener();
  };
  return { view, setDark, listeners };
}

describe('applyTheme', () => {
  describe('system 模式', () => {
    it('按系统主题设置 dark class，并跟随系统变化', () => {
      const root = document.createElement('html');
      const { view, setDark } = fakeView(true);
      applyTheme('system', root, view);
      expect(root.classList.contains('dark')).toBe(true);
      setDark(false);
      expect(root.classList.contains('dark')).toBe(false);
    });

    it('取消监听后不再跟随变化', () => {
      const root = document.createElement('html');
      const { view, setDark, listeners } = fakeView(false);
      const stop = applyTheme('system', root, view);
      stop();
      expect(listeners.size).toBe(0);
      setDark(true);
      expect(root.classList.contains('dark')).toBe(false);
    });

    it('不支持 matchMedia 时视为浅色且不报错', () => {
      const root = document.createElement('html');
      expect(() => applyTheme('system', root, {} as Window)()).not.toThrow();
      expect(root.classList.contains('dark')).toBe(false);
    });
  });

  describe('light / dark 模式', () => {
    it('light 模式直接移除 dark class，不监听系统变化', () => {
      const root = document.createElement('html');
      root.classList.add('dark');
      const { view, setDark, listeners } = fakeView(true);
      const stop = applyTheme('light', root, view);
      expect(root.classList.contains('dark')).toBe(false);
      expect(listeners.size).toBe(0);
      setDark(false);
      expect(root.classList.contains('dark')).toBe(false);
      expect(() => stop()).not.toThrow();
    });

    it('dark 模式直接设置 dark class，不监听系统变化', () => {
      const root = document.createElement('html');
      const { view, listeners } = fakeView(false);
      applyTheme('dark', root, view);
      expect(root.classList.contains('dark')).toBe(true);
      expect(listeners.size).toBe(0);
    });
  });
});
