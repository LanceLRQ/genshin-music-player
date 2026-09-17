import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNavigationStore } from './navigationStore';

beforeEach(() => {
  useNavigationStore.setState(useNavigationStore.getInitialState(), true);
});

describe('navigationStore', () => {
  it('默认在演奏页，navigate 切换页面', async () => {
    expect(useNavigationStore.getState().page).toBe('play');
    await expect(useNavigationStore.getState().navigate('settings')).resolves.toBe(true);
    expect(useNavigationStore.getState().page).toBe('settings');
  });

  it('离开确认返回 false 时不切换，切换到当前页面时不询问', async () => {
    const guard = vi.fn(() => false);
    useNavigationStore.getState().setLeaveGuard(guard);
    await expect(useNavigationStore.getState().navigate('play')).resolves.toBe(true);
    expect(guard).not.toHaveBeenCalled();
    await expect(useNavigationStore.getState().navigate('instruments')).resolves.toBe(false);
    expect(useNavigationStore.getState()).toMatchObject({ page: 'play', leaveGuard: guard });
  });

  it('异步的离开确认通过后切换页面，并清除确认函数', async () => {
    useNavigationStore.getState().setLeaveGuard(() => Promise.resolve(true));
    await expect(useNavigationStore.getState().navigate('instruments')).resolves.toBe(true);
    expect(useNavigationStore.getState()).toMatchObject({ page: 'instruments', leaveGuard: null });
  });
});
