//! Genshin Music Player 执行核心。不依赖 Tauri，可以在任何平台上 `cargo test`。

// 调度线程用 catch_unwind 兜底：播放线程 panic 时尽力松开所有按键、进入 Error 状态，
// 而不是让按键卡在按下状态。这条防线依赖展开式 panic，panic = "abort" 会让它失效。
#[cfg(panic = "abort")]
compile_error!("player-core 依赖展开式 panic 在调度线程出错时松开按键，不能使用 panic = \"abort\"");

pub mod error;
pub mod exec_log;
pub mod guard;
pub mod input;
pub mod instruments;
pub mod keymap;
pub mod model;
pub mod platform;
pub mod player;
pub mod timeline;

pub use error::{CoreError, ErrorCode};
