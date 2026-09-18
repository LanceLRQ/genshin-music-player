//! IPC 命令：只做参数转发，逻辑在 AppState 中。
//!
//! 前端 `invoke` 的 camelCase 参数名由 Tauri 对应到这里的 snake_case 参数：
//! `save_custom_instrument { profile }`、`delete_custom_instrument { id }`、`save_settings { settings }`、
//! `build_execution { timeline, params }`、`play { countdownSec? }`，其余命令没有参数。

use player_core::model::{ExecutionParams, ExecutionTimeline, KeyTimeline};
use player_core::platform;
use player_core::player::PlayerState;
use serde_json::Value;
use tauri::ipc::Invoke;
use tauri::{AppHandle, Runtime, State};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

use crate::error::AppError;
use crate::hotkeys::with_hotkeys_released;
use crate::settings::Settings;
use crate::state::{AppState, EnvInfo};
use crate::storage::CustomInstrumentList;

#[tauri::command]
pub fn get_env<R: Runtime>(app: AppHandle<R>, state: State<'_, AppState>) -> EnvInfo {
    state.env_info(
        &app.package_info().version.to_string(),
        platform::is_elevated(),
    )
}

/// macOS：打开系统设置的辅助功能面板（CGEvent 发键需要该权限）。其他平台返回 NOT_SUPPORTED。
#[tauri::command]
pub fn open_accessibility_settings() -> Result<(), AppError> {
    platform::open_accessibility_settings().map_err(AppError::from)
}

/// 提权前先注销当前热键，避免新旧进程同时占着 F9 / F10 导致新进程 setup 时注册失败：
/// 提权失败时尽力恢复热键（`with_hotkeys_released`）后把错误返回给前端；
/// 提权成功时热键保持注销（新进程的 setup 会重新注册），先停止演奏（松开所有按键），再退出当前进程。
#[tauri::command]
pub fn restart_as_admin<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let hotkeys = state.settings().hotkeys;
    with_hotkeys_released(app.global_shortcut(), &hotkeys, || {
        platform::restart_as_admin().map_err(AppError::from)
    })?;
    // 即将退出进程：stop 失败（例如已经是 Idle 返回 INVALID_STATE）不影响退出，忽略错误
    let _ = state.stop();
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub fn list_custom_instruments(state: State<'_, AppState>) -> CustomInstrumentList {
    state.list_custom_instruments()
}

#[tauri::command]
pub fn save_custom_instrument(state: State<'_, AppState>, profile: Value) -> Result<(), AppError> {
    state.save_custom_instrument(&profile)
}

#[tauri::command]
pub fn delete_custom_instrument(state: State<'_, AppState>, id: String) -> Result<(), AppError> {
    state.delete_custom_instrument(&id)
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings()
}

#[tauri::command]
pub fn save_settings<R: Runtime>(
    app: AppHandle<R>,
    state: State<'_, AppState>,
    settings: Settings,
) -> Result<Settings, AppError> {
    state.save_settings(settings, app.global_shortcut())
}

#[tauri::command]
pub fn build_execution(
    state: State<'_, AppState>,
    timeline: KeyTimeline,
    params: ExecutionParams,
) -> Result<ExecutionTimeline, AppError> {
    state.build_execution(&timeline, &params)
}

#[tauri::command]
pub fn play(state: State<'_, AppState>, countdown_sec: Option<u32>) -> Result<(), AppError> {
    state.play(countdown_sec)
}

#[tauri::command]
pub fn pause(state: State<'_, AppState>) -> Result<(), AppError> {
    state.pause()
}

#[tauri::command]
pub fn resume(state: State<'_, AppState>) -> Result<(), AppError> {
    state.resume()
}

#[tauri::command]
pub fn stop(state: State<'_, AppState>) -> Result<(), AppError> {
    state.stop()
}

#[tauri::command]
pub fn get_player_state(state: State<'_, AppState>) -> PlayerState {
    state.player_state()
}

/// 全部 14 个命令；应用和测试（MockRuntime）共用
pub fn invoke_handler<R: Runtime>() -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        get_env,
        open_accessibility_settings,
        restart_as_admin,
        list_custom_instruments,
        save_custom_instrument,
        delete_custom_instrument,
        get_settings,
        save_settings,
        build_execution,
        play,
        pause,
        resume,
        stop,
        get_player_state,
    ]
}
