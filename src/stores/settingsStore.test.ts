import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
