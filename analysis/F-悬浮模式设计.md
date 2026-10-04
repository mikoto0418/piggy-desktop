# 悬浮模式（Bongo Cat 式不打扰方案）· 设计与实证

> **本文回答你的问题**：「是否可以参考 Bongo Cat 那种？他好像就不影响游戏，或者设个快捷键/模式，开了那个模式之后桌宠就不会被点到，只是和 Bongo Cat 一样悬浮着。」
>
> **结论：可以，而且这是比「全屏检测」更简单、更可靠的主方案。** Bongo Cat 就是这么做的 —— 它**根本没有全屏检测**。
>
> 证据来源：`F:\piggy\_bongocat`（`ayangweb/BongoCat` v2.0.1 源码，`--depth 1` 克隆，只读分析）

---

## 0. 结论速览

| 问题 | 结论 |
|---|---|
| Bongo Cat 靠什么不影响游戏？ | **整窗点击穿透**（Windows `WS_EX_TRANSPARENT \| WS_EX_LAYERED`）+ `WS_EX_NOACTIVATE`，**不是**全屏检测 |
| 它有全屏检测吗？ | **没有**。它用「用户自己开穿透模式」代替自动检测 |
| 有快捷键吗？ | **有**。`toggle_overlay` 快捷键切换模型窗口显隐；穿透是配置项 `overlay.click_through` |
| 它多大？ | Windows 安装包 **9.71 MB**（纯 Rust + GPUI + D3D11，**不用 Tauri/WebView**） |
| 我们能照抄吗？ | **能，而且应该照抄这个机制**。我们的技术栈（Tauri 2）对应 API 是 `set_ignore_cursor_events` |
| 那还需要全屏检测吗？ | **降级为增强项**。主方案 = 穿透模式；全屏检测作为「自动帮你切模式」的锦上添花 |

### 为什么这比全屏检测更好

| | 全屏检测方案 | 穿透模式方案（Bongo Cat 式） |
|---|---|---|
| 实现复杂度 | 高（5 个 Win32 调用 + DPI 坑 + 去抖） | **低**（切换 2 个样式位） |
| 可靠性 | 中（FSE/FSO/最大化三种模式判断边界模糊） | **高**（穿透就是穿透，没有判断） |
| 用户可控 | ❌ 自动，用户无法干预 | ✅ **用户按快捷键，所见即所得** |
| 游戏内表现 | 隐藏（猪不见了） | **悬浮可见但不挡操作**（更符合桌宠定位） |
| 失败模式 | 误判 → 猪莫名消失 | 无（不会误判） |

> **你的直觉是对的**：桌宠该做的是「**看得见但不碍事**」，而不是「检测到游戏就消失」。

---

## 1. Bongo Cat 的实证机制（源码级）

### 1.1 整窗点击穿透 = 两个扩展样式位

`crates/bongocat-overlay/src/windows/window.rs:95-102`：

```rust
if options.click_through {
    // `WS_EX_TRANSPARENT` alone leaves a DirectComposition-backed
    // top-level window on the desktop input path: `WM_NCHITTEST`
    // returns `HTTRANSPARENT`, but a real click still selects this
    // HWND. Layering is the Win32 pair that makes the whole window
    // pass through to the window underneath it.
    extended |= WS_EX_TRANSPARENT | WS_EX_LAYERED;
}
```

> 🔴 **这是全篇最重要的一条，也是网上教程最常写错的地方**：
> **只设 `WS_EX_TRANSPARENT` 不够。**
> 对 DirectComposition / 透明窗口，`WM_NCHITTEST` 虽然返回 `HTTRANSPARENT`，
> 但**真实点击仍然会选中这个 HWND**（桌面输入路径还是能命中它）。
> **必须 `WS_EX_TRANSPARENT | WS_EX_LAYERED` 一起设**，整窗才会真正把鼠标让给下层窗口。

### 1.2 窗口创建时的完整样式组合

`window.rs:92-102` + `:120`：

| 样式 | 作用 |
|---|---|
| `WS_POPUP` | 无边框顶层窗口（基础样式） |
| `WS_EX_NOACTIVATE` | **永不抢焦点** ← 你的硬约束 ② 关键 |
| `WS_EX_NOREDIRECTIONBITMAP` | 配合 DirectComposition 渲染，不占重定向位图 |
| `WS_EX_TRANSPARENT` | 鼠标穿透（命中测试返回 `HTTRANSPARENT`） |
| `WS_EX_LAYERED` | 让穿透对**真实点击**生效（见 §1.1） |
| `WS_EX_TOOLWINDOW` / `WS_EX_APPWINDOW` | 任务栏按钮显隐（`taskbar_ex_style()`） |

### 1.3 运行时热切换（就是你要的「模式」）

`window.rs:371-398` —— 这是可以直接照抄的核心逻辑：

```rust
pub(crate) fn set_click_through(&self, click_through: bool) -> Result<(), OverlayError> {
    self.assert_owner_thread();
    unsafe {
        let click_through_style = WS_EX_TRANSPARENT.0 as isize | WS_EX_LAYERED.0 as isize;
        let mut style = GetWindowLongPtrW(self.hwnd, GWL_EXSTYLE);
        if click_through {
            style |= click_through_style;      // 开：加两个位
        } else {
            style &= !click_through_style;     // 关：清两个位
        }
        SetWindowLongPtrW(self.hwnd, GWL_EXSTYLE, style);
        SetWindowPos(
            self.hwnd, None, 0, 0, 0, 0,
            SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER,
        )
    }
}
```

**关键细节**：改完样式**必须**调 `SetWindowPos(..., SWP_FRAMECHANGED, ...)`
刷新缓存的非客户区状态，否则新样式不生效。
其余标志位的作用：`SWP_NOACTIVATE` 不激活、`SWP_NOMOVE/SWP_NOSIZE` 不动窗口、`SWP_NOZORDER` 不改层级。

### 1.4 命中测试（双保险）

`crates/bongocat-overlay/src/windows/window_proc.rs:98-105`：

```rust
WM_NCHITTEST => {
    let style = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
    if style & WS_EX_TRANSPARENT.0 as isize != 0 {
        return LRESULT(HTTRANSPARENT as isize);   // 穿透：鼠标交给下层
    }
    return LRESULT(HTCAPTION as isize);            // 非穿透：整窗当标题栏（可拖动）
}
```

**顺便学一招**：非穿透时返回 `HTCAPTION`，**整个窗口都能拖动**，不用自己写拖动逻辑
（`window_proc.rs:34` 注释说明右键拖动缩放也走这条路）。

### 1.5 悬停自动隐藏（额外的贴心功能）

`shared/config/contract.md:127-134` 记录了这个行为：

> `overlay.hide_on_pointer_hover` 默认 `false`，`hide_on_pointer_hover_delay_seconds` 默认 `0`（立即隐藏）。
> 开启后指针进入 overlay 窗口矩形并停留满延迟时间，**窗口渲染 alpha 在 300ms 内降到 0，
> 同时指针事件立即穿透**；指针离开后 alpha 在 300ms 内恢复，穿透状态回到 `overlay.click_through`。
> **窗口本身不隐藏、不销毁**，也不改变 runtime 的 overlay visibility。

> 这个设计很妙：**鼠标扫过猪时猪淡出**，不会挡住你想点的东西；移开又淡回来。
> 建议我们一并采纳（可作为独立开关）。

### 1.6 Bongo Cat 的 overlay 配置项全表

`shared/config/contract.md:50-58`（可直接作为我们的配置项设计参考）：

| 配置项 | 含义 | 默认 |
|---|---|---|
| `click_through` | **指针事件是否穿透** | `false` |
| `always_on_top` | 是否置顶 | — |
| `scale_percent` | 模型/窗口缩放 | — |
| `opacity_percent` | 窗口不透明度 | — |
| `maximum_fps` | 最大帧率 `[15, 240]` | — |
| `corner_radius_percent` | 圆角 `[0, 50]` | — |
| `hide_on_pointer_hover` | 悬停隐藏内容并临时穿透 | `false` |
| `hide_on_pointer_hover_delay_seconds` | 悬停隐藏延迟 `[0, 60]` | `0` |
| `keep_inside_screen` | 保持在屏幕内 | — |
| `system.show_taskbar_icon` | 任务栏按钮 | `false` |
| `system.show_status_icon` | 托盘/菜单栏图标 | — |

### 1.7 它到底有没有「快捷键」？

有，但分工与你的设想略有不同（`contract.md:125`、`:314`）：

| 入口 | 作用 |
|---|---|
| **快捷键 `toggle_overlay`** | 切换**模型窗口显隐**（隐藏/显示整只猫） |
| 设置页 / 右键菜单 | 切换 **`click_through`**（穿透模式） |
| `overlay.visible` | 是 **runtime 会话状态**，**不写入配置文件**，重启后恢复可见 |

> 注意最后一条：**可见性不持久化**，每次启动都以可见状态创建。
> 我们的「穿透模式」建议**持久化**（用户开了穿透就是想一直穿透），这点与 Bongo Cat 不同。

### 1.8 Bongo Cat 的架构（对我们的技术栈有参考意义）

`AGENTS.md` §1 明确：

> Rust 2024 桌面应用：**GPUI 设置 UI + Product/Live2D runtime**。Windows 用 **Raw Input、Win32、D3D11**。
> **不引入 Tauri、WebView、Node.js、JavaScript 或第二套 UI framework。**

**所以 Bongo Cat 的 9.71 MB 是「纯 Rust + 系统原生渲染」的成绩，不是 Tauri 的成绩。**

| | Bongo Cat | 我们的项目 |
|---|---|---|
| UI | GPUI（Rust 原生） | HTML/CSS（复用参考项目，**迁移成本低**） |
| 渲染 | Live2D + D3D11 自绘 | SVG + CSS（**更轻**） |
| 运行时 | 无 WebView | WebView2（**Win10+ 系统自带**） |
| 体积 | 9.71 MB | Tauri 预估 5–12 MB |

> **两条路都成立**：
> - 想要**极致轻量 + 已有 Rust 能力** → 纯 Rust（Bongo Cat 路线），但要重写 UI
> - 想要**复用现有 HTML/CSS 前端 + 开发快** → Tauri 2（**推荐**），WebView2 是系统组件不占安装包
>
> 我们选 Tauri 2 的理由：参考项目前端是零框架纯 DOM/CSS + SVG，**可近乎逐行迁移**；
> 业务逻辑 `packages/pet-core/` 是纯 ESM 无 DOM，可原样复用。

---

## 2. 我们要做的：三种交互模式

### 2.1 模式定义

| 模式 | 鼠标 | 猪的交互 | 气泡/面板 | 适用场景 |
|---|---|---|---|---|
| **① 互动模式**（默认） | 正常接收 | ✅ 可点、可拖、可右键 | ✅ 显示 | 平时养宠物 |
| **② 穿透模式**（悬浮） | **全部穿透** | ❌ 完全不可点 | ❌ 不显示 | **打游戏、全屏工作** |
| **③ 隐藏模式** | 无窗口 | ❌ | ❌ | 不想看见它 |

### 2.2 快捷键设计

| 快捷键 | 作用 | 说明 |
|---|---|---|
| `Ctrl+Alt+P` | **互动 ↔ 穿透 切换**（主快捷键） | 打游戏前按一下，猪就变成纯装饰悬浮着 |
| `Ctrl+Alt+H` | 显示 ↔ 隐藏 | 兜底，彻底不看 |
| 右键菜单 | 同上两项 | 不用记快捷键 |

> **热键注册注意**：Bongo Cat 用了 `RegisterHotKey` 风格的全局热键服务
> （`crates/bongocat-platform/src/shortcut/global/`）。
> 我们要注意**热键冲突**处理 —— 注册失败要明确告知用户并让用户改键
> （Bongo Cat 在 `contract.md` 里也提到「快捷键冲突写出实际 chord」）。

### 2.3 穿透模式下的行为细节（必须定义清楚）

| 项 | 行为 | 理由 |
|---|---|---|
| 动画 | **继续播放**（呼吸、眨眼） | 悬浮着的猪是「活着」的，这是桌宠的意义 |
| 气泡 | **不显示** | 会挡住游戏画面 |
| 状态条 HUD | **不显示**（或降到极简） | 同上 |
| 右键菜单 | 不可用（已穿透） | 用快捷键切回来 |
| 拖动 | 不可用（已穿透） | 同上 |
| 系统托盘 | **仍可用** | 唯一的兜底入口，必须保留 |
| 状态衰减 | **继续**（照常结算） | 猪还在活着 |
| 配置持久化 | **持久化** | 用户开了穿透就是想一直穿透 |

### 2.4 可选增强：悬停自动穿透（学 Bongo Cat）

| 项 | 建议值 |
|---|---|
| 开关 | `hide_on_pointer_hover`，默认 `false` |
| 延迟 | `0` 秒（立即） |
| 动画 | alpha 在 **300ms** 内降到 0，穿透**立即**生效 |
| 恢复 | 指针离开后 alpha 300ms 恢复，穿透回到用户设定值 |
| 窗口 | **不隐藏、不销毁**（只改 alpha 与穿透位） |

> 这个功能让猪在你不理它的时候「让路」，比手动切模式更无感。

---

## 3. Tauri 2 的对应实现

### 3.1 点击穿透 API

Tauri 2 提供 `set_ignore_cursor_events`：

```rust
// 整窗鼠标穿透
window.set_ignore_cursor_events(true)?;   // 开穿透
window.set_ignore_cursor_events(false)?;  // 关穿透
```

> 参考：[Tauri v2 クリックスルー](https://tauri.ninja/recipe.php?id=win-027)、
> [BongoCat Window Management](https://deepwiki.com/ayangweb/BongoCat/8.1-window-management)

**但要注意**：Tauri 的 `set_ignore_cursor_events` 在 Windows 上底层就是改
`WS_EX_TRANSPARENT | WS_EX_LAYERED`。Bongo Cat 那条「**只设 `WS_EX_TRANSPARENT` 不够**」的坑，
在 Tauri 里由框架处理；但如果你自己用 `windows` crate 改样式（为了更细的控制），
**必须两个位一起改**。

### 3.2 不抢焦点

```rust
// tauri.conf.json: 窗口配置
"focus": false,          // 不抢焦点
"alwaysOnTop": true,
"skipTaskbar": true,
"transparent": true,
"decorations": false,
"shadow": false,
"resizable": false
```

> 对应 Bongo Cat 的 `WS_EX_NOACTIVATE`。
> **这是硬约束 ② 的关键**：不抢焦点，游戏就不会因为点猪而 alt-tab。

### 3.3 建议的窗口样式组合（Windows）

| 项 | 值 | 来源 |
|---|---|---|
| 基础样式 | `WS_POPUP` | Bongo Cat `window.rs:120` |
| 扩展样式（始终） | `WS_EX_NOACTIVATE \| WS_EX_TOOLWINDOW` | 不抢焦点 + 不进任务栏 |
| 扩展样式（穿透时追加） | `WS_EX_TRANSPARENT \| WS_EX_LAYERED` | **必须成对** |
| 切换后调用 | `SetWindowPos(..., SWP_FRAMECHANGED \| SWP_NOACTIVATE \| SWP_NOMOVE \| SWP_NOSIZE \| SWP_NOZORDER, ...)` | 样式才生效 |
| 命中测试 | 穿透 → `HTTRANSPARENT`；否则 → `HTCAPTION`（整窗可拖） | `window_proc.rs:98-105` |

---

## 4. 全屏检测还需要吗？—— 降级为「可选增强」

有了穿透模式，全屏检测从「**必需**」降级为「**锦上添花**」：

| 方案 | 定位 | 建议 |
|---|---|---|
| **穿透模式 + 快捷键** | **主方案（必须做）** | 用户可控、零误判、实现简单 |
| 悬停自动穿透 | 体验增强（建议做） | 学 Bongo Cat |
| 全屏检测自动切换模式 | 可选增强（二期再做） | 检测到全屏 → 自动进穿透模式，切回桌面自动恢复 |

**如果二期要做全屏检测**，`analysis/E-lightweight-fullscreen.md` 里已有完整方案与实测数据
（几何快路径 2 Hz + `SHQueryUserNotificationState` 慢路径 0.2 Hz，以及三个必踩的 DPI 坑）。
**但现在不需要为了它推迟上线。**

> ⚠️ 注意：即使用了穿透模式，**仍然建议保留全屏检测的一个子用途** ——
> **FSO 无边全屏下桌宠会盖在游戏画面上**（见 E 报告 §2.2）。
> 穿透模式解决的是「挡鼠标」，**不解决「挡画面」**。
> 所以如果用户希望打游戏时**完全看不见**猪，还是需要检测 → 自动隐藏。

---

## 5. 对主文档的修订建议

| 原文档位置 | 修订 |
|---|---|
| `桌宠功能清单.md` §7.2（全屏冲突） | **降级**为「可选增强」，新增「穿透模式」为主方案 |
| §2.1 功能点表 #13 | 「全屏应用检测与让位」→ 改为「**穿透模式 + 快捷键**（主）+ 全屏检测（可选）」 |
| §2.1 新增 | 「模式切换快捷键」「悬停自动穿透」「整窗可拖动（`HTCAPTION`）」 |
| §10.1 验收标准 | 新增：穿透模式下**任何**点击都落到下层窗口；不抢焦点；热键冲突有明确提示 |
| `PROJECT-REF.md` §0 | 记录本次决策 |

---

## 6. 待你确认

> ✅ **已全部确认**：
> - ~~M2 穿透模式下动画继续播还是冻结~~ → **继续播放**（悬浮的活猪才有意义）
> - ~~M4 快捷键用哪两个~~ → **可自定义**，默认 `Ctrl+Alt+P` / `Ctrl+Alt+H`
> - ~~M1 穿透模式默认值~~ → **默认互动**
> - ~~M3 悬停自动穿透~~ → **一期做**
> - ~~M5 全屏检测~~ → **二期做**

| # | 问题 | 最终决策 |
|---|---|---|
| M1 | 穿透模式**默认值** | ✅ **默认互动**（新用户先看见猪） |
| M2 | 穿透模式下动画 | ✅ **继续播放**（帧率可降到 15–30fps 省电） |
| M3 | 悬停自动穿透 | ✅ **一期做** |
| M4 | 快捷键 | ✅ **可自定义**，默认 `Ctrl+Alt+P` / `Ctrl+Alt+H` |
| M5 | 全屏检测 | ✅ **二期做** |

**一期范围（本设计相关）**：互动模式 + 穿透模式 + 两个快捷键 + 悬停自动穿透 + 托盘兜底。
**二期范围**：全屏检测自动隐藏（解决「挡画面」，见 §4）。

---

## 7. 已确认决策的落地细节

### 7.1 穿透模式下动画继续播放

**决定**：穿透模式下**所有动画照常播放**（呼吸、眨眼、待机动作）。

| 项 | 行为 |
|---|---|
| 动画 | ✅ **继续播放** |
| 气泡 / HUD | ❌ 不显示（会挡游戏画面） |
| 交互 | ❌ 不可点、不可拖（已穿透） |
| 状态衰减 | ✅ 继续结算 |
| 帧率 | 可降到较低档省电，**但不停** |

> **省电补充**：既然动画不停，更要做好降频 —— 建议穿透模式下把帧率降到
> `maximumFps` 的低档（Bongo Cat 的 `maximum_fps` 范围是 `[15, 240]`，默认可用 30）。
> 配合「窗口被遮挡/失焦时暂停」策略，空闲占用依然可控。

### 7.2 快捷键可自定义

**决定**：默认 `Ctrl+Alt+P`（互动↔穿透）、`Ctrl+Alt+H`（显示↔隐藏），**用户可改键**。

| 项 | 设计 |
|---|---|
| 默认值 | `Ctrl+Alt+P` / `Ctrl+Alt+H` |
| 自定义 | 设置页提供改键入口，写入配置文件 |
| **冲突检测** | 注册失败时**明确提示实际冲突的 chord**，并允许立即改键 |
| 持久化 | 用户改过的键写入配置，重启保持 |
| **兜底** | 即使两个快捷键都冲突，**托盘菜单**仍可切换模式 |

> ⚠️ **热键冲突必须处理，不能静默吞掉**：Bongo Cat 也把这条写进了 contract
> （「快捷键冲突写出实际 chord」）。用户按了没反应会以为是 bug。

### 7.3 建议的配置项（照抄 Bongo Cat 的成熟设计）

```jsonc
{
  "overlay": {
    "clickThrough": false,           // 穿透模式（我们做持久化，与 Bongo Cat 不同）
    "alwaysOnTop": true,
    "maximumFps": 30,                // 穿透模式下可降到 15
    "hideOnPointerHover": false,     // 悬停自动穿透（建议一期做）
    "hideOnPointerHoverDelaySeconds": 0,
    "keepInsideScreen": true,
    "opacityPercent": 100,
    "scalePercent": 100
  },
  "shortcuts": {
    "toggleClickThrough": "Ctrl+Alt+P",
    "toggleVisibility": "Ctrl+Alt+H"
  },
  "system": {
    "showTrayIcon": true,            // 必须 true —— 唯一兜底入口
    "showTaskbarIcon": false,
    "launchAtLogin": false           // 待定（Q6）
  }
}
```
