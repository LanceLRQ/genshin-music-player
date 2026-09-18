import { useEffect, useState } from 'react';
import { listOutputDevices, sinkSelectionSupported, watchOutputDevices, type OutputDevice } from '@/audio/outputDevices';
import { previewPlayer } from '@/audio/previewPlayer';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** 「系统默认」的选项值；Radix Select 的选项不允许空字符串 */
const DEFAULT_SINK = 'default';

/** 试听输出设备选择（与音量一致只记在本地）。WebView 不支持 setSinkId 或枚举不到输出设备时整行不渲染 */
export function OutputDeviceSelect() {
  const [devices, setDevices] = useState<OutputDevice[] | null>(null);
  const [sinkId, setSinkId] = useState(() => previewPlayer.currentSinkId);

  useEffect(() => {
    if (!sinkSelectionSupported()) return;
    let cancelled = false;
    const refresh = async () => {
      const next = await listOutputDevices();
      if (!cancelled) setDevices(next);
    };
    void refresh();
    const stopWatching = watchOutputDevices(() => void refresh());
    return () => {
      cancelled = true;
      stopWatching();
    };
  }, []);

  if (!devices || devices.length === 0) return null;
  const current = sinkId && devices.some((device) => device.id === sinkId) ? sinkId : DEFAULT_SINK;

  const change = async (next: string) => {
    const id = next === DEFAULT_SINK ? '' : next;
    setSinkId(id);
    try {
      await previewPlayer.setSink(id);
    } catch {
      // 设备在枚举之后被拔掉：回到系统默认
      setSinkId('');
      await previewPlayer.setSink('').catch(() => {});
    }
  };

  return (
    <div className="flex items-center gap-3">
      <span className="w-14 shrink-0 text-sm">输出</span>
      <Select value={current} onValueChange={(next) => void change(next)}>
        <SelectTrigger className="flex-1" aria-label="试听输出设备">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT_SINK}>系统默认</SelectItem>
          {devices.map((device) => (
            <SelectItem key={device.id} value={device.id}>
              {device.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
