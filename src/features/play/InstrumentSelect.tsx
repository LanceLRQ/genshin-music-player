import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { InstrumentEntry } from '@/core/instruments/registry';
import { useAdaptStore } from '@/stores/adaptStore';
import { useInstrumentStore } from '@/stores/instrumentStore';

interface InstrumentSelectProps {
  disabled?: boolean;
  /** 切换目标乐器（页面负责重置自动推荐） */
  onValueChange: (id: string) => void;
}

/** 目标乐器选择：内置与自定义分组，待实测乐器带徽章（设计 01 第 4.3 节） */
export function InstrumentSelect({ disabled, onValueChange }: InstrumentSelectProps) {
  const entries = useInstrumentStore((state) => state.entries);
  const targetId = useAdaptStore((state) => state.targetId);
  const current = entries.find((entry) => entry.profile.id === targetId);
  const builtin = entries.filter((entry) => entry.builtin);
  const custom = entries.filter((entry) => !entry.builtin);
  const renderItem = (entry: InstrumentEntry) => (
    <SelectItem key={entry.profile.id} value={entry.profile.id}>
      {entry.profile.name}
      {entry.profile.status === 'unverified' && <Badge variant="outline" className="ml-2">待实测</Badge>}
    </SelectItem>
  );
  return (
    <div className="flex flex-col gap-1.5">
      <Select value={targetId} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>内置</SelectLabel>
            {builtin.map(renderItem)}
          </SelectGroup>
          {custom.length > 0 && (
            <SelectGroup>
              <SelectLabel>自定义</SelectLabel>
              {custom.map(renderItem)}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
      {current?.profile.status === 'unverified' && (
        <p className="text-xs text-muted-foreground">该乐器的键位和音高尚未在游戏中验证，可能与实际不符。</p>
      )}
    </div>
  );
}
