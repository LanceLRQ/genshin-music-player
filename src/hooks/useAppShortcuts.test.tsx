import { act } from 'react';
import { fireEvent, render, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type EnvInfo, type Platform } from '@/ipc/types';
import { useEnvStore } from '@/stores/envStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { type AppShortcutHandlers, useAppShortcuts } from './useAppShortcuts';

function setPlatform(platform: Platform) {
  const env: EnvInfo = {
    platform,
    backend: platform === 'windows' ? 'windows' : 'mock',
    elevated: platform === 'windows' ? true : null,
    appVersion: '0.1.0',
    dataDir: '/data',
    logsDir: '/data/logs',
    startupWarnings: [],
  };
  useEnvStore.setState({ env, status: 'ready' });
}

function handlers(): Required<AppShortcutHandlers> {
  return { openFile: vi.fn(), previewToggle: vi.fn(), previewStop: vi.fn() };
}

/** fireEvent 的返回值为 false 表示事件被 preventDefault */
const press = (target: Element | Window, code: string, init: KeyboardEventInit = {}) =>
  !fireEvent.keyDown(target, { code, bubbles: true, cancelable: true, ...init });

beforeEach(() => {
  useEnvStore.setState(useEnvStore.getInitialState(), true);
  useSettingsStore.setState(useSettingsStore.getInitialState(), true);
  setPlatform('windows');
});

describe('useAppShortcuts', () => {
  it('默认快捷键：Space 开始或停止试听、Escape 停止试听，并阻止默认行为', () => {
    const h = handlers();
    renderHook(() => useAppShortcuts(h));
    expect(press(window, 'Space')).toBe(true);
    expect(press(window, 'Escape')).toBe(true);
    expect(h.previewToggle).toHaveBeenCalledTimes(1);
    expect(h.previewStop).toHaveBeenCalledTimes(1);
    expect(h.openFile).not.toHaveBeenCalled();
  });

  it('CmdOrCtrl+O 在 Windows 上按 Ctrl，在 macOS 上按 Cmd', () => {
    const h = handlers();
    renderHook(() => useAppShortcuts(h));
    press(window, 'KeyO', { metaKey: true });
    expect(h.openFile).not.toHaveBeenCalled();
    press(window, 'KeyO', { ctrlKey: true });
    expect(h.openFile).toHaveBeenCalledTimes(1);

    act(() => setPlatform('macos'));
    press(window, 'KeyO', { ctrlKey: true });
    press(window, 'KeyO', { metaKey: true });
    expect(h.openFile).toHaveBeenCalledTimes(2);
  });

  it('使用设置中修改后的快捷键', () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, shortcuts: { openFile: 'Alt+Shift+I', previewToggle: 'Enter', previewStop: 'F2' } },
    });
    const h = handlers();
    renderHook(() => useAppShortcuts(h));
    press(window, 'Space');
    press(window, 'Enter');
    press(window, 'F2');
    press(window, 'KeyI', { altKey: true, shiftKey: true });
    expect(h.previewToggle).toHaveBeenCalledTimes(1);
    expect(h.previewStop).toHaveBeenCalledTimes(1);
    expect(h.openFile).toHaveBeenCalledTimes(1);
  });

  it('焦点在输入框中时忽略不带修饰键的快捷键，带修饰键的仍然生效', () => {
    const h = handlers();
    const { getByRole } = render(<input aria-label="标题" />);
    renderHook(() => useAppShortcuts(h));
    const input = getByRole('textbox');
    expect(press(input, 'Space')).toBe(false);
    press(input, 'KeyO', { ctrlKey: true });
    expect(h.previewToggle).not.toHaveBeenCalled();
    expect(h.openFile).toHaveBeenCalledTimes(1);
  });

  it('焦点在按钮上时 Space 交给按钮自己处理，Escape 照常生效', () => {
    const h = handlers();
    const { getByRole } = render(<button type="button">试听</button>);
    renderHook(() => useAppShortcuts(h));
    press(getByRole('button'), 'Space');
    press(getByRole('button'), 'Escape');
    expect(h.previewToggle).not.toHaveBeenCalled();
    expect(h.previewStop).toHaveBeenCalledTimes(1);
  });

  it('有打开的对话框时不响应任何快捷键', () => {
    const h = handlers();
    render(<div role="dialog" data-state="open" />);
    renderHook(() => useAppShortcuts(h));
    press(window, 'Escape');
    press(window, 'KeyO', { ctrlKey: true });
    expect(h.previewStop).not.toHaveBeenCalled();
    expect(h.openFile).not.toHaveBeenCalled();
  });

  it('没有处理函数、事件已被其他控件处理或按住重复时，不拦截也不调用', () => {
    const h = handlers();
    renderHook(() => useAppShortcuts({ previewToggle: h.previewToggle }));
    expect(press(window, 'Escape')).toBe(false);
    press(window, 'Space', { repeat: true });
    const event = new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true });
    event.preventDefault();
    window.dispatchEvent(event);
    expect(h.previewToggle).not.toHaveBeenCalled();
  });

  it('重新渲染后使用最新的处理函数，卸载后不再响应', () => {
    const first = handlers();
    const second = handlers();
    const { rerender, unmount } = renderHook(({ current }) => useAppShortcuts(current), {
      initialProps: { current: first },
    });
    rerender({ current: second });
    press(window, 'Space');
    expect(first.previewToggle).not.toHaveBeenCalled();
    expect(second.previewToggle).toHaveBeenCalledTimes(1);
    unmount();
    press(window, 'Space');
    expect(second.previewToggle).toHaveBeenCalledTimes(1);
  });
});
