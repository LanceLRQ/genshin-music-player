//! Genshin Music Player 执行核心。不依赖 Tauri，可以在任何平台上 `cargo test`。

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
