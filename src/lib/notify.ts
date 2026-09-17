import { toast } from 'sonner';
import { toAppError } from '@/ipc/commands';

/** 用 toast 显示错误；context 描述正在做的操作，会作为前缀 */
export function notifyError(error: unknown, context?: string): void {
  const { message } = toAppError(error);
  toast.error(context ? `${context}：${message}` : message);
}
