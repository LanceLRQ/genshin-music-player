import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useScoreStore } from '@/stores/scoreStore';
import { useTransportStore } from '@/stores/transportStore';
import { parseTimeInput, scoreDurationMs } from './scoreInfo';

/** 区间滑块与两次输入的最小间隔（毫秒） */
export const MIN_RANGE_GAP_MS = 100;

/**
 * 保证 [start, end] 不越界且间隔不小于 MIN_RANGE_GAP_MS。
 * 拖动的那一端让步：拖 start 时压缩 start，拖 end 时延伸 end。
 */
export function clampRange(
  next: [number, number],
  changed: 'start' | 'end',
  total: number,
  prev: readonly [number, number] = next,
): [number, number] {
  let start = Math.min(Math.max(next[0], 0), total);
  let end = Math.min(Math.max(next[1], 0), total);
  if (end - start < MIN_RANGE_GAP_MS) {
    if (changed === 'end' || prev[0] === start) {
      end = Math.min(total, start + MIN_RANGE_GAP_MS);
    } else {
      start = Math.max(0, end - MIN_RANGE_GAP_MS);
    }
  }
  return [Math.min(start, end), Math.max(start, end)];
}

function RangeTimeInput({ value, locked, onCommit, ariaLabel }: {
  value: number;
  locked: boolean;
  onCommit: (raw: string) => boolean;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  return (
    <Input
      aria-label={ariaLabel}
      className={cn('w-20 text-xs tabular-nums', invalid && 'border-destructive')}
      inputMode="numeric"
      value={draft ?? formatTime(value)}
      disabled={locked}
      onChange={(event) => {
        setDraft(event.target.value);
        setInvalid(false);
      }}
      onBlur={() => {
        if (draft === null) return;
        const text = draft;
        setDraft(null);
        if (!onCommit(text)) setInvalid(true);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}

interface RangeControlsProps {
  locked: boolean;
}

/** 演奏区间与循环（设计 01 第 4.8 节） */
export function RangeControls({ locked }: RangeControlsProps) {
  const score = useScoreStore((state) => state.score);
  const range = useTransportStore((state) => state.range);
  const loop = useTransportStore((state) => state.loop);
  if (!score) return null;
  const total = scoreDurationMs(score);
  const setRange = (startMs: number, endMs: number) => useTransportStore.getState().setRange({ startMs, endMs });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Label className="w-14 shrink-0 text-sm">区间</Label>
        <Slider
          className="flex-1"
          min={0}
          max={total}
          step={MIN_RANGE_GAP_MS}
          value={[range.startMs, range.endMs]}
          disabled={locked}
          onValueChange={([start, end]) => {
            const next = clampRange([start, end], start === range.startMs ? 'end' : 'start', total, [
              range.startMs,
              range.endMs,
            ]);
            setRange(next[0], next[1]);
          }}
        />
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={locked} onClick={() => setRange(0, total)}>
          重置区间
        </Button>
      </div>
      <div className="flex items-center gap-3">
        <span className="w-14 shrink-0" />
        <div className="flex flex-1 items-center gap-2">
          <RangeTimeInput
            ariaLabel="区间开始时间"
            value={range.startMs}
            locked={locked}
            onCommit={(raw) => {
              const parsed = parseTimeInput(raw, Math.max(range.endMs - MIN_RANGE_GAP_MS, 0));
              if (parsed === null) return false;
              const next = clampRange([parsed, range.endMs], 'start', total, [range.startMs, range.endMs]);
              setRange(next[0], next[1]);
              return true;
            }}
          />
          <span className="text-muted-foreground">—</span>
          <RangeTimeInput
            ariaLabel="区间结束时间"
            value={range.endMs}
            locked={locked}
            onCommit={(raw) => {
              const parsed = parseTimeInput(raw, total);
              if (parsed === null || parsed <= range.startMs) return false;
              const next = clampRange([range.startMs, parsed], 'end', total, [range.startMs, range.endMs]);
              setRange(next[0], next[1]);
              return true;
            }}
          />
          <div className="flex flex-1 items-center justify-end gap-2">
            <Switch
              id="play-loop"
              aria-label="循环播放"
              checked={loop}
              disabled={locked}
              onCheckedChange={(checked) => useTransportStore.getState().setLoop(checked)}
            />
            <Label htmlFor="play-loop" className="text-sm">
              循环
            </Label>
          </div>
        </div>
      </div>
    </div>
  );
}
