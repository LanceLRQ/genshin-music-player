import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnvInfo, Summary } from '@/ipc/types';
import { useEnvStore } from '@/stores/envStore';
import { useTransportStore } from '@/stores/transportStore';
import { SummaryLine } from './SummaryLine';

const summary: Summary = {
  completed: false,
  eventsSent: 456,
  latenessP50Ms: 1.2,
  latenessP95Ms: 3.24,
  latenessMaxMs: 11,
  dropped: 2,
  resyncCount: 0,
  logPath: '/data/logs/exec-1789.jsonl',
};

const mockEnv: EnvInfo = {
  platform: 'macos',
  backend: 'mock',
  elevated: null,
  trusted: null,
  appVersion: '0.1.0',
  dataDir: '/data',
  logsDir: '/data/logs',
  startupWarnings: [],
};

beforeEach(() => {
  vi.spyOn(toast, 'success');
  vi.spyOn(toast, 'error');
  useEnvStore.setState(useEnvStore.getInitialState(), true);
  useTransportStore.setState(useTransportStore.getInitialState(), true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SummaryLine', () => {
  it('没有统计时不渲染', () => {
    render(<SummaryLine />);
    expect(screen.queryByText(/上次演奏/)).not.toBeInTheDocument();
  });

  it('显示统计、变速丢弃与（已停止），并显示日志路径', async () => {
    useTransportStore.setState({ summary });
    render(<SummaryLine />);
    expect(
      screen.getByText(/上次演奏：456 次按键 · 延迟 p50 1.2ms · p95 3.2ms · 最大 11ms · 变速丢弃 2（已停止）/),
    ).toBeInTheDocument();
    expect(screen.getByText('/data/logs/exec-1789.jsonl')).toBeInTheDocument();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await user.click(screen.getByRole('button', { name: /复制路径/ }));
    expect(writeText).toHaveBeenCalledWith('/data/logs/exec-1789.jsonl');
    expect(toast.success).toHaveBeenCalledWith('已复制日志路径');
  });

  it('mock 后端显示模拟徽章，logPath 为 null 时不显示路径', () => {
    useEnvStore.setState({ env: mockEnv, status: 'ready' });
    useTransportStore.setState({ summary: { ...summary, logPath: null } });
    render(<SummaryLine />);
    expect(screen.getByText('模拟')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /复制路径/ })).not.toBeInTheDocument();
  });
});
