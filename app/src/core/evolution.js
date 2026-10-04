// @ts-check
/**
 * 形态：长成之后换一身样子（猪猪王、恶魔猪）。P2 才真正启用。
 *
 * 纯函数领域逻辑：时间由 nowMs 传入，不读写文件、不碰 DOM。
 *
 * ⚠️ 和参考项目的区别：参考项目靠商店的晋升道具（王冠 / 恶魔契约）激活形态，
 * 而 promotion 货架已经砍掉。所以这里不再有 `useFormItem()` / `crown()` /
 * `signContract()`，换成一个明确的 `setForm()` 入口 —— 条件检查由 P2 决定，
 * 现在只保证「形态数据 + 展示 + 写进存档」这条链路是通的。
 * 达标不会自动换，不加钱、不改成长规则。
 *
 * @module piggy-core/core/evolution
 */

import { DEFAULT_FORM, FORMS, formByKey } from './data/evolution.js'
import { lifeStageByKey } from './data/life.js'
import { TRAITS } from './data/traits.js'
import { levelFor, lifeStageFor } from './clock.js'
import { announce, remember } from './effects.js'
import { skinStageView } from './skins.js'

/** The level a stage starts at (成年猪 → 40). */
function stageLevel(stageKey) {
  return lifeStageByKey(stageKey)?.fromLevel ?? 0
}

const REQUIREMENT_LABELS = Object.freeze({
  feeds: '累计喂食', baths: '累计洗澡', plays: '累计玩耍', pets: '累计摸摸',
})

/**
 * One form's conditions, each with what the pig has now.
 *
 * ⚠️ 计数类条件一律读 `state.stats`。以前这里写的是
 * `key === 'jobs' || key === 'plays' ? stats : traits`，于是**任何**新的计数条件
 * 都会被当成 traits 去读 —— 而 traits 早就没人增加了，加一条就锁死一条。
 * 现在改成「`stats` 里有这个 key 就用 stats，否则才回退 traits」。
 */
function requirementsFor(state, form) {
  const rows = [{ key: 'level', label: '等级', have: levelFor(state.xp), need: stageLevel(form.stage) }]
  for (const [key, need] of Object.entries(form.requires)) {
    const stats = state.stats ?? {}
    const inStats = Object.prototype.hasOwnProperty.call(stats, key)
    rows.push({
      key,
      label: REQUIREMENT_LABELS[key] ?? TRAITS[key]?.label ?? key,
      have: inStats ? (stats[key] ?? 0) : (state.traits?.[key] ?? 0),
      need,
    })
  }
  return rows.map(row => ({ ...row, met: row.have >= row.need }))
}

/**
 * Every form and how close the pig is to it. `ready` means its own conditions
 * would pass right now.
 * @param {object} state
 * @returns {{ current: string | null, forms: object[] } | null}
 */
export function formsView(state) {
  if (state === null) return null
  const alive = state.hatched === true
  return {
    current: formByKey(state.form)?.key ?? null,
    forms: FORMS.map(form => {
      const requirements = requirementsFor(state, form)
      return {
        key: form.key, via: form.via, item: form.item, label: form.label, emoji: form.emoji, art: form.art,
        stage: form.stage,
        fromLevel: lifeStageByKey(form.stage)?.fromLevel ?? 1,
        current: state.form === form.key,
        ready: alive && state.form !== form.key && requirements.every(row => row.met),
        requirements,
      }
    }),
  }
}

/**
 * 换形态的入口。写进 `state.form`，其余一切照旧。
 *
 * **不设硬锁**（D11：形态与等级解耦、可自由切换）。`formsView().ready` 只用来在
 * UI 上标一个「条件已达成」的角标，当作收集进度提示，**不阻止**切换。
 * 传 `null` 就是换回默认小猪。
 *
 * @param {object} state
 * @param {string | null} formKey
 * @param {number} nowMs
 */
export function setForm(state, formKey, nowMs) {
  if (state === null) return { ok: false, reason: 'absent' }
  if (state.hatched !== true) return { ok: false, reason: 'box' }
  if (formKey === null) {
    if (state.form === null) return { ok: false, reason: 'already', form: null }
    state.form = null
    remember(state, '🐷 换回了原来的样子', nowMs)
    return { ok: true, form: null }
  }
  const form = formByKey(formKey)
  if (form === null) return { ok: false, reason: 'unknown' }
  if (state.form === form.key) return { ok: false, reason: 'already', form: form.key }
  state.form = form.key
  remember(state, `${form.emoji} 变成了${form.label}，本事和生活都照旧`, nowMs)
  announce(state, 'form', `${state.name} 变成了${form.label}！`, nowMs)
  return { ok: true, form: form.key }
}

/**
 * The life stage with the chosen form laid over it: same key and size, the
 * form's name, line and sprite.
 * @param {object} state
 * @param {number} nowMs
 */
export function formStageView(state, nowMs) {
  const life = lifeStageFor(state, nowMs)
  const form = state === null ? null : formByKey(state.form)
  if (form === null || life.key !== form.stage) return skinStageView(state, { ...life, actionArt: false, hides: [] })
  return { ...life, label: form.label, art: form.art, line: form.line, actionArt: form.actionArt, hides: [...form.hides] }
}

export { DEFAULT_FORM, FORMS, formByKey }
