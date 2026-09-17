import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useInstrumentStore } from '@/stores/instrumentStore';
import { TextScoreDialog } from './TextScoreDialog';

beforeEach(() => {
  useInstrumentStore.setState(useInstrumentStore.getInitialState(), true);
});

function renderDialog(overrides: Partial<Parameters<typeof TextScoreDialog>[0]> = {}) {
  const onImport = vi.fn();
  const onOpenChange = vi.fn();
  const user = userEvent.setup();
  render(
    <TextScoreDialog
      open
      initialTab="keyscore"
      onOpenChange={onOpenChange}
      onImport={onImport}
      {...overrides}
    />,
  );
  return { user, onImport, onOpenChange };
}

describe('TextScoreDialog', () => {
  it('默认内容解析成功，显示音数与时长，导入可用', async () => {
    const { user, onImport } = renderDialog();
    expect(await screen.findByText(/解析成功：5 个音/)).toBeInTheDocument();
    const importButton = screen.getByRole('button', { name: '导入' });
    expect(importButton).toBeEnabled();
    await user.click(importButton);
    expect(onImport).toHaveBeenCalledTimes(1);
    const [score, sourceId] = onImport.mock.calls[0];
    expect(score.meta).toMatchObject({ title: '未命名乐谱', source: 'keyscore' });
    expect(sourceId).toBe('windsong-lyre');
  });

  it('解析错误显示行列号、出错行原文与 ^ 标记，导入禁用', async () => {
    const { user } = renderDialog();
    const textarea = screen.getByLabelText('乐谱文本');
    await user.clear(textarea);
    await user.type(textarea, 'Q W E K');
    expect(await screen.findByText(/来源乐器「风物之诗琴」没有按键「K」/)).toBeInTheDocument();
    expect(screen.getByText('第 1 行第 7 列')).toBeInTheDocument();
    const pre = screen.getByText((_, element) => element?.tagName === 'PRE');
    expect(pre.textContent).toMatch(/^Q W E K\n {6}\^$/);
    expect(screen.getByRole('button', { name: '导入' })).toBeDisabled();
  });

  it('简谱标签下隐藏键盘谱选项，简谱可以解析', async () => {
    const { user } = renderDialog();
    await user.click(screen.getByRole('tab', { name: '简谱' }));
    await waitFor(() => expect(screen.queryByLabelText('来源乐器')).not.toBeInTheDocument());
    const textarea = screen.getByLabelText('乐谱文本');
    await user.clear(textarea);
    await user.type(textarea, '1 1 5 5');
    expect(await screen.findByText(/解析成功：4 个音/)).toBeInTheDocument();
  });

  it('清空文本时隐藏解析反馈并禁用导入', async () => {
    const { user } = renderDialog();
    await screen.findByText(/解析成功/);
    await user.clear(screen.getByLabelText('乐谱文本'));
    await waitFor(() => expect(screen.queryByText(/解析成功/)).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '导入' })).toBeDisabled();
  });

  it('点击取消调用 onOpenChange(false)', async () => {
    const { user, onOpenChange } = renderDialog();
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('预填标题与文本（.txt 导入场景）', async () => {
    renderDialog({ preset: { title: '小星星', text: 'Q W E' } });
    expect(await screen.findByLabelText('标题')).toHaveValue('小星星');
    expect(screen.getByLabelText('乐谱文本')).toHaveValue('Q W E');
    expect(within(screen.getByRole('dialog')).getByText(/解析成功：3 个音/)).toBeInTheDocument();
  });
});
