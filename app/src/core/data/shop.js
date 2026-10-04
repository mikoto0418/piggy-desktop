// @ts-check
/**
 * 照护物品 —— 静态数值表（零逻辑、零 IO）。
 *
 * ## 为什么每个货架都有一件免费默认件
 *
 * 参考项目里食物/洗浴/玩具都是**消耗品**，靠打工赚金币去商店买。
 * 本项目按需求砍掉了商店与金币（用户明确说「不需要学习打工商店旅行钓鱼」），
 * 消耗品于是断了来源 —— 新猪背包是空的，喂食与洗澡会永远返回 `no-item`，
 * 四个照顾动作里有两个永远按不动。
 *
 * 所以三个货架各配一件**免费且不消耗**的基础件，键名与付费货架**不重名**，
 * 这样 `resolveCareItem(state, kind, 'apple')` 想指定苹果时不会被默认件顶掉：
 *   - 食物：🥣 猪粮 `basic-feed`（饱食 +22 / 心情 +3，与最便宜的苹果同值）
 *   - 洗浴：💧 清水 `basic-wash`（清洁 +35 / 心情 +2，与最便宜的香皂同值）
 *   - 玩具：🎾 小皮球 `ball`（心情 +12 / 饱食 -3，参考项目原有）
 *
 * `act()` 里 `item.default === true` 不扣背包；`resolveCareItem()` 永远找得到它，
 * 所以新猪立刻喂得动、洗得动、玩得动。
 *
 * 付费货架**原样保留**（含 `price`，只是惰性元数据 —— 金币已砍，没人扣钱）：
 * 它们目前没有获取途径，属于备选数值表，留给 P2 万一要做补给/商店。
 * 保留它们还有一个硬理由：`migrate.js` 的 `sanitizeInventory` 拿 `SHOP` 当白名单，
 * 删条目会让老存档里的东西凭空消失。
 *
 * 砍掉的货架：诱饵(bait)、装扮(dress)、药品(medicine)、还魂丹(revive)、晋升(promotion)。
 *
 * `CARE_KIND` 和 `careItems()` 支撑喂食/洗澡/玩耍，**不能删**。
 *
 * @module piggy-core/data/shop
 */

/**
 * One shelf entry. Everything past `kind` is optional: food carries satiety,
 * bath carries cleanliness, toys carry happiness.
 *
 * @typedef {object} ShopItem
 * @property {string} key
 * @property {string} label
 * @property {string} emoji
 * @property {number} price
 * @property {string} kind
 * @property {number} [satiety]
 * @property {number} [happiness]
 * @property {number} [cleanliness]
 * @property {number} [health]
 * @property {boolean} [default]
 * @property {string} [blurb]
 */

/** 免费基础食物：新猪永远喂得动。 */
export const DEFAULT_FOOD = Object.freeze({
  key: 'basic-feed', label: '猪粮', emoji: '🥣', price: 0, kind: 'food',
  satiety: 22, happiness: 3, default: true,
})

/** 免费基础洗浴：新猪永远洗得动。 */
export const DEFAULT_BATH = Object.freeze({
  key: 'basic-wash', label: '清水', emoji: '💧', price: 0, kind: 'bath',
  cleanliness: 35, happiness: 2, default: true,
})

/** 免费基础玩具（参考项目原有）。 */
export const DEFAULT_TOY = Object.freeze({
  key: 'ball', label: '小皮球', emoji: '🎾', price: 0, kind: 'toy',
  happiness: 12, satiety: -3, default: true,
})

/** 三个货架各自的免费默认件。 */
export const DEFAULTS = Object.freeze({
  food: DEFAULT_FOOD,
  bath: DEFAULT_BATH,
  toy: DEFAULT_TOY,
})

/** @type {ReadonlyArray<ShopItem>} */
export const SHOP = Object.freeze([
  // --- food ---------------------------------------------------------------
  Object.freeze({ key: 'apple', label: '苹果', emoji: '🍎', price: 6, kind: 'food', satiety: 22, happiness: 3 }),
  Object.freeze({ key: 'bread', label: '面包', emoji: '🍞', price: 10, kind: 'food', satiety: 32, happiness: 4 }),
  Object.freeze({ key: 'bone', label: '肉骨头', emoji: '🍖', price: 15, kind: 'food', satiety: 45, happiness: 8, cleanliness: -4 }),
  Object.freeze({ key: 'rice', label: '蛋炒饭', emoji: '🍚', price: 24, kind: 'food', satiety: 58, happiness: 10 }),
  Object.freeze({ key: 'cake', label: '奶油蛋糕', emoji: '🎂', price: 40, kind: 'food', satiety: 80, happiness: 18, cleanliness: -8 }),
  Object.freeze({ key: 'noodle', label: '大碗拉面', emoji: '🍜', price: 66, kind: 'food', satiety: 100, happiness: 26, cleanliness: -6 }),
  Object.freeze({ key: 'fish', label: '小鱼干', emoji: '🐟', price: 12, kind: 'food', satiety: 30, happiness: 7 }),
  Object.freeze({ key: 'pumpkin', label: '南瓜粥', emoji: '🎃', price: 34, kind: 'food', satiety: 62, happiness: 13 }),
  Object.freeze({ key: 'skewer', label: '烤肉串', emoji: '🍢', price: 58, kind: 'food', satiety: 76, happiness: 21, cleanliness: -7 }),
  Object.freeze({ key: 'feast', label: '豪华大餐', emoji: '🍱', price: 130, kind: 'food', satiety: 100, happiness: 34, cleanliness: -10 }),
  // --- bath ---------------------------------------------------------------
  Object.freeze({ key: 'soap', label: '香皂', emoji: '🧼', price: 6, kind: 'bath', cleanliness: 35, happiness: 2 }),
  Object.freeze({ key: 'shower', label: '冲个澡', emoji: '🚿', price: 10, kind: 'bath', cleanliness: 50, happiness: 3 }),
  Object.freeze({ key: 'shampoo', label: '沐浴露', emoji: '🧴', price: 14, kind: 'bath', cleanliness: 65, happiness: 6 }),
  Object.freeze({ key: 'bubble', label: '泡泡浴', emoji: '🛁', price: 28, kind: 'bath', cleanliness: 100, happiness: 14 }),
  Object.freeze({ key: 'sauna', label: '泡温泉', emoji: '🧖', price: 58, kind: 'bath', cleanliness: 100, happiness: 24, satiety: -8 }),
  Object.freeze({ key: 'candle', label: '香薰', emoji: '🕯', price: 22, kind: 'bath', cleanliness: 58, happiness: 13 }),
  Object.freeze({ key: 'milkbath', label: '牛奶浴', emoji: '🥛', price: 44, kind: 'bath', cleanliness: 85, happiness: 19 }),
  Object.freeze({ key: 'deadsea', label: '死海泥', emoji: '🫧', price: 78, kind: 'bath', cleanliness: 100, happiness: 27, satiety: -6 }),
  // --- toys ---------------------------------------------------------------
  Object.freeze({ key: 'yoyo', label: '悠悠球', emoji: '🪀', price: 30, kind: 'toy', happiness: 22, satiety: -4 }),
  Object.freeze({ key: 'blocks', label: '积木', emoji: '🎲', price: 45, kind: 'toy', happiness: 30, satiety: -5 }),
  Object.freeze({ key: 'plush', label: '布偶', emoji: '🧸', price: 75, kind: 'toy', happiness: 42, satiety: -7 }),
  Object.freeze({ key: 'scooter', label: '滑板车', emoji: '🛴', price: 120, kind: 'toy', happiness: 58, satiety: -10, cleanliness: -6 }),
  Object.freeze({ key: 'carousel', label: '旋转木马', emoji: '🎠', price: 260, kind: 'toy', happiness: 80, satiety: -12, cleanliness: -8 }),
  Object.freeze({ key: 'balloon', label: '气球', emoji: '🎈', price: 22, kind: 'toy', happiness: 24, satiety: -3 }),
  Object.freeze({ key: 'puzzle', label: '拼图', emoji: '🧩', price: 60, kind: 'toy', happiness: 34, satiety: -5 }),
  Object.freeze({ key: 'kite', label: '风筝', emoji: '🪁', price: 95, kind: 'toy', happiness: 48, satiety: -7 }),
  Object.freeze({ key: 'rccar', label: '遥控车', emoji: '🏎', price: 180, kind: 'toy', happiness: 62, satiety: -9, cleanliness: -6 }),
  Object.freeze({ key: 'bubbles', label: '泡泡机', emoji: '🫧', price: 220, kind: 'toy', happiness: 74, satiety: -10, cleanliness: -8 }),
])

/** Shop shelves, in the order the panel shows them. */
export const KIND_ORDER = Object.freeze(['food', 'bath', 'toy'])

export const KIND_LABEL = Object.freeze({
  food: '食物',
  bath: '洗浴',
  toy: '玩具',
})

/** Which care action spends which shelf. */
export const CARE_KIND = Object.freeze({ feed: 'food', bathe: 'bath', play: 'toy' })

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/** 付费货架里的条目（不含免费默认件）。 */
export const itemByKey = key => SHOP.find(item => item.key === key) ?? null

export const itemsOfKind = kind => SHOP.filter(item => item.kind === kind)

/**
 * Every item a care action will accept: the shelf's free default first, then
 * whatever the pig owns off that shelf.
 *
 * 默认件放**第一位**，所以 `resolveCareItem()` 不指定道具时返回的就是它 ——
 * 免费、不消耗，保证动作永远按得动。指定 key 时也能精确命中付费件。
 */
export function careItems(kind) {
  const def = DEFAULTS[kind]
  const bought = itemsOfKind(kind)
  return def === undefined ? bought : [def, ...bought]
}

/** 该货架的免费默认件（面板可以据此标「免费」）。 */
export const defaultCareItem = kind => DEFAULTS[kind] ?? null
