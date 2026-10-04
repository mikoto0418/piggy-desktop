// @ts-check
/**
 * 生命周期、等级与状态阈值 —— 静态数值表（零逻辑、零 IO）。
 * @module piggy-core/data/life
 */

/** Attribute ceilings. `health` keeps QQ Pet's 5-point scale. */
export const MAX = Object.freeze({ satiety: 100, happiness: 100, cleanliness: 100, health: 5 })

/** One "pig month" — what the stage table below counts in. */
export const DAYS_PER_MONTH = 30

/**
 * 状态阈值：饿、脏、孤单（心情）。成长减速、心情显示、闲着时的台词共用。
 * 参考项目把它放在 data/illness.js 里；疾病玩法砍掉后挪到这里，数值原样保留。
 */
export const THRESHOLDS = Object.freeze({
  hungry: 25,
  dirty: 35,
  lonely: 35,
})

/** 多久没互动算「睡着了」（分钟）—— 只影响心情显示。 */
export const SLEEPY_AFTER_MINUTES = 30

/**
 * @typedef {object} LifeStage
 * @property {string} key
 * @property {string} label
 * @property {string} emoji
 * @property {number} size
 * @property {number} [fromLevel] - 到这一级就换成这个形态
 * @property {string} line
 * @property {boolean} [box]
 * @property {string} [art]
 * @property {boolean} [faded]
 */
/**
 * 形态按**等级**换，不按年龄（B2）：幼年 → 青年 Lv10，青年 → 成年 Lv40。
 * 没有老年、没有寿命。key 沿用旧的 piglet/young/middle，美术和样式都挂在 key 上。
 * @type {ReadonlyArray<LifeStage>}
 */
export const LIFE_STAGES = Object.freeze([
  Object.freeze({
    key: 'box', label: '纸盒', emoji: '📦', size: 58, fromLevel: 0, box: true,
    line: '一个纸盒，侧面戳了几个透气孔',
  }),
  Object.freeze({
    key: 'piglet', label: '幼年猪', emoji: '🐖', art: 'piglet', size: 54, fromLevel: 1,
    line: '刚从纸盒里蹦出来，圆头圆脑',
  }),
  Object.freeze({
    key: 'young', label: '青年猪', emoji: '🐖', size: 60, fromLevel: 10,
    line: '长开了，走路带风',
  }),
  Object.freeze({
    key: 'middle', label: '成年猪', emoji: '🐖', size: 68, fromLevel: 40,
    line: '很有分量，会一屁股坐住你的椅子',
  }),
])

// ---------------------------------------------------------------------------
// Level — the curve and the sources of growth live in data/growth.js.
// ---------------------------------------------------------------------------

/** Titles, earned by level. The last one that applies wins. */
export const LEVEL_TITLES = Object.freeze([
  Object.freeze({ level: 1, label: '新来的', emoji: '🌱' }),
  Object.freeze({ level: 5, label: '熟面孔', emoji: '🙂' }),
  Object.freeze({ level: 10, label: '老伙计', emoji: '🤝' }),
  Object.freeze({ level: 20, label: '镇宅之猪', emoji: '🏠' }),
  Object.freeze({ level: 35, label: '十里八乡有名', emoji: '📣' }),
  Object.freeze({ level: 50, label: '传说', emoji: '🌟' }),
  Object.freeze({ level: 80, label: '神话', emoji: '👑' }),
])

export const lifeStageByKey = key => LIFE_STAGES.find(stage => stage.key === key) ?? null
