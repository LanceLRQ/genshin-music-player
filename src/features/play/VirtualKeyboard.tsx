import { Keyboard, Music2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { previewPlayer } from '@/audio/previewPlayer';
import { activeCodesAt } from '@/audio/schedule';
import { Card, CardContent } from '@/components/ui/card';
import { Kbd } from '@/components/ui/kbd';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { keyLabel } from '@/core/model/keycodes';
import type { InstrumentKey, InstrumentProfile } from '@/core/model/instrument';
import { midiToNoteName } from '@/core/music/pitch';
import { isPlayerActive } from '@/lib/playerStatus';
import { cn } from '@/lib/utils';
import { useAdaptStore } from '@/stores/adaptStore';
import { useInstrumentStore } from '@/stores/instrumentStore';
import { useTransportStore } from '@/stores/transportStore';
import { FallingNotesView } from './FallingNotesView';
import { voiceLabel } from './scoreInfo';

/** 乐器预览卡的两个视图：键帽（默认）与落音预览；选择记忆在 localStorage */
type PreviewView = 'keycaps' | 'falling';
const PREVIEW_VIEW_STORAGE_KEY = 'previewView';

function readStoredView(): PreviewView {
  try {
    return localStorage.getItem(PREVIEW_VIEW_STORAGE_KEY) === 'falling' ? 'falling' : 'keycaps';
  } catch {
    return 'keycaps';
  }
}

/** 键帽：上方键帽字母，下方音名或音色（设计 01 第 4.7 节） */
function Keycap({ profile, code, active, disabled, onPlay }: {
  profile: InstrumentProfile;
  code: string;
  active: boolean;
  disabled: boolean;
  onPlay: (code: string) => void;
}) {
  const key = profile.rows.flatMap((row) => row.keys).find((candidate) => candidate.code === code);
  if (!key) return null;
  const sub = key.pitch !== undefined ? midiToNoteName(key.pitch) : voiceLabel(key.voice ?? '');
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`键帽 ${keyLabel(key.code)} ${sub}`}
      onClick={() => onPlay(key.code)}
      className={cn(
        'flex h-16 w-14 flex-col items-center justify-center gap-1 rounded-lg border bg-card transition-colors',
        active && 'border-primary bg-primary/15',
      )}
    >
      <Kbd>{keyLabel(key.code)}</Kbd>
      <span className="text-[10px] text-muted-foreground">{sub}</span>
    </button>
  );
}

/**
 * 虚拟琴键（设计 01 第 4.7 节）：试听与演奏按执行时间线高亮，倒计时 / 等待前台时显示覆盖层。
 * 卡片右上角可在键帽 / 落音两个视图间随时切换——只是换一种显示，不影响进行中的播放。
 */
export function VirtualKeyboard() {
  const targetId = useAdaptStore((state) => state.targetId);
  const profile = useInstrumentStore((state) => state.entries.find((entry) => entry.profile.id === targetId)?.profile);
  const playerState = useTransportStore((state) => state.playerState);
  const execution = useTransportStore((state) => state.execution);
  const previewing = useTransportStore((state) => state.previewing);
  const previewPositionMs = useTransportStore((state) => state.previewPositionMs);
  const progress = useTransportStore((state) => state.progress);
  const [view, setView] = useState<PreviewView>(readStoredView);

  const playingLike = isPlayerActive(playerState);
  const positionMs = previewing ? previewPositionMs : (progress?.positionMs ?? 0);
  const activeCodes = useMemo(
    () =>
      execution && (previewing || playerState.kind === 'playing')
        ? activeCodesAt(execution, positionMs)
        : new Set<string>(),
    [execution, previewing, playerState.kind, positionMs],
  );

  if (!profile) return null;
  const selectView = (next: PreviewView) => {
    setView(next);
    try {
      localStorage.setItem(PREVIEW_VIEW_STORAGE_KEY, next);
    } catch {
      // 本地存储不可用时只在本次运行中生效
    }
  };

  return (
    <Card className="relative gap-0 py-4">
      <CardContent className="flex flex-col gap-3">
        <div className="absolute right-2 top-2 z-20">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={view}
            onValueChange={(next) => {
              if (next) selectView(next as PreviewView);
            }}
            aria-label="预览视图"
          >
            <ToggleGroupItem value="keycaps" aria-label="键帽视图" title="键帽视图">
              <Keyboard className="size-3.5" />
            </ToggleGroupItem>
            <ToggleGroupItem value="falling" aria-label="落音预览" title="落音预览">
              <Music2 className="size-3.5" />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        {view === 'keycaps' ? (
          profile.rows.map((row) => (
            <div key={row.label} className="flex items-center gap-3">
              <span className="w-8 shrink-0 text-right text-xs text-muted-foreground">{row.label}</span>
              <div className="flex flex-1 flex-wrap gap-1.5">
                {row.keys.map((key: InstrumentKey) => (
                  <Keycap
                    key={key.code}
                    profile={profile}
                    code={key.code}
                    active={activeCodes.has(key.code)}
                    disabled={playingLike}
                    onPlay={(code) => previewPlayer.playKey(profile, code)}
                  />
                ))}
              </div>
            </div>
          ))
        ) : (
          <FallingNotesView profile={profile} onPlayKey={(code) => previewPlayer.playKey(profile, code)} />
        )}
        <p className="text-xs text-muted-foreground">点击键帽可以试听单个音（只在本窗口发声，不会向游戏发键）。</p>
      </CardContent>
      {playerState.kind === 'countdown' && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl bg-background/85">
          <span className="text-6xl font-bold tabular-nums text-amber-500">{playerState.remainingSec}</span>
          <span className="text-sm font-medium text-amber-500">请切换到游戏窗口</span>
        </div>
      )}
      {playerState.kind === 'waitingFocus' && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl bg-background/85">
          <p className="flex animate-pulse items-center gap-2 text-sm font-medium text-amber-500">
            <Spinner className="size-4" />
            等待切换到原神窗口…
          </p>
        </div>
      )}
    </Card>
  );
}
