//! 播放器：纯逻辑状态机 PlayerCore + 调度线程 Player。

pub mod core;
pub mod state;

pub use self::core::{PlayerConfig, PlayerCore, Wake};
pub use self::state::{Command, PauseReason, PlayerSink, PlayerState, Progress, Summary};
