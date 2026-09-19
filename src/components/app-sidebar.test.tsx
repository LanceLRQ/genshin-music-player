import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { SidebarProvider } from '@/components/ui/sidebar';
import { AppError, type EnvInfo } from '@/ipc/types';
import { useEnvStore } from '@/stores/envStore';
import { useNavigationStore } from '@/stores/navigationStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTransportStore } from '@/stores/transportStore';
import { AppSidebar } from './app-sidebar';

const windowsEnv: EnvInfo = {
  platform: 'windows',
  backend: 'windows',
  elevated: true,
  trusted: null,
  appVersion: '0.1.0',
  dataDir: 'C:\\data',
  logsDir: 'C:\\data\\logs',
  startupWarnings: [],
};

function renderSidebar() {
  return {
    user: userEvent.setup(),
    ...render(
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>,
    ),
  };
}

beforeEach(() => {
  useEnvStore.setState(useEnvStore.getInitialState(), true);
  useSettingsStore.setState(useSettingsStore.getInitialState(), true);
  useNavigationStore.setState(useNavigationStore.getInitialState(), true);
  useTransportStore.setState(useTransportStore.getInitialState(), true);
});

describe('AppSidebar', () => {
  it('显示三个页面入口，高亮当前页面，点击后切换', async () => {
    const { user } = renderSidebar();
    expect(screen.getByRole('button', { name: '演奏' })).toHaveAttribute('data-active', 'true');
    await user.click(screen.getByRole('button', { name: '设置' }));
    expect(useNavigationStore.getState().page).toBe('settings');
    expect(screen.getByRole('button', { name: '设置' })).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('button', { name: '演奏' })).toHaveAttribute('data-active', 'false');
    expect(screen.getByRole('button', { name: '乐器' })).toBeInTheDocument();
  });

  it('Windows 后端显示管理员状态', () => {
    useEnvStore.setState({ env: { ...windowsEnv, elevated: false }, status: 'ready' });
    renderSidebar();
    expect(screen.getByText('Windows')).toBeInTheDocument();
    expect(screen.getByText('管理员 ✗')).toBeInTheDocument();
  });

  it('模拟模式不显示管理员状态', () => {
    useEnvStore.setState({ env: { ...windowsEnv, platform: 'macos', backend: 'mock', elevated: null }, status: 'ready' });
    renderSidebar();
    expect(screen.getByText('模拟模式')).toBeInTheDocument();
    expect(screen.queryByText(/管理员/)).not.toBeInTheDocument();
  });

  it('连接后端前后分别显示正在连接和未连接', () => {
    useEnvStore.setState({ status: 'loading' });
    renderSidebar();
    expect(screen.getByText('正在连接后端…')).toBeInTheDocument();
    act(() => useEnvStore.setState({ status: 'error', error: new AppError('IPC_UNAVAILABLE', '未连接') }));
    expect(screen.getByText('未连接后端')).toBeInTheDocument();
  });

  it('不显示全局热键提示（已移到演奏页控制条）', () => {
    renderSidebar();
    expect(screen.queryByText('开始/暂停')).not.toBeInTheDocument();
    expect(screen.queryByText('停止')).not.toBeInTheDocument();
  });

  it('演奏进行中且不在演奏页时，"演奏"入口显示状态点', () => {
    useTransportStore.setState({ playerState: { kind: 'paused', reason: 'focusLost', positionMs: 100 } });
    useNavigationStore.setState({ page: 'settings' });
    renderSidebar();
    expect(screen.getByRole('img', { name: '演奏状态：游戏窗口失去焦点，已暂停' })).toHaveClass('bg-red-500');
  });

  it('在演奏页或播放器空闲时不显示状态点', () => {
    useTransportStore.setState({ playerState: { kind: 'playing' } });
    renderSidebar();
    expect(screen.queryByRole('img', { name: /演奏状态/ })).not.toBeInTheDocument();
    act(() => {
      useNavigationStore.setState({ page: 'instruments' });
      useTransportStore.setState({ playerState: { kind: 'idle' } });
    });
    expect(screen.queryByRole('img', { name: /演奏状态/ })).not.toBeInTheDocument();
  });
});
