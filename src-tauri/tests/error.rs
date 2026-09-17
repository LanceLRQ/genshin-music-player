use genshin_music_player_lib::error::{AppError, AppErrorCode};
use player_core::error::{CoreError, ErrorCode};
use serde_json::json;

/// 来源：前端 `src/ipc/types.ts` 的 `BACKEND_ERROR_CODES`。前端列表变化时这里必须保持一致。
const FRONTEND_BACKEND_ERROR_CODES: [&str; 16] = [
    "TIMELINE_INVALID",
    "UNKNOWN_KEY_CODE",
    "PARAMS_INVALID",
    "NO_EXECUTION",
    "PLAYER_BUSY",
    "INVALID_STATE",
    "INPUT_SEND_FAILED",
    "PLAYER_PANIC",
    "NOT_SUPPORTED",
    "ELEVATION_FAILED",
    "INSTRUMENT_INVALID",
    "INSTRUMENT_ID_CONFLICT",
    "INSTRUMENT_NOT_FOUND",
    "SETTINGS_INVALID",
    "HOTKEY_REGISTER_FAILED",
    "STORAGE_IO",
];

#[test]
fn error_codes_match_frontend_list() {
    let codes: Vec<&str> = AppErrorCode::ALL.iter().map(|code| code.as_str()).collect();
    assert_eq!(codes, FRONTEND_BACKEND_ERROR_CODES);
}

#[test]
fn error_code_as_str_matches_serialized_form() {
    for code in AppErrorCode::ALL {
        assert_eq!(serde_json::to_value(code).unwrap(), json!(code.as_str()));
    }
}

#[test]
fn app_error_serializes_to_code_and_message() {
    assert_eq!(
        serde_json::to_value(AppError::no_execution()).unwrap(),
        json!({ "code": "NO_EXECUTION", "message": "还没有准备好的演奏，请先导入乐谱" })
    );
    assert_eq!(
        AppError::no_execution().to_string(),
        "还没有准备好的演奏，请先导入乐谱"
    );
}

#[test]
fn core_errors_keep_code_and_message() {
    let core_errors = [
        CoreError::timeline_invalid("第 2 个按键的时间早于上一个按键"),
        CoreError::unknown_key_code("KeyFoo"),
        CoreError::params_invalid("速度必须在 0.5–2.0 之间"),
        CoreError::player_busy(),
        CoreError::invalid_state("继续"),
        CoreError::input_send_failed(5),
        CoreError::player_panic(),
        CoreError::not_supported(),
        CoreError::elevation_failed(),
    ];
    let expected = [
        ErrorCode::TimelineInvalid,
        ErrorCode::UnknownKeyCode,
        ErrorCode::ParamsInvalid,
        ErrorCode::PlayerBusy,
        ErrorCode::InvalidState,
        ErrorCode::InputSendFailed,
        ErrorCode::PlayerPanic,
        ErrorCode::NotSupported,
        ErrorCode::ElevationFailed,
    ];
    for (core_error, core_code) in core_errors.into_iter().zip(expected) {
        let message = core_error.message.clone();
        let app_error = AppError::from(core_error);
        assert_eq!(app_error.code.as_str(), core_code.as_str());
        assert_eq!(app_error.message, message);
    }
}

#[test]
fn app_error_messages_are_chinese() {
    assert_eq!(
        AppError::instrument_id_conflict("windsong-lyre").message,
        "「windsong-lyre」是内置乐器的 id"
    );
    assert_eq!(
        AppError::instrument_not_found("my-lyre").message,
        "找不到自定义乐器「my-lyre」"
    );
    assert_eq!(
        AppError::hotkey_register_failed("F9").message,
        "热键「F9」注册失败，可能被其他程序占用"
    );
    assert_eq!(
        AppError::storage_io("磁盘已满").message,
        "读写文件失败：磁盘已满"
    );
    assert_eq!(
        AppError::params_invalid("倒计时不能超过 10 秒").message,
        "倒计时不能超过 10 秒"
    );
    assert_eq!(
        AppError::params_invalid("倒计时不能超过 10 秒").code,
        AppErrorCode::ParamsInvalid
    );
}
