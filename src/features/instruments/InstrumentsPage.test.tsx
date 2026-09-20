import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { BUILTIN_INSTRUMENTS } from '@/core/instruments/registry';
import type { InstrumentProfile } from '@/core/model/instrument';
import { useInstrumentStore } from '@/stores/instrumentStore';
import { useNavigationStore } from '@/stores/navigationStore';
import { InstrumentsPage } from './InstrumentsPage';

vi.mock('@/audio/previewPlayer', () => ({
  previewPlayer: { playKey: vi.fn(), start: vi.fn(), stop: vi.fn() },
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ readTextFile: vi.fn(), writeTextFile: vi.fn() }));

const lyre = BUILTIN_INSTRUMENTS[0];
const myLyre: InstrumentProfile = { ...structuredClone(lyre), id: 'my-lyre', name: '我的琴', status: 'unverified', timing: { holdMs: 35, minRepeatGapMs: 45, sustain: false } };

/** customs 在测试里可变：save / delete 处理器直接改它，模拟后端数据目录 */
let customs: InstrumentProfile[];
let warnings: string[];

function mockBackend() {
  mockIPC((cmd, args) => {
    if (cmd === 'save_custom_instrument') {
      customs = customs.filter((profile) => profile.id !== (args as { profile: InstrumentProfile }).profile.id);
      customs.push(structuredClone((args as { profile: InstrumentProfile }).profile));
      return null;
    }
    if (cmd === 'delete_custom_instrument') {
      const id = (args as { id: string }).id;
      customs = customs.filter((profile) => profile.id !== id);
      return null;
    }
    if (cmd === 'list_custom_instruments') return { profiles: structuredClone(customs), warnings: [...warnings] };
    return null;
  });
}

beforeEach(() => {
  customs = [];
  warnings = [];
  useInstrumentStore.setState(useInstrumentStore.getInitialState(), true);
  useNavigationStore.setState(useNavigationStore.getInitialState(), true);
});

afterEach(() => {
  clearMocks();
  vi.restoreAllMocks();
});

async function renderPage() {
  mockBackend();
  await useInstrumentStore.getState().load();
  return { user: userEvent.setup(), ...render(<InstrumentsPage />) };
}

describe('InstrumentsPage 列表与详情', () => {
  it('列表分内置与自定义分组并显示徽章', async () => {
    await renderPage();
    // 默认选中内置的风物之诗琴，所以"内置"出现两次（列表分组标签 + 详情元信息），
    // "自定义"只出现一次（列表分组标签，自定义列表为空）
    expect(screen.getAllByText('内置')).toHaveLength(2);
    expect(screen.getAllByText('自定义')).toHaveLength(1);
    expect(screen.getByText('还没有自定义乐器')).toBeInTheDocument();
    // 乐器名称同样在列表项与详情标题各出现一次
    expect(screen.getAllByText('风物之诗琴')).toHaveLength(2);
    expect(screen.getByText('荒泷·盛世豪鼓')).toBeInTheDocument();
    // 三件敲击类：荒泷·盛世豪鼓、聚聚鼓、绮筵之鼓
    expect(screen.getAllByText('敲击')).toHaveLength(3);
    // 12 件内置乐器均已于 2026-09-19 游戏内实测，列表不应再出现待实测徽章
    expect(screen.queryByText('待实测')).toBeNull();
  });

  it('详情显示元信息、时值行与虚拟琴键预览，点击键帽试听', async () => {
    const { previewPlayer } = await import('@/audio/previewPlayer');
    const { user } = await renderPage();
    expect(screen.getByText('音高类')).toBeInTheDocument();
    expect(screen.getByText('已验证')).toBeInTheDocument();
    expect(screen.getByText('windsong-lyre')).toBeInTheDocument();
    expect(screen.getByText('虚拟琴键预览（点击试听）')).toBeInTheDocument();
    expect(screen.getByText('按住时长 30ms · 最小重复间隔 75ms · 不可持续发声')).toBeInTheDocument();
    await user.click(screen.getByText('C5'));
    expect(previewPlayer.playKey).toHaveBeenCalled();
  });

  it('敲击乐器显示只读鼓映射表与分界音高', async () => {
    const { user } = await renderPage();
    await user.click(screen.getByText('荒泷·盛世豪鼓'));
    expect(screen.getByText('鼓映射表')).toBeInTheDocument();
    // GM 默认映射 35、36 都是咚：鼓映射表贡献 2 个，键帽预览（KeyS → don）再贡献 1 个
    expect(screen.getAllByText('咚')).toHaveLength(3);
    expect(screen.getByText('分界音高：自动（中位数）')).toBeInTheDocument();
    expect(screen.getByText('按住时长 30ms · 最小重复间隔 96ms · 不可持续发声')).toBeInTheDocument();
  });

  it('无法读取的自定义乐器文件显示警告并可展开', async () => {
    warnings = ['跳过无法解析的文件 bad.json', '跳过无法解析的文件 worse.json'];
    customs = [{ ...myLyre }];
    await renderPage();
    // 警告只影响读取失败的文件，合法的自定义乐器照常加载
    expect(screen.getByText('我的琴')).toBeInTheDocument();
    // 待实测徽章由自定义乐器承载（内置乐器已全部实测）
    expect(screen.getAllByText('待实测')).toHaveLength(1);
    await userEvent.setup().click(screen.getByRole('button', { name: '有 2 个自定义乐器文件无法读取' }));
    expect(screen.getByText('跳过无法解析的文件 bad.json')).toBeInTheDocument();
    expect(screen.getByText('跳过无法解析的文件 worse.json')).toBeInTheDocument();
  });

  it('复制为自定义后保存并进入编辑器', async () => {
    await renderPage();
    await userEvent.setup().click(screen.getByRole('button', { name: '复制为自定义' }));
    expect(await screen.findByText('风物之诗琴（副本）')).toBeInTheDocument();
    expect(screen.getByLabelText('名称')).toHaveValue('风物之诗琴（副本）');
    expect(screen.getByLabelText('ID')).toHaveValue('windsong-lyre-custom');
  });

  it('删除自定义乐器需要确认', async () => {
    customs = [{ ...myLyre }];
    const spy = vi.spyOn(toast, 'success');
    const { user } = await renderPage();
    await user.click(screen.getByText('我的琴'));
    await user.click(screen.getByRole('button', { name: '删除' }));
    const dialog = screen.getByRole('alertdialog', { name: '删除「我的琴」？' });
    expect(dialog).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '取消' }));
    // 取消后乐器仍在：列表项与详情标题各出现一次
    expect(screen.getAllByText('我的琴')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: '删除' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: /^删除$/ }));
    await waitFor(() => expect(screen.getByText('还没有自定义乐器')).toBeInTheDocument());
    expect(spy).toHaveBeenCalledWith('已删除自定义乐器');
  });

  it('有未保存修改时切换乐器先确认', async () => {
    customs = [{ ...myLyre }];
    const { user } = await renderPage();
    await user.click(screen.getByText('我的琴'));
    await user.click(screen.getByRole('button', { name: '编辑' }));
    await user.type(screen.getByLabelText('名称'), '二');
    await user.click(screen.getByText('风物之诗琴'));
    expect(screen.getByRole('alertdialog', { name: '有未保存的修改' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(screen.getByLabelText('名称')).toHaveValue('我的琴二');
    await user.click(screen.getByText('风物之诗琴'));
    await user.click(screen.getByRole('button', { name: '放弃修改并离开' }));
    await waitFor(() => expect(screen.getByText('虚拟琴键预览（点击试听）')).toBeInTheDocument());
    expect(screen.queryByLabelText('名称')).not.toBeInTheDocument();
  });

  it('有未保存修改时切换页面被拦截，确认后放行', async () => {
    customs = [{ ...myLyre }];
    const { user } = await renderPage();
    // 测试直接渲染乐器页，把导航状态同步到乐器页再发起跳转
    useNavigationStore.setState({ page: 'instruments' });
    await user.click(screen.getByText('我的琴'));
    await user.click(screen.getByRole('button', { name: '编辑' }));
    await user.type(screen.getByLabelText('名称'), '二');
    act(() => {
      void useNavigationStore.getState().navigate('settings');
    });
    expect(await screen.findByRole('alertdialog', { name: '有未保存的修改' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '继续编辑' }));
    await waitFor(() => expect(useNavigationStore.getState().page).toBe('instruments'));
    act(() => {
      void useNavigationStore.getState().navigate('settings');
    });
    expect(await screen.findByRole('alertdialog', { name: '有未保存的修改' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '放弃修改并离开' }));
    await waitFor(() => expect(useNavigationStore.getState().page).toBe('settings'));
  });

  it('新建乐器进入编辑器且 ID 为 custom-时间戳', async () => {
    const { user } = await renderPage();
    await user.click(screen.getByRole('button', { name: '新建' }));
    expect(screen.getByText('新建乐器', { selector: 'h2' })).toBeInTheDocument();
    expect(screen.getByLabelText('名称')).toHaveValue('新建乐器');
    // jest-dom 的 toHaveValue 不支持正则，改为直接读取输入值匹配
    expect(screen.getByLabelText<HTMLInputElement>('ID').value).toMatch(/^custom-\d+$/);
    expect(screen.getByLabelText('ID')).toBeEnabled();
  });
});

describe('InstrumentsPage 导入与导出', () => {
  it('导入合法配置后保存并选中新乐器', async () => {
    vi.mocked(open).mockResolvedValue('/data/新琴.json');
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ ...myLyre, id: 'new-lyre', name: '新琴' }));
    const { user } = await renderPage();
    await user.click(screen.getByRole('button', { name: '导入 JSON' }));
    await waitFor(() => expect(useInstrumentStore.getState().selectedId).toBe('new-lyre'));
    // 导入后自动选中新乐器，名称在列表项与详情标题各出现一次
    expect(screen.getAllByText('新琴')).toHaveLength(2);
  });

  it('校验失败的文件用对话框列出全部错误', async () => {
    vi.mocked(open).mockResolvedValue('/data/broken.json');
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ schemaVersion: 1, id: 'BROKEN', name: '' }));
    const { user } = await renderPage();
    await user.click(screen.getByRole('button', { name: '导入 JSON' }));
    expect(await screen.findByRole('dialog', { name: '乐器配置校验失败' })).toBeInTheDocument();
    expect(screen.getByText(/id 只能包含小写字母、数字和连字符/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '知道了' }));
    expect(screen.queryByRole('dialog', { name: '乐器配置校验失败' })).not.toBeInTheDocument();
  });

  it('导入内置 ID 提示修改 ID', async () => {
    const spy = vi.spyOn(toast, 'error');
    vi.mocked(open).mockResolvedValue('/data/lyre.json');
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ ...myLyre, id: 'windsong-lyre' }));
    await renderPage();
    await userEvent.setup().click(screen.getByRole('button', { name: '导入 JSON' }));
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith('这个 ID 属于内置乐器，请修改 ID 后再导入'),
    );
  });

  it('导入同 ID 自定义乐器先确认覆盖', async () => {
    customs = [{ ...myLyre }];
    vi.mocked(open).mockResolvedValue('/data/my-lyre.json');
    vi.mocked(readTextFile).mockResolvedValue(JSON.stringify({ ...myLyre, name: '我的琴改' }));
    const { user } = await renderPage();
    await user.click(screen.getByRole('button', { name: '导入 JSON' }));
    expect(await screen.findByRole('alertdialog', { name: '覆盖已有乐器？' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '覆盖' }));
    // 覆盖后乐器被选中，名称在列表项与详情标题各出现一次
    await waitFor(() => expect(screen.getAllByText('我的琴改')).toHaveLength(2));
  });

  it('导出当前乐器为格式化 JSON', async () => {
    customs = [{ ...myLyre }];
    vi.mocked(save).mockResolvedValue('/out/我的琴.json');
    const { user } = await renderPage();
    await user.click(screen.getByText('我的琴'));
    await user.click(screen.getByRole('button', { name: '导出 JSON' }));
    await waitFor(() => expect(writeTextFile).toHaveBeenCalled());
    expect(writeTextFile).toHaveBeenCalledWith('/out/我的琴.json', JSON.stringify(myLyre, null, 2));
  });

  it('JSON 解析失败时提示原因', async () => {
    const spy = vi.spyOn(toast, 'error');
    vi.mocked(open).mockResolvedValue('/data/bad.json');
    vi.mocked(readTextFile).mockResolvedValue('{ not json');
    await renderPage();
    await userEvent.setup().click(screen.getByRole('button', { name: '导入 JSON' }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.stringMatching(/^JSON 解析失败：/)));
  });
});

describe('InstrumentsPage 顶栏按钮离开保护', () => {
  it('编辑器有未保存修改时点新建先确认，取消后仍停留在编辑', async () => {
    customs = [{ ...myLyre }];
    const { user } = await renderPage();
    await user.click(screen.getByText('我的琴'));
    await user.click(screen.getByRole('button', { name: '编辑' }));
    await user.type(screen.getByLabelText('名称'), '二');
    await user.click(screen.getByRole('button', { name: '新建' }));
    expect(screen.getByRole('alertdialog', { name: '有未保存的修改' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(screen.getByLabelText('名称')).toHaveValue('我的琴二');
  });

  it('编辑器有未保存修改时点导入 JSON 先确认，取消后仍停留在编辑', async () => {
    customs = [{ ...myLyre }];
    const { user } = await renderPage();
    await user.click(screen.getByText('我的琴'));
    await user.click(screen.getByRole('button', { name: '编辑' }));
    await user.type(screen.getByLabelText('名称'), '二');
    await user.click(screen.getByRole('button', { name: '导入 JSON' }));
    expect(screen.getByRole('alertdialog', { name: '有未保存的修改' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(screen.getByLabelText('名称')).toHaveValue('我的琴二');
  });
});
