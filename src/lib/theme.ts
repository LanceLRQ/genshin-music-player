const DARK_QUERY = '(prefers-color-scheme: dark)';

/** 主题模式：跟随系统、固定浅色、固定深色 */
export const THEME_MODES = ['system', 'light', 'dark'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

/**
 * 按主题模式设置根元素上的 dark class。
 * system 模式跟随 prefers-color-scheme，并在系统主题变化时同步，返回取消监听的函数；
 * light / dark 模式直接设置或移除 dark class，不监听系统变化，返回空函数。
 * 环境不支持 matchMedia 时，system 视为浅色且不报错。
 */
export function applyTheme(
  mode: ThemeMode,
  root: HTMLElement = document.documentElement,
  view: Window = window,
): () => void {
  if (mode !== 'system') {
    root.classList.toggle('dark', mode === 'dark');
    return () => undefined;
  }
  if (typeof view.matchMedia !== 'function') {
    root.classList.remove('dark');
    return () => undefined;
  }
  const query = view.matchMedia(DARK_QUERY);
  const apply = () => {
    root.classList.toggle('dark', query.matches);
  };
  apply();
  query.addEventListener('change', apply);
  return () => query.removeEventListener('change', apply);
}
