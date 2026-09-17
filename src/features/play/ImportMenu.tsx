import { ChevronDown, FileMusic, FileText, FolderOpen, Keyboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DEFAULT_SETTINGS } from '@/ipc/types';
import { displayShortcut, guessPlatform } from '@/lib/shortcuts';
import { useEnvStore } from '@/stores/envStore';
import { useSettingsStore } from '@/stores/settingsStore';

/** 文本乐谱对话框的标签页：键盘谱或简谱 */
export type TextScoreTab = 'keyscore' | 'jianpu';

interface ImportMenuProps {
  disabled?: boolean;
  onOpenFile: () => void;
  onPasteText: (tab: TextScoreTab) => void;
}

/** 左栏顶部的导入菜单（设计 01 第 4.2 节） */
export function ImportMenu({ disabled, onOpenFile, onPasteText }: ImportMenuProps) {
  const openFileShortcut = useSettingsStore(
    (state) => state.settings?.shortcuts.openFile ?? DEFAULT_SETTINGS.shortcuts.openFile,
  );
  const envPlatform = useEnvStore((state) => state.env?.platform);
  const platform = envPlatform ?? guessPlatform(navigator.userAgent);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5" disabled={disabled}>
          <FileMusic className="size-4" />
          导入
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuItem onSelect={onOpenFile}>
          <FolderOpen />
          打开文件…
          <DropdownMenuShortcut>{displayShortcut(openFileShortcut, platform)}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onPasteText('keyscore')}>
          <Keyboard />
          粘贴键盘谱…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onPasteText('jianpu')}>
          <FileText />
          粘贴简谱…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
