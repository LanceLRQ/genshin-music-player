/**
 * Radix 浮层关闭依赖退出动画的 animationend 事件。WKWebView 在窗口遮挡 / 挂起渲染时
 * 会冻结 CSS 动画时间轴（document.timeline 停走），事件永远不会触发——浮层内容挂着
 * 不卸载，body 上残留 pointer-events:none，整个页面点不动（表现为下拉再也拉不开、
 * 弹层关掉后页面僵死）。兜底：body 被禁用且没有任何 open 状态浮层时，给 Portal 里
 * closed 状态的浮层根补发 animationend，让 Radix Presence 立即完成卸载并恢复 body。
 */
const LAYER_SELECTORS = [
  '[data-slot="select-content"]',
  '[data-slot="dialog-content"]',
  '[data-slot="dialog-overlay"]',
  '[data-slot="popover-content"]',
  '[data-slot="dropdown-menu-content"]',
  '[data-slot="dropdown-menu-sub-content"]',
];
const OPEN_LAYERS = LAYER_SELECTORS.map((selector) => `${selector}[data-state="open"]`).join(', ');
const CLOSED_LAYERS = LAYER_SELECTORS.map((selector) => `${selector}[data-state="closed"]`).join(', ');

/** animationend 事件（jsdom 没有 AnimationEvent 构造器，用普通 Event 降级） */
function createAnimationEndEvent(): Event {
  if (typeof AnimationEvent === 'function') {
    return new AnimationEvent('animationend', { bubbles: true, animationName: 'exit' });
  }
  const event = new Event('animationend', { bubbles: true });
  Object.defineProperty(event, 'animationName', { value: 'exit' });
  return event;
}

/** 一次性体检：发现卡死的浮层就补发 animationend；返回是否做了修复（便于测试与调试） */
export function healStuckOverlays(): boolean {
  if (document.body.style.pointerEvents !== 'none') return false;
  // 还有浮层开着（body 被禁用是正常状态）时不干预
  if (document.querySelector(OPEN_LAYERS)) return false;
  let healed = false;
  for (const node of document.querySelectorAll(CLOSED_LAYERS)) {
    // 只处理 Portal（body 直下容器）里的浮层；#root 内的同名元素不属于这类状态机
    if (node.closest('#root')) continue;
    node.dispatchEvent(createAnimationEndEvent());
    healed = true;
  }
  return healed;
}

/** 在应用入口安装：前台恢复事件 + 低频轮询（body 正常时只读一次 style，开销可忽略） */
export function installOverlayGuard(): void {
  const check = () => healStuckOverlays();
  document.addEventListener('visibilitychange', check);
  window.addEventListener('focus', check);
  window.setInterval(check, 1000);
}
