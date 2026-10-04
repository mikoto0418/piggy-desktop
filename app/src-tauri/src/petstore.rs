//! 宠物存档读写。
//!
//! 设计要点：
//! - **原子写入**：临时文件 + `sync_all` + `rename`，避免半截文件把存档写坏。
//! - **损坏兜底**：`pet.json` 解析失败时回退到 `pet.json.bak`（上一次有效存档），
//!   两者都坏才返回 `None`（前端会重新 `adopt()` 一只新猪）。
//! - 存档是**纯 JSON**，不解析具体字段 —— 领域模型在 JS 侧的 `core/` 里，
//!   Rust 只当搬运工，这样以后升 `STATE_VERSION` 不用改 Rust。

use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

pub fn pet_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("pet.json")
}

fn backup_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("pet.json.bak")
}

/// 读取存档。`pet.json` 坏了就退到 `.bak`；都坏/都不存在返回 `None`。
pub fn load(app_data_dir: &Path) -> Option<Value> {
    let main = pet_path(app_data_dir);
    match read_json(&main) {
        Some(v) => Some(v),
        None => {
            if main.exists() {
                crate::config::log("pet.json 无法解析，尝试回退到 pet.json.bak");
            }
            let bak = backup_path(app_data_dir);
            match read_json(&bak) {
                Some(v) => {
                    crate::config::log("已从 pet.json.bak 恢复存档");
                    Some(v)
                }
                None => None,
            }
        }
    }
}

fn read_json(path: &Path) -> Option<Value> {
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str::<Value>(&text).ok()
}

/// 原子保存。写入前先把当前有效存档复制成 `.bak`。
pub fn save(app_data_dir: &Path, state: &Value) -> Result<(), String> {
    fs::create_dir_all(app_data_dir).map_err(|e| e.to_string())?;
    let main = pet_path(app_data_dir);
    let bak = backup_path(app_data_dir);

    // 先把现有的好存档留一份备份
    if main.exists() {
        let _ = fs::copy(&main, &bak);
    }

    let text = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    let tmp = app_data_dir.join("pet.json.tmp");
    {
        use std::io::Write;
        let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        f.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, &main).map_err(|e| e.to_string())?;
    Ok(())
}
