// @ts-check
/**
 * 照护动作（喂食/洗澡/玩耍/摸摸）。
 *
 * 纯函数领域逻辑：时间由 nowMs 传入，不读写文件、不碰 DOM。
 *
 * 砍掉的是疾病相关的手脚：吃撑了不会得肠胃病（`rollForOverfeeding`）、
 * 玩耍不再减体重（`reducePlayWeight`）、也不写日记。
 * 「撑住了」那句抱怨留着，阈值换成 constants.js 的 OVERFULL_AT。
 *
 * @module piggy-core/core/care
 */

import { CARE_KIND, careItems } from './data/shop.js'
import { ACTIONS, DIET, OVERFULL_AT } from './constants.js'
import { applyEffects, remember } from './effects.js'
import { growFromRealWork } from './growth.js'
import { say } from './lines.js'
import { decay } from './settlement.js'

/** Which line scene each care action makes the pig speak from. */
const CARE_SCENE = Object.freeze({ feed: 'eat', bathe: 'bathe', play: 'play', pet: 'pet' })

/** Which shelves the pig can actually use right now, for the panel's picker. */
export function careView(state) {
  const out = {}
  for (const action of ['feed', 'bathe', 'play']) out[action] = careOptions(state, action)
  return out
}

/**
 * 被动投喂：主人真实干活（一轮对话结束、跑了一次工具）顺手喂的一口。
 * 数值见 constants.js 的 DIET，成长加成单独按天封顶（growth.js）。
 * @param {object} state
 * @param {string} event - a DIET key
 * @param {number} nowMs
 */
export function feed(state, event, nowMs) {
  const diet = DIET[event]
  if (diet === undefined) return []
  decay(state, nowMs)
  switch (event) {
    case 'message': state.stats.messages += 1; break
    case 'turn': state.stats.turns += 1; break
    case 'tool': state.stats.tools += 1; break
    case 'toolError': state.stats.toolErrors += 1; break
    case 'agentError': state.stats.agentErrors += 1; break
    default: break
  }
  // The box does not eat: the work still counts in the stats, nothing else.
  if (state.hatched !== true) return []
  applyEffects(state, diet, nowMs)
  growFromRealWork(state, event, nowMs)
  return []
}

// ---------------------------------------------------------------------------
// Care actions
// ---------------------------------------------------------------------------

export function actionCooldownSeconds(state, action, nowMs) {
  const spec = ACTIONS[action]
  if (spec === undefined || spec.cooldownMs <= 0) return 0
  const last = state.cooldowns?.[action] ?? 0
  const remaining = spec.cooldownMs - (nowMs - last)
  return remaining <= 0 ? 0 : Math.ceil(remaining / 1000)
}

export const actionReady = (state, action, nowMs) => actionCooldownSeconds(state, action, nowMs) === 0

/**
 * Do one care action.
 *
 * 喂食/洗澡/玩耍各自花掉自己货架上的一件东西（QQ 宠物把食物、日用品、药
 * 分成不同背包格，这里同理）；摸摸是亲昵，不花钱。
 *
 * @param {object} state
 * @param {'feed'|'bathe'|'play'|'pet'} action
 * @param {number} nowMs
 * @param {string} [itemKey] - 用哪一件；不传就用最便宜的一件
 * @returns {{ok: boolean, reason?: string, item?: string|null, spent?: boolean, kind?: string, wait?: number}}
 */
export function act(state, action, nowMs, itemKey) {
  const spec = ACTIONS[action]
  if (spec === undefined) return { ok: false, reason: 'unknown' }
  if (state === null) return { ok: false, reason: 'absent' }
  if (state.hatched !== true) return { ok: false, reason: 'box' }
  decay(state, nowMs)

  const wait = actionCooldownSeconds(state, action, nowMs)
  if (wait > 0) return { ok: false, reason: 'cooldown', wait }

  // Feeding, washing and playing each spend something off their own shelf.
  // Petting is affection, and costs nothing.
  const shelf = CARE_KIND[action]
  let item = null
  if (shelf !== undefined) {
    item = resolveCareItem(state, shelf, itemKey)
    if (item === null) return { ok: false, reason: 'no-item', kind: shelf }
    if (item.default !== true) {
      const left = (state.inventory?.[item.key] ?? 0) - 1
      state.inventory = { ...(state.inventory ?? {}) }
      if (left > 0) state.inventory[item.key] = left
      else delete state.inventory[item.key]
    }
  }

  state.cooldowns = { ...(state.cooldowns ?? {}), [action]: nowMs }
  if (action === 'feed') { state.stats.feeds += 1; state.lastFedAt = nowMs }
  else if (action === 'bathe') state.stats.baths += 1
  else if (action === 'play') state.stats.plays += 1
  else if (action === 'pet') state.stats.pets += 1

  const satietyBefore = state.satiety
  applyEffects(state, careEffects(item, spec), nowMs)
  remember(state, item === null ? spec.verb : `${item.emoji} ${spec.label}用了「${item.label}」`, nowMs)
  // Feeding a pig that was already stuffed gets a different complaint.
  say(state, action === 'feed' && satietyBefore >= OVERFULL_AT ? 'overfull' : CARE_SCENE[action], nowMs)
  return { ok: true, item: item === null ? null : item.key, spent: item !== null && item.default !== true }
}

/**
 * The item an action will spend: the caller's pick when it is actually in the
 * bag, otherwise the cheapest thing the pig owns. The free default toy makes
 * `play` always available.
 */
export function resolveCareItem(state, kind, wanted) {
  const usable = careItems(kind).filter(
    item => item.default === true || (state.inventory?.[item.key] ?? 0) > 0,
  )
  if (usable.length === 0) return null
  if (wanted === undefined || wanted === null || wanted === '') return usable[0]
  return usable.find(item => item.key === wanted) ?? null
}

/**
 * Blend an item's own effects with the action's baseline. The item decides how
 * far its own bar moves; the action keeps whatever the item does not mention.
 *
 * 这就是「动作数值与 ACTIONS 表一致」的落点：道具没写的维度，一律回落到
 * ACTIONS 里的基线；没有道具时（pet）整份基线原样生效。
 */
export function careEffects(item, spec) {
  if (item === null) return spec
  return {
    weightG: item.satiety !== undefined && spec.key === 'feed' ? spec.weightG : 0,
    satiety: item.satiety ?? spec.satiety,
    happiness: item.happiness ?? spec.happiness,
    cleanliness: item.cleanliness ?? spec.cleanliness,
  }
}

/** What each care action could be done with right now, and how many are left. */
export function careOptions(state, action) {
  const kind = CARE_KIND[action]
  if (kind === undefined) return []
  return careItems(kind)
    .filter(item => item.default === true || (state.inventory?.[item.key] ?? 0) > 0)
    .map(item => ({
      key: item.key,
      label: item.label,
      emoji: item.emoji,
      price: item.price,
      default: item.default === true,
      count: item.default === true ? null : (state.inventory?.[item.key] ?? 0),
      satiety: item.satiety ?? 0,
      happiness: item.happiness ?? 0,
      cleanliness: item.cleanliness ?? 0,
    }))
}

export const canFeed = (state, nowMs) => actionReady(state, 'feed', nowMs)

export const feedCooldownSeconds = (state, nowMs) => actionCooldownSeconds(state, 'feed', nowMs)
