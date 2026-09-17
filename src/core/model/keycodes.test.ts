import { describe, expect, it } from 'vitest';
import { KEY_CODES, codeFromChar, isKnownKeyCode, keyLabel } from './keycodes';

describe('keycodes', () => {
  it('键码和扫描码都不重复', () => {
    expect(new Set(KEY_CODES.map((k) => k.code)).size).toBe(KEY_CODES.length);
    expect(new Set(KEY_CODES.map((k) => k.scan)).size).toBe(KEY_CODES.length);
  });

  it('包含 26 个字母键和 10 个数字键', () => {
    for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') expect(isKnownKeyCode(`Key${letter}`)).toBe(true);
    for (const digit of '0123456789') expect(isKnownKeyCode(`Digit${digit}`)).toBe(true);
  });

  it('使用 Set 1 扫描码', () => {
    const scan = (code: string) => KEY_CODES.find((k) => k.code === code)?.scan;
    expect(scan('KeyQ')).toBe(0x10);
    expect(scan('KeyA')).toBe(0x1e);
    expect(scan('KeyZ')).toBe(0x2c);
    expect(scan('Space')).toBe(0x39);
    expect(scan('F9')).toBe(0x43);
    expect(scan('F12')).toBe(0x58);
  });

  it('codeFromChar 只识别单个字母和数字，不区分大小写', () => {
    expect(codeFromChar('q')).toBe('KeyQ');
    expect(codeFromChar('Q')).toBe('KeyQ');
    expect(codeFromChar('7')).toBe('Digit7');
    expect(codeFromChar('-')).toBeUndefined();
    expect(codeFromChar('(')).toBeUndefined();
    expect(codeFromChar('QW')).toBeUndefined();
  });

  it('keyLabel 返回键帽文字，未知键码原样返回', () => {
    expect(keyLabel('KeyN')).toBe('N');
    expect(keyLabel('Space')).toBe('Space');
    expect(keyLabel('Nope')).toBe('Nope');
  });
});
