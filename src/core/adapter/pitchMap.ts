import type { InstrumentProfile } from '../model/instrument';
import type { BlackKeyPolicy, OutOfRangePolicy } from '../model/timeline';

export interface PitchKeyMap {
  min: number;
  max: number;
  byPitch: ReadonlyMap<number, string>;
  /** 升序 */
  pitches: readonly number[];
}

export type KeyResolution =
  | { kind: 'hit'; code: string; folded: boolean }
  | { kind: 'drop'; reason: 'blackKey' | 'outOfRange' };

export function buildPitchKeyMap(profile: InstrumentProfile): PitchKeyMap {
  const byPitch = new Map<number, string>();
  for (const row of profile.rows) {
    for (const key of row.keys) {
      if (key.pitch !== undefined) byPitch.set(key.pitch, key.code);
    }
  }
  const pitches = [...byPitch.keys()].sort((a, b) => a - b);
  if (pitches.length === 0) throw new Error(`乐器「${profile.name}」没有可用的音高键`);
  return { min: pitches[0], max: pitches[pitches.length - 1], byPitch, pitches };
}

export function resolvePitch(
  map: PitchKeyMap,
  pitch: number,
  blackKeyPolicy: BlackKeyPolicy,
  outOfRangePolicy: OutOfRangePolicy,
): KeyResolution {
  let target = pitch;
  let folded = false;
  if (target < map.min || target > map.max) {
    if (outOfRangePolicy === 'drop') return { kind: 'drop', reason: 'outOfRange' };
    while (target < map.min) target += 12;
    while (target > map.max) target -= 12;
    // 音域不足一个八度时可能折不回来
    if (target < map.min) return { kind: 'drop', reason: 'outOfRange' };
    folded = true;
  }

  const exact = map.byPitch.get(target);
  if (exact !== undefined) return { kind: 'hit', code: exact, folded };
  if (blackKeyPolicy === 'skip') return { kind: 'drop', reason: 'blackKey' };

  // pitches 升序，严格小于才替换，所以距离相等时保留较低的音
  let nearest = map.pitches[0];
  for (const candidate of map.pitches) {
    if (Math.abs(candidate - target) < Math.abs(nearest - target)) nearest = candidate;
  }
  return { kind: 'hit', code: map.byPitch.get(nearest)!, folded };
}
