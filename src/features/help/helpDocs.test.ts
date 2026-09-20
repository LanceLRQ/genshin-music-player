import { describe, expect, it } from 'vitest';
import { extractMarkdownSection, githubSlug, HELP_SECTIONS, resolveHelpLink, sectionMarkdown } from './helpDocs';

describe('HELP_SECTIONS 与文档打包', () => {
  it('章节按「使用」「参考」分组且顺序稳定', () => {
    expect(HELP_SECTIONS.map((section) => section.id)).toEqual([
      'usage',
      'faq',
      'instrument-params',
      'keyscore',
      'jianpu',
      'instrument-profile',
      'audio-to-midi',
      'development',
    ]);
  });

  it('每个 Markdown 章节的文档都已打进包且非空', () => {
    for (const section of HELP_SECTIONS) {
      if (!section.doc) continue;
      expect(sectionMarkdown(section)!.length, section.id).toBeGreaterThan(0);
    }
  });

  it('乐器参数章节由组件生成，没有 Markdown 源', () => {
    expect(sectionMarkdown(HELP_SECTIONS.find((s) => s.id === 'instrument-params')!)).toBeNull();
  });
});

describe('extractMarkdownSection', () => {
  const markdown = ['# 标题', '', '## 甲', '', '内容一', '', '## 乙', '', '内容二', ''].join('\n');

  it('取「## 甲」到下一个 ## 之间的小节', () => {
    expect(extractMarkdownSection(markdown, '甲')).toBe('## 甲\n\n内容一');
  });

  it('最后一节取到文件末尾', () => {
    expect(extractMarkdownSection(markdown, '乙')).toBe('## 乙\n\n内容二');
  });

  it('找不到小节时抛错', () => {
    expect(() => extractMarkdownSection(markdown, '丙')).toThrow('找不到小节');
  });

  it('常见问题章节从使用指南抽出，不含「更多文档」', () => {
    const faq = sectionMarkdown(HELP_SECTIONS.find((s) => s.id === 'faq')!)!;
    expect(faq.startsWith('## 常见问题')).toBe(true);
    expect(faq).toContain('Q：');
    expect(faq).not.toContain('## 更多文档');
  });
});

describe('githubSlug', () => {
  it('中文标题原样保留', () => {
    expect(githubSlug('界面总览')).toBe('界面总览');
  });

  it('去掉中文标点（与 GitHub 锚点一致）', () => {
    expect(githubSlug('乐器页：管理与自定义')).toBe('乐器页管理与自定义');
    expect(githubSlug('进度条、定位与区间循环')).toBe('进度条定位与区间循环');
  });

  it('空白折叠为单个连字符，转小写', () => {
    expect(githubSlug('Quick Start')).toBe('quick-start');
  });
});

describe('resolveHelpLink', () => {
  const guide = 'docs/guides/user-guide.md';

  it('跨目录相对链接解析到对应章节', () => {
    expect(resolveHelpLink(guide, '../formats/keyscore.md')).toEqual({ kind: 'section', sectionId: 'keyscore' });
    expect(resolveHelpLink(guide, 'audio-to-midi.md')).toEqual({
      kind: 'section',
      sectionId: 'audio-to-midi',
    });
    expect(resolveHelpLink('docs/development.md', 'guides/user-guide.md')).toEqual({
      kind: 'section',
      sectionId: 'usage',
    });
  });

  it('带锚点的文档链接保留锚点', () => {
    expect(resolveHelpLink(guide, '../formats/keyscore.md#语法')).toEqual({
      kind: 'section',
      sectionId: 'keyscore',
      anchor: '语法',
    });
  });

  it('未收录的仓库文档（README）标记为外部文档', () => {
    expect(resolveHelpLink(guide, '../../README.md')).toEqual({ kind: 'external-doc' });
    expect(resolveHelpLink('docs/formats/keyscore.md', '../README.md')).toEqual({ kind: 'external-doc' });
  });

  it('网页链接与非 .md 链接不当作文档跳转', () => {
    expect(resolveHelpLink(guide, 'https://example.com/a.md')).toEqual({ kind: 'external' });
    expect(resolveHelpLink(guide, '#常见问题')).toEqual({ kind: 'external' });
  });
});

describe('文档内链接的一致性', () => {
  it('打包文档里的所有 .md 链接都能映射到章节或明确降级', () => {
    const docs = [...new Set(HELP_SECTIONS.map((s) => s.doc).filter((doc): doc is string => doc !== undefined))];
    expect(docs.length).toBeGreaterThan(0);
    for (const doc of docs) {
      const markdown = sectionMarkdown(HELP_SECTIONS.find((s) => s.doc === doc)!)!;
      for (const href of [...markdown.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1])) {
        if (!/\.md($|#)/.test(href)) continue;
        const link = resolveHelpLink(doc, href);
        expect(['section', 'external-doc'], `${doc} → ${href}`).toContain(link.kind);
      }
    }
  });

  it('使用指南里的每个锚点链接都能命中一个标题', () => {
    const markdown = sectionMarkdown(HELP_SECTIONS.find((s) => s.id === 'usage')!)!;
    const slugs = new Set(
      [...markdown.matchAll(/^#{1,4}\s+(.+)$/gm)].map((match) => githubSlug(match[1])),
    );
    const anchors = new Set([...markdown.matchAll(/\]\(#([^)]+)\)/g)].map((match) => match[1]));
    expect(anchors.size).toBeGreaterThan(0);
    for (const anchor of anchors) expect(slugs, anchor).toContain(anchor);
  });
});
