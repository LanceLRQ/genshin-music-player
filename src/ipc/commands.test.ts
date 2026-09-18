import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { afterEach, describe, expect, it } from 'vitest';
import * as commands from './commands';
import { AppError, DEFAULT_SETTINGS, type EnvInfo, type ExecutionParams, type KeyTimeline } from './types';

afterEach(() => {
  clearMocks();
});

interface Call {
  cmd: string;
  args: unknown;
}

function recordIPC(response: unknown = null): Call[] {
  const calls: Call[] = [];
  mockIPC((cmd, args) => {
    calls.push({ cmd, args });
    return response;
  });
  return calls;
}

const timeline: KeyTimeline = {
  instrumentId: 'windsong-lyre',
  durationMs: 30,
  minRepeatGapMs: 40,
  presses: [{ tMs: 0, codes: ['KeyA'], holdMs: 30 }],
};
const params: ExecutionParams = {
  speed: 1,
  humanize: { maxJitterMs: 0, seed: 7 },
  range: { startMs: 0, endMs: 30, loop: false },
};

describe('IPC 命令', () => {
  it.each<[string, () => Promise<unknown>, unknown]>([
    ['get_env', () => commands.getEnv(), {}],
    ['restart_as_admin', () => commands.restartAsAdmin(), {}],
    ['list_custom_instruments', () => commands.listCustomInstruments(), {}],
    ['save_custom_instrument', () => commands.saveCustomInstrument({ id: 'my-lyre' }), { profile: { id: 'my-lyre' } }],
    ['delete_custom_instrument', () => commands.deleteCustomInstrument('my-lyre'), { id: 'my-lyre' }],
    ['get_settings', () => commands.getSettings(), {}],
    ['save_settings', () => commands.saveSettings(DEFAULT_SETTINGS), { settings: DEFAULT_SETTINGS }],
    ['build_execution', () => commands.buildExecution(timeline, params), { timeline, params }],
    ['play', () => commands.play(5), { countdownSec: 5 }],
    ['pause', () => commands.pause(), {}],
    ['resume', () => commands.resume(), {}],
    ['stop', () => commands.stop(), {}],
    ['get_player_state', () => commands.getPlayerState(), {}],
  ])('%s：命令名和参数与后端约定一致', async (cmd, run, args) => {
    const calls = recordIPC();
    await run();
    expect(calls).toEqual([{ cmd, args }]);
  });

  it('play 不传倒计时时参数里没有 countdownSec', async () => {
    const calls = recordIPC();
    await commands.play();
    expect(calls[0].args).toStrictEqual({});
  });

  it('返回后端的结果', async () => {
    const env: EnvInfo = {
      platform: 'macos',
      backend: 'mock',
      elevated: null,
      trusted: null,
      appVersion: '0.1.0',
      dataDir: '/data',
      logsDir: '/data/logs',
      startupWarnings: [],
    };
    recordIPC(env);
    await expect(commands.getEnv()).resolves.toEqual(env);
  });
});

describe('IPC 错误', () => {
  const rejectWith = (error: unknown) => mockIPC(() => Promise.reject(error));

  it('后端的 { code, message } 转成带错误码的 AppError', async () => {
    rejectWith({ code: 'PLAYER_BUSY', message: '正在演奏中，请先停止' });
    const error = await commands.play().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'PLAYER_BUSY', message: '正在演奏中，请先停止' });
  });

  it('无法识别的错误码归为 UNKNOWN，并保留信息', async () => {
    rejectWith({ code: 'SOMETHING_NEW', message: '新的错误' });
    await expect(commands.stop()).rejects.toMatchObject({ code: 'UNKNOWN', message: '新的错误' });
  });

  it('字符串错误转成 UNKNOWN', async () => {
    rejectWith('command get_env not found');
    await expect(commands.getEnv()).rejects.toMatchObject({ code: 'UNKNOWN', message: 'command get_env not found' });
  });

  it('没有 Tauri 运行时时不调用 invoke，直接报 IPC_UNAVAILABLE', async () => {
    expect(commands.hasTauriRuntime()).toBe(false);
    await expect(commands.getSettings()).rejects.toMatchObject({
      code: 'IPC_UNAVAILABLE',
      message: commands.IPC_UNAVAILABLE_MESSAGE,
    });
    recordIPC();
    expect(commands.hasTauriRuntime()).toBe(true);
  });

  it('toAppError：AppError 原样返回，Error 取 message，其他值转成文字', () => {
    const appError = new AppError('STORAGE_IO', '读写文件失败');
    expect(commands.toAppError(appError)).toBe(appError);
    expect(commands.toAppError(new Error('boom'))).toMatchObject({ code: 'UNKNOWN', message: 'boom' });
    expect(commands.toAppError(42)).toMatchObject({ code: 'UNKNOWN', message: '42' });
  });
});
