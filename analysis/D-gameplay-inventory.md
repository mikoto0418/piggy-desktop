# D · 娱乐玩法全量清点与裁撤影响链

> 对象：`F:\piggy\_ref`（dsh-piggy v0.26.1，存档 v12）。
> 本文所有 `文件:行号` 均相对 `_ref/` 根目录，已逐条对照源码核对。
> 产出人：gameplay-analyst（task-4）。

---

## 0. 先校准三件事（影响后面所有判断）

| 任务书里的提法 | 实际情况 | 证据 |
|---|---|---|
| `packages/pet-core/src/data/skool/课程表` | **不存在 `skool/` 目录**。课程表真值在 `data/school.js`（9 门课 × 5 学段） | `packages/pet-core/src/data/school.js:32-72` |
| `core/upgrades.js` = 「晋升与升级（升级项全集、消耗、效果、上限）」 | **它是存档结构迁移表，不是玩法**。5 级迁移 `to: 8/9/10/11/12`，`FIRST_UPGRADE_FROM = 7` | `packages/pet-core/src/core/upgrades.js:84-173`、`:176` |
| 「升级/晋升」玩法 | 真身是**形态（猪猪王/恶魔猪）**，在 `data/evolution.js` + 商店「晋升」货架 | `packages/pet-core/src/data/evolution.js:30-47`、`data/shop.js:102-109` |
| `client.js`（241KB） | **是构建产物**，由 `npm run build` 从 `src/client/` 生成。裁撤时要改的是 `src/client/`，再重新 `build` | `client.js:1`、`package.json:47` |

另：`packages/pet-core/src/data/` 下没有 `shop` 之外的商品表；`data/travel.js` 只有旅行与纪念品，物品表在 `data/shop.js`。

---

## 1. 学习 school.js —— 9 门课 / 5 学段 / 每门课各自毕业

### 1.1 课程表全集（9 门，`data/school.js:32-42`）

| # | key | 名字 | emoji | 主属性 | 顺带属性 |
|---|---|---|---|---|---|
| 1 | `chinese` | 语文 | 📖 | 智力 | 魅力 |
| 2 | `mathematics` | 数学 | 🔢 | 智力 | — |
| 3 | `politics` | 政治 | ⚖️ | 智力 | 武力 |
| 4 | `music` | 音乐 | 🎵 | 魅力 | — |
| 5 | `art` | 艺术 | 🎨 | 魅力 | 智力 |
| 6 | `manners` | 礼仪 | 🎩 | 魅力 | — |
| 7 | `pe` | 体育 | 🏃 | 武力 | 魅力 |
| 8 | `labour` | 劳技 | 🔧 | 武力 | 智力 |
| 9 | `wushu` | 武术 | 🥋 | 武力 | — |

**关键机制**：9 门课**各算各的课时**，没有「9 门一起升」。第 N 节课属于哪个学段，由**这门课已上过的节数**决定（`stageForNextLesson()`，`data/school.js:85-88`）。

### 1.2 时长 / 学费 / 产出（5 个学段，`data/school.js:66-72`）

| 学段 | key | emoji | 覆盖节数 | 时长 | 学费 | 主属性+ | 顺带+ | 饱食 | 心情 |
|---|---|---|---|---|---|---|---|---|---|
| 小学 | `primary` | 📚 | 1–9 | 20 min | 10 | +1 | 0 | −5 | −1 |
| 中学 | `middle` | 🏫 | 10–20 | 30 min | 25 | +2 | +1 | −7 | −2 |
| 大学 | `college` | 🏛 | 21–40 | 45 min | 60 | +3 | +1 | −10 | −3 |
| 研究生 | `graduate` | 🔬 | 41–95 | 60 min | 120 | +4 | +2 | −12 | −4 |
| 学无止境 | `beyond` | 🌌 | 96+ | 60 min | 150 | +5 | +2 | −12 | −4 |

> 每门课的「时长/花费/产出」不是课程自身属性，而是**当前学段**的属性；课程之间只差主属性/顺带属性。

### 1.3 起始与结束条件（`core/school.js:57-81`）

- 拒绝条件（依次）：未孵化 `box` / 科目不存在 `unknown` / 已去世 `dead` / 正在外面 `away` / 健康 ≤ 1 `weak`（`TOO_WEAK_HEALTH = 1`，`core/constants.js:102`）/ 金币 < 学费 `poor` / 饱食 < 15 `hungry`。
- 学费**先扣后开班**，`begin()` 失败会退还（`core/school.js:69-78`）。
- **没有等级门槛**——学段只由课时数决定，钱够 + 饱食够就能一直上。

### 1.4 毕业（有毕业，每门课 4 次）

- 毕业节数 `GRADUATION_LESSONS = [9, 20, 40, 95]`（`data/school.js:75`）。
- 上完第 9/20/40/95 节即「这门课**该学段毕业**」，与其它课无关。
- 毕业结算（`core/settlement.js:268-277`）：必得 **3 件**毕业礼（`GRADUATION_DROP_COUNT = 3`，`data/drops.js:18`）+ 额外成长 **+500**（`GRADUATION_GROWTH`，`data/growth.js:63`）+ `stats.graduations += 1` + 公告/台词。
- 每节课固定成长 **+40**（`STUDY_GROWTH_PER_LESSON`，`data/growth.js:60`），由 `core/settlement.js:265` 结算。
- 居民卡显示「毕业总数」= 各门课跨过的毕业节点数之和（`core/profile.js:86-87`）。

### 1.5 兴趣 interests（另一套 16 门，不计入 school 阶梯）

- **16 门兴趣课**（`data/interests.js:16-37`）：摄影📷/编程💻/跳舞💃/健身🏋 + 智力（围棋♟️/英语🔤/天文🔭/魔方🧩）+ 魅力（书法🖌️/吉他🎸/魔术🎩/插花💐）+ 武力（游泳🏊/轮滑🛼/攀岩🧗/足球⚽）。
- 单次 30 或 60 分钟，花费 35–90 金币，固定 **属性 +2**（`data/interests.js:17-36`）。
- 同一门上满 **5 次**（`CERTIFICATE_AFTER = 5`，`data/interests.js:14`）拿证书；证书是**4 份高级工作的上岗凭证**：摄影师/教练/程序员/舞蹈家（`data/jobs.js:73-76`）。
- 结算在 `core/settlement.js:183-204`：属性 +2、`interests[key] += 1`、饱食 −4、心情 +3、`stats.interests += 1`、成长 +40、满 5 次发证书公告。
- 可重复上，不在校阶梯内（`core/interests.js:33-55`）。

### 1.6 面板 / UI

- 学习页 `src/client/tabs/study.js`（学段页 + 科目页 + 兴趣页）；`snapshot.js:305-314` 出 9 门课，`:286-302` 出 5 个学段，`:266-280` 出 16 门兴趣。
- 斜杠命令：`/pig study <科目>`（`commands.js:65-77`）、`/pig interest <兴趣班>`（`commands.js:117-127`）。
- ⚠️ 客户端残留 **7 学段表**（幼儿园/课外/小学/中学/高中/大学/研究生，`src/client/constants.js:92-100`），只在 `ui.view.stages` 为空时兜底（`src/client/tabs/study.js:55`），实际永远用不到 —— 是 B4 之前的死代码。

---

## 2. 打工 work.js —— 33 个工种 / 无职位晋升

### 2.1 工种全集（33 个，`data/jobs.js:47-86`）

| 档位 | 数量 | 时长 | 报酬区间 | 门槛档 |
|---|---|---|---|---|
| 起步（不用上学） | 4 | 30–45 min | 40–70 | Lv1–5（送外卖要体育 3 节） |
| 小学毕业档 | 8 | 60 min | 150–180 | Lv3–9 + 某 1–2 门课 9 节 |
| 中学毕业档 | 8 | 120 min | 480–560 | Lv12–15 + 某 1–2 门课 20 节 |
| 大学毕业档 | 7 | 240 min | 1500–2000 | Lv18–26 + 某门课 40 节（4 份还要证书） |
| 研究生档 | 6 | 480 min | 4800–8000 | Lv30–50 + 多门课 40/95 节 / 九门各 40 节 |

- 数量核对：4+8+8+7+6 = **33**（数据表实测 33 条）。
- 报酬区间 **40（搬砖/发传单）～ 8000（总裁）**；时长集合 **{30, 45, 60, 120, 240, 480}**。
- 门槛字段有 5 种（`data/jobs.js:16-23`）：`level` / `lessons{课:节数}` / `every`（九门各 N 节）/ `anyOf{count,lessons}` / `certificate`（兴趣证书）。
- 未达标时**逐条列出差什么**（`jobChecklist()`，`data/jobs.js:106-134`；`jobRequirement()`，`:143-147`）。

### 2.2 体力 / 饱食消耗（按时长分档，`data/jobs.js:26-33`）

| 时长 | 饱食 | 清洁 |
|---|---|---|
| 30 min | −6 | −4 |
| 45 min | −8 | −6 |
| 60 min | −15 | −12 |
| 120 min | −18 | −10 |
| 240 min | −34 | −26 |
| 480 min | −60 | −40 |

> 这些值在**结算时**一次性加到状态上（`core/settlement.js:221-222`），不是打工期间逐分钟扣。

### 2.3 报酬结算公式（`core/settlement.js:206-241`）

```
base      = job.coins
withTrait = base × traitBonus(trait, 属性点).pay
coins     = 病中 ? max(1, round(withTrait × 0.5)) : round(withTrait)
```

- `traitBonus(...).pay = min(3, 1 + 点数 × 1/150)`（`data/traits.js:15,19,27-33`）——150 点翻倍，封顶 **×3**。
- 病中半薪 `SICK_PAY_MULTIPLIER = 0.5`（`data/illness.js:42`）。
- **时长不再受属性影响**：`TRAIT_SPEED_PER_POINT = 0`（`data/traits.js:22`），所以 `startWork` 里 `minutes = job.minutes`（`core/work.js:38-40`）。
- 结算同时：`stats.jobs += 1`、`stats.coinsEarned += coins`、按实际时长减超重（`reduceWorkWeight`，`core/weight.js:58-61`）、成长 `outingGrowth(minutes) = round(分钟/60 × 25)`（`data/growth.js:57`、`core/growth.js:110`）。
- 掉落在 §6。

### 2.4 打工期状态变化

- 外出衰减 ×1.4（`AWAY_DECAY_MULTIPLIER`，`core/constants.js:83`），且有**地板 15**（`AWAY_FLOOR`，`:86`；`core/settlement.js:108-117`）——单次外出不会把任一状态条清零。
- 病中外出：病程速度 ×2（`SICK_AWAY_MULTIPLIER`，`data/illness.js:45`；`core/settlement.js:135-138`）。
- 连续出门 ≥3 次且中间没在家休息满 60 分钟 → 头晕风险（`ILLNESS_ONSET.overworkStreak = 3`、`restMinutes = 60`，`data/illness.js:157-160`）。
- 可随时召回；**打工召回不给钱**（`core/activity.js:58-79`）。

### 2.5 有没有晋升？

**没有职位晋升链**。33 个工种是平铺的「门槛表」，不存在「搬砖 → 工头」这种升级路径。用户说的「晋升」在本项目里指的是**形态**（猪猪王/恶魔猪，见 §7）。

---

## 3. 旅行 travel.js —— 7 个目的地 / 25 件纪念品

### 3.1 目的地全集（`data/travel.js:26-66`）

| # | key | 名字 | emoji | 时长 | 花费 | 心情 | 饱食 | 纪念品数 | 最好稀有度 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `suburb` | 郊游 | 🧺 | 60 min | 60 | +10 | −8 | 3 | 稀有 |
| 2 | `mountain` | 名山大川 | 🏔 | 180 min | 200 | +16 | −20 | 4 | 传说 |
| 3 | `hotspring` | 泡温泉 | ♨️ | 360 min | 380 | +20 | −28 | 3 | 稀有 |
| 4 | `sea` | 看海 | 🌊 | 480 min | 620 | +24 | −42 | 4 | 传说 |
| 5 | `oldtown` | 古镇 | 🏮 | 720 min | 1100 | +30 | −50 | 3 | 传说 |
| 6 | `abroad` | 出国 | 🌍 | 1440 min | 2000 | +38 | −80 | 4 | 传说 |
| 7 | `aurora` | 看极光 | 🌌 | 1440 min | 3600 | +44 | −90 | 4 | 传说 |

合计 **25 件纪念品**（3+4+3+4+3+4+4）。

### 3.2 带回的物品：确定性轮转，不是概率

`core/settlement.js:286-310`：`pick = trip.souvenirs[state.stats.trips % trip.souvenirs.length]` —— 第 N 次去同一目的地，拿到该地列表里的第 N 件。稀有度是**物品固有属性**，不掷骰。

| 稀有度 | key | 标签 | emoji | 售价 |
|---|---|---|---|---|
| 普通 | `common` | 普通 | ⚪ | 60 |
| 稀有 | `rare` | 稀有 | 🔵 | 320 |
| 传说 | `legend` | 传说 | 🟡 | 1600 |

（`data/travel.js:16-20`）25 件的分布：普通 **11** / 稀有 **9** / 传说 **5**。

### 3.3 旅行中猪的状态变化

- 花费在出发时扣（`core/travel.js:44-47`），召回**全额退还**（`core/activity.js:72-76`）。
- 外出衰减 ×1.4 + 地板 15（同上）。
- 回来：心情 += 目的地 `happiness`、饱食 += `satiety`（负数）、`stats.trips += 1`、成长 `outingGrowth(minutes)`（`core/settlement.js:301-304`）。
- 纪念品可**卖出**换钱（`core/travel.js:22-35`），价格由稀有度决定，`stats.sales += 1`。
- 旅行**不**减体重（`reduceWorkWeight`/`reduceFishingWeight` 都没在这里调）；减体重只有玩耍、打工、钓鱼、自然代谢。

---

## 4. 钓鱼 fishing.js —— 15 种鱼 / 唯一的内嵌小游戏

### 4.1 玩法机制（两段：等待 + 圆盘技能检定）

服务端只判「成/败」，随机在抛竿时一次定完（`core/fishing.js:64-82`）：

1. **抛竿** `castFishing`：检查没有未过期的 `pending`、猪在家、饱食 ≥1、**有鱼饵且扣 1 个**（`:70-79`）→ 立刻抽定鱼种与尺寸（`:74-77`）→ `pending.phase = 'waiting'`，`bitesAt = now + 2000~8000ms`，`hookUntil = bitesAt + 2000`（**2 秒**提竿窗口），`expiresAt = now + 60s`。
2. **提竿** `hookFishing`（`:84-93`）：太早 `early`、超窗 `escaped`、成功转 `hooked`。
3. **小游戏**（客户端，`src/client/tabs/fishing.js`）：指针沿圆盘顺时针转，进入绿区点击/空格；黄区（完美）一次 +2 格。`qteRules()`（`:90-98`）：
   - 绿区角度 `115 − 难度×0.38`（难度 12 → ~110°，难度 100 → ~77°）
   - 黄区角度 `16 − 难度×0.06`
   - `rotationsPerSecond = 0.28 + 难度×0.0018`（实际角速度还乘 0.36，`:194`）
   - 需要连续命中 **2 / 3 / 4** 次（难度 <45 / 45–79 / ≥80）
   - 空满 **3 整圈**鱼才跑（`:196-203`）；关面板即判失败（`:192`）
4. **结果** `resolveFishing`（`:95-102`）→ `keepFish`（`:110-122`）进鱼篓 + 记图鉴 + `stats.fishCaught += 1` + 减重 3 分钟当量。

### 4.2 鱼种全集（15 种，`data/fish.js:3-19`）

| 稀有度 | 数量 | 权重 | 鱼（难度 / 售价） |
|---|---|---|---|
| 普通 common | 8 | 60 | 鲫鱼12/8、鲤鱼18/12、沙丁鱼22/14、鳀鱼25/16、河鲈28/18、鳊鱼30/20、鲶鱼34/24、青花鱼38/28 |
| 少见 uncommon | 4 | 24 | 鲑鱼48/48、河豚55/62、鳗鱼61/78、金枪鱼66/96 |
| 稀有 rare | 2 | 8 | 鲟鱼78/160、黄金锦鲤86/220 |
| 传说 legend | 1 | 1 | 月影鱼100/300 |

- 尺寸 `minCm~maxCm` 随机（`:61`），长度 8–220 cm 区间；售价 **8–300**。
- 权重表 `WEIGHT`（`core/fishing.js:11`）+ 抛竿力度加成（`:47-56`）+ 鱼饵加成（`rarityBoost`）。
- 鱼饵 3 种（`data/shop.js:58-60`）：蚯蚓 5 币（boost 0）、鲜虾 15 币（0.6）、夜光 40 币（1.5）。

### 4.3 与时间 / 天气的关系

- **时间**：4 个时段，按**设备本地时间**（`core/fishing.js:42-45`）：早 05–09、午 10–15、晚 16–20、夜 21–04；每种鱼只在特定时段出现（`data/fish.js` 的 `times` 字段）。
- **天气**：**全项目没有天气系统**（全库 grep `weather|天气|rain` 仅命中台词「今天天气好像不错」，`data/lines.js:111`）。任务书里的「与天气关系」答案是没有。

### 4.4 自动钓鱼（每天限 2 次）

- `startAutoFishing`（`:167-182`）：时长只能 30 或 60 分钟；每天上限 `AUTO_LIMIT = 2`；**预扣** `分钟/3` 个鱼饵（30→10 个、60→20 个）。
- `finishAutoFishing`（`:184-202`）：每 3 分钟一次尝试，成功率 `max(0.2, 0.95 − 难度×0.0075)`，收获进鱼篓，`stats.fishingAuto += 1`。
- 提前召回**退还全部预扣鱼饵**（`core/activity.js:67-71`）。

### 4.5 鱼的两个出口

- **喂**：饱食 `+= min(售价/2, 60)`（`core/fishing.js:141-150`）。
- **卖**：按 `caught.price` 原价（`:152-160`）。⚠️ C 批次任务卡曾写「自动钓鱼售价按 70%」（`docs/tasks/C-round.md:84`），**实现与数值单都是原价**（`docs/tasks/numbers/C5-fish.md:23`），以数值单为准。

### 4.6 这是全项目**唯一**的内嵌小游戏

- 全库 grep `minigame|小游戏` 仅 8 处：`test/fishing.test.js:88,103`（测试名）、`docs/tasks/C-round.md`（任务卡）、截图 `docs/screenshots/c5-minigame.png`。
- 代码实现在 `src/client/tabs/fishing.js:109-208`（构建进 `client.js:3432-3530`），用 `requestAnimationFrame`（`:10,204`）。
- **没有其它小游戏**：没有对战、没有抽卡、没有点击器、没有音乐节奏。

---

## 5. 商店 shop.js + store/api.js —— 66 件 / 8 个货架

### 5.1 货架与数量（`data/shop.js:45-110`、货架顺序 `:113`）

| 货架 | key | 件数 | 价格区间 | 是否消耗 |
|---|---|---|---|---|
| 食物 | `food` | **10** | 6–130 | 消耗 |
| 洗浴 | `bath` | **8** | 6–78 | 消耗 |
| 玩具 | `toy` | **10** | 22–260 | 消耗（+ 免费默认小皮球，`data/shop.js:10-13`） |
| 鱼饵 | `bait` | **3** | 5–40 | 消耗 |
| 装扮（家当） | `dress` | **11** | 80–8000 | **买一次永久** |
| 药品 | `medicine` | **21** | 30–500 | 消耗 |
| 复活 | `revive` | **1** | 800 | 消耗 |
| 晋升 | `promotion` | **2** | 3000 / 6666 | 消耗 |
| **合计** | | **66** | | |

- 药品 21 = 5 条病链 × 4 级（20 件，`data/illness.js:71-117`）+ 百草丹 500 币（`data/illness.js:123`）。药价按级 `[30, 70, 140, 260]`（`data/illness.js:60`）。
- 装扮带**等级门槛**（Lv1–50，`data/shop.js:86-96`），挂在猪身上 **6 个点位**（`DRESS_SLOTS`，`data/shop.js:135-142`：头/脸/脖子/身子/背后/脚），同点位只能穿一件（`core/inventory.js:99-111`）。
- 晋升货架：王冠 3000（`form: 'king'`）、恶魔契约 6666（`form: 'devil'`）。
- ⚠️ `core/inventory.js:35` 注释写「shows all twelve」，实际装扮是 **11** 件（注释过期）。

### 5.2 货币来源与消耗

**来源**（5 条）：

| 来源 | 公式 | 证据 |
|---|---|---|
| 打工 | 见 §2.3 | `core/settlement.js:219` |
| 卖鱼 | 按鱼原价 | `core/fishing.js:155` |
| 卖纪念品 | 稀有度价 60/320/1600 | `core/travel.js:31` |
| 签到 + 在线礼包 | 12 天循环 + 每小时 1 个（每天上限 8、最多攒 3） | `core/daily.js:64-79,92-104,113-133` |
| 番茄钟 | 每个 +8（每天前 8 个） | `core/pomodoro.js:140` |
| 初始金币 | 500 | `core/egg.js:50` |

**消耗**：买物（`core/inventory.js:67,75`）、学费（`core/school.js:69`）、兴趣课（`core/interests.js:43`）、旅行（`core/travel.js:47`）、看医生（`DOCTOR_MARKUP = 1.5` × 对症药价，`data/illness.js:135`）、番茄钟不收钱。

### 5.3 接口面（裁撤时要一起改的地方）

- 服务端动作表：`routes.js:57-112` —— `buy`（`:103`）、`use`（`:104`）、`sell`（`:107`）、`wear`（`:109`）、`doctor`（`:105`）、`giveAll`（`:111`）。
- store 方法：`store/api.js:164`（buy）、`:167`（useItem）、`:170`（seeDoctor）、`:171`（sellSouvenir）、`:202`（wear）。
- 命令：`/pig shop`（`commands.js:101-104`）、`/pig buy`（`:105-110`）、`/pig use`（`:111-116`）、`/pig sell`（`:128-136`）、`/pig wear`（`:137-146`）。
- 面板：商店页 `src/client/tabs/shop.js`、背包页 `src/client/tabs/bag.js`；快照 `snapshot.js:352-375`（`shop`）、`:183`（`dress`）、`:184`（`inventory`）。
- 客户端货架名/顺序：`src/client/constants.js:90-91`（`KIND_TITLE` / `KIND_ORDER`，与 `data/shop.js:113` 重复定义，需同步）。

---

## 6. 背包与物品 inventory.js + drops.js

### 6.1 物品分类与持有形态

- 消耗品按 `inventory: { key: count }` 计数（`core/inventory.js:19-30`）。
- **装扮不走计数**：`dress: [...]`（已拥有）+ `worn: [...]`（穿着中）（`core/inventory.js:38-53`）。
- 鱼**不在背包里**，在独立的 `fishing.bag[]`（鱼篓，`core/fishing.js:13,116`）。
- 纪念品在 `souvenirs: [...]`（`core/travel.js:25-30`）。
- 免费的默认玩具「小皮球」恒在（`DEFAULT_TOY`，`data/shop.js:10-13`；`inventoryView` 里填 `Infinity`，`core/inventory.js:28`），所以**玩耍永远不会因为空背包而不能用**。

### 6.2 掉落来源与概率（`data/drops.js` / `core/drops.js`）

| 来源 | 概率 | 价值上限 | 货架权重 | 证据 |
|---|---|---|---|---|
| 打工回来 | 2 件 **15%** / 1 件 **50%** / 0 件 35% | 该班报酬 × **0.3** | 食物 0.45 / 洗浴+玩具 0.40 / 1 级药 0.15 | `data/drops.js:12,21-25,28`；`core/drops.js:66-70` |
| 上课回来 | **30%** 1 件 | 40 金币 | 同上 | `data/drops.js:15,31`；`core/drops.js:73-75` |
| 毕业礼 | **必得 3 件** | 30–150 金币 | 同上但**去掉药品** | `data/drops.js:18,34`；`core/drops.js:78-81` |
| 签到 | 12 天固定表（第 8 天还魂丹、第 12 天豪华大餐） | — | — | `data/daily.js:24-54` |
| 在线礼包 | 每小时 1 个，概率表 6 档 | — | — | `data/daily.js:63-88`；`core/daily.js:185-193` |

### 6.3 使用效果

`core/inventory.js:156-189` `useItem()` 分派：食物/洗浴/玩具 → `applyEffects`（`core/care.js:127-135` 混合道具自身数值）；药品 → `medicate`（吃错药**照样消耗且加重**，`:175-181`）；复活 → 仅死后可用（`:167-172`）；晋升 → 交给 `useFormItem`（`:162`）；装扮 → 拒绝（`:160`，用「穿上」而非「使用」）。

### 6.4 有没有装饰 / 家具系统？

**没有家具、没有房间、没有摆件**。全库 grep `家具|furniture|装饰|decorat` 只命中 2 处无关注释（`src/client/scene.js:60`、`test/client.test.js:379`）。

「装扮」是**穿在猪身上**的 11 件（帽子/围巾/翅膀…），不是房间装饰。**没有任何可摆放、可升级、可布置的空间**——这是好事：裁撤时不涉及「家」的重构。

---

## 7. 晋升与升级 —— 两件完全不同的事

### 7.1 `core/upgrades.js` = 存档迁移（不是玩法，**不要删**）

| 级 | 内容 | 证据 |
|---|---|---|
| → v8 | `hatched` 不再由 xp 推断 | `core/upgrades.js:85-94` |
| → v9 | xp 改成长值、按新曲线折算、形态改由等级决定、补性别 | `:95-110` |
| → v10 | 四种通用药下架退款、`riskMinutes` 换成外出计数 | `:111-130` |
| → v11 | 23 门旧课并进 9 门、旧职业在途班次按旧报酬结算 | `:131-162` |
| → v12 | 形态存成 `form`、`finalForm` 改名 | `:163-172` |

- `FIRST_UPGRADE_FROM = 7`（`:176`），`STATE_VERSION = 12`（`core/constants.js:10`）。
- 迁移前自动备份到 `state.json.v<版本>-backup-<时间>`（`store/state-file.js:67-72`）。
- **裁撤任何玩法都必须考虑它**：v11 迁移专门为 school/jobs 写过映射表（`V11_SUBJECT_OF`、`V11_OLD_JOB_PAY`）——删掉 school 后这段迁移仍要保留，否则老存档升不上来。

### 7.2 真正的「晋升」= 形态（2 个，`data/evolution.js:30-47`）

| 形态 | key | 道具（商店） | 条件 | 盖住的装扮点位 |
|---|---|---|---|---|
| 猪猪王 | `king` | 王冠 👑 3000 | Lv40 + 智力/魅力/武力各 20 + 本代打工 10 次 | 头、背后 |
| 恶魔猪 | `devil` | 恶魔契约 😈 6666 | Lv40 + 武力/魅力各 20 + 本代玩耍 20 次 | 头、背后 |

- 条件不齐**不消耗道具**（`core/evolution.js:99-117`）。
- 形态**不加任何收益**，只换立绘（`data/evolution.js:5-6`）。
- 形态优先于皮肤（`docs/guides/skins.md:30-38`）。
- 没有「升级项 / 消耗 / 上限」式的强化系统（没有属性点分配、没有装备强化、没有技能树）。

### 7.3 等级 / 成长（与玩法耦合最深的一条）

- 满级 **60**（`data/growth.js:15`），曲线 `xp = 122 × L²`（`:18,25`）。
- 成长来源：被动时间（`100/小时 × 照顾系数`，`data/growth.js:28`）、陪主人真实干活（每轮 +3 / 每工具 +1，每天上限 300，`data/growth.js:51-54`）、**上课/兴趣 +40**、**毕业 +500**、**打工/旅行 +25/小时**、**钓鱼减重但不加成长**。
- 形态按等级换：幼年 Lv1 → 青年 Lv10 → 成年 Lv40（`data/life.js:31-48`）。
- **裁撤含义**：删掉 school/work/travel 后，Lv40 只能靠被动时间（约 2.7 个月）和陪干活，形态晋升基本不可达 → 形态/图鉴形态分区事实上一起死掉。

---

## 8. 图鉴 dex.js —— 5 个分区 / 110 条基础条目 / **没有完成度奖励**

- 分区：`DEX_SECTIONS = ['forms', 'skins', 'fish', 'items', 'souvenirs']`（`core/dex.js:6`）。
- 条目基数（`dexView`，`core/dex.js:77-138`）：

| 分区 | 条目数 | 来源 |
|---|---|---|
| 形态 | **2** | `FORMS`（王/恶魔） |
| 皮肤 | **2** 起 | 默认猪 + 薄荷（+ 玩家导入的自定义皮肤，`core/skins.js:28-35`） |
| 鱼 | **15** | `FISH` |
| 道具 | **66** | `SHOP`（含装扮/晋升/复活） |
| 纪念品 | **25** | `ALL_SOUVENIRS` |
| **基础合计** | **110** | 2+2+15+66+25 |

- 记录字段：`{firstAt, count}`，鱼额外记 `maxSizeCm`（`core/dex.js:12-18,104-108`）。
- 回填：老存档从当前形态、背包、已购装扮、纪念品反推（`core/dex.js:33-54`）。
- **没有完成度奖励**：`dexView` 只产数据，客户端只画进度条（`src/client/tabs/dex.js:53-57`），没有任何「集齐 N 条送 X」的逻辑。
- 记录点分散：买物（`core/inventory.js:68,79`）、变身（`core/evolution.js:58`）、换肤（`core/skins.js:49,63`）、钓到鱼（`core/fishing.js:107`）、旅行（`core/settlement.js:294`）、掉落（`core/drops.js:57`）、签到/礼包（`core/daily.js:71`）、一键拿齐（`core/inventory.js:135,139`）。
- **裁撤含义**：图鉴是**寄生模块**——它本身没有玩法，全靠别的模块喂数据。删掉 school/work/travel/fishing/shop 后，110 条里只剩形态 2 + 皮肤 2 还有意义。

---

## 9. 日记 diary.js —— 每天一篇 / 14 个模板 / **不能导出**

- 记录方式：事件点旁边加一句 `noteToday(state, kind)`（`core/diary.js:60-64`），归属日由「跨天」时决定。
- **触发频率：每天最多 1 篇**，在跨过 **06:00** 后第一次读状态时落笔（`core/diary.js:88-102`；`store/api.js:116` 每次 `freshen()` 都调）。
- 一篇最多 **5 句**（`DIARY_MAX_SENTENCES = 5`，`data/daily.js:94`），从 **14 个模板**（`DIARY_LINES`，`data/daily.js:103-118`）里按优先级挑：吃 → 洗澡 → 被摸 → 打工 → 上课 → 毕业 → 旅行 → 生病 → 吃药 → 吃错药 → 升级 → 长大 → 敲代码 → 工具。
- 什么都没发生也有一句（`DIARY_EMPTY_LINE`，`data/daily.js:121`）。
- 保留最近 **60 篇**（`DIARY_MAX = 60`，`data/daily.js:91`）。
- 事件来源（`noteToday` 调用点）：`core/care.js:46,105`、`core/growth.js:64,71`、`core/illness.js:135,156,204,209,233`、`core/settlement.js:199,227,228,274,282,307,308`。
- **不能导出**：没有导出接口、没有下载按钮，只存在存档 `diary` 字段里，面板在背包页显示（`src/client/tabs/bag.js` 的 `renderDiary`；`snapshot.js:198`）。
- ⚠️ 日记模板里有 **7 句依赖被裁玩法**（打工/上课/毕业/旅行/纪念品；`data/daily.js:107-110`）。删掉这些玩法后这 7 个模板永远不触发，`composeDiary` 只会剩吃/洗澡/摸/生病/升级/长大/敲代码。

---

## 10. 番茄钟 pomodoro.js —— **建议保留（陪伴工具，不是娱乐）**

### 10.1 事实

- 时长 **15 / 25 / 45** 分钟 + 休息 5 分钟（`data/pomodoro.js:11,14`）。
- 完成奖励：**+8 金币、+6 心情**，**每天前 8 个**给奖励，之后只计数（`data/pomodoro.js:17,20`）。
- 中途放弃不给奖励；**已到点再点放弃按「完成」结算**（`core/pomodoro.js:161-176`）。
- 专注期间猪进入**免打扰**（复用 `dialogue.quiet`），结束后恢复用户原来的设置（`core/pomodoro.js:106-116,143-145`）。
- 状态存在服务端 `state.pomodoro`，**关着面板也走**（`store/api.js:119` 每次请求结算）。
- 猪会说开场/完成/放弃三组台词（`data/lines.js:196-210`）。
- 完成时客户端弹一次通知（无权限退回气泡，`src/client/panel.js:94-99`）。
- 面板：`src/client/tabs/pomodoro.js`、`src/client/pomodoro-clock.js`，状态页顺带显示「今天 N 个」（`src/client/tabs/status.js:44-48`）。
- 猪在打工/上课/旅行时**开不了**番茄钟（`core/pomodoro.js:81-89`，`reason: 'away'`）。

### 10.2 为什么算「陪伴工具」而不是娱乐

1. **它的主体行为是主人的**：番茄钟计量的是用户自己的专注时长，猪只是「在旁边陪着」（`core/pomodoro.js:3` 注释原文：「主人专注，猪在旁边陪着」）。
2. **奖励是象征性的**：+8 金币对比打工 40–8000，只是「有个反馈」，不足以驱动刷取；每天 8 个封顶更是明确防刷。
3. **它不产生玩法循环**：不开新场景、不掉物品、不进图鉴、不推进形态、不失败惩罚。
4. **它与其他玩法的唯一耦合是「不能同时外出」**（`core/pomodoro.js:87`）——删掉打工/旅行反而让它更连贯。
5. **它是唯一把「免打扰」用起来的入口**：删掉它，B6 做的 `dialogue.quiet` 就只剩状态页一个手动开关。

**建议：保留**（若用户只想要最小桌宠，可只留计时 + 免打扰，去掉金币/心情奖励，改造成纯「陪专注」工具 —— 改动面仅 `data/pomodoro.js:17` 与 `core/pomodoro.js:139-142`）。

---

## 11. 结算 settlement.js —— 一切时间推进的唯一入口

### 11.1 统一结算哪些玩法

`decay(state, nowMs)`（`core/settlement.js:45-71`）是**所有**时间推进的入口，由 `store/api.js:117` 每次读状态时调用。它把「上次见到 → 现在」切成最多两段：**外出段**（到活动结束）+ **在家段**，每段按 **5 分钟**（`SETTLE_STEP_MS`，`core/constants.js:95`）走步（`core/settlement.js:79-86`），所以长离线也能复现「班次在 18:56 结束就按 18:56 结算」。

`finishActivity()`（`:171-181`）按 `activity.kind` 分派 **5 种**：

| kind | 结算函数 | 做什么 |
|---|---|---|
| `work` | `finishWork`（`:206-241`） | 报酬、饱食/清洁消耗、掉落、减重、成长、统计 |
| `study` | `finishStudy`（`:247-284`） | 课时 +1、属性、毕业判定、掉落、成长 |
| `interest` | `finishInterest`（`:183-204`） | 属性 +2、计数、证书判定 |
| `trip` | `finishTrip`（`:286-310`） | 轮转纪念品、心情/饱食、成长 |
| `fishing` | `finishAutoFishing`（`core/fishing.js:184-202`） | 按 3 分钟一次尝试结算自动钓鱼 |

### 11.2 周期与其它职责

- **结算周期**：活动在**自己的 endsAt 时刻**结算；衰减按 5 分钟步进；跨天口径统一为 **06:00**（`DAY_STARTS_AT_HOUR = 6`，`data/growth.js:66`，签到/礼包/日记/每日上限共用）。
- 同一步里还做：状态条衰减（外出 ×1.4、地板 15）、疾病发病与病程推进（病中外出 ×2）、体重自然回落（每猪日 2%）、年龄累计、被动成长（`:94-100`）。
- 上限：无「最大补算时长」，一个月离线约 8640 步（`:92-93` 注释明确算过）。

### 11.3 裁撤含义（重要）

删掉 school/work/travel/fishing 后，`finishActivity` 的 5 个分支只剩 `interest`（若也删则一个不剩），`activity` 概念本身失去意义 —— 但**不要顺手删 `decay()`**：状态衰减、生病、死亡、成长、体重、年龄全在里面，那是「养一只猪」的骨架。

---

## 12. 小游戏结论

**全项目只有 1 个内嵌小游戏：钓鱼的圆盘技能检定**（§4.6）。删掉钓鱼 = 删掉全部小游戏。

---

# 娱乐玩法总表

> 「数据规模」一律给准数（条目数），均可由对应数据表实测复核。

| 模块 | 功能点 | 数据规模 | 依赖的其它模块 | 建议 |
|---|---|---|---|---|
| **学习** `core/school.js` + `data/school.js` | 9 门课 × 5 学段，逐门课时 + 4 次毕业 | **9 门课**、**5 学段**、毕业节点 **4 个**（9/20/40/95） | 金币、饱食、心情、`traits`、`xp`、掉落、日记、居民卡、图鉴(无)、打工门槛 | **整体删除**（用户点名不要） |
| **兴趣课** `core/interests.js` + `data/interests.js` | 16 门可重复课 → 5 次拿证 | **16 门**、**16 张证书** | 金币、`traits`、`xp`、打工证书门槛、居民卡「证书数」 | **整体删除**（属「学习」大类） |
| **打工** `core/work.js` + `data/jobs.js` | 33 工种、6 种时长档、属性加成报酬 | **33 个工种**、门槛字段 5 类 | `lessons`/`interests`(门槛)、`traits`(报酬)、金币、饱食/清洁、掉落、减重、日记、图鉴(道具) | **整体删除** |
| **旅行** `core/travel.js` + `data/travel.js` | 7 目的地、确定性带回纪念品、可卖 | **7 个目的地**、**25 件纪念品**（普通 11/稀有 9/传说 5） | 金币、心情、`souvenirs`、`xp`、图鉴(纪念品)、居民卡「纪念品数」 | **整体删除** |
| **钓鱼** `core/fishing.js` + `data/fish.js` | 抛竿→提竿→圆盘 QTE→鱼篓；自动钓鱼；喂/卖 | **15 种鱼**（普通 8/少见 4/稀有 2/传说 1）、**3 种鱼饵**、**4 个时段** | 鱼饵(商店)、饱食、金币、减重、图鉴(鱼)、`activity`、**唯一的小游戏** | **整体删除**（连小游戏一起） |
| **商店** `data/shop.js` + `core/inventory.js` | 8 货架 66 件；买/用/穿/卖 | **66 件**：食物 10、洗浴 8、玩具 10、鱼饵 3、装扮 11、药品 21、复活 1、晋升 2 | 金币、`inventory`、`dress`/`worn`、图鉴(道具)、喂食/洗澡/玩耍、疾病 | **保留骨架**（只留食物/洗浴/玩具/药品/复活 = 50 件，砍鱼饵 3 + 装扮 11 + 晋升 2）——**照顾玩法没有商店会断供** |
| **背包与物品** `core/inventory.js` + `data/drops.js` | 计数背包 + 装扮 + 使用效果 + 3 类掉落 | 掉落出口 **3 个**（打工/上课/毕业） | 商店、喂食/洗澡/玩耍、疾病、图鉴 | **保留骨架**（背包必留；掉落 3 个出口随玩法一起死，应删 `core/drops.js`） |
| **形态晋升** `core/evolution.js` + `data/evolution.js` | 2 形态：买道具 + 达标 + 使用 | **2 个形态**（王 3000 / 恶魔 6666） | Lv40、`traits`、`stats.jobs`/`stats.plays`、商店晋升货架、图鉴(形态)、装扮点位 | **整体删除**（Lv40 全靠 school/work/travel 才可达；留着也拿不到） |
| **等级/成长** `core/growth.js` + `data/growth.js` | 满级 60；被动成长 + 干活加成 + 上课/打工/旅行加成 | 满级 **60**、称号 **7** 档 | 全部外出玩法、体重、形态、日记 | **保留骨架**（删掉外出的成长源，只留「陪主人干活 + 时间」两条） |
| **体重** `core/weight.js` + `data/weight.js` | 3 档体型；玩耍/打工/钓鱼/代谢减重 | **3 档**（正常/圆润 ≥1.3×/胖胖 ≥1.6×）、玩耍每日 **10** 次 | 玩耍、打工、钓鱼、等级、立绘 | **保留骨架**（删外出玩法后只剩玩耍 + 自然代谢） |
| **图鉴** `core/dex.js` | 5 分区 110 条，只记录不给奖 | **5 分区**、基础 **110 条** | 形态、皮肤、鱼、道具、纪念品 —— **全靠别人喂** | **保留骨架 or 整体删除**（删玩法后只剩形态 2 + 皮肤 2） |
| **日记** `core/diary.js` + `data/daily.js:91-121` | 每天 1 篇、14 模板、最多 5 句、留 60 篇 | **14 个模板**、**60 篇**上限、每日 **1** 篇 | 吃/洗澡/摸、打工、上课、毕业、旅行、生病、升级、干活 | **建议保留**（陪伴向；需删 7 个依赖被裁玩法的模板） |
| **番茄钟** `core/pomodoro.js` + `data/pomodoro.js` | 15/25/45 专注 + 5 分钟休息；强制免打扰；+8🪙/+6 心情（每天前 8） | 时长 **3** 档、奖励上限 **8**/天 | 金币、心情、`dialogue.quiet` | **建议保留**（陪伴工具，非娱乐；可选：去掉奖励改纯计时） |
| **日常** `core/daily.js` + `data/daily.js` | 12 天签到 + 在线礼包（每小时 1 个） | 签到 **12** 档、礼包概率 **6** 档、每天上限 **8**、最多攒 **3** | 金币、道具表、图鉴(道具) | **保留骨架**（是「每天来看看」的轻量钩子；奖励池会随商店缩水，需重调 `GIFT_TABLE`） |
| **结算** `core/settlement.js` | 统一时间推进：衰减/疾病/活动结算/死亡/成长 | 分派 **5** 种活动、步长 **5 分钟** | 全部 | **必须保留**（这是骨架，不是娱乐） |
| **存档迁移** `core/upgrades.js` | 5 级迁移（→v8/9/10/11/12） | **5 级** | 全部 | **必须保留**（含 school/jobs 的旧映射表） |

---

# 删除影响链

> 每一行 = 「删掉这个模块」需要动的**全部**地方。按此表逐项处理可避免漏改导致的白屏 / 崩溃 / 老存档升不上来。

## A. 通用基础设施（删任何玩法都要动）

| 位置 | 文件:行号 | 说明 |
|---|---|---|
| 数据表导出 | `packages/pet-core/src/data.js:44-46`（及相邻 `export *`） | 删模块要同步删 `export *` |
| 核心导出 | `packages/pet-core/src/core.js:88-103` | 40+ 个再导出，删模块必须同步 |
| 快照 | `snapshot.js:11-12`（导入）、`:88-111`（空态）、`:124-207`（正常态） | 少一个 view 字段，旧客户端会读到 undefined |
| 动作表 | `routes.js:57-112` | 每个玩法 1–10 个 op，删了要一起删，否则 `unknown action` 是**运行时报错** |
| store 方法 | `store/api.js:10-60`（导入）、`:129-202` | 同上 |
| 斜杠命令 | `commands.js:37-197` + `:195`（提示串）+ `:243-244`（描述/hint） | 命令分支与帮助文案 |
| 文本报告 | `render.js:188-231`（work/study/trip 报告）、`:330-351`（帮助） | ⚠️ `render.js:344-345` 已是**过期文案**（还写着 `work <odd|site|office>`、`trip <suburb|mountain|sea|abroad>`） |
| 客户端页签注册 | `src/client/constants.js:38-50`（`TABS`）、`src/client/index.js:29,112`（drill 键）、`src/client/panel.js:14-27`（导入）、`:144-166`（分派） | 删页签要动这 4 处 |
| 主屏配色 | `src/client/tabs/home.js:12-15`（`APP_COLOR`） | 每个页签一个颜色键 |
| 快照归一化 | `src/client/normalize.js:248,259-273,365` 等 | 缺字段会崩，删字段要同步 |
| 场景立绘映射 | `src/client/art.js:11`（`ACTIVITY_ART = {work, study, interest, trip, fishing}`） | 删外出玩法要清这张表 |
| 打包产物 | `client.js`（4943 行，构建生成）+ `npm run build`（`package.json:47`） | **必须重新 build**；`test/bundle.test.js`、`test/conventions.test.js:66-82` 会校验产物与源码一致 |
| 测试 | `test/` 35 个文件；见下逐模块 | 不删测试 = 红 |
| 文档 | `docs/guides/gameplay.md`（`:14-27` App 表、`:53-65` 命令表、`:39` 每日签到/礼物）、`README.md`、`CHANGELOG.md` | 真值文档必须同步，否则下一个人按文档改代码 |

## B. 逐模块影响链

### B1 删「学习」`school` + 「兴趣课」`interests`

| 类别 | 具体 |
|---|---|
| 核心文件 | `core/school.js`、`core/interests.js`、`data/school.js`、`data/interests.js` |
| 需求文件 | `core/settlement.js:247-284`（`finishStudy`）、`:183-204`（`finishInterest`）、`:176-179`（分派）；`core/work.js:32-35`（门槛）；`data/jobs.js:12-13`（导入）、`:106-134`（`jobChecklist` 的 lesson/certificate 分支） |
| 存档字段 | `lessons{}`、`interests{}`、`stats.courses`、`stats.lessons`、`stats.graduations`、`stats.interests`、`activity.kind='study'/'interest'`、`traits`（这些是唯一来源） |
| UI 面板 | 学习页 `src/client/tabs/study.js`（含 `STAGES` 兜底 `:55`）、`src/client/constants.js:92-100`（7 学段死代码）、背包页的毕业/证书展示、居民卡 `src/client/tabs/card.js:58`（证书/毕业计数）、状态页三维 |
| 动作/命令 | `routes.js:89-90`、`store/api.js:135-138`、`commands.js:65-77,117-127`、`:195`、`:243-244` |
| 快照 | `snapshot.js:92,94,177,180,229,266-314`（`subjects`/`interests`/`stages`/`jobFacts`） |
| 测试 | `test/school-jobs.test.js`（整份）、`test/core.test.js:356-1050`（校阶梯 + 兴趣大量用例）、`test/client.test.js:304`（学段 fixture）、`:592`（首页页签断言）、`test/host.test.js`（命令）、`test/dev-coverage.test.js`、`test/store.test.js` |
| 连带死亡 | 打工的门槛（33 工种里 **30 个**要课时/证书，只有搬砖 `bricks`/发传单 `flyers`/洗碗工 `dishes` 3 个只看等级）、4 张证书工资（`data/jobs.js:73-76`）、毕业礼掉落（`core/drops.js:78-81`）、日记 2 个模板、居民卡 2 个计数 |

### B2 删「打工」`work`

| 类别 | 具体 |
|---|---|
| 核心文件 | `core/work.js`、`data/jobs.js` |
| 需求文件 | `core/settlement.js:206-241`（`finishWork`）、`:176`（分派）、`:13`（导入）；`core/weight.js:58-61`（`reduceWorkWeight` 仍被钓鱼复用）；`core/drops.js:66-70` |
| 存档字段 | `stats.jobs`（**形态条件用**）、`stats.coinsEarned`、`activity.kind='work'`、`coins`、`satiety`、`cleanliness`、`outingStreak`、`lastActiveAt` |
| UI 面板 | 打工页 `src/client/tabs/work.js`、`src/client/art.js:11`（`work` 场景立绘）、`src/client/scene.js`（外出道具/进度）、背包页、日记 |
| 动作/命令 | `routes.js:88`、`store/api.js:132`、`commands.js:55-63`、`:195`、`:243-244`；`render.js:189-200,233-242`、`:330-351` |
| 测试 | `test/core.test.js:444-530,1010-1070`、`test/school-jobs.test.js`（门槛部分）、`test/settlement.test.js`、`test/weight.test.js`、`test/chatter.test.js:83`、`test/evolution.test.js:70-73`、`test/host.test.js:725`、`test/client.test.js:592` |
| 连带死亡 | 金币主来源（唯一稳定收入）、打工掉落、外出减重、形态「打工 10 次」条件、日记 2 个模板 |

### B3 删「旅行」`travel`

| 类别 | 具体 |
|---|---|
| 核心文件 | `core/travel.js`、`data/travel.js` |
| 需求文件 | `core/settlement.js:286-310`（`finishTrip`）、`:179`（分派）；`core/state.js:41`（`INHERITED` 含 `souvenirs`）；`core/migrate.js:9,49,141-165`（`sanitizeSouvenirs` + `tripByKey`）、`:226`（活动校验） |
| 存档字段 | `souvenirs[]`（每项含 key/emoji/label/rarity/story/from/fromLabel/gotAt）、`stats.trips`、`stats.sales`、`activity.kind='trip'`、`happiness`、`satiety` |
| UI 面板 | 旅行页 `src/client/tabs/travel.js`（含纪念品故事卡 `:37-87`）、背包页纪念品分区 `src/client/tabs/bag.js:23,36,68,185-219`、`src/client/index.js:113-114,179`（`souvenirPick`）、图鉴纪念品博物馆 `src/client/tabs/dex.js:27` + `core/dex.js:128-137`、居民卡「纪念品」计数 `src/client/tabs/card.js:58`、`src/client/art.js:11`（`trip` 场景） |
| 动作/命令 | `routes.js:91,107`、`store/api.js:144,171`、`commands.js:79-88,128-136`、`:195`、`:243-244`；`render.js:219-231,330-351` |
| 测试 | `test/core.test.js:838-1010`（纪念品 41 件上限等）、`test/dex.test.js`（纪念品回填）、`test/dex-client.test.js:110-114`、`test/host.test.js:773`、`test/client.test.js:592` |
| 连带死亡 | 图鉴 25 条、`stats.sales` 一半、日记 2 个模板、素描的稀有度价（`data/travel.js:16-20`） |

### B4 删「钓鱼」`fishing`

| 类别 | 具体 |
|---|---|
| 核心文件 | `core/fishing.js`、`data/fish.js`；客户端 `src/client/tabs/fishing.js`、`src/client/normalize-fishing.js`、`src/client/css-fishing.js`（经 `src/client/styles.js:12` 引入） |
| 需求文件 | `core/settlement.js:180`（`finishAutoFishing` 分派）、`:20`（导入）；`core/activity.js:67-71`（鱼饵退还分支）；`core/migrate.js:22,92,216,224-238`（活动校验 + `ensureFishing`）；`core/egg.js:13,56`（`emptyFishing()` 进初始存档）；`core/weight.js:64-66`（`reduceFishingWeight`）；`core/dex.js:104-115`（鱼分区） |
| 存档字段 | `fishing{pending, bag[], seq, autoDay, autoTrips}`、`stats.fishCaught`、`stats.fishingAuto`、`stats.sales`、`coins`、`satiety`、`weightG`、`dex.fish{}`、`activity.kind='fishing'`（带 `baitKey`/`baitCount`） |
| UI 面板 | 钓鱼页（含**唯一小游戏**）、背包页鱼篓 `src/client/tabs/bag.js:69,86`、`src/client/constants.js:48-49`（TABS）、`src/client/art.js:11`（`fish` 场景）、`src/client/tabs/home.js:14`（配色）、调试页「钓鱼」组 + 跳过等待 `src/client/tabs/dev.js`、皮肤场景 `fish`（可选） |
| 动作/命令 | `routes.js:92-100`（9 个 op）、`store/api.js:145-153`、`snapshot.js:105,200`；**无斜杠命令**（钓鱼只有面板入口） |
| 测试 | `test/fishing.test.js`、`test/fishing-client.test.js`、`test/dev-coverage.test.js:197-222`（FISH 覆盖断言）、`test/weight.test.js` |
| 连带死亡 | 鱼饵 3 件（商店）、图鉴 15 条、外出减重一个来源、`ACTIVITY_ART` 的 `fish` 场景、小游戏全部 |

### B5 删「商店 / 装扮 / 晋升形态」

| 类别 | 具体 |
|---|---|
| 核心文件 | `data/shop.js`、`core/inventory.js`、`core/evolution.js`、`data/evolution.js` |
| 需求文件 | `core/settlement.js`（召唤 `decay`）、`core/care.js:9,79-90,114-154`（**喂食/洗澡/玩耍都要从货架取物**）、`core/illness.js`（药品）、`core/daily.js:11,169-173`（礼包从货架抽）、`core/drops.js:40-45`（掉落从货架抽）、`core/migrate.js:9,101-111,171-181`（背包/装扮清洗）、`core/dex.js:116-127`（道具分区） |
| 存档字段 | `inventory{}`、`dress[]`、`worn[]`、`coins`、`stats.purchases`、`form`、`dex.items{}`、`dex.forms{}` |
| UI 面板 | 商店页 `src/client/tabs/shop.js`、背包页 `src/client/tabs/bag.js`（分类/物品/装扮/鱼/纪念品/日记 6 个分区，`:49-184`）、装扮渲染层 + `DRESS_SLOTS`（`data/shop.js:135-142`）、图鉴道具目录（含搜索/筛选，`src/client/tabs/dex.js`）、`src/client/constants.js:90-91`（`KIND_TITLE`/`KIND_ORDER`）、`src/client/effects.js:115`（购买特效） |
| 动作/命令 | `routes.js:103-105,109,111`、`store/api.js:164-170,202`、`commands.js:101-116,137-146`；`render.js:244-259`（买）、`renderUse` |
| 测试 | `test/store.test.js`、`test/c3-promotion.test.js`、`test/evolution.test.js`、`test/devil-evolution.test.js`、`test/king-art.test.js`、`test/dex.test.js`、`test/dex-client.test.js`、`test/daily.test.js`、`test/client.test.js` |
| 建议切法 | **别整体删**。食物 10 / 洗浴 8 / 玩具 10 / 药品 21 / 复活 1 = **50 件**是照顾与生病玩法的供应链；只删鱼饵 3 + 装扮 11 + 晋升 2 = **16 件**最安全 |

### B6 删「图鉴」`dex`

| 类别 | 具体 |
|---|---|
| 核心文件 | `core/dex.js` |
| 记录点（都要摘掉） | `core/inventory.js:16,68,79,135,139`、`core/evolution.js:15,58`、`core/skins.js:4,49,63`、`core/fishing.js:7,105-107`、`core/settlement.js:18,294`、`core/drops.js:21,57`、`core/daily.js:16,71` |
| 存档字段 | `dex{forms,skins,fish,items,souvenirs}`（每项 `{firstAt, count[, maxSizeCm]}`）、`state.js:41`（`INHERITED` 含 `dex`）、`core/migrate.js:20,90`（`ensureDex`） |
| UI 面板 | 图鉴页 `src/client/tabs/dex.js`（5 分区 + 详情 + 搜索筛选 + 博物馆格）、`src/client/css-dex.js`、`snapshot.js:98,137`、`src/client/normalize.js:2901-2946`（`normalizeDex`）、`src/client/constants.js:41`（TABS）、`src/client/tabs/home.js:13`（配色）、`:14`（`crown`→`dex` 格子） |
| 动作/命令 | **无面板动作**（纯读）；无斜杠命令；仅 `routes.js` 的 `giveAll` 间接影响 |
| 测试 | `test/dex.test.js`、`test/dex-client.test.js`、`test/dev-coverage.test.js`（形态入口断言与图鉴解耦，可保留） |
| 关系 | 图鉴是**纯消费者**，删除它**不会破坏任何玩法**，只会少一块展示面 —— 是裁撤时**风险最低**的一块 |

### B7 删「日记」

| 类别 | 具体 |
|---|---|
| 核心文件 | `core/diary.js`、`data/daily.js:90-121`（模板段） |
| 记录点 | `core/care.js:18,46,105`、`core/growth.js:25,64,71`、`core/illness.js`（5 处）、`core/settlement.js:17,199,227-228,274,282,307-308` |
| 存档字段 | `diary{entries[{day,text}], today{day,counts}}`（最多 60 篇） |
| 入口 | `core/migrate.js:14,88`（`ensureDiary`）、`store/api.js:27,116`（`writeDiaryIfNewDay` 在每次 freshen 里）、`snapshot.js:103,198`、`src/client/tabs/bag.js`（`renderDiary`） |
| 测试 | `test/daily.test.js:318-330`、`test/client.test.js`（背包日记） |
| 注意 | 删日记要顺手删掉 **18 个 `noteToday(...)` 调用点**，否则 `ensureDiary` 仍会被隐式创建 |

### B8 删「番茄钟」

| 类别 | 具体 |
|---|---|
| 核心文件 | `core/pomodoro.js`、`data/pomodoro.js`；客户端 `src/client/tabs/pomodoro.js`、`src/client/pomodoro-clock.js` |
| 需求文件 | `store/api.js:28-30,119,197-198`（`freshen` 里结算）、`core/state.js:14`（dev patch 快进）、`core/migrate.js:15,89`、`core/egg.js`（`ensurePomodoro` 经 migrate）、`snapshot.js:104,199`、`core/lines.js` 的 3 个场景（`data/lines.js:196-210`） |
| 存档字段 | `pomodoro{startedAt,minutes,todayDone,day,restUntil,finishedAt,quietBefore}`、`dialogue.quiet`、`coins`、`happiness` |
| UI 面板 | 番茄钟页、`src/client/io.js:10`、`src/client/panel.js:19,94-99,163,282`、`src/client/tabs/status.js:44-48`（今天 N 个）、`src/client/tabs/home.js:14`（配色）、场景角标 `src/client/scene.js`、`src/client/css-tiles.js`（`.dp-pomo`）、调试页 `src/client/tabs/dev.js:131-132` |
| 动作/命令 | `routes.js:74-75`、`store/api.js:197-198`；**无斜杠命令** |
| 测试 | `test/pomodoro.test.js`（约 23 条）、`test/pomodoro-clock.test.js`、`test/client.test.js` |
| 建议 | **不要删。** 若砍奖励，只改 `data/pomodoro.js:17` + `core/pomodoro.js:139-142` |

### B9 删「日常（签到 / 在线礼包）」

| 类别 | 具体 |
|---|---|
| 核心文件 | `core/daily.js`、`data/daily.js:19-88` |
| 存档字段 | `daily{signIn{lastDay,index,total}, online{day,onlineMs,given,unclaimed}}` |
| 需求文件 | `store/api.js:31,113`（`recordOnline` 在 freshen 里）、`core/migrate.js:13,87`、`snapshot.js:102,197`、`core/lines.js` 的 `signIn`/`gift` 场景、`src/client/tabs/status.js`（签到按钮/礼包角标）、`src/client/tabs/home.js:29-30`（红点） |
| 动作 | `routes.js:72,76`、`store/api.js:195,201`；无斜杠命令 |
| 测试 | `test/daily.test.js`（含 10000 次抽样分布断言 `:247-256`）、`test/client.test.js` |
| 注意 | `GIFT_TABLE`（`data/daily.js:81-88`）按**货架 kind + 价格上限**抽，商店缩水后要重调，否则礼包价值崩塌 |

## C. 存档字段总览（删玩法时要知道哪些字段变成死人）

| 字段 | 归属玩法 | 删后处理建议 |
|---|---|---|
| `lessons{}` | 学习 | 保留迁移兼容，值可留（`INHERITED` 里要摘掉） |
| `interests{}` | 兴趣课 | 同上 |
| `traits{intel,charm,strong}` | 学习/兴趣/打工加成 | **保留**（状态页展示 + 仍可被其它来源加） |
| `souvenirs[]` | 旅行 | 可留作历史收藏，或迁移时清空 + 退币 |
| `fishing{...}` | 钓鱼 | 清理；`ensureFishing` 可删 |
| `dex{...}` | 图鉴 | 若删图鉴则一并清 |
| `diary{...}` | 日记 | 若删日记则一并清 |
| `pomodoro{...}` | 番茄钟 | 若保留则不动 |
| `daily{...}` | 签到/礼包 | 若保留则不动 |
| `inventory{}` `dress[]` `worn[]` | 商店/背包 | **保留**（照顾玩法依赖） |
| `form` `stats.jobs` `stats.plays` | 形态晋升 | 若删形态则清 |
| `activity` | 全部外出玩法 | 若只剩照顾，可整体删（但 `decay` 里的活动分支要一起简化） |
| `stats.*`（24 个计数，`core/egg.js:76-82`） | 各玩法 | 建议**保留字段、停止累加**（避免迁移风险） |
| `outingsStreak` `restMinutes` | 打工/上课/旅行的过劳病 | 随外出玩法一起失去意义 |

## D. 推荐裁撤顺序（每步都能独立编译 + 跑测试）

1. **先删展示面**（零风险）：图鉴 → 日记（若用户不要）。
2. **再删「孤岛玩法」**：钓鱼（连小游戏 + 鱼饵）→ 旅行（连纪念品）。
3. **再删「经济系统」**：打工 → 学习 + 兴趣课。
   - ⚠️ 这一步会同时废掉：金币主来源、形态晋升、体重外出减重、图鉴形态分区。
4. **最后收尾**：形态/晋升（如果金币来源已断）→ 商店缩到 50 件（砍鱼饵/装扮/晋升，保留食物/洗浴/玩具/药品/复活）→ `data/drops.js` + `core/drops.js` 整体删 → `INHERITED`（`core/state.js:41`）裁剪 → 重新 `npm run build` → 同步 `docs/guides/gameplay.md`、`README.md`、`CHANGELOG.md`。
5. **绝不能删**：`core/settlement.js`（衰减/疾病/死亡/成长）、`core/care.js`（喂食/洗澡/玩耍/摸摸）、`core/illness.js`（生病）、`core/growth.js`、`core/weight.js`、`core/upgrades.js` + `core/migrate.js`（老存档）、`apps/desktop/*`（桌面外壳）。

---

# 附：顺手发现的「文档 / 注释 vs 实现」不一致（裁撤时别被误导）

| # | 说法 | 实际 | 证据 |
|---|---|---|---|
| 1 | C 批次卡：自动钓鱼「售价按 70%」 | **原价** | `docs/tasks/C-round.md:84` vs `docs/tasks/C5-fish.md:23`、`core/fishing.js:61` |
| 2 | C 批次卡：咬钩后「1 秒内」提竿 | **2 秒**（`hookUntil = bitesAt + 2000`），`gameplay.md:49` 写的 2 秒才对 | `docs/tasks/C-round.md:77` vs `core/fishing.js:77` |
| 3 | 注释：「The panel shows all twelve」（装扮） | 装扮是 **11** 件 | `core/inventory.js:35` vs 实测 `SHOP` dress=11 |
| 4 | 帮助文案：`work <odd\|site\|office>`、`trip <suburb\|mountain\|sea\|abroad>` | 这些 key 早已不存在（老职业/老目的地） | `render.js:344-345` |
| 5 | 客户端 `STAGES` 7 学段（含幼儿园/高中） | B4 之后只有 **5** 学段，此表仅作死兜底 | `src/client/constants.js:92-100`、`src/client/tabs/study.js:55` vs `data/school.js:66-72` |
| 6 | `docs/tasks/numbers/` 有 7 份数值单 | 任务书提到的 `data/skool/课程表` 不存在；课程表真值在 `data/school.js` | glob 结果 vs `data/school.js:32-72` |
| 7 | `client.js` 是「全部前端 UI」 | 它是**构建产物**（241KB / 4943 行），真源是 `src/client/` 的 **44 个模块**（29 个顶层 + 15 个 `tabs/`） | `client.js:1`、`package.json:47` |
| 8 | `src/client/tabs/crown.js` 还在仓库里 | **孤儿文件**：C4 已把 `crown` App 换成 `dex`，全库无任何 import；只剩 `src/client/tabs/card.js:8` 的过期注释还在提它 | grep `tabs/crown` 仅 3 处命中（文档 + 文件自身注释 + card.js 注释） |

---

*本文只做清点与影响分析，未修改 `_ref/` 下任何文件。*
