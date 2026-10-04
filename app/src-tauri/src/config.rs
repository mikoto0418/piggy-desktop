//! 配置读写。原子写入 + 损坏兜底（照搬 Bongo Cat 的「最新有效备份 → 默认配置」思路的简化版）。

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// 悬浮层配置。字段命名与 `analysis/F-悬浮模式设计.md` §7.3 一致。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct OverlayConfig {
    /// 穿透模式。M1 决策：**默认互动**（false）。
    pub click_through: bool,
    pub always_on_top: bool,
    /// 穿透模式下可降到低档省电（M2：动画继续播，但降帧率）。
    pub maximum_fps: u32,

    // ── 悬停让位（P2-6）──────────────────────────────────────────────
    //
    // 🔴 这里有个**设计冲突**必须先讲清楚，否则实现出来一定是坏的：
    //    「悬停」同时被两个功能用着 ——
    //      ① 悬停 → 打开照顾面板（要能点）
    //      ② 悬停 → 淡出 + 穿透，别挡住下层（要不能点）
    //    两者都盯着「指针在猪身上」这一个条件，**不可能同时成立**。
    //
    //    解法：用**停留时长**区分「路过」和「想互动」。
    //      · 指针刚扫过来（< wake 延迟）→ 判定为**路过** → 淡出 + 穿透，
    //        这一下点击直接落到游戏里，猪完全不碍事 ✅
    //      · 指针停住不走（≥ wake 延迟）→ 判定为**想互动** → 恢复不透明 +
    //        取消穿透 + 打开面板，面板可以正常点 ✅
    //      · 指针移开 → 过 restore 延迟后回到「路过」态 ✅
    //
    //    这样两个功能都活着，而且打游戏时**永远不会**吞掉一次点击
    //    （路过是立刻穿透的，不需要等延迟）。
    /// 悬停让位总开关。默认**关**（M3 决策：一期做，但要让用户显式打开）。
    pub hover_through: bool,
    /// 让位时的不透明度百分比（10–100）。默认 35，淡淡的还看得见。
    pub hover_through_alpha: u32,
    /// 指针**刚进入**就立刻穿透，不需要等延迟 —— 这样「路过扫一下」
    /// 不会吞掉点击。这个值只控制**移开之后**多久恢复不透明。
    pub hover_restore_delay_ms: u32,
    /// 指针在猪身上停多久算「想互动」（恢复不透明 + 开面板）。
    pub hover_wake_delay_ms: u32,

    pub keep_inside_screen: bool,
    pub opacity_percent: u32,
    pub scale_percent: u32,
}

impl Default for OverlayConfig {
    fn default() -> Self {
        Self {
            click_through: false,
            always_on_top: true,
            maximum_fps: 30,
            hover_through: false,
            hover_through_alpha: 35,
            hover_restore_delay_ms: 300,
            hover_wake_delay_ms: 600,
            keep_inside_screen: true,
            opacity_percent: 100,
            scale_percent: 100,
        }
    }
}

/// 快捷键配置。M4 决策：**可自定义**，默认 Ctrl+Alt+P / Ctrl+Alt+H。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ShortcutsConfig {
    pub toggle_click_through: String,
    pub toggle_visibility: String,
}

impl Default for ShortcutsConfig {
    fn default() -> Self {
        Self {
            toggle_click_through: "Ctrl+Alt+P".into(),
            toggle_visibility: "Ctrl+Alt+H".into(),
        }
    }
}

/// 系统集成配置。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SystemConfig {
    /// 托盘是快捷键全部冲突时的**唯一兜底入口**，必须保留。
    pub show_tray_icon: bool,
    pub show_taskbar_icon: bool,
    /// Q6 待定，先默认关。
    pub launch_at_login: bool,
}

impl Default for SystemConfig {
    fn default() -> Self {
        Self {
            show_tray_icon: true,
            show_taskbar_icon: false,
            launch_at_login: false,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Config {
    pub overlay: OverlayConfig,
    pub shortcuts: ShortcutsConfig,
    pub system: SystemConfig,
}

impl Config {
    /// 读取配置。文件缺失/损坏都回落到默认值，**绝不因为配置问题启动失败**。
    pub fn load(path: &Path) -> Self {
        match fs::read_to_string(path) {
            Ok(text) => match serde_json::from_str::<Config>(&text) {
                Ok(cfg) => {
                    log(&format!("config loaded from {}", path.display()));
                    cfg.sanitize()
                }
                Err(e) => {
                    log(&format!("config parse failed ({e}), using defaults"));
                    Config::default()
                }
            },
            Err(_) => {
                log("config not found, using defaults");
                Config::default()
            }
        }
    }

    /// 夹紧取值范围，避免配置文件被手改成越界值。
    ///
    /// `pub` 是因为设置界面也会调：用户在界面上拖滑块同样能拖出越界值，
    /// 而且 `set_config` 存盘**之前**必须先夹紧，否则坏值会被写回文件。
    pub fn sanitize(mut self) -> Self {
        self.overlay.maximum_fps = self.overlay.maximum_fps.clamp(15, 240);
        self.overlay.opacity_percent = self.overlay.opacity_percent.clamp(10, 100);
        self.overlay.scale_percent = self.overlay.scale_percent.clamp(50, 300);
        self.overlay.hover_through_alpha = self.overlay.hover_through_alpha.clamp(10, 100);
        // 让位后要能看见，所以上限压到 90：设成 100 等于「让位了但完全没变化」。
        self.overlay.hover_through_alpha = self.overlay.hover_through_alpha.min(90);
        self.overlay.hover_restore_delay_ms = self.overlay.hover_restore_delay_ms.min(5000);
        // 唤醒延迟必须**严格大于** 150ms 的轮询周期，否则一帧就跳到「想互动」，
        // 「路过不吞点击」这个性质就没了。
        self.overlay.hover_wake_delay_ms = self.overlay.hover_wake_delay_ms.clamp(300, 10_000);
        if self.shortcuts.toggle_click_through.trim().is_empty() {
            self.shortcuts.toggle_click_through = ShortcutsConfig::default().toggle_click_through;
        }
        if self.shortcuts.toggle_visibility.trim().is_empty() {
            self.shortcuts.toggle_visibility = ShortcutsConfig::default().toggle_visibility;
        }
        self
    }

    /// 原子写入：先写同目录临时文件并 flush，再 rename 覆盖。
    /// rename 在同一卷上是原子的，避免半截文件把配置写坏。
    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir)?;
        }
        let text = serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into());
        let tmp = path.with_extension("json.tmp");
        {
            use std::io::Write;
            let mut f = fs::File::create(&tmp)?;
            f.write_all(text.as_bytes())?;
            f.sync_all()?;
        }
        fs::rename(&tmp, path)
    }
}

/// 配置目录：`%APPDATA%\com.piggy.desktop\config.json`
pub fn config_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("config.json")
}

/// 日志文件句柄。release 构建是 windows 子系统（没有控制台），
/// 必须同时落盘，否则出问题完全看不到线索。
static LOG_FILE: std::sync::OnceLock<std::sync::Mutex<fs::File>> = std::sync::OnceLock::new();

/// 打开日志文件（启动时调用一次，**覆盖**旧日志，避免无限增长）。
pub fn init_log_file(path: &Path) {
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    match fs::File::create(path) {
        Ok(f) => {
            let _ = LOG_FILE.set(std::sync::Mutex::new(f));
        }
        Err(_) => {}
    }
}

pub fn log(msg: &str) {
    println!("[piggy] {msg}");
    if let Some(f) = LOG_FILE.get() {
        if let Ok(mut f) = f.lock() {
            use std::io::Write;
            let _ = writeln!(f, "[piggy] {msg}");
            let _ = f.flush();
        }
    }
}
