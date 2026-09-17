import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DISCLAIMER_STORAGE_KEY, useDisclaimerStore } from '@/stores/disclaimerStore';
import { DisclaimerDialog } from './disclaimer-dialog';

function setup(storedVersion?: string) {
  if (storedVersion !== undefined) localStorage.setItem(DISCLAIMER_STORAGE_KEY, storedVersion);
  useDisclaimerStore.getState().init();
  return { user: userEvent.setup(), ...render(<DisclaimerDialog />) };
}

beforeEach(() => {
  localStorage.clear();
});

describe('DisclaimerDialog', () => {
  it('首次启动弹出风险提示，勾选前"开始使用"不可点击', () => {
    setup();
    expect(screen.getByRole('alertdialog', { name: '使用前请阅读' })).toBeInTheDocument();
    expect(screen.getByText('本软件只模拟键盘输入，不读写游戏内存，不修改游戏文件；')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始使用' })).toBeDisabled();
  });

  it('勾选并点击"开始使用"后关闭，并记录确认的版本号', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('checkbox', { name: '我已了解上述风险' }));
    await user.click(screen.getByRole('button', { name: '开始使用' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(localStorage.getItem(DISCLAIMER_STORAGE_KEY)).toBe('1');
    expect(useDisclaimerStore.getState()).toMatchObject({ accepted: true, open: false });
  });

  it('已确认过当前版本时不弹出', () => {
    setup('1');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('确认的是旧版本时重新弹出', () => {
    setup('0');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('未确认时按 Esc 不能关闭', async () => {
    const { user } = setup();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(useDisclaimerStore.getState().open).toBe(true);
  });

  it('确认后在设置页重新查看时，可以直接关闭', async () => {
    const { user } = setup('1');
    act(() => useDisclaimerStore.getState().review());
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });
});
