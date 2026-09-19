import { useMemo } from 'react';
import { NoteCanvas, type AnimationConfig, type KeyboardConfig, type PianoRollTheme } from '@minagishl/react-piano-roll';
import { activeCodesAt } from '@/audio/schedule';
import { Kbd } from '@/components/ui/kbd';
import type { InstrumentKey, InstrumentProfile } from '@/core/model/instrument';
import { keyLabel } from '@/core/model/keycodes';
import { midiToNoteName } from '@/core/music/pitch';
import { isPlayerActive } from '@/lib/playerStatus';
import { cn } from '@/lib/utils';
import { useTransportStore } from '@/stores/transportStore';
import { executionToNotes, orderedPreviewKeys, syntheticPitch } from './fallingNotes';
import { voiceLabel } from './scoreInfo';

const CELL_WIDTH = 34;
const ROLL_HEIGHT = 168;
const FALL_SPEED = 150;
const LOOKAHEAD_SEC = 2.5;

/**
 * 舞台配色固定为深色：画布绘制需要具体颜色值（拿不到 Tailwind 的 CSS 变量），
 * 落音视图的惯例也是深色底，两种应用主题下都成立。白/黑键颜色在本视图里画不到
 * （不渲染库自带的琴键组件），只是为了满足 Required 类型。
 */
const stageTheme: Required<PianoRollTheme> = {
  backgroundColor: '#0b1220',
  gridColor: 'rgba(148, 163, 184, 0.16)',
  showGrid: true,
  gridSpacing: 0,
  noteColor: '#38bdf8',
  activeNoteColor: '#facc15',
  noteRadius: 4,
  whiteKeyColor: '#e2e8f0',
  blackKeyColor: '#0f172a',
  activeWhiteKeyColor: '#facc15',
  activeBlackKeyColor: '#facc15',
  keyBorderColor: '#334155',
};

/** 落点条上的一个键帽格：点击试听单个音，播放中随 execution 高亮 */
function LandingCell({ keyItem, active, disabled, onPlay }: {
  keyItem: InstrumentKey;
  active: boolean;
  disabled: boolean;
  onPlay: (code: string) => void;
}) {
  const sub = keyItem.pitch !== undefined ? midiToNoteName(keyItem.pitch) : voiceLabel(keyItem.voice ?? '');
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`键帽 ${keyLabel(keyItem.code)} ${sub}`}
      onClick={() => onPlay(keyItem.code)}
      style={{ width: CELL_WIDTH }}
      className={cn(
        'flex h-12 flex-col items-center justify-center gap-0.5 border-border bg-card transition-colors',
        'border-x border-b first:border-l-0 last:border-r-0',
        active && 'border-primary bg-primary/15',
      )}
    >
      <Kbd className="h-4 min-w-4 px-0.5 text-[10px]">{keyLabel(keyItem.code)}</Kbd>
      <span className="text-[9px] leading-none text-muted-foreground">{sub}</span>
    </button>
  );
}

/**
 * 落音预览视图（虚拟琴键卡的另一种显示）：按执行时间线把将要弹的音符从上往下落，
 * 时间轴与试听/演奏共用同一个时钟（试听 30fps 位置回写、演奏后端 33ms progress），
 * 看到的就是实际会弹出来的。列与乐器键一一对应，不按真实音高排。
 */
export function FallingNotesView({ profile, onPlayKey }: { profile: InstrumentProfile; onPlayKey: (code: string) => void }) {
  const execution = useTransportStore((state) => state.execution);
  const previewing = useTransportStore((state) => state.previewing);
  const previewPositionMs = useTransportStore((state) => state.previewPositionMs);
  const playerState = useTransportStore((state) => state.playerState);
  const progress = useTransportStore((state) => state.progress);

  const keys = useMemo(() => orderedPreviewKeys(profile), [profile]);
  const columnOf = useMemo(() => new Map(keys.map((key, index) => [key.code, index])), [keys]);
  const notes = useMemo(() => (execution ? executionToNotes(execution, columnOf) : []), [execution, columnOf]);

  const playingLike = isPlayerActive(playerState);
  const playing = previewing || playerState.kind === 'playing';
  const positionMs = previewing ? previewPositionMs : (progress?.positionMs ?? 0);
  const activeCodes = useMemo(
    () => (execution && playing ? activeCodesAt(execution, positionMs) : new Set<string>()),
    [execution, playing, positionMs],
  );

  const keyboardConfig = useMemo<Required<KeyboardConfig>>(() => {
    const last = keys.length > 0 ? syntheticPitch(keys.length - 1) : 60;
    return {
      keyCount: last - 60 + 1,
      startNote: 60,
      whiteKeyWidth: CELL_WIDTH,
      whiteKeyHeight: 48,
      blackKeyWidth: 20,
      blackKeyHeight: 32,
      showLabels: false,
      labelFontSize: 10,
      labelFontFamily: 'inherit',
      whiteLabelColor: '#000000',
      blackLabelColor: '#ffffff',
      keyBorderRadius: 0,
    };
  }, [keys.length]);
  const animationConfig = useMemo<Required<AnimationConfig>>(
    () => ({ fallSpeed: FALL_SPEED, easing: 'linear', lookahead: LOOKAHEAD_SEC }),
    [],
  );

  const width = keys.length * CELL_WIDTH;
  return (
    <div className="w-full overflow-x-auto">
      <div className="overflow-hidden rounded-lg border" style={{ width }} data-testid="falling-stage">
        <NoteCanvas
          notes={notes}
          currentTime={positionMs / 1000}
          isPlaying={playing}
          keyboardConfig={keyboardConfig}
          theme={stageTheme}
          animationConfig={animationConfig}
          width={width}
          height={ROLL_HEIGHT}
        />
        <div className="flex">
          {keys.map((key) => (
            <LandingCell
              key={key.code}
              keyItem={key}
              active={activeCodes.has(key.code)}
              disabled={playingLike}
              onPlay={onPlayKey}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
