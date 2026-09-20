# 开发文档

面向从源码构建和参与开发的人。日常使用看[使用指南](guides/user-guide.md)，功能与平台支持看 [README](../README.md)。

## 环境要求

- Node.js 24、pnpm 11、Rust stable
- Windows：还需要 Visual Studio 的「使用 C++ 的桌面开发」工作负载（MSVC 编译器 + Windows SDK）。`cargo` 命令请在 PowerShell 或「Developer PowerShell for VS」里执行——Git Bash 自带的 `link.exe`（coreutils）会遮蔽 MSVC 链接器，直接在 Git Bash 里跑会链接失败

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

## 仓库结构

以实际代码为准：

```
docs/                     使用者文档（使用指南、乐谱语法、乐器配置格式、音频转 MIDI 指南）
docs/development.md       本文档
docs/superpowers/specs/   设计规格（交互与架构决策记录）
shared/                   前端和 Rust 共用的 JSON（键码表、内置乐器配置）
src/core/                 纯 TS 核心：乐谱解析、乐器配置、适配算法、自动推荐
src/                      React 界面
src-tauri/                Tauri 应用壳：IPC、设置、自定义乐器存储、热键
crates/player-core/       Rust 执行核心：执行时间线、调度器、输入后端、前台检测
crates/gm-verify/         命令行验证工具（真机验证用）
```

## 乐器实测校准（gm-verify）

乐器配置里的按住时长、最小重复间隔和音高都需要在实际游戏里确认。这一节用到的 `gm-verify` 不随软件分发，先按上面的环境要求装好工具链，在仓库根目录运行（`<id>` 换成乐器 id）：

```bash
cargo run -p gm-verify --release -- pattern scale --instrument windsong-lyre
```

Windows 上要在**以管理员身份打开的终端**里执行，否则按键可能被系统拦截而看不出问题。

### 按住时长与最小重复间隔

`repeat` 测试样例会用固定的九档间隔（200 / 150 / 100 / 80 / 60 / 50 / 40 / 30 / 20ms，每档连打 5 次）连续按同一个键；`--gap` 传给的是生成执行时间线时使用的 `minRepeatGapMs`——间隔小于这个值的按键会在发送前就被直接丢弃，不会真的发到游戏里。所以**不要**用调低 `--gap` 的方式去试探每一档，而是先把 `--gap` 设成 `0`，让九档全部真实发送：

```bash
cargo run -p gm-verify --release -- pattern repeat --instrument windsong-lyre --gap 0
```

对着游戏数每一档实际听到几次响声，找到「5 次都响」的最短那一档对应的间隔，加上一点余量后写回配置的 `timing.minRepeatGapMs`。建议在游戏帧率上限调到 60 和 30 时各测一次，取两者中更保守（更大）的值。

按住时长用 `scale` 样例配合 `--hold` 测试，从当前值往下试：

```bash
cargo run -p gm-verify --release -- pattern scale --instrument windsong-lyre --hold 15
```

依次尝试 30 → 20 → 15 → 10 → 5，找到每个键仍然都能正常发声的最小值，同样在 60 帧和 30 帧下各测一次，取更保守的值写回 `timing.holdMs`。

### 音高

`scale` 样例会按行、按键顺序逐个弹奏。对着游戏录音，再用调音器或[从音频提取 MIDI](guides/audio-to-midi.md)里介绍的转录工具（比如 Basic Pitch）识别出实际音高，和配置里的 `pitch` 对照，不一致就改成实测值。全部键确认无误后，把配置的 `status` 改成 `"verified"`。

### 敲击类乐器的音色

用调音器分辨不同鼓面敲击出的音色差异比较困难，更适合直接凭听感和节奏位置判断「咚」和「咔」对应哪个键，再用 `chord` / `scale` 样例逐键确认：

```bash
cargo run -p gm-verify --release -- pattern chord --instrument <id>
```
