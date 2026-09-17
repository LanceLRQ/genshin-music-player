import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Score } from '@/core/model/score';
import { ScoreHeader } from './ScoreHeader';

const score: Score = {
  meta: { title: '不问天_4轨道', source: 'midi', bpm: 60 },
  tracks: [
    { id: 't0', name: 'A', isDrum: false, notes: [{ startMs: 0, durationMs: 1000, pitch: 60, velocity: 0.8 }] },
    { id: 't1', name: 'B', isDrum: false, notes: [{ startMs: 500, durationMs: 234000, pitch: 62, velocity: 0.8 }] },
  ],
};

describe('ScoreHeader', () => {
  it('显示标题与来源、时长、音轨数、BPM', () => {
    render(<ScoreHeader score={score} />);
    expect(screen.getByText('不问天_4轨道')).toBeInTheDocument();
    expect(screen.getByText('MIDI')).toBeInTheDocument();
    expect(screen.getByText('3:55')).toBeInTheDocument();
    expect(screen.getByText('2 条音轨')).toBeInTheDocument();
    expect(screen.getByText('60 BPM')).toBeInTheDocument();
  });

  it('没有 BPM 时不显示 BPM 段', () => {
    render(<ScoreHeader score={{ ...score, meta: { ...score.meta, bpm: undefined } }} />);
    expect(screen.queryByText(/BPM/)).not.toBeInTheDocument();
  });
});
