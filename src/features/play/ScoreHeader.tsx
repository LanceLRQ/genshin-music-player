import type { Score } from '@/core/model/score';
import { formatTimeShort, scoreDurationMs, sourceLabel } from './scoreInfo';

/** 右栏顶部的乐谱标题与元信息（设计 01 第 4.1 节） */
export function ScoreHeader({ score }: { score: Score }) {
  const bpm = score.meta.bpm;
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <h2 className="truncate text-lg font-semibold" title={score.meta.title}>
        {score.meta.title}
      </h2>
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span>{sourceLabel(score.meta.source)}</span>
        <span>·</span>
        <span>{formatTimeShort(scoreDurationMs(score))}</span>
        <span>·</span>
        <span>{score.tracks.length} 条音轨</span>
        {bpm !== undefined && (
          <>
            <span>·</span>
            <span>{bpm} BPM</span>
          </>
        )}
      </p>
    </div>
  );
}
