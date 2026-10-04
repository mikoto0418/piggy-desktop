// @ts-check
/**
 * 形态：长成之后可以换的一身样子（猪猪王、恶魔猪）。
 *
 * 等级成长（data/life.js）照旧；形态只是在某个阶段上换一身样子，不加收益。
 * P2 才会真正启用，数据先留着。
 *
 * ⚠️ 注意：参考项目里每个形态都靠商店道具解锁（王冠 / 恶魔契约），
 * 而 promotion 货架已经随「晋升」一起砍掉。所以本表的 `via` / `item` 字段
 * 现在只是历史数据，激活形态走 core/evolution.js 的 `setForm()`。
 *
 * 🔴 **条件表必须只用「还活着的」统计量**（2026-10 修）：
 * 原表用的是 `{ intel: 20, charm: 20, strong: 20, jobs: 10 }` ——
 * 但这四个量全都随上学/打工一起砍掉了：
 *   - `traits.intel/charm/strong` 现在**永远是 0**（没有任何地方再增加它们）
 *   - `stats.jobs` 已经不存在
 * 结果就是**猪猪王永久不可达**：条件永远不满足，图鉴里永远是灰的。
 * 现在改用**真正会累积**的照顾次数（`stats.plays` / `pets` / `feeds`）。
 *
 * @module piggy-core/data/evolution
 */

/**
 * @typedef {object} PigForm
 * @property {string} key       存档里 state.form 的值
 * @property {'item'} via
 * @property {string} item
 * @property {string} label
 * @property {string} emoji
 * @property {string} art       assets/ 里的立绘名
 * @property {boolean} actionArt 有没有喂食等各个动作的立绘
 * @property {string} line
 * @property {string} hint      图鉴未解锁时显示的谜面，不直接泄露精确条件
 * @property {string} stage     到了哪个阶段（data/life.js 的 key）才能换
 * @property {Readonly<Record<string, number>>} requires  各要多少。
 *   key 只允许是**还在累积**的量：`plays`/`pets`/`feeds`/`baths`（取自 `state.stats`）。
 *   不要再用 `intel`/`charm`/`strong`/`jobs` —— 那些已经死了，写了就是永久锁死。
 * @property {readonly string[]} hides  这身样子盖住的装扮位置
 */

/** @type {readonly Readonly<PigForm>[]} */
export const FORMS = Object.freeze([
  Object.freeze({
    key: 'king', via: 'item', item: 'crown', label: '猪猪王', emoji: '👑', art: 'pig-king', actionArt: true,
    line: '被照顾得无微不至，也就有了自己的王冠。',
    hint: '当嬉闹声攒够，又被人摸了无数次头，金色会自己找上门。',
    stage: 'middle',
    requires: Object.freeze({ plays: 20, pets: 50 }),
    hides: Object.freeze(['head', 'back']),
  }),
  Object.freeze({
    key: 'devil', via: 'item', item: 'contract', label: '恶魔猪', emoji: '😈', art: 'pig-devil', actionArt: true,
    line: '吃得好、玩得野，也就玩出了自己的小脾气。',
    hint: '当饭碗总是满的、嬉闹也足够多时，一纸约定会来敲门。',
    stage: 'middle',
    requires: Object.freeze({ feeds: 30, plays: 40 }),
    hides: Object.freeze(['head', 'back']),
  }),
])

/** The 加冕 App keeps its king card until C4 replaces the app. */
export const CORONATION_FORMS = Object.freeze(FORMS.filter(form => form.item === 'crown'))

/** The form `/pig crown` picks when none is named. */
export const DEFAULT_FORM = 'king'

/** @returns {Readonly<PigForm> | null} */
export function formByKey(key) {
  return FORMS.find(form => form.key === key) ?? null
}
