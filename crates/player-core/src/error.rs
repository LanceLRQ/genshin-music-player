use serde::Serialize;
use thiserror::Error;

/// 执行核心的错误码，序列化为 `TIMELINE_INVALID` 这样的大写蛇形字符串
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    TimelineInvalid,
    UnknownKeyCode,
    ParamsInvalid,
    PlayerBusy,
    InvalidState,
    InputSendFailed,
    PlayerPanic,
    NotSupported,
    ElevationFailed,
}

impl ErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            ErrorCode::TimelineInvalid => "TIMELINE_INVALID",
            ErrorCode::UnknownKeyCode => "UNKNOWN_KEY_CODE",
            ErrorCode::ParamsInvalid => "PARAMS_INVALID",
            ErrorCode::PlayerBusy => "PLAYER_BUSY",
            ErrorCode::InvalidState => "INVALID_STATE",
            ErrorCode::InputSendFailed => "INPUT_SEND_FAILED",
            ErrorCode::PlayerPanic => "PLAYER_PANIC",
            ErrorCode::NotSupported => "NOT_SUPPORTED",
            ErrorCode::ElevationFailed => "ELEVATION_FAILED",
        }
    }
}

/// 序列化为 `{ "code": "...", "message": "..." }`，message 是给用户看的中文
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Error)]
#[error("{message}")]
pub struct CoreError {
    pub code: ErrorCode,
    pub message: String,
}

impl CoreError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn timeline_invalid(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::TimelineInvalid, message)
    }

    pub fn unknown_key_code(code: &str) -> Self {
        Self::new(ErrorCode::UnknownKeyCode, format!("未知键码「{code}」"))
    }

    pub fn params_invalid(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::ParamsInvalid, message)
    }

    pub fn player_busy() -> Self {
        Self::new(ErrorCode::PlayerBusy, "正在演奏中，请先停止")
    }

    /// action 是动作名称，例如「暂停」「继续」
    pub fn invalid_state(action: &str) -> Self {
        Self::new(ErrorCode::InvalidState, format!("当前状态不能{action}"))
    }

    pub fn input_send_failed(os_error: u32) -> Self {
        Self::new(
            ErrorCode::InputSendFailed,
            format!("按键发送失败（系统错误 {os_error}）"),
        )
    }

    pub fn player_panic() -> Self {
        Self::new(ErrorCode::PlayerPanic, "播放线程异常退出，已松开所有按键")
    }

    pub fn not_supported() -> Self {
        Self::new(ErrorCode::NotSupported, "当前平台不支持该操作")
    }

    pub fn elevation_failed() -> Self {
        Self::new(
            ErrorCode::ElevationFailed,
            "未能以管理员身份重启（可能取消了授权）",
        )
    }
}
