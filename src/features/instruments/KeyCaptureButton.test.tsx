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
});
