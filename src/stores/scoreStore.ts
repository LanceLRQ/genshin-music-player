import { create } from 'zustand';
import type { Score } from '@/core/model/score';

export interface ScoreState {
  score: Score | null;
  /** 导入来源的展示名（文件名；文本导入为「标题（文本导入）」） */
  fileName: string | null;
  /** 键盘谱的来源乐器 id；其他来源为 null */
  sourceInstrumentId: string | null;
  setScore: (score: Score, info?: { fileName?: string; sourceInstrumentId?: string }) => void;
  /** 手动纠正轨道类型：MIDI 按通道 10 识别鼓轨，写在普通通道的鼓谱靠启发式猜测，
   *  猜错时在这里切换，适配立即按新类型重算 */
  setTrackDrum: (trackId: string, isDrum: boolean) => void;
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
  setTrackDrum: (trackId, isDrum) =>
    set((state) => {
      if (!state.score) return state;
      const tracks = state.score.tracks.map((track) => (track.id === trackId ? { ...track, isDrum } : track));
      return { score: { ...state.score, tracks } };
    }),
  clear: () => set({ score: null, fileName: null, sourceInstrumentId: null }),
}));
