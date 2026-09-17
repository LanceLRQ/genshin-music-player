import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['dist', 'coverage', 'src-tauri', 'target']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
  },
  {
    // shadcn 生成的文件保持原样、不手动修改：sidebar.tsx 的骨架屏在 useMemo 中取随机宽度、
    // use-mobile.ts 在 effect 中同步初始值，都会被 React Compiler 相关规则判为错误，所以只对手写代码启用 hooks 规则
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/components/ui/**', 'src/hooks/use-mobile.ts'],
    extends: [reactHooks.configs.flat.recommended],
  },
]);
