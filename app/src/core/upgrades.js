// @ts-check
/**
 * 存档的逐级升级：每改一次存档结构，就在 UPGRADES 末尾加一级。
 *
 * migrate() 先按版本号把原始存档一级一级升到最新，再做字段清洗。
 * 一级只做一件事、只认上一级的形状，这样老存档跨多个版本升级时，
 * 每一步都和当初写它的时候一样确定。
 *
 * 加一级的步骤：
 *   1. 在 UPGRADES 末尾追加 `{ to: N, why, up(raw) }`，`up` 返回新对象，不改入参
 *   2. STATE_VERSION 改成 N（constants.js）
 *   3. 补一条迁移测试，用升级前的真实形状做样本
 *
 * 纯函数领域逻辑：时间由 nowMs 传入，不读写文件、不碰 DOM。
 * @module piggy-core/core/upgrades
 */

/**
 * @typedef {object} Upgrade
 * @property {number} to - 升级后的版本号
 * @property {string} why - 这一级改了什么，写给以后读代码的人
 * @property {(raw: Record<string, unknown>, nowMs: number) => Record<string, unknown>} up
 */

import { roll } from './random.js'

/*
 * The curves below are frozen copies of what each version used. An upgrade
 * must keep meaning what it meant when it was written, even after the live
 * tables in data/ change again.
 */
const v8LevelFloor = level => (level <= 1 ? 0 : 20 * level * (level - 1))
const v9LevelFloor = level => (level <= 1 ? 0 : 122 * level * level)
const V9_MAX_LEVEL = 60

/**
 * v11: the 23 subjects of the old seven-stage ladder, folded into the nine
 * QQ Pet subjects (B4 sheet §6). 礼仪 and 武术 had no old counterpart.
 *
 * ⚠️ 这两张表必须留着（陷阱 #4）：删掉它们，v11 之前的老存档就再也升不上来。
 */
export const V11_SUBJECT_OF = Object.freeze({
  literacy: 'chinese', chinese: 'chinese', english: 'chinese', history: 'chinese', philosophy: 'chinese',
  mathematics: 'mathematics', science: 'mathematics', physics: 'mathematics', chemistry: 'mathematics',
  biology: 'mathematics', it: 'mathematics', economics: 'mathematics', go: 'mathematics',
  politics: 'politics', geography: 'politics',
  sing: 'music', piano: 'music',
  doodle: 'art', painting: 'art', art: 'art',
  pe: 'pe', football: 'pe',
  engineering: 'labour',
})

/** v11: what each job of the old table paid, for a shift still in progress. */
export const V11_OLD_JOB_PAY = Object.freeze({
  odd: 30, dish: 70, site: 260, foreman: 700, street: 200,
  tutor: 480, office: 900, manager: 2200, researcher: 4000,
})

/** v10 refund for each retired generic medicine: the new price of the same tier. */
const V10_REFUND = Object.freeze({ med1: 30, med2: 70, med3: 140, med4: 260 })

/**
 * v13：被砍掉的顶层字段。
 *
 * ⚠️ 陷阱 #5：migrate() 用的是 `{...egg, ...raw}` —— 新表里没有的字段**不会**
 * 自动消失。所以这里必须**显式 delete**，否则疾病、金币、打工记录会跟着新存档
 * 一路走下去，早晚被某个还在读它的地方引爆。
 *
 * 这份清单同时被 migrate() 当第二道防线用（见 migrate.js）。
 */
export const V13_REMOVED_FIELDS = Object.freeze([
  // 疾病与死亡
  'illness', 'dead', 'diedAt', 'grave', 'soul', 'soulAt', 'riskMinutes',
  // 离家活动（猪永远在家）
  'activity', 'work', 'outingStreak', 'restMinutes',
  // 上学 / 兴趣课 / 纪念品 / 图鉴
  'lessons', 'subjects', 'courses', 'coursesByStage', 'lessonsByStage',
  'interests', 'certificates', 'souvenirs', 'trips', 'dex',
  // 打工 / 金币
  'jobs', 'job', 'coins',
  // 日记 / 签到 / 礼物 / 番茄钟 / 钓鱼
  'diary', 'daily', 'gifts', 'pomodoro', 'fishing',
  // 体重 / 时间倍率 / 装扮 / 档案里没人再读的字段
  'weightG', 'bodyWeight', 'timeScale', 'ageForced',
  'dress', 'worn', 'sex', 'personality', 'motto', 'finalForm',
])

/** v13：stats 里被砍掉的计数器（其余计数器照旧保留）。 */
export const V13_REMOVED_STATS = Object.freeze([
  'jobs', 'coinsEarned', 'courses', 'lessons', 'graduations', 'trips', 'interests',
  'illnesses', 'cures', 'deaths', 'revives', 'doctorVisits', 'sales',
  'fishCaught', 'fishingAuto',
])

function levelOnCurve(xp, floorOf, cap) {
  let level = 1
  while (level < cap && xp >= floorOf(level + 1)) level += 1
  return level
}

/**
 * Carry an old xp total onto the v9 growth curve: same level, same fraction of
 * the way to the next one. Lv8 at 40% stays Lv8 at 40%.
 */
function growthFromV8Xp(xp) {
  const value = Number.isFinite(xp) && xp > 0 ? xp : 0
  const level = levelOnCurve(value, v8LevelFloor, 999)
  if (level >= V9_MAX_LEVEL) return v9LevelFloor(V9_MAX_LEVEL)
  const floor = v8LevelFloor(level)
  const fraction = Math.min(1, (value - floor) / Math.max(1, v8LevelFloor(level + 1) - floor))
  const nextFloor = v9LevelFloor(level + 1)
  return Math.round(v9LevelFloor(level) + fraction * (nextFloor - v9LevelFloor(level)))
}

/** The v9 body for a level: 幼年 from Lv1, 青年 from Lv10, 成年 from Lv40. */
const v9StageFor = level => (level >= 40 ? 'middle' : level >= 10 ? 'young' : 'piglet')

/** stats 去掉被砍的计数器，其余原样。 */
function stripRemovedStats(raw) {
  const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const out = {}
  for (const [key, value] of Object.entries(source)) {
    if (!V13_REMOVED_STATS.includes(key)) out[key] = value
  }
  return out
}

/** @type {ReadonlyArray<Upgrade>} */
export const UPGRADES = Object.freeze([
  Object.freeze({
    to: 8,
    why: 'hatched 不再由 xp 推断：没拆的纸盒也会吃到经验，重启后会被误当成已孵化',
    up(raw) {
      // Only saves from before the flag existed get the old inference; a save
      // that recorded `hatched: false` meant it, whatever its xp says.
      if (typeof raw.hatched === 'boolean') return { ...raw, version: 8 }
      return { ...raw, version: 8, hatched: typeof raw.xp === 'number' && raw.xp > 0 }
    },
  }),
  Object.freeze({
    to: 9,
    why: 'B2 成长：xp 改为成长值、按新曲线折算（等级和进度不变）；形态改由等级决定、去掉老年；补性别',
    up(raw) {
      const next = { ...raw, version: 9, xp: growthFromV8Xp(raw.xp) }
      if (next.hatched === true && next.dead !== true) {
        next.stage = v9StageFor(levelOnCurve(next.xp, v9LevelFloor, V9_MAX_LEVEL))
      } else if (next.stage === 'elder') {
        next.stage = 'middle'
      }
      if (next.hatched === true && next.sex !== 'boy' && next.sex !== 'girl') {
        next.sex = roll(next) < 0.5 ? 'boy' : 'girl'
      }
      return next
    },
  }),
  Object.freeze({
    to: 10,
    why: 'B3 疾病：四种通用药下架、按新同级药价退金币；病的必病计时 riskMinutes 换成连续外出计数',
    up(raw) {
      const next = { ...raw, version: 10 }
      const bag = raw.inventory !== null && typeof raw.inventory === 'object' ? { ...raw.inventory } : {}
      let refund = 0
      for (const [key, price] of Object.entries(V10_REFUND)) {
        const count = Number.isFinite(bag[key]) ? Math.max(0, Math.floor(bag[key])) : 0
        refund += count * price
        delete bag[key]
      }
      next.inventory = bag
      next.coins = (Number.isFinite(raw.coins) ? raw.coins : 0) + refund
      delete next.riskMinutes
      next.outingStreak = 0
      next.restMinutes = 0
      return next
    },
  }),
  Object.freeze({
    to: 11,
    why: 'B4 学习→职业：23 门课按对照表并进九门课的课时；旧职业表里在打的工按旧报酬结算',
    up(raw) {
      const next = { ...raw, version: 11 }
      const lessons = raw.lessons !== null && typeof raw.lessons === 'object' ? { ...raw.lessons } : {}
      const courses = raw.courses !== null && typeof raw.courses === 'object' ? raw.courses : {}
      for (const [oldKey, count] of Object.entries(courses)) {
        const into = V11_SUBJECT_OF[oldKey]
        if (into === undefined || !Number.isFinite(count) || count <= 0) continue
        lessons[into] = (lessons[into] ?? 0) + Math.floor(count)
      }
      next.lessons = lessons
      delete next.courses
      delete next.coursesByStage
      delete next.lessonsByStage
      // v3 saves kept a shift under `work: { job }`; migrate() lifts it later.
      const legacyWork = raw.work !== null && typeof raw.work === 'object' ? { kind: 'work', key: raw.work.job, ...raw.work } : null
      const activity = raw.activity ?? legacyWork
      if (activity !== null && typeof activity === 'object') {
        if (activity.kind === 'study') {
          // Same lesson, new subject name; the stage is decided afresh.
          const into = V11_SUBJECT_OF[activity.key] ?? activity.key
          next.activity = { ...activity, key: into, stage: undefined }
        } else if (activity.kind === 'work' && V11_OLD_JOB_PAY[activity.key] !== undefined) {
          const minutes = Math.max(0, Math.round((activity.endsAt - activity.startedAt) / 60000))
          next.activity = { ...activity, legacyCoins: V11_OLD_JOB_PAY[activity.key], minutes }
        }
      }
      return next
    },
  }),
  Object.freeze({
    to: 12,
    why: '加冕形态单独存成 form（普通猪是 null）；PR #2 早期版本存的 finalForm 改名过来',
    up(raw) {
      const next = { ...raw, version: 12 }
      next.form = typeof raw.form === 'string' ? raw.form : typeof raw.finalForm === 'string' ? raw.finalForm : null
      delete next.finalForm
      return next
    },
  }),
  Object.freeze({
    to: 13,
    why: '只留基础照顾：砍掉疾病/死亡、打工/上学/旅行/钓鱼/兴趣课/番茄钟/体重/日记/签到/图鉴/掉落/离家活动，'
      + '以及 bait/dress/medicine/revive/promotion 五个货架。这里把被砍的字段逐个显式删掉，'
      + '因为 {...egg, ...raw} 不会替我们丢字段。',
    up(raw) {
      const next = { ...raw, version: 13 }
      for (const key of V13_REMOVED_FIELDS) delete next[key]
      next.stats = stripRemovedStats(raw.stats)
      return next
    },
  }),
])

/** The oldest version the step table starts from; earlier saves are cleaned by migrate() alone. */
export const FIRST_UPGRADE_FROM = 7

/**
 * Run every upgrade the save has not had yet.
 * @param {Record<string, unknown>} raw
 * @param {number} nowMs
 * @returns {Record<string, unknown>}
 */
export function applyUpgrades(raw, nowMs) {
  const onDisk = typeof raw.version === 'number' && Number.isFinite(raw.version) ? raw.version : 0
  // Saves older than the table were shaped by migrate()'s field cleaning; they
  // enter the table as if they were the version it starts from.
  let current = onDisk < FIRST_UPGRADE_FROM ? { ...raw, version: FIRST_UPGRADE_FROM } : raw
  for (const upgrade of UPGRADES) {
    if (/** @type {number} */ (current.version) < upgrade.to) current = upgrade.up(current, nowMs)
  }
  return current
}
