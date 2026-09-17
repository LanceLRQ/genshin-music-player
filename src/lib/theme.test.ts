import { describe, expect, it } from 'vitest';
import { watchSystemTheme } from './theme';

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

describe('watchSystemTheme', () => {
  it('按系统主题设置 dark class，并跟随系统变化', () => {
    const root = document.createElement('html');
    const { view, setDark } = fakeView(true);
    watchSystemTheme(root, view);
    expect(root.classList.contains('dark')).toBe(true);
    setDark(false);
    expect(root.classList.contains('dark')).toBe(false);
  });

  it('取消监听后不再跟随变化', () => {
    const root = document.createElement('html');
    const { view, setDark, listeners } = fakeView(false);
    const stop = watchSystemTheme(root, view);
    stop();
    expect(listeners.size).toBe(0);
    setDark(true);
    expect(root.classList.contains('dark')).toBe(false);
  });

  it('不支持 matchMedia 时什么也不做', () => {
    const root = document.createElement('html');
    expect(() => watchSystemTheme(root, {} as Window)()).not.toThrow();
    expect(root.className).toBe('');
  });
});
