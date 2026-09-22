//! src-tauri 测试共用的辅助代码
#![allow(dead_code)]

use std::collections::BTreeSet;
use std::sync::{Arc, Mutex, PoisonError, RwLock};
use std::thread;
use std::time::{Duration, Instant};

use genshin_music_player_lib::hotkeys::HotkeyRegistrar;
use genshin_music_player_lib::settings::{Hotkeys, Settings};
use genshin_music_player_lib::state::{AppState, player_config};
use genshin_music_player_lib::storage::AppPaths;
use player_core::guard::mock::MockProbe;
use player_core::input::KeyboardOutput;
use player_core::input::mock::MockBackend;
use player_core::model::{KeyTimeline, Press};
use player_core::player::{Player, PlayerSink, PlayerState, Progress, Summary};
use tempfile::TempDir;

/// 记录注册状态；occupied 中的组合键模拟"被其他程序占用"，注册总是失败。
/// `block_after_unregister` 是链式开关：一旦这些组合键被注销，后续任何注册都会失败，
/// 用于模拟"恢复旧热键时旧热键也被其他程序占用"
#[derive(Default)]
pub struct FakeRegistrar {
    registered: Mutex<BTreeSet<String>>,
    occupied: BTreeSet<String>,
    blocked_after_unregister: BTreeSet<String>,
    blocked: Mutex<BTreeSet<String>>,
}

impl FakeRegistrar {
    pub fn occupied(values: &[&str]) -> Self {
        Self {
            occupied: values.iter().map(|value| value.to_string()).collect(),
            ..Self::default()
        }
    }

    pub fn block_after_unregister(mut self, values: &[&str]) -> Self {
        self.blocked_after_unregister = values.iter().map(|value| value.to_string()).collect();
        self
    }

    pub fn registered(&self) -> Vec<String> {
        self.set().iter().cloned().collect()
    }

    fn set(&self) -> std::sync::MutexGuard<'_, BTreeSet<String>> {
        self.registered
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    fn blocked(&self) -> std::sync::MutexGuard<'_, BTreeSet<String>> {
        self.blocked.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl HotkeyRegistrar for FakeRegistrar {
    fn register(&self, hotkey: &str) -> Result<(), String> {
        if self.occupied.contains(hotkey)
            || self.blocked().contains(hotkey)
            || !self.set().insert(hotkey.to_string())
        {
            return Err(format!("{hotkey} 已被占用"));
        }
        Ok(())
    }

    fn unregister(&self, hotkey: &str) -> Result<(), String> {
        self.set().remove(hotkey);
        if self.blocked_after_unregister.contains(hotkey) {
            self.blocked().insert(hotkey.to_string());
        }
        Ok(())
    }

    fn is_registered(&self, hotkey: &str) -> bool {
        self.set().contains(hotkey)
    }
}

pub fn hotkeys(toggle: &str, stop: &str) -> Hotkeys {
    Hotkeys {
        toggle: toggle.to_string(),
        stop: stop.to_string(),
    }
}

pub fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| value.to_string()).collect()
}

/// 记录 Summary；clone 出来的句柄共享同一份记录
#[derive(Debug, Clone, Default)]
pub struct RecordingSink {
    summaries: Arc<Mutex<Vec<Summary>>>,
}

impl RecordingSink {
    pub fn summaries(&self) -> Vec<Summary> {
        self.summaries
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
}

impl PlayerSink for RecordingSink {
    fn on_state(&self, _state: &PlayerState) {}

    fn on_progress(&self, _progress: &Progress) {}

    fn on_summary(&self, summary: &Summary) {
        self.summaries
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(summary.clone());
    }
}

pub struct TestApp {
    pub state: AppState,
    pub backend: MockBackend,
    pub sink: RecordingSink,
    /// 数据目录，测试结束时删除
    pub temp: TempDir,
}

/// 用 Mock 后端、Mock 前台检测和临时数据目录创建 AppState
pub fn test_app(settings: Settings) -> TestApp {
    let temp = TempDir::new().unwrap();
    let paths = AppPaths::new(temp.path());
    let backend = MockBackend::new();
    let sink = RecordingSink::default();
    let window_rule = Arc::new(RwLock::new(settings.target_window.clone()));
    let player = Player::spawn(
        KeyboardOutput::new(backend.clone()),
        MockProbe::new(),
        sink.clone(),
        player_config(&settings, &paths),
    )
    .expect("应能创建播放线程");
    let state = AppState::new(player, "mock", settings, window_rule, paths, Vec::new());
    TestApp {
        state,
        backend,
        sink,
        temp,
    }
}

/// presses 为 (tMs, 键码)，holdMs 固定为 10
pub fn key_timeline(presses: &[(f64, &str)], duration_ms: f64) -> KeyTimeline {
    KeyTimeline {
        instrument_id: "windsong-lyre".to_string(),
        duration_ms,
        min_repeat_gap_ms: 40.0,
        presses: presses
            .iter()
            .map(|(t_ms, code)| Press {
                t_ms: *t_ms,
                codes: vec![code.to_string()],
                hold_ms: 10.0,
                sustain_ms: None,
            })
            .collect(),
        release_gap_ms: None,
    }
}

pub fn wait_until(mut condition: impl FnMut() -> bool) -> bool {
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(5) {
        if condition() {
            return true;
        }
        thread::sleep(Duration::from_millis(5));
    }
    condition()
}
