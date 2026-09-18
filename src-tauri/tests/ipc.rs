//! IPC 测试：用 Tauri 的 MockRuntime 走一遍真实的命令分发，确认命令名、参数名、返回值与错误的 JSON 形状
//! 和前端 `src/ipc/commands.ts` 的约定一致。
//! 需要全局热键插件的 `save_settings` 和会退出进程的 `restart_as_admin` 不在这里调用（逻辑见 app_state 测试）。

mod common;

use std::sync::{Arc, Mutex};

use common::{TestApp, test_app, wait_until};
use genshin_music_player_lib::commands::invoke_handler;
use genshin_music_player_lib::events::{PROGRESS_EVENT, STATE_EVENT, SUMMARY_EVENT, TauriSink};
use genshin_music_player_lib::settings::Settings;
use player_core::player::{PauseReason, PlayerSink, PlayerState, Progress, Summary};
use serde_json::{Value, json};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{
    INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder, mock_context, noop_assets,
};
use tauri::webview::InvokeRequest;
use tauri::{App, Listener, Manager, WebviewWindow, WebviewWindowBuilder};
use tempfile::TempDir;

struct MockApp {
    app: App<MockRuntime>,
    webview: WebviewWindow<MockRuntime>,
    /// 临时数据目录，MockApp 被丢弃时删除
    _temp: TempDir,
}

/// 与应用相同的命令分发，AppState 使用 Mock 播放器和临时数据目录
fn mock_app(settings: Settings) -> MockApp {
    let TestApp { state, temp, .. } = test_app(settings);
    let app = mock_builder()
        .invoke_handler(invoke_handler())
        .build(mock_context(noop_assets()))
        .expect("应能创建 MockRuntime 应用");
    app.manage(state);
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("应能创建窗口");
    MockApp {
        app,
        webview,
        _temp: temp,
    }
}

fn invoke(mock: &MockApp, cmd: &str, args: Value) -> Result<Value, Value> {
    get_ipc_response(
        &mock.webview,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: if cfg!(windows) {
                "http://tauri.localhost"
            } else {
                "tauri://localhost"
            }
            .parse()
            .unwrap(),
            body: InvokeBody::Json(args),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|body| body.deserialize::<Value>().unwrap())
}

#[test]
fn player_commands_use_frontend_argument_names() {
    let mock = mock_app(Settings::default());
    let timeline = json!({
        "instrumentId": "windsong-lyre",
        "durationMs": 1000,
        "minRepeatGapMs": 40,
        "presses": [{ "tMs": 0, "codes": ["KeyA"], "holdMs": 30 }]
    });
    let params = json!({
        "speed": 1,
        "humanize": { "maxJitterMs": 0, "seed": 7 },
        "range": { "startMs": 0, "endMs": 1000, "loop": false }
    });
    let execution = invoke(
        &mock,
        "build_execution",
        json!({ "timeline": timeline, "params": params }),
    )
    .unwrap();
    assert_eq!(
        execution,
        json!({
            "instrumentId": "windsong-lyre",
            "events": [
                { "tMs": 0.0, "up": [], "down": ["KeyA"] },
                { "tMs": 30.0, "up": ["KeyA"], "down": [] }
            ],
            "durationMs": 1000.0,
            "sourceStartMs": 0.0,
            "speed": 1.0,
            "loop": false,
            "dropped": 0
        })
    );

    assert_eq!(
        invoke(&mock, "play", json!({ "countdownSec": 5 })),
        Ok(Value::Null)
    );
    assert_eq!(
        invoke(&mock, "get_player_state", json!({})),
        Ok(json!({ "kind": "countdown", "remainingSec": 5 }))
    );
    assert_eq!(invoke(&mock, "stop", json!({})), Ok(Value::Null));
    assert_eq!(
        invoke(&mock, "play", json!({})),
        Ok(Value::Null),
        "不传 countdownSec 时参数对象为空"
    );
    assert_eq!(
        invoke(&mock, "get_player_state", json!({})),
        Ok(json!({ "kind": "countdown", "remainingSec": 3 })),
        "使用设置里的倒计时"
    );
    assert_eq!(invoke(&mock, "pause", json!({})), Ok(Value::Null));
    assert_eq!(
        invoke(&mock, "get_player_state", json!({})),
        Ok(json!({ "kind": "idle" }))
    );
}

#[test]
fn errors_are_serialized_as_code_and_message() {
    let mock = mock_app(Settings::default());
    assert_eq!(
        invoke(&mock, "play", json!({})),
        Err(json!({ "code": "NO_EXECUTION", "message": "还没有准备好的演奏，请先导入乐谱" }))
    );
    assert_eq!(
        invoke(&mock, "resume", json!({})),
        Err(json!({ "code": "INVALID_STATE", "message": "当前状态不能继续" }))
    );
    assert_eq!(
        invoke(
            &mock,
            "delete_custom_instrument",
            json!({ "id": "my-lyre" })
        ),
        Err(json!({ "code": "INSTRUMENT_NOT_FOUND", "message": "找不到自定义乐器「my-lyre」" }))
    );
}

#[test]
fn custom_instrument_and_settings_commands() {
    let mock = mock_app(Settings::default());
    let profile = json!({ "schemaVersion": 1, "id": "my-lyre", "name": "我的诗琴" });
    assert_eq!(
        invoke(
            &mock,
            "save_custom_instrument",
            json!({ "profile": profile })
        ),
        Ok(Value::Null)
    );
    assert_eq!(
        invoke(&mock, "list_custom_instruments", json!({})),
        Ok(json!({ "profiles": [profile], "warnings": [] }))
    );
    assert_eq!(
        invoke(
            &mock,
            "delete_custom_instrument",
            json!({ "id": "my-lyre" })
        ),
        Ok(Value::Null)
    );
    assert_eq!(
        invoke(&mock, "get_settings", json!({})),
        Ok(serde_json::to_value(Settings::default()).unwrap())
    );
    let env = invoke(&mock, "get_env", json!({})).unwrap();
    assert_eq!(env["backend"], json!("mock"));
    assert_eq!(env["startupWarnings"], json!([]));
    let mut keys: Vec<&str> = env
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        vec![
            "appVersion",
            "backend",
            "dataDir",
            "elevated",
            "logsDir",
            "platform",
            "startupWarnings",
            "trusted"
        ]
    );
}

#[test]
fn tauri_sink_emits_player_events() {
    let mock = mock_app(Settings::default());
    let received: Arc<Mutex<Vec<(String, Value)>>> = Arc::default();
    for name in [STATE_EVENT, PROGRESS_EVENT, SUMMARY_EVENT] {
        let received = Arc::clone(&received);
        mock.app.listen(name, move |event| {
            received.lock().unwrap().push((
                name.to_string(),
                serde_json::from_str(event.payload()).unwrap(),
            ));
        });
    }

    let sink = TauriSink::new(mock.app.handle().clone());
    sink.on_state(&PlayerState::Paused {
        reason: PauseReason::FocusLost,
        position_ms: 1200.0,
    });
    sink.on_progress(&Progress {
        position_ms: 33.0,
        source_position_ms: 66.0,
    });
    sink.on_summary(&Summary {
        completed: true,
        events_sent: 2,
        lateness_p50_ms: 0.0,
        lateness_p95_ms: 1.0,
        lateness_max_ms: 1.0,
        dropped: 0,
        resync_count: 0,
        log_path: None,
    });

    assert!(wait_until(|| received.lock().unwrap().len() == 3));
    assert_eq!(
        *received.lock().unwrap(),
        vec![
            (
                "player://state".to_string(),
                json!({ "kind": "paused", "reason": "focusLost", "positionMs": 1200.0 })
            ),
            (
                "player://progress".to_string(),
                json!({ "positionMs": 33.0, "sourcePositionMs": 66.0 })
            ),
            (
                "player://summary".to_string(),
                json!({
                    "completed": true,
                    "eventsSent": 2,
                    "latenessP50Ms": 0.0,
                    "latenessP95Ms": 1.0,
                    "latenessMaxMs": 1.0,
                    "dropped": 0,
                    "resyncCount": 0,
                    "logPath": null
                })
            ),
        ]
    );
}
