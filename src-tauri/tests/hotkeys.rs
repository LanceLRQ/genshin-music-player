mod common;

use common::{FakeRegistrar, hotkeys, strings};
use genshin_music_player_lib::error::{AppError, AppErrorCode};
use genshin_music_player_lib::hotkeys::{
    HotkeyAction, HotkeyRegistrar, hotkey_action, parse_hotkey, register_hotkeys,
    register_missing_hotkeys, register_on_startup, replace_hotkeys, with_hotkeys_released,
};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

#[test]
fn settings_shortcut_strings_parse_without_conversion() {
    let cmd_or_ctrl = if cfg!(target_os = "macos") {
        Modifiers::SUPER
    } else {
        Modifiers::CONTROL
    };
    let cases = [
        ("F9", Shortcut::new(None, Code::F9)),
        ("F12", Shortcut::new(None, Code::F12)),
        ("CmdOrCtrl+O", Shortcut::new(Some(cmd_or_ctrl), Code::KeyO)),
        (
            "Alt+Shift+1",
            Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::Digit1),
        ),
        (
            "CmdOrCtrl+Alt+Shift+F5",
            Shortcut::new(
                Some(cmd_or_ctrl | Modifiers::ALT | Modifiers::SHIFT),
                Code::F5,
            ),
        ),
        (
            "Ctrl+Z",
            Shortcut::new(Some(Modifiers::CONTROL), Code::KeyZ),
        ),
        ("Space", Shortcut::new(None, Code::Space)),
        ("Escape", Shortcut::new(None, Code::Escape)),
        ("Enter", Shortcut::new(None, Code::Enter)),
    ];
    for (value, expected) in cases {
        assert_eq!(
            parse_hotkey(value).map(|s| s.id()),
            Ok(expected.id()),
            "{value}"
        );
    }
}

#[test]
fn only_pressed_toggle_or_stop_maps_to_action() {
    let hotkeys = hotkeys("Alt+Shift+1", "F10");
    let toggle = Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::Digit1);
    let stop = Shortcut::new(None, Code::F10);
    assert_eq!(
        hotkey_action(&hotkeys, &toggle, ShortcutState::Pressed),
        Some(HotkeyAction::Toggle)
    );
    assert_eq!(
        hotkey_action(&hotkeys, &stop, ShortcutState::Pressed),
        Some(HotkeyAction::Stop)
    );
    assert_eq!(
        hotkey_action(&hotkeys, &toggle, ShortcutState::Released),
        None
    );
    assert_eq!(
        hotkey_action(
            &hotkeys,
            &Shortcut::new(None, Code::F9),
            ShortcutState::Pressed
        ),
        None
    );
}

#[test]
fn register_rolls_back_when_second_hotkey_fails() {
    let registrar = FakeRegistrar::occupied(&["F10"]);
    let error = register_hotkeys(&registrar, &hotkeys("F9", "F10")).unwrap_err();
    assert_eq!(error.code, AppErrorCode::HotkeyRegisterFailed);
    assert_eq!(error.message, "热键「F10」注册失败，可能被其他程序占用");
    assert!(registrar.registered().is_empty());
}

#[test]
fn startup_registration_keeps_successful_hotkeys_and_reports_failures() {
    let registrar = FakeRegistrar::occupied(&["F9"]);
    let warnings = register_on_startup(&registrar, &hotkeys("F9", "F10"));
    assert_eq!(
        warnings,
        strings(&["热键「F9」注册失败，可能被其他程序占用"])
    );
    assert_eq!(registrar.registered(), strings(&["F10"]));
}

#[test]
fn replace_unregisters_old_and_registers_new() {
    let registrar = FakeRegistrar::default();
    register_hotkeys(&registrar, &hotkeys("F9", "F10")).unwrap();
    replace_hotkeys(
        &registrar,
        &hotkeys("F9", "F10"),
        &hotkeys("F10", "CmdOrCtrl+Q"),
    )
    .unwrap();
    assert_eq!(registrar.registered(), strings(&["CmdOrCtrl+Q", "F10"]));
}

#[test]
fn replace_failure_restores_old_hotkeys() {
    let registrar = FakeRegistrar::occupied(&["F8"]);
    register_hotkeys(&registrar, &hotkeys("F9", "F10")).unwrap();
    let error =
        replace_hotkeys(&registrar, &hotkeys("F9", "F10"), &hotkeys("F7", "F8")).unwrap_err();
    assert_eq!(error.code, AppErrorCode::HotkeyRegisterFailed);
    assert_eq!(error.message, "热键「F8」注册失败，可能被其他程序占用");
    assert_eq!(registrar.registered(), strings(&["F10", "F9"]));
}

#[test]
fn replace_failure_reports_hotkeys_that_could_not_be_restored() {
    let registrar = FakeRegistrar::occupied(&["F8"]).block_after_unregister(&["F9", "F10"]);
    register_hotkeys(&registrar, &hotkeys("F9", "F10")).unwrap();
    let error =
        replace_hotkeys(&registrar, &hotkeys("F9", "F10"), &hotkeys("F7", "F8")).unwrap_err();
    assert_eq!(error.code, AppErrorCode::HotkeyRegisterFailed);
    assert_eq!(
        error.message,
        "热键「F8」注册失败，可能被其他程序占用，原热键「F9」、「F10」也未能恢复"
    );
    assert!(registrar.registered().is_empty());
}

#[test]
fn replace_failure_does_not_restore_hotkeys_that_were_never_registered() {
    let registrar = FakeRegistrar::occupied(&["F9", "F8"]);
    assert_eq!(
        register_on_startup(&registrar, &hotkeys("F9", "F10")).len(),
        1
    );
    replace_hotkeys(&registrar, &hotkeys("F9", "F10"), &hotkeys("F7", "F8")).unwrap_err();
    assert_eq!(registrar.registered(), strings(&["F10"]));
}

#[test]
fn with_hotkeys_released_unregisters_before_f_runs() {
    let registrar = FakeRegistrar::default();
    register_hotkeys(&registrar, &hotkeys("F9", "F10")).unwrap();
    let mut registered_during_f = true;
    with_hotkeys_released(&registrar, &hotkeys("F9", "F10"), || {
        registered_during_f = registrar.is_registered("F9") || registrar.is_registered("F10");
        Ok::<(), AppError>(())
    })
    .unwrap();
    assert!(!registered_during_f, "f 执行期间热键应当处于未注册状态");
}

#[test]
fn with_hotkeys_released_keeps_hotkeys_unregistered_when_f_succeeds() {
    let registrar = FakeRegistrar::default();
    register_hotkeys(&registrar, &hotkeys("F9", "F10")).unwrap();
    let value = with_hotkeys_released(&registrar, &hotkeys("F9", "F10"), || {
        Ok::<u32, AppError>(42)
    })
    .unwrap();
    assert_eq!(value, 42);
    assert!(
        registrar.registered().is_empty(),
        "f 成功后热键应当保持注销"
    );
}

#[test]
fn with_hotkeys_released_restores_hotkeys_when_f_fails() {
    let registrar = FakeRegistrar::default();
    register_hotkeys(&registrar, &hotkeys("F9", "F10")).unwrap();
    let error = with_hotkeys_released(&registrar, &hotkeys("F9", "F10"), || {
        Err::<(), AppError>(AppError::new(AppErrorCode::ElevationFailed, "提权失败"))
    })
    .unwrap_err();
    assert_eq!(error.message, "提权失败");
    assert_eq!(registrar.registered(), strings(&["F10", "F9"]));
}

#[test]
fn with_hotkeys_released_reports_hotkeys_that_could_not_be_restored() {
    let registrar = FakeRegistrar::default().block_after_unregister(&["F9", "F10"]);
    register_hotkeys(&registrar, &hotkeys("F9", "F10")).unwrap();
    let error = with_hotkeys_released(&registrar, &hotkeys("F9", "F10"), || {
        Err::<(), AppError>(AppError::new(AppErrorCode::ElevationFailed, "提权失败"))
    })
    .unwrap_err();
    assert_eq!(error.message, "提权失败，原热键「F9」、「F10」也未能恢复");
    assert!(registrar.registered().is_empty());
}

#[test]
fn register_missing_hotkeys_only_registers_unregistered_ones() {
    let registrar = FakeRegistrar::occupied(&["F9"]);
    register_on_startup(&registrar, &hotkeys("F9", "F10"));
    assert_eq!(registrar.registered(), strings(&["F10"]));
    register_missing_hotkeys(&registrar, &hotkeys("F9", "F10"));
    assert_eq!(
        registrar.registered(),
        strings(&["F10"]),
        "F9 仍被占用，补注册失败但不报错"
    );
}
