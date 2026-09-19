import { Copy, Download, FilePlus, Pencil, Timer, Trash2, TriangleAlert, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { isBuiltinInstrumentId } from '@/core/instruments/registry';
import { type InstrumentProfile, validateInstrumentProfile } from '@/core/model/instrument';
import { midiToNoteName } from '@/core/music/pitch';
import { useNavigationStore } from '@/stores/navigationStore';
import { useInstrumentStore } from '@/stores/instrumentStore';
import { copyProfile } from './copyProfile';
import { InstrumentEditor } from './InstrumentEditor';
import { KeycapPreview, voiceLabel } from './KeycapPreview';
import { pickJsonFile, writeJsonFile } from './profileFiles';

interface EditingState {
  profile: InstrumentProfile;
  /** 已保存过的乐器 ID 不可修改 */
  saved: boolean;
}

interface ConfirmState {
  title: string;
  description: string;
  actionText: string;
  onAction: () => void;
  onCancel?: () => void;
}

/** 乐器页：左侧内置 / 自定义列表，右侧详情或编辑器，支持导入 / 导出 JSON */
export function InstrumentsPage() {
  const entries = useInstrumentStore((state) => state.entries);
  const warnings = useInstrumentStore((state) => state.warnings);
  const selectedId = useInstrumentStore((state) => state.selectedId);
  const select = useInstrumentStore((state) => state.select);
  const saveProfile = useInstrumentStore((state) => state.save);
  const removeProfile = useInstrumentStore((state) => state.remove);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InstrumentProfile | null>(null);
  const [importErrors, setImportErrors] = useState<string[] | null>(null);
  const [warningsOpen, setWarningsOpen] = useState(false);

  const selected = entries.find((entry) => entry.profile.id === selectedId);
  const builtinEntries = entries.filter((entry) => entry.builtin);
  const customEntries = entries.filter((entry) => !entry.builtin);

  /** 有未保存修改时，先弹确认再执行 action */
  const requestLeave = (action: () => void) => {
    if (!dirty) {
      action();
      return;
    }
    setConfirmState({
      title: '有未保存的修改',
      description: '离开后修改将丢失，确定要离开吗？',
      actionText: '放弃修改并离开',
      onAction: action,
    });
  };

  // 编辑器有未保存修改时注册离开保护：切换页面（侧边栏）前先确认
  useEffect(() => {
    if (!dirty) return;
    useNavigationStore.getState().setLeaveGuard(
      () =>
        new Promise<boolean>((resolve) => {
          setConfirmState({
            title: '有未保存的修改',
            description: '离开后修改将丢失，确定要离开吗？',
            actionText: '放弃修改并离开',
            onAction: () => resolve(true),
            onCancel: () => resolve(false),
          });
        }),
    );
    return () => useNavigationStore.getState().setLeaveGuard(null);
  }, [dirty]);

  const startNew = () => {
    const profile: InstrumentProfile = {
      schemaVersion: 1,
      id: `custom-${Date.now()}`,
      name: '新建乐器',
      kind: 'pitched',
      status: 'unverified',
      rows: [{ label: '高音', keys: [{ code: 'KeyQ', pitch: 72 }] }],
      timing: { holdMs: 30, minRepeatGapMs: 40, sustain: false },
    };
    setEditing({ profile, saved: false });
  };

  const copyToCustom = async (source: InstrumentProfile, fromBuiltin: boolean) => {
    const copy = copyProfile(source, entries.map((entry) => entry.profile.id));
    if (await saveProfile(copy)) {
      toast.success(fromBuiltin ? '已复制为自定义乐器，可编辑键位' : '已创建副本');
      setEditing({ profile: copy, saved: true });
    }
  };

  const finishImport = async (profile: InstrumentProfile) => {
    if (await saveProfile(profile)) {
      toast.success('已导入自定义乐器');
      setEditing(null);
      select(profile.id);
    }
  };

  const doImport = async () => {
    const picked = await pickJsonFile();
    if (!picked) return;
    let raw: unknown;
    try {
      raw = JSON.parse(picked.text);
    } catch (error) {
      toast.error(`JSON 解析失败：${(error as Error).message}`);
      return;
    }
    const result = validateInstrumentProfile(raw);
    if (!result.ok) {
      setImportErrors(result.errors);
      return;
    }
    const profile = result.value;
    if (isBuiltinInstrumentId(profile.id)) {
      toast.error('这个 ID 属于内置乐器，请修改 ID 后再导入');
      return;
    }
    if (entries.some((entry) => entry.profile.id === profile.id)) {
      setConfirmState({
        title: '覆盖已有乐器？',
        description: `已有同 ID 的自定义乐器「${profile.id}」，导入会覆盖它。`,
        actionText: '覆盖',
        onAction: () => void finishImport(profile),
      });
      return;
    }
    await finishImport(profile);
  };

  const exportProfile = async (profile: InstrumentProfile) => {
    if (await writeJsonFile(`${profile.id}.json`, JSON.stringify(profile, null, 2))) {
      toast.success('已导出乐器配置');
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    if (await removeProfile(target.id)) toast.success('已删除自定义乐器');
  };

  const renderItem = (profile: InstrumentProfile) => {
    const active = editing ? editing.profile.id === profile.id : profile.id === selectedId;
    return (
      <Button
        key={profile.id}
        variant="ghost"
        className={`w-full justify-between gap-2 ${active ? 'bg-accent' : ''}`}
        onClick={() => {
          if (editing) {
            if (editing.profile.id === profile.id) return;
            requestLeave(() => {
              setEditing(null);
              select(profile.id);
            });
            return;
          }
          select(profile.id);
        }}
      >
        <span className="truncate">{profile.name}</span>
        <span className="flex shrink-0 items-center gap-1">
          <Badge variant="secondary">{profile.kind === 'percussion' ? '敲击' : '音高'}</Badge>
          {profile.status === 'unverified' && <Badge variant="outline">待实测</Badge>}
        </span>
      </Button>
    );
  };

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-72 shrink-0 flex-col border-r p-4">
        {warnings.length > 0 && (
          <Alert className="mb-2">
            <TriangleAlert />
            <AlertTitle>
              <button
                type="button"
                className="flex items-center gap-1 text-left"
                aria-expanded={warningsOpen}
                onClick={() => setWarningsOpen((open) => !open)}
              >
                有 {warnings.length} 个自定义乐器文件无法读取
              </button>
            </AlertTitle>
            {warningsOpen && (
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {warnings.map((warning, index) => (
                    <li key={`${index}-${warning}`}>{warning}</li>
                  ))}
                </ul>
              </AlertDescription>
            )}
          </Alert>
        )}
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
          <p className="px-2 pt-1 text-xs text-muted-foreground">内置</p>
          {builtinEntries.map((entry) => renderItem(entry.profile))}
          <p className="px-2 pt-3 text-xs text-muted-foreground">自定义</p>
          {customEntries.length > 0 ? (
            customEntries.map((entry) => renderItem(entry.profile))
          ) : (
            <p className="px-2 py-1 text-sm text-muted-foreground">还没有自定义乐器</p>
          )}
        </div>
        <div className="mt-2 flex gap-2 border-t pt-3">
          <Button variant="outline" size="sm" className="flex-1" onClick={() => requestLeave(startNew)}>
            <FilePlus /> 新建
          </Button>
          <Button variant="outline" size="sm" className="flex-1" onClick={() => void requestLeave(() => void doImport())}>
            <Upload /> 导入 JSON
          </Button>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col p-4">
        {editing ? (
          <InstrumentEditor
            key={editing.profile.id}
            profile={editing.profile}
            saved={editing.saved}
            onDirtyChange={setDirty}
            onCancel={() => requestLeave(() => setEditing(null))}
            onDone={() => setEditing(null)}
          />
        ) : selected && (
          <>
            <div>
              <h2 className="text-lg font-semibold">{selected.profile.name}</h2>
              <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span>{selected.builtin ? '内置' : '自定义'}</span>
                <span>·</span>
                <span>{selected.profile.kind === 'percussion' ? '敲击类' : '音高类'}</span>
                <Badge variant="secondary">{selected.profile.status === 'verified' ? '已验证' : '待实测'}</Badge>
                <span>·</span>
                <span className="font-mono text-xs">{selected.profile.id}</span>
              </p>
            </div>
            {selected.profile.status === 'unverified' && (
              <p className="mt-1 text-sm text-muted-foreground">该乐器的键位和音高尚未在游戏中验证，可能与实际不符。</p>
            )}
            <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
              <Card>
                <CardContent className="flex flex-col gap-2 px-3 py-2">
                  <p className="text-sm text-muted-foreground">虚拟琴键预览（点击试听）</p>
                  <KeycapPreview profile={selected.profile} />
                </CardContent>
              </Card>
              <p className="flex items-center gap-1 text-sm text-muted-foreground">
                <Timer className="size-4" />
                按住时长 {selected.profile.timing.holdMs}ms · 最小重复间隔 {selected.profile.timing.minRepeatGapMs}ms ·{' '}
                {selected.profile.timing.sustain ? '可持续发声' : '不可持续发声'}
              </p>
              {selected.profile.kind === 'percussion' && selected.profile.percussionMap && (
                <Card>
                  <CardContent className="flex flex-col gap-2 px-3 py-2">
                    <p className="text-sm font-medium">鼓映射表</p>
                    <div className="flex flex-col gap-1">
                      {Object.entries(selected.profile.percussionMap.drumNotes).map(([note, voice]) => (
                        <p key={note} className="flex gap-3 text-sm">
                          <span className="w-16 font-mono">{note}</span>
                          <span className="w-16">{voiceLabel(voice)}</span>
                          <span className="text-muted-foreground">{midiToNoteName(Number(note))}</span>
                        </p>
                      ))}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      分界音高：
                      {selected.profile.percussionMap.splitPitch === 'auto'
                        ? '自动（中位数）'
                        : midiToNoteName(selected.profile.percussionMap.splitPitch)}
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
              {selected.builtin ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => void copyToCustom(selected.profile, true)}>
                    <Copy /> 复制为自定义
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void exportProfile(selected.profile)}>
                    <Download /> 导出 JSON
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" onClick={() => setEditing({ profile: selected.profile, saved: true })}>
                    <Pencil /> 编辑
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void copyToCustom(selected.profile, false)}>
                    <Copy /> 复制
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void exportProfile(selected.profile)}>
                    <Download /> 导出 JSON
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setDeleteTarget(selected.profile)}>
                    <Trash2 /> 删除
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </div>
      <AlertDialog
        open={confirmState !== null}
        onOpenChange={(open) => {
          if (!open) {
            confirmState?.onCancel?.();
            setConfirmState(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmState?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmState?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                confirmState?.onCancel?.();
                setConfirmState(null);
              }}
            >
              继续编辑
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const action = confirmState?.onAction;
                setConfirmState(null);
                action?.();
              }}
            >
              {confirmState?.actionText}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteTarget ? `删除「${deleteTarget.name}」？` : ''}</AlertDialogTitle>
            <AlertDialogDescription>删除后无法恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteTarget(null)}>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => void handleDelete()}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={importErrors !== null} onOpenChange={(open) => !open && setImportErrors(null)}>
        <DialogContent showCloseButton={false} className="max-w-lg">
          <DialogHeader>
            <DialogTitle>乐器配置校验失败</DialogTitle>
            <DialogDescription>导入的文件存在以下问题，请修改后再试：</DialogDescription>
          </DialogHeader>
          <ul className="list-disc pl-5 text-sm">
            {(importErrors ?? []).map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportErrors(null)}>
              知道了
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
