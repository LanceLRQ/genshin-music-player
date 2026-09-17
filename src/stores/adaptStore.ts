import { create } from 'zustand';
import { recommendOptions } from '@/core/adapter/recommend';
import type { InstrumentProfile } from '@/core/model/instrument';
import type { Score } from '@/core/model/score';
import type { AdaptOptions } from '@/core/model/timeline';
import { DEFAULT_INSTRUMENT_ID } from './instrumentStore';

export { DEFAULT_INSTRUMENT_ID };

export interface AdaptState {
  /** 目标乐器 id */
  targetId: string;
  /** 适配参数；还没有乐谱时为 null */
  options: AdaptOptions | null;
  /** 导入乐谱或恢复自动推荐之后是否又被手动修改过 */
  manual: boolean;
  setTarget: (targetId: string) => void;
  /** 手动修改参数（含音轨勾选），一律标记 manual */
  setOptions: (options: AdaptOptions) => void;
  /** 按自动推荐重置（导入乐谱、切换目标乐器、恢复自动推荐）；来源是键盘谱且与目标乐器相同时不移调 */
  resetToRecommended: (score: Score, profile: InstrumentProfile, sourceInstrumentId?: string) => void;
}

export const useAdaptStore = create<AdaptState>()((set) => ({
  targetId: DEFAULT_INSTRUMENT_ID,
  options: null,
  manual: false,
  setTarget: (targetId) => set({ targetId }),
  setOptions: (options) => set({ options, manual: true }),
  resetToRecommended: (score, profile, sourceInstrumentId) =>
    set({ options: recommendOptions(score, profile, sourceInstrumentId), manual: false }),
}));
