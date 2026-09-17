import { describe, expect, it } from 'vitest';
import type { Score } from '../model/score';
import { catchParseError } from '../testing';
import { parseJsonScore, serializeScore } from './jsonScore';

const sample: Score = {
  meta: { title: '小星星', source: 'jianpu', bpm: 100 },
  tracks: [
    {
      id: 't0',
      name: '旋律',
      isDrum: false,
      notes: [
        { startMs: 0, durationMs: 500, pitch: 60, velocity: 0.8 },
        { startMs: 500, durationMs: 500, voice: 'don', velocity: 1 },
      ],
    },
  ],
};

describe('JSON 谱', () => {
  it('导出后再导入内容一致，来源改为 json', () => {
    const parsed = parseJsonScore(serializeScore(sample));
    expect(parsed.tracks).toEqual(sample.tracks);
    expect(parsed.meta).toEqual({ ...sample.meta, source: 'json' });
  });

  it('导出内容带 schemaVersion 1', () => {
    expect(JSON.parse(serializeScore(sample)).schemaVersion).toBe(1);
  });

  it('不是合法 JSON 时报错', () => {
    expect(catchParseError(() => parseJsonScore('{oops')).message).toMatch(/^不是合法的 JSON：/);
  });

  it('字段不合法时给出字段路径', () => {
    const bad = JSON.parse(serializeScore(sample));
    bad.tracks[0].notes[0].startMs = -1;
    expect(catchParseError(() => parseJsonScore(JSON.stringify(bad))).path).toBe('tracks.0.notes.0.startMs');
  });

  it('音符既没有 pitch 也没有 voice 时报错', () => {
    const bad = JSON.parse(serializeScore(sample));
    delete bad.tracks[0].notes[1].voice;
    const error = catchParseError(() => parseJsonScore(JSON.stringify(bad)));
    expect(error.path).toBe('tracks.0.notes.1');
    expect(error.message).toContain('音符必须有 pitch 或 voice');
  });

  it('schemaVersion 不是 1 时报错', () => {
    const bad = { ...JSON.parse(serializeScore(sample)), schemaVersion: 2 };
    expect(catchParseError(() => parseJsonScore(JSON.stringify(bad))).path).toBe('schemaVersion');
  });
});
