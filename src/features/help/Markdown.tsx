import { isValidElement, type ReactNode, useRef } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { githubSlug, resolveHelpLink, type HelpSectionId } from './helpDocs';

/** 从 React 子树里抽出纯文本，用于给标题生成锚点 id */
function nodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (isValidElement(node)) return nodeText((node.props as { children?: ReactNode }).children);
  return '';
}

/** 锚点 href 里的中文可能是原文也可能是百分号编码，统一解码 */
function anchorSlug(href: string): string {
  const raw = href.slice(1);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

const LINK_CLASS = 'text-primary underline-offset-4 hover:underline';

interface MarkdownProps {
  markdown: string;
  /** 这份内容来自哪份仓库文档（规范化路径），用于把相对 .md 链接解析成章节跳转 */
  doc?: string;
  onOpenSection?: (sectionId: HelpSectionId, anchor?: string) => void;
}

/** 帮助页的 Markdown 渲染：GitHub 风格表格 + 文内锚点滚动 + 跨文档链接跳章节 */
export function Markdown({ markdown, doc, onOpenSection }: MarkdownProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  const scrollToAnchor = (slug: string) => {
    // slug 只含字母数字、中文和连字符（githubSlug 已去标点），可以安全拼进属性选择器
    rootRef.current
      ?.querySelector(`[id="${slug}"]`)
      ?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };

  const components: Components = {
    h1: ({ children }) => (
      <h1 id={githubSlug(nodeText(children))} className="mb-4 text-2xl font-bold tracking-tight">
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 id={githubSlug(nodeText(children))} className="mt-8 mb-3 border-b pb-1.5 text-lg font-semibold">
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 id={githubSlug(nodeText(children))} className="mt-6 mb-2 text-base font-semibold">
        {children}
      </h3>
    ),
    h4: ({ children }) => (
      <h4 id={githubSlug(nodeText(children))} className="mt-4 mb-2 text-sm font-semibold">
        {children}
      </h4>
    ),
    p: ({ children }) => <p className="mb-3 text-sm leading-6">{children}</p>,
    ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-6 text-sm leading-6">{children}</ul>,
    ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-6 text-sm leading-6">{children}</ol>,
    blockquote: ({ children }) => <blockquote className="mb-3 border-l-2 pl-4 text-muted-foreground">{children}</blockquote>,
    hr: () => <hr className="my-6 border" />,
    a: ({ href, children }) => {
      if (!href) return <>{children}</>;
      if (href.startsWith('#')) {
        return (
          <button type="button" className={LINK_CLASS} onClick={() => scrollToAnchor(anchorSlug(href))}>
            {children}
          </button>
        );
      }
      if (doc && href.endsWith('.md')) {
        const link = resolveHelpLink(doc, href);
        if (link.kind === 'section') {
          return (
            <button
              type="button"
              className={LINK_CLASS}
              onClick={() => onOpenSection?.(link.sectionId, link.anchor)}
            >
              {children}
            </button>
          );
        }
        if (link.kind === 'external-doc') {
          return (
            <span className="text-muted-foreground" title="这篇没有收进应用内帮助，完整内容在仓库 docs/ 目录里">
              {children}
            </span>
          );
        }
      }
      return (
        <a href={href} target="_blank" rel="noreferrer" className={LINK_CLASS}>
          {children}
        </a>
      );
    },
    table: ({ children }) => (
      <div className="mb-4 overflow-x-auto rounded-md border">
        <table className="w-full border-collapse text-sm">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
    th: ({ children }) => <th className="px-2.5 py-1.5 text-left font-medium whitespace-nowrap">{children}</th>,
    td: ({ children }) => <td className="border-t px-2.5 py-1.5 align-top leading-6">{children}</td>,
    // 围栏代码块内的 <code> 不套行内样式；无语言标注的围栏也走这条覆盖
    pre: ({ children }) => (
      <pre className="mb-4 overflow-x-auto rounded-md border bg-muted p-3 text-xs leading-5 [&>code]:bg-transparent [&>code]:px-0 [&>code]:py-0 [&>code]:text-foreground">
        {children}
      </pre>
    ),
    code: ({ children }) => <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[0.85em]">{children}</code>,
  };

  return (
    <div ref={rootRef} className={cn('help-markdown max-w-none [&>*:first-child]:mt-0')}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
