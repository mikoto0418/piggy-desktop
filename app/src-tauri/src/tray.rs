//! 托盘图标 —— 快捷键全部冲突时的**唯一兜底入口**，因此默认开启且不提供关闭捷径。

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::AppHandle;

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let toggle_ct = MenuItem::with_id(
        app,
        "toggle_click_through",
        "切换穿透模式（悬浮）",
        true,
        None::<&str>,
    )?;
    let toggle_vis =
        MenuItem::with_id(app, "toggle_visibility", "显示 / 隐藏桌宠", true, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "显示桌宠", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    // 设置是**唯一**能改键和调悬停让位的地方，所以放在退出前面、单独一段。
    let settings_item = MenuItem::with_id(app, "settings", "设置…", true, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&toggle_ct, &toggle_vis, &show, &sep, &settings_item, &sep2, &quit],
    )?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("default window icon missing".into()))?;

    TrayIconBuilder::with_id("piggy-tray")
        .icon(icon)
        .tooltip("谷歌猪桌宠")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle_click_through" => crate::actions::toggle_click_through(app),
            "toggle_visibility" => crate::actions::toggle_visibility(app),
            "show" => {
                if let Some(w) = crate::actions::pet_window(app) {
                    let _ = w.show();
                }
                crate::actions::broadcast(app);
            }
            "settings" => {
                if let Err(e) = crate::settings::open(app) {
                    crate::config::log(&format!("open settings failed: {e}"));
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    crate::config::log("tray built");
    Ok(())
}
