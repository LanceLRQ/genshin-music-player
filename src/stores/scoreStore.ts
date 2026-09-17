import { create } from 'zustand';
import type { Score } from '@/core/model/score';

export interface ScoreState {
  score: Score | null;
  /** 导入来源的展示名（文件名；文本导入为「标题（文本导入）」） */
  fileName: string | null;
  /** 键盘谱的来源乐器 id；其他来源为 null */
  sourceInstrumentId: string | null;
  setScore: (score: Score, info?: { fileName?: string; sourceInstrumentId?: string }) => void;
  clear: () => void;
}

export const useScoreStore = create<ScoreState>()((set) => ({
  score: null,
  fileName: null,
  sourceInstrumentId: null,
  setScore: (score, info) =>
    set({
      score,
      fileName: info?.fileName ?? null,
      sourceInstrumentId: info?.sourceInstrumentId ?? null,
    }),
  clear: () => set({ score: null, fileName: null, sourceInstrumentId: null }),
}));
