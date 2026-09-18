import { useEffect } from 'react';
import * as commands from '@/ipc/commands';
import { type HotkeyAction, onHotkeyAction } from '@/ipc/events';
import { useAdaptStore } from '@/stores/adaptStore';
import { useInstrumentStore } from '@/stores/instrumentStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTransportStore } from '@/stores/transportStore';

/**
 * 模拟发声模式的全局热键接管（后端不再驱动播放器，只转发 hotkey://action）：
 * toggle = 开始 / 停止试听，stop = 停止试听并兜底停掉后端演奏。
 * 模拟发声关闭时不做任何事（keys 模式下后端自己处理热键）；
 * 不在 Tauri 窗口中运行时静默跳过，订阅失败也不提示（IPC_UNAVAILABLE 由顶部横幅兜底）。
 */
export function useSoundModeHotkeys(): void {
  useEffect(() => {
    if (!commands.hasTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const handleAction = async (action: HotkeyAction) => {
      if (!(useSettingsStore.getState().settings?.simulateSound ?? false)) return;
      const transport = useTransportStore.getState();
      if (action === 'stop') {
        if (transport.previewing) void transport.stopPreview();
        // 兜底停掉可能仍在发键的后端演奏（fire-and-forget：stop 热键不重开试听，无需等待）
        commands.stop().catch(() => undefined);
        return;
      }
      if (transport.previewing) {
        void transport.stopPreview();
        return;
      }
      // 空闲时先兜底停掉后端可能残留的演奏。必须 await：后端在播放线程处理 stop 时同步 emit
      // player://state: idle，await 返回时该事件已被 setPlayerState 消化（此刻 previewing 还是
      // false，清试听逻辑无害）；先 stop 再 startPreview，试听才不会被随后的 idle 事件掐掉
      await commands.stop().catch(() => undefined);
      const currentProfile = useInstrumentStore
        .getState()
        .entries.find((entry) => entry.profile.id === useAdaptStore.getState().targetId)?.profile;
      if (currentProfile) useTransportStore.getState().startPreview(currentProfile);
    };

    onHotkeyAction(handleAction)
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}
