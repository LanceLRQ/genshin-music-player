import type { PlayerState } from '@/ipc/types';

/** 状态颜色，与界面交互设计第 4.9 节一致；blue 留给演奏页的"试听中" */
export type StatusTone = 'gray' | 'blue' | 'amber' | 'green' | 'red';

export const STATUS_DOT_CLASS: Record<StatusTone, string> = {
  gray: 'bg-muted-foreground',
  blue: 'bg-sky-500',
  amber: 'bg-amber-500',
  green: 'bg-emerald-500',
  red: 'bg-red-500',
};

/** 演奏流程进行中（倒计时、等待前台、演奏中、已暂停）：界面锁定参数，侧边栏显示状态点 */
export function isPlayerActive(state: PlayerState): boolean {
  return state.kind === 'countdown' || state.kind === 'waitingFocus' || state.kind === 'playing' || state.kind === 'paused';
}

export function playerStateTone(state: PlayerState): StatusTone {
  switch (state.kind) {
    case 'idle':
      return 'gray';
    case 'countdown':
    case 'waitingFocus':
      return 'amber';
    case 'playing':
      return 'green';
    case 'paused':
      return state.reason === 'focusLost' ? 'red' : 'amber';
    case 'error':
      return 'red';
  }
}

/** 简短的状态名称，用于状态点的无障碍标签和提示 */
export function playerStateLabel(state: PlayerState): string {
  switch (state.kind) {
    case 'idle':
      return '空闲';
    case 'countdown':
      return `倒计时 ${state.remainingSec} 秒`;
    case 'waitingFocus':
      return '等待切换到游戏窗口';
    case 'playing':
      return '演奏中';
    case 'paused':
      return state.reason === 'focusLost' ? '游戏窗口失去焦点，已暂停' : '已暂停';
    case 'error':
      return '出错';
  }
}
