import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionTimeline, EnvInfo } from '@/ipc/types';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useEnvStore } from '@/stores/envStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTransportStore } from '@/stores/transportStore';
import { TransportBar } from './TransportBar';

const execution: ExecutionTimeline = {
  instrumentId: 'windsong-lyre',
  events: [{ tMs: 0, up: [], down: ['KeyA'] }],
  durationMs: 1000,
  sourceStartMs: 0,
  speed: 1,
  loop: false,
  dropped: 0,
};

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

function renderBar(overrides: Partial<Parameters<typeof TransportBar>[0]> = {}) {
  const props = {
    soloTrackName: null,
    onPreviewToggle: vi.fn(),
    onPlay: vi.fn(),
    onPause: vi.fn(),
    onStop: vi.fn(),
    onSoloCancel: vi.fn(),
    ...overrides,
  };
  render(
    <TooltipProvider>
      <TransportBar {...props} />
    </TooltipProvider>,
  );
  return props;
}

beforeEach(() => {
  useEnvStore.setState(useEnvStore.getInitialState(), true);
  useSettingsStore.setState(useSettingsStore.getInitialState(), true);
  useTransportStore.setState(useTransportStore.getInitialState(), true);
  useEnvStore.setState({ env: windowsEnv, status: 'ready' });
  useTransportStore.setState({ execution });
});

describe('TransportBar', () => {
  it('空闲且有可弹时间线时试听和演奏可用，暂停停止禁用', async () => {
    const props = renderBar();
    expect(screen.getByRole('button', { name: /试听/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /演奏/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /暂停/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /停止/ })).toBeDisabled();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /演奏/ }));
    expect(props.onPlay).toHaveBeenCalledTimes(1);
    expect(screen.getByText('空闲')).toBeInTheDocument();
  });

  it('演奏中暂停停止可用并显示锁定提示', () => {
    useTransportStore.setState({ playerState: { kind: 'playing' } });
    renderBar();
    expect(screen.getByRole('button', { name: /暂停/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /停止/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /试听/ })).toBeDisabled();
    expect(screen.getByText('演奏中')).toBeInTheDocument();
    expect(screen.getByText('演奏进行中，停止后才能修改')).toBeInTheDocument();
  });

  it('已暂停显示继续按钮与热键提示', () => {
    useTransportStore.setState({ playerState: { kind: 'paused', reason: 'user', positionMs: 100 } });
    renderBar();
    expect(screen.getByRole('button', { name: /继续/ })).toBeEnabled();
    expect(screen.getByText('已暂停，按 F9 继续')).toBeInTheDocument();
    expect(screen.getByText('F9')).toBeInTheDocument();
    expect(screen.getByText('F10')).toBeInTheDocument();
  });

  it('失去焦点暂停时显示红色警示', () => {
    useTransportStore.setState({ playerState: { kind: 'paused', reason: 'focusLost', positionMs: 100 } });
    renderBar();
    expect(screen.getByText('游戏窗口失去焦点，已暂停并松开所有按键。')).toBeInTheDocument();
    expect(screen.getByText(/切回游戏后按/)).toBeInTheDocument();
    expect(screen.getByText('游戏窗口失去焦点，已暂停')).toBeInTheDocument();
  });

  it('试听中试听按钮变为停止试听，点击回调', async () => {
    const props = renderBar();
    act(() => useTransportStore.setState({ previewing: true }));
    const user = userEvent.setup();
    const button = screen.getByRole('button', { name: /停止试听/ });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(props.onPreviewToggle).toHaveBeenCalledTimes(1);
    expect(screen.getByText('试听中')).toBeInTheDocument();
  });

  it('单轨进行中显示徽章，✕ 等同于停止', async () => {
    const props = renderBar({ soloTrackName: '音轨 1 · bright acoustic piano' });
    act(() => useTransportStore.setState({ solo: { mode: 'preview', trackId: 't0' }, previewing: true }));
    const user = userEvent.setup();
    expect(screen.getByText(/单独试听：音轨 1 · bright acoustic piano/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '停止单轨' }));
    expect(props.onSoloCancel).toHaveBeenCalledTimes(1);
  });
});
