import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, type EnvInfo } from '@/ipc/types';
import { useEnvStore } from '@/stores/envStore';
import { EnvBanners } from './env-banners';

const baseEnv: EnvInfo = {
  platform: 'windows',
  backend: 'windows',
  elevated: true,
  trusted: null,
  appVersion: '0.1.0',
  dataDir: 'C:\\data',
  logsDir: 'C:\\data\\logs',
  startupWarnings: [],
};

function renderWithEnv(env: Partial<EnvInfo> | null, error: AppError | null = null) {
  useEnvStore.setState({
    env: env ? { ...baseEnv, ...env } : null,
    status: error ? 'error' : 'ready',
    error,
  });
  return { user: userEvent.setup(), ...render(<EnvBanners />) };
}

beforeEach(() => {
  useEnvStore.setState(useEnvStore.getInitialState(), true);
});

afterEach(() => {
  clearMocks();
  vi.restoreAllMocks();
});

describe('EnvBanners', () => {
  it('已提权的 Windows 且没有启动警告时不显示任何横幅', () => {
    const { container } = renderWithEnv({});
    expect(container).toBeEmptyDOMElement();
  });

  it('Windows 未提权时显示警告，点击按钮调用 restart_as_admin', async () => {
    const calls: string[] = [];
    mockIPC((cmd) => {
      calls.push(cmd);
      return null;
    });
    const { user } = renderWithEnv({ elevated: false });
    expect(screen.getByText('未以管理员身份运行，游戏将收不到按键。')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '以管理员身份重启' }));
    expect(calls).toEqual(['restart_as_admin']);
  });

  it('重启失败时用 toast 提示原因', async () => {
    mockIPC(() => Promise.reject({ code: 'ELEVATION_FAILED', message: '未能以管理员身份重启（可能取消了授权）' }));
    const spy = vi.spyOn(toast, 'error');
    const { user } = renderWithEnv({ elevated: false });
    await user.click(screen.getByRole('button', { name: '以管理员身份重启' }));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('以管理员身份重启失败：未能以管理员身份重启（可能取消了授权）'),
    );
    expect(screen.getByRole('button', { name: '以管理员身份重启' })).toBeEnabled();
  });

  it('模拟模式显示提示，非 Windows 不显示管理员警告', () => {
    renderWithEnv({ platform: 'macos', backend: 'mock', elevated: null });
    expect(screen.getByText('当前平台不能向游戏发送按键，“演奏”只会模拟并记录日志。')).toBeInTheDocument();
    expect(screen.queryByText('未以管理员身份运行，游戏将收不到按键。')).not.toBeInTheDocument();
  });

  it('逐条显示启动警告，关闭后隐藏', async () => {
    const { user } = renderWithEnv({ startupWarnings: ['设置文件损坏，已恢复默认设置', '热键「F9」注册失败，可能被其他程序占用'] });
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '设置文件损坏，已恢复默认设置',
      '热键「F9」注册失败，可能被其他程序占用',
    ]);
    await user.click(screen.getByRole('button', { name: '关闭启动警告' }));
    expect(screen.queryByText('设置文件损坏，已恢复默认设置')).not.toBeInTheDocument();
    expect(useEnvStore.getState().warningsDismissed).toBe(true);
  });

  it('无法连接后端时显示错误信息', () => {
    renderWithEnv(null, new AppError('IPC_UNAVAILABLE', '未连接到桌面端后端，当前页面不在应用窗口中运行'));
    expect(screen.getByText('无法连接后端')).toBeInTheDocument();
    expect(screen.getByText('未连接到桌面端后端，当前页面不在应用窗口中运行')).toBeInTheDocument();
  });
});
