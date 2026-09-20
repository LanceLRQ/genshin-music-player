# Genshin Music Player

> 通过模拟键盘输入，自动演奏《原神》乐器的桌面工具（Tauri + React + Rust）。

## 项目一句话定义

把 MIDI、键盘谱、简谱或 JSON 谱转换成原神乐器的按键时间线，在 Windows 上通过系统键盘输入 API 自动演奏。类比：一个"会弹原神乐器的 MIDI 播放器"。

它**不是**外挂：不读写游戏内存、不注入、不修改客户端、不打开游戏进程句柄，也不做任何网络交互。

## 核心设计要点

- **只模拟键盘**：Windows 上用 `SendInput` 发送扫描码；前台窗口检测只读取窗口类名和标题。
- **乐器配置数据化**：乐器是 JSON 配置（键位、音高或音色、按住时长），兼容三行诗琴、两行新乐器和敲击类乐器，用户可以自己新建。
- **TS 负责编排，Rust 负责执行**：前端完成乐谱解析、适配和自动推荐；Rust 生成执行时间线（变速、节奏人性化、区间），在独立线程中高精度调度。试听和实际演奏使用同一份时间线。
- **输入后端可替换**：Windows 用 `SendInput`、macOS 用 CGEvent（需辅助功能权限）真实发键，其余平台用 Mock 后端（只记录执行日志）；macOS 还支持「模拟发声」模式——不发键、用本窗口合成音色试听。
- **多轨**：可以选择多条音轨合并演奏，也可以单独试听或演奏某一轨；合并时同一时刻重复的音只按一次（音高类按键位判重，敲击类按声音判重）。
- **安全底线**：开始前倒计时、全局热键、游戏窗口失去前台时自动暂停并松开所有按键。

## 技术栈

- **桌面框架**：Tauri 2
- **前端**：React 19、TypeScript 5.9、Vite 7；zod 4 做数据校验；`@tonejs/midi` 解析 MIDI；vitest 4 做测试
- **界面**：shadcn/ui + Tailwind CSS + lucide-react
- **后端**：Rust（`windows` crate、`tauri-plugin-global-shortcut` / `dialog` / `fs`、`rand_chacha`）
- **工具**：pnpm 11、ESLint 10、GitHub Actions（前端、macOS、Windows 三个任务）

## 实现现状

- [x] 调研与设计规格：`docs/superpowers/specs/2026-09-17-genshin-musician-design.md`
- [x] 工程脚手架 + TS 核心（乐谱解析、乐器配置、适配、自动推荐）
- [x] Rust 执行核心（执行时间线、调度器、Windows 与 Mock 输入后端、验证工具）
- [x] Tauri 应用与界面（应用壳、演奏页、乐器页、设置页；macOS CGEvent 后端与「模拟发声」模式）
- [x] 使用文档与测试素材
- [ ] Windows 真机验证收尾（音高录音定标、循环衔接听感、游戏提权组合；详细台账在 `docs/_internal/audit/windows-真机验证清单.md`）

## 仓库结构

以实际代码为准：

```
docs/                     使用者文档（使用指南、乐谱语法、乐器配置格式、音频转 MIDI 指南）
docs/development.md       开发文档（构建、常用命令、乐器实测校准）
docs/superpowers/specs/   设计规格
shared/                   前端和 Rust 共用的 JSON（键码表、内置乐器配置）
src/core/                 纯 TS 核心：乐谱解析、乐器配置、适配算法、自动推荐
src/                      React 界面
src-tauri/                Tauri 应用壳：IPC、设置、自定义乐器存储、热键
crates/player-core/       Rust 执行核心：执行时间线、调度器、输入后端、前台检测
crates/gm-verify/         命令行验证工具（真机验证用）
```

## 常用命令

```bash
pnpm install              # 安装依赖
pnpm dev                  # 启动前端开发服务器（端口 1420）
pnpm test                 # 运行 vitest
pnpm test:coverage        # 测试 + 覆盖率（src/core 要求 ≥ 80%）
pnpm lint                 # ESLint
pnpm typecheck            # TypeScript 类型检查
pnpm build                # 类型检查 + 前端构建
cargo test --workspace    # Rust 测试
pnpm tauri dev            # 启动桌面应用
```
