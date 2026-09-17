use std::path::PathBuf;

use clap::{CommandFactory, Parser};
use gm_verify::cli::{Cli, CliCommand, RunArgs, describe_state, describe_summary, pattern_options};
use gm_verify::patterns::{PatternKind, PatternOptions};
use player_core::player::state::{PauseReason, PlayerState, Summary};

fn parse(args: &[&str]) -> CliCommand {
    Cli::try_parse_from(std::iter::once("gm-verify").chain(args.iter().copied()))
        .unwrap()
        .command
}

fn play_run(args: &[&str]) -> RunArgs {
    match parse(args) {
        CliCommand::Play { run, .. } => run,
        other => panic!("应解析为 play：{other:?}"),
    }
}

#[test]
fn command_definition_is_valid() {
    Cli::command().debug_assert();
}

#[test]
fn play_defaults() {
    let CliCommand::Play { timeline, run } = parse(&["play", "song.json"]) else {
        panic!("应解析为 play");
    };
    assert_eq!(timeline, PathBuf::from("song.json"));
    assert_eq!(run.countdown, 3);
    assert_eq!(run.log, None);
    assert!(!run.no_guard);
    let params = run.execution_params();
    assert_eq!(params.speed, 1.0);
    assert_eq!(params.humanize.max_jitter_ms, 0.0);
    assert_eq!(params.humanize.seed, 1);
    assert_eq!(params.range.start_ms, 0.0);
    assert!(params.range.end_ms.is_infinite());
    assert!(!params.range.looped);
    assert_eq!(run.log_dir(), None);
}

#[test]
fn play_options_map_to_execution_params() {
    let run = play_run(&[
        "play",
        "song.json",
        "--speed",
        "1.5",
        "--humanize",
        "10",
        "--seed",
        "7",
        "--start-ms",
        "1000",
        "--end-ms",
        "5000",
        "--loop",
        "--countdown",
        "0",
        "--log",
        "logs/run.jsonl",
        "--no-guard",
    ]);
    let params = run.execution_params();
    assert_eq!(params.speed, 1.5);
    assert_eq!(params.humanize.max_jitter_ms, 10.0);
    assert_eq!(params.humanize.seed, 7);
    assert_eq!(params.range.start_ms, 1000.0);
    assert_eq!(params.range.end_ms, 5000.0);
    assert!(params.range.looped);
    assert_eq!(run.countdown, 0);
    assert!(run.no_guard);
    assert_eq!(run.log_dir(), Some(PathBuf::from("logs")));
    assert_eq!(
        play_run(&["play", "song.json", "--log", "run.jsonl"]).log_dir(),
        Some(PathBuf::from("."))
    );
}

#[test]
fn pattern_arguments_and_defaults() {
    let CliCommand::Pattern {
        kind,
        instrument,
        hold,
        gap,
        out,
        run,
    } = parse(&[
        "pattern",
        "repeat",
        "--instrument",
        "windsong-lyre",
        "--out",
        "repeat.json",
    ])
    else {
        panic!("应解析为 pattern");
    };
    assert_eq!(kind, PatternKind::Repeat);
    assert_eq!(instrument, "windsong-lyre");
    assert_eq!(
        pattern_options(hold, gap),
        PatternOptions {
            hold_ms: 30.0,
            min_repeat_gap_ms: 40.0,
        }
    );
    assert_eq!(out, Some(PathBuf::from("repeat.json")));
    assert_eq!(run.countdown, 3);

    let CliCommand::Pattern { hold, gap, run, .. } = parse(&[
        "pattern",
        "long",
        "--instrument",
        "my.json",
        "--hold",
        "25",
        "--gap",
        "10",
        "--no-guard",
    ]) else {
        panic!("应解析为 pattern");
    };
    assert_eq!((hold, gap), (25.0, 10.0));
    assert!(run.no_guard);
}

#[test]
fn stats_arguments_and_invalid_input() {
    let CliCommand::Stats { log, compare } =
        parse(&["stats", "mac.jsonl", "--compare", "win.jsonl"])
    else {
        panic!("应解析为 stats");
    };
    assert_eq!(log, PathBuf::from("mac.jsonl"));
    assert_eq!(compare, Some(PathBuf::from("win.jsonl")));

    assert!(
        Cli::try_parse_from([
            "gm-verify",
            "pattern",
            "waltz",
            "--instrument",
            "windsong-lyre"
        ])
        .is_err()
    );
    assert!(
        Cli::try_parse_from(["gm-verify", "pattern", "scale"]).is_err(),
        "--instrument 必填"
    );
}

#[test]
fn console_messages_are_chinese() {
    assert_eq!(
        describe_state(&PlayerState::Countdown { remaining_sec: 3 }),
        "倒计时 3 秒"
    );
    assert_eq!(
        describe_state(&PlayerState::WaitingFocus),
        "等待游戏窗口切到前台…"
    );
    assert_eq!(
        describe_state(&PlayerState::Paused {
            reason: PauseReason::FocusLost,
            position_ms: 1234.4,
        }),
        "游戏窗口失去前台，已在 1234ms 处暂停；按 Ctrl+C 结束"
    );
    assert_eq!(
        describe_state(&PlayerState::Error {
            code: "INPUT_SEND_FAILED".to_string(),
            message: "按键发送失败（系统错误 5）".to_string(),
        }),
        "错误 INPUT_SEND_FAILED：按键发送失败（系统错误 5）"
    );
    let summary = Summary {
        completed: true,
        events_sent: 42,
        lateness_p50_ms: 0.8,
        lateness_p95_ms: 1.9,
        lateness_max_ms: 4.25,
        dropped: 1,
        log_path: None,
    };
    assert_eq!(
        describe_summary(&summary),
        "播放完成：发送 42 个事件，延迟 p50 0.80ms · p95 1.90ms · 最大 4.25ms，过密丢弃 1 个\n执行日志：未写入"
    );
}
