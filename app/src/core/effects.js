// @ts-check
/**
 * 记忆、公告与属性结算。
 *
 * 纯函数领域逻辑：时间由 nowMs 传入，不读写文件、不碰 DOM。
 * @module piggy-core/core/effects
 */

import { MAX } from './data/life.js'
import { MEMORY_LIMIT, PENDING_LIMIT } from './constants.js'

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export const clamp100 = value => clamp(value, 0, 100)

/** 面板上显示的时钟（HH:MM），只用于记忆里的一行前缀。 */
export function clock(nowMs) {
  const d = new Date(nowMs)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function remember(state, text, nowMs) {
  state.memories.push(`[${clock(nowMs)}] ${text}`)
  if (state.memories.length > MEMORY_LIMIT) state.memories.splice(0, state.memories.length - MEMORY_LIMIT)
}

/**
 * Queue a message for the panel.
 *
 * Every message gets an `id` from a counter that only goes up, so the panel
 * can tell two messages from the same instant apart.
 * @param {object} state
 * @param {string} kind
 * @param {string} text
 * @param {number} nowMs
 * @param {Record<string, unknown>} [extra] - kind-specific fields, e.g. a line's replies.
 * @returns {{id: number, kind: string, text: string, at: number}}
 */
export function announce(state, kind, text, nowMs, extra = {}) {
  state.pending = Array.isArray(state.pending) ? state.pending : []
  const id = (Number.isInteger(state.pendingSeq) && state.pendingSeq >= 0 ? state.pendingSeq : 0) + 1
  state.pendingSeq = id
  const message = { ...extra, id, kind, text, at: nowMs }
  state.pending.push(message)
  if (state.pending.length > PENDING_LIMIT) state.pending.splice(0, state.pending.length - PENDING_LIMIT)
  return message
}

export function takePending(state) {
  const out = Array.isArray(state.pending) ? state.pending.slice() : []
  state.pending = []
  return out
}

/** Take and clear the queued announcements. */
export function drainPending(state) {
  return takePending(state)
}

/**
 * Apply bar and health changes. Growth is not an effect: it goes through
 * growth.js `grow()`, which is what announces level-ups.
 *
 * 体重（weightG）随体重玩法一起砍掉：这里不再读写 state.weightG，
 * 否则 undefined + n 会算出 NaN。
 */
export function applyEffects(state, effects, nowMs) {
  if (effects.satiety) state.satiety = clamp100(state.satiety + effects.satiety)
  if (effects.happiness) state.happiness = clamp100(state.happiness + effects.happiness)
  if (effects.cleanliness) state.cleanliness = clamp100(state.cleanliness + effects.cleanliness)
  if (effects.health) state.health = clamp(Math.round(state.health + effects.health), 0, MAX.health)
  state.lastActiveAt = nowMs
}
