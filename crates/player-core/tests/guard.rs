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
