//! 测试样例生成：都生成 KeyTimeline，与前端适配结果的格式相同。

use std::fs;
use std::path::Path;

use clap::ValueEnum;
use player_core::instruments::{InstrumentKey, InstrumentLayout, find_builtin_instrument};
use player_core::model::{KeyTimeline, Press};

pub const SCALE_INTERVAL_MS: f64 = 300.0;
pub const CHORD_INTERVAL_MS: f64 = 600.0;
pub const REPEAT_INTERVALS_MS: [f64; 9] = [200.0, 150.0, 100.0, 80.0, 60.0, 50.0, 40.0, 30.0, 20.0];
pub const REPEAT_HITS_PER_INTERVAL: usize = 5;
pub const REPEAT_REST_MS: f64 = 500.0;
pub const LONG_INTERVAL_MS: f64 = 150.0;
pub const LONG_TOTAL_MS: f64 = 300_000.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum PatternKind {
    /// 按行、按键顺序逐个弹奏，间隔 300ms
    Scale,
    /// 每一行作为一个和弦弹一次，最后所有行的第一个键一起弹，间隔 600ms
    Chord,
    /// 中间一行的第一个键连打，间隔逐档缩短
    Repeat,
    /// 全部键先升序再降序循环，每 150ms 一个，共 300 秒
    Long,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PatternOptions {
    pub hold_ms: f64,
    pub min_repeat_gap_ms: f64,
}

/// 参数是内置乐器 id 时直接使用，否则当作乐器配置 JSON 文件路径读取
pub fn load_instrument(arg: &str) -> Result<InstrumentLayout, String> {
    if let Some(layout) = find_builtin_instrument(arg) {
        return Ok(layout.clone());
    }
    let path = Path::new(arg);
    let text = fs::read_to_string(path)
        .map_err(|error| format!("「{arg}」不是内置乐器 id，也无法作为文件读取：{error}"))?;
    let layout: InstrumentLayout = serde_json::from_str(&text)
        .map_err(|error| format!("乐器配置格式错误（{arg}）：{error}"))?;
    if layout.rows.iter().all(|row| row.keys.is_empty()) {
        return Err(format!("乐器「{}」没有任何按键", layout.name));
    }
    Ok(layout)
}

/// 乐器没有任何按键时生成空时间线
pub fn generate(
    kind: PatternKind,
    layout: &InstrumentLayout,
    options: PatternOptions,
) -> KeyTimeline {
    let presses = if layout.rows.iter().all(|row| row.keys.is_empty()) {
        Vec::new()
    } else {
        match kind {
            PatternKind::Scale => scale(layout, options),
            PatternKind::Chord => chord(layout, options),
            PatternKind::Repeat => repeat(layout, options),
            PatternKind::Long => long(layout, options),
        }
    };
    let duration_ms = presses
        .last()
        .map_or(0.0, |press| press.t_ms + press.hold_ms);
    KeyTimeline {
        instrument_id: layout.id.clone(),
        duration_ms,
        min_repeat_gap_ms: options.min_repeat_gap_ms,
        presses,
    }
}

fn press(t_ms: f64, codes: Vec<String>, options: PatternOptions) -> Press {
    Press {
        t_ms,
        codes,
        hold_ms: options.hold_ms,
        sustain_ms: None,
    }
}

fn scale(layout: &InstrumentLayout, options: PatternOptions) -> Vec<Press> {
    layout
        .rows
        .iter()
        .flat_map(|row| row.keys.iter())
        .enumerate()
        .map(|(i, key)| {
            press(
                i as f64 * SCALE_INTERVAL_MS,
                vec![key.code.clone()],
                options,
            )
        })
        .collect()
}

fn chord(layout: &InstrumentLayout, options: PatternOptions) -> Vec<Press> {
    let rows: Vec<_> = layout
        .rows
        .iter()
        .filter(|row| !row.keys.is_empty())
        .collect();
    let mut presses: Vec<Press> = rows
        .iter()
        .enumerate()
        .map(|(i, row)| {
            let codes = row.keys.iter().map(|key| key.code.clone()).collect();
            press(i as f64 * CHORD_INTERVAL_MS, codes, options)
        })
        .collect();
    let firsts = rows.iter().map(|row| row.keys[0].code.clone()).collect();
    presses.push(press(
        rows.len() as f64 * CHORD_INTERVAL_MS,
        firsts,
        options,
    ));
    presses
}

/// 中间一行取下标 rows.len() / 2（3 行取第 2 行，2 行取第 2 行，1 行取第 1 行）
fn repeat(layout: &InstrumentLayout, options: PatternOptions) -> Vec<Press> {
    let rows: Vec<_> = layout
        .rows
        .iter()
        .filter(|row| !row.keys.is_empty())
        .collect();
    let code = rows[rows.len() / 2].keys[0].code.clone();
    let mut presses = Vec::new();
    let mut t_ms = 0.0;
    for (tier, interval) in REPEAT_INTERVALS_MS.iter().enumerate() {
        if tier > 0 {
            t_ms += REPEAT_REST_MS;
        }
        for hit in 0..REPEAT_HITS_PER_INTERVAL {
            if hit > 0 {
                t_ms += interval;
            }
            presses.push(press(t_ms, vec![code.clone()], options));
        }
    }
    presses
}

/// 音高类乐器按音高升序，敲击类乐器按配置中的顺序；然后降序返回（不重复两端），如此循环
fn long(layout: &InstrumentLayout, options: PatternOptions) -> Vec<Press> {
    let mut keys: Vec<&InstrumentKey> =
        layout.rows.iter().flat_map(|row| row.keys.iter()).collect();
    if keys.iter().all(|key| key.pitch.is_some()) {
        keys.sort_by_key(|key| key.pitch);
    }
    let mut cycle = keys.clone();
    if keys.len() > 2 {
        cycle.extend(keys[1..keys.len() - 1].iter().rev());
    }
    let count = (LONG_TOTAL_MS / LONG_INTERVAL_MS) as usize;
    (0..count)
        .map(|i| {
            let key = cycle[i % cycle.len()];
            press(i as f64 * LONG_INTERVAL_MS, vec![key.code.clone()], options)
        })
        .collect()
}
