//! PlayerCore：纯逻辑状态机。不读系统时钟，所有时间由调用方传入，可以确定性测试。
//! 内部时间统一用整数微秒表示，避免浮点比较误差。

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use super::state::{Command, PauseReason, PlayerSink, PlayerState, Progress};
use crate::error::CoreError;
use crate::exec_log::ExecLog;
use crate::guard::WindowProbe;
use crate::input::{InputBackend, KeyboardOutput};
use crate::model::ExecutionTimeline;

pub const DEFAULT_PROGRESS_INTERVAL_MS: f64 = 33.0;
/// 倒计时每秒减一
pub const COUNTDOWN_TICK: Duration = Duration::from_secs(1);
/// 等待前台时的轮询间隔
pub const FOCUS_POLL_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Debug, Clone, PartialEq)]
pub struct PlayerConfig {
    /// 不为空时，每次演奏结束写 `exec-<Unix 毫秒>.jsonl`
    pub log_dir: Option<PathBuf>,
    /// Playing 时的进度上报间隔
    pub progress_interval_ms: f64,
}

impl Default for PlayerConfig {
    fn default() -> Self {
        Self {
            log_dir: None,
            progress_interval_ms: DEFAULT_PROGRESS_INTERVAL_MS,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Wake {
    /// 最晚在这个时间再调用一次 advance
    At(Duration),
    /// 没有定时任务，等下一条命令即可
    WaitForCommand,
}

/// 一次演奏（从 Play 到回到 Idle / Error）的运行数据
struct Session {
    execution: Arc<ExecutionTimeline>,
    /// 下一个待发送事件的下标
    cursor: usize,
    /// 执行时间 0 对应的时刻；Playing 时有效
    t0_us: i64,
    /// 暂停或等待前台时保存的位置；从头开始时为 0
    position_us: i64,
    next_countdown_us: i64,
    next_focus_poll_us: i64,
    next_progress_us: i64,
}

pub struct PlayerCore<B: InputBackend, P: WindowProbe, S: PlayerSink> {
    output: KeyboardOutput<B>,
    probe: P,
    sink: S,
    log_dir: Option<PathBuf>,
    progress_interval_us: i64,
    state: PlayerState,
    session: Option<Session>,
    log: ExecLog,
}

fn to_micros(time: Duration) -> i64 {
    i64::try_from(time.as_micros()).unwrap_or(i64::MAX)
}

fn ms_to_micros(ms: f64) -> i64 {
    (ms * 1000.0).round() as i64
}

fn micros_to_ms(us: i64) -> f64 {
    us as f64 / 1000.0
}

/// 循环周期：durationMs（含区间尾部休止），至少覆盖最后一个事件，并且大于 0
fn loop_period_us(execution: &ExecutionTimeline) -> i64 {
    let last_event_us = execution
        .events
        .last()
        .map_or(0, |event| ms_to_micros(event.t_ms));
    ms_to_micros(execution.duration_ms)
        .max(last_event_us)
        .max(1)
}

fn wake_at(us: i64) -> Wake {
    Wake::At(Duration::from_micros(u64::try_from(us).unwrap_or(0)))
}

impl<B: InputBackend, P: WindowProbe, S: PlayerSink> PlayerCore<B, P, S> {
    pub fn new(output: KeyboardOutput<B>, probe: P, sink: S, config: PlayerConfig) -> Self {
        Self {
            output,
            probe,
            sink,
            log_dir: config.log_dir,
            progress_interval_us: ms_to_micros(config.progress_interval_ms).max(1),
            state: PlayerState::Idle,
            session: None,
            log: ExecLog::new(),
        }
    }

    pub fn state(&self) -> &PlayerState {
        &self.state
    }

    pub fn backend_name(&self) -> &'static str {
        self.output.backend_name()
    }

    pub fn handle(&mut self, command: Command, now: Duration) -> Result<(), CoreError> {
        let now_us = to_micros(now);
        match command {
            Command::Play {
                execution,
                countdown_sec,
            } => {
                if !matches!(self.state, PlayerState::Idle | PlayerState::Error { .. }) {
                    return Err(CoreError::player_busy());
                }
                self.start(execution, countdown_sec, now_us);
            }
            Command::Toggle {
                execution,
                countdown_sec,
            } => match self.state {
                PlayerState::Idle | PlayerState::Error { .. } => {
                    if let Some(execution) = execution {
                        self.start(execution, countdown_sec, now_us);
                    }
                }
                PlayerState::Playing => self.pause(PauseReason::User, now_us),
                PlayerState::Paused { .. } => self.check_focus(now_us),
                PlayerState::Countdown { .. } | PlayerState::WaitingFocus => {}
            },
            Command::Pause => match self.state {
                PlayerState::Playing => self.pause(PauseReason::User, now_us),
                PlayerState::Countdown { .. } | PlayerState::WaitingFocus => self.stop(),
                _ => return Err(CoreError::invalid_state("暂停")),
            },
            Command::Resume => match self.state {
                PlayerState::Paused { .. } => self.check_focus(now_us),
                _ => return Err(CoreError::invalid_state("继续")),
            },
            Command::Stop | Command::Shutdown => self.stop(),
            Command::SetLogDir { log_dir } => self.log_dir = log_dir,
        }
        Ok(())
    }

    /// 执行 now 之前到期的所有动作，返回下一次需要被唤醒的时间
    pub fn advance(&mut self, now: Duration) -> Wake {
        let now_us = to_micros(now);
        loop {
            match self.state {
                PlayerState::Countdown { remaining_sec } => {
                    let Some(session) = self.session.as_mut() else {
                        return Wake::WaitForCommand;
                    };
                    if now_us < session.next_countdown_us {
                        return wake_at(session.next_countdown_us);
                    }
                    session.next_countdown_us += to_micros(COUNTDOWN_TICK);
                    let remaining_sec = remaining_sec.saturating_sub(1);
                    if remaining_sec == 0 {
                        self.check_focus(now_us);
                    } else {
                        self.set_state(PlayerState::Countdown { remaining_sec });
                    }
                }
                PlayerState::WaitingFocus => {
                    let Some(session) = self.session.as_ref() else {
                        return Wake::WaitForCommand;
                    };
                    if now_us < session.next_focus_poll_us {
                        return wake_at(session.next_focus_poll_us);
                    }
                    self.check_focus(now_us);
                    if let (PlayerState::WaitingFocus, Some(session)) = (&self.state, &self.session)
                    {
                        return wake_at(session.next_focus_poll_us);
                    }
                }
                PlayerState::Playing => return self.advance_playing(now_us),
                PlayerState::Idle | PlayerState::Paused { .. } | PlayerState::Error { .. } => {
                    return Wake::WaitForCommand;
                }
            }
        }
    }

    /// 播放线程 panic 后由调度线程调用：尽力松开所有键，进入 Error{PLAYER_PANIC}
    pub fn handle_panic(&mut self) {
        self.fail(CoreError::player_panic());
    }

    fn start(&mut self, execution: Arc<ExecutionTimeline>, countdown_sec: u32, now_us: i64) {
        // 上一次演奏可能因 Stop 时 release_all 失败而残留按下的键：
        // 若不先补发松开，这些键的 down 会被 KeyboardOutput 当成"已按下"过滤掉，导致吞音。
        if !self.output.pressed().is_empty()
            && let Err(error) = self.output.release_all()
        {
            self.fail(error);
            return;
        }
        self.log.reset();
        self.session = Some(Session {
            execution,
            cursor: 0,
            t0_us: now_us,
            position_us: 0,
            next_countdown_us: now_us + to_micros(COUNTDOWN_TICK),
            next_focus_poll_us: now_us,
            next_progress_us: now_us,
        });
        if countdown_sec > 0 {
            self.set_state(PlayerState::Countdown {
                remaining_sec: countdown_sec,
            });
        } else {
            self.check_focus(now_us);
        }
    }

    /// 前台判断：在前台就从保存的位置开始演奏，否则进入 WaitingFocus 并在 100ms 后再判断
    fn check_focus(&mut self, now_us: i64) {
        let foreground = self.probe.is_target_foreground();
        let Some(session) = self.session.as_mut() else {
            return;
        };
        if foreground {
            session.t0_us = now_us - session.position_us;
            session.next_progress_us = now_us;
            self.set_state(PlayerState::Playing);
        } else {
            session.next_focus_poll_us = now_us + to_micros(FOCUS_POLL_INTERVAL);
            self.set_state(PlayerState::WaitingFocus);
        }
    }

    fn pause(&mut self, reason: PauseReason, now_us: i64) {
        let Some(session) = self.session.as_mut() else {
            return;
        };
        let position_us = (now_us - session.t0_us).max(0);
        session.position_us = position_us;
        if let Err(error) = self.output.release_all() {
            self.fail(error);
            return;
        }
        self.set_state(PlayerState::Paused {
            reason,
            position_ms: micros_to_ms(position_us),
        });
    }

    /// 松开所有键（错误忽略）；发送过按键时输出 Summary（completed = false）
    fn stop(&mut self) {
        if matches!(self.state, PlayerState::Idle) {
            return;
        }
        let _ = self.output.release_all();
        if self.session.is_some() && self.log.events_sent() > 0 {
            self.emit_summary(false);
        }
        self.session = None;
        self.set_state(PlayerState::Idle);
    }

    fn fail(&mut self, error: CoreError) {
        let _ = self.output.release_all();
        self.session = None;
        self.set_state(PlayerState::Error {
            code: error.code.as_str().to_string(),
            message: error.message,
        });
    }

    fn advance_playing(&mut self, now_us: i64) -> Wake {
        let Some(session) = self.session.as_ref() else {
            return Wake::WaitForCommand;
        };
        let execution = Arc::clone(&session.execution);
        let events = &execution.events;
        let t0_us = session.t0_us;
        let elapsed_us = now_us - t0_us;
        let cursor_before = session.cursor;
        let mut cursor = cursor_before;

        let due =
            |index: usize| index < events.len() && ms_to_micros(events[index].t_ms) <= elapsed_us;
        if due(cursor) {
            // 每批事件发送前检查一次前台
            if !self.probe.is_target_foreground() {
                self.pause(PauseReason::FocusLost, now_us);
                return Wake::WaitForCommand;
            }
            while due(cursor) {
                let event = &events[cursor];
                if let Err(error) = self.output.send(&event.up, &event.down) {
                    self.fail(error);
                    return Wake::WaitForCommand;
                }
                self.log
                    .record(event.t_ms, micros_to_ms(elapsed_us), &event.up, &event.down);
                cursor += 1;
            }
        }

        let looping = execution.looped && !events.is_empty();
        let round_end_us = t0_us + loop_period_us(&execution);
        if cursor >= events.len() {
            // 本轮最后一个事件刚发完（或时间线为空）：松开所有键；不循环时立即结束
            if cursor_before < events.len() || events.is_empty() {
                if let Err(error) = self.output.release_all() {
                    self.fail(error);
                    return Wake::WaitForCommand;
                }
                if !looping {
                    if self.log.events_sent() > 0 {
                        self.emit_summary(true);
                    }
                    self.session = None;
                    self.set_state(PlayerState::Idle);
                    return Wake::WaitForCommand;
                }
            }
            // 循环：尾部休止结束后开始下一轮，t0 按周期累加，不受本轮延迟影响
            if now_us >= round_end_us {
                self.log.mark_loop();
                if let Some(session) = self.session.as_mut() {
                    session.t0_us = round_end_us;
                    session.cursor = 0;
                }
                return wake_at(round_end_us + ms_to_micros(events[0].t_ms));
            }
        }

        let progress_interval_us = self.progress_interval_us;
        let Some(session) = self.session.as_mut() else {
            return Wake::WaitForCommand;
        };
        session.cursor = cursor;
        let mut progress = None;
        if now_us >= session.next_progress_us {
            session.next_progress_us = now_us + progress_interval_us;
            let position_ms = micros_to_ms(elapsed_us);
            progress = Some(Progress {
                position_ms,
                source_position_ms: execution.source_start_ms + position_ms * execution.speed,
            });
        }
        let next_us = match events.get(cursor) {
            Some(event) => t0_us + ms_to_micros(event.t_ms),
            None => round_end_us,
        };
        let wake = wake_at(next_us.min(session.next_progress_us));
        if let Some(progress) = progress {
            self.sink.on_progress(&progress);
        }
        wake
    }

    fn emit_summary(&mut self, completed: bool) {
        let dropped = self
            .session
            .as_ref()
            .map_or(0, |session| session.execution.dropped);
        let summary = self.log.finish(completed, dropped, self.log_dir.as_deref());
        self.sink.on_summary(&summary);
    }

    /// 状态没有变化时不重复通知
    fn set_state(&mut self, state: PlayerState) {
        if self.state != state {
            self.state = state;
            self.sink.on_state(&self.state);
        }
    }
}

impl<B: InputBackend, P: WindowProbe, S: PlayerSink> Drop for PlayerCore<B, P, S> {
    fn drop(&mut self) {
        let _ = self.output.release_all();
    }
}
