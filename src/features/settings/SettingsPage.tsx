import { Settings } from 'lucide-react';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';

/** 占位页面，由乐器页与设置页的计划（M3d）整份替换 */
export function SettingsPage() {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Settings />
        </EmptyMedia>
        <EmptyTitle>设置</EmptyTitle>
        <EmptyDescription>设置页尚未实现。</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
