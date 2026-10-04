//! 模式切换动作。快捷键与托盘菜单**共用**同一份逻辑，避免两条路径行为不一致。

use crate::config::Config;
use crate::overlay;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

pub const PET_WINDOW: &str = "pet";
/// 前端监听此事件同步 UI（例如穿透模式下隐藏气泡/HUD）。
pub const EVENT_MODE: &str = "piggy://mode";

pub struct AppState {
    pub config: Mutex<Config>,
    pub config_path: PathBuf,
    /// 快捷键注册问题（冲突/解析失败）。空 = 全部正常。
    pub shortcut_problems: Mutex<Vec<String>>,
    /// **实际生效**的快捷键（可能与配置里的首选不同，因为首选被占用时会退到备选）。
    pub bound_shortcuts: Mutex<(Option<String>, Option<String>)>,
}

impl AppState {
    pub fn new(config: Config, config_path: PathBuf) -> Self {
        Self {
            config: Mutex::new(config),
            config_path,
            shortcut_problems: Mutex::new(Vec::new()),
            bound_shortcuts: Mutex::new((None, None)),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeSnapshot {
    pub click_through: bool,
    pub visible: bool,
    pub maximum_fps: u32,
    /// 悬停让位（P2-6）的四个参数，前端据此算淡出后的不透明度。
    pub hover_through: bool,
    pub hover_through_alpha: u32,
    pub hover_restore_delay_ms: u32,
    pub hover_wake_delay_ms: u32,
    /// 常态不透明度（P2-7，原先只有字段没有实现）。
    pub opacity_percent: u32,
    /// 宠物缩放百分比（P2-7，原先只有字段没有实现）。
    pub scale_percent: u32,
    /// 当前是否正处于「让位」态（淡出 + 穿透）。运行时状态，不持久化。
    pub ghost: bool,
    pub shortcut_problems: Vec<String>,
    /// 实际生效的组合键，供界面显示。
    pub bound_toggle_click_through: Option<String>,
    pub bound_toggle_visibility: Option<String>,
}

/// 当前的「让位」态。由主进程的光标轮询线程写、广播时读。
pub static GHOST: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn pet_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(PET_WINDOW)
}

/// 组装当前模式快照。`get_mode` 命令与 `piggy://mode` 广播**共用这一份**。
///
/// 以前这两条路径各写了一遍字段赋值，加了新字段只改一处就会编译不过
/// （或者更糟：改了两处但语义不一致）。现在只有一个来源。
pub fn mode_snapshot(app: &AppHandle) -> ModeSnapshot {
    let Some(state) = app.try_state::<AppState>() else {
        return ModeSnapshot {
            click_through: false,
            visible: true,
            maximum_fps: 30,
            hover_through: false,
            hover_through_alpha: 35,
            hover_restore_delay_ms: 300,
            hover_wake_delay_ms: 600,
            opacity_percent: 100,
            scale_percent: 100,
            ghost: false,
            shortcut_problems: Vec::new(),
            bound_toggle_click_through: None,
            bound_toggle_visibility: None,
        };
    };
    let cfg = state.config.lock().unwrap().clone();
    let visible = pet_window(app).map(|w| w.is_visible().unwrap_or(true)).unwrap_or(true);
    let shortcut_problems = state.shortcut_problems.lock().unwrap().clone();
    let (bound_ct, bound_vis) = state.bound_shortcuts.lock().unwrap().clone();
    ModeSnapshot {
        click_through: cfg.overlay.click_through,
        visible,
        maximum_fps: cfg.overlay.maximum_fps,
        hover_through: cfg.overlay.hover_through,
        hover_through_alpha: cfg.overlay.hover_through_alpha,
        hover_restore_delay_ms: cfg.overlay.hover_restore_delay_ms,
        hover_wake_delay_ms: cfg.overlay.hover_wake_delay_ms,
        opacity_percent: cfg.overlay.opacity_percent,
        scale_percent: cfg.overlay.scale_percent,
        ghost: GHOST.load(std::sync::atomic::Ordering::SeqCst),
        shortcut_problems,
        bound_toggle_click_through: bound_ct,
        bound_toggle_visibility: bound_vis,
    }
}

/// 把当前模式广播给前端。
pub fn broadcast(app: &AppHandle) {
    let _ = app.emit(EVENT_MODE, mode_snapshot(app));
}

/// 应用穿透模式到窗口，并持久化。
pub fn apply_click_through(app: &AppHandle, on: bool) {
    if let Some(win) = pet_window(app) {
        if let Err(e) = overlay::toggle_click_through(&win, on) {
            crate::config::log(&format!("set_click_through failed: {e}"));
            return;
        }
    }
    if let Some(state) = app.try_state::<AppState>() {
        let mut cfg = state.config.lock().unwrap();
        if cfg.overlay.click_through != on {
            cfg.overlay.click_through = on;
            // 穿透模式是用户意图，**要持久化**（这点与 Bongo Cat 的可见性策略不同）。
            if let Err(e) = cfg.save(&state.config_path) {
                crate::config::log(&format!("config save failed: {e}"));
            }
        }
    }
    broadcast(app);
}

pub fn toggle_click_through(app: &AppHandle) {
    let cur = current_click_through(app);
    apply_click_through(app, !cur);
}

pub fn current_click_through(app: &AppHandle) -> bool {
    app.try_state::<AppState>()
        .map(|s| s.config.lock().unwrap().overlay.click_through)
        .unwrap_or(false)
}

/// 显示/隐藏。显示时**不激活**窗口（`WS_EX_NOACTIVATE` 已保证不抢焦点）。
pub fn toggle_visibility(app: &AppHandle) {
    let Some(win) = pet_window(app) else { return };
    let visible = win.is_visible().unwrap_or(true);
    let next = !visible;
    if next {
        // show() 不会激活窗口，因为已设 WS_EX_NOACTIVATE；仍显式避免 set_focus。
        let _ = win.show();
    } else {
        let _ = win.hide();
    }
    crate::config::log(&format!("visibility -> {next}"));
    broadcast(app);
}

