//! AppError：IPC 命令返回给前端的错误，序列化为 `{ "code": "...", "message": "..." }`。

use std::fmt::Display;

use player_core::error::{CoreError, ErrorCode};
use serde::Serialize;

/// 后端错误码，与前端 `src/ipc/types.ts` 的 `BACKEND_ERROR_CODES` 一一对应
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AppErrorCode {
    TimelineInvalid,
    UnknownKeyCode,
    ParamsInvalid,
    NoExecution,
    PlayerBusy,
    InvalidState,
    InputSendFailed,
    PlayerPanic,
    NotSupported,
    ElevationFailed,
    InstrumentInvalid,
    InstrumentIdConflict,
    InstrumentNotFound,
    SettingsInvalid,
    HotkeyRegisterFailed,
    StorageIo,
}

impl AppErrorCode {
    /// 全部错误码，顺序与前端 `BACKEND_ERROR_CODES` 一致
    pub const ALL: [AppErrorCode; 16] = [
        AppErrorCode::TimelineInvalid,
        AppErrorCode::UnknownKeyCode,
        AppErrorCode::ParamsInvalid,
        AppErrorCode::NoExecution,
        AppErrorCode::PlayerBusy,
        AppErrorCode::InvalidState,
        AppErrorCode::InputSendFailed,
        AppErrorCode::PlayerPanic,
        AppErrorCode::NotSupported,
        AppErrorCode::ElevationFailed,
        AppErrorCode::InstrumentInvalid,
        AppErrorCode::InstrumentIdConflict,
        AppErrorCode::InstrumentNotFound,
        AppErrorCode::SettingsInvalid,
        AppErrorCode::HotkeyRegisterFailed,
        AppErrorCode::StorageIo,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            AppErrorCode::TimelineInvalid => "TIMELINE_INVALID",
            AppErrorCode::UnknownKeyCode => "UNKNOWN_KEY_CODE",
            AppErrorCode::ParamsInvalid => "PARAMS_INVALID",
            AppErrorCode::NoExecution => "NO_EXECUTION",
            AppErrorCode::PlayerBusy => "PLAYER_BUSY",
            AppErrorCode::InvalidState => "INVALID_STATE",
            AppErrorCode::InputSendFailed => "INPUT_SEND_FAILED",
            AppErrorCode::PlayerPanic => "PLAYER_PANIC",
            AppErrorCode::NotSupported => "NOT_SUPPORTED",
            AppErrorCode::ElevationFailed => "ELEVATION_FAILED",
            AppErrorCode::InstrumentInvalid => "INSTRUMENT_INVALID",
            AppErrorCode::InstrumentIdConflict => "INSTRUMENT_ID_CONFLICT",
            AppErrorCode::InstrumentNotFound => "INSTRUMENT_NOT_FOUND",
            AppErrorCode::SettingsInvalid => "SETTINGS_INVALID",
            AppErrorCode::HotkeyRegisterFailed => "HOTKEY_REGISTER_FAILED",
            AppErrorCode::StorageIo => "STORAGE_IO",
        }
    }
}

impl From<ErrorCode> for AppErrorCode {
    fn from(code: ErrorCode) -> Self {
        match code {
            ErrorCode::TimelineInvalid => AppErrorCode::TimelineInvalid,
            ErrorCode::UnknownKeyCode => AppErrorCode::UnknownKeyCode,
            ErrorCode::ParamsInvalid => AppErrorCode::ParamsInvalid,
            ErrorCode::PlayerBusy => AppErrorCode::PlayerBusy,
            ErrorCode::InvalidState => AppErrorCode::InvalidState,
            ErrorCode::InputSendFailed => AppErrorCode::InputSendFailed,
            ErrorCode::PlayerPanic => AppErrorCode::PlayerPanic,
            ErrorCode::NotSupported => AppErrorCode::NotSupported,
            ErrorCode::ElevationFailed => AppErrorCode::ElevationFailed,
        }
    }
}

/// message 是给用户看的中文
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AppError {
    pub code: AppErrorCode,
    pub message: String,
}

impl Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for AppError {}

impl From<CoreError> for AppError {
    fn from(error: CoreError) -> Self {
        Self::new(error.code.into(), error.message)
    }
}

impl AppError {
    pub fn new(code: AppErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn timeline_invalid(message: impl Into<String>) -> Self {
        Self::new(AppErrorCode::TimelineInvalid, message)
    }

    pub fn no_execution() -> Self {
        Self::new(
            AppErrorCode::NoExecution,
            "还没有准备好的演奏，请先导入乐谱",
        )
    }

    pub fn instrument_invalid(message: impl Into<String>) -> Self {
        Self::new(AppErrorCode::InstrumentInvalid, message)
    }

    pub fn instrument_id_conflict(id: &str) -> Self {
        Self::new(
            AppErrorCode::InstrumentIdConflict,
            format!("「{id}」是内置乐器的 id"),
        )
    }

    pub fn instrument_not_found(id: &str) -> Self {
        Self::new(
            AppErrorCode::InstrumentNotFound,
            format!("找不到自定义乐器「{id}」"),
        )
    }

    pub fn settings_invalid(message: impl Into<String>) -> Self {
        Self::new(AppErrorCode::SettingsInvalid, message)
    }

    pub fn hotkey_register_failed(hotkey: &str) -> Self {
        Self::new(
            AppErrorCode::HotkeyRegisterFailed,
            format!("热键「{hotkey}」注册失败，可能被其他程序占用"),
        )
    }

    pub fn storage_io(detail: impl Display) -> Self {
        Self::new(AppErrorCode::StorageIo, format!("读写文件失败：{detail}"))
    }
}
