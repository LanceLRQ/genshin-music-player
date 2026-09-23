# Genshin Music Player 设计规格

- 日期：2026-09-17
- 状态：待审查
- 仓库：`git@github.com:LanceLRQ/genshin-music-player.git`（`dev` 分支）

## 1. 背景与目标

用脚本自动演奏《原神》中的乐器。**只通过模拟键盘输入**实现，不读写内存、不注入、不修改客户端、不抓包。

需要兼容三类乐器：

| 类型 | 代表 | 特点 |
|---|---|---|
| 三行音高类 | 风物之诗琴、镜花之琴、老旧的诗琴 | 21 键，3 个八度 |
| 两行音高类 | 新乐器（开发中，未上线） | 14 键，2 个八度，高音谱号行 + 低音谱号行 |
| 敲击类 | 节庆鼓等 | 无音高，按音色区分（咚/咔） |

开发约束：当前没有 Windows 环境。开发分两阶段进行：

1. **Mac 开发阶段**：完成全部软件功能，真实发键以外的链路都用 Mock 后端验证；通过 GitHub Actions 保证 Windows 代码能编译、单元测试能通过。
2. **Windows 真机阶段**：按《真机验证文档》逐项验证，并校准乐器配置。

### 1.1 非目标

- 不读写游戏内存，不注入 DLL，不 hook，不修改客户端文件，不做任何网络交互。
- 不打开游戏进程句柄。前台检测只读取窗口类名和标题。
- 不做基于图像识别的音游活动自动打分。
- 第一版不支持 macOS 或云原神真实发键，不支持鼠标输入。

## 2. 需求决策汇总

| # | 决策 |
|---|---|
| 1 | 乐谱来源：**A. MIDI 文件**、**B. 键盘谱文本**、**C. 简谱文本 + 自定义 JSON 谱**。D（内置编辑器）列入路线图 |
| 2 | 音频提取 MIDI：**不集成**，只写外部工具操作文档 |
| 3 | Mac 版：Web Audio 试听 + 虚拟琴键可视化 + 执行日志；输入后端做成可替换的接口 |
| 4 | 乐器配置：内置乐器 + 界面改键 + 导入/导出 JSON + 用户新建自定义乐器 |
| 5 | 适配：自动推荐 + 手动微调，调整后可以立即试听并看到命中率 |
| 6 | 演奏控制：倒计时、全局热键、前台窗口检测、变速、节奏人性化、指定位置播放与区间循环。播放列表列入路线图 |
| 7 | 键盘谱：兼容社区常见写法，另加带节拍的扩展写法；导入时按"来源乐器"解析成音高，再适配到目标乐器 |
| 8 | 架构：**TS 负责编排 + Rust 负责执行**。最终执行时间线由 Rust 生成，同时返回前端试听 |

## 3. 技术栈

- 桌面框架：Tauri 2
- 前端：React + TypeScript + Vite；zod 做数据校验；`@tonejs/midi` 解析 MIDI；vitest 做测试
- 界面：shadcn/ui 组件 + Tailwind CSS 样式 + lucide-react 图标；状态管理用 zustand
- 后端：Rust；Windows API 用 `windows` crate；插件用 `tauri-plugin-global-shortcut`、`tauri-plugin-dialog`、`tauri-plugin-fs`；随机数用可设种子的 `rand_chacha`
- 包管理：pnpm
- 界面语言：第一版只有简体中文

## 4. 仓库结构

```
genshin-music-player/
├─ src/                          React 前端
│  ├─ core/                      纯 TS 逻辑，不依赖 React
│  │  ├─ model/                  类型定义 + zod schema
│  │  ├─ parsers/                midi.ts · keyscore.ts · jianpu.ts · jsonScore.ts
│  │  ├─ instruments/            乐器配置加载、校验、合并（内置 + 自定义）
│  │  └─ adapter/                推荐 · 音高映射 · 敲击映射 · 时间线生成 · 报告
│  ├─ audio/                     Web Audio 试听（合成音色）
│  ├─ ipc/                       Tauri 命令/事件的类型化封装
│  └─ features/                  import · adapt · player · instruments · settings
├─ src-tauri/                    Tauri 应用壳：命令、事件、存储、热键、提权重启
├─ crates/
│  ├─ player-core/               与 Tauri 无关的执行核心
│  │                             timeline · scheduler · clock · input · keymap · guard
│  └─ gm-verify/                 命令行验证工具（真机验证用）
├─ shared/
│  ├─ keycodes.json              键码 → 扫描码清单（前端和 Rust 共用同一份）
│  └─ instruments/*.json         内置乐器配置（前端和 gm-verify 共用）
├─ scripts/gen-test-assets.ts    生成测试 MIDI
├─ test-assets/                  生成出的测试 MIDI（音阶、和弦、连打、长曲）
├─ docs/
└─ .github/workflows/ci.yml
```

`player-core` 独立成 crate，原因有两个：一是不依赖 Tauri，在 Mac 上可以直接 `cargo test`；二是 `gm-verify` 可以复用它，而不必链接整个 Tauri。

## 5. 数据模型

### 5.1 乐谱 `Score`

所有输入格式解析后都转成这个统一结构。自定义 JSON 谱的文件格式也就是它，外面再加一个 `schemaVersion`。

```ts
interface Score {
  meta: { title: string; source: 'midi' | 'keyscore' | 'jianpu' | 'json'; bpm?: number };
  tracks: Track[];
}
interface Track { id: string; name: string; isDrum: boolean; notes: Note[] }
interface Note {
  startMs: number;      // 浮点毫秒，解析时已把 tempo 变化换算进来
  durationMs: number;
  pitch?: number;       // MIDI 音高号，60 = C4；音高类必填
  voice?: string;       // 敲击音色，如 'don' / 'ka'；敲击类必填
  velocity: number;     // 0..1
}
```

### 5.2 乐器配置 `InstrumentProfile`

```jsonc
{
  "schemaVersion": 1,
  "id": "windsong-lyre",            // kebab-case，全局唯一
  "name": "风物之诗琴",
  "kind": "pitched",                // "pitched" | "percussion"
  "category": "lyre",               // "lyre" | "drum" | "horn" | "vocal" | "custom"，缺省 "custom"；
                                     // 只有 "horn"、"vocal" 在游戏里按住持续发声
  "status": "verified",             // "verified" | "unverified"
  "rows": [
    { "label": "高音", "keys": [ { "pitch": 72, "code": "KeyQ" }, ... ] },
    { "label": "中音", "keys": [ ... ] },
    { "label": "低音", "keys": [ ... ] }
  ],
  "timing": { "holdMs": 30, "minRepeatGapMs": 40, "sustain": false },
  "percussionMap": {                // 仅敲击类乐器需要
    "drumNotes": { "35": "don", "36": "don", "38": "ka", ... },
    "splitPitch": "auto"            // 非鼓轨分界音高："auto"（取中位数）或具体数值
  }
}
```

校验规则（zod）：

- 同一个乐器内 `code` 不能重复。
- `kind = pitched` 时，每个键都必须有 `pitch`，且 `pitch` 不能重复。
- `kind = percussion` 时，每个键都必须有 `voice`，且 `voice` 不能重复；`percussionMap.drumNotes` 里引用的 voice 必须存在。
- `code` 必须在 `shared/keycodes.json` 中。
- `rows` 数量为 1–4，每行 1–12 个键。

内置配置是只读的，可以"复制为自定义"后再编辑。自定义配置保存在应用数据目录的 `instruments/<id>.json`；`id` 不能和内置乐器重复。

### 5.3 按键时间线 `KeyTimeline`（前端适配输出，交给 Rust 执行）

```ts
interface KeyTimeline {
  instrumentId: string;
  durationMs: number;
  minRepeatGapMs: number;             // 从乐器配置里带过来，Rust 变速后重新检查
  releaseGapMs?: number;              // 仅长音模式下设置：同键再次按下前至少提前松开的毫秒数（0–200，默认 40）
  presses: Press[];                   // 按 tMs 升序排列
}
interface Press {
  tMs: number;                        // 在乐谱中的时间
  codes: string[];                    // 同时按下的键；多个键表示和弦，发送时是原子操作
  holdMs: number;                     // 按住时长；按音长时取 timing.holdMs，固定时长时取 holdMsOverride ?? timing.holdMs
  sustainMs?: number;                 // 需要按音长按住时的目标音长（未经变速）；只在音长大于 holdMs 时设置
}
interface AdaptReport {
  total: number; played: number; folded: number;
  merged: number;   // 同一时刻映射到同一个键的音被合并为一次按键，不算丢音（合并多轨齐唱时很常见）
  dropped: { blackKey: number; outOfRange: number; polyphony: number; tooDense: number; unmappedDrum: number };
}
```

统计关系：`total = played + merged + dropped 各项之和`；命中率 = `(played + merged) / total`（total 为 0 时记为 0）。

这里用"按键动作"（press），而不是拆开的 down/up 事件，原因是：**变速只缩放按下的时间点，不缩放按住时长**。按住时长是游戏识别按键所需的物理下限，不能跟着速度变。

### 5.4 执行时间线 `ExecutionTimeline`（Rust 生成，返回前端试听）

```ts
interface ExecutionParams {
  speed: number;                                    // 0.5..2.0
  humanize: { maxJitterMs: number; seed: number };  // maxJitterMs 取 0..30，0 表示关闭
  range: { startMs: number; endMs: number; loop: boolean };  // 单位是乐谱时间
}
interface ExecutionTimeline {
  instrumentId: string;
  events: { tMs: number; up: string[]; down: string[] }[];   // 从 0 开始，同一时刻先处理 up 再处理 down
  durationMs: number;                               // 最后一个事件的时间；区间终点有限时至少为区间长度 / speed（保留尾部休止）
  sourceStartMs: number; speed: number;             // 用来把执行时间换算回乐谱时间，显示进度
  loop: boolean;                                    // 来自 range.loop，播放器据此决定是否循环
  dropped: number;                                  // 变速后因为按键过密被丢掉的数量
}
```

生成规则（`player-core::timeline`，纯函数）：

1. 截取范围：只保留 `range.startMs ≤ tMs < range.endMs` 的按键。
2. 变速：`t' = (tMs − startMs) / speed`。`holdMs` 本身不缩放；有 `sustainMs` 时，实际按住时长取 `max(holdMs, sustainMs / speed)`，保证按音长持续发声的乐器（晚风圆号、沃雅妮莎等）变速后仍能覆盖音符时值。加速后如果和下一次同键按下重叠，由第 4 步把松开时间提前。
3. 人性化：用种子初始化 `ChaCha8Rng`，给每个按键加一个 `[−maxJitterMs, +maxJitterMs]` 内的均匀随机偏移。一个和弦共用同一个偏移。偏移后不能小于 0。
4. 同键冲突处理：按键按时间重新排序后，检查同一个键的相邻两次按下（最小间隔取 `max(minRepeatGapMs, 2)`，保证松开时间能严格落在两次按下之间）：
   - 间隔小于最小间隔时，丢掉后一次，计入 `dropped`；
   - 提前量 `lead = max(releaseGapMs ?? 1, 1)`（`KeyTimeline.releaseGapMs` 未设置时退化为原来的 1ms）；前一次的松开时间晚于"下一次按下 − lead"时提前到该时刻，但不早于"前一次按下 + 原始 `holdMs`"（未被 `sustainMs` 放大的值，保证按住时长不会被压缩到下限以下），且始终严格早于下一次按下至少 1ms。
   - 循环播放时，本轮末尾的按键与下一轮开头的同键按下（回卷衔接）套用同一套提前松开规则；循环周期取回卷截短前确定的时长，避免松开间隔被重新算小的周期吃掉。
5. 把按键拆成 down/up 事件，时间相同的合并；同一时刻先处理 up 再处理 down。

## 6. 乐谱解析

### 6.1 MIDI（来源 A）

- 用 `@tonejs/midi` 解析，每个音轨生成一个 `Track`，`isDrum` 由第 10 通道（channel 9）判断。
- tempo 变化由库换算成秒，再转成毫秒。
- 空音轨丢弃；音轨名为空时用"音轨 N · 乐器名"作为名字。

### 6.2 键盘谱文本（来源 B）

规则摘要，完整语法见 `docs/formats/keyscore.md`：

| 语法 | 含义 |
|---|---|
| `@bpm=120` `@instrument=windsong-lyre` `@step=1/2` | 头部指令（可选）：速度、来源乐器、每个符号占几拍（默认 1/2 拍） |
| `Q` `w`（不区分大小写） | 一个音，占 1 个步长 |
| `QWE` | 连续字母表示依次弹奏的多个音 |
| `(QE)` 或 `[QE]` | 和弦，占 1 个步长 |
| `-` | 延长上一个音 1 个步长（不可持续发声的乐器上等同于休止） |
| `/` | 休止 1 个步长 |
| `\|` | 小节线，忽略 |
| 空格、换行 | 分隔符，不占时值。导入选项"空格视为休止"开启后，每个空格占 1 个步长 |
| `Q:2`、`(QE):1/2` | 扩展写法：显式时值，是步长的倍数 |
| `//` 到行尾 | 注释 |

- 导入对话框可以设置：来源乐器（优先用 `@instrument`，没有就默认风物之诗琴）、BPM、步长、空格是否视为休止。
- 按来源乐器把按键字母反查成 `pitch` 或 `voice`。字母与键码按 QWERTY 位置对应，例如 `Q` → `KeyQ`。
- 遇到来源乐器没有的按键，报错并给出行号和列号。

### 6.3 简谱文本（来源 C 之一）

简谱文本没有统一标准，本项目自定义如下语法。规则摘要如下，完整语法见 `docs/formats/jianpu.md`：

| 语法 | 含义 |
|---|---|
| `@bpm=100` | 速度，默认 90 |
| `@key=D`（也可以写 `1=D`、`1=bB`、`1=F#`） | 调号，默认 C |
| `@octave=4` | 不带八度标记的 `1` 所在的八度，默认 4，即 `1` = C4 |
| `@track=右手` | 开始一个新音轨，新音轨的时间从 0 开始；不写时所有音在同一个音轨 |
| `1`–`7` | 当前调的大调音级，默认占 1 拍 |
| `0` | 休止，占 1 拍 |
| `#4`、`b7` | 升号、降号，写在数字前面 |
| `1'`、`1''` / `1,`、`1,,` | 高八度 / 低八度，可以叠加 |
| `1_`、`1__` | 减时线，每个 `_` 让时值减半 |
| `1.` | 附点，时值 ×1.5 |
| `-` | 增时线，把前一个音延长 1 拍 |
| `[135]`、`[1 3 5']` | 和弦，标记写在 `]` 后面，如 `[135]_` |
| `{1 2 3}` | 三连音，括号内每个音的时值 ×2/3 |
| `\|` | 小节线，忽略 |
| 空格、换行 | 分隔符 |
| `//` 到行尾 | 注释 |

- 示例：`@bpm=100 @key=C` 换行 `1 1 5 5 | 6 6 5 - | 4 4 3 3 | 2 2 1 -`
- 简谱只描述音高，与乐器无关，所以不需要选择来源乐器，直接进入适配流程。
- 解析出错时，报告行号、列号和出错的符号。

### 6.4 自定义 JSON 谱（来源 C 之一）

- 文件就是 `{ "schemaVersion": 1, ...Score }`，用 zod 校验，出错时显示字段路径。
- 支持把任意已导入的乐谱**导出**成 JSON 谱。

## 7. 适配算法（`src/core/adapter`）

### 7.1 参数

```ts
interface AdaptOptions {
  tracks: string[];
  transpose: number;                     // -11..+11
  octaveShift: number;
  blackKeyPolicy: 'skip' | 'nearest';    // nearest 距离相等时取低音
  outOfRangePolicy: 'fold' | 'drop';
  maxPolyphony: number;                  // >= 1，1 表示只留旋律
  chordWindowMs: number;                 // 默认 15
  percussionSplitPitch?: number;         // 覆盖乐器配置中的 splitPitch
  useNoteDuration?: boolean;             // 按 MIDI 音长按键，未设置时取 timing.sustain；只对自定义乐器、category 为 horn/vocal 的内置乐器生效
  holdMsOverride?: number;               // 固定时长模式（按音长关闭）下覆盖 timing.holdMs（10–4000ms），生效范围同 useNoteDuration
}
```

`useNoteDuration` / `holdMsOverride` 的资格判断由 `src/core/instruments/registry.ts` 的 `supportsHoldControl` 统一给出：自定义乐器恒为 true；内置乐器只有 `category` 为 `horn` 或 `vocal` 才为 true。`adapt` 函数本身不做这个判断，调用方（演奏页、单轨试听）在调用前用 `stripHoldControlOptions` 剥离不合规乐器的这两项参数。

### 7.2 音高类流程

1. 合并所选音轨（鼓轨不参与）。
2. 变换音高：`p' = p + transpose + 12 × octaveShift`。
3. 查找按键：
   - 精确命中 → 使用该键；
   - `p'` 在乐器最低音和最高音之间但找不到对应键 → 按 `blackKeyPolicy` 处理（`skip` 计入 `blackKey`）；
   - 超出音域 → `fold` 就按八度折回音域内并重新查找（计入 `folded`，折回后仍找不到键就再按 `blackKeyPolicy` 处理）；`drop` 就丢弃，计入 `outOfRange`。
4. 限制复音数：把起音时间差在 `chordWindowMs` 以内的音分成一组，组的时间取组内最早的起音。组内按音高从高到低处理：映射到已选键的音计入 `merged`（合并，不算丢音）；其余音保留前 `maxPolyphony` 个，多出来的计入 `polyphony`。
5. 处理过密：同一个键相邻两次按下的间隔小于 `minRepeatGapMs` 时，丢掉后一次，计入 `tooDense`。
6. 生成按键：每组生成一个 `Press`。先定 `sustain = useNoteDuration ?? timing.sustain`；`holdMs` 取 `baseHold`：按音长时为 `timing.holdMs`（只作最短按住兜底），固定时长时为 `holdMsOverride ?? timing.holdMs`。`sustain` 为真且组内最长时值大于 `baseHold` 时，额外设置 `sustainMs` 为组内最长时值。和弦键路径（同一组收成一个和弦键）只应用 `baseHold`，不设置 `sustainMs`。

### 7.3 敲击类流程

- 鼓轨：按 `percussionMap.drumNotes` 把 MIDI 音高号映射成 voice；表里没有的音计入 `unmappedDrum`。
- 非鼓轨：音高低于分界线的映射为"咚"，高于或等于的映射为"咔"。分界线为 `auto` 时取所选音轨全部音高的中位数。
- voice 按乐器配置找到对应的 `code`。之后的复音限制和过密处理与音高类相同。

默认 `drumNotes`：35、36 → don；37、38、40、42、44、46、49、51、57 → ka。

### 7.4 自动推荐

- 在 `transpose ∈ [-6, +5]` × `octaveShift` 的组合里搜索。`octaveShift` 只取"能让音符中位数落在乐器音域内"的少数几个值。
- 打分：每个命中的音 +1，和弦组里的最高音额外 +1（视为旋律）；每个折回的音 −0.3。打分时固定使用 `blackKeyPolicy = skip`、`outOfRangePolicy = fold`。
- 分数相同时，先选 |transpose| 小的，再选 |octaveShift| 小的。
- 音轨默认选中全部非鼓轨；界面上显示每条音轨单独适配时的命中率。
- 键盘谱的来源乐器和目标乐器相同时，直接使用 `transpose = 0`、`octaveShift = 0`。
- 计算在主线程完成，参数变化后防抖 100ms 再重新计算。如果以后遇到性能问题，再移到 Web Worker。

## 8. 执行核心（`crates/player-core`）

### 8.1 抽象接口

```rust
trait Clock { fn now(&self) -> Duration; fn sleep_until(&self, t: Duration); }
trait InputBackend { fn send(&mut self, up: &[Code], down: &[Code]) -> Result<()>; fn release_all(&mut self) -> Result<()>; }
trait WindowProbe { fn is_target_foreground(&self) -> bool; }
```

| 接口 | Windows 实现 | Mock 实现（Mac 和测试用） |
|---|---|---|
| 计时 | 演奏期间 `timeBeginPeriod(1)`；等待命令通道时顺便计时，最后 2ms 自旋补齐 | 真实时钟（`std`）；播放器核心逻辑不读时钟，测试时直接传入时间 |
| `InputBackend` | `SendInput`（扫描码） | 只记录事件，不发键 |
| `WindowProbe` | `GetForegroundWindow` + 类名/标题匹配 | 始终返回 true，测试时可以控制返回值 |

### 8.2 调度器

- 在独立线程中运行，Windows 下线程优先级设为 `THREAD_PRIORITY_HIGHEST`。
- 计时：
  - 目标时间 = `t0 + event.tMs`，按绝对时间调度，不累加误差；
  - 线程用命令通道的 `recv_timeout` 等到目标时间前 2ms，最后 2ms 自旋补齐。这样暂停和停止命令能立即唤醒线程；
  - 处于倒计时、等待前台、演奏中时调用 `timeBeginPeriod(1)`，离开这些状态时调用 `timeEndPeriod(1)`；
  - 如果真机测试达不到计时验收标准，改用 `CreateWaitableTimerExW(CREATE_WAITABLE_TIMER_HIGH_RESOLUTION)`。
- 延迟：事件实际发出晚于目标时间时，立即发出，不平移后续事件。每个事件都记录 `targetMs` 和 `actualMs`。
- 状态机：

```
Idle / Error ──play──▶ Countdown ──倒计时结束──▶ (目标在前台?) ──是──▶ Playing
                                                  └─否─▶ WaitingFocus ──回到前台──▶ Playing
Countdown / WaitingFocus ──pause──▶ Idle（取消）
Playing ──pause/热键──▶ Paused(user)
Playing ──失去前台──▶ Paused(focus_lost)
Paused ──resume──▶ (目标在前台?) ──是──▶ Playing；否 ──▶ WaitingFocus
Playing ──播完且 loop=false──▶ Idle
Playing ──播完且 loop=true──▶ release_all，等到 t0 + durationMs（保留区间尾部休止），t0 按周期累加，从区间起点继续
任意状态 ──stop──▶ Idle
任意状态 ──发送失败/线程 panic──▶ Error(code, message)
```

- 热键使用 `Toggle` 命令，在播放线程内原子地判断：Idle / Error 时开始演奏缓存的时间线，Playing 时暂停，Paused 时继续，倒计时和等待前台时忽略。
- 非 Idle / Error 状态下收到 play，返回 `PLAYER_BUSY` 错误。
- 暂停时记下当前位置；继续时重设 `t0 = now − 当前位置`。
- `Paused(focus_lost)` 不会自动恢复，必须按热键或点按钮继续。
- **松开所有键（`release_all`）的时机**：暂停、停止、失去前台、循环回到起点、发送失败、线程 panic（用 `catch_unwind` 兜底）、调度器被 Drop（包括应用退出）。
- 演奏结束或停止时，把执行日志写入应用数据目录 `logs/exec-<Unix 毫秒>.jsonl`：每行 `{ targetMs, actualMs, up, down }`，循环播放时每轮之间插入 `{ loop: n }` 行，最后一行是汇总 `{ summary: { ... } }`（单位 ms）。日志写入失败不影响演奏。

### 8.3 Windows 输入

- `SendInput` 设置 `wVk = 0`、`KEYEVENTF_SCANCODE`，扩展键再加 `KEYEVENTF_EXTENDEDKEY`，松开时加 `KEYEVENTF_KEYUP`。
- 同一个事件里的 up 和 down 放进同一个 `INPUT` 数组，一次调用发出。
- 返回值小于数组长度时，视为发送失败。
- ⚠️ 被 UIPI 拦截时，`SendInput` **不会报错**。所以要靠启动时检测自身是否提权、在界面上提示，再加真机验证来兜底。
- `keymap` 读取 `shared/keycodes.json`（通过 `include_str!` 编译进程序），覆盖字母、数字、常用标点、F1–F12、空格。

### 8.4 前台窗口检测

- 用 `GetForegroundWindow` 取到窗口后，读 `GetClassNameW` 和 `GetWindowTextW`，**不打开游戏进程**。
- 默认规则：类名为 `UnityWndClass`，并且标题是 `原神` 或 `Genshin Impact`。规则可以在设置里修改，需要真机确认。
- 每批事件发送前检查一次；在 WaitingFocus 状态下每 100ms 轮询一次。

### 8.5 提权

- 启动时通过自身进程的 `TokenElevation` 判断是否以管理员运行，结果由 `get_env` 返回。
- 未提权时，界面顶部常驻警告，并提供"以管理员身份重启"按钮：用 `ShellExecuteW` 的 `runas` 重新启动自身，然后退出当前进程。
- 程序清单文件里不强制要求管理员权限。

## 9. Tauri 应用壳（`src-tauri`）

### 9.1 IPC 命令

| 命令 | 参数 → 返回 |
|---|---|
| `get_env` | → `{ platform, backend: 'windows' \| 'mock', elevated: boolean \| null, appVersion, dataDir, logsDir, startupWarnings: string[] }` |
| `restart_as_admin` | → 无（仅 Windows） |
| `list_custom_instruments` | → `{ profiles: unknown[], warnings: string[] }`：返回原始 JSON，由前端用 zod 校验；无法读取或不是 JSON 的文件跳过并写入 warnings |
| `save_custom_instrument` | `profile` → 无（`id` 和内置乐器重复时报错） |
| `delete_custom_instrument` | `id` → 无 |
| `get_settings` / `save_settings` | `Settings` |
| `build_execution` | `KeyTimeline, ExecutionParams` → `ExecutionTimeline`；同时在 Rust 端缓存为"当前演奏" |
| `play` | `{ countdownSec? }` → 无；演奏最近一次 `build_execution` 缓存的结果，没有缓存时返回错误；不传 `countdownSec` 时用设置里的值 |
| `pause` / `resume` / `stop` | → 无 |
| `get_player_state` | → `PlayerState` |

- 内置乐器由前端直接从 `shared/instruments` 打包加载，并与 `list_custom_instruments` 的结果合并。
- 错误统一返回 `{ code: string, message: string }`，前端通过 `ipc/` 封装成带类型的异常。

### 9.2 事件

| 事件 | 负载 |
|---|---|
| `player://state` | `PlayerState`（包含 `Paused` 的原因、`Error` 的信息、倒计时剩余秒数） |
| `player://progress` | `{ positionMs, sourcePositionMs }`，节流到约 30Hz |
| `player://summary` | 演奏结束时的计时统计和日志文件路径 |

### 9.3 设置 `Settings`（保存在应用数据目录的 `settings.json`）

```ts
interface Settings {
  hotkeys: { toggle: string; stop: string };       // 全局热键，默认 F9 / F10，由 Rust 注册
  shortcuts: {                                     // 窗口内快捷键，由前端监听
    openFile: string;                              // 默认 CmdOrCtrl+O
    previewToggle: string;                         // 默认 Space
    previewStop: string;                           // 默认 Escape
  };
  countdownSec: number;                            // 0–10，默认 3
  targetWindow: { className: string; titles: string[] };
  defaultHumanizeMs: number;                       // 0–30，默认 0
  writeExecutionLog: boolean;                      // 默认 true
}
```

- **所有快捷键都可以在设置页修改。**
- 全局热键只允许 F1–F12，或者带修饰键（`CmdOrCtrl` / `Ctrl` / `Alt` / `Shift`）的字母、数字组合，避免占用普通打字按键。窗口内快捷键在此基础上，还允许单独使用 `Space`、`Escape`、`Enter`。
- 5 个快捷键两两不能相同。
- 保存设置时重新注册全局热键，失败则恢复旧热键并报错。
- 热键逻辑：`toggle` 在 Idle 或 Error 状态下开始演奏"当前演奏"缓存（没有缓存时忽略），在 Playing 状态下暂停，在 Paused 状态下继续，在倒计时和等待前台时忽略；`stop` 在任何状态下都停止。全局热键会被系统独占，游戏本身收不到这些按键。
- `settings.json` 损坏时改名为 `settings.json.bak`，使用默认值，并写入 `startupWarnings`。

## 10. 前端界面

### 10.1 主界面
- **导入区**：打开 MIDI、键盘谱、简谱或 JSON 谱文件，也可以把文件拖进窗口；简谱和键盘谱还可以直接粘贴文本，粘贴时实时解析，出错时指出行号和列号。`.txt` 文件按内容自动猜测是简谱还是键盘谱。显示乐谱信息（标题、时长、音轨数）。
- **适配面板**：
  - 选择目标乐器；
  - 音轨列表：
    - 勾选框，可以多选，勾选的音轨合并后一起适配；提供全选和全不选；
    - 每条音轨显示名称、音符数、音域、首音时间、单独适配时的命中率（没有轨道名的角色分轨，主要靠音域和首音时间来区分）；
    - 每条音轨有"单独试听"和"单独演奏"按钮：临时只用这一条音轨生成时间线，不改变勾选状态；
  - 参数：移调、八度偏移、黑键策略、超音域策略、复音上限、和弦窗口；"恢复自动推荐"按钮；
  - 报告：命中率和各类丢音数量；
  - "导出 JSON 谱"按钮。
- **播放器**：
  - 按乐器配置的行和键画出虚拟琴键，显示键帽字母和音名，播放时高亮；点击键帽可以试听单个音；
  - 进度条、区间选择、开关循环；
  - 速度滑块（0.5–2.0）、人性化滑块（0–30ms）、试听音量；
  - 按钮：**试听**（前端 Web Audio）、**演奏**（Rust 调度器）、暂停、停止；
  - 状态显示：倒计时（覆盖在琴键上方）、等待游戏窗口、失去前台时暂停、错误；
  - 从倒计时开始到停止之前，导入、换乐器、选轨、适配参数、区间、速度都锁定，只能暂停或停止；
  - 演奏结束后显示计时统计和日志路径。

### 10.2 乐器管理
- 列表显示内置和自定义乐器，以及"待实测"标记。
- 操作：复制为自定义、新建、删除、导入 JSON、导出 JSON。
- 编辑器：
  - 按行编辑键；
  - 音高用音名输入（如 `C#4`），也可以填 MIDI 号；
  - 键码通过"点击后按下按键"来绑定，只接受 `keycodes.json` 里的键；
  - 可以编辑按住时长、最小重复间隔、是否持续发声；
  - 敲击类乐器可以编辑鼓映射表和分界音高；
  - 保存前用 zod 校验。

### 10.3 设置
- 快捷键（全局热键和窗口内快捷键都可以修改，点击后直接按下组合键录入）、倒计时、目标窗口规则、默认人性化、是否写执行日志；环境信息（平台、后端、是否管理员、版本、数据目录）。
- 修改后点击"保存设置"才生效（热键重新注册可能失败，需要明确的保存时机）。

### 10.4 首次启动风险提示
- 首次启动弹出不能直接关闭的风险提示：非官方工具、可能违反用户协议、只模拟键盘、注意乐曲版权。
- 勾选"我已了解上述风险"后才能开始使用；确认的版本号保存在本地，提示内容有实质变化时要求重新确认。

### 10.5 试听与高亮
- 试听：用 Web Audio 播放 `build_execution` 返回的 `ExecutionTimeline`。
  - 音高类：合成拨弦音色（振荡器 + 衰减包络）；
  - 敲击类："咚"用低频正弦加快速衰减，"咔"用短噪声。
  - 不使用任何游戏素材。
- 演奏时的高亮：界面收到 `player://progress` 后，用其中的 `positionMs` 对齐本地的 `ExecutionTimeline`，由前端自己渲染按键高亮，避免逐键事件带来的 IPC 开销。

## 11. 内置乐器（第一版）

| id | 名称 | 类型 | 状态 | 键位与音高 |
|---|---|---|---|---|
| `windsong-lyre` | 风物之诗琴 | pitched | verified | 高音 `Q W E R T Y U` = 72 74 76 77 79 81 83；中音 `A S D F G H J` = 60 62 64 65 67 69 71；低音 `Z X C V B N M` = 48 50 52 53 55 57 59 |
| `floral-zither` | 镜花之琴 | pitched | verified | 与风物之诗琴相同 |
| `vintage-lyre` | 老旧的诗琴 | pitched | unverified | 键位与风物之诗琴相同。暂定音高：高音行 C 弗里几亚 72 73 75 77 79 80 82；中音、低音行 C 多利亚 60 62 63 65 67 69 70 / 48 50 51 53 55 57 58。**需要真机确认** |
| `two-row-prototype` | 两行乐器（开发中） | pitched | unverified | 高音谱号行 `Q W E R T Y U`，暂定 60–71 的 C 大调音阶；低音谱号行 `A S D F G N J`（按截图，la 对应 N），暂定 48–59 的 C 大调音阶。**正式名称、音域、默认键位都需要上线后实测** |
| `festive-drum` | 节庆鼓 | percussion | unverified | 暂定 don → `KeyF`，ka → `KeyJ`。**默认键位需要真机确认** |

所有内置乐器的 `timing` 初始值都是 `holdMs = 30`、`minRepeatGapMs = 40`，真机验证时再校准。

## 12. 测试策略

| 层 | 工具 | 内容 |
|---|---|---|
| `src/core` | vitest | 解析器：测试时用 `@tonejs/midi` 现场生成 MIDI，覆盖键盘谱和简谱语法全部写法（包括调号、八度、时值、和弦、三连音、多音轨）以及出错位置；适配器：各策略分支、多轨合并时的同键合并、推荐打分和同分时的选择、敲击映射；schema：全部内置乐器 JSON 校验通过，非法配置能被拒绝。覆盖率 ≥ 80% |
| `player-core::timeline` | cargo test | 截取范围、变速（holdMs 不缩放）、同一种子结果可复现、和弦共用偏移、同键冲突的丢弃和松开提前 |
| `player-core::scheduler` | cargo test + 假时钟 | 事件顺序；同一时刻先 up 后 down；暂停后继续的位置；失去前台时进入暂停；等待前台；循环；stop、panic、Drop 时都调用了 `release_all` |
| `keymap` | cargo test + vitest | 两边读取同一份 `keycodes.json`；全部内置乐器的键码都能在表里找到 |
| `src-tauri` | cargo test | 自定义乐器存储读写、id 冲突、跳过非法文件 |
| 界面 | vitest + Testing Library | 只测关键交互：导入 → 适配 → 参数变化后刷新报告 |

CI（`.github/workflows/ci.yml`）：
- `frontend`（ubuntu）：lint、类型检查、vitest。
- `rust-macos`（macos）：`cargo clippy` 和 `cargo test`，覆盖整个 workspace。
- `windows`（windows-latest）：`cargo clippy`、`cargo test`、`tauri build`，并**上传安装包作为构建产物**，供真机验证时下载。

## 13. 验证工具 `gm-verify`

| 子命令 | 作用 |
|---|---|
| `play <timeline.json> [--speed] [--humanize] [--seed] [--start-ms] [--end-ms] [--loop] [--countdown 3] [--log out.jsonl] [--no-guard]` | 不开界面，直接执行时间线；`--no-guard` 关闭前台检测（往记事本发键测试用）；Ctrl+C 时先停止并松开所有键再退出 |
| `pattern <scale\|chord\|repeat\|long> --instrument <id 或 json 路径> [--hold] [--gap]` | 生成并执行测试样例（逐键音阶、全部和弦组合、逐步加快的连打、5 分钟长曲） |
| `stats <log.jsonl> [--compare other.jsonl]` | 输出计时统计；与另一份日志逐条比对事件顺序和按键内容 |

## 14. 文档清单

| 文档 | 写作时机 |
|---|---|
| `docs/superpowers/specs/2026-09-17-genshin-musician-design.md`（本文） | 现在 |
| Windows 真机验证清单（内部验收文档，不入库） | 实现阶段 |
| `docs/guides/audio-to-midi.md` 用外部工具从音频提取 MIDI（Basic Pitch、Demucs 等） | 实现阶段 |
| `docs/formats/keyscore.md` 键盘谱语法 | 实现阶段 |
| `docs/formats/jianpu.md` 简谱文本语法 | 实现阶段 |
| `docs/formats/instrument-profile.md` 乐器配置格式与校准方法 | 实现阶段 |

### 14.1 真机验证文档大纲

每个用例都按"步骤 / 预期 / 实际 / 结论"记录。

0. 环境记录：Windows 版本、游戏版本和服务器、分辨率、帧率上限、键盘布局、软件版本（CI 构建号）。
1. 权限：普通权限启动时出现警告；"以管理员身份重启"能正常工作。
2. 不开游戏的链路验证：用 `gm-verify pattern scale` 往记事本发键，核对输出的文字；用 `stats --compare` 比对 Mac Mock 日志和 Windows 日志。
3. 计时验收：跑 5 分钟长曲，p95 < 5ms，最大偏差 < 20ms，结束时没有累积漂移。
4. 每种乐器在游戏内的测试：逐键音阶、和弦、连打；逐步缩短 `holdMs` 和 `minRepeatGapMs`，找到不漏音的最小值，把它加上余量后写回配置。在 60 帧和 30 帧上限下分别测一次。
5. 两行新乐器校准：核对正式名称和默认键位；逐键录音，用 Basic Pitch 或调音器确认音高；更新配置，状态改为 `verified`。
6. 老旧的诗琴音高、节庆鼓默认键位的确认。
7. 安全功能：切出窗口后暂停；游戏在前台时 F9/F10 能否响应（软件分别以管理员和普通权限运行）；停止、退出、循环后没有卡住的键；前台窗口的类名和标题规则是否正确。
8. 结果汇总表 + 问题反馈模板。

## 15. 待实测清单

- 两行新乐器：正式名称、音域、音阶、默认键位（下排 la 是否默认就是 N）。
- 老旧的诗琴每个键的准确音高。
- 节庆鼓（以及其他敲击类乐器）的默认键位。
- 各乐器 `holdMs` 和 `minRepeatGapMs` 的最小可靠值，以及帧率对它们的影响。
- 游戏是否接受扫描码方式的 `SendInput`。
- 游戏以管理员运行时，全局热键在各种权限组合下是否可用。
- 游戏窗口的类名和标题（国服、国际服）。

## 16. 风险

| 风险 | 应对 |
|---|---|
| 用户协议禁止第三方脚本，封号风险低但不为零 | README 和软件首次启动时明确提示风险；坚持只模拟键盘，不碰进程 |
| 版权：游戏内要求演奏有权使用的曲目 | README 提示；不内置任何有版权的乐谱 |
| UIPI 拦截时没有任何报错 | 提权检测 + 界面警告 + 真机验证 |
| 游戏更新后键位、乐器或反作弊策略变化 | 乐器配置化；真机验证文档可以重复执行 |
| 新乐器上线时与截图不一致 | 状态标为 `unverified`，用户可以自己编辑，不需要发版 |

## 17. 路线图（第一版之后）

1. D：内置乐谱编辑器
2. 播放列表
3. 内置音频转 MIDI（Basic Pitch JS 版）
4. macOS 真实发键后端（CGEvent，用于云原神）
5. 鼠标输入后端
6. 多语言界面
7. 适配计算移到 Web Worker（出现性能问题时）
8. 简谱语法扩展：连音线、反复记号、任意 N 连音

## 18. 第一版完成标准

- Mac 上：全部单元测试通过，覆盖率达标；可以完成"导入四种格式（MIDI、键盘谱、简谱、JSON 谱）→ 适配 → 试听 → Mock 演奏 → 生成日志"的完整流程。
- CI：三个任务全部通过，Windows 安装包产物可以下载。
- 文档：第 14 节列出的文档全部完成。
- 真机阶段（有 Windows 环境后）：按真机验证文档执行完毕；风物之诗琴能完整弹奏测试长曲，不漏音，计时达标。
