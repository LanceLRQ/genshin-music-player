import { describe, expect, it } from 'vitest';
import { midiToNoteName, noteNameToMidi, pitchOffsetFromName } from './pitch';

describe('pitchOffsetFromName', () => {
  it.each([
    ['C', 0],
    ['c', 0],
    ['F#', 6],
    ['#F', 6],
    ['Bb', 10],
    ['bB', 10],
    ['bb', 10],
    ['b', 11],
    ['Cb', -1],
    ['B#', 12],
  ])('%s → %d', (name, offset) => {
    expect(pitchOffsetFromName(name)).toBe(offset);
  });

  it.each(['H', '', '#', 'bbb', '#F#', 'C4'])('非法写法「%s」返回 undefined', (name) => {
    expect(pitchOffsetFromName(name)).toBeUndefined();
  });
});

describe('noteNameToMidi', () => {
  it.each([
    ['C4', 60],
    ['C#4', 61],
    ['Bb3', 58],
    ['bb3', 58],
    ['Cb4', 59],
    ['B#3', 60],
    ['C-1', 0],
    ['G9', 127],
  ])('%s → %d', (name, midi) => {
    expect(noteNameToMidi(name)).toBe(midi);
  });

  it.each(['G#9', 'H4', 'C', '60'])('非法或超出范围的「%s」返回 undefined', (name) => {
    expect(noteNameToMidi(name)).toBeUndefined();
  });
});

describe('midiToNoteName', () => {
  it.each([
    [0, 'C-1'],
    [60, 'C4'],
    [61, 'C#4'],
    [127, 'G9'],
  ])('%d → %s', (midi, name) => {
    expect(midiToNoteName(midi)).toBe(name);
  });
});
