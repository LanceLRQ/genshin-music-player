import type { InstrumentProfile } from '../model/instrument';
import type { Note } from '../model/score';

/** GM 鼓音色默认映射：底鼓为咚，军鼓、边击、踩镲、镲为咔 */
export const DEFAULT_DRUM_NOTES: Readonly<Record<string, string>> = {
  '35': 'don',
  '36': 'don',
  '37': 'ka',
  '38': 'ka',
  '40': 'ka',
  '42': 'ka',
  '44': 'ka',
  '46': 'ka',
  '49': 'ka',
  '51': 'ka',
  '57': 'ka',
};

export interface VoiceContext {
  isDrum: boolean;
  drumNotes: Readonly<Record<string, string>>;
  splitPitch: number;
}

export function buildVoiceKeyMap(profile: InstrumentProfile): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of profile.rows) {
    for (const key of row.keys) {
      if (key.voice !== undefined) map.set(key.voice, key.code);
    }
  }
  return map;
}

export function resolveVoice(note: Note, context: VoiceContext): string | undefined {
  if (note.voice !== undefined) return note.voice;
  if (note.pitch === undefined) return undefined;
  if (context.isDrum) return context.drumNotes[String(note.pitch)];
  return note.pitch < context.splitPitch ? 'don' : 'ka';
}

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('median 需要至少一个值');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
