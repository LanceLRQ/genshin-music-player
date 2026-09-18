/** 系统音频输出设备的枚举与能力检测；选择器只在 WebView 支持 setSinkId 且能枚举到设备时出现 */
export interface OutputDevice {
  id: string;
  label: string;
}

/** 当前 WebView 的 AudioContext 是否支持选择输出设备（Chromium 系支持；旧版 WKWebView 不支持） */
export function sinkSelectionSupported(): boolean {
  if (typeof AudioContext === 'undefined' || typeof navigator === 'undefined') return false;
  const prototype = AudioContext.prototype as unknown as { setSinkId?: unknown };
  return typeof prototype.setSinkId === 'function' && typeof navigator.mediaDevices?.enumerateDevices === 'function';
}

/** 枚举系统输出设备；没有名字的设备显示"输出设备 N" */
export async function listOutputDevices(): Promise<OutputDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === 'audiooutput')
    .map((device, index) => ({ id: device.deviceId, label: device.label || `输出设备 ${index + 1}` }));
}

/** 订阅系统设备插拔；返回取消订阅函数 */
export function watchOutputDevices(onChange: () => void): () => void {
  navigator.mediaDevices?.addEventListener('devicechange', onChange);
  return () => navigator.mediaDevices?.removeEventListener('devicechange', onChange);
}
