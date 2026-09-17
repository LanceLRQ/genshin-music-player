//! Genshin Music Player 桌面应用壳：IPC 命令、事件、设置、自定义乐器存储与全局热键。

pub mod error;
pub mod events;
pub mod hotkeys;
pub mod settings;
pub mod state;
pub mod storage;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("启动应用失败");
}
