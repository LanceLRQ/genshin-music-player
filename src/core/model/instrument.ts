import { z } from 'zod';
import { isKnownKeyCode } from './keycodes';

export const INSTRUMENT_FILE_VERSION = 1;

export const InstrumentKeySchema = z.object({
  code: z.string().min(1),
  pitch: z.number().int().min(0).max(127).optional(),
  voice: z.string().min(1).optional(),
});

export const InstrumentRowSchema = z.object({
  label: z.string(),
  keys: z.array(InstrumentKeySchema).min(1).max(12),
});

export const InstrumentTimingSchema = z.object({
  holdMs: z.number().int().min(1).max(1000),
  minRepeatGapMs: z.number().int().min(0).max(1000),
  sustain: z.boolean().default(false),
});

export const PercussionMapSchema = z.object({
  drumNotes: z.record(z.string().regex(/^\d{1,3}$/), z.string().min(1)),
  splitPitch: z.union([z.literal('auto'), z.number().int().min(0).max(127)]),
});

export const InstrumentProfileSchema = z
  .object({
    schemaVersion: z.literal(INSTRUMENT_FILE_VERSION),
    id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'id 只能包含小写字母、数字和连字符'),
    name: z.string().min(1),
    kind: z.enum(['pitched', 'percussion']),
    status: z.enum(['verified', 'unverified']),
    rows: z.array(InstrumentRowSchema).min(1).max(4),
    timing: InstrumentTimingSchema,
    percussionMap: PercussionMapSchema.optional(),
  })
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
          if (key.pitch === undefined) report([...at, 'pitch'], '音高类乐器的键必须有 pitch');
          else if (pitches.has(key.pitch)) report([...at, 'pitch'], `音高 ${key.pitch} 重复`);
          else pitches.add(key.pitch);
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

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** 校验乐器配置；错误格式为「字段路径：说明」 */
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
