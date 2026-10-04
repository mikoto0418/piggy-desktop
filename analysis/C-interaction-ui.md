# C · 交互、UI 与表现层

> 分析对象：`F:\piggy\_ref`（dsh-piggy 参考项目，只读）
> 定位说明：用户**不要**参考项目的界面视觉。因此本文件的结论取向是
> **「要保留哪些交互行为与接口契约」**，而不是「照抄哪些界面」。
> 所有结论标注 `文件:行号`；未在源码中找到的能力一律写「无」，不做推测。
>
> 阅读优先级：**第 1.4 节（shell.js 硬契约）→ 第 2 节（交互矩阵）→ 第 3 节（动画是否只改 transform）→ 第 9 节（裁撤依据）。**
> 第 5 节面板清单按「穷尽列出 + 建议保留/可弃」给出，便于用户知道砍掉了什么。

---

## 一、DOM 与类名契约

### 1.1 页面里只有一根子树

`client.js` 挂载时只往 `document.body` 追加**一个**宿主节点，其余全在里面
（`client.js:4250-4316`）：

```
body
└── div[data-dsh-pig]                       ← 唯一宿主，MOUNTED 常量 = "data-dsh-pig"（client.js:10）
    ├── div.dp-card          （面板，hidden 时 display:none）   client.js:4252, 4305
    │   ├── div.dp-content   （可滚动内容区）                   client.js:4302-4303
    │   └── div.dp-bar       （图标栏；被 CSS 强制 display:none）client.js:4301, 4304, 1656
    └── div.dp-scene         （"场景"，猪 + 所有悬浮物）          client.js:4253, 4306
        ├── div.dp-hud       （名字 / 金币 / 健康 三行）          client.js:4254-4261
        ├── div.dp-bubble    （气泡，默认 hidden）                client.js:4262-4264
        │   └── div.dp-bubble-replies > button.dp-reply           client.js:2138-2151
        ├── div.dp-work      （在外打工/上学/旅行指示，默认 hidden）client.js:4265-4273
        │   ├── span.dp-prop     （活动 emoji）
        │   └── div.dp-progress > i（进度条填充）
        ├── div.dp-poke-hint （"👉 戳三下"，默认 hidden）          client.js:4274-4278
        ├── button.dp-daily  （签到 / 礼包 圆钮，默认 hidden）      client.js:4279-4281
        ├── span.dp-soul     （墓碑上的灵魂 👻，默认 hidden）       client.js:4282-4284
        └── div.dp-pig       ★ 硬契约节点                        client.js:4290-4299
            ├── img.dp-pig-img   （SVG 立绘，默认 hidden）
            ├── span.dp-pig-emoji（emoji 兜底立绘 🐖）
            ├── div.dp-dress     （装扮锚点容器）
            │   └── span.dp-slot[data-slot=head|face|neck|body|back|feet]  client.js:1230-1237, 4150-4152
            └── div.dp-pomo[data-pomo-pill] （番茄钟药丸，默认 hidden）client.js:4295-4298
```

**脱离宿主树的两个浮层**（不参与量框，见 1.4）：

| 节点 | 位置 | 说明 |
|---|---|---|
| `div.dp-fx` | `scene` 内动态增删 | 粒子，`client.js:2076-2084` |
| `div.dp-transform` / `.dp-transform-fall` / `.dp-transform-pop` | **`document.body`**（`client.js:2051`），`position:fixed;inset:0`（`client.js:1559-1567`） | 加冕/签约的全屏彩带，`aria-hidden="true"`（`client.js:2038`） |
| `link[rel=stylesheet]` → Google Fonts | `document.head`（`client.js:4243-4246`） | **外网请求**：`fonts.googleapis.com` 的 Nunito + Noto Sans SC |
| `style` | `document.head`（`client.js:4247-4249`） | 全部 CSS 内联注入 |

### 1.2 CSS 变量与宿主样式（全部声明在宿主上，不是 `:root`）

`[data-dsh-pig]{…}` 一个规则块承载整棵设计系统，注释明确写了
「tokens 声明在 widget root 而不是 `:root`：宿主页面不能继承它们，也不能被宿主页面覆盖」
（`client.js:1133-1134`）。

宿主自身的定位（`client.js:1164-1176`）：

```css
--pig-size:56px; --pig-gap-below:12px; --scene-open:132px; --panel-width:292px;
position:fixed; right:18px; bottom:18px; z-index:2147483000;
user-select:none; touch-action:none;
pointer-events:none;            /* 透明区域不吞宿主页面的点击 */
display:block
```

三条关键派生规则：

| 规则 | 位置 | 作用 |
|---|---|---|
| `[data-dsh-pig] *{box-sizing:border-box}` | `client.js:1177` | 所有尺寸含边框 |
| `[data-dsh-pig]>*{pointer-events:auto}` | `client.js:1178` | **只有 card / scene 两个直接子节点可点** |
| `[data-dsh-pig] .dp-card[hidden],…,.dp-pig-emoji[hidden]{display:none}` | `client.js:1184-1190` | ↑ 见下方警告 |

> **⚠️ 硬约束（桌面版复用的隐形前提）**：`hidden` 属性必须能真正隐藏元素。
> UA 样式表的 `[hidden]{display:none}` 与单个类选择器**特异性打平**，任何
> `.dp-x{display:grid|flex}` 都会赢过它。踩过的坑写在注释里：
> 「折叠面板仍然渲染出图标栏与 HUD，而所有 `el.hidden === true` 断言全都通过」
> （`client.js:1179-1183`）。
> **后果对桌面版是双重的**：① 隐藏不掉的节点会进入 `shell.js` 的量框 →
> 窗口被撑大；② 会进入可点区域 `shape` → 吞掉桌面点击。新 UI 必须保留
> 一组等价的 `[hidden]{display:none !important}` 兜底。

### 1.3 `dp-*` 类名全量清单（217 个）

按用途分组（同一元素可能命中多条规则）：

- **宿主/布局**：`dp-card` `dp-content` `dp-bar` `dp-scene` `dp-pig` `dp-dress` `dp-slot`
- **立绘**：`dp-pig-img` `dp-pig-emoji`
- **HUD/指示**：`dp-hud` `dp-work` `dp-prop` `dp-progress` `dp-pomo` `dp-pomo-live` `dp-pomo-clock` `dp-soul` `dp-poke-hint` `dp-daily` `dp-version`
- **气泡**：`dp-bubble` `dp-bubble-replies` `dp-reply` `dp-toast`
- **粒子/特效**：`dp-fx` `dp-transform` `dp-transform-fall` `dp-transform-pop`
- **图标栏**：`dp-ico` `dp-ico-e`
- **通用控件**：`dp-btn` `dp-btn-wide` `dp-mini` `dp-mini-plain` `dp-input` `dp-row` `dp-meter` `dp-title` `dp-list` `dp-item` `dp-grow` `dp-dim` `dp-empty` `dp-cancel` `dp-actions` `dp-grid` `dp-pick` `dp-pick-head` `dp-count` `dp-wait` `dp-alert` `dp-memo` `dp-talk` `dp-traits` `dp-drill` `dp-drill-back` `dp-drill-title` `dp-drill-info` `dp-app-head` `dp-seg` `dp-seg-3` `dp-req` `dp-req-ok` `dp-lock` `dp-locked` `dp-wanted`
- **磁贴（B8/B9 主页）**：`dp-tiles` `dp-tile` `dp-tile-soft` `dp-tile-card` `dp-tile-icon` `dp-tile-e` `dp-tile-badge` `dp-tile-tag` `dp-tile-n` `dp-tile-note`
- **状态条**：`dp-mood` `dp-clean` `dp-health`
- **居民卡**：`dp-vcard`（含 `-top -avatar -img -e -who -name -sub -row -label -value -input -edit -foot -motto -motto-row`）
- **图鉴**：`dp-dex-*`（约 35 个：`sections` `card` `card-foil` `card-locked` `big` `big-art` `big-foil` `big-locked` `big-title` `flash-grid` `museum` `museum-art` `museum-item` `museum-lock` `museum-locked` `museum-name` `catalog` `catalog-tools` `filters` `filter` `search` `entries/row` `detail` `info` `info-art` `info-locked` `art` `artbox` `caption` `progress` `story` `riddle` `foot` `emoji` `emoji-large`）
- **钓鱼**：`dp-fish-*`（`scene` `copy` `cast` `bait` `auto` `waiting` `bobber` `bite` `qte` `qte-title` `qte-ring` `qte-needle` `qte-core` `qte-score` `qte-feedback` `help` `result` `result-emoji` `away`）
- **换肤**：`dp-skin-intro` `dp-skin-grid` `dp-skin-row` `dp-skin-current` `dp-skin-art` `dp-skin-copy` `dp-skin-import` `dp-skin-file`
- **打工/日记**：`dp-job-detail` `dp-job-go` `dp-job-locked` `dp-diary` `dp-diary-page` `dp-diary-full` `dp-shelf`
- **更新**：`dp-update-now` `dp-update-detail` `dp-update-notes` `dp-update-back` `dp-update-page` `dp-update-latest`（后两个只在 `data-*` 钩子里出现）
- **加冕（道具详情）**：`dp-crown` `dp-crown-*`（`head` `top` `side` `pic` `img` `reqs` `req` `ok` `now` `done` `ok`）
- **开发者**：`dp-dev-row` `dp-dev-btn` `dp-dev-note` `dp-on`
- **状态钩子类**：`dp-legacy` `dp-sick` `dp-dead`

### 1.4 ★ 与 `apps/desktop/renderer/shell.js` 的接口契约（桌面版能不能复用外壳改窗口的硬约束）

这一节按「照着实现就能跑通」的粒度写。**两侧必须同时满足，缺一条桌面版就退化成网页版或量框错位。**

#### A. 页面（外壳）必须提供给 `client.js` 的三个全局

| 全局 | 谁来挂 | 要求 | 证据 |
|---|---|---|---|
| `window.piggyShell` | Electron `preload.cjs` 的 `contextBridge` | 必须有 `setContent(content)` / `moveBy(dx,dy)` / `geometry()` / `askGeometry()` / `onGeometry(cb)` | `preload.cjs:7-20` |
| `window.__dshPiggyShell` | 外壳的 `shell.js`，**必须在 `client.js` 之前挂好** | `{ room(): Room\|null, moveBy(dx,dy) }`；`client.js` 只检查 `typeof moveBy === "function"` | `shell.js:32-58`；`client.js:2381-2387` |
| `window.__ModuleLoader__` | 外壳的 `shell.js` | `{ load(entry) }`；随后外壳自己调 `entry.factory(function(){return {}}).apply({})` 再 `start()` | `shell.js:60-70`；`client.js:4533-4542` |

**时序要求（注释里写得很明确）**：`shell.js:24-31`——
「先把外壳挂上：`client.js` 在挂载那一刻（`apply` 里）就会读 `__dshPiggyShell`，
晚一步它就把桌面版当网页版 —— 拖动只挪页面里的猪、窗口不跟。
几何还没到时 `room()` 返回 `null`，页面会先用自己那套算，等几何到了再改。」

补充两点实测细节：
- `client.js` 的 `apply(ctx)` **完全不用 `ctx`**（`client.js:4539-4547` 直接 `return mount()`），
  所以外壳传 `{}` 当 ctx 是安全的。
- `desktopShell === null` 时（网页版），`mount()` 给宿主写死 `right/bottom = 18px`
  并读 `localStorage` 的 `dsh-piggy:position`；桌面版则设成 `right:auto;bottom:auto`
  交给 `pinPig` 接管（`client.js:4581-4591`，`client.js:4321-4331`）。

#### B. 页面必须提供的 DOM 节点/类名（就三个）

| 选择器 | 必须满足 | 谁用它 | 缺失后果 |
|---|---|---|---|
| `[data-dsh-pig]` | 全页**唯一**；必须存在且渲染（`display≠none`）；`position:fixed`（或 offsetParent 链能终止在它） | `shell.js:96` 量框根节点；`shell.js:37`、`shell.js:172`、`shell.js:246`；`client.js` 全部逻辑 | 值为 `null` → `boxes()` 直接返回 `{content:null}`，`tick()` 静默不报 → 窗口永远保持初始尺寸，且 `applyShape([])` 后**窗口一个点击都不接受**（`main.js:195-196`） |
| `.dp-pig` | 必须是 `[data-dsh-pig]` 的**后代**，且可见（`display≠none`、`visibility≠hidden`、`opacity>0.01`） | `shell.js:38`（`room()` 里）、`shell.js:143-145`（量猪）、`shell.js:207`；`client.js:2396, 2431, 3313` | 为 `null` → `room()` 返回 `null` → `fitPanel` 退回用 `window.innerWidth/innerHeight` 算面板朝向（`client.js:2435-2455`），在小窗口里会「按小窗口的 innerWidth 乱开」（`shell.js:28` 原话）。同时 `pig` 报成 `{0,0,0,0}`，主进程的锚点补正失去基准 |
| `.dp-card` | 必须是 `[data-dsh-pig]` 的**直接子节点**；收起时必须有 `card.hidden === true` | `shell.js:206-208` 判断面板在猪的哪一侧 | 缺 `hidden` 语义 → `sides()` 每次都用面板中心比猪中心，收起时被误判成「面板在下面」，一展开就翻锚点、窗口带着猪跳（`shell.js:198-204` 注释原话） |

> 注意 `shell.js:142` 的注释：「用 `host.querySelector`，不用后代选择器」——
> 实现里全部是 `host.querySelector('.dp-pig')` 这种**元素级**查询，没有
> `[data-dsh-pig] .dp-pig` 这种复合选择器。新 UI 只要在宿主下留一个 `.dp-pig`
> 和一个 `.dp-card` 即可，**不要求任何其他类名**。

#### C. `shell.setContent` 的载荷形状（`shell.js:252-259` → `main.js:221-262`）

```js
shell.setContent({
  width, height,                  // 内容外接框（已含 PAD=16 的两倍），Math.floor(w/4)*4 量化的 key 去重
  pig:     {x, y, width, height}, // 猪相对「内容框原点」的位置（主进程用它记锚点，main.js:225）
  pigWindow: {x, y},              // 猪在**窗口坐标**里的位置（不减内容原点）—— 收敛补正用它 main.js:230, 245
  anchor:  {vertical:'top'|'bottom', horizontal:'left'|'right'},  // 面板朝哪边开
  shape:   [{x,y,width,height}]   // 互不重叠的可点矩形（像素级窗口区域）
})
```

`shape` 的三条实现细节，改 UI 时必须一起考虑：

1. 矩形按**布局盒**算，右下角向上取整、左上角向下取整，**再各放宽 1px**
   （`shell.js:149-153`）。注释解释了原因：「以前按内容框原点换算再四舍五入到 4px，
   相邻两块之间会漏出一道缝，透出窗口后面的东西（用户看到的黑条），面板右边也会被切掉几像素」。
2. **主进程硬截断到 64 个矩形**：`shape.slice(0, 64)`（`main.js:257`、`main.js:285`）。
   合并后仍超过 64 块时会被静默丢弃尾部 → 那部分不可点。
3. 任何 `width<1 || height<1` 的节点，以及任何 `node.closest('[hidden]') !== null`
   或 `visible()` 为假（`display:none` / `visibility:hidden` / `opacity<=0.01`）的节点，
   连同其整棵子树一起被剔除（`shell.js:105-107`，`shell.js:76-79`）。

4. **`shape` 是随 `setContent` 走的，不是独立的 `setShape` 通道。**
   `preload.cjs:11` 暴露了 `setShape`，`main.js:281-289` 也注册了 `ipcMain.on('piggy:shape')`，
   但参考实现的 `shell.js` **一次都没调用 `setShape`**（全文件只有 `shell.js:252` 一处 `setContent`）。
   → 新实现只需保证 `setContent` 的 `shape` 字段正确；若保留 `setShape` 通道，
   要意识到它是未被验证的死代码（其 `first shape` 日志 `main.js:282` 永不打印）。

#### D. 量框为什么只能用布局盒（性能硬约束，直接决定第 3 节结论）

`shell.js:82-92` 的 `layoutBox()`：

```js
while (walk !== null && walk !== undefined && walk !== document.body) {
  x += walk.offsetLeft || 0;  y += walk.offsetTop || 0;  walk = walk.offsetParent
}
```

`shell.js:9-11` 注释点名了退化路径：
> 「量框必须用布局盒（offsetLeft/offsetTop/offsetWidth/offsetHeight 累加到 body），
> 不能用 `getBoundingClientRect`：呼吸/浮动动画只改 `transform`，`rect` 每帧都在抖，
> **Windows 上那会变成每秒一次 `SetWindowRgn`**。」

推论：
- 宿主的 `position:fixed` 是**必要**条件——fixed 元素的 `offsetParent` 为 `null`，
  循环立刻终止，`offsetLeft/offsetTop` 就是视口（= 窗口）坐标。若改成 `position:static`，
  累加会带上 `body` 的偏移，坐标全错。
- **只要动画只改 `transform`，它就不影响 `layoutBox`**；一旦某个动画改
  `width/height/padding/margin/top/left`，量框值每帧变化 → 4px 量化也挡不住 → 窗口反复改尺寸。
  这是第 3 节逐条标注「是否改 transform」的原因。

#### E. 上报与节流（`shell.js:243-271`）

- `setInterval(tick, 120)`（≈8.3 次/秒）+ `pointermove` + `pointerup` 触发（`shell.js:267-269`）。
- `keyOf()` 去重（`shell.js:223-235`）：内容宽高与猪在内容框内的位置按 **4px 一档**，
  猪在**窗口坐标**里的位置按 **1px 一档**（注释：粗了会漏掉 4px 以内的补正），
  `shape` 的每一项也按 4px 一档。key 不变就完全不发 IPC。
- 每次 `tick()` 还会跑一次 `pinPig()`（见下）和一次 O(n²) 的矩形合并（`shell.js:112-128`，
  两两相交就合并，直到不动点）。

#### F. 钉边与朝向

- `pinPig(vertical, horizontal, hostBox, contentBox)`（`shell.js:171-196`）：
  让**整块内容**（猪、面板、HUD、气泡）离窗口锚边正好 `PAD=16px`。
  注释说明为什么钉的是内容框而不是猪：「面板朝下开时 HUD 在猪上面，猪离顶边 16px，
  HUD 就伸到窗口外面去了」（`shell.js:164-170`）。四个方向写进 `host.style.left/right/top/bottom`，
  用 key 缓存避免每帧写样式（`shell.js:189-195`）。
- `sides()`（`shell.js:205-221`）：用 `.dp-card` 与 `.dp-pig` 的**中心点**比较而非边界
  （「面板比猪宽得多，可能和猪的范围重叠」）；面板收起时**保持上一次的锚边**
  （`lastVertical='bottom'` / `lastHorizontal='right'`，`shell.js:161-162`、`shell.js:208`）。
- 主进程侧的分工：`contentBounds()` 按锚边改尺寸（`window-geometry.js:51-64`），
  下一帧再按页面报来的 `pigWindow` 做一次 `anchorCorrection()` 收敛，容差
  `ANCHOR_TOLERANCE = 1`，最多 3 轮（`main.js:236-249`）。`moveBy` 的拖动走
  `moveAcrossDisplays()`，按所有显示器工作区的并集夹取（`window-geometry.js:83-92`）。

#### G. `room()` 返回什么（面板朝向的唯一依据）

`shell.js:34-56`：用「窗口原点 + 猪在窗口里的布局盒」得到猪在屏幕上的矩形，
再减去工作区四边，返回 `{above, below, left, right, width, height}`。
`fitPanel` 用它决定面板开在猪的上方还是下方、朝左还是朝右，
**并且算出 `maxHeight` 与 `maxWidth`**（`client.js:2408-2431`）：

- `above >= below` → 面板朝上开，`maxHeight = max(PANEL_MIN_HEIGHT=120, room.above)`
- 横向：`room.left < width + PANEL_MARGIN=10 && room.right > room.left` → 朝右开，
  给宿主设 `data-panel-side="right"`，CSS 把猪改到场景左端、气泡镜像（`client.js:2421-2428`，`client.js:1215-1217`）
- **没有 `room()` 就没有这些**，`client.js:2433-2455` 会退回 `window.innerWidth/innerHeight` 分支。

#### H. 桌面版最小可跑骨架（把上面全部收拢）

```html
<!-- 1. 先加载外壳脚本（挂 __dshPiggyShell + __ModuleLoader__ shim，再异步加载 client.js） -->
<script src="shell.js"></script>
```
```js
// shell.js 的等价最小实现
window.__dshPiggyShell = { room(){ /* 用 piggyShell.geometry() + layoutBox(.dp-pig) 算 */ },
                           moveBy(dx,dy){ window.piggyShell.moveBy(dx,dy) } }
window.__ModuleLoader__ = { load(e){ entry = e } }
// …把 client.js 作为 <script src> 插入，onload 里 entry.factory(()=>({})).apply({}) 然后 start()
setInterval(tick, 120); window.addEventListener('pointermove', tick); window.addEventListener('pointerup', tick)
```
页面只需产出：
```html
<div data-dsh-pig style="position:fixed">
  <div class="dp-card" hidden>…</div>
  <div class="dp-scene"><div class="dp-pig">…</div></div>
</div>
```
主进程只需：`setContent` → 按锚边改尺寸 + `setShape`；`moveBy` → 平移窗口；
`geometry` 推给页面。**除此之外没有任何耦合**——`client.js` 不引用任何 `.dp-` 之外的宿主页面结构，
也不要求宿主页面提供任何全局变量（除了那三个）。

#### I. 桌面版的分支行为差异（复用外壳时必须知道的 4 处）

| 场景 | 网页版（`desktopShell()===null`） | 桌面版 |
|---|---|---|
| 拖动 | 改 `host.style.right/bottom` 移动**元素**，并把位置写进 `localStorage`（`client.js:4834-4837`、`4846`） | 只把屏幕坐标增量 `moveBy(stepX,stepY)` 交给主进程（`client.js:4823-4832`），**不写存档** |
| 拖动阈值判定 | 用 `clientX/clientY` 增量 `>3`（`client.js:4834`） | 用 `screenX/screenY` 相对起点的绝对差 `>3`（`client.js:4826`） |
| 位置夹取 | `clampPig()` 按 `innerWidth/innerHeight` 夹（`client.js:2391-2404`） | `clampPig()` 第一行直接 `return`（`client.js:2392`） |
| 面板朝向 | `getBoundingClientRect` + `innerWidth/innerHeight`（`client.js:2438-2455`） | `room()` 的四个方向余量（`client.js:2409-2432`） |

---

## 二、交互矩阵

### 2.1 全部监听器（`client.js` 里 `addEventListener` 的完整清单）

| # | 目标 | 事件 | 位置 |
|---|---|---|---|
| 1 | `scene` | `pointerdown` | `client.js:4802-4817` |
| 2 | `scene` | `pointermove` | `client.js:4818-4839` |
| 3 | `scene` | `pointerup` | `client.js:4866-4873` |
| 4 | `scene` | `pointercancel` | `client.js:4874-4876` |
| 5 | `scene` | `contextmenu` | `client.js:4877-4881` |
| 6 | `button.dp-daily` | `pointerdown`（仅 `stopPropagation`） | `client.js:4793-4795` |
| 7 | `button.dp-daily` | `click` | `client.js:4796-4800` |
| 8 | `window` | `resize` | `client.js:4899-4903` |
| 9 | `document` | `DOMContentLoaded`（仅当 `body` 尚不存在） | `client.js:4310-4315` |
| 10 | `.dp-reply`（每条台词按钮） | `click` | `client.js:2142-2148` |
| 11 | 所有 `button()` 产物 | `click`（内部 `stopPropagation`） | `client.js:94-97` |
| 12 | 钓鱼 QTE `button.dp-fish-qte` | `pointerdown` | `client.js:3449-3452` |
| 13 | 钓鱼鱼漂 `button.dp-fish-waiting` | 无独立监听，靠 `button()` 的 `click` | `client.js:3386-3392` |
| 14 | 图鉴卡片 | `pointermove` / `pointerleave`（3D 倾斜） | `client.js:3298-3306` |
| 15 | `input` / `select`（居民卡、搜索框） | `input` / `change` | `client.js:872`、`3029`、`3206`、`3944` |
| 16 | 版本号 `div.dp-version` | `click`（开发者模式计数） | `client.js:3589-3592` |

**`window` 级只监听 `resize`；`document` 级只监听 `DOMContentLoaded`。
全库没有 `keydown` / `keyup` / `keypress` / `wheel` / `dblclick` / `mousedown` / `mouseup` / `touchstart`。**

### 2.2 精确判定逻辑

#### 左键摸摸（`client.js:4866-4873`）

```js
scene.addEventListener("pointerup", function() {
  if (endDrag()) return;                    // 拖动过 → 不算点击
  if (view.hatched !== true) { pokeBox(); return; }   // 还没孵化 → 戳纸盒
  if (!view.dead) flash("pet");             // 否则摸摸
});
```
- `flash("pet")` → `react("pet", 420)` + `burst(["❤️"], 1)` + 从 `PET_LINES` 随机一句
  （`client.js:2110-2117`，`client.js:2102`，`client.js:40-51`）。
- **没有 `event.button` 判定**（见 2.4 冲突 #1）。
- **没有命中目标过滤**：气泡本体、`.dp-reply` 按钮、`dp-daily` 圆钮、`dp-work` 道具
  上的 `pointerup` 都会冒泡到 `scene`，因此**点这些位置也会摸一下**（见 2.4 冲突 #2）。

#### 拖动（`client.js:4802-4849`）

| 项 | 值 | 位置 |
|---|---|---|
| 起始条件 | `event.button === 0`，否则直接 `return`（不设 `drag`） | `client.js:4803` |
| 起点记录 | `clientX/clientY` + `screenX/screenY` + 当前 `host` 的 `right/bottom` | `client.js:4804-4814` |
| 视觉反馈 | `scene[data-dragging="true"]` → `cursor:grabbing`（CSS `client.js:1207`） | `client.js:4815` |
| 指针捕获 | `scene.setPointerCapture?.(event.pointerId)` | `client.js:4816` |
| 移动阈值 | **3px**（桌面版比 `screenX/screenY` 与起点的绝对差；网页版比 `clientX/clientY` 增量） | `client.js:4826` / `client.js:4834` |
| 桌面版动作 | `moveBy(screenX - lastX, screenY - lastY)`，逐帧增量 | `client.js:4827-4831` |
| 网页版动作 | `userRight = drag.right - dx`；`clampPig()`；`fitPanel()` | `client.js:4835-4838` |
| 结束 | `endDrag()` 返回 `moved`；桌面版**不写**位置，网页版写 `localStorage` | `client.js:4840-4849` |
| 取消 | `pointercancel` → `endDrag()` | `client.js:4874-4876` |

#### 右键开/关面板（`client.js:4877-4881`）

```js
scene.addEventListener("contextmenu", function(event) {
  event.preventDefault();
  setOpen(!isOpen);
  if (isOpen && view.pig !== null) flash("pet");     // 注意：setOpen 之后 isOpen 已翻转
});
```
- `setOpen` 的完整副作用（`client.js:3967-3985`）：写 `host[data-open]`、
  `card.hidden = !next`、`hud.hidden = !next`、收起时 `bubble.hidden = true`、
  写 `localStorage['dsh-piggy:open']`；展开时 `renderContent() + fitPanel()`；
  收起时**清空** card 的 `right/top/bottom/maxHeight/maxWidth` 内联样式。
- 右键**只在 `scene` 上**注册。在 `.dp-card`（面板内部）右键 → 无处理器 →
  网页版弹浏览器默认菜单，桌面版无默认菜单（`main.js` 未装 `context-menu` 处理器）。

#### 鼠标中键 / 双击 / 长按 / 滚轮

| 输入 | 行为 | 依据 |
|---|---|---|
| 中键 | **无**。`pointerdown` 因 `button !== 0` 直接返回；`pointerup` 仍会 `flash("pet")` | `client.js:4803`、`client.js:4866` |
| 双击 | **无专用处理**。每次 `pointerup` 各触发一次 `flash("pet")`；`react()` 会先 `removeAttribute("data-react")`、强制 `void pig.offsetWidth` 重排、再设回，所以连点表现为动画反复重启 | `client.js:4866`、`client.js:2059-2070` |
| 双击间隔常量 | **不存在**（全库无 `dblclick`、无 `DCLICK_MS` 之类常量） | grep 零命中 |
| 长按 | **无**。按住不放只是保持 `drag` 状态；松手时 `moved === false` 则算一次摸摸 | `client.js:4840-4848`、`client.js:4866-4873` |
| 滚轮 | **无**。全库无 `wheel` / `mousewheel` 监听。面板内容靠原生 `overflow-y:auto` 滚动 | `client.js:1436-1439` |

#### 开发者模式解锁（唯一的「多击」手势）

`client.js:32-35` + `client.js:4345-4357`：点击主菜单底部的版本号
（`div.dp-version`，`client.js:3587-3593`）**7 次**（`DEV_TAPS_TO_UNLOCK = 7`），
窗口期 `DEV_TAP_WINDOW_MS = 3000`，第 4 次起提示「再点 N 次」（`DEV_TAP_HINT_MS = 1200`）。
解锁后：开面板、切到「调试」App、气泡「🔧 开发者模式已开」，
并暴露 `window.dshPigDev.off()`（`client.js:4358-4373`、`client.js:4904-4921`）。

#### 纸盒三击（开局）

`BOX_POKES_TO_OPEN = 3`（`client.js:54`）。`pokeBox()`（`client.js:4850-4865`）：
每次 `react("poke", 560)` + 2 个 💨；第 1、2 次显示
`BOX_POKE_LINES`（`client.js:55-58`）；第 3 次 `burst(["✨","🎉","💨"], 6)` + `send("hatch")`。
提示 UI 是 `dp-poke-hint`（`client.js:4274-4278`，文案「👉 戳三下」）。

#### 钓鱼的分段交互（唯一的「小游戏」交互）

| 阶段 | 输入 | 判定 | 位置 |
|---|---|---|---|
| `ready` | 点 bait 按钮选饵（`aria-pressed`）；点「🎣 抛竿」→ `fishCast` | 无饵则 `disabled` | `client.js:3354-3371` |
| `waiting` | 点水面 → 若 `Date.now() < pending.bitesAt` 提示「还没上钩」，否则 `fishHook` | `rAF` 轮询把 `data-bite="true"` 打上并换 ❗；超过 `pending.hookUntil` 自动 `fishHook`（失败） | `client.js:3385-3414` |
| `hooked` | `pointerdown` 或按钮 `click`（空格/回车）→ `hit()` | 见下 | `client.js:3444-3452` |
| `result` | 点「🎒 放进背包」→ `fishKeep` | — | `client.js:3530-3541` |

QTE 判定的精确逻辑（`client.js:3490-3511`）：
- 指针角度由 `rAF` 推进：`angle = (now - startedAt) * rotationsPerSecond * 0.36`
  （`client.js:3515`）；`rotationsPerSecond = 0.28 + difficulty * 0.0018`（`client.js:3420`）。
- 绿区 `zoneDegrees = round(115 - difficulty * 0.38)`，其中黄区（完美）
  `perfectDegrees = round(16 - difficulty * 0.06)`（`client.js:3418-3419`）。
- 命中绿区 = +1，命中黄区 = +2；所需命中数 `difficulty>=80 ? 4 : difficulty>=45 ? 3 : 2`（`client.js:3421`）。
- 转满一圈未命中算 miss，累计 3 miss 判负（`client.js:3517-3524`）。
- **`pointerdown` 与 `click` 去重**：`if (event.detail > 0 && event.timeStamp - lastPointerAt < 700) return`
  （`client.js:3445`）——700ms 内的合成 `click` 被丢弃，避免一次点击判两次。
- 「按空格」不是键盘监听：`wrap` 是真正的 `<button>` 且带 `tabindex="0"`
  （`client.js:3439`、`client.js:3466`），空格/回车走浏览器原生按钮激活 → `click` → `hit()`。
  操作提示文案在 `client.js:3465`。

### 2.3 冲突解决机制（源码里真实存在的）

| 机制 | 位置 | 作用 |
|---|---|---|
| `event.button !== 0` 早退 | `client.js:4803` | 右键/中键不启动拖动 |
| `drag.moved` 阈值 3px | `client.js:4826`、`client.js:4834` | 点击与拖动互斥：`endDrag()` 返回 `true` 时不再摸摸 |
| `stopPropagation` on child `click` | `client.js:94-96`（所有 button）、`client.js:2143`（reply）、`client.js:4797`（daily） | 子控件点击不冒泡到宿主 `click` 处理器 |
| `stopPropagation` on `dailyHint.pointerdown` | `client.js:4793-4795` | 点签到圆钮不启动拖动 |
| `setPointerCapture` | `client.js:4816` | 拖出元素范围仍能收到 `pointermove`/`pointerup` |
| `pointercancel → endDrag` | `client.js:4874-4876` | 系统抢走指针时清理拖动状态 |
| QTE 700ms 去重 | `client.js:3445` | `pointerdown` 与合成 `click` 不重复计分 |
| `ctx.busy` 串行锁 | `client.js:2282-2287`、`client.js:4622` | 上一动作未返回时不发新请求 |
| `ctx.stopped` 守卫 | `client.js:2283`、`client.js:4615-4617` | 卸载后不再发请求/加粒子 |

### 2.4 ⚠️ 源码里真实存在的交互冲突（未解决）

**冲突 #1 —— 右键同时「摸摸」和「开关面板」。**
`pointerup` 处理器（`client.js:4866`）不检查 `event.button`。
右键序列（Windows 上 `contextmenu` 在 `mouseup` 之后）：
`pointerdown(button=2)` → 早退（`drag` 保持 `null`）→ `pointerup(button=2)` →
`endDrag()` 返回 `false` → `flash("pet")`（摸摸动画 + 爱心 + 「好舒服…」气泡）→
`contextmenu` → `setOpen(true)`。
**净效果：每次右键开面板都会附带一次摸摸动画和一句随机台词气泡**，
而且 `setOpen(true)` 不会清掉气泡（只有收起时才 `bubble.hidden = true`，`client.js:3973`），
所以展开的面板上方一直挂着那句「好舒服…」。
→ 新 UI 必须在 `pointerup` 里补 `if (event.button !== 0) return`。

**冲突 #2 —— 场景内任何 `pointerup` 都算摸摸。**
`scene` 是 `.dp-bubble`、`.dp-bubble-replies > .dp-reply`、`button.dp-daily`、
`div.dp-work` 的祖先（`client.js:4262-4299`）。子控件的 `click` 里 `stopPropagation`
**拦不住 `pointerup`**（不同类型、且 `pointerup` 先于 `click`）。
所以：点「回复」按钮回答台词 → 先摸一下；点签到圆钮 → 先摸一下。
→ 新 UI 应在 `pointerup` 里检查 `event.target.closest('.dp-pig')` 或等价的目标过滤。

**冲突 #3 —— `.dp-scene` 整块矩形都是实体，透明区域也吞桌面点击。**
`[data-dsh-pig]>*{pointer-events:auto}`（`client.js:1178`）让 `.dp-scene` 整体可点，
而 `shell.js` 的可点区域来自**布局盒并集**（`shell.js:102-128`）。
展开时 `.dp-scene` 是 `width:var(--panel-width)=292px` × `height:var(--scene-open)=132px`
（`client.js:1204-1212`），猪只占右下角 56px（`padding:0 6px 12px`，
`--pig-size:56px`，`client.js:1204-1206`、`1164`）；
矩形合并（相交即合并，`shell.js:120`）会把猪、HUD、气泡、道具**全部并进这一块
292×132 的大矩形**（面积 38544px²，其中猪只有 3136px²）。
→ 面板展开期间，这块矩形里约 **90% 的面积是全透明区域**，却会挡住桌面点击，
`PROJECT-REF.md` 第 5 节「只有猪和面板那几块是实体，其余真正穿透」在
**布局盒粒度上并不成立**，只在「元素粒度」上成立。
→ 新 UI 若真要做到像素级穿透，必须给透明容器 `pointer-events:none` 并
**同时**让 `shell.js` 跳过它（否则量框仍按布局盒算，`shape` 里还是有那块矩形）。

**冲突 #4 —— 首次上报之前窗口不接受任何点击；若 `.dp-pig` 因故不可见，则永远不接受。**
`applyShape([])` 在窗口创建时执行（`main.js:195-196`），
在页面第一次 `setContent` 之前**窗口不接受任何点击**。
如果 `.dp-pig` 因故不可见（例如立绘 404 导致 `img` 尺寸为 0，或 CSS 把 `opacity` 设成 ≤0.01），
`boxes()` 里 `rects.length === 0` → `content` 为 `null` → `tick()` 静默返回（`shell.js:245`）
→ **窗口永远无法交互**。

而且这条路径**没有任何日志**：唯一一行 `log('first shape', …)` 写在使用
`ipcMain.on('piggy:shape')` 的处理器里（`main.js:281-282`），
但参考实现的 `shell.js` **从不调用 `shell.setShape`**（只有一处 `shell.setContent`，
`shell.js:252`）——`shape` 是随 `setContent` 的载荷一起过去的（`main.js:256-261`）。
即 `piggy:shape` 通道在参考实现里是**死代码**，那行日志永远不会打印。
→ 新项目应当在 `piggy:content` 处理器里补上「首次 content 到达」的日志，
并保留 `piggy:shape` 作为独立通道（或直接删掉以免误判）。

---

## 三、动画与粒子

### 3.1 关键结论：全部动画都只改 `transform`（+ 少数 `opacity` / `filter`）

逐条核对全部 **29 个** `@keyframes` 声明——**没有任何一条动画改动
`width/height/top/left/margin/padding`**，因此 `shell.js` 的 `layoutBox()`
在动画期间读数稳定，4px 量化足以吸收抖动，**不会触发窗口区域重算**。
唯一改 `opacity` 的是粒子/彩带（它们本身不参与窗口尺寸，且 `dp-transform` 在 body 上）。

全库 `@keyframes` 位置：`client.js:1246-1252`（7）、`1261-1263`（3）、`1285-1286`（2）、
`1301-1303`（3）、`1324`、`1331`、`1336`、`1353`、`1358`、`1362`、`1400`、`1433`、
`1562`、`1566`、`1572`、`1579`（各 1，共 12）、`1825`（`dp-fish-bob` + `dp-fish-bite`，2）。
合计 **29**。

**⚠️ 唯一的例外是 CSS `transition`（不是 `@keyframes`）**：进度条与状态条用
`transition:width` 改宽度（`client.js:1290`、`1451`、`1734`、`1749`），
它们位于 `.dp-content` 内，**会真实改变量框值**——详见 3.3 表末行与附录 R16。

### 3.2 猪本体（`.dp-pig`）动画表

| 触发（属性） | 动画名 | CSS 定义 | 时长 | 改什么 | 备注 |
|---|---|---|---|---|---|
| **默认（始终）** | `dp-bob` | `client.js:1246` | `1.8s` `ease-in-out` `infinite` | `translateY(-7px) rotate(-2.5deg)` | 基态；`animation` 声明在 `client.js:1225-1226` |
| `[data-mood="happy"]` | 继承 `dp-bob` | `client.js:1253` | `1.15s` | 同 | 只是加快 |
| `[data-mood="sleepy"]` | `dp-breathe` | `client.js:1247` | `3.6s` | `translateY(1px) scale(1.09)` | `client.js:1254` |
| `[data-mood="hungry"]` | `dp-shake` | `client.js:1248` | `2.4s` | `translateX(±4px) rotate(±5deg)` | `client.js:1255` |
| `[data-mood="dirty"]` | `dp-breathe` | 同上 | `2.6s` | 同 | 另有 `sepia(.4)` 滤镜，`client.js:1256-1257` |
| `[data-mood="sick"]` | `dp-cough` | `client.js:1252` | `2.2s` | `translateX(±4px) rotate` | 另有 `hue-rotate(-28deg)`，`client.js:1258-1259` |
| `[data-mood="working"]` | `dp-typing` | `client.js:1261` | `.7s` | `translateY(-2px) rotate(±1.5deg)` | `client.js:1264` |
| `[data-mood="studying"]` | `dp-reading` | `client.js:1262` | `2.4s` | `translateY(1px) rotate(-5deg→-2deg)` | `client.js:1265` |
| `[data-mood="traveling"]` | `dp-walking` | `client.js:1263` | `1s` | `translateY(-6px) rotate(±4deg)` | `client.js:1266` |
| `[data-mood="dead"]` | `none` | `client.js:1267` | — | — | 另加 `grayscale(1)`，`client.js:1268` |
| `[data-stage="box"]` | `dp-box-wobble` | `client.js:1358` | `3.2s` | `rotate(0→-4deg→3deg→-2deg)` | `client.js:1357` |
| `[data-stage="grave"]` | `none` | `client.js:1356` | — | — | 墓碑不晃 |
| `[data-react="feed"/"away"/"levelup"]` | `dp-jump` | `client.js:1250` | `.85s`/`.9s`/`.95s`，**1 次** | `translateY(-26px) scale(1.12)` | 声明 `client.js:1269-1275` |
| `[data-react="bathe"]` | `dp-wobble` | `client.js:1251` | `1.05s` 1 次 | `rotate(±14deg)` | |
| `[data-react="play"/"cure"]` | `dp-spin` | `client.js:1249` | `.9s` 1 次 | `rotate(0→360deg) scale(1.2)` | |
| `[data-react="refuse"]` | `dp-shake` | `client.js:1248` | `.5s` 1 次 | 同 shake | |
| `[data-react="pet"]` | `dp-squash` | `client.js:1362` | `.42s` 1 次 | `scale(1.16,.74)` ↔ `scale(.94,1.08)` | `client.js:1361`；特意做短以便连点 |
| `[data-art-actions="true"][data-mood=working/studying/traveling]:not([data-react])` | `dp-king-work` / `dp-king-study` / `dp-king-walk` | `client.js:1301-1303` | `1.4s` / `2.4s` / `.8s` | `translateY` / `rotate(±2deg)` | `client.js:1298-1300`（猪猪王/恶魔猪/肥猪专用） |

`data-react` 的生命周期：`react(kind, ms)` 先 `removeAttribute` → `void pig.offsetWidth`
（强制重排以重启动画）→ `setAttribute` → `setTimeout` 后移除（`client.js:2059-2070`）。

**性能取舍写在注释里**（`client.js:1223-1224`）：
「阴影挂在立绘（不动的元素）上，而不是做 bob/breathe 的 `.dp-pig` 上：
动画只改 `transform`，滤镜跟着每帧重算在 Windows 上很贵。」
→ `.dp-pig-img` / `.dp-pig-emoji` 承担 `filter:drop-shadow(...)`（`client.js:1227`），
`.dp-pig` 只做 transform。**这一点必须在新 UI 里延续。**

### 3.3 场景内其他元素的动画

| 元素 | 动画 | 定义 | 时长 | 触发 |
|---|---|---|---|---|
| `.dp-prop`（打工道具） | `dp-prop-bob` | `client.js:1285` | `2.4s` | `client.js:1281`；`[data-away="study"/"interest"]` 拉到 `3.4s`，`[data-away="trip"]` 换 `dp-prop-swing 1.6s`（`client.js:1282-1284`） |
| `.dp-poke-hint`（戳三下提示） | `dp-hint-bob` | `client.js:1331` | `1.6s` | `client.js:1330`；`hidden=false` 时（未孵化） |
| `.dp-soul`（灵魂） | `dp-haunt` | `client.js:1353` | `3.4s` | `client.js:1352`；改 `opacity` + `translateY(-9px) scale(1.08)` |
| `.dp-daily`（签到圆钮） | `dp-daily-bob` | `client.js:1400` | `2.4s` | `client.js:1386`；**注释警告**：名字不能叫 `dp-bob`，否则覆盖猪的待机动画的 `transform` 会让猪横跳半个身位（`client.js:1397-1399`） |
| `.dp-ico[data-alert="true"] .dp-ico-e` | `dp-pulse` | `client.js:1433` | `1.4s` | `client.js:1434`；有提醒时图标脉冲 |
| `[data-poke] .dp-pig` | `dp-poke-shake` | `client.js:1336` | 默认，`[data-poke="2"]` 时 `.28s` | `client.js:1333-1335` |
| 钓鱼 `.dp-fish-bobber` | `dp-fish-bob` | `client.js:1825` | `1.3s` | 等鱼时上下浮动 |
| 钓鱼 `.dp-fish-waiting[data-bite=true] .dp-fish-bobber` | `dp-fish-bite` | `client.js:1825` | `.18s` `alternate` `infinite` | 咬钩时高频抖动 + 内阴影高亮 |
| `.dp-transform-fall`（彩带 16 片） | `dp-transform-fall` | `client.js:1562` | `1.35s` `forwards`，逐片 `--delay` `0–0.28s` | `client.js:1559-1563`；改 `opacity` + `translate3d` |
| `.dp-transform-pop`（中心大 emoji） | `dp-transform-pop` | `client.js:1566` | `1.3s` `forwards` | `client.js:1564-1565` |
| `.dp-fx`（粒子） | `dp-rise` | `client.js:1572` | `1.1s` `forwards` | `client.js:1570-1571`；改 `opacity` + `translate(var(--dx0), 4px) scale(.5)` |
| `.dp-toast` | `dp-toast` | `client.js:1579` | `4.6s` `forwards`（与 JS 的 4800ms 移除对齐） | `client.js:1574-1578` |
| 图鉴 3D 卡片 | `transform: rotateX/rotateY` + `transition .18s` | `client.js:1749`、`1755`、`1803` | — | 鼠标 `pointermove` 驱动（`client.js:3298-3306`） |
| 进度/状态条 | `width` + `transition` | `client.js:1290`、`1451`、`1734` | — | ⚠️ **改 `width`**，但只在面板内部（`.dp-content`），会改变量框 → 每次变化都会触发一次 `setContent`（4px 量化后仍可能过阈） |

### 3.4 粒子系统（`createEffects`，`client.js:2022-2176`）

| 函数 | 行为 | 位置 |
|---|---|---|
| `burst(emojis, count)` | 每个粒子延迟 `index * 110ms` 生成一个 `span.dp-fx`，位置在**猪头顶**（`headSpot()`），`--dx` 随机 `±23px`；`1200ms` 后移除 | `client.js:2071-2088` |
| `headSpot()` | `pig.getBoundingClientRect()` 与 `scene.getBoundingClientRect()` 相减，`x = 中心`、`y = 顶部 - 20px`；拿不到时回退 `{x:24,y:8}` | `client.js:2089-2096` |
| `transform(kind)` | 生成 `div.dp-transform`（`position:fixed;inset:0;z-index:2147483647`）挂到 `document.body`；16 片 `dp-transform-fall` + 1 个 `dp-transform-pop`；`1450ms` 后整体移除 | `client.js:2033-2058` |
| `react(kind, ms)` | 见 3.2 | `client.js:2059-2070` |
| `flash(action)` | 查 `REACTIONS` 表 → `react` + `burst` + `showBubble` | `client.js:2110-2117` |
| `toast(text)` | `div.dp-toast` **插到 `card.firstChild` 之前**（面板顶部），`4800ms` 移除 | `client.js:2158-2164` |
| `dispose()` | 清 3 个 timer + 移除 `transformLayer` | `client.js:2165-2174` |

`REACTIONS` 表（12 项，含 `kind`/`ms`/`fx`/`say`）见 `client.js:2097-2109`：
`hatch` `feed` `bathe` `play` `pet` `work` `study` `trip` `calloff` `buy` `use`。

**注意**：`burst()` 的粒子挂在 `scene` 内 → **进入量框与 `shape`**；
而 `transform()` 的彩带挂在 `body` 上 → **不进入量框**。这对新 UI 是个可借鉴的取舍：
纯装饰、只改 `opacity/transform`、且会飘出内容框的层，应挂在 `body` 而不是 `scene`。

### 3.5 定时器与轮询（性能画像）

| 定时器 | 周期 | 位置 | 是否常驻 |
|---|---|---|---|
| `shell.js` 的 `tick` | `120ms`（≈8.3 次/秒） | `shell.js:267` | **常驻** |
| 状态轮询 `refresh2` | `POLL_MS = 4000ms` | `client.js:7`、`client.js:4886` | **常驻**（4 秒一次 HTTP `GET /dsh-piggy/state`） |
| 番茄钟本地秒表 | `1000ms` | `client.js:2273` | 常驻（`render` 时创建，`dispose` 清理） |
| 空闲闲聊 | `20–40` 分钟随机 | `client.js:8`、`client.js:4888-4894` | 常驻 `setTimeout` 自续 |
| 入场问候 | `1500ms` 一次 | `client.js:9`、`client.js:4895-4897` | 一次性 |
| 更新检查 | 首次 `10s`，之后 `6h` | `client.js:4478-4479` | 常驻 |
| 钓鱼 `rAF` 循环 | 每帧 | `client.js:3399-3413`、`3512-3528` | **仅钓鱼面板打开时**，`stopLoop()` 收尾 |
| 图标脉冲 / 各种 `setTimeout` | 一次性 | 多处 | 否 |

→ 空闲态常驻定时器 **3 个**（120ms + 4000ms + 1000ms）+ 1 个随机闲聊 `setTimeout`。

---

## 四、气泡与台词

### 4.1 台词库规模

| 数据 | 规模 | 位置 |
|---|---|---|
| `LINES` 场景数 | **27** | `data/lines.js:55-211` |
| `LINES` 台词总条数 | **94** | 逐场景计数：`eat 6, overfull 3, bathe 5, play 5, pet 7, hungry 3, dirty 3, lonely 3, idle 8, workDone 3, tired 3, study 3, graduate 3, tripBack 3, sick 3, wrongMedicine 3, cured 3, levelup 3, growUp 3, enter 3, death 2, revive 3, signIn 2, gift 2, pomodoroStart 3, pomodoroDone 3, pomodoroAbandon 3` |
| 带回复按钮的台词 | 每条 `line(text, reply)` 的第二参数；全库 `replies:` 只有 1 处字面量，其余由 `line()` 工厂生成（`data/lines.js:48-50`） | `data/lines.js:48-50` |
| `LINE_SCENES` | `Object.keys(LINES)` | `data/lines.js:214` |
| 客户端硬编码台词 | `PET_LINES` 10 条（`client.js:40-51`）、`BOX_POKE_LINES` 2 条（`client.js:55-58`）、`NO_ITEM_LINE` 3 条（`client.js:59-63`） | — |

**台词文本本身不含 emoji**（`data/lines.js` 全文为纯中文文本 + `[主人]` 占位符）；
emoji 只出现在 UI 标签、按钮、粒子与 `REACTIONS.say`。
**`[主人]` 占位符**替换为用户设置的称呼（`core/lines.js:36`，`OWNER_TOKEN` 见 `data/lines.js:12`，
默认「主人」`data/lines.js:15`，上限 12 字 `data/lines.js:18`）。

### 4.2 触发时机

| 时机 | 触发方 | 路径 | 位置 |
|---|---|---|---|
| **进入 DSH 后 1.5s** 问候 | 客户端 | `setTimeout(…, GREET_DELAY_MS=1500)` → `send("chat", {reason:"enter"})` → 服务端 `chat()` → `say('enter')` → `announce('line')` → 客户端 4s 轮询取到 `pending` → `showPigLine()` | `client.js:4895-4897`；`core/lines.js:104-108` |
| **空闲 20–40 分钟** 随机闲聊 | 客户端 | `scheduleChat()` 递归 `setTimeout`；条件 `!stopped && !busy && view.pig !== null` | `client.js:4888-4894`、`4898` |
| 陪伴动作完成 | 服务端 | `feed`/`bathe`/`play` 等 `say(scene)`（`eat`/`overfull`/`bathe`/`play`/`pet`…） | `data/lines.js:57-92` |
| 生病 / 康复 / 死亡 / 复活 / 升级 / 长大 / 毕业 | 服务端 | 各自场景 | `data/lines.js:146-185` |
| 签到 / 礼包 | 服务端 | `signIn` / `gift` | `data/lines.js:187-194` |
| 番茄钟开始 / 完成 / 放弃 | 服务端 | `pomodoroStart` / `pomodoroDone` / `pomodoroAbandon` | `core/pomodoro.js:115`、`148`、`174` |
| 主人回复台词 | 客户端 → 服务端 | `.dp-reply` → `send("reply", {line, index})` → `replyToLine()` 加心情 | `client.js:2142-2148`、`4234-4236`；`core/lines.js:77-88` |

### 4.3 冷却与去重（四层）

| 层 | 机制 | 位置 |
|---|---|---|
| ① 场景级不重复 | `dialogue.lastByScene[scene]` 记住上次下标，`pool.length>1` 时 `index = (index+1) % pool.length`，**绝不连续两句相同** | `core/lines.js:29-32` |
| ② 问候冷却 | `nowMs - dialogue.greetedAt < WELCOME_BACK_AFTER_MINUTES(30) * 60000` 则静默 | `core/lines.js:105`；`data/lines.js:29` |
| ③ 免打扰 | `dialogue.quiet === true` 时 `chat()` 直接 `{ok:false, reason:'silent'}`；同时 **away / 生病 / 死亡 / 未孵化 一律静默** | `core/lines.js:100-103` |
| ④ 客户端 pending 去重 | `lastPendingId` / `lastPendingAt` 双游标，只处理更新的消息 | `client.js:4192-4196` |
| ⑤ 待发队列上限 | `PENDING_LIMIT = 6`，超出丢最旧的 | `core/constants.js:18`；`core/effects.js:54` |
| ⑥ 同一条最新台词才能被回复一次 | `dialogue.open = {id, replies}`，回复后清空；旧 `id` 返回 `stale-line` | `core/lines.js:67`、`82-85` |
| ⑦ 更新提醒不重复 | `localStorage` 的 `dsh-piggy:update-notified` 记 `kind:version:shell` 签名 | `client.js:4417-4427` |

**口头禅（catchphrase）注入**：40% 概率把用户设置的自我描述拼到句尾，
但**严肃场景不加**（`SERIOUS_SCENES = ['death','sick','wrongMedicine']`，
`data/profile.js:41`）、**括号舞台提示不加**（`text.startsWith('（')`）、
**已包含则不加**（`core/lines.js:46-54`）。概率常量 `CATCHPHRASE_CHANCE = 0.4`
（`data/profile.js:38`）。

**免打扰的双向语义**：`setQuiet` 只影响 `chat()` 与「日常 toast」，
`URGENT_KINDS = ["sick","worse","death","cured","revived"]` 仍会穿透
（`client.js:3960`、`client.js:4201`）。
**注意**：`kind === "line"` 的处理在免打扰判断**之前**（`client.js:4197-4201`），
即客户端不会因为免打扰而丢弃已生成的台词——但服务端 `chat()` 在免打扰下根本不会生成，
所以实际行为一致。番茄钟会复用 `dialogue.quiet` 并保存/还原原值
（`core/pomodoro.js:108`、`113`、`144`、`171`）。

### 4.4 渲染与生命周期

| 函数 | 时长 | 内容 | 位置 |
|---|---|---|---|
| `showBubble(text, ms)` | 默认 `2600ms` | `hidden=false`，同时**隐藏番茄钟药丸**；到点 `hidden=true` 并按 `data-pomo` 恢复药丸 | `client.js:2119-2130` |
| `showLine(text, replies, onReply)` | 有回复时 `6000ms`；无回复走 `showBubble(text, 2600)` | 追加 `div.dp-bubble-replies > button.dp-reply[]`；点按钮 `hidden=true` 并回调 | `client.js:2131-2157` |
| `toast(text)` | `4800ms` | 面板顶部条，非气泡 | `client.js:2158-2164` |

气泡默认 `hidden`（`client.js:4263`）。CSS：折叠态浮在猪头顶上方
（`bottom:calc(100% + 8px)`，尾巴朝下，`client.js:1414-1419`）；
展开态贴在场景右上角（`client.js:1368-1376`）；
`data-panel-side="right"` 时镜像到左侧（`client.js:1216`）。
`z-index:2` —— 注释解释了为什么必须高于猪：「猪在 DOM 里更靠后，
没有 z-index 时猪会盖住气泡」（`client.js:1365-1367`）。
**气泡没有 `aria-live`**（见第八节）。

---

## 五、面板清单（穷尽）

### 5.1 入口层级

面板只有**一个物理容器** `div.dp-card`（`client.js:4252`），
内容每次整体重建（`paintContent()` 先 `ctx.content.textContent = ""`，`client.js:4024`）。
「App 切换」= 换 `ctx.tab` 重新渲染，**不是多窗口/多 stacking**。
层级：`home`（主菜单磁贴）→ App → 下钻（`drill`）→ 详情（`picker` / `pick`）。
返回靠 `dp-drill-back`（`client.js:189-199`）或 `dp-app-head` 的 `‹`（`client.js:3607-3620`）。

- 主菜单磁贴由 `apps` 列表生成：`TABS` + `UPDATE_TAB` +（桌面版）`QUIT_TAB` +（开发者模式）`DEV_TAB`
  （`client.js:4048`，`client.js:19-39`）。
- App 内有独立下钻状态的：`drill = {study, shop, bag, work, dex, pick}`（`client.js:4597`）。
- 磁贴配色表 `APP_COLOR`（`client.js:3548-3563`）。
- **图标栏 `.dp-bar` 存在但被 CSS 隐藏**（`client.js:1656`）：注释说明
  「B9 主页取代了底部图标栏。栏还在（它的图标承载主页磁贴读取的提醒状态），但不显示」
  （`client.js:1654-1655`）——`ctx.icons[key].data-alert` 是提醒状态的**真值存储**，
  改 UI 时若删掉 `.dp-bar`，必须把这份状态搬到别处。

### 5.2 主菜单与系统级

| # | 面板 | 入口 | 用途 | 关键证据 | 建议 |
|---|---|---|---|---|---|
| 0 | **主菜单 home** | 右键开面板后的默认页 | 标题行（名字/性别/Lv + 金币）+ 磁贴网格 + 底部版本号（点 7 次进调试） | `client.js:3564-3594` | **保留**（可精简为 3–4 个磁贴） |
| 1 | **更新 update** | 主菜单磁贴（未读时角标 `!`） | 桌面版：显示 游戏版本/外壳版本、下载、安装、回退、读 Release Notes；插件版：显示当前版本 + 打开发布页 | `client.js:3738-3803`、`3804-3840`；未读气泡 `client.js:4408-4530` | **保留**（新项目可只要「打开发布页」） |
| 2 | **退出 quit** | 主菜单磁贴（仅桌面版，`shell.quit` 存在时） | 存档后关 App | `client.js:3988-3991`、`4048` | **保留**（改为托盘菜单项即可，不必占磁贴） |
| 3 | **调试 dev** | 版本号点 7 次解锁 | 11 组调试按钮：形态/皮肤/道具/体重/状态/生病/等级/番茄钟/钓鱼/资源/时间/生死/面板 | `client.js:558-786` | **可弃**（发布版应整体删除，见第九节） |

### 5.3 正式 App（`TABS` 11 项，`client.js:19-31`）

| # | key | 标签 | 入口 | 用途 | 下钻/子面板 | 证据 | 建议 |
|---|---|---|---|---|---|---|---|
| 4 | `status` | 📋 状态 | 磁贴 / 图标 | 4 条状态条（饱食/心情/清洁/健康）+ 三维（智力/魅力/武力）+ 体重/金币 + 体重档位 + 签到行 + 番茄钟行 + 等级行 + 陪伴天数 + 4 个照顾按钮 + 物品选择面板 + 称呼/名字/免打扰 + 最后 3 条回忆 + 顶部横幅（死亡/生病/领养） | `pickerPanel`（喂食/洗澡/玩耍三选一物品） | `client.js:789-915`；`client.js:116-147`；`client.js:916-977`（横幅）；`client.js:978-989`（体重） | **保留精简版**：状态条 + 3 个照顾按钮；死亡/生病横幅可弃；三维/体重/签到行视裁撤决定 |
| 5 | `card` | 🪪 居民卡 | 磁贴 | 头像 + 名字/Lv/阶段 + 生日/星座/性格/形态 + 可编辑 口头禅/签名 | 编辑态 `cardEdit` | `client.js:2963-3059` | **可弃**（纯装饰） |
| 6 | `dex` | 📖 图鉴 | 磁贴 / 换肤页也可跳 | 5 个分区（形态/皮肤/鱼类/道具/纪念品），每个有完成度进度条；三种展示：闪卡架（形态/皮肤）、目录（道具，带搜索 + 8 个分类过滤）、博物馆（鱼类/纪念品）；点卡片进详情 | `renderSections` → `renderEntries` → `renderDetail` | `client.js:3085-3310`；分区定义 `client.js:3077-3084`；分区真值 `core/dex.js:6` | **可弃**（若要保留「收集感」，只留「形态」一区） |
| 7 | `skins` | 🎨 换肤 | 磁贴 | 皮肤列表（缩略图 + 名称 + 作者/简介 + 「使用/使用中」）+ 导入区（`input[type=file accept=.zip]`） | 导入失败气泡 | `client.js:3900-3957` | **保留**（桌宠换肤是低成本高感知的功能） |
| 8 | `study` | 📚 学习 | 磁贴 | 学阶磁贴（幼儿园→研究生，含锁定态）→ 科目列表（课时/花费/是否买得起）→ 🎯 兴趣班 | `drill.study` 三态 | `client.js:1001-1117` | **可弃** |
| 9 | `work` | 💼 打工 | 磁贴 | 若工作带 `trait` 则先按「武力/魅力/智力」分组，再列工种（含等级/证书门槛与报酬） | `drill.work` | `client.js:1912-2004`；SKILLS `client.js:1907-1911` | **可弃** |
| 10 | `shop` | 🛒 商店 | 磁贴（生病时角标 `!`） | 8 个货架（食物/沐浴/玩具/鱼饵/装扮/药品/复活/晋升）→ 商品磁贴（价格/拥有数/「需要」标签） | `drill.shop` | `client.js:208-275`；`KIND_ORDER` `client.js:65`；`KIND_TITLE` `client.js:64` | **可弃** |
| 11 | `travel` | 🧳 旅行 | 磁贴（金币 ≥400 时角标 `!`） | 目的地列表（时长/花费/可带回稀有度）+ 纪念品行 + 选中后可卖 | `drill.travel`；`souvenirPick` | `client.js:1838-1905` | **可弃** |
| 12 | `bag` | 🎒 背包 | 磁贴 | 分类网格（6 类消耗品 + 4 个特殊：装扮/日记/纪念品/鱼篓）→ 物品列表（用/穿）→ 鱼篓（喂食/出售）→ 日记 → 纪念品（卖） | `drill.bag` 多态 | `client.js:289-557`；`CONSUMABLES` `client.js:277-279`；`EXTRA` `client.js:280-285` | **可弃** |
| 13 | `pomodoro` | 🍅 番茄钟 | 磁贴 | 未开始：15/25/45 分钟按钮 + 今日完成数 + 奖励规则 + 休息倒计时；进行中：大字倒计时 + 「放弃这一个」 | 无 | `client.js:2185-2232`；计时 `client.js:2235-2277` | **保留**（这是「陪伴工具」而非娱乐，见第九节） |
| 14 | `fishing` | 🎣 钓鱼 | 磁贴 | 5 个阶段：准备（选饵/抛竿/自动钓鱼 30/60 分）→ 等待（水面 + ❗）→ 咬钩（圆盘 QTE）→ 结果（放进背包）→ 外出中 | 无 | `client.js:3332-3545` | **可弃**（唯一内嵌小游戏） |

副证：`docs/screenshots/` 的文件名与上表一一对应——
`03-status.png`、`b9-card-*.png`、`c4-dex-*.png`、`c6-skins.png`、`c6-import.png`、
`04-study.png`/`b8-study-*.png`、`b9-work-*.png`、`05-shop.png`/`11-shop-shelves.png`/`22-shop-grid.png`、
`06-travel.png`、`b8-bag-*.png`、`c2-focusing.png`、`c5-minigame.png`/`c5-catch-result.png`、
`c1-dev-app.png`、`09-item-picker.png`、`b10-crown-*.png`。

### 5.4 非 App 的浮层 / 常驻 UI

| 元素 | 类名 | 何时出现 | 位置 | 建议 |
|---|---|---|---|---|
| 名字/金币/健康 HUD | `.dp-hud` | **仅面板展开时**（`hud.hidden = !next`） | `client.js:3972`、`client.js:1305-1311` | 保留精简版（可只留名字） |
| 在外活动指示 | `.dp-work` + `.dp-prop` + `.dp-progress` | 学习/打工/旅行/钓鱼期间 | `client.js:4090-4098`、`client.js:1278-1290` | 视裁撤决定；**若不裁，桌宠形态下建议只留 emoji，不要进度条** |
| 番茄钟药丸 | `.dp-pomo[data-pomo-pill]` | 专注进行中 | `client.js:4166-4168`、`client.js:1588` | 保留（`1s` 本地刷新） |
| 签到/礼包圆钮 | `button.dp-daily` | 可签到或有未领礼包 | `client.js:4171-4178`、`client.js:1383-1400` | 可弃（或保留为纯提醒点） |
| 戳三下提示 | `.dp-poke-hint` | 未孵化时 | `client.js:4111`、`client.js:1326-1331` | 保留（开局引导） |
| 灵魂 | `.dp-soul` | 死亡超过 1 天未收尸 | `client.js:4143`；`SOUL_AFTER_DAYS=1`（`data/life.js:66`） | 可弃 |
| 粒子层 | `.dp-fx` | 每次动作 | `client.js:2076-2084` | 保留（陪伴感的核心） |
| 彩带层 | `.dp-transform` | 加冕/签约 | `client.js:2033-2058` | 可弃（随晋升玩法一起走） |
| Toast | `.dp-toast` | 非台词类消息（生病/升级/死亡/外出返回…） | `client.js:4192-4225`、`client.js:2158-2164` | 保留精简版（只承载「猪有事要说」） |
| 图标栏 | `.dp-bar` / `.dp-ico` | **被 CSS 隐藏** | `client.js:1656` | 可弃（但要搬走 alert 状态，见 5.1） |
| 装扮锚点 | `.dp-dress` / `.dp-slot` | 有穿着装扮时 | `client.js:4145-4153` | 可弃（随背包一起走） |
| 物品选择面板 | `div.dp-pick` | 点照顾按钮且货架非空 | `client.js:116-147` | 保留（如果保留物品消耗） |
| 开发者入口 | `div.dp-version` | 主菜单底部 | `client.js:3587-3593` | **移除**（改为环境变量/隐藏快捷键） |

### 5.5 面板尺寸的硬编码常量（新 UI 若沿用外壳必须知道）

| 常量 | 值 | 用途 | 位置 |
|---|---|---|---|
| `PANEL_WIDTH` | `292` | 面板宽，也是展开态 `.dp-scene` 的宽 | `client.js:13`、`client.js:1212` |
| `PANEL_GAP` | `8` | 面板与场景的间距 | `client.js:14` |
| `PANEL_MARGIN` | `10` | 面板距窗口边缘留白（算 `maxWidth` 用） | `client.js:15` |
| `PANEL_MIN_HEIGHT` | `120` | `maxHeight` 下限 | `client.js:16` |
| `SCENE_RESERVE` | `132` | 网页版 `clampPig` 的最小场景高 | `client.js:17` |
| `PIG_PADDING_X` | `6` | 网页版夹取时的横向余量 | `client.js:18` |
| `--pig-size` | `56px`（随生命阶段改为 `54/58/60/68`，肥胖再乘系数） | 猪的边长 | `client.js:1164`、`client.js:4106/4137`；`data/life.js:33-47`；`core/weight.js:112` |
| `--pig-gap-below` | `12px` | 猪下方留白（折叠态场景高 = `pig-size + 12`） | `client.js:1164`、`client.js:1221` |
| `--scene-open` | `132px` | 展开态场景高 | `client.js:1164` |

---

## 六、通知 / 提醒能力

### 6.1 系统通知 —— 有代码，但**缺少权限申请**

唯一一处 `Notification` 调用（`client.js:4003-4017`）：

```js
function noticePomodoro(pomodoro) {
  if (pomodoro === null || pomodoro.finishedAt === null || pomodoro.finishedAt === pomodoroNotifiedAt) return
  pomodoroNotifiedAt = pomodoro.finishedAt                    // 用服务端时间戳去重
  var paid = pomodoro.todayDone <= pomodoro.cap
  var text = "今天第 N 个 · +N 🪙 / 今天奖励已拿满"
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification("🍅 专注结束", { body: text }); return
    }
  } catch (error) {}
  ctx.showBubble("🍅 专注结束 · " + text, 3200)                // 降级：气泡
}
```

**全库 grep `requestPermission` = 0 命中。** 因此：
- 在 DSH 网页版（HTTP origin）里 `Notification.permission` 是 `'default'` 且**永远不会变** →
  系统通知这条分支**永远走不到**，实际只走气泡降级。
- 桌面版（Electron）渲染进程里 `Notification.permission` 通常默认 `'granted'`，
  所以**可能**能弹系统通知——但这不是代码保证的，也没有 `setPermissionRequestHandler` 兜底
  （`main.js` 里 grep `Notification` 零命中）。
- **结论：系统通知是一条未验证的半成品路径。新项目若要「到点提醒」，
  必须在主进程显式接管**（`Notification` 主进程模块或 `session.setPermissionRequestHandler`），
  不要在渲染进程里裸调 HTML5 Notification。

### 6.2 番茄钟（`packages/pet-core/src/core/pomodoro.js`）

| 能力 | 实现 | 位置 |
|---|---|---|
| 时长选项 | `POMODORO_MINUTES`（UI 渲染成 15/25/45 三个按钮） | `client.js:2211-2221`；`core/pomodoro.js:104` |
| 状态存放 | `state.pomodoro = {startedAt, minutes, todayDone, day, restUntil, finishedAt, quietBefore}` | `core/pomodoro.js:23-26` |
| **跨刷新/重启持续** | 存的是 `startedAt` 时间戳，不是剩余秒数 | `core/pomodoro.js:109-110` |
| **到点结算时机** | 「到点由**下次请求**结算（`store/api.js` 的 `freshen` 调 `settlePomodoro`），**所以关着面板也会结算**」 | `core/pomodoro.js:5-7`、`126-153` |
| 免打扰联动 | 开始时保存 `quietBefore` 并置 `quiet=true`；结束时还原（**不会关掉用户自己开的免打扰**） | `core/pomodoro.js:108`、`113`、`143-145` |
| 奖励 | 每天前 `POMODORO_REWARDED_PER_DAY` 个给 `POMODORO_REWARD`，之后只计数 | `core/pomodoro.js:138-142` |
| 休息 | 完成后 `restUntil = now + POMODORO_BREAK_MINUTES` | `core/pomodoro.js:137` |
| **客户端本地秒表** | `createPomodoroClock` 用 `setInterval(tick, 1000)` 本地推进，与服务端 `secondsLeft` 偏差 >1500ms 时以服务端为准（`resync`） | `client.js:2235-2277`，尤其 `2239-2242`、`2273` |
| **面板外可见** | 折叠态药丸 `.dp-pomo[data-pomo-pill]` 显示 `🍅 m:ss` | `client.js:4166-4168`、`client.js:1588` |
| 提醒去重 | 服务端 `pomodoroView.finishedAt` 时间戳；客户端 `pomodoroNotifiedAt` 只在变化时弹一次 | `core/pomodoro.js:201`；`client.js:4005-4006` |
| 放弃 | `abandonPomodoro` 先结算（面板关着时可能早就到点了，那算完成） | `core/pomodoro.js:155-176` |
| 台词 | 开始/完成/放弃各 3 句 | `data/lines.js:196-210` |

### 6.3 其他提醒机制

| 机制 | 触发 | 表现 | 位置 |
|---|---|---|---|
| **图标角标 + 脉冲** | 学习（有买得起的课）、商店（生病）、旅行（金币 ≥400） | `icons[key][data-alert="true"]` → 图标 emoji 脉冲；主页磁贴读这份状态显示 `!`/文字 | `client.js:4188-4191`、`client.js:3595-3605` |
| **主页磁贴标签** | status 磁贴直接显示「走了 / 生病 / 在外面」 | 文字标签 | `client.js:3598-3603` |
| **待发消息 → Toast** | 升级/死亡/康复/外出返回/加冕/签约 | `div.dp-toast`，`4800ms`；`URGENT_KINDS` 穿透免打扰 | `client.js:4192-4225`、`client.js:3960` |
| **签到 / 礼包圆钮** | `daily.canSignIn` 或 `daily.unclaimed > 0` | 猪头顶圆钮（📅 / 🎁），`title` 有提示文案 | `client.js:4171-4178` |
| **更新提醒** | GitHub Releases 检查：首启 `10s`，之后每 `6h` | 未读时主页磁贴角标 `!` + 一次气泡「有新版本 vX 啦，去更新看看吧～」；`localStorage` 签名去重 | `client.js:4444-4480`、`4421-4428` |
| **托盘菜单**（桌面版） | 常驻 | 「藏起来 / 叫猪出来」「开机自启」（复选框）「从 DSH 导入猪…」「游戏版本 X」「退出」；单击托盘图标切换显隐 | `main.js:336-351` |
| **闹钟 / 定时提醒** | — | **无**。全库无 `alarm` / `remind` / 时间点提醒实现 | grep 零命中 |
| **主进程系统通知** | — | **无**。`apps/desktop` 下 grep `Notification` 零命中 | — |
| **托盘气泡 / 任务栏闪烁** | — | **无**（且 `skipTaskbar: true`，`main.js:188`） | — |

---

## 七、皮肤系统

### 7.1 内置皮肤

| 项 | 值 | 位置 |
|---|---|---|
| 场景枚举 | `SKIN_SCENES = [idle, eat, bathe, play, pet, relaxed, work, study, trip, fish]`（10 个） | `data/skins.js:3` |
| 必需场景 | `REQUIRED_SKIN_SCENES = SKIN_SCENES.slice(0,5)` = `idle, eat, bathe, play, pet` | `data/skins.js:4` |
| 内置皮肤表 | **只有 1 个**：`{key:'mint', label:'薄荷小猪', emoji:'🌿', art:'skin-mint', author:'dsh-piggy', description:'像一口薄荷汽水，清清凉凉。', scenes:['idle','eat','bathe','play','pet'], custom:false}` | `data/skins.js:6-12` |
| **默认皮肤不在表里** | `allSkins()` 手工前置 `{key:'default', label:'默认小猪', emoji:'🐷', art:'piglet', scenes:['idle'], custom:false}` | `core/skins.js:31` |
| 默认猪美术 | `assets/piglet.svg`（蜜桃色手绘猪，2.7KB） | `data/life.js:37`、`assets/piglet.svg` |

**⚠️ 内置「薄荷小猪」是占位素材。** `assets/skin-mint.svg`、
`skin-mint-eat.svg`、`skin-mint-bathe.svg`、`skin-mint-play.svg`、`skin-mint-pet.svg`
**五个文件字节完全相同**（MD5 均为 `11722ACBADB9A87EE7D30AFCD5549FE6`），
且与 `docs/examples/skin-pack/*.svg`（10 个文件）也是同一份字节。
即：**薄荷皮肤的 5 个场景全部渲染同一张图，没有任何动作差异**；
`docs/examples/skin-pack-example.zip` 里的示例包同样是这份占位图。
→ 换肤功能**逻辑完整但美术未完成**，新项目不能把它当「已可用素材」。
（另：`skin-mint.svg` 第 1 行的 `aria-label="薄荷小猪"`、第 3 行注释却写「蜜桃色的薄荷小猪」，
配色实际是薄荷绿 `#AEE8D0 / #3E9F83 / #79C9AF / #72BFA8`，注释是残留。）

### 7.2 自定义皮肤包格式（`docs/guides/skin-pack-format.md` + `store/skin-pack.js`）

**ZIP 层限制**（`docs/guides/skin-pack-format.md:9-14`；实现 `store/skin-pack.js:10-11`、`15-33`）：

| 限制 | 值 | 实现 |
|---|---|---|
| ZIP 总大小 | ≤ **2 MB**（`MAX_ZIP = 2*1024*1024`） | `store/skin-pack.js:10`、`15` |
| 文件数 | ≤ **20** | `docs:11` |
| 目录结构 | 文件必须**直接位于 ZIP 根目录**（不能有外层文件夹） | `docs:12` |
| 压缩方式 | 仅 未压缩(0) 或 Deflate(8)，不接受加密 ZIP | `store/skin-pack.js:33`（`[0,8].includes(method)`）；`docs:13` |
| 文件名 | 只能是 `skin.json` 或**全小写英文字母**组成的 `.svg` | `docs:13` |
| 单文件解压后 | ≤ **96 KB**（`MAX_FILE = 96*1024`） | `store/skin-pack.js:11`、`33`、`39` |
| 解析器 | **自研**（读 EOCD + 中央目录 + `inflateRawSync`），不依赖 zip 库 | `store/skin-pack.js:14-44` |

**场景文件**（`docs/guides/skin-pack-format.md:18-20`；实现 `store/skin-pack.js:54-55`）：
- 必需：`idle.svg` `eat.svg` `bathe.svg` `play.svg` `pet.svg`
- 可选：`relaxed.svg` `work.svg` `study.svg` `trip.svg` `fish.svg`；缺失时**回退到 `idle`**

**`skin.json` 字段**（`docs:24-32`；实现 `store/skin-pack.js:49-53`、`66-68`）：

| 字段 | 必需 | 限制 | 默认 |
|---|---|---|---|
| `key` | 是 | 1–24 位；`^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$`；不能与 `default` 或内置皮肤重名 | — |
| `label` | 是 | 非空，截断到 30 字 | — |
| `author` | 否 | 截断到 30 字 | `玩家` |
| `description` | 否 | 截断到 100 字 | `''` |
| `emoji` | 否 | 截断到 4 字 | `🎨` |

同一个 `key` 可重复导入以**更新**已有皮肤（`docs:32`；`core/skins.js:59-61` 覆盖写）。

**SVG 安全限制**（`docs:36-42`；实现 `store/skin-pack.js:59-60` 的正则）：

```js
/<svg\b/i.test(svg) && /viewBox\s*=\s*["']0\s+0\s+64\s+64["']/i.test(svg)
!/<(?:script|image|text|use|style|foreignObject|linearGradient|radialGradient|filter)\b
  |<!DOCTYPE|<!ENTITY|\bon[a-z]+\s*=|\b(?:href|src)\s*=|url\s*\(/i.test(svg)
```
- 必须有 `<svg>`；**必须** `viewBox="0 0 64 64"`
- 禁止标签：`script` `image` `text` `use` `style` `foreignObject` `linearGradient` `radialGradient` `filter`
- 禁止：`DOCTYPE`、实体、`href`、`src`、`on*` 事件属性、`url()`
- 目的（`docs:42`）：「让皮肤保持为可审查的纯矢量路径，并阻止脚本、外链资源、字体和位图进入页面」

**校验策略**：**先整包校验，失败不安装任何一部分**（`docs:46`；`store/skin-pack.js:74-77`）。
校验返回 `{ok:false, errors:[...]}` 时客户端把 `errors.join('；')` 塞进气泡
（`client.js:3948`）。

### 7.3 导入方式与存放路径

| 项 | 值 | 位置 |
|---|---|---|
| 入口 UI | 🎨 换肤 App 底部「📦 导入自己的皮肤」卡片（`label` 包住 `input[type=file accept=".zip,application/zip"]`） | `client.js:3932-3956` |
| 传输 | `fetch("/dsh-piggy/skins/import", {method:"POST", headers:{"content-type":"application/zip"}, body: file})` —— **原始 File 当 body**，不做 multipart | `client.js:3947` |
| 成功 | `ui.view = data`（服务端直接回新的完整视图）+ 重渲染 + 气泡「皮肤导入成功 🎨」 | `client.js:3949-3951` |
| 失败 | 气泡「导入失败：<errors.join('；')>」或「无法读取皮肤包」 | `client.js:3948`、`3952` |
| **存放路径** | **存档文件同级的 `skins/` 目录**：`join(dirname(savePath), 'skins')` | `store/skin-pack.js:78`；`docs:47` |
| 文件命名 | `custom-<key>.svg`（idle 不带后缀）、`custom-<key>-eat.svg` … | `store/skin-pack.js:81`；`core/skins.js:16`（`art: 'custom-'+key`） |
| 写入方式 | 先写 `.tmp` 再 `renameSync`（原子替换） | `store/skin-pack.js:82-83` |
| 读取 | `GET /dsh-piggy/art/custom-<key>[-<scene>].svg`；路由先查皮肤目录，再回退到 `./assets/` | `routes.js:146-150`、`store/skin-pack.js:89-91` |
| 美术 URL 白名单 | `^[a-z][a-z0-9-]{0,63}\.svg$` ——「请求里的任何东西都不可能走出 `./assets`」 | `routes.js:146` |
| 导入后行为 | 校验通过 → 立即加入列表并**成为当前皮肤** | `core/skins.js:62`；`docs:48` |

### 7.4 显示优先级与动作美术映射

**优先级**：`晋升形态 → 当前皮肤 → 默认猪`（`docs:49`；实现链
`formStageView()`（`core/evolution.js:146-151`）→ `skinStageView()`（`core/skins.js:67-73`）
→ `weightStageView()`（`core/weight.js:105-114`）→ 默认 `lifeStageFor()`）。
晋升形态结束后恢复此前选择的皮肤（`docs:50`）。

**动作美术解析**（客户端 `syncPigArt()`，`client.js:2005-2019`）：

```js
REACTION_ART = { feed:'eat', bathe:'bathe', play:'play', pet:'pet', cure:'relaxed', levelup:'relaxed' }
ACTIVITY_ART = { work:'work', study:'study', interest:'study', trip:'trip', fishing:'fish' }
src = ART_URL + art + (动作 && 允许 ? '-' + 动作 : '') + '.svg'
```
允许列表来自 `data-art-scenes`（`client.js:4123` 写入），来源是 `pig.stage.artScenes`。
**但 `artScenes` 只在内置皮肤/自定义皮肤路径上被赋值**（`core/skins.js:72`）；
`pig-fat`（`core/weight.js:107-114`）、`pig-king` / `pig-devil`
（`core/evolution.js:150`）**从不设置 `artScenes`** → `data-art-scenes=""` →
`String("").split(",")` 得到 `[""]` → 判断 `scenes[0] === ""` 为真 →
**任何动作都会被允许**（`client.js:2014-2015`）。

**由此产生两个实际的 404 断图**（`<img>` 上没有 `onerror` 兜底，全库 grep `onerror` 零命中）：

| 场景 | 会请求 | 实际存在？ |
|---|---|---|
| 肥猪 / 猪猪王 / 恶魔猪 形态下**钓鱼** | `assets/pig-fat-fish.svg` / `pig-king-fish.svg` / `pig-devil-fish.svg` | **都不存在**（`assets/` 只有 `pig-devil-fly.svg`，名字对不上，且没有代码引用它） |
| 任何形态下 `fish` 场景 | 同上 | 同上 |

另外 `assets/elder.svg`（老年猪，3.0KB）**是死素材**：
`LIFE_STAGES`（`data/life.js:31-48`）只有 `box / piglet / young / middle`，
注释明确写「没有老年、没有寿命 —— 猪只会因为意外死掉」（`data/life.js:27`），
全库无任何代码引用 `elder`。

**各形态的动作美术覆盖情况**（`assets/` 实际文件）：

| 形态 | 基图 | 动作场景文件 | 缺 |
|---|---|---|---|
| 默认（`piglet`） | `piglet.svg` | 无（`actionArt:false`，只有 emoji 弹跳） | — |
| 肥猪（`pig-fat`） | `pig-fat.svg` | `eat bathe play pet relaxed work study trip`（8 个） | `idle`(用基图) `fish` |
| 猪猪王（`pig-king`） | `pig-king.svg` | 同上 8 个 | `idle` `fish` |
| 恶魔猪（`pig-devil`） | `pig-devil.svg` | 同上 8 个 + `fly`（死文件） | `idle` `fish` |
| 薄荷皮肤 | `skin-mint.svg` | `eat bathe play pet`（4 个，**内容全同**） | `relaxed work study trip fish` |
| 老年（`elder`） | `elder.svg` | — | **整个形态无代码引用** |

**场景差异的实质**（抽查 `assets/pig-fat*.svg`）：
所有场景共用同一套基底，外层统一包一个
`<g transform="translate(3 3) scale(.90) … translate(32 54) rotate(0) scale(1 1) translate(-32 -54)">`，
再套 `<g transform="translate(2 5) scale(.073) translate(-216 -272)">` 把内容坐标缩放进 `64×64`。
场景之间**只增量追加道具路径**（球、碗、书、行李箱…），身体路径基本复用；
文件体积差即道具量差：`pig-fat.svg 2286B` → `pig-fat-eat.svg 2686B` →
`pig-fat-play.svg 2555B` → `pig-fat-relaxed.svg 2258B`。
`sleep/relaxed` 一类的差异只是姿态微调。**这正是新项目可以只做 1 张 idle + 4 张动作就够的原因。**

---

## 八、适配与无障碍

### 8.1 触屏

| 项 | 状态 | 位置 |
|---|---|---|
| 事件模型 | **全用 Pointer Events**（`pointerdown/move/up/cancel/leave`），天然兼容触摸与笔 | `client.js:4802`、`4818`、`4866`、`4874`、`3298`、`3305`、`3449`、`4793` |
| `touch-action` | 宿主 `touch-action:none` | `client.js:1167` |
| ⚠️ 副作用 | `touch-action` 会在整棵子树继承，因此**面板内容区 `.dp-content`（`overflow-y:auto`）在触屏上无法滚动/无法双指缩放**。全库只有两处重新放开：`.dp-fish-cast{touch-action:manipulation}`（`client.js:1825`）、`.dp-fish-qte{…touch-action:manipulation}`（`client.js:1826`） | — |
| 拖动阈值 | 桌面版用 `screenX/screenY`，触摸下这两个字段在部分实现里为 0 → 代码有 `typeof event.screenX === "number" ? event.screenX : event.clientX` 兜底，但**0 也是 number**，兜底不生效 → 触屏拖动在桌面壳里可能失效 | `client.js:4824-4825`、`4807-4810` |
| 长按 / 双击缩放 | 未被屏蔽（`touch-action:none` 已屏蔽页面级手势，但元素级 `manipulation` 处未处理） | — |
| 自定义光标 | `.dp-pig{cursor:url('data:image/svg+xml;…') 16 24, pointer}` —— 内联 SVG 手型光标，无资源依赖，palette 描边 `#794F27` | `client.js:1243` |
| **触屏专项适配（如虚拟摇杆、轻触 vs 长按区分）** | **无** | — |
| **响应式断点** | **无** `@media` 宽度断点；`@media` 只有 1 处（`prefers-reduced-motion`）；宽度靠 JS 的 `PANEL_WIDTH=292` 常量与 `room()` 实时计算 | `client.js:1819`、`client.js:2405-2456` |

### 8.2 高 DPI

**无任何显式处理。** 逐项核对：

| 检查 | 结果 |
|---|---|
| `devicePixelRatio` | 全仓（含 `apps/desktop`）**零命中** |
| `zoomFactor` / `setZoomFactor` / `zoomLevel` | 零命中 |
| `scaleFactor` / `getPrimaryDisplay().scaleFactor` | 零命中 |
| `width=device-width` viewport meta | `apps/desktop/renderer/index.html` **没有** `<meta name="viewport">`（全文 11 行） |
| 位图与倍图 | 无位图资源（`assets/` 全 SVG，`viewBox="0 0 64 64"`），矢量天然与 DPI 无关 |
| 混用 CSS px 与 DIP | 页面量框产出 CSS px，主进程 `win.setBounds` / `win.setShape` 收 DIP。Electron 在 Windows 上 `deviceScaleFactor = 系统缩放`，**CSS px ≡ DIP**，所以 1:1 直接可用——这是「能用」而非「已处理」 |

→ **结论：桌面版能跑是因为 Windows 上 CSS px 与 DIP 恰好 1:1**；
如果将来加缩放（`webContents.setZoomFactor`）或换到需要显式换算的平台，
`shell.js` 的 `layoutBox` 与 `main.js` 的 `setShape` 之间会立刻出现比例错位。
新项目应在契约里显式约定「报给主进程的必须是 DIP」。

### 8.3 无障碍与键盘操作

| 检查 | 结果 | 证据 |
|---|---|---|
| 全局 `keydown` / `keyup` / `keypress` | **无** | grep 全库零命中 |
| 快捷键 / 热键 | **无**（`main.js` 里也没有 `globalShortcut`） | grep `globalShortcut` 零命中 |
| 键盘可达性 | **仅靠原生 `<button>` 语义**：`button()` 工厂创建真正的 `<button type="button">`（`client.js:90-99`），因此 Tab 聚焦 + 空格/回车激活**天然可用** | `client.js:90-99` |
| 钓鱼空格操作 | 提示文案写「点击或按空格」（`client.js:3465`），但**没有键盘监听**，实际是 `wrap` 带 `tabindex="0"` 的 `<button>` 的原生激活行为 | `client.js:3439`、`3466` |
| 焦点可见样式 | 有 **8 处** `:focus-visible` 轮廓（统一 `2px solid var(--ac-primary)`，主色青绿，注释说明设计系统要求 focus ring 用黄或青、绝不用蓝） | `client.js:1396`、`1409`、`1432`、`1475`、`1519`、`1529`、`1622-1623`、`1745`、`1826`；设计规则见 `client.js:1142` |
| 焦点管理 | **无**。没有 roving tabindex、没有面板打开时自动聚焦、没有焦点陷阱（焦点可以 Tab 到宿主页面背后）、没有 Escape 关闭面板 | — |
| ARIA | **全库只有 3 处**：`aria-hidden="true"`（彩带层，`client.js:2038`）、QTE 的 `aria-label`（`client.js:3443`）、鱼饵的 `aria-pressed`（`client.js:3361`） | — |
| 语义角色 | 面板 `div.dp-card` **没有** `role="dialog"` / `aria-modal` / `aria-label`；气泡 **没有** `aria-live`；toast **没有** `role="status"` | — |
| 图片替代文本 | `.dp-pig-img` 的 `alt=""`（装饰性，`client.js:4287`）；居民卡头像 `alt=""`（`client.js:2981`）；皮肤缩略图 `alt = skin.label`（`client.js:3918`） | — |
| 工具栏提示 | `scene.title = "左键摸摸 · 右键打开面板 · 拖动可移动"`（原生 tooltip，慢且不读屏友好）；`dp-daily.title` 有文案（`client.js:4176`）；`dp-work.title` 有文案（`client.js:4097`） | `client.js:4300` |
| 减少动效 | **只有 1 处** `@media (prefers-reduced-motion:reduce)`，且只关掉图鉴 3D 卡片的 `transition` / `transform`；**猪的 `dp-bob`、粒子、彩带、toast 动画全部不受影响** | `client.js:1819-1820` |
| 高对比模式 / `forced-colors` | **无** | — |
| 字号缩放 | 全部字号硬编码 `px`（`9.5px`–`18px`），不随系统字号变化 | — |

**结论：无障碍支持基本为「无」。** 唯一的实质性支持是
（a）所有可点控件都是真 `<button>`（因此键盘可达），
（b）8 处 `:focus-visible` 轮廓，
（c）1 处图鉴卡片级的 `prefers-reduced-motion`。
**没有全局快捷键、没有 Escape 关闭、没有焦点管理、没有 `aria-live` 状态播报、没有 reduced-motion 覆盖主体动画。**

---

## 九、桌宠必需 vs 游戏专有 —— 划分表

判定口径：
- **必需**＝删掉它桌宠就不成立（或要重写外壳契约）。
- **陪伴增益**＝删掉仍能跑，但桌宠的「活着」的感觉明显变弱。
- **可弃**＝纯游戏内容，删掉只影响玩法，不影响桌宠身份。
- **有害**＝建议主动删除（成本/风险大于收益：外网依赖、调试入口、断图素材、空转轮询）。

| # | 功能点 | 证据 | 归属 | 建议 |
|---|---|---|---|---|
| 1 | 宿主 `[data-dsh-pig]` + `.dp-pig` + `.dp-card` 三件套 + `__dshPiggyShell` / `piggyShell` / `__ModuleLoader__` 三个全局 | `shell.js:32-70`、`shell.js:96`、`shell.js:143`、`shell.js:206`；`client.js:10`、`client.js:2381-2387`、`client.js:4533` | **必需（硬契约）** | **原样保留**。这是外壳（改窗口 + 像素级点击区域 + 拖动窗口）能复用的唯一条件；重写 UI 时这三个选择器与三个全局名不要改，改名要同步改 `shell.js`/`preload.cjs`/`main.js` 三处 |
| 2 | `[hidden]{display:none}` 兜底规则组 | `client.js:1184-1190`；原因 `client.js:1179-1183` | **必需** | 保留等价规则。否则隐藏面板会撑大窗口 + 吞桌面点击 |
| 3 | 宿主 `position:fixed` + `pointer-events:none` + `>*{pointer-events:auto}` | `client.js:1165`、`1172`、`1178` | **必需** | 保留。`fixed` 是 `layoutBox()` 能终止于宿主的前提；`pointer-events` 是透明边不吞点击的前提 |
| 4 | 待机浮动 `dp-bob 1.8s`（**只改 transform**）+ 阴影挂在子元素上 | `client.js:1225-1227`、`client.js:1246`、注释 `client.js:1223-1224` | **必需** | 保留「动画只改 transform、滤镜挂不动元素」这两条铁律。这是 120ms 量框 + 4px 量化能不抖的基础（`shell.js:9-11`） |
| 5 | 左键摸摸：`flash("pet")`（squash 动画 + ❤️ 粒子 + `PET_LINES` 10 句） | `client.js:4866-4873`、`2102`、`2110-2117`、`40-51` | **必需** | 保留并**修掉两个冲突**：① `pointerup` 补 `event.button !== 0` 判定；② 补目标过滤，别让点回复/签到也摸摸（见 2.4） |
| 6 | 左键拖动 → 桌面版只发 `moveBy` 增量、不写存档 | `client.js:4818-4849` | **必需** | 保留。`screenX/screenY` 增量 + 3px 阈值 + `setPointerCapture` 三件套照抄 |
| 7 | 右键开/关面板（`contextmenu` + `setOpen`） | `client.js:4877-4881`、`3967-3985` | **必需** | 保留。建议把开关搬到 `pointerdown(button===2)` 并 `preventDefault`，消除与 #5 的冲突 |
| 8 | 气泡 `.dp-bubble`（折叠态浮在猪头顶、`z-index:2`）+ `showBubble` 2600ms | `client.js:2119-2130`、`1368-1376`、`1414-1419` | **必需** | 保留。`z-index:2`（必须高于猪）这条注释 `client.js:1365-1367` 值得抄进新样式 |
| 9 | 台词系统：`say()` / `chat('enter'|'idle')` / `pickLine` 不连续重复 / 四次去重 / `[主人]` 占位符 | `core/lines.js:25-39`、`62-69`、`99-116`；`data/lines.js:55-211`（27 场景 94 句） | **必需** | 保留机制，**台词库可大幅裁剪**（桌宠只需要 `idle / enter / pet / hungry / dirty / lonely` 六个场景 ≈ 30 句） |
| 10 | 免打扰 `dialogue.quiet`（`setQuiet`，设置入口在状态页） | `core/lines.js:119-123`；UI `client.js:907-913` | **必需** | 保留。这是「不打扰」诉求的用户可控开关，比全屏检测更便宜、更可靠 |
| 11 | 纸盒开局三击（`pokeBox` / `BOX_POKES_TO_OPEN=3` / `.dp-poke-hint`） | `client.js:4850-4865`、`54-58`、`4274-4278` | **陪伴增益** | 保留（首次启动的引导感），可简化为「点一下拆开」 |
| 12 | HUD（名字 / 金币 / 健康），**仅展开时可见** | `client.js:3972`、`client.js:4254-4261`、`1305-1311` | **陪伴增益** | 保留精简版（名字 + Lv），金币/健康随经济系统一起砍 |
| 13 | 番茄钟（含折叠态药丸、跨重启、免打扰联动） | `core/pomodoro.js`（全文）、`client.js:2185-2232`、`2235-2277`、`4166-4168` | **必需（陪伴工具）** | **保留**。这是全项目最贴合「PC 桌宠陪我工作」的产品点；注意系统通知是半成品（第六节），要用主进程通知重做 |
| 14 | 换肤（切换 + 自定义 ZIP 包 + 校验 + `skins/` 目录） | `core/skins.js`、`store/skin-pack.js`、`client.js:3900-3957`、`docs/guides/skin-pack-format.md` | **陪伴增益** | 保留逻辑框架；**但内置薄荷皮肤是 5 张同图占位**（7.1 节），要自己出图或只留导入口 |
| 15 | 待发消息 → Toast（升级/生病/死亡/外出返回）+ `URGENT_KINDS` 穿透免打扰 | `client.js:4192-4225`、`3960`、`2158-2164` | **陪伴增益** | 保留 Toast 通道（只留 3–4 种 kind）；URGENT 白名单机制照抄 |
| 16 | 更新提醒（GitHub Releases + `localStorage` 签名去重 + 一次气泡） | `client.js:4408-4530`、`4444-4480` | **陪伴增益** | 保留降级版（启动查一次 + 打开发布页），删掉 6 小时轮询 |
| 17 | 托盘 + 开机自启 + 隐藏/显示 + 退出 | `main.js:336-351`、`447` | **必需（桌面版）** | 保留。`skipTaskbar: true`（`main.js:188`）意味着**托盘是唯一的找回方式**，不能砍 |
| 18 | 在外活动指示 `.dp-work` + `.dp-prop` + `.dp-progress` | `client.js:4090-4098`、`1278-1290` | **陪伴增益** | 若裁掉学习/打工/旅行则整体删；若保留「出门」概念，建议只留 `.dp-prop` emoji，**删掉 `width` 变化的进度条**（它每次变化都会触发一次 `setContent`，见 3.3 表末行） |
| 19 | 粒子 `.dp-fx`（心形/星星/水滴…11 组映射） | `client.js:2071-2088`、`2097-2109` | **陪伴增益** | 保留（`pet` 的 ❤️ 一颗足矣），其余的随对应玩法一起删 |
| 20 | 状态 App 的照顾动作（喂食/洗澡/玩耍 + 物品选择 + 冷却文案） | `client.js:789-855`、`116-147` | **陪伴增益** | 保留「摸摸」（免费、无物品）+ 可选保留「喂食」；洗澡/玩耍与物品/商店强耦合，建议整体裁 |
| 21 | 状态条 4 条 + 三维 + 体重档位 | `client.js:793-806`、`978-989` | **可弃** | 若保留「饿/脏」台词，可只留 2 条条；三维/体重整体删 |
| 22 | 签到 / 礼包圆钮 + 连签周期 | `client.js:4171-4178`、`1383-1400` | **可弃** | 删 |
| 23 | 居民卡 App（生日/星座/性格/口头禅/签名 + 编辑） | `client.js:2963-3059` | **可弃** | 删（口头禅字段本身保留，它喂给台词 catchphrase：`data/profile.js:38`、`core/lines.js:46-54`） |
| 24 | 图鉴 App（5 分区 / 闪卡 / 博物馆 / 目录 / 详情 / 3D 倾斜 / 搜索过滤） | `client.js:3085-3310`、`core/dex.js` | **可弃** | 删。若要留一点收集感，只留「形态」分区（4 条） |
| 25 | 商店 App（8 货架 + 商品磁贴 + 金币） | `client.js:208-275`、`data/shop.js` | **可弃** | 删（金币随之一并删，HUD 只留名字） |
| 26 | 背包 App（6 类消耗品 + 装扮 + 日记 + 纪念品 + 鱼篓 + 装扮锚点 `.dp-slot`） | `client.js:289-557`、`client.js:4145-4153` | **可弃** | 删 |
| 27 | 学习 App（学阶 → 科目 → 兴趣班） | `client.js:1001-1117` | **可弃** | 删 |
| 28 | 打工 App（三维分组 → 工种） | `client.js:1912-2004` | **可弃** | 删 |
| 29 | 旅行 App（目的地 + 纪念品 + 出售） | `client.js:1838-1905` | **可弃** | 删 |
| 30 | 钓鱼 App（抛竿 / 咬钩 / 圆盘 QTE / 自动钓鱼 / 鱼篓） | `client.js:3332-3545` | **可弃** | 删。这是唯一的 rAF 逐帧小游戏，也是唯二需要 `touch-action:manipulation` 的地方 |
| 31 | 晋升玩法（加冕/签约）+ 全屏彩带 `.dp-transform` | `client.js:2033-2058`、`4203-4208`、`data/evolution.js` | **可弃** | 删 |
| 32 | 死亡 / 墓碑 / 灵魂 | `client.js:4143`、`1350-1359`、`data/life.js:61-66` | **可弃** | 删（「陪伴」型桌宠不适合会死的猪） |
| 33 | 图标栏 `.dp-bar`（11 个 App 图标 + `data-alert` 脉冲） | `client.js:1421-1434`、`1656`、`2467-2478` | **可弃** | 删，但**先搬走 alert 状态**（现在由 `ctx.icons[key].getAttribute("data-alert")` 承载，`client.js:4188-4191`、`3604-3605`） |
| 34 | 开发者模式（版本号点 7 次 + 13 组调试按钮 + `window.dshPigDev`） | `client.js:32-36`、`558-786`、`4345-4376`、`4904-4921` | **可弃（建议有害）** | **删**。发布版留一个 7 连点后门 + 能改存档的按钮组，是纯粹的暴露面 |
| 35 | 更新 App（游戏/外壳双版本、下载、安装、回退、Release Notes） | `client.js:3738-3803` | **可弃** | 桌面版保留「打开发布页」；金丝雀/回退机制交给安装器 |
| 36 | GitHub API 轮询（首启 10s + 每 6h）**在插件版也跑** | `client.js:4478-4479`、`4394-4395` | **有害** | 桌宠不需要每 6 小时打一次 GitHub。改成「用户点更新才查」 |
| 37 | Google Fonts 外链（`fonts.googleapis.com` 的 Nunito + Noto Sans SC） | `client.js:4243-4246` | **有害** | **删**。桌宠在离线/内网环境下会白等字体；改为系统字体栈（`--ac-font` 里已有的 `-apple-system / PingFang SC / Hiragino Sans GB / sans-serif` 可直接用，`client.js:1145`） |
| 38 | 4 秒轮询 `GET /dsh-piggy/state`（常驻，面板关着也跑） | `client.js:7`、`4886` | **有害（可按需优化）** | 桌宠空闲态应当没有网络活动。改成：面板关闭时停轮询 / 用 SSE / 只在动作后拉一次 |
| 39 | `assets/elder.svg`（无代码引用） | 无引用；`data/life.js:27`、`31-48` | **有害（死素材）** | 删文件 |
| 40 | `assets/pig-devil-fly.svg`（无代码引用） | `ACTIVITY_ART` 无 `fly`（`client.js:2007`） | **有害（死素材）** | 删文件 |
| 41 | 肥猪/猪猪王/恶魔猪 形态下钓鱼会请求不存在的 `*-fish.svg` → 断图 | `client.js:2007`、`2014-2018`；`assets/` 无 `-fish` 文件 | **有害（bug）** | 裁掉钓鱼即消失；若保留钓鱼，需补图或加 `<img onerror>` 回退到基图 |
| 42 | `.dp-scene` 整块矩形吞桌面点击（展开时约 292×132，其中透明区 ~200×90） | `client.js:1178`、`1204-1212`；`shell.js:102-128` | **有害（体验 bug）** | 若要真正的像素级穿透：给透明容器 `pointer-events:none`，**并**让量框跳过它（否则 `shape` 仍含该矩形），或改用「按可见叶子节点取盒」的策略 |

### 9.1 建议的「最小桌宠 UI 集」（把上表收拢）

**只保留 6 个界面状态**（对应 `client.js` 里要保留的渲染函数）：

| 状态 | 来源 | 说明 |
|---|---|---|
| ① 折叠态 | `setOpen(false)` + `.dp-scene`（`pig-size + 12` 高） | 猪 + `dp-bob` 待机 + 可选 `.dp-pomo` 药丸 + 可选 `.dp-daily` 提醒点 |
| ② 气泡 | `showBubble` / `showLine` | 折叠时浮在猪头顶；有 `dp-reply` 时 6 秒超时 |
| ③ 展开态面板 | `setOpen(true)` | 一个卡：精简单状态页（名字/Lv + 1–2 条状态条 + 摸摸/喂食按钮 + 免打扰开关） |
| ④ 番茄钟面板 | `renderPomodoroTab`（`client.js:2185-2232`） | 15/25/45 + 倒计时 + 放弃 + 今日数 |
| ⑤ 换肤面板 | `renderSkinsTab`（`client.js:3900-3957`） | 皮肤列表 + ZIP 导入 |
| ⑥ 设置面板 | **新增** | 免打扰、开机自启、贴边方向、缩放、快捷键；替换现有的 `dev` + `update` 两个 App |

**必须搬走的 3 个隐含状态**（删 UI 时容易漏）：
1. `ctx.icons[key][data-alert]` —— 提醒状态的真值存储，目前寄居在被隐藏的 `.dp-bar` 上（`client.js:1656`、`4188-4191`）。
2. `localStorage` 三把键：`dsh-piggy:open`、`dsh-piggy:position`、`dsh-piggy:dev`（`client.js:11-12`、`36`）。
3. `desktopShell()` 分支 —— 网页版与桌面版在同一份代码里，删任一侧时不要破坏另一侧（`client.js:2381-2387`）。

---

## 附录 · 风险与缺口速查

| # | 风险 | 影响 | 证据 |
|---|---|---|---|
| R1 | 右键同时触发「摸摸」与「开关面板」 | 手感错乱 + 展开后残留台词气泡 | `client.js:4866`（无 button 判定）+ `client.js:4877-4881` |
| R2 | 场景内任何 `pointerup` 都算摸摸（回复按钮、签到钮、道具） | 误触 | `client.js:4866`（无 target 过滤） |
| R3 | `.dp-scene` 整块矩形进入可点区域 | 展开时 292×132 里有约 90% 是全透明区域，仍会吞桌面点击 | `client.js:1178`、`1204-1212`；`shell.js:102-128` |
| R4 | 主进程硬截断 64 个 shape 矩形 | 超过即静默丢弃 → 部分区域不可点 | `main.js:257`、`main.js:285` |
| R5 | `.dp-pig` 不可见 ⇒ `setContent` 永不发出 ⇒ 窗口永不接受点击（无日志） | 死锁式失效，难排查 | `shell.js:107`、`245`；`main.js:195-196`、`256-261` |
| R5b | `piggy:shape` 通道 + `setShape` API 是死代码（`shell.js` 从不调用） | 误以为有两条上报路径 | `preload.cjs:11`；`main.js:281-289`；`shell.js` 只有 `252` 一处 `setContent` |
| R6 | 系统通知缺 `requestPermission` | 番茄钟系统通知在网页版永远不弹 | `client.js:4010-4011`；全库 grep 零命中 |
| R7 | 内置薄荷皮肤 5 图字节相同 + 示例包同图 | 换肤后看不到动作差异 | MD5 全部 `11722ACB…` |
| R8 | 肥猪/王/恶魔猪钓鱼请求不存在的 `*-fish.svg`，无 `onerror` 回退 | 断图 | `client.js:2007`、`2014-2018` |
| R9 | 全库无全屏检测（`fullscreen` / `kiosk` / `QUNS_*` 零命中） | 「不与全屏游戏冲突」未实现 | 见 task-1 / task-5 |
| R10 | 常驻 4s HTTP 轮询 + 6h GitHub 轮询 + 120ms 量框 timer + 1s 番茄钟 timer | 空闲功耗与网络活动 | `client.js:7`、`4886`、`4478-4479`；`shell.js:267`；`client.js:2273` |
| R11 | Google Fonts 外链 | 离线首屏白等 | `client.js:4243-4246` |
| R12 | `.dp-content` 触屏不可滚动（`touch-action:none` 继承） | 触屏设备面板滚不动 | `client.js:1167`；仅 `client.js:1825-1826` 放开 |
| R13 | 无全局键盘 / 无 Escape / 无焦点管理 / 无 `aria-live` | 键盘与读屏体验缺失 | 第八节 |
| R14 | `prefers-reduced-motion` 只覆盖图鉴卡片 | 晕动症用户仍会看到猪持续浮动与粒子 | `client.js:1819` |
| R15 | 开发者后门（7 连点）+ 可改存档按钮组 | 暴露面 | `client.js:32-36`、`558-786` |
| R16 | 进度条与状态条改 `width`（非 transform） | 每次变化触发 `setContent` | `client.js:1290`、`1451`；与 `shell.js:9-11` 的性能原则冲突 |
