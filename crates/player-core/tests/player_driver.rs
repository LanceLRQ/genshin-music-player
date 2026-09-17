//! Player 调度线程测试：真实时间，时间线短、断言宽松，避免 CI 抖动。

mod common;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock, PoisonError, Weak};
use std::thread;
use std::time::{Duration, Instant};

use common::{RecordingSink, codes, execution};
use player_core::error::{CoreError, ErrorCode};
use player_core::guard::WindowProbe;
use player_core::guard::mock::MockProbe;
use player_core::input::KeyboardOutput;
use player_core::input::mock::{MockBackend, SentKeys};
use player_core::player::state::{Command, PlayerSink, PlayerState, Progress, Summary};
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
    )
    .expect("应能创建播放线程");
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
    )
    .expect("应能创建播放线程");
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

/// 在 `on_state` 回调（运行在播放线程上）里尝试对同一个 `Player` 调用 `send`。
/// 用 `Weak` 而不是 `Arc` 持有引用：sink 活在播放线程里，若长期持有强引用会和
/// 外部持有的 `Arc<Player>` 形成引用环，导致 `Player` 永远不会真正被 drop。
struct DeadlockProbeSink {
    player: Arc<OnceLock<Weak<Player>>>,
    attempted: Arc<AtomicBool>,
    send_result: Arc<Mutex<Option<Result<(), CoreError>>>>,
}

impl PlayerSink for DeadlockProbeSink {
    fn on_state(&self, state: &PlayerState) {
        if !matches!(state, PlayerState::Playing) {
            return;
        }
        if self.attempted.swap(true, Ordering::SeqCst) {
            return;
        }
        if let Some(player) = self.player.get().and_then(Weak::upgrade) {
            let outcome = player.send(Command::Stop);
            *self
                .send_result
                .lock()
                .unwrap_or_else(PoisonError::into_inner) = Some(outcome);
        }
    }

    fn on_progress(&self, _progress: &Progress) {}

    fn on_summary(&self, _summary: &Summary) {}
}

#[test]
fn send_inside_sink_callback_returns_error_without_blocking() {
    let player_slot: Arc<OnceLock<Weak<Player>>> = Arc::new(OnceLock::new());
    let attempted = Arc::new(AtomicBool::new(false));
    let send_result: Arc<Mutex<Option<Result<(), CoreError>>>> = Arc::new(Mutex::new(None));
    let sink = DeadlockProbeSink {
        player: Arc::clone(&player_slot),
        attempted: Arc::clone(&attempted),
        send_result: Arc::clone(&send_result),
    };

    let player = Arc::new(
        Player::spawn(
            KeyboardOutput::new(MockBackend::new()),
            MockProbe::new(),
            sink,
            PlayerConfig::default(),
        )
        .expect("应能创建播放线程"),
    );
    player_slot
        .set(Arc::downgrade(&player))
        .expect("刚创建的 OnceLock 应当为空");

    // Play 命令本身要在有超时的等待里完成：如果 sink 在回调中调用 send 卡死了播放线程，
    // 这次 Play 也永远不会收到回复，主线程会被永久阻塞——所以放到另一个线程里发送，
    // 用 wait_until 从外部观察是否按时完成，而不是直接阻塞测试线程本身。
    let timeline = execution(&[(0.0, &["KeyA"], 10_000.0)]);
    let play_done = Arc::new(AtomicBool::new(false));
    let play_done_writer = Arc::clone(&play_done);
    let player_for_play = Arc::clone(&player);
    thread::spawn(move || {
        let _ = player_for_play.send(Command::Play {
            execution: timeline,
            countdown_sec: 0,
        });
        play_done_writer.store(true, Ordering::SeqCst);
    });

    assert!(
        wait_until(|| play_done.load(Ordering::SeqCst)),
        "Play 命令应在超时前处理完成；若播放线程被回调内的 send 卡住，这里会超时"
    );
    assert!(
        wait_until(|| attempted.load(Ordering::SeqCst)),
        "sink 应该在状态变化时尝试过一次 send"
    );
    let outcome = send_result
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .take()
        .expect("send 应当立即返回结果，而不是让回调一直挂起");
    let error =
        outcome.expect_err("在播放线程内调用 send 必须返回错误，不能阻塞也不能当作成功处理");
    assert_eq!(error.code, ErrorCode::InvalidState);

    assert!(
        wait_until(|| player.state() == PlayerState::Playing),
        "主线程之后仍能正常观察到状态推进，说明播放线程没有被卡住"
    );
    player.send(Command::Stop).unwrap();
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
