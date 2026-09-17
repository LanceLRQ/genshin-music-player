//! 应用数据目录与自定义乐器文件的读写。乐器配置的完整校验在前端（zod）完成，这里只做保存所需的最小检查。

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use player_core::instruments::is_builtin_instrument_id;
use serde::Serialize;
use serde_json::Value;

use crate::error::AppError;

/// 自定义乐器配置文件的版本
pub const INSTRUMENT_SCHEMA_VERSION: u64 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppPaths {
    pub data_dir: PathBuf,
    /// `<data_dir>/instruments`，每个自定义乐器一个 `<id>.json`
    pub instruments_dir: PathBuf,
    /// `<data_dir>/logs`，执行日志目录
    pub logs_dir: PathBuf,
    /// `<data_dir>/settings.json`
    pub settings_file: PathBuf,
}

impl AppPaths {
    pub fn new(data_dir: impl Into<PathBuf>) -> Self {
        let data_dir = data_dir.into();
        Self {
            instruments_dir: data_dir.join("instruments"),
            logs_dir: data_dir.join("logs"),
            settings_file: data_dir.join("settings.json"),
            data_dir,
        }
    }
}

/// `list_custom_instruments` 的返回值：profiles 是未经校验的原始 JSON
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomInstrumentList {
    pub profiles: Vec<Value>,
    pub warnings: Vec<String>,
}

/// 先写同目录下的临时文件再重命名，避免写到一半时留下损坏的文件
pub fn write_atomic(path: &Path, contents: &[u8]) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut temp_name = path.file_name().unwrap_or_default().to_os_string();
    temp_name.push(".tmp");
    let temp_path = path.with_file_name(temp_name);
    fs::write(&temp_path, contents)?;
    fs::rename(&temp_path, path).inspect_err(|_| {
        let _ = fs::remove_file(&temp_path);
    })
}

/// 读取目录中所有 `.json` 文件（按文件名排序）；目录不存在时返回空列表。
/// 读不了或不是 JSON 的文件跳过，并写入 warnings。
pub fn list_custom_instruments(dir: &Path) -> CustomInstrumentList {
    let mut list = CustomInstrumentList {
        profiles: Vec::new(),
        warnings: Vec::new(),
    };
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return list,
        Err(error) => {
            list.warnings
                .push(format!("无法读取自定义乐器目录：{error}"));
            return list;
        }
    };
    let mut paths: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.is_file() && path.extension().is_some_and(|ext| ext == "json"))
        .collect();
    paths.sort();
    for path in paths {
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        let text = match fs::read_to_string(&path) {
            Ok(text) => text,
            Err(error) => {
                list.warnings
                    .push(format!("无法读取自定义乐器文件「{name}」：{error}"));
                continue;
            }
        };
        match serde_json::from_str::<Value>(&text) {
            Ok(profile) => list.profiles.push(profile),
            Err(error) => list
                .warnings
                .push(format!("自定义乐器文件「{name}」不是有效的 JSON：{error}")),
        }
    }
    list
}

/// id 只能由小写字母和数字组成，用单个连字符分隔（与前端 zod 规则 `^[a-z0-9]+(-[a-z0-9]+)*$` 一致）
pub fn is_valid_instrument_id(id: &str) -> bool {
    !id.is_empty()
        && id.split('-').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        })
}

fn check_instrument_id(id: &str) -> Result<(), AppError> {
    if is_valid_instrument_id(id) {
        Ok(())
    } else {
        Err(AppError::instrument_invalid(
            "乐器 id 只能包含小写字母、数字和连字符",
        ))
    }
}

/// 保存前的最小检查：是对象、schemaVersion 为 1、id 格式正确且不是内置乐器的 id。返回 id。
pub fn validate_custom_instrument(profile: &Value) -> Result<&str, AppError> {
    let Some(object) = profile.as_object() else {
        return Err(AppError::instrument_invalid("乐器配置必须是 JSON 对象"));
    };
    if object.get("schemaVersion").and_then(Value::as_u64) != Some(INSTRUMENT_SCHEMA_VERSION) {
        return Err(AppError::instrument_invalid(
            "不支持的乐器配置版本，schemaVersion 必须为 1",
        ));
    }
    let Some(id) = object.get("id").and_then(Value::as_str) else {
        return Err(AppError::instrument_invalid("乐器配置缺少 id"));
    };
    check_instrument_id(id)?;
    if is_builtin_instrument_id(id) {
        return Err(AppError::instrument_id_conflict(id));
    }
    Ok(id)
}

/// 写入 `<dir>/<id>.json`；同 id 直接覆盖（是否确认覆盖由前端负责）
pub fn save_custom_instrument(dir: &Path, profile: &Value) -> Result<(), AppError> {
    let id = validate_custom_instrument(profile)?;
    let mut json = serde_json::to_string_pretty(profile).map_err(AppError::storage_io)?;
    json.push('\n');
    write_atomic(&dir.join(format!("{id}.json")), json.as_bytes()).map_err(AppError::storage_io)
}

/// 删除 `<dir>/<id>.json`；先检查 id 格式，避免拼出目录之外的路径
pub fn delete_custom_instrument(dir: &Path, id: &str) -> Result<(), AppError> {
    check_instrument_id(id)?;
    match fs::remove_file(dir.join(format!("{id}.json"))) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            Err(AppError::instrument_not_found(id))
        }
        Err(error) => Err(AppError::storage_io(error)),
    }
}
