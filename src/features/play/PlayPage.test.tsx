import { mockIPC } from '@tauri-apps/api/mocks';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { previewPlayer } from '@/audio/previewPlayer';
import { BUILTIN_INSTRUMENTS } from '@/core/instruments/registry';
import type { Score } from '@/core/model/score';
import type { ExecutionTimeline } from '@/ipc/types';
import { useAdaptStore } from '@/stores/adaptStore';
import { useScoreStore } from '@/stores/scoreStore';
import { useTransportStore } from '@/stores/transportStore';
import { PlayPage } from './PlayPage';

vi.mock('@/audio/previewPlayer', () => ({
  previewPlayer: { start: vi.fn(), stop: vi.fn(), playKey: vi.fn(), setVolume: vi.fn(), playing: false },
}));

const lyre = BUILTIN_INSTRUMENTS[0];
const score: Score = {
  meta: { title: '测试曲', source: 'midi', bpm: 60 },
  tracks: [
    {
      id: 't0',
      name: '音轨 1 · bright acoustic piano',
      isDrum: false,
      notes: [
        { startMs: 0, durationMs: 500, pitch: 72, velocity: 0.8 },
        { startMs: 500, durationMs: 500, pitch: 74, velocity: 0.8 },
      ],
    },
  ],
};
const execution: ExecutionTimeline = {
  instrumentId: 'windsong-lyre',
  events: [{ tMs: 0, up: [], down: ['KeyA'] }],
  durationMs: 1000,
  sourceStartMs: 0,
  speed: 1,
  loop: false,
  dropped: 0,
};

function mockBackend() {
  const calls: string[] = [];
  mockIPC((cmd) => {
    calls.push(cmd);
    return cmd === 'build_execution' ? execution : null;
  });
  return calls;
}

beforeEach(() => {
  vi.clearAllMocks();
  useScoreStore.setState(useScoreStore.getInitialState(), true);
  useAdaptStore.setState(useAdaptStore.getInitialState(), true);
  useTransportStore.setState(useTransportStore.getInitialState(), true);
});

describe('PlayPage', () => {
  it('没有乐谱时显示导入空状态，左栏隐藏', () => {
    render(<PlayPage />);
    expect(screen.getByText('导入乐谱开始')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /打开文件/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /粘贴键盘谱/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /粘贴简谱/ })).toBeInTheDocument();
    expect(screen.queryByText('目标乐器')).not.toBeInTheDocument();
  });

  it('导入乐谱后显示左栏各卡、虚拟琴键与乐谱页头', async () => {
    mockBackend();
    useScoreStore.getState().setScore(score);
    useAdaptStore.getState().resetToRecommended(score, lyre);
    render(<PlayPage />);
    expect(await screen.findByText('目标乐器')).toBeInTheDocument();
    expect(screen.getByText('音轨')).toBeInTheDocument();
    expect(screen.getByText('适配参数')).toBeInTheDocument();
    expect(screen.getByText('适配结果')).toBeInTheDocument();
    expect(screen.getByText('测试曲')).toBeInTheDocument();
    expect(screen.getByText('MIDI')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '键帽 Q C5' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '演奏' })).toBeEnabled();
  });

  it('点击演奏调用 play 命令', async () => {
    const calls = mockBackend();
    useScoreStore.getState().setScore(score);
    useAdaptStore.getState().resetToRecommended(score, lyre);
    const user = userEvent.setup();
    render(<PlayPage />);
    const playButton = await screen.findByRole('button', { name: '演奏' });
    await waitFor(() => expect(playButton).toBeEnabled());
    await user.click(playButton);
    await waitFor(() => expect(calls).toContain('play'));
    expect(calls).toContain('build_execution');
  });

  it('点击试听用当前执行时间线启动试听播放器', async () => {
    mockBackend();
    useScoreStore.getState().setScore(score);
    useAdaptStore.getState().resetToRecommended(score, lyre);
    const user = userEvent.setup();
    render(<PlayPage />);
    const previewButton = await screen.findByRole('button', { name: '试听' });
    await waitFor(() => expect(previewButton).toBeEnabled());
    await user.click(previewButton);
    expect(vi.mocked(previewPlayer.start)).toHaveBeenCalledWith(
      execution,
      lyre,
      expect.objectContaining({ onPosition: expect.any(Function), onEnded: expect.any(Function) }),
    );
  });

  it('试听进行中点击单独演奏：先停止试听再开始单轨演奏', async () => {
    const calls = mockBackend();
    useScoreStore.getState().setScore(score);
    useAdaptStore.getState().resetToRecommended(score, lyre);
    const user = userEvent.setup();
    render(<PlayPage />);
    const soloButton = await screen.findByRole('button', { name: `单独演奏 ${score.tracks[0].name}` });
    await waitFor(() => expect(soloButton).toBeEnabled());
    // 挂载后再进入试听状态，避免触发挂载时的参数变化停止试听副作用
    act(() => useTransportStore.setState({ previewing: true }));
    await user.click(soloButton);
    expect(vi.mocked(previewPlayer.stop)).toHaveBeenCalled();
    expect(useTransportStore.getState().previewing).toBe(false);
    expect(useTransportStore.getState().solo).toEqual({ mode: 'play', trackId: 't0' });
    await waitFor(() => expect(calls).toContain('play'));
  });

  it('演奏进行中导入菜单与目标乐器禁用', () => {
    useScoreStore.getState().setScore(score);
    useAdaptStore.getState().resetToRecommended(score, lyre);
    useTransportStore.setState({ playerState: { kind: 'playing' }, execution });
    render(<PlayPage />);
    expect(screen.getByRole('button', { name: /导入/ })).toBeDisabled();
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByText('演奏进行中，停止后才能修改')).toBeInTheDocument();
  });

  it('双击速度数值恢复 1.00×（设计 01 第 4.8 节）', async () => {
    useScoreStore.getState().setScore(score);
    useAdaptStore.getState().resetToRecommended(score, lyre);
    useTransportStore.getState().setSpeed(1.5);
    const user = userEvent.setup();
    render(<PlayPage />);
    const speedText = await screen.findByText('1.50×');
    await user.dblClick(speedText);
    expect(useTransportStore.getState().speed).toBe(1);
    expect(screen.getByText('1.00×')).toBeInTheDocument();
  });

  it('挂载后 500ms 内只请求一次执行时间线，防抖不随重渲染空转', async () => {
    vi.useFakeTimers();
    try {
      const calls = mockBackend();
      useScoreStore.getState().setScore(score);
      useAdaptStore.getState().resetToRecommended(score, lyre);
      render(<PlayPage />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(calls.filter((cmd) => cmd === 'build_execution')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
