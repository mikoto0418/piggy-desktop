// @ts-check
/**
 * 时间推进：四维衰减 + 变老 + 随时间成长。
 *
 * **这是整个模块树里唯一的时间入口。** 参考项目在同一个函数里还结算了
 * 离家活动、疾病推进、死亡、体重、日记、图鉴和掉落；那些玩法全部砍掉之后，
 * 这个文件必须重写而不是删文件 —— 保留的只有「按 SETTLE_STEP_MS 切步 → 衰减 → 变老」。
 *
 * 纯函数领域逻辑：时间由 nowMs 传入，不读写文件、不碰 DOM、不取时间。
 * @module piggy-core/core/settlement
 */

import {
  CLEANLINESS_DECAY_PER_MIN,
  HAPPINESS_DECAY_PER_MIN,
  SATIETY_DECAY_PER_MIN,
  SETTLE_STEP_MS,
} from './constants.js'
import { clamp100 } from './effects.js'
import { growWithTime } from './growth.js'

/**
 * Bring the pig up to `nowMs`.
 *
 * The gap is walked in steps of SETTLE_STEP_MS, so a bar that crosses a
 * threshold at 3 a.m. really does cross it at 3 a.m. rather than at whatever
 * moment the panel was next opened.
 *
 * @param {object} state
 * @param {number} nowMs
 * @param {{roll?: import('./random.js').Roll}} [options] - 保留参考项目的签名；
 *   随机玩法（发病、掉落）已经砍掉，这里不再使用。
 * @returns {object} the same state object, brought up to date
 */
export function decay(state, nowMs, options = {}) {
  const fromMs = state.lastSeenAt ?? nowMs
  state.lastSeenAt = nowMs
  // An unopened box is not a pet yet: it never gets hungry, dirty or older
  // while it waits to be poked open.
  if (state.hatched !== true) return state
  if (!(nowMs > fromMs)) return state
  if (typeof state.ageMs !== 'number' || !Number.isFinite(state.ageMs)) {
    // First tick after loading an old save: seed pig time from the birthday.
    state.ageMs = typeof state.bornAt === 'number' ? Math.max(0, fromMs - state.bornAt) : 0
  }

  let cursor = fromMs
  while (cursor < nowMs) {
    const stepEnd = Math.min(nowMs, cursor + SETTLE_STEP_MS)
    step(state, { elapsedMs: stepEnd - cursor, atMs: stepEnd })
    cursor = stepEnd
  }
  return state
}

/**
 * One step of pig time: bars, then age (which carries the passive growth).
 * @param {object} state
 * @param {{elapsedMs: number, atMs: number}} tick
 */
function step(state, tick) {
  drainBars(state, tick.elapsedMs / 60000)
  growOlder(state, tick.elapsedMs, tick.atMs)
}

/**
 * Time passing: the three bars fall at their own fixed rates and are clamped to
 * 0..100. There is no away multiplier and no floor any more — the pig is always
 * at home, so the plain per-minute rate is the whole formula.
 */
function drainBars(state, minutes) {
  state.satiety = clamp100(state.satiety - minutes * SATIETY_DECAY_PER_MIN)
  state.happiness = clamp100(state.happiness - minutes * HAPPINESS_DECAY_PER_MIN)
  state.cleanliness = clamp100(state.cleanliness - minutes * CLEANLINESS_DECAY_PER_MIN)
}

/**
 * Age is elapsed time (the debug time scale is gone), and the same pig time
 * drives passive growth.
 */
function growOlder(state, elapsedMs, atMs) {
  state.ageMs += elapsedMs
  growWithTime(state, elapsedMs, atMs)
}
