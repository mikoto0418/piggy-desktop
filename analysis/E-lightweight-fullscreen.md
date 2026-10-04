# E · 轻量化与全屏冲突技术方案

> 任务：`task-5`（E · 轻量化与全屏冲突技术方案）
> 作者：perf-analyst
> 结论基于：**本机实测**（Windows 11 build 26100 / i7-14650HX / 31.8 GB / 2560×1600 @150%）+ **官方文档/一手来源**。
> 证据分级：🟢 本机实测 ｜ 🔵 官方文档 ｜ 🟡 官方发布物元数据（Content-Length / npm-PyPI registry） ｜ 🔴 估算（未实测，已标注）

---

## 〇、证据基线与复现环境

| 项 | 值 |
|---|---|
| 机器 | Intel Core i7-14650HX / 31.8 GB RAM / Windows 11 家庭版 中文版 build 26100 |
| 主显示器 | 2560×1600 @ **150%** 缩放（DPI 144），工作区 2560×1528 |
| Node / npm / pnpm | v24.11.1 / 11.6.2 / 9.15.1 |
| .NET SDK | 8.0.418（含 WindowsDesktop.App 8.0.5 运行时） |
| Python | 3.10.9（tkinter 可用；PySide6 未安装） |
| 参考项目锁定版本 | Electron **44.5.1**（`_ref/package.json`） |
| 验证过的库 | `koffi@3.3.2` |

**所有 `_ref` 路径均相对 `F:\piggy\_ref`；本方案未修改 `_ref` 下任何文件。**

### 本地实验产物（临时目录，已清理）

| 实验 | 位置 | 结论 |
|---|---|---|
| koffi FFI 全屏检测器 | `%TEMP%\koffi-probe` | 检测器跑通，写入本文档的代码骨架即此版本 |
| Electron 44.5.1 常驻实测 | `%TEMP%\electron-probe` | 367 MB 磁盘 / 302 MB 内存（见 §5） |
| .NET WPF 自包含体积 | `%TEMP%\dotnet-probe` | 160 MB 目录 / 72.8 MB 单文件（见 §5） |

---

## 一、结论速览

### 1.1 推荐技术栈

> **Electron 直接出局。** 它违反约束①：官方 win32-x64 发布包 **150.68 MB**，解包后 **367.10 MB**（`electron.exe` 单文件 234.34 MB），一只桌宠空闲常驻 **299–302 MB**（4 个进程）。这不是调优能解决的量级问题。

| 排序 | 方案 | 安装包 | 常驻内存 | 理由 |
|---|---|---|---|---|
| **首选** | **Tauri 2 + WebView2** | 🟡 官方称最小可 **< 600 KB**，实际桌宠预估 **5–12 MB**（🔴估算） | 🔴 未实测（见 §5.4 验收必测） | 现有前端是**零框架纯 DOM/CSS + SVG**，可近乎逐行迁移；Win32 全屏检测在 Rust 里用 `windows` crate **原生调用，零 FFI 层、零额外体积** |
| 次选 | Rust + 原生 Win32/DirectComposition（无 WebView2） | 🔴 **1.5–3 MB** 单 exe（估算） | 🟡 参照同类单进程：**15–30 MB** | 唯一无外部运行时依赖的选项；代价是必须重写 241 KB 的 `client.js` UI |
| 不推荐 | Python + PySide6 | 🟡 PySide6-Essentials wheel **73.35 MB**；PyInstaller 打包后 **≈80–150 MB** | 🟢 tkinter 版单进程 **37.2 MB**（PySide6 更高，未实测） | RAM 意外地好，但 wheel/打包体积大、逐像素 alpha 需 Qt、生态与前端资产（SVG/DOM 动画）不匹配 |
| **淘汰** | Electron 44.5.1（参考项目现状） | 🟡 **150.68 MB** zip / 🟢 **367.10 MB** 磁盘 | 🟢 **299–302 MB** | 见上 |
| **淘汰** | .NET WPF / WinUI3 | 🟢 自包含 **160.07 MB** 目录 / 单文件压缩 **72.84 MB**；框架依赖仅 0.16 MB 但要求用户预装桌面运行时 | 🔴 未实测 | **WPF 明确不支持裁剪**（`NETSDK1168`），无法压到轻量级 |

**分阶段落地建议**：
1. **阶段一（必须）**：把 §3 的全屏检测 + §7 的调度优化做成与运行时无关的独立模块（本文档代码骨架可直接跑），先在现有 Electron 外壳里验证行为，同时用 §8 的验收标准量化。
2. **阶段二（满足约束①的前提）**：把 `client.js` 前端迁到 Tauri 2。因为 UI 是零框架的，迁移主要是替换 `window.piggyShell` 这一层桥（`_ref/apps/desktop/preload.cjs` 只有 1 个 `setShape` 通道 + 几何通道），业务逻辑 `packages/pet-core/` 是纯 ESM 无 DOM，可原样复用。

### 1.2 推荐全屏方案

> **双层轮询：几何探测做快路径（2 Hz，成本 0.0016% 单核），`SHQueryUserNotificationState` 做慢路径（0.2 Hz，补几何看不见的状态）。**

这个结论与直觉相反，是本任务最重要的实测发现：

| 检测手段 | 🟢 实测单次成本 | 相对成本 |
|---|---|---|
| `SHQueryUserNotificationState`（官方"标准答案"） | **155–188 µs**（中位 ≈168 µs） | 基准 |
| 完整几何探测（5 个 Win32 调用） | **1.9–3.9 µs**（中位 ≈2.1 µs） | **快约 80 倍** |
| 仅 `GetForegroundWindow` + `GetWindowRect` | **≈0.78 µs** | 快约 215 倍 |

原因：`SHQueryUserNotificationState` 是 shell32 里的查询，内部要走一遍 shell 状态；而几何探测只是读内核/桌面窗口管理器的几个结构体。原生 C# 计时，20000 次 × 5 轮，预热后取中位。

**因此不要"照抄官方 API 每 200 ms 轮询一次"** —— 那样每次 168 µs，2 Hz 下是 0.34 ms/s（仍然很小，但完全可以避免），而几何探测 2 Hz 只有 0.0095 ms/s。

### 1.3 三个必须知道的坑（都会导致线上现形）

| # | 坑 | 实测证据 | 后果 |
|---|---|---|---|
| 1 | **DPI 坐标系混用** | 🟢 DPI-unaware 进程里 `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)` 返回**物理**像素 2560×1528，`GetMonitorInfo` 返回**虚拟化**像素 1707×1067。直接比较 → 一个**最大化窗口被判成全屏**（假阳性） | 猪在普通最大化窗口前无故消失 |
| 2 | **`GetWindowRect` 含隐形边框** | 🟢 最大化的 Chrome：`GetWindowRect` = 2582×1550 @(-11,-11)，真实可见框 = 2560×1528 @(0,0) | 用 `GetWindowRect` 做"是否铺满"会误判；必须用 DWM 扩展边框 |
| 3 | **`QUERY_USER_NOTIFICATION_STATE` 是 1-based** | 🔵 官方 enum 从 `QUNS_NOT_PRESENT = 1` 开始。我第一版按 0-based 映射，把 `QUNS_ACCEPTS_NOTIFICATIONS(5)` 读成了 `QUNS_QUIET_TIME` | 状态判断整体错位 |

### 1.4 成本极低的两个"兜底"事实

- 🟢 `powershell.exe` 外壳调用方案**彻底不可行**：`powershell.exe -NoProfile -Command "exit 0"` 冷启动 **1190–1319 ms**；真正跑一次检测脚本（`Add-Type` 编译 P/Invoke + 调用）**1694 ms**。对比进程内 FFI 的 0.005 ms，慢 **30 万倍**。`pwsh.exe` 也要 347 ms。**"无依赖 PowerShell 方案"必须从候选里划掉。**
- 🟢 给 Electron 加 FFI 的代价小到可以忽略：`koffi@3.3.2` 安装后 `node_modules` 共 **2.64 MB**（`koffi` 1.64 MB + `@koromix/koffi-win32-x64` 1.00 MB），**只有 1 个预编译 `.node`（1020 KB），`build/` 目录数 0，不需要 node-gyp / MSVC / electron-rebuild**，`npm install` 耗时 2.6 s。

---

## 二、全屏冲突：问题本质与候选方案对比

### 2.1 先确认：参考项目确实没有全屏逻辑

🟢 grep 证据（对 `F:\piggy\_ref` 全库）：

```
pattern: (?i)fullscreen|full-screen|kiosk|isFullScreen|setFullScreen|
         SHQueryUserNotificationState|QUNS_|monitorFromPoint|workArea
命中 27 行，逐条归类后：
  · 绝大多数是 workArea —— 窗口几何夹取/锚定（main.js:146-147,178,229,244,277,452；
    shell.js:49-54；window.test.js）
  · effects.js:31 注释 "Full-screen promotion effect"（进化特效，与窗口无关）
  · client.test.js:2227 测试名里的 "full-screen emoji effect"（同上）
  · _ref/docs/tasks/C-round.md 里讨论的是 workArea 夹取

zero-match 子模式：kiosk / isFullScreen / setFullScreen /
                  SHQueryUserNotificationState / QUNS_
```

对照 `_ref/apps/desktop/main.js` 全文，窗口相关的 API 只用了 `setAlwaysOnTop(true,'floating')`(L192)、`setShape`(L173)、`showInactive`(L198)、`setBounds`(L161)，**没有任何"前台窗口是谁"的查询**。

**结论：全屏检测需要从零做，`PROJECT-REF.md` §7 的判断成立。**

### 2.2 问题本质：Windows 上有三种"全屏"，行为完全不同

🔵 微软 DirectX 官方博客《Demystifying Fullscreen Optimizations》明确：Windows 10 起引入 **Fullscreen Optimizations（FSO）**，把原本的全屏独占（FSE）游戏**改为"高度优化的无边窗口化"**运行，以获得 alt-tab 更快、多显示器、overlay 可用等好处。原文：

> "With the release of Windows 10, we added Fullscreen Optimizations – which takes full screen exclusive games and runs them instead in a highly optimized borderless windowed format that takes up the entire screen."
> —— <https://devblogs.microsoft.com/directx/demystifying-full-screen-optimizations/>

这直接决定了三种模式的检测难度：

| 模式 | DWM 合成？ | 置顶窗口（桌宠）表现 | 几何探测能测到？ | QUNS 返回 |
|---|---|---|---|---|
| **FSO 无边全屏**（Win10+ 默认，绝大多数游戏） | 是 | 会被合成在游戏之上 → **桌宠会盖在游戏画面上**，正是"冲突"的主要来源 | ✅ 能（窗口铺满整个显示器） | `QUNS_BUSY (2)` |
| **真·独占全屏 FSE**（FSO 关闭 / 部分 DX12、Vulkan） | 否，独占显示输出 | 桌宠**不会被画出来**（DWM 不合成），但可能造成 alt-tab 抖动 / 抢焦点 | ❌ 不能可靠判断 | 理论上 `QUNS_RUNNING_D3D_FULL_SCREEN (3)`，**实测常退化为 `QUNS_BUSY (2)`** |
| **无边窗口化 / 最大化** | 是 | 桌宠正常置顶 | ❌ 不应判为全屏（最大化只铺满 **工作区**，不盖任务栏） | `QUNS_ACCEPTS_NOTIFICATIONS (5)` |

🔵 关于 `QUNS_RUNNING_D3D_FULL_SCREEN` 在实践中经常拿不到，微软官方 Q&A 有同题记录（`SHQueryUserNotificationState returns QUNS_BUSY instead of QUNS_RUNNING_D3D_FULL_SCREEN for full-screen games`），社区结论指向 FSO：<https://learn.microsoft.com/en-us/answers/questions/1086527/shqueryusernotificationstate-returns-quns-busy-ins>

🟢 **本机复现了这个现象**：我创建一个铺满整个显示器（2560×1600，含任务栏区域）的无边框 TopMost 窗口后，QUNS 从 5 变成 **2（QUNS_BUSY）**，而不是 3（D3D_FULL_SCREEN）；关闭后回到 5。因为我的测试窗口不是独占 D3D 应用。

> **设计含义：`QUNS_BUSY` 必须和 `QUNS_RUNNING_D3D_FULL_SCREEN` 同等对待。** 只判 3 会漏掉绝大多数真实场景。

### 2.3 Windows 的置顶层级：`setAlwaysOnTop` 的 level 在实际表现

🔵 Electron 官方文档 `win.setAlwaysOnTop(flag[, level][, relativeLevel])`（<https://www.electronjs.org/docs/latest/api/browser-window#winsetalwaysontopflag-level-relativelevel>）原文：

> * `level` string (optional) _macOS_ _Windows_ - Values include `normal`, `floating`, `torn-off-menu`, `modal-panel`, `main-menu`, `status`, `pop-up-menu`, `screen-saver`, and ~~`dock`~~ (Deprecated). The default is `floating` when `flag` is true. The `level` is reset to `normal` when the flag is false. **Note that from `floating` to `status` included, the window is placed below the Dock on macOS and below the taskbar on Windows. From `pop-up-menu` to a higher it is shown above the Dock on macOS and above the taskbar on Windows.**

**在 Windows 上的实际语义（关键结论）：**

| level | Windows 实际行为 |
|---|---|
| `normal` | 普通窗口 |
| `floating`（**参考项目用的就是这个**）～ `status`（含） | 置顶，但**在任务栏之下** |
| `pop-up-menu` ～ `screen-saver` | 置顶，且**在任务栏之上** |
| `relativeLevel` | **仅 macOS**（文档明确标注 _macOS_），Windows 上传了也没用 |

**也就是说：Windows 上这 8 个 level 实际只压缩成 2 档 ——"任务栏之下"和"任务栏之上"。** 它们**不提供**"高于全屏游戏"的独立层级，因为 Windows 只有一个 topmost 带（band），同带内按 z-order 排序。所以**指望调 level 来躲开全屏游戏是行不通的**，必须做检测 + 主动隐藏。

🟡 另外，Electron 官方文档注明 `setVisibleOnAllWorkspaces` **在 Windows 上什么都不做**（`win.visibleOnAllWorkspaces` "Always returns false on Windows"），所以"全工作区可见"这条路在 Windows 也不通。

**对参考项目的具体影响**：`_ref/apps/desktop/main.js:192` 用的是 `floating`，即**猪在任务栏之下**。这本身是个可选的产品决定（猪不会挡住任务栏/开始菜单），但也意味着开始菜单弹出时猪会被盖住。若要猪在任务栏之上（更像"桌宠"），应改为 `'pop-up-menu'`。**这是一个独立于全屏检测的天真选择，建议单独决策。**

### 2.4 候选方案横向对比

| # | 方案 | 可行性 | 依赖体积 | 引入原生模块 | 维护成本 | 判定 |
|---|---|---|---|---|---|---|
| **S1** | `display.bounds` vs `workArea` 比较 | ❌ **不可行** | 0 | 否 | — | **排除**。`bounds` 是显示器物理区域、`workArea` 是扣掉任务栏的可用区，二者差异只反映**任务栏**，不反映"是否有别家应用全屏"。而且任务栏自动隐藏时二者相等，另一个方向也会误判 |
| **S2** | `GetForegroundWindow` + `GetWindowRect` 与显示器尺寸比较 | ⚠️ 可行但有假阳性 | 0（Electron 内置）或 +2.64 MB（koffi） | 是（要读 Win32） | 低 | 可与 S3 合并；单独用不行（坑 2） |
| **S3** | 前台窗口 **DWM 扩展边框** vs 该窗口所在显示器的 `rcMonitor` | ✅ **推荐（快路径）** | 0（Electron 内置）或 +2.64 MB | 是 | 低 | 🟢 实测通过（见 §3.2） |
| **S4** | `SHQueryUserNotificationState`（QUNS） | ✅ **推荐（慢路径）** | +2.64 MB | 是 | 低 | 🟢 实测能正确跟随全屏状态；能补 S3 看不见的"屏保/锁屏/演示模式" |
| **S5** | 调用 PowerShell 子进程执行 P/Invoke | ❌ **不可行** | 0 | 否 | — | 🟢 实测单次 **1694 ms**，是进程内 FFI 的 **30 万倍**。1.4 秒的检测延迟在"切回桌面 1 秒内恢复"这条验收上直接失败 |
| **S6** | `ffi-napi` | ❌ **不推荐** | 🟡 6.94 MB / **621 个文件** | 是，且需 node-gyp 编译 | **高** | 需 MSVC + `electron-rebuild`，Electron 每次大版本升级都要重编；社区维护停滞（最新 4.0.3） |
| **S7** | `koffi` | ✅ **推荐** | 🟡 **2.64 MB**（1 个预编译 `.node`） | 是（但是预编译 N-API） | **低** | 🟢 实测 2.6 s 装完，零编译，无需 node-gyp |
| **S8** | `notification-state-ffi` 之类的现成小包 | ⚠️ 可以但不必 | 未知 | 是 | 中（第三方小包长期维护风险） | 功能等价于 S4，不如直接写 25 行 koffi 代码（本文档已给） |
| **S9** | Rust/Tauri 里直接用 `windows` crate 调 user32/shell32 | ✅ **最佳（迁移后）** | 0（编译进二进制） | 否（是原生代码本身） | 低 | 无 FFI 层，无额外体积 |
| **S10** | 不做检测：非独占全屏时置顶 + 热键手动隐藏 | ⚠️ 兜底 | 0 | 否 | 极低 | **Plan B**，见 §4 |

### 2.5 其它"不打扰"手段的定位

这些**不能替代检测**，但都是检测之外的必备补充：

| 手段 | API | 作用 | 出处 |
|---|---|---|---|
| 像素级点击穿透 | `win.setShape(rects)` | "Outside of the given region, no pixels will be drawn and no mouse events will be registered. Mouse events outside of the region will not be received by that window, but will fall through to whatever is behind the window." —— 官方原文，正是桌宠要的效果 | 🔵 <https://www.electronjs.org/docs/latest/api/browser-window#winsetshaperects-windows-linux-experimental> |
| 整窗鼠标穿透 | `win.setIgnoreMouseEvents(ignore[, {forward}])` | 全窗忽略鼠标，点击落到下层窗口。**注意：窗口仍有焦点时仍会收到键盘事件** | 🔵 <https://www.electronjs.org/docs/latest/api/browser-window#winsetignoremouseeventsignore-options> |
| 不进任务栏 | `setSkipTaskbar(true)`（构造项 `skipTaskbar`） | 桌宠不该在任务栏留条目 | 🔵 同上页 |
| 不抢焦点 | `win.showInactive()` | "Shows the window but doesn't focus on it." 参考项目已用 | 🔵 <https://www.electronjs.org/docs/latest/api/browser-window#winshowinactive> |
| 暂停渲染 | `win.hide()` + Page Visibility | 官方建议："It is recommended that you pause expensive operations when the visibility state is `hidden`" | 🔵 <https://www.electronjs.org/docs/latest/api/browser-window#page-visibility> |
| 锁屏/休眠感知 | `powerMonitor` | Windows 上可用事件：`suspend` `resume` `on-ac` `on-battery` `lock-screen` `unlock-screen`；另有 `isOnBatteryPower()` / `getSystemIdleState()` | 🔵 <https://www.electronjs.org/docs/latest/api/power-monitor> |
| 帧率上限 | `webContents.setFrameRate(fps)` | 参考项目用 30，注释写明"Windows 上每帧合成整窗的代价高" | 🟢 `_ref/apps/desktop/main.js:31-32,194` |
| 屏幕捕获排除 | `win.setContentProtection(true)` | 可选：让猪不出现在录屏/直播里（`WDA_EXCLUDEFROMCAPTURE`） | 🔵 同 BrowserWindow 页 |

---

## 三、推荐全屏方案详解（含代码骨架）

### 3.1 判定算法

```
每 500 ms 执行一次（快路径）：
  1. hwnd = GetForegroundWindow()
     若 hwnd == 0 → 视为"不忙"，返回
     若 GetWindowThreadProcessId(hwnd) == 本进程 → 忽略（防自触发）
  2. cls = GetClassName(hwnd)
     若 cls ∈ SHELL_CLASSES（Progman / WorkerW / Shell_TrayWnd /
        Shell_SecondaryTrayWnd / Windows.UI.Core.CoreWindow /
        XamlExplorerHostIslandWindow / MultitaskingViewFrame …）
        → 视为"不忙"（桌面本身、开始菜单、任务视图不是"应用全屏"）
  3. DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED) != 0 → 忽略（被 DWM 遮蔽的 UWP 幽灵窗口）
  4. frame = DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS)
     mon   = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST)
     rcMon = GetMonitorInfo(mon).rcMonitor
     ✅ 用同一个坐标系比较（见 §3.2 坑 1）
     若 frame 覆盖 rcMon（容差 tol=0..2 px）→ 判定"全屏"
        ※ 可选策略：若猪在另一块显示器上，可选择不隐藏（见 3.5）

每 5 s 执行一次（慢路径）：
  state = SHQueryUserNotificationState()
  1 QUNS_NOT_PRESENT            → 隐藏（屏保/锁屏/非活动快速用户切换会话）
  2 QUNS_BUSY                   → 隐藏（有无边全屏应用，或启用了演示设置）
  3 QUNS_RUNNING_D3D_FULL_SCREEN→ 隐藏（独占 D3D 全屏）
  4 QUNS_PRESENTATION_MODE      → 隐藏（演示设置）
  5 QUNS_ACCEPTS_NOTIFICATIONS  → 不隐藏
  6 QUNS_QUIET_TIME             → 不隐藏（※注意语义，见下）
  7 QUNS_APP                    → 不隐藏

去抖（两条路径共用）：
  · 隐藏：连续 2 次判定"忙"（≥1 个快路径周期）才隐藏
  · 恢复：连续 2 次判定"不忙"才恢复
  · 用户正在拖动猪 / 面板打开中 → 推迟隐藏判定 1 个周期
```

🔵 **`QUNS_QUIET_TIME` 不是"专注助手/勿扰"**，官方定义是"新用户首次登录后的第一个小时"，以及每次 OS 升级或全新安装之后。原文见 <https://learn.microsoft.com/en-us/windows/win32/api/shellapi/ne-shellapi-query_user_notification_state>：

> `QUNS_QUIET_TIME` Value: _6_ — **Introduced in Windows 7**. The current user is in "quiet time", which is the first hour after a new user logs into his or her account for the first time.

而且官方特别说明：**若同时处于其它被屏蔽状态（`QUNS_NOT_PRESENT` / `QUNS_BUSY` / `QUNS_PRESENTATION_MODE` / `QUNS_RUNNING_D3D_FULL_SCREEN`），函数只返回那个状态，不会返回 `QUNS_QUIET_TIME`**。这意味着 `QUIET_TIME` 一定不是"有应用全屏"，所以**不隐藏**是对的。

### 3.2 三个坑的实测细节（务必照做）

#### 坑 1：DPI 坐标系混用 → 假阳性（最危险）

🟢 实测（同一台机器，同一时刻，同一个被最大化的 Chrome 窗口）：

| 进程 DPI 感知 | `DwmGetWindowAttribute(EXTENDED_FRAME_BOUNDS)` | `GetMonitorInfo().rcMonitor` | 判定 `frame ⊇ rcMon` | 正确？ |
|---|---|---|---|---|
| **DPI-unaware**（裸 node.exe / powershell.exe） | 2560×1528 @(0,0)（**物理**像素） | 1707×1067 @(0,0)（**虚拟化**像素，= 物理 ÷ 1.5） | `true` | ❌ **假阳性**：把最大化窗口当成全屏 |
| **PER_MONITOR_AWARE_V2** | 2560×1528 @(0,0) | 2560×1600 @(0,0) | `false` | ✅ 正确 |

修复方式（二者取一）：
1. 进程启动时调用 `SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 /* -4 */)`；
2. 或全程混用会出错的两个 API 中**只用同一族**：要么全用 Win32（都是物理像素），要么把 DWM 结果用 `screen.screenToDipRect()` 换算成 DIP 再和 `screen` 模块比。

🔵 **Electron 主进程本身是 per-monitor DPI 感知的，所以第 1 条自动成立**——但由此引出**新**的坑：**Electron 的 `screen` 模块返回 DIP，裸 Win32 返回物理像素，两者不能混用。** 🟢 实测确认：同一个 2560×1600 显示器上，Electron 报 `scaleFactor=1.5`、`workArea={0,0,1707,1019}`、`bounds={0,0,1707,1067}`（DIP），而 Win32 报 rcMonitor=2560×1600、rcWork 高 1528（物理）。🔵 `screen` 模块文档也明确区分 "Physical screen points" 与 "Device-independent pixel (DIP) points"，并提供 `screen.screenToDipRect()` / `screen.dipToScreenRect()`（Windows）。出处：<https://www.electronjs.org/docs/latest/api/screen>

> **本方案的对策：检测器全程只用 Win32，一个坐标系，不碰 `screen.*`。** 隐藏/恢复用 `win.hide()` / `win.showInactive()`，与坐标无关。§3.3 的骨架已按此实现。

#### 坑 2：`GetWindowRect` 含不可见边框

🟢 实测：最大化的 Chrome，`GetWindowRect` = 2582×1550 @(**-11**,-11)，而 DWM 扩展边框 = 2560×1528 @(0,0)。差 ~11 px 的不可见调整边框。

**后果**：若用 `GetWindowRect` 和 `rcMonitor` 比，会得到"比显示器还大"的荒谬结果，从而在任何方向上都更容易假阳性。

> **对策：一律用 `DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS /* 9 */)` 取"用户实际看到的框"，用 `GetWindowRect` 只作降级兜底。**

#### 坑 3：QUNS 的 enum 是 1-based

🔵 官方定义（`shellapi.h`）：

```c
typedef enum {
  QUNS_NOT_PRESENT = 1, QUNS_BUSY = 2, QUNS_RUNNING_D3D_FULL_SCREEN = 3,
  QUNS_PRESENTATION_MODE = 4, QUNS_ACCEPTS_NOTIFICATIONS = 5,
  QUNS_QUIET_TIME = 6, QUNS_APP = 7
} QUERY_USER_NOTIFICATION_STATE;
```

出处：<https://learn.microsoft.com/en-us/windows/win32/api/shellapi/ne-shellapi-query_user_notification_state>（函数本体：<https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shqueryusernotificationstate>）

> **对策：映射表写成 `[null,'NOT_PRESENT','BUSY','D3D_FULL_SCREEN','PRESENTATION_MODE','ACCEPTS_NOTIFICATIONS','QUIET_TIME','APP']`，或直接按常量名比对。调用后必须检查返回的 `HRESULT`（正常为 `S_OK` = 0），非 0 时退回几何路径。**

### 3.3 代码骨架（已在 Electron 44.5.1 / Node 24 / koffi 3.3.2 上跑通）

**依赖**：`npm i koffi`（🟡 2.64 MB，1 个预编译 `.node`，零编译）。

#### `apps/desktop/lib/fullscreen-win32.mjs`（Windows 主进程侧）

```js
// @ts-check
/**
 * 全屏检测（Windows）。纯 Win32，一个坐标系（物理像素），不依赖 Electron screen 模块。
 * 依赖：koffi（预编译 N-API，无需 node-gyp）。
 */
import koffi from 'koffi'

const user32 = koffi.load('user32.dll')
const shell32 = koffi.load('shell32.dll')
const dwmapi = koffi.load('dwmapi.dll')
const kernel32 = koffi.load('kernel32.dll')

const RECT = koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' })
const MONITORINFO = koffi.struct('MONITORINFO', {
  cbSize: 'uint32', rcMonitor: RECT, rcWork: RECT, dwFlags: 'uint32',
})
const RECT_SIZE = koffi.sizeof(RECT)
const MONITORINFO_SIZE = koffi.sizeof(MONITORINFO)

const GetForegroundWindow = user32.func('void *GetForegroundWindow()')
const GetWindowRect = user32.func('bool GetWindowRect(void *h, _Out_ RECT *r)')
const GetClassNameA = user32.func('int GetClassNameA(void *h, _Out_ uint8_t *buf, int n)')
const MonitorFromWindow = user32.func('void *MonitorFromWindow(void *h, uint32 flags)')
const GetMonitorInfoA = user32.func('bool GetMonitorInfoA(void *m, _Inout_ MONITORINFO *mi)')
const DwmGetWindowAttributeRect = dwmapi.func(
  'int DwmGetWindowAttribute(void *h, uint32 attr, _Out_ RECT *v, uint32 size)')
const DwmGetWindowAttributeInt = dwmapi.func(
  'int DwmGetWindowAttribute(void *h, uint32 attr, _Out_ int *v, uint32 size)')
const SHQueryUserNotificationState = shell32.func(
  'int SHQueryUserNotificationState(_Out_ int *state)')
const SetProcessDpiAwarenessContext = user32.func(
  'bool SetProcessDpiAwarenessContext(intptr ctx)')
const GetWindowThreadProcessId = user32.func(
  'uint32 GetWindowThreadProcessId(void *h, _Out_ uint32 *pid)')

// ---- 常量 ----
const DWMWA_EXTENDED_FRAME_BOUNDS = 9
const DWMWA_CLOAKED = 14
const MONITOR_DEFAULTTONEAREST = 2
const DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4   // 见 §3.2 坑 1

/** QUERY_USER_NOTIFICATION_STATE —— **1-based**，见 §3.2 坑 3。 */
const QUNS = ['?', 'NOT_PRESENT', 'BUSY', 'D3D_FULL_SCREEN',
  'PRESENTATION_MODE', 'ACCEPTS_NOTIFICATIONS', 'QUIET_TIME', 'APP']
/** "忙"的状态：全屏应用 / 独占全屏 / 演示设置 / 屏保或锁屏。 */
const QUNS_BUSY_STATES = new Set([1, 2, 3, 4])

/** 覆盖整屏但不算"应用全屏"的 shell 窗口类名。 */
const SHELL_CLASSES = new Set([
  'Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd',
  'Windows.UI.Core.CoreWindow', 'XamlExplorerHostIslandWindow',
  'MultitaskingViewFrame', 'ForegroundStaging',
  'ApplicationManager_DesktopShellWindow',
])

// 只调用一次；Electron 主进程已经是 PMv2，这里返回 false 属正常（已被上游设置过）。
let dpiReady = false
export function ensureDpiAware() {
  if (dpiReady) return
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)
  dpiReady = true
}

/** 读 QUNS；失败返回 0（"未知"，不当作忙）。 */
export function queryUserNotificationState() {
  const out = [0]
  const hr = SHQueryUserNotificationState(out)
  if (hr !== 0 || out[0] < 1 || out[0] > 7) return 0
  return out[0]
}

function className(hwnd) {
  const buf = Buffer.alloc(256)
  GetClassNameA(hwnd, buf, 256)
  return buf.toString('ascii').replace(/\0[\s\S]*$/, '')
}

function windowMonitorRect(hwnd) {
  const mon = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST)
  if (mon === null) return null
  const mi = { cbSize: MONITORINFO_SIZE }
  if (!GetMonitorInfoA(mon, mi)) return null
  return mi.rcMonitor
}

/**
 * 几何探测：前台窗口是否铺满它所在的那块显示器。**唯一快路径。**
 * @param {{ ignorePid?: number }} [opts] 忽略自家进程的窗口（防自触发）
 * @returns {{ fullscreen: boolean, hwnd: bigint|null, cls: string, reason: string }}
 */
export function probeForegroundFullscreen(opts = {}) {
  const hwnd = GetForegroundWindow()
  if (hwnd === null) return { fullscreen: false, hwnd: null, cls: '', reason: 'no-foreground' }

  const cls = className(hwnd)
  if (SHELL_CLASSES.has(cls)) return { fullscreen: false, hwnd, cls, reason: 'shell-surface' }

  const cloaked = [0]
  if (DwmGetWindowAttributeInt(hwnd, DWMWA_CLOAKED, cloaked, 4) === 0 && cloaked[0] !== 0) {
    return { fullscreen: false, hwnd, cls, reason: 'cloaked' }
  }

  if (opts.ignorePid !== undefined) {
    const pid = [0]
    GetWindowThreadProcessId(hwnd, pid)
    if (pid[0] === opts.ignorePid) return { fullscreen: false, hwnd, cls, reason: 'self' }
  }

  // DWM 扩展边框 = 用户实际看到的框；失败则退回 GetWindowRect（含隐形边框，仅兜底）。
  const frame = {}
  if (DwmGetWindowAttributeRect(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, frame, RECT_SIZE) !== 0) {
    if (!GetWindowRect(hwnd, frame)) {
      return { fullscreen: false, hwnd, cls, reason: 'no-rect' }
    }
  }
  const mon = windowMonitorRect(hwnd)
  if (mon === null) return { fullscreen: false, hwnd, cls, reason: 'no-monitor' }

  // 同一坐标系（物理像素）比较，容差 0：见 §3.2 坑 1/坑 2。
  const covers = frame.left <= mon.left && frame.top <= mon.top
    && frame.right >= mon.right && frame.bottom >= mon.bottom
  return { fullscreen: covers, hwnd, cls, reason: covers ? 'covers-monitor' : 'windowed' }
}

/** 综合判定（几何快路径的结果 + 可选的 QUNS 慢路径结果）。 */
export function isBusy(geom, quns) {
  if (quns !== undefined && QUNS_BUSY_STATES.has(quns)) {
    return { busy: true, why: `quns:${QUNS[quns]}` }
  }
  if (geom.fullscreen) return { busy: true, why: `geom:${geom.cls}` }
  return { busy: false, why: `idle:${geom.reason}` }
}
```

#### `apps/desktop/lib/fullscreen-watch.mjs`（双频轮询 + 去抖）

```js
// @ts-check
import { ensureDpiAware, isBusy, probeForegroundFullscreen, queryUserNotificationState }
  from './fullscreen-win32.mjs'

const FAST_MS = 500     // 几何快路径
const SLOW_MS = 5000    // QUNS 慢路径
const NEED = 2          // 连续 N 次同向才切换状态

/**
 * @param {{ onBusyChange: (busy: boolean, why: string) => void,
 *           selfPid?: number,
 *           sameDisplayOnly?: boolean }} opts
 * @returns {() => void} 停止函数
 */
export function startFullscreenWatch({ onBusyChange, selfPid, sameDisplayOnly = false }) {
  ensureDpiAware()

  let quns = 0
  let qunsAt = 0
  let busy = false
  let hits = 0
  let visibleSince = Date.now()

  const slow = setInterval(() => {
    quns = queryUserNotificationState()
    qunsAt = Date.now()
  }, SLOW_MS)
  slow.unref?.()

  const fast = setInterval(() => {
    // QUNS 结果超过 15 s 未刷新就丢弃，避免拿旧状态做决定
    const freshQuns = (Date.now() - qunsAt < SLOW_MS * 3) ? quns : 0
    const geom = probeForegroundFullscreen({ ignorePid: selfPid })
    // sameDisplayOnly：猪和全屏窗口不在同一块屏时不隐藏（多显示器场景，见 §3.5）
    const sameDisplay = sameDisplayOnly ? onSameDisplay(geom) : true
    const verdict = isBusy(geom, freshQuns)

    if (verdict.busy === busy) { hits = 0; return }
    hits += 1
    if (hits < NEED) return
    // 从"闲"切到"忙"时，若刚开始显示不足 500 ms，再等一轮，避免闪烁
    if (verdict.busy && Date.now() - visibleSince < 500) return
    hits = 0
    busy = verdict.busy
    if (!busy) visibleSince = Date.now()
    onBusyChange(busy, verdict.why)
  }, FAST_MS)

  return () => { clearInterval(fast); clearInterval(slow) }
}

/** 占位：需要时用 Geometry 的 monitor 矩形与猪窗口的显示器矩形比对。 */
function onSameDisplay(/* geom */) { return true }
```

#### 主进程接线（`apps/desktop/main.js` 片段）

```js
import { startFullscreenWatch } from './lib/fullscreen-watch.mjs'

let hiddenByFullscreen = false
let restoreTimer = null
const stopWatch = startFullscreenWatch({
  selfPid: process.pid,
  onBusyChange: (busy, why) => {
    if (win === null || win.isDestroyed()) return
    if (busy) {
      if (!win.isVisible()) return
      clearTimeout(restoreTimer); restoreTimer = null
      hiddenByFullscreen = true
      win.hide()                       // 隐藏而不是 setOpacity(0)：省掉整条合成链
      win.webContents.setFrameRate(1)  // 兜底：万一 hide 被系统延迟，把合成降到 1fps
      log('fullscreen', 'hide', why)
    } else if (hiddenByFullscreen) {
      hiddenByFullscreen = false
      // 切回桌面后尽快恢复；用 showInactive 保证不抢焦点
      restoreTimer = setTimeout(() => {
        restoreTimer = null
        if (win === null || win.isDestroyed()) return
        win.webContents.setFrameRate(FRAME_RATE)
        win.showInactive()
        log('fullscreen', 'restore', why)
      }, 120)
    }
  },
})
app.on('before-quit', () => stopWatch())
```

**要点**：
- **`win.hide()` 而不是 `setOpacity(0)`**：隐藏窗口让 Chromium 停止合成，是真正的"零成本"；透明窗口仍在合成。
- **`showInactive()` 而不是 `show()`**：不抢焦点（🔵 官方语义 "Shows the window but doesn't focus on it"）。
- **`ignorePid: process.pid`**：防止猪自己的窗口（理论上被最大化时）触发误判。
- **去抖 `NEED = 2`**：alt-tab 过程中的瞬时全屏不会让猪闪一下。

### 3.4 为什么不直接上 `SetWinEventHook`（免轮询）

理论上可以用 `SetWinEventHook(EVENT_SYSTEM_FOREGROUND, ...)` 做事件驱动，彻底去掉轮询。koffi 支持回调，**但本任务未验证**（需要消息泵 + 回调生命周期管理，跨 Electron 主进程的事件循环风险不低）。

**成本核算说明为什么不必**：🟢 几何探测 2 Hz = **0.0155 ms/s ≈ 单核的 0.0016%**；加上 QUNS 0.2 Hz ≈ **0.004%**。合计 **< 0.006% 单核**。为了这点开销去引入 hook 的复杂度不划算。**建议：先上轮询，若实测有问题再评估 hook。**

> 🔴 建议把它列为"后续可选优化"，不作为交付前提。

### 3.5 多显示器策略（需要产品决策）

三种可选策略，建议做配置项而不是写死：

| 策略 | 行为 | 适用 |
|---|---|---|
| A（默认） | 前台窗口全屏 → 一律隐藏 | 简单可预期；玩游戏的用户通常只盯一块屏 |
| B | 只有当全屏窗口与猪在**同一块**显示器时才隐藏 | 双屏用户：一块全屏游戏、一块留桌宠 |
| C | 只有当全屏窗口是**独占**（QUNS=3）时才隐藏 | 过于保守，🟢 实测这条路常拿不到 3，**不推荐** |

实现 B 只需把 `probeForegroundFullscreen` 返回的 `hwnd` 对应的 `rcMonitor` 与猪窗口所在显示器的矩形比对（Win32 侧用 `MonitorFromWindow(猪的 hwnd)`，或 Electron 侧 `screen.getDisplayMatching(win.getBounds()).bounds` 再换算到物理像素）。

---

## 四、降级方案

### Plan B：不做检测（"不冲突"靠产品约束而非技术检测）

适用于：检测方案在某种环境下失效、或首版要快速上线。

```
1. 窗口永远置顶，但用 level = 'pop-up-menu'（任务栏之上；见 §2.3）
2. 只做"内容贴合 + 像素级穿透"（setShape），窗口天然只有 ~164×184，
   即使盖在全屏游戏上也只占 164×184 像素的极小区域
3. 全局热键一键隐藏/显示（Electron globalShortcut，例如 Ctrl+Alt+P）
4. 托盘单击隐藏/显示 —— 参考项目已实现（_ref/apps/desktop/main.js:341）
5. 用户手动"游戏模式"开关：勾选后立即 hide() 且不再自动恢复，
   直到用户再次点击托盘
```

**代价评估**：不检测时，桌宠会在 **FSO 无边全屏**（Win10+ 绝大多数游戏）里**盖在画面上**——这正是用户说的"冲突"。所以 Plan B 只能算**过渡**：把 5 条做完，然后尽快补 §3 的检测。

### Plan C：检测失败时的安全降级链

```
koffi 加载失败（缺 .node / ABI 不匹配）
  → 退化为纯 Electron 方案：screen.getDisplayMatching + win.isFullScreen 之类只能测自家窗口，不够用
  → 于是退化为 Plan B（热键 + 托盘），并在日志/托盘提示"全屏检测不可用"
绝不在检测异常时"乐观假设不忙"以外的任何动作；异常一律按"不忙"处理，
宁可少隐藏（用户可热键）也不要误隐藏（用户以为程序坏了）
```

> **重要**：不要因为 koffi 失败就 `throw`。参考项目 `main.js:37-45` 的 `log()` 已经把"绝不因为日志失败而影响主流程"写成了惯例，检测器应遵循同一原则。

---

## 五、技术栈选型对比

### 5.1 硬数字总表

| 运行时 | 安装/发布物 | 磁盘（实测） | 常驻内存（实测） | 空闲 CPU | 逐像素 alpha | 逐像素点击穿透 | 多显示器 | 自启 | 开发成本 |
|---|---|---|---|---|---|---|---|---|---|
| **Electron 44.5.1** | 🟡 **150.68 MB** zip（win32-x64） | 🟢 **367.10 MB**（73 文件） | 🟢 **302 MB / 4 进程**（Browser 99 + GPU 88 + Utility 45 + Tab 69） | 🟢 0–3.2%（30fps 呼吸动画） | ✅ | ✅ `setShape` | ✅ | ✅ `setLoginItemSettings` | 最低（已有） |
| **Tauri 2** | 🟡 官方："minimal Tauri app can be less than **600 KB**"；🔴 桌宠实际预计 **5–12 MB** | 🔴 未实测 | 🔴 未实测（WebView2 多进程） | 🔴 未实测 | ✅（需 `transparent(true)`） | ⚠️ 需自己 `SetWindowRgn`（无现成 API） | ✅ | ✅ `autostart` 插件 | 中（前端可复用，Rust 侧重写窗口层） |
| **Rust + 原生 Win32** | 🔴 **1.5–3 MB** 单 exe（估算） | 🔴 未实测 | 🟡 参照单进程量级 **15–30 MB** | 极低 | ✅ 分层窗口 | ✅ `SetWindowRgn`/`WM_NCHITTEST` | ✅ | ✅ 注册表 Run | **高**（重写 241 KB UI） |
| **WPF / WinUI3 (.NET 8)** | 🟢 自包含 **160.07 MB**（464 文件）/ 单文件压缩 **72.84 MB**（`app.exe` 64.83 MB）；框架依赖 **0.16 MB** | 🟢 同上 | 🔴 未实测 | 🔴 未实测 | ✅ `AllowsTransparency` | ✅ `SetWindowRgn` | ✅ | ✅ | 高（重写 UI） |
| **Python + tkinter** | 🟡 仅 Python 运行时（嵌入式 ~15 MB） | — | 🟢 **37.2 MB / 1 进程** | 低 | ❌ **只有 colorkey**（`-transparentcolor`），抗锯齿边缘会锯齿化 | ⚠️ 需 `SetWindowRgn` | ⚠️ | ✅ | 中 |
| **Python + PySide6** | 🟡 wheel **73.35 MB**；PyInstaller 打包后 🔴 ≈80–150 MB | 🔴 未实测 | 🔴 未实测（Qt 通常 > tkinter） | 中 | ✅ `WA_TranslucentBackground` | ✅ `setMask` | ✅ | ✅ | 中 |

> 🟢 **本机同时观测到的对照**（同一时刻 `Get-Process`）：Microsoft Edge 浏览器 **5 进程 / 356.3 MB**；Chrome **19 进程 / 2464.9 MB**。
> 这两个是**浏览器**而非裸 WebView2 宿主，因此不能直接当作 Tauri 的内存预期；它们证明的是另一件事：**Chromium 系多进程在 Windows 上的量级是"每个宿主进程几十 MB × 4~5 个"**，不会因为"用了系统共享的 WebView"就凭空消失。**省的是磁盘与安装包，不是内存。** 这一点必须在选型时讲清楚，否则会重演用户对"轻量化"的失望。Tauri 的真实内存数字见 §8.2 B3 的必测项。

### 5.2 WebView2 的真实代价（Tauri 的关键前提）

🟢 本机实测 + 🟡 官方直链元数据：

| 项 | 值 | 来源 |
|---|---|---|
| WebView2 运行时**是否已装** | ✅ 已装，版本 **154.0.4258.48**（`HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-...}`，正是微软文档给出的检测位置） | 🟢 注册表 |
| 已装的共享运行时**磁盘占用** | 🟢 **862.0 MB** | 🟢 `%ProgramFiles(x86)%\Microsoft\EdgeWebView\Application` |
| Evergreen **Bootstrapper**（在线安装器，只下载不下蛋） | 🟡 **1.91 MB**（`https://go.microsoft.com/fwlink/p/?LinkId=2124703`）——官方文档描述为 "tiny (approximately **2 MB**) installer"，与实测吻合 | 🟡 Content-Length + 🔵 官方文档 |
| Evergreen **Standalone Installer**（离线全量包） | 🟡 **202.44 MB**（`https://go.microsoft.com/fwlink/p/?LinkId=2124701`） | 🟡 Content-Length |
| ⚠️ **Fixed Version** 运行时（随应用打包，非共享） | 🔵 官方原文："The Fixed Version binaries are **over 250 MB** and will make your app package larger by that amount." | 🔵 官方文档 |

🔵 官方还说明两条对选型很重要的事实（<https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution>）：
- **"The Evergreen WebView2 Runtime will be included as part of the Windows 11 operating system."** —— Win11 自带；Win10 "vast majority of ... devices have the WebView2 Runtime installed already"，但仍有少数没有，**必须做检测 + 引导安装**（不能假设一定有）。
- **Evergreen 模式下所有 WebView2 应用共享同一份运行时**，且在同版本时与 Edge 的二进制**硬链接**在一起以节省磁盘、内存与提升性能。**这正是"轻量化"的正解**；一旦选 Fixed Version，安装包直接 **+250 MB**，优势全没。

> **结论**：Tauri 的安装包极小，是因为它**不打包浏览器引擎**——但用户机器上仍然存在一个 **862 MB** 的 Chromium，运行时也仍会 fork 多个 `msedgewebview2.exe` 子进程。**这仍然是"轻量化"的正确方向（用户不为每只桌宠付一份 Chromium），但不能承诺内存降到 30 MB。** 必须实测后写进验收（§8.2 B3）。

### 5.3 淘汰判据

| 运行时 | 淘汰理由（一句话 + 数字） |
|---|---|
| **Electron** | 为一只猪付 **367 MB 磁盘 + 302 MB 常驻**，且**无法通过调优消除**（这是 Chromium 多进程架构的固定成本）。与约束①直接冲突 |
| **WPF / WinUI3** | 自包含 **160 MB**、单文件 **72.84 MB**；且 🟢 实测 `dotnet publish -p:PublishTrimmed=true` **直接失败**：`error NETSDK1168: 启用剪裁时，不支持或不推荐使用 WPF`（<https://aka.ms/dotnet-illink/wpf>）。没有把体积压下来的官方路径 |
| **tkinter** | 🟢 37.2 MB 内存很好，但**只有 colorkey 透明**，做不出宠物需要的柔边/半透明效果（`-transparentcolor` 会把抗锯齿边缘变成硬边） |
| **PySide6** | wheel 73.35 MB + PyInstaller 打包后体积更大；且必须放弃现有 HTML/CSS/SVG 资产与 DOM 动画体系 |

### 5.4 Tauri 落地前必须闭合的三件事（验收项）

1. **透明 + 逐像素穿透**：Tauri/tao 在 Windows 上需要 `transparent(true)` + `decorations(false)` + 自建 `SetWindowRgn`。**参考项目 `setShape` 的整套矩形合并算法（`_ref/apps/desktop/renderer/shell.js:94-140`）可以原样搬过去**，只是把 IPC 那段换成 Tauri 的 `invoke`。
2. **实测内存**：必须用 §6.2 的命令测出真实数字，替换本表的 🔴。
3. **WebView2 缺失时的行为**：Tauri 安装器可选带 Bootstrapper（🟡 1.91 MB）。Win11 已内置；Win10 需检测并提示。

---

## 六、资源预算与测量方法

### 6.1 桌宠空闲态资源预算目标

| 指标 | 目标（通过） | 上限（可接受） | 不可接受 | Electron 现状（🟢实测） |
|---|---|---|---|---|
| **常驻内存（working set 合计）** | **≤ 60 MB** | 120 MB | > 200 MB | **302 MB** ❌ |
| **常驻内存（private bytes）** | ≤ 40 MB | 80 MB | > 120 MB | 140.7 MB ❌ |
| **空闲 CPU（无交互、有呼吸动画）** | **≤ 0.5% 单核** | 1.5% | > 3% | 0.86–1.08%（30fps）⚠️ |
| **空闲 CPU（全屏隐藏时）** | **≈ 0%** | 0.1% | > 0.5% | 未实现隐藏，N/A |
| **GPU** | 隐藏时停止合成 | 桌面态 < 1% | 持续 > 3% | 未单独隔离测量 |
| **磁盘（安装后）** | **≤ 30 MB** | 80 MB | > 150 MB | **367 MB** ❌ |
| **安装包下载体积** | ≤ 15 MB | 30 MB | > 80 MB | **150.68 MB** ❌ |
| **冷启动到可见（ready-to-show）** | ≤ 800 ms | 1500 ms | > 2500 ms | 未单独测量（Electron 44 该规格通常 ~600–1200 ms）🔴 |
| **全屏切换 → 隐藏延迟** | ≤ 1000 ms | 1500 ms | > 2000 ms | 设计值 ≤ 500 ms（2×500 ms 去抖） |
| **恢复延迟（切回桌面）** | **≤ 600 ms** | 1000 ms | > 1500 ms | 设计值 120 ms + 2×500 ms 去抖 ≈ 620 ms |

> 🔴 冷启动与 Tauri 内存是本表仅有的两项未实测数据，**建议 task 收尾前用 §6.2 的命令补齐**。

### 6.2 测量方法（可直接执行的 PowerShell）

#### (a) 内存与进程分解

```powershell
# 总内存 + 每进程分解（按进程名，适合 Electron/Tauri/原生）
$names = 'electron','msedgewebview2','piggy'      # 按实际进程名替换
Get-Process -Name $names -ErrorAction SilentlyContinue | ForEach-Object {
  "pid {0,-7} {1,-24} WS {2,8:N1} MB  Private {3,8:N1} MB  Threads {4,3}" -f `
    $_.Id, $_.ProcessName, ($_.WorkingSet64/1MB), ($_.PrivateMemorySize64/1MB), $_.Threads.Count
}
$p = Get-Process -Name $names -ErrorAction SilentlyContinue
"---- TOTAL working set : {0:N1} MB over {1} processes ----" -f (($p|Measure-Object WorkingSet64 -Sum).Sum/1MB), $p.Count
"---- TOTAL private     : {0:N1} MB ----" -f (($p|Measure-Object PrivateMemorySize64 -Sum).Sum/1MB)
```

#### (b) 空闲 CPU（10 秒窗口，比瞬时值可靠）

```powershell
$names = 'electron','msedgewebview2','piggy'
$a = (Get-Process -Name $names -ErrorAction SilentlyContinue | Measure-Object CPU -Sum).Sum
Start-Sleep -Seconds 10
$b = (Get-Process -Name $names -ErrorAction SilentlyContinue | Measure-Object CPU -Sum).Sum
"{0:N3} CPU-seconds over 10 s  =>  {1:N2}% of one logical core" -f ($b-$a), (($b-$a)/10*100)
```

#### (c) 用 `Get-Counter` 看整机上下文（排除"是别的东西在吃 CPU"）

```powershell
Get-Counter -Counter '\Process(electron*)\% Processor Time','\Process(electron*)\Working Set - Private' `
            -SampleInterval 1 -MaxSamples 10 |
  Select-Object -ExpandProperty CounterSamples |
  Group-Object Path | ForEach-Object {
    "{0,-70} avg {1,8:N2}" -f $_.Name, (($_.Group | Measure-Object CookedValue -Average).Average)
  }
```

#### (d) Electron 内部视角（官方推荐，**能直接给出进程类型**）

```js
// 主进程里执行；ProcessMetric 结构见官方文档
const m = app.getAppMetrics()
console.table(m.map(p => ({
  type: p.type,                       // Browser / GPU / Utility / Tab / ...
  pid: p.pid,
  workingSetMB: +(p.memory.workingSetSize / 1024).toFixed(1),
  peakMB: +(p.memory.peakWorkingSetSize / 1024).toFixed(1),
  cpuPercent: +p.cpu.percentCPUUsage.toFixed(3),   // "Percentage of CPU used since the last call to getAppMetrics"
})))
console.log('TOTAL', m.reduce((s, p) => s + p.memory.workingSetSize / 1024, 0).toFixed(1), 'MB')
```

🔵 `ProcessMetric` 官方定义：<https://www.electronjs.org/docs/latest/api/structures/process-metric>

> 🟢 **本方案 §5 的 Electron 数字就是用这个方法测出来的**（配合外部 `Get-Process` 交叉验证，两者吻合：302 MB vs 300.8 MB）。

#### (e) 冷启动时间

```powershell
$sw=[System.Diagnostics.Stopwatch]::StartNew()
$p = Start-Process -FilePath '.\piggy.exe' -PassThru
while (-not $p.HasExited) {
  if ((Get-Process -Id $p.Id).MainWindowHandle -ne 0) { break }
  Start-Sleep -Milliseconds 20
}
$sw.Stop(); "cold start to first window: {0:N0} ms" -f $sw.Elapsed.TotalMilliseconds
```

#### (f) 全屏检测的成本（本方案自证）

```powershell
# 用 §3.3 的模块实测；native C# 基准是 2.1 µs/次（几何）、168 µs/次（QUNS）
cd $env:TEMP
node -e "const t=process.hrtime.bigint();const m=require('./fullscreen-win32.cjs');for(let i=0;i<20000;i++)m.probeForegroundFullscreen();console.log('geom us/call',Number(process.hrtime.bigint()-t)/1000/20000)"
```

### 6.3 参考项目里可直接复用的轻量化手段

| # | 手段 | 位置 | 为什么有用 |
|---|---|---|---|
| 1 | **窗口只框住内容**（布局外接框 + 四周 16px） | `_ref/apps/desktop/main.js:5-8`、`lib/window-geometry.js`（`WINDOW_PADDING=16`） | 之前的窗口铺满整个工作区，**Windows 上每帧都要合成一整块全屏透明层**（`main.js` 头部注释原话）。这是本项目最大的一次性能修复 |
| 2 | **量框用布局盒，不用 `getBoundingClientRect`** | `_ref/apps/desktop/renderer/shell.js:9-11, 81-92` | 注释原文：呼吸/浮动动画只改 `transform`，`rect` 每帧都在抖，"**Windows 上那会变成每秒一次 `SetWindowRgn`**"。这是最"值钱"的一条经验 |
| 3 | **上报按 4px 量化** | `shell.js:21-22`（`STEP=4`）、`window-geometry.js`（`QUANTIZE_STEP=4`） | 动画抖几像素不触发窗口改动 |
| 4 | **120ms 节流上报**（≈8.3 次/秒） | `shell.js`（`setInterval(tick, 120)`，见 `PROJECT-REF.md` §5） | 把窗口几何改为"变化才发"，常驻开销降到可忽略 |
| 5 | **帧率上限 30fps** | `_ref/apps/desktop/main.js:31-32, 194` | 注释原文："Windows 上每帧合成整窗的代价高：30fps 足够猪动，CPU/GPU 掉一大截" |
| 6 | **`showInactive()` 而非 `show()`** | `main.js:198` | 启动不抢焦点 |
| 7 | **启动即"零点击区"** `applyShape([])` | `main.js:196` | 页面报出真实区域前，窗口完全不接管鼠标 → 桌面右键等操作不被挡 |
| 8 | **shape 矩形上限 64 个 + 取整/夹取** | `main.js:257-260, 285-288` | 防止矩形爆炸拖慢 `SetWindowRgn` |
| 9 | **窗口状态写盘去抖 800 ms** | `main.js:130-143` | 拖动时 `setBounds` 连发，不去抖会疯狂写盘 |
| 10 | **`piggy://` 自定义协议，不开 TCP 端口** | `main.js:10, 66-68, 98-110` | 少一个监听端口 = 少一份常驻开销与安全面 |
| 11 | **`requestSingleInstanceLock()`** | `main.js:72` | 防止多开导致内存翻倍 |
| 12 | **`display-metrics-changed` → 重新夹取窗口** | `main.js:449-456` | 分辨率/任务栏变化时不留下屏幕外窗口 |
| 13 | **美术资源仅 34 个 SVG ≈ 130 KB** | `PROJECT-REF.md` §3 | 零位图，矢量放大不糊，且几乎不占磁盘 |
| 14 | **`transparent/frame:false/hasShadow:false`** | `main.js:187-190` | 无边框无阴影 = 少一层系统绘制 |

**这些手段的迁移成本**：1/2/3/4/6/7/8 全部在**页面与几何层**，迁到 Tauri 时**逻辑可直接复用**，只需替换 IPC 与原生窗口调用。

### 6.4 三项遗留风险（与 `PROJECT-REF.md` §7 对应）

| 风险 | 现状 | 本方案处理 |
|---|---|---|
| `SetWindowRgn` 每秒一次的退化 | 已由手段 2/3/4 规避 | 迁移时**必须保留**"只用布局盒 + 量化 + 变化才发"三条，不要因为换框架就退回 `getBoundingClientRect` |
| `setInterval(tick, 120)` 常驻定时器 | ≈8.3 次/秒，仍在跑 | 见 §7.4：改为"内容变化驱动 + 低频兜底"，并接入 `powerMonitor` 在锁屏/休眠时停掉 |
| `client.js` 241 KB 单文件巨石 | 一次解析全部加载 | Tauri 迁移时用 code-split：`client.js` 只保留桌面外壳需要的部分（面板/气泡/动画），玩法模块按需动态 `import()`。Electron 官方性能清单第 2 条"Loading and running code too soon"、第 7 条"Bundle your code"正是讲这个 |

---

## 七、渲染与调度优化清单

### 7.1 🟢 本机实测：六种动画策略的 CPU 成本

**方法**：Electron 44.5.1，透明无边框 164×164 置顶窗口，`webContents.setFrameRate(30)`，每种模式跑 6 s，每 250 ms 采样一次 `app.getAppMetrics()` 的 `percentCPUUsage` 之和（4 个进程）。同一台机器、同一进程、连续测量。

| 模式 | 平均 CPU（4 进程之和） | 峰值 | 相对静态 |
|---|---|---|---|
| **A 静态**（无动画） | **0.02%** | 0.09% | 基准 |
| **B CSS `transform` 动画**（只改 transform） | 1.05% | 1.27% | +1.03% |
| **C CSS `transform` + `will-change:transform`** | **0.86%** | 0.99% | +0.84% |
| **D CSS 动画改 `width/height`**（触发布局） | 1.03% | 1.40% | +1.01% |
| **E JS `setInterval(16ms)` 写 `left/top`** | **0.38%** | 0.44% | +0.36% |
| **F JS `requestAnimationFrame` 写 `transform`** | 1.08% | 1.51% | +1.06% |

**可落地的结论**：

1. **`will-change: transform` 有实测收益**：1.05% → 0.86%，**降 18%**。对常驻动画元素加上是划算的。但它会常驻提升合成层，**用完要撤**（动画结束/隐藏时移除），否则长期占显存。
2. **B/D/F 三者差异在噪声范围内**（1.03–1.08%）。在 164×164 的窗口里，动画本身的开销由**每帧的合成提交**主导，而不是"改了哪个属性"。**所以不要为"用 transform 还是用 left"过度纠结——先把帧率压下来更有效。**
3. **E 看起来最便宜（0.38%）要谨慎解读**：E 每 16 ms 写一次 `left/top`，位移量是 `sin(t)*3` ≈ 每帧 0.15 px，**被 Chromium 像素对齐后大量帧实际不产生视觉变化**，因此省掉了重绘。**这不是"布局动画更便宜"的证据。** 如果幅度/速度加大，E 的成本会上升。**不要把 E 当作"可以用 JS 动布局"的许可。**
4. **绝对量级都很小（< 1.1%）**：在这个窗口尺寸下，**动画不是 CPU 的主要矛盾，固定进程内存（300 MB）才是**。优化要先打内存/体积，再谈动画微调。
5. **全屏隐藏时应当 ≈ 0%**：表 A 的 0.02% 说明"停掉动画"就足够接近零；而 `win.hide()` 比"停动画"更彻底（连合成都停）。

> ⚠️ 测量限制：单机、单次、6 s/模式、`percentCPUUsage` 是采样值；模式间未随机化顺序。用于**相对比较**可靠，绝对值仅供量级参考。

### 7.2 SVG vs PNG 精灵图

🔵 参考项目已有结论：**34 个 SVG ≈ 130 KB**，全矢量、透明底、零位图（`PROJECT-REF.md` §3/§4）。单张 2.2–7.6 KB。

| 维度 | SVG | PNG 精灵图 |
|---|---|---|
| 磁盘 | 🟢 单张 2.2–7.6 KB；全套 130 KB | 同等清晰度下通常数倍（多倍图更甚） |
| 缩放/DPI | 任意分辨率无损（150% 缩放下尤其重要——本机就是 150%） | 需要 @2x/@3x，体积翻倍 |
| 运行时成本 | 每次改属性可能触发**重绘光栅化**（比位图贵） | 解码一次后是纯位图 blit，改属性更便宜 |
| 动画友好度 | 改 `fill` 等属性会重绘；建议**只改 `transform`/`opacity`** | 帧动画靠换图，JS 成本高 |

> **建议**：**保留 SVG**（体积与 DPI 优势是硬需求），但把动画限制在 `transform`/`opacity`——即参考项目已经在做的（`shell.js:9-11` 的注释就是这个意思）。**不要用 CSS 动画去改 SVG 的 `fill`/`stroke-width`/`d`**，那会每帧重新光栅化。
> 若某个场景确实需要复杂形态变化（如进化特效），**再考虑把那一帧预渲染成 PNG 切图**，而不是全局换位图。

### 7.3 CSS vs JS 逐帧

| 做法 | 结论 |
|---|---|
| **CSS 声明式动画 + `transform`/`opacity`** | ✅ **首选**。见 §7.1：B/C 与 F 成本相当，但 CSS 版本不占 JS 主线程，主线程忙时不会卡 |
| **`will-change: transform`** | ✅ 有 18% 实测收益；**但要在动画结束时移除**，避免长期占合成层 |
| **减少合成层数量** | 只有真正在动的元素加提升。每个 `will-change`/`transform: translateZ(0)` 都吃显存；一只猪有 1–2 层就够 |
| **`requestAnimationFrame`** | 用于需要 JS 计算的场景。**不要用 `setInterval` 驱动视觉**（会与刷新率脱节、后台仍跑） |
| **`setInterval`** | 只用于低频状态机（如参考项目的 120 ms 几何上报）。**频率越低越好，且必须能被暂停** |

### 7.4 调度与降级策略（帧率/动画的"档位"）

参考项目已经用 `setFrameRate(30)` 做了第一档（`main.js:194`）。建议补成完整档位表：

| 状态 | 触发条件 | 帧率 | 动画 | 几何上报 | 全屏检测 |
|---|---|---|---|---|---|
| **活跃** | 鼠标悬停 / 面板打开 / 拖动中 | 30 fps | 全部 | 120 ms | 500 ms |
| **空闲** | 无交互（默认） | 15–30 fps | 呼吸/浮动 | 内容变化才发 + 2 s 兜底 | 500 ms |
| **被遮挡 / 失焦** | `document.visibilityState === 'hidden'` | 1 fps | 暂停 | 停 | 500 ms |
| **锁屏 / 休眠** | `powerMonitor` `lock-screen` / `suspend` | 0 | 停 | 停 | 暂停（`unlock-screen`/`resume` 后重启） |
| **电池供电** | `powerMonitor.on('on-battery')` | 15 fps | 减半 | 2 s | 500 ms |
| **全屏中** | 检测器判定 busy | — | — | — | `win.hide()` + `setFrameRate(1)` |

🔵 依据：
- Page Visibility & `backgroundThrottling`：官方明确"visibility state will be `hidden` only when the window is minimized or explicitly hidden with `win.hide()`"，并**建议 "pause expensive operations when the visibility state is `hidden`"**。注意 **Windows 上没有"被遮挡"的可见性信号**（那是 macOS 独有的 occlusion 行为），所以"被别的窗口盖住"这件事在 Windows 上**只能靠全屏检测器自己判断**。<https://www.electronjs.org/docs/latest/api/browser-window#page-visibility>
- `powerMonitor` 事件（Windows 可用）：`suspend` `resume` `on-ac` `on-battery` `lock-screen` `unlock-screen`；方法 `isOnBatteryPower()`、`getSystemIdleState(threshold)`、`getSystemIdleTime()`。<https://www.electronjs.org/docs/latest/api/power-monitor>
- `backgroundThrottling` 默认 `true`（🔵 WebPreferences），**不要关掉它**——关掉会让后台窗口继续满速渲染。注意官方也说明：只要有一个 `webContents` 关了它，**整个窗口**就都不节流。

### 7.5 其它可直接照做的清单

| 项 | 动作 | 依据 |
|---|---|---|
| 启动菜单 | 启动时调 `Menu.setApplicationMenu(null)` | 🔵 官方性能清单第 8 条：阻止 Electron 建默认菜单，改善启动 |
| 模块加载 | 延迟 `require` 大模块；避免"加载即执行" | 🔵 官方性能清单第 1、2、7 条 |
| 主进程 | 不阻塞 UI 线程；不用同步 IPC / `@electron/remote` / 同步 I/O | 🔵 官方性能清单第 3 条 |
| 渲染进程 | 重活用 `requestIdleCallback` / Web Worker | 🔵 官方性能清单第 4 条 |
| 网络 | 不加载远程字体/CDN 资源，全部打包进应用 | 🔵 官方性能清单第 6 条 |
| 多开 | `requestSingleInstanceLock()` | 🟢 `_ref/apps/desktop/main.js:72` |
| 日志 | 日志失败绝不影响主流程（try/catch 包裹） | 🟢 `_ref/apps/desktop/main.js:37-45` |
| 存档写盘 | 去抖（参考项目 800 ms） | 🟢 `_ref/apps/desktop/main.js:130-143` |

---

## 八、验收标准

### 8.1 约束②：不与全屏应用冲突（可验证）

| # | 验收项 | 判定方法 | 通过标准 |
|---|---|---|---|
| **A1** | FSO 无边全屏游戏内**不出现桌宠** | 启动一个支持无边框全屏的游戏（或用一个铺满显示器的无边框窗口模拟），把猪放在同屏 | 游戏进入全屏后 **≤ 1.0 s** 内猪消失；游戏中全程截图不可见 |
| **A2** | 真·独占全屏（FSE）下不冲突 | 关闭该游戏的"全屏优化"（兼容性 → 禁用全屏优化），重跑 A1 | 不出现闪烁/花屏；不导致游戏 alt-tab 抖动；猪不在画面上 |
| **A3** | **切回桌面 ≤ 1 s 恢复** | 用秒表/录屏（120fps）从 alt-tab 起算到猪重新可见 | **≤ 1000 ms**（设计值 ≈620 ms）；不含用户手动隐藏的情况 |
| **A4** | **不抢焦点** | 全屏游戏运行中，观察游戏是否失焦；用 `GetForegroundWindow()` 记录切换前后 | 全程前台窗口**始终是游戏**；猪出现/消失前后前台窗口不变 |
| **A5** | **不导致游戏掉帧** | 用 PresentMon / 游戏内置帧率计数，分别测"猪在跑（非全屏态）"与"猪已隐藏"两种情况的 1% low FPS | 两者 **1% low FPS 差异 < 3%**；且猪隐藏时差值应 ≈ 0 |
| **A6** | 最大化窗口**不误判** | 把一个普通窗口最大化（不是全屏），观察猪 | 猪**不消失**（§3.2 坑 1/坑 2 的回归测试） |
| **A7** | 演示模式 / 屏保 / 锁屏 | 分别触发：演示设置（`presentationsettings.exe`）、屏保、Win+L 锁屏 | 三种情况下猪均隐藏；解锁后 **≤ 1 s** 恢复 |
| **A8** | 多显示器 | 显示器 A 全屏，猪在显示器 B | 按选定策略（§3.5）行为一致；策略 B 下猪**不消失** |
| **A9** | 检测自身开销 | §6.2(f) 测 20000 次 | 几何探测 **≤ 15 µs/次**（本机实测 7.8 µs）；2 Hz 总开销 **≤ 0.005% 单核** |
| **A10** | 检测失败不崩 | 人为移除 `koffi.node` 后启动 | 应用正常启动；**不抛异常**；退化为 Plan B 且托盘有提示 |

### 8.2 约束①：轻量化（可验证）

| # | 验收项 | 判定方法 | 通过标准 |
|---|---|---|---|
| **B1** | 安装包体积 | `Get-Item installer.exe` / 官方 artifact 大小 | **≤ 15 MB**（Tauri）/ ≤ 30 MB（可接受） |
| **B2** | 安装后磁盘占用 | §6.2 之外的 `Get-ChildItem -Recurse \| Measure-Object Length -Sum` | **≤ 30 MB**（不含共享 WebView2 运行时，需在报告中单列） |
| **B3** | 空闲常驻内存 | §6.2(a)，稳定运行 60 s 后采样 | working set **≤ 60 MB**；private bytes ≤ 40 MB |
| **B4** | 空闲 CPU（桌面态，有呼吸动画） | §6.2(b)，10 s 窗口 | **≤ 0.5% 单核** |
| **B5** | 空闲 CPU（全屏隐藏态） | 强制隐藏后 §6.2(b) | **≤ 0.1% 单核** |
| **B6** | 冷启动 | §6.2(e) | **≤ 800 ms** 到首个可见窗口 |
| **B7** | 不新增常驻定时器 | 代码审计：统计 `setInterval` 数量与频率 | 常驻定时器 ≤ 2 个；几何上报改为"变化驱动 + ≥1 s 兜底" |
| **B8** | 无后台网络 | 抓包 / `netstat` 观察 10 分钟 | 无出站连接（更新检查须用户触发） |

### 8.3 回归测试（由参考项目已有测试体系承接）

参考项目已有 `_ref/apps/desktop/test/window.test.js:163`：

> `test('猪闲着 10 秒：setShape/setContent 一次都不调（动画只改 transform）')`

**建议新增两条同风格的测试**：

1. `猪在全屏窗口前台时 hide() 被调用一次，并只调用一次`（用假的检测器 + 假时钟驱动去抖）
2. `DPI 坐标系一致性`：把 DWM 矩形设成物理像素、monitor 矩形设成虚拟化像素，断言检测器**不**返回 fullscreen（把 §3.2 坑 1 固化成测试）

---

## 九、给下游的明确结论（TL;DR）

1. **技术栈**：**Electron 必须换**。推荐 **Tauri 2**（前端可近乎逐行复用现有零框架 DOM/CSS/SVG 资产）。参考数字：Electron 🟢 367 MB 磁盘 / 302 MB 内存 / 150.68 MB 安装包 vs Tauri 🟡 官方最小 <600 KB 二进制。
2. **全屏方案**：**几何快路径（2 Hz，🟢 0.0016% 单核）+ QUNS 慢路径（0.2 Hz）**。检测器全程只用 Win32，用 `DwmGetWindowAttribute(DWMWA_EXTENDED_FRAME_BOUNDS)` 和 `MonitorFromWindow`+`GetMonitorInfo` 在**同一坐标系**比较，跳过 shell 类窗口与 cloaked 窗口。
3. **不要用 PowerShell 外壳检测**：🟢 实测 **1694 ms/次**，是进程内 FFI 的 30 万倍，直接违反"1 秒内恢复"。
4. **不要指望 `setAlwaysOnTop` 的 level 解决问题**：🔵 官方文档明确，Windows 上这 8 个 level 只分成"任务栏之下（`floating`–`status`）"和"任务栏之上（`pop-up-menu`–`screen-saver`）"两档，**没有高于全屏游戏的层级**。
5. **加 FFI 的成本可忽略**：🟢 `koffi` 一共 **2.64 MB**、1 个预编译 `.node`、零编译、2.6 s 安装。
6. **三个必须防的坑**：DPI 坐标系混用（→假阳性）、`GetWindowRect` 含隐形边框、QUNS enum 是 **1-based**。
7. **动画不是主要矛盾**：🟢 六种动画策略实测都在 **0.02%–1.08%** 之间；先把 302 MB 内存降到 60 MB，再谈动画微调。`will-change: transform` 有实测 18% 收益。

---

## 十、引用来源

### 微软 / Windows 官方

1. `QUERY_USER_NOTIFICATION_STATE` enumeration（**1-based 定义**）—— <https://learn.microsoft.com/en-us/windows/win32/api/shellapi/ne-shellapi-query_user_notification_state>
2. `SHQueryUserNotificationState` function —— <https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shqueryusernotificationstate>
3. Microsoft Q&A：QUNS 对全屏游戏返回 `QUNS_BUSY` 而非 `QUNS_RUNNING_D3D_FULL_SCREEN` —— <https://learn.microsoft.com/en-us/answers/questions/1086527/shqueryusernotificationstate-returns-quns-busy-ins>
4. DirectX 官方博客《Demystifying Fullscreen Optimizations》（Win10 起 FSE → 优化过的无边窗口化）—— <https://devblogs.microsoft.com/directx/demystifying-full-screen-optimizations/>
5. .NET 自包含部署裁剪（`.NET` trimming 仅对 self-contained 可用）—— <https://learn.microsoft.com/en-us/dotnet/core/deploying/trimming/trim-self-contained>
6. WPF 不支持裁剪（🟢 实测报错 `NETSDK1168` 指向此处）—— <https://aka.ms/dotnet-illink/wpf>

### Electron 官方文档

7. `BrowserWindow`（`setAlwaysOnTop` 各 level 语义、`setShape`、`setIgnoreMouseEvents`、Page Visibility、`backgroundThrottling`、`showInactive`）—— <https://www.electronjs.org/docs/latest/api/browser-window>
8. `screen` 模块（物理像素 vs DIP、`screenToDipRect`/`dipToScreenRect`）—— <https://www.electronjs.org/docs/latest/api/screen>
9. `powerMonitor`（Windows 可用事件与空闲查询）—— <https://www.electronjs.org/docs/latest/api/power-monitor>
10. Performance 清单（Measure/模块加载/主进程/渲染进程/打包/`Menu.setApplicationMenu(null)`）—— <https://www.electronjs.org/docs/latest/tutorial/performance>
11. `ProcessMetric` 结构（`workingSetSize` / `percentCPUUsage`）—— <https://www.electronjs.org/docs/latest/api/structures/process-metric>
12. Electron v44.5.1 发布产物（🟡 win32-x64 zip = **150.68 MB**）—— <https://github.com/electron/electron/releases/tag/v44.5.1>

### Tauri / 其它运行时

13. Tauri《What is Tauri?》（"a minimal Tauri app can be less than 600KB in size"）—— <https://v2.tauri.app/start/>
14. Tauri《App Size》（Cargo release profile、`removeUnusedCommands`）—— <https://v2.tauri.app/concept/size/>
15. `koffi` npm 包（🟡 3.3.2，unpacked 1.64 MB；`@koromix/koffi-win32-x64` 1.00 MB，预编译）—— <https://www.npmjs.com/package/koffi>
16. PySide6-Essentials PyPI（🟡 `pyside6_essentials-6.11.2-cp310-abi3-win_amd64.whl` = **73.35 MB**）—— <https://pypi.org/project/PySide6-Essentials/#files>
17. WebView2 分发模式（Evergreen 共享运行时 vs Fixed Version）—— <https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution>

### 参考项目（本地证据）

18. `_ref/apps/desktop/main.js` —— 窗口构造项（L185-192）、`setFrameRate(30)`（L194）、`applyShape([])`（L196）、`showInactive`（L198）、shape 上限 64（L257-260）、窗口状态去抖 800 ms（L130-143）、`piggy://` 协议（L66-110）、单实例锁（L72）、`display-metrics-changed` 重新夹取（L449-456）
19. `_ref/apps/desktop/renderer/shell.js` —— 布局盒取代 `getBoundingClientRect` 与 `SetWindowRgn` 退化说明（L9-11）、`PAD=16`/`STEP=4`（L18-22）、`layoutBox` 累加（L81-92）
20. `PROJECT-REF.md` —— §3 体积与资源统计、§5 桌面外壳机制、§7 性能风险点

---

*文档结束。全部本机实验的临时目录已清理；本任务只在 `F:\piggy\analysis\E-lightweight-fullscreen.md` 写入，未修改 `_ref` 下任何文件。*
