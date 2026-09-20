import type { InstrumentProfile } from '../model/instrument';
import type { Note } from '../model/score';
import { midiToNoteName } from '../music/pitch';

/** GM 打击乐音符号（35–81）的通用名称，用于下拉与详情的显示 */
export const GM_PERCUSSION_NAMES: Readonly<Record<number, string>> = {
  35: '原声底鼓',
  36: '底鼓',
  37: '边击',
  38: '原声军鼓',
  39: '拍手',
  40: '电子军鼓',
  41: '低音地嗵',
  42: '闭镲',
  43: '高音地嗵',
  44: '踩镲',
  45: '低嗵',
  46: '开镲',
  47: '中低嗵',
  48: '中高嗵',
  49: '碎音镲',
  50: '高嗵',
  51: '叮镲',
  52: '中国镲',
  53: '叮镲碗',
  54: '铃鼓',
  55: '溅音镲',
  56: '牛铃',
  57: '碎音镲 2',
  58: '颤音刮',
  59: '叮镲 2',
  60: '高邦戈鼓',
  61: '低邦戈鼓',
  62: '闷康加鼓',
  63: '开康加鼓',
  64: '低康加鼓',
  65: '高天巴鼓',
  66: '低天巴鼓',
  67: '高阿哥哥铃',
  68: '低阿哥哥铃',
  69: '卡巴沙',
  70: '沙锤',
  71: '短口哨',
  72: '长口哨',
  73: '短刮瓜',
  74: '长刮瓜',
  75: '响棒',
  76: '高木鱼',
  77: '低木鱼',
  78: '闷库加鼓',
  79: '开库加鼓',
  80: '闷三角铁',
  81: '开三角铁',
};

/** 鼓音符号的显示标签：GM 音域带通用名（如「B1 · 原声底鼓」），其余只显示音名 */
export function drumNoteLabel(pitch: number): string {
  const name = GM_PERCUSSION_NAMES[pitch];
  return name === undefined ? midiToNoteName(pitch) : `${midiToNoteName(pitch)} · ${name}`;
}

/** 把「音色 → 指定音符号」的临时指定合并进鼓映射表：被指定的音符号优先于乐器自带映射 */
export function applyDrumVoiceNotes(
  drumNotes: Readonly<Record<string, string>>,
  drumVoiceNotes: Readonly<Record<string, number>> | undefined,
): Record<string, string> {
  const merged = { ...drumNotes };
  if (drumVoiceNotes === undefined) return merged;
  for (const [voice, pitch] of Object.entries(drumVoiceNotes)) merged[String(pitch)] = voice;
  return merged;
}

/**
 * 自动推荐「音色 → 指定音符」：按谱中音高的出现数量降序逐个分配——
 * 乐器鼓映射表（含 GM 预设）命中的音高沿用其音色，表外的音高按音高升序
 * 分给还没被占用的音色（行序）。音高多于音色时数量少的不再分配。
 * 对称备用键（-2 后缀）归并为同一声音，结果一律以基础音色为键。
 */
export function recommendDrumVoiceNotes(
  notes: readonly { pitch?: number }[],
  profile: InstrumentProfile,
): Record<string, number> | undefined {
  if (profile.kind !== 'percussion') return undefined;
  const voices = [...buildVoiceKeyGroups(profile).keys()];
  if (voices.length === 0) return undefined;
  const table = profile.percussionMap?.drumNotes ?? DEFAULT_DRUM_NOTES;

  const counts = new Map<number, number>();
  for (const note of notes) {
    if (note.pitch === undefined) continue;
    counts.set(note.pitch, (counts.get(note.pitch) ?? 0) + 1);
  }
  if (counts.size === 0) return undefined;
  const byCount = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([pitch]) => pitch);

  const result: Record<string, number> = {};
  const taken = new Set<string>();
  const unmapped: number[] = [];
  for (const pitch of byCount) {
    const hit = table[String(pitch)];
    const voice = hit === undefined ? undefined : baseVoice(hit);
    if (voice !== undefined && !taken.has(voice) && voices.includes(voice)) {
      result[voice] = pitch;
      taken.add(voice);
    } else {
      unmapped.push(pitch);
    }
  }
  unmapped.sort((a, b) => a - b);
  const rest = voices.filter((voice) => !taken.has(voice));
  for (let index = 0; index < Math.min(unmapped.length, rest.length); index += 1) {
    result[rest[index]] = unmapped[index];
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/** GM 打击乐（35–81）音符号 → 音色的默认映射：底鼓为咚，其余一律为咔，保证 GM 鼓轨不因音符号缺失而丢音 */
export const GM_DRUM_NOTES: Readonly<Record<string, string>> = {
  '35': 'don',
  '36': 'don',
  '37': 'ka',
  '38': 'ka',
  '39': 'ka',
  '40': 'ka',
  '41': 'ka',
  '42': 'ka',
  '43': 'ka',
  '44': 'ka',
  '45': 'ka',
  '46': 'ka',
  '47': 'ka',
  '48': 'ka',
  '49': 'ka',
  '50': 'ka',
  '51': 'ka',
  '52': 'ka',
  '53': 'ka',
  '54': 'ka',
  '55': 'ka',
  '56': 'ka',
  '57': 'ka',
  '58': 'ka',
  '59': 'ka',
  '60': 'ka',
  '61': 'ka',
  '62': 'ka',
  '63': 'ka',
  '64': 'ka',
  '65': 'ka',
  '66': 'ka',
  '67': 'ka',
  '68': 'ka',
  '69': 'ka',
  '70': 'ka',
  '71': 'ka',
  '72': 'ka',
  '73': 'ka',
  '74': 'ka',
  '75': 'ka',
  '76': 'ka',
  '77': 'ka',
  '78': 'ka',
  '79': 'ka',
  '80': 'ka',
  '81': 'ka',
};

/** 敲击类乐器没有配置 percussionMap 时的回退映射 */
export const DEFAULT_DRUM_NOTES = GM_DRUM_NOTES;

export interface VoiceContext {
  isDrum: boolean;
  drumNotes: Readonly<Record<string, string>>;
  splitPitch: number;
  /** 按音色直接指定的音符（音色 → 音高）：对非鼓轨也生效——不少音源把鼓写在普通通道上，
   *  这类轨道不走鼓映射表，只有用户的显式指定能纠正它 */
  voiceNotePitches?: Readonly<Record<string, number>>;
}

/** 音高 → 音色的反查；同一音高只指定给一个音色（界面侧保证），命中返回音色名 */
function findVoiceForPitch(
  voiceNotePitches: Readonly<Record<string, number>> | undefined,
  pitch: number,
): string | undefined {
  if (voiceNotePitches === undefined) return undefined;
  for (const [voice, note] of Object.entries(voiceNotePitches)) {
    if (note === pitch) return voice;
  }
  return undefined;
}

/** 对称备用键归并：去掉 `-2` 后缀的音色视为同一声音（游戏内鼓的左右键对称，音相同） */
export function baseVoice(voice: string): string {
  return voice.replace(/-2$/, '');
}

/**
 * 声音 → 可用键位列表（按乐器行序）。同一声音的对称键（如 bass 与 bass-2）
 * 归并为一组，连续击打时轮流使用，把同键连打间隔翻倍。
 */
export function buildVoiceKeyGroups(profile: InstrumentProfile): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const row of profile.rows) {
    for (const key of row.keys) {
      if (key.voice === undefined) continue;
      const group = baseVoice(key.voice);
      const codes = groups.get(group) ?? [];
      codes.push(key.code);
      groups.set(group, codes);
    }
  }
  return groups;
}

export function resolveVoice(note: Note, context: VoiceContext): string | undefined {
  if (note.voice !== undefined) return note.voice;
  if (note.pitch === undefined) return undefined;
  if (context.isDrum) return context.drumNotes[String(note.pitch)];
  // 非鼓轨：用户显式指定的音符优先（合并进 drumNotes 的指定对鼓轨已在上面生效），
  // 其余仍按分界音高映射为咚/咔
  const override = findVoiceForPitch(context.voiceNotePitches, note.pitch);
  if (override !== undefined) return override;
  return note.pitch < context.splitPitch ? 'don' : 'ka';
}

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error('median 需要至少一个值');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
