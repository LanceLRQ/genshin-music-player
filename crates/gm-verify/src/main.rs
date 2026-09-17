use std::fs;
use std::io::Write;
use std::path::Path;
use std::process::ExitCode;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender};
use std::thread;
use std::time::Duration;

use clap::Parser;
use gm_verify::cli::{Cli, CliCommand, RunArgs, describe_state, describe_summary, pattern_options};
use gm_verify::patterns::{generate, load_instrument};
use gm_verify::stats::{compare_logs, format_stats, parse_log};
use player_core::exec_log::LogRecord;
use player_core::guard::{AlwaysForeground, WindowProbe};
use player_core::input::{InputBackend, KeyboardOutput};
use player_core::model::KeyTimeline;
use player_core::platform::is_elevated;
use player_core::player::state::{Command, PlayerSink, PlayerState, Progress, Summary};
use player_core::player::{Player, PlayerConfig};
use player_core::timeline::build_execution;

fn main() -> ExitCode {
    match run(Cli::parse()) {
        Ok(code) => code,
        Err(message) => {
            eprintln!("错误：{message}");
            ExitCode::from(2)
        }
    }
}

fn run(cli: Cli) -> Result<ExitCode, String> {
    match cli.command {
        CliCommand::Play { timeline, run } => {
            let text = fs::read_to_string(&timeline)
                .map_err(|error| format!("无法读取时间线文件 {}：{error}", timeline.display()))?;
            let key_timeline: KeyTimeline =
                serde_json::from_str(&text).map_err(|error| format!("时间线格式错误：{error}"))?;
            execute(&key_timeline, &run)
        }
        CliCommand::Pattern {
            kind,
            instrument,
            hold,
            gap,
            out,
            run,
        } => {
            let layout = load_instrument(&instrument)?;
            let key_timeline = generate(kind, &layout, pattern_options(hold, gap));
            match out {
                Some(out) => {
                    let json = serde_json::to_string_pretty(&key_timeline)
                        .map_err(|error| error.to_string())?;
                    fs::write(&out, json + "\n")
                        .map_err(|error| format!("无法写入 {}：{error}", out.display()))?;
                    println!(
                        "已生成 {} 个按键，写入 {}",
                        key_timeline.presses.len(),
                        out.display()
                    );
                    Ok(ExitCode::SUCCESS)
                }
                None => execute(&key_timeline, &run),
            }
        }
        CliCommand::Stats { log, compare } => {
            let records = read_log(&log)?;
            println!("{}", format_stats(&records));
            let Some(other) = compare else {
                return Ok(ExitCode::SUCCESS);
            };
            let other_records = read_log(&other)?;
            println!(
                "对比日志 {}：\n{}",
                other.display(),
                format_stats(&other_records)
            );
            let comparison = compare_logs(&records, &other_records);
            if comparison.is_match() {
                println!("比对一致");
                return Ok(ExitCode::SUCCESS);
            }
            println!(
                "比对不一致，共 {} 处差异，列出前 {} 处：",
                comparison.total,
                comparison.listed.len()
            );
            for line in &comparison.listed {
                println!("  {line}");
            }
            Ok(ExitCode::from(1))
        }
    }
}

fn read_log(path: &Path) -> Result<Vec<LogRecord>, String> {
    let text = fs::read_to_string(path)
        .map_err(|error| format!("无法读取日志 {}：{error}", path.display()))?;
    parse_log(&text)
}

struct ConsoleSink {
    summaries: Sender<Summary>,
}

impl PlayerSink for ConsoleSink {
    fn on_state(&self, state: &PlayerState) {
        let _ = writeln!(std::io::stdout(), "{}", describe_state(state));
    }

    fn on_progress(&self, _progress: &Progress) {}

    fn on_summary(&self, summary: &Summary) {
        let _ = writeln!(std::io::stdout(), "{}", describe_summary(summary));
        let _ = self.summaries.send(summary.clone());
    }
}

/// 在前台运行 Player；Ctrl+C 时发送 Stop，等回到 Idle 后退出，保证松开所有按键
fn execute(key_timeline: &KeyTimeline, args: &RunArgs) -> Result<ExitCode, String> {
    let execution =
        build_execution(key_timeline, &args.execution_params()).map_err(|error| error.message)?;
    println!(
        "执行时间线：{} 个事件，时长 {:.0}ms，过密丢弃 {} 个",
        execution.events.len(),
        execution.duration_ms,
        execution.dropped
    );
    if is_elevated() == Some(false) {
        println!("提示：当前没有以管理员身份运行；如果游戏以管理员身份运行，按键会被系统拦截");
    }

    let backend = platform_backend();
    println!("输入后端：{}", backend.name());
    let (summary_tx, summary_rx) = mpsc::channel();
    let player = Player::spawn(
        KeyboardOutput::new(backend),
        window_probe(args.no_guard),
        ConsoleSink {
            summaries: summary_tx,
        },
        PlayerConfig {
            log_dir: args.log_dir(),
            ..PlayerConfig::default()
        },
    )
    .map_err(|error| format!("无法创建播放线程：{error}"))?;

    let interrupted = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&interrupted);
    ctrlc::set_handler(move || flag.store(true, Ordering::SeqCst))
        .map_err(|error| format!("无法注册 Ctrl+C 处理：{error}"))?;

    player
        .send(Command::Play {
            execution: Arc::new(execution),
            countdown_sec: args.countdown,
        })
        .map_err(|error| error.message)?;
    loop {
        if interrupted.swap(false, Ordering::SeqCst) {
            println!("收到 Ctrl+C，停止并松开所有按键");
            player.send(Command::Stop).map_err(|error| error.message)?;
        }
        match player.state() {
            PlayerState::Idle | PlayerState::Error { .. } => break,
            _ => thread::sleep(Duration::from_millis(20)),
        }
    }
    let failed = matches!(player.state(), PlayerState::Error { .. });
    drop(player);

    if let (Some(target), Ok(summary)) = (&args.log, summary_rx.try_recv())
        && let Some(written) = summary.log_path
    {
        fs::rename(&written, target)
            .map_err(|error| format!("无法把日志移动到 {}：{error}", target.display()))?;
        println!("执行日志已保存到 {}", target.display());
    }
    Ok(if failed {
        ExitCode::from(1)
    } else {
        ExitCode::SUCCESS
    })
}

fn window_probe(no_guard: bool) -> Box<dyn WindowProbe> {
    if no_guard {
        Box::new(AlwaysForeground)
    } else {
        target_probe()
    }
}

#[cfg(windows)]
fn platform_backend() -> player_core::input::windows::WindowsBackend {
    player_core::input::windows::WindowsBackend
}

#[cfg(not(windows))]
fn platform_backend() -> player_core::input::mock::MockBackend {
    println!("当前平台不是 Windows，使用 Mock 后端（不会真实发键）");
    player_core::input::mock::MockBackend::new()
}

#[cfg(windows)]
fn target_probe() -> Box<dyn WindowProbe> {
    use std::sync::RwLock;

    use player_core::guard::WindowRule;
    use player_core::guard::windows::WindowsProbe;

    Box::new(WindowsProbe::new(Arc::new(RwLock::new(
        WindowRule::default(),
    ))))
}

#[cfg(not(windows))]
fn target_probe() -> Box<dyn WindowProbe> {
    Box::new(player_core::guard::mock::MockProbe::new())
}
