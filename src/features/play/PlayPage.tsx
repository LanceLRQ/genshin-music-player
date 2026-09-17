import { Music } from 'lucide-react';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';

/** 占位页面，由演奏页的计划（M3c）整份替换 */
export function PlayPage() {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Music />
        </EmptyMedia>
        <EmptyTitle>演奏</EmptyTitle>
        <EmptyDescription>演奏页尚未实现。</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
