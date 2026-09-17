use std::path::PathBuf;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::model::ExecutionTimeline;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PauseReason {
    User,
    FocusLost,
}

/// 序列化为 `{ "kind": "paused", "reason": "focusLost", "positionMs": 1200.0 }` 这样的形式
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PlayerState {
    Idle,
    Countdown {
        remaining_sec: u32,
    },
    WaitingFocus,
    Playing,
    Paused {
        reason: PauseReason,
        position_ms: f64,
    },
    Error {
        code: String,
        message: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    /// 执行时间（从 0 开始）
    pub position_ms: f64,
    /// 乐谱时间 = sourceStartMs + positionMs × speed
    pub source_position_ms: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    /// 自然播完为 true，被停止为 false
    pub completed: bool,
    pub events_sent: u32,
    pub lateness_p50_ms: f64,
    pub lateness_p95_ms: f64,
    pub lateness_max_ms: f64,
    /// 来自 ExecutionTimeline
    pub dropped: u32,
    pub log_path: Option<String>,
}

/// 演奏事件回调。三个方法都在播放线程（调度线程，由 `Player::spawn` 创建）上
/// 同步调用；播放线程会等回调返回才继续处理下一条命令或推进时间线。
///
/// 因此实现回调时：
/// - **不能**在回调里同步调用同一个 `Player` 的 `send`——那是在等播放线程处理完
///   一条命令，而播放线程正忙着执行这个回调本身，两者是同一个线程，会永久卡死
///   （`Player::send` 检测到这种情况会直接返回 `INVALID_STATE` 错误，不会阻塞，
///   但业务上仍然达不到目的）。
/// - **不能**在回调里获取可能被 `send` 调用方（通常是主线程/UI 线程）持有的锁，
///   否则同样可能与播放线程相互等待造成死锁。
pub trait PlayerSink: Send {
    fn on_state(&self, state: &PlayerState);
    fn on_progress(&self, progress: &Progress);
    fn on_summary(&self, summary: &Summary);
}

#[derive(Debug, Clone)]
pub enum Command {
    Play {
        execution: Arc<ExecutionTimeline>,
        countdown_sec: u32,
    },
    /// 热键：空闲或出错时开始播放 execution（为 None 时忽略）；演奏中（包括循环的尾部休止）暂停；暂停中继续；倒计时和等待前台时忽略
    Toggle {
        execution: Option<Arc<ExecutionTimeline>>,
        countdown_sec: u32,
    },
    Pause,
    Resume,
    Stop,
    Shutdown,
    /// 修改执行日志目录（None 表示不写日志）；任何状态下都接受，从下一次输出 Summary 起生效
    SetLogDir {
        log_dir: Option<PathBuf>,
    },
}
