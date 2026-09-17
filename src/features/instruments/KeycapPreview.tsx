import { keyLabel } from '@/core/model/keycodes';
import type { InstrumentProfile } from '@/core/model/instrument';
import { midiToNoteName, noteNameToMidi } from '@/core/music/pitch';
import { previewPlayer } from '@/audio/previewPlayer';
import { cn } from '@/lib/utils';

const VOICE_LABELS: Record<string, string> = { don: '咚', ka: '咔' };

/** 敲击乐器的音色显示名：don → 咚、ka → 咔，其余原样 */
export function voiceLabel(voice: string): string {
  return VOICE_LABELS[voice] ?? voice;
}

/** 音高输入解析：'61' / 'C#4' / 'c4' → MIDI 音高号；非法或超出 0–127 时返回 undefined */
export function parsePitchInput(text: string): number | undefined {
  const trimmed = text.trim();
  if (/^\d+$/.test(trimmed)) {
    const value = Number(trimmed);
    return value >= 0 && value <= 127 ? value : undefined;
  }
  return noteNameToMidi(trimmed);
}

interface KeycapPreviewProps {
  profile: InstrumentProfile;
  className?: string;
}

/** 虚拟琴键预览：每行一行键帽，点击试听（与演奏页的 Keycap 无关，这是乐器页的只读预览） */
export function KeycapPreview({ profile, className }: KeycapPreviewProps) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {profile.rows.map((row, rowIndex) => (
        <div key={rowIndex} className="flex items-center gap-3">
          <span className="w-10 shrink-0 text-right text-xs text-muted-foreground">{row.label}</span>
          <div className="flex flex-wrap gap-2">
            {row.keys.map((instrumentKey, keyIndex) => (
              <button
                key={keyIndex}
                type="button"
                onClick={() => previewPlayer.playKey(profile, instrumentKey.code)}
                className="flex h-14 w-14 flex-col items-center justify-center rounded-md border bg-card text-sm hover:bg-accent"
              >
                <span className="font-medium">{keyLabel(instrumentKey.code)}</span>
                <span className="text-xs text-muted-foreground">
                  {profile.kind === 'percussion'
                    ? voiceLabel(instrumentKey.voice ?? '')
                    : instrumentKey.pitch === undefined
                      ? '—'
                      : midiToNoteName(instrumentKey.pitch)}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
