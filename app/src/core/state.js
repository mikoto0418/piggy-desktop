// @ts-check
/**
 * 新猪的初始状态、领养/重置/改名，以及开发者模式的补丁。
 *
 * 纯函数领域逻辑：时间由 nowMs 传入，不读写文件、不碰 DOM。
 *
 * 参考项目把「新猪的初始状态」放在 core/egg.js；本模块树不再有那个文件，
 * 于是 `layEgg()` / `hatch()` / `hatchEgg()` 搬到这里，和 adopt/reset 待在一起。
 * 复活(revive)、疾病、时间倍率、装扮这些字段随玩法一起删掉了。
 *
 * @module piggy-core/core/state
 */

import { MAX } from './data/life.js'
import { MAX_LEVEL, xpForLevel } from './data/growth.js'
import { formByKey } from './data/evolution.js'
import { lifeStageFor } from './clock.js'
import { MEMORY_LIMIT, STATE_VERSION } from './constants.js'
import { clamp, remember } from './effects.js'
import { emptyDialogue } from './lines.js'
import { sanitizeInventory, sanitizeTraits } from './migrate.js'
import { decay } from './settlement.js'

/**
 * A brand new pig, still in its box.
 *
 * 只有基础照顾要用的字段：四维、等级、背包（食物/洗浴/玩具）、台词、记忆、统计。
 * 体重、金币、课时、图鉴、日记、疾病、活动一律不存在 —— 也就没有机会再被写回存档。
 * @param {number} nowMs
 */
export function layEgg(nowMs) {
  return {
    version: STATE_VERSION,
    name: '猪猪',
    bornAt: nowMs,
    hatched: false,
    /** Last stage the panel announced; drives the "grew up" message. */
    stage: 'box',
    /** 形态（data/evolution.js 的 key），null 是普通的猪。P2 才用。 */
    form: null,
    /** Selected cosmetic skin. */
    skin: 'default',
    customSkins: [],
    /** Accumulated pig time in ms — age is this, not wall clock. */
    ageMs: 0,
    xp: 0,
    satiety: 70,
    happiness: 70,
    cleanliness: 90,
    health: MAX.health,
    inventory: {},
    traits: { intel: 0, charm: 0, strong: 0 },
    lastFedAt: 0,
    lastActiveAt: nowMs,
    lastSeenAt: nowMs,
    cooldowns: {},
    pending: [],
    pendingSeq: 0,
    dialogue: emptyDialogue(),
    memories: [],
    stats: {
      turns: 0, messages: 0, tools: 0, toolErrors: 0, agentErrors: 0,
      levelUps: 0, feeds: 0, baths: 0, plays: 0, pets: 0, purchases: 0,
    },
  }
}

/**
 * Open the box. The piglet falls out — it does not start as a fully grown pig,
 * and `ageMs` starts counting from the moment it does.
 *
 * `lastSeenAt` is pulled up to `nowMs` too: a box can sit unopened for a week,
 * and hatching it must not immediately drain a week's worth of bars.
 */
export function hatch(state, nowMs) {
  state.hatched = true
  // A new body starts at Lv1: anything the box picked up before it opened
  // does not count toward growing up.
  state.xp = 0
  state.bornAt = nowMs
  state.ageMs = 0
  state.stage = 'piglet'
  state.health = Math.max(state.health, 1)
  state.lastSeenAt = nowMs
  remember(state, '纸盒打开了，一只小猪蹦了出来 🐷', nowMs)
  return state
}

/** A brand new pig, already out of the box. */
export function hatchEgg(nowMs) {
  const state = layEgg(nowMs)
  state.hatched = true
  state.stage = 'piglet'
  remember(state, '纸盒打开了，一只小猪蹦了出来 🐷', nowMs)
  return state
}

// ---------------------------------------------------------------------------
// Starting over
// ---------------------------------------------------------------------------

/** Wipe the pig and start from a fresh box. */
export function reset(nowMs) {
  return layEgg(nowMs)
}

/**
 * What a new pig inherits from the old one.
 *
 * 三维本事、皮肤和记忆跟着走；等级和四维不跟 —— 领养一只新猪不该直接继承
 * 一只养了几个月的身体。（参考项目还继承课时、兴趣、纪念品和图鉴，那些玩法已砍。）
 */
export const INHERITED = ['traits', 'skin', 'customSkins']

export function inherit(oldState, fresh, nowMs) {
  if (oldState === null) return fresh
  for (const key of INHERITED) {
    if (oldState[key] !== undefined) fresh[key] = structuredCloneish(oldState[key])
  }
  if (Array.isArray(oldState.memories)) fresh.memories = oldState.memories.slice(-MEMORY_LIMIT)
  remember(fresh, '🐖 新的小猪来了，本事都留下了', nowMs)
  return fresh
}

/** JSON round-trip; every inherited field is plain data. */
export function structuredCloneish(value) {
  try { return JSON.parse(JSON.stringify(value)) } catch (error) { return value }
}

/**
 * Start over with a fresh box. The old pig's story stays in `memories`.
 *
 * 参考项目用的是 `Object.assign(state, fresh)`：宿主手里握着同一个对象，
 * 只能原地改。但那样一来，新表里没有的老字段（coins、lessons、illness……）
 * 会原封不动留在对象上。所以这里先把 fresh 里不存在的键删掉，再合并。
 */
export function adopt(state, nowMs) {
  const fresh = inherit(state, layEgg(nowMs), nowMs)
  remember(fresh, '又领养了一只，纸盒里传来窸窸窣窣的声音 📦', nowMs)
  if (state === null || typeof state !== 'object') return fresh
  for (const key of Object.keys(state)) {
    if (!(key in fresh)) delete state[key]
  }
  return Object.assign(state, fresh)
}

/** Put the pig's clock back to now, so its age counts real time again. */
export function ageFromNow(state, nowMs) {
  if (state === null) return state
  state.bornAt = nowMs
  state.ageMs = 0
  state.stage = lifeStageFor(state, nowMs).key
  state.lastSeenAt = nowMs
  remember(state, '🔧 年龄归零，从现在开始按真实时间算', nowMs)
  return state
}

// ---------------------------------------------------------------------------
// Developer mode
// ---------------------------------------------------------------------------

/** Numeric fields dev mode may set, with their legal range. */
export const DEV_NUMBERS = Object.freeze({
  satiety: [0, 100],
  happiness: [0, 100],
  cleanliness: [0, 100],
  health: [0, MAX.health],
  xp: [0, 10_000_000],
})

/**
 * Applies an arbitrary patch to the pig so the panel can be driven into any
 * state without waiting days for it. Everything is clamped through the same
 * bounds the game uses, so dev mode can produce a *valid* state but never a
 * corrupt one.
 */
export function applyDevPatch(state, patch, nowMs) {
  if (state === null || typeof patch !== 'object' || patch === null) return state
  const before = { hatched: state.hatched, stage: state.stage }

  for (const [key, [lo, hi]] of Object.entries(DEV_NUMBERS)) {
    const value = patch[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      state[key] = clamp(Math.round(value), lo, hi)
    }
  }

  if (patch.traits !== null && typeof patch.traits === 'object') {
    state.traits = sanitizeTraits({ ...state.traits, ...patch.traits })
  }

  if (patch.inventory !== null && typeof patch.inventory === 'object') {
    state.inventory = sanitizeInventory({ ...state.inventory, ...patch.inventory })
  }

  // Fast-forward: decay the pig as if `__advanceMs` had really passed. This is
  // the whole point of dev mode — the interesting states take days to reach.
  if (typeof patch.__advanceMs === 'number' && Number.isFinite(patch.__advanceMs) && patch.__advanceMs > 0) {
    const advance = Math.min(patch.__advanceMs, 60 * 86_400_000)
    state.lastSeenAt = nowMs - advance
    decay(state, nowMs)
  }

  // Level is what takes months to see: jump straight to one.
  if (typeof patch.level === 'number' && Number.isFinite(patch.level)) {
    state.xp = xpForLevel(clamp(Math.round(patch.level), 1, MAX_LEVEL))
  }

  // Age only counts days on the panel now; still jumpable for testing.
  if (typeof patch.ageDays === 'number' && Number.isFinite(patch.ageDays)) {
    const days = Math.max(0, patch.ageDays)
    state.bornAt = nowMs - days * 86_400_000
    state.ageMs = days * 86_400_000
  }

  if (patch.hatched === true && state.hatched !== true) state.hatched = true
  if (patch.hatched === false) {
    state.hatched = false
    state.stage = 'box'
  }

  // 形态（P2）：调试页要能直接变成猪猪王 / 恶魔猪，条件不看。传 null 恢复普通。
  if (patch.form === null) state.form = null
  else if (typeof patch.form === 'string' && formByKey(patch.form) !== null) state.form = patch.form

  state.stage = lifeStageFor(state, nowMs).key
  state.lastSeenAt = nowMs
  remember(state, `🔧 开发者改了状态（${before.stage} → ${state.stage}）`, nowMs)
  return state
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

export function rename(state, rawName, nowMs) {
  const cleaned = String(rawName ?? '').replace(/\s+/g, ' ').trim()
  if (cleaned === '' || [...cleaned].length > 16) return null
  state.name = cleaned
  remember(state, `改名叫「${cleaned}」`, nowMs)
  return cleaned
}
