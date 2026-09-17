//! PlayerCore 状态机测试：时间全部手动传入，覆盖设计文档第 7.3 节状态转换表的每一行。

mod common;

use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use common::{RecordingSink, codes, execution, execution_with};
use player_core::error::ErrorCode;
use player_core::guard::mock::MockProbe;
use player_core::input::KeyboardOutput;
use player_core::input::mock::{MockBackend, SentKeys};
use player_core::model::{ExecutionParams, ExecutionTimeline};
use player_core::player::state::{Command, PauseReason, PlayerState, Progress};
use player_core::player::{PlayerConfig, PlayerCore, Wake};

type TestCore = PlayerCore<MockBackend, MockProbe, RecordingSink>;

struct Harness {
    core: TestCore,
    backend: MockBackend,
    probe: MockProbe,
    sink: RecordingSink,
}

fn harness_with(config: PlayerConfig) -> Harness {
    let backend = MockBackend::new();
    let probe = MockProbe::new();
    let sink = RecordingSink::default();
    let core = PlayerCore::new(
        KeyboardOutput::new(backend.clone()),
        probe.clone(),
        sink.clone(),
        config,
    );
    Harness {
        core,
        backend,
        probe,
        sink,
    }
}

fn harness() -> Harness {
    harness_with(PlayerConfig::default())
}

fn ms(value: u64) -> Duration {
    Duration::from_millis(value)
}

fn play(execution: Arc<ExecutionTimeline>, countdown_sec: u32) -> Command {
    Command::Play {
        execution,
        countdown_sec,
    }
}

fn sent(up: &[&str], down: &[&str]) -> SentKeys {
    SentKeys {
        up: codes(up),
        down: codes(down),
    }
}

fn paused(reason: PauseReason, position_ms: f64) -> PlayerState {
    PlayerState::Paused {
        reason,
        position_ms,
    }
}

/// KeyA 在 0ms 按下、500ms 松开；KeyS 在 200ms 按下、230ms 松开
fn overlapping() -> Arc<ExecutionTimeline> {
    execution(&[(0.0, &["KeyA"], 500.0), (200.0, &["KeyS"], 30.0)])
}

/// KeyA 在 0ms 按下、30ms 松开；KeyS 在 300ms 按下、330ms 松开
fn two_notes() -> Arc<ExecutionTimeline> {
    execution(&[(0.0, &["KeyA"], 30.0), (300.0, &["KeyS"], 30.0)])
}

/// 区间 0–400ms 循环：KeyA 0–30ms、KeyS 100–130ms，130ms 之后是尾部休止，durationMs = 400
fn looped_range() -> Arc<ExecutionTimeline> {
    let mut params = ExecutionParams::default();
    params.range.end_ms = 400.0;
    params.range.looped = true;
    execution_with(&[(0.0, &["KeyA"], 30.0), (100.0, &["KeyS"], 30.0)], params)
}

fn temp_log_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("gm-player-core-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    dir
}

#[test]
fn idle_play_with_countdown_enters_countdown() {
    let mut h = harness();
    h.core.handle(play(two_notes(), 3), ms(0)).unwrap();
    assert_eq!(h.core.state(), &PlayerState::Countdown { remaining_sec: 3 });
    assert_eq!(
        h.sink.states(),
        vec![PlayerState::Countdown { remaining_sec: 3 }]
    );
    assert_eq!(h.core.advance(ms(0)), Wake::At(ms(1000)));
    assert!(h.backend.calls().is_empty());
}

#[test]
fn idle_play_without_countdown_starts_immediately_when_foreground() {
    let mut h = harness();
    h.core.handle(play(two_notes(), 0), ms(500)).unwrap();
    assert_eq!(h.core.state(), &PlayerState::Playing);
    assert_eq!(h.core.advance(ms(500)), Wake::At(ms(530)));
    assert_eq!(h.backend.calls(), vec![sent(&[], &["KeyA"])]);
}

#[test]
fn countdown_ticks_every_second_then_checks_focus() {
    let mut h = harness();
    h.core.handle(play(two_notes(), 3), ms(0)).unwrap();
    assert_eq!(h.core.advance(ms(999)), Wake::At(ms(1000)));
    assert_eq!(h.core.advance(ms(1000)), Wake::At(ms(2000)));
    assert_eq!(h.core.state(), &PlayerState::Countdown { remaining_sec: 2 });
    h.core.advance(ms(2000));
    assert_eq!(h.core.state(), &PlayerState::Countdown { remaining_sec: 1 });
    h.core.advance(ms(3000));
    assert_eq!(h.core.state(), &PlayerState::Playing);
    assert_eq!(h.backend.calls(), vec![sent(&[], &["KeyA"])]);
    assert_eq!(
        h.sink.states(),
        vec![
            PlayerState::Countdown { remaining_sec: 3 },
            PlayerState::Countdown { remaining_sec: 2 },
            PlayerState::Countdown { remaining_sec: 1 },
            PlayerState::Playing,
        ]
    );
}

#[test]
fn countdown_end_without_focus_enters_waiting_focus() {
    let mut h = harness();
    h.core.handle(play(two_notes(), 1), ms(0)).unwrap();
    h.probe.set_foreground(false);
    assert_eq!(h.core.advance(ms(1000)), Wake::At(ms(1100)));
    assert_eq!(h.core.state(), &PlayerState::WaitingFocus);
    assert!(h.backend.calls().is_empty());
}

#[test]
fn waiting_focus_polls_every_100ms_and_starts_from_beginning() {
    let mut h = harness();
    h.probe.set_foreground(false);
    h.core.handle(play(two_notes(), 0), ms(0)).unwrap();
    assert_eq!(h.core.state(), &PlayerState::WaitingFocus);
    assert_eq!(h.core.advance(ms(0)), Wake::At(ms(100)));
    assert_eq!(h.core.advance(ms(50)), Wake::At(ms(100)));
    assert_eq!(h.core.advance(ms(100)), Wake::At(ms(200)));
    assert_eq!(
        h.sink.states(),
        vec![PlayerState::WaitingFocus],
        "轮询不重复通知状态"
    );

    h.probe.set_foreground(true);
    h.core.advance(ms(200));
    assert_eq!(h.core.state(), &PlayerState::Playing);
    assert_eq!(h.backend.calls(), vec![sent(&[], &["KeyA"])]);
    h.core.advance(ms(229));
    assert_eq!(h.backend.calls().len(), 1);
    h.core.advance(ms(230));
    assert_eq!(
        h.backend.calls(),
        vec![sent(&[], &["KeyA"]), sent(&["KeyA"], &[])]
    );
}

#[test]
fn due_events_are_sent_and_logged_while_foreground() {
    let mut h = harness();
    h.core.handle(play(overlapping(), 0), ms(0)).unwrap();
    h.core.advance(ms(0));
    h.core.advance(ms(205));
    assert_eq!(
        h.backend.calls(),
        vec![sent(&[], &["KeyA"]), sent(&[], &["KeyS"])]
    );
    h.core.handle(Command::Stop, ms(210)).unwrap();
    let summary = h.sink.summaries().pop().unwrap();
    assert_eq!(summary.events_sent, 2);
    assert_eq!(summary.lateness_p50_ms, 0.0);
    assert_eq!(summary.lateness_max_ms, 5.0);
}

#[test]
fn losing_focus_before_sending_releases_keys_and_pauses() {
    let mut h = harness();
    h.core.handle(play(overlapping(), 0), ms(0)).unwrap();
    h.core.advance(ms(0));
    h.probe.set_foreground(false);
    assert_eq!(h.core.advance(ms(200)), Wake::WaitForCommand);
    assert_eq!(h.core.state(), &paused(PauseReason::FocusLost, 200.0));
    assert_eq!(
        h.backend.calls(),
        vec![sent(&[], &["KeyA"]), sent(&["KeyA"], &[])]
    );
    assert_eq!(
        h.core.advance(ms(10_000)),
        Wake::WaitForCommand,
        "失去前台后不会自动恢复"
    );
}

#[test]
fn user_pause_releases_keys_and_keeps_position() {
    let mut h = harness();
    h.core.handle(play(overlapping(), 0), ms(0)).unwrap();
    h.core.advance(ms(0));
    h.core.handle(Command::Pause, ms(150)).unwrap();
    assert_eq!(h.core.state(), &paused(PauseReason::User, 150.0));
    assert_eq!(
        h.backend.calls(),
        vec![sent(&[], &["KeyA"]), sent(&["KeyA"], &[])]
    );
    assert_eq!(h.core.advance(ms(10_000)), Wake::WaitForCommand);
    assert_eq!(h.backend.calls().len(), 2);
}

#[test]
fn resume_in_foreground_continues_from_paused_position() {
    let mut h = harness();
    h.core.handle(play(two_notes(), 0), ms(0)).unwrap();
    h.core.advance(ms(0));
    h.core.advance(ms(30));
    h.core.handle(Command::Pause, ms(250)).unwrap();
    h.core.handle(Command::Resume, ms(1000)).unwrap();
    assert_eq!(h.core.state(), &PlayerState::Playing);
    assert_eq!(h.core.advance(ms(1000)), Wake::At(ms(1033)));
    h.core.advance(ms(1049));
    assert_eq!(h.backend.calls().len(), 2);
    h.core.advance(ms(1050));
    assert_eq!(
        h.backend.calls(),
        vec![
            sent(&[], &["KeyA"]),
            sent(&["KeyA"], &[]),
            sent(&[], &["KeyS"])
        ]
    );
}

#[test]
fn resume_resends_events_that_were_due_before_pause() {
    let mut h = harness();
    h.core.handle(play(overlapping(), 0), ms(0)).unwrap();
    h.core.advance(ms(0));
    h.probe.set_foreground(false);
    h.core.advance(ms(200));
    h.probe.set_foreground(true);
    h.core.handle(Command::Resume, ms(5000)).unwrap();
    h.core.advance(ms(5000));
    h.core.advance(ms(5030));
    h.core.advance(ms(5300));
    assert_eq!(
        h.backend.calls(),
        vec![
            sent(&[], &["KeyA"]),
            sent(&["KeyA"], &[]),
            sent(&[], &["KeyS"]),
            sent(&["KeyS"], &[]),
        ],
        "KeyA 的松开事件到期时已经松开过，不再重复发送"
    );
    assert_eq!(h.core.state(), &PlayerState::Idle);
    let summary = h.sink.summaries().pop().unwrap();
    assert!(summary.completed);
    assert_eq!(summary.events_sent, 4);
}

#[test]
fn resume_without_focus_waits_and_keeps_position() {
    let mut h = harness();
    h.core.handle(play(two_notes(), 0), ms(0)).unwrap();
    h.core.advance(ms(0));
    h.core.advance(ms(30));
    h.core.handle(Command::Pause, ms(100)).unwrap();
    h.probe.set_foreground(false);
    h.core.handle(Command::Resume, ms(1000)).unwrap();
    assert_eq!(h.core.state(), &PlayerState::WaitingFocus);
    assert_eq!(h.core.advance(ms(1000)), Wake::At(ms(1100)));
    h.probe.set_foreground(true);
    h.core.advance(ms(1100));
    assert_eq!(h.core.state(), &PlayerState::Playing);
    h.core.advance(ms(1299));
    assert_eq!(h.backend.calls().len(), 2);
    h.core.advance(ms(1300));
    assert_eq!(h.backend.calls().last(), Some(&sent(&[], &["KeyS"])));
}

#[test]
fn last_event_without_loop_reports_summary_and_returns_to_idle() {
    let mut params = ExecutionParams::default();
    params.range.end_ms = 1000.0;
    let single = execution_with(&[(0.0, &["KeyA"], 30.0)], params);
    assert_eq!(single.duration_ms, 1000.0);
    let mut h = harness();
    h.core.handle(play(single, 0), ms(0)).unwrap();
    h.core.advance(ms(0));
    assert_eq!(
        h.core.advance(ms(31)),
        Wake::WaitForCommand,
        "不循环时发完最后一个事件立即结束，不等尾部休止"
    );
    assert_eq!(h.core.state(), &PlayerState::Idle);
    assert_eq!(
        h.backend.calls(),
        vec![sent(&[], &["KeyA"]), sent(&["KeyA"], &[])]
    );
    let summaries = h.sink.summaries();
    assert_eq!(summaries.len(), 1);
    assert!(summaries[0].completed);
    assert_eq!(summaries[0].events_sent, 2);
    assert_eq!(summaries[0].lateness_max_ms, 1.0);
    assert_eq!(
        h.sink.states(),
        vec![PlayerState::Playing, PlayerState::Idle]
    );
}

#[test]
fn looping_waits_for_range_tail_and_restarts_at_t0_plus_duration() {
    let dir = temp_log_dir("loop");
    let mut h = harness_with(PlayerConfig {
        log_dir: Some(dir.clone()),
        ..PlayerConfig::default()
    });
    h.core.handle(play(looped_range(), 0), ms(0)).unwrap();
    for t in [0, 30, 100] {
        h.core.advance(ms(t));
    }
    h.core.advance(ms(135));
    assert_eq!(h.backend.calls().len(), 4, "最后一个事件晚 5ms 发出");
    h.core.advance(ms(399));
    assert_eq!(h.backend.calls().len(), 4, "尾部休止期间不发送");
    assert_eq!(h.core.state(), &PlayerState::Playing);
    assert_eq!(
        h.core.advance(ms(400)),
        Wake::At(ms(400)),
        "下一轮 t0 = 上一轮 t0 + durationMs，不受上一轮延迟影响"
    );
    h.core.advance(ms(400));
    assert_eq!(
        h.backend.calls(),
        vec![
            sent(&[], &["KeyA"]),
            sent(&["KeyA"], &[]),
            sent(&[], &["KeyS"]),
            sent(&["KeyS"], &[]),
            sent(&[], &["KeyA"]),
        ]
    );

    h.core.handle(Command::Stop, ms(410)).unwrap();
    let summary = h.sink.summaries().pop().unwrap();
    assert!(!summary.completed);
    assert_eq!(summary.events_sent, 5);
    let text = fs::read_to_string(summary.log_path.unwrap()).unwrap();
    let lines: Vec<&str> = text.lines().collect();
    let loop_line = lines
        .iter()
        .position(|line| *line == r#"{"loop":1}"#)
        .expect("进入下一轮时写入循环分隔行");
    assert_eq!(loop_line, 4);
    assert_eq!(
        lines[5],
        r#"{"targetMs":0.0,"actualMs":0.0,"up":[],"down":["KeyA"]}"#
    );
    assert!(lines.last().unwrap().starts_with(r#"{"summary":"#));
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn pause_in_loop_tail_keeps_next_round_time() {
    let mut h = harness();
    h.core.handle(play(looped_range(), 0), ms(0)).unwrap();
    for t in [0, 30, 100, 130] {
        h.core.advance(ms(t));
    }
    h.core.handle(Command::Pause, ms(250)).unwrap();
    assert_eq!(h.core.state(), &paused(PauseReason::User, 250.0));
    h.core.handle(Command::Resume, ms(1000)).unwrap();
    assert_eq!(h.core.advance(ms(1000)), Wake::At(ms(1033)));
    h.core.advance(ms(1149));
    assert_eq!(h.backend.calls().len(), 4, "继续后仍处在尾部休止");
    assert_eq!(
        h.core.advance(ms(1150)),
        Wake::At(ms(1150)),
        "t0 = 1000 − 250 = 750，下一轮在 750 + 400"
    );
    h.core.advance(ms(1150));
    assert_eq!(h.backend.calls().len(), 5);
    assert_eq!(h.backend.calls().last(), Some(&sent(&[], &["KeyA"])));
}

#[test]
fn empty_execution_returns_to_idle_even_when_looping() {
    let mut params = ExecutionParams::default();
    params.range.start_ms = 1000.0;
    params.range.looped = true;
    let empty = execution_with(&[(0.0, &["KeyA"], 30.0)], params);
    let mut h = harness();
    h.core.handle(play(empty, 0), ms(0)).unwrap();
    assert_eq!(h.core.advance(ms(0)), Wake::WaitForCommand);
    assert_eq!(h.core.state(), &PlayerState::Idle);
    assert!(
        h.sink.summaries().is_empty(),
        "没有发送过按键时不输出 Summary"
    );
}

#[test]
fn pause_during_countdown_or_waiting_focus_cancels() {
    let mut countdown = harness();
    countdown.core.handle(play(two_notes(), 3), ms(0)).unwrap();
    countdown.core.handle(Command::Pause, ms(500)).unwrap();
    assert_eq!(countdown.core.state(), &PlayerState::Idle);
    assert_eq!(countdown.core.advance(ms(5000)), Wake::WaitForCommand);

    let mut waiting = harness();
    waiting.probe.set_foreground(false);
    waiting.core.handle(play(two_notes(), 0), ms(0)).unwrap();
    waiting.core.handle(Command::Pause, ms(50)).unwrap();
    assert_eq!(waiting.core.state(), &PlayerState::Idle);
    assert!(waiting.sink.summaries().is_empty());
    assert!(waiting.backend.calls().is_empty());
}

#[test]
fn stop_from_playing_releases_keys_and_reports_incomplete_summary() {
    let mut h = harness();
    h.core.handle(play(overlapping(), 0), ms(0)).unwrap();
    h.core.advance(ms(0));
    h.core.handle(Command::Stop, ms(100)).unwrap();
    assert_eq!(h.core.state(), &PlayerState::Idle);
    assert_eq!(
        h.backend.calls(),
        vec![sent(&[], &["KeyA"]), sent(&["KeyA"], &[])]
    );
    let summaries = h.sink.summaries();
    assert_eq!(summaries.len(), 1);
    assert!(!summaries[0].completed);
    assert_eq!(summaries[0].events_sent, 1);
    assert_eq!(summaries[0].log_path, None);
}

#[test]
fn stop_from_other_states() {
    let mut countdown = harness();
    countdown.core.handle(play(two_notes(), 3), ms(0)).unwrap();
    countdown.core.handle(Command::Stop, ms(10)).unwrap();
    assert_eq!(countdown.core.state(), &PlayerState::Idle);
    assert!(
        countdown.sink.summaries().is_empty(),
        "没有发送过按键时不输出 Summary"
    );

    let mut paused_core = harness();
    paused_core
        .core
        .handle(play(two_notes(), 0), ms(0))
        .unwrap();
    paused_core.core.advance(ms(0));
    paused_core.core.handle(Command::Pause, ms(10)).unwrap();
    paused_core.core.handle(Command::Stop, ms(20)).unwrap();
    assert_eq!(paused_core.core.state(), &PlayerState::Idle);
    assert_eq!(paused_core.sink.summaries().len(), 1);

    let mut idle = harness();
    idle.core.handle(Command::Stop, ms(0)).unwrap();
    assert!(idle.sink.events().is_empty(), "空闲时停止没有任何动作");
}

#[test]
fn play_is_rejected_while_busy() {
    let busy_check = |h: &mut Harness, expected: PlayerState| {
        let error = h.core.handle(play(two_notes(), 0), ms(10)).unwrap_err();
        assert_eq!(error.code, ErrorCode::PlayerBusy);
        assert_eq!(error.message, "正在演奏中，请先停止");
        assert_eq!(h.core.state(), &expected);
    };

    let mut countdown = harness();
    countdown.core.handle(play(two_notes(), 3), ms(0)).unwrap();
    busy_check(&mut countdown, PlayerState::Countdown { remaining_sec: 3 });

    let mut waiting = harness();
    waiting.probe.set_foreground(false);
    waiting.core.handle(play(two_notes(), 0), ms(0)).unwrap();
    busy_check(&mut waiting, PlayerState::WaitingFocus);

    let mut playing = harness();
    playing.core.handle(play(two_notes(), 0), ms(0)).unwrap();
    busy_check(&mut playing, PlayerState::Playing);

    let mut paused_core = harness();
    paused_core
        .core
        .handle(play(two_notes(), 0), ms(0))
        .unwrap();
    paused_core.core.handle(Command::Pause, ms(5)).unwrap();
    busy_check(&mut paused_core, paused(PauseReason::User, 5.0));
}

#[test]
fn send_failure_releases_keys_and_enters_error() {
    let mut h = harness();
    h.core.handle(play(overlapping(), 0), ms(0)).unwrap();
    h.core.advance(ms(0));
    h.backend.fail_next_call();
    assert_eq!(h.core.advance(ms(200)), Wake::WaitForCommand);
    assert_eq!(
        h.core.state(),
        &PlayerState::Error {
            code: "INPUT_SEND_FAILED".to_string(),
            message: "按键发送失败（系统错误 5）".to_string(),
        }
    );
    assert_eq!(
        h.backend.calls(),
        vec![sent(&[], &["KeyA"]), sent(&["KeyA", "KeyS"], &[])],
        "尽力松开所有可能按下的键"
    );
    assert!(h.sink.summaries().is_empty());
}

#[test]
fn play_is_accepted_after_error() {
    let mut h = harness();
    h.core.handle(play(two_notes(), 0), ms(0)).unwrap();
    h.backend.fail_next_call();
    h.core.advance(ms(0));
    assert!(matches!(h.core.state(), PlayerState::Error { .. }));
    h.core.handle(play(two_notes(), 0), ms(100)).unwrap();
    assert_eq!(h.core.state(), &PlayerState::Playing);
    h.core.advance(ms(100));
    assert_eq!(
        h.backend.calls(),
        vec![sent(&["KeyA"], &[]), sent(&[], &["KeyA"])],
        "第一次发送失败后尽力松开，第二次演奏正常按下"
    );
}

#[test]
fn panic_recovery_releases_keys_and_enters_error() {
    let mut h = harness();
    h.core.handle(play(overlapping(), 0), ms(0)).unwrap();
    h.core.advance(ms(0));
    h.core.handle_panic();
    assert_eq!(
        h.core.state(),
        &PlayerState::Error {
            code: "PLAYER_PANIC".to_string(),
            message: "播放线程异常退出，已松开所有按键".to_string(),
        }
    );
    assert_eq!(
        h.backend.calls(),
        vec![sent(&[], &["KeyA"]), sent(&["KeyA"], &[])]
    );
}

#[test]
fn dropping_core_releases_pressed_keys() {
    let mut h = harness();
    h.core.handle(play(overlapping(), 0), ms(0)).unwrap();
    h.core.advance(ms(0));
    let backend = h.backend.clone();
    drop(h);
    assert_eq!(
        backend.calls(),
        vec![sent(&[], &["KeyA"]), sent(&["KeyA"], &[])]
    );
}

#[test]
fn progress_is_reported_about_every_33ms_in_source_time() {
    let mut params = ExecutionParams {
        speed: 2.0,
        ..ExecutionParams::default()
    };
    params.range.start_ms = 1000.0;
    let scaled = execution_with(
        &[(1000.0, &["KeyA"], 30.0), (3000.0, &["KeyS"], 30.0)],
        params,
    );
    let mut h = harness();
    h.core.handle(play(scaled, 0), ms(0)).unwrap();
    for t in [0, 10, 30, 33, 50, 66] {
        h.core.advance(ms(t));
    }
    assert_eq!(h.core.advance(ms(70)), Wake::At(ms(99)));
    assert_eq!(
        h.sink.progresses(),
        vec![
            Progress {
                position_ms: 0.0,
                source_position_ms: 1000.0,
            },
            Progress {
                position_ms: 33.0,
                source_position_ms: 1066.0,
            },
            Progress {
                position_ms: 66.0,
                source_position_ms: 1132.0,
            },
        ]
    );
}

#[test]
fn toggle_follows_hotkey_rules() {
    let mut h = harness();
    let toggle = |execution: Option<Arc<ExecutionTimeline>>| Command::Toggle {
        execution,
        countdown_sec: 0,
    };
    h.core.handle(toggle(None), ms(0)).unwrap();
    assert_eq!(h.core.state(), &PlayerState::Idle, "没有缓存的演奏时忽略");
    h.core.handle(toggle(Some(two_notes())), ms(0)).unwrap();
    assert_eq!(h.core.state(), &PlayerState::Playing);
    h.core.handle(toggle(None), ms(10)).unwrap();
    assert_eq!(h.core.state(), &paused(PauseReason::User, 10.0));
    h.core.handle(toggle(None), ms(20)).unwrap();
    assert_eq!(h.core.state(), &PlayerState::Playing);

    let mut countdown = harness();
    countdown
        .core
        .handle(
            Command::Toggle {
                execution: Some(two_notes()),
                countdown_sec: 3,
            },
            ms(0),
        )
        .unwrap();
    countdown
        .core
        .handle(toggle(Some(two_notes())), ms(10))
        .unwrap();
    assert_eq!(
        countdown.core.state(),
        &PlayerState::Countdown { remaining_sec: 3 }
    );

    let mut waiting = harness();
    waiting.probe.set_foreground(false);
    waiting
        .core
        .handle(toggle(Some(two_notes())), ms(0))
        .unwrap();
    waiting.core.handle(toggle(None), ms(10)).unwrap();
    assert_eq!(waiting.core.state(), &PlayerState::WaitingFocus);
}

#[test]
fn pause_and_resume_are_rejected_in_wrong_states() {
    let mut h = harness();
    let pause_error = h.core.handle(Command::Pause, ms(0)).unwrap_err();
    assert_eq!(pause_error.code, ErrorCode::InvalidState);
    assert_eq!(pause_error.message, "当前状态不能暂停");
    let resume_error = h.core.handle(Command::Resume, ms(0)).unwrap_err();
    assert_eq!(resume_error.message, "当前状态不能继续");

    h.core.handle(play(two_notes(), 0), ms(0)).unwrap();
    assert_eq!(
        h.core.handle(Command::Resume, ms(1)).unwrap_err().code,
        ErrorCode::InvalidState
    );
    h.core.handle(Command::Pause, ms(2)).unwrap();
    assert_eq!(
        h.core.handle(Command::Pause, ms(3)).unwrap_err().code,
        ErrorCode::InvalidState
    );
}

#[test]
fn set_log_dir_takes_effect_from_next_summary() {
    let dir = temp_log_dir("set-log-dir");
    let mut h = harness();
    h.core.handle(play(overlapping(), 0), ms(0)).unwrap();
    h.core.advance(ms(0));
    h.core
        .handle(
            Command::SetLogDir {
                log_dir: Some(dir.clone()),
            },
            ms(50),
        )
        .unwrap();
    assert_eq!(h.core.state(), &PlayerState::Playing);
    assert_eq!(
        h.sink.states(),
        vec![PlayerState::Playing],
        "不改变状态、不通知"
    );
    h.core.handle(Command::Stop, ms(100)).unwrap();
    let written = PathBuf::from(h.sink.summaries()[0].log_path.clone().expect("应写出日志"));
    assert_eq!(written.parent(), Some(dir.as_path()));
    assert!(written.exists());

    h.core
        .handle(Command::SetLogDir { log_dir: None }, ms(200))
        .unwrap();
    h.core.handle(play(overlapping(), 0), ms(300)).unwrap();
    h.core.advance(ms(300));
    h.core.handle(Command::Stop, ms(400)).unwrap();
    let summaries = h.sink.summaries();
    assert_eq!(summaries.len(), 2);
    assert_eq!(summaries[1].log_path, None);
    fs::remove_dir_all(dir).unwrap();
}

// ---------------------------------------------------------------------
// 增补：Stop 时 release_all 失败会保留按下集合，下一次 start() 必须先补一次
// release_all，否则残留键的 down 会被 KeyboardOutput 当成"已按下"过滤掉，导致吞音。
// ---------------------------------------------------------------------

#[test]
fn play_releases_keys_left_by_failed_stop() {
    let mut h = harness();
    h.core.handle(play(overlapping(), 0), ms(0)).unwrap();
    h.core.advance(ms(0));
    assert_eq!(h.backend.calls(), vec![sent(&[], &["KeyA"])]);

    // Stop 时 release_all 失败，按下集合保留 KeyA，这次失败的调用不会被记录
    h.backend.fail_next_call();
    h.core.handle(Command::Stop, ms(100)).unwrap();
    assert_eq!(h.core.state(), &PlayerState::Idle);
    assert_eq!(
        h.backend.calls(),
        vec![sent(&[], &["KeyA"])],
        "release_all 失败，按下集合未清空，Stop 仍然忽略这次失败"
    );
    let summary = h.sink.summaries().pop().unwrap();
    assert!(!summary.completed);
    assert_eq!(summary.events_sent, 1);

    // 再次 Play：start() 先补发 KeyA 的松开，再正常进入 Playing
    h.core.handle(play(two_notes(), 0), ms(200)).unwrap();
    assert_eq!(h.core.state(), &PlayerState::Playing);
    assert_eq!(
        h.backend.calls(),
        vec![sent(&[], &["KeyA"]), sent(&["KeyA"], &[])],
        "开始新一轮前先松开上一次残留的按键"
    );

    // 新一轮的 KeyA 按下没有被当成"已按下"过滤掉
    assert_eq!(h.core.advance(ms(200)), Wake::At(ms(230)));
    assert_eq!(
        h.backend.calls(),
        vec![
            sent(&[], &["KeyA"]),
            sent(&["KeyA"], &[]),
            sent(&[], &["KeyA"]),
        ],
        "残留键已释放，新一轮的按下事件正常发出"
    );
}

#[test]
fn play_fails_when_leftover_release_fails() {
    let mut h = harness();
    h.core.handle(play(overlapping(), 0), ms(0)).unwrap();
    h.core.advance(ms(0));
    h.backend.fail_next_call();
    h.core.handle(Command::Stop, ms(100)).unwrap();
    assert_eq!(h.core.state(), &PlayerState::Idle);
    assert_eq!(h.sink.summaries().len(), 1);

    // 残留键仍在；这次 Play 补发松开失败 → 不创建会话，直接进入 Error，并把错误
    // 返回给调用方（而不是像正常流程一样返回 Ok，让调用方误以为已经开始播放）。
    // fail() 内部会再尝试一次 release_all（MockBackend 只让"下一次"调用失败），
    // 这次成功，所以键最终还是被尽力松开了，但状态已经是 Error。
    h.backend.fail_next_call();
    let error = h.core.handle(play(two_notes(), 0), ms(200)).unwrap_err();
    assert_eq!(error.code, ErrorCode::InputSendFailed);
    assert_eq!(error.message, "按键发送失败（系统错误 5）");
    assert_eq!(
        h.core.state(),
        &PlayerState::Error {
            code: "INPUT_SEND_FAILED".to_string(),
            message: "按键发送失败（系统错误 5）".to_string(),
        }
    );
    assert_eq!(
        h.backend.calls(),
        vec![sent(&[], &["KeyA"]), sent(&["KeyA"], &[])],
        "补发松开失败后，fail() 会尽力再松开一次"
    );
    assert_eq!(
        h.sink.summaries().len(),
        1,
        "进入 Error 时不产生新的 Summary"
    );
    assert_eq!(
        h.core.advance(ms(200)),
        Wake::WaitForCommand,
        "没有进入 Countdown/Playing，advance 不需要再被唤醒"
    );
}

#[test]
fn stop_from_error_returns_to_idle_without_summary() {
    let mut h = harness();
    h.core.handle(play(overlapping(), 0), ms(0)).unwrap();
    h.core.advance(ms(0));
    h.backend.fail_next_call();
    h.core.handle(Command::Stop, ms(100)).unwrap();
    assert_eq!(h.sink.summaries().len(), 1);

    // 通过补发松开失败进入 Error（与上一个测试相同的路径）
    h.backend.fail_next_call();
    h.core.handle(play(two_notes(), 0), ms(200)).unwrap_err();
    assert!(matches!(h.core.state(), PlayerState::Error { .. }));

    h.core.handle(Command::Stop, ms(300)).unwrap();
    assert_eq!(h.core.state(), &PlayerState::Idle);
    assert_eq!(
        h.sink.summaries().len(),
        1,
        "Error 状态下 Stop 不输出新的 Summary"
    );
}

// ---------------------------------------------------------------------
// 增补：长时间停顿（睡眠唤醒、调试断点、系统卡顿）后不补发积压事件，
// 而是把 t0 平移，让最早到期的事件恰好此刻到期。
// ---------------------------------------------------------------------

/// KeyA 0–30ms、KeyS 300–330ms、KeyD 600–630ms
fn three_notes() -> Arc<ExecutionTimeline> {
    execution(&[
        (0.0, &["KeyA"], 30.0),
        (300.0, &["KeyS"], 30.0),
        (600.0, &["KeyD"], 30.0),
    ])
}

#[test]
fn stall_longer_than_threshold_shifts_t0_instead_of_bursting() {
    let mut h = harness();
    h.core.handle(play(three_notes(), 0), ms(0)).unwrap();
    h.core.advance(ms(0));
    assert_eq!(
        h.core.advance(ms(2000)),
        Wake::At(ms(2033)),
        "停顿 2 秒后：KeyA 松开延迟 1970ms，t0 平移到 1970，下一次进度上报早于 KeyS（2270）"
    );
    assert_eq!(
        h.backend.calls(),
        vec![sent(&[], &["KeyA"]), sent(&["KeyA"], &[])],
        "只发出当前到期的事件，KeyS 不会被连带补发"
    );
    assert_eq!(
        h.sink.progresses().last(),
        Some(&Progress {
            position_ms: 30.0,
            source_position_ms: 30.0,
        }),
        "进度随 t0 平移保持连续"
    );
    h.core.advance(ms(2269));
    assert_eq!(h.backend.calls().len(), 2, "后续事件保持原有间隔");
    h.core.advance(ms(2270));
    assert_eq!(h.backend.calls().last(), Some(&sent(&[], &["KeyS"])));

    h.core.handle(Command::Pause, ms(2400)).unwrap();
    assert_eq!(
        h.core.state(),
        &paused(PauseReason::User, 430.0),
        "暂停位置基于平移后的 t0"
    );
    h.core.handle(Command::Stop, ms(2500)).unwrap();
    let summary = h.sink.summaries().pop().unwrap();
    assert_eq!(summary.events_sent, 3);
    assert_eq!(
        summary.lateness_max_ms, 0.0,
        "执行日志记录平移后的 target / actual"
    );
}

#[test]
fn lateness_within_threshold_still_catches_up_due_events() {
    let mut h = harness();
    h.core.handle(play(three_notes(), 0), ms(0)).unwrap();
    h.core.advance(ms(0));
    h.core.advance(ms(530));
    assert_eq!(
        h.backend.calls(),
        vec![
            sent(&[], &["KeyA"]),
            sent(&["KeyA"], &[]),
            sent(&[], &["KeyS"]),
            sent(&["KeyS"], &[]),
        ],
        "延迟恰好 500ms 不算停顿，照常补发到期事件"
    );
}

#[test]
fn loop_stall_over_multiple_periods_starts_only_one_round() {
    let dir = temp_log_dir("loop-stall");
    let mut h = harness_with(PlayerConfig {
        log_dir: Some(dir.clone()),
        ..PlayerConfig::default()
    });
    h.core.handle(play(looped_range(), 0), ms(0)).unwrap();
    for t in [0, 30, 100, 130] {
        h.core.advance(ms(t));
    }
    assert_eq!(
        h.core.advance(ms(1250)),
        Wake::At(ms(1200)),
        "尾部休止中停顿到 1250ms：跨过两个周期，t0 对齐到当前周期 1200"
    );
    assert_eq!(h.backend.calls().len(), 4, "对齐时不发送积压的轮次");
    h.core.advance(ms(1250));
    h.core.advance(ms(1300));
    assert_eq!(
        h.backend.calls(),
        vec![
            sent(&[], &["KeyA"]),
            sent(&["KeyA"], &[]),
            sent(&[], &["KeyS"]),
            sent(&["KeyS"], &[]),
            sent(&[], &["KeyA"]),
            sent(&["KeyA"], &[]),
            sent(&[], &["KeyS"]),
        ]
    );

    h.core.handle(Command::Stop, ms(1310)).unwrap();
    let summary = h.sink.summaries().pop().unwrap();
    let text = fs::read_to_string(summary.log_path.unwrap()).unwrap();
    let loop_lines: Vec<&str> = text
        .lines()
        .filter(|line| line.starts_with(r#"{"loop":"#))
        .collect();
    assert_eq!(loop_lines, vec![r#"{"loop":1}"#], "只开始了一轮");
    fs::remove_dir_all(dir).unwrap();
}
