# 🐖 piggy-desktop · 谷歌猪桌宠

一个**轻量、不抢焦点、不和全屏游戏打架**的 Windows 桌面宠物。

桌面上的小猪会自己呼吸、眨眼、掉状态；你可以喂它、给它洗澡、陪它玩、摸摸它。
不想理它的时候，它可以**完全点击穿透**——鼠标直接穿过去点到下面的游戏里。

> 技术栈：**Tauri 2 + WebView2**，前端零框架（纯 DOM/CSS/SVG），核心逻辑是零依赖的纯 ESM 模块。

---

## ✨ 特性

### 桌面行为

| 能力 | 说明 |
|---|---|
| 三种模式 | **互动**（默认，可点）/ **穿透**（鼠标穿透到下层窗口）/ **隐藏** |
| 点击穿透 | Win32 `WS_EX_TRANSPARENT \| WS_EX_LAYERED` 成对设置，鼠标事件完全不进桌宠窗口 |
| 不抢焦点 | `WS_EX_NOACTIVATE` + `WS_EX_TOOLWINDOW`，点它不会把游戏/全屏应用切到后台，任务栏也不显示 |
| 悬停让位 | 鼠标**路过**（<600 ms）→ 淡到 35% 并立刻穿透；**停住**（≥600 ms）→ 恢复不透明、取消穿透、展开面板 |
| 全局快捷键 | 默认 `Ctrl+Alt+P`（切换穿透）/ `Ctrl+Alt+H`（切换显隐），可在设置里自定义，被占用时自动换备用键并在界面里提示 |
| 系统托盘 | 切换穿透 / 显隐 / 打开设置 / 退出，随时可用 |
| 设置窗口 | 独立普通窗口，改完即生效 |
| 开机自启 | 可选（默认关） |
| 位置记忆 | 拖动后记住坐标，重启回到原处，且保证不出屏 |
| 单实例 | 重复启动只会唤起已有实例（`--settings` 时直接开设置窗口） |

### 养成（无氪金、无战斗、无社交）

- **四维状态**：饱食 / 心情 / 清洁 / 健康，随时间自然衰减，健康随其余三项联动。
- **四个动作**：喂食、洗澡、玩耍、抚摸。每个货架都有**免费且不消耗的默认物品**，
  所以四个动作**永远可用**，不存在「卡死做不了事」。
- **对话气泡**：点击小猪说话，台词按状态挑，同一条不重复。
- **等级**：纯粹的展示数字（D10），不影响任何数值。
- **形态**：额外立绘形态（猪猪王 / 小猪恶魔），条件达成即可自由切换，**不锁死**（D11）。
- **皮肤**：皮肤 = **一套 6 色调色板**，运行时给基础 SVG 重新着色，**每个皮肤磁盘占用 0 字节**。

> 明确**不做**：疾病与死亡、打工 / 商店 / 旅行 / 钓鱼等娱乐玩法。
> 详见 [桌宠功能清单.md](桌宠功能清单.md) 的决策表 D1–D17。

### 轻量实测（本机 i7-14650HX / 31.8 GB / Win11 26100 / 2560×1600 @150%）

| 指标 | 实测 |
|---|---|
| release exe | **3.55 MB** |
| 常驻内存 | **111.9 MB** Private（7 进程，主要是 WebView2；P0 基线 106.9 MB） |
| 待机 CPU | 最小 0.52% / 中位 1.04% / 最大 2.60%（单核，主进程 0%） |
| 运行时网络请求 | **0**（0 个 TCP 连接） |
| 美术资源总量 | **18.0 KB**（6 个 SVG，预算 30 KB；加皮肤不会让它增长） |
| 冷启动到窗口可见 | 1.79 s |

---

## 📁 目录结构

```
piggy-desktop/
├─ app/
│  ├─ src/                     # 前端（桌宠窗口 + 设置窗口），零框架
│  │  ├─ index.html  main.js  pet.js  style.css
│  │  ├─ settings.html  settings.js  settings.css
│  │  ├─ assets/               # 6 个场景 SVG（piglet / eat / bathe / play / pet / relax）
│  │  └─ core/                 # 纯 ESM 领域模型，零依赖，可单独 node 跑
│  │     ├─ data/              # 数值表：life / lines / shop / growth / traits / evolution / skins
│  │     ├─ state.js  migrate.js  settlement.js  care.js  growth.js
│  │     ├─ skins.js  evolution.js  inventory.js  upgrades.js  effects.js  views.js
│  │     └─ selftest.mjs       # 226 项自检，node selftest.mjs
│  ├─ src-tauri/               # Rust 外壳
│  │  ├─ src/main.rs           # 窗口、托盘、单实例、鼠标轮询线程
│  │  ├─ src/overlay.rs        # WS_EX_* 样式与穿透切换
│  │  ├─ src/config.rs         # 配置读写 + 钳位
│  │  ├─ src/shortcuts.rs      # 全局快捷键 + 备用键
│  │  ├─ src/settings.rs       # 设置窗口
│  │  ├─ src/actions.rs  tray.rs  petstore.rs
│  │  ├─ capabilities/         # 按窗口最小权限
│  │  └─ icons/                # 猪图标（16/24/32/48/64/128/256 全尺寸 .ico）
│  ├─ gen-scenes.py            # 从 piglet.svg 派生 5 个动作场景
│  ├─ verify-scenes.py         # 无头 Edge 渲染 + 逐像素比对
│  ├─ verify-p0.ps1            # 穿透样式对 / 进程 / 内存 / 网络 验收
│  ├─ test-interaction.ps1     # 面板展开/收起、拖动、右键、缩放
│  ├─ test-hover-through.ps1   # 悬停让位三阶段
│  ├─ test-settings.ps1        # 设置窗口渲染与控件
│  ├─ test-autostart.ps1       # 开机自启开关
│  └─ make-shortcut.ps1        # 生成/刷新桌面快捷方式（猪图标）
├─ analysis/                   # 参考项目功能点拆解（A–F）
├─ 桌宠功能清单.md              # ★ 全部功能点 + 决策表 D1–D17
├─ 实施计划.md                  # 分阶段计划与实测记录
├─ P0-验收报告.md               # P0 验收数据
├─ PROJECT-REF.md              # 参考项目分析
├─ THIRD-PARTY.md              # 第三方致谢
└─ LICENSE                     # MIT
```

---

## 🔨 构建

**依赖**：Rust 1.99+、MSVC 生成工具、Windows SDK、WebView2 Runtime（Win11 自带）、Node.js（只用来跑自检）、Python + Pillow（只用来跑美术校验）。

```powershell
# 1) 核心逻辑自检（不需要编译 Rust）
cd app\src\core
node selftest.mjs            # ✅ 226 项检查

# 2) 美术校验（需要 Edge + Pillow）
python app\verify-scenes.py

# 3) 构建 release
Get-Process piggy-desktop -ErrorAction SilentlyContinue | Stop-Process -Force
cd app\src-tauri
cargo build --release        # → target\release\piggy-desktop.exe

# 4) 桌面快捷方式（猪图标）
powershell -NoProfile -File app\make-shortcut.ps1
```

## 🧪 验收探针

每个探针都是可重复执行的 PowerShell 脚本，自己拉起进程、读窗口样式、截图比对、退出：

```powershell
pwsh -NoProfile -File app\verify-p0.ps1            # 穿透样式对 / 内存 / 0 网络
pwsh -NoProfile -File app\test-interaction.ps1     # 互动模式
pwsh -NoProfile -File app\test-hover-through.ps1   # 悬停让位
pwsh -NoProfile -File app\test-settings.ps1        # 设置窗口
pwsh -NoProfile -File app\test-autostart.ps1       # 开机自启（需 --settings 启动）
```

## 🗺️ 进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 骨架 + 轻量化验收 | ✅ |
| P1 | 桌宠窗口、穿透、快捷键、托盘 | ✅ |
| P2-2/P2-3/P2-5/P2-6/P2-7 | 面板、气泡、设置窗口、悬停让位、缩放 | ✅ |
| P2-1 | 皮肤系统（调色板模型 + 设置界面选皮肤） | ✅ |
| P2-4 | 自定义导入（皮肤/形态共用一套格式） | ⬜ |
| P3 | NSIS 安装包 + 全屏检测（FSO） | ⬜ |

---

## 📜 许可

[MIT](LICENSE)。玩法数值、功能范围与部分美术参考
[CLICGGER-TYPES/dsh-piggy](https://github.com/CLICGGER-TYPES/dsh-piggy)（MIT），
详见 [THIRD-PARTY.md](THIRD-PARTY.md)。
