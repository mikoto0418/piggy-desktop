// @ts-check
/**
 * 三维属性 —— 静态数值表（零逻辑、零 IO）。
 *
 * 等级是纯展示的：三维不设解锁门槛，也不加钱（打工玩法已砍）。
 * 数值和标签原样保留，形态(evolution)的条件表还在读它们。
 * @module piggy-core/data/traits
 */

/** The three traits QQ Pet tracks alongside growth. */
export const TRAITS = Object.freeze({
  intel: Object.freeze({ key: 'intel', label: '智力', emoji: '🧠' }),
  charm: Object.freeze({ key: 'charm', label: '魅力', emoji: '✨' }),
  strong: Object.freeze({ key: 'strong', label: '武力', emoji: '💪' }),
})

export const TRAIT_ORDER = Object.freeze(['intel', 'charm', 'strong'])
