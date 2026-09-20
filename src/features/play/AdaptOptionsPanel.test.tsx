import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BUILTIN_INSTRUMENTS } from '@/core/instruments/registry';
import { DEFAULT_ADAPT_OPTIONS, type AdaptOptions } from '@/core/model/timeline';
import { AdaptOptionsPanel } from './AdaptOptionsPanel';

const lyre = BUILTIN_INSTRUMENTS[0];
const drum = BUILTIN_INSTRUMENTS[4];
const options: AdaptOptions = { ...DEFAULT_ADAPT_OPTIONS, tracks: ['t0'] };

function renderPanel(overrides: Partial<Parameters<typeof AdaptOptionsPanel>[0]> = {}) {
  const props = {
    profile: lyre,
    options,
    locked: false,
    onChange: vi.fn(),
    ...overrides,
  };
  render(<AdaptOptionsPanel {...props} />);
  return props;
}

describe('AdaptOptionsPanel（音高类）', () => {
  it('显示小节标题与移调、八度、黑键、超音域，展开高级后显示复音上限与和弦窗口', async () => {
    const user = userEvent.setup();
    renderPanel();
    expect(screen.getByText('适配参数')).toBeInTheDocument();
    expect(screen.getByText('移调')).toBeInTheDocument();
    expect(screen.getByText('八度')).toBeInTheDocument();
    expect(screen.getByText('黑键')).toBeInTheDocument();
    expect(screen.getByText('超音域')).toBeInTheDocument();
    expect(screen.queryByText('复音上限')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '高级' }));
    expect(screen.getByText('复音上限')).toBeInTheDocument();
    expect(screen.getByText('和弦窗口')).toBeInTheDocument();
  });

  it('点击步进按钮修改移调，输入框失焦提交', async () => {
    const props = renderPanel();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '增加移调' }));
    expect(props.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ transpose: 1 }));
    await user.click(screen.getByRole('button', { name: '减少移调' }));
    expect(props.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ transpose: -1 }));
    const input = screen.getByRole('textbox', { name: '移调' });
    await user.clear(input);
    await user.type(input, '-5');
    await user.tab();
    expect(props.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ transpose: -5 }));
  });

  it('黑键与超音域切换回调', async () => {
    const props = renderPanel();
    const user = userEvent.setup();
    // Radix ToggleGroup 单选模式的选项是 radio 语义，不是 button
    await user.click(screen.getByRole('radio', { name: '就近取音' }));
    expect(props.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ blackKeyPolicy: 'nearest' }));
    await user.click(screen.getByRole('radio', { name: '丢弃' }));
    expect(props.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ outOfRangePolicy: 'drop' }));
  });
});

describe('AdaptOptionsPanel（敲击类）', () => {
  it('隐藏移调与黑键，显示分界音高', () => {
    renderPanel({ profile: drum });
    expect(screen.queryByText('移调')).not.toBeInTheDocument();
    expect(screen.queryByText('黑键')).not.toBeInTheDocument();
    expect(screen.getByText('分界音高')).toBeInTheDocument();
    expect(screen.getByText('低于分界音高的音映射为「咚」，其余映射为「咔」。')).toBeInTheDocument();
  });

  it('按音色指定音符：默认自动，选定后回调 drumVoiceNotes', async () => {
    const props = renderPanel({ profile: drum });
    const user = userEvent.setup();
    expect(screen.getByRole('combobox', { name: '指定咚的音符' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '指定咔的音符' })).toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: '指定咚的音符' }));
    await user.click(screen.getByRole('option', { name: /F2 · 低音地嗵/ }));
    expect(props.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ drumVoiceNotes: { don: 41 } }));
  });

  it('按音色指定音符：选回自动则移除指定', async () => {
    const props = renderPanel({ profile: drum, options: { ...options, drumVoiceNotes: { don: 41 } } });
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox', { name: '指定咚的音符' }));
    await user.click(screen.getByRole('option', { name: '自动（按鼓映射表）' }));
    expect(props.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ drumVoiceNotes: undefined }));
  });

  it('聚聚鼓对称键合并为一行：只有基础音色成行，键位提示可见', () => {
    const juju = BUILTIN_INSTRUMENTS.find((profile) => profile.id === 'juju-drum')!;
    renderPanel({ profile: juju, options: { ...options, drumVoiceNotes: { bass: 36, 'hi-hat': 38 } } });
    const rows = screen.getAllByRole('combobox').filter((element) => /的音符$/.test(element.getAttribute('aria-label') ?? ''));
    expect(rows).toHaveLength(4);
    expect(screen.getByRole('combobox', { name: '指定底鼓的音符' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '指定军鼓的音符' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '指定擦的音符' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '指定三连音的音符' })).toBeInTheDocument();
    expect(screen.getByText('Q/A')).toBeInTheDocument();
    expect(screen.getByText('W/S')).toBeInTheDocument();
  });

  it('聚聚鼓指定行：被其他声音占用的音高禁用，可选其余音高并回调', async () => {
    const juju = BUILTIN_INSTRUMENTS.find((profile) => profile.id === 'juju-drum')!;
    const props = renderPanel({ profile: juju, options: { ...options, drumVoiceNotes: { bass: 36, 'hi-hat': 38 } } });
    const user = userEvent.setup();
    // 军鼓行：36（底鼓占用）与 38（擦占用）都禁用
    await user.click(screen.getByRole('combobox', { name: '指定军鼓的音符' }));
    expect(screen.getByRole('option', { name: 'C2 · 底鼓' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('option', { name: 'D2 · 原声军鼓' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(screen.getByRole('option', { name: 'F2 · 低音地嗵' }));
    expect(props.onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ drumVoiceNotes: { bass: 36, 'hi-hat': 38, snare: 41 } }),
    );
  });

  it('关闭自动分界音高后出现输入框，接受音名或 MIDI 号', async () => {
    const props = renderPanel({ profile: drum });
    const user = userEvent.setup();
    await user.click(screen.getByRole('switch', { name: '自动分界音高' }));
    expect(props.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ percussionSplitPitch: 60 }));
    const input = screen.getByRole('textbox', { name: '分界音高' });
    await user.clear(input);
    await user.type(input, 'C4');
    await user.tab();
    expect(props.onChange).toHaveBeenLastCalledWith(expect.objectContaining({ percussionSplitPitch: 60 }));
  });
});
