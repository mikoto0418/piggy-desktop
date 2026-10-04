// @ts-check
/**
 * 背包、购买与道具使用。
 *
 * 纯函数领域逻辑：时间由 nowMs 传入，不读写文件、不碰 DOM。
 *
 * 砍掉的是：金币结算（`coins` 字段连同打工一起删了）、装扮的穿戴/摘下、
 * 药品与还魂丹、晋升道具、图鉴登记。**留下的是食物/洗浴/玩具三个货架**。
 *
 * ⚠️ 因为金币没了，`buy()` 现在只是「把一件东西放进背包」的入口
 * （宿主赠送、奖励、调试都走它），`price` 字段留着当参考，不再扣钱。
 *
 * @module piggy-core/core/inventory
 */

import { DEFAULT_TOY, SHOP, itemByKey } from './data/shop.js'
import { applyEffects, remember } from './effects.js'
import { decay } from './settlement.js'

/** Inventory counts, always including zeroes so the UI can render a grid. */
export function inventoryView(state) {
  const out = {}
  for (const item of SHOP) out[item.key] = state.inventory?.[item.key] ?? 0
  // The free default toy is always in the bag and never runs out, so `玩耍` is
  // never blocked by an empty one.
  out[DEFAULT_TOY.key] = Infinity
  return out
}

/**
 * Put one of `itemKey` in the bag.
 *
 * 参考项目在这里扣金币、卡等级门槛、登记图鉴；那些系统都随玩法砍掉了。
 * 现在它只负责「这件东西存不存在」和「数量 +1」，条件由宿主决定。
 */
export function buy(state, itemKey, nowMs) {
  const item = itemByKey(itemKey)
  if (item === null) return { ok: false, reason: 'unknown' }
  state.inventory = { ...(state.inventory ?? {}) }
  state.inventory[item.key] = (state.inventory[item.key] ?? 0) + 1
  state.stats.purchases = (state.stats.purchases ?? 0) + 1
  remember(state, `得到了 ${item.emoji} ${item.label}`, nowMs)
  return { ok: true, item }
}

/**
 * Debug helper: hand the pig a stack of everything on the three shelves.
 * 20 of each consumable, so a test in the panel never fails for lack of an item.
 */
export function grantAll(state, nowMs) {
  if (state === null || state === undefined) return { ok: false, reason: 'absent' }
  const inventory = { ...(state.inventory ?? {}) }
  for (const item of SHOP) {
    inventory[item.key] = Math.max(inventory[item.key] ?? 0, 20)
  }
  state.inventory = inventory
  remember(state, '🔧 调试：一键拿齐了所有物品', nowMs)
  return { ok: true, granted: { items: SHOP.length } }
}

/**
 * Use one item straight from the bag (food / bath / toy).
 *
 * 喂食、洗澡、玩耍走的是 care.js 的 `act()`；这个入口是「直接吃/直接用」，
 * 只有食物、洗浴、玩具三种，用完即减一。
 */
export function useItem(state, itemKey, nowMs) {
  const item = itemByKey(itemKey)
  if (item === null) return { ok: false, reason: 'unknown' }
  const have = state.inventory?.[itemKey] ?? 0
  if (have <= 0) return { ok: false, reason: 'empty' }
  decay(state, nowMs)

  state.inventory = { ...(state.inventory ?? {}) }
  state.inventory[itemKey] = have - 1
  if (state.inventory[itemKey] <= 0) delete state.inventory[itemKey]
  applyEffects(state, item, nowMs)
  remember(state, `用了 ${item.emoji} ${item.label}`, nowMs)
  return { ok: true, item }
}
