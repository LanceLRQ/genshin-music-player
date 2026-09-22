import { act } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_INSTRUMENTS, type InstrumentEntry } from '@/core/instruments/registry';
import { useAdaptStore } from '@/stores/adaptStore';
import { useInstrumentStore } from '@/stores/instrumentStore';
import { InstrumentSelect } from './InstrumentSelect';

beforeEach(() => {
  useInstrumentStore.setState(useInstrumentStore.getInitialState(), true);
  useAdaptStore.setState(useAdaptStore.getInitialState(), true);
});

const customEntry: InstrumentEntry = {
  profile: { ...BUILTIN_INSTRUMENTS[0], id: 'my-lyre', name: '我的琴', status: 'verified' },
  builtin: false,
};

/** 内置乐器已全部游戏内实测，待实测徽章由自定义乐器承载 */
const draftEntry: InstrumentEntry = {
  profile: { ...BUILTIN_INSTRUMENTS[0], id: 'draft-lyre', name: '草稿琴', status: 'unverified' },
  builtin: false,
};

describe('InstrumentSelect', () => {
  it('默认选中风物之诗琴：打开后该项带选中标记', async () => {
    const user = userEvent.setup();
    render(<InstrumentSelect onValueChange={vi.fn()} />);
    await user.click(screen.getByRole('combobox'));
    const option = await screen.findByRole('option', { name: '风物之诗琴' });
    // shadcn SelectItem 的选中标记（Check 图标）只在选中项里渲染
    expect(option.querySelector('svg')).not.toBeNull();
    // 选项可访问名可能拼有待实测徽章等附加文本，因此用子串匹配
    expect(screen.getByRole('option', { name: /老旧的诗琴/ }).querySelector('svg')).toBeNull();
  });

  it('内置乐器按分类分组、自定义单独一组，切换乐器后回调 id', async () => {
    useInstrumentStore.setState({ entries: [...useInstrumentStore.getState().entries, customEntry] });
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<InstrumentSelect onValueChange={onValueChange} />);
    await user.click(screen.getByRole('combobox'));
    expect(await screen.findByText('琴类')).toBeInTheDocument();
    expect(screen.getByText('鼓类')).toBeInTheDocument();
    expect(screen.getByText('圆号')).toBeInTheDocument();
    expect(screen.getByText('人声')).toBeInTheDocument();
    expect(screen.getByText('自定义')).toBeInTheDocument();
    expect(screen.getByText('我的琴')).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: '我的琴' }));
    expect(onValueChange).toHaveBeenCalledWith('my-lyre');
  });

  it('待实测乐器带徽章，选中后显示提示文字', async () => {
    useInstrumentStore.setState({ entries: [...useInstrumentStore.getState().entries, draftEntry] });
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(<InstrumentSelect onValueChange={onValueChange} />);
    await user.click(screen.getByRole('combobox'));
    expect((await screen.findAllByText('待实测')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('option', { name: /草稿琴/ }));
    expect(onValueChange).toHaveBeenCalledWith('draft-lyre');
    // 组件由页面持有目标乐器状态；让 store 采用回发的值后提示文字才出现
    act(() => useAdaptStore.getState().setTarget('draft-lyre'));
    expect(screen.getByText('该乐器的键位和音高尚未在游戏中验证，可能与实际不符。')).toBeInTheDocument();
  });
});
