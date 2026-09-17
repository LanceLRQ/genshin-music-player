//! Genshin Music Player 桌面应用壳：IPC 命令、事件、设置、自定义乐器存储与全局热键。

pub mod commands;
pub mod error;
pub mod events;
pub mod hotkeys;
pub mod settings;
pub mod state;
pub mod storage;

use std::io;
use std::sync::{Arc, RwLock};

use player_core::guard::WindowRule;
use player_core::player::{Player, PlayerConfig, PlayerSink};
use tauri::{AppHandle, Manager, RunEvent, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent};

use crate::events::TauriSink;
use crate::hotkeys::{hotkey_action, register_on_startup};
use crate::settings::load_settings;
use crate::state::{AppState, player_config};
use crate::storage::AppPaths;

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(on_hotkey)
                .build(),
        )
        .setup(|app| {
            setup(app.handle())?;
            Ok(())
        })
        .invoke_handler(commands::invoke_handler())
        .build(tauri::generate_context!())
        .expect("启动应用失败");
    app.run(|app, event| {
        // app.exit() 最终调用 process::exit，托管的 Player 不会被 Drop，这里显式停止以松开所有按键
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit)
            && let Some(state) = app.try_state::<AppState>()
        {
            let _ = state.stop();
        }
    });
}

/// 读取设置 → 注册全局热键 → 创建播放线程 → 托管 AppState。设置损坏与热键注册失败只写入启动警告。
fn setup<R: Runtime>(app: &AppHandle<R>) -> Result<(), Box<dyn std::error::Error>> {
    let paths = AppPaths::new(app.path().app_data_dir()?);
    let loaded = load_settings(&paths.settings_file);
    let settings = loaded.settings;
    let mut startup_warnings: Vec<String> = loaded.warning.into_iter().collect();
    startup_warnings.extend(register_on_startup(
        app.global_shortcut(),
        &settings.hotkeys,
    ));

    let window_rule = Arc::new(RwLock::new(settings.target_window.clone()));
    let (player, backend) = spawn_player(
        TauriSink::new(app.clone()),
        Arc::clone(&window_rule),
        player_config(&settings, &paths),
    )?;
    app.manage(AppState::new(
        player,
        backend,
        settings,
        window_rule,
        paths,
        startup_warnings,
    ));
    Ok(())
}

/// 热键回调在主线程上运行；AppState 还没创建（启动过程中）时忽略。
/// 命令的结果通过 player:// 事件反映到界面上，这里不再单独处理错误。
fn on_hotkey<R: Runtime>(app: &AppHandle<R>, shortcut: &Shortcut, event: ShortcutEvent) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let hotkeys = state.settings().hotkeys;
    if let Some(action) = hotkey_action(&hotkeys, shortcut, event.state) {
        let _ = state.handle_hotkey(action);
    }
}

/// Windows 上用 SendInput 后端和前台窗口检测（与设置共享窗口规则）
#[cfg(windows)]
fn spawn_player<S: PlayerSink + 'static>(
    sink: S,
    window_rule: Arc<RwLock<WindowRule>>,
    config: PlayerConfig,
) -> io::Result<(Player, &'static str)> {
    use player_core::guard::windows::WindowsProbe;
    use player_core::input::KeyboardOutput;
    use player_core::input::windows::WindowsBackend;

    let output = KeyboardOutput::new(WindowsBackend);
    let backend = output.backend_name();
    let player = Player::spawn(output, WindowsProbe::new(window_rule), sink, config)?;
    Ok((player, backend))
}

/// 其他平台用 Mock 后端（只记录，不发键），前台检测始终认为目标在前台
#[cfg(not(windows))]
fn spawn_player<S: PlayerSink + 'static>(
    sink: S,
    _window_rule: Arc<RwLock<WindowRule>>,
    config: PlayerConfig,
) -> io::Result<(Player, &'static str)> {
    use player_core::guard::mock::MockProbe;
    use player_core::input::KeyboardOutput;
    use player_core::input::mock::MockBackend;

    let output = KeyboardOutput::new(MockBackend::new());
    let backend = output.backend_name();
    let player = Player::spawn(output, MockProbe::new(), sink, config)?;
    Ok((player, backend))
}
