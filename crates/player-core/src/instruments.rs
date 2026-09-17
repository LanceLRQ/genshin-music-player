//! 内置乐器的最小结构：只读取生成测试样例需要的 id、名称、键位与计时参数。
//! 完整的乐器配置校验在前端（zod）完成。

use std::sync::OnceLock;

use serde::Deserialize;

const BUILTIN_SOURCES: [&str; 5] = [
    include_str!("../../../shared/instruments/windsong-lyre.json"),
    include_str!("../../../shared/instruments/floral-zither.json"),
    include_str!("../../../shared/instruments/vintage-lyre.json"),
    include_str!("../../../shared/instruments/two-row-prototype.json"),
    include_str!("../../../shared/instruments/festive-drum.json"),
];

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstrumentLayout {
    pub id: String,
    pub name: String,
    pub rows: Vec<InstrumentRow>,
    pub timing: InstrumentTiming,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstrumentRow {
    pub label: String,
    pub keys: Vec<InstrumentKey>,
}

/// 音高类乐器有 pitch；敲击类乐器没有（它们用 voice，这里不需要）
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstrumentKey {
    pub code: String,
    pub pitch: Option<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstrumentTiming {
    pub hold_ms: f64,
    pub min_repeat_gap_ms: f64,
}

/// 按固定顺序返回 5 个内置乐器
pub fn builtin_instruments() -> &'static [InstrumentLayout] {
    static BUILTIN: OnceLock<Vec<InstrumentLayout>> = OnceLock::new();
    BUILTIN.get_or_init(|| {
        BUILTIN_SOURCES
            .iter()
            .map(|source| {
                serde_json::from_str(source).expect("shared/instruments 中的乐器配置格式错误")
            })
            .collect()
    })
}

pub fn builtin_instrument_ids() -> Vec<&'static str> {
    builtin_instruments()
        .iter()
        .map(|layout| layout.id.as_str())
        .collect()
}

pub fn is_builtin_instrument_id(id: &str) -> bool {
    builtin_instruments().iter().any(|layout| layout.id == id)
}

pub fn find_builtin_instrument(id: &str) -> Option<&'static InstrumentLayout> {
    builtin_instruments().iter().find(|layout| layout.id == id)
}
