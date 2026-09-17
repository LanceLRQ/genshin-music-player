const LETTER_OFFSETS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * 音名 → 相对同一八度 C 的半音偏移。
 * 升降号可以写在字母前（`#F`、`bB`）或字母后（`F#`、`Bb`），但不能前后都写。
 * 返回值范围 -1（Cb）到 12（B#）。
 */
export function pitchOffsetFromName(name: string): number | undefined {
  const match = /^([#b]?)([A-Ga-g])([#b]?)$/.exec(name.trim());
  if (!match) return undefined;
  const [, prefix, letter, suffix] = match;
  if (prefix && suffix) return undefined;
  const accidental = prefix || suffix;
  const shift = accidental === '#' ? 1 : accidental === 'b' ? -1 : 0;
  return LETTER_OFFSETS[letter.toUpperCase()] + shift;
}

/** 'C4' / 'C#4' / 'Bb3' → MIDI 音高号；非法或超出 0–127 时返回 undefined */
export function noteNameToMidi(name: string): number | undefined {
  const match = /^([A-Ga-g][#b]?)(-?\d)$/.exec(name.trim());
  if (!match) return undefined;
  const offset = pitchOffsetFromName(match[1]);
  if (offset === undefined) return undefined;
  const midi = 12 * (Number(match[2]) + 1) + offset;
  return midi >= 0 && midi <= 127 ? midi : undefined;
}

/** MIDI 音高号 → 音名（统一使用升号） */
export function midiToNoteName(midi: number): string {
  return `${SHARP_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
}
