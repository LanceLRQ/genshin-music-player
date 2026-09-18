use gm_verify::stats::{compare_logs, format_stats, parse_log, parse_summary, record_stats};
use player_core::exec_log::{LatenessStats, LogRecord};

fn record(target_ms: f64, actual_ms: f64, up: &[&str], down: &[&str]) -> LogRecord {
    let owned = |codes: &[&str]| codes.iter().map(|code| code.to_string()).collect();
    LogRecord {
        target_ms,
        actual_ms,
        up: owned(up),
        down: owned(down),
    }
}

const LOG: &str = r#"{"targetMs":0.0,"actualMs":0.5,"up":[],"down":["KeyA"]}
{"targetMs":30.0,"actualMs":32.0,"up":["KeyA"],"down":[]}
{"loop":1}
{"targetMs":0.0,"actualMs":1.0,"up":[],"down":["KeyA"]}

{"summary":{"completed":false,"eventsSent":3,"latenessP50Ms":1.0,"latenessP95Ms":2.0,"latenessMaxMs":2.0,"dropped":0,"logPath":null}}
"#;

#[test]
fn parse_log_keeps_only_send_records() {
    let records = parse_log(LOG).unwrap();
    assert_eq!(
        records,
        vec![
            record(0.0, 0.5, &[], &["KeyA"]),
            record(30.0, 32.0, &["KeyA"], &[]),
            record(0.0, 1.0, &[], &["KeyA"]),
        ]
    );
}

#[test]
fn parse_log_reports_line_number_of_bad_line() {
    let error = parse_log("{\"loop\":1}\nnot json\n").unwrap_err();
    assert!(error.starts_with("第 2 行不是有效的执行日志"), "{error}");
}

#[test]
fn parse_summary_reads_trailing_summary_line() {
    let summary = parse_summary(LOG).unwrap().expect("LOG 末尾是汇总行");
    assert_eq!(summary.events_sent, 3);
    // 旧格式汇总没有 resyncCount，反序列化默认 0
    assert_eq!(summary.resync_count, 0);
}

#[test]
fn parse_summary_reads_resync_count_or_none_without_summary() {
    let text = r#"{"targetMs":0.0,"actualMs":0.0,"up":[],"down":["KeyA"]}
{"summary":{"completed":true,"eventsSent":1,"latenessP50Ms":0.0,"latenessP95Ms":0.0,"latenessMaxMs":0.0,"dropped":0,"resyncCount":2,"logPath":null}}
"#;
    let summary = parse_summary(text).unwrap().expect("有汇总行");
    assert_eq!(summary.resync_count, 2);
    // 日志被截断、没有汇总行时返回 None，stats 不输出停顿平移一行
    assert_eq!(parse_summary("{\"loop\":1}\n").unwrap(), None);
}

#[test]
fn stats_use_nearest_rank_percentiles() {
    let records = parse_log(LOG).unwrap();
    assert_eq!(
        record_stats(&records),
        LatenessStats {
            p50_ms: 1.0,
            p95_ms: 2.0,
            max_ms: 2.0,
        }
    );
    assert_eq!(
        format_stats(&records, None),
        "事件数：3\n延迟 p50：1.00ms · p95：2.00ms · 最大：2.00ms"
    );
    let summary = parse_summary(LOG).unwrap().unwrap();
    assert_eq!(
        format_stats(&records, Some(&summary)),
        "事件数：3\n延迟 p50：1.00ms · p95：2.00ms · 最大：2.00ms\n停顿平移：0 次"
    );
}

#[test]
fn identical_logs_match_within_tolerance() {
    let left = vec![
        record(0.0, 0.5, &[], &["KeyA"]),
        record(30.0, 31.0, &["KeyA"], &[]),
    ];
    let right = vec![
        record(0.4, 3.0, &[], &["KeyA"]),
        record(29.5, 30.0, &["KeyA"], &[]),
    ];
    let comparison = compare_logs(&left, &right);
    assert!(comparison.is_match());
    assert_eq!(comparison.total, 0);
}

#[test]
fn different_keys_counts_or_times_do_not_match() {
    let left = vec![
        record(0.0, 0.0, &[], &["KeyA"]),
        record(30.0, 30.0, &["KeyA"], &[]),
    ];

    let other_key = vec![
        record(0.0, 0.0, &[], &["KeyS"]),
        record(30.0, 30.0, &["KeyA"], &[]),
    ];
    let comparison = compare_logs(&left, &other_key);
    assert_eq!(comparison.total, 1);
    assert!(comparison.listed[0].starts_with("第 1 条按键不同"));

    let shifted = vec![
        record(0.0, 0.0, &[], &["KeyA"]),
        record(30.6, 30.6, &["KeyA"], &[]),
    ];
    let comparison = compare_logs(&left, &shifted);
    assert_eq!(comparison.total, 1);
    assert!(comparison.listed[0].starts_with("第 2 条 targetMs 相差超过 0.5ms"));

    let shorter = vec![record(0.0, 0.0, &[], &["KeyA"])];
    let comparison = compare_logs(&left, &shorter);
    assert!(!comparison.is_match());
    assert_eq!(comparison.listed[0], "事件数不同：2 与 1");
}

#[test]
fn only_first_ten_differences_are_listed() {
    let left: Vec<_> = (0..15)
        .map(|i| record(f64::from(i) * 100.0, 0.0, &[], &["KeyA"]))
        .collect();
    let right: Vec<_> = (0..15)
        .map(|i| record(f64::from(i) * 100.0, 0.0, &[], &["KeyS"]))
        .collect();
    let comparison = compare_logs(&left, &right);
    assert_eq!(comparison.total, 15);
    assert_eq!(comparison.listed.len(), 10);
}
