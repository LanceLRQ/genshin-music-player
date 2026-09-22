import type { InstrumentProfile } from '../model/instrument';
import type { Score, Track } from '../model/score';
import type { AdaptOptions, AdaptReport, KeyTimeline, Press } from '../model/timeline';
import { DEFAULT_DRUM_NOTES, applyDrumVoiceNotes, baseVoice, buildVoiceKeyGroups, median, resolveVoice } from './percussionMap';
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
  const durationMs = presses.reduce((max, press) => Math.max(max, press.tMs + Math.max(press.holdMs, press.sustainMs ?? 0)), 0);
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
  const voiceGroups = buildVoiceKeyGroups(profile);
  const drumNotes = applyDrumVoiceNotes(profile.percussionMap?.drumNotes ?? DEFAULT_DRUM_NOTES, options.drumVoiceNotes);
  const splitPitch = options.percussionSplitPitch ?? resolveSplitPitch(tracks, profile);

  // 先解析出每个音落在哪个声音上，再按时间排序：轮流击打必须沿时间轴推进，
  // 否则多轨合并时会按「先走完一条轨再走下一条」分配键位，同一侧连着响两下
  interface Hit {
    startMs: number;
    group: string;
    codes: string[];
    durationMs: number;
    pitch: number;
  }
  const hits: Hit[] = [];
  for (const track of tracks) {
    for (const note of track.notes) {
      report.total += 1;
      const voice = resolveVoice(note, { isDrum: track.isDrum, drumNotes, splitPitch, voiceNotePitches: options.drumVoiceNotes });
      if (voice === undefined) {
        report.dropped.unmappedDrum += 1;
        continue;
      }
      const group = baseVoice(voice);
      const codes = voiceGroups.get(group);
      if (codes === undefined || codes.length === 0) {
        report.dropped.unmappedDrum += 1;
        continue;
      }
      hits.push({ startMs: note.startMs, group, codes, durationMs: note.durationMs, pitch: note.pitch ?? 0 });
    }
  }
  hits.sort((a, b) => a.startMs - b.startMs);

  /** 每个声音已击打的次数：对称键组内轮流（第 n 次用第 n mod 组长 的键），左右交替 */
  const strikes = new Map<string, number>();
  /** 每个声音上一次击打的时刻，用于合并同一次击打的重音 */
  const lastHitAt = new Map<string, number>();
  const candidates: Candidate[] = [];
  for (const hit of hits) {
    // 同一声音在和弦窗口内的重音（MIDI 力度叠层、多轨同拍）算同一次击打。必须在分配
    // 轮流键位之前合并：否则重音会占掉一个轮流位，把后续击打的左右相位错开；而且分到
    // 左右两个键后不再撞码，buildPresses 的同键去重也拦不住，变成双键齐击
    const last = lastHitAt.get(hit.group);
    if (last !== undefined && hit.startMs - last <= options.chordWindowMs) {
      report.merged += 1;
      continue;
    }
    lastHitAt.set(hit.group, hit.startMs);
    const count = strikes.get(hit.group) ?? 0;
    strikes.set(hit.group, count + 1);
    candidates.push({
      startMs: hit.startMs,
      code: hit.codes[count % hit.codes.length],
      order: hit.pitch,
      durationMs: hit.durationMs,
      folded: false,
    });
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
  // 未指定时按乐器配置决定是否按音长；按音长时乐器 holdMs 只作最短按住兜底，holdMsOverride 只用于固定时长模式
  const sustain = options.useNoteDuration ?? profile.timing.sustain;
  const baseHold = sustain ? profile.timing.holdMs : (options.holdMsOverride ?? profile.timing.holdMs);
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
            presses.push({ tMs: groupStart, codes: [chordCode], holdMs: baseHold });
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
      holdMs: baseHold,
      ...(sustain && longest > baseHold ? { sustainMs: longest } : {}),
    });
  }
  return presses;
}
