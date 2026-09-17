import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/utils';

describe('cn', () => {
  it('按条件拼接类名', () => {
    const classes = (active: boolean) => cn('px-2', active && 'font-bold', { 'text-sm': true, hidden: !active }, ['rounded']);
    expect(classes(true)).toBe('px-2 font-bold text-sm rounded');
    expect(classes(false)).toBe('px-2 text-sm hidden rounded');
  });

  it('后出现的 Tailwind 类覆盖冲突的类', () => {
    expect(cn('px-2 py-1 bg-red-500', 'px-4 bg-primary')).toBe('py-1 px-4 bg-primary');
  });
});
