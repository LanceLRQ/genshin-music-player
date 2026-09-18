use std::fs;
use std::path::PathBuf;

use player_core::exec_log::{
    ExecLog, LatenessStats, LogLine, LogRecord, lateness_stats, log_file_name,
    percentile_nearest_rank,
};
use serde_json::{Value, json};

fn codes(list: &[&str]) -> Vec<String> {
    list.iter().map(|code| code.to_string()).collect()
}

/// 每个测试使用独立的临时目录
fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("gm-exec-log-{}-{name}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn nearest_rank_percentiles() {
    let values: Vec<f64> = (1..=10).map(f64::from).collect();
    assert_eq!(percentile_nearest_rank(&values, 50), 5.0);
    assert_eq!(percentile_nearest_rank(&values, 95), 10.0);
    assert_eq!(percentile_nearest_rank(&[1.0, 2.0, 3.0, 4.0], 50), 2.0);
    let twenty: Vec<f64> = (1..=20).map(f64::from).collect();
    assert_eq!(percentile_nearest_rank(&twenty, 95), 19.0);
    assert_eq!(percentile_nearest_rank(&[7.0], 95), 7.0);
    assert_eq!(percentile_nearest_rank(&[], 50), 0.0);
}

#[test]
fn lateness_stats_sorts_input() {
    assert_eq!(
        lateness_stats(&[3.0, -1.0, 2.0]),
        LatenessStats {
            p50_ms: 2.0,
            p95_ms: 3.0,
            max_ms: 3.0,
        }
    );
    assert_eq!(lateness_stats(&[]), LatenessStats::default());
}

#[test]
fn records_events_and_loop_markers() {
    let mut log = ExecLog::new();
    log.record(0.0, 0.5, &[], &codes(&["KeyA"]));
    log.record(30.0, 32.0, &codes(&["KeyA"]), &[]);
    log.mark_loop();
    log.record(0.0, 1.0, &[], &codes(&["KeyA"]));
    assert_eq!(log.events_sent(), 3);
    assert_eq!(log.lines().len(), 4);
    assert_eq!(log.lines()[2], LogLine::Loop { round: 1 });
    assert_eq!(
        log.stats(),
        LatenessStats {
            p50_ms: 1.0,
            p95_ms: 2.0,
            max_ms: 2.0,
        }
    );
    log.reset();
    assert_eq!(log.events_sent(), 0);
    assert!(log.lines().is_empty());
}

#[test]
fn finish_without_log_dir_only_builds_summary() {
    let mut log = ExecLog::new();
    log.record(10.0, 10.8, &[], &codes(&["KeyA"]));
    let summary = log.finish(true, 2, None);
    assert!(summary.completed);
    assert_eq!(summary.events_sent, 1);
    assert!((summary.lateness_p50_ms - 0.8).abs() < 1e-9);
    assert_eq!(summary.dropped, 2);
    assert_eq!(summary.log_path, None);
}

#[test]
fn resync_count_is_counted_and_reset() {
    let mut log = ExecLog::new();
    log.record(0.0, 0.0, &[], &codes(&["KeyA"]));
    log.mark_resync();
    log.mark_resync();
    let summary = log.finish(true, 0, None);
    assert_eq!(summary.resync_count, 2);
    log.reset();
    assert_eq!(
        log.finish(true, 0, None).resync_count,
        0,
        "reset 后归零，次数按一次演奏统计"
    );
}

#[test]
fn finish_writes_jsonl_with_summary_last() {
    let dir = temp_dir("jsonl");
    let mut log = ExecLog::new();
    log.record(1250.0, 1250.75, &codes(&["KeyA"]), &codes(&["KeyS"]));
    log.mark_loop();
    let summary = log.finish(false, 0, Some(&dir));

    let path = PathBuf::from(summary.log_path.clone().expect("应写出日志"));
    let file_name = path.file_name().unwrap().to_string_lossy().into_owned();
    assert!(file_name.starts_with("exec-") && file_name.ends_with(".jsonl"));
    assert_eq!(path.parent().unwrap(), dir.as_path());

    let text = fs::read_to_string(&path).unwrap();
    let lines: Vec<Value> = text
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(lines.len(), 3);
    assert_eq!(
        lines[0],
        json!({ "targetMs": 1250.0, "actualMs": 1250.75, "up": ["KeyA"], "down": ["KeyS"] })
    );
    assert_eq!(lines[1], json!({ "loop": 1 }));
    assert_eq!(lines[2]["summary"]["completed"], json!(false));
    assert_eq!(lines[2]["summary"]["eventsSent"], json!(1));
    assert_eq!(lines[2]["summary"]["logPath"], json!(summary.log_path));

    let parsed: Vec<LogLine> = text
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(
        parsed[0],
        LogLine::Record(LogRecord {
            target_ms: 1250.0,
            actual_ms: 1250.75,
            up: codes(&["KeyA"]),
            down: codes(&["KeyS"]),
        })
    );
    assert_eq!(parsed[2], LogLine::Summary { summary });
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn write_failure_leaves_log_path_empty() {
    let dir = temp_dir("blocked");
    let blocker = dir.join("not-a-directory");
    fs::write(&blocker, "x").unwrap();
    let mut log = ExecLog::new();
    log.record(0.0, 0.0, &[], &codes(&["KeyA"]));
    let summary = log.finish(true, 0, Some(&blocker.join("logs")));
    assert_eq!(summary.log_path, None);
    assert_eq!(summary.events_sent, 1);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn log_file_name_uses_unix_millis() {
    assert_eq!(log_file_name(1_726_531_200_123), "exec-1726531200123.jsonl");
}
