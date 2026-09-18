//! 键盘输出：InputBackend 抽象、记录按下状态的 KeyboardOutput、平台无关的按键动作组装。

use std::collections::BTreeSet;

use crate::error::CoreError;
use crate::keymap::{KeyInfo, resolve_key};

pub mod mock;
#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(windows)]
pub mod windows;

/// 与 Win32 `KEYEVENTF_EXTENDEDKEY` 取值相同
pub const FLAG_EXTENDED_KEY: u32 = 0x0001;
/// 与 Win32 `KEYEVENTF_KEYUP` 取值相同
pub const FLAG_KEY_UP: u32 = 0x0002;
/// 与 Win32 `KEYEVENTF_SCANCODE` 取值相同
pub const FLAG_SCANCODE: u32 = 0x0008;

pub trait InputBackend: Send {
    /// 同一次调用中先发 up 再发 down；实现必须原子地发出（Windows 下合并为一次 SendInput）
    fn send_raw(&mut self, up: &[KeyInfo], down: &[KeyInfo]) -> Result<(), CoreError>;
    /// "windows" / "mock"
    fn name(&self) -> &'static str;
}

/// 单个键的一次按下或松开，与平台无关；Windows 后端把它转换成 INPUT 结构
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KeyStroke {
    pub scan: u16,
    pub extended: bool,
    pub key_up: bool,
}

impl KeyStroke {
    /// 始终带扫描码标志；扩展键加扩展标志；松开时加松开标志
    pub fn flags(&self) -> u32 {
        let mut flags = FLAG_SCANCODE;
        if self.extended {
            flags |= FLAG_EXTENDED_KEY;
        }
        if self.key_up {
            flags |= FLAG_KEY_UP;
        }
        flags
    }
}

/// 先排 up 再排 down，保持各自的顺序
pub fn key_strokes(up: &[KeyInfo], down: &[KeyInfo]) -> Vec<KeyStroke> {
    let stroke = |key: &KeyInfo, key_up: bool| KeyStroke {
        scan: key.scan,
        extended: key.extended,
        key_up,
    };
    up.iter()
        .map(|key| stroke(key, true))
        .chain(down.iter().map(|key| stroke(key, false)))
        .collect()
}

/// 包装后端，记录当前按下的键
pub struct KeyboardOutput<B: InputBackend> {
    backend: B,
    pressed: BTreeSet<String>,
}

impl<B: InputBackend> KeyboardOutput<B> {
    pub fn new(backend: B) -> Self {
        Self {
            backend,
            pressed: BTreeSet::new(),
        }
    }

    pub fn backend_name(&self) -> &'static str {
        self.backend.name()
    }

    /// 当前按下的键，按键码排序
    pub fn pressed(&self) -> Vec<String> {
        self.pressed.iter().cloned().collect()
    }

    /// 过滤掉没有按下的 up 和已经按下的 down；过滤后为空时不调用后端。
    /// 后端报错时可能只发出了一部分，按下集合取调用前与调用后的并集，
    /// 保证之后的 release_all 会尝试松开所有可能按下的键（多发一次 up 无害）。
    pub fn send(&mut self, up: &[String], down: &[String]) -> Result<(), CoreError> {
        let mut next = self.pressed.clone();
        let mut up_keys = Vec::new();
        for code in up {
            if next.remove(code) {
                up_keys.push(resolve_key(code)?);
            }
        }
        let mut down_keys = Vec::new();
        for code in down {
            if !next.contains(code) {
                down_keys.push(resolve_key(code)?);
                next.insert(code.clone());
            }
        }
        if up_keys.is_empty() && down_keys.is_empty() {
            return Ok(());
        }
        let result = self.backend.send_raw(&up_keys, &down_keys);
        if result.is_err() {
            next.extend(self.pressed.iter().cloned());
        }
        self.pressed = next;
        result
    }

    /// 对所有按下的键发 up，成功后清空集合；集合为空时不调用后端。
    /// 后端报错时保留集合，下一次 release_all 会再尝试松开。
    pub fn release_all(&mut self) -> Result<(), CoreError> {
        if self.pressed.is_empty() {
            return Ok(());
        }
        let keys = self
            .pressed
            .iter()
            .map(|code| resolve_key(code))
            .collect::<Result<Vec<_>, _>>()?;
        self.backend.send_raw(&keys, &[])?;
        self.pressed.clear();
        Ok(())
    }
}
