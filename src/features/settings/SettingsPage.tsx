import { Copy, Settings as SettingsIcon, ShieldAlert } from 'lucide-react';
import { useMemo } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { DEFAULT_SETTINGS, type Hotkeys, type Settings, type Shortcuts } from '@/ipc/types';
import { isPlayerActive } from '@/lib/playerStatus';
import { findShortcutConflicts, getShortcut, guessPlatform, SHORTCUT_FIELDS, type ShortcutField } from '@/lib/shortcuts';
import { useDisclaimerStore } from '@/stores/disclaimerStore';
import { useEnvStore } from '@/stores/envStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTransportStore } from '@/stores/transportStore';
import { HotkeyInput } from './HotkeyInput';
import { WindowTitleList } from './WindowTitleList';

const PLATFORM_LABEL = { windows: 'Windows', macos: 'macOS', linux: 'Linux' } as const;

const DEFAULT_VALUE: Record<ShortcutField, string> = {
  'hotkeys.toggle': DEFAULT_SETTINGS.hotkeys.toggle,
  'hotkeys.stop': DEFAULT_SETTINGS.hotkeys.stop,
  'shortcuts.openFile': DEFAULT_SETTINGS.shortcuts.openFile,
  'shortcuts.previewToggle': DEFAULT_SETTINGS.shortcuts.previewToggle,
  'shortcuts.previewStop': DEFAULT_SETTINGS.shortcuts.previewStop,
};

/** 快捷键字段 → 对应设置分段中的键 */
function setShortcutValue(base: Settings, field: ShortcutField, value: string): Settings {
  if (field.startsWith('hotkeys.')) {
    const key = field.slice('hotkeys.'.length) as keyof Hotkeys;
    return { ...base, hotkeys: { ...base.hotkeys, [key]: value } };
  }
  const key = field.slice('shortcuts.'.length) as keyof Shortcuts;
  return { ...base, shortcuts: { ...base.shortcuts, [key]: value } };
}

/** 设置页：六个分组的显式保存表单，底部操作栏只在有未保存修改时出现 */
export function SettingsPage() {
  const settings = useSettingsStore((state) => state.settings);
  const draft = useSettingsStore((state) => state.draft);
  const saving = useSettingsStore((state) => state.saving);
  const setDraft = useSettingsStore((state) => state.setDraft);
  const saveDraft = useSettingsStore((state) => state.saveDraft);
  const resetDraft = useSettingsStore((state) => state.resetDraft);
  const env = useEnvStore((state) => state.env);
  const playerState = useTransportStore((state) => state.playerState);
  const reviewRisk = useDisclaimerStore((state) => state.review);
  const platform = env?.platform ?? guessPlatform(navigator.userAgent);
  const playerActive = isPlayerActive(playerState);

  const current = draft ?? settings;
  const isDirty = draft !== null && settings !== null && JSON.stringify(draft) !== JSON.stringify(settings);
  const conflicts = useMemo(() => {
    if (!draft) return new Set<ShortcutField>();
    return new Set(findShortcutConflicts(draft).flatMap((conflict) => conflict.fields));
  }, [draft]);

  const update = (patch: (base: Settings) => Settings) => {
    const base = draft ?? (settings ? structuredClone(settings) : null);
    if (base) setDraft(patch(base));
  };

  const save = async () => {
    if (await saveDraft()) toast.success('设置已保存');
  };

  const revert = () => {
    resetDraft();
    toast.info('已撤销未保存的修改');
  };

  const copyLogsDir = () => {
    if (!env) return;
    navigator.clipboard
      ?.writeText(env.logsDir)
      .then(() => toast.success('已复制日志目录'))
      .catch(() => toast.error('复制失败'));
  };

  if (!settings || !current) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SettingsIcon />
          </EmptyMedia>
          <EmptyTitle>设置</EmptyTitle>
          <EmptyDescription>设置尚未加载。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const renderHotkeyField = (field: ShortcutField) => {
    const info = SHORTCUT_FIELDS.find((candidate) => candidate.field === field);
    if (!info) return null;
    return (
      <Field key={field} orientation="horizontal">
        <FieldLabel className="w-40 shrink-0">{info.label}</FieldLabel>
        <FieldContent>
          <HotkeyInput
            info={info}
            value={getShortcut(current, field)}
            defaultValue={DEFAULT_VALUE[field]}
            conflict={conflicts.has(field)}
            disabled={playerActive}
            onChange={(value) => update((base) => setShortcutValue(base, field, value))}
          />
        </FieldContent>
      </Field>
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>快捷键（全局）</CardTitle>
          <CardDescription>全局热键由系统独占，游戏本身收不到这些按键。保存时重新注册，失败会提示。</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            {renderHotkeyField('hotkeys.toggle')}
            {renderHotkeyField('hotkeys.stop')}
            {playerActive && <p className="text-sm text-destructive">演奏进行中不能修改快捷键</p>}
          </FieldGroup>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>快捷键（窗口内）</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            {renderHotkeyField('shortcuts.openFile')}
            {renderHotkeyField('shortcuts.previewToggle')}
            {renderHotkeyField('shortcuts.previewStop')}
            <FieldDescription>侧边栏折叠使用 Ctrl / Cmd+B，请避免把窗口内快捷键设为这个组合。</FieldDescription>
            {playerActive && <p className="text-sm text-destructive">演奏进行中不能修改快捷键</p>}
          </FieldGroup>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>演奏</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldLabel className="w-40 shrink-0">倒计时</FieldLabel>
              <Slider
                min={0}
                max={10}
                step={1}
                value={[current.countdownSec]}
                onValueChange={([countdownSec]) => update((base) => ({ ...base, countdownSec }))}
                className="max-w-sm flex-1"
              />
              <span className="w-12 text-right text-sm text-muted-foreground">{current.countdownSec} 秒</span>
            </Field>
            <Field orientation="horizontal">
              <FieldLabel className="w-40 shrink-0">默认人性化</FieldLabel>
              <Slider
                min={0}
                max={30}
                step={1}
                value={[current.defaultHumanizeMs]}
                onValueChange={([defaultHumanizeMs]) => update((base) => ({ ...base, defaultHumanizeMs }))}
                className="max-w-sm flex-1"
              />
              <span className="w-12 text-right text-sm text-muted-foreground">{current.defaultHumanizeMs} ms</span>
            </Field>
            <FieldDescription>默认人性化在导入新乐谱时作为初始值。</FieldDescription>
          </FieldGroup>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>游戏窗口识别</CardTitle>
          <CardAction>
            <Button variant="ghost" size="sm" onClick={() => update((base) => ({ ...base, targetWindow: structuredClone(DEFAULT_SETTINGS.targetWindow) }))}>
              恢复默认
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldLabel className="w-40 shrink-0" htmlFor="set-class">
                窗口类名
              </FieldLabel>
              <Input
                id="set-class"
                value={current.targetWindow.className}
                className="w-56 font-mono"
                onChange={(event) => update((base) => ({ ...base, targetWindow: { ...base.targetWindow, className: event.target.value } }))}
              />
            </Field>
            <Field orientation="horizontal">
              <FieldLabel className="w-40 shrink-0">窗口标题</FieldLabel>
              <WindowTitleList
                titles={current.targetWindow.titles}
                onChange={(titles) => update((base) => ({ ...base, targetWindow: { ...base.targetWindow, titles } }))}
              />
            </Field>
            <FieldDescription>
              {platform === 'macos'
                ? 'macOS 上按前台应用名（如 Google Chrome、Safari）或窗口标题匹配，类名不参与匹配；云原神请把浏览器应用名加进列表。'
                : '演奏时只在类名和标题同时匹配的窗口在前台时才发键。至少保留一个标题。'}
            </FieldDescription>
          </FieldGroup>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>日志</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldLabel className="w-40 shrink-0" htmlFor="set-log">
                写入执行日志
              </FieldLabel>
              <Switch
                id="set-log"
                checked={current.writeExecutionLog}
                onCheckedChange={(writeExecutionLog) => update((base) => ({ ...base, writeExecutionLog }))}
              />
            </Field>
            <Field orientation="horizontal">
              <FieldLabel className="w-40 shrink-0">日志目录</FieldLabel>
              <span className="font-mono text-sm text-muted-foreground">{env?.logsDir ?? '—'}</span>
              <Button variant="outline" size="sm" onClick={copyLogsDir}>
                <Copy /> 复制路径
              </Button>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>关于</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldLabel className="w-40 shrink-0">平台</FieldLabel>
              <span className="text-sm">{PLATFORM_LABEL[platform]}</span>
            </Field>
            <Field orientation="horizontal">
              <FieldLabel className="w-40 shrink-0">后端</FieldLabel>
              <span className="text-sm">
                {env ? `${env.backend}${env.backend === 'mock' ? '（演示环境，不能向游戏发键）' : ''}` : '—'}
              </span>
            </Field>
            {env?.platform === 'windows' && (
              <Field orientation="horizontal">
                <FieldLabel className="w-40 shrink-0">管理员状态</FieldLabel>
                <span className="text-sm">{env.elevated ? '是' : '否'}</span>
              </Field>
            )}
            <Field orientation="horizontal">
              <FieldLabel className="w-40 shrink-0">版本号</FieldLabel>
              <span className="text-sm">{env?.appVersion ?? '—'}</span>
            </Field>
            <Field orientation="horizontal">
              <FieldLabel className="w-40 shrink-0">数据目录</FieldLabel>
              <span className="font-mono text-sm text-muted-foreground">{env?.dataDir ?? '—'}</span>
            </Field>
            <div>
              <Button variant="outline" size="sm" onClick={reviewRisk}>
                <ShieldAlert /> 查看风险提示
              </Button>
            </div>
          </FieldGroup>
        </CardContent>
      </Card>
      {isDirty && (
        <div className="sticky bottom-0 flex items-center gap-3 border-t bg-background py-3">
          <span className="text-sm text-muted-foreground">有未保存的设置</span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" onClick={revert}>
              撤销修改
            </Button>
            <Button disabled={conflicts.size > 0 || saving} onClick={() => void save()}>
              保存设置
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
