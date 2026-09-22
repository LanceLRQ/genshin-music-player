use player_core::error::{CoreError, ErrorCode};
use player_core::model::{
    ExecutionParams, ExecutionTimeline, Humanize, KeyTimeline, PlayRange, Press, TimelineEvent,
};
use serde_json::json;

#[test]
fn key_timeline_reads_camel_case_json_from_frontend() {
    let timeline: KeyTimeline = serde_json::from_value(json!({
        "instrumentId": "windsong-lyre",
        "durationMs": 1030,
        "minRepeatGapMs": 40,
        "presses": [
            { "tMs": 0, "codes": ["KeyQ"], "holdMs": 30 },
            { "tMs": 1000.5, "codes": ["KeyA", "KeyD"], "holdMs": 30 }
        ]
    }))
    .unwrap();
    assert_eq!(
        timeline,
        KeyTimeline {
            instrument_id: "windsong-lyre".to_string(),
            duration_ms: 1030.0,
            min_repeat_gap_ms: 40.0,
            presses: vec![
                Press {
                    t_ms: 0.0,
                    codes: vec!["KeyQ".to_string()],
                    hold_ms: 30.0,
                    sustain_ms: None,
                },
                Press {
                    t_ms: 1000.5,
                    codes: vec!["KeyA".to_string(), "KeyD".to_string()],
                    hold_ms: 30.0,
                    sustain_ms: None,
                },
            ],
        }
    );
}

#[test]
fn press_sustain_ms_defaults_to_none_and_round_trips_camel_case() {
    let press: Press = serde_json::from_value(json!({
        "tMs": 0,
        "codes": ["KeyQ"],
        "holdMs": 30
    }))
    .unwrap();
    assert_eq!(press.sustain_ms, None);

    let press: Press = serde_json::from_value(json!({
        "tMs": 0,
        "codes": ["KeyQ"],
        "holdMs": 30,
        "sustainMs": 400
    }))
    .unwrap();
    assert_eq!(press.sustain_ms, Some(400.0));
    assert_eq!(
        serde_json::to_value(&press).unwrap(),
        json!({ "tMs": 0.0, "codes": ["KeyQ"], "holdMs": 30.0, "sustainMs": 400.0 })
    );
}

#[test]
fn execution_params_use_loop_as_field_name() {
    let params: ExecutionParams = serde_json::from_value(json!({
        "speed": 1.5,
        "humanize": { "maxJitterMs": 5, "seed": 42 },
        "range": { "startMs": 0, "endMs": 1000, "loop": true }
    }))
    .unwrap();
    assert_eq!(
        params,
        ExecutionParams {
            speed: 1.5,
            humanize: Humanize {
                max_jitter_ms: 5.0,
                seed: 42,
            },
            range: PlayRange {
                start_ms: 0.0,
                end_ms: 1000.0,
                looped: true,
            },
        }
    );
}

#[test]
fn execution_params_default_plays_whole_score_once() {
    let params = ExecutionParams::default();
    assert_eq!(params.speed, 1.0);
    assert_eq!(params.humanize.max_jitter_ms, 0.0);
    assert_eq!(params.range.start_ms, 0.0);
    assert!(params.range.end_ms.is_infinite());
    assert!(!params.range.looped);
}

#[test]
fn execution_timeline_serializes_to_camel_case() {
    let execution = ExecutionTimeline {
        instrument_id: "windsong-lyre".to_string(),
        events: vec![TimelineEvent {
            t_ms: 12.5,
            up: vec!["KeyA".to_string()],
            down: vec!["KeyS".to_string()],
        }],
        duration_ms: 12.5,
        source_start_ms: 100.0,
        speed: 1.0,
        looped: false,
        dropped: 2,
    };
    assert_eq!(
        serde_json::to_value(&execution).unwrap(),
        json!({
            "instrumentId": "windsong-lyre",
            "events": [{ "tMs": 12.5, "up": ["KeyA"], "down": ["KeyS"] }],
            "durationMs": 12.5,
            "sourceStartMs": 100.0,
            "speed": 1.0,
            "loop": false,
            "dropped": 2
        })
    );
}

#[test]
fn core_error_serializes_to_code_and_message() {
    assert_eq!(
        serde_json::to_value(CoreError::player_busy()).unwrap(),
        json!({ "code": "PLAYER_BUSY", "message": "正在演奏中，请先停止" })
    );
    assert_eq!(CoreError::player_busy().to_string(), "正在演奏中，请先停止");
}

#[test]
fn error_code_as_str_matches_serialized_form() {
    let codes = [
        ErrorCode::TimelineInvalid,
        ErrorCode::UnknownKeyCode,
        ErrorCode::ParamsInvalid,
        ErrorCode::PlayerBusy,
        ErrorCode::InvalidState,
        ErrorCode::InputSendFailed,
        ErrorCode::PlayerPanic,
        ErrorCode::NotSupported,
        ErrorCode::ElevationFailed,
    ];
    for code in codes {
        assert_eq!(serde_json::to_value(code).unwrap(), json!(code.as_str()));
    }
}

#[test]
fn error_messages_are_chinese() {
    assert_eq!(
        CoreError::unknown_key_code("KeyFoo").message,
        "未知键码「KeyFoo」"
    );
    assert_eq!(CoreError::invalid_state("继续").message, "当前状态不能继续");
    assert_eq!(
        CoreError::input_send_failed(5).message,
        "按键发送失败（系统错误 5）"
    );
    assert_eq!(
        CoreError::player_panic().message,
        "播放线程异常退出，已松开所有按键"
    );
    assert_eq!(CoreError::not_supported().code, ErrorCode::NotSupported);
    assert_eq!(
        CoreError::elevation_failed().code,
        ErrorCode::ElevationFailed
    );
}
