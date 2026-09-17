import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/ipc/types';
import { notifyError } from './notify';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('notifyError', () => {
  it('用 toast 显示 AppError 的信息', () => {
    const spy = vi.spyOn(toast, 'error');
    notifyError(new AppError('PLAYER_BUSY', '正在演奏中，请先停止'));
    expect(spy).toHaveBeenCalledWith('正在演奏中，请先停止');
  });

  it('带上操作说明作为前缀，非 Error 的值也能显示', () => {
    const spy = vi.spyOn(toast, 'error');
    notifyError('command not found', '无法开始演奏');
    expect(spy).toHaveBeenCalledWith('无法开始演奏：command not found');
  });
});
