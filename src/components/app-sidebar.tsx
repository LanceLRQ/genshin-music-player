import { type LucideIcon, Music, PanelLeft, Piano, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
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
import { guessPlatform, displayShortcut } from '@/lib/shortcuts';
import { STATUS_DOT_CLASS, isPlayerActive, playerStateLabel, playerStateTone } from '@/lib/playerStatus';
import { cn } from '@/lib/utils';
import { useEnvStore } from '@/stores/envStore';
import { type PageId, useNavigationStore } from '@/stores/navigationStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTransportStore } from '@/stores/transportStore';

const NAV_ITEMS: { page: PageId; label: string; icon: LucideIcon }[] = [
  { page: 'play', label: '演奏', icon: Music },
  { page: 'instruments', label: '乐器', icon: Piano },
  { page: 'settings', label: '设置', icon: Settings },
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
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <StatusDot className={env.backend === 'windows' ? STATUS_DOT_CLASS.green : STATUS_DOT_CLASS.gray} />
        <span>{env.backend === 'windows' ? 'Windows' : '模拟模式'}</span>
      </div>
      {env.platform === 'windows' && <span className="pl-4">管理员 {env.elevated ? '✓' : '✗'}</span>}
    </div>
  );
}

function HotkeyHints() {
  const hotkeys = useSettingsStore((state) => state.settings?.hotkeys);
  const envPlatform = useEnvStore((state) => state.env?.platform);
  if (!hotkeys) return null;
  const platform = envPlatform ?? guessPlatform(navigator.userAgent);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Kbd>{displayShortcut(hotkeys.toggle, platform)}</Kbd>
        <span>开始/暂停</span>
      </div>
      <div className="flex items-center gap-2">
        <Kbd>{displayShortcut(hotkeys.stop, platform)}</Kbd>
        <span>停止</span>
      </div>
    </div>
  );
}

/** 左侧边栏：三个页面入口；底部显示后端状态、管理员状态和全局热键 */
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
          <span className="truncate text-sm font-semibold group-data-[collapsible=icon]:hidden">Genshin Music Player</span>
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
      <SidebarFooter className="gap-3 p-4 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
        <BackendStatus />
        <HotkeyHints />
      </SidebarFooter>
    </Sidebar>
  );
}
