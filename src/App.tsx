import { useEffect } from 'react';
import { AppSidebar } from '@/components/app-sidebar';
import { DisclaimerDialog } from '@/components/disclaimer-dialog';
import { EnvBanners } from '@/components/env-banners';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/sonner';
import { InstrumentsPage } from '@/features/instruments/InstrumentsPage';
import { PlayPage } from '@/features/play/PlayPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { usePlayerEvents } from '@/hooks/usePlayerEvents';
import { useSoundModeHotkeys } from '@/hooks/useSoundModeHotkeys';
import { watchSystemTheme } from '@/lib/theme';
import { useEnvStore } from '@/stores/envStore';
import { useInstrumentStore } from '@/stores/instrumentStore';
import { type PageId, useNavigationStore } from '@/stores/navigationStore';
import { useSettingsStore } from '@/stores/settingsStore';

function CurrentPage({ page }: { page: PageId }) {
  switch (page) {
    case 'play':
      return <PlayPage />;
    case 'instruments':
      return <InstrumentsPage />;
    case 'settings':
      return <SettingsPage />;
  }
}

export function App() {
  const page = useNavigationStore((state) => state.page);
  usePlayerEvents();
  useSoundModeHotkeys();

  useEffect(() => {
    void useEnvStore.getState().load();
    void useSettingsStore.getState().load();
    void useInstrumentStore.getState().load();
  }, []);

  useEffect(() => watchSystemTheme(), []);

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
