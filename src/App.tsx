import { useEffect } from 'react';
import { AppSidebar } from '@/components/app-sidebar';
import { DisclaimerDialog } from '@/components/disclaimer-dialog';
import { EnvBanners } from '@/components/env-banners';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/sonner';
import { HelpPage } from '@/features/help/HelpPage';
import { InstrumentsPage } from '@/features/instruments/InstrumentsPage';
import { PlayPage } from '@/features/play/PlayPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { usePlayerEvents } from '@/hooks/usePlayerEvents';
import { useSoundModeHotkeys } from '@/hooks/useSoundModeHotkeys';
import { applyTheme } from '@/lib/theme';
import { useEnvStore } from '@/stores/envStore';
import { useInstrumentStore } from '@/stores/instrumentStore';
import { type PageId, useNavigationStore } from '@/stores/navigationStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useThemeStore } from '@/stores/themeStore';

function CurrentPage({ page }: { page: PageId }) {
  switch (page) {
    case 'play':
      return <PlayPage />;
    case 'instruments':
      return <InstrumentsPage />;
    case 'settings':
      return <SettingsPage />;
    case 'help':
      return <HelpPage />;
  }
}

export function App() {
  const page = useNavigationStore((state) => state.page);
  const themeMode = useThemeStore((state) => state.mode);
  usePlayerEvents();
  useSoundModeHotkeys();

  useEffect(() => {
    void useEnvStore.getState().load();
    void useSettingsStore.getState().load();
    void useInstrumentStore.getState().load();
  }, []);

  useEffect(() => applyTheme(themeMode), [themeMode]);

  return (
    <>
      <SidebarProvider className="h-svh overflow-hidden">
        <AppSidebar />
        <SidebarInset className="min-h-0 min-w-0">
          <EnvBanners />
          <div className="min-h-0 flex-1 overflow-auto">
            <CurrentPage page={page} />
          </div>
        </SidebarInset>
      </SidebarProvider>
      <DisclaimerDialog />
      <Toaster position="bottom-right" />
    </>
  );
}
