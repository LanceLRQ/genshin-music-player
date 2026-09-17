import { describe, expect, it } from 'vitest';
import type { StatusTone } from '@/lib/playerStatus';
import type { PlayerState } from '@/ipc/types';
import { transportView } from './transportView';

const viewOf = (playerState: PlayerState, overrides: Partial<Parameters<typeof transportView>[0]> = {}) =>
  transportView({ playerState, previewing: false, hasTimeline: true, solo: false, toggleLabel: 'F9', ...overrides });

type TransportRow = readonly [
  string,
  { playerState?: PlayerState; hasTimeline?: boolean },
  Record<'preview' | 'play' | 'pause' | 'stop', boolean>,
  string,
  StatusTone,
  boolean,
];

describe('transportView（设计 01 第 4.9 节的状态表）', () => {
  it.each<TransportRow>([
    ['没有时间线', { hasTimeline: false }, { preview: false, play: false, pause: false, stop: false }, '空闲', 'gray', false],
    [
      '空闲',
      { playerState: { kind: 'idle' } },
      { preview: true, play: true, pause: false, stop: false },
      '空闲',
      'gray',
      false,
    ],
    [
      '倒计时',
      { playerState: { kind: 'countdown', remainingSec: 3 } },
      { preview: false, play: false, pause: true, stop: true },
      '倒计时 3 秒，请切换到游戏窗口',
      'amber',
      true,
    ],
    [
      '等待前台',
      { playerState: { kind: 'waitingFocus' } },
      { preview: false, play: false, pause: true, stop: true },
      '等待切换到原神窗口',
      'amber',
      true,
    ],
    [
      '演奏中',
      { playerState: { kind: 'playing' } },
      { preview: false, play: false, pause: true, stop: true },
      '演奏中',
      'green',
      true,
    ],
    [
      '已暂停（用户）',
      { playerState: { kind: 'paused', reason: 'user', positionMs: 100 } },
      { preview: false, play: true, pause: false, stop: true },
      '已暂停，按 F9 继续',
      'amber',
      true,
    ],
    [
      '已暂停（失去焦点）',
      { playerState: { kind: 'paused', reason: 'focusLost', positionMs: 100 } },
      { preview: false, play: true, pause: false, stop: true },
      '游戏窗口失去焦点，已暂停',
      'red',
      true,
    ],
    [
      '出错',
      { playerState: { kind: 'error', code: 'PLAYER_PANIC', message: '播放线程异常退出' } },
      { preview: true, play: true, pause: false, stop: false },
      '出错：播放线程异常退出',
      'red',
      false,
    ],
  ])('%s', (_name, input, buttons, statusText, tone, locked) => {
    const view = transportView({
      playerState: input.playerState ?? { kind: 'idle' },
      previewing: false,
      hasTimeline: input.hasTimeline ?? true,
      solo: false,
      toggleLabel: 'F9',
    });
    expect(view.preview.enabled).toBe(buttons.preview);
    expect(view.play.enabled).toBe(buttons.play);
    expect(view.pause.enabled).toBe(buttons.pause);
    expect(view.stop.enabled).toBe(buttons.stop);
    expect(view.status).toEqual({ text: statusText, tone });
    expect(view.locked).toBe(locked);
  });

  it('试听中：试听按钮变为停止试听，停止可用，状态为蓝色', () => {
    const view = viewOf({ kind: 'idle' }, { previewing: true });
    expect(view.preview).toEqual({ enabled: true, label: '停止试听' });
    expect(view.stop.enabled).toBe(true);
    expect(view.play.enabled).toBe(false);
    expect(view.pause.enabled).toBe(false);
    expect(view.status).toEqual({ text: '试听中', tone: 'blue' });
    expect(view.locked).toBe(false);
  });

  it('出错时演奏按钮文案变为重新开始', () => {
    const view = viewOf({ kind: 'error', code: 'NO_EXECUTION', message: '还没有准备好的演奏' });
    expect(view.play).toEqual({ enabled: true, label: '重新开始' });
    expect(view.preview.enabled).toBe(true);
  });
});

describe('transportView（单轨，设计 01 第 4.10 节）', () => {
  it('单轨试听中：主试听按钮禁用，状态仍是试听中', () => {
    const view = viewOf({ kind: 'idle' }, { previewing: true, solo: true });
    expect(view.preview).toEqual({ enabled: false, label: '停止试听' });
    expect(view.stop.enabled).toBe(true);
    expect(view.status).toEqual({ text: '试听中', tone: 'blue' });
  });

  it('单轨演奏中：试听和演奏禁用，状态为演奏中', () => {
    const view = viewOf({ kind: 'playing' }, { solo: true });
    expect(view.preview.enabled).toBe(false);
    expect(view.play.enabled).toBe(false);
    expect(view.status).toEqual({ text: '演奏中', tone: 'green' });
  });

  it('单轨暂停时演奏按钮作为继续可用', () => {
    const view = viewOf({ kind: 'paused', reason: 'user', positionMs: 0 }, { solo: true });
    expect(view.play).toEqual({ enabled: true, label: '继续' });
    expect(view.stop.enabled).toBe(true);
  });
});

describe('transportView（热键提示）', () => {
  it('暂停状态的文字使用传入的热键显示文字', () => {
    const view = viewOf({ kind: 'paused', reason: 'user', positionMs: 0 }, { toggleLabel: 'Ctrl+F8' });
    expect(view.status.text).toBe('已暂停，按 Ctrl+F8 继续');
  });

  it('toggleLabel 缺省时按 F9 显示', () => {
    expect(transportView({ playerState: { kind: 'paused', reason: 'user', positionMs: 0 }, previewing: false, hasTimeline: true }).status.text).toBe(
      '已暂停，按 F9 继续',
    );
  });
});
