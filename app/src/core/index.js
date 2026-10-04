// @ts-check
/**
 * piggy-core —— 桌面猪的纯领域模型（只有基础照顾）。
 *
 * 零依赖、零 IO：不读文件、不发请求、不碰 DOM、不自己取时间或随机数。
 * 宿主负责存档、时钟和界面，把 nowMs 等外部输入传进来。
 *
 * 时间只有一个入口：`decay(state, nowMs)`。
 * 保留的东西：四维状态（satiety/happiness/cleanliness/health）、四个照顾动作
 * （feed/bathe/play/pet）、随时间衰减与成长、等级与形态（纯展示）、台词气泡、
 * 皮肤、存档迁移。
 *
 * @module piggy-core
 */

// --- 领域常量与动作表 -------------------------------------------------------
export {
  ACTIONS, ACTION_ORDER, STATE_VERSION, DIET, OVERFULL_AT,
  DAY_MS, SETTLE_STEP_MS,
  SATIETY_DECAY_PER_MIN, HAPPINESS_DECAY_PER_MIN, CLEANLINESS_DECAY_PER_MIN,
} from './constants.js'

// --- 时间 / 年龄 / 等级 -----------------------------------------------------
export {
  ageDays, ageMonths, dayKeyFor, daysToNextStage,
  levelFor, levelProgress, levelTitle, lifeStageFor, nextLifeStage,
} from './clock.js'

// --- 时间推进（唯一入口）----------------------------------------------------
export { decay } from './settlement.js'

// --- 成长 -------------------------------------------------------------------
export { careFactor, grow, growFromRealWork, growWithTime } from './growth.js'

// --- 照顾动作 ---------------------------------------------------------------
export {
  act, actionCooldownSeconds, actionReady, canFeed,
  careEffects, careOptions, careView, feed, feedCooldownSeconds, resolveCareItem,
} from './care.js'

// --- 新猪 / 领养 / 改名 / 开发者模式 ----------------------------------------
export {
  DEV_NUMBERS, INHERITED, adopt, ageFromNow, applyDevPatch,
  hatch, hatchEgg, inherit, layEgg, rename, reset, structuredCloneish,
} from './state.js'

// --- 存档迁移 ---------------------------------------------------------------
export { KEPT_INVENTORY_KINDS, asObject, migrate, sanitizeInventory, sanitizeTraits } from './migrate.js'
export {
  FIRST_UPGRADE_FROM, UPGRADES, V11_OLD_JOB_PAY, V11_SUBJECT_OF,
  V13_REMOVED_FIELDS, V13_REMOVED_STATS, applyUpgrades,
} from './upgrades.js'

// --- 派生视图 ---------------------------------------------------------------
export { bar, healthPercent, mood, traitView } from './views.js'

// --- 台词气泡 ---------------------------------------------------------------
export { chat, emptyDialogue, ensureDialogue, pickLine, replyToLine, say, setOwnerName, setQuiet } from './lines.js'

// --- 皮肤 -------------------------------------------------------------------
export { allSkins, ensureSkins, registerCustomSkin, selectSkin, skinPalette, skinStageView, skinView } from './skins.js'

// --- 形态（P2）-------------------------------------------------------------
export { DEFAULT_FORM, FORMS, formByKey, formStageView, formsView, setForm } from './evolution.js'

// --- 背包 / 道具 ------------------------------------------------------------
export { buy, grantAll, inventoryView, useItem } from './inventory.js'

// --- 效果与消息队列 ---------------------------------------------------------
export { announce, applyEffects, clamp, clamp100, clock, drainPending, remember, takePending } from './effects.js'

// --- 随机（种子存在存档里）--------------------------------------------------
export { chance, isSeed, pickOne, roll, rollerFor, seedFor } from './random.js'

// --- 静态数值表 -------------------------------------------------------------
export { DAYS_PER_MONTH, LEVEL_TITLES, LIFE_STAGES, MAX, SLEEPY_AFTER_MINUTES, THRESHOLDS, lifeStageByKey } from './data/life.js'
export {
  DSH_GROWTH, DSH_GROWTH_DAILY_CAP, GROWTH_CURVE_K, GROWTH_PER_HOUR,
  MAX_LEVEL, MIN_GROWTH_FACTOR, MOOD_GROWTH_FACTORS, NEGLECT_GROWTH_FACTOR, xpForLevel,
} from './data/growth.js'
export { TRAITS, TRAIT_ORDER } from './data/traits.js'
export {
  CARE_KIND, DEFAULTS, DEFAULT_TOY, KIND_LABEL, KIND_ORDER, SHOP,
  careItems, defaultCareItem, itemByKey, itemsOfKind,
} from './data/shop.js'
export { CORONATION_FORMS } from './data/evolution.js'
export {
  CATCHPHRASE_CHANCE, DEFAULT_OWNER_NAME, IDLE_CHAT_MINUTES, LINES, LINE_SCENES,
  OWNER_NAME_MAX, OWNER_TOKEN, REPLY_HAPPINESS, WELCOME_BACK_AFTER_MINUTES,
} from './data/lines.js'
export { REQUIRED_SKIN_SCENES, SKINS, SKIN_SCENES, SKIN_SLOTS, SKIN_SLOT_ORDER, skinByKey } from './data/skins.js'
