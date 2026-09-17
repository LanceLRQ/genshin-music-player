import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// 本项目不开启 vitest 的 globals，Testing Library 无法自动注册清理，这里手动在每个测试后卸载渲染结果
afterEach(() => {
  cleanup();
});

// 允许在测试里直接使用 react 的 act(...)，否则会打印 act 环境未配置的警告
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 以下是 jsdom 没有实现、但 shadcn / Radix 组件会用到的浏览器接口：
// matchMedia（侧边栏判断窄屏、主题跟随系统）、ResizeObserver（Slider、ScrollArea 测量尺寸）、
// scrollIntoView 与 Pointer Capture（Select 下拉列表）
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  });
}

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe = () => undefined;
    unobserve = () => undefined;
    disconnect = () => undefined;
  };
}

Element.prototype.scrollIntoView ??= () => undefined;
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => undefined;
Element.prototype.releasePointerCapture ??= () => undefined;
