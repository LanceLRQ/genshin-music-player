import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EnvInfo } from '@/ipc/types';
import { useEnvStore } from './envStore';

const env: EnvInfo = {
  platform: 'windows',
  backend: 'windows',
  elevated: false,
  trusted: null,
  appVersion: '0.1.0',
  dataDir: 'C:\\data',
  logsDir: 'C:\\data\\logs',
  startupWarnings: ['设置文件损坏，已恢复默认设置'],
};

beforeEach(() => {
  useEnvStore.setState(useEnvStore.getInitialState(), true);
});

afterEach(() => {
  clearMocks();
});

describe('envStore', () => {
  it('load 成功后保存环境信息', async () => {
    mockIPC((cmd) => (cmd === 'get_env' ? env : null));
    const loading = useEnvStore.getState().load();
    expect(useEnvStore.getState().status).toBe('loading');
    await loading;
    expect(useEnvStore.getState()).toMatchObject({ env, status: 'ready', error: null });
  });

  it('load 失败时记录错误', async () => {
    await useEnvStore.getState().load();
    expect(useEnvStore.getState()).toMatchObject({ env: null, status: 'error', error: { code: 'IPC_UNAVAILABLE' } });
  });

  it('dismissWarnings 关闭启动警告横幅', () => {
    useEnvStore.getState().dismissWarnings();
    expect(useEnvStore.getState().warningsDismissed).toBe(true);
  });
});
