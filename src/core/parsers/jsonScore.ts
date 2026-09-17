import { SCORE_FILE_VERSION, ScoreFileSchema, type Score } from '../model/score';
import { ScoreParseError } from './errors';

export function parseJsonScore(text: string): Score {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ScoreParseError(`不是合法的 JSON：${error instanceof Error ? error.message : String(error)}`);
  }
  const result = ScoreFileSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length > 0 ? issue.path.map(String).join('.') : '(根)';
    throw new ScoreParseError(issue.message, { path });
  }
  return { meta: { ...result.data.meta, source: 'json' }, tracks: result.data.tracks };
}

export function serializeScore(score: Score): string {
  return JSON.stringify({ schemaVersion: SCORE_FILE_VERSION, ...score }, null, 2);
}
