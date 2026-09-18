import type { InstrumentProfile } from '../model/instrument';
import type { Score } from '../model/score';
import { type AdaptOptions, DEFAULT_ADAPT_OPTIONS } from '../model/timeline';
import { adapt, hitRate } from './adapt';
import { median } from './percussionMap';
import { type PitchKeyMap, buildPitchKeyMap, resolvePitch } from './pitchMap';

export interface ShiftRecommendation {
  transpose: number;
  octaveShift: number;
}

const TRANSPOSE_MIN = -6;
const TRANSPOSE_MAX = 5;
const OCTAVE_SEARCH = 5;
const FOLD_PENALTY = 0.3;
const SCORE_EPSILON = 1e-9;
const NO_SHIFT: ShiftRecommendation = { transpose: 0, octaveShift: 0 };

interface PitchedNote {
  startMs: number;
  pitch: number;
}

/** 默认只勾选一条音轨：第一条有音符的合规轨（音高类乐器排除鼓轨）；没有合规轨时为空 */
export function defaultTrackIds(score: Score, profile: InstrumentProfile): string[] {
  const eligible = score.tracks.filter((track) => profile.kind === 'percussion' || !track.isDrum);
  const first = eligible.find((track) => track.notes.length > 0);
  return first ? [first.id] : [];
}

export function recommendShift(
  score: Score,
  profile: InstrumentProfile,
  trackIds: readonly string[],
  chordWindowMs: number = DEFAULT_ADAPT_OPTIONS.chordWindowMs,
): ShiftRecommendation {
  if (profile.kind !== 'pitched') return NO_SHIFT;
  const notes: PitchedNote[] = score.tracks
    .filter((track) => trackIds.includes(track.id) && !track.isDrum)
    .flatMap((track) => track.notes)
    .flatMap((note) => (note.pitch === undefined ? [] : [{ startMs: note.startMs, pitch: note.pitch }]))
    .sort((a, b) => a.startMs - b.startMs);
  if (notes.length === 0) return NO_SHIFT;

  const map = buildPitchKeyMap(profile);
  const isMelody = markGroupTops(notes, chordWindowMs);
  const candidates: ShiftRecommendation[] = [];
  for (let transpose = TRANSPOSE_MIN; transpose <= TRANSPOSE_MAX; transpose += 1) {
    for (const octaveShift of candidateOctaves(notes, map)) candidates.push({ transpose, octaveShift });
  }
  candidates.sort(
    (a, b) =>
      Math.abs(a.transpose) - Math.abs(b.transpose) ||
      Math.abs(a.octaveShift) - Math.abs(b.octaveShift) ||
      a.transpose - b.transpose ||
      a.octaveShift - b.octaveShift,
  );

  let best = candidates[0];
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const value = scoreShift(notes, isMelody, map, candidate);
    if (value > bestScore + SCORE_EPSILON) {
      best = candidate;
      bestScore = value;
    }
  }
  return best;
}

/** 自动推荐的完整适配参数；来源乐器与目标乐器相同时不移调 */
export function recommendOptions(
  score: Score,
  profile: InstrumentProfile,
  sourceInstrumentId?: string,
): AdaptOptions {
  const tracks = defaultTrackIds(score, profile);
  const shift = sourceInstrumentId === profile.id ? NO_SHIFT : recommendShift(score, profile, tracks);
  return { ...DEFAULT_ADAPT_OPTIONS, tracks, ...shift };
}

/** 每条音轨单独适配时的命中率，算法见 hitRate */
export function trackHitRates(score: Score, profile: InstrumentProfile, options: AdaptOptions): Record<string, number> {
  const rates: Record<string, number> = {};
  for (const track of score.tracks) {
    rates[track.id] = hitRate(adapt(score, profile, { ...options, tracks: [track.id] }).report);
  }
  return rates;
}

function candidateOctaves(notes: readonly PitchedNote[], map: PitchKeyMap): number[] {
  const center = median(notes.map((note) => note.pitch));
  const octaves: number[] = [];
  for (let shift = -OCTAVE_SEARCH; shift <= OCTAVE_SEARCH; shift += 1) {
    const moved = center + 12 * shift;
    if (moved >= map.min && moved <= map.max) octaves.push(shift);
  }
  if (octaves.length === 0) octaves.push(Math.round(((map.min + map.max) / 2 - center) / 12));
  return octaves;
}

/** notes 已按 startMs 排序；每个和弦组中音高最高的音标记为 true */
function markGroupTops(notes: readonly PitchedNote[], chordWindowMs: number): boolean[] {
  const tops = new Array<boolean>(notes.length).fill(false);
  let start = 0;
  while (start < notes.length) {
    let end = start;
    let top = start;
    while (end + 1 < notes.length && notes[end + 1].startMs - notes[start].startMs <= chordWindowMs) {
      end += 1;
      if (notes[end].pitch > notes[top].pitch) top = end;
    }
    tops[top] = true;
    start = end + 1;
  }
  return tops;
}

function scoreShift(
  notes: readonly PitchedNote[],
  isMelody: readonly boolean[],
  map: PitchKeyMap,
  shift: ShiftRecommendation,
): number {
  let total = 0;
  notes.forEach((note, index) => {
    const resolution = resolvePitch(map, note.pitch + shift.transpose + 12 * shift.octaveShift, 'skip', 'fold');
    if (resolution.kind !== 'hit') return;
    total += isMelody[index] ? 2 : 1;
    if (resolution.folded) total -= FOLD_PENALTY;
  });
  return total;
}
