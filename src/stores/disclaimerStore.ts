import { create } from 'zustand';

/** 风险提示内容有实质变化时提高版本号，让用户重新确认 */
export const DISCLAIMER_VERSION = 1;
export const DISCLAIMER_STORAGE_KEY = 'disclaimerAcceptedVersion';

function readAccepted(): boolean {
  try {
    return localStorage.getItem(DISCLAIMER_STORAGE_KEY) === String(DISCLAIMER_VERSION);
  } catch {
    return false;
  }
}

export interface DisclaimerState {
  /** 已确认当前版本的风险提示 */
  accepted: boolean;
  open: boolean;
  /** 重新读取本地记录；未确认时打开对话框 */
  init: () => void;
  accept: () => void;
  /** 设置页"查看风险提示"：重新打开对话框 */
  review: () => void;
  /** 只有已确认时才能关闭 */
  close: () => void;
}

const initialState = () => {
  const accepted = readAccepted();
  return { accepted, open: !accepted };
};

export const useDisclaimerStore = create<DisclaimerState>()((set, get) => ({
  ...initialState(),
  init: () => set(initialState()),
  accept: () => {
    try {
      localStorage.setItem(DISCLAIMER_STORAGE_KEY, String(DISCLAIMER_VERSION));
    } catch {
      // 本地存储不可用时只在本次运行中记住，下次启动会再次提示
    }
    set({ accepted: true, open: false });
  },
  review: () => set({ open: true }),
  close: () => {
    if (get().accepted) set({ open: false });
  },
}));
