import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Track } from '@/core/model/score';
import { TrackItem, type SoloMode } from './TrackItem';

const MAX_VISIBLE_TRACKS = 8;

interface TrackListProps {
  tracks: Track[];
  checkedIds: readonly string[];
  rates: Record<string, number | null>;
  /** 目标乐器是否为音高类：鼓轨不可参与 */
  pitched: boolean;
  locked: boolean;
  onSetChecked: (ids: string[]) => void;
  onSolo: (mode: SoloMode, trackId: string) => void;
}

/** 音轨列表：勾选的音轨合并适配（设计 01 第 4.4 节）；超过 8 条时内部滚动 */
export function TrackList({ tracks, checkedIds, rates, pitched, locked, onSetChecked, onSolo }: TrackListProps) {
  const toggle = (trackId: string) => {
    onSetChecked(
      checkedIds.includes(trackId) ? checkedIds.filter((id) => id !== trackId) : [...checkedIds, trackId],
    );
  };
  const selectAll = () => onSetChecked(tracks.filter((track) => !pitched || !track.isDrum).map((track) => track.id));
  const list = tracks.map((track) => (
    <TrackItem
      key={track.id}
      track={track}
      checked={checkedIds.includes(track.id)}
      rate={rates[track.id] ?? null}
      drumDisabled={pitched && track.isDrum}
      locked={locked}
      onCheckedChange={() => toggle(track.id)}
      onSolo={(mode) => onSolo(mode, track.id)}
    />
  ));
  return (
    <Card>
      <CardHeader>
        <CardTitle>音轨</CardTitle>
        <CardAction className="flex items-center gap-3">
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" disabled={locked} onClick={selectAll}>
            全选
          </Button>
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            disabled={locked}
            onClick={() => onSetChecked([])}
          >
            全不选
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {tracks.length > MAX_VISIBLE_TRACKS ? (
          <ScrollArea className="max-h-[360px]">
            <div className="flex flex-col gap-2 pr-3">{list}</div>
          </ScrollArea>
        ) : (
          <div className="flex flex-col gap-2">{list}</div>
        )}
      </CardContent>
    </Card>
  );
}
