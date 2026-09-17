//! 执行日志统计与逐条比对。

use player_core::exec_log::{LatenessStats, LogLine, LogRecord, lateness_stats};

/// 两份日志的 targetMs 最多相差多少毫秒仍算一致
pub const TARGET_TOLERANCE_MS: f64 = 0.5;
/// 比对不一致时最多列出的差异条数
pub const MAX_LISTED_DIFFERENCES: usize = 10;

/// 解析 JSONL 执行日志，只保留发送记录（跳过循环分隔行和汇总行）
pub fn parse_log(text: &str) -> Result<Vec<LogRecord>, String> {
    let mut records = Vec::new();
    for (index, line) in text.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let parsed: LogLine = serde_json::from_str(line)
            .map_err(|error| format!("第 {} 行不是有效的执行日志：{error}", index + 1))?;
        if let LogLine::Record(record) = parsed {
            records.push(record);
        }
    }
    Ok(records)
}

pub fn record_stats(records: &[LogRecord]) -> LatenessStats {
    let lateness: Vec<f64> = records
        .iter()
        .map(|record| record.actual_ms - record.target_ms)
        .collect();
    lateness_stats(&lateness)
}

pub fn format_stats(records: &[LogRecord]) -> String {
    let stats = record_stats(records);
    format!(
        "事件数：{}\n延迟 p50：{:.2}ms · p95：{:.2}ms · 最大：{:.2}ms",
        records.len(),
        stats.p50_ms,
        stats.p95_ms,
        stats.max_ms
    )
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Comparison {
    /// 差异总数
    pub total: usize,
    /// 前 10 处差异的描述
    pub listed: Vec<String>,
}

impl Comparison {
    pub fn is_match(&self) -> bool {
        self.total == 0
    }
}

/// 事件数相同、每条的 up/down 相同、targetMs 相差不超过 0.5ms 才算一致
pub fn compare_logs(left: &[LogRecord], right: &[LogRecord]) -> Comparison {
    let mut differences = Vec::new();
    if left.len() != right.len() {
        differences.push(format!("事件数不同：{} 与 {}", left.len(), right.len()));
    }
    for (index, (a, b)) in left.iter().zip(right).enumerate() {
        let number = index + 1;
        if a.up != b.up || a.down != b.down {
            differences.push(format!(
                "第 {number} 条按键不同：up {:?} / {:?}，down {:?} / {:?}",
                a.up, b.up, a.down, b.down
            ));
        }
        if (a.target_ms - b.target_ms).abs() > TARGET_TOLERANCE_MS {
            differences.push(format!(
                "第 {number} 条 targetMs 相差超过 {TARGET_TOLERANCE_MS}ms：{} / {}",
                a.target_ms, b.target_ms
            ));
        }
    }
    Comparison {
        total: differences.len(),
        listed: differences
            .into_iter()
            .take(MAX_LISTED_DIFFERENCES)
            .collect(),
    }
}
