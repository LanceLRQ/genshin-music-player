import { Midi } from '@tonejs/midi';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScoreParseError } from '@/core/parsers/errors';
import { parseScoreFile, pickScoreFile, writeScoreJson } from './fileIO';

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  save: vi.fn(),
  readFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open, save: mocks.save }));
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: mocks.readFile, writeTextFile: mocks.writeTextFile }));

function buildMidi(): Uint8Array {
  const midi = new Midi();
  midi.header.setTempo(96);
  const melody = midi.addTrack();
  melody.name = 'Melody';
  melody.addNote({ midi: 72, time: 0, duration: 0.5, velocity: 0.8 });
  return midi.toArray();
}

const jsonScore = JSON.stringify({
  schemaVersion: 1,
  meta: { title: 'JSON 曲', source: 'json' },
  tracks: [{ id: 't0', name: '旋律', isDrum: false, notes: [{ startMs: 0, durationMs: 500, pitch: 60, velocity: 0.8 }] }],
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('pickScoreFile / writeScoreJson', () => {
  it('pickScoreFile 返回选中的路径，取消时返回 null', async () => {
    mocks.open.mockResolvedValue('/tmp/demo.mid');
    await expect(pickScoreFile()).resolves.toBe('/tmp/demo.mid');
    expect(mocks.open).toHaveBeenCalledWith(
      expect.objectContaining({ multiple: false, filters: [{ name: '乐谱文件', extensions: ['mid', 'midi', 'txt', 'json'] }] }),
    );
    mocks.open.mockResolvedValue(null);
    await expect(pickScoreFile()).resolves.toBeNull();
  });

  it('writeScoreJson 保存成功时写入文本并返回 true', async () => {
    mocks.save.mockResolvedValue('/tmp/测试曲.json');
    const score = { meta: { title: '测试曲', source: 'json' as const }, tracks: [] };
    await expect(writeScoreJson('测试曲', score)).resolves.toBe(true);
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: '测试曲.json' }));
    expect(mocks.writeTextFile).toHaveBeenCalledWith('/tmp/测试曲.json', expect.stringContaining('schemaVersion'));
  });

  it('writeScoreJson 取消保存时返回 false，不写文件', async () => {
    mocks.save.mockResolvedValue(null);
    const score = { meta: { title: '测试曲', source: 'json' as const }, tracks: [] };
    await expect(writeScoreJson('测试曲', score)).resolves.toBe(false);
    expect(mocks.writeTextFile).not.toHaveBeenCalled();
  });
});

describe('parseScoreFile', () => {
  it('.mid / .midi 按 MIDI 解析，标题取文件名去扩展名', () => {
    const parsed = parseScoreFile('demo.mid', buildMidi());
    expect(parsed).toMatchObject({ kind: 'score', score: { meta: { title: 'demo', source: 'midi', bpm: 96 } } });
  });

  it('.json 按 JSON 谱解析', () => {
    const parsed = parseScoreFile('demo.json', new TextEncoder().encode(jsonScore));
    expect(parsed).toMatchObject({ kind: 'score', score: { meta: { title: 'JSON 曲', source: 'json' } } });
  });

  it('.txt 返回文本、标题与格式猜测，交给文本乐谱对话框', () => {
    const parsed = parseScoreFile('小星星.txt', new TextEncoder().encode('@bpm=90\n1 1 5 5'));
    expect(parsed).toEqual({ kind: 'text', title: '小星星', text: '@bpm=90\n1 1 5 5', guess: 'jianpu' });
  });

  it('不支持的扩展名抛出 ScoreParseError', () => {
    expect(() => parseScoreFile('demo.wav', new Uint8Array())).toThrow(ScoreParseError);
    expect(() => parseScoreFile('demo.wav', new Uint8Array())).toThrow(/不支持的文件类型「\.wav」/);
  });
});
