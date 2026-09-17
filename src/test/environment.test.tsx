import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from '@/components/ui/button';

describe('界面测试环境', () => {
  it('在 jsdom 中渲染 shadcn 组件，并可以使用 jest-dom 断言', () => {
    render(<Button disabled>试听</Button>);
    expect(screen.getByRole('button', { name: '试听' })).toBeDisabled();
  });

  it('补齐了 jsdom 缺少的浏览器接口', () => {
    expect(window.matchMedia('(prefers-color-scheme: dark)').matches).toBe(false);
    expect(() => new ResizeObserver(() => undefined).observe(document.body)).not.toThrow();
    expect(document.body.hasPointerCapture(1)).toBe(false);
    expect(() => document.body.scrollIntoView()).not.toThrow();
  });

  it('每个测试结束后都会清理上一个测试的渲染结果', () => {
    expect(document.body).toBeEmptyDOMElement();
  });
});
