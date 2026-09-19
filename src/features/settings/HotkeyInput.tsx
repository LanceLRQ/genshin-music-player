import { RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import {
  displayShortcut,
  guessPlatform,
  shortcutFromEvent,
  validateShortcut,
  type ShortcutFieldInfo,
} from '@/lib/shortcuts';
import { cn } from '@/lib/utils';
import { useEnvStore } from '@/stores/envStore';

const CAPTURING_TEXT = '请按下组合键…（Esc 取消）';
const MODIFIER_ONLY_TEXT = '只按下修饰键，请再按一个字母、数字或功能键';
const CONFLICT_TEXT = '这个组合键已被占用';

interface HotkeyInputProps {
  /** 字段定义（field / scope / label），来自 lib/shortcuts 的 SHORTCUT_FIELDS */
  info: ShortcutFieldInfo;
  value: string;
  defaultValue: string;
  /** 与其他快捷键冲突时标红并提示 */
  conflict?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
}

/** 设置页的快捷键录入：点击后按下组合键，Esc 取消；不符合规则时提示原因并继续等待 */
export function HotkeyInput({ info, value, defaultValue, conflict = false, disabled = false, onChange }: HotkeyInputProps) {
  const envPlatform = useEnvStore((state) => state.env?.platform);
  const platform = envPlatform ?? guessPlatform(navigator.userAgent);
  const [capturing, setCapturing] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    if (!capturing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // 捕获期间拦截事件，避免触发窗口内快捷键或页面默认行为；
      // 多个字段同时处于录制态时它们都监听同一个 document 节点，
      // stopImmediatePropagation 让先收到按键的实例拦住其余实例，避免一次按键写入多个字段
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === 'Escape') {
        setCapturing(false);
        setHint(null);
        return;
      }
      const captured = shortcutFromEvent(event, platform);
      if (captured === null) {
        setHint(MODIFIER_ONLY_TEXT);
        return;
      }
      const result = validateShortcut(captured, info.scope);
      if (!result.ok) {
        setHint(result.reason);
        return;
      }
      setCapturing(false);
      setHint(null);
      onChange(captured);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [capturing, info.scope, onChange, platform]);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          aria-label={`${info.label}快捷键`}
          disabled={disabled || capturing}
          // 固定最小宽度：录制态文案比常态长，避免状态切换时按钮宽度突变、同行元素横移
          className={cn('min-w-56', conflict && 'border-destructive text-destructive')}
          onClick={() => {
            setHint(null);
            setCapturing(true);
          }}
        >
          {capturing ? (
            (hint ?? CAPTURING_TEXT)
          ) : (
            <>
              <Kbd>{displayShortcut(value, platform)}</Kbd>
              <span className="text-xs text-muted-foreground">点击修改</span>
            </>
          )}
        </Button>
        {!capturing && value !== defaultValue && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={`恢复默认${info.label}`}
            disabled={disabled}
            onClick={() => onChange(defaultValue)}
          >
            <RotateCcw />
          </Button>
        )}
      </div>
      {conflict && <p className="text-sm text-destructive">{CONFLICT_TEXT}</p>}
    </div>
  );
}
