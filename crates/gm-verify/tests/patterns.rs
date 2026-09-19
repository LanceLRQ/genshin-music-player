use std::fs;

use gm_verify::patterns::{PatternKind, PatternOptions, generate, load_instrument};
use player_core::instruments::find_builtin_instrument;
use player_core::model::{ExecutionParams, KeyTimeline};
use player_core::timeline::build_execution;

const OPTIONS: PatternOptions = PatternOptions {
    hold_ms: 30.0,
    min_repeat_gap_ms: 40.0,
};

fn lyre_pattern(kind: PatternKind) -> KeyTimeline {
    generate(
        kind,
        find_builtin_instrument("windsong-lyre").unwrap(),
        OPTIONS,
    )
}

fn single_codes(timeline: &KeyTimeline) -> Vec<&str> {
    timeline
        .presses
        .iter()
        .map(|press| {
            assert_eq!(press.codes.len(), 1);
            press.codes[0].as_str()
        })
        .collect()
}

#[test]
fn scale_plays_every_key_in_row_order_every_300ms() {
    let timeline = lyre_pattern(PatternKind::Scale);
    assert_eq!(timeline.instrument_id, "windsong-lyre");
    assert_eq!(timeline.min_repeat_gap_ms, 40.0);
    assert_eq!(timeline.presses.len(), 21);
    let codes = single_codes(&timeline);
    assert_eq!(&codes[..3], &["KeyQ", "KeyW", "KeyE"]);
    assert_eq!(codes[7], "KeyA");
    assert_eq!(codes[20], "KeyM");
    assert!(
        timeline
            .presses
            .iter()
            .enumerate()
            .all(|(i, press)| press.t_ms == i as f64 * 300.0)
    );
    assert!(timeline.presses.iter().all(|press| press.hold_ms == 30.0));
    assert_eq!(timeline.duration_ms, 6030.0);
}

#[test]
fn chord_plays_each_row_then_first_keys_every_600ms() {
    let timeline = lyre_pattern(PatternKind::Chord);
    assert_eq!(timeline.presses.len(), 4);
    assert_eq!(
        timeline.presses[0].codes,
        vec!["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU"]
    );
    assert_eq!(timeline.presses[2].codes[0], "KeyZ");
    assert_eq!(timeline.presses[3].codes, vec!["KeyQ", "KeyA", "KeyZ"]);
    let times: Vec<f64> = timeline.presses.iter().map(|press| press.t_ms).collect();
    assert_eq!(times, vec![0.0, 600.0, 1200.0, 1800.0]);
}

#[test]
fn repeat_hits_middle_row_first_key_with_shrinking_intervals() {
    let timeline = lyre_pattern(PatternKind::Repeat);
    assert_eq!(timeline.presses.len(), 45);
    assert!(single_codes(&timeline).iter().all(|code| *code == "KeyA"));
    let times: Vec<f64> = timeline.presses.iter().map(|press| press.t_ms).collect();
    assert_eq!(&times[..6], &[0.0, 200.0, 400.0, 600.0, 800.0, 1300.0]);
    assert_eq!(&times[40..], &[6840.0, 6860.0, 6880.0, 6900.0, 6920.0]);
    assert_eq!(timeline.duration_ms, 6950.0);

    let two_row = generate(
        PatternKind::Repeat,
        find_builtin_instrument("two-row-prototype").unwrap(),
        OPTIONS,
    );
    assert_eq!(two_row.presses[0].codes, vec!["KeyA"], "两行乐器取第 2 行");
    let drum = generate(
        PatternKind::Repeat,
        find_builtin_instrument("festive-drum").unwrap(),
        OPTIONS,
    );
    assert_eq!(drum.presses[0].codes, vec!["KeyS"], "只有一行时取第一行");
}

#[test]
fn long_zigzags_through_keys_by_pitch_for_300_seconds() {
    let timeline = lyre_pattern(PatternKind::Long);
    assert_eq!(timeline.presses.len(), 2000);
    assert_eq!(timeline.presses[1999].t_ms, 299_850.0);
    let codes = single_codes(&timeline);
    assert_eq!(&codes[..3], &["KeyZ", "KeyX", "KeyC"], "从最低音开始升序");
    assert_eq!(codes[20], "KeyU", "第 21 个是最高音");
    assert_eq!(codes[21], "KeyY", "然后降序");
    assert_eq!(codes[39], "KeyX");
    assert_eq!(codes[40], "KeyZ", "一轮 40 个后重新开始");

    let drum = generate(
        PatternKind::Long,
        find_builtin_instrument("festive-drum").unwrap(),
        OPTIONS,
    );
    let drum_codes = single_codes(&drum);
    assert_eq!(&drum_codes[..4], &["KeyS", "KeyA", "KeyS", "KeyA"]);
}

#[test]
fn generated_patterns_build_valid_execution_timelines() {
    for layout in player_core::instruments::builtin_instruments() {
        for kind in [
            PatternKind::Scale,
            PatternKind::Chord,
            PatternKind::Repeat,
            PatternKind::Long,
        ] {
            let timeline = generate(kind, layout, OPTIONS);
            let execution = build_execution(&timeline, &ExecutionParams::default());
            assert!(
                execution.is_ok(),
                "{} 的 {kind:?} 样例无法生成执行时间线",
                layout.id
            );
        }
    }
    let repeat = build_execution(
        &lyre_pattern(PatternKind::Repeat),
        &ExecutionParams::default(),
    )
    .unwrap();
    assert_eq!(
        repeat.dropped, 4,
        "30ms 和 20ms 两档低于最小重复间隔 40ms，每档隔一个丢一个"
    );
}

#[test]
fn load_instrument_accepts_builtin_id_or_json_file() {
    assert_eq!(load_instrument("floral-zither").unwrap().name, "镜花之琴");

    let dir = std::env::temp_dir().join(format!("gm-verify-patterns-{}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    let custom = dir.join("custom.json");
    fs::write(
        &custom,
        r#"{ "id": "my-lyre", "name": "我的琴", "rows": [{ "label": "行", "keys": [{ "code": "KeyQ", "pitch": 60 }] }],
            "timing": { "holdMs": 25, "minRepeatGapMs": 35 } }"#,
    )
    .unwrap();
    let layout = load_instrument(custom.to_str().unwrap()).unwrap();
    assert_eq!(layout.id, "my-lyre");
    assert_eq!(layout.timing.hold_ms, 25.0);

    let empty = dir.join("empty.json");
    fs::write(
        &empty,
        r#"{ "id": "empty", "name": "空乐器", "rows": [], "timing": { "holdMs": 30, "minRepeatGapMs": 40 } }"#,
    )
    .unwrap();
    assert_eq!(
        load_instrument(empty.to_str().unwrap()).unwrap_err(),
        "乐器「空乐器」没有任何按键"
    );

    let broken = dir.join("broken.json");
    fs::write(&broken, "{").unwrap();
    assert!(
        load_instrument(broken.to_str().unwrap())
            .unwrap_err()
            .starts_with("乐器配置格式错误")
    );
    assert!(
        load_instrument("no-such-instrument")
            .unwrap_err()
            .starts_with("「no-such-instrument」不是内置乐器 id")
    );
    fs::remove_dir_all(dir).unwrap();
}
