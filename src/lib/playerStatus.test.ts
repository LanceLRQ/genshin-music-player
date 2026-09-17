import { describe, expect, it } from 'vitest';
import type { PlayerState } from '@/ipc/types';
import { isPlayerActive, playerStateLabel, playerStateTone } from './playerStatus';

describe('播放器状态的显示', () => {
  it.each<[PlayerState, boolean, string, string]>([
    [{ kind: 'idle' }, false, 'gray', '空闲'],
    [{ kind: 'countdown', remainingSec: 3 }, true, 'amber', '倒计时 3 秒'],
    [{ kind: 'waitingFocus' }, true, 'amber', '等待切换到游戏窗口'],
    [{ kind: 'playing' }, true, 'green', '演奏中'],
    [{ kind: 'paused', reason: 'user', positionMs: 10 }, true, 'amber', '已暂停'],
    [{ kind: 'paused', reason: 'focusLost', positionMs: 10 }, true, 'red', '游戏窗口失去焦点，已暂停'],
    [{ kind: 'error', code: 'PLAYER_PANIC', message: '播放线程异常退出' }, false, 'red', '出错'],
  ])('%o：进行中 %s，颜色 %s，名称 %s', (state, active, tone, label) => {
    expect(isPlayerActive(state)).toBe(active);
    expect(playerStateTone(state)).toBe(tone);
    expect(playerStateLabel(state)).toBe(label);
  });
});
