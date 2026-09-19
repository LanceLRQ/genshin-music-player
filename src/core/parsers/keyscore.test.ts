import { describe, expect, it } from 'vitest';
import { BUILTIN_INSTRUMENTS } from '../instruments/registry';
import { catchParseError } from '../testing';
import { type KeyscoreOptions, parseKeyscore } from './keyscore';

const resolveInstrument = (id: string) => BUILTIN_INSTRUMENTS.find((p) => p.id === id);

// bpm 120、步长 1/2 拍 → 每个步长 250ms
function parse(text: string, extra: Partial<KeyscoreOptions> = {}) {
  return parseKeyscore(text, {
    title: '测试',
    defaultInstrumentId: 'windsong-lyre',
    resolveInstrument,
    bpm: 120,
    step: 0.5,
    ...extra,
  });
}

const notesOf = (text: string, extra: Partial<KeyscoreOptions> = {}) => parse(text, extra).score.tracks[0]?.notes ?? [];
const brief = (text: string, extra: Partial<KeyscoreOptions> = {}) =>
  notesOf(text, extra).map((n) => [n.startMs, n.durationMs, n.pitch ?? n.voice]);

describe('parseKeyscore', () => {
  it('连续字母依次弹奏，每个占一个步长', () => {
    expect(brief('QWE')).toEqual([
      [0, 250, 72],
      [250, 250, 74],
      [500, 250, 76],
    ]);
  });

  it('生成单音轨乐谱，并返回来源乐器', () => {
    const { score, sourceInstrumentId } = parse('Q');
    expect(score.meta).toEqual({ title: '测试', source: 'keyscore', bpm: 120 });
    expect(score.tracks.map((t) => [t.id, t.name, t.isDrum])).toEqual([['t0', '风物之诗琴', false]]);
    expect(sourceInstrumentId).toBe('windsong-lyre');
  });

  it('字母不区分大小写', () => {
    expect(brief('q')).toEqual([[0, 250, 72]]);
  });

  it('圆括号和方括号都表示和弦', () => {
    expect(brief('(QE) [AD]')).toEqual([
      [0, 250, 72],
      [0, 250, 76],
      [250, 250, 60],
      [250, 250, 64],
    ]);
  });

  it('- 延长上一个音，/ 表示休止，| 被忽略', () => {
    expect(brief('Q - W / E | R')).toEqual([
      [0, 500, 72],
      [500, 250, 74],
      [1000, 250, 76],
      [1250, 250, 77],
    ]);
  });

  it('默认空格只是分隔符，开启 spaceAsRest 后每个空格占一个步长', () => {
    expect(brief('Q  W').map((n) => n[0])).toEqual([0, 250]);
    expect(brief('Q  W', { spaceAsRest: true }).map((n) => n[0])).toEqual([0, 750]);
  });

  it(':n 和 :n/m 指定步长倍数', () => {
    expect(brief('Q:2 W:1/2 E')).toEqual([
      [0, 500, 72],
      [500, 125, 74],
      [625, 250, 76],
    ]);
    expect(brief('(QE):2 W').map((n) => n[0])).toEqual([0, 0, 500]);
  });

  it('@bpm 和 @step 指令覆盖选项', () => {
    expect(brief('@bpm=60 @step=1 Q W').map((n) => n[0])).toEqual([0, 1000]);
    expect(parse('@bpm=60 Q').score.meta.bpm).toBe(60);
  });

  it('@instrument 指定来源乐器', () => {
    const result = parse('@instrument=two-row-prototype N');
    expect(result.sourceInstrumentId).toBe('two-row-prototype');
    expect(result.score.tracks[0].notes[0].pitch).toBe(57);
  });

  it('// 之后到行尾是注释，换行是分隔符', () => {
    expect(brief('Q // W E\nR').map((n) => n[2])).toEqual([72, 77]);
  });

  it('敲击类来源乐器生成 voice 音符', () => {
    expect(brief('S A', { defaultInstrumentId: 'festive-drum' })).toEqual([
      [0, 250, 'don'],
      [250, 250, 'ka'],
    ]);
  });

  it('没有音符时返回空音轨列表', () => {
    expect(parse('// 空谱').score.tracks).toEqual([]);
  });

  describe('错误', () => {
    it('来源乐器没有这个按键', () => {
      const error = catchParseError(() => parse('Q K'));
      expect([error.line, error.col]).toEqual([1, 3]);
      expect(error.message).toContain('来源乐器「风物之诗琴」没有按键「K」');
    });

    it('无法识别的字符', () => {
      expect(catchParseError(() => parse('%')).message).toContain('无法识别的字符「%」');
    });

    it('和弦没有闭合时指向和弦起点', () => {
      const error = catchParseError(() => parse('Q\n(QE'));
      expect([error.line, error.col]).toEqual([2, 1]);
      expect(error.message).toContain('和弦没有闭合');
    });

    it('和弦不能为空', () => {
      expect(catchParseError(() => parse('()')).message).toContain('和弦不能为空');
    });

    it('@instrument 必须在第一个音符之前', () => {
      const error = catchParseError(() => parse('Q @instrument=floral-zither'));
      expect([error.line, error.col]).toEqual([1, 3]);
      expect(error.message).toContain('@instrument 必须写在第一个音符之前');
    });

    it('找不到来源乐器', () => {
      expect(catchParseError(() => parse('@instrument=nope Q')).message).toContain('找不到来源乐器「nope」');
      expect(catchParseError(() => parse('Q', { defaultInstrumentId: 'nope' })).message).toContain(
        '找不到来源乐器「nope」',
      );
    });

    it('指令格式或取值错误', () => {
      expect(catchParseError(() => parse('@foo=1')).message).toContain('未知指令「@foo」');
      expect(catchParseError(() => parse('@bpm')).message).toContain('指令格式应为 @名称=值');
      expect(catchParseError(() => parse('@bpm=0')).message).toContain('@bpm 必须是正数');
      expect(catchParseError(() => parse('@step=x')).message).toContain('@step 写法错误');
    });

    it('时值写法错误', () => {
      const error = catchParseError(() => parse('Q:0'));
      expect([error.line, error.col]).toEqual([1, 2]);
      expect(error.message).toContain('时值写法错误「:0」');
    });
  });
});
