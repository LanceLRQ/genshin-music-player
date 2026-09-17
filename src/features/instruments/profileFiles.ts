import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { hasTauriRuntime } from '@/ipc/commands';

const JSON_FILTERS = [{ name: 'JSON', extensions: ['json'] }];

export interface PickedFile {
  fileName: string;
  text: string;
}

/** 选择并读取一个 JSON 文件；取消时返回 null。Tauri 用系统对话框，浏览器回退为 <input type="file"> */
export function pickJsonFile(): Promise<PickedFile | null> {
  if (hasTauriRuntime()) {
    return (async () => {
      const path = await open({ multiple: false, filters: JSON_FILTERS });
      if (typeof path !== 'string') return null;
      const fileName = path.split(/[\\/]/).pop() ?? path;
      return { fileName, text: await readTextFile(path) };
    })();
  }
  return pickWithInput();
}

function pickWithInput(): Promise<PickedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) {
        resolve(null);
        return;
      }
      void file.text().then((text) => resolve({ fileName: file.name, text }));
    });
    document.body.appendChild(input);
    input.click();
  });
}

/** 把内容写出为 JSON 文件，默认文件名 defaultName；取消或失败时返回 false。浏览器回退为下载链接 */
export async function writeJsonFile(defaultName: string, content: string): Promise<boolean> {
  if (hasTauriRuntime()) {
    const path = await save({ defaultPath: defaultName, filters: JSON_FILTERS });
    if (typeof path !== 'string') return false;
    await writeTextFile(path, content);
    return true;
  }
  downloadWithAnchor(defaultName, content);
  return true;
}

function downloadWithAnchor(fileName: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
