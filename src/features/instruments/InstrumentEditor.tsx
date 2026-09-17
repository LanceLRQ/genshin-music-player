import { ArrowDown, ArrowUp, CircleAlert, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { type InstrumentKey, type InstrumentProfile, validateInstrumentProfile } from '@/core/model/instrument';
import { midiToNoteName } from '@/core/music/pitch';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useInstrumentStore } from '@/stores/instrumentStore';
import { KeyCaptureButton } from './KeyCaptureButton';
import { KeycapPreview, parsePitchInput } from './KeycapPreview';
import { DEFAULT_PERCUSSION_MAP, PercussionMapEditor } from './PercussionMapEditor';

export interface InstrumentEditorProps {
  /** 进入编辑器时的配置 */
  profile: InstrumentProfile;
  /** 是否已经保存过（保存过的乐器 ID 不可修改） */
  saved: boolean;
  /** 草稿是否有未保存的修改（页面用于离开保护）；卸载时回调 false */
  onDirtyChange: (dirty: boolean) => void;
  /** 点击取消（未保存修改的确认由页面统一处理） */
  onCancel: () => void;
  /** 保存成功后退出编辑器 */
  onDone: () => void;
}

/** 校验错误按字段归类：能映射到字段的在字段下方显示，其余显示在表单顶部 */
interface EditorErrors {
  top: string[];
  name?: string;
  id?: string;
  holdMs?: string;
  minRepeatGapMs?: string;
  keys: Map<string, string>;
}

function computeErrors(profile: InstrumentProfile): EditorErrors {
  const result = validateInstrumentProfile(profile);
  const errors: EditorErrors = { top: [], keys: new Map() };
  if (result.ok) return errors;
  for (const message of result.errors) {
    const separator = message.indexOf('：');
    const path = separator === -1 ? '' : message.slice(0, separator);
    const text = separator === -1 ? message : message.slice(separator + 1);
    const key = /^rows\.(\d+)\.keys\.(\d+)\./.exec(path);
    const row = /^rows\.(\d+)\.keys$/.exec(path);
    if (path === 'name') errors.name = text;
    else if (path === 'id') errors.id = text;
    else if (path === 'timing.holdMs') errors.holdMs = text;
    else if (path === 'timing.minRepeatGapMs') errors.minRepeatGapMs = text;
    else if (key) errors.keys.set(`${key[1]}-${key[2]}`, text);
    else if (row) errors.top.push(`第 ${Number(row[1]) + 1} 行还没有键`);
    else errors.top.push(message);
  }
  return errors;
}

function nextDefaultKey(kind: InstrumentProfile['kind']): InstrumentKey {
  return kind === 'pitched' ? { code: 'KeyQ', pitch: 60 } : { code: 'KeyF', voice: 'don' };
}

/** 乐器编辑器：在详情区域原地渲染的编辑表单，底部固定 [取消] [保存] 操作栏 */
export function InstrumentEditor({ profile, saved, onDirtyChange, onCancel, onDone }: InstrumentEditorProps) {
  const saveProfile = useInstrumentStore((state) => state.save);
  const [draft, setDraft] = useState<InstrumentProfile>(() => structuredClone(profile));
  const debounced = useDebouncedValue(draft, 200);
  const errors = useMemo(() => computeErrors(debounced), [debounced]);
  const problemCount = useMemo(() => {
    const result = validateInstrumentProfile(debounced);
    return result.ok ? 0 : result.errors.length;
  }, [debounced]);
  // 名称只有空白字符时 min(1) 不会报错，这里补计一次，避免"显示错误但可以保存"
  const nameEmpty = debounced.name.trim() === '';
  const effectiveProblemCount = problemCount > 0 || nameEmpty ? Math.max(problemCount, 1) : 0;
  const dirty = JSON.stringify(draft) !== JSON.stringify(profile);
  const [kindConfirm, setKindConfirm] = useState<InstrumentProfile['kind'] | null>(null);

  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  const update = (mutate: (next: InstrumentProfile) => void) => {
    setDraft((current) => {
      const next = structuredClone(current);
      mutate(next);
      return next;
    });
  };

  const updateKey = (rowIndex: number, keyIndex: number, mutate: (target: InstrumentKey) => void) => {
    update((next) => {
      mutate(next.rows[rowIndex].keys[keyIndex]);
    });
  };

  const requestKind = (kind: string) => {
    if (!kind || kind === draft.kind) return;
    const hasKeys = draft.rows.some((row) => row.keys.length > 0);
    if (hasKeys) setKindConfirm(kind as InstrumentProfile['kind']);
    else applyKind(kind as InstrumentProfile['kind']);
  };

  const applyKind = (kind: InstrumentProfile['kind']) => {
    setKindConfirm(null);
    update((next) => {
      next.kind = kind;
      next.rows.forEach((row) => {
        row.keys = [];
      });
      if (kind === 'percussion' && !next.percussionMap) next.percussionMap = structuredClone(DEFAULT_PERCUSSION_MAP);
    });
  };

  const handleSave = async () => {
    const result = validateInstrumentProfile(draft);
    if (!result.ok) return;
    if (await saveProfile(result.value)) {
      toast.success('乐器配置已保存');
      onDone();
    }
  };

  const voices = useMemo(
    () => [...new Set(draft.rows.flatMap((row) => row.keys.map((key) => key.voice).filter((voice) => voice !== undefined)))],
    [draft],
  );
  const percussionMap = draft.kind === 'percussion' ? (draft.percussionMap ?? structuredClone(DEFAULT_PERCUSSION_MAP)) : null;

  return (
    <div className="flex flex-col gap-4 pb-4">
      <div>
        <h2 className="text-lg font-semibold">{saved ? '编辑乐器' : '新建乐器'}</h2>
        <p className="text-sm text-muted-foreground">{saved ? '修改会即时校验，保存后生效' : '填写名称与键位，保存后加入自定义列表'}</p>
      </div>
      {errors.top.length > 0 && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>配置还有问题，无法保存</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {errors.top.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      <Card>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">试弹预览（点击试听，实时反映编辑结果）</p>
          <KeycapPreview profile={draft} />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <Label htmlFor="editor-name" className="w-28 shrink-0">
              名称
            </Label>
            <div className="flex flex-1 flex-col gap-1">
              <Input id="editor-name" value={draft.name} onChange={(event) => update((next) => { next.name = event.target.value; })} />
              {(draft.name.trim() === '' || errors.name) && (
                <p className="text-sm text-destructive">{draft.name.trim() === '' ? '名称不能为空' : errors.name}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Label htmlFor="editor-id" className="w-28 shrink-0">
              ID
            </Label>
            <div className="flex flex-1 flex-col gap-1">
              <Input
                id="editor-id"
                value={draft.id}
                disabled={saved}
                onChange={(event) => update((next) => { next.id = event.target.value.trim(); })}
              />
              {errors.id && <p className="text-sm text-destructive">{errors.id}</p>}
              {saved && <p className="text-sm text-muted-foreground">保存过的乐器 ID 不可修改</p>}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Label className="w-28 shrink-0">类型</Label>
            <ToggleGroup type="single" variant="outline" value={draft.kind} onValueChange={requestKind}>
              <ToggleGroupItem value="pitched">音高类</ToggleGroupItem>
              <ToggleGroupItem value="percussion">敲击类</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="flex items-center gap-4">
            <Label className="w-28 shrink-0">状态</Label>
            <Select
              value={draft.status}
              onValueChange={(value) => update((next) => { next.status = value as InstrumentProfile['status']; })}
            >
              <SelectTrigger className="w-32" aria-label="状态">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="verified">已验证</SelectItem>
                <SelectItem value="unverified">待实测</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-4">
            <Label htmlFor="editor-hold" className="w-28 shrink-0">
              按住时长
            </Label>
            <div className="flex flex-1 items-center gap-2">
              <NumberInput id="editor-hold" value={draft.timing.holdMs} onCommit={(holdMs) => update((next) => { next.timing.holdMs = holdMs; })} />
              <span className="text-sm text-muted-foreground">ms</span>
              {errors.holdMs && <p className="text-sm text-destructive">{errors.holdMs}</p>}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Label htmlFor="editor-gap" className="w-28 shrink-0">
              最小重复间隔
            </Label>
            <div className="flex flex-1 items-center gap-2">
              <NumberInput
                id="editor-gap"
                value={draft.timing.minRepeatGapMs}
                onCommit={(minRepeatGapMs) => update((next) => { next.timing.minRepeatGapMs = minRepeatGapMs; })}
              />
              <span className="text-sm text-muted-foreground">ms</span>
              {errors.minRepeatGapMs && <p className="text-sm text-destructive">{errors.minRepeatGapMs}</p>}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Label htmlFor="editor-sustain" className="w-28 shrink-0">
              可持续发声
            </Label>
            <Switch
              id="editor-sustain"
              checked={draft.timing.sustain}
              onCheckedChange={(checked) => update((next) => { next.timing.sustain = checked; })}
            />
          </div>
        </CardContent>
      </Card>
      <section className="flex flex-col gap-3">
        {draft.rows.map((row, rowIndex) => (
          <Card key={rowIndex}>
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Input
                  value={row.label}
                  placeholder="行名（如 高音）"
                  className="w-40"
                  aria-label={`第 ${rowIndex + 1} 行名称`}
                  onChange={(event) => update((next) => { next.rows[rowIndex].label = event.target.value; })}
                />
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={`上移第 ${rowIndex + 1} 行`}
                    disabled={rowIndex === 0}
                    onClick={() =>
                      update((next) => {
                        [next.rows[rowIndex - 1], next.rows[rowIndex]] = [next.rows[rowIndex], next.rows[rowIndex - 1]];
                      })
                    }
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={`下移第 ${rowIndex + 1} 行`}
                    disabled={rowIndex === draft.rows.length - 1}
                    onClick={() =>
                      update((next) => {
                        [next.rows[rowIndex + 1], next.rows[rowIndex]] = [next.rows[rowIndex], next.rows[rowIndex + 1]];
                      })
                    }
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={`删除第 ${rowIndex + 1} 行`}
                    disabled={draft.rows.length <= 1}
                    onClick={() =>
                      update((next) => {
                        next.rows.splice(rowIndex, 1);
                      })
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {row.keys.map((instrumentKey, keyIndex) => (
                  <div key={`${rowIndex}-${keyIndex}`} className="flex flex-wrap items-center gap-2">
                    <KeyCaptureButton
                      value={instrumentKey.code}
                      onCapture={(code) => updateKey(rowIndex, keyIndex, (target) => { target.code = code; })}
                    />
                    {draft.kind === 'pitched' ? (
                      <PitchInput
                        ariaLabel={`第 ${rowIndex + 1} 行第 ${keyIndex + 1} 个键的音高`}
                        pitch={instrumentKey.pitch}
                        invalid={errors.keys.has(`${rowIndex}-${keyIndex}`)}
                        onCommit={(pitch) => updateKey(rowIndex, keyIndex, (target) => { target.pitch = pitch; })}
                      />
                    ) : (
                      <Input
                        value={instrumentKey.voice ?? ''}
                        placeholder="don / ka"
                        className="w-32"
                        aria-label={`第 ${rowIndex + 1} 行第 ${keyIndex + 1} 个键的音色`}
                        onChange={(event) => updateKey(rowIndex, keyIndex, (target) => { target.voice = event.target.value.trim(); })}
                      />
                    )}
                    {errors.keys.get(`${rowIndex}-${keyIndex}`) && (
                      <p className="text-sm text-destructive">{errors.keys.get(`${rowIndex}-${keyIndex}`)}</p>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={`删除第 ${rowIndex + 1} 行第 ${keyIndex + 1} 个键`}
                      disabled={row.keys.length <= 1}
                      onClick={() =>
                        update((next) => {
                          next.rows[rowIndex].keys.splice(keyIndex, 1);
                        })
                      }
                    >
                      <X />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-start"
                  aria-label={`在第 ${rowIndex + 1} 行添加键`}
                  disabled={row.keys.length >= 12}
                  onClick={() => update((next) => { next.rows[rowIndex].keys.push(nextDefaultKey(next.kind)); })}
                >
                  <Plus /> 添加键
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          disabled={draft.rows.length >= 4}
          onClick={() => update((next) => { next.rows.push({ label: '', keys: [nextDefaultKey(next.kind)] }); })}
        >
          <Plus /> 添加行
        </Button>
      </section>
      {percussionMap && (
        <PercussionMapEditor
          voices={voices}
          map={percussionMap}
          onChange={(map) => update((next) => { next.percussionMap = map; })}
        />
      )}
      <div className="sticky bottom-0 flex items-center gap-3 border-t bg-background py-3">
        <span className="text-sm text-muted-foreground">
          {effectiveProblemCount > 0 ? `有 ${effectiveProblemCount} 个校验错误` : dirty ? '有未保存的修改' : '无修改'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button disabled={effectiveProblemCount > 0} onClick={() => void handleSave()}>
            保存
          </Button>
        </div>
      </div>
      <AlertDialog open={kindConfirm !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>切换乐器类型？</AlertDialogTitle>
            <AlertDialogDescription>切换类型会清空所有键。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setKindConfirm(null)}>继续编辑</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => kindConfirm && applyKind(kindConfirm)}>
              切换并清空
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function NumberInput({ id, value, onCommit }: { id: string; value: number; onCommit: (value: number) => void }) {
  const [text, setText] = useState(String(value));
  return (
    <Input
      id={id}
      type="number"
      min={1}
      max={1000}
      value={text}
      className="w-24"
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        const parsed = Number(text);
        if (text.trim() !== '' && Number.isFinite(parsed)) onCommit(Math.round(parsed));
        else setText(String(value));
      }}
    />
  );
}

function PitchInput({
  ariaLabel,
  pitch,
  invalid,
  onCommit,
}: {
  ariaLabel: string;
  pitch: number | undefined;
  invalid: boolean;
  onCommit: (pitch: number | undefined) => void;
}) {
  const [text, setText] = useState(() => (pitch === undefined ? '' : `${midiToNoteName(pitch)} (${pitch})`));
  const [invalidText, setInvalidText] = useState(false);
  // 行的上移 / 下移 / 删除会复用同一位置的组件实例：pitch 变化而本地文本对不上时，
  // 在 render 期间同步文本，避免失焦把旧位置的输入提交到错位的键
  const [prevPitch, setPrevPitch] = useState(pitch);
  if (prevPitch !== pitch) {
    setPrevPitch(pitch);
    if (parsePitchInput(text) !== pitch) {
      setText(pitch === undefined ? '' : `${midiToNoteName(pitch)} (${pitch})`);
      setInvalidText(false);
    }
  }
  return (
    <Input
      aria-label={ariaLabel}
      value={text}
      placeholder="C4 或 60"
      className="w-36"
      aria-invalid={(invalidText || invalid) || undefined}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        const parsed = parsePitchInput(text);
        if (parsed === undefined) {
          setInvalidText(true);
          return;
        }
        setInvalidText(false);
        setText(`${midiToNoteName(parsed)} (${parsed})`);
        onCommit(parsed);
      }}
    />
  );
}
