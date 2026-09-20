import type { InstrumentProfile } from '../model/instrument';
import type { Score, Track } from '../model/score';
import type { AdaptOptions, AdaptReport, KeyTimeline, Press } from '../model/timeline';
import { DEFAULT_DRUM_NOTES, applyDrumVoiceNotes, buildVoiceKeyMap, median, resolveVoice } from './percussionMap';
import { buildPitchKeyMap, resolvePitch } from './pitchMap';

export interface AdaptResult {
  timeline: KeyTimeline;
  report: AdaptReport;
}

interface Candidate {
  startMs: number;
  code: string;
  /** 组内排序依据：音高类为变换后的音高，敲击类为原始音高 */
  order: number;
  durationMs: number;
  folded: boolean;
}

const DEFAULT_SPLIT_PITCH = 60;

export function emptyReport(): AdaptReport {
  return {
    total: 0,
    played: 0,
    folded: 0,
    merged: 0,
    dropped: { blackKey: 0, outOfRange: 0, polyphony: 0, tooDense: 0, unmappedDrum: 0 },
    chordHits: 0,
    chordFallbacks: 0,
  };
}

/** 命中率：被弹出（含同键合并）的音占全部音的比例 */
export function hitRate(report: AdaptReport): number {
  return report.total === 0 ? 0 : (report.played + report.merged) / report.total;
}

export function adapt(score: Score, profile: InstrumentProfile, options: AdaptOptions): AdaptResult {
  const report = emptyReport();
  const tracks = score.tracks.filter((track) => options.tracks.includes(track.id));
  const candidates =
    profile.kind === 'pitched'
      ? collectPitched(tracks, profile, options, report)
      : collectPercussion(tracks, profile, options, report);
  const presses = buildPresses(candidates, profile, options, report);
  const durationMs = presses.reduce((max, press) => Math.max(max, press.tMs + press.holdMs), 0);
  return {
    timeline: { instrumentId: profile.id, durationMs, minRepeatGapMs: profile.timing.minRepeatGapMs, presses },
    report,
  };
}

function collectPitched(
  tracks: Track[],
  profile: InstrumentProfile,
  options: AdaptOptions,
  report: AdaptReport,
): Candidate[] {
  const map = buildPitchKeyMap(profile);
  const shift = options.transpose + 12 * options.octaveShift;
  const candidates: Candidate[] = [];
  for (const track of tracks) {
    if (track.isDrum) continue;
    for (const note of track.notes) {
      report.total += 1;
      if (note.pitch === undefined) {
        report.dropped.unmappedDrum += 1;
        continue;
      }
      const pitch = note.pitch + shift;
      const resolution = resolvePitch(map, pitch, options.blackKeyPolicy, options.outOfRangePolicy);
      if (resolution.kind === 'drop') {
        report.dropped[resolution.reason] += 1;
        continue;
      }
      candidates.push({
        startMs: note.startMs,
        code: resolution.code,
        order: pitch,
        durationMs: note.durationMs,
        folded: resolution.folded,
      });
    }
  }
  return candidates;
}

function collectPercussion(
  tracks: Track[],
  profile: InstrumentProfile,
  options: AdaptOptions,
  report: AdaptReport,
): Candidate[] {
  const voiceKeys = buildVoiceKeyMap(profile);
  const drumNotes = applyDrumVoiceNotes(profile.percussionMap?.drumNotes ?? DEFAULT_DRUM_NOTES, options.drumVoiceNotes);
  const splitPitch = options.percussionSplitPitch ?? resolveSplitPitch(tracks, profile);
  const candidates: Candidate[] = [];
  for (const track of tracks) {
    for (const note of track.notes) {
      report.total += 1;
      const voice = resolveVoice(note, { isDrum: track.isDrum, drumNotes, splitPitch });
      const code = voice === undefined ? undefined : voiceKeys.get(voice);
      if (code === undefined) {
        report.dropped.unmappedDrum += 1;
        continue;
      }
      candidates.push({ startMs: note.startMs, code, order: note.pitch ?? 0, durationMs: note.durationMs, folded: false });
    }
  }
  return candidates;
}

function resolveSplitPitch(tracks: Track[], profile: InstrumentProfile): number {
  const configured = profile.percussionMap?.splitPitch;
  if (typeof configured === 'number') return configured;
  const pitches = tracks
    .filter((track) => !track.isDrum)
    .flatMap((track) => track.notes)
    .flatMap((note) => (note.pitch === undefined ? [] : [note.pitch]));
  return pitches.length > 0 ? median(pitches) : DEFAULT_SPLIT_PITCH;
}

/** 和弦簇匹配（M6）：同时发声的音簇与乐器和弦键做音级集合（pitch class）Jaccard 匹配 */
function matchChord(pcs: Set<number>, chordKeys: { code: string; pcs: Set<number> }[]): string | undefined {
  if (pcs.size < 3) return undefined;
  let best: { code: string; score: number } | undefined;
  for (const key of chordKeys) {
    let inter = 0;
    for (const pc of key.pcs) if (pcs.has(pc)) inter += 1;
    const score = inter / (key.pcs.size + pcs.size - inter);
    if (score >= 0.75 && (!best || score > best.score)) best = { code: key.code, score };
  }
  return best?.code;
}

function buildPresses(
  candidates: Candidate[],
  profile: InstrumentProfile,
  options: AdaptOptions,
  report: AdaptReport,
): Press[] {
  const chordKeys = profile.rows
    .flatMap((row) => row.keys)
    .filter((key) => key.chord !== undefined)
    .map((key) => ({ code: key.code, pcs: new Set(key.chord!.map((p) => p % 12)) }));
  const chordEnabled = chordKeys.length > 0 && options.useChordKeys !== false;
  const sorted = [...candidates].sort((a, b) => a.startMs - b.startMs || b.order - a.order);
  const lastPressAt = new Map<string, number>();
  const presses: Press[] = [];

  let index = 0;
  while (index < sorted.length) {
    const groupStart = sorted[index].startMs;
    let end = index;
    while (end < sorted.length && sorted[end].startMs - groupStart <= options.chordWindowMs) end += 1;
    const group = sorted.slice(index, end).sort((a, b) => b.order - a.order);
    index = end;

    // 和弦簇命中：整个同时组收成一个和弦键（≥3 个不同音级、与某和弦键 Jaccard ≥0.75）。
    // 没收成和弦键的候选组计入 chordFallbacks，供适配报告展示和弦命中率
    if (chordEnabled && group.length >= 3) {
      const pcs = new Set(group.map((candidate) => ((candidate.order % 12) + 12) % 12));
      if (pcs.size >= 3) {
        const chordCode = matchChord(pcs, chordKeys);
        if (chordCode !== undefined) {
          const last = lastPressAt.get(chordCode);
          if (last === undefined || groupStart - last >= profile.timing.minRepeatGapMs) {
            for (const candidate of group) {
              if (candidate.folded) report.folded += 1;
            }
            report.played += group.length;
            report.merged += group.length - 1;
            report.chordHits += 1;
            lastPressAt.set(chordCode, groupStart);
            presses.push({ tMs: groupStart, codes: [chordCode], holdMs: profile.timing.holdMs });
            continue;
          }
        }
        report.chordFallbacks += 1;
      }
    }

    const selected: Candidate[] = [];
    for (const candidate of group) {
      if (selected.some((s) => s.code === candidate.code)) {
        report.merged += 1;
        continue;
      }
      if (selected.length >= options.maxPolyphony) {
        report.dropped.polyphony += 1;
        continue;
      }
      selected.push(candidate);
    }

    const kept = selected.filter((candidate) => {
      const last = lastPressAt.get(candidate.code);
      if (last !== undefined && groupStart - last < profile.timing.minRepeatGapMs) {
        report.dropped.tooDense += 1;
        return false;
      }
      return true;
    });
    if (kept.length === 0) continue;

    for (const candidate of kept) {
      lastPressAt.set(candidate.code, groupStart);
      if (candidate.folded) report.folded += 1;
    }
    report.played += kept.length;
    const longest = Math.max(...kept.map((candidate) => candidate.durationMs));
    presses.push({
      tMs: groupStart,
      codes: kept.map((candidate) => candidate.code),
      holdMs: profile.timing.sustain ? Math.max(profile.timing.holdMs, longest) : profile.timing.holdMs,
    });
  }
  return presses;
}
