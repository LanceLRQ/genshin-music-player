//! 执行日志：记录每次发送的目标时间与实际时间，统计延迟分位数，写 JSONL。

use std::fs::{self, File};
use std::io::{self, BufWriter, Write};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::player::state::Summary;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogRecord {
    pub target_ms: f64,
    /// 发送时的 now − t0
    pub actual_ms: f64,
    pub up: Vec<String>,
    pub down: Vec<String>,
}

/// JSONL 中的一行：发送记录、循环分隔行 `{ "loop": n }`、最后一行汇总 `{ "summary": {...} }`
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum LogLine {
    Record(LogRecord),
    Loop {
        #[serde(rename = "loop")]
        round: u32,
    },
    Summary {
        summary: Summary,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct LatenessStats {
    pub p50_ms: f64,
    pub p95_ms: f64,
    pub max_ms: f64,
}

/// 最近秩法：rank = ⌈percent / 100 × N⌉，取升序排列后的第 rank 个值；空序列返回 0
pub fn percentile_nearest_rank(sorted: &[f64], percent: usize) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let rank = (percent * sorted.len())
        .div_ceil(100)
        .clamp(1, sorted.len());
    sorted[rank - 1]
}

pub fn lateness_stats(lateness_ms: &[f64]) -> LatenessStats {
    let mut sorted = lateness_ms.to_vec();
    sorted.sort_by(f64::total_cmp);
    LatenessStats {
        p50_ms: percentile_nearest_rank(&sorted, 50),
        p95_ms: percentile_nearest_rank(&sorted, 95),
        max_ms: sorted.last().copied().unwrap_or(0.0),
    }
}

pub fn log_file_name(unix_ms: u128) -> String {
    format!("exec-{unix_ms}.jsonl")
}

/// 自动创建目录；每行一个 JSON，最后一行是汇总
pub fn write_jsonl(path: &Path, lines: &[LogLine], summary: &Summary) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut writer = BufWriter::new(File::create(path)?);
    let summary_line = LogLine::Summary {
        summary: summary.clone(),
    };
    for line in lines.iter().chain(std::iter::once(&summary_line)) {
        serde_json::to_writer(&mut writer, line).map_err(io::Error::other)?;
        writer.write_all(b"\n")?;
    }
    writer.flush()
}

#[derive(Debug, Default)]
pub struct ExecLog {
    lines: Vec<LogLine>,
    lateness_ms: Vec<f64>,
    events_sent: u32,
    loops: u32,
}

impl ExecLog {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn reset(&mut self) {
        *self = Self::default();
    }

    pub fn record(&mut self, target_ms: f64, actual_ms: f64, up: &[String], down: &[String]) {
        self.lateness_ms.push(actual_ms - target_ms);
        self.events_sent += 1;
        self.lines.push(LogLine::Record(LogRecord {
            target_ms,
            actual_ms,
            up: up.to_vec(),
            down: down.to_vec(),
        }));
    }

    /// 一轮循环结束，写入 `{ "loop": n }`，n 为已完成的轮数
    pub fn mark_loop(&mut self) {
        self.loops += 1;
        self.lines.push(LogLine::Loop { round: self.loops });
    }

    pub fn events_sent(&self) -> u32 {
        self.events_sent
    }

    pub fn lines(&self) -> &[LogLine] {
        &self.lines
    }

    pub fn stats(&self) -> LatenessStats {
        lateness_stats(&self.lateness_ms)
    }

    /// 生成 Summary；log_dir 不为空时写 `exec-<Unix 毫秒>.jsonl`。
    /// 写入失败不影响调用方，只是 logPath 为 None，并在 stderr 输出一行。
    pub fn finish(&self, completed: bool, dropped: u32, log_dir: Option<&Path>) -> Summary {
        let stats = self.stats();
        let mut summary = Summary {
            completed,
            events_sent: self.events_sent,
            lateness_p50_ms: stats.p50_ms,
            lateness_p95_ms: stats.p95_ms,
            lateness_max_ms: stats.max_ms,
            dropped,
            log_path: None,
        };
        if let Some(dir) = log_dir {
            let unix_ms = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |elapsed| elapsed.as_millis());
            let path = dir.join(log_file_name(unix_ms));
            summary.log_path = Some(path.to_string_lossy().into_owned());
            if let Err(error) = write_jsonl(&path, &self.lines, &summary) {
                eprintln!("写入执行日志失败（{}）：{error}", path.display());
                summary.log_path = None;
            }
        }
        summary
    }
}
