# B · 宠物本体与成长生命周期

> **任务**：`task-2`
> **分析对象**：`F:\piggy\_ref`（只读参考仓库 `CLICGGER-TYPES/dsh-piggy`，`--depth 1` 克隆）
> **路径约定**：本文所有 `文件:行号` 均为**相对 `F:\piggy\_ref`** 的路径。
> **取值原则**：数值一律给源码原值（含小数位），不做四舍五入概括；凡文档与源码冲突，以源码为准并在文中标注。
> **本轮结论不含任何实现代码**，仅供裁撤决策。

---

## 一、生命周期总览

### 1.1 一段话概括

猪是一个**纯函数状态机**：没有任何定时器，所有时间推进都由 `decay(state, nowMs)` 一次性惰性结算
（`packages/pet-core/src/core/settlement.js:45-71`，设计理由见 `docs/DESIGN.md:17`）。
生命的形状是**一条由等级驱动的形态阶梯**（`data/life.js:31-48`），而不是年龄阶梯——
`data/life.js:26-28` 的注释明确写了：**「形态按等级换，不按年龄（B2，用户 2026-10-01 确认）」**、
**「没有老年、没有寿命 —— 猪只会因为意外死掉」**。

### 1.2 状态机全图

```
                       ┌──────────────────────────────────────────────┐
                       │  layEgg(nowMs)   纸盒 state.hatched=false     │  core/egg.js:18-84
                       │  · 不吃不喝不老不病不死                        │  settlement.js:49-50
                       └───────────────┬──────────────────────────────┘
                    戳三下 / hatch()    │  client/constants.js:79 BOX_POKES_TO_OPEN=3
                                       ▼
        ┌───────────────────────────────────────────────────────────────┐
        │  hatched=true · xp=0 · stage='piglet' · sex 50/50 · 随机性格   │  core/egg.js:94-110
        │  weightG 1200 + 160 = 1360                                    │  constants.js:12,14
        └───────────────┬───────────────────────────────────────────────┘
                        │  decay() 每 5 分钟一步（SETTLE_STEP_MS）
      ┌─────────────────┼──────────────────────┬───────────────────────┐
      ▼                 ▼                      ▼                       ▼
  属性衰减         疾病风险 roll           疾病推进 progress        成长+变老
  drainBars        rollForIllness          progressIllness          growOlder
  settlement:108   settlement:124-128      settlement:135-150       settlement:156-164
      │                 │                      │                       │
      │                 ▼                      ▼                       ▼
      │          catchIllness(chain,1)   advanceIllness/worsen    grow(pigMs 折算)
      │          illness.js:127-137      illness.js:149-177       growth.js:52-67
      │                 │                      │                       │
      │                 │              ┌───────┴────────┐              ▼
      │                 │              ▼                ▼         Lv↑ 换形态/换称号
      │                 │         recover()         第4期链尾      clock.js:37-48
      │                 │         health=5 →        die()         life.js:31-48
      │                 │         回归健康           illness.js:34-45  73-81
      │                 │              │                │
      └─────────────────┴──────────────┴────────────────┴──────► 死亡分支
                                                                     │
                            ┌────────────────────────────────────────┘
                            ▼
                    GRAVE（墓碑 🪦 size 56）           life.js:61
                            │  离开 1 天
                            ▼
                    SOUL（灵魂 👻）                   life.js:63,66  hasSoul clock.js:121-122
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
       还魂丹 soul 800 🪙            领养 adopt() → 回到纸盒
       state.js:228-242              state.js:218-222
       复活保留形态，领养从头来        evolution.js:3-5 注释
```

### 1.3 三个「唯一入口」

| 唯一入口 | 位置 | 说明 |
|---|---|---|
| 时间推进 | `core/settlement.js:45` `decay()` | 全库唯一让时间流逝的函数（`docs/DESIGN.md:125`） |
| 经验增长 | `core/growth.js:52` `grow()` | 注释原文：「The only way `xp` should ever go up」 |
| 死亡 | `core/illness.js:34` `die()` | 只有疾病链走完 / 吃错药两种死法 |

宿主每读一次状态就跑一次 `freshen()`：`recordOnline → writeDiaryIfNewDay → decay → settlePomodoro → scheduleSave`
（`store/api.js:106-126`）。

---

## 二、生命阶段与成长

### 2.1 全部生命阶段（源码原值）

来源：`packages/pet-core/src/data/life.js:31-48`（`LIFE_STAGES`），墓碑/灵魂见同文件 `61-66`。

| # | key | label | emoji | `size`(px) | 触发条件 | `art` | 美术文件 | `line` |
|---|---|---|---|---|---|---|---|---|
| 0 | `box` | 纸盒 | 📦 | **58** | `hatched !== true`（`fromLevel: 0`, `box: true`） | —（无 art） | 无 | 一个纸盒，侧面戳了几个透气孔 |
| 1 | `piglet` | 幼年猪 | 🐖 | **54** | `fromLevel: 1`（孵化即 Lv1） | `piglet` | `assets/piglet.svg`（2.7KB） | 刚从纸盒里蹦出来，圆头圆脑 |
| 2 | `young` | 青年猪 | 🐖 | **60** | `fromLevel: 10` | **无** | **无专用 SVG，回落 emoji 🐖** | 长开了，走路带风 |
| 3 | `middle` | 成年猪 | 🐖 | **68** | `fromLevel: 40` | **无** | **无专用 SVG，回落 emoji 🐖** | 很有分量，会一屁股坐住你的椅子 |
| — | `grave` | 墓碑 | 🪦 | **56** | `state.dead === true` | — | 无（emoji） | 这里躺着一只猪 |
| — | `SOUL` | 灵魂 | 👻 | — | 死后 `SOUL_AFTER_DAYS = 1` 天 | — | 无（emoji） | — |

**关键事实（对裁撤很重要）**：

1. **只有 `piglet` 有立绘**。`young`(60px) / `middle`(68px) 都**没有 `art` 字段**，
   客户端 `src/client/art.js:20-21` 遇到空 `data-art` 直接 `return`，退回 `src/client/scene.js:82` 的 emoji `🐖`。
   `src/client/scene.js:76-77` 注释原文：「Drawn stages (the piglet, the elder pig) use an `<img>`; the rest fall back to the emoji.」
   → **「猪长大了变样子」这件事，代码里只有尺寸 + emoji 变大，没有换图。**
2. **`assets/elder.svg`（3.0KB）是孤儿资源**：`LIFE_STAGES` 里没有 `elder`，
   `test/core.test.js:168` 明确断言 `LIFE_STAGES.some(s => s.key === 'elder') === false`，
   `core/migrate.js:82` 把老存档的 `elder` 改写成 `middle`。该文件在运行期**零引用**。
3. **形态阶梯只有 3 级正身**（piglet/young/middle），最高级在 Lv40，之后不再变化
   （`test/core.test.js:166-167` 断言 Lv600 仍是 `middle`）。
4. **`size` 唯一约束**：`test/core.test.js:169-171` 断言没有两个阶段共享 size。

### 2.2 等级 / 称号

| 项 | 原值 | 证据 |
|---|---|---|
| 满级 | `MAX_LEVEL = 60` | `data/growth.js:15` |
| 曲线系数 | `GROWTH_CURVE_K = 122` | `data/growth.js:18` |
| 升级公式 | `xpForLevel(L) = L <= 1 ? 0 : 122 × L²` | `data/growth.js:25` |
| 等级求解 | `while (level < 60 && xp >= xpForLevel(level+1)) level += 1` | `core/clock.js:86-91` |
| 进度条 | `percent = round((xp - floor) / (ceiling - floor) × 100)`，满级恒 100 | `core/clock.js:101-118` |

**数值样本（源码原值 + 测试交叉验证）**：

| 等级 | `xpForLevel` | 满照顾下所需天数（100/小时） | 交叉验证 |
|---|---|---|---|
| Lv1 | `0` | 0 | `test/growth.test.js:30` |
| Lv10 | `12_200` | **≈ 5.08 天** | `test/growth.test.js:31`；`test/core.test.js:176-177` |
| Lv40 | `195_200` | **≈ 81.3 天 ≈ 2.7 个月** | `test/growth.test.js:32` |
| Lv60 | `439_200` | **≈ 183 天 ≈ 6 个月** | `test/growth.test.js:33,36` |

**称号表**（`data/life.js:73-81`，`levelTitle()` 取最后一个满足 `level >= entry.level` 的项，`core/clock.js:94-98`）：

| level | label | emoji |
|---|---|---|
| 1 | 新来的 | 🌱 |
| 5 | 熟面孔 | 🙂 |
| 10 | 老伙计 | 🤝 |
| 20 | 镇宅之猪 | 🏠 |
| 35 | 十里八乡有名 | 📣 |
| 50 | 传说 | 🌟 |
| **80** | **神话** | **👑** |

> ⚠️ **源码不一致（可裁撤的无效数据）**：`MAX_LEVEL = 60`（`data/growth.js:15`），
> 但称号表最后一项是 **Lv80**（`data/life.js:80`）——**「神话」称号永远不可达**。

> ⚠️ **同仓库两处注释互相矛盾**：`core/constants.js:20-29` 的注释仍在描述旧阶梯
> （「7 minutes to 小猪崽, 40 minutes to 圆滚猪, an afternoon to 大猪猪, a few days to 猪皇,
> a week or so to 猪王, … 野猪王」），这些名字在现行 `LIFE_STAGES` 里**全部不存在**。
> 该注释块紧贴在空的文档注释之后（第 20-21 行是悬挂的 `/** Growth ladder, ascending by xp. */`），
> 属于 B2 改版后的残留。

### 2.3 成长的三个来源 + 系数

**来源 1：时间（被动，主来源）**

```js
// core/growth.js:88-90
growWithTime(state, pigMs, atMs):
  grow(state, (pigMs / 3_600_000) × GROWTH_PER_HOUR × careFactor(state), atMs)
```
- `GROWTH_PER_HOUR = 100`（`data/growth.js:28`）
- `pigMs = elapsedMs × timeScale`（`core/settlement.js:156-163`）

**来源 2：陪主人真实干活（被动，有日上限）**
- `DSH_GROWTH = { turn: 3, tool: 1 }`（`data/growth.js:51`）——注意 `message` / `toolError` / `agentError` **不给成长**
- `DSH_GROWTH_DAILY_CAP = 300`（`data/growth.js:54`）
- 日界按 06:00 切（`core/growth.js:102` + `core/clock.js:74-79`）
- 事件接线：`index.js:41-48`（`agent/inbox/claimed`→message、`agent/turn-stopping`→turn、`agent/error`→agentError、`tools/result`→tool/toolError）
- 交叉验证：连发 200 个 `turn` 后 `xp === 300`；次日 06:10 再发 `tool` 得 +1（`test/growth.test.js:61-74`）

**来源 3：外出活动（娱乐向，见第九节）**
- `WORK_GROWTH_PER_HOUR = 25`（`data/growth.js:57`），`outingGrowth(minutes) = round(minutes/60 × 25)`（`core/growth.js:110`）
- `STUDY_GROWTH_PER_LESSON = 40`（`data/growth.js:60`）
- `GRADUATION_GROWTH = 500`（`data/growth.js:63`）

**`careFactor` 完整公式**（`core/growth.js:34-43`）：

| 条件 | 系数 | 源码 |
|---|---|---|
| `happiness >= 70` | `1` | `data/growth.js:35` |
| `happiness >= 50` | `0.9` | `data/growth.js:36` |
| `happiness >= 30` | `0.7` | `data/growth.js:37` |
| `happiness >= 0` | `0.5` | `data/growth.js:38` |
| `satiety < 25` **或** `cleanliness < 35` | `× 0.7`（两者同时只算一次） | `data/growth.js:42`；`core/growth.js:37` |
| 生病中 | `× max(0, 1 - (5 - health) × 0.15)` | `data/growth.js:45`；`core/growth.js:38-41` |
| 总下限 | `MIN_GROWTH_FACTOR = 0.1` | `data/growth.js:48`；`core/growth.js:42` |

交叉验证（`test/growth.test.js:47-58`）：`{}`→1；`happiness:60`→0.9；`happiness:40`→0.7；
`happiness:10`→0.5；`satiety:10`→0.7；`cleanliness:10`→0.7；`satiety:10,cleanliness:10`→0.7；
`happiness:60,satiety:10` → **每小时 63**（0.9×0.7×100）；
理论上最惨 `happiness:0,satiety:0,health:1,生病` → **0.14**（0.5×0.7×0.4，注释说「10% 下限只是保险」）。

### 2.4 阶段推进：**按累计成长值，不按真实天数**

- `lifeStageFor()` 只读 `levelFor(state.xp)`，**完全不看 `ageMs` / `bornAt`**
  （`core/clock.js:37-48`，`data/life.js:35-36` 注释「The body follows the level, not the calendar」）
- `nextLifeStage()` 返回下一个 `fromLevel > level` 的非 box 阶段，已成年返回 `null`（`core/clock.js:51-55`）
- `daysToNextStage()` = `剩余 xp / GROWTH_PER_HOUR / 24`（`core/clock.js:61-66`）——**面板上的估算值**，不是承诺
- **年龄另有独立字段**：`state.ageMs` 是「猪时间」累计（真实耗时 × `timeScale`），
  `ageDays = ageMs / 86_400_000`（`core/clock.js:20-28`），`ageMonths = ageDays / 30`（`DAYS_PER_MONTH = 30`，`data/life.js:11`）。
  **结论：年龄只做显示，不参与任何判定。**

**时间倍率**（调试用，`data/life.js:54-57`）：

| 常量 | 原值 |
|---|---|
| `DEFAULT_TIME_SCALE` | `1` |
| `TIME_SCALES`（面板预设） | `[1, 12, 30, 60]` |
| 合法范围 | `> 0` 且 `<= 365`（`core/state.js:59-65`） |

倍率只影响**未来**：`ageMs` 存的是累计猪时间，改倍率不会让猪凭空变老（`core/clock.js:14-18` 注释）。

### 2.5 性别

`SEXES`（`data/growth.js:69-72`）：`boy` 男孩 ♂ / `girl` 女孩 ♀。
拆纸盒时 50/50 定下：`pickSex = roll(state) < 0.5 ? 'boy' : 'girl'`（`core/egg.js:130`），
在 `hatch()`（`core/egg.js:99`）与 `hatchEgg()`（`core/egg.js:115`）各调一次。
老存档补性别走 `migrate()`（`core/migrate.js:81`）与 v9 升级（`core/upgrades.js:105-107`）。

---

## 三、核心数值表（stats）

### 3.1 三维 + 健康

上限：`MAX = { satiety: 100, happiness: 100, cleanliness: 100, health: 5 }`（`data/life.js:8`）。
注释原文：**「`health` keeps QQ Pet's 5-point scale」**。

| 属性 | 中文 | 含义 | 初始值（`layEgg`） | 上下限 | 自然衰减 / 分钟 | 衰减 / 小时 | 归零/触限后果 |
|---|---|---|---|---|---|---|---|
| `satiety` | 饱食 | 饿不饿 | **70**（`core/egg.js:44`） | `0–100` | **`0.08`** | **`4.8`** | `< 25` → 心情「饿了」+ 成长 ×0.7 + 每小时 3% 感冒风险 |
| `happiness` | 心情 | 开不开心 | **70**（`core/egg.js:45`） | `0–100` | **`0.06`** | **`3.6`** | `< 35` → 「有点孤单」；`< 30` → 每小时 5% 头晕风险；`< 70/50/30` 拖慢成长 |
| `cleanliness` | 清洁 | 脏不脏 | **90**（`core/egg.js:46`） | `0–100` | **`0.07`** | **`4.2`** | `< 35` → 「该洗澡了」+ 成长 ×0.7 + 3% 咳嗽风险；`< 15` → 改判皮肤链 |
| `health` | 健康 | 生死刻度 | **`MAX.health` = 5**（`core/egg.js:47`） | `0–5` | 无自然衰减，**只由疾病链改写** | — | `<= 1` 不能出门（`TOO_WEAK_HEALTH`）；`0` → 死亡 |

衰减常量位置：`SATIETY_DECAY_PER_MIN = 0.08`（`core/constants.js:77`）、
`HAPPINESS_DECAY_PER_MIN = 0.06`（`:79`）、`CLEANINESS_DECAY_PER_MIN = 0.07`（`:81`）。
`data/weight.js:5` 的注释 `4.8 satiety lost hourly` 与 0.08×60 一致。

**时间单位**：`drainBars()` 收到的单位是**分钟**（`core/settlement.js:96` `elapsedMs / 60000`）；
成长按**小时**；年龄按**猪毫秒**。三者不可混用。

**外出加速**（`drainBars`，`core/settlement.js:108-117`）：

| 常量 | 原值 | 效果 |
|---|---|---|
| `AWAY_DECAY_MULTIPLIER` | **`1.4`** | 外出期间衰减 ×1.4（`core/constants.js:83`，用于 `settlement.js:109`） |
| `AWAY_FLOOR` | **`15`** | 单次外出**不允许把任何一条压到 15 以下**；外出也**不会抬高**数值（`core/constants.js:85-86`，`settlement.js:110-113`） |

> ⚠️ **死代码**：`data/illness.js:50` 有 `AWAY_MULTIPLIER = 1.8`，被 `core.js:24` import 进来，
> 但 `core.js:95-96` 的 re-export 列表里**没有它**，全库**没有任何地方使用**（grep 仅 3 处命中：定义、
> core.js 的 import、无）。真正生效的是 `AWAY_DECAY_MULTIPLIER = 1.4`。
> `docs/DESIGN.md:128` 与 `docs/DESIGN.md:130` 也仍在写「外出时 ×1.8」「每 25 分钟一期」，**均为过期文档**。

**归零后果汇总**：
- `satiety = 0` / `cleanliness = 0` → **不会死**，只降成长速度并持续挂疾病骰子
- `happiness = 0` → 同上，且 `happiness < 30` 时每小时 5% 头晕
- `health = 0` → `die()`（`core/illness.js:37`），且 `migrate` 会把 `health <= 0` 的存档强制标死（`core/migrate.js:78`）

### 3.2 体重与体型（C7）

| 项 | 原值 | 证据 |
|---|---|---|
| `BIRTH_WEIGHT_G` | **`1200`** | `core/constants.js:12` |
| `HATCH_WEIGHT_G` | **`160`** | `core/constants.js:14`（孵化时 `weightG += 160`，`core/egg.js:106`） |
| 孵化后体重 | **`1360`** | `1200 + 160 = 1360`，正好等于 `WEIGHT_RULES.baseG`（`data/weight.js:4`） |
| 下限（`applyEffects` 强制） | **`400`** | `core/effects.js:77` `Math.max(400, ...)` |

`WEIGHT_RULES`（`data/weight.js:3-14`）：

| key | 原值 | 含义 |
|---|---|---|
| `baseG` | `1360` | 理想体重基线 |
| `growthGPerXp` | `90 * 4.8 / 22 / 100` = **`0.19636363…`** | 每点成长涨多少克 |
| `roundRatio` | `1.3` | 圆润门槛 |
| `fatRatio` | `1.6` | 胖胖门槛 |
| `fatSizeMultiplier` | `1.5` | 胖胖立绘尺寸放大倍数 |
| `playLoss` | `0.03` | 每次玩耍减掉 3% 超出部分 |
| `playsPerDay` | `10` | 每天最多 10 次「有效运动」 |
| `workLossPerHour` | `0.03` | 打工每小时减 3% 超出部分 |
| `dailyLoss` | `0.02` | 自然代谢每天减 2% 超出部分（含离线） |

- `idealWeightG = round(1360 + min(xp, xpForLevel(60)) × growthGPerXp)`（`core/weight.js:8-12`）
  → Lv60 理想体重 ≈ **87.6 kg**；圆润线 ≈ 113.9 kg；胖胖线 ≈ 140.2 kg
- `bodyWeightClass()`（`core/weight.js:15-21`）：`>= ideal×1.6` → `fat`；`>= ideal×1.3` → `round`；否则 `normal`
- `visible` 仅当 **`fat` + `form == null` + 默认皮肤** 三者同时成立（`core/weight.js:86-93`）
  → 此时立绘换成 `pig-fat`，尺寸 `× 1.5`（`core/weight.js:105-114`）
- 玩耍记次按天，日界 06:00（`core/weight.js:44-55` + `core/clock.js:74`）

### 3.3 其它标量

| 字段 | 初始值 | 证据 |
|---|---|---|
| `coins` | **`500`** | `core/egg.js:50`（注释：`60` 起家时买不起最便宜的药，改 500） |
| `xp` | `0` | `core/egg.js:42` |
| `outingStreak` | `0` | `core/egg.js:66` |
| `restMinutes` | `0` | `core/egg.js:67` |
| `lastFedAt` | `0` | `core/egg.js:68` |
| `name` | `'猪猪'` | `core/egg.js:20`；改名上限 **16 字**（`core/state.js:248-253`） |
| `stage` | `'box'` | `core/egg.js:28` |
| `skin` | `'default'` | `core/egg.js:31` |
| `traits` | `{ intel: 0, charm: 0, strong: 0 }` | `core/egg.js:57` |
| `MEMORY_LIMIT` | **`8`** | `core/constants.js:16` |
| `PENDING_LIMIT` | **`6`** | `core/constants.js:18` |

**开发模式可设范围**（`DEV_NUMBERS`，`core/state.js:91-99`）：
`satiety [0,100]`、`happiness [0,100]`、`cleanliness [0,100]`、`health [0,5]`、
`coins [0, 1_000_000]`、`xp [0, 10_000_000]`、`weightG [400, 500_000]`。

### 3.4 三维特质 traits

`data/traits.js:36-42`：

| key | label | emoji | 初始值 |
|---|---|---|---|
| `intel` | 智力 | 🧠 | `0` |
| `charm` | 魅力 | ✨ | `0` |
| `strong` | 武力 | 💪 | `0` |

`TRAIT_ORDER = ['intel', 'charm', 'strong']`（`data/traits.js:42`）。

**唯一作用 = 打工报酬加成 + 形态门槛**（裁撤结论：**属娱乐**，见 §9.4 #59）：

| 常量 | 原值 | 证据 |
|---|---|---|
| `TRAIT_PAY_PER_POINT` | **`1 / 150`** | `data/traits.js:15`（注释：150 点翻倍；曾是 1/15，2026-10-01 砍到十分之一） |
| `TRAIT_PAY_CAP` | **`3`**（最多三倍） | `data/traits.js:19` |
| `TRAIT_SPEED_PER_POINT` | **`0`**（已废弃） | `data/traits.js:22` |
| `TRAIT_SPEED_CAP` | `0.5` | `data/traits.js:24` |
| `traitBonus(trait, points)` | `{ pay: min(3, 1 + n × 1/150), minutes: max(0.5, 1 - n × 0) }` | `data/traits.js:27-33` |

数量：只有 **3 维**（`core/egg.js:57`、`core/migrate.js:113-121` 白名单清洗）。
来源：上课（`core/settlement.js:256-259`，主属性 + 可选副属性）、兴趣班（`core/settlement.js:188`）。
展示：`traitView()` 恒返回三维（`core/views.js:15-19`）。

### 3.5 玩家档案 profile（居民卡）

`data/profile.js` + `core/profile.js`。**纯身份信息，无任何数值作用**（裁撤结论：**陪伴**，见 §9.4 #58）。

**6 种性格**（`data/profile.js:20-27`，拆纸盒时随机一种，`core/profile.js:19-24`）：

| key | label | emoji | 默认口头禅 | 默认签名 |
|---|---|---|---|---|
| `peppy` | 元气 | 🌟 | 嘿嘿 | 今天也要元气满满！ |
| `lazy` | 悠闲 | 😴 | 呼噜 | 能躺着，绝不坐着。 |
| `cranky` | 暴躁 | 😤 | 哼 | 别惹我，除非你带了吃的。 |
| `sisterly` | 大姐姐 | 💁 | 懂吗 | 有事找我，我罩着你。 |
| `snooty` | 自恋 | 💅 | 啧啧 | 我是这片最可爱的猪。 |
| `normal` | 普通 | 🙂 | 嗯嗯 | 平平淡淡才是真。 |

**其它档案常量**：

| 常量 | 原值 | 证据 |
|---|---|---|
| `CATCHPHRASE_MAX` | **`6`** 字 | `data/profile.js:32` |
| `MOTTO_MAX` | **`24`** 字 | `data/profile.js:35` |
| `CATCHPHRASE_CHANCE` | **`0.4`** — 猪说话时句末带口头禅的概率 | `data/profile.js:38` |
| `SERIOUS_SCENES` | `['death', 'sick', 'wrongMedicine']` 不带口头禅 | `data/profile.js:41` |
| `ZODIAC` | **12 星座**，按起始月日（1/20 水瓶 → 12/22 摩羯） | `data/profile.js:47-60` |

**`profileView()` 输出**（`core/profile.js:79-102`）：
`personality`（三字段）、`catchphrase`、`motto`、`birthday`（`M月D日`）、`zodiac`、
`counts: { days（向下取整天数）, certificates, souvenirs, graduations }`。
- `certificates` = 兴趣课次数 `>= CERTIFICATE_AFTER = 5`（`core/profile.js:88`；`data/interests.js:14`）
- `graduations` = 每门课跨过 `GRADUATION_LESSONS = [9, 20, 40, 95]` 的次数求和（`core/profile.js:86-87`）

**口头禅拼接规则**（`core/lines.js:46-54`）：非严肃场景 + 台词不以 `（` 开头 + 台词里还没出现该口头禅 +
`chance(0.4)` → `「好舒服…」` 变成 `「好舒服，呼噜…」`（把句末标点留在最后）。

**改档案**：`setCatchphrase()` / `setMotto()`（`core/profile.js:45-60`），超长按**字符**截断
（`Array.from(raw)`，`core/profile.js:39-42`），空串返回 `{ ok:false, reason:'empty' }`。

---

## 四、照顾与互动

### 4.1 四个主动动作（源码原值）

来源：`packages/pet-core/src/core/constants.js:49-70`（`ACTIONS`）、`72`（`ACTION_ORDER`）。

| action | label | emoji | verb（记忆文本） | `cooldownMs` | `satiety` | `happiness` | `cleanliness` | `weightG` |
|---|---|---|---|---|---|---|---|---|
| `feed` | 喂食 | 🍎 | 吃了一口 🍎 | **`0`** | **`+22`** | **`+6`** | **`0`** | **`+90`** |
| `bathe` | 洗澡 | 🛁 | 洗了个澡 🛁 | **`0`** | **`-2`** | **`+8`** | **`+50`** | `0` |
| `play` | 玩耍 | 🎾 | 玩了一会儿 🎾 | **`0`** | **`-5`** | **`+16`** | **`-4`** | **`+4`** |
| `pet` | 摸摸 | ❤️ | 被摸了摸头 ❤️ | **`0`** | `0` | **`+10`** | `0` | `0` |

**冷却全部为 0**。源码注释（`core/constants.js:53-55`）原文：
> 「No cooldown (owner, 2026-10-01): every bite already costs a food item,
> and feeding a full pig risks a stomach ache (B3) — that is the brake.」

**物品货架绑定**（`data/shop.js:127` `CARE_KIND`）：

| action | 货架 kind | 物品来源 |
|---|---|---|
| `feed` | `food` | `data/shop.js:47-56`（10 种，价格 6–130） |
| `bathe` | `bath` | `data/shop.js:62-69`（8 种，价格 6–78） |
| `play` | `toy` | `data/shop.js:71-80`（10 种，价格 22–260）**+ 免费默认球** |
| `pet` | **无货架** | 免费（`core/care.js:78-79`：`shelf === undefined` → 不扣物品） |

**默认玩具**（`data/shop.js:10-13`）：
`{ key:'ball', label:'小皮球', emoji:'🎾', price:0, kind:'toy', happiness:12, satiety:-3, default:true }`
→ 由 `careItems()` 拼在最前（`data/shop.js:155-158`）；
`default:true` 的物品**永不消耗**（`core/care.js:84-89`）。
交叉验证：`careView(pig).play` 顺序为 `['ball','yoyo']`（`test/core.test.js:345-353`）。

**食品/洗浴/玩具原值表**（`data/shop.js:47-80`，节选关键项，**注意食品自带 `cleanliness` 惩罚**）：

| kind | key | label | price | satiety | happiness | cleanliness |
|---|---|---|---|---|---|---|
| food | `apple` | 苹果 🍎 | 6 | +22 | +3 | — |
| food | `bone` | 肉骨头 🍖 | 15 | **+45** | +8 | **-4** |
| food | `cake` | 奶油蛋糕 🎂 | 40 | +80 | +18 | **-8** |
| food | `noodle` | 大碗拉面 🍜 | 66 | **+100** | +26 | **-6** |
| food | `feast` | 豪华大餐 🍱 | 130 | **+100** | +34 | **-10** |
| bath | `soap` | 香皂 🧼 | 6 | — | +2 | **+35** |
| bath | `bubble` | 泡泡浴 🛁 | 28 | — | +14 | **+100** |
| bath | `sauna` | 泡温泉 🧖 | 58 | **-8** | +24 | +100 |
| toy | `yoyo` | 悠悠球 🪀 | 30 | -4 | +22 | — |
| toy | `carousel` | 旋转木马 🎠 | 260 | -12 | **+80** | -8 |

交叉验证：`satiety=10` 喂 `bone`(45) → `55`（`test/core.test.js:326-334`）。

**物品数值如何覆盖动作基线**（`core/care.js:127-135` `careEffects`）：

```js
{
  weightG:    item.satiety !== undefined && spec.key === 'feed' ? spec.weightG : 0,
  satiety:    item.satiety     ?? spec.satiety,
  happiness:  item.happiness   ?? spec.happiness,
  cleanliness:item.cleanliness ?? spec.cleanliness,
}
```
→ **物品提及的维度用物品的值，没提的用动作基线；`weightG` 永远用动作基线的 90g（只要喂的是食物）。**

### 4.2 `act()` 的完整拒绝链（对应 react-refuse）

来源：`core/care.js:64-107`。**按顺序判定，命中即返回**：

| 序 | 条件 | 返回值 | 客户端话术（`src/client/io.js:57-84`） | 触发 refuse 动画 |
|---|---|---|---|---|
| 1 | `ACTIONS[action]` 不存在 | `{ ok:false, reason:'unknown' }` | 兜底「这个操作没成」 | ✅ |
| 2 | `state === null` | `{ ok:false, reason:'absent' }` | 兜底 | ✅ |
| 3 | `state.hatched !== true` | `{ ok:false, reason:'box' }` | **「先把纸盒拆开」**（`io.js:58`） | ✅ |
| 4 | — | （先跑 `decay(state, nowMs)` 再继续） | — | — |
| 5 | `state.dead === true` | `{ ok:false, reason:'dead' }` | **「它已经走了…」**（`io.js:75`） | ✅ |
| 6 | `state.activity !== null && action !== 'pet'` | `{ ok:false, reason:'away' }` | **「它在外面」**（`io.js:67`） | ✅ |
| 7 | `actionCooldownSeconds > 0` | `{ ok:false, reason:'cooldown', wait }` | 「还要等 N 秒」（`io.js:65`）——**当前永不触发，全部 `cooldownMs:0`** | ✅ |
| 8 | 货架无可用物品 | `{ ok:false, reason:'no-item', kind }` | 按 kind 给专门文案（`io.js:45-49` + `client/constants.js:85-89`） | ✅ |

> **`pet` 是唯一能在「外出」状态下执行的动作**（第 6 条显式放行 `action !== 'pet'`）。
> 这是「陪伴感」最强的一条设计：猪在外面，你仍然可以摸摸它。

**空货架文案**（`src/client/constants.js:85-89`）：
`food` → 「没有吃的啦，快去买一点 🍎」；`bath` → 「没有洗浴用品了，去买点吧 🧼」；`toy` → 「没有玩具了，去商店看看 🪀」。

### 4.3 `react-refuse` 的完整触发点

| 触发点 | 条件 | 时长 | 证据 |
|---|---|---|---|
| 动作被拒 | 响应 `ok === false`，**且 reason 不是 `stale-line` 也不是 `silent`** | `520ms` | `src/client/io.js:38-44`（两个豁免见 `:41` `:43`） |
| 网络失败 | `fetch` 抛异常 | `520ms` | `src/client/io.js:86-88` |
| 召回外出 | `calloff` 特效定义 | `520ms`，粒子 `💨` ×1，台词「提前回来了…」 | `src/client/effects.js:114` |
| 死亡公告 | `event.kind === 'death'` | **`700ms`** | `src/client/panel.js:343` |
| CSS 实现 | `.dp-pig[data-react="refuse"]` → `dp-shake` | `.5s` | `src/client/css-base.js:168` |
| 打包副本 | 同上四处已被打进 `client.js` | — | `client.js:1276, 2106, 2301, 2346, 4215` |

> ⚠️ **美术缺口**：`docs/ART-SPEC.md:99` 把 `react-refuse.svg`（「操作被拒绝：扭头、闭眼、耳朵往后」）
> 列为待办选项，但 `assets/` 实际的 **35 个 SVG 里没有这个文件**（已全量确认）。
> 顺带修正 `PROJECT-REF.md:42` 的统计：`assets/` 实为 **35 个 SVG**（多出的是
> `pig-devil-fly.svg`；`PROJECT-REF.md:52` 把恶魔猪场景数记为 8，实为 9）。
> 也就是说：**拒绝时只有 emoji 猪在抖，没有专门立绘**。

`silent` 豁免的来源：`core/lines.js:100-103`（没孵化 / 死了 / 免打扰 / 外出 / 生病 → `{ok:false, reason:'silent'}`）。
`stale-line` 的来源：`core/lines.js:82`（回复了已经翻页的气泡）。

### 4.4 被动投喂 `feed()`（吃主人的真实工作）

来源：`core/care.js:29-48`。**注意与主动 `act(state,'feed',...)` 是两个完全不同的入口**。

`DIET` 表（`core/constants.js:41-47`）：

| event | satiety | happiness | weightG | 成长（`DSH_GROWTH`） | 触发事件 |
|---|---|---|---|---|---|
| `message` | `+1` | `+1` | `+6` | — | `agent/inbox/claimed` |
| `turn` | `+2` | `+1` | `+14` | **+3** | `agent/turn-stopping` |
| `tool` | `+2` | `0` | `+9` | **+1** | `tools/result`（`isError !== true`） |
| `toolError` | `0` | `+1` | `+2` | — | `tools/result`（`isError === true`） |
| `agentError` | `0` | `0` | `+2` | — | `agent/error` |

**纸盒不吃**：`if (state.hatched !== true) return []`（`core/care.js:43`），
但统计数据照记（第 35-41 行先加 `stats` 再判孵化）。
源码注释（`core/constants.js:33-39`）：一个工具调用曾经值 3 点，一下午 2232 XP = 整个猪的 94%，
现在「Passive work is now a trickle; the activities are where the growth is」。

### 4.5 摸摸 / 左键交互

| 交互 | 行为 | 证据 |
|---|---|---|
| 左键猪身 | 摸摸（`pet`） | `docs/guides/gameplay.md:6`；`src/client/constants.js:74` `MODES=['feed','bathe','play','pet']` |
| 摸摸台词池 | 10 句 | `src/client/constants.js:69-72`（好舒服…／再摸摸～／…／再多待一会儿） |
| 右键 | 开/收主菜单 | `docs/guides/gameplay.md:4` |
| 拖动 | 移动窗口 | `docs/guides/gameplay.md:7` |
| 纸盒三连戳 | 开盒 | `src/client/constants.js:79` `BOX_POKES_TO_OPEN = 3`；提示语 `:80-83` |

### 4.6 台词系统（陪伴感的核心载体）

`LINES` 场景表共 **24 个场景**（`data/lines.js:55-214`，`LINE_SCENES` 在 `:214`）：

| 分类 | 场景 key | 行号 |
|---|---|---|
| 照顾 | `eat` `overfull` `bathe` `play` `pet` | `data/lines.js:57,65,70,77,84` |
| 状态 | `hungry` `dirty` `lonely` `idle` | `:94,99,104,109` |
| 娱乐向 | `workDone` `tired` `study` `graduate` `tripBack` | `:120,125,130,135,140` |
| 疾病 | `sick` `wrongMedicine` `cured` | `:146,151,156` |
| 成长 | `levelup` `growUp` | `:162,167` |
| 生命 | `enter` `death` `revive` | `:172,177,181` |
| 娱乐向 | `signIn` `gift` | `:187,191` |
| 番茄钟 | `pomodoroStart` `pomodoroDone` `pomodoroAbandon` | `:196,201,206` |

其它台词常量：

| 常量 | 原值 | 证据 |
|---|---|---|
| `OWNER_TOKEN` | `'[主人]'` | `data/lines.js:13` |
| `DEFAULT_OWNER_NAME` | `'主人'` | `:16` |
| `OWNER_NAME_MAX` | `12` 字 | `:19` |
| `REPLY_HAPPINESS` | **`+3`** 心情／次，每句只算一次 | `:22`；`core/lines.js:86` |
| `IDLE_CHAT_MINUTES` | `{ min: 20, max: 40 }` | `:25`；客户端副本 `src/client/constants.js:17` |
| `WELCOME_BACK_AFTER_MINUTES` | **`30`** 分钟 | `:28`；`core/lines.js:105` |
| 口头禅概率 | `CATCHPHRASE_CHANCE = 0.4` | `data/profile.js:38` |
| 不带口头禅的场景 | `SERIOUS_SCENES = ['death','sick','wrongMedicine']` | `data/profile.js:41` |

**主动搭话规则**（`core/lines.js:99-116`）：
`enter`（离开 ≥30 分钟回来）→ 场景固定 `enter`；`idle` → 按 **饿 → 脏 → 孤单 → idle** 优先级挑场景。
静默条件：没孵化 / 死 / `dialogue.quiet` / 外出中 / 生病中 →
`{ ok:false, reason:'silent' }`（`core/lines.js:100-103`）。

**免打扰**：`setQuiet()`（`core/lines.js:119-123`），只影响闲聊与例行 toast，
**生病和死亡照说**（注释 `:118`）。

### 4.7 开局流程（纸盒 → 小猪）

| 步 | 动作 | 入口 | 效果 |
|---|---|---|---|
| 1 | 首次运行 | `store.js:26, 73` `createStore()` → `readStateFile()` 返回 `state:null` | **不写盘**（`needsSave:false`），猪还不存在 |
| 2 | 生成纸盒 | `core/egg.js:18-84` `layEgg(nowMs)` | 全字段默认值（见 §8.3），`hatched:false`、`stage:'box'`、`weightG:1200` |
| 3 | 显示 | `core/clock.js:37-48` `lifeStageFor()` | `hatched !== true` → `LIFE_STAGES[0]`（纸盒 📦 size 58） |
| 4 | 纸盒期特性 | `core/settlement.js:49-50` | `decay()` 立即 return —— **纸盒不饿、不脏、不老、不病、不死**，`ageDays` 从开盒才开始算 |
| 5 | 纸盒期例外 | `core/care.js:35-43` | `feed()` 只累加 `stats.message/turn/tool/…`，**不 `applyEffects`、不给成长** |
| 6 | 三连戳提示 | `src/client/constants.js:79-83` | `BOX_POKES_TO_OPEN = 3`；第 1/2 下说「里面好像有东西…」「动了！再戳一下！」 |
| 7 | 开盒 | `core/egg.js:94-110` `hatch()` | `hatched:true` / `xp=0`（**清零**）/ `sex` 50/50 / `assignPersonality()` / `bornAt=nowMs` / `dead:false` / `stage:'piglet'` / `weightG += HATCH_WEIGHT_G(160)` → **1360** / `health = max(health,1)` |
| 8 | 一次性建新猪 | `core/egg.js:112-123` `hatchEgg()` | 上面一步到位版本（`layEgg()` + 同样字段），测试与 `/pig hatch` 用 |
| 9 | 命令式开局 | `docs/guides/gameplay.md:57` | `/pig hatch`（开盒）/ `/pig adopt`（领养） |

**重置 / 领养**：
- `reset(nowMs)` = `layEgg(nowMs)`，丢下一切重来（`core/state.js:29-31`）
- `adopt(state, nowMs)` = `inherit(state, layEgg(nowMs), nowMs)` + `Object.assign(state, fresh)`
  （`core/state.js:218-222`）；`inherit` 带过 `INHERITED = ['traits','lessons','interests','souvenirs','dex']`
  + `memories` 末 8 条（`core/state.js:41-51`）
- `reset` 的注释背景（`core/state.js:22-27`）：**`adopt` 曾经只在猪死后可用**，
  想重开只能手删存档文件——而宿主把状态存在内存里，改文件在运行期根本无效。

### 4.8 每日系统 daily.js（签到 / 在线礼包 / 日记）

**日切口径**：`DAY_STARTS_AT_HOUR = 6`（`data/growth.js:66`），实现在 `core/clock.js:74-79`。
06:00 以前算前一天。签到、在线礼包、日记、成长日上限、番茄钟日计数、运动记次**共用这一个口径**
（`core/daily.js:5-7` 注释：「免得『一天从几点算起』有两份实现」）。

#### ① 签到（12 天循环）

- `SIGN_IN_CYCLE = SIGN_IN_REWARDS.length = 12`（`data/daily.js:57`）
- 断签**不清零**（下次接着领下一天）；12 天领完从头来；**死了也能签**——「墓碑也攒还魂丹」（`core/daily.js:89`）
- 状态字段：`daily.signIn = { lastDay, index, total }`（`core/daily.js:23`）
- `canSignIn()` = `lastDay !== dayKeyFor(now)`（`core/daily.js:82-84`）；同日第二次 → `{ ok:false, reason:'signed' }`（`:95`）
- 交叉验证：同一天签两次被拒（`test/daily.test.js:51`）

**12 天奖励表**（`data/daily.js:24-54`，**全量原值**）：

| 天 | coins | items |
|---|---|---|
| 1 | 0 | `apple ×3` |
| 2 | **50** | — |
| 3 | 0 | `soap ×3`、`bread ×2` |
| 4 | **100** | — |
| 5 | 0 | `plush ×1`、`rice ×2` |
| 6 | 0 | `banlangen ×1`、`xiaoshipian ×1`、`pipa-syrup ×1` |
| 7 | **200** | — |
| 8 | 0 | **`soul ×1`（还魂丹）** |
| 9 | 0 | `bubble ×3`、`skewer ×2` |
| 10 | **300** | — |
| 11 | 0 | **`baicaodan ×1`（百草丹）** |
| 12 | **500** | `feast ×2`、`deadsea ×2`、`carousel ×1` |

交叉验证：第 8 天拿到还魂丹（`test/daily.test.js:78`）。

#### ② 在线礼包

`ONLINE_GIFT`（`data/daily.js:63-72`）：

| key | 原值 | 含义 |
|---|---|---|
| `perGiftMs` | **`60 × 60 × 1000` = 3600000ms** | 每在线满 1 小时给 1 个 |
| `perDay` | **`8`** | 每天最多 8 个（06:00 刷新） |
| `unclaimedMax` | **`3`** | 没领的最多攒 3 个，攒满只消耗时长不再给 |
| `pollGapMaxMs` | **`30 × 1000` = 30000ms** | 两次轮询间隔超过 30 秒，中间那段不算在线 |

- **只算真实毫秒，与调试页时间倍率无关**（`core/daily.js:110-111` 注释）
- 跨天清零 `onlineMs` 与 `given`，**`unclaimed` 不清**（`core/daily.js:116-121`）
- 轮询节拍由 `store/api.js:113` 的 `recordOnline(state, lastPollMs, nowMs)` 驱动，
  客户端 `POLL_MS = 4000`（`src/client/constants.js:14`）

**礼包概率表**（`data/daily.js:81-88`，合计 `0.40+0.25+0.20+0.10+0.04+0.01 = 1.00`）：

| 概率 | 内容 |
|---|---|
| **0.40** | `kind:'food'`, `maxPrice: 40` —— 从 `SHOP` 现取 |
| **0.25** | `kinds:['bath','toy']`, `maxPrice: 60` |
| **0.20** | 金币 `[30, 80]` 区间随机 |
| **0.10** | `kind:'medicine'`, `maxPrice: 30` |
| **0.04** | 点名 `feast` / `carousel` / `bubbles` |
| **0.01** | 点名 `baicaodan` |

> ⚠️ `resolveGiftBucket()`（`core/daily.js:159-174`）**直接从 `SHOP` 过滤货架**。
> 裁掉商店货架后这个函数会退化成兜底 `{ coins: 30, items: [] }`（`:171`）——这是裁撤签到功能的另一点理由。

#### ③ 日记（**陪伴**，与签到同在 `daily.js` 语境但代码独立）

- `DIARY_MAX = 60` 篇，超出删最早（`data/daily.js:91`；`core/diary.js:99`）
- `DIARY_MAX_SENTENCES = 5` 句（`data/daily.js:94`；`core/diary.js:76`）
- **14 条模板**（`data/daily.js:103-118`），顺序即优先级：
  `feed → bathe → pet → work → study → graduate → trip → illness → cure → wrongMedicine → levelUp → stage → turn → tool`
- 什么都没发生也有话：`DIARY_EMPTY_LINE = '今天[主人]没来，我睡了一整天。'`（`data/daily.js:121`）
- 落笔时机：`writeDiaryIfNewDay()` 在**每次读状态**时跑（`store/api.js:116`）；
  第一次见到今天只归位不落笔（`core/diary.js:91-94`）
- 交叉验证：同一天不落笔，06:30 换天落笔（`test/daily.test.js:266-274`）
- **零 token**：模板拼句，不调模型（`core/diary.js:4-5`）

#### ④ 番茄钟（**陪伴**，`core/pomodoro.js` + `data/pomodoro.js`）

| 常量 | 原值 | 证据 |
|---|---|---|
| `POMODORO_MINUTES` | **`[15, 25, 45]`** | `data/pomodoro.js:11` |
| `POMODORO_BREAK_MINUTES` | **`5`** | `:14` |
| `POMODORO_REWARD` | **`{ coins: 8, happiness: 6 }`** | `:17` |
| `POMODORO_REWARDED_PER_DAY` | **`8`**（之后只计数） | `:20` |
| `POMODORO_MAX_MINUTES` | `180`（存档清洗上界） | `:23` |

- 状态：`state.pomodoro = { startedAt, minutes, todayDone, day, restUntil, finishedAt, quietBefore }`（`core/pomodoro.js:24-26`）
- 到点由**下一次请求**结算（`store/api.js:119` `settlePomodoro`），**关着面板也会结算**（注释 `core/pomodoro.js:5-6`）
- 专注期间**复用免打扰**：开始时打开 `dialogue.quiet`，结束/放弃时**按原来的值放回**，
  用户自己开的免打扰不会被关掉（`core/pomodoro.js:8-9`）
- 中途放弃不给奖励（`data/pomodoro.js:6`）

---

## 五、心情（mood）系统

来源：`packages/pet-core/src/core/views.js:21-38`。**这是一个纯派生视图，不落存档。**

> ⚠️ `mood()` 第一行就调 `decay(state, nowMs)`（`views.js:22`）——**读心情会推进时间**。

### 5.1 判定优先级（严格按源码顺序，命中即返回）

| 序 | 条件 | key | emoji | label | 阈值来源 |
|---|---|---|---|---|---|
| 1 | `state.dead === true` | `dead` | 💀 | 已经走了 | `views.js:23` |
| 2 | `state.illness !== null` | `sick` | 🤒 | `ill === null ? '生病了' : '得了' + ill.name` | `views.js:24-27` |
| 3 | `state.activity !== null` | `working` / `studying` / `traveling` | 💼/📚/🧳（可被 `activity.emoji` 覆盖） | 在打工／在上课／在旅行／在兴趣课 | `views.js:28-31` + `core/constants.js:104-109` |
| 4 | `satiety < 25` | `hungry` | 🍎 | 饿了 | `THRESHOLDS.hungry = 25`（`data/illness.js:14`） |
| 5 | `cleanliness < 35` | `dirty` | 🫧 | 该洗澡了 | `THRESHOLDS.dirty = 35`（`:15`） |
| 6 | `nowMs - lastActiveAt > 30 × 60000` | `sleepy` | 💤 | 睡着了 | `SLEEPY_AFTER_MINUTES = 30`（`data/illness.js:47`） |
| 7 | `happiness >= 75` | `happy` | ❤️ | 很开心 | 硬编码 `75`（`views.js:35`） |
| 8 | `happiness < 35` | `lonely` | 🥺 | 有点孤单 | `THRESHOLDS.lonely = 35`（`data/illness.js:16`） |
| 9 | 以上都不满足 | `fine` | 😊 | 还不错 | `views.js:37` |

### 5.2 `AWAY_MOODS` 原值（`core/constants.js:104-109`）

| activity.kind | key | emoji | label |
|---|---|---|---|
| `work` | `working` | 💼 | 在打工 |
| `study` | `studying` | 📚 | 在上课 |
| `trip` | `traveling` | 🧳 | 在旅行 |
| `interest` | `studying` | 💻 | 在兴趣课 |
| 未知 kind 兜底 | — | — | 取 `AWAY_MOODS.work`（`views.js:29`） |

> 注意：`interest` 和 `study` **共用 key `studying`**，只有 emoji 不同。

### 5.3 心情如何影响全局

| 影响面 | 规则 | 证据 |
|---|---|---|
| 成长速度 | 见 §2.3 的 `MOOD_GROWTH_FACTORS` 四档 | `data/growth.js:34-39` |
| 疾病风险 | `happiness < 30` → 头晕链 +0.05/小时 | `data/illness.js:154-155`；`core/illness.js:71` |
| 闲聊内容 | 饿 → 脏 → 孤单 → idle | `core/lines.js:110-113` |
| 动画 | 开心加速、困了鼓气、饿了抖、脏了蜡黄、病了咳嗽、死了静止变灰 | `docs/DESIGN.md:234-235` |
| 表情气泡 | 面板 HUD | `views.js` 返回值 |

### 5.4 与「孤单」相关的阈值一览（易混淆，单独列出）

| 语义 | 值 | 位置 | 用途 |
|---|---|---|---|
| `THRESHOLDS.hungry` | `25` | `data/illness.js:14` | 心情「饿了」、成长 ×0.7、感冒风险 |
| `THRESHOLDS.dirty` | `35` | `data/illness.js:15` | 心情「该洗澡了」、成长 ×0.7、咳嗽风险 |
| `THRESHOLDS.lonely` | `35` | `data/illness.js:16` | 心情「有点孤单」、闲聊选 lonely 场景 |
| `ILLNESS_ONSET.sadBelow` | `30` | `data/illness.js:154` | **头晕链**风险（注意与 lonely 的 35 不同） |
| 「很开心」阈值 | `75` | `views.js:35` | 只有这里，非命名常量 |
| `ILLNESS_ONSET.veryDirty` | `15` | `data/illness.js:152` | 脏到 15 以下从咳嗽链改判皮肤链 |

---

## 六、疾病与死亡

### 6.1 五条链 × 四级（`data/illness.js:71-117`）

`cause` 字段是「什么导致的」（注释 `:69`）。

| # | chainKey | name | emoji | cause | 1 级 | 2 级 | 3 级 | 4 级 |
|---|---|---|---|---|---|---|---|---|
| 0 | `cold` | 感冒 | 🤧 | **饿** | 感冒 | 发烧 | 重感冒 | **肺炎** |
| 1 | `cough` | 咳嗽 | 😷 | **脏** | 咳嗽 | 支气管炎 | 哮喘 | **肺结核** |
| 2 | `stomach` | 肠胃 | 🤢 | **吃撑** | 肚子胀 | 胃炎 | 胃溃疡 | **胃癌** |
| 3 | `dizzy` | 头晕 | 😵 | **心情差、连续打工上课** | 头晕 | 偏头痛 | 神经衰弱 | **心力衰竭** |
| 4 | `skin` | 皮肤 | 🩹 | **很脏** | 瘙痒 | 干裂 | 溃疡 | **感染** |

每级对应一种药（`stage(name, medicine(key, label, emoji, tier))`，`data/illness.js:62-65`）+ 价格：

| tier | 价格 | 感冒链 | 咳嗽链 | 肠胃链 | 头晕链 | 皮肤链 |
|---|---|---|---|---|---|---|
| 1 | **30** | 板蓝根 🌿 | 枇杷糖浆 🍯 | 消食片 💊 | 清凉油 🟢 | 润肤露 🧴 |
| 2 | **70** | 退烧药 💊 | 甘草剂 🌾 | 蓝色消炎水 🧪 | 止痛片 💊 | 薄荷油 🍃 |
| 3 | **140** | 银翘丸 🟤 | 定喘丸 ⚪ | 龙胆草 🌱 | 噗噗神水 🫧 | 生肌膏 🩹 |
| 4 | **260** | 金色消炎水 🧪 | 通风散 🫙 | 仙人汤 🍵 | 何首乌 🥔 | 茶树油 🌳 |

- `MEDICINE_PRICE_BY_TIER = [30, 70, 140, 260]`（`data/illness.js:60`）
- `CURE_ALL` 百草丹 🌿 **500** 🪙，任何病任何级都能治（`:123`）
- `MEDICINES = 20 种对症药 + 百草丹`（`:126-129`）
- 交叉验证：五条链价格数组全部等于 `[30,70,140,260]`（`test/illness.test.js:133`）；百草丹 500（`:135`）

### 6.2 分期时长与健康

| 常量 | 原值 | 证据 |
|---|---|---|
| `ILLNESS_STAGE_HOURS` | **`[24, 36, 48, 72]`** 小时 | `data/illness.js:28` |
| 未治疗全链总时长 | **`24+36+48+72 = 180 小时 = 7.5 天`** | 注释 `data/illness.js:26-27` |
| `illnessStageMs(stage)` | `(ILLNESS_STAGE_HOURS[stage-1] ?? 24) × 3_600_000` | `:33` |
| `STAGE_HEALTH` | **`[4, 3, 2, 1]`** —— 每进一级，健康**设置**（非扣减）为该值 | `:53`；`core/illness.js:129,174` |
| `SELF_HEAL_CHANCE` | **`[0.25, 0.12, 0.05, 0]`** | `:39` |
| `SICK_PAY_MULTIPLIER` | **`0.5`**（带病打工半薪） | `:42` |
| `SICK_AWAY_MULTIPLIER` | **`2`**（带病外出，疾病钟走两倍） | `:45` |
| `DOCTOR_MARKUP` | **`1.5`** | `:135` |
| `REVIVE_ITEM` 还魂丹 | `{ key:'soul', label:'还魂丹', emoji:'✨', price: 800, kind:'revive' }` | `:132` |

> **注释与文档冲突**：`docs/DESIGN.md:130` 仍写「推进未治疗的疾病（每 25 分钟一期）」，
> `data/illness.js:20-22` 明确说明这是**改过的**：一个 stage 过去只有 25 分钟，
> 感冒两小时内就能弄死猪。**以 `[24,36,48,72]` 小时为准。**

### 6.3 发病（onset）：每小时骰子

`ILLNESS_ONSET`（`data/illness.js:145-164`）**全部原值**：

| key | 原值 | 含义 |
|---|---|---|
| `basePerHour` | **`0.002`** | 养得再好的猪也有约「三周一次小病」（注释 `:146`） |
| `hungryPerHour` | **`0.03`** | `satiety < 25` → 感冒链 |
| `dirtyPerHour` | **`0.03`** | `cleanliness < 35` → 咳嗽链；`< 15` → 皮肤链 |
| `veryDirty` | **`15`** | 很脏分界 |
| `sadBelow` | **`30`** | 心情低于此 → 头晕链 |
| `sadPerHour` | **`0.05`** | 对应上一条 |
| `overworkStreak` | **`3`** | 连续外出无休息的次数门槛 |
| `overworkPerHour` | **`0.05`** | 超门槛 → 头晕链 |
| `restMinutes` | **`60`** | 在家累计 60 分钟清空 `outingStreak` |
| `overfullAt` | **`95`** | 喂食前 `satiety >= 95` |
| `overfeedChance` | **`0.25`** | 吃撑 → 肠胃链 |

**算法**（`core/illness.js:63-103`）：
1. `onsetRisks()` 列出所有当前风险，每条 `{ chain, perHour }`；基础那条 `chain = -1`
2. `perHour = Σ risks.perHour`（各条件**相加**）
3. `hit = 1 - (1 - min(1, perHour)) ^ (minutes / 60)` —— 5 分钟切片与一次长步结果一致
   （`test/settlement.test.js:64-73` 断言两者误差 < 1e-6）
4. 命中后按各风险 `perHour` 占比**加权抽签**决定是哪条链；`chain === -1` 时**随机**选链

**只有在家才会发病**：`trackSicknessRisk()` 里 `if (away) return`
（`core/settlement.js:124-128`，注释原文「A pig that was out living its life has not been neglected」）。

**交叉验证**（`test/illness.test.js:33-55`）：又饿又脏时中位数 **10.8 小时**（注释按 6.2%/h 算），
测试断言 `median > 8 && median < 14`，且 90 分位 < 48 小时。
`0.002 + 0.03 + 0.03 = 0.062/h` ✔。
吃撑骰子：200 次试验中 25–80 次发病（`test/illness.test.js:77-95`），约合 25% ✔。

### 6.4 严重度递增、自愈与致死

`core/illness.js:149-177`：

```
advanceIllness(state, nowMs, next):
  healChance = SELF_HEAL_CHANCE[stage - 1] ?? 0
  if chance(healChance)  → recover(), 公告 'cured', 记忆「自己好了，扛过去了 💚」
  else                   → worsen(state, nowMs, '没能撑过去')

worsen():
  worse = nextIllness(chain, stage)          // stage+1
  if worse === null → die(state, nowMs, why) // 第 4 级之后 = 死
  else → stage+1, health = STAGE_HEALTH[stage]
```

**致死条件（全集，仅 3 条）**：

| # | 条件 | why 文案 | 证据 |
|---|---|---|---|
| 1 | 第 4 级疾病再走完一期（`72h`）且自愈骰子失败 | 「没能撑过去」 | `core/illness.js:159,166-171` |
| 2 | **在第 4 级吃错药** | 「吃错了药，没能撑过去」 | `core/illness.js:210` |
| 3 | 开发模式把 `health` 打到 `<= 0`，或直接勾 `dead` | 「被开发者按死了」 | `core/state.js:169-174` |

> **没有老死**。`test/core.test.js:182-195` 跑满 250 天（每天恢复满值）后断言 `pig.dead === false`。
> `core/illness.js:30-31` 注释原文：「Only accidents kill it (the end of an illness chain,
> or a wrong medicine at the last stage); there is no old age (B2).」

**自愈概率的几何期望**：不治疗时每期结束有 `25% / 12% / 5% / 0%` 概率自愈。
第 4 级 `SELF_HEAL_CHANCE = 0` → **必死**（`data/illness.js:38-39` 注释：「The last stage never does」）。
交叉验证：`test/core.test.js:625` 用 `always` 骰子在 `illnessStageMs(4)` 后跑出死亡。

**治愈后无后遗症**：`recover()` 直接把 `health = MAX.health`（`core/illness.js:179-184`），
注释「an illness leaves no permanent dent」。

### 6.5 治疗三条路

| 路径 | 规则 | 返回 | 证据 |
|---|---|---|---|
| **对症吃药** | `item.key === ill.cureKey` 或 `item.cureAll === true` → 痊愈；`stats.cures += 1` | `{ ok:true, cured:true }` | `core/illness.js:199-205` |
| **吃错药** | **照扣物品**，记忆「吃错了药…病情加重」，`say('wrongMedicine')`，立即 `worsen()` | `{ ok:false, reason:'wrong-medicine', needs: ill }` | `:207-211` |
| **看医生** | `fee = ceil(curePrice × 1.5)`；`coins < fee` → `poor`；否则扣钱痊愈，`doctorVisits += 1` | `{ ok:true, fee }` | `:215-235` |

交叉验证：头晕 2 级 → `止痛片 70 × 1.5 = 105`（`test/illness.test.js:118-130`）。
吃错药在最后一级 = 死（`test/illness.test.js:97-104`；`test/core.test.js:720-724`）。
健康猪吃药 → `not-sick`，药不消耗（`test/core.test.js:736-740`）。

**为什么生病不阻止打工**（`core/activity.js:16-21` 注释）：
生病曾经完全禁止出门，导致死锁「病 → 不能打工 → 没钱买药 → 继续病 → 只能等死」。
现在只有 `health <= 1` 才拦（`awayBlockedReason`，`core/activity.js:22-29`）。

### 6.6 死亡的表现与复活

**`die()`**（`core/illness.js:34-45`）逐项设置：

| 字段 | 值 |
|---|---|
| `dead` | `true` |
| `health` | `0` |
| `illness` | `null` |
| `activity` | `null` |
| `diedAt` | `nowMs` |
| `stats.deaths` | `+1` |
| 记忆 | `` `${why} 🪦` `` |
| 公告 | `kind:'death'`，文本含「用还魂丹可以救回来，也可以领养一只新的」 |
| 台词 | `say(state, 'death', nowMs)` |

**墓碑 → 灵魂**（`core/clock.js:121-122`）：
`hasSoul = dead && (nowMs - diedAt) / 86_400_000 >= SOUL_AFTER_DAYS`，`SOUL_AFTER_DAYS = 1`（`data/life.js:66`）。
交叉验证：0.5 天无、1.1 天有（`test/core.test.js:207-214`）。

**复活 `revive()`**（`core/state.js:228-242`）——**复活后的确切状态**：

| 字段 | 复活后的值 |
|---|---|
| `dead` | `false` |
| `diedAt` | `null` |
| `health` | **`MAX.health` = 5**（满血） |
| `satiety` | `max(satiety, 60)` |
| `cleanliness` | `max(cleanliness, 60)` |
| `happiness` | `max(happiness, 50)` |
| `illness` | `null` |
| `activity` | `null` |
| `outingStreak` | `0` |
| `stats.revives` | `+1` |
| 记忆/公告/台词 | 「被 还魂丹 救了回来 ✨」/ `kind:'revived'` / `say('revive')` |

**复活入口**（`core/inventory.js:167-172`）：
`useItem(state, 'soul', ...)`；活猪用还魂丹 → `{ ok:false, reason:'not-dead' }`（交叉验证 `test/core.test.js:706`）。
**形态保留**：`revive()` 不碰 `state.form`（`core/evolution.js:5` 注释「复活保留形态，领养的新猪从头来」）。
**价格 800 🪙**（`data/illness.js:132`）。

> ⚠️ **测试 fixture 里的 150 是 mock**：`test/client.test.js:319` 出现 `soul price: 150`，
> 那是客户端渲染测试手写的假快照，**不是真值**；真值 800 由 `test/illness.test.js:136` 断言。

**领养 `adopt()`**（`core/state.js:218-222`）：
`inherit(state, layEgg(nowMs), nowMs)` 后 `Object.assign` 回原对象。
继承清单 `INHERITED = ['traits', 'lessons', 'interests', 'souvenirs', 'dex']`（`core/state.js:41`）
+ `memories` 末 8 条（`:48`，`MEMORY_LIMIT = 8`）。
**成长不继承**（`:37-39` 注释：等级就是身体，继承 Lv40 会孵出一只成年猪）。
交叉验证：`adopt` 后 `dead=false, hatched=false, xp=0`（`test/core.test.js:198-204`）。

> ⚠️ **`hatch()` 会把 `xp` 清零**（`core/egg.js:96-98`）：注释说纸盒期间
> 老存档可能吃到了真实工作的经验，开盒时不作数。**但 `feed()` 在纸盒状态下仍然累加 `stats`**
> （`core/care.js:35-41`）——`stats.turns/tools` 会带着纸盒期数字进正文。

---

## 七、时间与离线

### 7.1 `decay()` 的完整流程

来源：`core/settlement.js:45-71`。

```
decay(state, nowMs, options):
  fromMs = state.lastSeenAt ?? nowMs
  state.lastSeenAt = nowMs
  ① hatched !== true            → 立即 return（纸盒不饿不老不病不死）      :50
  ② !(nowMs > fromMs) || dead   → 立即 return（时间没走 / 已死）           :51
  ③ ageMs 缺失时用 bornAt 补种（老存档）                                  :53-56
  ④ 若 activity != null:
       untilMs = min(nowMs, max(cursor, activity.endsAt))
       passTime(away = true,  from=cursor, to=untilMs)                    :62
       cursor = untilMs
       若活动确实到点 → finishActivity(state, untilMs)（在结束时刻结算，不是看到时刻）:65-67
  ⑤ 若未死 → passTime(away = false, from=cursor, to=nowMs)               :69
```

> 关键设计（`core/settlement.js:30-37` 注释）：间隙被切成**最多两段**（在外直到活动结束、然后在家），
> 每段按 `SETTLE_STEP_MS` 走步。这就是为什么「6 点结束的班」会在 6 点被结算和打时间戳。

### 7.2 步长与上限

| 项 | 原值 | 证据 |
|---|---|---|
| `SETTLE_STEP_MS` | **`5 * 60_000` = 300000ms = 5 分钟** | `core/constants.js:95` |
| 离线结算**上限** | **无**。注释：「five minutes keeps a month offline under ten thousand cheap steps」（一个月 ≈ 8640 步） | `core/constants.js:90-94` |
| 疾病单步内推进次数上限 | `guard < 16`（防止一个 step 里无限推进） | `core/settlement.js:140` |
| 调试快进上限 | `min(patch.__advanceMs, 60 * 86_400_000)` = **60 天** | `core/state.js:133` |
| 一致性保证 | 一次长 `decay` 与 5 分钟一次的多次 `decay`，`satiety/happiness/cleanliness/ageMs` 误差 `< 1e-6` | `test/settlement.test.js:64-73` |

**结论：没有「离线收益上限」也没有「离线衰减封顶」**。关掉 DSH 一个月，下次打开会按真实时间
一次结清（8640 步），**期间该饿的饿、该病的病、该死的时候已经死了**。

### 7.3 一步里做的四件事

`step()`（`core/settlement.js:94-100`）：

| 序 | 动作 | 函数 | 位置 |
|---|---|---|---|
| 1 | 三条 bar 衰减 | `drainBars(state, elapsedMs/60000, away)` | `:108-117` |
| 2 | 生病风险（**只在家**）+ 休息计时 | `trackSicknessRisk` → `restAtHome` + `rollForIllness` | `:124-128` |
| 3 | 疾病推进 | `progressIllness` | `:135-150` |
| 4 | 变老 + 被动成长 + 体重代谢 | `growOlder` | `:156-164` |

`growOlder()`：
```js
scale = Number.isFinite(timeScale) && timeScale > 0 ? timeScale : DEFAULT_TIME_SCALE
pigMs = elapsedMs × scale
settleWeight(state, pigMs)
state.ageMs += pigMs
if (hatched) growWithTime(state, pigMs, atMs)
```
（`core/settlement.js:156-164`）

**疾病推进按「有效时间」**（`core/settlement.js:130-150`）：
`rate = away ? SICK_AWAY_MULTIPLIER(=2) : 1`；`progressMs += elapsedMs × rate`。
注释原文：「a day of work costs two days of illness and staying home is the cheap way to wait it out」。
超出的余量会**带进下一期**（`carried`，`:145-147`），不丢弃。

### 7.4 日界：`DAY_STARTS_AT_HOUR = 6`

- `data/growth.js:66` 定义 **`6`**；注释：「06:00 以前还算前一天（签到、在线礼包、日记、每日上限共用）」
- `dayKeyFor(nowMs)`（`core/clock.js:74-79`）：`new Date(nowMs - 6*3_600_000)` 后取本地 `YYYY-MM-DD`
- 复用于：**成长日上限**（`core/growth.js:102`）、**签到**（`core/daily.js:83,94`）、
  **在线礼包**（`core/daily.js:115`）、**日记落笔**（`core/diary.js:90`）、
  **番茄钟当日计数**（`core/pomodoro.js:66`）、**运动记次**（`core/weight.js:47`）
- 交叉验证：05:30 与前一天同一天，06:10 是新一天（`test/growth.test.js:66-73`）

### 7.5 存档写入时机

| 环节 | 机制 | 证据 |
|---|---|---|
| 节流 | `SAVE_THROTTLE_MS = 1500`（毫秒） | `store.js:16` |
| 调度 | `scheduleSave()` — `dirty = true`；已有 timer 就直接返回；否则 `setTimeout(..., 1500)`，并 `timer.unref()`（不阻止进程退出） | `store.js:35-49` |
| 真正写 | `writeNow()` — `if (!dirty \|\| state === null) return`；`writeStateFile(filePath, state)`；`dirty = false` | `store.js:51-55` |
| 变更包装 | `mutate(fn)` — 先 `structuredClone` 快照，成功才 `scheduleSave()`；抛异常则回滚到快照 | `store.js:57-71` |
| 读时机 | `freshen()`：`recordOnline → writeDiaryIfNewDay → decay → settlePomodoro → scheduleSave` | `store/api.js:106-126` |
| 被动事件 | `feed(event)` → `coreFeed` → `scheduleSave()`（独立于 mutate） | `store/api.js:92-103` |
| 退出兜底 | `dispose()` 清 timer 后**强制** `writeNow()` | `store.js:84-94` |
| 原子写 | 临时文件 → `fsyncSync` → `renameSync` | `store/state-file.js:118-129` |
| 启动读 | `readStateFile()` → `migrate()`；旧版本先留备份 | `store/state-file.js:86-115` |
| 旧版本备份 | `keepPreUpgradeCopy()` 写 `state.json.v{N}-backup-{ISO}` | `store/state-file.js:66-74, 113` |
| 损坏存档 | `preserveUnusableSave()` 写 `state.json.corrupt-{ISO}`，**原文件不动** | `store/state-file.js:49-58, 103, 109` |

> **离线结算不会漏**：`freshen()` 在每次读状态时都调 `decay` 并 `scheduleSave`，
> 而面板每 `POLL_MS = 4000` 毫秒轮询一次（`src/client/constants.js:14`）。

---

## 八、存档结构

### 8.1 文件路径

| 形态 | 路径 | 证据 |
|---|---|---|
| DSH 插件（默认） | **`$DSH_HOME/dsh-piggy/state.json`** | `store/state-file.js:22-24`；`docs/guides/gameplay.md:69` |
| `$DSH_HOME` 缺省 | **`~/.dsh`** | `store/state-file.js:14-19` |
| DSH 插件（可配） | `config.statePath` 覆盖 | `index.js:54, 57` |
| 桌面版 | **`app.getPath('userData')/dsh-piggy/state.json`** | `apps/desktop/main.js:79` |
| 桌面版导入 | 找 `~/.dsh/dsh-piggy/state.json`（或 `DSH_HOME` 下） | `apps/desktop/main.js:295, 305` |
| 旧路径迁移 | `$DSH_HOME/dsh-pig/` → `dsh-piggy/`（整目录拷贝，旧目录改名留档，不删） | `store/state-file.js:26-46`；`index.js:55-56` |

> 注释 `apps/desktop/main.js:11`：「存档在 `userData/dsh-piggy/state.json`，**跟 DSH 里那只各养各的**；
> 托盘里可以导入。」→ **双形态各有一份独立存档。**
> ⚠️ `docs/DESIGN.md:182` 数据流图里仍写 `$DSH_HOME/dsh-pig/state.json`，**路径已过期**。

### 8.2 `STATE_VERSION = 12`

`core/constants.js:10`。注释：「Bumped when the saved shape changes in a way `migrate()` must handle.」

### 8.3 存档字段清单（`layEgg()` 全量，`core/egg.js:18-84`）

| 字段 | 初始值 | 说明 |
|---|---|---|
| `version` | `STATE_VERSION` = 12 | `egg.js:20` |
| `name` | `'猪猪'` | `:21` |
| `bornAt` | `nowMs` | `:22` |
| `hatched` | `false` | `:23` |
| `dead` | `false` | `:24` |
| `diedAt` | `null` | `:26` |
| `stage` | `'box'` | `:28` |
| `form` | `null` | 形态 key（`data/evolution.js`），`:30` |
| `skin` | `'default'` | `:31` |
| `customSkins` | `[]` | `:32` |
| `bodyWeight` | `{ playDay: '', plays: 0 }` | `:35` |
| `ageMs` | `0` | 累计猪时间 ms，`:37` |
| `timeScale` | `DEFAULT_TIME_SCALE` = `1` | `:39` |
| `ageForced` | `false` | 调试强制过年龄，`:41` |
| `xp` | `0` | 成长值，`:42` |
| `weightG` | `BIRTH_WEIGHT_G` = `1200` | `:43` |
| `satiety` | `70` | `:44` |
| `happiness` | `70` | `:45` |
| `cleanliness` | `90` | `:46` |
| `health` | `MAX.health` = `5` | `:47` |
| `coins` | `500` | `:50` |
| `inventory` | `{}` | `:51` |
| `dress` | `[]` | 已购装扮（永久），`:53` |
| `worn` | `[]` | 正在穿戴，`:54` |
| `dex` | `emptyDex()` | `:55` |
| `fishing` | `emptyFishing()` | `:56` |
| `traits` | `{ intel: 0, charm: 0, strong: 0 }` | `:57` |
| `lessons` | `{}` | 每科课时，`:60` |
| `interests` | `{}` | 兴趣课次数，`:62` |
| `souvenirs` | `[]` | `:63` |
| `illness` | `null` | `:64` |
| `activity` | `null` | `:65` |
| `outingStreak` | `0` | `:66` |
| `restMinutes` | `0` | `:67` |
| `lastFedAt` | `0` | `:68` |
| `lastActiveAt` | `nowMs` | `:69` |
| `lastSeenAt` | `nowMs` | `:70` |
| `cooldowns` | `{}` | `:71` |
| `pending` | `[]` | 待显示公告，`:72` |
| `pendingSeq` | `0` | 公告自增 id，`:73` |
| `dialogue` | `emptyDialogue()` | `:74` |
| `memories` | `[]` | `:75` |
| `stats` | 见下 | `:76-82` |

**`stats` 全字段初值**（`core/egg.js:76-82`）：
```
turns:0 messages:0 tools:0 toolErrors:0 agentErrors:0
levelUps:0 feeds:0 baths:0 plays:0 pets:0
jobs:0 coinsEarned:0 purchases:0 illnesses:0 cures:0 deaths:0 revives:0
courses:0 lessons:0 trips:0 sales:0 interests:0
fishCaught:0 fishingAuto:0
```

**由子系统懒补的字段**（不在 `layEgg` 里，靠 `ensure*()` 补）：

| 字段 | 结构与初值 | 补全函数 | 证据 |
|---|---|---|---|
| `seed` | uint32，由 `bornAt + name` FNV-1a 派生 | `seedFor()` / `isSeed()` | `core/random.js:27-38, 46-48`；`core/migrate.js:80` |
| `sex` | `'boy'` / `'girl'` | `pickSex()` | `core/egg.js:99,115`；`core/migrate.js:81` |
| `personality` / `catchphrase` / `motto` | 6 种性格之一 | `assignPersonality()` / `ensureProfile()` | `core/profile.js:19-36` |
| `daily` | `{ signIn:{lastDay,index,total}, online:{day,onlineMs,given,unclaimed} }` | `ensureDaily()` | `core/daily.js:21-56` |
| `diary` | `{ entries: [], today: { day: null, counts: {} } }` | `ensureDiary()` | `core/diary.js:15-49` |
| `pomodoro` | `{ startedAt, minutes, todayDone, day, restUntil, finishedAt, quietBefore }` | `ensurePomodoro()` | `core/pomodoro.js:24-61` |
| `realWorkGrowth` | `{ day, amount }` | `growFromRealWork()` | `core/growth.js:103-106` |

### 8.4 版本迁移

**`UPGRADES` 表（`core/upgrades.js:84-173`）—— 6 级，从 v7 起**：

| to | why（原文摘要） | 关键动作 | 行号 |
|---|---|---|---|
| **8** | `hatched` 不再由 xp 推断 | 无 `hatched` 时 `hatched = (xp > 0)` | `:85-94` |
| **9** | B2 成长：xp 改为成长值、按新曲线折算；形态改由等级决定、**去掉老年**；补性别 | `growthFromV8Xp()` 保持等级与进度百分比；`elder` → `middle`；50/50 补 `sex` | `:95-110` |
| **10** | B3 疾病：四种通用药下架退款；`riskMinutes` 换成连续外出计数 | 按 `V10_REFUND = { med1:30, med2:70, med3:140, med4:260 }` 退金币；删 `riskMinutes`；`outingStreak = restMinutes = 0` | `:111-130` |
| **11** | B4 学习→职业：23 门课并进九门；旧职业在打的工按旧报酬结算 | `V11_SUBJECT_OF` 23→9 映射；`V11_OLD_JOB_PAY` 给在途的班打 `legacyCoins` | `:131-162` |
| **12** | 加冕形态单独存成 `form`；PR #2 早期 `finalForm` 改名 | `form = raw.form ?? raw.finalForm ?? null`；删 `finalForm` | `:163-172` |

- `FIRST_UPGRADE_FROM = 7`（`core/upgrades.js:176`）——**比 v7 更老的存档跳过步进表，直接走 `migrate()` 字段清洗**
- `applyUpgrades()`（`:184-192`）：`onDisk < 7` 时视作 7；逐级 `if (current.version < upgrade.to) current = upgrade.up(current)`
- **曲线是冻结副本**（`:27-34`）：`v8LevelFloor = 20*L*(L-1)`、`v9LevelFloor = 122*L²`、`V9_MAX_LEVEL = 60`——
  升级永远按当初的曲线算，不受现行 `data/` 表变化影响

**`migrate()` 的字段清洗**（`core/migrate.js:26-95`，逐项要点）：

| 处理 | 证据 |
|---|---|
| 非对象 / null / 数组 → 返回 `null`（存档被拒） | `:27` |
| `{ ...layEgg(bornAt), ...raw }` —— **egg 先、raw 后覆盖** | `:31-32` |
| `form` 用 `formByKey()` 白名单校验 | `:34` |
| `stats` 与 `egg.stats` 合并 | `:35` |
| `inventory` 只保留 `SHOP` 里有的 key（`sanitizeInventory`） | `:38, 101-111` |
| 旧王冠（`crown`/`royal-crown` 在 dress/worn）折算成 1 个王冠道具 | `:41-42` |
| `worn` 必须是 `dress` 的子集 | `:45` |
| `memories` 仅保留字符串，末 8 条 | `:51-53` |
| 13 个数值字段非有限数就用 egg 的 | `:55-57` |
| **`onDiskVersion < 5` 且 `coins < 500` → 补到 500（只补一次）** | `:64-66` |
| `illness` 白名单校验（`sanitizeIllness`） | `:76, 195-208` |
| `activity` 兼容 v3 `work` 记录（`sanitizeActivity`） | `:77, 211-241` |
| `dead = dead === true \|\| health <= 0` | `:78` |
| `stage === 'elder'` → `'middle'` | `:82` |
| 依次调 9 个 `ensure*()` | `:84-93` |

**升级前必留备份**：`readStateFile()` 在 `onDisk < STATE_VERSION` 时调 `keepPreUpgradeCopy()`
（`store/state-file.js:112-114`），文件名 `state.json.v{N}-backup-{ISO时间}`。

**测试样本**：`test/fixtures/state-v7-real.json` 是一份**真实 v7 存档**（93 行），
含 `riskMinutes: 0`、`coursesByStage`、`lessonsByStage`（七个学段全 0）、
`cooldowns: { play:…, bathe:… }`、`stats.tools: 993`，用来验证 v7→v12 的跨版本升级。
v1 存档跨到最新也有测试（`test/core.test.js:228-244`）。

---

## 九、功能点归属表（陪伴 / 娱乐）

> **判定口径**
> - **陪伴**：不依赖「赚取/消费/竞争/进度解锁」，去掉后猪仍然是一个会饿、会脏、会开心、会生病的活物。
> - **娱乐**：核心循环是「投入时间/金钱 → 换取数值/收藏/解锁」，去掉后陪伴感**不降低**。
> - **混合**：本体是陪伴，但被娱乐系统挂钩（需要改一行才能干净裁掉）。
> - **基础设施**：不是玩法，是存档/外壳/构建。

### 9.1 生命本体与成长

| # | 功能点 | 证据 | 归属 | 判定理由 |
|---|---|---|---|---|
| 1 | 纸盒开局（戳三下开盒） | `core/egg.js:18-110`；`src/client/constants.js:79` | **陪伴** | 唯一的「第一次」仪式感，无任何资源交换 |
| 2 | 随机性别 ♂/♀ 50/50 | `core/egg.js:130`；`data/growth.js:69-72` | **陪伴** | 纯身份属性，无机制作用 |
| 3 | 生命阶段阶梯（纸盒/幼年/青年/成年） | `data/life.js:31-48` | **陪伴** | 形态变化 = 生命感本身 |
| 4 | 等级与称号（Lv1–60，7 个称号） | `data/growth.js:15,18,25`；`data/life.js:73-81` | **陪伴** | 纯展示，无门禁（唯一例外见 #33） |
| 5 | 被动成长（时间 × 照顾系数） | `core/growth.js:88-90` | **陪伴** | 「你照顾得好它就长得快」，这是核心情感回路 |
| 6 | 陪主人真实干活加成（turn/tool） | `core/growth.js:99-107`；`index.js:41-48` | **陪伴** | 与 DSH 的耦合点，**零 token、模型无感知** |
| 7 | 年龄显示（天/月） | `core/clock.js:20-31`；`data/life.js:11` | **陪伴** | 只做显示，无判定作用 |
| 8 | 三维属性条（饱食/心情/清洁） | `core/egg.js:44-46`；`core/constants.js:77-81` | **陪伴** | 生命感的地基 |
| 9 | 健康 5 格 + 归零死亡 | `data/life.js:8`；`core/illness.js:37` | **陪伴** | 让照顾有分量 |
| 10 | 体重与体型（正常/圆润/胖胖） | `core/weight.js:15-21`；`data/weight.js:3-14` | **陪伴** | 「养胖了」是纯粹的可爱度反馈，**但 `playsPerDay` 与玩耍绑定**（见 #28） |
| 11 | 胖胖专属立绘 `pig-fat` | `core/weight.js:105-114`；`assets/pig-fat.svg` | **陪伴** | 唯一一个「因为养得好而换图」的奖励 |
| 12 | 记忆（末 8 条） | `core/effects.js:30-33`；`core/constants.js:16` | **陪伴** | 猪的「人生流水」 |
| 13 | 时间倍率（1/12/30/60，调试用） | `data/life.js:54-57`；`core/state.js:59-65` | **基础设施** | 调试页功能，正式体验里应隐藏 |

### 9.2 照顾与互动

| # | 功能点 | 证据 | 归属 | 判定理由 |
|---|---|---|---|---|
| 14 | 喂食 | `core/constants.js:50-57`；`core/care.js:64-107` | **陪伴** | 但**绑定食物库存**（混合，见 #30） |
| 15 | 洗澡 | `core/constants.js:58-61` | **陪伴** | 同上，绑洗浴库存 |
| 16 | 玩耍 | `core/constants.js:62-65` | **陪伴** | 有免费默认球 `ball`，**不绑库存** |
| 17 | 摸摸（+10 心情，免费，无冷却） | `core/constants.js:66-69`；`core/care.js:78-79` | **陪伴** | **纯陪伴，零成本，且是唯一在外出时仍可执行的动作** |
| 18 | 左键摸摸 / 10 句摸摸台词 | `src/client/constants.js:69-74` | **陪伴** | 最轻的交互 |
| 19 | 24 场景台词系统 | `data/lines.js:55-214` | **陪伴** | 陪伴感的直接载体 |
| 20 | 台词回复按钮（+3 心情，每句一次） | `core/lines.js:77-88`；`data/lines.js:22` | **陪伴** | 双向互动 |
| 21 | 主动搭话（enter / idle，20–40 分钟） | `core/lines.js:99-116`；`data/lines.js:25,28` | **陪伴** | 「它会主动找你说话」 |
| 22 | 免打扰开关 | `core/lines.js:119-123` | **陪伴** | 不打扰的前提 |
| 23 | 主人称呼 `[主人]` | `data/lines.js:13,16,19` | **陪伴** | 个性化 |
| 24 | 被动投喂（吃 message/turn/tool） | `core/care.js:29-48`；`core/constants.js:41-47` | **陪伴** | 「吃真实工作长大」 |
| 25 | 心情系统（9 态） | `core/views.js:21-38` | **陪伴** | 表情即情绪语言 |
| 26 | 心情驱动动画（加速/鼓气/抖/蜡黄/咳嗽/变灰） | `docs/DESIGN.md:234-235` | **陪伴** | 无需数值的实时反馈 |
| 27 | `react-refuse` 拒绝动画（抖一下） | `src/client/io.js:44`；`src/client/css-base.js:168` | **陪伴** | 有反应 = 有性格 |

### 9.3 疾病与生命风险

| # | 功能点 | 证据 | 归属 | 判定理由 |
|---|---|---|---|---|
| 28 | 五条疾病链 × 四级 | `data/illness.js:71-117` | **陪伴（生命感）** | 制造「被需要」的压力，**是本项目与纯装饰桌宠的分界线** |
| 29 | 发病骰子（条件概率/小时） | `data/illness.js:145-164` | **陪伴（生命感）** | 让「饿/脏/孤单」有真实代价 |
| 30 | 分期推进 + 自愈骰子 + 致死 | `core/illness.js:149-177`；`data/illness.js:28,39,53` | **陪伴（生命感）** | 唯一的自然死亡路径 |
| 31 | 对症药 / 吃错药加重 | `core/illness.js:196-212` | **混合** | 治疗依赖**商店+金币**（见 #41） |
| 32 | 看医生（1.5× 药价直接治好） | `core/illness.js:215-235` | **混合** | 依赖金币 |
| 33 | 墓碑 → 1 天后灵魂 | `data/life.js:61,66`；`core/clock.js:121-122` | **陪伴** | 失去的表达 |
| 34 | 还魂丹复活（800 🪙） | `core/state.js:228-242`；`data/illness.js:132` | **混合** | 本体是陪伴，获取途径是商店 |
| 35 | 领养新猪（继承 traits/lessons/interests/souvenirs/dex） | `core/state.js:41-51, 218-222` | **混合** | 继承清单里 4/5 是娱乐向收藏 |
| 36 | 离家（activity）机制 | `core/settlement.js:58-69`；`core/activity.js:22-47` | **娱乐（载体）** | 机制本身中性，但**唯一使用者**全是娱乐玩法（打工/上课/旅行/钓鱼） |
| 37 | 外出时衰减 ×1.4 + 保底 15 | `core/constants.js:83-86`；`core/settlement.js:108-117` | **娱乐（载体）** | 为外出玩法服务 |
| 38 | 带病外出疾病钟 ×2 | `data/illness.js:45`；`core/settlement.js:137` | **娱乐（载体）** | 同上 |
| 39 | 连续外出 3 次 → 头晕风险 | `data/illness.js:156-159` | **娱乐（载体）** | 惩罚的是「连续打工上课」，见 #45/#46 |
| 40 | 吃撑骰子（喂食时 satiety ≥ 95 → 25% 肠胃） | `data/illness.js:161-163`；`core/care.js:102` | **陪伴** | 直接服务于喂食动作，是「无冷却」的刹车 |

### 9.4 娱乐玩法（用户指定裁撤范围）

| # | 功能点 | 证据 | 归属 | 判定理由 |
|---|---|---|---|---|
| 41 | 商店 `shop` / 购买 `buy` | `core/inventory.js:151-154`；`data/shop.js:45-110` | **娱乐** | 纯经济循环。**但照护动作依赖货架**（见第十节） |
| 42 | 打工 `work`（18+15 种职业、门槛=等级+课时+证书） | `data/jobs.js:1-150`；`core/work.js` | **娱乐** | 按真实时间换金币 + 三维属性 |
| 43 | 学习 `school`（9 门课 × 7 学段） | `data/school.js:32-42`；`core/school.js` | **娱乐** | 为打工门槛服务（`data/jobs.js:19-22`） |
| 44 | 兴趣班 `interests`（5 次拿证） | `data/interests.js:14-16`；`core/interests.js` | **娱乐** | 服务打工证书门槛 |
| 45 | 旅行 `travel`（4 目的地 + 纪念品 + 稀有度） | `data/travel.js:16-87`；`core/travel.js` | **娱乐** | 收集 + 卖钱（`data/travel.js:17-19` 带价格） |
| 46 | 钓鱼 `fishing`（手动 QTE + 自动） | `core/fishing.js`；`data/fish.js:3`；`src/client/tabs/fishing.js` | **娱乐** | 独立小游戏 |
| 47 | 掉落 `drops`（打工 15%/50% 带 1–2 件） | `data/drops.js:12-34`；`core/drops.js` | **娱乐** | 供商店/背包循环 |
| 48 | 背包 `inventory`（使用/出售） | `core/inventory.js`；`src/client/tabs/bag.js` | **娱乐** | 经济系统的终端 |
| 49 | 装扮 `dress`（11 件，Lv1–Lv50 门槛） | `data/shop.js:86-96`；`migrate.js:171-181` | **娱乐** | 花费 + 等级双重门槛 |
| 50 | 形态进化（猪猪王 / 恶魔猪） | `data/evolution.js:30-47` | **娱乐** | 条件 = Lv40 + 三维 20 + **打工 10 次 / 玩耍 20 次** + 商店买道具（`data/shop.js:102-109`，3000/6666 🪙） |
| 51 | 签到 12 天循环 | `core/daily.js:92-104`；`data/daily.js:24-57` | **娱乐** | 留存机制，奖励全是金币+商店货 |
| 52 | 在线礼包（1 小时 1 个，每天 8 个，最多攒 3 个） | `core/daily.js:113-133`；`data/daily.js:63-72` | **娱乐** | 同上 |
| 53 | 礼包概率表（6 档） | `data/daily.js:81-88` | **娱乐** | 抽奖 |
| 54 | 图鉴 `dex`（5 个分区） | `core/dex.js:6`；`src/client/tabs/dex.js` | **娱乐（收藏）** | `forms/skins/fish/items/souvenirs` 全是娱乐产物 |
| 55 | 番茄钟（15/25/45 分钟，+8 🪙 +6 心情，每天前 8 个） | `core/pomodoro.js:1-203`；`data/pomodoro.js:11-20` | **陪伴** | 注释原文「主人专注，猪在旁边陪着」（`core/pomodoro.js:3`）；奖励是附带的 |
| 56 | 换肤 / 自定义皮肤包 | `core/skins.js`；`data/skins.js`；`store/skin-pack.js` | **陪伴（外观）** | 打扮自己的宠物，无进度门槛 |
| 57 | 日记（模板拼句，最多 5 句，留 60 篇） | `core/diary.js`；`data/daily.js:91-121` | **陪伴** | 回顾「我们一起过的一天」，零 token |
| 58 | 居民卡（性格/口头禅/签名/星座/生日） | `core/profile.js:79-102`；`data/profile.js:20-59` | **陪伴** | 照动森居民卡（`data/profile.js:5`），纯身份 |
| 59 | 三维 traits（智力/魅力/武力） | `data/traits.js:36-42` | **娱乐** | 唯一作用 = 打工报酬加成（`data/traits.js:15-33`）+ 形态门槛 |
| 60 | 打工门槛校验（等级+课时+证书） | `core/work.js`；`data/jobs.js:16-23` | **娱乐** | 完全服务打工 |

### 9.5 基础设施与外壳

| # | 功能点 | 证据 | 归属 |
|---|---|---|---|
| 61 | Electron 窗口贴合内容 + 像素级点击穿透 | `apps/desktop/main.js`；`apps/desktop/lib/window-geometry.js` | 基础设施（轻量化） |
| 62 | 拖动 = 移动窗口 | `docs/DESIGN.md:227-228`；`docs/guides/gameplay.md:7` | 基础设施 |
| 63 | 存档原子写 + 节流 + 迁移 + 备份 | `store/state-file.js`；`store.js:16-95` | 基础设施 |
| 64 | 热更新（桌面版）/ 版本提示（DSH） | `apps/desktop/lib/versions.js`；`src/client/update-notice.js` | 基础设施 |
| 65 | `/pig` 斜杠命令（13 个子命令） | `docs/guides/gameplay.md:55-65`；`commands.js` | 基础设施（冗余入口） |
| 66 | 调试页（连点 7 次解锁） | `src/client/constants.js:52-61`；`src/client/tabs/dev.js` | 基础设施 |
| 67 | 前端单文件 `client.js`（241KB，构建产物） | `package.json:47` `build: node scripts/build-client.mjs`；来源 `src/client/**` | 基础设施 |

### 9.6 归属统计

| 归属 | 条目数 | 占比 | 条目号 |
|---|---|---|---|
| **陪伴** | **32** | 47.8% | 1–12, 14–27, 33, 40, 55–58 |
| **陪伴（生命感）——疾病子系统** | **3** | 4.5% | 28–30 |
| **娱乐** | **16** | 23.9% | 41–54, 59, 60 |
| **混合**（陪伴本体 + 娱乐依赖） | **4** | 6.0% | 31, 32, 34, 35 |
| **娱乐（载体）——activity 机制** | **4** | 6.0% | 36–39 |
| **基础设施** | **8** | 11.9% | 13, 61–67 |
| 合计 | 67 | 100% | — |

> **关键读数**：明确的娱乐玩法 **20 条**（16 娱乐 + 4 载体），占 29.9%；
> 陪伴 + 生命感 **35 条**，占 52.3%。再加 4 条「混合」需要在裁撤时逐条决定。

---

## 十、可安全裁撤的模块清单 + 依赖关系

### 10.1 结论先行：三条硬约束

> **约束 A：`settlement.js` 是唯一的时间入口，而它直接 import 了全部娱乐结算函数。**
> ```js
> // core/settlement.js:9
> import { CERTIFICATE_AFTER, ..., interestByKey, jobByKey, rarityByKey,
>          schoolStageByKey, stageForNextLesson, subjectByKey, traitBonus, tripByKey } from '../data.js'
> // core/settlement.js:13
> import { describeDrops, graduationDrops, studyDrops, workDrops } from './drops.js'
> // core/settlement.js:20
> import { finishAutoFishing } from './fishing.js'
> ```
> **不能靠「删文件」裁撤**——必须同时改 `settlement.js:9-20` 与 `finishActivity()`（`:171-181`）、
> 删掉 `finishWork`/`finishStudy`/`finishTrip`（`:206-310`）。这是整个裁撤里**唯一必须动核心文件**的地方。

> **约束 B：`migrate.js` 是第二个漏斗，它 import 了 9 个 `ensure*()`。**
> ```js
> // core/migrate.js:12-23
> ensureDaily(daily.js:13) · ensureDiary(diary.js:14) · ensurePomodoro(pomodoro.js:15)
> ensureDialogue(lines.js:16) · ensureProfile(profile.js:17) · ensureDex(dex.js:20)
> ensureBodyWeight(weight.js:21) · ensureFishing(fishing.js:22) · ensureSkins(skins.js:23)
> ```
> 删任何一个子系统，`migrate.js` 都要同步删 import 与调用（`:84-93`）。

> **约束 C：`{ ...egg, ...raw }` 会把未知字段原样写回。**
> ```js
> // core/migrate.js:31-32
> const egg = layEgg(...)
> const state = { ...egg, ...raw }
> ```
> **被裁掉模块的存档字段不会自动消失**，会一直被读进来、一直被写回磁盘。
> 想让存档真正瘦身，必须：**① 提高 `STATE_VERSION`（`core/constants.js:10`）→
> ② 在 `UPGRADES` 末尾追加一级 `up(raw)` 显式 `delete` 这些字段（`core/upgrades.js:84-173` 的既有模式）。**

### 10.2 裁撤分层

#### 🟢 A 级：可直接删（陪伴感零损失）

| 模块 | 路径 | 大小 | 删后必须同步改 |
|---|---|---|---|
| 打工逻辑 | `core/work.js` | — | `core.js:92` 导出；`core/settlement.js:206-241 finishWork` |
| 上课逻辑 | `core/school.js` | — | `core.js:89` 导出 |
| 兴趣班 | `core/interests.js` | — | `core.js:91` 导出；`settlement.js:183-204 finishInterest` |
| 旅行 | `core/travel.js` | — | `core.js:93` 导出；`settlement.js:286-310 finishTrip` |
| 钓鱼 | `core/fishing.js` | — | `core.js:100` 导出；`core/egg.js:13,56 emptyFishing`；`core/migrate.js:22,92`；`core/settlement.js:20,180`；`store/api.js` 的 fishing 方法 |
| 掉落 | `core/drops.js` | — | `core/settlement.js:13,231,269,278` |
| 职业数据表 | `data/jobs.js`（150 行） | — | `data.js:43`；`migrate.js:219 jobByKey`；`snapshot.js`/`render.js` |
| 课程数据表 | `data/school.js`（99 行） | — | `data.js:44`；`data/jobs.js:13`；`data/drops.js` 不依赖但 `settlement.js:253` |
| 兴趣数据表 | `data/interests.js` | — | `data.js:45`；`data/jobs.js:12`；`data/evolution.js` 无直接依赖 |
| 旅行数据表 | `data/travel.js`（87 行） | — | `data.js:46`；`settlement.js:287 tripByKey`；`migrate.js:226` |
| 鱼数据表 | `data/fish.js` | — | `data.js:55`；`core/dex.js:4`（`FISH` 用于图鉴）；`core.js:101` |
| 掉落数据表 | `data/drops.js` | — | `data.js:48`；`core.js` 未直接导出 |
| 钓鱼 UI | `src/client/tabs/fishing.js` + `src/client/normalize-fishing.js` + `src/client/css-fishing.js` | — | `src/client/constants.js:49` TABS 项；**须重跑 `pnpm build`（`package.json:47`）** |
| 学习/打工/旅行 UI | `src/client/tabs/{study,work,travel}.js` | — | `src/client/constants.js:43,44,46` TABS 项；重跑 build |

**A 级附带删除量**：`assets/` 里 `pig-*-work/study/trip.svg` 共 **9 个**失去引用
（`pig-fat` / `pig-king` / `pig-devil` 各 3 张，`skin-mint` 与 `piglet` 本就没有这些动作图）；
`src/client/art.js:11` 的 `ACTIVITY_ART` 映射（`work`/`study`/`interest`/`trip`/`fishing`）随之失效。
注意 `assets/pig-king-fish.svg` **本来就不存在**（`art.js:11` 把钓鱼映射到 `fish`，
但 `pig-king`/`pig-devil`/`pig-fat` 都没有 `-fish` 图，只有 `pig-devil-fly.svg`）。

#### 🟡 B 级：半娱乐，需要「拆一半」才能删

| 模块 | 不能整体删的原因（证据） | 安全的拆法 |
|---|---|---|
| `data/shop.js` | `CARE_KIND`（`:127`）与 `careItems()`（`:155-158`）是**照护动作的地基**，被 `core/care.js:9,79,115,141` 直接使用；`DEFAULT_TOY`（`:10-13`）是「玩耍永远可用」的保证 | **保留** `DEFAULT_TOY` + `food`/`bath`/`toy` 三个货架 + `CARE_KIND` + `careItems` + `itemByKey` + `itemsOfKind`；**删除** `bait`(3) / `dress`(11) / `medicine`(21) / `revive`(1) / `promotion`(2) = **38 项**（`data/shop.js:58-109`），以及 `KIND_ORDER`(`:113`)/`KIND_LABEL`(`:115`)/`DRESS_SLOTS`(`:135`)/`dressSlotByKey`(`:144`) |
| `data/illness.js` 的药品部分 | `MEDICINES`（`:126-129`）被 `data/shop.js:7,98` 引入货架；`REVIVE_ITEM`（`:132`）被 `data/shop.js:100`、`core/illness.js:17,43`、`core/state.js:9`、`core/inventory.js:167` 使用 | 若保留疾病（推荐）：**保留全部**。若裁撤疾病：连带删 `THRESHOLDS`（但 `core/views.js:9` 与 `core/growth.js:19` 也在用）。**建议不裁** |
| `core/inventory.js` | `useItem()` 分派 `promotion`→`evolution`（`:162`）、`medicine`→`illness`（`:175-181`）、`revive`→`state`（`:167-172`） | 保留 `useItem`（只留 medicine/revive/普通物品分支）、`buy`、`canAfford`；**删除** `wearItem`/`takeOff`/`dressView`（`core.js:88` 导出，依赖 `DRESS_SLOTS`） |
| `core/evolution.js` | 依赖商店道具（`data/shop.js:102-109`）与 `stats.jobs`/`stats.plays`（`data/evolution.js:36,44`）；被 `core/inventory.js:12`、`core/state.js`、`core/migrate.js:34`、`core/dex.js:4` 使用 | **整模块可删**，但必须同时改：`core/inventory.js:162`（promotion 分支）、`core/migrate.js:34`（`formByKey`）、`core/dex.js:4,33`（`FORMS`/`dex.forms`）、`core/settlement.js`（无）、`core.js:79` 导出、`data/evolution.js` 整表、`data/shop.js:102-109`、`assets/pig-king*.svg`(9) + `pig-devil*.svg`(10) = **19 个 SVG** |
| `core/weight.js` | 被 `core/care.js:17`（`reducePlayWeight`）、`core/settlement.js:19`（`settleWeight`/`reduceWorkWeight`）、`core/evolution.js:16`、`core/state.js:19,156`、`core/migrate.js:21`、`core.js:99` 使用 | **建议保留**（体型是陪伴反馈，见 §9.1 #10）。若删：`settleWeight` 从 `growOlder` 摘掉（`settlement.js:161`），`reducePlayWeight` 从 `care.js:100` 摘掉 |
| `core/daily.js` | 被 `core/migrate.js:13,87`、`store/api.js`（`recordOnline`）、`core.js:81` 使用；`data/daily.js:169` 的 `resolveGiftBucket` **从 `SHOP` 货架现取**（裁商店后该函数失效） | 签到+在线礼包可整删（**建议删**，属留存机制）；**保留** `dayKeyFor` 的转出（`:18`）与 `ensureDaily` 的空壳或改为 no-op。日记 `core/diary.js` **建议保留**（陪伴），它与 `daily.js` 共享 `dayKeyFor` 但**没有代码依赖** |
| `core/dex.js` | 被 **9 处**调用 `recordDex`：`core/daily.js:16`、`core/drops.js:21`、`core/evolution.js:15`、`core/fishing.js:7`、`core/settlement.js:18`、`core/skins.js:4`、`core/inventory.js:16`、`core/state.js:18`、`core/egg.js:12`（`emptyDex`）、`core/migrate.js:20` | 若删 A 级模块，`dex` 的 `fish`/`items`/`souvenirs`/`forms` 四个分区已空。**建议保留但缩到 `skins` 一个分区**（换肤仍属陪伴）。删则必须清掉上述 9 处调用 |

#### 🔴 C 级：不建议裁撤（陪伴内核 / 生命感）

| 模块 | 保留理由 |
|---|---|
| `core/clock.js` `core/constants.js` `core/random.js` `core/effects.js` | 全局地基，几乎被所有模块 import |
| `core/egg.js` `core/state.js` `core/migrate.js` `core/upgrades.js` | 开局 / 状态迁移 / 存档迁移，删了存档就废 |
| `core/care.js` `core/growth.js` `core/lines.js` `core/diary.js` `core/profile.js` `core/views.js` | 陪伴内核（§9.1/9.2） |
| `core/illness.js` | **唯一的死亡路径**。删掉后猪不再会死、`health` 变死字段、`还魂丹`/`墓碑`/`灵魂` 全部失效，项目退化成纯装饰 |
| `core/activity.js` | 机制中性（`awayBlockedReason`/`begin`/`callOffActivity`）。**但 `AWAY_MOODS`（`core/constants.js:104-109`）只服务外出玩法**，删 A 级后可保留但成空转；`core/views.js:28-31` 的 mood 分支与 `core/settlement.js:59-69` 的外出段也一并成为死代码 |
| `core/pomodoro.js` | **建议保留**：注释定位就是「主人专注，猪在旁边陪着」（`core/pomodoro.js:1-3`），是 DSH 场景下最贴合的陪伴功能 |
| `core/skins.js` + `data/skins.js` | 换肤是陪伴（打扮宠物），且皮肤包的 `SKIN_SCENES` 与照护动作对齐 |
| 全部 `store/` `apps/desktop/` *基础设施* | 与玩法无关 |

### 10.3 「裁掉谁必须同时裁掉谁」——传递闭包表

| 删这个 | 必须同时改这些文件（含行号） |
|---|---|
| `core/work.js` | `core.js:92`；`core/settlement.js:9,176,206-241`；`data/jobs.js` 整表；`src/client/constants.js:44`；`src/client/tabs/work.js` |
| `core/school.js` | `core.js:89`；`core/settlement.js:9,247-284`；`data/school.js`；`src/client/constants.js:43`；`src/client/tabs/study.js` |
| `core/interests.js` | `core.js:91`；`core/settlement.js:9,183-204`；`data/interests.js`；`data/jobs.js:12` |
| `core/travel.js` | `core.js:93`；`core/settlement.js:9,179,286-310`；`data/travel.js`；`src/client/constants.js:46`；`src/client/tabs/travel.js` |
| `core/fishing.js` | `core.js:100-101`；`core/egg.js:13,56`；`core/migrate.js:22,92`；`core/settlement.js:20,180`；`data/fish.js`；`data.js:55`；`core/dex.js:4`；`src/client/constants.js:49`；`src/client/tabs/fishing.js`；`src/client/normalize-fishing.js`；`src/client/css-fishing.js`；`store/api.js` 的钓鱼方法 |
| `core/drops.js` | `core/settlement.js:13,231,269,278`；`data/drops.js`；`data.js:48` |
| `data/shop.js` 的 5 个娱乐货架 | `core/inventory.js:151-154`（`buy` 需加 kind 白名单）；`core/migrate.js:108`（`sanitizeInventory` 用 `SHOP` 做白名单，改后旧存档里的药/装扮会被清空——**这是期望行为，但要写进迁移说明**）；`core/dex.js:4,73`；`core/daily.js:169`（`resolveGiftBucket` 从 `SHOP` 取池，裁签到后自然消失）；`core/weight.js:0`（不依赖）；`src/client/constants.js:90-91` |
| `core/evolution.js` | `core.js:79`；`core/inventory.js:12,162`；`core/migrate.js:9,34`；`core/dex.js:4,33`；`data/evolution.js` 整表；`data/shop.js:102-109`；`core/state.js:9,202-206`（调试页 `patch.form`）；`src/client/tabs/crown.js`；`assets/pig-king*.svg`(9) + `pig-devil*.svg`(10) |
| `core/daily.js`（签到+礼包） | `core.js:81`；`core/migrate.js:13,87`；`core/egg.js`（无 daily 字段，靠 `ensureDaily` 补）；`store/api.js:113`（`recordOnline`）；`data/daily.js:24-88`（保留 `DIARY_*` 与 `DIARY_LINES`）；`src/client/tabs/home.js` 的签到气泡；`src/client/scene.js:68-70`（`dailyHint`） |
| `core/dex.js` | `core.js:72`；9 处 `recordDex` 调用（见 §10.2 B 级）；`core/egg.js:12,55`；`core/migrate.js:20,90`；`src/client/constants.js:41`；`src/client/tabs/dex.js`；`src/client/css-dex.js` |
| `core/pomodoro.js` | `core.js:98`；`core/migrate.js:15,89`；`core/state.js:14,143-147,188-199`；`store/api.js:119`；`data/pomodoro.js`；`src/client/constants.js:48`；`src/client/tabs/pomodoro.js`；`src/client/pomodoro-clock.js` |
| `core/illness.js` | ⚠️ **不建议**。若坚持：`core.js:85`；`core/care.js:13,102`；`core/inventory.js:13,175-181`；`core/settlement.js:14,124-150`；`core/views.js:12,24-27`；`core/state.js:16`（`die` 经 settlement 转出）；`core/egg.js:47`；`core/growth.js:19,38-41`；`data/illness.js` 整表；`data/shop.js:7,98-100`；`core.js:96`（`GRAVE`/`SOUL`）；`src/client/tabs/status.js` |
| `core/activity.js` | `core.js:86`；`core/school.js:10`；`core/interests.js:10`；`core/travel.js:10`；`core/work.js:10`；`core/fishing.js:4`；`core/settlement.js:58-69`；`core/views.js:28-31`；`core/constants.js:104-109`（`AWAY_MOODS`） |

### 10.4 裁撤后的极小内核（建议保留集合）

```
packages/pet-core/src/
├─ core/
│  ├─ clock.js        时间/年龄/等级派生
│  ├─ constants.js    动作表/衰减率/日长（可精简 AWAY_* 与 ACTIONS 的 cooldown 字段）
│  ├─ random.js       种子随机
│  ├─ effects.js      记忆/公告/属性结算
│  ├─ care.js         喂食/洗澡/玩耍/摸摸 + 被动投喂
│  ├─ growth.js       成长曲线与照顾系数
│  ├─ illness.js      五链疾病 + 死亡（生命感核心）
│  ├─ settlement.js   ★ 必须重写：删 finishWork/Study/Trip/AutoFishing 与相关 import
│  ├─ diary.js        宠物日记
│  ├─ lines.js        台词与回复
│  ├─ profile.js      居民卡
│  ├─ views.js        心情/属性条（删掉 activity mood 分支）
│  ├─ weight.js       体型反馈
│  ├─ skins.js        换肤
│  ├─ egg.js          开局（删 emptyFishing）
│  ├─ state.js        复活/领养/改名/时间倍率（删 pomodoro 与 form 相关）
│  ├─ migrate.js      ★ 必须重写：9 个 ensure 里删 4 个
│  └─ upgrades.js     ★ 追加 v13：delete 被裁字段
└─ data/
   ├─ life.js growth.js illness.js traits.js weight.js lines.js profile.js
   ├─ minutes.js random 相关
   ├─ skins.js
   ├─ shop.js         ★ 裁到只剩 food/bath/toy + DEFAULT_TOY
   └─ daily.js        ★ 裁到只剩 DIARY_*
```
估算：`core/` 从 **30 个模块**（实测 `Get-ChildItem core\*.js` = 30）降到 **18 个**；
`data/` 从 **19 个**降到 **11 个**（两边都是按本节的保留集合点数）。

### 10.5 裁撤的风险清单

| 风险 | 说明 | 证据 |
|---|---|---|
| **存档字段残留** | 删模块 ≠ 删字段。`{...egg, ...raw}` 会把 `lessons`/`interests`/`souvenirs`/`fishing`/`dex.fish` 原样带回磁盘 | `core/migrate.js:31-32` |
| **升级备份不可回退** | v12→v13 的 `delete` 是单向的；虽然 `keepPreUpgradeCopy()` 会留 `.v12-backup-*`，但**用户不会知道怎么用** | `store/state-file.js:66-74` |
| **`sanitizeInventory` 依赖 `SHOP`** | 裁掉药/装扮后，旧存档里的这些物品会被**静默清空**（`SHOP.some(item => item.key === key)` 判 false） | `core/migrate.js:108` |
| **形态数据与美术的硬绑定** | `data/evolution.js:9` 规定新形态要放 `<art>.svg` **和** 8 个动作立绘；裁掉形态 = 19 个 SVG 失去引用，但 `assets/` 里删不删是独立决定 | `data/evolution.js:8-10` |
| **`client.js` 是构建产物** | 改 `src/client/**` 后必须跑 `pnpm build`（`scripts/build-client.mjs`），否则 241KB 的 `client.js` 仍是旧的 | `package.json:47` |
| **测试面很宽** | 直接覆盖被裁模块的测试文件：`test/school-jobs.test.js`、`test/fishing.test.js`、`test/fishing-client.test.js`、`test/evolution.test.js`、`test/devil-evolution.test.js`、`test/c3-promotion.test.js`、`test/dex.test.js`、`test/dex-client.test.js`、`test/pomodoro.test.js`、`test/pomodoro-clock.test.js`、`test/skins*.test.js`、`test/daily.test.js`、`test/weight*.test.js`、`test/upgrades.test.js`、`test/host.test.js`（含 13 个 `action` 分支）、`test/client.test.js`、`test/bundle.test.js` | `test/` 目录实测 **34 个** `*.test.js`（另有 `apps/desktop/test/`） |
| **`conventions.test.js` / `core-boundary.test.js` 是架构守卫** | 前者查文案与常量集中，后者禁止领域层调 `Math.random()`。删模块时若留下悬空引用，这两个会先炸 | `test/conventions.test.js`、`test/core-boundary.test.js` |

### 10.6 建议的裁撤顺序（依赖安全的拓扑序）

```
① 先裁叶子（无内部依赖）：
   core/travel.js, core/interests.js, core/school.js, core/work.js,
   core/drops.js, core/fishing.js  + 对应 data/*.js
   → 同步改：core/settlement.js（删 4 个 finish*）、core/egg.js、core/migrate.js、core.js

② 再裁商店面：
   data/shop.js 裁到 food/bath/toy；core/inventory.js 删 dress 分支；
   core/evolution.js + data/evolution.js + 19 个形态 SVG
   → 同步改：core/migrate.js:9,34、core/dex.js:4,33、core/state.js:202-206、core/inventory.js:162

③ 再裁留存机制：
   core/daily.js 的签到/在线礼包 + data/daily.js 的 SIGN_IN_*/ONLINE_GIFT/GIFT_TABLE
   → 同步改：core/migrate.js:13,87、store/api.js:113、src/client/scene.js:68-70

④ 收窄收藏：
   core/dex.js 只留 skins 分区；删 src/client/tabs/dex.js

⑤ 最后写迁移 + 重建前端：
   在 core/upgrades.js 追加 { to: 13, up(raw){ delete raw.lessons; … } }
   core/constants.js:10 STATE_VERSION = 13
   pnpm build（scripts/build-client.mjs）
   node --test "test/**/*.test.js" "apps/desktop/test/*.test.js"
```

**第 ① 步就要动 `core/settlement.js`，这是全流程里唯一的高风险改动**——它是时间入口，
`test/settlement.test.js`（6 个测试）与 `test/core.test.js`（1313 行）都直接依赖它的行为。

---

## 附：本文档发现的问题清单（供后续任务参考）

| # | 问题 | 证据 | 影响 |
|---|---|---|---|
| 1 | `AWAY_MULTIPLIER = 1.8` 是死代码（import 了但没导出、没使用） | `data/illness.js:50` vs `core.js:24,95-96` | 无功能影响，但会让裁撤时误判 |
| 2 | `LEVEL_TITLES` 最后一项 Lv80「神话」**不可达**（`MAX_LEVEL = 60`） | `data/life.js:80` vs `data/growth.js:15` | 一条永远看不到的文案 |
| 3 | `core/constants.js:20-29` 的成长阶梯注释描述的是**已废弃的旧形态名** | `core/constants.js:20-29` vs `data/life.js:31-48` | 误导读者 |
| 4 | `assets/elder.svg` 是孤儿资源（`elder` 阶段已被删除） | `core/migrate.js:82`；`test/core.test.js:168` | 3.0KB 死资源 |
| 5 | `react-refuse.svg` 从未实现（ART-SPEC 列为待办） | `docs/ART-SPEC.md:99` vs `assets/` 全量 35 个 SVG | 拒绝时只有抖动，没有立绘 |
| 6 | `young` / `middle` 阶段**没有立绘**，只靠 emoji + size 变大 | `src/client/art.js:20-21`；`src/client/scene.js:76-77`；`data/life.js:41,45` | 「长大」的视觉反馈很弱 |
| 7 | `docs/DESIGN.md` 多处过期：路径 `dsh-pig/`、外出 ×1.8、疾病每 25 分钟一期 | `docs/DESIGN.md:130, 182` | 文档与源码不一致 |
| 8 | `docs/DESIGN.md:99` 写「+22 / +50 / +16」，但 `pet` 实际是 **+10** 不是 +16 | `docs/DESIGN.md:99` vs `core/constants.js:68` | 文档笔误 |
| 9 | `test/client.test.js:319` 手写还魂丹价格 **150**，真值 **800** | `test/client.test.js:319` vs `data/illness.js:132` | 只影响该 mock 测试 |
| 10 | `hatch()` 清零 `xp`，但纸盒期的 `stats` 会带进正文 | `core/egg.js:96-98` vs `core/care.js:35-41` | 新猪的统计数字含纸盒期事件 |
| 11 | **事实基线小误**：`PROJECT-REF.md:42` 记「34 个 SVG」，实测 `assets/` 为 **35 个**（漏了 `pig-devil-fly.svg`）；`:52` 记恶魔猪场景 8 个，实为 9 个 | `PROJECT-REF.md:42,52` vs 实测 `Get-ChildItem assets\*.svg` = 35 | 影响资源清单类任务 |
| 12 | `core/constants.js:10-29` 有一行**悬挂的空文档注释**（`:20-21`）紧跟实际注释，TypeScript 会把后一段当实现注释而非 JSDoc | `core/constants.js:20-29` | 只影响 `@ts-check` 提示，无运行时影响 |

---

*分析完成 · task-2 · 数据源 `F:\piggy\_ref`（只读）*
