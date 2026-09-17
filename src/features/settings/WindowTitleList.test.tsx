import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { WindowTitleList } from './WindowTitleList';

describe('WindowTitleList', () => {
  it('渲染标题徽章，点击 × 删除', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<WindowTitleList titles={['原神', 'Genshin Impact']} onChange={onChange} />);
    expect(screen.getByText('原神')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '删除标题 原神' }));
    expect(onChange).toHaveBeenCalledWith(['Genshin Impact']);
  });

  it('只剩一个标题时删除按钮禁用', () => {
    render(<WindowTitleList titles={['原神']} onChange={() => undefined} />);
    expect(screen.getByRole('button', { name: '删除标题 原神' })).toBeDisabled();
  });

  it('添加按钮与回车都可以添加标题', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<WindowTitleList titles={['原神']} onChange={onChange} />);
    await user.type(screen.getByLabelText('新窗口标题'), '云·原神');
    await user.click(screen.getByRole('button', { name: '添加' }));
    expect(onChange).toHaveBeenLastCalledWith(['原神', '云·原神']);
    await user.type(screen.getByLabelText('新窗口标题'), '国际服{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(['原神', '国际服']);
  });

  it('重复标题不添加并提示', async () => {
    const onChange = vi.fn();
    const spy = vi.spyOn(toast, 'info');
    const user = userEvent.setup();
    render(<WindowTitleList titles={['原神']} onChange={onChange} />);
    await user.type(screen.getByLabelText('新窗口标题'), '原神');
    await user.click(screen.getByRole('button', { name: '添加' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('这个标题已经存在'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('空标题不添加', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<WindowTitleList titles={['原神']} onChange={onChange} />);
    await user.type(screen.getByLabelText('新窗口标题'), '   ');
    await user.click(screen.getByRole('button', { name: '添加' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
