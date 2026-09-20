import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { BUILTIN_INSTRUMENTS } from '@/core/instruments/registry';
import type { InstrumentProfile } from '@/core/model/instrument';
import { InstrumentEditor } from './InstrumentEditor';

vi.mock('@/audio/previewPlayer', () => ({
  previewPlayer: { playKey: vi.fn(), start: vi.fn(), stop: vi.fn() },
}));

afterEach(() => {
  clearMocks();
  vi.restoreAllMocks();
});

const lyreProfile: InstrumentProfile = { ...structuredClone(BUILTIN_INSTRUMENTS[0]), id: 'my-lyre', name: '我的琴', status: 'unverified' };
const drumProfile: InstrumentProfile = structuredClone(BUILTIN_INSTRUMENTS[4]);

function renderEditor(profile: InstrumentProfile, saved = true) {
  const onDirtyChange = vi.fn();
  const onCancel = vi.fn();
  const onDone = vi.fn();
  const user = userEvent.setup();
  render(
    <InstrumentEditor
      profile={profile}
      saved={saved}
      onDirtyChange={onDirtyChange}
      onCancel={onCancel}
      onDone={onDone}
    />,
  );
  return { user, onDirtyChange, onCancel, onDone };
}

beforeEach(() => {
  mockIPC(() => null);
});

describe('InstrumentEditor', () => {
  it('渲染字段与试弹预览的初值', () => {
    renderEditor(lyreProfile);
    expect(screen.getByLabelText('名称')).toHaveValue('我的琴');
    expect(screen.getByLabelText('ID')).toHaveValue('my-lyre');
    expect(screen.getByLabelText('ID')).toBeDisabled();
    expect(screen.getByText('保存过的乐器 ID 不可修改')).toBeInTheDocument();
    expect(screen.getByLabelText('按住时长')).toHaveValue(30);
    expect(screen.getByLabelText('最小重复间隔')).toHaveValue(75);
    expect(screen.getByRole('switch', { name: '可持续发声' })).not.toBeChecked();
    // "Q"出现两次：试弹预览的键帽 + 行编辑按键捕获按钮的 Kbd
    expect(screen.getAllByText('Q')).toHaveLength(2);
    expect(screen.getByText('C5')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
  });

  it('修改后通过 onDirtyChange 报告未保存状态', async () => {
    const { user, onDirtyChange } = renderEditor(lyreProfile);
    await user.type(screen.getByLabelText('名称'), '二');
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByText('有未保存的修改')).toBeInTheDocument();
  });

  it('和弦键显示和弦名与构成音输入，切换为单音后清空和弦字段', async () => {
    const guitar: InstrumentProfile = { ...structuredClone(BUILTIN_INSTRUMENTS.find((p) => p.id === 'yuco-lyre')!), id: 'my-guitar' };
    const { user } = renderEditor(guitar);
    // 第一行第一键是 C 和弦：表单里是和弦名 + 构成音输入
    expect(screen.getByLabelText('第 1 行第 1 个键的和弦名')).toHaveValue('C');
    expect(screen.getByLabelText('第 1 行第 1 个键的和弦构成音')).toHaveValue('C3 E3 G3');
    // 修改构成音：乱序输入自动排序去重后提交
    const notes = screen.getByLabelText('第 1 行第 1 个键的和弦构成音');
    await user.clear(notes);
    await user.type(notes, '60 64 67 64');
    fireEvent.blur(notes);
    expect(screen.getByLabelText('第 1 行第 1 个键的和弦构成音')).toHaveValue('C4 E4 G4');
    // 切回单音：和弦字段消失，音高输入出现
    const typeToggle = screen.getByRole('radiogroup', { name: '第 1 行第 1 个键的键类型' });
    await user.click(within(typeToggle).getByText('单音'));
    expect(screen.queryByLabelText('第 1 行第 1 个键的和弦名')).not.toBeInTheDocument();
    expect(screen.getByLabelText('第 1 行第 1 个键的音高')).toHaveValue('C4 (60)');
  });

  it('名称为空时给出中文错误并禁用保存，改回后恢复', async () => {
    renderEditor(lyreProfile);
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '' } });
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeDisabled());
    expect(screen.getByText('名称不能为空')).toBeInTheDocument();
    expect(screen.getByText('有 1 个校验错误')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '好名字' } });
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled());
  });

  it('切换类型需要确认并清空所有键，出现鼓映射表', async () => {
    const { user } = renderEditor(lyreProfile);
    // radix-ui 会把 single 型 ToggleGroupItem 渲染成 role="radio" 而不是 button
    await user.click(screen.getByRole('radio', { name: '敲击类' }));
    expect(screen.getByRole('alertdialog', { name: '切换乐器类型？' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: '敲击类' }));
    await user.click(screen.getByRole('button', { name: '切换并清空' }));
    expect(screen.queryByLabelText(/个键的音高/)).not.toBeInTheDocument();
    expect(screen.getByText('鼓映射表')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '映射音符 1' })).toBeInTheDocument();
  });

  it('行的上移、删除与添加键、添加行', async () => {
    const { user } = renderEditor(lyreProfile);
    expect(screen.getByLabelText('第 3 行名称')).toHaveValue('低音');
    await user.click(screen.getByRole('button', { name: '上移第 3 行' }));
    expect(screen.getByLabelText('第 2 行名称')).toHaveValue('低音');
    await user.click(screen.getByRole('button', { name: '删除第 1 行' }));
    expect(screen.getAllByLabelText(/行名称/)).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: '添加行' }));
    expect(screen.getAllByLabelText(/行名称/)).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: '在第 3 行添加键' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: '在第 1 行添加键' }));
    expect(screen.getAllByLabelText(/第 1 行第 \d+ 个键的音高/)).toHaveLength(8);
  });

  it('音高输入失焦时规范化显示，无法解析时标红', () => {
    renderEditor(lyreProfile);
    const pitch = screen.getByLabelText('第 1 行第 1 个键的音高');
    fireEvent.change(pitch, { target: { value: 'c#4' } });
    fireEvent.blur(pitch);
    expect(pitch).toHaveValue('C#4 (61)');
    fireEvent.change(pitch, { target: { value: 'abc' } });
    fireEvent.blur(pitch);
    expect(pitch).toHaveAttribute('aria-invalid', 'true');
  });

  it('上移行后音高输入跟随数据，失焦不会把旧值提交到错位的键', async () => {
    const { user } = renderEditor(lyreProfile);
    // 上移第 2 行后，第 1 行第 1 个键从 高音 KeyQ（C5）换成 中音 KeyA（C4），输入框必须跟着换
    await user.click(screen.getByRole('button', { name: '上移第 2 行' }));
    const pitch = screen.getByLabelText('第 1 行第 1 个键的音高');
    expect(pitch).toHaveValue('C4 (60)');
    fireEvent.blur(pitch);
    expect(pitch).toHaveValue('C4 (60)');
    expect(screen.getByText('C4')).toBeInTheDocument();
  });

  it('保存成功后提示并退出编辑器', async () => {
    const spy = vi.spyOn(toast, 'success');
    let saved: { profile?: unknown } | null = null;
    mockIPC((cmd, args) => {
      if (cmd === 'save_custom_instrument') {
        saved = args as { profile: unknown };
        return null;
      }
      if (cmd === 'list_custom_instruments') return { profiles: saved ? [saved.profile] : [], warnings: [] };
      return null;
    });
    const { user, onDone } = renderEditor(lyreProfile);
    await user.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith('乐器配置已保存');
  });

  it('鼓映射表：添加条目与恢复 GM 默认映射', async () => {
    // 用小映射表测行为，避免渲染 47 行下拉拖慢用例；GM 全音域覆盖由 registry.test 的不变量保证
    const small: InstrumentProfile = {
      ...structuredClone(drumProfile),
      percussionMap: { drumNotes: { '36': 'don', '38': 'ka' }, splitPitch: 'auto' },
    };
    const { user } = renderEditor(small);
    expect(screen.getAllByRole('combobox', { name: /^映射音符/ })).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: '添加' }));
    expect(screen.getAllByRole('combobox', { name: /^映射音符/ })).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: '恢复 GM 默认映射' }));
    // GM 预设覆盖 35–81
    expect(screen.getAllByRole('combobox', { name: /^映射音符/ })).toHaveLength(47);
  }, 15000);

  it('分界音高：关闭自动后可输入音名', async () => {
    const { user } = renderEditor(drumProfile);
    expect(screen.queryByLabelText('分界音高')).not.toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: '自动（中位数）' }));
    const split = screen.getByLabelText('分界音高');
    fireEvent.change(split, { target: { value: 'C4' } });
    fireEvent.blur(split);
    expect(split).toHaveValue('C4 (60)');
  });
});
