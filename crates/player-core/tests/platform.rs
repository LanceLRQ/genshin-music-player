use player_core::platform::{
    TimerResolutionGuard, is_elevated, quote_windows_arg, raise_thread_priority,
    windows_command_line,
};

#[test]
fn plain_arguments_are_not_quoted() {
    assert_eq!(quote_windows_arg("play"), "play");
    assert_eq!(
        quote_windows_arg(r"C:\Games\score.json"),
        r"C:\Games\score.json"
    );
}

#[test]
fn arguments_with_spaces_quotes_or_empty_are_quoted() {
    assert_eq!(quote_windows_arg(""), r#""""#);
    assert_eq!(quote_windows_arg("my score.json"), r#""my score.json""#);
    assert_eq!(quote_windows_arg(r#"say "hi""#), r#""say \"hi\"""#);
    assert_eq!(quote_windows_arg(r"C:\My Dir\"), r#""C:\My Dir\\""#);
    assert_eq!(quote_windows_arg(r#"a\"b c"#), r#""a\\\"b c""#);
}

#[test]
fn command_line_joins_quoted_arguments() {
    let args = vec![
        "--countdown".to_string(),
        "3".to_string(),
        "my score.json".to_string(),
    ];
    assert_eq!(
        windows_command_line(&args),
        r#"--countdown 3 "my score.json""#
    );
    assert_eq!(windows_command_line(&[]), "");
}

#[cfg(not(windows))]
#[test]
fn non_windows_platform_functions_are_no_ops() {
    use player_core::error::ErrorCode;
    use player_core::platform::restart_as_admin;

    assert_eq!(is_elevated(), None);
    assert_eq!(
        restart_as_admin().unwrap_err().code,
        ErrorCode::NotSupported
    );
    assert!(!raise_thread_priority());
    let guard = TimerResolutionGuard::acquire();
    assert!(!guard.is_active());
    drop(guard);
}

/// restart_as_admin 会弹出 UAC，不在自动化测试中调用
#[cfg(windows)]
#[test]
fn windows_platform_functions_work() {
    assert!(is_elevated().is_some());
    assert!(raise_thread_priority());
    let guard = TimerResolutionGuard::acquire();
    assert!(guard.is_active());
    drop(guard);
}
