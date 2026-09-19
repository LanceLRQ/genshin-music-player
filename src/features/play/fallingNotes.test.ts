import { describe, expect, it } from 'vitest';
import { BUILTIN_INSTRUMENTS } from '@/core/instruments/registry';
import type { ExecutionTimeline } from '@/ipc/types';
import { executionToNotes, orderedPreviewKeys, syntheticPitch } from './fallingNotes';

const lyre = BUILTIN_INSTRUMENTS.find((profile) => profile.id === 'windsong-lyre')!;
const drum = BUILTIN_INSTRUMENTS.find((profile) => profile.id === 'festive-drum')!;

function timeline(events: ExecutionTimeline['events'], durationMs = 1000): ExecutionTimeline {
  return { instrumentId: 'test', events, durationMs, sourceStartMs: 0, speed: 1, loop: false, dropped: 0 };
}

describe('orderedPreviewKeys', () => {
  it('音高类乐器按音高升序排列（低音在左）', () => {
    const keys = orderedPreviewKeys(lyre);
    expect(keys.map((key) => key.code).slice(0, 8)).toEqual(['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'KeyA']);
    expect(keys.map((key) => key.pitch)).toEqual([...keys.map((key) => key.pitch)].sort((a, b) => a! - b!));
  });

  it('敲击类乐器按配置行序排列', () => {
    expect(orderedPreviewKeys(drum).map((key) => key.code)).toEqual(['KeyF', 'KeyJ']);
  });
});

describe('syntheticPitch', () => {
  it('从 C4 起依次落在白键上，跨八度继续', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map(syntheticPitch)).toEqual([60, 62, 64, 65, 67, 69, 71, 72, 74]);
  });
});

describe('executionToNotes', () => {
  const columnOf = new Map([
    ['KeyA', 0],
    ['KeyS', 1],
  ]);

  it('down 开音、配对的 up 关音，时间换算成秒', () => {
    const notes = executionToNotes(timeline([{ tMs: 100, up: [], down: ['KeyA'] }, { tMs: 450, up: ['KeyA'], down: [] }]), columnOf);
    expect(notes).toEqual([{ pitch: 60, startTime: 0.1, duration: 0.35 }]);
  });

  it('和弦：同一时刻多个 down，分别配对 up', () => {
    const notes = executionToNotes(
      timeline([{ tMs: 0, up: [], down: ['KeyA', 'KeyS'] }, { tMs: 200, up: ['KeyA'], down: [] }, { tMs: 500, up: ['KeyS'], down: [] }]),
      columnOf,
    );
    expect(notes).toEqual([
      { pitch: 60, startTime: 0, duration: 0.2 },
      { pitch: 62, startTime: 0, duration: 0.5 },
    ]);
  });

  it('没有 up 关闭的音收到时间线结尾', () => {
    const notes = executionToNotes(timeline([{ tMs: 200, up: [], down: ['KeyS'] }], 900), columnOf);
    expect(notes).toEqual([{ pitch: 62, startTime: 0.2, duration: 0.7 }]);
  });

  it('同一时刻先 up 后 down：重按拆成两段，不串音', () => {
    const notes = executionToNotes(
      timeline([
        { tMs: 0, up: [], down: ['KeyA'] },
        { tMs: 100, up: ['KeyA'], down: ['KeyA'] },
        { tMs: 300, up: ['KeyA'], down: [] },
      ]),
      columnOf,
    );
    expect(notes).toEqual([
      { pitch: 60, startTime: 0, duration: 0.1 },
      { pitch: 60, startTime: 0.1, duration: 0.2 },
    ]);
  });

  it('没有列映射的键码被跳过，未关上的 up 不产生音符', () => {
    const notes = executionToNotes(
      timeline([
        { tMs: 0, up: ['KeyQ'], down: ['Unknown'] },
        { tMs: 100, up: ['Unknown'], down: [] },
      ]),
      columnOf,
    );
    expect(notes).toEqual([]);
  });

  it('过短的音保底最小显示时长', () => {
    const notes = executionToNotes(timeline([{ tMs: 0, up: [], down: ['KeyA'] }, { tMs: 5, up: ['KeyA'], down: [] }]), columnOf);
    expect(notes[0]!.duration).toBeGreaterThanOrEqual(0.04);
  });
});
