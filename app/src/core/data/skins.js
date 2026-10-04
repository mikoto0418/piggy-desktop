// @ts-check
/**
 * 皮肤 —— 静态数值表（零逻辑、零 IO）。
 *
 * ## 皮肤 = 一套调色板，而不是一套新图
 *
 * 美术资源里猪本体只用了 **6 个颜色**（身体 / 后腿 / 鼻子 / 耳朵 / 眼睛 / 腮红），
 * 其余 8 个颜色都是道具（水、泡泡、食物、牛奶、zzz）。
 * 所以换皮肤不需要重画任何图 —— 把猪本体的 6 个颜色换掉就行，
 * 道具颜色原样保留（薄荷猪吃的还是同一块蛋糕）。
 *
 * 落地方式是在**运行时**把基础 SVG 的 6 个色值替换掉，生成一张 blob 图。
 * 好处是**一个皮肤 0 字节磁盘占用**：加皮肤只是加一个调色板对象，
 * 不会让「美术资源 < 30 KB」这条预算随皮肤数量膨胀。
 *
 * > 走这条路的前提是美术里**没有渐变、没有滤镜、颜色都是 `#RRGGBB` 字面量**
 * > —— 这三条本来就是 `gen-scenes.py` / `verify-scenes.py` 在守的硬约束。
 *
 * 场景只留还活着的照顾动作：idle / eat / bathe / play / pet，
 * 外加状态偏低时摆出来的「累」表情 relax。打工、上学、旅行、钓鱼、番茄钟
 * 的场景随那些玩法一起砍掉了。
 *
 * ⚠️ 这张表必须和宿主 `src/main.js` 的 `SCENE_SRC` **完全一致**。
 * 少了谁，那个场景就不会被预载重着色（换皮肤时只有它没变色）；
 * 多了谁，就会去 fetch 一张不存在的图（静默回落到 idle）。
 * `selftest.mjs` 有一条测试直接读 `main.js` 来守这个契约 ——
 * 这条测试是**真的抓到了** `relax` 漏登记。
 *
 * @module piggy-core/data/skins
 */

export const SKIN_SCENES = Object.freeze(['idle', 'eat', 'bathe', 'play', 'pet', 'relax'])

/**
 * 必须支持换色的场景 —— 就是全部场景。
 *
 * 调色板皮肤是**整图重着色**，没有任何 per-scene 例外，
 * 所以「必需」和「全部」在这里是同一个集合；分开命名只是为了
 * 万一以后真有场景不支持换色时，改一处就够。
 */
export const REQUIRED_SKIN_SCENES = Object.freeze([...SKIN_SCENES])

/**
 * 猪本体可换色的 6 个槽位，值是**基础美术里实际使用的色值**。
 *
 * ⚠️ 这几个值是 `assets/piglet*.svg` 的硬契约：改美术就必须同步改这里，
 * 否则那个部位会换不掉（替换不到就静默保留原色）。
 * `selftest.mjs` 有一条测试直接扫 SVG 文件来守这个契约。
 */
export const SKIN_SLOTS = Object.freeze({
  body: '#FFD1AF',
  farLegs: '#FF9FA5',
  nose: '#FF8195',
  ears: '#E95892',
  eyes: '#373A32',
  blush: '#FFAFAC',
})

export const SKIN_SLOT_ORDER = Object.freeze(Object.keys(SKIN_SLOTS))

/** 三个内置皮肤。`default` 不在这里 —— 它是「不换色」，见 `core/skins.js`。 */
export const SKINS = Object.freeze([
  Object.freeze({
    key: 'mint', label: '薄荷小猪', emoji: '🌿',
    author: 'dsh-piggy', description: '像一口薄荷汽水，清清凉凉。',
    palette: Object.freeze({
      body: '#C9F0DC', farLegs: '#A0E0C6', nose: '#6FC9A8',
      ears: '#3FA982', eyes: '#2F3A36', blush: '#86D9BD',
    }),
    custom: false,
  }),
  Object.freeze({
    key: 'grape', label: '葡萄小猪', emoji: '🍇',
    author: 'dsh-piggy', description: '紫得发亮，甜得发腻。',
    palette: Object.freeze({
      body: '#D8C6F2', farLegs: '#BCA3E2', nose: '#9B7FD4',
      ears: '#7A5BB8', eyes: '#373A32', blush: '#C0A2E6',
    }),
    custom: false,
  }),
  Object.freeze({
    key: 'ink', label: '墨玉小猪', emoji: '🪨',
    author: 'dsh-piggy', description: '安安静静，像块被盘了很久的石头。',
    palette: Object.freeze({
      body: '#C9CDD4', farLegs: '#A6ADB8', nose: '#868D99',
      ears: '#5E6470', eyes: '#23262B', blush: '#9BA3AF',
    }),
    custom: false,
  }),
])

export function skinByKey(key) {
  return SKINS.find(skin => skin.key === key) ?? null
}
