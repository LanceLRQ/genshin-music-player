//! 前台窗口检测：只读取前台窗口的类名和标题，不打开任何进程句柄。

use serde::{Deserialize, Serialize};

pub mod mock;
#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(windows)]
pub mod windows;

pub const DEFAULT_CLASS_NAME: &str = "UnityWndClass";
pub const DEFAULT_TITLES: [&str; 2] = ["原神", "Genshin Impact"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowRule {
    pub class_name: String,
    pub titles: Vec<String>,
}

impl Default for WindowRule {
    fn default() -> Self {
        Self {
            class_name: DEFAULT_CLASS_NAME.to_string(),
            titles: DEFAULT_TITLES
                .iter()
                .map(|title| title.to_string())
                .collect(),
        }
    }
}

impl WindowRule {
    /// 类名完全相等，并且标题与 titles 中的某一项完全相等
    pub fn matches(&self, class_name: &str, title: &str) -> bool {
        self.class_name == class_name && self.titles.iter().any(|candidate| candidate == title)
    }
}

pub trait WindowProbe: Send {
    fn is_target_foreground(&self) -> bool;
}

/// macOS 前台匹配（纯函数，全平台可测）：窗口标题列表同时匹配前台应用名或窗口标题，类名忽略。
/// macOS 10.15 起读取其他应用的窗口标题需要屏幕录制权限，应用名（kCGWindowOwnerName）始终可得，
/// 所以浏览器云原神这类场景按应用名（如 Google Chrome）配置即可。
pub fn mac_window_matches(rule: &WindowRule, owner: Option<&str>, title: Option<&str>) -> bool {
    rule.titles
        .iter()
        .any(|candidate| Some(candidate.as_str()) == owner || Some(candidate.as_str()) == title)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule() -> WindowRule {
        WindowRule {
            class_name: "UnityWndClass".to_string(),
            titles: vec!["Genshin Impact".to_string(), "Google Chrome".to_string()],
        }
    }

    #[test]
    fn mac_window_matches_accepts_owner_or_title() {
        assert!(mac_window_matches(&rule(), Some("Google Chrome"), None));
        assert!(mac_window_matches(&rule(), None, Some("Genshin Impact")));
        assert!(!mac_window_matches(&rule(), Some("Safari"), Some("云原神")));
    }

    #[test]
    fn mac_window_matches_requires_exact_equality() {
        assert!(!mac_window_matches(&rule(), Some("Google Chrome Canary"), None));
        assert!(!mac_window_matches(&rule(), None, Some("原神")));
        assert!(!mac_window_matches(&rule(), None, None));
    }

    #[test]
    fn mac_window_matches_ignores_class_name() {
        let mut other = rule();
        other.class_name = "Anything".to_string();
        assert!(mac_window_matches(&other, Some("Google Chrome"), None));
    }
}

impl<P: WindowProbe + ?Sized> WindowProbe for Box<P> {
    fn is_target_foreground(&self) -> bool {
        (**self).is_target_foreground()
    }
}

/// 关闭前台检测时使用（gm-verify --no-guard）
#[derive(Debug, Clone, Copy, Default)]
pub struct AlwaysForeground;

impl WindowProbe for AlwaysForeground {
    fn is_target_foreground(&self) -> bool {
        true
    }
}

/// 把 Win32 返回的 UTF-16 缓冲区转成字符串；len 是系统调用返回的字符数（≤ 0 表示没有内容）
pub fn utf16_text(buffer: &[u16], len: i32) -> String {
    let len = usize::try_from(len).unwrap_or(0).min(buffer.len());
    String::from_utf16_lossy(&buffer[..len])
}
