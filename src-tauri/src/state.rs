//! AppState：IPC 命令与全局热键共用的应用状态。所有方法都不依赖 AppHandle，可以在测试中用 Mock 播放器驱动。
//!
//! 锁的约定：`current`、`settings`、`window_rule` 只在命令线程和热键回调中短暂持有，持有期间不调用
//! `Player::send`；播放线程（PlayerSink 回调）不访问 AppState，避免与等待 `send` 返回的线程互相等待。

use std::sync::{Arc, Mutex, PoisonError, RwLock};

use player_core::guard::WindowRule;
use player_core::model::{ExecutionParams, ExecutionTimeline, KeyTimeline};
use player_core::platform;
use player_core::player::{Command, Player, PlayerConfig, PlayerState};
use player_core::timeline::build_execution;
use serde::Serialize;
use serde_json::Value;

use crate::error::AppError;
use crate::hotkeys::{HotkeyAction, HotkeyRegistrar, register_missing_hotkeys, replace_hotkeys};
use crate::settings::{MAX_COUNTDOWN_SEC, Settings, save_settings_file, validate_settings};
use crate::storage::{self, AppPaths, CustomInstrumentList};

/// `get_env` 的返回值
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvInfo {
    /// `windows` / `macos` / `linux`
    pub platform: &'static str,
    /// `windows` / `macos` / `mock`
    pub backend: &'static str,
    /// 只有 Windows 上有值
    pub elevated: Option<bool>,
    /// 只有 macOS 上有值：是否已授予辅助功能权限（CGEvent 发键的前提）
    pub trusted: Option<bool>,
    pub app_version: String,
    pub data_dir: String,
    pub logs_dir: String,
    pub startup_warnings: Vec<String>,
}

pub fn current_platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

/// 写执行日志时日志目录为 logs_dir，否则不写
pub fn log_dir_for(settings: &Settings, paths: &AppPaths) -> Option<std::path::PathBuf> {
    settings.write_execution_log.then(|| paths.logs_dir.clone())
}

pub fn player_config(settings: &Settings, paths: &AppPaths) -> PlayerConfig {
    PlayerConfig {
        log_dir: log_dir_for(settings, paths),
        ..PlayerConfig::default()
    }
}

pub struct AppState {
    /// `Player` 本身是 `Send + Sync`，不需要再包 `Mutex`
    pub player: Player,
    /// 输入后端名称：`windows` / `mock`
    pub backend: &'static str,
    /// 最近一次 build_execution 的结果，play 与热键使用
    pub current: Mutex<Option<Arc<ExecutionTimeline>>>,
    pub settings: RwLock<Settings>,
    /// 与 WindowsProbe 共享，保存设置后立即生效
    pub window_rule: Arc<RwLock<WindowRule>>,
    pub paths: AppPaths,
    pub startup_warnings: Vec<String>,
}

impl AppState {
    pub fn new(
        player: Player,
        backend: &'static str,
        settings: Settings,
        window_rule: Arc<RwLock<WindowRule>>,
        paths: AppPaths,
        startup_warnings: Vec<String>,
    ) -> Self {
        Self {
            player,
            backend,
            current: Mutex::new(None),
            settings: RwLock::new(settings),
            window_rule,
            paths,
            startup_warnings,
        }
    }

    pub fn env_info(&self, app_version: &str, elevated: Option<bool>) -> EnvInfo {
        EnvInfo {
            platform: current_platform(),
            backend: self.backend,
            elevated,
            trusted: platform::is_trusted(),
            app_version: app_version.to_string(),
            data_dir: self.paths.data_dir.to_string_lossy().into_owned(),
            logs_dir: self.paths.logs_dir.to_string_lossy().into_owned(),
            startup_warnings: self.startup_warnings.clone(),
        }
    }

    pub fn settings(&self) -> Settings {
        self.settings
            .read()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    fn current(&self) -> Option<Arc<ExecutionTimeline>> {
        self.current
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    /// 生成执行时间线并缓存为"当前演奏"。空时间线在这里拦截：
    /// 否则 range.endMs 取 durationMs = 0 时会因为 endMs > startMs 不成立报 PARAMS_INVALID，提示不直观。
    pub fn build_execution(
        &self,
        timeline: &KeyTimeline,
        params: &ExecutionParams,
    ) -> Result<ExecutionTimeline, AppError> {
        if timeline.presses.is_empty()
            || timeline.duration_ms.is_nan()
            || timeline.duration_ms <= 0.0
        {
            return Err(AppError::timeline_invalid(
                "乐谱中没有可以演奏的按键，请先导入乐谱并选择音轨",
            ));
        }
        let execution = build_execution(timeline, params)?;
        *self.current.lock().unwrap_or_else(PoisonError::into_inner) =
            Some(Arc::new(execution.clone()));
        Ok(execution)
    }

    /// 演奏"当前演奏"；不传倒计时时用设置里的值；显式传入的倒计时超过 MAX_COUNTDOWN_SEC 时返回参数错误
    pub fn play(&self, countdown_sec: Option<u32>) -> Result<(), AppError> {
        let execution = self.current().ok_or_else(AppError::no_execution)?;
        let countdown_sec = match countdown_sec {
            Some(seconds) if seconds > MAX_COUNTDOWN_SEC => {
                return Err(AppError::params_invalid(format!(
                    "倒计时不能超过 {MAX_COUNTDOWN_SEC} 秒"
                )));
            }
            Some(seconds) => seconds,
            None => self.settings().countdown_sec,
        };
        self.send(Command::Play {
            execution,
            countdown_sec,
        })
    }

    pub fn pause(&self) -> Result<(), AppError> {
        self.send(Command::Pause)
    }

    pub fn resume(&self) -> Result<(), AppError> {
        self.send(Command::Resume)
    }

    pub fn stop(&self) -> Result<(), AppError> {
        self.send(Command::Stop)
    }

    pub fn player_state(&self) -> PlayerState {
        self.player.state()
    }

    /// 全局热键：toggle 发送 Toggle（带当前演奏与设置里的倒计时），stop 发送 Stop
    pub fn handle_hotkey(&self, action: HotkeyAction) -> Result<(), AppError> {
        match action {
            HotkeyAction::Toggle => self.send(Command::Toggle {
                execution: self.current(),
                countdown_sec: self.settings().countdown_sec,
            }),
            HotkeyAction::Stop => self.stop(),
        }
    }

    /// 校验 → 处理热键 → 更新窗口规则 → 更新执行日志目录 → 写文件。返回实际保存的设置。
    ///
    /// 热键处理分两种情况：热键有变化时重新注册（失败时恢复旧热键并报错，见 `replace_hotkeys`）；
    /// 热键没变化时只尽力补注册当前未注册的键（见 `register_missing_hotkeys`），不因为某个热键仍被
    /// 占用（例如启动时就注册失败、此刻仍未释放）就拒绝保存其他跟热键无关的设置改动。
    pub fn save_settings(
        &self,
        settings: Settings,
        registrar: &impl HotkeyRegistrar,
    ) -> Result<Settings, AppError> {
        validate_settings(&settings)?;
        let old = self.settings();
        if old.hotkeys == settings.hotkeys {
            register_missing_hotkeys(registrar, &settings.hotkeys);
        } else {
            replace_hotkeys(registrar, &old.hotkeys, &settings.hotkeys)?;
        }
        *self
            .window_rule
            .write()
            .unwrap_or_else(PoisonError::into_inner) = settings.target_window.clone();
        *self
            .settings
            .write()
            .unwrap_or_else(PoisonError::into_inner) = settings.clone();
        self.send(Command::SetLogDir {
            log_dir: log_dir_for(&settings, &self.paths),
        })?;
        save_settings_file(&self.paths.settings_file, &settings)?;
        Ok(settings)
    }

    pub fn list_custom_instruments(&self) -> CustomInstrumentList {
        storage::list_custom_instruments(&self.paths.instruments_dir)
    }

    pub fn save_custom_instrument(&self, profile: &Value) -> Result<(), AppError> {
        storage::save_custom_instrument(&self.paths.instruments_dir, profile)
    }

    pub fn delete_custom_instrument(&self, id: &str) -> Result<(), AppError> {
        storage::delete_custom_instrument(&self.paths.instruments_dir, id)
    }

    fn send(&self, command: Command) -> Result<(), AppError> {
        self.player.send(command).map_err(AppError::from)
    }
}
