import type { InstrumentProfile } from '@/core/model/instrument';

/**
 * 复制乐器配置：深拷贝全部字段（内置乐器对象是共享引用，绝不能原地修改），
 * ID 追加 -custom（已存在时再追加 -2、-3），名称加"（副本）"，状态回到待实测。
 */
export function copyProfile(source: InstrumentProfile, existingIds: readonly string[]): InstrumentProfile {
  const copy = structuredClone(source);
  const taken = new Set(existingIds);
  let id = `${source.id}-custom`;
  for (let n = 2; taken.has(id); n += 1) id = `${source.id}-custom-${n}`;
  copy.id = id;
  copy.name = `${source.name}（副本）`;
  copy.status = 'unverified';
  return copy;
}
