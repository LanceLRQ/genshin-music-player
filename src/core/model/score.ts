import { z } from 'zod';

export const SCORE_FILE_VERSION = 1;

export const NoteSchema = z
  .object({
    startMs: z.number().min(0),
    durationMs: z.number().min(0),
    pitch: z.number().int().min(0).max(127).optional(),
    voice: z.string().min(1).optional(),
    velocity: z.number().min(0).max(1),
  })
  .refine((note) => note.pitch !== undefined || note.voice !== undefined, {
    error: '音符必须有 pitch 或 voice',
  });

export const TrackSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  isDrum: z.boolean(),
  notes: z.array(NoteSchema),
});

export const ScoreSourceSchema = z.enum(['midi', 'keyscore', 'jianpu', 'json']);

export const ScoreSchema = z.object({
  meta: z.object({
    title: z.string(),
    source: ScoreSourceSchema,
    bpm: z.number().positive().optional(),
  }),
  tracks: z.array(TrackSchema),
});

export const ScoreFileSchema = ScoreSchema.extend({ schemaVersion: z.literal(SCORE_FILE_VERSION) });

export type Note = z.infer<typeof NoteSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type Score = z.infer<typeof ScoreSchema>;
export type ScoreSource = z.infer<typeof ScoreSourceSchema>;
