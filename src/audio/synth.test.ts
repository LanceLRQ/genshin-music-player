import { describe, expect, it } from 'vitest';
import { BUILTIN_INSTRUMENTS } from '@/core/instruments/registry';
import { buildSoundMap, midiToFrequency } from './synth';

const builtin = (id: string) => BUILTIN_INSTRUMENTS.find((profile) => profile.id === id)!;

describe('midiToFrequency', () => {
  it('A4 = 440Hz，每升高一个八度频率加倍', () => {
    expect(midiToFrequency(69)).toBe(440);
    expect(midiToFrequency(81)).toBe(880);
    expect(midiToFrequency(60)).toBeCloseTo(261.626, 3);
  });
});

describe('buildSoundMap', () => {
  it('音高类乐器每个键都是对应频率的拨弦', () => {
    const sounds = buildSoundMap(builtin('windsong-lyre'));
    expect(sounds.size).toBe(21);
    expect(sounds.get('KeyH')).toEqual({ kind: 'pluck', frequency: 440 });
  });

  it('敲击类乐器：don 为"咚"，其他音色统一为"咔"', () => {
    const drum = builtin('festive-drum');
    const withExtraVoice = { ...drum, rows: [{ label: '鼓', keys: [...drum.rows[0].keys, { code: 'KeyK', voice: 'rim' }] }] };
    expect([...buildSoundMap(withExtraVoice)]).toEqual([
      ['KeyF', { kind: 'don' }],
      ['KeyJ', { kind: 'ka' }],
      ['KeyK', { kind: 'ka' }],
    ]);
  });
});
