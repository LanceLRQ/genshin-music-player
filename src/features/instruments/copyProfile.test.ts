import { describe, expect, it } from 'vitest';
import { BUILTIN_INSTRUMENTS } from '@/core/instruments/registry';
import { copyProfile } from './copyProfile';

const lyre = BUILTIN_INSTRUMENTS[0];

describe('copyProfile', () => {
  it('ID 依次追加 -custom、-2、-3，名称加（副本），状态回到待实测', () => {
    const first = copyProfile(lyre, [lyre.id]);
    expect(first.id).toBe('windsong-lyre-custom');
    const third = copyProfile(lyre, [lyre.id, 'windsong-lyre-custom', 'windsong-lyre-custom-2']);
    expect(third.id).toBe('windsong-lyre-custom-3');
    expect(third.name).toBe('风物之诗琴（副本）');
    expect(third.status).toBe('unverified');
  });

  it('深拷贝：修改副本不影响原对象（内置乐器对象是共享引用）', () => {
    const copy = copyProfile(lyre, []);
    copy.rows[0].keys[0].pitch = 1;
    copy.timing.holdMs = 999;
    copy.rows.push({ label: '新行', keys: [{ code: 'KeyQ', pitch: 1 }] });
    expect(lyre.rows[0].keys[0].pitch).toBe(72);
    expect(lyre.timing.holdMs).toBe(30);
    expect(lyre.rows).toHaveLength(3);
  });
});
