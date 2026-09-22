import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installOverlayGuard } from './lib/overlayGuard';
import { applyTheme } from './lib/theme';
import { useThemeStore } from './stores/themeStore';

installOverlayGuard();
// 首次渲染前先按已保存的模式设置 dark class，避免启动时闪一下另一种配色；持续监听交给 App 里的 effect
applyTheme(useThemeStore.getState().mode)();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
