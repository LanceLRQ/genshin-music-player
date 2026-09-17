import { CircleCheck, CircleX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { findInstrument } from '@/core/instruments/registry';
import type { Score } from '@/core/model/score';
import { ScoreParseError } from '@/core/parsers/errors';
import { parseJianpu } from '@/core/parsers/jianpu';
import { parseKeyscore } from '@/core/parsers/keyscore';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { formatTime } from '@/lib/format';
import { useInstrumentStore } from '@/stores/instrumentStore';
import { scoreDurationMs } from './scoreInfo';

/** 文本乐谱对话框的标签页：键盘谱或简谱 */
type TextScoreTab = 'keyscore' | 'jianpu';

export interface TextScorePreset {
  title?: string;
  text?: string;
}

interface TextScoreDialogProps {
  open: boolean;
  initialTab: TextScoreTab;
  preset?: TextScorePreset;
  onOpenChange: (open: boolean) => void;
  /** 导入成功：score 为解析结果；sourceInstrumentId 只有键盘谱有 */
  onImport: (score: Score, sourceInstrumentId?: string) => void;
}

const STEP_OPTIONS = [
  { value: '0.25', label: '1/4 拍' },
  { value: '0.5', label: '1/2 拍' },
  { value: '1', label: '1 拍' },
];

const KEYSAMPLE_TEXT = '@bpm=100\nQ W (QE) - T\n// 在这里粘贴键盘谱';
const JIANPU_TEXT = '@bpm=100 @key=C\n1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2 2 1 -';

type ParseOutcome =
  | { ok: true; score: Score; sourceInstrumentId?: string; noteCount: number; durationMs: number }
  | { ok: false; message: string; line?: number; col?: number };

function countNotes(score: Score): number {
  return score.tracks.reduce((total, track) => total + track.notes.length, 0);
}

/** 带行列号的错误消息形如「第 1 行第 7 列：原因」，拆成位置与原因两段 */
function splitParseMessage(message: string, hasLocation: boolean): [string, string] {
  if (!hasLocation) return [message, ''];
  const index = message.indexOf('：');
  return index === -1 ? [message, ''] : [message.slice(0, index), message.slice(index + 1)];
}

/** 文本乐谱对话框（设计 01 第 4.2 节）：输入防抖 300ms 实时解析，失败时显示出错行与 ^ 标记 */
export function TextScoreDialog({ open, initialTab, preset, onOpenChange, onImport }: TextScoreDialogProps) {
  const entries = useInstrumentStore((state) => state.entries);
  const [tab, setTab] = useState<TextScoreTab>(initialTab);
  const [title, setTitle] = useState(preset?.title ?? '未命名乐谱');
  const [text, setText] = useState(preset?.text ?? (initialTab === 'keyscore' ? KEYSAMPLE_TEXT : JIANPU_TEXT));
  const [sourceId, setSourceId] = useState(useInstrumentStore.getInitialState().selectedId);
  const [bpmText, setBpmText] = useState('90');
  const [step, setStep] = useState('0.5');
  const [spaceAsRest, setSpaceAsRest] = useState(false);

  const debouncedText = useDebouncedValue(text, 300);
  const outcome = useMemo<ParseOutcome | null>(() => {
    if (!debouncedText.trim()) return null;
    try {
      if (tab === 'keyscore') {
        const { score, sourceInstrumentId } = parseKeyscore(debouncedText, {
          title,
          defaultInstrumentId: sourceId,
          resolveInstrument: (id) => findInstrument(entries, id),
          bpm: Number.parseFloat(bpmText) || undefined,
          step: Number.parseFloat(step) || undefined,
          spaceAsRest,
        });
        return { ok: true, score, sourceInstrumentId, noteCount: countNotes(score), durationMs: scoreDurationMs(score) };
      }
      const score = parseJianpu(debouncedText, { title });
      return { ok: true, score, noteCount: countNotes(score), durationMs: scoreDurationMs(score) };
    } catch (error) {
      if (error instanceof ScoreParseError) return { ok: false, message: error.message, line: error.line, col: error.col };
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }, [debouncedText, tab, title, sourceId, bpmText, step, spaceAsRest, entries]);

  const errorLineText =
    outcome !== null && !outcome.ok && outcome.line !== undefined
      ? (debouncedText.split('\n')[outcome.line - 1] ?? '').slice(0, 120)
      : null;
  /** 带行列号的错误消息形如「第 1 行第 7 列：原因」，拆成两段分别渲染 */
  const errorParts =
    outcome !== null && !outcome.ok ? splitParseMessage(outcome.message, outcome.line !== undefined) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>导入文本乐谱</DialogTitle>
          <DialogDescription>输入后 300ms 内实时解析预览，只显示成功或失败其中一行。</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(value) => setTab(value as TextScoreTab)}>
          <TabsList>
            <TabsTrigger value="keyscore">键盘谱</TabsTrigger>
            <TabsTrigger value="jianpu">简谱</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="text-score-title">标题</Label>
          <Input id="text-score-title" value={title} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <Textarea
          aria-label="乐谱文本"
          rows={12}
          spellCheck={false}
          className="font-mono"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={tab === 'keyscore' ? KEYSAMPLE_TEXT : JIANPU_TEXT}
        />
        {tab === 'keyscore' && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="text-score-source" className="text-sm">
                来源乐器
              </Label>
              <Select value={sourceId} onValueChange={setSourceId}>
                <SelectTrigger id="text-score-source" className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {entries
                    .filter((entry) => entry.profile.kind === 'pitched')
                    .map((entry) => (
                      <SelectItem key={entry.profile.id} value={entry.profile.id}>
                        {entry.profile.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="text-score-bpm" className="text-sm">
                BPM
              </Label>
              <Input
                id="text-score-bpm"
                className="w-16"
                inputMode="decimal"
                value={bpmText}
                onChange={(event) => setBpmText(event.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="text-score-step" className="text-sm">
                步长
              </Label>
              <Select value={step} onValueChange={setStep}>
                <SelectTrigger id="text-score-step" className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STEP_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="text-score-space"
                checked={spaceAsRest}
                onCheckedChange={(value) => setSpaceAsRest(value === true)}
              />
              <Label htmlFor="text-score-space">空格视为休止</Label>
            </div>
          </div>
        )}
        {outcome === null ? null : outcome.ok ? (
          <p className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-500">
            <CircleCheck className="size-4" />
            解析成功：{outcome.noteCount} 个音，时长 {formatTime(outcome.durationMs)}
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            <p className="flex items-center gap-1.5 text-sm text-destructive">
              <CircleX className="size-4" />
              <span>{errorParts?.[0]}</span>
              {errorParts?.[1] && <span>{errorParts[1]}</span>}
            </p>
            {errorLineText !== null && outcome.col !== undefined && (
              <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs text-destructive">
                {errorLineText}
                {'\n'}
                {' '.repeat(Math.min(Math.max(outcome.col - 1, 0), errorLineText.length))}^
              </pre>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">语法说明文档将在 M4 完成后提供链接。</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={!outcome?.ok} onClick={() => outcome?.ok && onImport(outcome.score, outcome.sourceInstrumentId)}>
            导入
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
