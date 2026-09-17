//! AppState 测试：Mock 播放器（真实时间）+ 临时数据目录 + 假的热键注册器。

mod common;

use std::fs;

use common::{FakeRegistrar, hotkeys, key_timeline, strings, test_app, wait_until};
use genshin_music_player_lib::error::AppErrorCode;
use genshin_music_player_lib::hotkeys::{HotkeyAction, register_hotkeys};
use genshin_music_player_lib::settings::{Settings, load_settings};
use genshin_music_player_lib::state::current_platform;
use player_core::guard::WindowRule;
use player_core::model::ExecutionParams;
use player_core::player::PlayerState;
use serde_json::json;

fn params_for(duration_ms: f64) -> ExecutionParams {
    let mut params = ExecutionParams::default();
    params.range.end_ms = duration_ms;
    params
}

#[test]
fn env_info_serializes_platform_backend_and_paths() {
    let app = test_app(Settings::default());
    let env = serde_json::to_value(app.state.env_info("0.1.0", None)).unwrap();
    assert_eq!(
        env,
        json!({
            "platform": current_platform(),
            "backend": "mock",
            "elevated": null,
            "appVersion": "0.1.0",
            "dataDir": app.temp.path().to_string_lossy(),
            "logsDir": app.temp.path().join("logs").to_string_lossy(),
            "startupWarnings": []
        })
    );
    let expected_platform = if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    };
    assert_eq!(current_platform(), expected_platform);
}

#[test]
fn build_execution_rejects_empty_timeline_before_core_validation() {
    let app = test_app(Settings::default());
    for timeline in [
        key_timeline(&[], 1000.0),
        key_timeline(&[(0.0, "KeyA")], 0.0),
    ] {
        let error = app
            .state
            .build_execution(&timeline, &params_for(1000.0))
            .unwrap_err();
        assert_eq!(error.code, AppErrorCode::TimelineInvalid);
        assert_eq!(
            error.message,
            "乐谱中没有可以演奏的按键，请先导入乐谱并选择音轨"
        );
    }
    assert_eq!(
        app.state.play(None).unwrap_err().code,
        AppErrorCode::NoExecution
    );
}

#[test]
fn build_execution_caches_current_and_keeps_it_on_error() {
    let app = test_app(Settings::default());
    let timeline = key_timeline(&[(0.0, "KeyA"), (20.0, "KeyS")], 30.0);
    let execution = app
        .state
        .build_execution(&timeline, &params_for(30.0))
        .unwrap();
    assert_eq!(execution.events.len(), 4);
    assert_eq!(
        app.state.current.lock().unwrap().as_deref(),
        Some(&execution)
    );

    let unknown = key_timeline(&[(0.0, "KeyFoo")], 30.0);
    let error = app
        .state
        .build_execution(&unknown, &params_for(30.0))
        .unwrap_err();
    assert_eq!(error.code, AppErrorCode::UnknownKeyCode);
    assert_eq!(error.message, "未知键码「KeyFoo」");
    assert_eq!(
        app.state.current.lock().unwrap().as_deref(),
        Some(&execution),
        "失败时保留上一次的当前演奏"
    );
}

#[test]
fn play_without_execution_returns_no_execution() {
    let app = test_app(Settings::default());
    let error = app.state.play(Some(0)).unwrap_err();
    assert_eq!(error.code, AppErrorCode::NoExecution);
    assert_eq!(error.message, "还没有准备好的演奏，请先导入乐谱");
}

#[test]
fn play_uses_settings_countdown_unless_given() {
    let app = test_app(Settings {
        countdown_sec: 4,
        ..Settings::default()
    });
    let timeline = key_timeline(&[(0.0, "KeyA")], 1000.0);
    app.state
        .build_execution(&timeline, &params_for(1000.0))
        .unwrap();

    app.state.play(None).unwrap();
    assert_eq!(
        app.state.player_state(),
        PlayerState::Countdown { remaining_sec: 4 }
    );
    let busy = app.state.play(None).unwrap_err();
    assert_eq!(busy.code, AppErrorCode::PlayerBusy);
    app.state.stop().unwrap();

    app.state.play(Some(7)).unwrap();
    assert_eq!(
        app.state.player_state(),
        PlayerState::Countdown { remaining_sec: 7 }
    );
    app.state.stop().unwrap();
    assert_eq!(app.state.player_state(), PlayerState::Idle);
}

#[test]
fn pause_and_resume_errors_keep_core_codes() {
    let app = test_app(Settings::default());
    let error = app.state.resume().unwrap_err();
    assert_eq!(error.code, AppErrorCode::InvalidState);
    assert_eq!(error.message, "当前状态不能继续");
    assert_eq!(
        app.state.pause().unwrap_err().code,
        AppErrorCode::InvalidState
    );
    app.state.stop().unwrap();
}

#[test]
fn hotkeys_toggle_current_execution_and_stop() {
    let app = test_app(Settings {
        countdown_sec: 2,
        ..Settings::default()
    });
    app.state.handle_hotkey(HotkeyAction::Toggle).unwrap();
    assert_eq!(
        app.state.player_state(),
        PlayerState::Idle,
        "没有当前演奏时忽略"
    );

    let timeline = key_timeline(&[(0.0, "KeyA")], 1000.0);
    app.state
        .build_execution(&timeline, &params_for(1000.0))
        .unwrap();
    app.state.handle_hotkey(HotkeyAction::Toggle).unwrap();
    assert_eq!(
        app.state.player_state(),
        PlayerState::Countdown { remaining_sec: 2 },
        "使用设置里的倒计时"
    );
    app.state.handle_hotkey(HotkeyAction::Stop).unwrap();
    assert_eq!(app.state.player_state(), PlayerState::Idle);
}

#[test]
fn invalid_settings_are_rejected_before_touching_hotkeys() {
    let app = test_app(Settings::default());
    let registrar = FakeRegistrar::default();
    register_hotkeys(&registrar, &Settings::default().hotkeys).unwrap();
    let settings = Settings {
        countdown_sec: 11,
        ..Settings::default()
    };
    let error = app.state.save_settings(settings, &registrar).unwrap_err();
    assert_eq!(error.code, AppErrorCode::SettingsInvalid);
    assert_eq!(registrar.registered(), strings(&["F10", "F9"]));
    assert!(!app.state.paths.settings_file.exists());
    assert_eq!(app.state.settings(), Settings::default());
}

#[test]
fn save_settings_applies_hotkeys_window_rule_and_writes_file() {
    let app = test_app(Settings::default());
    let registrar = FakeRegistrar::default();
    register_hotkeys(&registrar, &Settings::default().hotkeys).unwrap();
    let settings = Settings {
        hotkeys: hotkeys("Alt+Shift+1", "F8"),
        target_window: WindowRule {
            class_name: "UnityWndClass".to_string(),
            titles: strings(&["原神"]),
        },
        countdown_sec: 0,
        ..Settings::default()
    };

    let saved = app
        .state
        .save_settings(settings.clone(), &registrar)
        .unwrap();
    assert_eq!(saved, settings);
    assert_eq!(registrar.registered(), strings(&["Alt+Shift+1", "F8"]));
    assert_eq!(
        *app.state.window_rule.read().unwrap(),
        settings.target_window
    );
    assert_eq!(app.state.settings(), settings);
    let loaded = load_settings(&app.state.paths.settings_file);
    assert_eq!(loaded.settings, settings);
    assert_eq!(loaded.warning, None);
}

#[test]
fn hotkey_failure_keeps_old_settings_and_hotkeys() {
    let app = test_app(Settings::default());
    let registrar = FakeRegistrar::occupied(&["F8"]);
    register_hotkeys(&registrar, &Settings::default().hotkeys).unwrap();
    let settings = Settings {
        hotkeys: hotkeys("F7", "F8"),
        ..Settings::default()
    };
    let error = app.state.save_settings(settings, &registrar).unwrap_err();
    assert_eq!(error.code, AppErrorCode::HotkeyRegisterFailed);
    assert_eq!(error.message, "热键「F8」注册失败，可能被其他程序占用");
    assert_eq!(registrar.registered(), strings(&["F10", "F9"]));
    assert_eq!(app.state.settings(), Settings::default());
    assert!(!app.state.paths.settings_file.exists());
}

#[test]
fn toggling_execution_log_takes_effect_on_next_summary() {
    let app = test_app(Settings {
        write_execution_log: false,
        ..Settings::default()
    });
    let registrar = FakeRegistrar::default();
    let timeline = key_timeline(&[(0.0, "KeyA"), (20.0, "KeyS")], 40.0);
    app.state
        .build_execution(&timeline, &params_for(40.0))
        .unwrap();

    app.state.play(Some(0)).unwrap();
    assert!(wait_until(|| app.sink.summaries().len() == 1));
    assert_eq!(app.sink.summaries()[0].log_path, None);

    app.state
        .save_settings(Settings::default(), &registrar)
        .unwrap();
    assert!(wait_until(|| app.state.player_state() == PlayerState::Idle));
    app.state.play(Some(0)).unwrap();
    assert!(wait_until(|| app.sink.summaries().len() == 2));
    let log_path = app.sink.summaries()[1].log_path.clone().unwrap();
    assert!(
        log_path.starts_with(&*app.state.paths.logs_dir.to_string_lossy()),
        "{log_path}"
    );
    assert!(fs::metadata(&log_path).unwrap().len() > 0);
    assert_eq!(app.backend.calls().len(), 8);
}

#[test]
fn custom_instruments_are_stored_in_data_dir() {
    let app = test_app(Settings::default());
    let profile = json!({ "schemaVersion": 1, "id": "my-lyre", "name": "我的诗琴" });
    app.state.save_custom_instrument(&profile).unwrap();
    assert!(
        app.temp
            .path()
            .join("instruments")
            .join("my-lyre.json")
            .exists()
    );
    assert_eq!(app.state.list_custom_instruments().profiles, vec![profile]);
    app.state.delete_custom_instrument("my-lyre").unwrap();
    assert!(app.state.list_custom_instruments().profiles.is_empty());
    assert_eq!(
        app.state
            .delete_custom_instrument("my-lyre")
            .unwrap_err()
            .code,
        AppErrorCode::InstrumentNotFound
    );
}
