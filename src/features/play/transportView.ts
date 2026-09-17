import type { StatusTone } from '@/lib/playerStatus';
import type { PlayerState } from '@/ipc/types';

export interface TransportButtonView {
  enabled: boolean;
  label: string;
}

export interface TransportStatusView {
  text: string;
  tone: StatusTone;
}

export interface TransportViewInput {
  playerState: PlayerState;
  /** 前端试听是否进行中 */
  previewing: boolean;
  /** 是否有可弹的执行时间线 */
  hasTimeline: boolean;
  /** 是否正在单轨试听或单轨演奏 */
  solo: boolean;
  /** 全局热键「开始 / 暂停」的显示文字（已做平台换算），用于暂停状态提示 */
  toggleLabel: string;
}

export interface TransportView {
  preview: TransportButtonView;
  play: TransportButtonView;
  pause: TransportButtonView;
  stop: TransportButtonView;
  status: TransportStatusView;
  /** 演奏流程进行中：导入、乐器、音轨、参数、区间全部锁定 */
  locked: boolean;
}

/** 播放控制区四个按钮与状态文字（设计 01 第 4.9 节的状态表） */
export function transportView({
  playerState = { kind: 'idle' },
  previewing = false,
  hasTimeline = false,
  solo = false,
  toggleLabel = 'F9',
}: Partial<TransportViewInput>): TransportView {
  const view: TransportView = {
    preview: { enabled: false, label: '试听' },
    play: { enabled: false, label: '演奏' },
    pause: { enabled: false, label: '暂停' },
    stop: { enabled: false, label: '停止' },
    status: { text: '空闲', tone: 'gray' },
    locked: false,
  };
  if (!hasTimeline) return view;
  if (previewing) {
    view.preview = { enabled: true, label: '停止试听' };
    view.stop = { enabled: true, label: '停止' };
    view.status = { text: '试听中', tone: 'blue' };
    if (solo) view.preview.enabled = false;
    return view;
  }
  switch (playerState.kind) {
    case 'idle':
      view.preview.enabled = true;
      view.play.enabled = true;
      break;
    case 'error':
      view.preview.enabled = true;
      view.play = { enabled: true, label: '重新开始' };
      view.status = { text: `出错：${playerState.message}`, tone: 'red' };
      break;
    case 'countdown':
      view.pause = { enabled: true, label: '取消' };
      view.stop.enabled = true;
      view.status = { text: `倒计时 ${playerState.remainingSec} 秒，请切换到游戏窗口`, tone: 'amber' };
      view.locked = true;
      break;
    case 'waitingFocus':
      view.pause = { enabled: true, label: '取消' };
      view.stop.enabled = true;
      view.status = { text: '等待切换到原神窗口', tone: 'amber' };
      view.locked = true;
      break;
    case 'playing':
      view.pause.enabled = true;
      view.stop.enabled = true;
      view.status = { text: '演奏中', tone: 'green' };
      view.locked = true;
      break;
    case 'paused':
      view.play = { enabled: true, label: '继续' };
      view.stop.enabled = true;
      view.status =
        playerState.reason === 'focusLost'
          ? { text: '游戏窗口失去焦点，已暂停', tone: 'red' }
          : { text: `已暂停，按 ${toggleLabel} 继续`, tone: 'amber' };
      view.locked = true;
      break;
  }
  if (solo) {
    view.preview.enabled = false;
    view.play.enabled = playerState.kind === 'paused';
  }
  return view;
}
