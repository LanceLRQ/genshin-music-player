import { BookOpen, type LucideIcon, Monitor, Moon, Music, PanelLeft, Piano, Settings, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { STATUS_DOT_CLASS, isPlayerActive, playerStateLabel, playerStateTone } from '@/lib/playerStatus';
import type { ThemeMode } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { useEnvStore } from '@/stores/envStore';
import { type PageId, useNavigationStore } from '@/stores/navigationStore';
import { useThemeStore } from '@/stores/themeStore';
import { useTransportStore } from '@/stores/transportStore';

const NAV_ITEMS: { page: PageId; label: string; icon: LucideIcon }[] = [
  { page: 'play', label: '演奏', icon: Music },
  { page: 'instruments', label: '乐器', icon: Piano },
  { page: 'settings', label: '设置', icon: Settings },
  { page: 'help', label: '帮助', icon: BookOpen },
];

function StatusDot({ className }: { className: string }) {
  return <span aria-hidden className={cn('size-2 shrink-0 rounded-full', className)} />;
}

function PlayStatusDot() {
  const playerState = useTransportStore((state) => state.playerState);
  return (
    <span
      role="img"
      aria-label={`演奏状态：${playerStateLabel(playerState)}`}
      className={cn(
        'pointer-events-none absolute top-1.5 left-5 size-2 rounded-full ring-2 ring-sidebar',
        STATUS_DOT_CLASS[playerStateTone(playerState)],
        playerState.kind === 'waitingFocus' && 'animate-pulse',
      )}
    />
  );
}

function BackendStatus() {
  const env = useEnvStore((state) => state.env);
  const status = useEnvStore((state) => state.status);

  if (!env) {
    const failed = status === 'error';
    return (
      <div className="flex items-center gap-2">
        <StatusDot className={failed ? STATUS_DOT_CLASS.red : STATUS_DOT_CLASS.gray} />
        <span>{failed ? '未连接后端' : '正在连接后端…'}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <StatusDot className={env.backend === 'mock' ? STATUS_DOT_CLASS.gray : STATUS_DOT_CLASS.green} />
      <span>{env.backend === 'windows' ? 'Windows' : env.backend === 'macos' ? 'macOS' : '模拟模式'}</span>
      {env.platform === 'windows' && (
        <span className={cn('truncate', !env.elevated && 'font-medium text-destructive')}>
          管理员 {env.elevated ? '✓' : '✗'}
        </span>
      )}
    </div>
  );
}

const THEME_MODE_META: Record<ThemeMode, { label: string; icon: LucideIcon }> = {
  system: { label: '跟随系统', icon: Monitor },
  light: { label: '浅色', icon: Sun },
  dark: { label: '深色', icon: Moon },
};

/** 主题切换按钮：点击循环切换跟随系统 / 浅色 / 深色；收起为图标模式时靠 tooltip 显示说明 */
function ThemeToggleButton() {
  const mode = useThemeStore((state) => state.mode);
  const cycleMode = useThemeStore((state) => state.cycleMode);
  const { label, icon: Icon } = THEME_MODE_META[mode];
  const description = `切换主题（当前：${label}）`;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton tooltip={description} onClick={cycleMode}>
        <Icon />
        <span>主题：{label}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/** 左侧边栏：三个页面入口；底部显示后端与管理员状态，以及主题切换按钮 */
export function AppSidebar() {
  const page = useNavigationStore((state) => state.page);
  const navigate = useNavigationStore((state) => state.navigate);
  const playerActive = useTransportStore((state) => isPlayerActive(state.playerState));
  const { toggleSidebar } = useSidebar();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="size-8" aria-label="展开或收起侧边栏" onClick={toggleSidebar}>
            <PanelLeft />
          </Button>
          <span className="truncate text-sm font-semibold group-data-[collapsible=icon]:hidden">原琴模拟器</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => (
                <SidebarMenuItem key={item.page}>
                  <SidebarMenuButton
                    isActive={page === item.page}
                    tooltip={item.label}
                    onClick={() => void navigate(item.page)}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                  {item.page === 'play' && playerActive && page !== 'play' && <PlayStatusDot />}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="gap-2 p-0">
        <div className="p-4 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
          <BackendStatus />
        </div>
        <SidebarMenu className="p-2">
          <ThemeToggleButton />
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
