import type { InstrumentProfile } from '../model/instrument';
import type { Score, Track } from '../model/score';
import type { AdaptOptions, AdaptReport, KeyTimeline, Press } from '../model/timeline';
import { DEFAULT_DRUM_NOTES, buildVoiceKeyMap, median, resolveVoice } from './percussionMap';
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
  const drumNotes = profile.percussionMap?.drumNotes ?? DEFAULT_DRUM_NOTES;
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

function buildPresses(
  candidates: Candidate[],
  profile: InstrumentProfile,
  options: AdaptOptions,
  report: AdaptReport,
): Press[] {
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
