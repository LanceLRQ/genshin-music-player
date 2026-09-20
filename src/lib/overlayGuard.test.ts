import { afterEach, describe, expect, it, vi } from 'vitest';
import { healStuckOverlays, installOverlayGuard } from './overlayGuard';

function setupRoot() {
  const root = document.createElement('div');
  root.id = 'root';
  document.body.appendChild(root);
  return root;
}

function addPortalLayer(slot: string, state: string) {
  const portal = document.createElement('div');
  const layer = document.createElement('div');
  layer.setAttribute('data-slot', slot);
  layer.setAttribute('data-state', state);
  portal.appendChild(layer);
  document.body.appendChild(portal);
  return layer;
}

describe('healStuckOverlays', () => {
  afterEach(() => {
    document.body.removeAttribute('style');
    document.body.innerHTML = '';
  });

  it('body 正常时不做任何事', () => {
    const layer = addPortalLayer('select-content', 'closed');
    const listener = vi.fn();
    layer.addEventListener('animationend', listener);
    expect(healStuckOverlays()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('body 被禁用且无 open 浮层时，给 Portal 里的 closed 浮层补发 animationend', () => {
    const root = setupRoot();
    const inRoot = document.createElement('div');
    inRoot.setAttribute('data-slot', 'select-content');
    inRoot.setAttribute('data-state', 'closed');
    root.appendChild(inRoot);
    const stuck = addPortalLayer('select-content', 'closed');
    const events: string[] = [];
    stuck.addEventListener('animationend', (event) => events.push((event as AnimationEvent).animationName));
    inRoot.addEventListener('animationend', () => events.push('root-layer'));
    document.body.style.pointerEvents = 'none';

    expect(healStuckOverlays()).toBe(true);
    expect(events).toEqual(['exit']);
  });

  it('还有 open 状态的浮层时不干预', () => {
    addPortalLayer('dialog-content', 'open');
    const stuck = addPortalLayer('select-content', 'closed');
    const listener = vi.fn();
    stuck.addEventListener('animationend', listener);
    document.body.style.pointerEvents = 'none';

    expect(healStuckOverlays()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('installOverlayGuard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.removeAttribute('style');
    document.body.innerHTML = '';
  });

  it('轮询周期内自动修复卡死的浮层', () => {
    vi.useFakeTimers();
    installOverlayGuard();
    const stuck = addPortalLayer('select-content', 'closed');
    const listener = vi.fn();
    stuck.addEventListener('animationend', listener);
    document.body.style.pointerEvents = 'none';

    vi.advanceTimersByTime(1100);
    expect(listener).toHaveBeenCalled();
  });
});
