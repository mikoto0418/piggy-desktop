# 第三方致谢与许可

本项目以 **MIT** 发布。下面列出它参考、依赖或提及的第三方内容。

## 设计参考

| 项目 | 许可 | 本项目的使用方式 |
|---|---|---|
| [CLICGGER-TYPES/dsh-piggy](https://github.com/CLICGGER-TYPES/dsh-piggy) | MIT | 参考其**功能点范围、玩法数值与数据表结构**；采纳其**小猪造型**作为默认皮肤的基础形象，并据此重绘了 5 个动作场景（吃 / 洗澡 / 玩 / 摸 / 累）。**未复制其代码**：本项目的 `app/src/core/` 与 `app/src-tauri/` 均为重写，且已按 D1–D17 决策做了大量删减与改造 |
| [xuemian168/qqpet_automation](https://github.com/xuemian168/qqpet_automation) | MIT（其原创部分） | 经 dsh-piggy 间接参考**属性阈值与物品名称**等事实性数值 |
| [guokaigdg/animal-island-ui](https://github.com/guokaigdg/animal-island-ui) | MIT | 经 dsh-piggy 间接参考**设计 token**（颜色、圆角、缓动）。本项目 UI 为独立设计，未沿用其界面结构 |

## 美术

- `app/src/assets/piglet.svg` 及由 `gen-scenes.py` 派生的
  `piglet-eat.svg`、`piglet-bathe.svg`、`piglet-play.svg`、`piglet-pet.svg`、`piglet-relax.svg`：
  原创矢量重绘，造型取自通用的 🐖 形象（侧视、卷尾、圆耳）。
  全部为纯路径 + 纯色填充，**无渐变、无滤镜、无位图、无描边**，单文件 2.7–3.3 KB。
- `app/src-tauri/icons/`：由上列 SVG 无头渲染导出的多尺寸图标（含 7 帧 `.ico`）。

## 运行时依赖

| 内容 | 许可 | 说明 |
|---|---|---|
| Tauri 2 / Wry / Tao | MIT / Apache-2.0 | 应用外壳 |
| `tauri-plugin-global-shortcut` | MIT / Apache-2.0 | 全局快捷键 |
| `tauri-plugin-single-instance` | MIT / Apache-2.0 | 单实例 |
| `tauri-plugin-autostart` | MIT / Apache-2.0 | 开机自启 |
| Microsoft Edge WebView2 Runtime | 微软最终用户许可 | 系统组件，不随本仓库分发 |

## 商标

「谷歌猪」是社区对 🐖 形象的俗称。本项目与 Google LLC、腾讯控股有限公司
均**无任何关联，亦未获其授权**。若权利人认为本仓库有不妥之处，请开 issue，作者会立即调整或下架。
