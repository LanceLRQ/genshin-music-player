import keycodeTable from '../../../shared/keycodes.json';

export interface KeyCodeInfo {
  code: string;
  label: string;
  scan: number;
  extended: boolean;
}

export const KEY_CODES: readonly KeyCodeInfo[] = keycodeTable.keys;

const byCode = new Map(KEY_CODES.map((info) => [info.code, info]));

export function isKnownKeyCode(code: string): boolean {
  return byCode.has(code);
}

export function keyLabel(code: string): string {
  return byCode.get(code)?.label ?? code;
}

/** 键盘谱中的单个字母或数字 → 物理键码；其余字符都是语法符号，返回 undefined */
export function codeFromChar(ch: string): string | undefined {
  if (/^[A-Za-z]$/.test(ch)) return `Key${ch.toUpperCase()}`;
  if (/^[0-9]$/.test(ch)) return `Digit${ch}`;
  return undefined;
}
