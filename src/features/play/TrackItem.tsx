import { Headphones, Play } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { midiToNoteName } from '@/core/music/pitch';
import type { Track } from '@/core/model/score';
import { formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';
import { formatTimeShort, rateTextClass, trackStats } from './scoreInfo';

export type SoloMode = 'preview' | 'play';

interface TrackItemProps {
  track: Track;
  checked: boolean;
  /** 单独适配这条音轨的命中率；没有可处理的音时为 null */
  rate: number | null;
  /** 音高类乐器下鼓轨不可参与适配 */
  drumDisabled: boolean;
  locked: boolean;
  onCheckedChange: (checked: boolean) => void;
  onSolo: (mode: SoloMode) => void;
}

/** 单条音轨（设计 01 第 4.4 节） */
export function TrackItem({ track, checked, rate, drumDisabled, locked, onCheckedChange, onSolo }: TrackItemProps) {
  const stats = trackStats(track);
  const soloDisabled = drumDisabled || !checked || locked;
  const subParts = [
    `${track.notes.length} 音`,
    track.isDrum || !stats?.hasPitch ? null : `${midiToNoteName(stats.minPitch)}–${midiToNoteName(stats.maxPitch)}`,
    `首音 ${formatTimeShort(stats?.firstMs ?? 0)}`,
  ].filter((part) => part !== null);
  return (
    <Item variant="outline" size="sm" className={cn('gap-3', checked && 'bg-accent/40')}>
      <ItemMedia>
        {drumDisabled ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Checkbox checked={checked} disabled aria-label={`选择 ${track.name}`} onCheckedChange={() => undefined} />
              </span>
            </TooltipTrigger>
            <TooltipContent>鼓轨不参与音高类乐器的适配</TooltipContent>
          </Tooltip>
        ) : (
          <Checkbox
            checked={checked}
            disabled={locked}
            aria-label={`选择 ${track.name}`}
            onCheckedChange={(value) => onCheckedChange(value === true)}
          />
        )}
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="min-w-0 items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="truncate">{track.name}</span>
            </TooltipTrigger>
            <TooltipContent>{track.name}</TooltipContent>
          </Tooltip>
          {track.isDrum && <Badge variant="secondary">鼓</Badge>}
        </ItemTitle>
        <ItemDescription className="truncate">{subParts.join(' · ')}</ItemDescription>
      </ItemContent>
      <ItemActions className="gap-2 self-center">
        <span
          className={cn(
            'w-12 text-right text-sm font-medium tabular-nums',
            rate === null ? 'text-muted-foreground' : rateTextClass(rate),
          )}
        >
          {rate === null ? '—' : formatPercent(rate)}
        </span>
        <div className="flex flex-col gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={`单独试听 ${track.name}`}
            disabled={soloDisabled}
            onClick={() => onSolo('preview')}
          >
            <Headphones className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={`单独演奏 ${track.name}`}
            disabled={soloDisabled}
            onClick={() => onSolo('play')}
          >
            <Play className="size-3.5" />
          </Button>
        </div>
      </ItemActions>
    </Item>
  );
}
