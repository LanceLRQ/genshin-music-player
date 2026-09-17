import type { InstrumentProfile } from '@/core/model/instrument';

/** 一个键发出的声音：音高类为拨弦，敲击类"咚"为低频正弦，其余音色统一用"咔"的短噪声 */
export type SoundSpec = { kind: 'pluck'; frequency: number } | { kind: 'don' } | { kind: 'ka' };

export function midiToFrequency(pitch: number): number {
  return 440 * 2 ** ((pitch - 69) / 12);
}

/** 键码 → 声音 */
export function buildSoundMap(profile: InstrumentProfile): Map<string, SoundSpec> {
  const sounds = new Map<string, SoundSpec>();
  for (const row of profile.rows) {
    for (const key of row.keys) {
      if (key.pitch !== undefined) sounds.set(key.code, { kind: 'pluck', frequency: midiToFrequency(key.pitch) });
      else sounds.set(key.code, key.voice === 'don' ? { kind: 'don' } : { kind: 'ka' });
    }
  }
  return sounds;
}

/** 已经排程的一个发声 */
export interface SynthVoice {
  /** 从 atSec（AudioContext 时间）开始释放；只对持续发声的拨弦有效，其他声音会自然衰减 */
  release: (atSec: number) => void;
  /** 立即停止并断开 */
  stop: () => void;
}

export interface PlayOptions {
  /** 持续发声：按下后保持音量，直到 release */
  sustain: boolean;
  /** 声音播放完毕（或被 stop）后调用 */
  onEnded?: () => void;
}

const PEAK_GAIN = 0.35;
const SILENT_GAIN = 0.0001;
const PLUCK_ATTACK_SEC = 0.005;
const PLUCK_DECAY_SEC = 1.2;
const SUSTAIN_GAIN = 0.25;
const SUSTAIN_RELEASE_SEC = 0.3;
const DON_SWEEP_SEC = 0.15;
const KA_DURATION_SEC = 0.06;

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

function noiseBuffer(context: BaseAudioContext): AudioBuffer {
  let buffer = noiseBuffers.get(context);
  if (!buffer) {
    buffer = context.createBuffer(1, Math.ceil(context.sampleRate * KA_DURATION_SEC), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
    noiseBuffers.set(context, buffer);
  }
  return buffer;
}

/** 在 atSec 排程一个声音，连接到 destination */
export function playSound(
  context: BaseAudioContext,
  destination: AudioNode,
  spec: SoundSpec,
  atSec: number,
  options: PlayOptions,
): SynthVoice {
  const output = context.createGain();
  output.connect(destination);
  const sources: AudioScheduledSourceNode[] = [];
  let released = false;

  if (spec.kind === 'pluck') {
    // 三角波 + 音量 30% 的二倍频正弦波，起音 5ms
    const fundamental = context.createOscillator();
    fundamental.type = 'triangle';
    fundamental.frequency.setValueAtTime(spec.frequency, atSec);
    const overtone = context.createOscillator();
    overtone.type = 'sine';
    overtone.frequency.setValueAtTime(spec.frequency * 2, atSec);
    const overtoneGain = context.createGain();
    overtoneGain.gain.value = 0.3;
    fundamental.connect(output);
    overtone.connect(overtoneGain).connect(output);
    sources.push(fundamental, overtone);

    output.gain.setValueAtTime(SILENT_GAIN, atSec);
    if (options.sustain) {
      output.gain.exponentialRampToValueAtTime(SUSTAIN_GAIN, atSec + PLUCK_ATTACK_SEC);
    } else {
      output.gain.exponentialRampToValueAtTime(PEAK_GAIN, atSec + PLUCK_ATTACK_SEC);
      output.gain.exponentialRampToValueAtTime(SILENT_GAIN, atSec + PLUCK_ATTACK_SEC + PLUCK_DECAY_SEC);
      for (const source of sources) source.stop(atSec + PLUCK_ATTACK_SEC + PLUCK_DECAY_SEC);
    }
  } else if (spec.kind === 'don') {
    // 正弦波，150ms 内从 90Hz 降到 50Hz，同时音量衰减
    const oscillator = context.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(90, atSec);
    oscillator.frequency.exponentialRampToValueAtTime(50, atSec + DON_SWEEP_SEC);
    oscillator.connect(output);
    sources.push(oscillator);
    output.gain.setValueAtTime(PEAK_GAIN * 2, atSec);
    output.gain.exponentialRampToValueAtTime(SILENT_GAIN, atSec + DON_SWEEP_SEC);
    oscillator.stop(atSec + DON_SWEEP_SEC);
  } else {
    // 白噪声经中心 2kHz 的带通滤波，持续 60ms
    const noise = context.createBufferSource();
    noise.buffer = noiseBuffer(context);
    const bandpass = context.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 2000;
    noise.connect(bandpass).connect(output);
    sources.push(noise);
    output.gain.setValueAtTime(PEAK_GAIN * 2, atSec);
    output.gain.exponentialRampToValueAtTime(SILENT_GAIN, atSec + KA_DURATION_SEC);
    noise.stop(atSec + KA_DURATION_SEC);
  }

  for (const source of sources) source.start(atSec);
  sources[0].onended = () => {
    output.disconnect();
    options.onEnded?.();
  };

  return {
    release: (releaseSec) => {
      if (spec.kind !== 'pluck' || !options.sustain || released) return;
      released = true;
      const from = Math.max(releaseSec, atSec + PLUCK_ATTACK_SEC);
      output.gain.cancelScheduledValues(from);
      output.gain.setValueAtTime(SUSTAIN_GAIN, from);
      output.gain.exponentialRampToValueAtTime(SILENT_GAIN, from + SUSTAIN_RELEASE_SEC);
      for (const source of sources) source.stop(from + SUSTAIN_RELEASE_SEC);
    },
    stop: () => {
      released = true;
      for (const source of sources) {
        try {
          source.stop();
        } catch {
          // 已经停止的节点再次 stop 会抛错，忽略即可
        }
      }
      output.disconnect();
    },
  };
}
