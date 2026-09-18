//! 命令行定义与控制台输出文案。

use std::path::{Path, PathBuf};

use clap::{Args, Parser, Subcommand};
use player_core::model::{ExecutionParams, Humanize, PlayRange};
use player_core::player::state::{PauseReason, PlayerState, Summary};

use crate::patterns::{PatternKind, PatternOptions};

#[derive(Debug, Parser)]
#[command(
    name = "gm-verify",
    version,
    about = "Genshin Music Player 真机验证工具：不开界面，直接执行按键时间线"
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: CliCommand,
}

#[derive(Debug, Subcommand)]
pub enum CliCommand {
    /// 执行按键时间线 JSON（KeyTimeline）
    Play {
        /// 时间线文件
        timeline: PathBuf,
        #[command(flatten)]
        run: RunArgs,
    },
    /// 生成测试样例；带 --out 时只写文件，否则直接执行
    Pattern {
        kind: PatternKind,
        /// 内置乐器 id，或乐器配置 JSON 文件路径
        #[arg(long)]
        instrument: String,
        /// 每个按键的按住时长（ms）
        #[arg(long, default_value_t = 30.0)]
        hold: f64,
        /// 同键最小重复间隔（ms）
        #[arg(long, default_value_t = 40.0)]
        gap: f64,
        /// 只把生成的时间线写入文件，不执行
        #[arg(long)]
        out: Option<PathBuf>,
        #[command(flatten)]
        run: RunArgs,
    },
    /// 输出执行日志的计时统计；带 --compare 时与另一份日志逐条比对
    Stats {
        log: PathBuf,
        #[arg(long)]
        compare: Option<PathBuf>,
    },
}

#[derive(Debug, Clone, PartialEq, Args)]
pub struct RunArgs {
    /// 速度（0.5–2.0）
    #[arg(long, default_value_t = 1.0)]
    pub speed: f64,
    /// 节奏人性化最大偏移（0–30ms）
    #[arg(long, default_value_t = 0.0)]
    pub humanize: f64,
    /// 人性化随机种子
    #[arg(long, default_value_t = 1)]
    pub seed: u64,
    /// 区间起点（乐谱时间，ms）
    #[arg(long, default_value_t = 0.0)]
    pub start_ms: f64,
    /// 区间终点（乐谱时间，ms），不填表示播放到结尾
    #[arg(long)]
    pub end_ms: Option<f64>,
    /// 循环播放区间
    #[arg(long = "loop")]
    pub looped: bool,
    /// 开始前的倒计时秒数
    #[arg(long, default_value_t = 3)]
    pub countdown: u32,
    /// 执行日志输出文件（.jsonl）
    #[arg(long)]
    pub log: Option<PathBuf>,
    /// 关闭前台窗口检测（往记事本发键测试用）
    #[arg(long)]
    pub no_guard: bool,
}

impl RunArgs {
    pub fn execution_params(&self) -> ExecutionParams {
        ExecutionParams {
            speed: self.speed,
            humanize: Humanize {
                max_jitter_ms: self.humanize,
                seed: self.seed,
            },
            range: PlayRange {
                start_ms: self.start_ms,
                end_ms: self.end_ms.unwrap_or(f64::INFINITY),
                looped: self.looped,
            },
        }
    }

    /// 播放器把日志写到这个目录，结束后再改名为 --log 指定的文件
    pub fn log_dir(&self) -> Option<PathBuf> {
        self.log.as_deref().map(parent_dir)
    }
}

pub fn pattern_options(hold: f64, gap: f64) -> PatternOptions {
    PatternOptions {
        hold_ms: hold,
        min_repeat_gap_ms: gap,
    }
}

fn parent_dir(path: &Path) -> PathBuf {
    match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent.to_path_buf(),
        _ => PathBuf::from("."),
    }
}

pub fn describe_state(state: &PlayerState) -> String {
    match state {
        PlayerState::Idle => "空闲".to_string(),
        PlayerState::Countdown { remaining_sec } => format!("倒计时 {remaining_sec} 秒"),
        PlayerState::WaitingFocus => "等待游戏窗口切到前台…".to_string(),
        PlayerState::Playing => "演奏中".to_string(),
        PlayerState::Paused {
            reason: PauseReason::User,
            position_ms,
        } => format!("已暂停（{position_ms:.0}ms）"),
        PlayerState::Paused {
            reason: PauseReason::FocusLost,
            position_ms,
        } => format!("游戏窗口失去前台，已在 {position_ms:.0}ms 处暂停；按 Ctrl+C 结束"),
        PlayerState::Error { code, message } => format!("错误 {code}：{message}"),
    }
}

pub fn describe_summary(summary: &Summary) -> String {
    let outcome = if summary.completed {
        "播放完成"
    } else {
        "已停止"
    };
    let log = summary.log_path.as_deref().unwrap_or("未写入");
    format!(
        "{outcome}：发送 {} 个事件，延迟 p50 {:.2}ms · p95 {:.2}ms · 最大 {:.2}ms，过密丢弃 {} 个，停顿平移 {} 次\n执行日志：{log}",
        summary.events_sent,
        summary.lateness_p50_ms,
        summary.lateness_p95_ms,
        summary.lateness_max_ms,
        summary.dropped,
        summary.resync_count
    )
}
