//! TauriSink：把播放器回调转成前端事件。

use player_core::player::{PlayerSink, PlayerState, Progress, Summary};
use tauri::{AppHandle, Emitter, Runtime};

pub const STATE_EVENT: &str = "player://state";
pub const PROGRESS_EVENT: &str = "player://progress";
pub const SUMMARY_EVENT: &str = "player://summary";
/// 模拟发声模式下全局热键的转发通道：后端不再驱动播放器，改由前端控制试听
pub const HOTKEY_EVENT: &str = "hotkey://action";

/// 回调运行在播放线程上，播放线程要等回调返回才继续处理命令或推进时间线。因此这里只做 `emit`：
/// - **不能**调用 `Player::send`：那是在等播放线程处理完命令，而播放线程正在执行这个回调；
/// - **不能**获取 `AppState` 中的锁（`current`、`settings`、`window_rule`）：持有这些锁的命令线程或
///   热键回调可能正在等 `Player::send` 返回，两边会互相等待。
///
/// `emit` 只把消息投递给事件循环，不会等待主线程。发送失败（例如窗口已关闭）时忽略。
pub struct TauriSink<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> TauriSink<R> {
    pub fn new(app: AppHandle<R>) -> Self {
        Self { app }
    }
}

impl<R: Runtime> PlayerSink for TauriSink<R> {
    fn on_state(&self, state: &PlayerState) {
        let _ = self.app.emit(STATE_EVENT, state);
    }

    fn on_progress(&self, progress: &Progress) {
        let _ = self.app.emit(PROGRESS_EVENT, progress);
    }

    fn on_summary(&self, summary: &Summary) {
        let _ = self.app.emit(SUMMARY_EVENT, summary);
    }
}
