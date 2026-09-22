//! KeyTimeline 校验与执行时间线生成（纯函数）。

use std::collections::{BTreeMap, HashMap, HashSet};

use rand::{RngExt, SeedableRng};
use rand_chacha::ChaCha8Rng;

use crate::error::CoreError;
use crate::keymap::key_info;
use crate::model::{ExecutionParams, ExecutionTimeline, KeyTimeline, TimelineEvent};

pub const MIN_SPEED: f64 = 0.5;
pub const MAX_SPEED: f64 = 2.0;
pub const MAX_JITTER_MS: f64 = 30.0;
/// 同键最小间隔的下限，保证提前后的松开时间严格落在两次按下之间
pub const MIN_REPEAT_GAP_FLOOR_MS: f64 = 2.0;
/// 同键冲突时，上一次的松开时间最晚提前到下一次按下前 1ms
pub const RELEASE_LEAD_MS: f64 = 1.0;

pub fn validate_timeline(timeline: &KeyTimeline) -> Result<(), CoreError> {
    let mut previous_ms = 0.0;
    for (index, press) in timeline.presses.iter().enumerate() {
        let number = index + 1;
        if !press.t_ms.is_finite() || press.t_ms < 0.0 {
            return Err(CoreError::timeline_invalid(format!(
                "第 {number} 个按键的时间无效"
            )));
        }
        if press.t_ms < previous_ms {
            return Err(CoreError::timeline_invalid(format!(
                "第 {number} 个按键的时间早于上一个按键"
            )));
        }
        previous_ms = press.t_ms;
        if !(press.hold_ms.is_finite() && press.hold_ms > 0.0) {
            return Err(CoreError::timeline_invalid(format!(
                "第 {number} 个按键的按住时长必须大于 0"
            )));
        }
        if let Some(sustain_ms) = press.sustain_ms {
            if !(sustain_ms.is_finite() && sustain_ms > 0.0) {
                return Err(CoreError::timeline_invalid(format!(
                    "第 {number} 个按键的按住音长必须大于 0"
                )));
            }
        }
        if press.codes.is_empty() {
            return Err(CoreError::timeline_invalid(format!(
                "第 {number} 个按键没有键码"
            )));
        }
        let mut seen = HashSet::new();
        for code in &press.codes {
            if !seen.insert(code.as_str()) {
                return Err(CoreError::timeline_invalid(format!(
                    "第 {number} 个按键包含重复的键码「{code}」"
                )));
            }
            if key_info(code).is_none() {
                return Err(CoreError::unknown_key_code(code));
            }
        }
    }
    Ok(())
}

pub fn validate_params(params: &ExecutionParams) -> Result<(), CoreError> {
    if !(MIN_SPEED..=MAX_SPEED).contains(&params.speed) {
        return Err(CoreError::params_invalid("速度必须在 0.5–2.0 之间"));
    }
    if !(0.0..=MAX_JITTER_MS).contains(&params.humanize.max_jitter_ms) {
        return Err(CoreError::params_invalid(
            "节奏人性化偏移必须在 0–30ms 之间",
        ));
    }
    let range = params.range;
    if !(range.start_ms.is_finite() && range.start_ms >= 0.0 && range.end_ms > range.start_ms) {
        return Err(CoreError::params_invalid(
            "播放区间无效：起点不能小于 0，终点必须大于起点",
        ));
    }
    Ok(())
}

/// 截取 → 变速 → 人性化 → 重新排序 → 同键冲突 → 拆成事件 → 计算时长
pub fn build_execution(
    timeline: &KeyTimeline,
    params: &ExecutionParams,
) -> Result<ExecutionTimeline, CoreError> {
    validate_timeline(timeline)?;
    validate_params(params)?;

    let mut presses = slice_and_scale(timeline, params);
    apply_humanize(&mut presses, params);
    presses.sort_by(|a, b| a.t_ms.total_cmp(&b.t_ms));
    let (mut notes, mut dropped) = resolve_conflicts(&presses, timeline.min_repeat_gap_ms);
    // 循环回卷衔接的过密检查放在轮内冲突解决之后：轮内过滤看不到「下一轮」，
    // 回卷衔接是唯一绕过 min_repeat_gap 的路径（M2 遗留 7.7）。周期取调度器将采用
    // 的循环周期（durationMs，含区间尾部休止，已是执行时间线时间），只在 looped 生效
    if params.range.looped && !notes.is_empty() {
        let period_ms = execution_duration_ms(&to_events(&notes), params);
        dropped += resolve_loop_wrap(&mut notes, period_ms, timeline.min_repeat_gap_ms);
    }
    let events = to_events(&notes);
    let duration_ms = execution_duration_ms(&events, params);

    Ok(ExecutionTimeline {
        instrument_id: timeline.instrument_id.clone(),
        events,
        duration_ms,
        source_start_ms: params.range.start_ms,
        speed: params.speed,
        looped: params.range.looped,
        dropped,
    })
}

struct ScheduledPress<'a> {
    t_ms: f64,
    codes: &'a [String],
    hold_ms: f64,
}

struct KeyNote<'a> {
    code: &'a str,
    down_ms: f64,
    up_ms: f64,
}

fn slice_and_scale<'a>(
    timeline: &'a KeyTimeline,
    params: &ExecutionParams,
) -> Vec<ScheduledPress<'a>> {
    let range = params.range;
    timeline
        .presses
        .iter()
        .filter(|press| press.t_ms >= range.start_ms && press.t_ms < range.end_ms)
        .map(|press| ScheduledPress {
            t_ms: (press.t_ms - range.start_ms) / params.speed,
            codes: &press.codes,
            // 点按（无 sustain_ms）按住时长不随变速缩放；需要按音长按住时，
            // 目标音长按速度换算后与 hold_ms 取较大值，保证仍不短于游戏识别按键的物理下限
            hold_ms: match press.sustain_ms {
                Some(sustain_ms) => press.hold_ms.max(sustain_ms / params.speed),
                None => press.hold_ms,
            },
        })
        .collect()
}

/// 和弦内的键共用同一个偏移；偏移后小于 0 时取 0
fn apply_humanize(presses: &mut [ScheduledPress<'_>], params: &ExecutionParams) {
    let jitter = params.humanize.max_jitter_ms;
    if jitter <= 0.0 {
        return;
    }
    let mut rng = ChaCha8Rng::seed_from_u64(params.humanize.seed);
    for press in presses {
        let offset: f64 = rng.random_range(-jitter..=jitter);
        press.t_ms = (press.t_ms + offset).max(0.0);
    }
}

fn resolve_conflicts<'a>(
    presses: &[ScheduledPress<'a>],
    min_repeat_gap_ms: f64,
) -> (Vec<KeyNote<'a>>, u32) {
    let min_gap = min_repeat_gap_ms.max(MIN_REPEAT_GAP_FLOOR_MS);
    let mut notes: Vec<KeyNote<'a>> = Vec::new();
    let mut last_note: HashMap<&'a str, usize> = HashMap::new();
    let mut dropped = 0;
    for press in presses {
        for code in press.codes {
            if let Some(&previous) = last_note.get(code.as_str()) {
                let note = &mut notes[previous];
                if press.t_ms - note.down_ms < min_gap {
                    dropped += 1;
                    continue;
                }
                let latest_up = press.t_ms - RELEASE_LEAD_MS;
                if note.up_ms > latest_up {
                    note.up_ms = latest_up;
                }
            }
            last_note.insert(code.as_str(), notes.len());
            notes.push(KeyNote {
                code,
                down_ms: press.t_ms,
                up_ms: press.t_ms + press.hold_ms,
            });
        }
    }
    (notes, dropped)
}

/// 循环回卷衔接：把「下一轮开头」视作时间线末尾之后的下一次按下，对每个键
/// 套用与轮内一致的 min_repeat_gap 约束——回卷间隔 = 循环周期 − 该键末次按下
/// + 该键下次按下。过密时丢弃下一轮的首按；时间线每一轮共用同一份事件，
/// 丢弃即从时间线里去掉该键的首按，并计入 dropped。
/// 不需要为回卷补提前松开：循环周期 ≥ 最后一个事件的时间，末次松开必然
/// 先于（至多重合于）下一轮同键的按下。
fn resolve_loop_wrap<'a>(
    notes: &mut Vec<KeyNote<'a>>,
    period_ms: f64,
    min_repeat_gap_ms: f64,
) -> u32 {
    let min_gap = min_repeat_gap_ms.max(MIN_REPEAT_GAP_FLOOR_MS);
    // notes 按按下时间有序：先收集每个键的按下位置，末位即该键本轮末按
    let mut positions: HashMap<&str, Vec<usize>> = HashMap::new();
    for (index, note) in notes.iter().enumerate() {
        positions.entry(note.code).or_default().push(index);
    }
    let mut drop_indices: Vec<usize> = Vec::new();
    for note_positions in positions.values() {
        let last_down = notes[note_positions[note_positions.len() - 1]].down_ms;
        for &index in note_positions {
            // 首按被丢后，下一次按下成为新的回卷首按，继续检查直到间隔达标
            if period_ms - last_down + notes[index].down_ms >= min_gap {
                break;
            }
            drop_indices.push(index);
        }
    }
    let dropped = drop_indices.len() as u32;
    // 按下标从大到小移除，保持其余音符的相对顺序
    drop_indices.sort_unstable_by(|a, b| b.cmp(a));
    for index in drop_indices {
        notes.remove(index);
    }
    dropped
}

#[derive(Default)]
struct EventSlot {
    up: Vec<String>,
    down: Vec<String>,
}

/// 时间四舍五入到 0.01ms（以整数表示，避免浮点比较），同一时刻合并为一个事件
fn to_events(notes: &[KeyNote<'_>]) -> Vec<TimelineEvent> {
    let mut slots: BTreeMap<i64, EventSlot> = BTreeMap::new();
    for note in notes {
        let down = hundredths(note.down_ms);
        // 按住时长极短时，保证松开至少比按下晚 0.01ms
        let up = hundredths(note.up_ms).max(down + 1);
        slots
            .entry(down)
            .or_default()
            .down
            .push(note.code.to_string());
        slots.entry(up).or_default().up.push(note.code.to_string());
    }
    slots
        .into_iter()
        .map(|(time, slot)| TimelineEvent {
            t_ms: time as f64 / 100.0,
            up: slot.up,
            down: slot.down,
        })
        .collect()
}

/// 空时间线为 0；否则取最后一个事件的时间，区间终点有限时至少为区间长度 / speed（保留尾部休止，循环周期才正确）
fn execution_duration_ms(events: &[TimelineEvent], params: &ExecutionParams) -> f64 {
    let Some(last) = events.last() else {
        return 0.0;
    };
    let range = params.range;
    if range.end_ms.is_finite() {
        let range_ms = hundredths((range.end_ms - range.start_ms) / params.speed) as f64 / 100.0;
        last.t_ms.max(range_ms)
    } else {
        last.t_ms
    }
}

fn hundredths(ms: f64) -> i64 {
    (ms * 100.0).round() as i64
}
