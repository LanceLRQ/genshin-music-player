//! src-tauri 测试共用的辅助代码
#![allow(dead_code)]

use std::collections::BTreeSet;
use std::sync::{Mutex, PoisonError};

use genshin_music_player_lib::hotkeys::HotkeyRegistrar;
use genshin_music_player_lib::settings::Hotkeys;

/// 记录注册状态；occupied 中的组合键模拟"被其他程序占用"，注册总是失败
#[derive(Default)]
pub struct FakeRegistrar {
    registered: Mutex<BTreeSet<String>>,
    occupied: BTreeSet<String>,
}

impl FakeRegistrar {
    pub fn occupied(values: &[&str]) -> Self {
        Self {
            occupied: values.iter().map(|value| value.to_string()).collect(),
            ..Self::default()
        }
    }

    pub fn registered(&self) -> Vec<String> {
        self.set().iter().cloned().collect()
    }

    fn set(&self) -> std::sync::MutexGuard<'_, BTreeSet<String>> {
        self.registered
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }
}

impl HotkeyRegistrar for FakeRegistrar {
    fn register(&self, hotkey: &str) -> Result<(), String> {
        if self.occupied.contains(hotkey) || !self.set().insert(hotkey.to_string()) {
            return Err(format!("{hotkey} 已被占用"));
        }
        Ok(())
    }

    fn unregister(&self, hotkey: &str) -> Result<(), String> {
        self.set().remove(hotkey);
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
