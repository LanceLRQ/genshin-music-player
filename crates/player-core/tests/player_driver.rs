//! Player 调度线程测试：真实时间，时间线短、断言宽松，避免 CI 抖动。

mod common;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use common::{RecordingSink, codes, execution};
use player_core::error::ErrorCode;
use player_core::guard::WindowProbe;
use player_core::guard::mock::MockProbe;
use player_core::input::KeyboardOutput;
use player_core::input::mock::{MockBackend, SentKeys};
use player_core::player::state::{Command, PlayerState};
use player_core::player::{Player, PlayerConfig};

const TIMEOUT: Duration = Duration::from_secs(5);

fn wait_until(mut condition: impl FnMut() -> bool) -> bool {
    let started = Instant::now();
    while started.elapsed() < TIMEOUT {
        if condition() {
            return true;
        }
        thread::sleep(Duration::from_millis(5));
    }
    condition()
}

fn spawn_mock() -> (Player, MockBackend, RecordingSink) {
    let backend = MockBackend::new();
    let sink = RecordingSink::default();
    let player = Player::spawn(
        KeyboardOutput::new(backend.clone()),
        MockProbe::new(),
        sink.clone(),
        PlayerConfig::default(),
    );
    (player, backend, sink)
}

fn downs(backend: &MockBackend) -> Vec<Vec<String>> {
    backend
        .calls()
        .into_iter()
        .filter(|call| !call.down.is_empty())
        .map(|call| call.down)
        .collect()
}

/// 第一次调用时 panic，之后始终在前台
struct PanicOnceProbe {
    panicked: AtomicBool,
}

impl WindowProbe for PanicOnceProbe {
    fn is_target_foreground(&self) -> bool {
        if !self.panicked.swap(true, Ordering::SeqCst) {
            panic!("模拟前台检测崩溃");
        }
        true
    }
}

#[test]
fn short_timeline_plays_to_the_end() {
    let (player, backend, sink) = spawn_mock();
    let timeline = execution(&[
        (0.0, &["KeyA"], 10.0),
        (20.0, &["KeyS"], 10.0),
        (40.0, &["KeyD"], 10.0),
    ]);
    player
        .send(Command::Play {
            execution: timeline,
            countdown_sec: 0,
        })
        .unwrap();
    assert!(
        wait_until(|| player.state() == PlayerState::Idle),
        "应在超时前播完"
    );
    assert_eq!(
        downs(&backend),
        vec![codes(&["KeyA"]), codes(&["KeyS"]), codes(&["KeyD"])]
    );
    let summaries = sink.summaries();
    assert_eq!(summaries.len(), 1);
    assert!(summaries[0].completed);
    assert_eq!(summaries[0].events_sent, 6);
    assert!(summaries[0].lateness_max_ms >= 0.0);
}

#[test]
fn stop_takes_effect_immediately() {
    let (player, backend, sink) = spawn_mock();
    let presses: Vec<(f64, &[&str], f64)> = (0..200)
        .map(|i| (f64::from(i) * 50.0, &["KeyA"][..], 400.0))
        .collect();
    player
        .send(Command::Play {
            execution: execution(&presses),
            countdown_sec: 0,
        })
        .unwrap();
    assert!(wait_until(|| !backend.calls().is_empty()));
    player.send(Command::Stop).unwrap();
    assert_eq!(
        player.state(),
        PlayerState::Idle,
        "send 返回时命令已经处理完"
    );

    let calls = backend.calls();
    assert_eq!(
        calls.last(),
        Some(&SentKeys {
            up: codes(&["KeyA"]),
            down: vec![],
        }),
        "停止时松开按下的键"
    );
    thread::sleep(Duration::from_millis(150));
    assert_eq!(backend.calls().len(), calls.len(), "停止后不再发送");
    let summary = sink.summaries().pop().unwrap();
    assert!(!summary.completed);
}

#[test]
fn play_while_busy_returns_player_busy() {
    let (player, _backend, _sink) = spawn_mock();
    let timeline = execution(&[(0.0, &["KeyA"], 30.0)]);
    player
        .send(Command::Play {
            execution: Arc::clone(&timeline),
            countdown_sec: 5,
        })
        .unwrap();
    assert_eq!(player.state(), PlayerState::Countdown { remaining_sec: 5 });
    let error = player
        .send(Command::Play {
            execution: timeline,
            countdown_sec: 0,
        })
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::PlayerBusy);
    player.send(Command::Stop).unwrap();
    assert_eq!(player.state(), PlayerState::Idle);
}

#[test]
fn panic_in_player_thread_enters_error_and_thread_keeps_running() {
    let backend = MockBackend::new();
    let player = Player::spawn(
        KeyboardOutput::new(backend.clone()),
        PanicOnceProbe {
            panicked: AtomicBool::new(false),
        },
        RecordingSink::default(),
        PlayerConfig::default(),
    );
    let timeline = execution(&[(0.0, &["KeyA"], 10.0)]);
    let error = player
        .send(Command::Play {
            execution: Arc::clone(&timeline),
            countdown_sec: 0,
        })
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::PlayerPanic);
    assert_eq!(
        player.state(),
        PlayerState::Error {
            code: "PLAYER_PANIC".to_string(),
            message: "播放线程异常退出，已松开所有按键".to_string(),
        }
    );

    player
        .send(Command::Play {
            execution: timeline,
            countdown_sec: 0,
        })
        .unwrap();
    assert!(wait_until(|| player.state() == PlayerState::Idle));
    assert_eq!(downs(&backend), vec![codes(&["KeyA"])]);
}

#[test]
fn dropping_player_releases_keys_and_joins_thread() {
    let (player, backend, _sink) = spawn_mock();
    player
        .send(Command::Play {
            execution: execution(&[(0.0, &["KeyA"], 60_000.0)]),
            countdown_sec: 0,
        })
        .unwrap();
    assert!(wait_until(|| !backend.calls().is_empty()));
    drop(player);
    assert_eq!(
        backend.calls().last(),
        Some(&SentKeys {
            up: codes(&["KeyA"]),
            down: vec![],
        })
    );
}
