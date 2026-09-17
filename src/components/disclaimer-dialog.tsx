import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useDisclaimerStore } from '@/stores/disclaimerStore';

const DISCLAIMER_ITEMS = [
  '本软件是非官方工具，与米哈游没有任何关联；',
  '游戏的用户协议禁止第三方脚本，使用本软件有账号受限的风险，风险由使用者自行承担；',
  '本软件只模拟键盘输入，不读写游戏内存，不修改游戏文件；',
  '请只演奏原创曲目或你有权使用的曲目。',
];

/** 首次启动的风险提示：未确认前不能关闭（点击外部、按 Esc 都无效），勾选"我已了解上述风险"后才能开始使用 */
export function DisclaimerDialog() {
  const open = useDisclaimerStore((state) => state.open);
  const accepted = useDisclaimerStore((state) => state.accepted);
  const accept = useDisclaimerStore((state) => state.accept);
  const close = useDisclaimerStore((state) => state.close);
  const [checked, setChecked] = useState(false);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>使用前请阅读</AlertDialogTitle>
          <AlertDialogDescription>首次使用本软件前，请确认以下事项。</AlertDialogDescription>
        </AlertDialogHeader>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          {DISCLAIMER_ITEMS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
        {accepted ? (
          <AlertDialogFooter>
            <AlertDialogAction onClick={close}>关闭</AlertDialogAction>
          </AlertDialogFooter>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Checkbox
                id="disclaimer-accepted"
                checked={checked}
                onCheckedChange={(value) => setChecked(value === true)}
              />
              <Label htmlFor="disclaimer-accepted">我已了解上述风险</Label>
            </div>
            <AlertDialogFooter>
              <AlertDialogAction disabled={!checked} onClick={accept}>
                开始使用
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
