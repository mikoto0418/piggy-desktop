//! 悬浮层窗口行为：不抢焦点 + 整窗点击穿透。
//!
//! 机制来源：`analysis/F-悬浮模式设计.md`（对 `ayangweb/BongoCat` v2.0.1 的源码级实证）。
//!
//! 🔴 **最关键的一条**：只设 `WS_EX_TRANSPARENT` **不够**。
//! 对 DirectComposition 支撑的顶层窗口（wry/WebView2 正是这种），
//! `WM_NCHITTEST` 虽会返回 `HTTRANSPARENT`，但**真实点击仍会选中这个 HWND**。
//! 必须 `WS_EX_TRANSPARENT | WS_EX_LAYERED` **成对设置**，整窗才会真正把鼠标让给下层窗口。

use tauri::WebviewWindow;

/// 启动时观察到的「互动模式」基准扩展样式。
/// 切换穿透时以此为基准做增删，避免误删 wry 自己设置的位
/// （透明窗口可能本来就带 `WS_EX_LAYERED`，删掉会破坏透明）。
static BASE_EX_STYLE: std::sync::atomic::AtomicIsize =
    std::sync::atomic::AtomicIsize::new(isize::MIN);

fn base_unset() -> bool {
    BASE_EX_STYLE.load(std::sync::atomic::Ordering::SeqCst) == isize::MIN
}

#[cfg(windows)]
mod imp {
    use super::BASE_EX_STYLE;
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use std::ffi::c_void;
    use std::sync::atomic::Ordering;
    use tauri::WebviewWindow;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetCursorPos, GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE,
        SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, WS_EX_APPWINDOW,
        WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
    };

    /// 光标此刻是否落在窗口的**屏幕矩形**内。
    ///
    /// 🔴 为什么不用 DOM 的 hover 事件判断：
    ///
    /// 1. 窗口 resize / move 时 WebView2 会**补发一次假的 `pointerleave`**
    ///    （光标其实一动没动），面板刚打开就被自己关掉；实测日志里就是
    ///    `POINTERENTER → BOX 166x240 → BOX 80x80`，一次就结束。
    /// 2. 反过来，光标**真的**移出窗口时 Windows 不再发 `WM_MOUSEMOVE`，
    ///    前端手里最后一个坐标还停在窗口内 —— 想用几何复核去识别假 leave，
    ///    就会把真的 leave 也一起当成假的，面板再也收不起来。
    ///
    /// 两个方向都不可靠。`GetCursorPos` 是唯一说了算的判据：轮询它，
    /// 只在**状态翻转**时通知前端，所以稳定态下没有任何开销。
    pub fn cursor_inside(window: &WebviewWindow) -> Result<bool, String> {
        let mut p = POINT { x: 0, y: 0 };
        unsafe { GetCursorPos(&mut p) }.map_err(|e| e.to_string())?;
        let pos = window.outer_position().map_err(|e| e.to_string())?;
        let size = window.outer_size().map_err(|e| e.to_string())?;
        Ok(p.x >= pos.x
            && p.y >= pos.y
            && p.x < pos.x + size.width as i32
            && p.y < pos.y + size.height as i32)
    }

    /// `WS_EX_TRANSPARENT | WS_EX_LAYERED` —— 穿透必须成对。
    fn click_through_bits() -> isize {
        WS_EX_TRANSPARENT.0 as isize | WS_EX_LAYERED.0 as isize
    }

    /// 「不抢焦点 + 不进任务栏」的基准位。
    ///
    /// 必须**显式清掉 `WS_EX_APPWINDOW`**：Tauri 的 `skip_taskbar` 在这个窗口上
    /// 实测没有清干净（观察到的 ex-style 是 `0x40118`，含 APPWINDOW 而无 TOOLWINDOW），
    /// 结果窗口会出现在任务栏里。
    fn no_activate_bits(cur: isize) -> isize {
        (cur | WS_EX_NOACTIVATE.0 as isize | WS_EX_TOOLWINDOW.0 as isize)
            & !(WS_EX_APPWINDOW.0 as isize)
    }

    /// 取原生 HWND。
    ///
    /// 走 `raw-window-handle` 而不是 Tauri 的 `hwnd()`：拿到的是**裸指针数值**，
    /// 再用本 crate 的 `windows` 版本重建 `HWND`，
    /// 这样即使 Tauri 内部用的 `windows` 版本与这里不同也不会类型冲突。
    fn hwnd_of(window: &WebviewWindow) -> Result<HWND, String> {
        let handle = window
            .window_handle()
            .map_err(|e| format!("window_handle failed: {e}"))?;
        match handle.as_raw() {
            RawWindowHandle::Win32(h) => {
                Ok(HWND(h.hwnd.get() as *mut c_void))
            }
            other => Err(format!("unexpected window handle: {other:?}")),
        }
    }

    /// 读取当前扩展样式。
    pub fn read_ex_style(window: &WebviewWindow) -> Result<isize, String> {
        let hwnd = hwnd_of(window)?;
        Ok(unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) })
    }

    /// 写回扩展样式并刷新非客户区缓存。
    ///
    /// `SetWindowPos(..., SWP_FRAMECHANGED, ...)` 是**必须**的：
    /// 只改样式位而不刷新，新样式不会生效（BongoCat `window.rs:371-398` 同款做法）。
    fn write_ex_style(window: &WebviewWindow, style: isize) -> Result<(), String> {
        let hwnd = hwnd_of(window)?;
        unsafe {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style);
            SetWindowPos(
                hwnd,
                None,
                0,
                0,
                0,
                0,
                SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
            )
            .map_err(|e| format!("SetWindowPos failed: {e}"))?;
        }
        Ok(())
    }

    /// 初始化：加上 `WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW`、清掉 `WS_EX_APPWINDOW`，
    /// 并记录基准样式。**幂等**，可以重复调用（wry 会在 show/webview 初始化时覆盖样式）。
    ///
    /// - `WS_EX_NOACTIVATE`：**永不抢焦点** —— 硬约束 ② 的关键，点猪不会把焦点从游戏抢走。
    /// - `WS_EX_TOOLWINDOW`：不进任务栏 / Alt-Tab 列表。
    pub fn init_window(window: &WebviewWindow) -> Result<(), String> {
        let cur = read_ex_style(window)?;
        let base = no_activate_bits(cur);
        write_ex_style(window, base)?;
        BASE_EX_STYLE.store(base, Ordering::SeqCst);
        Ok(())
    }

    /// 切换穿透模式。以基准样式为底，增删 `WS_EX_TRANSPARENT | WS_EX_LAYERED`。
    pub fn set_click_through(window: &WebviewWindow, on: bool) -> Result<(), String> {
        let base = if super::base_unset() {
            let b = no_activate_bits(read_ex_style(window)?);
            BASE_EX_STYLE.store(b, Ordering::SeqCst);
            b
        } else {
            BASE_EX_STYLE.load(Ordering::SeqCst)
        };
        let next = if on {
            base | click_through_bits()
        } else {
            base & !click_through_bits()
        };
        write_ex_style(window, next)
    }

    /// 诊断：把当前样式位翻译成人能读的字符串，用于实测验收。
    pub fn describe(window: &WebviewWindow) -> Result<String, String> {
        let s = read_ex_style(window)?;
        let has = |bit: u32| s & (bit as isize) != 0;
        Ok(format!(
            "ex=0x{:X} [TRANSPARENT={} LAYERED={} NOACTIVATE={} TOOLWINDOW={}]",
            s,
            has(WS_EX_TRANSPARENT.0),
            has(WS_EX_LAYERED.0),
            has(WS_EX_NOACTIVATE.0),
            has(WS_EX_TOOLWINDOW.0),
        ))
    }
}

#[cfg(windows)]
pub use imp::{cursor_inside, describe, init_window, set_click_through};

// ---- 非 Windows 平台占位（首发只做 Windows，但保证能编译） ----

#[cfg(not(windows))]
mod imp_stub {
    use tauri::WebviewWindow;

    pub fn init_window(_w: &WebviewWindow) -> Result<(), String> {
        Ok(())
    }
    pub fn set_click_through(w: &WebviewWindow, on: bool) -> Result<(), String> {
        w.set_ignore_cursor_events(on).map_err(|e| e.to_string())
    }
    pub fn describe(_w: &WebviewWindow) -> Result<String, String> {
        Ok("non-windows platform".into())
    }
    pub fn cursor_inside(_w: &WebviewWindow) -> Result<bool, String> {
        Ok(false)
    }
}

#[cfg(not(windows))]
pub use imp_stub::{cursor_inside, describe, init_window, set_click_through};

/// 供命令层调用：切换穿透模式并记录诊断。
pub fn toggle_click_through(window: &WebviewWindow, on: bool) -> Result<(), String> {
    set_click_through(window, on)?;
    if let Ok(d) = describe(window) {
        crate::config::log(&format!("click_through={on} -> {d}"));
    }
    Ok(())
}
