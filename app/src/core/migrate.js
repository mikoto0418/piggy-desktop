// @ts-check
/**
 * 存档迁移与字段清洗。
 *
 * 纯函数领域逻辑：时间由 nowMs 传入，不读写文件、不碰 DOM。
 *
 * 和参考项目的区别：只清洗基础照顾用得到的字段。疾病、活动、装扮、图鉴、
 * 日记、签到、体重、钓鱼那些 sanitize* 全部删掉了；被砍字段的清除工作写在
 * upgrades.js 的 v12→v13 一级里（显式 delete），这里再按同一份清单兜一次底。
 *
 * @module piggy-core/core/migrate
 */

import { MAX } from './data/life.js'
import { TRAIT_ORDER } from './data/traits.js'
import { itemByKey } from './data/shop.js'
import { formByKey } from './data/evolution.js'
import { MEMORY_LIMIT, STATE_VERSION } from './constants.js'
import { clamp, clamp100 } from './effects.js'
import { ensureDialogue } from './lines.js'
import { isSeed, seedFor } from './random.js'
import { ensureSkins } from './skins.js'
import { layEgg } from './state.js'
import { V13_REMOVED_FIELDS, V13_REMOVED_STATS, applyUpgrades } from './upgrades.js'

/** Fill in anything a hand-edited or older save is missing. */
export function migrate(input, nowMs) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null
  // Untrusted save data: every field below is checked before it is used.
  const raw = /** @type {any} */ (applyUpgrades(input, nowMs))
  const egg = layEgg(typeof raw.bornAt === 'number' ? raw.bornAt : nowMs)
  const state = { ...egg, ...raw }
  state.version = STATE_VERSION
  // 第二道防线（陷阱 #5）：升级表已经显式删过一遍，但一份版本号被写成 13 的
  // 手改存档会跳过那一级，所以这里用同一份清单再删一次。
  for (const key of V13_REMOVED_FIELDS) delete state[key]

  state.form = formByKey(raw.form)?.key ?? null
  state.stats = { ...egg.stats, ...(asObject(raw.stats) ?? {}) }
  for (const key of V13_REMOVED_STATS) delete state.stats[key]
  state.cooldowns = { ...(asObject(raw.cooldowns) ?? {}) }
  state.inventory = sanitizeInventory(raw.inventory)
  state.traits = sanitizeTraits(raw.traits)
  state.pending = []
  state.memories = Array.isArray(raw.memories)
    ? raw.memories.filter(m => typeof m === 'string').slice(-MEMORY_LIMIT)
    : []

  for (const key of ['xp', 'satiety', 'happiness', 'cleanliness', 'health', 'bornAt', 'lastFedAt', 'lastActiveAt', 'lastSeenAt']) {
    if (typeof state[key] !== 'number' || !Number.isFinite(state[key])) state[key] = egg[key]
  }
  // 年龄是累计猪时间。老存档没有 ageMs 时**不要**填 0 —— 留着 undefined，
  // 交给 settlement.js 的 decay() 从 bornAt 推算（否则一只养了半年的猪会变成 0 天大）。
  if (typeof raw.ageMs !== 'number' || !Number.isFinite(raw.ageMs)) delete state.ageMs
  if (typeof raw.cleanliness !== 'number') state.cleanliness = egg.cleanliness
  if (typeof raw.health !== 'number') state.health = MAX.health
  if (typeof state.stage !== 'string') state.stage = state.hatched === true ? 'piglet' : 'box'
  if (typeof state.name !== 'string' || state.name.trim() === '') state.name = egg.name

  state.health = clamp(Math.round(state.health), 0, MAX.health)
  state.satiety = clamp100(state.satiety)
  state.happiness = clamp100(state.happiness)
  state.cleanliness = clamp100(state.cleanliness)
  state.hatched = state.hatched === true
  if (!isSeed(state.seed)) state.seed = seedFor(state)
  if (state.stage === 'elder') state.stage = 'middle'
  if (!Number.isInteger(state.pendingSeq) || state.pendingSeq < 0) state.pendingSeq = 0
  ensureDialogue(state)
  ensureSkins(state)
  return state
}

export function asObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null
}

/** 背包里还认的三个货架：食物 / 洗浴 / 玩具。 */
export const KEPT_INVENTORY_KINDS = Object.freeze(['food', 'bath', 'toy'])

/**
 * 背包清洗 —— 陷阱 #3 的落点。
 *
 * 参考项目拿整个 SHOP 当白名单。砍掉 bait / dress / medicine / revive /
 * promotion 五个货架之后，老存档里那几类物品会在这里被静默丢掉：这是**有意**的
 * （货架没了，留着也用不了）。真正要守住的是**食物/洗浴/玩具** —— 它们还在 SHOP
 * 里，所以白名单直接来自 SHOP 就能让老存档的苹果、香皂、皮球原样留下；
 * 下面再按 kind 确认一次，免得以后有人往 SHOP 里加别的货架时误伤。
 */
export function sanitizeInventory(raw) {
  const source = asObject(raw)
  if (source === null) return {}
  const out = {}
  for (const [key, count] of Object.entries(source)) {
    if (!Number.isFinite(count)) continue
    const n = Math.floor(count)
    if (n <= 0) continue
    const item = itemByKey(key)
    if (item === null || !KEPT_INVENTORY_KINDS.includes(item.kind)) continue
    out[key] = n
  }
  return out
}

export function sanitizeTraits(raw) {
  const source = asObject(raw)
  const out = {}
  for (const key of TRAIT_ORDER) {
    const value = source?.[key]
    out[key] = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
  }
  return out
}
