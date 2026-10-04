// @ts-check
/**
 * selftest.mjs —— 基础照顾领域模型的自检脚本。
 *
 * 纯 Node，无测试框架：`node selftest.mjs`，全部通过时退出码 0。
 * 时间一律用常量传进去，所以这个脚本不依赖真实时钟，也不需要等待。
 *
 * @module piggy-core/selftest
 */

import {
  ACTIONS, ACTION_ORDER, CARE_KIND, DEFAULT_TOY, DIET, FORMS, MAX, STATE_VERSION, SETTLE_STEP_MS,
  SATIETY_DECAY_PER_MIN, HAPPINESS_DECAY_PER_MIN, CLEANLINESS_DECAY_PER_MIN,
  UPGRADES, V11_OLD_JOB_PAY, V11_SUBJECT_OF, V13_REMOVED_FIELDS, V13_REMOVED_STATS,
  act, adopt, bar, buy, careEffects, careItems, chat, decay, feed, formStageView, formsView,
  grantAll, hatch, hatchEgg, healthPercent, inventoryView, layEgg, levelFor, levelProgress, lifeStageFor,
  migrate, mood, replyToLine, say, selectSkin, setForm, skinView, traitView, useItem, xpForLevel,
} from './index.js'

// ---------------------------------------------------------------------------
// 极简断言工具
// ---------------------------------------------------------------------------

let checks = 0
let failures = 0
const failuresList = []

function ok(label, condition, detail = '') {
  checks += 1
  if (condition) {
    console.log(`  ✅ ${label}`)
  } else {
    failures += 1
    failuresList.push(label)
    console.log(`  ❌ ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

function group(title) {
  console.log(`\n${title}`)
}

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps
const inRange = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi

/** 时间基准：固定值，脚本不依赖真实时钟。 */
const T0 = 1_700_000_000_000
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** 一只出盒子的猪，四维摆在中段，方便看清单次动作的增减。 */
function freshPig(nowMs, inventory = {}) {
  const state = hatchEgg(nowMs)
  state.satiety = 30
  state.happiness = 30
  state.cleanliness = 30
  state.inventory = { ...inventory }
  state.lastSeenAt = nowMs
  state.lastActiveAt = nowMs
  return state
}

const snapshot = state => ({
  satiety: state.satiety,
  happiness: state.happiness,
  cleanliness: state.cleanliness,
  health: state.health,
  xp: state.xp,
})

console.log('piggy-core selftest —— 基础照顾领域模型')
console.log(`STATE_VERSION = ${STATE_VERSION} · SETTLE_STEP_MS = ${SETTLE_STEP_MS}`)

// ---------------------------------------------------------------------------
group('1. adopt() 出来的初始状态')
// ---------------------------------------------------------------------------

{
  const adopted = adopt(null, T0)
  ok('返回了一个对象', adopted !== null && typeof adopted === 'object')
  ok('四维都在合法范围内', inRange(adopted.satiety, 0, 100) && inRange(adopted.happiness, 0, 100)
    && inRange(adopted.cleanliness, 0, 100) && inRange(adopted.health, 0, MAX.health),
  JSON.stringify(snapshot(adopted)))
  ok('饱食 70 / 心情 70 / 清洁 90（与参考 layEgg 一致）',
    adopted.satiety === 70 && adopted.happiness === 70 && adopted.cleanliness === 90)
  ok('健康满格', adopted.health === MAX.health && MAX.health === 5)
  ok('还是纸盒：hatched === false、stage === box', adopted.hatched === false && adopted.stage === 'box')
  ok('版本号 = STATE_VERSION', adopted.version === STATE_VERSION)
  ok('三维从 0 开始', adopted.traits.intel === 0 && adopted.traits.charm === 0 && adopted.traits.strong === 0)
  ok('等级从 Lv1 开始', levelFor(adopted.xp) === 1 && adopted.xp === 0)
  ok('背包是空的，但免费玩具随时可用',
    Object.keys(adopted.inventory).length === 0 && careItems('toy').some(item => item.default === true))
  ok('没有疾病/金币/活动这些被砍字段',
    adopted.illness === undefined && adopted.coins === undefined && adopted.activity === undefined
    && adopted.dead === undefined && adopted.weightG === undefined)
  ok('有记忆数组和空消息队列', Array.isArray(adopted.memories) && Array.isArray(adopted.pending))

  const opened = hatch(adopt(null, T0), T0)
  ok('hatch() 之后是幼年猪', opened.hatched === true && opened.stage === 'piglet' && opened.health >= 1)

  // adopt 要能真的「从零开始」：老对象上多出来的字段不能留。
  const dirty = hatchEgg(T0)
  dirty.coins = 999
  dirty.illness = { chain: 0, stage: 2 }
  dirty.lessons = { chinese: 9 }
  const reborn = adopt(dirty, T0 + 1000)
  ok('adopt() 会清掉新表里没有的老字段',
    reborn.coins === undefined && reborn.illness === undefined && reborn.lessons === undefined,
    `coins=${reborn.coins} illness=${JSON.stringify(reborn.illness)}`)
  ok('adopt() 是原地改（宿主手里是同一个对象）', reborn === dirty)
}

// ---------------------------------------------------------------------------
group('2. 四个动作与参考项目的 ACTIONS 表一致')
// ---------------------------------------------------------------------------

/** 参考项目 packages/pet-core/src/core/constants.js 的 ACTIONS，逐字段抄下来。 */
const REFERENCE_ACTIONS = {
  feed: { key: 'feed', label: '喂食', emoji: '🍎', verb: '吃了一口 🍎', cooldownMs: 0, satiety: 22, happiness: 6, cleanliness: 0, weightG: 90 },
  bathe: { key: 'bathe', label: '洗澡', emoji: '🛁', verb: '洗了个澡 🛁', cooldownMs: 0, satiety: -2, happiness: 8, cleanliness: 50, weightG: 0 },
  play: { key: 'play', label: '玩耍', emoji: '🎾', verb: '玩了一会儿 🎾', cooldownMs: 0, satiety: -5, happiness: 16, cleanliness: -4, weightG: 4 },
  pet: { key: 'pet', label: '摸摸', emoji: '❤️', verb: '被摸了摸头 ❤️', cooldownMs: 0, satiety: 0, happiness: 10, cleanliness: 0, weightG: 0 },
}

{
  ok('ACTION_ORDER 一致', JSON.stringify(ACTION_ORDER) === JSON.stringify(['feed', 'bathe', 'play', 'pet']))
  for (const key of ACTION_ORDER) {
    const spec = ACTIONS[key]
    const ref = REFERENCE_ACTIONS[key]
    const same = spec !== undefined
      && Object.keys(ref).length === Object.keys(spec).length
      && Object.keys(ref).every(field => spec[field] === ref[field])
    ok(`ACTIONS.${key} 与参考表逐字段一致`, same, JSON.stringify(spec))
    ok(`careEffects(null, ACTIONS.${key}) 就是表本身（没有道具时基线原样生效）`, careEffects(null, spec) === spec)
  }

  // pet：不花道具，整份基线原样落到四维上。
  let pig = freshPig(T0)
  let before = snapshot(pig)
  let result = act(pig, 'pet', T0)
  ok('pet 成功', result.ok === true)
  ok('pet: happiness +10（表值）', near(pig.happiness - before.happiness, ACTIONS.pet.happiness))
  ok('pet: satiety / cleanliness 不变',
    pig.satiety === before.satiety && pig.cleanliness === before.cleanliness)
  ok('pet: health / xp 不变', pig.health === before.health && pig.xp === before.xp)

  // feed：指定苹果（+22 饱食 / +3 心情），清洁度回落到表里的基线 0。
  pig = freshPig(T0, { apple: 3 })
  before = snapshot(pig)
  result = act(pig, 'feed', T0, 'apple')
  ok('feed 花掉一颗苹果', result.ok === true && result.spent === true && pig.inventory.apple === 2)
  ok('feed: satiety +22 / happiness +3（道具值）',
    near(pig.satiety - before.satiety, 22) && near(pig.happiness - before.happiness, 3),
  `${pig.satiety} / ${pig.happiness}`)
  ok('feed: cleanliness 用表里的基线 0', near(pig.cleanliness - before.cleanliness, ACTIONS.feed.cleanliness))
  ok('feed: health / xp 不变', pig.health === before.health && pig.xp === before.xp)

  // bathe：指定香皂（+35 清洁 / +2 心情），饱食回落到表里的基线 -2。
  pig = freshPig(T0, { soap: 2 })
  before = snapshot(pig)
  result = act(pig, 'bathe', T0, 'soap')
  ok('bathe 花掉一块香皂', result.ok === true && pig.inventory.soap === 1)
  ok('bathe: cleanliness +35 / happiness +2（道具值），satiety -2（表基线）',
    near(pig.cleanliness - before.cleanliness, 35)
    && near(pig.happiness - before.happiness, 2)
    && near(pig.satiety - before.satiety, ACTIONS.bathe.satiety),
  `${pig.satiety} / ${pig.happiness} / ${pig.cleanliness}`)
  ok('bathe: health / xp 不变', pig.health === before.health && pig.xp === before.xp)

  // play：没有玩具也玩得起来（免费小皮球），数值以球为准、清洁度回落到表基线 -4。
  pig = freshPig(T0)
  before = snapshot(pig)
  result = act(pig, 'play', T0)
  ok('play 用免费小皮球，不消耗背包', result.ok === true && result.item === DEFAULT_TOY.key && result.spent === false)
  ok('play: happiness +12（球）/ satiety -3（球）/ cleanliness -4（表基线）',
    near(pig.happiness - before.happiness, DEFAULT_TOY.happiness)
    && near(pig.satiety - before.satiety, DEFAULT_TOY.satiety)
    && near(pig.cleanliness - before.cleanliness, ACTIONS.play.cleanliness),
  `${pig.satiety} / ${pig.happiness} / ${pig.cleanliness}`)
  ok('play: health / xp 不变', pig.health === before.health && pig.xp === before.xp)

  // 商店与金币已砍，所以三个货架各有一件免费且不消耗的默认件：
  // 新猪必须**马上**喂得动、洗得动、玩得动，否则四个照顾动作里有两个是死的。
  pig = freshPig(T0)
  ok('新猪立刻能喂（免费默认件 苹果）', act(pig, 'feed', T0).ok === true)
  pig = freshPig(T0)
  ok('新猪立刻能洗（免费默认件 香皂）', act(pig, 'bathe', T0).ok === true)
  pig = freshPig(T0)
  ok('新猪立刻能玩（免费默认件 小皮球）', act(pig, 'play', T0).ok === true)
  ok('免费默认件不消耗背包', Object.keys(freshPig(T0).inventory ?? {}).length === 0
    && act(freshPig(T0), 'feed', T0).spent === false)

  // 指定一件背包里没有的东西时，仍然应当被拒（no-item 这条路没死）。
  pig = freshPig(T0)
  ok('指定背包里没有的食物时 feed 被拒（reason: no-item）',
    act(pig, 'feed', T0, 'cake').reason === 'no-item')
  ok('未知动作被拒（reason: unknown）', act(pig, 'dance', T0).reason === 'unknown')
  ok('纸盒不能动（reason: box）', act(adopt(null, T0), 'pet', T0).reason === 'box')

  // 被动投喂（主人真实干活时顺手喂的一口）。
  pig = freshPig(T0)
  feed(pig, 'turn', T0)
  ok('被动投喂 turn: satiety +2 / happiness +1（DIET 表）',
    near(pig.satiety - 30, DIET.turn.satiety) && near(pig.happiness - 30, DIET.turn.happiness))
  ok('被动投喂会记统计并给成长值', pig.stats.turns === 1 && pig.xp > 0)
}

// ---------------------------------------------------------------------------
group('3. decay() 跑 60 分钟：衰减量与 0.08 / 0.06 / 0.07 × 60 一致')
// ---------------------------------------------------------------------------

{
  ok('SETTLE_STEP_MS = 5 分钟', SETTLE_STEP_MS === 5 * MINUTE)
  const pig = hatchEgg(T0)
  pig.satiety = 70
  pig.happiness = 70
  pig.cleanliness = 90
  const now = T0 + 60 * MINUTE
  decay(pig, now)
  ok('satiety 70 → 70 - 0.08×60 = 65.2', near(pig.satiety, 70 - SATIETY_DECAY_PER_MIN * 60, 1e-9), String(pig.satiety))
  ok('happiness 70 → 70 - 0.06×60 = 66.4', near(pig.happiness, 70 - HAPPINESS_DECAY_PER_MIN * 60, 1e-9), String(pig.happiness))
  ok('cleanliness 90 → 90 - 0.07×60 = 85.8', near(pig.cleanliness, 90 - CLEANLINESS_DECAY_PER_MIN * 60, 1e-9), String(pig.cleanliness))
  ok('health 不随时间掉（没有疾病了）', pig.health === MAX.health)
  ok('lastSeenAt 推进到 nowMs', pig.lastSeenAt === now)
  ok('ageMs 加了 60 分钟', near(pig.ageMs, 60 * MINUTE, 1e-9), String(pig.ageMs))

  // 12 步 vs 1 步：步长切分不改变总量。
  const oneStep = hatchEgg(T0)
  oneStep.lastSeenAt = T0 + 60 * MINUTE - SETTLE_STEP_MS
  decay(oneStep, T0 + 60 * MINUTE)
  ok('单步（5 分钟）与 12 步的总量一致',
    near(oneStep.satiety, 70 - SATIETY_DECAY_PER_MIN * 5, 1e-9)
    && near(oneStep.happiness, 70 - HAPPINESS_DECAY_PER_MIN * 5, 1e-9)
    && near(oneStep.cleanliness, 90 - CLEANLINESS_DECAY_PER_MIN * 5, 1e-9))

  // 未孵化：只推进 lastSeenAt，什么都不掉。
  const box = adopt(null, T0)
  decay(box, T0 + 30 * DAY)
  ok('未孵化的纸盒不吃衰减（也不变老）',
    box.satiety === 70 && box.happiness === 70 && box.cleanliness === 90
    && box.ageMs === 0 && box.lastSeenAt === T0 + 30 * DAY)

  // 时间没往前走：直接返回。
  const back = hatchEgg(T0)
  back.lastSeenAt = T0
  decay(back, T0 - 1000)
  ok('nowMs <= fromMs 时直接返回（不倒退也不衰减）',
    back.satiety === 70 && back.lastSeenAt === T0 - 1000)

  // 老存档缺 ageMs：由 bornAt 推算（补 ageMs 发生在确认时间真的往前走了之后）。
  const old = hatchEgg(T0 - 10 * DAY)
  delete old.ageMs
  old.lastSeenAt = T0
  decay(old, T0 + 5 * MINUTE)
  ok('老存档缺 ageMs 时从 bornAt 推算（10 天 + 这一步）',
    near(old.ageMs, 10 * DAY + 5 * MINUTE, 1e-9), String(old.ageMs))
}

// ---------------------------------------------------------------------------
group('4. 长时间 decay()（30 天）：不抛异常、不出现 NaN、数值夹在 0..100')
// ---------------------------------------------------------------------------

{
  const pig = hatchEgg(T0)
  const now = T0 + 30 * DAY
  let threw = null
  try {
    decay(pig, now)
  } catch (error) {
    threw = error
  }
  ok('不抛异常', threw === null, threw === null ? '' : String(threw && threw.message))
  const numbers = [pig.satiety, pig.happiness, pig.cleanliness, pig.health, pig.xp, pig.ageMs]
  ok('没有 NaN / Infinity', numbers.every(value => typeof value === 'number' && Number.isFinite(value)),
    JSON.stringify(numbers))
  ok('四维夹在范围内（health 0..5）',
    inRange(pig.satiety, 0, 100) && inRange(pig.happiness, 0, 100)
    && inRange(pig.cleanliness, 0, 100) && inRange(pig.health, 0, MAX.health),
  JSON.stringify(snapshot(pig)))
  ok('30 天后三个条见底为 0', pig.satiety === 0 && pig.happiness === 0 && pig.cleanliness === 0)
  ok('成长值随时间长上去了（xp > 0）', pig.xp > 0)
  ok('等级没超过 MAX_LEVEL', levelFor(pig.xp) <= 60)
  ok('ageMs 正好是 30 天', near(pig.ageMs, 30 * DAY, 1e-6), String(pig.ageMs))
  ok('形态跟着等级走（幼年 → 青年/成年）', ['piglet', 'young', 'middle'].includes(lifeStageFor(pig, now).key))

  // 再跑一次同样长的时间：依然稳定，且不会把条推成负数。
  decay(pig, T0 + 60 * DAY)
  ok('再跑 30 天依然稳定',
    pig.satiety === 0 && pig.happiness === 0 && pig.cleanliness === 0 && Number.isFinite(pig.xp))
  ok('没有进度倒退', pig.ageMs >= 30 * DAY)
}

// ---------------------------------------------------------------------------
group('5. migrate() 吃掉一份模拟的老 v12 存档')
// ---------------------------------------------------------------------------

/** 参考项目 v12 形状的存档：疾病、金币、打工、纪念品全都在。 */
const OLD_V12 = {
  version: 12,
  name: '老猪',
  bornAt: T0 - 40 * DAY,
  hatched: true,
  dead: false,
  diedAt: null,
  stage: 'young',
  form: 'king',
  skin: 'mint',
  customSkins: [],
  ageMs: 40 * DAY,
  xp: 12200,
  weightG: 4200,
  bodyWeight: { playDay: '', plays: 0 },
  satiety: 55.5,
  happiness: 44.4,
  cleanliness: 33.3,
  health: 3,
  coins: 1234,
  inventory: { apple: 3, bread: 2, soap: 5, yoyo: 1, bait_worm: 4, scarf: 1, banlangen: 2, soul: 1, crown: 1 },
  dress: ['scarf'],
  worn: ['scarf'],
  traits: { intel: 7, charm: 3, strong: 0 },
  lessons: { chinese: 9 },
  interests: { coding: 2 },
  certificates: { coding: true },
  souvenirs: [{ key: 'shell', label: '贝壳' }],
  trips: 2,
  illness: { chain: 0, stage: 2, since: T0, progressMs: 0 },
  grave: null,
  soul: null,
  soulAt: null,
  activity: { kind: 'work', key: 'odd', endsAt: T0 + 1000, startedAt: T0 },
  work: { job: 'odd' },
  outingStreak: 2,
  restMinutes: 30,
  riskMinutes: 12,
  jobs: { odd: 3 },
  job: 'odd',
  dex: { items: {} },
  diary: { entries: [] },
  daily: { streak: 5 },
  gifts: [],
  pomodoro: { todayDone: 3 },
  fishing: { catches: 2 },
  timeScale: 12,
  ageForced: false,
  sex: 'boy',
  personality: 'calm',
  motto: '加油',
  finalForm: null,
  cooldowns: { feed: 0 },
  pending: [{ id: 1, kind: 'work', text: '打工回来了', at: T0 }],
  pendingSeq: 1,
  memories: ['[08:00] 你好'],
  stats: {
    turns: 5, messages: 2, tools: 9, toolErrors: 1, agentErrors: 0,
    levelUps: 4, feeds: 3, baths: 2, plays: 1, pets: 6, purchases: 4,
    jobs: 7, coinsEarned: 900, courses: 2, lessons: 9, graduations: 1, trips: 2, interests: 1,
    illnesses: 1, cures: 1, deaths: 0, revives: 0, doctorVisits: 1, sales: 0,
    fishCaught: 3, fishingAuto: 1,
  },
  lastFedAt: T0 - HOUR,
  lastActiveAt: T0 - MINUTE,
  lastSeenAt: T0,
}

{
  const migrated = migrate(OLD_V12, T0)
  ok('返回了一个对象', migrated !== null && typeof migrated === 'object')
  ok('版本号升到 13', migrated.version === 13 && STATE_VERSION === 13)

  // 独立于实现的一份清单：任务书点名要删掉的字段，逐个验一遍。
  const REQUIRED_DELETIONS = [
    'illness', 'dead', 'diedAt', 'grave', 'soul', 'soulAt', 'activity',
    'lessons', 'subjects', 'courses', 'jobs', 'job', 'coins',
    'souvenirs', 'trips', 'interests', 'certificates', 'dex', 'diary',
    'daily', 'gifts', 'pomodoro', 'fishing', 'weightG', 'bodyWeight', 'timeScale',
  ]
  const REQUIRED_STAT_DELETIONS = ['jobs', 'coinsEarned', 'courses', 'lessons', 'graduations', 'trips', 'interests']
  for (const key of REQUIRED_DELETIONS) {
    ok(`任务书点名的字段 ${key} 确实消失`, migrated[key] === undefined, JSON.stringify(migrated[key]))
  }
  for (const key of REQUIRED_STAT_DELETIONS) {
    ok(`任务书点名的 stats.${key} 确实消失`, migrated.stats[key] === undefined, JSON.stringify(migrated.stats[key]))
  }
  ok('实现里的删除清单覆盖了任务书点名的字段',
    REQUIRED_DELETIONS.every(key => V13_REMOVED_FIELDS.includes(key))
    && REQUIRED_STAT_DELETIONS.every(key => V13_REMOVED_STATS.includes(key)))

  for (const key of V13_REMOVED_FIELDS) {
    ok(`顶层字段 ${key} 确实消失`, migrated[key] === undefined, JSON.stringify(migrated[key]))
  }
  for (const key of V13_REMOVED_STATS) {
    ok(`stats.${key} 确实消失`, migrated.stats[key] === undefined, JSON.stringify(migrated.stats[key]))
  }

  ok('四维被保留并夹进范围',
    migrated.satiety === 55.5 && migrated.happiness === 44.4 && migrated.cleanliness === 33.3 && migrated.health === 3,
  JSON.stringify(snapshot(migrated)))
  ok('xp / 三维 / 形态 / 皮肤保留',
    migrated.xp === 12200 && migrated.traits.intel === 7 && migrated.traits.charm === 3
    && migrated.form === 'king' && migrated.skin === 'mint')
  ok('保留下来的统计计数器还在',
    migrated.stats.feeds === 3 && migrated.stats.pets === 6 && migrated.stats.turns === 5 && migrated.stats.purchases === 4)
  ok('pending 清空、memories 保留',
    Array.isArray(migrated.pending) && migrated.pending.length === 0 && migrated.memories.length === 1)
  ok('名字 / 生日 / 孵化状态保留',
    migrated.name === '老猪' && migrated.bornAt === OLD_V12.bornAt && migrated.hatched === true)
  ok('种子被补齐（随机数可复现）', Number.isInteger(migrated.seed) && migrated.seed >= 0)
  ok('migrate() 没有改动入参对象', OLD_V12.coins === 1234 && OLD_V12.illness !== undefined && OLD_V12.version === 12)
  ok('垃圾输入返回 null',
    migrate(null, T0) === null && migrate('x', T0) === null && migrate([], T0) === null && migrate(42, T0) === null)

  const again = migrate(migrated, T0)
  ok('对已经是 v13 的存档再跑一次是幂等的',
    again.version === 13 && again.coins === undefined && again.illness === undefined
    && again.satiety === migrated.satiety && again.stats.feeds === 3)

  // v7 老古董：要一路穿过 v8..v13（V11 的映射表就在这条路上）。
  const v7 = {
    version: 7, name: '老古董', bornAt: T0 - 100 * DAY, hatched: true, xp: 4000,
    satiety: 50, happiness: 50, cleanliness: 50, health: 5, coins: 60,
    courses: { literacy: 5, mathematics: 2 },
    inventory: { apple: 1 },
    stats: {},
  }
  const upgraded = migrate(v7, T0)
  ok('v7 存档能一路升到 13', upgraded.version === 13)
  ok('v7 的课程表先被 v11 合并、再被 v13 删掉', upgraded.courses === undefined && upgraded.lessons === undefined)
  ok('v7 的 xp 被 v9 折算过（不再是 4000）', upgraded.xp > 0 && upgraded.xp !== 4000, String(upgraded.xp))
  ok('v7 的苹果留下来了', upgraded.inventory.apple === 1)
  ok('v7 的金币被删掉', upgraded.coins === undefined)
  ok('UPGRADES 里有 to: 13 的一级', UPGRADES.some(upgrade => upgrade.to === 13))
  ok('陷阱 #4：V11_SUBJECT_OF / V11_OLD_JOB_PAY 都还在',
    Object.keys(V11_SUBJECT_OF).length === 23 && V11_OLD_JOB_PAY.manager === 2200 && V11_OLD_JOB_PAY.odd === 30)
}

// ---------------------------------------------------------------------------
group('6. 老存档的食物 / 洗浴 / 玩具没有被 sanitizeInventory 清空')
// ---------------------------------------------------------------------------

{
  const migrated = migrate(OLD_V12, T0)
  ok('食物：苹果 3 / 面包 2', migrated.inventory.apple === 3 && migrated.inventory.bread === 2)
  ok('洗浴：香皂 5', migrated.inventory.soap === 5)
  ok('玩具：悠悠球 1', migrated.inventory.yoyo === 1)
  ok('被砍货架的物品被丢掉（有意为之）',
    migrated.inventory.bait_worm === undefined && migrated.inventory.scarf === undefined
    && migrated.inventory.banlangen === undefined && migrated.inventory.soul === undefined
    && migrated.inventory.crown === undefined,
  JSON.stringify(migrated.inventory))

  const view = inventoryView(migrated)
  ok('inventoryView 里三个货架的数量都对', view.apple === 3 && view.soap === 5 && view.yoyo === 1)
  ok('CARE_KIND 三个货架映射没丢',
    CARE_KIND.feed === 'food' && CARE_KIND.bathe === 'bath' && CARE_KIND.play === 'toy')
  ok('careItems() 三个货架都还有货',
    careItems('food').length > 0 && careItems('bath').length > 0 && careItems('toy').length > 0)

  const fed = act(migrated, 'feed', T0, 'apple')
  ok('迁移后还能喂食（指定苹果）', fed.ok === true && migrated.inventory.apple === 2)
  const bathed = act(migrated, 'bathe', T0, 'soap')
  ok('迁移后还能洗澡（指定香皂）', bathed.ok === true && migrated.inventory.soap === 4)
  const played = act(migrated, 'play', T0, 'yoyo')
  ok('迁移后还能玩耍（指定悠悠球）', played.ok === true && migrated.inventory.yoyo === undefined)
}

// ---------------------------------------------------------------------------
group('7. levelFor / xpForLevel：单调且与参考曲线一致')
// ---------------------------------------------------------------------------

{
  const REFERENCE_CURVE = [[1, 0], [2, 488], [3, 1098], [10, 12200], [40, 195200], [60, 439200]]
  for (const [level, xp] of REFERENCE_CURVE) {
    ok(`xpForLevel(${level}) === ${xp}`, xpForLevel(level) === xp, String(xpForLevel(level)))
  }
  ok('levelFor(0) = 1 / levelFor(487) = 1 / levelFor(488) = 2',
    levelFor(0) === 1 && levelFor(487) === 1 && levelFor(488) === 2)
  ok('levelFor(12199) = 9 / levelFor(12200) = 10', levelFor(12199) === 9 && levelFor(12200) === 10)
  ok('levelFor(195200) = 40 / levelFor(439200) = 60 / 满级封顶',
    levelFor(195200) === 40 && levelFor(439200) === 60 && levelFor(1_000_000_000) === 60)

  let xpMonotone = true
  for (let level = 1; level < 60; level += 1) {
    if (!(xpForLevel(level + 1) > xpForLevel(level))) xpMonotone = false
  }
  ok('xpForLevel 在 1..60 上严格递增', xpMonotone)

  let levelMonotone = true
  let previous = levelFor(0)
  for (let xp = 0; xp <= 500_000; xp += 137) {
    const level = levelFor(xp)
    if (level < previous) levelMonotone = false
    previous = level
  }
  ok('levelFor 在 0..500000 上单调不减', levelMonotone)

  const progress = levelProgress(12200)
  ok('levelProgress(12200)：Lv10、刚进门、称号「老伙计」',
    progress.level === 10 && progress.percent === 0 && progress.title.label === '老伙计')
  ok('levelProgress(满级) 的 percent = 100', levelProgress(1_000_000_000).percent === 100)
}

// ---------------------------------------------------------------------------
group('8. 其余保留下来的东西还能跑（视图 / 台词 / 皮肤 / 形态 / 背包）')
// ---------------------------------------------------------------------------

{
  const pig = hatchEgg(T0)
  pig.satiety = 10
  ok('mood：饿了', mood(pig, T0).key === 'hungry')
  pig.satiety = 80
  pig.cleanliness = 10
  ok('mood：该洗澡了', mood(pig, T0).key === 'dirty')
  pig.cleanliness = 80
  pig.happiness = 90
  ok('mood：很开心', mood(pig, T0).key === 'happy')
  ok('healthPercent 满血 = 100', healthPercent(pig) === 100)
  ok('bar(50, 10) 长度正确', bar(50, 10) === '▓▓▓▓▓░░░░░')
  ok('traitView 三个属性都在', Object.keys(traitView(pig)).length === 3)

  ok('say() 排了一条台词', say(pig, 'pet', T0) === true && pig.pending.some(m => m.kind === 'line'))

  // 回复按钮：只有带按钮的台词才挂得住，反复说直到抽到一条。
  const talker = hatchEgg(T0)
  let lineMsg = null
  for (let attempt = 0; attempt < 40 && lineMsg === null; attempt += 1) {
    say(talker, 'pet', T0)
    const candidate = talker.pending
      .filter(m => m.kind === 'line' && Array.isArray(m.replies) && m.replies.length > 0)
      .at(-1)
    if (candidate !== undefined) lineMsg = candidate
  }
  ok('抽得到一条带回复按钮的台词', lineMsg !== null)
  const happinessBefore = talker.happiness
  const replied = replyToLine(talker, lineMsg.id, 0)
  ok('回复台词会加心情', replied.ok === true && talker.happiness === happinessBefore + 3,
    JSON.stringify(replied))
  ok('同一条台词不能回复两次', replyToLine(talker, lineMsg.id, 0).reason === 'stale-line')
  ok('没按钮的旧台词回复被拒', replyToLine(talker, 999999, 0).reason === 'stale-line')
  ok('chat("enter") 说得出来', chat(pig, 'enter', T0).ok === true)

  ok('skinView 里有默认皮肤', skinView(pig).entries.some(skin => skin.key === 'default'))
  ok('selectSkin("mint") 成功', selectSkin(pig, 'mint', T0).ok === true && pig.skin === 'mint')
  ok('selectSkin("不存在") 被拒', selectSkin(pig, 'nope', T0).reason === 'unknown')

  const forms = formsView(pig)
  ok('formsView 列出两个形态（P2 用）', forms !== null && forms.forms.length === 2)
  ok('setForm("devil") 写进存档', setForm(pig, 'devil', T0).ok === true && pig.form === 'devil')
  ok('formStageView 在没有对应立绘时回落到普通形态', typeof formStageView(pig, T0).art === 'string')

  // ── 形态条件不能引用「死字段」 ──────────────────────────────────────────
  // 这一条是回归测试：原表的 `requires` 用了 { intel, charm, strong, jobs }，
  // 而 traits 那三个量随上学/打工一起砍掉后再没人增加（永远 0），jobs 更是不存在。
  // 于是「猪猪王」永久不可达 —— 条件永远不满足，图鉴永远是灰的。
  // 下面这条断言保证：每个形态的每个条件 key，都必须是一个**真的会被累积**的量。
  const freshStats = Object.keys(hatchEgg(T0).stats)
  const deadKeys = []
  for (const form of FORMS) {
    for (const key of Object.keys(form.requires)) {
      if (!freshStats.includes(key)) deadKeys.push(`${form.key}.${key}`)
    }
  }
  ok(
    `形态条件全部指向还在累积的统计量（死字段：${deadKeys.join(',') || '无'}）`,
    deadKeys.length === 0
  )

  // 等级不够时不该 ready（猪猪王/恶魔猪都要 stage=middle，即 40 级）
  const lowLevel = hatchEgg(T0)
  lowLevel.stats.plays = 999
  lowLevel.stats.pets = 999
  lowLevel.stats.feeds = 999
  ok(
    '等级不够时形态未达成（stage=middle 要 40 级）',
    formsView(lowLevel).forms.every(form => form.ready === false)
  )

  // 等级 + 次数都够了 → ready（证明条件**可达**，不再永久锁死）
  const grinded = hatchEgg(T0)
  grinded.xp = xpForLevel(40)
  grinded.stats.plays = 999
  grinded.stats.pets = 999
  grinded.stats.feeds = 999
  const ready = formsView(grinded).forms.filter(form => form.ready).map(form => form.key)
  ok(`条件满足后两个形态都达成（实际 ${ready.join(',') || '无'}）`, ready.length === 2)

  // 形态与等级解耦：换形态不动等级、不动四维
  const decoupled = hatchEgg(T0)
  decoupled.xp = xpForLevel(40)
  const beforeXp = decoupled.xp
  const beforeSat = decoupled.satiety
  setForm(decoupled, 'king', T0)
  ok(
    '换形态不改等级、不改四维（D11 解耦）',
    decoupled.xp === beforeXp && decoupled.satiety === beforeSat && decoupled.form === 'king'
  )

  // 传 null 换回默认小猪
  ok('setForm(null) 换回默认小猪', setForm(decoupled, null, T0).ok === true && decoupled.form === null)
  ok('已经是默认小猪时再换回被拒', setForm(decoupled, null, T0).reason === 'already')
  ok('未孵化的蛋不能换形态', setForm(layEgg(T0), 'king', T0).reason === 'box')

  const bag = hatchEgg(T0)
  grantAll(bag, T0)
  ok('grantAll 发齐三个货架', bag.inventory.apple === 20 && bag.inventory.soap === 20 && bag.inventory.yoyo === 20)
  ok('useItem 吃掉一件', useItem(bag, 'apple', T0).ok === true && bag.inventory.apple === 19)
  ok('useItem 对没有的东西被拒', useItem(bag, 'nothing', T0).reason === 'unknown')
  ok('buy() 放一件进背包（金币已砍，不再扣钱）',
    buy(bag, 'bread', T0).ok === true && bag.inventory.bread === 21)

  // 迁移过的老存档还能继续正常走时间。
  const continued = migrate(OLD_V12, T0)
  decay(continued, T0 + 6 * HOUR)
  ok('迁移后的存档能继续 decay()',
    Number.isFinite(continued.satiety) && Number.isFinite(continued.xp) && continued.ageMs > 40 * DAY)
}

// ---------------------------------------------------------------------------

console.log(`\n${'─'.repeat(60)}`)
if (failures === 0) {
  console.log(`✅ 全部通过：${checks} 项检查`)
  process.exitCode = 0
} else {
  console.log(`❌ 失败 ${failures} / ${checks} 项：`)
  for (const label of failuresList) console.log(`   · ${label}`)
  process.exitCode = 1
}
