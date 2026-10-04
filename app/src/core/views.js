// @ts-check
/**
 * 派生视图（三维 / 心情 / 血条 / 进度条）。
 *
 * 纯函数领域逻辑：时间由 nowMs 传入，不读写文件、不碰 DOM。
 *
 * 砍掉的是：生病/死亡/离家三种心情（没有那些状态了）、体重格式化、
 * 以及一批已删模块的重导出。
 *
 * @module piggy-core/core/views
 */

import { LIFE_STAGES, MAX, SLEEPY_AFTER_MINUTES, THRESHOLDS } from './data/life.js'
import { SHOP } from './data/shop.js'
import { TRAITS, TRAIT_ORDER } from './data/traits.js'
import { DIET } from './constants.js'
import { clamp, clamp100 } from './effects.js'
import { decay } from './settlement.js'

/** Trait totals, always including every trait. */
export function traitView(state) {
  const out = {}
  for (const key of TRAIT_ORDER) out[key] = state.traits?.[key] ?? 0
  return out
}

/**
 * What the pig looks like it feels. Brings the pig up to date first, so a panel
 * that only asks for the mood still sees the current bars.
 */
export function mood(state, nowMs) {
  decay(state, nowMs)
  if (state.satiety < THRESHOLDS.hungry) return { key: 'hungry', emoji: '🍎', label: '饿了' }
  if (state.cleanliness < THRESHOLDS.dirty) return { key: 'dirty', emoji: '🫧', label: '该洗澡了' }
  if (nowMs - state.lastActiveAt > SLEEPY_AFTER_MINUTES * 60000) return { key: 'sleepy', emoji: '💤', label: '睡着了' }
  if (state.happiness >= 75) return { key: 'happy', emoji: '❤️', label: '很开心' }
  if (state.happiness < THRESHOLDS.lonely) return { key: 'lonely', emoji: '🥺', label: '有点孤单' }
  return { key: 'fine', emoji: '😊', label: '还不错' }
}

export const healthPercent = state => Math.round((clamp(state.health, 0, MAX.health) / MAX.health) * 100)

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function bar(value, width = 10) {
  const filled = Math.round((clamp100(value) / 100) * width)
  return `${'▓'.repeat(filled)}${'░'.repeat(width - filled)}`
}

export { LIFE_STAGES, MAX, THRESHOLDS, SHOP, TRAITS, TRAIT_ORDER, DIET }
