import type { Platform, Settings } from '@/ipc/types';

/**
 * 快捷键字符串格式：`[修饰键+]*主键`，与 docs/_internal/design/02-执行核心与IPC接口设计.md 第 11.4 节一致，
 * Rust 端 settings.rs 的 validate_shortcut 实现同样的规则。
 */

export type ShortcutScope = 'global' | 'window';

export type ShortcutField =
  | 'hotkeys.toggle'
  | 'hotkeys.stop'
  | 'shortcuts.openFile'
  | 'shortcuts.previewToggle'
  | 'shortcuts.previewStop';

export interface ShortcutFieldInfo {
  field: ShortcutField;
  scope: ShortcutScope;
  label: string;
}

export const SHORTCUT_FIELDS: readonly ShortcutFieldInfo[] = [
  { field: 'hotkeys.toggle', scope: 'global', label: '开始 / 暂停 / 继续' },
  { field: 'hotkeys.stop', scope: 'global', label: '停止' },
  { field: 'shortcuts.openFile', scope: 'window', label: '打开文件' },
  { field: 'shortcuts.previewToggle', scope: 'window', label: '开始 / 停止试听' },
  { field: 'shortcuts.previewStop', scope: 'window', label: '停止试听' },
];

/** 修饰键只能按这个顺序书写 */
export const SHORTCUT_MODIFIERS = ['CmdOrCtrl', 'Ctrl', 'Alt', 'Shift'] as const;

const FUNCTION_KEYS = Array.from({ length: 12 }, (_, index) => `F${index + 1}`);
const STANDALONE_KEYS = ['Space', 'Escape', 'Enter'];
const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'OSLeft',
  'OSRight',
]);

export type ShortcutValidation = { ok: true } | { ok: false; reason: string };

export type ShortcutKeyEvent = Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

/**
 * 键盘事件 → 快捷键字符串。只按下修饰键时返回 null（录入时继续等待）。
 * CmdOrCtrl 在 macOS 上对应 Cmd（metaKey），在其他平台上对应 Ctrl；macOS 上单独的 Ctrl 记为 Ctrl，
 * 其他平台上的 Win 键记为 Meta（不是合法的修饰键，校验时会给出原因）。
 * 不支持的主键原样使用 event.code，同样交给 validateShortcut 报错。
 */
export function shortcutFromEvent(event: ShortcutKeyEvent, platform: Platform): string | null {
  if (MODIFIER_CODES.has(event.code)) return null;
  const mac = platform === 'macos';
  const parts: string[] = [];
  if (mac ? event.metaKey : event.ctrlKey) parts.push('CmdOrCtrl');
  if (mac && event.ctrlKey) parts.push('Ctrl');
  if (!mac && event.metaKey) parts.push('Meta');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  parts.push(mainKeyFromCode(event.code));
  return parts.join('+');
}

function mainKeyFromCode(code: string): string {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1];
  return code;
}

const fail = (reason: string): ShortcutValidation => ({ ok: false, reason });

/**
 * 校验规则：
 * - 修饰键只能是 CmdOrCtrl、Ctrl、Alt、Shift，按这个顺序书写、不能重复，CmdOrCtrl 和 Ctrl 不能同时使用；
 * - 主键只能是 A–Z、0–9、F1–F12、Space、Escape、Enter；
 * - 全局热键：F1–F12 可以不带修饰键，字母和数字必须带修饰键，不能使用 Space、Escape、Enter；
 * - 窗口内快捷键：在全局规则之外，还允许不带修饰键的 Space、Escape、Enter（这三个键不能搭配修饰键）。
 */
export function validateShortcut(value: string, scope: ShortcutScope): ShortcutValidation {
  if (value === '') return fail('快捷键不能为空');
  const parts = value.split('+');
  if (parts.some((part) => part === '')) return fail(`快捷键格式错误「${value}」`);
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);

  let previous = -1;
  for (const modifier of modifiers) {
    const index = (SHORTCUT_MODIFIERS as readonly string[]).indexOf(modifier);
    if (index === -1) return fail(`不支持的修饰键「${modifier}」`);
    if (index === previous) return fail(`修饰键「${modifier}」重复`);
    if (index < previous) return fail('修饰键顺序应为 CmdOrCtrl、Ctrl、Alt、Shift');
    previous = index;
  }
  if (modifiers.includes('CmdOrCtrl') && modifiers.includes('Ctrl')) return fail('CmdOrCtrl 和 Ctrl 不能同时使用');

  const isLetterOrDigit = /^[A-Z0-9]$/.test(key);
  const isStandalone = STANDALONE_KEYS.includes(key);
  if (!isLetterOrDigit && !isStandalone && !FUNCTION_KEYS.includes(key)) {
    return fail(`不支持的按键「${key}」，只能使用 A–Z、0–9、F1–F12、Space、Escape、Enter`);
  }
  if (isStandalone && scope === 'global') return fail(`全局热键不能使用 ${key}`);
  if (isStandalone && modifiers.length > 0) return fail(`${key} 不能搭配修饰键`);
  if (isLetterOrDigit && modifiers.length === 0) return fail('字母和数字键必须搭配修饰键');
  return { ok: true };
}

type ShortcutSettings = Pick<Settings, 'hotkeys' | 'shortcuts'>;

const SHORTCUT_GETTERS: Record<ShortcutField, (settings: ShortcutSettings) => string> = {
  'hotkeys.toggle': (settings) => settings.hotkeys.toggle,
  'hotkeys.stop': (settings) => settings.hotkeys.stop,
  'shortcuts.openFile': (settings) => settings.shortcuts.openFile,
  'shortcuts.previewToggle': (settings) => settings.shortcuts.previewToggle,
  'shortcuts.previewStop': (settings) => settings.shortcuts.previewStop,
};

export function getShortcut(settings: ShortcutSettings, field: ShortcutField): string {
  return SHORTCUT_GETTERS[field](settings);
}

export interface ShortcutConflict {
  fields: [ShortcutField, ShortcutField];
  value: string;
}

/**
 * 5 个快捷键两两不能相同。合法的快捷键字符串修饰键顺序固定，已经是规范化的形式，所以直接比较字符串；
 * 空字符串交给 validateShortcut 报错，不算冲突。
 */
export function findShortcutConflicts(settings: ShortcutSettings): ShortcutConflict[] {
  const conflicts: ShortcutConflict[] = [];
  SHORTCUT_FIELDS.forEach((first, index) => {
    const value = getShortcut(settings, first.field);
    if (value === '') return;
    for (const second of SHORTCUT_FIELDS.slice(index + 1)) {
      if (getShortcut(settings, second.field) === value) conflicts.push({ fields: [first.field, second.field], value });
    }
  });
  return conflicts;
}

export function matchesShortcut(event: ShortcutKeyEvent, value: string, platform: Platform): boolean {
  return shortcutFromEvent(event, platform) === value;
}

export function hasModifier(value: string): boolean {
  return value.includes('+');
}

/** 界面显示用：CmdOrCtrl 在 macOS 上显示为 Cmd，其他平台显示为 Ctrl */
export function displayShortcut(value: string, platform: Platform): string {
  return value
    .split('+')
    .map((part) => (part === 'CmdOrCtrl' ? (platform === 'macos' ? 'Cmd' : 'Ctrl') : part))
    .join('+');
}

/** 环境信息还没加载时，根据 userAgent 猜测平台 */
export function guessPlatform(userAgent: string): Platform {
  if (/Mac/i.test(userAgent)) return 'macos';
  if (/Linux|X11/i.test(userAgent) && !/Android/i.test(userAgent)) return 'linux';
  return 'windows';
}

const TEXT_ENTRY_SELECTOR = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const KEY_ACTIVATED_SELECTOR = [
  'button',
  'a[href]',
  'summary',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="radio"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="slider"]',
  '[role="combobox"]',
].join(', ');

/**
 * 不带修饰键的快捷键是否应该让给当前焦点所在的控件：
 * 焦点在输入框、文本域、下拉框或可编辑区域时一律让出；焦点在按钮、复选框这类用 Space / Enter 触发的控件上时，
 * Space 和 Enter 让给控件自己处理。
 */
export function isShortcutBlockedByFocus(value: string, target: EventTarget | null): boolean {
  if (hasModifier(value) || !(target instanceof Element)) return false;
  if (target.closest(TEXT_ENTRY_SELECTOR)) return true;
  return (value === 'Space' || value === 'Enter') && target.closest(KEY_ACTIVATED_SELECTOR) !== null;
}

/** 是否有打开的模态对话框（Radix 的 Dialog、AlertDialog、Sheet） */
export function hasOpenDialog(root: ParentNode): boolean {
  return root.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]') !== null;
}
