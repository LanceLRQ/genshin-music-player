import { Fragment, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { HELP_SECTIONS, sectionMarkdown, type HelpSectionDef, type HelpSectionId } from './helpDocs';
import { InstrumentParams } from './InstrumentParams';
import { Markdown } from './Markdown';

const GROUPS = ['使用', '参考'] as const;

function SectionContent({
  section,
  onOpenSection,
}: {
  section: HelpSectionDef;
  onOpenSection: (sectionId: HelpSectionId, anchor?: string) => void;
}) {
  const markdown = sectionMarkdown(section);
  if (markdown === null) return <InstrumentParams />;
  return <Markdown markdown={markdown} doc={section.doc} onOpenSection={onOpenSection} />;
}

/** 帮助页：左侧章节目录，右侧渲染仓库使用者文档、常见问题和乐器参数速查 */
export function HelpPage() {
  const [sectionId, setSectionId] = useState<HelpSectionId>('usage');
  /** 跨章节锚点：切换章节渲染完成后再滚动到目标标题 */
  const [pendingAnchor, setPendingAnchor] = useState<string>();

  const section = HELP_SECTIONS.find((item) => item.id === sectionId) ?? HELP_SECTIONS[0];

  useEffect(() => {
    if (!pendingAnchor) return;
    const timer = setTimeout(() => {
      document.getElementById(pendingAnchor)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
      setPendingAnchor(undefined);
    }, 50);
    return () => clearTimeout(timer);
  }, [pendingAnchor, sectionId]);

  const openSection = (id: HelpSectionId, anchor?: string) => {
    setSectionId(id);
    if (anchor) setPendingAnchor(anchor);
  };

  return (
    <div className="flex h-full min-h-0">
      <nav className="flex w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r p-4" aria-label="帮助目录">
        {GROUPS.map((group) => (
          <Fragment key={group}>
            <p className="px-2 pt-1 text-xs text-muted-foreground">{group}</p>
            {HELP_SECTIONS.filter((item) => item.group === group).map((item) => (
              <Button
                key={item.id}
                variant="ghost"
                className={cn('w-full justify-start', sectionId === item.id && 'bg-accent')}
                aria-current={sectionId === item.id ? 'page' : undefined}
                onClick={() => openSection(item.id)}
              >
                {item.title}
              </Button>
            ))}
          </Fragment>
        ))}
      </nav>
      {/* key 让切换章节时滚动位置回到顶部 */}
      <div key={sectionId} className="min-w-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl">
          <SectionContent section={section} onOpenSection={openSection} />
        </div>
      </div>
    </div>
  );
}
