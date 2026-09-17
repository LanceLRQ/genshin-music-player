import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type EnvInfo } from '@/ipc/types';
import { useEnvStore } from '@/stores/envStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { ImportMenu } from './ImportMenu';

const macEnv: EnvInfo = {
  platform: 'macos',
  backend: 'mock',
  elevated: null,
  appVersion: '0.1.0',
  dataDir: '/data',
  logsDir: '/data/logs',
  startupWarnings: [],
};

beforeEach(() => {
  useEnvStore.setState(useEnvStore.getInitialState(), true);
  useSettingsStore.setState(useSettingsStore.getInitialState(), true);
});

describe('ImportMenu', () => {
  it('展开后显示三个菜单项，点击后回调', async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn();
    const onPasteText = vi.fn();
    render(<ImportMenu onOpenFile={onOpenFile} onPasteText={onPasteText} />);
    await user.click(screen.getByRole('button', { name: /导入/ }));
    expect(await screen.findByText('打开文件…')).toBeInTheDocument();
    expect(screen.getByText('粘贴键盘谱…')).toBeInTheDocument();
    expect(screen.getByText('粘贴简谱…')).toBeInTheDocument();
    await user.click(screen.getByText('粘贴键盘谱…'));
    expect(onPasteText).toHaveBeenCalledWith('keyscore');
    await user.click(screen.getByRole('button', { name: /导入/ }));
    await user.click(screen.getByText('打开文件…'));
    expect(onOpenFile).toHaveBeenCalledTimes(1);
  });

  it('打开文件项显示设置里的快捷键（macOS 上 Cmd+O）', async () => {
    useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, shortcuts: { ...DEFAULT_SETTINGS.shortcuts, openFile: 'CmdOrCtrl+O' } } });
    useEnvStore.setState({ env: macEnv, status: 'ready' });
    const user = userEvent.setup();
    render(<ImportMenu onOpenFile={vi.fn()} onPasteText={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /导入/ }));
    expect(await screen.findByText('Cmd+O')).toBeInTheDocument();
  });

  it('disabled 时触发按钮不可用', () => {
    render(<ImportMenu disabled onOpenFile={vi.fn()} onPasteText={vi.fn()} />);
    expect(screen.getByRole('button', { name: /导入/ })).toBeDisabled();
  });
});
