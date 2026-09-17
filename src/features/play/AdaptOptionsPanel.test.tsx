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
    manual: false,
    locked: false,
    onChange: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
  render(<AdaptOptionsPanel {...props} />);
  return props;
}

describe('AdaptOptionsPanel（音高类）', () => {
  it('显示移调、八度、黑键、超音域，展开高级后显示复音上限与和弦窗口', async () => {
    const user = userEvent.setup();
    renderPanel();
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

describe('AdaptOptionsPanel（手动调整）', () => {
  it('手动调整后出现徽章与恢复按钮，点击回调 onReset', async () => {
    const props = renderPanel({ manual: true });
    expect(screen.getByText('已手动调整')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /恢复自动推荐/ }));
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  it('没有手动调整时不显示徽章与恢复按钮', () => {
    renderPanel({ manual: false });
    expect(screen.queryByText('已手动调整')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /恢复自动推荐/ })).not.toBeInTheDocument();
  });
});
