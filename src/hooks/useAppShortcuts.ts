import { useEffect, useRef } from 'react';
import { DEFAULT_SETTINGS, type Shortcuts } from '@/ipc/types';
import { guessPlatform, hasOpenDialog, isShortcutBlockedByFocus, shortcutFromEvent } from '@/lib/shortcuts';
import { useEnvStore } from '@/stores/envStore';
import { useSettingsStore } from '@/stores/settingsStore';

/**
 * 窗口内快捷键的处理函数。某个快捷键当前不可用（例如演奏进行中不能打开文件）时，传 undefined，
 * 这个按键就不会被拦截，保留浏览器的默认行为。
 */
export type AppShortcutHandlers = Partial<Record<keyof Shortcuts, () => void>>;

const SHORTCUT_NAMES = Object.keys(DEFAULT_SETTINGS.shortcuts) as (keyof Shortcuts)[];

/**
 * 在窗口上监听 keydown，按 settings.shortcuts 触发处理函数（设置还没加载时使用默认快捷键）。
 * 以下情况不处理：事件已被其他控件处理（defaultPrevented，例如按键捕获按钮）、按住重复、输入法组字中、
 * 有打开的对话框、不带修饰键的快捷键遇到焦点在输入类控件上（见 isShortcutBlockedByFocus）。
 * 全局热键（F9 / F10）由后端注册和处理，这里不监听。
 */
export function useAppShortcuts(handlers: AppShortcutHandlers): void {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  const shortcuts = useSettingsStore((state) => state.settings?.shortcuts ?? DEFAULT_SETTINGS.shortcuts);
  const envPlatform = useEnvStore((state) => state.env?.platform);
  const platform = envPlatform ?? guessPlatform(navigator.userAgent);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;
      const value = shortcutFromEvent(event, platform);
      if (value === null || isShortcutBlockedByFocus(value, event.target) || hasOpenDialog(document)) return;
      const name = SHORTCUT_NAMES.find((candidate) => shortcuts[candidate] === value);
      const handler = name === undefined ? undefined : handlersRef.current[name];
      if (!handler) return;
      event.preventDefault();
      handler();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [shortcuts, platform]);
}
