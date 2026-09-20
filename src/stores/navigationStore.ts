import { create } from 'zustand';

export type PageId = 'play' | 'instruments' | 'settings' | 'help';

/** 离开当前页面前的确认；返回 false 表示取消跳转 */
export type LeaveGuard = () => boolean | Promise<boolean>;

export interface NavigationState {
  page: PageId;
  leaveGuard: LeaveGuard | null;
  /** 切换页面；有离开确认时先询问，返回是否真的切换了 */
  navigate: (page: PageId) => Promise<boolean>;
  /**
   * 页面在有未保存修改时注册离开确认（例如乐器编辑器），修改保存或丢弃后传 null 取消。
   * 切换页面成功后会自动清除。
   */
  setLeaveGuard: (guard: LeaveGuard | null) => void;
}

export const useNavigationStore = create<NavigationState>()((set, get) => ({
  page: 'play',
  leaveGuard: null,
  navigate: async (page) => {
    const { page: current, leaveGuard } = get();
    if (page === current) return true;
    if (leaveGuard && !(await leaveGuard())) return false;
    set({ page, leaveGuard: null });
    return true;
  },
  setLeaveGuard: (leaveGuard) => set({ leaveGuard }),
}));
