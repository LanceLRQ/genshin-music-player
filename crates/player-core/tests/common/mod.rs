//! 播放器测试共用的辅助代码
#![allow(dead_code)]

use std::sync::{Arc, Mutex, PoisonError};

use player_core::model::{ExecutionParams, ExecutionTimeline, KeyTimeline, Press};
use player_core::player::state::{PlayerSink, PlayerState, Progress, Summary};
use player_core::timeline::build_execution;

#[derive(Debug, Clone, PartialEq)]
pub enum SinkEvent {
    State(PlayerState),
    Progress(Progress),
    Summary(Summary),
}

/// 记录所有回调；clone 出来的句柄共享同一份记录
#[derive(Debug, Clone, Default)]
pub struct RecordingSink {
    events: Arc<Mutex<Vec<SinkEvent>>>,
}

impl RecordingSink {
    pub fn events(&self) -> Vec<SinkEvent> {
        self.events
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    pub fn states(&self) -> Vec<PlayerState> {
        self.events()
            .into_iter()
            .filter_map(|event| match event {
                SinkEvent::State(state) => Some(state),
                _ => None,
            })
            .collect()
    }

    pub fn progresses(&self) -> Vec<Progress> {
        self.events()
            .into_iter()
            .filter_map(|event| match event {
                SinkEvent::Progress(progress) => Some(progress),
                _ => None,
            })
            .collect()
    }

    pub fn summaries(&self) -> Vec<Summary> {
        self.events()
            .into_iter()
            .filter_map(|event| match event {
                SinkEvent::Summary(summary) => Some(summary),
                _ => None,
            })
            .collect()
    }

    fn push(&self, event: SinkEvent) {
        self.events
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(event);
    }
}

impl PlayerSink for RecordingSink {
    fn on_state(&self, state: &PlayerState) {
        self.push(SinkEvent::State(state.clone()));
    }

    fn on_progress(&self, progress: &Progress) {
        self.push(SinkEvent::Progress(*progress));
    }

    fn on_summary(&self, summary: &Summary) {
        self.push(SinkEvent::Summary(summary.clone()));
    }
}

pub fn codes(list: &[&str]) -> Vec<String> {
    list.iter().map(|code| code.to_string()).collect()
}

/// presses 为 (tMs, 键码, holdMs)
pub fn execution_with(
    presses: &[(f64, &[&str], f64)],
    params: ExecutionParams,
) -> Arc<ExecutionTimeline> {
    let timeline = KeyTimeline {
        instrument_id: "windsong-lyre".to_string(),
        duration_ms: 0.0,
        min_repeat_gap_ms: 40.0,
        presses: presses
            .iter()
            .map(|(t_ms, keys, hold_ms)| Press {
                t_ms: *t_ms,
                codes: codes(keys),
                hold_ms: *hold_ms,
            })
            .collect(),
    };
    Arc::new(build_execution(&timeline, &params).expect("测试时间线应当合法"))
}

pub fn execution(presses: &[(f64, &[&str], f64)]) -> Arc<ExecutionTimeline> {
    execution_with(presses, ExecutionParams::default())
}
