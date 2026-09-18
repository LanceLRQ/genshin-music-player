import { Headphones, Info, Pause, Play, Square, TriangleAlert, X } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { DEFAULT_SETTINGS } from '@/ipc/types';
import { STATUS_DOT_CLASS } from '@/lib/playerStatus';
import { displayShortcut, guessPlatform } from '@/lib/shortcuts';
import { cn } from '@/lib/utils';
import { useEnvStore } from '@/stores/envStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTransportStore } from '@/stores/transportStore';
import { transportView } from './transportView';

interface TransportBarProps {
  /** 单轨音轨名；非单轨时为 null */
  soloTrackName: string | null;
  onPreviewToggle: () => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  /** 单轨标记的 ✕，等同于停止 */
  onSoloCancel: () => void;
}

/** 播放控制条：按钮、状态行、热键提示、单轨徽章与失去焦点警示（设计 01 第 4.9、4.10 节） */
export function TransportBar({ soloTrackName, onPreviewToggle, onPlay, onPause, onStop, onSoloCancel }: TransportBarProps) {
  const playerState = useTransportStore((state) => state.playerState);
  const previewing = useTransportStore((state) => state.previewing);
  const solo = useTransportStore((state) => state.solo);
  const execution = useTransportStore((state) => state.execution);
  const settings = useSettingsStore((state) => state.settings);
  const envPlatform = useEnvStore((state) => state.env?.platform);
  const platform = envPlatform ?? guessPlatform(navigator.userAgent);
  const hotkeys = settings?.hotkeys ?? DEFAULT_SETTINGS.hotkeys;
  const toggleLabel = displayShortcut(hotkeys.toggle, platform);
  const view = transportView({
    playerState,
    previewing,
    hasTimeline: !!execution && execution.events.length > 0,
    solo: solo !== null,
    toggleLabel,
  });
  return (
    <div className="flex flex-col gap-3">
      {playerState.kind === 'paused' && playerState.reason === 'focusLost' && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>游戏窗口失去焦点，已暂停并松开所有按键。</AlertTitle>
          <AlertDescription>
            切回游戏后按 <Kbd>{toggleLabel}</Kbd> 继续，或回到这里点击「继续」。
          </AlertDescription>
        </Alert>
      )}
      {solo !== null && (
        <div>
          <Badge variant="outline" className="gap-1.5">
            {solo.mode === 'preview' ? '单独试听' : '单独演奏'}：{soloTrackName ?? solo.trackId}
            <button type="button" aria-label="停止单轨" className="rounded-sm" onClick={onSoloCancel}>
              <X className="size-3" />
            </button>
          </Badge>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" disabled={!view.preview.enabled} onClick={onPreviewToggle}>
          <Headphones className="size-4" />
          {view.preview.label}
        </Button>
        <Button disabled={!view.play.enabled} onClick={onPlay}>
          <Play className="size-4" />
          {view.play.label}
        </Button>
        <Button variant="secondary" disabled={!view.pause.enabled} onClick={onPause}>
          <Pause className="size-4" />
          {view.pause.label}
        </Button>
        <Button variant="outline" disabled={!view.stop.enabled} onClick={onStop}>
          <Square className="size-4" />
          {view.stop.label}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="flex items-center gap-1.5">
          <span className={cn('size-2 rounded-full', STATUS_DOT_CLASS[view.status.tone])} />
          <span>{view.status.text}</span>
        </span>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Kbd>{toggleLabel}</Kbd>
          开始/暂停 ·
          <Kbd>{displayShortcut(hotkeys.stop, platform)}</Kbd>
          停止
        </span>
        {view.locked && (
          <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
            <Info className="size-3.5" />
            演奏进行中，停止后才能修改
          </span>
        )}
        {settings?.simulateSound && <Badge variant="outline">模拟发声</Badge>}
      </div>
    </div>
  );
}
