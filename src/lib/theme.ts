const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * 跟随系统的浅色 / 深色主题：根据 prefers-color-scheme 切换根元素上的 dark class，并在系统主题变化时同步。
 * 返回取消监听的函数；环境不支持 matchMedia 时什么也不做。
 */
export function watchSystemTheme(root: HTMLElement = document.documentElement, view: Window = window): () => void {
  if (typeof view.matchMedia !== 'function') return () => undefined;
  const query = view.matchMedia(DARK_QUERY);
  const apply = () => {
    root.classList.toggle('dark', query.matches);
  };
  apply();
  query.addEventListener('change', apply);
  return () => query.removeEventListener('change', apply);
}
