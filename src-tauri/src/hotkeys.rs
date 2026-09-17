//! 全局热键：快捷键字符串解析、按下后对应的动作、注册与重新注册（失败时恢复旧热键）。
//!
//! 设置里的快捷键字符串（`F9`、`CmdOrCtrl+O`、`Alt+Shift+1`、`Space` 等）可以直接交给
//! global-hotkey 的 `HotKey::from_str` 解析：修饰键不区分大小写，`CmdOrCtrl` 在 macOS 上是 Cmd、
//! 其他平台上是 Ctrl，主键接受 `A`–`Z`、`0`–`9`、`F1`–`F12`、`Space`、`Escape`、`Enter`，不需要转换。

use std::str::FromStr;

use tauri::Runtime;
use tauri_plugin_global_shortcut::{GlobalShortcut, Shortcut, ShortcutState};

use crate::error::AppError;
use crate::settings::Hotkeys;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HotkeyAction {
    /// 空闲或出错时开始演奏"当前演奏"，演奏中暂停，暂停中继续
    Toggle,
    Stop,
}

/// 注册全局热键的抽象，便于在测试中替换
pub trait HotkeyRegistrar {
    fn register(&self, hotkey: &str) -> Result<(), String>;
    fn unregister(&self, hotkey: &str) -> Result<(), String>;
    fn is_registered(&self, hotkey: &str) -> bool;
}

impl<R: Runtime> HotkeyRegistrar for GlobalShortcut<R> {
    fn register(&self, hotkey: &str) -> Result<(), String> {
        GlobalShortcut::register(self, hotkey).map_err(|error| error.to_string())
    }

    fn unregister(&self, hotkey: &str) -> Result<(), String> {
        GlobalShortcut::unregister(self, hotkey).map_err(|error| error.to_string())
    }

    fn is_registered(&self, hotkey: &str) -> bool {
        GlobalShortcut::is_registered(self, hotkey)
    }
}

pub fn parse_hotkey(value: &str) -> Result<Shortcut, String> {
    Shortcut::from_str(value).map_err(|error| error.to_string())
}

/// 只处理按下；按下的组合键与 toggle / stop 都不相同时返回 None
pub fn hotkey_action(
    hotkeys: &Hotkeys,
    shortcut: &Shortcut,
    state: ShortcutState,
) -> Option<HotkeyAction> {
    if state != ShortcutState::Pressed {
        return None;
    }
    let matches =
        |value: &str| parse_hotkey(value).is_ok_and(|parsed| parsed.id() == shortcut.id());
    if matches(&hotkeys.toggle) {
        Some(HotkeyAction::Toggle)
    } else if matches(&hotkeys.stop) {
        Some(HotkeyAction::Stop)
    } else {
        None
    }
}

fn values(hotkeys: &Hotkeys) -> [&str; 2] {
    [&hotkeys.toggle, &hotkeys.stop]
}

/// 依次注册 toggle 和 stop；任何一个失败时注销本次已经注册的，返回 HOTKEY_REGISTER_FAILED
pub fn register_hotkeys(
    registrar: &impl HotkeyRegistrar,
    hotkeys: &Hotkeys,
) -> Result<(), AppError> {
    let mut registered = Vec::new();
    for value in values(hotkeys) {
        if registrar.register(value).is_err() {
            for done in registered {
                let _ = registrar.unregister(done);
            }
            return Err(AppError::hotkey_register_failed(value));
        }
        registered.push(value);
    }
    Ok(())
}

/// 启动时注册：失败不阻止启动，每个失败的热键返回一条警告（写入 startupWarnings）
pub fn register_on_startup(registrar: &impl HotkeyRegistrar, hotkeys: &Hotkeys) -> Vec<String> {
    values(hotkeys)
        .into_iter()
        .filter(|value| registrar.register(value).is_err())
        .map(|value| AppError::hotkey_register_failed(value).message)
        .collect()
}

/// 保存设置时：先注销旧热键，再注册新热键；新热键注册失败时恢复原来注册成功的旧热键并返回错误。
/// 恢复本身也可能失败（旧热键此刻被其他程序占用），这类热键会追加进错误信息，避免用户以为旧热键仍然有效
pub fn replace_hotkeys(
    registrar: &impl HotkeyRegistrar,
    old: &Hotkeys,
    new: &Hotkeys,
) -> Result<(), AppError> {
    with_hotkeys_released(registrar, old, || register_hotkeys(registrar, new))
}

/// 注销 `hotkeys` 中当前已注册的键，执行 `f`：
/// - `f` 返回 `Err` 时尽力恢复注销前已注册的键，恢复失败的键会追加进错误信息（与上面 `replace_hotkeys`
///   的文案风格一致），避免用户以为原热键仍然有效；
/// - `f` 返回 `Ok` 时不恢复——调用方（例如提权重启）通常会紧接着注册新的热键或直接退出进程。
///
/// `replace_hotkeys` 和 `restart_as_admin` 命令都基于这个函数：前者的 `f` 是重新注册新热键，
/// 后者的 `f` 是拉起提权后的新进程。
pub fn with_hotkeys_released<T>(
    registrar: &impl HotkeyRegistrar,
    hotkeys: &Hotkeys,
    f: impl FnOnce() -> Result<T, AppError>,
) -> Result<T, AppError> {
    let previously_registered: Vec<&str> = values(hotkeys)
        .into_iter()
        .filter(|value| registrar.is_registered(value))
        .collect();
    for value in &previously_registered {
        let _ = registrar.unregister(value);
    }
    f().map_err(|mut error| {
        let not_restored: Vec<&str> = previously_registered
            .into_iter()
            .filter(|value| registrar.register(value).is_err())
            .collect();
        if !not_restored.is_empty() {
            let joined = not_restored
                .iter()
                .map(|value| format!("「{value}」"))
                .collect::<Vec<_>>()
                .join("、");
            let original = error.message;
            error.message = format!("{original}，原热键{joined}也未能恢复");
        }
        error
    })
}

/// 尽力补注册 `hotkeys` 中当前未注册的键（例如启动时因为被占用而注册失败的）；单个失败会被忽略、
/// 不返回错误——调用方此时只是想顺带修复一下，不应该因为某个键仍被占用而阻塞其他操作
pub fn register_missing_hotkeys(registrar: &impl HotkeyRegistrar, hotkeys: &Hotkeys) {
    for value in values(hotkeys) {
        if !registrar.is_registered(value) {
            let _ = registrar.register(value);
        }
    }
}
