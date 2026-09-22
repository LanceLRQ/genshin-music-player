import { useMemo } from 'react';
import { adapt, hitRate } from '@/core/adapter/adapt';
import { stripHoldControlOptions } from '@/core/instruments/registry';
import type { AdaptReport, KeyTimeline } from '@/core/model/timeline';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useAdaptStore } from '@/stores/adaptStore';
import { useInstrumentStore } from '@/stores/instrumentStore';
import { useScoreStore } from '@/stores/scoreStore';
import { useSettingsStore } from '@/stores/settingsStore';

export interface Adaptation {
  /** 合并适配出的乐谱时间线；还没有乐谱、参数或乐器时为 null */
  timeline: KeyTimeline | null;
  report: AdaptReport | null;
  /** 每条音轨单独适配的命中率；没有可处理的音时为 null */
  rates: Record<string, number | null>;
}

/** 订阅乐谱与适配参数，防抖 100ms 后计算适配结果和逐轨命中率（设计 01 第 9 节） */
export function useAdaptation(): Adaptation {
  const score = useScoreStore((state) => state.score);
  const targetId = useAdaptStore((state) => state.targetId);
  const options = useAdaptStore((state) => state.options);
  const useChordKeys = useSettingsStore((state) => state.settings?.useChordKeys ?? true);
  const entry = useInstrumentStore((state) => state.entries.find((entry) => entry.profile.id === targetId));
  const debouncedScore = useDebouncedValue(score, 100);
  const debouncedOptions = useDebouncedValue(options, 100);

  return useMemo(() => {
    if (!debouncedScore || !debouncedOptions || !entry) return { timeline: null, report: null, rates: {} };
    const profile = entry.profile;
    const withChordSwitch = { ...stripHoldControlOptions(debouncedOptions, entry), useChordKeys };
    const { timeline, report } = adapt(debouncedScore, profile, withChordSwitch);
    const rates: Record<string, number | null> = {};
    for (const track of debouncedScore.tracks) {
      const single = adapt(debouncedScore, profile, { ...withChordSwitch, tracks: [track.id] });
      rates[track.id] = single.report.total > 0 ? hitRate(single.report) : null;
    }
    return { timeline, report, rates };
  }, [debouncedScore, debouncedOptions, entry, useChordKeys]);
}
