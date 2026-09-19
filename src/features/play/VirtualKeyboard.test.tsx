import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { previewPlayer } from '@/audio/previewPlayer';
import { BUILTIN_INSTRUMENTS } from '@/core/instruments/registry';
import type { ExecutionTimeline } from '@/ipc/types';
import { useAdaptStore } from '@/stores/adaptStore';
import { useInstrumentStore } from '@/stores/instrumentStore';
import { useTransportStore } from '@/stores/transportStore';
import { VirtualKeyboard } from './VirtualKeyboard';

vi.mock('@/audio/previewPlayer', () => ({
  previewPlayer: { start: vi.fn(), stop: vi.fn(), playKey: vi.fn(), setVolume: vi.fn(), playing: false },
}));

const lyre = BUILTIN_INSTRUMENTS[0];
const execution: ExecutionTimeline = {
  instrumentId: 'windsong-lyre',
  events: [{ tMs: 0, up: [], down: ['KeyA'] }],
  durationMs: 1000,
  sourceStartMs: 0,
  speed: 1,
  loop: false,
  dropped: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  useAdaptStore.setState(useAdaptStore.getInitialState(), true);
  useInstrumentStore.setState(useInstrumentStore.getInitialState(), true);
  useTransportStore.setState(useTransportStore.getInitialState(), true);
});

describe('VirtualKeyboard', () => {
  it('按乐器配置逐行绘制键帽，显示键帽字母与音名', () => {
    render(<VirtualKeyboard />);
    expect(screen.getByText('高音')).toBeInTheDocument();
    expect(screen.getByText('中音')).toBeInTheDocument();
    expect(screen.getByText('低音')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '键帽 Q C5' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '键帽 M B3' })).toBeInTheDocument();
    expect(screen.getByText('点击键帽可以试听单个音（只在本窗口发声，不会向游戏发键）。')).toBeInTheDocument();
  });

  it('空闲时点击键帽试听单个音', async () => {
    const user = userEvent.setup();
    render(<VirtualKeyboard />);
    await user.click(screen.getByRole('button', { name: '键帽 Q C5' }));
    expect(previewPlayer.playKey).toHaveBeenCalledWith(lyre, 'KeyQ');
  });

  it('和弦乐器的和弦键显示和弦名，鼓键显示中文音色（含序号变体）', () => {
    const guitar = BUILTIN_INSTRUMENTS.find((profile) => profile.id === 'yuco-lyre')!;
    const banquet = BUILTIN_INSTRUMENTS.find((profile) => profile.id === 'banquet-drum')!;
    useAdaptStore.setState({ targetId: 'yuco-lyre' });
    const { unmount } = render(<VirtualKeyboard />);
    expect(screen.getByRole('button', { name: '键帽 Q C' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '键帽 W Dm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '键帽 A C4' })).toBeInTheDocument();
    unmount();
    useAdaptStore.setState({ targetId: 'banquet-drum' });
    render(<VirtualKeyboard />);
    expect(screen.getByRole('button', { name: '键帽 Q 咚' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '键帽 W 咚-2' })).toBeInTheDocument();
    expect(guitar.rows[0].keys[0].chord).toEqual([48, 52, 55]);
    expect(banquet.rows[0].keys[1].voice).toBe('don-2');
  });

  it('演奏进行中键帽禁用且点击无效', async () => {
    useTransportStore.setState({ playerState: { kind: 'playing' } });
    const user = userEvent.setup();
    render(<VirtualKeyboard />);
    const keycap = screen.getByRole('button', { name: '键帽 Q C5' });
    expect(keycap).toBeDisabled();
    await user.click(keycap);
    expect(previewPlayer.playKey).not.toHaveBeenCalled();
  });

  it('试听与演奏时按执行时间线高亮键帽', () => {
    useTransportStore.setState({ execution, previewing: true, previewPositionMs: 0 });
    render(<VirtualKeyboard />);
    expect(screen.getByRole('button', { name: '键帽 A C4' })).toHaveClass('border-primary');
    expect(screen.getByRole('button', { name: '键帽 Q C5' })).not.toHaveClass('border-primary');
  });

  it('倒计时时显示覆盖层：大号数字与提示文字', () => {
    useTransportStore.setState({ playerState: { kind: 'countdown', remainingSec: 3 } });
    render(<VirtualKeyboard />);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('请切换到游戏窗口')).toBeInTheDocument();
  });

  it('等待前台时显示等待文案', () => {
    useTransportStore.setState({ playerState: { kind: 'waitingFocus' } });
    render(<VirtualKeyboard />);
    expect(screen.getByText('等待切换到原神窗口…')).toBeInTheDocument();
  });
});
