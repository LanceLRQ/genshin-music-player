use player_core::guard::mock::MockProbe;
use player_core::guard::{AlwaysForeground, WindowProbe, WindowRule, utf16_text};
use serde_json::json;

#[test]
fn default_rule_targets_genshin_window() {
    let rule = WindowRule::default();
    assert_eq!(rule.class_name, "UnityWndClass");
    assert_eq!(rule.titles, vec!["原神", "Genshin Impact"]);
}

#[test]
fn rule_requires_exact_class_and_title() {
    let rule = WindowRule::default();
    assert!(rule.matches("UnityWndClass", "原神"));
    assert!(rule.matches("UnityWndClass", "Genshin Impact"));
    assert!(!rule.matches("UnityWndClass", "原神 - 记事本"));
    assert!(!rule.matches("Notepad", "原神"));
    let empty = WindowRule {
        class_name: "UnityWndClass".to_string(),
        titles: vec![],
    };
    assert!(!empty.matches("UnityWndClass", ""));
}

#[test]
fn rule_serializes_to_camel_case() {
    assert_eq!(
        serde_json::to_value(WindowRule::default()).unwrap(),
        json!({ "className": "UnityWndClass", "titles": ["原神", "Genshin Impact"] })
    );
}

#[test]
fn mock_probe_defaults_to_foreground_and_shares_state() {
    let probe = MockProbe::new();
    let handle = probe.clone();
    assert!(probe.is_target_foreground());
    handle.set_foreground(false);
    assert!(!probe.is_target_foreground());
}

/// 真机冒烟：CGWindowList 能拿到最前面的普通层窗口，应用名非空且与规则匹配后返回 true
#[cfg(target_os = "macos")]
#[test]
fn mac_probe_queries_the_real_frontmost_window_without_panicking() {
    use std::sync::{Arc, RwLock};

    use player_core::guard::macos::{MacProbe, frontmost_window_info};

    let probe = MacProbe::new(Arc::new(RwLock::new(WindowRule::default())));
    let _ = probe.is_target_foreground();

    let (owner, _title) = frontmost_window_info().expect("桌面上应存在最前面的普通层窗口");
    let owner = owner.expect("前台窗口应带有应用名");
    let probe = MacProbe::new(Arc::new(RwLock::new(WindowRule {
        class_name: String::new(),
        titles: vec![owner],
    })));
    assert!(probe.is_target_foreground(), "前台应用名应能被规则匹配");
}

#[test]
fn boxed_probe_and_always_foreground() {
    let boxed: Box<dyn WindowProbe> = Box::new(AlwaysForeground);
    assert!(boxed.is_target_foreground());
    let mock = MockProbe::new();
    mock.set_foreground(false);
    let boxed_mock: Box<dyn WindowProbe> = Box::new(mock);
    assert!(!boxed_mock.is_target_foreground());
}

#[test]
fn utf16_text_uses_returned_length() {
    let mut buffer = [0u16; 8];
    for (slot, unit) in buffer.iter_mut().zip("原神".encode_utf16()) {
        *slot = unit;
    }
    assert_eq!(utf16_text(&buffer, 2), "原神");
    assert_eq!(utf16_text(&buffer, 1), "原");
    assert_eq!(utf16_text(&buffer, 0), "");
    assert_eq!(utf16_text(&buffer, -1), "");
    assert_eq!(utf16_text(&buffer[..2], 100), "原神");
}
