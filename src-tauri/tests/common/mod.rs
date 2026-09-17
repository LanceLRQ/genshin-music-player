//! src-tauri 测试共用的辅助代码
#![allow(dead_code)]

use std::collections::BTreeSet;
use std::sync::{Mutex, PoisonError};

use genshin_music_player_lib::hotkeys::HotkeyRegistrar;
use genshin_music_player_lib::settings::Hotkeys;

/// 记录注册状态；occupied 中的组合键模拟"被其他程序占用"，注册总是失败。
/// `block_after_unregister` 是链式开关：一旦这些组合键被注销，后续任何注册都会失败，
/// 用于模拟"恢复旧热键时旧热键也被其他程序占用"
#[derive(Default)]
pub struct FakeRegistrar {
    registered: Mutex<BTreeSet<String>>,
    occupied: BTreeSet<String>,
    blocked_after_unregister: BTreeSet<String>,
    blocked: Mutex<BTreeSet<String>>,
}

impl FakeRegistrar {
    pub fn occupied(values: &[&str]) -> Self {
        Self {
            occupied: values.iter().map(|value| value.to_string()).collect(),
            ..Self::default()
        }
    }

    pub fn block_after_unregister(mut self, values: &[&str]) -> Self {
        self.blocked_after_unregister = values.iter().map(|value| value.to_string()).collect();
        self
    }

    pub fn registered(&self) -> Vec<String> {
        self.set().iter().cloned().collect()
    }

    fn set(&self) -> std::sync::MutexGuard<'_, BTreeSet<String>> {
        self.registered
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    fn blocked(&self) -> std::sync::MutexGuard<'_, BTreeSet<String>> {
        self.blocked.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl HotkeyRegistrar for FakeRegistrar {
    fn register(&self, hotkey: &str) -> Result<(), String> {
        if self.occupied.contains(hotkey)
            || self.blocked().contains(hotkey)
            || !self.set().insert(hotkey.to_string())
        {
            return Err(format!("{hotkey} 已被占用"));
        }
        Ok(())
    }

    fn unregister(&self, hotkey: &str) -> Result<(), String> {
        self.set().remove(hotkey);
        if self.blocked_after_unregister.contains(hotkey) {
            self.blocked().insert(hotkey.to_string());
        }
        Ok(())
    }

    fn is_registered(&self, hotkey: &str) -> bool {
        self.set().contains(hotkey)
    }
}

pub fn hotkeys(toggle: &str, stop: &str) -> Hotkeys {
    Hotkeys {
        toggle: toggle.to_string(),
        stop: stop.to_string(),
    }
}

pub fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| value.to_string()).collect()
}
