import { useEffect } from 'react';
import { getPlayerState, toAppError } from '@/ipc/commands';
import { type Unlisten, onPlayerProgress, onPlayerState, onPlayerSummary } from '@/ipc/events';
import type { PlayerState } from '@/ipc/types';
import { notifyError } from '@/lib/notify';
import { useTransportStore } from '@/stores/transportStore';

/**
 * 在 App 挂载时调用一次：先订阅三个 player:// 事件，订阅完成后再读取 get_player_state 恢复刷新前的状态，
 * 消除读取返回与订阅完成之间丢事件的窗口；若读取 resolve 之前已收到过状态事件，迟到的快照将被丢弃。
 * 不在 Tauri 窗口中运行时静默跳过（顶部横幅已经提示无法连接后端）。
 */
export function usePlayerEvents(): void {
  useEffect(() => {
    let disposed = false;
    let receivedStateEvent = false;
    const unlisteners: Unlisten[] = [];
    const { setPlayerState, setProgress, setSummary } = useTransportStore.getState();
    const onState = (state: PlayerState) => {
      receivedStateEvent = true;
      setPlayerState(state);
    };
    const subscriptions = [
      () => onPlayerState(onState),
      () => onPlayerProgress(setProgress),
      () => onPlayerSummary(setSummary),
    ];

    const start = async () => {
      try {
        for (const subscribe of subscriptions) {
          const unlisten = await subscribe();
          if (disposed) {
            unlisten();
            return;
          }
          unlisteners.push(unlisten);
        }
        const state = await getPlayerState();
        if (disposed || receivedStateEvent) return;
        setPlayerState(state);
      } catch (error) {
        // 订阅中途失败时，取消已经建立的订阅，不能让它们存活到卸载
        for (const unlisten of unlisteners.splice(0)) unlisten();
        throw error;
      }
    };

    start().catch((error: unknown) => {
      const appError = toAppError(error);
      if (appError.code !== 'IPC_UNAVAILABLE') notifyError(appError, '无法同步播放器状态');
    });

    return () => {
      disposed = true;
      for (const unlisten of unlisteners.splice(0)) unlisten();
    };
  }, []);
}
