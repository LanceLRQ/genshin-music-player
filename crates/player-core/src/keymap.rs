//! 键码表：物理键码（`KeyQ`）→ Set 1 扫描码。与前端共用 `shared/keycodes.json`。

use std::collections::HashMap;
use std::sync::OnceLock;

use serde::Deserialize;

use crate::error::CoreError;

const KEYCODES_JSON: &str = include_str!("../../../shared/keycodes.json");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub struct KeyInfo {
    pub code: &'static str,
    /// Set 1 make code
    pub scan: u16,
    /// 扩展键需要额外加 KEYEVENTF_EXTENDEDKEY
    pub extended: bool,
}

#[derive(Deserialize)]
#[serde(bound(deserialize = "'de: 'static"))]
struct KeycodeFile {
    keys: Vec<KeyInfo>,
}

struct Keymap {
    keys: Vec<KeyInfo>,
    by_code: HashMap<&'static str, KeyInfo>,
}

fn keymap() -> &'static Keymap {
    static KEYMAP: OnceLock<Keymap> = OnceLock::new();
    KEYMAP.get_or_init(|| {
        let file: KeycodeFile =
            serde_json::from_str(KEYCODES_JSON).expect("shared/keycodes.json 格式错误");
        let by_code = file.keys.iter().map(|key| (key.code, *key)).collect();
        Keymap {
            keys: file.keys,
            by_code,
        }
    })
}

/// 键码表中的全部按键，顺序与 JSON 文件一致
pub fn all_keys() -> &'static [KeyInfo] {
    &keymap().keys
}

pub fn key_info(code: &str) -> Option<KeyInfo> {
    keymap().by_code.get(code).copied()
}

/// 查不到时返回 `UNKNOWN_KEY_CODE`
pub fn resolve_key(code: &str) -> Result<KeyInfo, CoreError> {
    key_info(code).ok_or_else(|| CoreError::unknown_key_code(code))
}

/// 键码 → macOS ANSI 虚拟键码（`kVK_ANSI_*`，HIToolbox/Events.h）。纯数据、全平台编译，
/// 供 macOS 后端使用；游戏读的是 ANSI 布局位置，与用户实际键盘布局无关。
pub fn mac_vk(code: &str) -> Option<u16> {
    Some(match code {
        "Digit1" => 0x12,
        "Digit2" => 0x13,
        "Digit3" => 0x14,
        "Digit4" => 0x15,
        "Digit5" => 0x17,
        "Digit6" => 0x16,
        "Digit7" => 0x1A,
        "Digit8" => 0x1C,
        "Digit9" => 0x19,
        "Digit0" => 0x1D,
        "Minus" => 0x1B,
        "Equal" => 0x18,
        "KeyQ" => 0x0C,
        "KeyW" => 0x0D,
        "KeyE" => 0x0E,
        "KeyR" => 0x0F,
        "KeyT" => 0x11,
        "KeyY" => 0x10,
        "KeyU" => 0x20,
        "KeyI" => 0x22,
        "KeyO" => 0x1F,
        "KeyP" => 0x23,
        "BracketLeft" => 0x21,
        "BracketRight" => 0x1E,
        "KeyA" => 0x00,
        "KeyS" => 0x01,
        "KeyD" => 0x02,
        "KeyF" => 0x03,
        "KeyG" => 0x05,
        "KeyH" => 0x04,
        "KeyJ" => 0x26,
        "KeyK" => 0x28,
        "KeyL" => 0x25,
        "Semicolon" => 0x29,
        "Quote" => 0x27,
        "Backquote" => 0x32,
        "Backslash" => 0x2A,
        "KeyZ" => 0x06,
        "KeyX" => 0x07,
        "KeyC" => 0x08,
        "KeyV" => 0x09,
        "KeyB" => 0x0B,
        "KeyN" => 0x2D,
        "KeyM" => 0x2E,
        "Comma" => 0x2B,
        "Period" => 0x2F,
        "Slash" => 0x2C,
        "Space" => 0x31,
        "F1" => 0x7A,
        "F2" => 0x78,
        "F3" => 0x63,
        "F4" => 0x76,
        "F5" => 0x60,
        "F6" => 0x61,
        "F7" => 0x62,
        "F8" => 0x64,
        "F9" => 0x65,
        "F10" => 0x6D,
        "F11" => 0x67,
        "F12" => 0x6F,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mac_vk_covers_every_key_in_the_table() {
        for key in all_keys() {
            assert!(
                mac_vk(key.code).is_some(),
                "键码 {} 缺少 macOS 虚拟键码",
                key.code
            );
        }
    }

    #[test]
    fn mac_vk_returns_none_for_unknown_code() {
        assert_eq!(mac_vk("KeyFoo"), None);
    }
}
