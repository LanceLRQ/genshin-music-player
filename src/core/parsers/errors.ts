export interface ParseLocation {
  line?: number;
  col?: number;
  /** JSON 字段路径，如 tracks.0.notes.1 */
  path?: string;
}

export class ScoreParseError extends Error {
  readonly line?: number;
  readonly col?: number;
  readonly path?: string;

  constructor(detail: string, location: ParseLocation = {}) {
    super(formatMessage(detail, location));
    this.name = 'ScoreParseError';
    this.line = location.line;
    this.col = location.col;
    this.path = location.path;
  }
}

function formatMessage(detail: string, { line, col, path }: ParseLocation): string {
  if (line !== undefined && col !== undefined) return `第 ${line} 行第 ${col} 列：${detail}`;
  if (path !== undefined) return `${path}：${detail}`;
  return detail;
}
