import { Copy, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatMs } from '@/lib/format';
import { useEnvStore } from '@/stores/envStore';
import { useTransportStore } from '@/stores/transportStore';

/** 上次演奏统计（设计 01 第 4.11 节） */
export function SummaryLine() {
  const summary = useTransportStore((state) => state.summary);
  const mock = useEnvStore((state) => state.env?.backend === 'mock');
  if (!summary) return null;
  const { completed, eventsSent, latenessP50Ms, latenessP95Ms, latenessMaxMs, dropped, logPath } = summary;
  const copyPath = async () => {
    if (logPath === null) return;
    try {
      await navigator.clipboard.writeText(logPath);
      toast.success('已复制日志路径');
    } catch {
      toast.error('复制日志路径失败');
    }
  };
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      {/* nowrap 防止统计在 p50 / p95 之间断行 */}
      <p className="flex flex-wrap items-center gap-1.5">
        {mock && <Badge variant="secondary">模拟</Badge>}
        <span className="whitespace-nowrap">
          上次演奏：{eventsSent} 次按键 · 延迟 p50 {formatMs(latenessP50Ms)} · p95 {formatMs(latenessP95Ms)} · 最大{' '}
          {formatMs(latenessMaxMs)}
          {dropped > 0 && <> · 变速丢弃 {dropped}</>}
          {!completed && <>（已停止）</>}
        </span>
      </p>
      {logPath !== null && (
        <p className="flex min-w-0 items-center gap-1.5">
          <FileText className="size-3.5 shrink-0" />
          <span className="truncate" title={logPath}>
            {logPath}
          </span>
          <Button variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-xs" onClick={() => void copyPath()}>
            <Copy className="size-3" />
            复制路径
          </Button>
        </p>
      )}
    </div>
  );
}
