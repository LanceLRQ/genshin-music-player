import { toSourcePositionMs } from '@/audio/schedule';
import { formatTime } from '@/lib/format';
import { useScoreStore } from '@/stores/scoreStore';
import { useTransportStore } from '@/stores/transportStore';
import { scoreDurationMs } from './scoreInfo';

/** 进度条：只用来显示，蓝色指针表示乐谱时间位置，区间段高亮（设计 01 第 4.8 节） */
export function TimelineBar() {
  const score = useScoreStore((state) => state.score);
  const execution = useTransportStore((state) => state.execution);
  const progress = useTransportStore((state) => state.progress);
  const previewing = useTransportStore((state) => state.previewing);
  const previewPositionMs = useTransportStore((state) => state.previewPositionMs);
  const range = useTransportStore((state) => state.range);
  if (!score) return null;
  const total = scoreDurationMs(score);
  const sourcePositionMs =
    previewing && execution ? toSourcePositionMs(execution, previewPositionMs) : (progress?.sourcePositionMs ?? range.startMs);
  const percent = total > 0 ? Math.min(Math.max((sourcePositionMs / total) * 100, 0), 100) : 0;
  return (
    <div className="flex flex-col gap-1">
      {/* 指针放在 overflow-hidden 轨道外层定位，否则 12px 圆点会被 6px 高的轨道上下各裁 3px */}
      <div className="relative">
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={Math.round(total)}
          aria-valuenow={Math.round(sourcePositionMs)}
          className="relative h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="absolute inset-y-0 bg-sky-500/25"
            style={{ left: `${(range.startMs / total) * 100}%`, width: `${((range.endMs - range.startMs) / total) * 100}%` }}
          />
        </div>
        <div
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-500"
          style={{ left: `${percent}%` }}
        />
      </div>
      <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
        <span>{formatTime(sourcePositionMs)}</span>
        <span>{formatTime(total)}</span>
      </div>
    </div>
  );
}
