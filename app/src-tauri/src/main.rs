// 发布版不弹控制台窗口；调试版保留 stdout 便于看诊断日志。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod actions;
mod config;
mod overlay;
mod petstore;
mod settings;
mod shortcuts;
mod tray;

use actions::{AppState, ModeSnapshot, PET_WINDOW};
use config::Config;
use tauri::{Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

/// 窗口与内容之间的留白（逻辑像素）。
///
/// 前端 `main.js` 里已经用 `PADDING = 8` 把内容栈四周各留了 8px（给阴影），
/// 所以这里必须是 **0** —— 否则两边各加一次，窗口会比内容大 32px，
/// 既浪费空间，也让「窗口贴合内容」的验收数字虚高。
const WINDOW_PADDING: f64 = 0.0;
/// 尺寸量化步长：避免动画每帧都触发窗口 resize。
const QUANTIZE_STEP: f64 = 4.0;

// ---------------- 命令 ----------------

#[tauri::command]
fn get_mode(app: tauri::AppHandle) -> ModeSnapshot {
    // 与 piggy://mode 广播共用同一份组装逻辑，避免两条路径字段漂移。
    actions::mode_snapshot(&app)
}

#[tauri::command]
fn set_click_through(app: tauri::AppHandle, on: bool) {
    actions::apply_click_through(&app, on);
}

#[tauri::command]
fn toggle_click_through(app: tauri::AppHandle) {
    actions::toggle_click_through(&app);
}

#[tauri::command]
fn toggle_visibility(app: tauri::AppHandle) {
    actions::toggle_visibility(&app);
}

/// 前端量出内容的外接框后调用，把窗口收缩到贴合内容，并**保持猪不动**。
///
/// ⚠️ 铁律：前端必须用**布局盒**（`offsetWidth/offsetHeight`、
/// `offsetLeft/offsetTop`）测量，**不能用 `getBoundingClientRect`**
/// —— 后者会被呼吸动画的 transform 污染。
///
/// - `pig_cx` / `pig_cy`：**新布局**下猪中心在内容框里的偏移（逻辑像素）。
/// - `prev_pig_cx` / `prev_pig_cy`：**改布局之前**猪中心的偏移。
///
/// 锚定算法：猪此刻的屏幕位置 = 窗口当前原点 + `prev_pig × scale`；
/// 再把新窗口摆到「猪还在那个屏幕位置」的原点。两边都用**实时**读到的窗口原点，
/// 所以用户拖过窗口、或外部把窗口挪走之后再开面板都不会算错
/// —— 早期版本缓存了原点，实测外部挪窗后会跳 380px。
#[tauri::command]
fn report_content_box(
    app: tauri::AppHandle,
    width: f64,
    height: f64,
    pig_cx: f64,
    pig_cy: f64,
    prev_pig_cx: f64,
    prev_pig_cy: f64,
) -> Result<(), String> {
    let win = actions::pet_window(&app).ok_or("pet window missing")?;

    let quantize = |v: f64| ((v / QUANTIZE_STEP).ceil() * QUANTIZE_STEP).max(QUANTIZE_STEP);
    let w = quantize(width + WINDOW_PADDING * 2.0);
    let h = quantize(height + WINDOW_PADDING * 2.0);

    let cur = win.inner_size().map_err(|e| e.to_string())?;
    let scale = win.scale_factor().map_err(|e| e.to_string())?;
    let cur_w = cur.width as f64 / scale;
    let cur_h = cur.height as f64 / scale;

    // 量化后尺寸没变就不动窗口，避免无谓的 resize 风暴。
    if (cur_w - w).abs() < 0.5 && (cur_h - h).abs() < 0.5 {
        return Ok(());
    }

    let pos = win.outer_position().map_err(|e| e.to_string())?;
    let pig_screen_x = pos.x + (prev_pig_cx * scale).round() as i32;
    let pig_screen_y = pos.y + (prev_pig_cy * scale).round() as i32;
    let target = PhysicalPosition::new(
        pig_screen_x - (pig_cx * scale).round() as i32,
        pig_screen_y - (pig_cy * scale).round() as i32,
    );

    win.set_size(LogicalSize::new(w, h)).map_err(|e| e.to_string())?;
    win.set_position(target).map_err(|e| e.to_string())?;
    // 变大之后可能顶出屏幕，夹一次（猪必须一直够得着）。
    clamp_to_screen(&win)
}

/// 把窗口夹回显示器工作区，保证猪**永远够得着**。
///
/// 为什么必须有：位置是持久化的，换个分辨率/拔掉外接屏之后，
/// 上次存下的坐标可能已经在屏幕外 —— 那时猪还在跑、还在吃 CPU，
/// 但鼠标永远碰不到它，用户只能去托盘里猜。实测就撞到过这个（窗口停在 x=2530
/// 而屏幕只有 2560 宽，猪中心 2590 在屏幕外）。
fn clamp_to_screen(win: &tauri::WebviewWindow) -> Result<(), String> {
    let pos = win.outer_position().map_err(|e| e.to_string())?;
    let size = win.outer_size().map_err(|e| e.to_string())?;

    // 优先用窗口当前所在的显示器；窗口完全在屏幕外时退到主显示器。
    let monitor = win
        .current_monitor()
        .map_err(|e| e.to_string())?
        .or_else(|| win.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else {
        return Ok(());
    };

    let mp = monitor.position();
    let ms = monitor.size();
    let w = size.width as i32;
    let h = size.height as i32;

    // 让整只猪都留在屏幕里（窗口比屏幕还大时才退化成「至少贴住左上角」）。
    // 注意这里用的是显示器**全高**，没有扣掉任务栏 —— Tauri 不直接暴露工作区，
    // 用全屏范围意味着猪可以被拖到任务栏底下。属于已知小瑕疵，用户拖出来即可。
    let min_x = mp.x;
    let max_x = (mp.x + ms.width as i32 - w).max(min_x);
    let min_y = mp.y;
    let max_y = (mp.y + ms.height as i32 - h).max(min_y);

    let x = pos.x.clamp(min_x, max_x);
    let y = pos.y.clamp(min_y, max_y);
    if x != pos.x || y != pos.y {
        config::log(&format!(
            "位置 ({},{}) 在屏幕外，已夹回 ({x},{y})",
            pos.x, pos.y
        ));
        win.set_position(PhysicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 改键：重新注册并持久化。
#[tauri::command]
fn set_shortcuts(
    app: tauri::AppHandle,
    toggle_click_through: String,
    toggle_visibility: String,
) -> Vec<String> {
    let state = app.state::<AppState>();
    {
        let mut cfg = state.config.lock().unwrap();
        cfg.shortcuts.toggle_click_through = toggle_click_through;
        cfg.shortcuts.toggle_visibility = toggle_visibility;
        if let Err(e) = cfg.save(&state.config_path) {
            config::log(&format!("config save failed: {e}"));
        }
    }
    let cfg = state.config.lock().unwrap().shortcuts.clone();
    shortcuts::reregister(&app, &cfg)
}

/// WebView2 启动参数。**实测数据**（同一台机器，release 构建，空闲 15s 后取
/// 「进程树 Private 合计」，这才是真实独占内存；WorkingSet 含跨进程共享页会高估）：
///
/// | 配置 | 进程数 | Private 合计 |
/// |---|---|---|
/// | 不传参数（Tauri 默认） | 7 | 150.6 MB |
/// | **本常量（安全裁剪）** | 7 | **105.1 MB** |
/// | 再加 `--single-process` | 3 | 68.5 MB（但官方不支持，有崩溃风险） |
///
/// 注意：设置 `additional_browser_args` 会**整体替换** Tauri 的默认值，
/// 所以必须把 Tauri 自己的 `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`
/// 一并带上，否则会丢掉 Tauri 的安全/体验默认项。
pub const WEBVIEW2_ARGS: &str = concat!(
    // Tauri 默认项（必须保留）
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,",
    // 关掉用不到的 Chromium 特性，顺带减少常驻内存
    "CalculateNativeWinOcclusion,AutofillServerCommunication,InterestFeedContentSuggestions,",
    "OptimizationHints,MediaRouter,Translate",
    // 桌宠只画一张 SVG：不需要 GPU 合成进程，也不需要多渲染进程
    " --disable-gpu --disable-gpu-compositing --renderer-process-limit=1",
    // 不联网、不更新、不遥测
    " --disable-background-networking --disable-component-update --disable-domain-reliability",
    " --disable-client-side-phishing-detection --disable-sync --disable-extensions",
    " --no-first-run --no-default-browser-check"
);

/// 前端日志桥：release 没有控制台，前端的诊断信息经此落盘。
#[tauri::command]
fn log_from_js(msg: String) {
    config::log(&format!("[js] {msg}"));
}

/// 读取宠物存档。没有/损坏返回 `null`，前端会 `adopt()` 一只新的。
#[tauri::command]
fn load_pet_state(app: tauri::AppHandle) -> Option<serde_json::Value> {
    let dir = app.path().app_data_dir().ok()?;
    petstore::load(&dir)
}

/// 保存宠物存档（原子写入 + 保留上一份备份）。
#[tauri::command]
fn save_pet_state(app: tauri::AppHandle, state: serde_json::Value) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    petstore::save(&dir, &state)
}

/// 前端加载完成后调用：**再套一遍**窗口样式并回读，作为实测验收的凭据。
///
/// 必要性：wry 在 webview 初始化/显示时会重写扩展样式，
/// 因此样式必须在窗口真正显示之后再巩固一次（幂等）。
#[tauri::command]
fn frontend_ready(app: tauri::AppHandle) -> Result<String, String> {
    let win = actions::pet_window(&app).ok_or("pet window missing")?;
    let ct = actions::current_click_through(&app);
    apply_overlay_styles(&win, ct);
    let desc = overlay::describe(&win)?;
    config::log(&format!("frontend_ready -> {desc}"));
    Ok(desc)
}

/// 统一套用「不抢焦点 + 按配置的穿透」样式。
fn apply_overlay_styles(win: &tauri::WebviewWindow, click_through: bool) {
    if let Err(e) = overlay::init_window(win) {
        config::log(&format!("overlay init failed: {e}"));
    }
    if let Err(e) = overlay::set_click_through(win, click_through) {
        config::log(&format!("set_click_through failed: {e}"));
    }
}

/// 保存窗口位置（拖动结束后由前端防抖调用）。
#[tauri::command]
fn save_position(app: tauri::AppHandle, x: i32, y: i32) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join("position.json.tmp");
    let dst = dir.join("position.json");
    std::fs::write(&tmp, format!("{{\"x\":{x},\"y\":{y}}}")).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &dst).map_err(|e| e.to_string())
}

/// 诊断输出：用于实测验收（窗口样式位、DPI、几何）。
#[tauri::command]
fn diagnostics(app: tauri::AppHandle) -> Result<String, String> {
    let win = actions::pet_window(&app).ok_or("pet window missing")?;
    let styles = overlay::describe(&win).map_err(|e| e.to_string())?;
    let size = win.inner_size().map_err(|e| e.to_string())?;
    let pos = win.outer_position().map_err(|e| e.to_string())?;
    let scale = win.scale_factor().map_err(|e| e.to_string())?;
    let visible = win.is_visible().unwrap_or(false);
    let state = app.state::<AppState>();
    let problems = state.shortcut_problems.lock().unwrap().clone();
    Ok(format!(
        "styles: {styles}\n\
         size: {}x{} physical ({:.1}x{:.1} logical) @ scale {scale}\n\
         pos: {},{}  visible={visible}\n\
         shortcut_problems: {:?}",
        size.width,
        size.height,
        size.width as f64 / scale,
        size.height as f64 / scale,
        pos.x,
        pos.y,
        problems
    ))
}

// ---------------- 启动 ----------------

fn main() {
    tauri::Builder::default()
        // 单实例：桌宠不该被重复启动出多只。
        //
        // `--settings` 是唯一例外：已经有一只在跑时，第二次启动**不开新猪**，
        // 而是把设置窗口调出来。这样托盘被隐藏、或快捷键全冲突时，
        // 仍然有一条命令行兜底路径能进设置。
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if argv.iter().any(|a| a == "--settings") {
                if let Err(e) = settings::open(app) {
                    config::log(&format!("open settings failed: {e}"));
                }
                return;
            }
            if let Some(w) = actions::pet_window(app) {
                let _ = w.show();
            }
            actions::broadcast(app);
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // 开机自启：写 HKCU\...\Run，不碰系统级设置。
        // macOS 那个参数在 Windows 上会被忽略（Windows 走注册表）。
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            get_mode,
            set_click_through,
            toggle_click_through,
            toggle_visibility,
            report_content_box,
            set_shortcuts,
            save_position,
            frontend_ready,
            log_from_js,
            load_pet_state,
            save_pet_state,
            diagnostics,
            settings::open_settings,
            settings::get_config,
            settings::set_config,
            settings::set_autostart,
            settings::get_autostart
        ])
        .setup(|app| {
            // 1) 配置：缺失/损坏都回落默认值，绝不因此启动失败。
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("com.piggy.desktop"));
            // 最先打开日志文件：release 是 windows 子系统没有控制台，落盘才有线索。
            config::init_log_file(&data_dir.join("piggy.log"));
            config::log("=== piggy-desktop starting ===");
            let cfg_path = config::config_path(&data_dir);
            let cfg = Config::load(&cfg_path);
            config::log(&format!("config path: {}", cfg_path.display()));
            // 首次运行就把默认配置落盘，让用户有个文件可以直接编辑。
            if !cfg_path.exists() {
                if let Err(e) = cfg.save(&cfg_path) {
                    config::log(&format!("initial config save failed: {e}"));
                } else {
                    config::log("wrote default config for first run");
                }
            }
            app.manage(AppState::new(cfg.clone(), cfg_path.clone()));

            // 2) 建窗口。先 visible(false)，把扩展样式设好再显示，避免显示瞬间抢焦点。
            let win = WebviewWindowBuilder::new(
                app,
                PET_WINDOW,
                WebviewUrl::App("index.html".into()),
            )
            .title("谷歌猪")
            .inner_size(164.0, 184.0)
            .additional_browser_args(WEBVIEW2_ARGS)
            .decorations(false)
            .transparent(true)
            .always_on_top(cfg.overlay.always_on_top)
            .skip_taskbar(!cfg.system.show_taskbar_icon)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .focused(false)
            .shadow(false)
            .visible(false)
            .build()?;

            // 3) 先设一遍样式，避免显示瞬间抢焦点。
            apply_overlay_styles(&win, cfg.overlay.click_through);
            // 4) 显示（不抢焦点）。
            win.show()?;
            // 5) show 之后**必须再设一遍**：wry 会在 show / webview 初始化时覆盖窗口样式。
            //    实测只设一次会丢掉 NOACTIVATE/TOOLWINDOW，且残留 APPWINDOW → 窗口跑进任务栏。
            apply_overlay_styles(&win, cfg.overlay.click_through);
            // 6) 恢复到上次保存的位置（有的话），然后夹回屏幕内。
            if let Some(saved) = load_position(&data_dir) {
                let _ = win.set_position(PhysicalPosition::new(saved.0, saved.1));
            }
            if cfg.overlay.keep_inside_screen {
                if let Err(e) = clamp_to_screen(&win) {
                    config::log(&format!("clamp_to_screen failed: {e}"));
                }
            }

            // 7) 快捷键 + 托盘。
            let problems = shortcuts::register_all(app.handle(), &cfg.shortcuts);
            if let Some(state) = app.try_state::<AppState>() {
                *state.shortcut_problems.lock().unwrap() = problems.clone();
            }
            for p in &problems {
                config::log(&format!("SHORTCUT PROBLEM: {p}"));
            }
            if cfg.system.show_tray_icon {
                if let Err(e) = tray::build(app.handle()) {
                    config::log(&format!("tray build failed: {e}"));
                }
            }
            // 把「实际生效的快捷键」推给界面（可能与配置首选不同）。
            actions::broadcast(app.handle());

            // 8) 光标进出窗口的判定 —— 交给 Rust 轮询 `GetCursorPos`。
            //
            // 为什么不用前端 DOM 的 hover 事件：窗口 resize / move 时 WebView2
            // 会补发一次**假的** `pointerleave`（光标其实没动），面板刚打开就被
            // 自己关掉；而光标**真的**移出时 Windows 不再发 `WM_MOUSEMOVE`，
            // 前端手里最后一个坐标还停在窗口内，几何复核也判不出来。
            // 详见 `overlay::cursor_inside` 的注释。
            //
            // 150ms 一次 `GetCursorPos`（微秒级），只在状态翻转时才 emit，
            // 所以稳定态下既不占 CPU 也不产生 IPC。
            //
            // ── 悬停让位（P2-6）也挂在这个线程上 ──────────────────────────
            //
            // 「悬停」被两个功能共用，这是设计上的硬冲突：
            //   ① 悬停 → 打开照顾面板（要能点）
            //   ② 悬停 → 淡出 + 穿透，别挡住下层（要不能点）
            // 两者都盯着「指针在猪身上」，不可能同时成立。用**停留时长**区分：
            //
            //   指针扫过来（< wake）  → 判定「路过」 → 立刻淡出 + 穿透，
            //                          这一下点击直接落到游戏里 ✅
            //   指针停住（≥ wake）    → 判定「想互动」 → 恢复不透明 + 取消穿透
            //                          + 通知前端开面板 ✅
            //   指针移开（≥ restore） → 回到「路过」态
            //
            // 关键：**进入时立刻穿透**，不等延迟。这样打游戏时鼠标扫过猪
            // 永远不会吞掉一次点击 —— 那正是用户最在意的「不与全屏游戏冲突」。
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    use std::time::{Duration, Instant};

                    let mut hover_sent: Option<bool> = None;
                    let mut ghost_applied: Option<bool> = None;
                    let mut inside_since: Option<Instant> = None;
                    let mut left_at: Option<Instant> = None;

                    loop {
                        std::thread::sleep(Duration::from_millis(150));
                        let Some(win) = actions::pet_window(&handle) else {
                            continue;
                        };
                        if !win.is_visible().unwrap_or(true) {
                            continue;
                        }

                        let cfg = handle
                            .try_state::<actions::AppState>()
                            .map(|s| s.config.lock().unwrap().overlay.clone())
                            .unwrap_or_default();

                        let inside = overlay::cursor_inside(&win).unwrap_or(false);
                        let now = Instant::now();

                        if inside {
                            left_at = None;
                            inside_since.get_or_insert(now);
                        } else {
                            inside_since = None;
                            left_at.get_or_insert(now);
                        }

                        // 该不该「让位」
                        let want_ghost = if !cfg.hover_through {
                            false
                        } else if inside {
                            let dwell = inside_since
                                .map(|t| now.duration_since(t).as_millis() as u32)
                                .unwrap_or(0);
                            dwell < cfg.hover_wake_delay_ms
                        } else {
                            let away = left_at
                                .map(|t| now.duration_since(t).as_millis() as u32)
                                .unwrap_or(0);
                            away >= cfg.hover_restore_delay_ms
                        };

                        if ghost_applied != Some(want_ghost) {
                            ghost_applied = Some(want_ghost);
                            actions::GHOST.store(want_ghost, std::sync::atomic::Ordering::SeqCst);
                            // 让位态一定穿透；醒来时回到**用户设定**的穿透值。
                            // 注意：这里直接改样式，**不写配置文件** —— 让位是
                            // 运行时状态，不能覆盖用户自己的穿透意图。
                            let through = want_ghost || cfg.click_through;
                            if let Err(e) = overlay::set_click_through(&win, through) {
                                config::log(&format!("GHOST set_click_through failed: {e}"));
                            }
                            let _ = handle.emit("piggy://ghost", want_ghost);
                            config::log(&format!(
                                "GHOST -> {want_ghost} (through={through}, alpha={})",
                                if want_ghost { cfg.hover_through_alpha } else { cfg.opacity_percent }
                            ));
                        }

                        // 只有「醒着且在窗口内」才通知前端开面板
                        let hover = inside && !want_ghost;
                        if hover_sent != Some(hover) {
                            hover_sent = Some(hover);
                            let _ = handle.emit("piggy://hover", hover);
                        }
                    }
                });
            }

            // 首次启动就带 `--settings` 时把设置窗口开出来。
            // **必须延迟** —— WebView2 此时还没初始化完，直接开必失败
            // （实测 `HRESULT(0x8007139F)`）。详见 `settings::open_deferred`。
            if std::env::args().any(|a| a == "--settings") {
                settings::open_deferred(app.handle(), 900, 6);
            }

            config::log("startup complete");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running piggy-desktop");
}

fn load_position(dir: &std::path::Path) -> Option<(i32, i32)> {
    let text = std::fs::read_to_string(dir.join("position.json")).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    Some((v.get("x")?.as_i64()? as i32, v.get("y")?.as_i64()? as i32))
}

