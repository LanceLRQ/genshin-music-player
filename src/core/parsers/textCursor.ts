import { ScoreParseError } from './errors';

export interface TextPosition {
  line: number;
  col: number;
}

export function isBlank(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n';
}

/** 逐字符扫描文本，并跟踪 1 起始的行号和列号 */
export class TextCursor {
  private readonly text: string;
  private index = 0;
  private line = 1;
  private col = 1;

  constructor(text: string) {
    this.text = text;
  }

  get done(): boolean {
    return this.index >= this.text.length;
  }

  /** 超出末尾时返回空字符串 */
  peek(offset = 0): string {
    return this.text.charAt(this.index + offset);
  }

  startsWith(token: string): boolean {
    return this.text.startsWith(token, this.index);
  }

  next(): string {
    const ch = this.text.charAt(this.index);
    this.index += 1;
    if (ch === '\n') {
      this.line += 1;
      this.col = 1;
    } else {
      this.col += 1;
    }
    return ch;
  }

  readWhile(predicate: (ch: string) => boolean): string {
    let out = '';
    while (!this.done && predicate(this.peek())) out += this.next();
    return out;
  }

  skipLine(): void {
    while (!this.done && this.peek() !== '\n') this.next();
  }

  position(): TextPosition {
    return { line: this.line, col: this.col };
  }

  error(message: string, at: TextPosition = this.position()): ScoreParseError {
    return new ScoreParseError(message, at);
  }
}

export interface Directive {
  name: string;
  value: string;
  at: TextPosition;
}

/** 读取 `@名称=值`，值一直读到空白字符为止；调用时游标必须停在 `@` 上 */
export function readDirective(cursor: TextCursor): Directive {
  const at = cursor.position();
  cursor.next();
  const body = cursor.readWhile((ch) => !isBlank(ch));
  const eq = body.indexOf('=');
  if (eq <= 0) throw cursor.error(`指令格式应为 @名称=值：「@${body}」`, at);
  return { name: body.slice(0, eq), value: body.slice(eq + 1), at };
}
