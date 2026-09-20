/**
 * 帮助页的数据层：把仓库 docs/ 下的使用者文档打进前端包，并定义帮助页章节。
 *
 * 文档只在构建时打包（import.meta.glob + ?raw），不做运行时文件读取；
 * docs/_internal、docs/superpowers 不在 glob 范围内，不会进包。
 * 文档内示例由 src/docs/docsExamples.test.ts 保证与代码行为一致，
 * 这里的测试保证章节、链接与锚点在帮助页里能正确解析。
 */

const rootDocs = import.meta.glob('/docs/*.md', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const guideDocs = import.meta.glob('/docs/guides/*.md', { eager: true, query: '?raw', import: 'default' }) as Record<
  string,
  string
>;
const formatDocs = import.meta.glob('/docs/formats/*.md', { eager: true, query: '?raw', import: 'default' }) as Record<
  string,
  string
>;

/** '/docs/guides/user-guide.md' → 'docs/guides/user-guide.md' */
function normalizeKey(globKey: string): string {
  return globKey.replace(/^\//, '');
}

const DOC_CONTENTS: Record<string, string> = {};
for (const [key, value] of Object.entries({ ...rootDocs, ...guideDocs, ...formatDocs })) {
  DOC_CONTENTS[normalizeKey(key)] = value;
}

export type HelpSectionId =
  | 'usage'
  | 'faq'
  | 'instrument-params'
  | 'keyscore'
  | 'jianpu'
  | 'instrument-profile'
  | 'audio-to-midi'
  | 'development';

export interface HelpSectionDef {
  id: HelpSectionId;
  title: string;
  group: '使用' | '参考';
  /** 内容来自哪份仓库文档（规范化路径）；省略表示内容由帮助页组件生成 */
  doc?: string;
  /** 只取文档中「## <heading>」这一小节（到下一个 ## 为止），用于从使用指南抽出常见问题 */
  sectionHeading?: string;
}

export const HELP_SECTIONS: readonly HelpSectionDef[] = [
  { id: 'usage', title: '使用指南', group: '使用', doc: 'docs/guides/user-guide.md' },
  { id: 'faq', title: '常见问题', group: '使用', doc: 'docs/guides/user-guide.md', sectionHeading: '常见问题' },
  { id: 'instrument-params', title: '乐器参数', group: '参考' },
  { id: 'keyscore', title: '键盘谱语法', group: '参考', doc: 'docs/formats/keyscore.md' },
  { id: 'jianpu', title: '简谱语法', group: '参考', doc: 'docs/formats/jianpu.md' },
  { id: 'instrument-profile', title: '乐器配置格式', group: '参考', doc: 'docs/formats/instrument-profile.md' },
  { id: 'audio-to-midi', title: '从音频提取 MIDI', group: '参考', doc: 'docs/guides/audio-to-midi.md' },
  { id: 'development', title: '开发文档', group: '参考', doc: 'docs/development.md' },
];

/** 章节正文；生成型章节（乐器参数）返回 null，由组件自己渲染 */
export function sectionMarkdown(def: HelpSectionDef): string | null {
  if (!def.doc) return null;
  const markdown = DOC_CONTENTS[def.doc];
  if (markdown === undefined) throw new Error(`帮助文档缺失：${def.doc}`);
  return def.sectionHeading ? extractMarkdownSection(markdown, def.sectionHeading) : markdown;
}

/** 取 markdown 中「## <heading>」小节：从该标题行起，到下一个 ## 标题前止 */
export function extractMarkdownSection(markdown: string, heading: string): string {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) throw new Error(`文档中找不到小节「## ${heading}」`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines
    .slice(start, end)
    .join('\n')
    .trim();
}

/** GitHub 风格的标题锚点：小写、去标点、空白转连字符；中文标题原样保留 */
export function githubSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-');
}

export type HelpLink =
  | { kind: 'section'; sectionId: HelpSectionId; anchor?: string }
  | { kind: 'external' }
  /** 仓库里还有、但没有打进帮助页的文档（如 README），渲染成不可点的说明文字 */
  | { kind: 'external-doc' };

/** 文档路径 → 章节；同一份文档只映射全文章节（常见问题抽取自使用指南，链接应跳到全文） */
const DOC_TO_SECTION = new Map<string, HelpSectionId>(
  HELP_SECTIONS.filter((section) => section.doc && !section.sectionHeading).map((section) => [
    section.doc as string,
    section.id,
  ]),
);

/** 解析文档里的相对链接（../formats/keyscore.md、audio-to-midi.md 等）到帮助章节 */
export function resolveHelpLink(fromDoc: string, href: string): HelpLink {
  if (/^https?:\/\//.test(href)) return { kind: 'external' };

  const [pathPart, anchor] = href.split('#');
  if (!pathPart.endsWith('.md')) return { kind: 'external' };

  const stack = fromDoc.split('/').slice(0, -1); // 所在目录
  for (const segment of pathPart.split('/')) {
    if (segment === '..') stack.pop();
    else if (segment !== '.' && segment !== '') stack.push(segment);
  }
  const sectionId = DOC_TO_SECTION.get(stack.join('/'));
  if (sectionId) return { kind: 'section', sectionId, anchor: anchor || undefined };
  return { kind: 'external-doc' };
}
