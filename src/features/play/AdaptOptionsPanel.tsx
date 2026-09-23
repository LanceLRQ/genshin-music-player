import { ChevronRight, Minus, Plus, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { drumNoteLabel, buildVoiceKeyGroups } from '@/core/adapter/percussionMap';
import { supportsHoldControl } from '@/core/instruments/registry';
import { midiToNoteName, noteNameToMidi } from '@/core/music/pitch';
import { voiceLabel } from '@/core/model/instrument';
import type { InstrumentProfile } from '@/core/model/instrument';
import { keyLabel } from '@/core/model/keycodes';
import { DEFAULT_RELEASE_GAP_MS } from '@/core/model/timeline';
import type { AdaptOptions } from '@/core/model/timeline';
import { formatSigned } from '@/lib/format';
import { cn } from '@/lib/utils';

/** 固定按住时长的可选范围：上限约为 60 BPM 下一个全音符 */
const HOLD_MS_MIN = 10;
const HOLD_MS_MAX = 4000;

/** 松开间隔的可选范围（仅长音模式下生效） */
const RELEASE_GAP_MS_MIN = 0;
const RELEASE_GAP_MS_MAX = 200;

/** 关闭「自动」时分界音高的默认值（C4） */
const MANUAL_SPLIT_PITCH = 60;

/** 音色指定音符下拉的完整范围：MIDI 里鼓音符号不一定落在 GM 标准区 */
const ALL_PITCHES = Array.from({ length: 128 }, (_, pitch) => pitch);

interface AdaptOptionsPanelProps {
  profile: InstrumentProfile;
  /** 当前乐器是否内置（决定「按音长按键」「按住时长」是否显示，见 supportsHoldControl） */
  builtin: boolean;
  options: AdaptOptions;
  locked: boolean;
  /** 手动修改参数（页面写回 adaptStore 并标记 manual） */
  onChange: (options: AdaptOptions) => void;
}

interface HoldControlRowProps {
  profile: InstrumentProfile;
  options: AdaptOptions;
  locked: boolean;
  onChange: (options: AdaptOptions) => void;
}

interface MsSliderRowProps {
  /** 行首文字 */
  label: string;
  /** 输入框的 aria-label */
  inputLabel: string;
  min: number;
  max: number;
  step: number;
  value: number;
  locked: boolean;
  /** 滑块拖动或输入框提交后回调；内部已 clamp 到 min–max */
  onChange: (next: number) => void;
  /** 存在时渲染复位按钮，取值为按钮文案；不存在则不渲染 */
  resetLabel?: string;
  onReset?: () => void;
}

/** 滑块 + 数字输入框 + 单位 + 可选复位按钮：按住时长与松开间隔共用此结构 */
function MsSliderRow({ label, inputLabel, min, max, step, value, locked, onChange, resetLabel, onReset }: MsSliderRowProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (next: number) => onChange(Math.min(Math.max(next, min), max));
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="w-14 shrink-0 text-sm">{label}</span>
      <Slider
        className="min-w-32 flex-1"
        min={min}
        max={max}
        step={step}
        value={[value]}
        disabled={locked}
        onValueChange={([next]) => commit(next)}
      />
      <Input
        aria-label={inputLabel}
        type="number"
        className="w-20 bg-background text-right tabular-nums"
        min={min}
        max={max}
        value={draft ?? String(value)}
        disabled={locked}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft === null) return;
          const parsed = Number.parseInt(draft, 10);
          setDraft(null);
          if (!Number.isNaN(parsed)) commit(parsed);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
      <span className="text-xs text-muted-foreground">ms</span>
      {resetLabel !== undefined && (
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" disabled={locked} onClick={onReset}>
          <RotateCcw className="size-3.5" />
          {resetLabel}
        </Button>
      )}
    </div>
  );
}

/**
 * 「按 MIDI 音长按键」与「按住时长 / 松开间隔」：只有支持按住控制的乐器才会渲染（见 supportsHoldControl）。
 * 开关未手动设置时跟随乐器的 sustain；开启时按音长按住（可调松开间隔避免同键连按撞车），关闭时每个音按固定的按住时长按住
 */
function HoldControlRow({ profile, options, locked, onChange }: HoldControlRowProps) {
  const useNoteDuration = options.useNoteDuration ?? profile.timing.sustain;
  const holdMs = options.holdMsOverride ?? profile.timing.holdMs;
  const releaseGapMs = options.releaseGapMs ?? DEFAULT_RELEASE_GAP_MS;
  return (
    <>
      <div className="flex items-center gap-3">
        <span className="w-14 shrink-0 text-sm">音长按键</span>
        <Switch
          aria-label="按 MIDI 音长按键"
          checked={useNoteDuration}
          disabled={locked}
          onCheckedChange={(checked) => onChange({ ...options, useNoteDuration: checked })}
        />
        <span className="text-xs text-muted-foreground">{useNoteDuration ? '按 MIDI 音长按住' : '按固定时长按住'}</span>
      </div>
      {useNoteDuration ? (
        <>
          <MsSliderRow
            key="release-gap"
            label="松开间隔"
            inputLabel="松开间隔（毫秒）"
            min={RELEASE_GAP_MS_MIN}
            max={RELEASE_GAP_MS_MAX}
            step={5}
            value={releaseGapMs}
            locked={locked}
            onChange={(next) => onChange({ ...options, releaseGapMs: next })}
            resetLabel={options.releaseGapMs !== undefined ? `默认（${DEFAULT_RELEASE_GAP_MS}ms）` : undefined}
            onReset={() => onChange({ ...options, releaseGapMs: undefined })}
          />
          <p className="text-xs text-muted-foreground">长音在同键再次按下前提前松开，避免游戏漏掉下一个音</p>
        </>
      ) : (
        <MsSliderRow
          key="hold-ms"
          label="按住时长"
          inputLabel="按住时长（毫秒）"
          min={HOLD_MS_MIN}
          max={HOLD_MS_MAX}
          step={10}
          value={holdMs}
          locked={locked}
          onChange={(next) => onChange({ ...options, holdMsOverride: next })}
          resetLabel={options.holdMsOverride !== undefined ? `跟随乐器（${profile.timing.holdMs}ms）` : undefined}
          onReset={() => onChange({ ...options, holdMsOverride: undefined })}
        />
      )}
    </>
  );
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
  /** 声音名（显示用） */
  label: string;
  /** 这个声音落在哪些键上（如 Q/A），提示与游戏内键位的对应 */
  keyHint: string;
  /** 已指定的音符号；undefined 表示跟随鼓映射表 */
  pitch: number | undefined;
  /** 已被其他声音指定的音符号，下拉里禁用避免一个音符配两个声音 */
  taken: Set<number>;
  locked: boolean;
  onPick: (pitch: number | undefined) => void;
}

/** 「声音 → 指定音符」单项：对称备用键（-2）与主键是同一声音，合并为一行；
 *  音色名与下拉横向紧凑排列，basis 保证窄容器下每行至少两项。
 *  收起时只显示音名或「自动」，完整的 GM 打击乐名称在展开的选项列表里看 */
function DrumVoiceNoteRow({ label, keyHint, pitch, taken, locked, onPick }: DrumVoiceNoteRowProps) {
  return (
    <div className="flex min-w-0 flex-1 basis-36 items-center gap-1.5">
      <span className="shrink-0 text-sm">
        {label}
        <span className="ml-1 text-xs text-muted-foreground">{keyHint}</span>
      </span>
      <Select
        value={pitch === undefined ? 'auto' : String(pitch)}
        onValueChange={(value) => onPick(value === 'auto' ? undefined : Number(value))}
        disabled={locked}
      >
        <SelectTrigger className="h-8 min-w-0 flex-1" aria-label={`指定${label}的音符`}>
          {/* 必须用 SelectValue 包住：它同时把节点注册为 Radix 的 valueNode，
              item-aligned 定位缺了它会直接跳过定位，浮层落到屏幕外打不开 */}
          <SelectValue>{pitch === undefined ? '自动' : midiToNoteName(pitch)}</SelectValue>
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
export function AdaptOptionsPanel({ profile, builtin, options, locked, onChange }: AdaptOptionsPanelProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const autoSplitFromProps = options.percussionSplitPitch === undefined;
  const holdControlEligible = supportsHoldControl({ profile, builtin });
  // 对称备用键（-2）与主键是同一声音：按 baseVoice 分组，一行一个下拉，改一处即整组联动
  const drumVoiceGroups = profile.kind === 'percussion' ? [...buildVoiceKeyGroups(profile)] : [];
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
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {drumVoiceGroups.map(([voice, codes]) => (
              <DrumVoiceNoteRow
                key={voice}
                label={voiceLabel(voice)}
                keyHint={codes.map(keyLabel).join('/')}
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
          </div>
          <p className="text-xs text-muted-foreground">
            鼓轨按乐器鼓映射表转换；MIDI 的鼓音符号和默认映射对不上、或鼓谱写在了普通音轨上时，给声音直接指定一个音符（如 底鼓 → C2），指定优先于映射表和分界音高。带对称键（如 Q/A）的声音左右轮流击打。
          </p>
        </>
      )}
      {holdControlEligible && <HoldControlRow profile={profile} options={options} locked={locked} onChange={onChange} />}
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
