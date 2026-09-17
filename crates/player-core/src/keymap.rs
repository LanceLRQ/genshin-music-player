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
