import { describe, expect, it } from 'vitest';
import { catchParseError } from '../testing';
import { parseJianpu } from './jianpu';

const parse = (text: string) => parseJianpu(text, { title: '测试' });
const notesOf = (text: string) => parse(text).tracks[0]?.notes ?? [];
const pitches = (text: string) => notesOf(text).map((n) => n.pitch);
const starts = (text: string) => notesOf(text).map((n) => n.startMs);

describe('parseJianpu', () => {
  it('音级对应 C 大调，默认每个音 1 拍', () => {
    expect(pitches('1 2 3 4 5 6 7')).toEqual([60, 62, 64, 65, 67, 69, 71]);
    expect(starts('@bpm=60 1 2 3')).toEqual([0, 1000, 2000]);
  });

  it('默认 bpm 为 90，生成的乐谱信息正确', () => {
    const score = parse('1 2');
    expect(score.meta).toEqual({ title: '测试', source: 'jianpu', bpm: 90 });
    expect(score.tracks[0].notes[1].startMs).toBeCloseTo(666.667, 2);
    expect(score.tracks.map((t) => [t.id, t.name, t.isDrum])).toEqual([['t0', '旋律', false]]);
  });

  it('调号：1=D、@key=bB、@key=F#', () => {
    expect(pitches('1=D 1 3')).toEqual([62, 66]);
    expect(pitches('@key=bB 1')).toEqual([70]);
    expect(pitches('@key=F# 1')).toEqual([66]);
  });

  it('八度：@octave 与 \' , 标记', () => {
    expect(pitches('@octave=5 1')).toEqual([72]);
    expect(pitches("1, 1,, 1''")).toEqual([48, 36, 84]);
  });

  it('升降号写在数字前', () => {
    expect(pitches('#4 b7')).toEqual([66, 70]);
  });

  it('减时线与附点', () => {
    const notes = notesOf('@bpm=60 1_ 2__ 3. 4');
    expect(notes.map((n) => n.startMs)).toEqual([0, 500, 750, 2250]);
    expect(notes.map((n) => n.durationMs)).toEqual([500, 250, 1500, 1000]);
  });

  it('增时线延长前一个音或和弦', () => {
    const notes = notesOf('@bpm=60 1 - - 2');
    expect(notes[0].durationMs).toBe(3000);
    expect(notes[1].startMs).toBe(3000);
    expect(notesOf('@bpm=60 [135] -').map((n) => n.durationMs)).toEqual([2000, 2000, 2000]);
  });

  it('休止符占时值，也可以带减时线', () => {
    expect(starts('@bpm=60 0 1 0_ 2')).toEqual([1000, 2500]);
  });

  it('和弦：时值标记写在 ] 后面，音上可以带八度标记', () => {
    const notes = notesOf("@bpm=60 [135]_ [1 3 5']");
    expect(notes.map((n) => [n.startMs, n.durationMs, n.pitch])).toEqual([
      [0, 500, 60],
      [0, 500, 64],
      [0, 500, 67],
      [500, 1000, 60],
      [500, 1000, 64],
      [500, 1000, 79],
    ]);
  });

  it('三连音每个音时值 ×2/3', () => {
    const result = starts('@bpm=60 {1 2 3} 4');
    expect(result[1]).toBeCloseTo(666.667, 2);
    expect(result[2]).toBeCloseTo(1333.333, 2);
    expect(result[3]).toBeCloseTo(2000, 6);
  });

  it('@track 开始新音轨，时间从 0 开始；开头的 @track 只重命名默认音轨', () => {
    const score = parse('@track=右手\n1 2\n@track=左手\n1,');
    expect(score.tracks.map((t) => [t.id, t.name])).toEqual([
      ['t0', '右手'],
      ['t1', '左手'],
    ]);
    expect(score.tracks[1].notes[0]).toMatchObject({ startMs: 0, pitch: 48 });
  });

  it('小节线被忽略，// 之后是注释', () => {
    expect(pitches('1 | 2 // 3 4')).toEqual([60, 62]);
  });

  describe('错误', () => {
    const errorOf = (text: string) => catchParseError(() => parse(text));

    it('无法识别的符号带行列号', () => {
      const error = errorOf('1 x');
      expect([error.line, error.col]).toEqual([1, 3]);
      expect(error.message).toContain('无法识别的符号「x」');
    });

    it('三连音不能嵌套，也必须闭合', () => {
      expect(errorOf('{1 {2}}').message).toContain('不支持嵌套三连音');
      const unclosed = errorOf('1\n{1 2');
      expect([unclosed.line, unclosed.col]).toEqual([2, 1]);
      expect(unclosed.message).toContain('三连音没有闭合');
      expect(errorOf('}').message).toContain('多余的「}」');
      expect(errorOf('{1 -}').message).toContain('三连音内不能使用增时线「-」');
    });

    it('和弦的各种错误', () => {
      expect(errorOf('[1 3').message).toContain('和弦没有闭合');
      expect(errorOf('[1_ 3]').message).toContain('和弦内不能写时值');
      expect(errorOf("[13]'").message).toContain('八度标记要写在和弦内的音上');
      expect(errorOf('[]').message).toContain('和弦不能为空');
      expect(errorOf('[1 0]').message).toContain('和弦内不能包含休止符');
      expect(errorOf('[1 x]').message).toContain('和弦内不能出现「x」');
    });

    it('休止符不能带升降号或八度标记', () => {
      expect(errorOf('#0').message).toContain('休止符不能带升降号或八度标记');
      expect(errorOf("0'").message).toContain('休止符不能带升降号或八度标记');
    });

    it('升降号后面必须是数字', () => {
      const error = errorOf('#x');
      expect([error.line, error.col]).toEqual([1, 2]);
      expect(error.message).toContain('升降号后面应该是 1–7 的数字');
    });

    it('指令错误', () => {
      expect(errorOf('@key=H 1').message).toContain('调号写法错误「H」');
      expect(errorOf('@bpm=0').message).toContain('@bpm 必须是正数');
      expect(errorOf('@octave=9').message).toContain('@octave 应为 -1 到 8 的整数');
      expect(errorOf('@track=').message).toContain('@track 需要名称');
      expect(errorOf('@tempo=1').message).toContain('未知指令「@tempo」');
    });

    it('音高超出 MIDI 范围', () => {
      expect(errorOf("@octave=8 7'''").message).toContain('音高超出 MIDI 范围');
    });
  });
});
