import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { DEFAULT_SETTINGS } from '@/ipc/types';
import { useSettingsStore } from './settingsStore';

beforeEach(() => {
  useSettingsStore.setState(useSettingsStore.getInitialState(), true);
});

afterEach(() => {
  clearMocks();
});

describe('settingsStore', () => {
  it('load 成功后保存后端返回的设置', async () => {
    const saved = { ...DEFAULT_SETTINGS, countdownSec: 5 };
    mockIPC((cmd) => (cmd === 'get_settings' ? saved : null));
    await useSettingsStore.getState().load();
    expect(useSettingsStore.getState()).toMatchObject({ settings: saved, status: 'ready', error: null });
  });

  it('load 失败时记录错误，settings 保持为 null', async () => {
    mockIPC(() => Promise.reject({ code: 'STORAGE_IO', message: '读写文件失败：权限不足' }));
    await useSettingsStore.getState().load();
    expect(useSettingsStore.getState()).toMatchObject({
      settings: null,
      status: 'error',
      error: { code: 'STORAGE_IO', message: '读写文件失败：权限不足' },
    });
  });
});

describe('settingsStore 草稿与保存', () => {
  it('已连接后端时 load 失败用 toast 提示', async () => {
    const spy = vi.spyOn(toast, 'error');
    mockIPC(() => Promise.reject({ code: 'STORAGE_IO', message: '读写文件失败：权限不足' }));
    await useSettingsStore.getState().load();
    expect(useSettingsStore.getState()).toMatchObject({ settings: null, status: 'error', error: { code: 'STORAGE_IO' } });
    expect(spy).toHaveBeenCalledWith('读取设置失败：读写文件失败：权限不足');
  });

  it('setDraft 写入草稿，不影响已保存设置', () => {
    useSettingsStore.setState({ settings: DEFAULT_SETTINGS, status: 'ready' });
    const next = { ...DEFAULT_SETTINGS, countdownSec: 5 };
    useSettingsStore.getState().setDraft(next);
    expect(useSettingsStore.getState().draft).toEqual(next);
    expect(useSettingsStore.getState().settings).toEqual(DEFAULT_SETTINGS);
  });

  it('saveDraft 成功后以后端返回为准并清空草稿', async () => {
    const saved = { ...DEFAULT_SETTINGS, countdownSec: 7 };
    mockIPC((cmd) => (cmd === 'save_settings' ? saved : null));
    useSettingsStore.setState({ settings: DEFAULT_SETTINGS, status: 'ready', draft: { ...DEFAULT_SETTINGS, countdownSec: 7 } });
    await expect(useSettingsStore.getState().saveDraft()).resolves.toBe(true);
    expect(useSettingsStore.getState()).toMatchObject({ settings: saved, draft: null, saving: false, status: 'ready' });
  });

  it('saveDraft 失败时保留草稿并用 toast 提示', async () => {
    const spy = vi.spyOn(toast, 'error');
    mockIPC(() => Promise.reject({ code: 'HOTKEY_REGISTER_FAILED', message: '热键注册失败，可能被其他程序占用' }));
    useSettingsStore.setState({ settings: DEFAULT_SETTINGS, status: 'ready', draft: DEFAULT_SETTINGS });
    await expect(useSettingsStore.getState().saveDraft()).resolves.toBe(false);
    expect(useSettingsStore.getState().draft).toEqual(DEFAULT_SETTINGS);
    expect(useSettingsStore.getState().saving).toBe(false);
    expect(spy).toHaveBeenCalledWith('保存设置失败：热键注册失败，可能被其他程序占用');
  });

  it('没有草稿时 saveDraft 不调用后端并返回 false', async () => {
    const calls: unknown[] = [];
    mockIPC((cmd, args) => {
      calls.push({ cmd, args });
      return null;
    });
    await expect(useSettingsStore.getState().saveDraft()).resolves.toBe(false);
    expect(calls).toEqual([]);
  });

  it('resetDraft 清空草稿', () => {
    useSettingsStore.setState({ settings: DEFAULT_SETTINGS, status: 'ready', draft: DEFAULT_SETTINGS });
    useSettingsStore.getState().resetDraft();
    expect(useSettingsStore.getState().draft).toBeNull();
  });
});
