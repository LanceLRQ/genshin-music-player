import { Info, ShieldAlert, SquareArrowOutUpRight, TriangleAlert, Unplug, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { openAccessibilitySettings, restartAsAdmin } from '@/ipc/commands';
import { notifyError } from '@/lib/notify';
import { useEnvStore } from '@/stores/envStore';

/** 顶部横幅：无法连接后端、Windows 未提权、macOS 未授权辅助功能、模拟模式、启动警告，按需出现、纵向堆叠 */
export function EnvBanners() {
  const env = useEnvStore((state) => state.env);
  const error = useEnvStore((state) => state.error);
  const warningsDismissed = useEnvStore((state) => state.warningsDismissed);
  const dismissWarnings = useEnvStore((state) => state.dismissWarnings);
  const reloadEnv = useEnvStore((state) => state.load);
  const [restarting, setRestarting] = useState(false);
  const [opening, setOpening] = useState(false);

  const showNotElevated = env?.platform === 'windows' && env.elevated === false;
  // 只对真实 macOS 后端提示：mock 后端（gm-verify 演示场景）不做 CGEvent 发键，避免同时挂两条横幅
  const showNotTrusted = env?.platform === 'macos' && env.backend === 'macos' && env.trusted === false;
  const showMock = env?.backend === 'mock';
  const warnings = env && !warningsDismissed ? env.startupWarnings : [];
  if (!error && !showNotElevated && !showNotTrusted && !showMock && warnings.length === 0) return null;

  const restart = async () => {
    setRestarting(true);
    try {
      await restartAsAdmin();
    } catch (restartError) {
      notifyError(restartError, '以管理员身份重启失败');
    } finally {
      setRestarting(false);
    }
  };

  const openSettings = async () => {
    setOpening(true);
    try {
      await openAccessibilitySettings();
      toast.info('已在系统设置中打开辅助功能面板，勾选本应用后点击「重新检测」');
    } catch (openError) {
      notifyError(openError, '无法打开系统设置');
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 border-b p-3">
      {error && (
        <Alert variant="destructive">
          <Unplug />
          <AlertTitle>无法连接后端</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}
      {showNotElevated && (
        <Alert variant="destructive">
          <ShieldAlert />
          <AlertTitle>未以管理员身份运行，游戏将收不到按键。</AlertTitle>
          <AlertDescription>
            <Button size="sm" variant="outline" disabled={restarting} onClick={() => void restart()}>
              以管理员身份重启
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {showNotTrusted && (
        <Alert variant="destructive">
          <ShieldAlert />
          <AlertTitle>未授予辅助功能权限，游戏将收不到按键。</AlertTitle>
          <AlertDescription>
            在系统设置 → 隐私与安全性 → 辅助功能中勾选本应用。也可以在设置页开启「模拟发声」，只在本窗口播放不出键。
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={opening} onClick={() => void openSettings()}>
                <SquareArrowOutUpRight className="size-4" />
                去系统设置授权
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void reloadEnv()}>
                重新检测
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
      {showMock && (
        <Alert>
          <Info />
          <AlertTitle>当前平台不能向游戏发送按键，“演奏”只会模拟并记录日志。</AlertTitle>
        </Alert>
      )}
      {warnings.length > 0 && (
        <Alert>
          <TriangleAlert />
          <AlertTitle className="flex items-center justify-between gap-2">
            启动时发现问题
            <Button size="icon" variant="ghost" className="size-6" aria-label="关闭启动警告" onClick={dismissWarnings}>
              <X />
            </Button>
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {warnings.map((warning, index) => (
                <li key={`${index}-${warning}`}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
