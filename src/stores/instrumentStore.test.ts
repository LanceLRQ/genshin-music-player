import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
