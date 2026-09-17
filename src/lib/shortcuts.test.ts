import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '@/ipc/types';
import {
  type ShortcutKeyEvent,
  displayShortcut,
  findShortcutConflicts,
  guessPlatform,
  hasOpenDialog,
  isShortcutBlockedByFocus,
  matchesShortcut,
  shortcutFromEvent,
  validateShortcut,
} from './shortcuts';

const key = (code: string, modifiers: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent => ({
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...modifiers,
});

describe('shortcutFromEvent', () => {
  it('字母、数字取键帽文字，功能键和 Space、Escape、Enter 原样使用', () => {
    expect(shortcutFromEvent(key('KeyQ', { ctrlKey: true }), 'windows')).toBe('CmdOrCtrl+Q');
    expect(shortcutFromEvent(key('Digit1', { altKey: true }), 'windows')).toBe('Alt+1');
    expect(shortcutFromEvent(key('F9'), 'windows')).toBe('F9');
    expect(shortcutFromEvent(key('Space'), 'windows')).toBe('Space');
  });

  it('CmdOrCtrl 在 macOS 上对应 Cmd，在其他平台上对应 Ctrl', () => {
    expect(shortcutFromEvent(key('KeyO', { metaKey: true }), 'macos')).toBe('CmdOrCtrl+O');
    expect(shortcutFromEvent(key('KeyO', { ctrlKey: true }), 'macos')).toBe('Ctrl+O');
    expect(shortcutFromEvent(key('KeyO', { ctrlKey: true }), 'linux')).toBe('CmdOrCtrl+O');
    expect(shortcutFromEvent(key('KeyO', { metaKey: true }), 'windows')).toBe('Meta+O');
  });

  it('修饰键按 CmdOrCtrl、Ctrl、Alt、Shift 的顺序拼接', () => {
    const all = key('KeyK', { metaKey: true, ctrlKey: true, altKey: true, shiftKey: true });
    expect(shortcutFromEvent(all, 'macos')).toBe('CmdOrCtrl+Ctrl+Alt+Shift+K');
  });

  it('只按下修饰键时返回 null，不支持的按键原样返回 event.code', () => {
    expect(shortcutFromEvent(key('ShiftLeft', { shiftKey: true }), 'windows')).toBeNull();
    expect(shortcutFromEvent(key('MetaRight', { metaKey: true }), 'macos')).toBeNull();
    expect(shortcutFromEvent(key('Minus', { ctrlKey: true }), 'windows')).toBe('CmdOrCtrl+Minus');
  });
});

describe('validateShortcut', () => {
  it.each([
    ['F9', 'global'],
    ['F12', 'global'],
    ['CmdOrCtrl+O', 'global'],
    ['Alt+Shift+1', 'global'],
    ['CmdOrCtrl+Alt+Shift+F5', 'global'],
    ['Ctrl+Z', 'window'],
    ['Space', 'window'],
    ['Escape', 'window'],
    ['Enter', 'window'],
    ['Shift+F1', 'window'],
  ] as const)('「%s」在 %s 范围内合法', (value, scope) => {
    expect(validateShortcut(value, scope)).toEqual({ ok: true });
  });

  it.each([
    ['', 'global', '快捷键不能为空'],
    ['Ctrl++O', 'global', '快捷键格式错误「Ctrl++O」'],
    ['Meta+O', 'global', '不支持的修饰键「Meta」'],
    ['Alt+Alt+O', 'global', '修饰键「Alt」重复'],
    ['Shift+Alt+O', 'global', '修饰键顺序应为 CmdOrCtrl、Ctrl、Alt、Shift'],
    ['CmdOrCtrl+Ctrl+O', 'window', 'CmdOrCtrl 和 Ctrl 不能同时使用'],
    ['CmdOrCtrl+Tab', 'window', '不支持的按键「Tab」，只能使用 A–Z、0–9、F1–F12、Space、Escape、Enter'],
    ['F13', 'global', '不支持的按键「F13」，只能使用 A–Z、0–9、F1–F12、Space、Escape、Enter'],
    ['o', 'window', '不支持的按键「o」，只能使用 A–Z、0–9、F1–F12、Space、Escape、Enter'],
    ['Space', 'global', '全局热键不能使用 Space'],
    ['Alt+Enter', 'global', '全局热键不能使用 Enter'],
    ['Shift+Space', 'window', 'Space 不能搭配修饰键'],
    ['Q', 'global', '字母和数字键必须搭配修饰键'],
    ['7', 'window', '字母和数字键必须搭配修饰键'],
  ] as const)('「%s」在 %s 范围内不合法', (value, scope, reason) => {
    expect(validateShortcut(value, scope)).toEqual({ ok: false, reason });
  });
});

describe('findShortcutConflicts', () => {
  const withShortcuts = (patch: Partial<Settings['shortcuts']>, hotkeys: Partial<Settings['hotkeys']> = {}) => ({
    hotkeys: { ...DEFAULT_SETTINGS.hotkeys, ...hotkeys },
    shortcuts: { ...DEFAULT_SETTINGS.shortcuts, ...patch },
  });

  it('默认设置没有冲突', () => {
    expect(findShortcutConflicts(DEFAULT_SETTINGS)).toEqual([]);
  });

  it('全局热键与窗口内快捷键相同也算冲突，每一对都列出', () => {
    expect(findShortcutConflicts(withShortcuts({ openFile: 'F9', previewStop: 'F9' }))).toEqual([
      { fields: ['hotkeys.toggle', 'shortcuts.openFile'], value: 'F9' },
      { fields: ['hotkeys.toggle', 'shortcuts.previewStop'], value: 'F9' },
      { fields: ['shortcuts.openFile', 'shortcuts.previewStop'], value: 'F9' },
    ]);
  });

  it('空值不算冲突', () => {
    expect(findShortcutConflicts(withShortcuts({ openFile: '', previewStop: '' }))).toEqual([]);
  });
});

describe('matchesShortcut / displayShortcut / guessPlatform', () => {
  it('matchesShortcut 按平台比较', () => {
    expect(matchesShortcut(key('KeyO', { metaKey: true }), 'CmdOrCtrl+O', 'macos')).toBe(true);
    expect(matchesShortcut(key('KeyO', { metaKey: true }), 'CmdOrCtrl+O', 'windows')).toBe(false);
  });

  it('displayShortcut 把 CmdOrCtrl 显示为 Cmd 或 Ctrl', () => {
    expect(displayShortcut('CmdOrCtrl+Shift+O', 'macos')).toBe('Cmd+Shift+O');
    expect(displayShortcut('CmdOrCtrl+Shift+O', 'windows')).toBe('Ctrl+Shift+O');
    expect(displayShortcut('F9', 'linux')).toBe('F9');
  });

  it('guessPlatform 根据 userAgent 猜测平台', () => {
    expect(guessPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15')).toBe('macos');
    expect(guessPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/140.0')).toBe('windows');
    expect(guessPlatform('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15')).toBe('linux');
  });
});

describe('焦点与对话框', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const mount = (html: string) => {
    document.body.innerHTML = html;
    return document.body.firstElementChild!;
  };

  it('焦点在输入控件中时，不带修饰键的快捷键让给控件，带修饰键的不受影响', () => {
    for (const html of ['<input />', '<textarea></textarea>', '<select></select>', '<div contenteditable="true"><span></span></div>']) {
      const element = mount(html);
      const target = element.firstElementChild ?? element;
      expect(isShortcutBlockedByFocus('Escape', target)).toBe(true);
      expect(isShortcutBlockedByFocus('CmdOrCtrl+O', target)).toBe(false);
    }
  });

  it('焦点在按钮类控件上时，只有 Space 和 Enter 让给控件', () => {
    const button = mount('<button><span>试听</span></button>').firstElementChild;
    expect(isShortcutBlockedByFocus('Space', button)).toBe(true);
    expect(isShortcutBlockedByFocus('Enter', mount('<div role="checkbox"></div>'))).toBe(true);
    expect(isShortcutBlockedByFocus('Escape', mount('<button></button>'))).toBe(false);
    expect(isShortcutBlockedByFocus('Space', mount('<div></div>'))).toBe(false);
    expect(isShortcutBlockedByFocus('Space', window)).toBe(false);
  });

  it('hasOpenDialog 只认打开状态的对话框', () => {
    mount('<div role="dialog" data-state="closed"></div>');
    expect(hasOpenDialog(document)).toBe(false);
    mount('<div role="alertdialog" data-state="open"></div>');
    expect(hasOpenDialog(document)).toBe(true);
  });
});
