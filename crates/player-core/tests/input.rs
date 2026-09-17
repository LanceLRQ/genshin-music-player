use player_core::error::ErrorCode;
use player_core::input::mock::{MockBackend, SentKeys};
use player_core::input::{
    FLAG_EXTENDED_KEY, FLAG_KEY_UP, FLAG_SCANCODE, InputBackend, KeyStroke, KeyboardOutput,
    key_strokes,
};
use player_core::keymap::{KeyInfo, key_info};

fn codes(list: &[&str]) -> Vec<String> {
    list.iter().map(|code| code.to_string()).collect()
}

fn sent(up: &[&str], down: &[&str]) -> SentKeys {
    SentKeys {
        up: codes(up),
        down: codes(down),
    }
}

fn output() -> (KeyboardOutput<MockBackend>, MockBackend) {
    let backend = MockBackend::new();
    (KeyboardOutput::new(backend.clone()), backend)
}

#[test]
fn flags_match_win32_values() {
    assert_eq!(FLAG_EXTENDED_KEY, 0x0001);
    assert_eq!(FLAG_KEY_UP, 0x0002);
    assert_eq!(FLAG_SCANCODE, 0x0008);
    let stroke = |extended, key_up| KeyStroke {
        scan: 16,
        extended,
        key_up,
    };
    assert_eq!(stroke(false, false).flags(), 0x0008);
    assert_eq!(stroke(false, true).flags(), 0x000A);
    assert_eq!(stroke(true, false).flags(), 0x0009);
    assert_eq!(stroke(true, true).flags(), 0x000B);
}

#[test]
fn key_strokes_put_up_before_down() {
    let q = key_info("KeyQ").unwrap();
    let a = key_info("KeyA").unwrap();
    let extended = KeyInfo {
        code: "Test",
        scan: 0x1d,
        extended: true,
    };
    assert_eq!(
        key_strokes(&[q], &[a, extended]),
        vec![
            KeyStroke {
                scan: 16,
                extended: false,
                key_up: true,
            },
            KeyStroke {
                scan: 30,
                extended: false,
                key_up: false,
            },
            KeyStroke {
                scan: 0x1d,
                extended: true,
                key_up: false,
            },
        ]
    );
    assert!(key_strokes(&[], &[]).is_empty());
}

#[test]
fn send_forwards_up_and_down_in_one_call() {
    let (mut output, backend) = output();
    output.send(&[], &codes(&["KeyA"])).unwrap();
    output
        .send(&codes(&["KeyA"]), &codes(&["KeyS", "KeyD"]))
        .unwrap();
    assert_eq!(
        backend.calls(),
        vec![sent(&[], &["KeyA"]), sent(&["KeyA"], &["KeyS", "KeyD"])]
    );
    assert_eq!(output.pressed(), codes(&["KeyD", "KeyS"]));
    assert_eq!(output.backend_name(), "mock");
}

#[test]
fn send_skips_up_for_keys_not_pressed() {
    let (mut output, backend) = output();
    output.send(&codes(&["KeyA"]), &[]).unwrap();
    assert!(backend.calls().is_empty(), "全部被过滤时不调用后端");
    output.send(&codes(&["KeyA"]), &codes(&["KeyS"])).unwrap();
    assert_eq!(backend.calls(), vec![sent(&[], &["KeyS"])]);
}

#[test]
fn send_skips_down_for_keys_already_pressed() {
    let (mut output, backend) = output();
    output.send(&[], &codes(&["KeyA", "KeyA"])).unwrap();
    output.send(&[], &codes(&["KeyA"])).unwrap();
    assert_eq!(backend.calls(), vec![sent(&[], &["KeyA"])]);
}

#[test]
fn send_allows_release_and_press_same_key_in_one_call() {
    let (mut output, backend) = output();
    output.send(&[], &codes(&["KeyA"])).unwrap();
    output.send(&codes(&["KeyA"]), &codes(&["KeyA"])).unwrap();
    assert_eq!(
        backend.calls(),
        vec![sent(&[], &["KeyA"]), sent(&["KeyA"], &["KeyA"])]
    );
    assert_eq!(output.pressed(), codes(&["KeyA"]));
}

#[test]
fn release_all_releases_every_pressed_key_once() {
    let (mut output, backend) = output();
    output.release_all().unwrap();
    assert!(backend.calls().is_empty(), "没有按下的键时不调用后端");

    output.send(&[], &codes(&["KeyS", "KeyA"])).unwrap();
    output.release_all().unwrap();
    output.release_all().unwrap();
    assert_eq!(
        backend.calls(),
        vec![sent(&[], &["KeyS", "KeyA"]), sent(&["KeyA", "KeyS"], &[])]
    );
    assert!(output.pressed().is_empty());
}

#[test]
fn unknown_code_is_rejected_without_calling_backend() {
    let (mut output, backend) = output();
    let error = output.send(&[], &codes(&["KeyFoo"])).unwrap_err();
    assert_eq!(error.code, ErrorCode::UnknownKeyCode);
    assert!(backend.calls().is_empty());
    assert!(output.pressed().is_empty());
}

#[test]
fn backend_failure_is_reported_and_keys_are_still_released_later() {
    let (mut output, backend) = output();
    backend.fail_next_call();
    let error = output.send(&[], &codes(&["KeyA"])).unwrap_err();
    assert_eq!(error.code, ErrorCode::InputSendFailed);
    assert_eq!(error.message, "按键发送失败（系统错误 5）");
    output.release_all().unwrap();
    assert_eq!(backend.calls(), vec![sent(&["KeyA"], &[])]);
}

#[test]
fn failed_send_keeps_both_released_and_pressed_keys() {
    let (mut output, backend) = output();
    output.send(&[], &codes(&["KeyA"])).unwrap();
    backend.fail_next_call();
    let error = output
        .send(&codes(&["KeyA"]), &codes(&["KeyS"]))
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::InputSendFailed);
    assert_eq!(
        output.pressed(),
        codes(&["KeyA", "KeyS"]),
        "发送可能只完成了一部分，KeyA 的 up 未必发出"
    );
    output.release_all().unwrap();
    assert_eq!(
        backend.calls(),
        vec![sent(&[], &["KeyA"]), sent(&["KeyA", "KeyS"], &[])]
    );
}

#[test]
fn failed_release_all_keeps_keys_for_next_attempt() {
    let (mut output, backend) = output();
    output.send(&[], &codes(&["KeyA"])).unwrap();
    backend.fail_next_call();
    assert_eq!(
        output.release_all().unwrap_err().code,
        ErrorCode::InputSendFailed
    );
    assert_eq!(output.pressed(), codes(&["KeyA"]));
    output.release_all().unwrap();
    assert_eq!(
        backend.calls(),
        vec![sent(&[], &["KeyA"]), sent(&["KeyA"], &[])]
    );
    assert!(output.pressed().is_empty());
}

#[test]
fn mock_backend_records_raw_calls() {
    let mut backend = MockBackend::new();
    let handle = backend.clone();
    let q = key_info("KeyQ").unwrap();
    backend.send_raw(&[q], &[]).unwrap();
    assert_eq!(handle.calls(), vec![sent(&["KeyQ"], &[])]);
    assert_eq!(backend.name(), "mock");
}
