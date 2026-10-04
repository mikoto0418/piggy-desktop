// @ts-check
/**
 * 领域常量与动作表。
 *
 * 纯函数领域逻辑：时间由 nowMs 传入，不读写文件、不碰 DOM。
 * @module piggy-core/core/constants
 */

/** Bumped when the saved shape changes in a way migrate() must handle. */
export const STATE_VERSION = 13

export const MEMORY_LIMIT = 8

export const PENDING_LIMIT = 6

/**
 * Passive diet — what the pig gets for watching you actually work. Growth from
 * real work is separate and capped per day (data/growth.js DSH_GROWTH).
 *
 * `weightG` 字段保留自参考表：体重玩法已砍，这个数字不再参与任何结算。
 */
export const DIET = Object.freeze({
  message: { satiety: 1, happiness: 1, weightG: 6 },
  turn: { satiety: 2, happiness: 1, weightG: 14 },
  tool: { satiety: 2, happiness: 0, weightG: 9 },
  toolError: { satiety: 0, happiness: 1, weightG: 2 },
  agentError: { satiety: 0, happiness: 0, weightG: 2 },
})

/**
 * 四个照顾动作的基线数值 —— 与参考项目逐字一致（这是产品的全部内容）。
 *
 * `weightG` 同上：体重玩法已砍，字段留着当参考，不参与结算。
 * 每个动作真正落到四维上的数值由 care.js 的 `careEffects()` 决定：
 * 用了道具就以道具的数值为准，道具没写的才落到这里的基线。
 */
export const ACTIONS = Object.freeze({
  feed: {
    key: 'feed', label: '喂食', emoji: '🍎', verb: '吃了一口 🍎',
    cooldownMs: 0, satiety: 22, happiness: 6, cleanliness: 0, weightG: 90,
  },
  bathe: {
    key: 'bathe', label: '洗澡', emoji: '🛁', verb: '洗了个澡 🛁',
    cooldownMs: 0, satiety: -2, happiness: 8, cleanliness: 50, weightG: 0,
  },
  play: {
    key: 'play', label: '玩耍', emoji: '🎾', verb: '玩了一会儿 🎾',
    cooldownMs: 0, satiety: -5, happiness: 16, cleanliness: -4, weightG: 4,
  },
  pet: {
    key: 'pet', label: '摸摸', emoji: '❤️', verb: '被摸了摸头 ❤️',
    cooldownMs: 0, satiety: 0, happiness: 10, cleanliness: 0, weightG: 0,
  },
})

export const ACTION_ORDER = Object.freeze(['feed', 'bathe', 'play', 'pet'])

export const SATIETY_DECAY_PER_MIN = 0.08

export const HAPPINESS_DECAY_PER_MIN = 0.06

export const CLEANLINESS_DECAY_PER_MIN = 0.07

export const DAY_MS = 86_400_000

/**
 * The longest single step decay() takes. Long absences are walked in steps of
 * this size so thresholds are crossed when they really were; five minutes keeps
 * a month offline under ten thousand cheap steps.
 */
export const SETTLE_STEP_MS = 5 * 60_000

/**
 * 饱食度到这条线还继续喂，就会听到「撑住了」的抱怨。
 * 参考项目写在 ILLNESS_ONSET.overfullAt 里；疾病砍掉后挪到这里，数值不变。
 */
export const OVERFULL_AT = 95
