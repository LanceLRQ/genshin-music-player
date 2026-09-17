import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type EnvInfo } from '@/ipc/types';
import { DISCLAIMER_STORAGE_KEY, useDisclaimerStore } from '@/stores/disclaimerStore';
import { useEnvStore } from '@/stores/envStore';
import { useInstrumentStore } from '@/stores/instrumentStore';
import { useNavigationStore } from '@/stores/navigationStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTransportStore } from '@/stores/transportStore';
import { App } from './App';

const mockEnv: EnvInfo = {
  platform: 'macos',
  backend: 'mock',
  elevated: null,
  appVersion: '0.1.0',
  dataDir: '/data',
  logsDir: '/data/logs',
  startupWarnings: [],
};

/** 模拟一个刚启动、没有自定义乐器的 macOS 后端 */
function mockBackend() {
  mockIPC((cmd) => {
    switch (cmd) {
      case 'get_env':
        return mockEnv;
      case 'get_settings':
        return DEFAULT_SETTINGS;
      case 'list_custom_instruments':
        return { profiles: [], warnings: [] };
      case 'get_player_state':
        return { kind: 'idle' };
      default:
        return 1;
    }
  });
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(DISCLAIMER_STORAGE_KEY, '1');
  useDisclaimerStore.getState().init();
  useEnvStore.setState(useEnvStore.getInitialState(), true);
  useSettingsStore.setState(useSettingsStore.getInitialState(), true);
  useInstrumentStore.setState(useInstrumentStore.getInitialState(), true);
  useNavigationStore.setState(useNavigationStore.getInitialState(), true);
  useTransportStore.setState(useTransportStore.getInitialState(), true);
});

afterEach(() => {
  clearMocks();
  vi.restoreAllMocks();
});

describe('App', () => {
  it('启动时加载环境、设置和乐器，显示侧边栏、模拟模式横幅和演奏页', async () => {
    mockBackend();
    render(<App />);
    expect(await screen.findByText('当前平台不能向游戏发送按键，“演奏”只会模拟并记录日志。')).toBeInTheDocument();
    await waitFor(() => expect(useInstrumentStore.getState().status).toBe('ready'));
    expect(useSettingsStore.getState().settings).toEqual(DEFAULT_SETTINGS);
    expect(screen.getByText('模拟模式')).toBeInTheDocument();
    expect(screen.getByText('F9')).toBeInTheDocument();
    expect(screen.getByText('导入乐谱开始')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('点击侧边栏切换到乐器页和设置页', async () => {
    mockBackend();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: '乐器' }));
    expect(screen.getByText('虚拟琴键预览（点击试听）')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '设置' }));
    expect(screen.getByText('设置页尚未实现。')).toBeInTheDocument();
    expect(screen.queryByText('乐器页尚未实现。')).not.toBeInTheDocument();
  });

  it('不在 Tauri 窗口中运行时不崩溃，显示无法连接后端且不弹出错误提示', async () => {
    const spy = vi.spyOn(toast, 'error');
    render(<App />);
    expect(await screen.findByText('无法连接后端')).toBeInTheDocument();
    expect(screen.getByText('未连接后端')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '演奏' })).toBeInTheDocument();
    expect(useInstrumentStore.getState().entries).toHaveLength(5);
    expect(spy).not.toHaveBeenCalled();
  });

  it('首次启动时先显示风险提示', async () => {
    localStorage.clear();
    useDisclaimerStore.getState().init();
    render(<App />);
    expect(await screen.findByRole('alertdialog', { name: '使用前请阅读' })).toBeInTheDocument();
  });
});
