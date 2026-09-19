import { getCurrentWebview } from '@tauri-apps/api/webview';
import { AudioLines, FileText, FileUp, FolderOpen, Keyboard } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { previewPlayer } from '@/audio/previewPlayer';
import { adapt } from '@/core/adapter/adapt';
import type { Score } from '@/core/model/score';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAppShortcuts } from '@/hooks/useAppShortcuts';
import { useAdaptation } from '@/hooks/useAdaptation';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import * as commands from '@/ipc/commands';
import { formatSpeed } from '@/lib/format';
import { isPlayerActive } from '@/lib/playerStatus';
import { notifyError } from '@/lib/notify';
import { useAdaptStore } from '@/stores/adaptStore';
import { useInstrumentStore } from '@/stores/instrumentStore';
import { useScoreStore } from '@/stores/scoreStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTransportStore } from '@/stores/transportStore';
import { AdaptOptionsPanel } from './AdaptOptionsPanel';
import { AdaptReportCard } from './AdaptReportCard';
import { scoreDurationMs } from './scoreInfo';
import { ImportMenu, type TextScoreTab } from './ImportMenu';
import { InstrumentSelect } from './InstrumentSelect';
import { OutputDeviceSelect } from './OutputDeviceSelect';
import { parseScoreFile, pickScoreFile, readScoreFile, writeScoreJson } from './fileIO';
import { RangeControls } from './RangeControls';
import { ScoreHeader } from './ScoreHeader';
import { TextScoreDialog, type TextScorePreset } from './TextScoreDialog';
import { TimelineBar } from './TimelineBar';
import type { SoloMode } from './TrackItem';
import { TrackList } from './TrackList';
import { TransportBar } from './TransportBar';
import { SummaryLine } from './SummaryLine';
import { VirtualKeyboard } from './VirtualKeyboard';

interface TextDialogState {
  tab: TextScoreTab;
  preset?: TextScorePreset;
}

/** 模拟发声是否开启：开启时演奏入口不向游戏发键，改由本窗口试听发声（设置未加载时按关闭处理） */
function soundOnly(): boolean {
  return useSettingsStore.getState().settings?.simulateSound ?? false;
}

/** 拖放悬停时的全窗口遮罩（设计 01 第 4.2 节） */
function DropOverlay() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70" data-testid="drop-overlay">
      <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-primary bg-background px-12 py-10">
        <FileUp className="size-8 text-muted-foreground" />
        <span className="text-sm font-medium">松开以导入乐谱</span>
      </div>
    </div>
  );
}

/** 演奏页（设计 01 第 4 节） */
export function PlayPage() {
  const score = useScoreStore((state) => state.score);
  const sourceInstrumentId = useScoreStore((state) => state.sourceInstrumentId);
  const targetId = useAdaptStore((state) => state.targetId);
  const options = useAdaptStore((state) => state.options);
  const manual = useAdaptStore((state) => state.manual);
  const entries = useInstrumentStore((state) => state.entries);
  const playerState = useTransportStore((state) => state.playerState);
  const solo = useTransportStore((state) => state.solo);
  const previewing = useTransportStore((state) => state.previewing);
  const execution = useTransportStore((state) => state.execution);
  const range = useTransportStore((state) => state.range);
  const loop = useTransportStore((state) => state.loop);
  const speed = useTransportStore((state) => state.speed);
  const humanizeMs = useTransportStore((state) => state.humanizeMs);
  const volume = useTransportStore((state) => state.volume);

  const profile = useMemo(() => entries.find((entry) => entry.profile.id === targetId)?.profile, [entries, targetId]);
  const locked = isPlayerActive(playerState);
  const hasTimeline = !!execution && execution.events.length > 0;
  const { timeline, report, rates } = useAdaptation();
  const checkedIds = useMemo(() => options?.tracks ?? [], [options]);

  const [textDialog, setTextDialog] = useState<TextDialogState | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // —— 执行时间线：适配结果或区间/循环/速度/人性化变化后防抖 150ms 重新生成（设计 01 第 4.8 节）；
  // useMemo 保持输入对象引用稳定，避免每次重渲染都重置防抖并反复触发 syncExecution ——
  const executionInputs = useMemo(
    () => ({ timeline, range, loop, speed, humanizeMs }),
    [timeline, range, loop, speed, humanizeMs],
  );
  const debouncedInputs = useDebouncedValue(executionInputs, 150);
  useEffect(() => {
    void useTransportStore.getState().syncExecution(debouncedInputs.timeline);
  }, [debouncedInputs]);

  // —— 参数修改时自动停止试听（设计 01 第 4.9 节） ——
  useEffect(() => {
    if (useTransportStore.getState().previewing) void useTransportStore.getState().stopPreview();
  }, [options, range, loop, speed, humanizeMs, targetId]);

  // —— 音量变化同步到试听播放器 ——
  useEffect(() => {
    previewPlayer.setVolume(volume);
  }, [volume]);

  /** 导入成功：重置 transport → 重置推荐参数 → 写入乐谱（设计 01 第 4.2 节） */
  const applyImportedScore = useCallback(
    (nextScore: Score, info: { fileName: string; sourceInstrumentId?: string }) => {
      if (isPlayerActive(useTransportStore.getState().playerState)) {
        toast.info('演奏进行中，停止后才能导入');
        return;
      }
      useTransportStore
        .getState()
        .resetForScore({ startMs: 0, endMs: scoreDurationMs(nextScore) }, useSettingsStore.getState().settings?.defaultHumanizeMs ?? 0);
      const targetProfile = useInstrumentStore
        .getState()
        .entries.find((entry) => entry.profile.id === useAdaptStore.getState().targetId)?.profile;
      if (targetProfile) useAdaptStore.getState().resetToRecommended(nextScore, targetProfile, info.sourceInstrumentId);
      useScoreStore.getState().setScore(nextScore, info);
      toast.success(`已导入「${nextScore.meta.title}」`);
    },
    [],
  );

  const importFromPath = useCallback(
    async (path: string) => {
      try {
        const data = await readScoreFile(path);
        const fileName = path.split(/[\\/]/).pop() ?? path;
        const parsed = parseScoreFile(fileName, data);
        if (parsed.kind === 'score') applyImportedScore(parsed.score, { fileName });
        else setTextDialog({ tab: parsed.guess, preset: { title: parsed.title, text: parsed.text } });
      } catch (error) {
        notifyError(error, '导入乐谱失败');
      }
    },
    [applyImportedScore],
  );

  const importFromPathRef = useRef(importFromPath);
  useEffect(() => {
    importFromPathRef.current = importFromPath;
  });

  // —— 拖放导入（Tauri 窗口）；getCurrentWebview 会同步读取 window.__TAURI_INTERNALS__.metadata，
  // 浏览器与测试环境都没有该对象，先判断再订阅，保证静默跳过、不白屏 ——
  useEffect(() => {
    const internals = (window as { __TAURI_INTERNALS__?: { metadata?: unknown } }).__TAURI_INTERNALS__;
    if (!internals?.metadata) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === 'enter' || event.payload.type === 'over') setDragOver(true);
        else if (event.payload.type === 'leave') setDragOver(false);
        else if (event.payload.type === 'drop') {
          setDragOver(false);
          const path = event.payload.paths[0];
          if (path) void importFromPathRef.current(path);
        }
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const openScoreFile = useCallback(async () => {
    try {
      const path = await pickScoreFile();
      if (path) await importFromPathRef.current(path);
    } catch (error) {
      notifyError(error, '无法打开乐谱文件');
    }
  }, []);

  const handleExport = useCallback(async () => {
    const current = useScoreStore.getState().score;
    if (!current) {
      toast.info('还没有可导出的乐谱');
      return;
    }
    try {
      if (await writeScoreJson(current.meta.title, current)) toast.success('已导出 JSON 谱');
    } catch (error) {
      notifyError(error, '导出 JSON 谱失败');
    }
  }, []);

  /** 切换目标乐器后重新计算自动推荐（设计 01 第 4.3 节） */
  const handleTargetChange = useCallback((id: string) => {
    useAdaptStore.getState().setTarget(id);
    const nextProfile = useInstrumentStore.getState().entries.find((entry) => entry.profile.id === id)?.profile;
    const currentScore = useScoreStore.getState().score;
    if (nextProfile && currentScore) {
      useAdaptStore.getState().resetToRecommended(currentScore, nextProfile, useScoreStore.getState().sourceInstrumentId ?? undefined);
    }
  }, []);

  const handlePreviewToggle = useCallback(() => {
    const transport = useTransportStore.getState();
    if (transport.previewing) {
      void transport.stopPreview();
      return;
    }
    const currentProfile = useInstrumentStore
      .getState()
      .entries.find((entry) => entry.profile.id === useAdaptStore.getState().targetId)?.profile;
    if (currentProfile) transport.startPreview(currentProfile);
  }, []);

  /** 演奏：先停止试听（设计 4.9），暂停中作为继续（设计 4.10 单轨恢复）；模拟发声开启时改由试听发声 */
  const handlePlay = useCallback(async () => {
    const transport = useTransportStore.getState();
    if (transport.previewing) await transport.stopPreview();
    if (soundOnly()) {
      // 兜底停掉可能仍在发键的后端演奏。必须 await：后端在播放线程处理 stop 时同步 emit
      // player://state: idle，await 返回时该事件已被 setPlayerState 消化（此刻 previewing 还是
      // false，清试听逻辑无害）；先 stop 再 startPreview，试听才不会被随后的 idle 事件掐掉
      await commands.stop().catch(() => undefined);
      const currentProfile = useInstrumentStore
        .getState()
        .entries.find((entry) => entry.profile.id === useAdaptStore.getState().targetId)?.profile;
      if (currentProfile) useTransportStore.getState().startPreview(currentProfile);
      return;
    }
    if (useTransportStore.getState().playerState.kind === 'paused') await useTransportStore.getState().resume();
    else await useTransportStore.getState().play();
  }, []);

  const handleStop = useCallback(() => {
    const transport = useTransportStore.getState();
    if (transport.previewing) void transport.stopPreview();
    else void transport.stop();
  }, []);

  /** 单轨试听 / 演奏（设计 01 第 4.10 节）：开始前先停止整曲试听；结束后由 transportStore 恢复主时间线 */
  const handleSolo = useCallback(async (mode: SoloMode, trackId: string) => {
    const transport = useTransportStore.getState();
    if (transport.previewing) await transport.stopPreview();
    const currentScore = useScoreStore.getState().score;
    const currentProfile = useInstrumentStore
      .getState()
      .entries.find((entry) => entry.profile.id === useAdaptStore.getState().targetId)?.profile;
    const currentOptions = useAdaptStore.getState().options;
    if (!currentScore || !currentProfile || !currentOptions) return;
    const single = adapt(currentScore, currentProfile, { ...currentOptions, tracks: [trackId] });
    // 模拟发声下与单独试听同语义：solo 标记必须记为 preview，否则 stopPreview / finishPreview
    // 不会触发 endSolo，单轨结束后标记与单轨 execution 会永久残留并污染后续演奏
    const soloMode: SoloMode = soundOnly() ? 'preview' : mode;
    const started = await useTransportStore.getState().startSolo({ mode: soloMode, trackId }, single.timeline);
    if (!started) {
      toast.info('这条音轨在当前区间内没有可弹的音');
      return;
    }
    if (soloMode === 'preview') {
      // 兜底停掉可能仍在发键的后端演奏（与 handlePlay / 热键 toggle 一致）：先 await stop——
      // await 返回时后端同步 emit 的 idle 事件已被消化（此刻 previewing 还是 false，无害），
      // 随后再起试听就不会被 idle 事件掐掉
      await commands.stop().catch(() => undefined);
      useTransportStore.getState().startPreview(currentProfile);
    } else void transport.play();
  }, []);

  const handleSoloCancel = useCallback(() => {
    const transport = useTransportStore.getState();
    if (transport.previewing) void transport.stopPreview();
    else void transport.stop();
  }, []);

  // —— 窗口内快捷键（设计 01 第 4.12 节） ——
  useAppShortcuts({
    openFile: locked ? undefined : () => void openScoreFile(),
    previewToggle: hasTimeline && !locked ? handlePreviewToggle : undefined,
    previewStop: previewing ? () => void useTransportStore.getState().stopPreview() : undefined,
  });

  const hasScore = score !== null && options !== null && profile !== undefined;
  return (
    <TooltipProvider delayDuration={100}>
      <div className="flex h-full min-h-0">
        {hasScore && (
          <div className="flex w-[360px] shrink-0 flex-col border-r">
            <div className="flex flex-col gap-3 p-4 pb-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">乐谱</span>
                <div className="flex items-center gap-2">
                  <ImportMenu disabled={locked} onOpenFile={() => void openScoreFile()} onPasteText={(tab) => setTextDialog({ tab })} />
                  <Button variant="outline" size="sm" disabled={locked} onClick={() => void handleExport()}>
                    导出 JSON 谱
                  </Button>
                </div>
              </div>
              <Card>
                <CardHeader className="px-3 py-2">
                  <CardTitle className="text-sm">目标乐器</CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3">
                  <InstrumentSelect disabled={locked} onValueChange={handleTargetChange} />
                </CardContent>
              </Card>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <TrackList
                tracks={score.tracks}
                checkedIds={checkedIds}
                rates={rates}
                pitched={profile.kind === 'pitched'}
                locked={locked}
                onSetChecked={(tracks) => useAdaptStore.getState().setOptions({ ...options, tracks })}
                onSolo={(mode, trackId) => void handleSolo(mode, trackId)}
              />
            </div>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 pb-0">
          {hasScore ? (
            <>
              <ScoreHeader score={score} />
              <VirtualKeyboard />
              <TimelineBar />
              <RangeControls locked={locked} />
              <div className="grid min-h-0 flex-1 grid-cols-2 gap-3">
                <div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
                  <AdaptOptionsPanel
                    profile={profile}
                    options={options}
                    manual={manual}
                    locked={locked}
                    onChange={(next) => useAdaptStore.getState().setOptions(next)}
                    onReset={() => useAdaptStore.getState().resetToRecommended(score, profile, sourceInstrumentId ?? undefined)}
                  />
                  <AdaptReportCard report={report} hasTracks={checkedIds.length > 0} />
                </div>
                <Card className="min-h-0 overflow-hidden">
                  <CardHeader className="px-3 py-2">
                    <CardTitle className="text-sm">演奏控制</CardTitle>
                  </CardHeader>
                  <CardContent className="min-h-0 overflow-y-auto px-3 pb-3">
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-3">
                        <span className="w-14 shrink-0 text-sm">速度</span>
                        <Slider
                          className="flex-1"
                          min={0.5}
                          max={2}
                          step={0.05}
                          value={[speed]}
                          disabled={locked}
                          onValueChange={([next]) => useTransportStore.getState().setSpeed(next)}
                        />
                        <span
                          className="w-12 cursor-default text-right text-sm tabular-nums"
                          title="双击恢复 1.00×"
                          onDoubleClick={() => useTransportStore.getState().setSpeed(1)}
                        >
                          {formatSpeed(speed)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="w-14 shrink-0 text-sm">人性化</span>
                        <Slider
                          className="flex-1"
                          min={0}
                          max={30}
                          step={1}
                          value={[humanizeMs]}
                          disabled={locked}
                          onValueChange={([next]) => useTransportStore.getState().setHumanizeMs(next)}
                        />
                        <span className="w-12 text-right text-sm tabular-nums">{humanizeMs} ms</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <Label className="w-14 shrink-0 text-sm">音量</Label>
                        <Slider
                          className="flex-1"
                          min={0}
                          max={100}
                          step={1}
                          value={[Math.round(volume * 100)]}
                          onValueChange={([next]) => useTransportStore.getState().setVolume(next / 100)}
                        />
                        <span className="w-12 text-right text-sm tabular-nums">{Math.round(volume * 100)}%</span>
                      </div>
                      <OutputDeviceSelect />
                    </div>
                  </CardContent>
                </Card>
              </div>
              <div className="sticky bottom-0 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur">
                <TransportBar
                  soloTrackName={solo ? (score.tracks.find((track) => track.id === solo.trackId)?.name ?? null) : null}
                  onPreviewToggle={handlePreviewToggle}
                  onPlay={() => void handlePlay()}
                  onPause={() => void useTransportStore.getState().pause()}
                  onStop={handleStop}
                  onSoloCancel={handleSoloCancel}
                />
                <SummaryLine />
              </div>
            </>
          ) : (
            <Empty className="flex-1 justify-center rounded-xl border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <AudioLines />
                </EmptyMedia>
                <EmptyTitle>导入乐谱开始</EmptyTitle>
                <EmptyDescription>支持 MIDI、键盘谱、简谱和 JSON 谱，也可以把文件直接拖进窗口。</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button onClick={() => void openScoreFile()}>
                    <FolderOpen className="size-4" />
                    打开文件
                  </Button>
                  <Button variant="outline" onClick={() => setTextDialog({ tab: 'keyscore' })}>
                    <Keyboard className="size-4" />
                    粘贴键盘谱
                  </Button>
                  <Button variant="outline" onClick={() => setTextDialog({ tab: 'jianpu' })}>
                    <FileText className="size-4" />
                    粘贴简谱
                  </Button>
                </div>
              </EmptyContent>
            </Empty>
          )}
        </div>
        {textDialog && (
          <TextScoreDialog
            open
            initialTab={textDialog.tab}
            preset={textDialog.preset}
            onOpenChange={(next) => {
              if (!next) setTextDialog(null);
            }}
            onImport={(imported, sourceId) => {
              setTextDialog(null);
              applyImportedScore(imported, { fileName: `${imported.meta.title}（文本导入）`, sourceInstrumentId: sourceId });
            }}
          />
        )}
        {dragOver && <DropOverlay />}
      </div>
    </TooltipProvider>
  );
}
