import { describe, expect, it } from 'vitest';
import { validateInstrumentProfile } from './instrument';

function pitchedProfile() {
  return {
    schemaVersion: 1,
    id: 'test-lyre',
    name: '测试琴',
    kind: 'pitched',
    status: 'unverified',
    rows: [
      {
        label: '中音',
        keys: [
          { pitch: 60, code: 'KeyA' },
          { pitch: 62, code: 'KeyS' },
        ],
      },
    ],
    timing: { holdMs: 30, minRepeatGapMs: 40 },
  };
}

function drumProfile() {
  return {
    schemaVersion: 1,
    id: 'test-drum',
    name: '测试鼓',
    kind: 'percussion',
    status: 'unverified',
    rows: [
      {
        label: '鼓',
        keys: [
          { voice: 'don', code: 'KeyF' },
          { voice: 'ka', code: 'KeyJ' },
        ],
      },
    ],
    timing: { holdMs: 30, minRepeatGapMs: 40 },
    percussionMap: { drumNotes: { '36': 'don', '38': 'ka' } as Record<string, string>, splitPitch: 'auto' },
  };
}

function errorsOf(data: unknown): string[] {
  const result = validateInstrumentProfile(data);
  return result.ok ? [] : result.errors;
}

describe('validateInstrumentProfile', () => {
  it('合法的音高类配置通过，sustain 默认为 false', () => {
    const result = validateInstrumentProfile(pitchedProfile());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.timing.sustain).toBe(false);
  });

  it('合法的敲击类配置通过', () => {
    expect(errorsOf(drumProfile())).toEqual([]);
  });

  it('id 必须是小写 kebab-case', () => {
    expect(errorsOf({ ...pitchedProfile(), id: 'Test Lyre' })[0]).toMatch(/^id：/);
  });

  it('键码重复时报错', () => {
    const profile = pitchedProfile();
    profile.rows[0].keys[1].code = 'KeyA';
    expect(errorsOf(profile)).toContain('rows.0.keys.1.code：键码「KeyA」重复');
  });

  it('未知键码报错', () => {
    const profile = pitchedProfile();
    profile.rows[0].keys[0].code = 'KeyFoo';
    expect(errorsOf(profile)).toContain('rows.0.keys.0.code：未知键码「KeyFoo」');
  });

  it('音高类乐器的键缺少 pitch 时报错', () => {
    const profile = pitchedProfile();
    delete (profile.rows[0].keys[1] as { pitch?: number }).pitch;
    expect(errorsOf(profile)).toContain('rows.0.keys.1.pitch：音高类乐器的键必须有 pitch 或 chord');
  });

  it('音高重复时报错', () => {
    const profile = pitchedProfile();
    profile.rows[0].keys[1].pitch = 60;
    expect(errorsOf(profile)).toContain('rows.0.keys.1.pitch：音高 60 重复');
  });

  it('音高类乐器的键不能有 voice', () => {
    const profile = pitchedProfile();
    (profile.rows[0].keys[0] as { voice?: string }).voice = 'don';
    expect(errorsOf(profile)).toContain('rows.0.keys.0.voice：音高类乐器的键不能有 voice');
  });

  it('敲击类乐器的键缺少 voice 时报错', () => {
    const profile = drumProfile();
    delete (profile.rows[0].keys[0] as { voice?: string }).voice;
    expect(errorsOf(profile)).toContain('rows.0.keys.0.voice：敲击类乐器的键必须有 voice');
  });

  it('敲击类乐器的键不能有 pitch', () => {
    const profile = drumProfile();
    (profile.rows[0].keys[0] as { pitch?: number }).pitch = 36;
    expect(errorsOf(profile)).toContain('rows.0.keys.0.pitch：敲击类乐器的键不能有 pitch');
  });

  it('音色重复时报错', () => {
    const profile = drumProfile();
    profile.rows[0].keys[1].voice = 'don';
    expect(errorsOf(profile)).toContain('rows.0.keys.1.voice：音色「don」重复');
  });

  it('鼓映射引用不存在的音色时报错', () => {
    const profile = drumProfile();
    profile.percussionMap.drumNotes = { '36': 'boom', '38': 'ka' };
    expect(errorsOf(profile)).toContain('percussionMap.drumNotes.36：音色「boom」在键位中不存在');
  });

  it('每行最多 12 个键', () => {
    const profile = pitchedProfile();
    profile.rows[0].keys = 'ABCDEFGHIJKLM'.split('').map((letter, i) => ({ pitch: 60 + i, code: `Key${letter}` }));
    expect(errorsOf(profile).some((e) => e.startsWith('rows.0.keys：'))).toBe(true);
  });

  it('结构性错误返回中文文案', () => {
    const errors = errorsOf({});
    expect(errors).toContain('schemaVersion：乐器配置版本必须是 1');
    expect(errors).toContain('id：ID 必须是文本');
    expect(errors).toContain('name：名称必须是文本');
    expect(errors).toContain('kind：类型必须是 pitched（音高类）或 percussion（敲击类）');
    expect(errors).toContain('status：状态必须是 verified（已验证）或 unverified（待实测）');
    expect(errors).toContain('rows：行配置必须是数组');
    expect(errors).toContain('timing：时值配置必须是对象');
  });

  it('非对象输入报中文错误', () => {
    expect(errorsOf('nope')).toEqual(['(根)：乐器配置必须是 JSON 对象']);
  });

  it('drumNotes 非规范键规范化为十进制', () => {
    const profile = drumProfile();
    profile.percussionMap.drumNotes = { '036': 'don', '38': 'ka' };
    const result = validateInstrumentProfile(profile);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.percussionMap?.drumNotes).toEqual({ '36': 'don', '38': 'ka' });
  });

  it('规范化后重复的键后出现的覆盖先出现的', () => {
    const profile = drumProfile();
    profile.percussionMap.drumNotes = { '36': 'don', '036': 'ka' };
    const result = validateInstrumentProfile(profile);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.percussionMap?.drumNotes).toEqual({ '36': 'ka' });
  });
});

describe('和弦键校验（M6）', () => {
  it('合法和弦键通过，与单音键混合', () => {
    const profile = pitchedProfile();
    (profile.rows[0].keys[1] as { chord?: number[]; label?: string; pitch?: number }).chord = [48, 52, 55];
    (profile.rows[0].keys[1] as { label?: string }).label = 'C';
    delete (profile.rows[0].keys[1] as { pitch?: number }).pitch;
    expect(errorsOf(profile)).toEqual([]);
  });

  it('和弦键缺 label、pitch 与 chord 同填、非升序分别报错', () => {
    const noLabel = pitchedProfile();
    (noLabel.rows[0].keys[0] as { chord?: number[]; pitch?: number }).chord = [60, 64];
    delete (noLabel.rows[0].keys[0] as { pitch?: number }).pitch;
    expect(errorsOf(noLabel)).toContain('rows.0.keys.0.label：和弦键必须有 label（和弦名）');

    const both = pitchedProfile();
    (both.rows[0].keys[0] as { chord?: number[] }).chord = [60, 64];
    expect(errorsOf(both)).toContain('rows.0.keys.0.chord：同一个键的 pitch 与 chord 只能二选一');

    const unsorted = pitchedProfile();
    (unsorted.rows[0].keys[0] as { chord?: number[]; pitch?: number; label?: string }).chord = [64, 60];
    (unsorted.rows[0].keys[0] as { label?: string }).label = 'C';
    delete (unsorted.rows[0].keys[0] as { pitch?: number }).pitch;
    expect(errorsOf(unsorted)).toContain('rows.0.keys.0.chord：和弦构成音必须严格升序且不重复');
  });
});
