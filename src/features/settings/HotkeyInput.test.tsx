import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type EnvInfo } from '@/ipc/types';
import { SHORTCUT_FIELDS } from '@/lib/shortcuts';
import { useEnvStore } from '@/stores/envStore';
import { HotkeyInput } from './HotkeyInput';

const macEnv: EnvInfo = {
  platform: 'macos',
  backend: 'mock',
  elevated: null,
  appVersion: '0.1.0',
  dataDir: '/data',
  logsDir: '/data/logs',
  startupWarnings: [],
};
const windowsEnv: EnvInfo = { ...macEnv, platform: 'windows' };

const openFile = SHORTCUT_FIELDS[2];
const stop = SHORTCUT_FIELDS[1];

function renderInput(props: Partial<Parameters<typeof HotkeyInput>[0]> = {}) {
  const onChange = vi.fn();
  const rendered = render(
    <HotkeyInput
      info={props.info ?? openFile}
      value={props.value ?? 'CmdOrCtrl+O'}
      defaultValue={props.defaultValue ?? DEFAULT_SETTINGS.shortcuts.openFile}
      conflict={props.conflict}
      disabled={props.disabled}
      onChange={onChange}
    />,
  );
  return { ...rendered, onChange, user: userEvent.setup() };
}

beforeEach(() => {
  useEnvStore.setState(useEnvStore.getInitialState(), true);
});

describe('HotkeyInput', () => {
  it('字段标签与设计 01 第 6 节逐字一致', () => {
    expect(SHORTCUT_FIELDS.map((field) => field.label)).toEqual([
      '开始 / 暂停 / 继续',
      '停止',
      '打开文件',
      '开始 / 停止试听',
      '停止试听',
    ]);
    expect(SHORTCUT_FIELDS.map((field) => field.scope)).toEqual(['global', 'global', 'window', 'window', 'window']);
  });

  it('在 macOS 上把 CmdOrCtrl 显示为 Cmd', () => {
    useEnvStore.setState({ env: macEnv, status: 'ready' });
    renderInput();
    expect(screen.getByRole('button', { name: '打开文件快捷键' })).toHaveTextContent('Cmd+O');
  });

  it('在其他平台上把 CmdOrCtrl 显示为 Ctrl', () => {
    useEnvStore.setState({ env: windowsEnv, status: 'ready' });
    renderInput();
    expect(screen.getByRole('button', { name: '打开文件快捷键' })).toHaveTextContent('Ctrl+O');
  });

  it('值与默认不同时显示恢复默认按钮，点击后回调默认值', async () => {
    useEnvStore.setState({ env: windowsEnv, status: 'ready' });
    const first = renderInput({ value: 'CmdOrCtrl+Shift+O' });
    await first.user.click(screen.getByRole('button', { name: '恢复默认打开文件' }));
    expect(first.onChange).toHaveBeenCalledWith('CmdOrCtrl+O');
    first.unmount();
    renderInput({ value: DEFAULT_SETTINGS.shortcuts.openFile });
    expect(screen.queryByRole('button', { name: /恢复默认/ })).not.toBeInTheDocument();
  });

  it('录制合法的组合键后回调', async () => {
    useEnvStore.setState({ env: windowsEnv, status: 'ready' });
    const { onChange, user } = renderInput();
    await user.click(screen.getByRole('button', { name: '打开文件快捷键' }));
    expect(screen.getByRole('button', { name: '打开文件快捷键' })).toHaveTextContent('请按下组合键…（Esc 取消）');
    fireEvent.keyDown(screen.getByRole('button', { name: '打开文件快捷键' }), { code: 'KeyO', key: 'o', ctrlKey: true });
    expect(onChange).toHaveBeenCalledWith('CmdOrCtrl+O');
    expect(screen.getByRole('button', { name: '打开文件快捷键' })).toHaveTextContent('Ctrl+O');
  });

  it('按 Esc 取消录制', async () => {
    useEnvStore.setState({ env: windowsEnv, status: 'ready' });
    const { onChange, user } = renderInput();
    await user.click(screen.getByRole('button', { name: '打开文件快捷键' }));
    await user.keyboard('{Escape}');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '打开文件快捷键' })).toHaveTextContent('Ctrl+O');
  });

  it('只按修饰键时提示并继续等待', async () => {
    useEnvStore.setState({ env: windowsEnv, status: 'ready' });
    const { onChange, user } = renderInput();
    await user.click(screen.getByRole('button', { name: '打开文件快捷键' }));
    fireEvent.keyDown(screen.getByRole('button', { name: '打开文件快捷键' }), {
      code: 'ControlLeft',
      key: 'Control',
      ctrlKey: true,
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '打开文件快捷键' })).toHaveTextContent(
      '只按下修饰键，请再按一个字母、数字或功能键',
    );
  });

  it('不满足该范围规则时提示原因并继续等待', async () => {
    useEnvStore.setState({ env: windowsEnv, status: 'ready' });
    const { onChange, user } = renderInput({ info: stop, value: 'F10', defaultValue: DEFAULT_SETTINGS.hotkeys.stop });
    await user.click(screen.getByRole('button', { name: '停止快捷键' }));
    fireEvent.keyDown(screen.getByRole('button', { name: '停止快捷键' }), { code: 'Digit1', key: '1' });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '停止快捷键' })).toHaveTextContent('字母和数字键必须搭配修饰键');
  });

  it('冲突时标红并提示已被占用', () => {
    useEnvStore.setState({ env: windowsEnv, status: 'ready' });
    renderInput({ conflict: true });
    expect(screen.getByRole('button', { name: '打开文件快捷键' })).toHaveClass('border-destructive');
    expect(screen.getByText('这个组合键已被占用')).toBeInTheDocument();
  });
});
