//! Player：在独立线程中驱动 PlayerCore。等待命令通道时顺便计时，最后 2ms 自旋补齐。

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender, TryRecvError};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread::{self, JoinHandle, ThreadId};
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

/// 调度线程驱动 [`PlayerCore`] 并在其上同步调用 sink 的回调（见 [`PlayerSink`]）。
/// `Player` 本身是 `Send + Sync`，可以直接用 `Arc` 在多处共享，不需要再包一层 `Mutex`。
pub struct Player {
    tx: Sender<Request>,
    state: Arc<Mutex<PlayerState>>,
    join: Option<JoinHandle<()>>,
    /// 播放线程的 id，用来在 `send`/`drop` 时判断"是不是在自己等自己"
    player_thread_id: ThreadId,
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
        let player_thread_id = join.thread().id();
        Player {
            tx,
            state,
            join: Some(join),
            player_thread_id,
        }
    }

    /// 等播放线程处理完这条命令后返回结果（Play 的忙碌检查在线程内完成）。
    ///
    /// 绝不能在 [`PlayerSink`] 回调里同步调用本方法：回调本身运行在播放线程上，
    /// 而这次调用要等的正是播放线程处理完当前命令——播放线程在等自己，会永久卡死
    /// （可能还按着没松开的键）。检测到这种情况会立即返回 `INVALID_STATE` 错误，
    /// 不会等待、也不会把命令放进队列。
    pub fn send(&self, command: Command) -> Result<(), CoreError> {
        if thread::current().id() == self.player_thread_id {
            return Err(CoreError::invalid_state("在播放线程内发送命令"));
        }
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
        // 同样要考虑在播放线程上被 drop 的情况（例如 sink 持有了最后一份引用）：
        // 只能异步通知关闭，不能等回复，更不能 join 自己所在的线程。
        if thread::current().id() == self.player_thread_id {
            let (reply, _response) = mpsc::channel();
            let _ = self.tx.send(Request {
                command: Command::Shutdown,
                reply,
            });
            return;
        }
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
