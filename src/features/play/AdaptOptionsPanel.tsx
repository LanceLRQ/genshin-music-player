import { ChevronRight, Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { drumNoteLabel } from '@/core/adapter/percussionMap';
import { noteNameToMidi } from '@/core/music/pitch';
import { voiceLabel } from '@/core/model/instrument';
import type { InstrumentProfile } from '@/core/model/instrument';
import type { AdaptOptions } from '@/core/model/timeline';
import { formatSigned } from '@/lib/format';
import { cn } from '@/lib/utils';

/** 关闭「自动」时分界音高的默认值（C4） */
const MANUAL_SPLIT_PITCH = 60;

/** 音色指定音符下拉的完整范围：MIDI 里鼓音符号不一定落在 GM 标准区 */
const ALL_PITCHES = Array.from({ length: 128 }, (_, pitch) => pitch);

interface AdaptOptionsPanelProps {
  profile: InstrumentProfile;
  options: AdaptOptions;
  locked: boolean;
  /** 手动修改参数（页面写回 adaptStore 并标记 manual） */
  onChange: (options: AdaptOptions) => void;
}

interface StepperProps {
  label: string;
  /** 数值右侧的单位说明（如「半音」），无单位时不渲染 */
  unit?: string;
  value: number;
  min: number;
  max: number;
  locked: boolean;
  onChange: (value: number) => void;
}

/** [−] 数值 [+]，数值可以直接输入（设计 01 第 4.5 节） */
function Stepper({ label, unit, value, min, max, locked, onChange }: StepperProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (next: number) => Math.min(Math.max(next, min), max);
  return (
    <div className="flex items-center gap-3">
      <span className="w-14 shrink-0 text-sm">{label}</span>
      <ButtonGroup>
        <Button variant="outline" size="icon" className="size-8" aria-label={`减少${label}`} disabled={locked} onClick={() => onChange(clamp(value - 1))}>
          <Minus className="size-3.5" />
        </Button>
        <Input
          aria-label={label}
          className="w-14 bg-background text-center"
          inputMode="numeric"
          value={draft ?? formatSigned(value)}
          disabled={locked}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (draft === null) return;
            const parsed = Number.parseInt(draft, 10);
            setDraft(null);
            if (!Number.isNaN(parsed)) onChange(clamp(parsed));
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
        <Button variant="outline" size="icon" className="size-8" aria-label={`增加${label}`} disabled={locked} onClick={() => onChange(clamp(value + 1))}>
          <Plus className="size-3.5" />
        </Button>
      </ButtonGroup>
      {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
    </div>
  );
}

function SplitPitchInput({ value, locked, onCommit }: { value: number; locked: boolean; onCommit: (pitch: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const commit = () => {
    if (draft === null) return;
    const text = draft.trim();
    const pitch = /^\d+$/.test(text) ? Number(text) : noteNameToMidi(text);
    setDraft(null);
    if (pitch === undefined || pitch < 0 || pitch > 127) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onCommit(pitch);
  };
  return (
    <Input
      aria-label="分界音高"
      className={cn('w-24', invalid && 'border-destructive')}
      value={draft ?? String(value)}
      disabled={locked}
      onChange={(event) => {
        setDraft(event.target.value);
        setInvalid(false);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}

interface SplitPitchRowProps {
  auto: boolean;
  value: number | undefined;
  locked: boolean;
  /** 切换自动/手动（页面写回 adaptStore） */
  onToggle: (auto: boolean) => void;
  onCommit: (pitch: number) => void;
}

/** 敲击类的分界音高行：开关与手动输入（auto 变化时由父级以 key 重置内部状态） */
function SplitPitchRow({ auto, value, locked, onToggle, onCommit }: SplitPitchRowProps) {
  const [autoSplit, setAutoSplit] = useState(auto);
  return (
    <>
      <div className="flex items-center gap-3">
        <span className="w-14 shrink-0 text-sm">分界音高</span>
        <div className="flex items-center gap-2">
          <Switch
            aria-label="自动分界音高"
            checked={autoSplit}
            disabled={locked}
            onCheckedChange={(checked) => {
              setAutoSplit(checked);
              onToggle(checked);
            }}
          />
          <span className="text-sm text-muted-foreground">自动（中位数）</span>
        </div>
      </div>
      {!autoSplit && <SplitPitchInput value={value ?? MANUAL_SPLIT_PITCH} locked={locked} onCommit={onCommit} />}
      <p className="text-xs text-muted-foreground">低于分界音高的音映射为「咚」，其余映射为「咔」。</p>
    </>
  );
}

interface DrumVoiceNoteRowProps {
  /** 音色名（显示用） */
  label: string;
  /** 已指定的音符号；undefined 表示跟随鼓映射表 */
  pitch: number | undefined;
  /** 已被其他音色指定的音符号，下拉里禁用避免一个音符配两个音色 */
  taken: Set<number>;
  locked: boolean;
  onPick: (pitch: number | undefined) => void;
}

/** 敲击类的「音色 → 指定音符」行：默认自动（按鼓映射表），选定后该音符优先映射到这个音色 */
function DrumVoiceNoteRow({ label, pitch, taken, locked, onPick }: DrumVoiceNoteRowProps) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-14 shrink-0 text-sm">{label}</span>
      <Select
        value={pitch === undefined ? 'auto' : String(pitch)}
        onValueChange={(value) => onPick(value === 'auto' ? undefined : Number(value))}
        disabled={locked}
      >
        <SelectTrigger className="w-44" aria-label={`指定${label}的音符`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">自动（按鼓映射表）</SelectItem>
          {ALL_PITCHES.map((note) => (
            <SelectItem key={note} value={String(note)} disabled={taken.has(note) && note !== pitch}>
              {drumNoteLabel(note)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** 适配参数内容片段（设计 01 第 4.5 节）：由演奏参数卡承载卡片样式，音高类与敲击类显示不同的参数集合 */
export function AdaptOptionsPanel({ profile, options, locked, onChange }: AdaptOptionsPanelProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const autoSplitFromProps = options.percussionSplitPitch === undefined;
  const drumVoices = profile.kind === 'percussion'
    ? [...new Set(profile.rows.flatMap((row) => row.keys.map((key) => key.voice).filter((voice) => voice !== undefined)))]
    : [];
  const setDrumVoiceNote = (voice: string, pitch: number | undefined) => {
    const next = { ...options.drumVoiceNotes };
    if (pitch === undefined) delete next[voice];
    else next[voice] = pitch;
    onChange({ ...options, drumVoiceNotes: Object.keys(next).length > 0 ? next : undefined });
  };
  return (
    <>
      <span className="text-sm font-medium">适配参数</span>
      {profile.kind === 'pitched' ? (
        <>
          <Stepper
            label="移调"
            unit="半音"
            value={options.transpose}
            min={-11}
            max={11}
            locked={locked}
            onChange={(transpose) => onChange({ ...options, transpose })}
          />
          <Stepper
            label="八度"
            value={options.octaveShift}
            min={-3}
            max={3}
            locked={locked}
            onChange={(octaveShift) => onChange({ ...options, octaveShift })}
          />
          <div className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-sm">黑键</span>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={options.blackKeyPolicy}
              disabled={locked}
              onValueChange={(value) => {
                if (value === 'skip' || value === 'nearest') onChange({ ...options, blackKeyPolicy: value });
              }}
            >
              <ToggleGroupItem value="skip">跳过</ToggleGroupItem>
              <ToggleGroupItem value="nearest">就近取音</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-sm">超音域</span>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={options.outOfRangePolicy}
              disabled={locked}
              onValueChange={(value) => {
                if (value === 'fold' || value === 'drop') onChange({ ...options, outOfRangePolicy: value });
              }}
            >
              <ToggleGroupItem value="fold">按八度折回</ToggleGroupItem>
              <ToggleGroupItem value="drop">丢弃</ToggleGroupItem>
            </ToggleGroup>
          </div>
        </>
      ) : (
        <>
          <SplitPitchRow
            key={autoSplitFromProps ? 'auto' : 'manual'}
            auto={autoSplitFromProps}
            value={options.percussionSplitPitch}
            locked={locked}
            onToggle={(auto) => onChange({ ...options, percussionSplitPitch: auto ? undefined : MANUAL_SPLIT_PITCH })}
            onCommit={(percussionSplitPitch) => onChange({ ...options, percussionSplitPitch })}
          />
          {drumVoices.map((voice) => (
            <DrumVoiceNoteRow
              key={voice}
              label={voiceLabel(voice)}
              pitch={options.drumVoiceNotes?.[voice]}
              taken={new Set(
                Object.entries(options.drumVoiceNotes ?? {})
                  .filter(([other]) => other !== voice)
                  .map(([, pitch]) => pitch),
              )}
              locked={locked}
              onPick={(pitch) => setDrumVoiceNote(voice, pitch)}
            />
          ))}
          <p className="text-xs text-muted-foreground">
            鼓轨按乐器鼓映射表转换；MIDI 的鼓音符号和默认映射对不上时，给音色直接指定一个音符，指定优先于映射表。
          </p>
        </>
      )}
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-fit gap-1 px-2 text-muted-foreground">
            <ChevronRight className={cn('size-4 transition-transform', advancedOpen && 'rotate-90')} />
            高级
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-3 pt-2">
          <div className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-sm">复音上限</span>
            <Slider
              className="flex-1"
              min={1}
              max={6}
              step={1}
              value={[options.maxPolyphony]}
              disabled={locked}
              onValueChange={([maxPolyphony]) => onChange({ ...options, maxPolyphony })}
            />
            <span className="w-6 text-right text-sm tabular-nums">{options.maxPolyphony}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-sm">和弦窗口</span>
            <Slider
              className="flex-1"
              min={0}
              max={50}
              step={5}
              value={[options.chordWindowMs]}
              disabled={locked}
              onValueChange={([chordWindowMs]) => onChange({ ...options, chordWindowMs })}
            />
            <span className="w-12 text-right text-sm tabular-nums">{options.chordWindowMs} ms</span>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </>
  );
}
