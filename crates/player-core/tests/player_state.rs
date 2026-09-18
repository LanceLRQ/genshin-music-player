use player_core::player::state::{PauseReason, PlayerState, Progress, Summary};
use serde_json::json;

#[test]
fn player_state_is_tagged_by_kind() {
    let cases = [
        (PlayerState::Idle, json!({ "kind": "idle" })),
        (
            PlayerState::Countdown { remaining_sec: 3 },
            json!({ "kind": "countdown", "remainingSec": 3 }),
        ),
        (PlayerState::WaitingFocus, json!({ "kind": "waitingFocus" })),
        (PlayerState::Playing, json!({ "kind": "playing" })),
        (
            PlayerState::Paused {
                reason: PauseReason::FocusLost,
                position_ms: 1200.5,
            },
            json!({ "kind": "paused", "reason": "focusLost", "positionMs": 1200.5 }),
        ),
        (
            PlayerState::Paused {
                reason: PauseReason::User,
                position_ms: 0.0,
            },
            json!({ "kind": "paused", "reason": "user", "positionMs": 0.0 }),
        ),
        (
            PlayerState::Error {
                code: "INPUT_SEND_FAILED".to_string(),
                message: "按键发送失败（系统错误 5）".to_string(),
            },
            json!({ "kind": "error", "code": "INPUT_SEND_FAILED", "message": "按键发送失败（系统错误 5）" }),
        ),
    ];
    for (state, expected) in cases {
        assert_eq!(serde_json::to_value(&state).unwrap(), expected);
        let back: PlayerState = serde_json::from_value(expected).unwrap();
        assert_eq!(back, state);
    }
}

#[test]
fn progress_and_summary_use_camel_case() {
    assert_eq!(
        serde_json::to_value(Progress {
            position_ms: 500.0,
            source_position_ms: 1100.0,
        })
        .unwrap(),
        json!({ "positionMs": 500.0, "sourcePositionMs": 1100.0 })
    );
    assert_eq!(
        serde_json::to_value(Summary {
            completed: true,
            events_sent: 6,
            lateness_p50_ms: 0.5,
            lateness_p95_ms: 1.5,
            lateness_max_ms: 3.0,
            dropped: 1,
            resync_count: 2,
            log_path: None,
        })
        .unwrap(),
        json!({
            "completed": true,
            "eventsSent": 6,
            "latenessP50Ms": 0.5,
            "latenessP95Ms": 1.5,
            "latenessMaxMs": 3.0,
            "dropped": 1,
            "resyncCount": 2,
            "logPath": null
        })
    );
}

#[test]
fn summary_without_resync_count_defaults_to_zero() {
    // 旧版本写出的日志没有 resyncCount 字段，反序列化必须默认 0 而不是报错
    let summary: Summary = serde_json::from_value(json!({
        "completed": false,
        "eventsSent": 3,
        "latenessP50Ms": 1.0,
        "latenessP95Ms": 2.0,
        "latenessMaxMs": 2.0,
        "dropped": 0,
        "logPath": null
    }))
    .unwrap();
    assert_eq!(summary.resync_count, 0);
}
