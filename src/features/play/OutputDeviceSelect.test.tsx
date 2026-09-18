import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { previewPlayer } from '@/audio/previewPlayer';
import { OutputDeviceSelect } from './OutputDeviceSelect';

vi.mock('@/audio/previewPlayer', () => ({
  previewPlayer: { setSink: vi.fn(async () => {}), currentSinkId: '' },
}));

type Listener = () => void;
const listeners = new Set<Listener>();
let devices: Array<{ kind: string; deviceId: string; label: string }>;

function stubSupported() {
  vi.stubGlobal(
    'AudioContext',
    class FakeAudioContext {
      async setSinkId(): Promise<void> {}
    },
  );
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

beforeEach(() => {
  devices = [];
  listeners.clear();
  vi.mocked(previewPlayer.setSink).mockClear();
  (previewPlayer as { currentSinkId: string }).currentSinkId = '';
});

afterEach(() => {
  delete (window.navigator as { mediaDevices?: unknown }).mediaDevices;
  vi.unstubAllGlobals();
});

describe('OutputDeviceSelect', () => {
  it('WebView 不支持选择输出设备时整行不渲染', () => {
    const { container } = render(<OutputDeviceSelect />);
    expect(container).toBeEmptyDOMElement();
  });

  it('枚举不到输出设备时整行不渲染', async () => {
    stubSupported();
    devices = [{ kind: 'audioinput', deviceId: 'm1', label: '麦克风' }];
    const { container } = render(<OutputDeviceSelect />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('列出系统默认与输出设备，显示当前选中的设备', async () => {
    stubSupported();
    devices = [
      { kind: 'audiooutput', deviceId: 'd1', label: '内置扬声器' },
      { kind: 'audiooutput', deviceId: 'd2', label: 'USB 耳机' },
    ];
    (previewPlayer as { currentSinkId: string }).currentSinkId = 'd2';
    render(<OutputDeviceSelect />);
    const trigger = await screen.findByRole('combobox');
    expect(trigger).toHaveTextContent('USB 耳机');
  });

  it('记忆的设备已不存在时显示系统默认', async () => {
    stubSupported();
    devices = [{ kind: 'audiooutput', deviceId: 'd1', label: '内置扬声器' }];
    (previewPlayer as { currentSinkId: string }).currentSinkId = 'gone';
    render(<OutputDeviceSelect />);
    expect(await screen.findByRole('combobox')).toHaveTextContent('系统默认');
  });

  it('选择设备后写入播放器，选回系统默认时传空字符串', async () => {
    stubSupported();
    devices = [
      { kind: 'audiooutput', deviceId: 'd1', label: '内置扬声器' },
      { kind: 'audiooutput', deviceId: 'd2', label: 'USB 耳机' },
    ];
    render(<OutputDeviceSelect />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'USB 耳机' }));
    expect(previewPlayer.setSink).toHaveBeenCalledWith('d2');
    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: '系统默认' }));
    expect(previewPlayer.setSink).toHaveBeenCalledWith('');
  });

  it('设备插拔后刷新列表', async () => {
    stubSupported();
    devices = [{ kind: 'audiooutput', deviceId: 'd1', label: '内置扬声器' }];
    render(<OutputDeviceSelect />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('combobox'));
    expect(screen.getByRole('option', { name: '内置扬声器' })).toBeInTheDocument();

    devices.push({ kind: 'audiooutput', deviceId: 'd2', label: 'USB 耳机' });
    await act(async () => {
      listeners.forEach((listener) => listener());
    });
    await waitFor(() => expect(screen.getByRole('option', { name: 'USB 耳机' })).toBeInTheDocument());
  });
});
