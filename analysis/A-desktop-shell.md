# A · 桌面外壳行为与约束分析

> **分析对象**：`F:\piggy\_ref`（只读工作副本，`CLICGGER-TYPES/dsh-piggy`）。
> **产出目的**：为「用 Electron 复刻一个轻量化、不与全屏游戏冲突的 PC 桌宠外壳」提供可直接落地的行为清单与缺口清单。
> **引用约定**：所有路径相对 `_ref/`；每条结论后标 `（证据：文件:行号）`。
> 标「**不存在**」的结论均已给出所用 grep 模式与命中情况，未命中即代表仓库内没有该逻辑。
> 外部 API 语义（Electron 行为）另行标注链接，并注明「需以目标 Electron 版本实测」。
> 本文件不修改 `_ref` 下任何文件。

---

## 0. 结论速览（先看这 12 条）

| # | 结论 | 证据 |
|---|---|---|
| 1 | 窗口**不铺满屏幕**，只框住「猪 + 面板 + 气泡」的外接矩形，四周留 16px；这是「轻量化」的根本手段 | `apps/desktop/main.js:5-8`、`apps/desktop/lib/window-geometry.js:10` |
| 2 | 实测窗口尺寸：收起 **117×114 DIP**，面板展开 **324×271 DIP**（X11 实机，python-xlib 读 X 树） | `docs/tasks/C-round.md:331-336` |
| 3 | 只缩小窗口还不够：**整屏透明置顶窗口会让 Windows 浏览器的 direct flip/overlay 失效**，这是该项目卡顿的根因 | `docs/tasks/C-round.md:573-578` |
| 4 | 量内容框**只用布局盒**（`offsetLeft/offsetTop` 累加到 body），**刻意不用 `getBoundingClientRect`**，否则动画抖动会退化成每秒一次 `SetWindowRgn` | `apps/desktop/renderer/shell.js:9-11`、`apps/desktop/renderer/shell.js:81-92` |
| 5 | 像素级点击穿透靠 `win.setShape(rects)`：只有猪/面板那几块是实体，其余点击真正落到桌面；**macOS 不支持，直接跳过** | `apps/desktop/main.js:171-174` |
| 6 | 页面**闲着时上报次数为 0**（有测试守着：10 秒 / 83 次 tick，`setContent`+`setShape` 增量 0） | `apps/desktop/test/window.test.js:163-172` |
| 7 | 拖动 = 移窗口（`moveBy` 增量 → `win.setBounds`），页面元素不动；增量必须用 `screenX/screenY`，用 `clientX` 会追不上 | `apps/desktop/main.js:271-279`、`_ref/client.js:4822-4832`、`docs/tasks/C-round.md:600` |
| 8 | 置顶固定为 `alwaysOnTop: true` + `setAlwaysOnTop(true, 'floating')`，**没有**任何降级/让位逻辑 | `apps/desktop/main.js:188`、`apps/desktop/main.js:192` |
| 9 | **全屏应用检测不存在**（全仓 `fullscreen|isFullScreen|kiosk|setFullScreen` 零命中）；这是复刻时必须自己补的最大缺口 | 见 §四.2 |
| 10 | 单实例、托盘、开机自启、退出清理、窗口位置记忆齐备；托盘隐藏只做 `win.hide()`，**没有空闲降频/挂起** | `apps/desktop/main.js:72,336-351,323-334,494` |
| 11 | 主进程 ↔ 页面共 **16 个 IPC 通道名**（4 个 `send` + 9 个 `invoke/handle` + 3 个主→页推送；其中 `piggy:shape` 无生产调用方，活跃 15 个），全部有 `event.sender` 校验 | 见 §六 |
| 12 | 桌面版最小文件集 = 外壳 7 项（`package.json build.files`）+ 游戏包 11 项（`pack-game.mjs GAME_FILES`）；更新器三层（`versions/shell-update/electron-updater`）可整层裁掉 | `apps/desktop/package.json:27-41`、`apps/desktop/scripts/pack-game.mjs:12-15` |

---

## 一、窗口与进程模型

### 1.1 BrowserWindow 逐项配置（逐条对照源码）

构造位置：`apps/desktop/main.js:185-191`。展开后逐项如下。

| 配置项 | 取值 | 证据 | 作用与理由（源码/文档内已写明者） |
|---|---|---|---|
| `transparent` | `true` | `main.js:187` | 需要透明底露出桌面；配合 `backgroundColor: '#00000000'` |
| `frame` | `false` | `main.js:187` | 无边框无标题栏，纯粹一只猪 |
| `resizable` | `false` | `main.js:187` | 尺寸由内容框驱动（`applyBounds`），不给用户手动拉伸 |
| `movable` | `false` | `main.js:187` | 禁用 OS 级窗口拖动；拖动完全由页面上报增量实现 |
| `hasShadow` | `false` | `main.js:187` | 不需要系统窗口阴影（阴影画在立绘上，见 `src/client/css-base.js:113`） |
| `alwaysOnTop` | `true` | `main.js:188` | 桌宠必须压在普通窗口之上 |
| `skipTaskbar` | `true` | `main.js:188` | 不占任务栏；副作用见 §九-6 |
| `focusable` | `true` | `main.js:188` | 可被点击/聚焦（注意：点击会从全屏游戏抢焦点，见 §3.6、§九-2） |
| `show` | `false` | `main.js:188` | 先不显示；显示时机交给页面：`ready-to-show` → `showInactive()`（`main.js:198`），且用 showInactive 不抢焦点 |
| `backgroundColor` | `'#00000000'` | `main.js:189` | 全透明背景 |
| `webPreferences.preload` | `join(HERE,'preload.cjs')` | `main.js:190` | 唯一的页面→主进程桥梁 |
| `webPreferences.contextIsolation` | `true` | `main.js:190` | 隔离上下文，页面只能拿到 `contextBridge` 暴露的白名单 |
| `webPreferences.sandbox` | `true` | `main.js:190` | 渲染进程启用沙箱 |
| 位置/尺寸 | `...start`（`readWindowState()` 或兜底） | `main.js:186`、`main.js:177-184` | 见 §1.3 启动序列 |

**窗口创建后立即追加的三条设置**：

| 调用 | 取值 | 证据 | 说明 |
|---|---|---|---|
| `win.setAlwaysOnTop(true, 'floating')` | 层级 `floating` | `main.js:192` | 见 §四.1 |
| `win.webContents.setFrameRate(FRAME_RATE)` | `30` | `main.js:194`、常量 `main.js:32` | 注释即理由：「Windows 上每帧合成整窗的代价高：30fps 足够猪动，CPU/GPU 掉一大截」 |
| `applyShape([])` | 空数组 | `main.js:196` | 注释：「Until the page reports where the pig is, the window takes no clicks at all.」——首帧前窗口完全不接收点击 |

**明确未设置的项**（影响复刻时的默认值判断）：

- **没有 `type`**（如 `'panel'`/`'toolbar'`）——用默认普通窗口（`main.js:185-191` 无该键）。
- **没有 `roundedCorners`**——用默认值（`main.js:185-191` 无该键）。
- **没有 `minimizable`/`maximizable`/`closable`/`fullscreenable`/`titleBarStyle`/`autoHideMenuBar`**（grep `minimi|autoHideMenuBar` 在 `apps/desktop` 仅命中 `package-lock.json` 的 `minimist`，源码零命中）。
- **没有 `webPreferences.backgroundThrottling` / `nodeIntegration` / `spellcheck` / `devTools`**（grep `backgroundThrottling|spellcheck|nodeIntegration` 在 `apps/desktop` 零命中）→ 走 Electron 默认值；隐藏时是否有节流依赖默认行为，**未见实测记录**（保守结论：不可假定省电）。
- **没有全局快捷键**（grep `globalShortcut|before-input-event` 在 `apps/desktop` 零命中）。
- **没有应用菜单管理**（grep `Menu.setApplicationMenu` 零命中）；`Menu` 只用于托盘右键菜单（`main.js:19` 导入、`main.js:342-350` 使用）。

**兜底尺寸与启动位置**：

```js
const FALLBACK_CONTENT = { width: 132, height: 152 }        // main.js:34
// 首启：width = 132 + 16*2 = 164，height = 152 + 16*2 = 184
const anchorRight = saved === null ? 18 : null              // main.js:181
x = area.x + area.width  - width  - 18                      // main.js:183
y = area.y + area.height - height - 18                      // main.js:183
```
（证据：`main.js:34`、`main.js:179-184`）

### 1.2 进程模型

| 角色 | 内容 | 证据 |
|---|---|---|
| 主进程（唯一） | 窗口、托盘、自启、`screen` 几何、自更新、**游戏宿主** | `main.js:19`（electron 导入清单）、`main.js:428-459` |
| 游戏宿主运行在主进程 | `startHost(gameDir, statePath)`，内含 `store.js` + `routes.js` 动态 `import` | `main.js:444`、`lib/host.js:16-25` |
| 渲染进程 | 仅 1 个 `BrowserWindow` 的 webContents（无第二窗口、无 `webview`、无 Worker 创建） | `main.js:185-197`；`renderer/index.html:1-11` 全文仅一个 `<script>` |
| 渲染进程权限 | `sandbox: true` + `contextIsolation: true` + preload 白名单 | `main.js:190`、`preload.cjs:7-37` |
| 本地服务 | **不开端口**：自定义协议 `piggy://`，`registerSchemesAsPrivileged({standard,secure,supportFetchAPI})` | `main.js:66-68`、`main.js:98-110`；`lib/host.js:5`（「不开任何端口」） |
| 静态资源 | `/dsh-piggy/*` → 宿主路由；`/client.js` → 游戏包；其余 → `apps/desktop/renderer/` | `main.js:98-110` |
| 路径穿越防护 | `normalize` + `startsWith(root)` + 存在性检查，MIME 白名单 5 种 | `main.js:81-88` |

**内存/空闲行为**：仓库内**没有**任何显式内存回收或空闲挂起逻辑——grep `powerMonitor|getSystemIdleTime|setOpacity|setContentProtection` 在 `_ref` 全域零命中；隐藏猪只调用 `win.hide()`（`main.js:341`、`main.js:343`），渲染进程与页面定时器继续存在。

### 1.3 生命周期

**启动序列**（`main.js:428-459`）：

1. `app.whenReady()` → 若需要 X11 直接 return（`main.js:428-429`）
2. 建 `shellUpdates`（`main.js:431-436`）
3. 建 `versions`（`main.js:437-442`，`fetch` 用 `net.fetch` 以走系统代理，`main.js:440-441`）
4. `gameDir = versions.activeDir()`（`main.js:443`）
5. `host = await startHost(gameDir, statePath())`（`main.js:444`）
6. `registerProtocol(gameDir)`（`main.js:445`）
7. `createWindow()`（`main.js:446`）
8. `createTray(gameDir)`（`main.js:447`）
9. 挂显示器变化监听 `reclamp`（`main.js:449-456`）
10. `did-finish-load` → `pushGeometry()`；再无条件 `pushGeometry()` 一次（`main.js:457-458`）

窗口显示时机：`ready-to-show` → `win.showInactive()`（**不抢焦点**），并记录尺寸与可见性（`main.js:198`）。

**单实例**：`if (!needsX11 && !app.requestSingleInstanceLock()) app.quit()`（`main.js:72`）；第二个实例启动时 `app.on('second-instance', () => win?.showInactive())`（`main.js:493`）——即「再点一次图标 = 把猪叫出来」，不新开窗口。

**Wayland 特例**：Linux + `WAYLAND_DISPLAY` 且未带 `--ozone-platform=x11` 时，**手动 spawn 一份带 X11 flag 的进程并 `app.exit(0)`**（`main.js:55-64`）；理由写在注释里：Wayland 不允许窗口置顶与自定义形状，XWayland 可以（`main.js:55-56`）。

**退出路径**（4 条，全部收敛到 `app.quit()`）：

| 入口 | 行为 | 证据 |
|---|---|---|
| 托盘「退出」 | `app.quit()` | `main.js:348` |
| 页面「退出」 | `ipcMain.handle('piggy:quit')` → `app.quit()`（需 `fromPage` 校验） | `main.js:422` |
| 快捷键 | **不存在**（无 `globalShortcut`） | grep 零命中 |
| 所有窗口关闭 | `app.on('window-all-closed', () => app.quit())` | `main.js:495` |
| 退出前存档 | `app.on('before-quit', () => host?.dispose())` → `store.dispose()` 里 `writeNow()` 落盘 | `main.js:494`、`store.js:84-94` |

**存档节流**：`SAVE_THROTTLE_MS = 1500`（`store.js:16`），`scheduleSave()` 用 `setTimeout` 合并写、`timer.unref()`（`store.js:35-49`）；写失败只 `console.warn`，不打断游戏（`store.js:42-46`）。

**测试/调试后门**（复刻时建议保留同类）：

- `PIGGY_USERDATA` 覆盖 `userData`（`main.js:71`）
- `PIGGY_CAPTURE` + `PIGGY_CAPTURE_STEPS`：跑一串页面步骤并截图 + 打印当前 shape（`main.js:461-491`）
- `PIGGY_DEVTOOLS=1` 打开 detached DevTools（`main.js:202`）
- `PIGGY_RELEASES_URL` 换更新源（`main.js:439`）
- 日志：`userData/piggy.log`，`appendFileSync` + try/catch 包裹（`main.js:36-45`）；页面 error 级以上 console 转发进日志（`main.js:201`）

---

## 二、点击穿透 / 窗口区域（完整数据流）

### 2.1 数据流七步

```
[渲染层] shell.js boxes()            →  合并可见节点矩形，算出 content 与 shape
   ↓  shell.js tick()（120ms + pointermove/pointerup）
   ↓  key 变了才发
[桥]     preload.cjs setContent()     →  ipcRenderer.send('piggy:content', content)
[主进程] ipcMain.on('piggy:content')  →  夹取/取整 → applyShape(shape)
   ↓
[系统]   win.setShape(rects)          →  Windows/Linux 抠出可点区域；其余点击穿透到桌面
```

### 2.2 谁算：渲染层（`apps/desktop/renderer/shell.js:95-156`）

1. **候选节点**：宿主 `[data-dsh-pig]` 自身 + 其全部后代（`shell.js:96-100`）。
2. **可见性过滤**：`node.closest('[hidden]') !== null` 或 `visible(node)` 为假则跳过（`shell.js:105`、`shell.js:76-79`：`display!=='none' && visibility!=='hidden' && opacity>0.01`）。
3. **尺寸过滤**：宽或高 `< 1px` 跳过（`shell.js:107`）。
4. **量框**：`layoutBox()` 逐级累加 `offsetLeft/offsetTop` 直到 `document.body`，尺寸取 `offsetWidth/offsetHeight`（`shell.js:82-92`）。**这是全案最关键的性能约束**——注释明写：呼吸/浮动动画只改 `transform`，用 `getBoundingClientRect` 会每帧抖动，Windows 上退化成每秒一次 `SetWindowRgn`（`shell.js:9-11`）。
5. **合并**：两两相交（`one.x <= two.r && two.x <= one.r && one.y <= two.b && two.y <= one.b`）就并成一个大矩形，循环到不再合并为止（`shell.js:114-128`）。复杂度 O(n²) 每轮，实际节点数很小（HUD/猪/面板等）。
6. **内容外接框**：所有合并矩形的 min/max，再四周扩 `PAD=16`（`shell.js:130-140`、`shell.js:19`）。
7. **可点区域**：**直接用页面坐标**（页面原点 = 窗口原点），左上 `floor()-1`、右下 `ceil()+1`，各放宽 1px（`shell.js:149-153`）。注释写明放宽原因：以前按内容框原点换算再四舍五入到 4px，相邻两块之间会漏缝，透出后面的东西（用户看到的「黑条」），面板右边也会被切几像素（`shell.js:146-148`）。

同时上报猪在内容框里的位置 `pig {x,y,w,h}`（`shell.js:143-145`）与**猪在窗口坐标里的原始位置** `pigWindow`（`shell.js:256`，取自 `pigBox`），后者专供主进程两步收敛（`shell.js:226-227`）。

### 2.3 何时更新 / 节流

| 机制 | 实现 | 证据 |
|---|---|---|
| 轮询 | `setInterval(tick, 120)`（≈8.3 次/秒） | `shell.js:267` |
| 事件驱动补充 | `pointermove` + `pointerup` 上挂 `tick` | `shell.js:268-269` |
| 变化判定 | `keyOf()`：内容宽高 + 猪在内容框内的位置按 **4px** 分档；`shape` 各字段按 4px 分档；**猪在窗口坐标的位置按 1px**（粗了会漏掉 4px 以内的补正） | `shell.js:223-235`、`shell.js:21-22` |
| 同 key 直接 return | `if (key === lastKey) return` | `shell.js:250-251` |
| 锚边钉住只在变化时写样式 | `pinPig()` 用 `pinned` 字符串去重，避免每帧改样式 | `shell.js:158-162`、`shell.js:189-195` |
| 效果 | 10 秒 83 次 tick，上报增量 **0** | `apps/desktop/test/window.test.js:163-172` |

### 2.4 主进程侧（`apps/desktop/main.js:221-262`、`main.js:167-174`）

- 入口校验：`win !== null && event.sender === win.webContents`（`main.js:222`）；宽高必须是有限数（`main.js:226`）。
- 上报的 `shape` 被**截断到前 64 个矩形**，并逐字段 `Math.max(0, Math.round(...))`（`main.js:256-260`）。
- **平台限制**：`process.platform === 'darwin'` 或 `typeof win.setShape !== 'function'` 直接 return（`main.js:172`）。注释给出代价评估：macOS 上「窗口已经只有猪和面板那么大，四周 16px 的透明边会挡一下点击，影响不大」（`main.js:168-170`）。
- 另有一条**并行但当前无人调用**的通道 `piggy:shape`（`main.js:281-289`，preload 暴露为 `setShape`，`preload.cjs:11`）：实测渲染层 `shell.js` 只调用 `setContent`（`shell.js:252`，shape 随 `piggy:content` 一起走）；grep `setShape` 在 `shell.js`/`client.js` 零命中，仅测试假对象中出现（`apps/desktop/test/window.test.js:103`、`test/client.test.js:2062`）。**这是冗余路径，可裁**。

### 2.5 实测形状数据

X11 实机（3840×2160 屏）用 `XShapeGetRectangles` 读到的可点区域 **2 块**：面板 `(32,32,584,192)` + 猪 `(32,240,584,272)`，空白角被抠掉，点得到桌面（`docs/tasks/C-round.md:335-336`）。

---

## 三、交互与事件路由

### 3.1 拖动 = 移动窗口（不是移动页面元素）

| 环节 | 实现 | 证据 |
|---|---|---|
| 按下 | `scene` 的 `pointerdown`，仅响应 `button === 0`；记录 `clientX/Y` + `screenX/Y` + 起始位置；`setPointerCapture` | `_ref/client.js:4802-4817` |
| 移动（桌面版分支） | `desktopShell() !== null` 时：用 **`screenX/screenY`** 算增量，`stepX/stepY` 逐次发给 `moveBy`，**直接 return（不改页面位置）** | `_ref/client.js:4822-4832` |
| 移动（网页版分支） | 用 `clientX/Y` 改 `userRight/userBottom` + `clampPig()` + `fitPanel()` | `_ref/client.js:4834-4838` |
| 松开 | `endDrag()`：清理状态；**桌面版不写 `POSITION_KEY`**；`fitPanel()` | `_ref/client.js:4840-4849` |
| 主进程 | `ipcMain.on('piggy:move')` → `moveAcrossDisplays()` → `applyBounds()` → `win.setBounds()` | `main.js:271-279` |
| 桥 | `moveBy: (dx,dy) => ipcRenderer.send('piggy:move', {dx,dy})`，`Number()` 归一 + 非法值忽略 | `preload.cjs:13`、`main.js:273-275` |

**为什么必须用 `screenX`**：窗口自己在动，`clientX` 相对窗口，下一次算出来的增量就错了（追不上鼠标/抖动）。这一条在 `docs/tasks/C-round.md:600` 被列为「高风险，没测到」的历史 bug，现有测试 `test/desktop-shell.test.js:57-69` 专门守它。

**只有一个地方发 `moveBy`**：外壳自己**不**监听鼠标再发一次（会和页面拖动叠成双倍位移）——有测试守着（`apps/desktop/test/window.test.js:253-262`）。

### 3.2 左键交互

| 行为 | 实现 | 证据 |
|---|---|---|
| 松开且未拖动 → 摸猪 | `flash('pet')` | `_ref/client.js:4866-4873` |
| 未孵化（还是纸盒）→ 连点开箱 | `pokeBox()`；`boxPokes >= BOX_POKES_TO_OPEN` 触发 `send('hatch')` | `_ref/client.js:4850-4865`、`_ref/client.js:4867-4871` |
| 拖动判定阈值 | 屏幕位移 > 3px 才算「拖动过」 | `_ref/client.js:4826` |
| 拖动误触防护 | 有专门测试：窗口跟随鼠标时，松手不能误判成摸猪 | `test/desktop-shell.test.js:71-81` |
| 图标栏点击 | 图标按钮 `click` → 未开面板则开、再选 tab | `src/client/layout.js:133-136` |

### 3.3 右键

`scene.addEventListener('contextmenu')` → `event.preventDefault()` → **切换游戏面板开合**（`setOpen(!isOpen)`），面板已开则顺手摸一次猪（`_ref/client.js:4877-4881`，源码同源 `src/client/index.js:323-327`）。
**不存在原生右键菜单**（无 `Menu.popup`、无 `context-menu` 事件监听；grep `popup` 在 `apps/desktop` 零命中）。

### 3.4 双击

**不存在**双击处理（grep `dblclick` 在 `_ref` 全域零命中）。唯一与 `event.detail` 相关的逻辑在钓鱼 QTE：`if (event.detail > 0 && event.timeStamp - lastPointerAt < 700) return`（`_ref/client.js:3445`），用于避免同一次点击被 `click` 与 `pointerdown` 处理两次。

### 3.5 穿透区域为什么不吞桌面点击（三重保障）

1. **窗口本身就小**（只包内容 + 16px），不是全屏覆盖层（`main.js:5-8`）。
2. **`setShape` 抠形状**：shape 外完全穿透（`main.js:173`）。
3. **页面侧 `pointer-events` 兜底**：宿主容器 `pointer-events:none`，仅直接子元素 `auto`（`src/client/css-base.js:56`、`src/client/css-base.js:62`）。注释记录了历史故障：容器比实际绘制区域大，会吞掉下层的点击，表现为「发消息没反应」（`src/client/css-base.js:52-56`）。

### 3.6 焦点与「不打扰」相关的既有选择

- 显示用 `showInactive()`（三次：首次显示 `main.js:198`、托盘恢复 `main.js:341`、第二实例 `main.js:493`）→ 启动/恢复都不抢焦点。
- 但 `focusable: true`（`main.js:188`）→ **用户点击猪时窗口会获得焦点**，会把前台应用（含全屏游戏）的焦点切走。复刻时若要「绝对不打扰」，这是需要改的一项。

---

## 四、置顶与全屏让位（含缺口）

### 4.1 现有置顶策略

```js
alwaysOnTop: true,                                  // main.js:188
win.setAlwaysOnTop(true, 'floating')                // main.js:192
```
- 层级参数写死 `'floating'`，**没有** `'screen-saver'`、没有按场景切换（`main.js:192`）。
- **注意平台差异**：Electron 社区长期记录 `setAlwaysOnTop` 的 `level` 参数在 Windows 上未实现（[electron#18933](https://github.com/electron/electron/issues/18933)）；仓库里没有针对该差异的注释或兜底。**复刻时应以目标 Electron 版本 + Windows 实机确认 `'floating'` 是否真的生效**，不要把层级当成可依赖的手段。
- 未使用任何其它「压在别人上面」的手段：grep `setVisibleOnAllWorkspaces|setFullScreenable|setIgnoreMouseEvents|setOpacity|setContentProtection` 在 `_ref` 全域**零命中**。

### 4.2 是否随全屏应用让位 —— **不存在**

grep 范围与结果（`_ref` 全域 `*.js`）：

| 模式 | 命中 |
|---|---|
| `fullscreen` / `FullScreen` / `isFullScreen` / `setFullScreen` / `kiosk` | **0**（唯一命中是 `main.js:188`、`main.js:192` 的 `alwaysOnTop`，被同一正则扫到） |
| `powerMonitor` / `getSystemIdleTime` | **0** |
| `minimi`（最小化）/ `showDesktop` / 虚拟桌面（`virtual`/`workspace`） | **0**（`apps/desktop` 源码零命中；`virtual` 仅命中 `lib/window-geometry.js:82` 的注释，那里指多屏工作区并集，不是虚拟桌面；`workspace` 仅命中 `package-lock.json` 的 npm workspaces） |
| 前台窗口查询（`foreground` / `GetForegroundWindow`）/ 原生扩展（`.node` / `ffi-napi` / `koffi`） | **0**（源码零命中；`node-gyp` 仅出现在 `package-lock.json` 的依赖树里） |

结论：**当前实现下，全屏游戏/全屏视频/演示时猪照样浮在最上层**，且点击猪会抢焦点。这与「不与全屏化的游戏等冲突」硬约束直接冲突，是复刻时必须新增的能力。

### 4.3 应在何处介入（给出可落地的挂点）

| 方案 | 挂点 | 理由与代价 |
|---|---|---|
| A. 主进程轮询/事件探测全屏，临时摘置顶 | `main.js:446` `createWindow()` 之后注册；与 `main.js:449-456` 的 `screen.on(...)` 那一组监听并列 | 与现有 `alwaysOnTop` 唯一的写入点（`main.js:188/192`）同处主进程，改动集中；需要新增一个 `win.setAlwaysOnTop(false/true)` 的开关函数 |
| B. 探测到全屏就 `win.hide()`（连像素都不出现） | 同上 | 更彻底，但要配合托盘「叫猪出来」的语义（`main.js:341-343`），避免用户以为程序挂了 |
| C. 复用页面 tick 上报 | `shell.js:267` 的 `tick()` 里带一个「屏幕被占用」标记 | 现有 IPC 形状已支持（`piggy:content` 里加字段即可），但探测本身仍需主进程做 |
| D. 只用渲染层 | 不可行 | 页面拿不到其它进程的前台/全屏状态 |
| E. `win.setIgnoreMouseEvents(true)` | `main.js:171-174` 附近（与 `applyShape` 并列） | 作为「穿透但不消失」的中间态：全屏时保留可见但完全不接收点击（不会抢焦点） |

**验收口径（建议直接沿用到复刻）**：
- 全屏应用（独占 + 无边框全屏都要测）切到前台 ≤ 500ms 内猪不可见或不可点击；
- 退出全屏后 ≤ 500ms 内自动恢复，且窗口位置/尺寸与隐藏前完全一致（复用 `readWindowState`/`applyBounds` 的既有能力，`main.js:122-128`、`main.js:157-165`）；
- 隐藏期间不产生 `setBounds` 抖动（`applyBounds` 已有「值相同就 return」，`main.js:160`）。

### 4.4 「显示桌面」/ 最小化 / 多显示器 / DPI

| 场景 | 现状 | 证据 |
|---|---|---|
| 「显示桌面」(Win+D) | **无任何处理**；无 `minimizable`/`minimize`/`showDesktop` 相关代码 | grep 零命中（见 §4.2） |
| 用户最小化 | 无最小化按钮（`frame:false` + `skipTaskbar:true`），也无快捷键 | `main.js:187-188`、grep `globalShortcut` 零命中 |
| 多显示器 | 有完整策略：启动时取鼠标所在屏；运行中按窗口所在屏取 `workArea`；拖动时按**虚拟桌面并集**夹取；显示器增删/度量变化时 `reclamp` | `main.js:112-115`、`main.js:145-148`、`main.js:277`、`main.js:449-456`、`lib/window-geometry.js:83-92` |
| 任务栏避让 | 隐式靠 `workArea`（`screen.*.workArea` 已排除任务栏） | `main.js:147`、`main.js:178`、`main.js:277` |
| DPI 缩放 | **无显式处理**：grep `scaleFactor|zoomFactor` 零命中。所有坐标都是 Electron DIP（`screen` API 与 `setBounds` 均用 DIP），跨不同缩放率显示器拖动时窗口物理尺寸会变，进而触发新一轮 content 上报——**无验证记录** | grep 零命中；`main.js:154`、`main.js:161` |

---

## 五、几何与多屏

### 5.1 常量表（`apps/desktop/lib/window-geometry.js`）

| 常量 | 值 | 证据 | 用途 |
|---|---|---|---|
| `WINDOW_PADDING` | `16` | `lib/window-geometry.js:10` | 内容外接框四周留白；渲染层有同名副本 `PAD = 16`（`renderer/shell.js:19`） |
| `MIN_WINDOW` | `{96,96}` | `lib/window-geometry.js:13` | 窗口最小尺寸，别缩成一条线 |
| `QUANTIZE_STEP` | `4` | `lib/window-geometry.js:16` | 取整步长；渲染层副本 `STEP = 4`（`renderer/shell.js:22`） |
| `ANCHOR_TOLERANCE` | `1` | `lib/window-geometry.js:95` | 猪的屏幕位置差 ≤1px 就不动窗口 |

> **注意**：`16` 与 `4` 在渲染层与主进程各写了一份（`renderer/shell.js:18-22` 的注释明确说「和 lib/window-geometry.js 一致」）。复刻时应抽成单一来源或至少加断言，否则改一处会静默错位。

### 5.2 四个纯函数 + 两步收敛

| 函数 | 作用 | 证据 |
|---|---|---|
| `clampBounds(bounds, area)` | 夹进工作区；比工作区还大的窗口不硬塞，贴左上 | `lib/window-geometry.js:27-38` |
| `contentBounds(windowBounds, content, area)` | **内容变了只改大小**：盯住猪贴的那两条锚边，往另一边长 | `lib/window-geometry.js:51-64` |
| `movedBounds` / `moveAcrossDisplays` | 拖动平移；跨屏时夹到**所有屏工作区的并集** | `lib/window-geometry.js:73-80`、`lib/window-geometry.js:83-92` |
| `anchorCorrection(windowBounds, pigWindow, targetPigScreen, area)` | **第二步收敛**：窗口大小已改好后，按页面量到的猪窗口坐标把窗口平移一次，补掉残余 | `lib/window-geometry.js:111-123` |

**两步收敛的完整流程**（`main.js:214-262`）：

```
页面报 piggy:content
 ├─ changed?（尺寸或 anchor 变了，main.js:232-234）
 │   ├─ 是 → 记下「变化前猪的屏幕坐标」= 当前窗口原点 + 上次的 pigWindow（main.js:238-241）
 │   │        applyBounds(contentBounds(...), 'content')                （main.js:242）
 │   └─ 否 → 若上一次是 changed 且本次带 pigWindow：                     （main.js:243-249）
 │            corrected = anchorCorrection(...)；passes += 1
 │            corrected !== null 才 applyBounds(..., 'anchor')
 │            corrected === null 或 passes >= 3 → 收敛结束
 └─ 更新 lastContent / lastPigWindow（main.js:251-252）
```
- 收敛上限 **3 趟**（`main.js:248`），容差 1px（`lib/window-geometry.js:95-116`）。
- 收敛只在「内容变化」时启动，闲着不触发（`main.js:214-220` 注释）。
- 实测效果：X11 实机四个角展开/收起位移全部 **0.0 DIP**（`docs/tasks/C-round.md:487`、`docs/tasks/C-round.md:638-639`）。

### 5.3 锚边协议

- 页面决定「猪贴哪两条边」，由**面板相对猪的位置**决定（比中心，不比边，因为面板比猪宽得多）：面板在猪上方 → 猪贴底边；下方 → 贴顶边；横向同理（`renderer/shell.js:205-221`）。
- 面板收起时**保持上一次锚边**（首次右下角），避免「一开除就翻锚点、窗口带着猪跳」（`renderer/shell.js:203-208`、`renderer/shell.js:160-162`）。
- 页面把整块内容（猪/面板/HUD/气泡）离锚边钉在正好 `PAD`，方法是按内容外接框**反推 host 内边距**（`renderer/shell.js:171-196`）。注释记录了为什么钉「整块内容」而不是钉猪：面板朝下开时 HUD 在猪上面，钉猪会让 HUD 伸出窗口（`renderer/shell.js:164-169`）。
- 面板朝哪边开由**屏幕空间**决定，不是窗口 `innerWidth`：`room()` 返回 `above/below/left/right/width/height`（`renderer/shell.js:34-56`），`fitPanel` 用它挑边并在 host 上写 `data-panel-side`（`src/client/layout.js:40-77`，横向 `55-72`）。

### 5.4 边缘吸附

**不存在**「拖到屏幕边缘自动吸附」的逻辑（grep `(?i)吸附|snap|magnet|dock` 在 `apps/desktop` 只命中 `scripts/pack-game.mjs:13` 的文件名 `snapshot.js`，无吸附实现）。只有「夹取不让露到工作区外」（`clampBounds`）与「内容变化时按锚边生长」（`contentBounds`）。若要加吸附，落点在 `main.js:271-279`（拖动入口）之后、`applyBounds` 之前。

### 5.5 窗口位置持久化

- 文件：`userData/window.json`（`main.js:117-120`）。
- 读：`readWindowState()` 只接受含有限 `width/height` 的对象（`main.js:122-128`）。
- 写：**800ms 防抖**，因为拖动时 `setBounds` 连发（`main.js:130-143`）。
- 恢复：有存档则按其宽高 + `clampBounds` 到该屏工作区（`main.js:177-184`）。

---

## 六、IPC 清单（完整）

### 6.1 全部通道

| # | 通道名 | 方向 | 类型 | 载荷 | 主进程处理 | 页面调用点 |
|---|---|---|---|---|---|---|
| 1 | `piggy:content` | 页面 → 主 | `send`/`on` | `{width,height,pig:{x,y,w,h},pigWindow:{x,y},anchor:{vertical,horizontal},shape:[{x,y,width,height}]}` | `main.js:221-262` | `renderer/shell.js:252-259` |
| 2 | `piggy:shape` | 页面 → 主 | `send`/`on` | `rects[]` | `main.js:281-289` | **无调用方**（preload 暴露 `setShape`，`preload.cjs:11`） |
| 3 | `piggy:move` | 页面 → 主 | `send`/`on` | `{dx,dy}` | `main.js:271-279` | `client.js:4831`（经 `__dshPiggyShell.moveBy`，`renderer/shell.js:57`） |
| 4 | `piggy:geometry:ask` | 页面 → 主 | `send`/`on` | 无 | `main.js:266-269` | `renderer/shell.js:30` |
| 5 | `piggy:geometry` | 主 → 页面 | `send`/`on` | `{window:{x,y,w,h}, workArea:{x,y,w,h}}` | `main.js:150-155`（`pushGeometry`） | `preload.cjs:18-20`；消费方 `renderer/shell.js:34-56` |
| 6 | `piggy:updates:current` | 页面 → 主 | `invoke`/`handle` | 无 → `{version,bundled,bundledVersion,shell,previous,previousIsBundled}` | `main.js:375` | `preload.cjs:23` |
| 7 | `piggy:updates:list` | 页面 → 主 | `invoke`/`handle` | 无 → `{ok,releases[]}` 或 `{ok:false,reason}` | `main.js:376-384` | `preload.cjs:24` |
| 8 | `piggy:updates:install` | 页面 → 主 | `invoke`/`handle` | `version` → `{ok,version}` / `{ok:false,reason}` | `main.js:385-398`（先 `backupSave`，600ms 后 `restartGame`） | `preload.cjs:25` |
| 9 | `piggy:updates:rollback` | 页面 → 主 | `invoke`/`handle` | 无 → `{ok,version}` / `{ok:false,reason}` | `main.js:399-405` | `preload.cjs:26` |
| 10 | `piggy:progress` | 主 → 页面 | `send`/`on` | `fraction:number` | `main.js:392` | `preload.cjs:27` |
| 11 | `piggy:shell:status` | 页面 → 主 | `invoke`/`handle` | 无 → `{mode,currentVersion,readyVersion}` | `main.js:406` | `preload.cjs:30` |
| 12 | `piggy:shell:download` | 页面 → 主 | `invoke`/`handle` | `version` → `{ok,version}` / `{ok:false,reason}` | `main.js:407-412` | `preload.cjs:31` |
| 13 | `piggy:shell:install` | 页面 → 主 | `invoke`/`handle` | 无 → `{ok}` / `{ok:false,reason}` | `main.js:413-421` | `preload.cjs:32` |
| 14 | `piggy:shell-progress` | 主 → 页面 | `send`/`on` | `fraction:number` | `main.js:435` | `preload.cjs:33` |
| 15 | `piggy:quit` | 页面 → 主 | `invoke`/`handle` | 无 | `main.js:422` | `preload.cjs:37` |
| 16 | `piggy:open` | 页面 → 主 | `invoke`/`handle` | `url` | `main.js:423-426` | `preload.cjs:35` |

（表中 1-4 属于「页面 → 主进程事件」，5、10、14 属于「主 → 页面推送」，其余为请求/响应。合计 **16 个通道名**；其中 `piggy:shape` 当前无调用方，实际活跃 15 个。）

### 6.2 桥的暴露面（`preload.cjs:7-37`）

```
window.piggyShell = {
  setContent, setShape, moveBy,          // 窗口几何
  geometry, askGeometry, onGeometry,     // 屏幕信息
  updates: {current,list,install,rollback,onProgress},
  shellUpdates: {status,download,install,onProgress},
  openPage, quit,
}
```
以及外壳额外挂的游戏侧对象 `window.__dshPiggyShell = { room(), moveBy() }`（`renderer/shell.js:32-58`），由游戏代码 `src/client/desktop-shell.js:11-14` 探测（要求 `typeof shell.moveBy === 'function'`）。

### 6.3 安全约束（复刻必须保留）

| 约束 | 证据 |
|---|---|
| 每个 `send`/`handle` 都校验 `event.sender === win.webContents` | `main.js:222,267,272,283,374` |
| `fromPage()` 统一封装（`win !== null && event.sender === win.webContents`） | `main.js:374`，用于全部更新类通道 |
| `piggy:open` 只允许本仓库 release 页前缀 | `main.js:423-426` |
| 静态文件服务拒绝路径穿越 | `main.js:84-88` |
| 协议注册为 `standard+secure`，支持 fetch | `main.js:66-68` |
| `contextIsolation: true` + `sandbox: true` | `main.js:190` |

---

## 七、既有性能优化清单（可直接照搬）

| 手段 | 位置 | 量化/理由 |
|---|---|---|
| 窗口贴合内容，不铺满 | `main.js:5-8`、`main.js:179-184` | 实测 117×114 / 324×271 DIP（`docs/tasks/C-round.md:331-336`）；避免 Windows 全屏透明层合成 |
| 帧率上限 30fps | `main.js:32`、`main.js:194` | 注释：整窗合成次数砍一半 |
| 量框用布局盒而非 `getBoundingClientRect` | `renderer/shell.js:81-92`、注释 `renderer/shell.js:9-11` | 避免 `transform` 动画导致每秒一次 `SetWindowRgn` |
| 4px 分档 + key 比对 | `renderer/shell.js:223-235`、`lib/window-geometry.js:16-20` | 动画级抖动不触发上报；有测试守（`window.test.js:406-411`） |
| 上报节流：120ms + 指针事件 | `renderer/shell.js:267-269` | 同时保证拖动/松手立刻刷新 |
| 闲着零上报 | `window.test.js:163-172` | 10 秒 83 tick → 增量 0 |
| 显示/移动去抖：值相同直接 return | `main.js:160` | 避免无谓 `setBounds` |
| 窗口位置写盘 800ms 防抖 | `main.js:131-143` | 拖动时 `setBounds` 连发 |
| 存档写盘 1500ms 防抖 + `unref()` | `store.js:16`、`store.js:35-49` | 不阻塞进程退出 |
| shape 矩形数上限 64 | `main.js:257`、`main.js:285` | IPC 与系统调用规模有界 |
| shape 合并同类矩形 | `renderer/shell.js:114-128` | 可点区域块数最小化（实测 2 块） |
| 锚点两步收敛 + 1px 容差 + 最多 3 趟 | `main.js:236-249`、`lib/window-geometry.js:95-123` | 避免来回改窗口 |
| 阴影放在**不做动画**的立绘元素上 | `src/client/css-base.js:109-113` | 注释：滤镜每帧重算在 Windows 上很贵（D1 第 4 条） |
| 动画只改 `transform` | `src/client/css-base.js:111-112`、`src/client/css-base.js:138` | 不触发 layout/paint 重算 |
| 面板与 HUD 绝对定位，不撑宽宿主 | `src/client/css-base.js:77-92` | 避免「面板一开猪横移 207px」 |
| 页面 console 只转发 `level >= 2`（warning/error）进日志 | `main.js:201` | 减少日志 IO |
| 托盘隐藏而非销毁窗口 | `main.js:341`、`main.js:343` | 恢复零成本 |
| 单实例锁 | `main.js:72`、`main.js:493` | 防多份渲染进程 |

**页面侧常驻定时器（复刻时应重新评估，属于「轻量化」的隐性成本）**：

| 定时器 | 周期 | 生命周期 | 证据 |
|---|---|---|---|
| 外壳量框 `tick` | 120ms | 常驻 | `renderer/shell.js:267` |
| 状态轮询 `refresh` | `POLL_MS = 4000` | 常驻（挂载即起） | `src/client/constants.js:14`、`_ref/client.js:4886` |
| 番茄钟 `tick` | 1000ms | **挂载即起**（`createPomodoroClock` 在 `createIo` 内无条件创建，`_ref/client.js:2366`；interval 在 `_ref/client.js:2273`） | 即使没有番茄钟任务也在跑 |
| 更新检查 | 10s 后一次 + 每 6 小时 | 常驻 | `_ref/client.js:4478-4479` |
| 闲聊 | 20–40 分钟随机 | 常驻 | `_ref/client.js:4888-4898`、`src/client/constants.js:17` |

> 合计：即使什么都不做，桌面版每秒也有 ≈9.3 次定时器回调（120ms tick）+ 1 次番茄 tick + 每 4s 一次网络轮询。复刻时若砍掉番茄钟/更新检查，需要同步删掉这些 interval。

---

## 八、桌面版最小文件集（复刻拷贝清单）

### 8.1 外壳必备（`apps/desktop/package.json` 的 `build.files`，第 27-35 行）

| 文件 | 必需性 | 证据 |
|---|---|---|
| `main.js` | **必需**，24KB，全部窗口行为 | `package.json:28` |
| `preload.cjs` | **必需**，38 行桥 | `package.json:29`、`main.js:190` |
| `lib/window-geometry.js` | **必需**（几何纯函数） | `package.json:30`、`main.js:23` |
| `lib/host.js` | **必需**（无端口宿主） | `main.js:22`、`main.js:444` |
| `lib/versions.js` | 可选（游戏热更新） | `main.js:24` |
| `lib/shell-update.js` | 可选（外壳自更新） | `main.js:25` |
| `renderer/index.html` | **必需**（11 行，透明底） | `package.json:31`、`renderer/index.html:1-11` |
| `renderer/shell.js` | **必需**（量框/穿透/拖动/钉边） | `package.json:31`、`renderer/shell.js:1-272` |
| `build/tray.png` | **必需**（托盘图标） | `package.json:32`、`main.js:337` |
| `build/icon.png` | 打包必需（安装包图标） | `package.json:33`、`package.json:47/55/82` |
| `package.json` | **必需**（`main` 字段与版本号） | `package.json:7` |
| `node_modules/electron-updater` | 仅当保留更新功能 | `package.json:94-96`、`main.js:20` |

**裁撤更新层的最小改法**：删 `main.js:20`（`electron-updater` 导入）、`main.js:24-25`（`versions`/`shell-update` 导入）、`main.js:372-421`（`fromPage` + 7 个更新类 handler）、`main.js:431-436`（`shellUpdates`）；`main.js:437-443` 的 `versions` 创建改为直接用 `bundledGameDir()` 取游戏目录（`main.js:75-77`）；同步删 preload 的 `updates`/`shellUpdates` 两组（`preload.cjs:22-34`）与页面里的更新 App（`src/client/tabs/update.js`）。可省掉唯一运行时依赖。

### 8.2 游戏包必备（`apps/desktop/scripts/pack-game.mjs:12-15` 的 `GAME_FILES`）

```
package.json
core.js
data.js
store.js
store/                      ← 存档读写 + 皮肤包导入
routes.js
snapshot.js
packages/pet-core/package.json
packages/pet-core/src/      ← 纯逻辑核心 + 数据表
client.js                   ← 构建产物（241KB，前端全部）
assets/                     ← 34 个 SVG（约 130KB）
```
（证据：`apps/desktop/scripts/pack-game.mjs:12-15`；打包脚本强制检查每一项存在，缺一即抛错，`pack-game.mjs:20-25`）

**不要拷**（桌面版用不到，或属于插件侧）：`index.js`、`commands.js`、`render.js`、`cordis.patch.yml`、`src/`（源码，已打进 `client.js`）、`docs/`（截图占仓库体积 95% 以上，PROJECT-REF §3）、`test/`、`tools/`、`scripts/`（构建脚本）。

### 8.3 桌面版与插件版共享代码的边界（必须一起改的部分）

| 共享点 | 内容 | 证据 |
|---|---|---|
| 外壳探测 | `src/client/desktop-shell.js:11-14`（`__dshPiggyShell` + `moveBy` 类型判断） | 复刻新外壳时，游戏侧这段判断要么保留、要么改协议 |
| 拖动分支 | `src/client/index.js` / 构建产物 `client.js:4818-4839` | 桌面版走 `moveBy`，网页版走坐标 |
| 面板挑边 | `src/client/layout.js:37-77`（桌面分支用 `room()` 的屏幕空间） | 网页版分支在 `layout.js:78-115` 不受影响 |
| 位置不写盘 | `_ref/client.js:4581-4591`、`_ref/client.js:4846` | 桌面版不写 `POSITION_KEY`，位置归窗口 |
| CSS 镜像规则 | `src/client/css-base.js:99-103`（`[data-panel-side="right"]` 下场景左对齐、气泡/道具镜像） | 只挂在 `[data-dsh-pig]` 上，网页版不命中 |
| 构建 | `client.js` 是 `npm run build`（`scripts/build-client.mjs`）的产物 | `package.json:47`；改 `src/` 后必须重建，否则游戏侧看不到 |

> **复刻建议**：如果新外壳沿用同一套页面协议（`piggy:content`/`piggy:move`/`piggy:geometry` + `__dshPiggyShell`），可以直接复用现成 `client.js`，外壳侧只需实现 §六 的 4 个通道 + 几何函数；若要换协议，必须同步改 `src/client/**` 并重建。

---

## 九、风险与缺口

| # | 风险/缺口 | 影响 | 证据 | 建议落点 |
|---|---|---|---|---|
| 1 | **无全屏应用检测与让位** | 硬约束「不与全屏游戏冲突」当前不成立：全屏游戏里猪仍浮在最上层，点击会抢焦点 | grep `fullscreen|isFullScreen|kiosk|setFullScreen` 全域 0 命中；`main.js:188,192` | §4.3 方案 A/B/E；挂点 `main.js:446` 之后 |
| 2 | `focusable: true` + 无「点击不抢焦点」机制 | 点猪会把前台应用（含游戏）焦点抢走 | `main.js:188`；显示虽用 `showInactive`（`main.js:198`）但不影响点击后获焦 | 评估 `focusable:false`（Electron 语义需实测）或全屏时 `setIgnoreMouseEvents` |
| 3 | Windows 上 `setAlwaysOnTop` 的 `level` 可能未实现，仓库无兜底/注释 | 置顶层级实际不可控，「浮在谁上面」依赖平台 | `main.js:192`；[electron#18933](https://github.com/electron/electron/issues/18933)（需按目标 Electron 版本实测） | 在 Windows 实机验证层级；不要设计依赖 `'floating'` 的差异化行为 |
| 4 | macOS 不调用 `setShape`，16px 透明边会挡点击 | macOS 上「空白处点击落到桌面」不彻底 | `main.js:171-174`（含注释 168-170） | 用 `setIgnoreMouseEvents` + 渲染层 `pointermove` 命中判定兜底，或接受该退化 |
| 5 | `piggy:shape` 通道 + preload `setShape` + `shapeRects`/`anchorPoint`/`quantizeKey` 均无生产调用方 | 冗余维护面；`shapeRects` 的算法与 `shell.js` 实际使用的算法**不一致**（`shell.js:149-153` 用 floor-1/ceil+1，`window-geometry.js:131-140` 用 4px 取整），误用会重现「黑条漏缝」 | `main.js:281-289`、`preload.cjs:11`、`lib/window-geometry.js:126-145`；grep 仅测试命中（`window.test.js:103,408-409`） | 复刻时直接删掉旧路径，只保留一条 |
| 6 | `skipTaskbar: true` 且无全局快捷键 | 猪被托盘藏起来后，若托盘图标不显示（Linux GNOME 已知），用户只能用主菜单退出 | `main.js:188`、`main.js:341-343`、`docs/guides/desktop.md:14` | 保留托盘 + 加一个「显示/隐藏」全局快捷键作为兜底 |
| 7 | 无虚拟桌面/工作区跟随（Windows 多桌面、macOS Spaces） | 切桌面后猪不跟随，用户以为它消失了 | `setVisibleOnAllWorkspaces` 在 `_ref` 全域 0 命中；`virtual`/`workspace` 仅命中 `lib/window-geometry.js:82` 的注释（指多屏并集）与 `package-lock.json` 的 npm workspaces，无实现 | `main.js:446` 之后补 `win.setVisibleOnAllWorkspaces(true)`（macOS/Linux 语义需实测，Windows 支持情况需确认） |
| 8 | 窗口位置写盘 800ms 防抖，`before-quit` 不 flush `windowStateTimer` | 拖完猪立刻退出（<800ms）会丢最后位置，下次从旧位置启动 | `main.js:131-143`、`main.js:494`（只 `host.dispose()`） | `before-quit` 里清定时器并同步写一次 |
| 9 | 启动即 `applyShape([])`：页面首帧前窗口完全不接收点击 | 若页面脚本抛错，猪既不可见也不可点，只能靠托盘/任务管理器退出（有日志但无自愈） | `main.js:196`；日志 `main.js:36-45`、`main.js:200` | 加 `did-fail-load` / 首帧超时兜底：设一个不含 shape 的兜底可点区域或提示 |
| 10 | 无空闲降频/挂起：托盘隐藏后渲染进程与全部定时器仍在跑 | 「轻量化」在隐藏状态下不成立 | `main.js:341,343`（仅 `hide()`）；grep `backgroundThrottling|powerMonitor` 零命中 | 隐藏时 `win.webContents.setFrameRate(1)` 或 `win.webContents.setBackgroundThrottling(true)` 并暂停页面定时器（需要一个 `piggy:visibility` 推送） |
| 11 | 跨不同 DPI 显示器拖动无验证；无 `scaleFactor` 处理 | 跨缩放屏可能触发尺寸抖动/位置漂移 | grep `scaleFactor|zoomFactor` 零命中；`main.js:154,161,277` | 补一项「125% ↔ 100% 双屏拖动」实测；必要时用 `screen.getDisplayMatching().scaleFactor` 校正 |
| 12 | `console-message` 用旧的位置参数签名 `(event, level, message)` | Electron 新版已改为单 Event 对象（`event.level` 等），旧签名被弃用 → 页面错误可能不再进日志 | `main.js:201`；[Electron WebContents `console-message` 文档](https://www.electronjs.org/docs/latest/api/web-contents#event-console-message)（需按目标 Electron 版本核对旧参数是否仍回调） | 复刻时直接采用单 Event 签名 |
| 13 | 面板/内容尺寸变化是「窗口改大小 + 下一帧平移」两段式，最多 3 趟 | 极端布局下（贴边 + 面板换边）可能有 1 帧视觉跳动 | `main.js:236-249`；实测已收敛到 0.0 DIP（`docs/tasks/C-round.md:638-639`） | 保留该设计并在复刻时沿用同一套测试 |
| 14 | `16`/`4` 两个常量跨进程重复定义 | 改一处不改另一处会静默错位（内容框与窗口尺寸不匹配 → 出现缝隙或裁切） | `renderer/shell.js:18-22` vs `lib/window-geometry.js:10,16` | 由主进程通过 `piggy:geometry` 下发这两个值，或构建期注入 |
| 15 | 单文件巨石：`client.js` 241KB 一次性解析 | 冷启动解析成本；桌面版无法只加载需要的一部分 | `_ref/client.js`（4943 行）、`PROJECT-REF §7`；打包入口 `main.js:107` | 复刻若做减法（砍玩法模块），应同步重建 `client.js`，而不是运行时按需 |

---

## 十、复刻要点小结（决策用）

**直接复用（这套实现已经解决了「轻量 + 不打扰」的 80%）**
1. 窗口贴合内容 + 16px 留白 + 锚边生长（`lib/window-geometry.js` 四个纯函数可直接搬，含测试 `apps/desktop/test/window.test.js`）。
2. 布局盒量框 + 4px 分档 + 变化才报（`renderer/shell.js` 的 `boxes()/keyOf()/tick()`）。
3. `setShape` 像素级穿透（Windows/Linux）；macOS 需另想办法。
4. 拖动 = 移窗口且用 `screenX/screenY`（唯一写入点，防双倍位移）。
5. `piggy://` 无端口宿主 + `serveFile` 穿越防护 + 16 通道里 4 个核心通道。
6. 30fps 上限、800ms/1500ms 双写盘防抖、`showInactive` 不抢焦点。

**必须新增（参考项目没有）**
1. 全屏应用检测 → 隐藏 / 摘置顶 / 关掉鼠标事件（§4.3）。
2. 点击不抢焦点（`focusable` 策略）。
3. 虚拟桌面跟随（可选）。
4. 隐藏时的空闲降频（可选，但对「轻量化」口碑影响大）。
5. Windows `setAlwaysOnTop` 层级的实机确认。

**必须裁掉（复刻为减法服务）**
1. 更新器三层（`versions.js` + `shell-update.js` + `electron-updater`）→ 省掉唯一运行时依赖。
2. `piggy:shape` + `shapeRects`/`anchorPoint` 冗余几何路径。
3. 页面侧常驻定时器（番茄 1s、更新检查 6h、玩法轮询 4s）按保留玩法边界重估。
4. `docs/`（截图占体积 95% 以上）与测试/构建脚本不进安装包（现有 `build.files` 已经做到了，`apps/desktop/package.json:27-35`）。

---

### 附：本次分析使用的主要否定性 grep（复现命令口径）

| 主张 | grep 模式 | 范围 | 结果 |
|---|---|---|---|
| 无全屏检测 | `(?i)fullscreen\|isFullScreen\|kiosk\|setFullScreen\|alwaysOnTop\|setAlwaysOnTop` | `_ref/**/*.js` | 仅 2 处 `alwaysOnTop`（`main.js:188,192`） |
| 无时钟穿透 API | `setIgnoreMouseEvents` | `_ref` 全域 | 0 |
| 无虚拟桌面/层级其它手段 | `setVisibleOnAllWorkspaces\|setFullScreenable\|setOpacity\|setContentProtection` | `_ref` 全域 | 0 |
| 无空闲/电源感知 | `powerMonitor\|getSystemIdleTime` | `_ref` 全域 | 0 |
| 无全局快捷键 | `globalShortcut\|before-input-event` | `_ref/apps/desktop` | 0 |
| 无双击 | `dblclick` | `_ref` 全域 | 0 |
| 无 DPI 显式处理 | `scaleFactor\|zoomFactor` | `_ref/**/*.js` | 0 |
| 无最小化/显示桌面处理 | `minimi\|showDesktop\|workspace` | `_ref/apps/desktop` | 0（`package-lock.json` 的 `minimist`/npm workspaces 除外） |
| 无前台窗口查询 / 原生扩展 | `(?i)foreground\|GetForegroundWindow\|\.node\|node-gyp\|ffi-napi\|koffi` | `_ref/apps/desktop` | 源码 0（仅 `package-lock.json` 的 `node-gyp` 依赖树） |
| 无隐藏时降频 | `backgroundThrottling` | `_ref/apps/desktop` | 0 |
