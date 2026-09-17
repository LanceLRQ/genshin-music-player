import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Rust 端的源码和编译产物变化不需要触发前端热更新
    watch: { ignored: ['**/src-tauri/**', '**/target/**'] },
  },
  build: {
    // 桌面应用从本地加载页面，不需要为网络传输拆分代码，调高体积警告的阈值
    chunkSizeWarningLimit: 2048,
  },
});
