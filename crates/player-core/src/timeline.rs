//! KeyTimeline 校验与执行时间线生成（纯函数）。长音模式下同键相邻两次按下的
//! 提前松开量由 `KeyTimeline.release_gap_ms` 控制（未设置时退化为 1ms），
//! 循环回卷衔接处同样适用，详见 `resolve_conflicts` / `resolve_loop_wrap`。

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
    if let Some(release_gap_ms) = timeline.release_gap_ms
        && !(release_gap_ms.is_finite() && release_gap_ms >= 0.0)
    {
        return Err(CoreError::timeline_invalid("松开间隔必须大于等于 0"));
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
    let (mut notes, mut dropped) = resolve_conflicts(
        &presses,
        timeline.min_repeat_gap_ms,
        timeline.release_gap_ms,
    );
    // 循环周期在回卷截短之前就固定下来：回卷会截短部分音符的松开时间，如果截短后
    // 从事件重新算周期，会把回卷时刚补出来的松开间隔又吃回去（截短用的 period_ms
    // 变小，松开时间又被下一次按下追上）。duration_ms 只算这一次，events 单独用
    // 截短后的 notes 重新生成（必须重新算，反映截短后的真实 up 时间）
    let duration_ms = execution_duration_ms(&to_events(&notes), params);
    // 循环回卷衔接的过密检查放在轮内冲突解决之后：轮内过滤看不到「下一轮」，
    // 回卷衔接是唯一绕过 min_repeat_gap 的路径（M2 遗留 7.7）。周期取调度器将采用
    // 的循环周期（durationMs，含区间尾部休止，已是执行时间线时间），只在 looped 生效
    if params.range.looped && !notes.is_empty() {
        dropped += resolve_loop_wrap(
            &mut notes,
            duration_ms,
            timeline.min_repeat_gap_ms,
            timeline.release_gap_ms,
        );
    }
    let events = to_events(&notes);

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
    /// 提前松开时不能短于的下限：press 原始的 hold_ms，不随 sustain 放大、也不随速度缩放
    min_hold_ms: f64,
}

struct KeyNote<'a> {
    code: &'a str,
    down_ms: f64,
    up_ms: f64,
    min_hold_ms: f64,
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
            min_hold_ms: press.hold_ms,
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
    release_gap_ms: Option<f64>,
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
                // 提前量默认取 release_gap_ms（长音模式），未设置时退化为旧行为的 1ms；
                // 但不能把按住时长压缩到原始 hold_ms 以下，也永远不能晚于下一次按下前 1ms
                let lead = release_gap_ms
                    .unwrap_or(RELEASE_LEAD_MS)
                    .max(RELEASE_LEAD_MS);
                let latest_up = (press.t_ms - lead)
                    .max(note.down_ms + note.min_hold_ms)
                    .min(press.t_ms - RELEASE_LEAD_MS);
                if note.up_ms > latest_up {
                    note.up_ms = latest_up;
                }
            }
            last_note.insert(code.as_str(), notes.len());
            notes.push(KeyNote {
                code,
                down_ms: press.t_ms,
                up_ms: press.t_ms + press.hold_ms,
                min_hold_ms: press.min_hold_ms,
            });
        }
    }
    (notes, dropped)
}

/// 循环回卷衔接：把「下一轮开头」视作时间线末尾之后的下一次按下，对每个键
/// 套用与轮内一致的 min_repeat_gap 约束——回卷间隔等于循环周期减去该键末次
/// 按下、加上该键下次按下的时刻。过密时丢弃下一轮的首按；时间线每一轮共用
/// 同一份事件，丢弃即从时间线里去掉该键的首按，并计入 dropped。
///
/// 丢弃判断结束后，再对每个键本轮最后一个音符按 release_gap_ms 提前松开
/// （公式与 resolve_conflicts 一致，下一次按下换成「下一轮开头该键的按下时刻」），
/// 保证长音模式下回卷衔接处也不会因松开太晚而被游戏漏读。
fn resolve_loop_wrap<'a>(
    notes: &mut Vec<KeyNote<'a>>,
    period_ms: f64,
    min_repeat_gap_ms: f64,
    release_gap_ms: Option<f64>,
) -> u32 {
    let min_gap = min_repeat_gap_ms.max(MIN_REPEAT_GAP_FLOOR_MS);
    // notes 按按下时间有序：先收集每个键的按下位置，末位即该键本轮末按
    let mut positions: HashMap<&str, Vec<usize>> = HashMap::new();
    for (index, note) in notes.iter().enumerate() {
        positions.entry(note.code).or_default().push(index);
    }
    let mut drop_indices: Vec<usize> = Vec::new();
    // (本轮最后一个音符的下标, 下一轮开头该键按下的绝对时间)；先只读收集，
    // 避免在同一循环里既读 notes[...] 又对 notes 做可变借用
    let mut truncations: Vec<(usize, f64)> = Vec::new();
    for note_positions in positions.values() {
        let last_index = note_positions[note_positions.len() - 1];
        let last_down = notes[last_index].down_ms;
        let mut retained_first_down = last_down;
        for &index in note_positions {
            // 首按被丢后，下一次按下成为新的回卷首按，继续检查直到间隔达标
            if period_ms - last_down + notes[index].down_ms >= min_gap {
                retained_first_down = notes[index].down_ms;
                break;
            }
            drop_indices.push(index);
        }
        truncations.push((last_index, period_ms + retained_first_down));
    }
    for (index, next_down) in truncations {
        let note = &mut notes[index];
        let lead = release_gap_ms
            .unwrap_or(RELEASE_LEAD_MS)
            .max(RELEASE_LEAD_MS);
        let latest_up = (next_down - lead)
            .max(note.down_ms + note.min_hold_ms)
            .min(next_down - RELEASE_LEAD_MS);
        if note.up_ms > latest_up {
            note.up_ms = latest_up;
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
