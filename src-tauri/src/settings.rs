//! 设置：数据结构与默认值、快捷键与设置校验、settings.json 读写。

use std::fs;
use std::io;
use std::path::Path;

use player_core::guard::WindowRule;
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::storage::write_atomic;

pub const MAX_COUNTDOWN_SEC: u32 = 10;
pub const MAX_HUMANIZE_MS: f64 = 30.0;

/// 全局热键，由 Rust 注册
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hotkeys {
    pub toggle: String,
    pub stop: String,
}

impl Default for Hotkeys {
    fn default() -> Self {
        Self {
            toggle: "F9".to_string(),
            stop: "F10".to_string(),
        }
    }
}

/// 窗口内快捷键，由前端监听
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Shortcuts {
    pub open_file: String,
    pub preview_toggle: String,
    pub preview_stop: String,
}

impl Default for Shortcuts {
    fn default() -> Self {
        Self {
            open_file: "CmdOrCtrl+O".to_string(),
            preview_toggle: "Space".to_string(),
            preview_stop: "Escape".to_string(),
        }
    }
}

/// 与前端 `src/ipc/types.ts` 的 `Settings` / `DEFAULT_SETTINGS` 逐字段一致
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub hotkeys: Hotkeys,
    /// 旧版 settings.json 没有这个字段时用默认值补齐
    #[serde(default)]
    pub shortcuts: Shortcuts,
    /// 0..=10
    pub countdown_sec: u32,
    pub target_window: WindowRule,
    /// 0..=30
    pub default_humanize_ms: f64,
    pub write_execution_log: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            hotkeys: Hotkeys::default(),
            shortcuts: Shortcuts::default(),
            countdown_sec: 3,
            target_window: WindowRule::default(),
            default_humanize_ms: 0.0,
            write_execution_log: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShortcutScope {
    /// 全局热键
    Global,
    /// 窗口内快捷键
    Window,
}

/// 修饰键只能按这个顺序书写
pub const SHORTCUT_MODIFIERS: [&str; 4] = ["CmdOrCtrl", "Ctrl", "Alt", "Shift"];
const STANDALONE_KEYS: [&str; 3] = ["Space", "Escape", "Enter"];

fn is_function_key(key: &str) -> bool {
    (1..=12).any(|number| key == format!("F{number}"))
}

/// 快捷键字符串 `[修饰键+]*主键` 的校验，规则、判断顺序与中文原因与前端 `src/lib/shortcuts.ts` 的
/// `validateShortcut` 逐字一致：空值 → 空段 → 修饰键（不支持、重复、顺序）→ CmdOrCtrl 与 Ctrl 同时出现
/// → 主键不支持 → 全局热键使用 Space / Escape / Enter → 这三个键带修饰键 → 字母数字不带修饰键。
pub fn validate_shortcut(value: &str, scope: ShortcutScope) -> Result<(), String> {
    if value.is_empty() {
        return Err("快捷键不能为空".to_string());
    }
    let parts: Vec<&str> = value.split('+').collect();
    if parts.iter().any(|part| part.is_empty()) {
        return Err(format!("快捷键格式错误「{value}」"));
    }
    let (key, modifiers) = parts.split_last().expect("split 至少返回一段");

    let mut previous: Option<usize> = None;
    for modifier in modifiers {
        let Some(index) = SHORTCUT_MODIFIERS.iter().position(|m| m == modifier) else {
            return Err(format!("不支持的修饰键「{modifier}」"));
        };
        if previous == Some(index) {
            return Err(format!("修饰键「{modifier}」重复"));
        }
        if previous.is_some_and(|previous| index < previous) {
            return Err("修饰键顺序应为 CmdOrCtrl、Ctrl、Alt、Shift".to_string());
        }
        previous = Some(index);
    }
    if modifiers.contains(&"CmdOrCtrl") && modifiers.contains(&"Ctrl") {
        return Err("CmdOrCtrl 和 Ctrl 不能同时使用".to_string());
    }

    let is_letter_or_digit = key.len() == 1
        && key
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit());
    let is_standalone = STANDALONE_KEYS.contains(key);
    if !is_letter_or_digit && !is_standalone && !is_function_key(key) {
        return Err(format!(
            "不支持的按键「{key}」，只能使用 A–Z、0–9、F1–F12、Space、Escape、Enter"
        ));
    }
    if is_standalone && scope == ShortcutScope::Global {
        return Err(format!("全局热键不能使用 {key}"));
    }
    if is_standalone && !modifiers.is_empty() {
        return Err(format!("{key} 不能搭配修饰键"));
    }
    if is_letter_or_digit && modifiers.is_empty() {
        return Err("字母和数字键必须搭配修饰键".to_string());
    }
    Ok(())
}

/// 5 个快捷键：(名称，取值，范围)，名称与前端 SHORTCUT_FIELDS 的 label 一致
pub fn shortcut_fields(settings: &Settings) -> [(&'static str, &str, ShortcutScope); 5] {
    [
        (
            "开始 / 暂停 / 继续",
            &settings.hotkeys.toggle,
            ShortcutScope::Global,
        ),
        ("停止", &settings.hotkeys.stop, ShortcutScope::Global),
        (
            "打开文件",
            &settings.shortcuts.open_file,
            ShortcutScope::Window,
        ),
        (
            "开始 / 停止试听",
            &settings.shortcuts.preview_toggle,
            ShortcutScope::Window,
        ),
        (
            "停止试听",
            &settings.shortcuts.preview_stop,
            ShortcutScope::Window,
        ),
    ]
}

/// save_settings 与读取 settings.json 时的完整校验，失败时返回 SETTINGS_INVALID
pub fn validate_settings(settings: &Settings) -> Result<(), AppError> {
    if settings.countdown_sec > MAX_COUNTDOWN_SEC {
        return Err(AppError::settings_invalid("倒计时必须在 0–10 秒之间"));
    }
    if !(settings.default_humanize_ms.is_finite()
        && (0.0..=MAX_HUMANIZE_MS).contains(&settings.default_humanize_ms))
    {
        return Err(AppError::settings_invalid("默认人性化必须在 0–30ms 之间"));
    }
    if settings.target_window.class_name.trim().is_empty() {
        return Err(AppError::settings_invalid("游戏窗口类名不能为空"));
    }
    if settings.target_window.titles.is_empty() {
        return Err(AppError::settings_invalid("至少需要一个游戏窗口标题"));
    }
    if settings
        .target_window
        .titles
        .iter()
        .any(|title| title.trim().is_empty())
    {
        return Err(AppError::settings_invalid("游戏窗口标题不能为空"));
    }
    let fields = shortcut_fields(settings);
    for (label, value, scope) in fields {
        validate_shortcut(value, scope).map_err(|reason| {
            AppError::settings_invalid(format!("「{label}」快捷键无效：{reason}"))
        })?;
    }
    for (index, (first_label, first_value, _)) in fields.iter().enumerate() {
        for (second_label, second_value, _) in &fields[index + 1..] {
            if first_value == second_value {
                return Err(AppError::settings_invalid(format!(
                    "「{first_label}」和「{second_label}」的快捷键相同（{first_value}）"
                )));
            }
        }
    }
    Ok(())
}

/// 读取结果；warning 不为空时要写入 startupWarnings
#[derive(Debug, Clone, PartialEq)]
pub struct LoadedSettings {
    pub settings: Settings,
    pub warning: Option<String>,
}

/// 读取 settings.json：
/// - 文件不存在：使用默认值，没有警告；
/// - 读取失败：使用默认值并给出警告，不改动文件；
/// - 不是合法的设置（JSON 格式错误或校验不通过）：改名为 settings.json.bak，使用默认值并给出警告。
pub fn load_settings(path: &Path) -> LoadedSettings {
    let defaults = |warning: Option<String>| LoadedSettings {
        settings: Settings::default(),
        warning,
    };
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return defaults(None),
        Err(error) => {
            return defaults(Some(format!(
                "无法读取设置文件（{error}），本次使用默认设置"
            )));
        }
    };
    let reason = match serde_json::from_str::<Settings>(&text) {
        Ok(settings) => match validate_settings(&settings) {
            Ok(()) => {
                return LoadedSettings {
                    settings,
                    warning: None,
                };
            }
            Err(error) => error.message,
        },
        Err(error) => error.to_string(),
    };
    let backup = path.with_file_name("settings.json.bak");
    let warning = match fs::rename(path, &backup) {
        Ok(()) => format!("设置文件已损坏（{reason}），已改名为 settings.json.bak 并恢复默认设置"),
        Err(error) => format!("设置文件已损坏（{reason}），本次使用默认设置；备份失败：{error}"),
    };
    defaults(Some(warning))
}

/// 先写临时文件再重命名
pub fn save_settings_file(path: &Path, settings: &Settings) -> Result<(), AppError> {
    let mut json = serde_json::to_string_pretty(settings).map_err(AppError::storage_io)?;
    json.push('\n');
    write_atomic(path, json.as_bytes()).map_err(AppError::storage_io)
}
