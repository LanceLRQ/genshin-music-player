const MINUS_SIGN = '−';

/** 毫秒 → m:ss.s，四舍五入到 0.1 秒；负数和非有限值按 0 处理 */
export function formatTime(ms: number): string {
  const tenths = Number.isFinite(ms) && ms > 0 ? Math.round(ms / 100) : 0;
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor((tenths % 600) / 10);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths % 10}`;
}

/** 0..1 的比例 → 百分比，保留一位小数，末尾的 .0 省略 */
export function formatPercent(ratio: number): string {
  return `${trimTrailingZero((ratio * 100).toFixed(1))}%`;
}

/** 毫秒数值 → "3.2ms"，保留一位小数，末尾的 .0 省略 */
export function formatMs(ms: number): string {
  return `${trimTrailingZero(ms.toFixed(1))}ms`;
}

/** 移调、八度这类带符号的整数："+2"、"−3"（U+2212 减号）、"0" */
export function formatSigned(value: number): string {
  if (value > 0) return `+${value}`;
  if (value < 0) return `${MINUS_SIGN}${Math.abs(value)}`;
  return '0';
}

/** 速度倍率 → "1.00×" */
export function formatSpeed(speed: number): string {
  return `${speed.toFixed(2)}×`;
}

function trimTrailingZero(text: string): string {
  const trimmed = text.endsWith('.0') ? text.slice(0, -2) : text;
  return trimmed === '-0' ? '0' : trimmed;
}
