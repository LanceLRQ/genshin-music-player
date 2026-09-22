# 乐器配置格式

乐器配置是一份 JSON 文件，描述一件乐器有哪些按键、每个键对应的音高（或音色）、以及按键的时序参数。内置乐器开箱即用，也可以在"乐器"页新建、编辑、导入或导出自己的配置。自定义配置保存在应用数据目录的 `instruments/<id>.json` 里。

## 顶层字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `schemaVersion` | `1` | 固定为 `1` |
| `id` | 字符串 | kebab-case（小写字母、数字、连字符），全局唯一；自定义乐器的 `id` 不能和内置乐器重复 |
| `name` | 字符串 | 显示名称 |
| `kind` | `"pitched"` \| `"percussion"` | 音高类还是敲击类 |
| `category` | `"lyre"` \| `"drum"` \| `"horn"` \| `"vocal"` \| `"custom"` | 乐器分类，缺省为 `"custom"`。只有 `"horn"`（圆号）和 `"vocal"`（人声）这两类在游戏里按住按键会持续发声，演奏页的「音长按键」「按住时长」也只对这两类内置乐器和全部自定义乐器生效，见下文「时序参数」 |
| `status` | `"verified"` \| `"unverified"` | 是否已经在游戏里实测确认过 |
| `rows` | 数组，1–4 项 | 见下文"行与键" |
| `timing` | 对象 | 见下文"时序参数" |
| `percussionMap` | 对象，可选 | 仅敲击类乐器需要，见下文"敲击映射" |

## 行与键

`rows` 是一个数组，每一项代表界面上的一行按键：

```jsonc
{
  "label": "高音",
  "keys": [
    { "pitch": 72, "code": "KeyQ" }
  ]
}
```

- `label`：这一行的名称，任意字符串（比如"高音""中音""鼓"）。
- `keys`：这一行的按键，1–12 个。每个键是：
  - `code`：物理键码，必须是 [`shared/keycodes.json`](../../shared/keycodes.json) 里存在的键（比如 `KeyQ`、`Digit1`、`Space`）；
  - 音高类乐器（`kind = "pitched"`）：每个键必须有 `pitch`（MIDI 音高号，0–127，60 = C4），不能有 `voice`；
  - 敲击类乐器（`kind = "percussion"`）：每个键必须有 `voice`（音色名，比如 `don`、`ka`），不能有 `pitch`。

## 时序参数

```jsonc
{ "holdMs": 30, "minRepeatGapMs": 40, "sustain": false }
```

| 字段 | 说明 | 范围 |
|---|---|---|
| `holdMs` | 每次按键的按住时长（毫秒） | 1–1000 |
| `minRepeatGapMs` | 同一个键连续按下的最小间隔（毫秒），短于这个间隔的后一次按键会被丢弃 | 0–1000 |
| `sustain` | 是否可以持续发声；`true` 时演奏页「按 MIDI 音长按键」默认打开，按住时长取音符时值和 `holdMs` 中较大的一个 | 默认 `false` |

这三个值都需要在游戏里实测校准，方法见[开发文档](../development.md)的「乐器实测校准」一节。

`sustain: true` 只应该给游戏里按住确实会持续发声的乐器（`category` 为 `"horn"` 或 `"vocal"`）用；琴类、鼓类按住无效，写 `true` 也不会有实际效果。演奏页额外提供「按 MIDI 音长按键」开关（默认取 `sustain`，可按曲子临时切换）和「按住时长」（开关关闭时的固定按住时长，10–4000ms），只对自定义乐器、`category` 为 `"horn"` 或 `"vocal"` 的内置乐器生效——这两类乐器的资格判断和 `sustain` 字段共用同一套规则。

## 敲击映射

只有 `kind = "percussion"` 时才需要：

```jsonc
{
  "drumNotes": { "36": "don", "38": "ka" },
  "splitPitch": "auto"
}
```

- `drumNotes`：MIDI 鼓音符号（字符串形式的数字）到音色的映射，用于把鼓轨（MIDI 第 10 通道）的音符转换成按键；表里引用的音色必须在 `rows` 的某个键上存在。内置鼓乐器已覆盖 GM 打击乐全音域（35–81），自定义乐器的映射表可以整表增删改；超出表外的音符号会按「未映射」丢音。
- `splitPitch`：非鼓轨音符按音高分界映射成音色的分界线；写 `"auto"` 表示取所选音轨全部音高的中位数，也可以写一个具体的 MIDI 音高号。

## 校验规则

保存或导入配置时会做以下校验，任何一条不满足都会报错并指出具体字段：

- 同一个乐器内 `code` 不能重复，且必须是 [`shared/keycodes.json`](../../shared/keycodes.json) 里存在的键。
- 音高类乐器：每个键必须有 `pitch`、不能有 `voice`；同一个乐器内 `pitch` 不能重复。
- 敲击类乐器：每个键必须有 `voice`、不能有 `pitch`；同一个乐器内 `voice` 不能重复；`percussionMap.drumNotes` 里引用的音色必须在某个键上存在。
- `id` 必须是小写 kebab-case（正则 `^[a-z0-9]+(-[a-z0-9]+)*$`）。
- `rows` 是 1–4 项，每行 `keys` 是 1–12 项。

## 完整示例：音高类乐器

一件两行乐器的最小示例（真实的内置乐器有更多按键，见下文"内置乐器"）：

```json
{
  "schemaVersion": 1,
  "id": "my-two-row-lyre",
  "name": "我的两行诗琴",
  "kind": "pitched",
  "category": "custom",
  "status": "unverified",
  "rows": [
    {
      "label": "高音",
      "keys": [
        { "pitch": 72, "code": "KeyQ" },
        { "pitch": 74, "code": "KeyW" },
        { "pitch": 76, "code": "KeyE" }
      ]
    },
    {
      "label": "中音",
      "keys": [
        { "pitch": 60, "code": "KeyA" },
        { "pitch": 62, "code": "KeyS" },
        { "pitch": 64, "code": "KeyD" }
      ]
    }
  ],
  "timing": { "holdMs": 30, "minRepeatGapMs": 40, "sustain": false }
}
```

## 完整示例：敲击类乐器

```json
{
  "schemaVersion": 1,
  "id": "my-hand-drum",
  "name": "我的手鼓",
  "kind": "percussion",
  "category": "custom",
  "status": "unverified",
  "rows": [
    {
      "label": "鼓",
      "keys": [
        { "voice": "don", "code": "KeyF" },
        { "voice": "ka", "code": "KeyJ" }
      ]
    }
  ],
  "timing": { "holdMs": 30, "minRepeatGapMs": 40, "sustain": false },
  "percussionMap": {
    "drumNotes": { "36": "don", "38": "ka" },
    "splitPitch": "auto"
  }
}
```

## 常见错误示例

同一个乐器内音高重复：

<!-- 预期错误: 音高 60 重复 -->
```json-error
{
  "schemaVersion": 1,
  "id": "broken-lyre",
  "name": "坏配置示例",
  "kind": "pitched",
  "status": "unverified",
  "rows": [
    {
      "label": "行",
      "keys": [
        { "pitch": 60, "code": "KeyA" },
        { "pitch": 60, "code": "KeyS" }
      ]
    }
  ],
  "timing": { "holdMs": 30, "minRepeatGapMs": 40 }
}
```

## 内置乐器

| id | 名称 | 类型 | 分类 | 状态 | 键位与音高 |
|---|---|---|---|---|---|
| `windsong-lyre` | 风物之诗琴 | 音高类 | 琴类 | 已验证 | 高音 `Q W E R T Y U` = 72 74 76 77 79 81 83；中音 `A S D F G H J` = 60 62 64 65 67 69 71；低音 `Z X C V B N M` = 48 50 52 53 55 57 59 |
| `floral-zither` | 镜花之琴 | 音高类 | 琴类 | 已验证 | 键位与音高同风物之诗琴 |
| `vintage-lyre` | 老旧的诗琴 | 音高类 | 琴类 | 已验证 | 键位与风物之诗琴相同；已游戏内逐键实测，音高听感符合音阶（录音定标待补） |
| `two-row-prototype` | 沃雅妮莎 | 音高类 | 人声 | 已验证 | 两行 14 键：高音谱号行 `Q W E R T Y U` = 60 62 64 65 67 69 71；低音谱号行 `A S D F G N J`（la 在 N）= 48 50 52 53 55 57 59 |
| `evening-horn` | 晚风圆号 | 音高类 | 圆号 | 已验证 | 两行 14 键：高音谱号行 `Q W E R T Y U` = 60–71；低音谱号行 `A S D F G H J` = 48–59（游戏内实测修正，原按 8 键推定） |
| `yuco-lyre` | 悠可琴 | 音高类 | 琴类 | 已验证 | 和弦吉他：第一排 `Q W E R T Y U` 为和弦键 C、Dm、Em、F、G、Am、Bdim；中音 / 低音两排单音同诗琴布局（已游戏内实测） |
| `lingering-echo` | 余音 | 音高类 | 琴类 | 已验证 | 和弦吉他，布局同悠可琴（已游戏内实测） |
| `harmony-clavier` | 谐律键琴 | 音高类 | 琴类 | 已验证 | 三行 21 键，布局同风物之诗琴（已游戏内实测） |
| `sprightly-lyre` | 跃律琴 | 音高类 | 琴类 | 已验证 | 三行 21 键，布局同风物之诗琴（已游戏内实测） |
| `festive-drum` | 荒泷·盛世豪鼓 | 敲击类 | 鼓类 | 已验证 | 2 键：咚 = `S`，咔 = `A` |
| `banquet-drum` | 绮筵之鼓 | 敲击类 | 鼓类 | 已验证 | 4 键 `A S K L` = 咔、咚、咚-2、咔-2 |
| `juju-drum` | 聚聚鼓 | 敲击类 | 鼓类 | 已验证 | 8 键四个声音（上排 `Q W I O`、下排 `A S K L`，键帽 B/T/S/R）：底鼓 bass、军鼓 snare、擦 hi-hat、三连音 triplet，左右对称键同声轮流。GM 映射：底鼓类→底鼓，军鼓 / 嗵鼓类→军鼓，闭镲类→擦，叮镲 / 碎音镲类→三连音（2026-09-20 复测修正，原按键帽字母推定为 Bass/Tom/Snare/Ride） |

12 件内置乐器的键位与发声均已在游戏内逐键实测（含三处键位现场修正后复测）；精确音高的录音定标仍待补，见下文「实测校准」。复制出的副本与用户自建乐器默认标"待实测"——可以正常使用，只是键位或音高可能与游戏实际不符，自己编辑校准就行，不用等软件更新。

`timing` 已按游戏内实测（60 帧上限）校准回写：`holdMs` 统一为 30；`minRepeatGapMs` 诗琴类（风物 / 镜花 / 老旧 / 谐律 / 跃律）为 75，鼓与和弦吉他（悠可 / 余音 / 三件鼓）为 96，晚风圆号为 120，沃雅妮莎暂为初始值 40。换设备或改帧率后如果出现漏音，按[开发文档](../development.md)的校准方法重新测量。晚风圆号（圆号）与沃雅妮莎（人声）在游戏里按住会持续发声，`sustain` 均为 `true`；其余内置乐器按住无效，`sustain` 为 `false`。

## 实测校准

校准需要用到仓库里的 `gm-verify` 命令行验证工具（不随软件分发），按住时长、最小重复间隔与音高的完整测量步骤见[开发文档](../development.md)。

## 和弦键（v1 schema 可选字段）

音高类乐器的键除 `pitch`（单音）外，可改用 `chord` 表示和弦键（与 `pitch` 二选一），写法：`{ "chord": [48, 52, 55], "label": "C", "code": "KeyQ" }`。

- `chord`：构成音的 MIDI 音高数组，2–7 个音、严格升序不重复。
- `label`：和弦显示名（必填），如 `C`、`Dm`、`Bdim`。
- 演奏适配时，同一时间窗内 ≥3 个不同音级的音符簇会与和弦键做音级集合匹配（Jaccard ≥ 0.75 命中），命中后整簇收成一个按键；未命中回退逐音映射。琶音（时间错开的音符）不会合并。
- 和弦键命中时始终按固定的按住时长按下，不受演奏页「按 MIDI 音长按键」开关影响。
