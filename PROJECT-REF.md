# PROJECT-REF · dsh-piggy 参考项目事实基线

> 本文件是**只读事实备忘**，供所有分析者共享，避免重复摸索。
> 数据来源：`F:\piggy\_ref`（`https://github.com/CLICGGER-TYPES/dsh-piggy` 的 `--depth 1` 克隆）。

## 0. 用户在 2026-10 会话中已确认的决策（**优先级高于本文档其它推断**）

**项目目标**：做一个 **PC 桌宠**，内容是「**谷歌猪**」。

| 决策项 | 用户原话/选择 | 落地含义 |
|---|---|---|
| 素材 | 「**A 采纳一部分 我不需要的动作不采纳 其余按 D 重绘**」 | `piglet.svg` **只采纳需要的那几张**；缺的场景图**自己重绘**（规格见 §4） |
| UI | 「**UI 也无需参考他的**」 | 界面自设计，只复用**行为与接口契约**，不复用视觉 |
| 娱乐玩法 | 「不需要他的娱乐玩法，比如学习打工商店旅行钓鱼」 | `school` `work` `travel` `fishing` `shop`(部分) `dex` 整体裁撤 |
| **保留** | 「基础照顾（喂食/洗澡/玩耍/摸摸）+ 四维状态条」 | 保留 `care.js` + 状态条 UI |
| **保留** | 「摸摸互动 + 台词气泡 lines.js」 | 保留 `lines.js` + 气泡系统 |
| **删除** | 「疾病与死亡（illness.js，含三条疾病链、墓碑、还魂丹）」 | `illness.js` `GRAVE` `SOUL` **整体删除**；猪不会死 |
| **等级** | 「不需要形态变化但是可以有**单纯的等级**，并且**可以有形态变化**，换皮肤，换形态，**可以去自定义形态**，形态可能后续还有技能能力」 | **不是**参考项目那种「等级 = 自动换形态」；而是：等级独立存在 + **形态/皮肤作为可切换的自定义维度** + 预留**技能/能力**扩展点 |
| 硬约束 1 | 「**轻量化**，尽可能不占用资源」 | 见 `analysis/E-lightweight-fullscreen.md` |
| 硬约束 2 | 「**不能与全屏化的游戏等冲突**」 | 见 `analysis/A-desktop-shell.md` §4 + `analysis/F-悬浮模式设计.md` |

### 0.1 第二轮确认（Bongo Cat 式悬浮方案）

| 决策项 | 用户原话 | 落地含义 |
|---|---|---|
| **不打扰机制** | 「可以参考 bongocat 那种，他好像就不影响游戏，或者设个快捷键或者模式，**开了那个模式之后桌宠就不会被点到只是和 bongocat 一样悬浮着**」 | ✅ **采用「穿透模式 + 快捷键」为主方案**，取代原计划的「全屏检测」。Bongo Cat 实测**根本没有全屏检测**，靠整窗点击穿透 |
| **等级** | 「不强制换形态的话**等级就是个数字，暂时没啥用**」 | ✅ 等级**纯展示**，一期不承担任何解锁/门槛职责；但**数据结构要留好**，后续接技能/解锁不用改存档 |
| **形态** | 「**形态做成单独的吧**」 | ✅ 形态与等级**完全解耦**，是可独立切换的维度（与皮肤并列） |
| **技术栈** | 「**接受换 Tauri2，保证轻量化不要占资源**」 | ✅ **确定 Tauri 2**，放弃 Electron |
| **穿透模式动画** | 「**动画继续播**」 | ✅ 穿透模式下动画照常播放（帧率可降档省电） |
| **快捷键** | 「**快捷键可以自己设**，默认先用你这个」 | ✅ 快捷键**可自定义**，默认 `Ctrl+Alt+P`（互动↔穿透）/ `Ctrl+Alt+H`（显示↔隐藏） |
| **穿透默认值** | 「**默认互动**」 | ✅ 首次启动为互动模式 |
| **悬停自动穿透** | 「**做**」 | ✅ **一期实现** |
| **全屏检测** | 「**二期**」 | ✅ **一期不做**，二期实现 |

**关键实证（`analysis/F-悬浮模式设计.md`）**：Bongo Cat（`ayangweb/BongoCat` v2.0.1）的机制是
Windows `WS_EX_TRANSPARENT | WS_EX_LAYERED` + `WS_EX_NOACTIVATE`，
**两个位必须成对设置**（只设 `WS_EX_TRANSPARENT` 对透明窗口无效，真实点击仍会命中）。
其 Windows 安装包仅 **9.71 MB**，但那是「纯 Rust + GPUI + D3D11、不用 Tauri/WebView」的成绩。

> 未选中的选项（**默认不采纳**）：番茄钟 `pomodoro`、体重/胖瘦 `weight`。
> 这两项尚未得到用户明确表态 → 在主方案里列为**待定项**，默认「暂不做」。

### 等级与形态的正确理解（覆盖参考项目设计）
参考项目：`data/life.js:31-48` 的 `LIFE_STAGES` 用 `fromLevel` **自动**推进形态
（box→piglet Lv1→young Lv10→middle Lv40），且 `young`/`middle` **根本没有立绘**。
用户第二轮确认后要的是**彻底解耦**：
```
等级 level（独立，一期【纯展示、纯数字】，不做解锁/门槛）
  ├── 皮肤 skin（可切换，可自定义导入）
  └── 形态 form（可切换，可自定义；与皮肤并列，【独立】于等级）
        └── skills（预留扩展点，一期留空数组）
```
> ⚠️ **等级一期无功能**（用户原话「暂时没啥用」），但**存档结构必须留好字段**，
> 后续接技能/解锁时不必再改存档版本、不必写迁移。

## 1. 仓库定位

一只住在 DeepSeek Harness（DSH）里的猪，**也能单独装成桌面宠物**。
双形态：`DSH 插件` + `Electron 桌面外壳`。MIT License。

> ⚠️ **本项目（我们的桌宠）已决定改用 Tauri 2，不再沿用它的 Electron 外壳**（见 §0.1）。
> 本文档 §1–§7 描述的是**参考项目的现状**，作为设计参考而非我们要照搬的技术栈。

## 2. 目录结构

| 路径 | 作用 |
|---|---|
| `index.js` `core.js` `data.js` | DSH 插件入口（Host 侧） |
| `client.js`（241KB） | **全部前端 UI 与猪的行为逻辑**，单文件 |
| `commands.js` `routes.js` `snapshot.js` `render.js` `store.js` | 插件 Host 侧接口 |
| `packages/pet-core/src/core/*.js` | **纯逻辑核心**（约 30 个模块，无 DOM） |
| `packages/pet-core/src/data/*.js` | **数值/文案数据表**（约 20 个模块） |
| `apps/desktop/main.js` | **Electron 主进程**（24KB）——桌面宠物的窗口行为全在这 |
| `apps/desktop/preload.cjs` | 主进程 ↔ 页面 桥 |
| `apps/desktop/renderer/shell.js` | 桌面页面：**量内容外接框 → 上报主进程改窗口** |
| `apps/desktop/lib/window-geometry.js` | 窗口几何算法（含 `WINDOW_PADDING=16`、`QUANTIZE_STEP=4`） |
| `apps/desktop/lib/versions.js` | 游戏包 / 外壳 双版本号与更新 |
| `apps/desktop/lib/host.js` `shell-update.js` | 内嵌本地 HTTP Host + 自更新 |
| `assets/*.svg` | **猪的美术资源（矢量 SVG，无位图）** |
| `docs/` | ART-SPEC / DESIGN / DEVELOPMENT / CONVENTIONS / guides |
| `store/` | 存档文件读写 + 皮肤包导入 + 商店 API |
| `test/` `apps/desktop/test/` | node:test 测试 |

## 3. 技术栈与体积

- Electron **44.5.1** + electron-builder 26.15.3（桌面外壳）
- 打包目标：Windows `nsis` + `portable`；Linux `AppImage`；macOS `dmg`(x64/arm64)
- 游戏本体以 `extraResources/game` 打入，**与外壳分离更新**
- 前端：**零框架、零运行时依赖**，纯 DOM + CSS（`client.js` 单文件）
- 核心逻辑：纯 ESM JS（`@ts-check`），依赖：`electron-updater` 一个
- 资源统计：153 个 `.js`（1.27MB）、103 个 `.png`（7.9MB，**几乎全在 `docs/screenshots/`**）、
  47 个 `.svg`（184KB）、2 个 `.gif`（4.3MB，在 docs）
- **实际运行所需美术资源仅 34 个 SVG ≈ 130KB**；`docs/` 截图占仓库体积 95% 以上

## 3.5 本机开发环境核验（2026-10 实测，为 Tauri 2 落地做准备）

| 依赖 | 状态 | 实测值 |
|---|---|---|
| Rust / Cargo | ✅ **已修复**（原为损坏，见下） | rustc **1.99.0** / cargo **1.99.0** |
| rustup | ✅ | 1.29.1（修复过程中自升级） |
| **MSVC 链接器** | ✅ | VS Community 2022 @ `D:\VS2022`，MSVC **14.41.34120**，`link.exe` 存在 |
| **Windows SDK** | ✅ | **10.0.22621.0**（`kernel32.lib` 等齐全） |
| **WebView2 Runtime** | ✅ | **154.0.4258.48**（Tauri 必需，已装） |
| Node.js | ✅ | v24.11.1 |
| CARGO_HOME / RUSTUP_HOME | scoop 托管 | `C:\Users\Lenovo\scoop\persist\rustup\...` |

> **结论：Tauri 2 的全部构建前置条件已满足。**

### 已修复：Rust 标准库损坏（`rust-std` 组件不自洽）

**原症状**：`rustc` 与 `cargo` **任何编译都失败**（与项目代码无关）：

```
error: only metadata stub found for `rlib` dependency `core`
       please provide path to the corresponding .rmeta file with full metadata
error: cannot resolve a prelude import
error: cannot find macro `println` in this scope
```

**根因（由 rustup 自己报出）**：toolchain 里 `libcore-<hash>.rlib` 存在，
但配套的 `libcore-<hash>.rmeta` **缺失**。rustup 的清单里记录了这个文件，
于是它**既认为组件是最新的、又无法卸载它**：

```
error: failure removing component 'rust-std-x86_64-pc-windows-msvc',
       directory does not exist: 'lib\rustlib\x86_64-pc-windows-msvc\lib\libcore-cf5ef8f9edb2b6bd.rmeta'
```

修复前 `lib/` 下是 **20 个 `.rmeta` vs 21 个 `.rlib`**（唯一缺口就是 `core`）。

**修复步骤**（已验证有效）：

```powershell
# 1) 补上 rustup 期望存在、实际缺失的占位文件，让它能完成卸载
$lib = "$(rustc --print sysroot)\lib\rustlib\x86_64-pc-windows-msvc\lib"
New-Item -ItemType File -Force -Path "$lib\libcore-cf5ef8f9edb2b6bd.rmeta"

# 2) 强制重装（国内建议加镜像，实测比官方快约 10 倍）
$env:RUSTUP_DIST_SERVER="https://mirrors.tuna.tsinghua.edu.cn/rustup"
$env:RUSTUP_UPDATE_ROOT="https://mirrors.tuna.tsinghua.edu.cn/rustup/rustup"
rustup toolchain install stable-x86_64-pc-windows-msvc --force
```

**修复后验证**：rustc 1.97.1 → **1.99.0**；`lib/` 下 **21 个 `.rmeta` + 21 个 `.rlib`**（配对完整）；
`rustc m.rs`、`cargo build` 均编译并运行成功。

> 📌 排查中排除的干扰项：rlib 归档本身合法（magic `!<arch>`，内含真实 2.23 MB x86-64 COFF）、
> MSVC/SDK 齐全、无 `RUSTFLAGS` 干扰、全新 target 目录同样复现。
> `rustup component add rust-std` 与 `rustup component add ... --force` **都无效**
> （前者报 "up to date"，后者该参数不存在），必须用上面的「补占位文件 + 重装 toolchain」。

### 另一个环境坑：cargo 本地 registry 索引过期（**会反复出现**）

修复工具链后，`tauri = "2"` 解析失败：

```
error: failed to select a version for the requirement `tauri-runtime-wry = "~2.12.1"`
candidate versions found which didn't match: 2.11.4, 2.11.3, 2.11.2, ...
```

**但 `tauri-runtime-wry 2.12.1` 在 crates.io 上确实存在**（2026/9/30 发布）——
是本地 sparse index 缓存停在 `2.11.4` 导致。加 `tray-icon`、`tauri-build` 时**又各犯一次**。

**修复**：删掉 `Cargo.lock` 后重新解析即可刷新索引（`cargo update` 会重新拉取）：

```powershell
Remove-Item Cargo.lock
cargo update               # 重新拉索引
cargo build
```

### Tauri 2 落地验证结果（✅ 全链路通过）

**不只是编译通过 —— 真实窗口 + 穿透 API 已实机跑通：**

| 项 | 实测结果 |
|---|---|
| 编译链接 | ✅ `cargo build --release` 成功 |
| **真实窗口创建** | ✅ 建出 `164×184` 透明无边框置顶窗口 |
| **穿透 API** | ✅ `set_ignore_cursor_events(true)` 调用成功（**穿透模式的核心原语可用**） |
| 运行 | ✅ 进程退出码 0 |
| **release 体积** | ✅ **8.17 MB**（真实带窗口应用，落在预估 5–12 MB 区间内） |
| 解析版本 | `tauri 2.12.1` / `tauri-runtime-wry 2.12.1` / `wry 0.57.0` / `windows 0.62.2` |
| 依赖规模 | 402 个 package |
| 工具链 | rustc/cargo **1.99.0** + MSVC 14.41 + Windows SDK 10.0.22621 |

**实测的窗口配置**（`tauri.conf.json` + builder，与设计一致）：

```rust
WebviewWindowBuilder::new(app, "pet", WebviewUrl::App("index.html".into()))
    .inner_size(164.0, 184.0)
    .decorations(false).transparent(true).always_on_top(true)
    .skip_taskbar(true).resizable(false).focused(false).shadow(false)
    .build()?;
w.set_ignore_cursor_events(true)?;   // ← 穿透模式
```

> **结论：两条硬约束的技术前提已全部具备，Tauri 2 方案已实机验证可行。**
> 另注：`tauri-build` 需要 `icons/icon.ico`（Windows 资源文件），缺失会直接构建失败 —— 建项目时先备好图标。

## 4. 美术资源清单（`assets/`，**实测 35 个 SVG**）

**全部矢量 SVG、透明底、平涂、零位图**。规格：`viewBox="0 0 64 64"`，图形占视框 ~90%。

| 系列 | 文件 | 数量 | 说明 |
|---|---|---|---|
| 幼崽 | `piglet.svg` | 1 | 2.7KB，已完成的基准图（**默认皮肤**） |
| 老年 | `elder.svg` | 1 | 3.0KB，**孤儿资源**（`test/core.test.js:168` 断言 elder 已删） |
| 肥猪 | `pig-fat.svg` + `-eat -bathe -play -pet -relaxed -work -study -trip` | 9 | 每张 2.2–3.0KB |
| 猪王 | `pig-king.svg` + 同上 8 个场景 | 9 | 每张 3.7–4.9KB |
| 恶魔猪 | `pig-devil.svg` + 同上 8 个场景 **+ `pig-devil-fly.svg`** | 10 | 每张 6.8–7.6KB，**fly 是额外的一张** |
| 薄荷皮肤 | `skin-mint.svg` + `-eat -play -pet -bathe` | 5 | 每张 2.7KB |

> ⚠️ **关键事实：`piglet` 只有 1 张图（idle），没有场景动作图。**
> `data/life.js:37` 的 `piglet` 只设了 `art: 'piglet'`，**没有 `actionArt: true`**，
> 所以 `client.js:2008-2019` 的 `syncPigArt()` 不会给它拼 `-eat/-bathe/...` 后缀。
> 全仓库**唯一拥有完整 10 场景套图的默认风格素材是 `pig-fat` 系列**。
> → 用户要的「只采纳需要的动作、其余重绘」正好对应这个缺口。

### 场景（scene）枚举
代码真值 `packages/pet-core/src/data/skins.js`：
```
SKIN_SCENES        = idle, eat, bathe, play, pet, relaxed, work, study, trip, fish   (10)
REQUIRED_SKIN_SCENES = idle, eat, bathe, play, pet                                   (前 5 必需)
```

### 内置皮肤表
```js
SKINS = [{ key:'mint', label:'薄荷小猪', emoji:'🌿', art:'skin-mint',
           scenes:[idle,eat,bathe,play,pet], custom:false }]
```
**注意：默认皮肤不在 `SKINS` 表里**，它是 `piglet` 系列，硬编码在渲染层。

### 风格锁定（`docs/ART-SPEC.md`）

| 部位 | 色值 |
|---|---|
| 身体 / 近侧腿 | `#FFD1AF` |
| 远侧后腿 | `#FF9FA5` |
| 鼻子 | `#FF8195` |
| 耳朵（圆头弧线） | `#E95892` |
| 眼睛 | `#373A32` |
| 腮红 | `#FFAFAC` |
| 尾巴 | `#FFD1AF` |

**四条不可违反规则**：① 侧面朝左 ② 平涂零描边 ③ 眼睛是不规则形状不是正圆 ④ 耳朵是圆头弧线不是填充三角。
禁止 `<image>` `<text>` 渐变 滤镜；背景必须透明。

### 图集（`.emoji/`）—— 线索
- `.emoji/noto.svg` → 内容只有一行 `404: Not Found`，**是一个占位/失效文件**
- `.emoji/openmoji.svg` → 3.0KB，OpenMoji 风格的猪 SVG（带黑色描边，viewBox `0 0 72 72`）

> **关于「谷歌猪」**：仓库内**没有**任何 Google/Noto 品牌字样的资源或引用（全库 grep
> `google|谷歌` 零命中）。唯一与 Google 生态相关的是失效的 `.emoji/noto.svg` 占位文件。
> 默认猪是**蜜桃色手绘猪**（`assets/piglet.svg`），风格自述为「蜜桃色的小猪，平涂无描边」。

## 5. 桌面外壳关键机制（轻量化 / 不打扰的现成答案）

`apps/desktop/main.js` + `renderer/shell.js` 已经解决了两个核心诉求：

1. **窗口不是全屏铺满，而是「贴合内容」**
   页面用**布局盒**（`offsetLeft/offsetTop` 逐级累加到 `body`）量出「猪+面板+气泡」的外接框，
   上报主进程；主进程把窗口调成那个尺寸再四周留 `WINDOW_PADDING = 16px`。
   - 刻意**不用 `getBoundingClientRect`**：呼吸/浮动动画只改 `transform`，`rect` 每帧抖动，
     在 Windows 上会退化成**每秒一次 `SetWindowRgn`**（明确写在注释里的性能坑）。
   - 上报按 `QUANTIZE_STEP = 4px` 分档，动画抖几像素不触发窗口改动。
   - 上报节流：`setInterval(tick, 120)` + `pointermove` / `pointerup`；`content` 变化才发。

2. **元素级点击区域（不是像素级！）**
   把所有可见节点的**布局盒**合并成一串互不重叠的矩形（两两相交就合并），
   作为 `shape` 上报 → 主进程设置窗口区域。
   ⚠️ **已修正的误解**：穿透只在**元素粒度**成立，**不是像素级**。
   `.dp-scene`（`src/client/css-base.js:90,98`）在展开态宽度 = `--panel-width`、高度 = `--scene-open`，
   `background:none` 完全透明，但**整块矩形都进入 shape** → 展开时其中约 90% 是
   全透明区域却**实实在在挡住桌面点击**。做新桌宠时必须解决这点（按实际绘制内容裁剪，或用子元素粒度）。

3. **拖动 = 移动窗口，不是移动页面元素**
   页面只把鼠标增量转给主进程（`moveBy(dx,dy)`），窗口跟着走。

4. **钉边（锚定）**
   面板开在猪的哪一侧 → 猪贴窗口哪两条边；用内容外接框反推 host 内边距，一次收敛。

以上是「不与全屏游戏冲突」「轻量化」两个诉求的**直接可复用实现**。

## 6. 玩法模块（待评估裁撤）

`packages/pet-core/src/core/` 的模块名即功能边界：
`activity` `care` `clock` `constants` `daily` `dex` `diary` `drops` `effects` `egg`
`evolution` `fishing` `growth` `illness` `interests` `inventory` `lines` `migrate`
`pomodoro` `profile` `random` `school` `settlement` `skins` `state` `travel`
`upgrades` `views` `weight` `work`

`data/` 数据表：`daily` `drops` `evolution` `fish` `growth` `illness` `interests`
`jobs` `life` `lines` `minutes` `pomodoro` `profile` `school` `shop` `skins` `traits`
`travel` `weight`

> **待用户明确的裁撤边界**：`school` `work` `travel` `fishing` `shop` `drops`
> `inventory` `settlement` `upgrades` `weight` 属于「娱乐玩法」；
> 而 `care`（喂食/洗澡/玩耍）`growth` `evolution` `illness` `daily` `diary`
> `pomodoro`（专注计时）是否保留需要用户判断。

## 7. 已知的性能/扰民风险点（需在方案中处理）

| 风险 | 证据 |
|---|---|
| 窗口区域重算 | `shell.js` 注释明确点名 `SetWindowRgn` 每秒一次的退化路径 |
| 轮询 | `setInterval(tick, 120)` 常驻定时器（≈8.3 次/秒） |
| 单文件巨石 | `client.js` 241KB，一次解析全部加载 |
| Electron 体积 | 外壳 + Chromium，安装包体量远大于「轻量化」预期 |
| 全屏冲突 | 仓库内**未见**全屏应用检测/自动隐藏逻辑（需 grep 确认） |
