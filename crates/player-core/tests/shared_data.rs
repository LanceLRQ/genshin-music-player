use std::collections::HashSet;

use player_core::error::ErrorCode;
use player_core::instruments::{
    builtin_instrument_ids, builtin_instruments, find_builtin_instrument, is_builtin_instrument_id,
};
use player_core::keymap::{KeyInfo, all_keys, key_info, resolve_key};

#[test]
fn keymap_codes_and_scans_are_unique() {
    let keys = all_keys();
    assert_eq!(keys.len(), 60);
    let codes: HashSet<_> = keys.iter().map(|key| key.code).collect();
    let scans: HashSet<_> = keys.iter().map(|key| key.scan).collect();
    assert_eq!(codes.len(), keys.len());
    assert_eq!(scans.len(), keys.len());
}

#[test]
fn keymap_uses_set1_scan_codes() {
    let scan = |code: &str| key_info(code).map(|key| key.scan);
    assert_eq!(scan("KeyQ"), Some(0x10));
    assert_eq!(scan("KeyA"), Some(0x1e));
    assert_eq!(scan("KeyZ"), Some(0x2c));
    assert_eq!(scan("Space"), Some(0x39));
    assert_eq!(scan("F9"), Some(0x43));
    assert_eq!(scan("F12"), Some(0x58));
    assert_eq!(
        key_info("KeyN"),
        Some(KeyInfo {
            code: "KeyN",
            scan: 49,
            extended: false,
        })
    );
}

#[test]
fn resolve_key_reports_unknown_code() {
    assert_eq!(resolve_key("KeyQ").unwrap().scan, 16);
    let error = resolve_key("KeyFoo").unwrap_err();
    assert_eq!(error.code, ErrorCode::UnknownKeyCode);
    assert_eq!(error.message, "未知键码「KeyFoo」");
}

#[test]
fn builtin_instruments_are_listed_in_fixed_order() {
    assert_eq!(
        builtin_instrument_ids(),
        vec![
            "windsong-lyre",
            "floral-zither",
            "vintage-lyre",
            "two-row-prototype",
            "festive-drum",
        ]
    );
    assert!(is_builtin_instrument_id("festive-drum"));
    assert!(!is_builtin_instrument_id("my-lyre"));
}

#[test]
fn every_builtin_instrument_key_is_in_keymap() {
    for layout in builtin_instruments() {
        for row in &layout.rows {
            for key in &row.keys {
                assert!(
                    key_info(&key.code).is_some(),
                    "{} 的键码 {} 不在键码表中",
                    layout.id,
                    key.code
                );
            }
        }
    }
}

#[test]
fn builtin_layouts_keep_rows_pitches_and_timing() {
    let lyre = find_builtin_instrument("windsong-lyre").unwrap();
    assert_eq!(lyre.name, "风物之诗琴");
    assert_eq!(lyre.rows.len(), 3);
    assert!(lyre.rows.iter().all(|row| row.keys.len() == 7));
    assert_eq!(lyre.rows[0].keys[0].code, "KeyQ");
    assert_eq!(lyre.rows[0].keys[0].pitch, Some(72));
    assert_eq!(lyre.timing.hold_ms, 30.0);
    assert_eq!(lyre.timing.min_repeat_gap_ms, 40.0);

    let two_row = find_builtin_instrument("two-row-prototype").unwrap();
    assert_eq!(two_row.rows[1].keys[5].code, "KeyN");

    let drum = find_builtin_instrument("festive-drum").unwrap();
    assert_eq!(drum.rows[0].keys[0].code, "KeyF");
    assert_eq!(drum.rows[0].keys[0].pitch, None);
    assert!(find_builtin_instrument("nope").is_none());
}
