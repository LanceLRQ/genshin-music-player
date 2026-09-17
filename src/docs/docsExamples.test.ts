import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BUILTIN_INSTRUMENTS } from '../core/instruments/registry';
import { validateInstrumentProfile } from '../core/model/instrument';
import { parseJianpu } from '../core/parsers/jianpu';
import { parseKeyscore } from '../core/parsers/keyscore';

/**
 * 文档示例与代码行为的一致性校验。
 *
 * 约定：文档中的代码围栏用语言标注区分示例类型——
 * - ```keyscore / ```jianpu：必须解析成功的合法示例；
 * - ```keyscore-error / ```jianpu-error：预期解析失败的示例，块内第一行必须是
 *   `// 预期错误: <关键字>`（这一行本身也是合法的 `//` 注释，不影响后续内容的解析），
 *   测试据此断言抛出的错误信息包含这个关键字；
 * - ```json（仅 instrument-profile.md）：完整的乐器配置示例，必须通过 validateInstrumentProfile；
 * - ```json-error：预期校验失败的乐器配置，紧跟一行 HTML 注释 `<!-- 预期错误: <关键字> -->`
 *   写在代码块之前，说明校验错误列表中应包含的关键字。
 *
 * 这样文档里的每个示例都会随 `pnpm test` 一起被验证，代码行为变化时文档会同步报错。
 */

interface FencedBlock {
  lang: string;
  body: string;
}

function extractFencedBlocks(markdown: string): FencedBlock[] {
  const lines = markdown.split('\n');
  const blocks: FencedBlock[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const open = /^```([a-z-]+)\s*$/.exec(lines[i]);
    if (!open) continue;
    const lang = open[1];
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length && lines[j] !== '```') {
      body.push(lines[j]);
      j += 1;
    }
    blocks.push({ lang, body: body.join('\n') });
    i = j;
  }
  return blocks;
}

function precedingComment(markdown: string, blockBody: string): string | undefined {
  const marker = '```json-error\n' + blockBody;
  const index = markdown.indexOf(marker);
  if (index === -1) return undefined;
  const before = markdown.slice(0, index);
  const match = /<!--\s*预期错误[:：]\s*(.+?)\s*-->\s*\n+$/.exec(before);
  return match?.[1];
}

function expectedErrorOf(body: string): string {
  const match = /^\/\/\s*预期错误[:：]\s*(.+)$/.exec(body.split('\n')[0]);
  if (!match) throw new Error(`错误示例缺少「// 预期错误: ...」首行：\n${body}`);
  return match[1];
}

const currentDir = dirname(fileURLToPath(import.meta.url));

function readDoc(relativePath: string): string {
  // 跨平台检出时 CRLF 会让代码围栏的结束行带上 \r，围栏匹配会一直吃到文件末尾，这里统一换行符
  return readFileSync(join(currentDir, '../../docs', relativePath), 'utf8').replace(/\r\n/g, '\n');
}

const resolveInstrument = (id: string) => BUILTIN_INSTRUMENTS.find((p) => p.id === id);

describe('docs/formats/keyscore.md 示例', () => {
  const markdown = readDoc('formats/keyscore.md');
  const blocks = extractFencedBlocks(markdown);
  const keyscoreBlocks = blocks.filter((b) => b.lang === 'keyscore');
  const errorBlocks = blocks.filter((b) => b.lang === 'keyscore-error');

  it('文档至少包含一个合法示例和一个错误示例', () => {
    expect(keyscoreBlocks.length).toBeGreaterThan(0);
    expect(errorBlocks.length).toBeGreaterThan(0);
  });

  it.each(keyscoreBlocks.map((b, i) => [i, b.body] as const))('合法示例 #%i 解析不报错', (_i, body) => {
    expect(() =>
      parseKeyscore(body, { title: '文档示例', defaultInstrumentId: 'windsong-lyre', resolveInstrument }),
    ).not.toThrow();
  });

  it.each(errorBlocks.map((b, i) => [i, b.body] as const))('错误示例 #%i 抛出预期错误', (_i, body) => {
    const expected = expectedErrorOf(body);
    let message = '';
    try {
      parseKeyscore(body, { title: '文档示例', defaultInstrumentId: 'windsong-lyre', resolveInstrument });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain(expected);
  });
});

describe('docs/formats/jianpu.md 示例', () => {
  const markdown = readDoc('formats/jianpu.md');
  const blocks = extractFencedBlocks(markdown);
  const jianpuBlocks = blocks.filter((b) => b.lang === 'jianpu');
  const errorBlocks = blocks.filter((b) => b.lang === 'jianpu-error');

  it('文档至少包含一个合法示例和一个错误示例', () => {
    expect(jianpuBlocks.length).toBeGreaterThan(0);
    expect(errorBlocks.length).toBeGreaterThan(0);
  });

  it.each(jianpuBlocks.map((b, i) => [i, b.body] as const))('合法示例 #%i 解析不报错', (_i, body) => {
    expect(() => parseJianpu(body, { title: '文档示例' })).not.toThrow();
  });

  it.each(errorBlocks.map((b, i) => [i, b.body] as const))('错误示例 #%i 抛出预期错误', (_i, body) => {
    const expected = expectedErrorOf(body);
    let message = '';
    try {
      parseJianpu(body, { title: '文档示例' });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain(expected);
  });
});

describe('docs/formats/instrument-profile.md 示例', () => {
  const markdown = readDoc('formats/instrument-profile.md');
  const blocks = extractFencedBlocks(markdown);
  const jsonBlocks = blocks.filter((b) => b.lang === 'json');
  const errorBlocks = blocks.filter((b) => b.lang === 'json-error');

  it('文档至少包含一个完整乐器示例', () => {
    expect(jsonBlocks.length).toBeGreaterThan(0);
  });

  it.each(jsonBlocks.map((b, i) => [i, b.body] as const))('乐器示例 #%i 通过校验', (_i, body) => {
    const result = validateInstrumentProfile(JSON.parse(body));
    expect(result.ok).toBe(true);
  });

  it.each(errorBlocks.map((b, i) => [i, b.body] as const))('错误示例 #%i 校验失败并包含预期错误', (_i, body) => {
    const expected = precedingComment(markdown, body);
    expect(expected).toBeDefined();
    const result = validateInstrumentProfile(JSON.parse(body));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes(expected as string))).toBe(true);
  });
});
