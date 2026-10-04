//! 设置窗口（P2-5）。
//!
//! ## 为什么是**独立窗口**而不是桌宠窗口里的面板
//!
//! 桌宠窗口是「贴着内容」的 —— 收起态只有 120×120 物理像素，而且
//! `WS_EX_NOACTIVATE` 保证它**永不抢焦点**。这两条都是硬约束，
//! 不能为了塞设置界面去破坏它们。
//!
//! 所以设置是一个**普通窗口**：有标题栏、可缩放、进任务栏、能拿焦点。
//! 它与桌宠窗口唯一的交集是共享 `AppState` 里的那份 `Config`。
//!
//! ## 改一项就落盘
//!
//! `set_config` 收一个**局部补丁**（`serde_json::Value`），递归合并进当前配置，
//! 过一遍 `sanitize()` 夹紧，存盘，然后**把副作用立刻应用**：
//! 改键 → 重新注册；穿透 → 改窗口样式；其余 → 广播给前端。
//! 不要求用户点「保存」，避免「改了没生效」这种最烦人的状态。

use crate::actions::{self, AppState};
use crate::config::{self, Config};
use crate::shortcuts;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const SETTINGS_WINDOW: &str = "settings";

/// 命令入口：托盘菜单和桌宠窗口都用它。
#[tauri::command]
pub fn open_settings(app: AppHandle) -> Result<(), String> {
    open(&app)
}

/// 打开（或聚焦）设置窗口。重复调用不会开出第二个。
pub fn open(app: &AppHandle) -> Result<(), String> {    if let Some(w) = app.get_webview_window(SETTINGS_WINDOW) {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        return Ok(());
    }

    WebviewWindowBuilder::new(app, SETTINGS_WINDOW, WebviewUrl::App("settings.html".into()))
        .title("谷歌猪 · 设置")
        .inner_size(600.0, 680.0)
        .min_inner_size(480.0, 460.0)
        // 🔴 **必须和桌宠窗口传同一份 `additional_browser_args`**。
        //
        // Tauri 每个 app 只建**一个** WebView2 环境，第一个窗口的
        // `additional_browser_args` 会被固化进环境选项。第二个窗口如果传不同的值
        // （或干脆不传，让 Tauri 用它自己的默认值），WebView2 会直接拒绝建 webview：
        //   `HRESULT(0x8007139F)`「组或资源的状态不是执行请求操作的正确状态」
        // 实测就是这个原因 —— 跟「开得太早」无关（延迟 5.4 秒 + 重试 6 次照样失败）。
        .additional_browser_args(crate::WEBVIEW2_ARGS)
        .resizable(true)
        .decorations(true)
        .transparent(false)
        .always_on_top(false)
        .skip_taskbar(false)
        .focused(true)
        .build()
        .map_err(|e| format!("settings window failed: {e}"))?;

    config::log("settings window opened");
    Ok(())
}/// 延迟打开（启动阶段用）。
///
/// 🔴 **启动阶段不能直接开**：WebView2 在第一个 webview 还没完全初始化完时
/// 创建第二个会直接失败，实测报
/// `HRESULT(0x8007139F)`「组或资源的状态不是执行请求操作的正确状态」。
/// 所以退到后台线程等一会儿再开，并重试几次。
/// （托盘菜单那条路径发生在启动之后，不受影响。）
pub fn open_deferred(app: &AppHandle, delay_ms: u64, attempts: u32) {
    let app = app.clone();
    std::thread::spawn(move || {
        for i in 1..=attempts {
            std::thread::sleep(std::time::Duration::from_millis(delay_ms));
            match open(&app) {
                Ok(()) => {
                    // `open()` 自己已经打过日志了，这里不重复打。
                    return;
                }
                Err(e) => {
                    config::log(&format!("open settings attempt {i}/{attempts} failed: {e}"));
                }
            }
        }
        config::log("open settings: 全部重试都失败");
    });
}

/// 递归合并 JSON 对象。数组和标量直接替换。
///
/// 为什么要递归而不是整个替换 `overlay`：设置界面只改一个滑块时，
/// 如果整段替换，用户手写在 `config.json` 里、界面还没暴露的字段
/// （比如以后新增的项）就会被悄悄抹掉。
fn merge(base: &mut serde_json::Value, patch: &serde_json::Value) {
    match (base.as_object_mut(), patch.as_object()) {
        (Some(b), Some(p)) => {
            for (k, v) in p {
                if v.is_object() {
                    merge(b.entry(k.clone()).or_insert_with(|| serde_json::json!({})), v);
                } else {
                    b.insert(k.clone(), v.clone());
                }
            }
        }
        _ => *base = patch.clone(),
    }
}

/// 读出完整配置（设置界面初始化用）。
#[tauri::command]
pub fn get_config(app: AppHandle) -> Result<serde_json::Value, String> {    let state = app.state::<AppState>();
    let cfg = state.config.lock().unwrap().clone();
    serde_json::to_value(&cfg).map_err(|e| e.to_string())
}

/// 应用一个局部补丁：合并 → 夹紧 → 存盘 → **立刻应用副作用**。
///
/// 返回夹紧后的完整配置，界面据此回写控件（例如用户把滑块拖到 100，
/// 但 `hoverThroughAlpha` 上限是 90，界面要显示 90 而不是 100）。
#[tauri::command]
pub fn set_config(app: AppHandle, patch: serde_json::Value) -> Result<serde_json::Value, String> {
    let state = app.state::<AppState>();

    let (before_shortcuts, before_click_through, after) = {
        let mut cfg = state.config.lock().unwrap();
        let before_shortcuts = cfg.shortcuts.clone();
        let before_click_through = cfg.overlay.click_through;

        let mut value = serde_json::to_value(&*cfg).map_err(|e| e.to_string())?;
        merge(&mut value, &patch);
        // 反序列化会走 `#[serde(default)]`，所以缺字段自动补默认值；
        // 类型不对则整体拒绝（而不是静默写成半个坏配置）。
        let merged: Config = serde_json::from_value(value).map_err(|e| format!("配置格式不对：{e}"))?;
        *cfg = merged.sanitize();
        let after = cfg.clone();

        if let Err(e) = cfg.save(&state.config_path) {
            config::log(&format!("config save failed: {e}"));
        }
        (before_shortcuts, before_click_through, after)
    };

    // ── 副作用：改键就重新注册 ──
    if before_shortcuts.toggle_click_through != after.shortcuts.toggle_click_through
        || before_shortcuts.toggle_visibility != after.shortcuts.toggle_visibility
    {
        shortcuts::reregister(&app, &after.shortcuts);
    }

    // ── 副作用：穿透模式改了要动窗口样式 ──
    // 注意不能用 `apply_click_through`：它会把配置再存一遍（无害），
    // 但它读的是 `cfg.overlay.click_through`，这里已经同步过了，所以安全。
    if before_click_through != after.overlay.click_through {
        if let Some(win) = actions::pet_window(&app) {
            if let Err(e) = crate::overlay::toggle_click_through(&win, after.overlay.click_through) {
                config::log(&format!("set_config click_through failed: {e}"));
            }
        }
    }

    // ── 副作用：其余（不透明度/缩放/悬停让位）都靠广播送到前端 ──
    actions::broadcast(&app);

    config::log("config updated from settings window");
    serde_json::to_value(&after).map_err(|e| e.to_string())
}

/// 开机自启。用插件写注册表 `HKCU\...\Run`，不碰系统级设置。
#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;

    let manager = app.autolaunch();
    let result = if enabled {
        manager.enable().map_err(|e| e.to_string())
    } else {
        manager.disable().map_err(|e| e.to_string())
    };
    result?;

    let now = manager.is_enabled().unwrap_or(enabled);
    config::log(&format!("autostart -> {now}"));

    // 同步进配置，重启后界面显示一致
    let state = app.state::<AppState>();
    {
        let mut cfg = state.config.lock().unwrap();
        cfg.system.launch_at_login = now;
        if let Err(e) = cfg.save(&state.config_path) {
            config::log(&format!("config save failed: {e}"));
        }
    }
    Ok(now)
}

/// 查询开机自启的真实状态（**读注册表**，不是读配置）。
///
/// 用户可能自己在「任务管理器 → 启动」里关掉了，这时配置里还是 true。
/// 界面必须显示**实际**状态，否则会出现「开关是开的但其实没生效」。
#[tauri::command]
pub fn get_autostart(app: AppHandle) -> bool {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().unwrap_or(false)
}
