use std::fs;

use genshin_music_player_lib::error::AppErrorCode;
use genshin_music_player_lib::settings::{
    Settings, ShortcutScope, load_settings, save_settings_file, validate_settings,
    validate_shortcut,
};
use serde_json::json;
use tempfile::TempDir;

use ShortcutScope::{Global, Window};

#[test]
fn default_settings_match_frontend_defaults() {
    // 来源：前端 `src/ipc/types.ts` 的 `DEFAULT_SETTINGS`
    assert_eq!(
        serde_json::to_value(Settings::default()).unwrap(),
        json!({
            "hotkeys": { "toggle": "F9", "stop": "F10" },
            "shortcuts": { "openFile": "CmdOrCtrl+O", "previewToggle": "Space", "previewStop": "Escape" },
            "countdownSec": 3,
            "targetWindow": { "className": "UnityWndClass", "titles": ["原神", "Genshin Impact"] },
            "defaultHumanizeMs": 0.0,
            "writeExecutionLog": true,
            "simulateSound": false
        })
    );
    assert_eq!(validate_settings(&Settings::default()), Ok(()));
}

#[test]
fn missing_shortcuts_field_uses_defaults() {
    let settings: Settings = serde_json::from_value(json!({
        "hotkeys": { "toggle": "F7", "stop": "F8" },
        "countdownSec": 5,
        "targetWindow": { "className": "UnityWndClass", "titles": ["原神"] },
        "defaultHumanizeMs": 4,
        "writeExecutionLog": false
    }))
    .unwrap();
    assert_eq!(settings.shortcuts, Settings::default().shortcuts);
    assert_eq!(settings.hotkeys.toggle, "F7");
    assert_eq!(settings.countdown_sec, 5);
    assert!(!settings.simulate_sound, "旧版 settings.json 没有该字段时补默认值 false");
}

/// 用例表与 M3b 任务 5 `src/lib/shortcuts.test.ts` 的 validateShortcut 用例逐条对应
#[test]
fn valid_shortcuts_match_frontend_cases() {
    let cases = [
        ("F9", Global),
        ("F12", Global),
        ("CmdOrCtrl+O", Global),
        ("Alt+Shift+1", Global),
        ("CmdOrCtrl+Alt+Shift+F5", Global),
        ("Ctrl+Z", Window),
        ("Space", Window),
        ("Escape", Window),
        ("Enter", Window),
        ("Shift+F1", Window),
    ];
    for (value, scope) in cases {
        assert_eq!(
            validate_shortcut(value, scope),
            Ok(()),
            "「{value}」应当合法"
        );
    }
}

#[test]
fn invalid_shortcuts_match_frontend_reasons() {
    let cases = [
        ("", Global, "快捷键不能为空"),
        ("Ctrl++O", Global, "快捷键格式错误「Ctrl++O」"),
        ("Meta+O", Global, "不支持的修饰键「Meta」"),
        ("Alt+Alt+O", Global, "修饰键「Alt」重复"),
        (
            "Shift+Alt+O",
            Global,
            "修饰键顺序应为 CmdOrCtrl、Ctrl、Alt、Shift",
        ),
        ("CmdOrCtrl+Ctrl+O", Window, "CmdOrCtrl 和 Ctrl 不能同时使用"),
        (
            "CmdOrCtrl+Tab",
            Window,
            "不支持的按键「Tab」，只能使用 A–Z、0–9、F1–F12、Space、Escape、Enter",
        ),
        (
            "F13",
            Global,
            "不支持的按键「F13」，只能使用 A–Z、0–9、F1–F12、Space、Escape、Enter",
        ),
        (
            "o",
            Window,
            "不支持的按键「o」，只能使用 A–Z、0–9、F1–F12、Space、Escape、Enter",
        ),
        ("Space", Global, "全局热键不能使用 Space"),
        ("Alt+Enter", Global, "全局热键不能使用 Enter"),
        ("Shift+Space", Window, "Space 不能搭配修饰键"),
        ("Q", Global, "字母和数字键必须搭配修饰键"),
        ("7", Window, "字母和数字键必须搭配修饰键"),
    ];
    for (value, scope, reason) in cases {
        assert_eq!(
            validate_shortcut(value, scope),
            Err(reason.to_string()),
            "「{value}」"
        );
    }
}

#[test]
fn function_keys_must_be_written_exactly() {
    for value in ["F0", "F01", "f9", "F1 "] {
        assert!(validate_shortcut(value, Global).is_err(), "「{value}」");
    }
}

fn invalid_message(settings: &Settings) -> String {
    let error = validate_settings(settings).unwrap_err();
    assert_eq!(error.code, AppErrorCode::SettingsInvalid);
    error.message
}

#[test]
fn validate_settings_checks_ranges_and_window_rule() {
    let mut settings = Settings {
        countdown_sec: 11,
        ..Settings::default()
    };
    assert_eq!(invalid_message(&settings), "倒计时必须在 0–10 秒之间");
    settings.countdown_sec = 10;
    assert_eq!(validate_settings(&settings), Ok(()));

    for humanize in [-1.0, 30.5, f64::NAN] {
        let settings = Settings {
            default_humanize_ms: humanize,
            ..Settings::default()
        };
        assert_eq!(invalid_message(&settings), "默认人性化必须在 0–30ms 之间");
    }

    let mut settings = Settings::default();
    settings.target_window.class_name = "  ".to_string();
    assert_eq!(invalid_message(&settings), "游戏窗口类名不能为空");
    let mut settings = Settings::default();
    settings.target_window.titles.clear();
    assert_eq!(invalid_message(&settings), "至少需要一个游戏窗口标题");
    let mut settings = Settings::default();
    settings.target_window.titles.push(String::new());
    assert_eq!(invalid_message(&settings), "游戏窗口标题不能为空");
}

#[test]
fn validate_settings_checks_each_shortcut_with_its_scope() {
    let mut settings = Settings::default();
    settings.hotkeys.stop = "Escape".to_string();
    assert_eq!(
        invalid_message(&settings),
        "「停止」快捷键无效：全局热键不能使用 Escape"
    );
    let mut settings = Settings::default();
    settings.shortcuts.open_file = "O".to_string();
    assert_eq!(
        invalid_message(&settings),
        "「打开文件」快捷键无效：字母和数字键必须搭配修饰键"
    );
}

#[test]
fn validate_settings_rejects_duplicate_shortcuts() {
    let mut settings = Settings::default();
    settings.shortcuts.open_file = "F9".to_string();
    assert_eq!(
        invalid_message(&settings),
        "「开始 / 暂停 / 继续」和「打开文件」的快捷键相同（F9）"
    );
    let mut settings = Settings::default();
    settings.shortcuts.preview_stop = "Space".to_string();
    assert_eq!(
        invalid_message(&settings),
        "「开始 / 停止试听」和「停止试听」的快捷键相同（Space）"
    );
}

#[test]
fn save_then_load_round_trips() {
    let temp = TempDir::new().unwrap();
    let path = temp.path().join("data").join("settings.json");
    let mut settings = Settings::default();
    settings.hotkeys.toggle = "Alt+Shift+1".to_string();
    settings.countdown_sec = 0;
    save_settings_file(&path, &settings).unwrap();
    assert!(fs::read_to_string(&path).unwrap().ends_with("}\n"));
    let loaded = load_settings(&path);
    assert_eq!(loaded.settings, settings);
    assert_eq!(loaded.warning, None);
}

#[test]
fn missing_file_loads_defaults_without_warning() {
    let temp = TempDir::new().unwrap();
    let loaded = load_settings(&temp.path().join("settings.json"));
    assert_eq!(loaded.settings, Settings::default());
    assert_eq!(loaded.warning, None);
}

#[test]
fn corrupted_file_is_renamed_to_bak_and_defaults_are_used() {
    let temp = TempDir::new().unwrap();
    let path = temp.path().join("settings.json");
    fs::write(&path, "{ 坏掉的 JSON").unwrap();
    let loaded = load_settings(&path);
    assert_eq!(loaded.settings, Settings::default());
    let warning = loaded.warning.unwrap();
    assert!(warning.starts_with("设置文件已损坏（"), "{warning}");
    assert!(
        warning.ends_with("），已改名为 settings.json.bak 并恢复默认设置"),
        "{warning}"
    );
    assert!(!path.exists());
    assert_eq!(
        fs::read_to_string(temp.path().join("settings.json.bak")).unwrap(),
        "{ 坏掉的 JSON"
    );
}

#[test]
fn invalid_settings_file_is_treated_as_corrupted() {
    let temp = TempDir::new().unwrap();
    let path = temp.path().join("settings.json");
    let mut value = serde_json::to_value(Settings::default()).unwrap();
    value["countdownSec"] = json!(99);
    fs::write(&path, value.to_string()).unwrap();
    let loaded = load_settings(&path);
    assert_eq!(loaded.settings, Settings::default());
    assert_eq!(
        loaded.warning.as_deref(),
        Some(
            "设置文件已损坏（倒计时必须在 0–10 秒之间），已改名为 settings.json.bak 并恢复默认设置"
        )
    );
    assert!(temp.path().join("settings.json.bak").exists());
}
