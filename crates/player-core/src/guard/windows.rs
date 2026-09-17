//! 前台窗口检测（仅 Windows 编译）。

use std::sync::{Arc, PoisonError, RwLock};

use windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetForegroundWindow, GetWindowTextW};

use super::{WindowProbe, WindowRule, utf16_text};

pub const CLASS_NAME_BUFFER_LEN: usize = 256;
pub const TITLE_BUFFER_LEN: usize = 512;

/// 与设置共享窗口规则，修改后立即生效
pub struct WindowsProbe {
    rule: Arc<RwLock<WindowRule>>,
}

impl WindowsProbe {
    pub fn new(rule: Arc<RwLock<WindowRule>>) -> Self {
        Self { rule }
    }
}

impl WindowProbe for WindowsProbe {
    fn is_target_foreground(&self) -> bool {
        // SAFETY: 只查询前台窗口句柄，不打开任何进程
        let hwnd = unsafe { GetForegroundWindow() };
        if hwnd.is_invalid() {
            return false;
        }
        let mut class_buffer = [0u16; CLASS_NAME_BUFFER_LEN];
        // SAFETY: 缓冲区长度由切片传入
        let class_len = unsafe { GetClassNameW(hwnd, &mut class_buffer) };
        let mut title_buffer = [0u16; TITLE_BUFFER_LEN];
        // SAFETY: 缓冲区长度由切片传入
        let title_len = unsafe { GetWindowTextW(hwnd, &mut title_buffer) };
        let rule = self.rule.read().unwrap_or_else(PoisonError::into_inner);
        rule.matches(
            &utf16_text(&class_buffer, class_len),
            &utf16_text(&title_buffer, title_len),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_runner_window_is_not_the_game() {
        let probe = WindowsProbe::new(Arc::new(RwLock::new(WindowRule::default())));
        assert!(!probe.is_target_foreground());
    }
}
