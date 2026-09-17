use std::collections::HashMap;

use player_core::error::{CoreError, ErrorCode};
use player_core::model::{ExecutionParams, ExecutionTimeline, KeyTimeline, Press, TimelineEvent};
use player_core::timeline::build_execution;

fn press(t_ms: f64, codes: &[&str], hold_ms: f64) -> Press {
    Press {
        t_ms,
        codes: codes.iter().map(|code| code.to_string()).collect(),
        hold_ms,
    }
}

fn timeline(min_repeat_gap_ms: f64, presses: Vec<Press>) -> KeyTimeline {
    KeyTimeline {
        instrument_id: "windsong-lyre".to_string(),
        duration_ms: 0.0,
        min_repeat_gap_ms,
        presses,
    }
}

fn event(t_ms: f64, up: &[&str], down: &[&str]) -> TimelineEvent {
    let owned = |codes: &[&str]| codes.iter().map(|code| code.to_string()).collect();
    TimelineEvent {
        t_ms,
        up: owned(up),
        down: owned(down),
    }
}

fn build(timeline: &KeyTimeline, params: ExecutionParams) -> ExecutionTimeline {
    build_execution(timeline, &params).unwrap()
}

fn build_error(timeline: &KeyTimeline, params: ExecutionParams) -> CoreError {
    build_execution(timeline, &params).unwrap_err()
}

fn with_speed(speed: f64) -> ExecutionParams {
    ExecutionParams {
        speed,
        ..ExecutionParams::default()
    }
}

fn with_range(start_ms: f64, end_ms: f64, looped: bool) -> ExecutionParams {
    let mut params = ExecutionParams::default();
    params.range.start_ms = start_ms;
    params.range.end_ms = end_ms;
    params.range.looped = looped;
    params
}

fn with_jitter(max_jitter_ms: f64, seed: u64) -> ExecutionParams {
    let mut params = ExecutionParams::default();
    params.humanize.max_jitter_ms = max_jitter_ms;
    params.humanize.seed = seed;
    params
}

/// 每个键的 down 与 up 必须严格交替，且以 up 结束
fn assert_alternating(execution: &ExecutionTimeline) {
    let mut pressed: HashMap<&str, bool> = HashMap::new();
    for event in &execution.events {
        for code in &event.up {
            assert_eq!(
                pressed.insert(code, false),
                Some(true),
                "{code} 在 {} 松开前没有按下",
                event.t_ms
            );
        }
        for code in &event.down {
            assert_ne!(
                pressed.insert(code, true),
                Some(true),
                "{code} 在 {} 重复按下",
                event.t_ms
            );
        }
    }
    assert!(pressed.values().all(|down| !down), "结束时仍有键按下");
}

#[test]
fn splits_presses_into_down_and_up_events() {
    let source = timeline(
        40.0,
        vec![
            press(0.0, &["KeyA"], 30.0),
            press(100.0, &["KeyS", "KeyD"], 30.0),
        ],
    );
    let execution = build(&source, ExecutionParams::default());
    assert_eq!(
        execution.events,
        vec![
            event(0.0, &[], &["KeyA"]),
            event(30.0, &["KeyA"], &[]),
            event(100.0, &[], &["KeyS", "KeyD"]),
            event(130.0, &["KeyS", "KeyD"], &[]),
        ]
    );
    assert_eq!(execution.duration_ms, 130.0);
    assert_eq!(execution.instrument_id, "windsong-lyre");
    assert_eq!(execution.dropped, 0);
}

#[test]
fn keeps_only_presses_inside_range_and_rebases_time() {
    let source = timeline(
        40.0,
        vec![
            press(0.0, &["KeyA"], 30.0),
            press(100.0, &["KeyS"], 30.0),
            press(200.0, &["KeyD"], 30.0),
            press(300.0, &["KeyF"], 30.0),
        ],
    );
    let execution = build(&source, with_range(100.0, 300.0, true));
    let downs: Vec<_> = execution
        .events
        .iter()
        .filter(|event| !event.down.is_empty())
        .map(|event| (event.t_ms, event.down.clone()))
        .collect();
    assert_eq!(
        downs,
        vec![
            (0.0, vec!["KeyS".to_string()]),
            (100.0, vec!["KeyD".to_string()])
        ]
    );
    assert_eq!(execution.source_start_ms, 100.0);
    assert!(execution.looped);
}

#[test]
fn empty_range_produces_empty_timeline() {
    let source = timeline(40.0, vec![press(0.0, &["KeyA"], 30.0)]);
    let execution = build(&source, with_range(500.0, 1000.0, false));
    assert!(execution.events.is_empty());
    assert_eq!(execution.duration_ms, 0.0);
}

#[test]
fn duration_keeps_range_tail_when_end_is_finite() {
    let source = timeline(
        40.0,
        vec![press(0.0, &["KeyA"], 30.0), press(3500.0, &["KeyS"], 30.0)],
    );
    assert_eq!(
        build(&source, with_range(0.0, 4000.0, true)).duration_ms,
        4000.0,
        "保留 3530ms 之后的尾部休止"
    );
    let mut fast = with_range(0.0, 4000.0, true);
    fast.speed = 2.0;
    assert_eq!(build(&source, fast).duration_ms, 2000.0);
    let mut uneven = with_range(0.0, 4000.0, false);
    uneven.speed = 1.5;
    assert_eq!(
        build(&source, uneven).duration_ms,
        2666.67,
        "四舍五入到 0.01ms"
    );
    assert_eq!(
        build(&source, ExecutionParams::default()).duration_ms,
        3530.0,
        "终点为无穷时取最后一个事件的时间"
    );

    let late = timeline(40.0, vec![press(3990.0, &["KeyA"], 30.0)]);
    assert_eq!(
        build(&late, with_range(0.0, 4000.0, false)).duration_ms,
        4020.0,
        "松开晚于区间终点时取最后一个事件的时间"
    );
}

#[test]
fn speed_scales_press_time_but_not_hold() {
    let source = timeline(40.0, vec![press(1000.0, &["KeyA"], 30.0)]);
    let execution = build(&source, with_speed(2.0));
    assert_eq!(
        execution.events,
        vec![event(500.0, &[], &["KeyA"]), event(530.0, &["KeyA"], &[])]
    );
    assert_eq!(execution.speed, 2.0);

    let slow = build(&source, with_speed(0.5));
    assert_eq!(slow.events[0].t_ms, 2000.0);
    assert_eq!(slow.events[1].t_ms, 2030.0);
}

#[test]
fn same_seed_gives_same_result_and_different_seed_differs() {
    let source = timeline(
        40.0,
        (0..20)
            .map(|i| press(f64::from(i) * 200.0, &["KeyA"], 30.0))
            .collect(),
    );
    let first = build(&source, with_jitter(20.0, 7));
    let second = build(&source, with_jitter(20.0, 7));
    let other = build(&source, with_jitter(20.0, 8));
    assert_eq!(first, second);
    assert_ne!(first.events, other.events);
}

#[test]
fn jitter_stays_within_bound_and_chord_shares_offset() {
    let source = timeline(
        40.0,
        (0..20)
            .map(|i| {
                press(
                    1000.0 + f64::from(i) * 200.0,
                    &["KeyA", "KeyS", "KeyD"],
                    30.0,
                )
            })
            .collect(),
    );
    let execution = build(&source, with_jitter(10.0, 3));
    let downs: Vec<_> = execution
        .events
        .iter()
        .filter(|event| !event.down.is_empty())
        .collect();
    assert_eq!(downs.len(), 20);
    for (i, event) in downs.iter().enumerate() {
        assert_eq!(
            event.down,
            vec!["KeyA", "KeyS", "KeyD"],
            "和弦内的键应在同一事件中按下"
        );
        let original = 1000.0 + i as f64 * 200.0;
        assert!((event.t_ms - original).abs() <= 10.0 + 0.005);
    }
    assert!(
        downs
            .iter()
            .enumerate()
            .any(|(i, event)| event.t_ms != 1000.0 + i as f64 * 200.0),
        "开启人性化后至少有一个按键发生偏移"
    );
}

#[test]
fn jitter_never_moves_press_before_zero() {
    let source = timeline(
        40.0,
        vec![press(0.0, &["KeyA"], 30.0), press(5.0, &["KeyS"], 30.0)],
    );
    for seed in 0..50 {
        let execution = build(&source, with_jitter(30.0, seed));
        assert!(execution.events.iter().all(|event| event.t_ms >= 0.0));
        let pressed: usize = execution.events.iter().map(|event| event.down.len()).sum();
        assert_eq!(pressed, 2);
    }
}

#[test]
fn drops_repeat_that_is_too_dense() {
    let source = timeline(
        40.0,
        vec![
            press(0.0, &["KeyA"], 20.0),
            press(30.0, &["KeyA"], 20.0),
            press(80.0, &["KeyA"], 20.0),
        ],
    );
    let execution = build(&source, ExecutionParams::default());
    assert_eq!(execution.dropped, 1);
    let downs: Vec<_> = execution
        .events
        .iter()
        .filter(|event| !event.down.is_empty())
        .map(|event| event.t_ms)
        .collect();
    assert_eq!(downs, vec![0.0, 80.0]);
}

#[test]
fn drops_only_the_dense_key_from_a_chord() {
    let source = timeline(
        40.0,
        vec![
            press(0.0, &["KeyA"], 5.0),
            press(10.0, &["KeyA", "KeyS"], 30.0),
        ],
    );
    let execution = build(&source, ExecutionParams::default());
    assert_eq!(execution.dropped, 1);
    assert_eq!(
        execution.events,
        vec![
            event(0.0, &[], &["KeyA"]),
            event(5.0, &["KeyA"], &[]),
            event(10.0, &[], &["KeyS"]),
            event(40.0, &["KeyS"], &[]),
        ]
    );
}

#[test]
fn speeding_up_can_make_repeats_too_dense() {
    let source = timeline(
        40.0,
        vec![press(0.0, &["KeyA"], 10.0), press(60.0, &["KeyA"], 10.0)],
    );
    assert_eq!(build(&source, ExecutionParams::default()).dropped, 0);
    let fast = build(&source, with_speed(2.0));
    assert_eq!(fast.dropped, 1);
    assert_eq!(fast.events.len(), 2);
}

#[test]
fn release_is_moved_before_next_press_of_same_key() {
    let source = timeline(
        40.0,
        vec![press(0.0, &["KeyA"], 100.0), press(50.0, &["KeyA"], 30.0)],
    );
    let execution = build(&source, ExecutionParams::default());
    assert_eq!(
        execution.events,
        vec![
            event(0.0, &[], &["KeyA"]),
            event(49.0, &["KeyA"], &[]),
            event(50.0, &[], &["KeyA"]),
            event(80.0, &["KeyA"], &[]),
        ]
    );
}

#[test]
fn min_gap_is_at_least_two_ms() {
    let dense = timeline(
        0.0,
        vec![press(0.0, &["KeyA"], 10.0), press(1.5, &["KeyA"], 10.0)],
    );
    assert_eq!(build(&dense, ExecutionParams::default()).dropped, 1);

    let tight = timeline(
        0.0,
        vec![press(0.0, &["KeyA"], 10.0), press(2.0, &["KeyA"], 10.0)],
    );
    let execution = build(&tight, ExecutionParams::default());
    assert_eq!(execution.dropped, 0);
    assert_eq!(
        execution.events,
        vec![
            event(0.0, &[], &["KeyA"]),
            event(1.0, &["KeyA"], &[]),
            event(2.0, &[], &["KeyA"]),
            event(12.0, &["KeyA"], &[]),
        ]
    );
}

#[test]
fn up_comes_before_down_at_same_time() {
    let source = timeline(
        40.0,
        vec![press(0.0, &["KeyA"], 30.0), press(30.0, &["KeyS"], 30.0)],
    );
    let execution = build(&source, ExecutionParams::default());
    assert_eq!(execution.events[1], event(30.0, &["KeyA"], &["KeyS"]));
}

#[test]
fn times_are_rounded_to_hundredths_and_merged() {
    let source = timeline(
        40.0,
        vec![
            press(0.0, &["KeyA"], 10.004),
            press(10.001, &["KeyS"], 0.001),
        ],
    );
    let execution = build(&source, ExecutionParams::default());
    assert_eq!(
        execution.events,
        vec![
            event(0.0, &[], &["KeyA"]),
            event(10.0, &["KeyA"], &["KeyS"]),
            event(10.01, &["KeyS"], &[]),
        ]
    );
}

#[test]
fn every_key_alternates_down_and_up_under_dense_input() {
    let presses = (0..400)
        .map(|i| {
            let codes: &[&str] = match i % 4 {
                0 => &["KeyA"],
                1 => &["KeyA", "KeyS"],
                2 => &["KeyS", "KeyD"],
                _ => &["KeyD", "KeyA"],
            };
            press(f64::from(i) * 7.3, codes, 25.0)
        })
        .collect();
    let source = timeline(3.0, presses);
    for seed in 0..5 {
        let mut params = with_jitter(12.0, seed);
        params.speed = 1.7;
        let execution = build(&source, params);
        assert!(
            execution
                .events
                .windows(2)
                .all(|pair| pair[0].t_ms < pair[1].t_ms)
        );
        assert_alternating(&execution);
    }
}

#[test]
fn rejects_press_earlier_than_previous() {
    let source = timeline(
        40.0,
        vec![press(100.0, &["KeyA"], 30.0), press(50.0, &["KeyS"], 30.0)],
    );
    let error = build_error(&source, ExecutionParams::default());
    assert_eq!(error.code, ErrorCode::TimelineInvalid);
    assert_eq!(error.message, "第 2 个按键的时间早于上一个按键");
}

#[test]
fn rejects_invalid_press_fields() {
    let cases = [
        (press(-1.0, &["KeyA"], 30.0), "第 1 个按键的时间无效"),
        (press(f64::NAN, &["KeyA"], 30.0), "第 1 个按键的时间无效"),
        (
            press(0.0, &["KeyA"], 0.0),
            "第 1 个按键的按住时长必须大于 0",
        ),
        (press(0.0, &[], 30.0), "第 1 个按键没有键码"),
        (
            press(0.0, &["KeyA", "KeyA"], 30.0),
            "第 1 个按键包含重复的键码「KeyA」",
        ),
    ];
    for (bad, message) in cases {
        let error = build_error(&timeline(40.0, vec![bad]), ExecutionParams::default());
        assert_eq!(error.code, ErrorCode::TimelineInvalid);
        assert_eq!(error.message, message);
    }
}

#[test]
fn rejects_unknown_key_code() {
    let source = timeline(40.0, vec![press(0.0, &["KeyFoo"], 30.0)]);
    let error = build_error(&source, ExecutionParams::default());
    assert_eq!(error.code, ErrorCode::UnknownKeyCode);
    assert_eq!(error.message, "未知键码「KeyFoo」");
}

#[test]
fn rejects_invalid_params() {
    let source = timeline(40.0, vec![press(0.0, &["KeyA"], 30.0)]);
    let cases = [
        (with_speed(0.49), "速度必须在 0.5–2.0 之间"),
        (with_speed(2.01), "速度必须在 0.5–2.0 之间"),
        (with_speed(f64::NAN), "速度必须在 0.5–2.0 之间"),
        (with_jitter(30.5, 1), "节奏人性化偏移必须在 0–30ms 之间"),
        (with_jitter(-1.0, 1), "节奏人性化偏移必须在 0–30ms 之间"),
        (
            with_range(-1.0, 100.0, false),
            "播放区间无效：起点不能小于 0，终点必须大于起点",
        ),
        (
            with_range(100.0, 100.0, false),
            "播放区间无效：起点不能小于 0，终点必须大于起点",
        ),
    ];
    for (params, message) in cases {
        let error = build_error(&source, params);
        assert_eq!(error.code, ErrorCode::ParamsInvalid);
        assert_eq!(error.message, message);
    }
    assert!(build_execution(&source, &with_speed(0.5)).is_ok());
    assert!(build_execution(&source, &with_jitter(30.0, 1)).is_ok());
}
