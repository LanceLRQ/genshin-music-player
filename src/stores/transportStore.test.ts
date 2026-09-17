import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { previewPlayer } from '@/audio/previewPlayer';
import { BUILTIN_INSTRUMENTS } from '@/core/instruments/registry';
import type { KeyTimeline } from '@/core/model/timeline';
import type { ExecutionTimeline, Summary } from '@/ipc/types';
import { executionParams, useTransportStore, VOLUME_STORAGE_KEY } from './transportStore';

vi.mock('@/audio/previewPlayer', () => ({
  previewPlayer: {
    start: vi.fn(),
    stop: vi.fn(),
    playKey: vi.fn(),
    setVolume: vi.fn(),
    playing: false,
  },
}));

const lyre = BUILTIN_INSTRUMENTS[0];
const progress = { positionMs: 500, sourcePositionMs: 1100 };
const summary: Summary = {
  completed: false,
  eventsSent: 12,
  latenessP50Ms: 0.4,
  latenessP95Ms: 2.1,
  latenessMaxMs: 9,
  dropped: 1,
  logPath: '/data/logs/exec-1.jsonl',
};
const timeline: KeyTimeline = {
  instrumentId: 'windsong-lyre',
  durationMs: 1000,
  minRepeatGapMs: 40,
  presses: [
    { tMs: 0, codes: ['KeyA'], holdMs: 30 },
    { tMs: 500, codes: ['KeyS'], holdMs: 30 },
  ],
};
const soloTimeline: KeyTimeline = { ...timeline, presses: [{ tMs: 0, codes: ['KeyA'], holdMs: 30 }] };
const execution: ExecutionTimeline = {
  instrumentId: 'windsong-lyre',
  events: [{ tMs: 0, up: [], down: ['KeyA'] }, { tMs: 1000, up: ['KeyA'], down: [] }],
  durationMs: 1000,
  sourceStartMs: 0,
  speed: 1,
  loop: false,
  dropped: 0,
};

function recordIPC() {
  const calls: { cmd: string; args: unknown }[] = [];
  mockIPC((cmd, args) => {
    calls.push({ cmd, args });
    // build_execution 需要返回有效负载，否则 store 会把 null 存进 execution
    return cmd === 'build_execution' ? execution : null;
  });
  return calls;
}

/** 记录 build_execution 的调用次数并返回固定结果 */
function countBuilds(result: ExecutionTimeline = execution) {
  const calls: string[] = [];
  mockIPC((cmd) => {
    calls.push(cmd);
    return cmd === 'build_execution' ? result : null;
  });
  return calls;
}

beforeEach(() => {
  useTransportStore.setState(useTransportStore.getInitialState(), true);
});

afterEach(() => {
  clearMocks();
  vi.restoreAllMocks();
});

describe('transportStore（M3b 既有行为）', () => {
  it('初始为空闲，没有进度和演奏统计', () => {
    expect(useTransportStore.getState()).toMatchObject({
      playerState: { kind: 'idle' },
      progress: null,
      summary: null,
      execution: null,
      solo: null,
    });
  });

  it('进入空闲、出错、倒计时时清空进度，演奏中和暂停时保留', () => {
    const { setPlayerState, setProgress } = useTransportStore.getState();
    const keeps = [
      { kind: 'playing' },
      { kind: 'paused', reason: 'user', positionMs: 500 },
      { kind: 'waitingFocus' },
    ] as const;
    const clears = [
      { kind: 'idle' },
      { kind: 'error', code: 'PLAYER_PANIC', message: '播放线程异常退出，已松开所有按键' },
      { kind: 'countdown', remainingSec: 3 },
    ] as const;
    for (const state of keeps) {
      setProgress(progress);
      setPlayerState(state);
      expect(useTransportStore.getState()).toMatchObject({ playerState: state, progress });
    }
    for (const state of clears) {
      setProgress(progress);
      setPlayerState(state);
      expect(useTransportStore.getState()).toMatchObject({ playerState: state, progress: null });
    }
  });

  it('setSummary 保存最近一次演奏统计', () => {
    useTransportStore.getState().setSummary(summary);
    expect(useTransportStore.getState().summary).toEqual(summary);
  });

  it('play 调用 play 命令并带上倒计时', async () => {
    const calls = recordIPC();
    await expect(useTransportStore.getState().play(0)).resolves.toBe(true);
    expect(calls).toEqual([{ cmd: 'play', args: { countdownSec: 0 } }]);
  });

  it.each(['pause', 'resume', 'stop'] as const)('%s 调用同名命令', async (action) => {
    const calls = recordIPC();
    await expect(useTransportStore.getState()[action]()).resolves.toBe(true);
    expect(calls.map((call) => call.cmd)).toEqual([action]);
  });

  it('命令失败时用 toast 提示并返回 false', async () => {
    mockIPC(() => Promise.reject({ code: 'PLAYER_BUSY', message: '正在演奏中，请先停止' }));
    const spy = vi.spyOn(toast, 'error');
    await expect(useTransportStore.getState().play()).resolves.toBe(false);
    expect(spy).toHaveBeenCalledWith('无法开始演奏：正在演奏中，请先停止');
  });
});

describe('transportStore（执行时间线）', () => {
  it('executionParams 组装执行参数，整曲的区间终点收敛到时间线时长', () => {
    expect(
      executionParams(timeline, {
        speed: 1.5,
        humanizeMs: 12,
        seed: 7,
        range: { startMs: 0, endMs: 235000 },
        loop: true,
      }),
    ).toEqual({
      speed: 1.5,
      humanize: { maxJitterMs: 12, seed: 7 },
      range: { startMs: 0, endMs: 1000, loop: true },
    });
  });

  it('syncExecution 调用 build_execution 并保存执行时间线与主时间线', async () => {
    const calls = recordIPC();
    await useTransportStore.getState().syncExecution(timeline);
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe('build_execution');
    expect(calls[0].args).toEqual({
      timeline,
      params: executionParams(timeline, useTransportStore.getState()),
    });
    expect(useTransportStore.getState()).toMatchObject({ execution, mainTimeline: timeline });
  });

  it('syncExecution 没有按键时不调用后端，清空执行时间线', async () => {
    const calls = recordIPC();
    await useTransportStore.getState().syncExecution({ ...timeline, presses: [] });
    expect(calls).toEqual([]);
    expect(useTransportStore.getState().execution).toBeNull();
  });

  it('syncExecution 失败时清空执行时间线并 toast', async () => {
    mockIPC(() => Promise.reject({ code: 'TIMELINE_INVALID', message: '区间无效' }));
    const spy = vi.spyOn(toast, 'error');
    await useTransportStore.getState().syncExecution(timeline);
    expect(useTransportStore.getState().execution).toBeNull();
    expect(spy).toHaveBeenCalledWith('无法生成执行时间线：区间无效');
  });
});

describe('transportStore（单轨）', () => {
  it('startSolo 生成单轨时间线并标记 solo，不覆盖主时间线', async () => {
    const calls = countBuilds();
    await useTransportStore.getState().syncExecution(timeline);
    const started = await useTransportStore.getState().startSolo({ mode: 'preview', trackId: 't0' }, soloTimeline);
    expect(started).toBe(true);
    expect(calls.filter((cmd) => cmd === 'build_execution')).toHaveLength(2);
    expect(useTransportStore.getState()).toMatchObject({
      solo: { mode: 'preview', trackId: 't0' },
      mainTimeline: timeline,
    });
  });

  it('单轨在当前区间没有可弹的音时 startSolo 返回 false 且不标记', async () => {
    const calls = countBuilds();
    const started = await useTransportStore.getState().startSolo({ mode: 'play', trackId: 't0' }, { ...timeline, presses: [] });
    expect(started).toBe(false);
    expect(calls).toEqual([]);
    expect(useTransportStore.getState().solo).toBeNull();
  });

  it('endSolo 清除单轨并用主时间线重建后端缓存', async () => {
    const calls = countBuilds();
    await useTransportStore.getState().syncExecution(timeline);
    await useTransportStore.getState().startSolo({ mode: 'play', trackId: 't0' }, soloTimeline);
    await useTransportStore.getState().endSolo();
    expect(useTransportStore.getState().solo).toBeNull();
    expect(calls.filter((cmd) => cmd === 'build_execution')).toHaveLength(3);
  });
});

describe('transportStore（试听）', () => {
  it('startPreview 用当前执行时间线启动试听播放器', async () => {
    countBuilds();
    await useTransportStore.getState().syncExecution(timeline);
    useTransportStore.getState().startPreview(lyre);
    expect(vi.mocked(previewPlayer.start)).toHaveBeenCalledWith(
      execution,
      lyre,
      expect.objectContaining({ onPosition: expect.any(Function), onEnded: expect.any(Function) }),
    );
    expect(useTransportStore.getState().previewing).toBe(true);
  });

  it('试听自然结束：清试听状态，单轨试听结束后自动恢复主时间线', async () => {
    const calls = countBuilds();
    await useTransportStore.getState().syncExecution(timeline);
    await useTransportStore.getState().startSolo({ mode: 'preview', trackId: 't0' }, soloTimeline);
    useTransportStore.getState().startPreview(lyre);
    await useTransportStore.getState().finishPreview();
    expect(useTransportStore.getState()).toMatchObject({ previewing: false, previewPositionMs: 0, solo: null });
    expect(calls.filter((cmd) => cmd === 'build_execution')).toHaveLength(3);
  });

  it('试听中途停止：清试听状态，单轨试听同样恢复主时间线', async () => {
    const calls = countBuilds();
    await useTransportStore.getState().syncExecution(timeline);
    await useTransportStore.getState().startSolo({ mode: 'preview', trackId: 't0' }, soloTimeline);
    useTransportStore.getState().startPreview(lyre);
    await useTransportStore.getState().stopPreview();
    expect(vi.mocked(previewPlayer.stop)).toHaveBeenCalled();
    expect(useTransportStore.getState().solo).toBeNull();
    expect(calls.filter((cmd) => cmd === 'build_execution')).toHaveLength(3);
  });

  it('单轨演奏结束回到空闲或出错时，清除单轨并恢复主时间线', async () => {
    const calls = countBuilds();
    await useTransportStore.getState().syncExecution(timeline);
    await useTransportStore.getState().startSolo({ mode: 'play', trackId: 't0' }, soloTimeline);
    useTransportStore.getState().setPlayerState({ kind: 'idle' });
    await vi.waitFor(() => expect(useTransportStore.getState().solo).toBeNull());
    expect(calls.filter((cmd) => cmd === 'build_execution')).toHaveLength(3);
    expect(useTransportStore.getState().previewing).toBe(false);
  });
});

describe('transportStore（参数与音量）', () => {
  it('resetForScore 重置区间、速度与统计，重新生成种子，保留音量', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    useTransportStore.setState({
      speed: 1.5,
      loop: true,
      summary,
      solo: { mode: 'preview', trackId: 't0' },
      volume: 0.4,
      execution,
    });
    useTransportStore.getState().resetForScore({ startMs: 0, endMs: 5000 }, 8);
    expect(useTransportStore.getState()).toMatchObject({
      range: { startMs: 0, endMs: 5000 },
      loop: false,
      speed: 1,
      humanizeMs: 8,
      seed: Math.floor(0.5 * 2 ** 31),
      execution: null,
      solo: null,
      summary: null,
      previewing: false,
    });
    expect(useTransportStore.getState().volume).toBe(0.4);
    randomSpy.mockRestore();
  });

  it('setRange / setLoop / setSpeed / setHumanizeMs 保存参数', () => {
    useTransportStore.getState().setRange({ startMs: 200, endMs: 800 });
    useTransportStore.getState().setLoop(true);
    useTransportStore.getState().setSpeed(1.25);
    useTransportStore.getState().setHumanizeMs(10);
    expect(useTransportStore.getState()).toMatchObject({
      range: { startMs: 200, endMs: 800 },
      loop: true,
      speed: 1.25,
      humanizeMs: 10,
    });
  });

  it('setVolume 写入 localStorage 并同步试听播放器', () => {
    useTransportStore.getState().setVolume(0.3);
    expect(localStorage.getItem(VOLUME_STORAGE_KEY)).toBe('0.3');
    expect(vi.mocked(previewPlayer.setVolume)).toHaveBeenCalledWith(0.3);
    expect(useTransportStore.getState().volume).toBe(0.3);
  });
});
