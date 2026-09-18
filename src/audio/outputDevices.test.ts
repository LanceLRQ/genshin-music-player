import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listOutputDevices, sinkSelectionSupported, watchOutputDevices } from './outputDevices';

type Listener = () => void;
const listeners = new Set<Listener>();
let devices: Array<{ kind: string; deviceId: string; label: string }>;

function stubMediaDevices() {
  Object.defineProperty(window.navigator, 'mediaDevices', {
    value: {
      enumerateDevices: async () => devices,
      addEventListener: (_event: string, listener: Listener) => listeners.add(listener),
      removeEventListener: (_event: string, listener: Listener) => listeners.delete(listener),
    },
    configurable: true,
    writable: true,
  });
}

/** 原型上带 setSinkId 方法的 AudioContext 桩；withSink 为 false 时模拟不支持选择设备的 WebView */
function stubAudioContext(withSink: boolean) {
  vi.stubGlobal(
    'AudioContext',
    withSink
      ? class FakeAudioContext {
          async setSinkId(): Promise<void> {}
        }
      : class FakeAudioContext {},
  );
}

beforeEach(() => {
  devices = [];
  listeners.clear();
});

afterEach(() => {
  delete (window.navigator as { mediaDevices?: unknown }).mediaDevices;
  vi.unstubAllGlobals();
});

describe('sinkSelectionSupported', () => {
  it('没有 AudioContext 时（如 jsdom）不支持', () => {
    stubMediaDevices();
    expect(sinkSelectionSupported()).toBe(false);
  });

  it('AudioContext 原型上没有 setSinkId 时（旧版 WKWebView）不支持', () => {
    stubAudioContext(false);
    stubMediaDevices();
    expect(sinkSelectionSupported()).toBe(false);
  });

  it('不能枚举设备时不支持', () => {
    stubAudioContext(true);
    expect(sinkSelectionSupported()).toBe(false);
  });

  it('能力齐全时支持', () => {
    stubAudioContext(true);
    stubMediaDevices();
    expect(sinkSelectionSupported()).toBe(true);
  });
});

describe('listOutputDevices', () => {
  it('只保留输出设备，没有名字的显示为输出设备 N', async () => {
    stubMediaDevices();
    devices = [
      { kind: 'audioinput', deviceId: 'm1', label: '麦克风' },
      { kind: 'audiooutput', deviceId: 'd1', label: '内置扬声器' },
      { kind: 'audiooutput', deviceId: 'd2', label: '' },
    ];
    await expect(listOutputDevices()).resolves.toEqual([
      { id: 'd1', label: '内置扬声器' },
      { id: 'd2', label: '输出设备 2' },
    ]);
  });
});

describe('watchOutputDevices', () => {
  it('订阅 devicechange，取消后不再收到通知', () => {
    stubMediaDevices();
    const calls: number[] = [];
    const stop = watchOutputDevices(() => calls.push(1));
    listeners.forEach((listener) => listener());
    stop();
    listeners.forEach((listener) => listener());
    expect(calls).toHaveLength(1);
    expect(listeners).toHaveLength(0);
  });
});
