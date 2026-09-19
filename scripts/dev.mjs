// dev 命令包装：vite 前后清理 1420 端口的残留进程。
// 背景：Windows 上 Ctrl+C 结束 `tauri dev` / `pnpm dev` 时，pnpm shim → node → vite 的进程链
// 偶尔不会被整树带走，残留的 vite 占着 1420（strictPort），下次 dev 直接报 Port already in use。
// 两手清理：启动前杀掉占用 1420 的残留进程树；退出信号（SIGINT/SIGBREAK/SIGTERM）时结束自己拉起的 vite。
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const PORT = 1420;

/** 占用 port 的进程 pid 列表（去掉 0/4 和自己） */
function pidsOnPort(port) {
  const own = process.pid;
  const found = new Set();
  if (process.platform === 'win32') {
    // 注意：不要加 -p tcp，本地化 Windows 上它会漏掉 IPv6 的行
    const res = spawnSync('netstat', ['-ano'], { encoding: 'utf8' });
    for (const line of res.stdout.split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/);
      // TCP  [::1]:1420  [::]:0  LISTENING  17948
      if (cols.length === 5 && cols[3] === 'LISTENING') {
        const local = cols[1];
        const portPart = local.lastIndexOf(':');
        if (local.slice(portPart + 1) === String(port)) {
          const pid = Number(cols[4]);
          if (pid > 4 && pid !== own) found.add(pid);
        }
      }
    }
  } else {
    const res = spawnSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
    for (const line of res.stdout.split(/\r?\n/)) {
      const pid = Number(line);
      if (Number.isFinite(pid) && pid > 1 && pid !== own) found.add(pid);
    }
  }
  return [...found];
}

function killTree(pid) {
  if (process.platform === 'win32') {
    // /T 连同子进程一起结束；残留进程属于当前用户，无需提权
    const res = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8' });
    return res.status === 0;
  }
  try {
    process.kill(pid, 'SIGKILL');
    return true;
  } catch {
    return false;
  }
}

for (const pid of pidsOnPort(PORT)) {
  const killed = killTree(pid);
  console.log(`[dev] 端口 ${PORT} 被残留进程 ${pid} 占用，${killed ? '已结束' : '结束失败（可能已退出或无权限）'}`);
}

const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
const child = spawn(process.execPath, [viteBin], { stdio: 'inherit' });

let exiting = false;
function shutdown() {
  if (exiting) return;
  exiting = true;
  if (process.platform === 'win32') {
    // Windows 上 child.kill() 只能打到直接子进程，用 taskkill /T 收整棵树
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { encoding: 'utf8' });
  } else {
    child.kill('SIGTERM');
  }
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(signal, shutdown);
process.on('exit', () => {
  if (!exiting && child.exitCode === null) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { encoding: 'utf8' });
  }
});
child.on('exit', (code) => process.exit(code ?? 0));
