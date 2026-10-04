// @ts-check
/**
 * 皮肤：注册玩家自制皮肤、切换当前皮肤、给出当前生效的调色板。
 *
 * 纯函数领域逻辑：时间由 nowMs 传入，不读写文件、不碰 DOM。
 * 砍掉的是图鉴登记（`recordDex`）。
 *
 * 这里**不生成图**，只负责回答「当前该用哪套颜色」；
 * 真正的重着色在宿主层（`src/main.js`），因为那需要 fetch + Blob。
 *
 * @module piggy-core/core/skins
 */

import { SKIN_SCENES, SKIN_SLOTS, SKIN_SLOT_ORDER, SKINS, skinByKey } from './data/skins.js'

const KEY = /^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$/
const HEX = /^#[0-9A-Fa-f]{6}$/

/** 「默认小猪」= 不换色。单独列出来，因为它的 `palette` 是 null。 */
const DEFAULT_SKIN = Object.freeze({
  key: 'default', label: '默认小猪', emoji: '🐷', author: 'dsh-piggy',
  description: '熟悉的小猪。', palette: null, scenes: Object.freeze([...SKIN_SCENES]), custom: false,
})

/**
 * 校验并规范化一个调色板。
 *
 * 缺槽位就**回落基础色**（而不是整个皮肤作废）：用户只想改身体颜色时，
 * 没必要逼他把 6 个槽位都写全。写了非法值的槽位同样回落。
 *
 * 一个槽位都没改的调色板视为「无效」—— 那等于没换皮肤，
 * 放行只会让用户在皮肤列表里看到一个和默认一模一样的条目。
 */
function cleanPalette(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const out = {}
  let changed = 0
  for (const slot of SKIN_SLOT_ORDER) {
    const value = raw[slot]
    if (typeof value === 'string' && HEX.test(value)) {
      out[slot] = value.toUpperCase()
      if (out[slot] !== SKIN_SLOTS[slot].toUpperCase()) changed += 1
    } else {
      out[slot] = SKIN_SLOTS[slot]
    }
  }
  return changed > 0 ? out : null
}

function clean(raw) {
  if (raw === null || typeof raw !== 'object' || !KEY.test(String(raw.key ?? ''))) return null
  const palette = cleanPalette(raw.palette)
  if (palette === null) return null
  const scenes = [...new Set(Array.isArray(raw.scenes) ? raw.scenes.filter(x => typeof x === 'string') : [])]
  const key = String(raw.key)
  return {
    key, label: String(raw.label ?? key).slice(0, 30), author: String(raw.author ?? '玩家').slice(0, 30),
    description: String(raw.description ?? '').slice(0, 100), emoji: String(raw.emoji ?? '🎨').slice(0, 4),
    palette,
    // 调色板皮肤对所有场景都生效，所以 scenes 缺省即全集
    scenes: scenes.length > 0 ? scenes : [...SKIN_SCENES],
    custom: true,
  }
}

export function ensureSkins(state) {
  if (state === null) return state
  state.customSkins = Array.isArray(state.customSkins) ? state.customSkins.map(clean).filter(Boolean) : []
  const known = state.customSkins.some(skin => skin.key === state.skin) || skinByKey(state.skin) !== null
  state.skin = known ? state.skin : 'default'
  return state
}

export function allSkins(state) {
  ensureSkins(state)
  return [DEFAULT_SKIN, ...SKINS, ...(state?.customSkins ?? [])]
}

export function skinView(state) {
  if (state === null) return { current: 'default', entries: [] }
  ensureSkins(state)
  return { current: state.skin, entries: allSkins(state).map(skin => ({ ...skin, current: skin.key === state.skin })) }
}

/**
 * 当前生效的调色板。**默认皮肤返回 `null`**。
 *
 * 返回 null 而不是「一套等于基础色的调色板」是有意的：
 * 宿主据此走**原图直出**的快路径（不 fetch、不重着色、不建 blob），
 * 于是「用默认皮肤」这条最常见的路径开销严格为 0。
 */
export function skinPalette(state) {
  if (state === null) return null
  ensureSkins(state)
  const skin = allSkins(state).find(entry => entry.key === state.skin)
  return skin?.palette ?? null
}

export function selectSkin(state, key, nowMs) {
  if (state === null) return { ok: false, reason: 'absent' }
  ensureSkins(state)
  const skin = allSkins(state).find(entry => entry.key === key)
  if (!skin) return { ok: false, reason: 'unknown' }
  state.skin = skin.key
  return { ok: true, skin: skin.key }
}

export function registerCustomSkin(state, raw, nowMs) {
  if (state === null) return { ok: false, reason: 'absent' }
  ensureSkins(state)
  const skin = clean(raw)
  if (!skin) return { ok: false, reason: 'invalid' }
  if (skin.key === 'default' || skinByKey(skin.key) !== null) return { ok: false, reason: 'reserved' }
  const at = state.customSkins.findIndex(entry => entry.key === skin.key)
  if (at < 0) state.customSkins.push(skin)
  else state.customSkins[at] = skin
  state.skin = skin.key
  return { ok: true, skin: skin.key }
}

/**
 * 把皮肤信息盖到形态视图上。
 *
 * D11：形态与皮肤**解耦** —— 换形态不影响皮肤，换皮肤也不影响形态。
 * 所以这里只往外带「当前皮肤该用哪套颜色」，不碰形态本身的字段。
 */
export function skinStageView(state, stage) {
  if (state === null) return stage
  const palette = skinPalette(state)
  if (palette === null) return stage
  return { ...stage, palette, skin: state.skin }
}
