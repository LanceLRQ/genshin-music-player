import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pickJsonFile, writeJsonFile } from './profileFiles';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ readTextFile: vi.fn(), writeTextFile: vi.fn() }));

beforeEach(() => {
  vi.mocked(open).mockReset();
  vi.mocked(save).mockReset();
  vi.mocked(readTextFile).mockReset();
  vi.mocked(writeTextFile).mockReset();
});

afterEach(() => {
  clearMocks();
  document.querySelectorAll('input[type="file"]').forEach((input) => input.remove());
});

describe('profileFiles（Tauri 环境）', () => {
  beforeEach(() => {
    mockIPC(() => null);
  });

  it('用文件对话框选择并读取 JSON', async () => {
    vi.mocked(open).mockResolvedValue('/data/instruments/新琴.json');
    vi.mocked(readTextFile).mockResolvedValue('{"id":"new-lyre"}');
    await expect(pickJsonFile()).resolves.toEqual({ fileName: '新琴.json', text: '{"id":"new-lyre"}' });
  });

  it('取消选择时返回 null', async () => {
    vi.mocked(open).mockResolvedValue(null);
    await expect(pickJsonFile()).resolves.toBeNull();
    expect(readTextFile).not.toHaveBeenCalled();
  });

  it('用保存对话框写出 JSON，取消时返回 false', async () => {
    vi.mocked(save).mockResolvedValue('/data/instruments/我的琴.json');
    vi.mocked(writeTextFile).mockResolvedValue(undefined);
    await expect(writeJsonFile('我的琴.json', '{}')).resolves.toBe(true);
    expect(writeTextFile).toHaveBeenCalledWith('/data/instruments/我的琴.json', '{}');
    vi.mocked(save).mockResolvedValue(null);
    await expect(writeJsonFile('我的琴.json', '{}')).resolves.toBe(false);
  });
});

describe('profileFiles（浏览器回退）', () => {
  it('回退为 input[type=file] 选择文件', async () => {
    const user = userEvent.setup();
    const pending = pickJsonFile();
    const input = (await waitFor(() => {
      const element = document.querySelector<HTMLInputElement>('input[type="file"]');
      if (!element) throw new Error('file input not ready');
      return element;
    })) as HTMLInputElement;
    await user.upload(input, new File(['{"id":"x"}'], 'x.json', { type: 'application/json' }));
    await expect(pending).resolves.toEqual({ fileName: 'x.json', text: '{"id":"x"}' });
    expect(open).not.toHaveBeenCalled();
  });

  it('回退为下载链接写出 JSON', async () => {
    let downloadName: string | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloadName = this.download;
    });
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
    await expect(writeJsonFile('my-lyre.json', '{}')).resolves.toBe(true);
    expect(downloadName).toBe('my-lyre.json');
  });
});
