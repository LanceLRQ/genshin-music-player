import { ScoreParseError } from './parsers/errors';

/** 执行 run 并返回它抛出的 ScoreParseError；没有抛出或抛出其他错误时让测试失败 */
export function catchParseError(run: () => unknown): ScoreParseError {
  try {
    run();
  } catch (error) {
    if (error instanceof ScoreParseError) return error;
    throw error;
  }
  throw new Error('预期抛出 ScoreParseError，但没有抛出');
}
