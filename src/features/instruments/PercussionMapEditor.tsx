import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { drumNoteLabel, GM_DRUM_NOTES } from '@/core/adapter/percussionMap';
import type { InstrumentProfile } from '@/core/model/instrument';
import { midiToNoteName } from '@/core/music/pitch';
import { parsePitchInput, voiceLabel } from './KeycapPreview';

export type PercussionMap = NonNullable<InstrumentProfile['percussionMap']>;

/** 音符号下拉的完整范围：GM 打击乐标准区之外也允许选择 */
const ALL_PITCHES = Array.from({ length: 128 }, (_, pitch) => pitch);

/** 敲击类乐器没有映射表时的默认值 */
export const DEFAULT_PERCUSSION_MAP: PercussionMap = { drumNotes: { '36': 'don', '38': 'ka' }, splitPitch: 'auto' };

interface PercussionMapEditorProps {
  /** 本乐器键位中出现过的音色，作为映射下拉的选项 */
  voices: string[];
  map: PercussionMap;
  onChange: (map: PercussionMap) => void;
}

/** 敲击类乐器的鼓映射表编辑：MIDI 音符号 → 音色，外加分界音高（自动 / 手动音名） */
export function PercussionMapEditor({ voices, map, onChange }: PercussionMapEditorProps) {
  const entries = Object.entries(map.drumNotes);
  const taken = new Set(Object.keys(map.drumNotes));

  const moveNote = (fromNote: string, toPitch: number) => {
    const toNote = String(toPitch);
    if (toNote === fromNote) return;
    const drumNotes = { ...map.drumNotes };
    drumNotes[toNote] = drumNotes[fromNote];
    delete drumNotes[fromNote];
    onChange({ ...map, drumNotes });
  };

  const addEntry = () => {
    const takenNums = new Set([...taken].map(Number));
    let note = 35;
    while (takenNums.has(note)) note += 1;
    onChange({ ...map, drumNotes: { ...map.drumNotes, [String(note)]: voices[0] ?? 'don' } });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>鼓映射表</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          {entries.map(([note, voice], index) => (
            <div key={note} className="flex items-center gap-2">
              <Select value={note} onValueChange={(value) => moveNote(note, Number(value))}>
                <SelectTrigger className="w-48" aria-label={`映射音符 ${index + 1}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALL_PITCHES.map((pitch) => (
                    <SelectItem key={pitch} value={String(pitch)} disabled={taken.has(String(pitch)) && pitch !== Number(note)}>
                      {drumNoteLabel(pitch)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={voice} onValueChange={(value) => onChange({ ...map, drumNotes: { ...map.drumNotes, [note]: value } })}>
                <SelectTrigger className="w-28" aria-label={`映射音色 ${index + 1}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {voices.map((item) => (
                    <SelectItem key={item} value={item}>
                      {voiceLabel(item)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={`删除映射 ${note}`}
                onClick={() => {
                  const drumNotes = { ...map.drumNotes };
                  delete drumNotes[note];
                  onChange({ ...map, drumNotes });
                }}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={addEntry}>
            <Plus /> 添加
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onChange({ ...map, drumNotes: { ...GM_DRUM_NOTES } })}>
            恢复 GM 默认映射
          </Button>
        </div>
        <div className="flex items-center gap-3">
          <Switch
            id="split-auto"
            checked={map.splitPitch === 'auto'}
            onCheckedChange={(checked) => onChange({ ...map, splitPitch: checked ? 'auto' : 60 })}
          />
          <Label htmlFor="split-auto">自动（中位数）</Label>
          {map.splitPitch !== 'auto' && <SplitPitchInput value={map.splitPitch} onCommit={(splitPitch) => onChange({ ...map, splitPitch })} />}
        </div>
      </CardContent>
    </Card>
  );
}

function SplitPitchInput({ value, onCommit }: { value: number; onCommit: (value: number) => void }) {
  const [text, setText] = useState(`${midiToNoteName(value)} (${value})`);
  return (
    <Input
      aria-label="分界音高"
      value={text}
      placeholder="C4 或 60"
      className="w-32"
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        const parsed = parsePitchInput(text);
        if (parsed === undefined) return;
        setText(`${midiToNoteName(parsed)} (${parsed})`);
        onCommit(parsed);
      }}
    />
  );
}
