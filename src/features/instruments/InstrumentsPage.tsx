import { Piano } from 'lucide-react';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';

/** 占位页面，由乐器页与设置页的计划（M3d）整份替换 */
export function InstrumentsPage() {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Piano />
        </EmptyMedia>
        <EmptyTitle>乐器</EmptyTitle>
        <EmptyDescription>乐器页尚未实现。</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
