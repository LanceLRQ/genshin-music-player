//! 与前端共享的数据类型，字段一律 camelCase。
//! `KeyTimeline` / `Press` 与 M1 的 `src/core/model/timeline.ts` 逐字段对应。

use serde::{Deserialize, Serialize};

/// 一次按键动作；codes 有多个时表示和弦，需要原子发送
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Press {
    pub t_ms: f64,
    pub codes: Vec<String>,
    pub hold_ms: f64,
    /// 需要按音长按住时的目标音长（未经变速）；前端只在音长大于 holdMs 时才会设置
    #[serde(default)]
    pub sustain_ms: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyTimeline {
    pub instrument_id: String,
    pub duration_ms: f64,
    pub min_repeat_gap_ms: f64,
    /// 按 tMs 升序
    pub presses: Vec<Press>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Humanize {
    /// 0..=30，0 表示关闭
    pub max_jitter_ms: f64,
    pub seed: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayRange {
    pub start_ms: f64,
    pub end_ms: f64,
    #[serde(rename = "loop")]
    pub looped: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionParams {
    /// 0.5..=2.0
    pub speed: f64,
    pub humanize: Humanize,
    pub range: PlayRange,
}

impl Default for ExecutionParams {
    /// 原速、不做人性化、播放整首、不循环
    fn default() -> Self {
        Self {
            speed: 1.0,
            humanize: Humanize {
                max_jitter_ms: 0.0,
                seed: 0,
            },
            range: PlayRange {
                start_ms: 0.0,
                end_ms: f64::INFINITY,
                looped: false,
            },
        }
    }
}

/// 同一时刻先处理 up 再处理 down
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEvent {
    pub t_ms: f64,
    pub up: Vec<String>,
    pub down: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionTimeline {
    pub instrument_id: String,
    /// tMs 从 0 开始、升序、互不相同
    pub events: Vec<TimelineEvent>,
    /// 最后一个事件的时间
    pub duration_ms: f64,
    pub source_start_ms: f64,
    pub speed: f64,
    #[serde(rename = "loop")]
    pub looped: bool,
    /// 变速后同键过密被丢弃的按键数
    pub dropped: u32,
}
