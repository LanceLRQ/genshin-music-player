import type { InstrumentProfile } from '@/core/model/instrument';
import type { ExecutionTimeline } from '@/ipc/types';
import { type LookaheadCursor, heldCodesAtEnd, planLookahead, previewPositionMs } from './schedule';
import { type SoundSpec, type SynthVoice, buildSoundMap, playSound } from './synth';

/** 每 25ms 检查一次，把未来 100ms 内的事件排程 */
const TICK_MS = 25;
const LOOKAHEAD_MS = 100;
/** 开始时留一点余量，保证第一个事件能按时排程 */
const START_DELAY_MS = 50;
/** 位置回调节流到约 30fps */
const POSITION_INTERVAL_MS = 1000 / 30;

export interface PreviewCallbacks {
  /** 当前执行时间（毫秒），约 30fps */
  onPosition?: (positionMs: number) => void;
  /** 不循环时播放到结尾后调用；调用 stop() 主动停止时不会调用 */
  onEnded?: () => void;
}

interface Session {
  execution: ExecutionTimeline;
  sounds: Map<string, SoundSpec>;
  sustain: boolean;
  cursor: LookaheadCursor;
  callbacks: PreviewCallbacks;
  timer: ReturnType<typeof setInterval>;
  frame: number;
  lastPositionAt: number;
  voices: Set<SynthVoice>;
  /** sustain 乐器中正在发声、等待 up 事件释放的键 */
  held: Map<string, SynthVoice>;
}

/**
 * 用 Web Audio 播放 ExecutionTimeline（试听）。AudioContext 在第一次 start / playKey 时创建，之后复用，
 * 这两个方法都应该在用户操作（点击）中调用，否则浏览器可能不允许发声。
 */
export class PreviewPlayer {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private volume = 0.7;
  private session: Session | null = null;

  get playing(): boolean {
    return this.session !== null;
  }

  /** 0..1，只影响试听 */
  setVolume(volume: number): void {
    this.volume = Math.min(Math.max(volume, 0), 1);
    if (this.context && this.master) this.master.gain.setValueAtTime(this.volume, this.context.currentTime);
  }

  /** 点击键帽试听单个键 */
  playKey(profile: InstrumentProfile, code: string): void {
    const spec = buildSoundMap(profile).get(code);
    if (!spec) return;
    const { context, master } = this.ensureContext();
    playSound(context, master, spec, context.currentTime, { sustain: false });
  }

  /** 从头开始试听；已经在试听时先停止 */
  start(execution: ExecutionTimeline, profile: InstrumentProfile, callbacks: PreviewCallbacks = {}): void {
    this.stop();
    const { context } = this.ensureContext();
    const session: Session = {
      execution,
      sounds: buildSoundMap(profile),
      sustain: profile.timing.sustain,
      cursor: { cycleStartMs: context.currentTime * 1000 + START_DELAY_MS, scheduledUntilMs: 0 },
      callbacks,
      timer: setInterval(() => this.tick(), TICK_MS),
      frame: 0,
      lastPositionAt: Number.NEGATIVE_INFINITY,
      voices: new Set(),
      held: new Map(),
    };
    this.session = session;
    session.frame = requestAnimationFrame((time) => this.reportPosition(time));
    this.tick();
  }

  /** 停止试听，并立即停止所有已经排程的声音 */
  stop(): void {
    const session = this.session;
    if (!session) return;
    this.endSession(session);
    for (const voice of session.voices) voice.stop();
    session.voices.clear();
    session.held.clear();
  }

  /** 关闭 AudioContext，释放音频设备 */
  async dispose(): Promise<void> {
    this.stop();
    const context = this.context;
    this.context = null;
    this.master = null;
    if (context) await context.close();
  }

  private ensureContext(): { context: AudioContext; master: GainNode } {
    if (!this.context || !this.master) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') void this.context.resume();
    return { context: this.context, master: this.master };
  }

  private tick(): void {
    const session = this.session;
    const { context, master } = this;
    if (!session || !context || !master) return;
    const nowMs = context.currentTime * 1000;
    const plan = planLookahead(session.execution, session.cursor, nowMs, LOOKAHEAD_MS);
    session.cursor = plan.cursor;

    for (const { atMs, event } of plan.events) {
      const atSec = Math.max(atMs, nowMs) / 1000;
      for (const code of event.up) {
        session.held.get(code)?.release(atSec);
        session.held.delete(code);
      }
      for (const code of event.down) {
        const spec = session.sounds.get(code);
        if (!spec) continue;
        const sustain = session.sustain && spec.kind === 'pluck';
        const voice = playSound(context, master, spec, atSec, {
          sustain,
          onEnded: () => session.voices.delete(voice),
        });
        session.voices.add(voice);
        if (sustain) session.held.set(code, voice);
      }
    }

    if (plan.ended) {
      // 畸形时间线可能缺少 up 事件，自然结束时释放所有仍在持续的音
      const releaseAtSec = Math.max(nowMs, session.execution.durationMs) / 1000;
      for (const code of heldCodesAtEnd(session.execution)) {
        session.held.get(code)?.release(releaseAtSec);
        session.held.delete(code);
      }
      this.endSession(session);
      session.callbacks.onPosition?.(session.execution.durationMs);
      session.callbacks.onEnded?.();
    }
  }

  private reportPosition(time: number): void {
    const session = this.session;
    const context = this.context;
    if (!session || !context) return;
    if (time - session.lastPositionAt >= POSITION_INTERVAL_MS) {
      session.lastPositionAt = time;
      session.callbacks.onPosition?.(previewPositionMs(session.execution, session.cursor, context.currentTime * 1000));
    }
    session.frame = requestAnimationFrame((next) => this.reportPosition(next));
  }

  private endSession(session: Session): void {
    clearInterval(session.timer);
    cancelAnimationFrame(session.frame);
    if (this.session === session) this.session = null;
  }
}

/** 全应用共用一个试听播放器 */
export const previewPlayer = new PreviewPlayer();
