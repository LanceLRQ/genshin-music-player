import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { isKnownKeyCode, keyLabel } from '@/core/model/keycodes';

const CAPTURING_TEXT = '请按下按键…（Esc 取消）';
const UNSUPPORTED_TEXT = '不支持这个按键';

interface KeyCaptureButtonProps {
  /** 当前键码；未设置时为 null */
  value: string | null;
  /** 捕获到键码表中的按键时回调 */
  onCapture: (code: string) => void;
}

/** 乐器编辑器的按键捕获按钮：点击后按下一个键，Esc 取消；不支持的键提示后继续等待 */
export function KeyCaptureButton({ value, onCapture }: KeyCaptureButtonProps) {
  const [capturing, setCapturing] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  // 父组件尚未根据回调更新 value 之前，先乐观显示刚捕获到的键码
  const [capturedCode, setCapturedCode] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!capturing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // 捕获期间拦截事件，避免触发窗口内快捷键或页面默认行为；
      // 多个按钮同时处于捕获态时，它们都监听同一个 document 节点，
      // stopImmediatePropagation 让先收到按键的实例拦住其余实例，避免一次按键写入多个键
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === 'Escape') {
        setCapturing(false);
        setHint(null);
        return;
      }
      if (!isKnownKeyCode(event.code)) {
        setHint(UNSUPPORTED_TEXT);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setHint(null), 1200);
        return;
      }
      setCapturing(false);
      setHint(null);
      setCapturedCode(event.code);
      onCapture(event.code);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [capturing, onCapture]);

  // 行的上移 / 下移 / 删除会复用同一位置的组件实例：value 变化而乐观键码对不上时，
  // 在 render 期间清除乐观键码，避免显示与数据不一致的旧按键
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    if (!capturing && capturedCode !== null && capturedCode !== value) {
      setCapturedCode(null);
    }
  }

  const displayCode = capturedCode ?? value;

  if (capturing) {
    return (
      <Button type="button" variant="outline" className="min-w-28" data-capturing>
        {hint ?? CAPTURING_TEXT}
      </Button>
    );
  }
  return (
    <Button
      type="button"
      variant="outline"
      className="min-w-28"
      onClick={() => {
        setHint(null);
        setCapturedCode(null);
        setCapturing(true);
      }}
    >
      {displayCode ? (
        <Kbd>{keyLabel(displayCode)}</Kbd>
      ) : (
        <span className="text-muted-foreground">未设置</span>
      )}
    </Button>
  );
}
