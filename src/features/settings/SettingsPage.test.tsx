import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { toast } from 'sonner';
import { DEFAULT_SETTINGS, type EnvInfo } from '@/ipc/types';
import { useDisclaimerStore } from '@/stores/disclaimerStore';
import { useEnvStore } from '@/stores/envStore';
import { useNavigationStore } from '@/stores/navigationStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTransportStore } from '@/stores/transportStore';
import { SettingsPage } from './SettingsPage';

const windowsEnv: EnvInfo = {
  platform: 'windows',
  backend: 'windows',
  elevated: true,
  appVersion: '0.1.0',
  dataDir: 'C:\\data',
  logsDir: 'C:\\data\\logs',
  startupWarnings: [],
};

beforeEach(() => {
  useSettingsStore.setState(useSettingsStore.getInitialState(), true);
  useEnvStore.setState(useEnvStore.getInitialState(), true);
  useTransportStore.setState(useTransportStore.getInitialState(), true);
  useNavigationStore.setState(useNavigationStore.getInitialState(), true);
  useDisclaimerStore.setState(useDisclaimerStore.getInitialState(), true);
  useEnvStore.setState({ env: windowsEnv, status: 'ready' });
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS, status: 'ready' });
});

afterEach(() => {
  clearMocks();
  vi.restoreAllMocks();
});

async function renderPage() {
  return { user: userEvent.setup(), ...render(<SettingsPage />) };
}

describe('SettingsPage', () => {
  it('按默认设置渲染各分组', async () => {
    await renderPage();
    expect(screen.getByText('快捷键（全局）')).toBeInTheDocument();
    expect(screen.getByText('快捷键（窗口内）')).toBeInTheDocument();
    expect(screen.getByText('演奏')).toBeInTheDocument();
    expect(screen.getByText('游戏窗口识别')).toBeInTheDocument();
    expect(screen.getByText('日志')).toBeInTheDocument();
    expect(screen.getByText('关于')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始 / 暂停 / 继续快捷键' })).toHaveTextContent('F9');
    expect(screen.getByRole('button', { name: '停止快捷键' })).toHaveTextContent('F10');
    expect(screen.getByRole('button', { name: '打开文件快捷键' })).toHaveTextContent('Ctrl+O');
    expect(screen.getByRole('button', { name: '开始 / 停止试听快捷键' })).toHaveTextContent('Space');
    expect(screen.getByRole('button', { name: '停止试听快捷键' })).toHaveTextContent('Escape');
    expect(screen.getByText('3 秒')).toBeInTheDocument();
    expect(screen.getByText('0 ms')).toBeInTheDocument();
    expect(screen.getByLabelText('窗口类名')).toHaveValue('UnityWndClass');
    expect(screen.getByText('原神')).toBeInTheDocument();
    expect(screen.getByText('Genshin Impact')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: '写入执行日志' })).toBeChecked();
    expect(screen.getByText('0.1.0')).toBeInTheDocument();
    expect(screen.getByText('C:\\data')).toBeInTheDocument();
  });

  it('修改后出现底部操作栏，撤销后消失', async () => {
    const spy = vi.spyOn(toast, 'info');
    const { user } = await renderPage();
    expect(screen.queryByRole('button', { name: '保存设置' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: '写入执行日志' }));
    expect(screen.getByText('有未保存的设置')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: '写入执行日志' })).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: '撤销修改' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '保存设置' })).not.toBeInTheDocument());
    expect(screen.getByRole('switch', { name: '写入执行日志' })).toBeChecked();
    expect(spy).toHaveBeenCalledWith('已撤销未保存的修改');
  });

  it('保存设置成功后清空草稿并提示', async () => {
    const successSpy = vi.spyOn(toast, 'success');
    const saved = { ...DEFAULT_SETTINGS, writeExecutionLog: false };
    mockIPC((cmd) => (cmd === 'save_settings' ? saved : null));
    const { user } = await renderPage();
    await user.click(screen.getByRole('switch', { name: '写入执行日志' }));
    await user.click(screen.getByRole('button', { name: '保存设置' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '保存设置' })).not.toBeInTheDocument());
    expect(useSettingsStore.getState().settings).toEqual(saved);
    expect(useSettingsStore.getState().draft).toBeNull();
    expect(successSpy).toHaveBeenCalledWith('设置已保存');
  });

  it('组内冲突（两个全局热键相同）标红并禁用保存', async () => {
    const { user } = await renderPage();
    await user.click(screen.getByRole('button', { name: '开始 / 暂停 / 继续快捷键' }));
    fireEvent.keyDown(screen.getByRole('button', { name: '开始 / 暂停 / 继续快捷键' }), { code: 'F10', key: 'F10' });
    expect(await screen.findAllByText('这个组合键已被占用')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '保存设置' })).toBeDisabled();
  });

  it('跨组冲突（全局热键与窗口内快捷键相同）也标红', async () => {
    const { user } = await renderPage();
    await user.click(screen.getByRole('button', { name: '打开文件快捷键' }));
    fireEvent.keyDown(screen.getByRole('button', { name: '打开文件快捷键' }), { code: 'F9', key: 'F9' });
    expect(await screen.findAllByText('这个组合键已被占用')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '保存设置' })).toBeDisabled();
  });

  it('演奏进行中禁用快捷键修改并提示', async () => {
    useTransportStore.setState({ playerState: { kind: 'playing' } });
    await renderPage();
    expect(screen.getAllByText('演奏进行中不能修改快捷键')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '开始 / 暂停 / 继续快捷键' })).toBeDisabled();
    expect(screen.getByLabelText('窗口类名')).toBeEnabled();
  });

  it('倒计时滑块步进并显示数值', async () => {
    const { user } = await renderPage();
    const slider = screen.getAllByRole('slider')[0];
    await user.click(slider);
    await user.keyboard('{ArrowRight}');
    expect(screen.getByText('4 秒')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存设置' })).toBeInTheDocument();
  });

  it('窗口标题可以添加，恢复默认后回到默认窗口规则', async () => {
    const { user } = await renderPage();
    await user.type(screen.getByLabelText('新窗口标题'), '云·原神');
    await user.click(screen.getByRole('button', { name: '添加' }));
    expect(screen.getByText('云·原神')).toBeInTheDocument();
    await user.type(screen.getByLabelText('窗口类名'), 'X');
    await user.click(screen.getByRole('button', { name: '恢复默认' }));
    expect(screen.getByLabelText('窗口类名')).toHaveValue('UnityWndClass');
    expect(screen.queryByText('云·原神')).not.toBeInTheDocument();
  });

  it('查看风险提示会重新打开对话框状态', async () => {
    const { user } = await renderPage();
    await user.click(screen.getByRole('button', { name: /查看风险提示/ }));
    expect(useDisclaimerStore.getState().open).toBe(true);
  });

  it('设置未加载时显示空状态', () => {
    useSettingsStore.setState(useSettingsStore.getInitialState(), true);
    render(<SettingsPage />);
    expect(screen.getByText('设置尚未加载。')).toBeInTheDocument();
  });
});
