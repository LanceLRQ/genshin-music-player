import banquetDrum from '../../../shared/instruments/banquet-drum.json';
import eveningHorn from '../../../shared/instruments/evening-horn.json';
import festiveDrum from '../../../shared/instruments/festive-drum.json';
import floralZither from '../../../shared/instruments/floral-zither.json';
import harmonyClavier from '../../../shared/instruments/harmony-clavier.json';
import jujuDrum from '../../../shared/instruments/juju-drum.json';
import lingeringEcho from '../../../shared/instruments/lingering-echo.json';
import sprightlyLyre from '../../../shared/instruments/sprightly-lyre.json';
import twoRowPrototype from '../../../shared/instruments/two-row-prototype.json';
import vintageLyre from '../../../shared/instruments/vintage-lyre.json';
import windsongLyre from '../../../shared/instruments/windsong-lyre.json';
import yucoLyre from '../../../shared/instruments/yuco-lyre.json';
import { InstrumentProfileSchema, type InstrumentProfile } from '../model/instrument';
import type { AdaptOptions } from '../model/timeline';

/** 模块加载时即做 schema 校验：内置配置写错会直接抛错，由测试兜底 */
export const BUILTIN_INSTRUMENTS: readonly InstrumentProfile[] = [
  windsongLyre,
  floralZither,
  vintageLyre,
  twoRowPrototype,
  festiveDrum,
  yucoLyre,
  harmonyClavier,
  sprightlyLyre,
  lingeringEcho,
  eveningHorn,
  jujuDrum,
  banquetDrum,
].map((raw) => InstrumentProfileSchema.parse(raw));

export interface InstrumentEntry {
  profile: InstrumentProfile;
  builtin: boolean;
}

export function isBuiltinInstrumentId(id: string): boolean {
  return BUILTIN_INSTRUMENTS.some((profile) => profile.id === id);
}

/** 内置乐器在前，自定义乐器按传入顺序追加；id 冲突的自定义乐器被跳过并给出警告 */
export function mergeInstruments(custom: readonly InstrumentProfile[]): {
  entries: InstrumentEntry[];
  warnings: string[];
} {
  const entries: InstrumentEntry[] = BUILTIN_INSTRUMENTS.map((profile) => ({ profile, builtin: true }));
  const warnings: string[] = [];
  const seen = new Set(entries.map((entry) => entry.profile.id));
  for (const profile of custom) {
    if (seen.has(profile.id)) {
      warnings.push(
        isBuiltinInstrumentId(profile.id)
          ? `自定义乐器「${profile.name}」的 id「${profile.id}」与内置乐器重复，已跳过`
          : `自定义乐器 id「${profile.id}」重复，已跳过「${profile.name}」`,
      );
      continue;
    }
    seen.add(profile.id);
    entries.push({ profile, builtin: false });
  }
  return { entries, warnings };
}

export function findInstrument(entries: readonly InstrumentEntry[], id: string): InstrumentProfile | undefined {
  return entries.find((entry) => entry.profile.id === id)?.profile;
}

/** 是否支持「按 MIDI 音长按键」与「按住时长」调整：自定义乐器，或分类为圆号 / 人声的内置乐器 */
export function supportsHoldControl(entry: { profile: InstrumentProfile; builtin: boolean }): boolean {
  return !entry.builtin || entry.profile.category === 'horn' || entry.profile.category === 'vocal';
}

/** 剥离当前乐器不支持的按住控制参数，避免不合规的乐器意外应用 useNoteDuration / holdMsOverride */
export function stripHoldControlOptions(
  options: AdaptOptions,
  entry: { profile: InstrumentProfile; builtin: boolean },
): AdaptOptions {
  if (supportsHoldControl(entry)) return options;
  if (options.useNoteDuration === undefined && options.holdMsOverride === undefined) return options;
  const rest = { ...options };
  delete rest.useNoteDuration;
  delete rest.holdMsOverride;
  return rest;
}
