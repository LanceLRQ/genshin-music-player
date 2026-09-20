import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { BUILTIN_INSTRUMENTS } from '@/core/instruments/registry';
import { useInstrumentStore } from '@/stores/instrumentStore';
import { HelpPage } from './HelpPage';

const SECTION_TITLES = ['使用指南', '常见问题', '乐器参数', '键盘谱语法', '简谱语法', '乐器配置格式', '从音频提取 MIDI', '开发文档'];

/** 章节目录按钮都在左侧 nav 里；正文里还有同名锚点按钮，查询要限定范围 */
const nav = () => within(screen.getByRole('navigation', { name: '帮助目录' }));

beforeEach(() => {
  useInstrumentStore.setState(useInstrumentStore.getInitialState(), true);
});

describe('HelpPage', () => {
  it('默认打开使用指南，渲染标题、目录锚点和表格', () => {
    render(<HelpPage />);
    expect(screen.getByRole('heading', { name: '使用指南', level: 1 })).toBeInTheDocument();
    expect(screen.getAllByRole('table').length).toBeGreaterThan(0);
    // 文内目录的锚点链接渲染成了可点按钮
    expect(screen.getByRole('button', { name: '快速上手' })).toBeInTheDocument();
  });

  it('左侧目录列出全部章节', () => {
    render(<HelpPage />);
    for (const title of SECTION_TITLES) expect(nav().getByRole('button', { name: title })).toBeInTheDocument();
  });

  it('常见问题章节显示使用指南里抽出的问题', async () => {
    const user = userEvent.setup();
    render(<HelpPage />);
    await user.click(nav().getByRole('button', { name: '常见问题' }));
    expect(screen.getByText(/命中率很低怎么办/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '使用指南', level: 1 })).not.toBeInTheDocument();
  });

  it('乐器参数章节默认显示第一件内置乐器的参数速查', async () => {
    const user = userEvent.setup();
    render(<HelpPage />);
    await user.click(nav().getByRole('button', { name: '乐器参数' }));

    const lyre = BUILTIN_INSTRUMENTS[0]; // 风物之诗琴
    expect(screen.getByText(lyre.name)).toBeInTheDocument();
    expect(screen.getByText('3 行 · 21 键')).toBeInTheDocument();
    expect(screen.getAllByText(/按住时长/).length).toBeGreaterThan(0);
    // 第一行高音：Q 键定音 C5（MIDI 72）
    expect(screen.getByText('Q')).toBeInTheDocument();
    expect(screen.getAllByText('C5').length).toBeGreaterThan(0);
  });

  it('敲击类乐器显示音色键位与鼓映射表', async () => {
    const drum = BUILTIN_INSTRUMENTS.find((profile) => profile.kind === 'percussion')!;
    useInstrumentStore.setState({
      entries: [{ profile: drum, builtin: true }],
    });
    const user = userEvent.setup();
    render(<HelpPage />);
    await user.click(nav().getByRole('button', { name: '乐器参数' }));

    expect(screen.getByText('敲击类')).toBeInTheDocument();
    expect(screen.getAllByText('咚').length).toBeGreaterThan(0);
    expect(screen.getByText(/鼓映射表/)).toBeInTheDocument();
    expect(screen.getByText(/自动（按音轨音高的中位数）/)).toBeInTheDocument();
  });

  it('文档里的 .md 链接跳转到对应章节，README 降级为普通文本', async () => {
    const user = userEvent.setup();
    render(<HelpPage />);

    // README 没有收录进帮助页，渲染成不可点的说明文字（先在使用指南页断言，再跳走）
    expect(screen.getAllByText('README').length).toBeGreaterThan(0);
    for (const readme of screen.getAllByText('README')) {
      expect(readme.closest('a')).toBeNull();
      expect(readme.closest('button')).toBeNull();
    }

    // 正文里的「键盘谱语法」链接（目录按钮之外还有正文链接，点最后一个）
    const docLinks = screen.getAllByRole('button', { name: '键盘谱语法' });
    expect(docLinks.length).toBeGreaterThan(1);
    await user.click(docLinks[docLinks.length - 1]);
    expect(screen.getByRole('heading', { name: '键盘谱语法', level: 1 })).toBeInTheDocument();
  });

  it('文内锚点点击不切章节也不报错', async () => {
    const user = userEvent.setup();
    render(<HelpPage />);
    await user.click(screen.getByRole('button', { name: '界面总览' }));
    expect(screen.getByRole('heading', { name: '使用指南', level: 1 })).toBeInTheDocument();
  });
});
