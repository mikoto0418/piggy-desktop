// @ts-check
/**
 * 台词 —— 按场景分类，带可选的回复按钮（零逻辑、零 IO）。
 *
 * 场景照 QQ 宠物的台词分类来（enter / eat / clean / toHeartTolk / levUp ……）。
 * `[主人]` 会换成主人的称呼。
 *
 * 砍掉的场景：打工/上学/旅行回来的、生病的、死亡的、签到的、番茄钟的
 * —— 那些玩法已经不在这个产品里了。
 *
 * @module piggy-core/data/lines
 */

/** 台词里代表主人称呼的占位符。 */
export const OWNER_TOKEN = '[主人]'

/** 没设置称呼时用的默认称呼。 */
export const DEFAULT_OWNER_NAME = '主人'

/** 称呼最多几个字。 */
export const OWNER_NAME_MAX = 12

/** 点一次回复按钮加的心情；每句台词只算一次。 */
export const REPLY_HAPPINESS = 3

/** 闲着时隔多久冒一句（分钟，区间内随机）。 */
export const IDLE_CHAT_MINUTES = Object.freeze({ min: 20, max: 40 })

/** 离开多久再打开算「你回来了」（分钟）。 */
export const WELCOME_BACK_AFTER_MINUTES = 30

/**
 * 偶尔在句尾带上口头禅的概率（参考项目放在 data/profile.js；
 * 口头禅本身还留在存档里，概率常量跟着台词一起挪过来）。
 */
export const CATCHPHRASE_CHANCE = 0.4

/**
 * @typedef {object} LineReply
 * @property {string} label - 按钮上的字
 * @property {number} [happiness] - 点了加多少心情，默认 REPLY_HAPPINESS
 */

/**
 * @typedef {object} Line
 * @property {string} text
 * @property {ReadonlyArray<LineReply>} [replies]
 */

/**
 * One line, with an optional reply button.
 * @param {string} text
 * @param {string} [reply]
 * @returns {Line}
 */
const line = (text, reply) => Object.freeze(reply === undefined
  ? { text }
  : { text, replies: Object.freeze([Object.freeze({ label: reply })]) })

const scene = (...lines) => Object.freeze(lines)

/** @type {Readonly<Record<string, ReadonlyArray<Line>>>} */
export const LINES = Object.freeze({
  // --- 照顾 -----------------------------------------------------------------
  eat: scene(
    line('好吃！还有吗？', '真乖'),
    line('吧唧吧唧……'),
    line('[主人]最好了～'),
    line('这个味道我记住了'),
    line('吃饱饱才有力气陪你加班'),
    line('嗝——（不好意思）'),
  ),
  overfull: scene(
    line('撑……撑住了……'),
    line('真的吃不下了，你看我肚子'),
    line('再喂我就要变成球了', '最后一口'),
  ),
  bathe: scene(
    line('香喷喷的！'),
    line('水有点凉……', '马上擦干'),
    line('搓搓背，舒服～'),
    line('泡泡！是泡泡！'),
    line('洗干净了，可以抱了'),
  ),
  play: scene(
    line('再来一次！'),
    line('接住啦！', '真棒'),
    line('哈哈哈好好玩'),
    line('我跑得比球快'),
    line('玩累了……再玩五分钟'),
  ),
  pet: scene(
    line('好舒服……'),
    line('再摸摸～', '好'),
    line('呼噜呼噜……'),
    line('（眯起眼睛）'),
    line('这里这里！左边一点！'),
    line('唔……好痒'),
    line('[主人]的手暖暖的'),
  ),
  // --- 状态提醒（闲着时优先说这些）-------------------------------------------
  hungry: scene(
    line('肚子咕咕叫了……'),
    line('[主人]，饭饭！', '马上来'),
    line('我可以吃一整个苹果树'),
  ),
  dirty: scene(
    line('身上有点痒痒的'),
    line('我是不是有点味道了……'),
    line('想洗泡泡浴', '好，这就洗'),
  ),
  lonely: scene(
    line('[主人]在忙什么呀？'),
    line('你好久没理我了……', '陪你一会儿'),
    line('我一个人在这儿数像素'),
  ),
  idle: scene(
    line('（打了个哈欠）'),
    line('今天天气好像不错'),
    line('你写的代码我看懂了一行！'),
    line('要不要休息一下眼睛？', '好'),
    line('我在想晚饭吃什么'),
    line('（在角落里滚了一圈）'),
    line('[主人]加油，我在旁边看着'),
    line('刚才那个报错我也看见了……'),
  ),
  // --- 成长 -----------------------------------------------------------------
  levelup: scene(
    line('我又长大了一点！', '真乖'),
    line('感觉自己变厉害了'),
    line('你看我是不是高了一点'),
  ),
  growUp: scene(
    line('我长大啦！'),
    line('以前的衣服好像穿不下了'),
    line('[主人]，我现在是大猪了'),
  ),
  enter: scene(
    line('[主人]你回来啦！', '回来了'),
    line('等你好久了～'),
    line('今天也要一起加油哦'),
  ),
})

/** Every scene a line can be asked for. */
export const LINE_SCENES = Object.freeze(Object.keys(LINES))
