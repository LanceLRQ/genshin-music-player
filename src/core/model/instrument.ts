import { z } from 'zod';
import { isKnownKeyCode } from './keycodes';

export const INSTRUMENT_FILE_VERSION = 1;

/** 乐器分类：只有 horn（圆号）与 vocal（人声）在游戏里按住会持续发声；custom 是自定义乐器的默认值，
 *  也用于兼容旧版本没有 category 字段的配置文件 */
export const INSTRUMENT_CATEGORIES = ['lyre', 'drum', 'horn', 'vocal', 'custom'] as const;
export type InstrumentCategory = (typeof INSTRUMENT_CATEGORIES)[number];

export const INSTRUMENT_CATEGORY_LABELS: Readonly<Record<InstrumentCategory, string>> = {
  lyre: '琴类',
  drum: '鼓类',
  horn: '圆号',
  vocal: '人声',
  custom: '自定义',
};

export const InstrumentKeySchema = z.object(
  {
    code: z.string({ message: '键码必须是文本' }).min(1, '键码不能为空'),
    pitch: z
      .number({ message: '音高必须是数字' })
      .int('音高必须是整数')
      .min(0, '音高不能小于 0')
      .max(127, '音高不能大于 127')
      .optional(),
    /** 和弦键：构成音 MIDI 音高（升序、≥2 音）；与 pitch 二选一 */
    chord: z
      .array(
        z.number({ message: '和弦构成音必须是数字' }).int('和弦构成音必须是整数').min(0).max(127),
        { message: '和弦必须是数组' },
      )
      .min(2, '和弦至少需要 2 个音')
      .max(7, '和弦最多 7 个音')
      .optional(),
    /** 和弦键的显示名，如 "C"、"Dm" */
    label: z.string({ message: '和弦名必须是文本' }).min(1, '和弦名不能为空').optional(),
    voice: z.string({ message: '音色必须是文本' }).min(1, '音色不能为空').optional(),
  },
  { message: '键位配置必须是对象' },
);

export const InstrumentRowSchema = z.object(
  {
    label: z.string({ message: '行名必须是文本' }),
    keys: z
      .array(InstrumentKeySchema, { message: '键位必须是数组' })
      .min(1, '每行至少需要 1 个键')
      .max(12, '每行最多 12 个键'),
  },
  { message: '行配置必须是对象' },
);

export const InstrumentTimingSchema = z.object(
  {
    holdMs: z
      .number({ message: '按住时长必须是数字' })
      .int('按住时长必须是整数')
      .min(1, '按住时长必须至少 1ms')
      .max(1000, '按住时长不能超过 1000ms'),
    minRepeatGapMs: z
      .number({ message: '最小重复间隔必须是数字' })
      .int('最小重复间隔必须是整数')
      .min(0, '最小重复间隔不能小于 0')
      .max(1000, '最小重复间隔不能超过 1000ms'),
    sustain: z.boolean({ message: '可持续发声必须是布尔值' }).default(false),
  },
  { message: '时值配置必须是对象' },
);

/** 规范化鼓映射键：'036' → '36'，与演奏适配时的 String(pitch) 查找保持一致；规范化后重复时后出现的覆盖先出现的 */
function canonicalizeDrumNotes(notes: Record<string, string>): Record<string, string> {
  const canonical: Record<string, string> = {};
  for (const [note, voice] of Object.entries(notes)) canonical[String(Number(note))] = voice;
  return canonical;
}

export const PercussionMapSchema = z.object(
  {
    drumNotes: z
      .record(
        z.string().regex(/^\d{1,3}$/, 'MIDI 音符号必须是 1–3 位数字'),
        z.string({ message: '音色必须是文本' }).min(1, '音色不能为空'),
      )
      .transform(canonicalizeDrumNotes),
    splitPitch: z.union(
      [
        z.literal('auto'),
        z
          .number({ message: '分界音高必须是数字' })
          .int('分界音高必须是整数')
          .min(0, '分界音高不能小于 0')
          .max(127, '分界音高不能大于 127'),
      ],
      { message: '分界音高必须是 auto 或 0–127 的整数' },
    ),
  },
  { message: '鼓映射表配置必须是对象' },
);

export const InstrumentProfileSchema = z
  .object(
    {
      schemaVersion: z.literal(INSTRUMENT_FILE_VERSION, { message: `乐器配置版本必须是 ${INSTRUMENT_FILE_VERSION}` }),
      id: z.string({ message: 'ID 必须是文本' }).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'id 只能包含小写字母、数字和连字符'),
      name: z.string({ message: '名称必须是文本' }).min(1, '名称不能为空'),
      kind: z.enum(['pitched', 'percussion'], { message: '类型必须是 pitched（音高类）或 percussion（敲击类）' }),
      category: z
        .enum(INSTRUMENT_CATEGORIES, {
          message: '分类必须是 lyre（琴类）、drum（鼓类）、horn（圆号）、vocal（人声）或 custom（自定义）之一',
        })
        .default('custom'),
      status: z.enum(['verified', 'unverified'], { message: '状态必须是 verified（已验证）或 unverified（待实测）' }),
      rows: z
        .array(InstrumentRowSchema, { message: '行配置必须是数组' })
        .min(1, '至少需要 1 行')
        .max(4, '最多 4 行'),
      timing: InstrumentTimingSchema,
      percussionMap: PercussionMapSchema.optional(),
    },
    { message: '乐器配置必须是 JSON 对象' },
  )
  .superRefine((profile, ctx) => {
    const codes = new Set<string>();
    const pitches = new Set<number>();
    const voices = new Set<string>();
    const report = (path: PropertyKey[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message, input: profile });

    profile.rows.forEach((row, r) => {
      row.keys.forEach((key, k) => {
        const at = ['rows', r, 'keys', k];
        if (!isKnownKeyCode(key.code)) report([...at, 'code'], `未知键码「${key.code}」`);
        if (codes.has(key.code)) report([...at, 'code'], `键码「${key.code}」重复`);
        codes.add(key.code);

        if (profile.kind === 'pitched') {
          if (key.voice !== undefined) report([...at, 'voice'], '音高类乐器的键不能有 voice');
          const hasPitch = key.pitch !== undefined;
          const hasChord = key.chord !== undefined;
          if (hasPitch && hasChord) report([...at, 'chord'], '同一个键的 pitch 与 chord 只能二选一');
          else if (!hasPitch && !hasChord) report([...at, 'pitch'], '音高类乐器的键必须有 pitch 或 chord');
          else if (hasPitch) {
            if (pitches.has(key.pitch!)) report([...at, 'pitch'], `音高 ${key.pitch} 重复`);
            else pitches.add(key.pitch!);
          } else {
            if (key.label === undefined) report([...at, 'label'], '和弦键必须有 label（和弦名）');
            const notes = key.chord!;
            for (let i = 1; i < notes.length; i++) {
              if (notes[i] <= notes[i - 1]) {
                report([...at, 'chord'], '和弦构成音必须严格升序且不重复');
                break;
              }
            }
          }
        } else {
          if (key.pitch !== undefined) report([...at, 'pitch'], '敲击类乐器的键不能有 pitch');
          if (key.voice === undefined) report([...at, 'voice'], '敲击类乐器的键必须有 voice');
          else if (voices.has(key.voice)) report([...at, 'voice'], `音色「${key.voice}」重复`);
          else voices.add(key.voice);
        }
      });
    });

    if (profile.kind === 'percussion' && profile.percussionMap) {
      for (const [note, voice] of Object.entries(profile.percussionMap.drumNotes)) {
        if (!voices.has(voice)) report(['percussionMap', 'drumNotes', note], `音色「${voice}」在键位中不存在`);
      }
    }
  });

export type InstrumentKey = z.infer<typeof InstrumentKeySchema>;
export type InstrumentProfile = z.infer<typeof InstrumentProfileSchema>;

/** 多音色鼓的标准音色中文名（键帽字母 B/T/S/R 来自游戏界面，声音语义为实测结论） */
const DRUM_VOICE_LABELS: Readonly<Record<string, string>> = {
  bass: '底鼓',
  snare: '军鼓',
  'hi-hat': '擦',
  triplet: '三连音',
};

/** 敲击音色的显示名：don → 咚、ka → 咔、标准鼓音色 → 中文名（含 -2 等带序号的变体），其余原样 */
export function voiceLabel(voice: string): string {
  const match = /^(don|ka)(?:-(\d+))?$/.exec(voice);
  if (match) {
    const base = match[1] === 'don' ? '咚' : '咔';
    return match[2] ? `${base}-${match[2]}` : base;
  }
  const suffix = /-\d+$/.exec(voice);
  const base = suffix ? voice.slice(0, suffix.index) : voice;
  const label = DRUM_VOICE_LABELS[base];
  if (label === undefined) return voice;
  return suffix ? `${label}-${suffix[0].slice(1)}` : label;
}

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** 校验乐器配置；错误格式为「字段路径：说明」（schema 层与业务层都已是中文） */
export function validateInstrumentProfile(data: unknown): ValidationResult<InstrumentProfile> {
  const result = InstrumentProfileSchema.safeParse(data);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.map(String).join('.') : '(根)';
      return `${path}：${issue.message}`;
    }),
  };
}
