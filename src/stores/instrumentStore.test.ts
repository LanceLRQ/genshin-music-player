import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { BUILTIN_INSTRUMENTS } from '@/core/instruments/registry';
import type { CustomInstrumentList } from '@/ipc/types';
import { DEFAULT_INSTRUMENT_ID, useInstrumentStore } from './instrumentStore';

const lyre = BUILTIN_INSTRUMENTS[0];
const custom = (id: string, name: string) => ({ ...lyre, id, name, status: 'unverified' });
const builtinIds = BUILTIN_INSTRUMENTS.map((profile) => profile.id);
const idsOf = () => useInstrumentStore.getState().entries.map((entry) => entry.profile.id);

function mockCustomInstruments(list: CustomInstrumentList) {
  mockIPC((cmd) => (cmd === 'list_custom_instruments' ? list : null));
}

beforeEach(() => {
  useInstrumentStore.setState(useInstrumentStore.getInitialState(), true);
});

afterEach(() => {
  clearMocks();
  vi.restoreAllMocks();
});

describe('instrumentStore', () => {
  it('加载前只有内置乐器，默认选中风物之诗琴', () => {
    expect(idsOf()).toEqual(builtinIds);
    expect(useInstrumentStore.getState()).toMatchObject({ status: 'idle', selectedId: 'windsong-lyre' });
    expect(DEFAULT_INSTRUMENT_ID).toBe('windsong-lyre');
  });

  it('load 合并合法的自定义乐器，内置在前', async () => {
    mockCustomInstruments({ profiles: [custom('my-lyre', '我的琴')], warnings: [] });
    await useInstrumentStore.getState().load();
    expect(idsOf()).toEqual([...builtinIds, 'my-lyre']);
    expect(useInstrumentStore.getState().entries.at(-1)).toMatchObject({ builtin: false, profile: { name: '我的琴' } });
    expect(useInstrumentStore.getState()).toMatchObject({ status: 'ready', warnings: [], error: null });
  });

  it('后端的警告和校验失败的文件写进 warnings，合法的配置照常加载', async () => {
    mockCustomInstruments({
      profiles: [{ schemaVersion: 1, id: 'broken', name: '坏琴' }, 'not-an-object', custom('my-lyre', '我的琴')],
      warnings: ['跳过无法解析的文件 bad.json'],
    });
    await useInstrumentStore.getState().load();
    const { warnings } = useInstrumentStore.getState();
    expect(idsOf()).toEqual([...builtinIds, 'my-lyre']);
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toBe('跳过无法解析的文件 bad.json');
    expect(warnings[1]).toMatch(/^自定义乐器「broken」校验失败：/);
    expect(warnings[2]).toMatch(/^自定义乐器「第 2 个文件」校验失败：/);
  });

  it('与内置乐器 id 冲突的自定义乐器被跳过并给出警告', async () => {
    mockCustomInstruments({ profiles: [custom('windsong-lyre', '山寨琴')], warnings: [] });
    await useInstrumentStore.getState().load();
    expect(idsOf()).toEqual(builtinIds);
    expect(useInstrumentStore.getState().warnings).toEqual([
      '自定义乐器「山寨琴」的 id「windsong-lyre」与内置乐器重复，已跳过',
    ]);
  });

  it('读取失败时保留内置乐器并记录错误', async () => {
    await useInstrumentStore.getState().load();
    expect(idsOf()).toEqual(builtinIds);
    expect(useInstrumentStore.getState()).toMatchObject({ status: 'error', error: { code: 'IPC_UNAVAILABLE' } });
  });

  it('select 只接受存在的乐器；重新加载后选中的乐器不存在时回到默认乐器', async () => {
    mockCustomInstruments({ profiles: [custom('my-lyre', '我的琴')], warnings: [] });
    await useInstrumentStore.getState().load();
    useInstrumentStore.getState().select('nope');
    expect(useInstrumentStore.getState().selectedId).toBe('windsong-lyre');
    useInstrumentStore.getState().select('my-lyre');
    expect(useInstrumentStore.getState().selectedId).toBe('my-lyre');

    clearMocks();
    mockCustomInstruments({ profiles: [], warnings: [] });
    await useInstrumentStore.getState().load();
    expect(useInstrumentStore.getState().selectedId).toBe('windsong-lyre');
  });
});

describe('instrumentStore 保存与删除', () => {
  it('save 调用 save_custom_instrument 后重新加载列表并选中', async () => {
    const customs: unknown[] = [];
    mockIPC((cmd, args) => {
      if (cmd === 'save_custom_instrument') {
        customs.push((args as { profile: unknown }).profile);
        return null;
      }
      if (cmd === 'list_custom_instruments') return { profiles: customs, warnings: [] };
      return null;
    });
    const profile = { ...lyre, id: 'my-lyre', name: '我的琴', status: 'unverified' } as typeof lyre;
    await expect(useInstrumentStore.getState().save(profile)).resolves.toBe(true);
    expect(idsOf()).toEqual([...builtinIds, 'my-lyre']);
    expect(useInstrumentStore.getState().selectedId).toBe('my-lyre');
  });

  it('save 失败时用 toast 提示并返回 false', async () => {
    const spy = vi.spyOn(toast, 'error');
    mockIPC((cmd) => (cmd === 'save_custom_instrument' ? Promise.reject({ code: 'INSTRUMENT_ID_CONFLICT', message: 'id 与内置乐器冲突' }) : null));
    const profile = { ...lyre, id: 'my-lyre', name: '我的琴', status: 'unverified' } as typeof lyre;
    await expect(useInstrumentStore.getState().save(profile)).resolves.toBe(false);
    expect(spy).toHaveBeenCalledWith('保存乐器失败：id 与内置乐器冲突');
    expect(idsOf()).toEqual(builtinIds);
  });

  it('remove 删除后重新加载，选中回到默认乐器', async () => {
    const customs = [custom('my-lyre', '我的琴')];
    mockIPC((cmd, args) => {
      if (cmd === 'delete_custom_instrument') {
        customs.splice(0, customs.length);
        return null;
      }
      if (cmd === 'list_custom_instruments') return { profiles: customs, warnings: [] };
      void args;
      return null;
    });
    await useInstrumentStore.getState().load();
    useInstrumentStore.getState().select('my-lyre');
    await expect(useInstrumentStore.getState().remove('my-lyre')).resolves.toBe(true);
    expect(idsOf()).toEqual(builtinIds);
    expect(useInstrumentStore.getState().selectedId).toBe('windsong-lyre');
  });

  it('remove 失败时用 toast 提示并返回 false', async () => {
    const spy = vi.spyOn(toast, 'error');
    mockIPC((cmd) => (cmd === 'delete_custom_instrument' ? Promise.reject({ code: 'STORAGE_IO', message: '读写文件失败：权限不足' }) : null));
    await expect(useInstrumentStore.getState().remove('my-lyre')).resolves.toBe(false);
    expect(spy).toHaveBeenCalledWith('删除乐器失败：读写文件失败：权限不足');
  });

  it('已连接后端时 load 失败用 toast 提示', async () => {
    const spy = vi.spyOn(toast, 'error');
    mockIPC(() => Promise.reject({ code: 'STORAGE_IO', message: '读写文件失败：磁盘已满' }));
    await useInstrumentStore.getState().load();
    expect(spy).toHaveBeenCalledWith('读取乐器列表失败：读写文件失败：磁盘已满');
    expect(idsOf()).toEqual(builtinIds);
  });

  it('没有后端时 load 失败保持静默', async () => {
    const spy = vi.spyOn(toast, 'error');
    await useInstrumentStore.getState().load();
    expect(useInstrumentStore.getState().status).toBe('error');
    expect(spy).not.toHaveBeenCalled();
  });
});
