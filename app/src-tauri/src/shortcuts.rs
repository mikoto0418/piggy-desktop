//! 全局快捷键。M4 决策：**可自定义**，默认 `Ctrl+Alt+P` / `Ctrl+Alt+H`。
//!
//! ⚠️ 注册失败（被别的软件占用）**不能静默吞掉** —— 必须记录并告知用户实际冲突的组合键，
//! 否则用户按了没反应会以为是 bug。托盘菜单是最终兜底入口。
//!
//! 实测发现本机 `Ctrl+Alt+P` **已被其他软件占用**，所以这里加了**备选链**：
//! 首选被占用时自动退到下一个可用组合键，并把实际生效的键回报给界面。

use crate::config::ShortcutsConfig;
use std::str::FromStr;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// 切换穿透的备选组合（按顺序尝试）。
const FALLBACK_CLICK_THROUGH: &[&str] = &["Ctrl+Alt+Shift+P", "Ctrl+Shift+F12", "Ctrl+Alt+F9"];
/// 切换显隐的备选组合。
const FALLBACK_VISIBILITY: &[&str] = &["Ctrl+Alt+Shift+H", "Ctrl+Shift+F11", "Ctrl+Alt+F10"];

/// 逐个尝试候选组合，返回实际生效的组合键与需要告知用户的问题。
fn register_one(
    app: &AppHandle,
    primary: &str,
    fallbacks: &[&str],
    on_fire: fn(&AppHandle),
    label: &str,
) -> (Option<String>, Vec<String>) {
    let gs = app.global_shortcut();
    let mut problems = Vec::new();

    let mut candidates: Vec<String> = vec![primary.to_string()];
    candidates.extend(fallbacks.iter().map(|s| (*s).to_string()));

    for (i, cand) in candidates.iter().enumerate() {
        let sc = match Shortcut::from_str(cand) {
            Ok(sc) => sc,
            Err(e) => {
                crate::config::log(&format!("hotkey[{label}] 无法解析 {cand}: {e}"));
                continue;
            }
        };
        match gs.on_shortcut(sc, move |app, _sc, event| {
            if event.state() == ShortcutState::Pressed {
                on_fire(app);
            }
        }) {
            Ok(()) => {
                if i == 0 {
                    crate::config::log(&format!("hotkey[{label}] = {cand}"));
                } else {
                    let msg = format!("「{primary}」已被占用，已自动改用「{cand}」");
                    crate::config::log(&format!("hotkey[{label}] {msg}"));
                    problems.push(msg);
                }
                return (Some(cand.clone()), problems);
            }
            Err(e) => {
                crate::config::log(&format!("hotkey[{label}] {cand} 注册失败: {e}"));
            }
        }
    }

    problems.push(format!(
        "快捷键「{primary}」及其备选全部注册失败，请到设置里改键（托盘菜单仍可切换模式）"
    ));
    (None, problems)
}

/// 注册两个快捷键，返回需要展示给用户的问题列表（空 = 全部按首选生效）。
pub fn register_all(app: &AppHandle, cfg: &ShortcutsConfig) -> Vec<String> {
    let mut problems = Vec::new();

    let (bound_ct, mut p1) = register_one(
        app,
        &cfg.toggle_click_through,
        FALLBACK_CLICK_THROUGH,
        crate::actions::toggle_click_through,
        "toggle-click-through",
    );
    problems.append(&mut p1);

    let (bound_vis, mut p2) = register_one(
        app,
        &cfg.toggle_visibility,
        FALLBACK_VISIBILITY,
        crate::actions::toggle_visibility,
        "toggle-visibility",
    );
    problems.append(&mut p2);

    if let Some(state) = app.try_state::<crate::actions::AppState>() {
        *state.bound_shortcuts.lock().unwrap() = (bound_ct, bound_vis);
    }
    problems
}

/// 改键后重新注册：先全部注销，再按新配置注册。
pub fn reregister(app: &AppHandle, cfg: &ShortcutsConfig) -> Vec<String> {
    let _ = app.global_shortcut().unregister_all();
    let problems = register_all(app, cfg);
    if let Some(state) = app.try_state::<crate::actions::AppState>() {
        *state.shortcut_problems.lock().unwrap() = problems.clone();
    }
    for p in &problems {
        crate::config::log(&format!("SHORTCUT PROBLEM: {p}"));
    }
    crate::actions::broadcast(app);
    problems
}
