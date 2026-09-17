use std::fs;
use std::path::Path;

use genshin_music_player_lib::error::AppErrorCode;
use genshin_music_player_lib::storage::{
    AppPaths, delete_custom_instrument, is_valid_instrument_id, list_custom_instruments,
    save_custom_instrument, validate_custom_instrument, write_atomic,
};
use serde_json::{Value, json};
use tempfile::TempDir;

fn profile(id: &str) -> Value {
    json!({ "schemaVersion": 1, "id": id, "name": "我的诗琴", "rows": [] })
}

fn file_names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

#[test]
fn app_paths_live_under_data_dir() {
    let paths = AppPaths::new("/data");
    assert_eq!(paths.data_dir, Path::new("/data"));
    assert_eq!(paths.instruments_dir, Path::new("/data/instruments"));
    assert_eq!(paths.logs_dir, Path::new("/data/logs"));
    assert_eq!(paths.settings_file, Path::new("/data/settings.json"));
}

#[test]
fn write_atomic_creates_parent_and_replaces_without_leftovers() {
    let temp = TempDir::new().unwrap();
    let path = temp.path().join("nested").join("settings.json");
    write_atomic(&path, b"first").unwrap();
    write_atomic(&path, b"second").unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "second");
    assert_eq!(file_names(path.parent().unwrap()), vec!["settings.json"]);
}

#[test]
fn instrument_id_format() {
    for id in ["my-lyre", "lyre2", "a-1-b"] {
        assert!(is_valid_instrument_id(id), "{id} 应当合法");
    }
    for id in [
        "", "My-Lyre", "my_lyre", "-lyre", "lyre-", "my--lyre", "../lyre", "诗琴",
    ] {
        assert!(!is_valid_instrument_id(id), "{id} 应当不合法");
    }
}

#[test]
fn validate_rejects_invalid_profiles_with_chinese_messages() {
    let cases = [
        (json!([1, 2]), "乐器配置必须是 JSON 对象"),
        (
            json!({ "schemaVersion": 2, "id": "my-lyre" }),
            "不支持的乐器配置版本，schemaVersion 必须为 1",
        ),
        (json!({ "schemaVersion": 1 }), "乐器配置缺少 id"),
        (
            json!({ "schemaVersion": 1, "id": "My Lyre" }),
            "乐器 id 只能包含小写字母、数字和连字符",
        ),
    ];
    for (value, message) in cases {
        let error = validate_custom_instrument(&value).unwrap_err();
        assert_eq!(error.code, AppErrorCode::InstrumentInvalid);
        assert_eq!(error.message, message);
    }
    let conflict = validate_custom_instrument(&profile("windsong-lyre")).unwrap_err();
    assert_eq!(conflict.code, AppErrorCode::InstrumentIdConflict);
    assert_eq!(conflict.message, "「windsong-lyre」是内置乐器的 id");
    assert_eq!(
        validate_custom_instrument(&profile("my-lyre")),
        Ok("my-lyre")
    );
}

#[test]
fn save_writes_pretty_json_and_overwrites_same_id() {
    let temp = TempDir::new().unwrap();
    let dir = temp.path().join("instruments");
    save_custom_instrument(&dir, &profile("my-lyre")).unwrap();
    let mut updated = profile("my-lyre");
    updated["name"] = json!("改过的诗琴");
    save_custom_instrument(&dir, &updated).unwrap();

    assert_eq!(file_names(&dir), vec!["my-lyre.json"]);
    let text = fs::read_to_string(dir.join("my-lyre.json")).unwrap();
    assert!(text.ends_with("}\n"));
    assert_eq!(serde_json::from_str::<Value>(&text).unwrap(), updated);
}

#[test]
fn save_rejects_invalid_profile_without_writing() {
    let temp = TempDir::new().unwrap();
    let dir = temp.path().join("instruments");
    let error = save_custom_instrument(&dir, &profile("windsong-lyre")).unwrap_err();
    assert_eq!(error.code, AppErrorCode::InstrumentIdConflict);
    assert!(!dir.exists());
}

#[test]
fn list_returns_raw_json_sorted_and_skips_bad_files() {
    let temp = TempDir::new().unwrap();
    let dir = temp.path();
    fs::write(dir.join("b-lyre.json"), profile("b-lyre").to_string()).unwrap();
    fs::write(
        dir.join("a-lyre.json"),
        json!({ "anything": true }).to_string(),
    )
    .unwrap();
    fs::write(dir.join("broken.json"), "{ not json").unwrap();
    fs::write(dir.join("notes.txt"), "不是乐器").unwrap();
    fs::write(dir.join("c-lyre.json.tmp"), "{}").unwrap();

    let list = list_custom_instruments(dir);
    assert_eq!(
        list.profiles,
        vec![json!({ "anything": true }), profile("b-lyre")],
        "原样返回 JSON，由前端校验"
    );
    assert_eq!(list.warnings.len(), 1);
    assert!(
        list.warnings[0].starts_with("自定义乐器文件「broken.json」不是有效的 JSON："),
        "{}",
        list.warnings[0]
    );
}

#[test]
fn list_of_missing_dir_is_empty_and_serializes_to_camel_case() {
    let temp = TempDir::new().unwrap();
    let list = list_custom_instruments(&temp.path().join("missing"));
    assert_eq!(
        serde_json::to_value(&list).unwrap(),
        json!({ "profiles": [], "warnings": [] })
    );
}

#[test]
fn delete_removes_file_and_reports_missing_or_invalid_id() {
    let temp = TempDir::new().unwrap();
    let dir = temp.path();
    save_custom_instrument(dir, &profile("my-lyre")).unwrap();
    delete_custom_instrument(dir, "my-lyre").unwrap();
    assert!(file_names(dir).is_empty());

    let missing = delete_custom_instrument(dir, "my-lyre").unwrap_err();
    assert_eq!(missing.code, AppErrorCode::InstrumentNotFound);
    assert_eq!(missing.message, "找不到自定义乐器「my-lyre」");

    let invalid = delete_custom_instrument(dir, "../settings").unwrap_err();
    assert_eq!(invalid.code, AppErrorCode::InstrumentInvalid);
}
