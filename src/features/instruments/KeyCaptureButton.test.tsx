import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { KeyCaptureButton } from './KeyCaptureButton';

describe('KeyCaptureButton', () => {
  it('未设置时显示"未设置"，点击后进入捕获状态', async () => {
    const user = userEvent.setup();
    render(<KeyCaptureButton value={null} onCapture={() => undefined} />);
    const button = screen.getByRole('button', { name: '未设置' });
    await user.click(button);
    expect(screen.getByRole('button')).toHaveTextContent('请按下按键…（Esc 取消）');
  });

  it('捕获到键码表中的按键后回调并显示键帽', async () => {
    const user = userEvent.setup();
    const onCapture = vi.fn();
    render(<KeyCaptureButton value={null} onCapture={onCapture} />);
    await user.click(screen.getByRole('button', { name: '未设置' }));
    fireEvent.keyDown(screen.getByRole('button'), { code: 'KeyQ', key: 'q' });
    expect(onCapture).toHaveBeenCalledWith('KeyQ');
    expect(screen.getByRole('button')).not.toHaveTextContent('请按下按键');
    expect(screen.getByText('Q')).toBeInTheDocument();
  });

  it('按 Esc 取消捕获，保持原值', async () => {
    const user = userEvent.setup();
    const onCapture = vi.fn();
    render(<KeyCaptureButton value="KeyA" onCapture={onCapture} />);
    await user.click(screen.getByRole('button', { name: 'A' }));
    await user.keyboard('{Escape}');
    expect(onCapture).not.toHaveBeenCalled();
    expect(screen.getByRole('button')).toHaveTextContent('A');
    expect(screen.getByRole('button')).not.toHaveTextContent('请按下按键');
  });

  it('不支持的按键提示后继续等待，仍可捕获下一个键', async () => {
    const user = userEvent.setup();
    const onCapture = vi.fn();
    render(<KeyCaptureButton value={null} onCapture={onCapture} />);
    await user.click(screen.getByRole('button', { name: '未设置' }));
    fireEvent.keyDown(screen.getByRole('button'), { code: 'F13', key: 'F13' });
    expect(screen.getByRole('button')).toHaveTextContent('不支持这个按键');
    expect(onCapture).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('button'), { code: 'KeyS', key: 's' });
    expect(onCapture).toHaveBeenCalledWith('KeyS');
  });

  it('已有值时显示键码标签', () => {
    render(<KeyCaptureButton value="Space" onCapture={() => undefined} />);
    expect(screen.getByText('Space')).toBeInTheDocument();
  });

  it('value 变化后显示跟随新值，不再显示旧捕获的键码', async () => {
    const user = userEvent.setup();
    const onCapture = vi.fn();
    const { rerender } = render(<KeyCaptureButton value="KeyQ" onCapture={onCapture} />);
    await user.click(screen.getByRole('button', { name: 'Q' }));
    fireEvent.keyDown(document, { code: 'KeyS', key: 's' });
    expect(onCapture).toHaveBeenCalledWith('KeyS');
    // 父组件应用捕获结果，乐观显示与数据一致
    rerender(<KeyCaptureButton value="KeyS" onCapture={onCapture} />);
    expect(screen.getByText('S')).toBeInTheDocument();
    // 行的上移 / 下移 / 删除会复用同一位置的组件实例：value 换成别的键后显示必须跟着换
    rerender(<KeyCaptureButton value="KeyA" onCapture={onCapture} />);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.queryByText('S')).not.toBeInTheDocument();
  });

  it('两个按钮同时捕获时，一次按键只被先进入捕获态的按钮捕获', async () => {
    const onCaptureA = vi.fn();
    const onCaptureB = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <KeyCaptureButton value={null} onCapture={onCaptureA} />
        <KeyCaptureButton value={null} onCapture={onCaptureB} />
      </>,
    );
    const starts = screen.getAllByRole('button', { name: '未设置' });
    await user.click(starts[0]);
    await user.click(starts[1]);
    expect(screen.getAllByText('请按下按键…（Esc 取消）')).toHaveLength(2);
    fireEvent.keyDown(document, { code: 'KeyQ', key: 'q' });
    expect(onCaptureA).toHaveBeenCalledTimes(1);
    expect(onCaptureA).toHaveBeenCalledWith('KeyQ');
    expect(onCaptureB).not.toHaveBeenCalled();
    // 未抢到的按钮仍停留在捕获态
    expect(screen.getAllByText('请按下按键…（Esc 取消）')).toHaveLength(1);
  });
});
