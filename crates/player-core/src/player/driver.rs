//! Player：在独立线程中驱动 PlayerCore。等待命令通道时顺便计时，最后 2ms 自旋补齐。

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender, TryRecvError};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use super::core::{PlayerConfig, PlayerCore, Wake};
use super::state::{Command, PlayerSink, PlayerState};
use crate::error::CoreError;
use crate::guard::WindowProbe;
use crate::input::{InputBackend, KeyboardOutput};
use crate::platform::{TimerResolutionGuard, raise_thread_priority};

/// 粗等待提前结束的时间，剩下的靠自旋补齐
pub const SPIN_WINDOW: Duration = Duration::from_millis(2);

struct Request {
    command: Command,
    reply: Sender<Result<(), CoreError>>,
}

pub struct Player {
    tx: Sender<Request>,
    state: Arc<Mutex<PlayerState>>,
    join: Option<JoinHandle<()>>,
}

impl Player {
    pub fn spawn<B, P, S>(
        output: KeyboardOutput<B>,
        probe: P,
        sink: S,
        config: PlayerConfig,
    ) -> Player
    where
        B: InputBackend + 'static,
        P: WindowProbe + 'static,
        S: PlayerSink + 'static,
    {
        let (tx, rx) = mpsc::channel();
        let state = Arc::new(Mutex::new(PlayerState::Idle));
        let shared = Arc::clone(&state);
        let join = thread::Builder::new()
            .name("gm-player".to_string())
            .spawn(move || {
                let core = PlayerCore::new(output, probe, sink, config);
                run(core, &rx, &shared);
            })
            .expect("无法创建播放线程");
        Player {
            tx,
            state,
            join: Some(join),
        }
    }

    /// 等播放线程处理完这条命令后返回结果（Play 的忙碌检查在线程内完成）
    pub fn send(&self, command: Command) -> Result<(), CoreError> {
        let (reply, response) = mpsc::channel();
        self.tx
            .send(Request { command, reply })
            .map_err(|_| CoreError::player_panic())?;
        response.recv().map_err(|_| CoreError::player_panic())?
    }

    /// 最近一次状态的快照
    pub fn state(&self) -> PlayerState {
        self.state
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
}

impl Drop for Player {
    fn drop(&mut self) {
        let _ = self.send(Command::Shutdown);
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

enum Waited {
    Request(Request),
    Deadline,
    Disconnected,
}

fn run<B, P, S>(
    mut core: PlayerCore<B, P, S>,
    requests: &Receiver<Request>,
    shared: &Mutex<PlayerState>,
) where
    B: InputBackend,
    P: WindowProbe,
    S: PlayerSink,
{
    raise_thread_priority();
    let clock = Instant::now();
    let mut timer: Option<TimerResolutionGuard> = None;
    loop {
        let wake = guarded(&mut core, |core| core.advance(clock.elapsed()))
            .unwrap_or(Wake::WaitForCommand);
        publish(&core, shared, &mut timer);
        let request = match wait(requests, wake, clock) {
            Waited::Request(request) => request,
            Waited::Deadline => continue,
            Waited::Disconnected => break,
        };
        let shutdown = matches!(request.command, Command::Shutdown);
        let result = guarded(&mut core, |core| {
            core.handle(request.command, clock.elapsed())
        })
        .unwrap_or_else(|| Err(CoreError::player_panic()));
        publish(&core, shared, &mut timer);
        let _ = request.reply.send(result);
        if shutdown {
            break;
        }
    }
}

/// 在 catch_unwind 中执行；panic 时让 PlayerCore 进入 Error{PLAYER_PANIC} 并返回 None
fn guarded<B, P, S, T>(
    core: &mut PlayerCore<B, P, S>,
    action: impl FnOnce(&mut PlayerCore<B, P, S>) -> T,
) -> Option<T>
where
    B: InputBackend,
    P: WindowProbe,
    S: PlayerSink,
{
    match catch_unwind(AssertUnwindSafe(|| action(core))) {
        Ok(value) => Some(value),
        Err(_) => {
            let _ = catch_unwind(AssertUnwindSafe(|| core.handle_panic()));
            None
        }
    }
}

/// 更新状态快照；倒计时、等待前台、演奏中持有计时器精度守卫
fn publish<B, P, S>(
    core: &PlayerCore<B, P, S>,
    shared: &Mutex<PlayerState>,
    timer: &mut Option<TimerResolutionGuard>,
) where
    B: InputBackend,
    P: WindowProbe,
    S: PlayerSink,
{
    let state = core.state();
    let needs_precision = matches!(
        state,
        PlayerState::Countdown { .. } | PlayerState::WaitingFocus | PlayerState::Playing
    );
    if needs_precision {
        timer.get_or_insert_with(TimerResolutionGuard::acquire);
    } else {
        *timer = None;
    }
    *shared.lock().unwrap_or_else(PoisonError::into_inner) = state.clone();
}

/// 粗等待：等命令，最多等到 deadline 前 2ms；超时后自旋到 deadline
fn wait(requests: &Receiver<Request>, wake: Wake, clock: Instant) -> Waited {
    let deadline = match wake {
        Wake::WaitForCommand => {
            return match requests.recv() {
                Ok(request) => Waited::Request(request),
                Err(_) => Waited::Disconnected,
            };
        }
        Wake::At(deadline) => deadline,
    };
    let coarse_deadline = deadline.saturating_sub(SPIN_WINDOW);
    let now = clock.elapsed();
    if coarse_deadline > now {
        match requests.recv_timeout(coarse_deadline - now) {
            Ok(request) => return Waited::Request(request),
            Err(RecvTimeoutError::Disconnected) => return Waited::Disconnected,
            Err(RecvTimeoutError::Timeout) => {}
        }
    } else {
        match requests.try_recv() {
            Ok(request) => return Waited::Request(request),
            Err(TryRecvError::Disconnected) => return Waited::Disconnected,
            Err(TryRecvError::Empty) => {}
        }
    }
    while clock.elapsed() < deadline {
        std::hint::spin_loop();
    }
    Waited::Deadline
}
