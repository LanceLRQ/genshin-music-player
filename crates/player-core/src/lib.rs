//! Genshin Music Player 执行核心。不依赖 Tauri，可以在任何平台上 `cargo test`。

pub mod error;
pub mod instruments;
pub mod keymap;
pub mod model;

pub use error::{CoreError, ErrorCode};
