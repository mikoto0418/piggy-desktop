// 宿主桥：把纯领域模型 `core/` 接到「存档 + 时钟 + DOM」上。
//
// 领域层（core/）不碰 IO、不取时间、不碰 DOM；这一层就是它缺的那半边：
//   - 存档：经 Tauri 命令读写 `pet.json`（Rust 侧原子写 + 备份兜底）
//   - 时钟：定时调 `decay(state, Date.now())`，并补上离线这段时间
//   - 消息：把 `state.pending` 里的台词抽出来给气泡显示
//
// 唯一的领域时间入口是 `core.decay()`，所以只要保证它被按时调用，
// 猪的饥饿/心情/清洁就是连续的、关掉再开也不丢。

import * as core from "./core/index.js";

/** 多久推进一次时间。衰减速率是每分钟 0.06~0.08，20 秒一步足够细。 */
const TICK_MS = 20_000;

/** 存档防抖：连续操作只写一次盘。 */
const SAVE_DEBOUNCE_MS = 1_200;

let invokeFn = null;
let logFn = () => {};
let state = null;
let tickTimer = null;
let saveTimer = null;

/** 给界面看的最新一条台词（气泡用）。 */
let latestLine = null;

// ---------------- 生命周期 ----------------

/**
 * 载入存档（没有就下一只蛋）并开始走时间。
 * @param {(cmd: string, args?: object) => Promise<any>} invoke
 * @param {(msg: string) => void} [log]
 */
export async function initPet(invoke, log) {
  invokeFn = invoke;
  logFn = log ?? (() => {});
  const now = Date.now();

  let raw = null;
  try {
    raw = await invoke("load_pet_state");
  } catch (e) {
    logFn(`读取存档失败（将新建）：${e}`);
  }

  let loaded = null;
  if (raw !== null && raw !== undefined) {
    loaded = core.migrate(raw, now);
    if (loaded === null) logFn("存档无法识别，当作新猪处理");
    else logFn(`存档已载入并迁移到 v${core.STATE_VERSION}`);
  }

  if (loaded === null) {
    loaded = core.layEgg(now);
    logFn("没有可用存档，下了一只新蛋");
  }

  state = loaded;
  // 关键：先把离线这段时间补上（唯一的时间入口）。
  core.decay(state, now);

  // 一期不做开盒动画（Q3 待定），先直接孵出来，让用户看到猪。
  if (state.hatched !== true) {
    core.hatch(state, now);
    logFn("纸盒已孵化（一期自动开盒）");
  }

  core.ensureDialogue(state);
  drainMessages(now);
  startTick();
  scheduleSave();
  return state;
}

export function getState() {
  return state;
}

export function disposePet() {
  stopTick();
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
}

// ---------------- 时钟 ----------------

function startTick() {
  stopTick();
  tickTimer = window.setInterval(() => {
    if (document.hidden) return; // 窗口不可见时先不推进，等回来一次性补
    tickNow();
  }, TICK_MS);
}

function stopTick() {
  if (tickTimer !== null) {
    window.clearInterval(tickTimer);
    tickTimer = null;
  }
}

/** 推进到「现在」。窗口从隐藏恢复时也要调一次，把空档补回来。 */
export function tickNow() {
  if (state === null) return;
  const now = Date.now();
  core.decay(state, now);
  drainMessages(now);
  scheduleSave();
}

// ---------------- 动作 ----------------

/**
 * 做一个照顾动作。
 * @param {'feed'|'bathe'|'play'|'pet'} action
 * @returns {{ok: boolean, reason?: string, item?: string|null}}
 */
export function doCare(action) {
  if (state === null) return { ok: false, reason: "absent" };
  const now = Date.now();
  const result = core.act(state, action, now);
  drainMessages(now);
  if (result.ok) scheduleSave();
  return result;
}

/** 回一句台词（台词带按钮时用）。 */
export function replyLine(lineId, replyIndex) {
  if (state === null) return { ok: false, reason: "absent" };
  const result = core.replyToLine(state, lineId, replyIndex);
  if (result.ok) {
    latestLine = null;
    scheduleSave();
  }
  return result;
}

/** 让猪主动说一句（进入面板 / 空闲时）。 */
export function petSay(scene) {
  if (state === null) return false;
  const now = Date.now();
  const said = core.say(state, scene, now);
  drainMessages(now);
  if (said) scheduleSave();
  return said;
}

/**
 * 换皮肤（D6）。
 *
 * 领域层只管改 `state.skin`；**换图是界面的事**（需要 fetch + Blob），
 * 所以调用方拿到 `ok` 之后自己调 `core.skinPalette()` 去重着色。
 * @param {string} key 皮肤 key，`'default'` = 不换色
 */
export function setSkin(key) {
  if (state === null) return { ok: false, reason: "absent" };
  const result = core.selectSkin(state, key, Date.now());
  if (result.ok) scheduleSave();
  return result;
}

/** 可选皮肤列表 + 当前项（设置界面用）。 */
export function skinsView() {
  if (state === null) return { current: "default", entries: [] };
  return core.skinView(state);
}

// ---------------- 消息 → 气泡 ----------------

/**
 * 取出排队的消息；把最新的 `line` 消息留给气泡。
 * 其余（levelup / growUp 之类）暂时只落日志，避免一次弹一堆。
 */
function drainMessages(nowMs) {
  const messages = core.drainPending(state);
  for (const message of messages) {
    if (message.kind === "line") {
      latestLine = { id: message.id, text: message.text, replies: message.replies ?? [], at: message.at };
    } else {
      logFn(`[消息] ${message.kind}: ${message.text}`);
    }
  }
  return messages;
}

/** 取走当前该显示的台词（取走即清空，气泡只弹一次）。 */
export function takeLine() {
  const line = latestLine;
  latestLine = null;
  return line;
}

/** 当前是否有待显示的台词。 */
export function peekLine() {
  return latestLine;
}

// ---------------- 存档 ----------------

function scheduleSave() {
  if (invokeFn === null) return;
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    saveNow();
  }, SAVE_DEBOUNCE_MS);
}

/** 立即写盘（退出前/窗口隐藏时调用）。 */
export async function saveNow() {
  if (invokeFn === null || state === null) return;
  try {
    await invokeFn("save_pet_state", { state: plain(state) });
  } catch (e) {
    logFn(`存档写入失败：${e}`);
  }
}

/** 去掉 undefined / 函数，保证 JSON 可序列化。 */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// ---------------- 派生视图（界面用） ----------------

/**
 * 界面需要的一切，一次性算好。
 * 四维条的长度用 0..1 的比例，界面用 transform:scaleX() 落地（铁律 1）。
 */
export function petView() {
  if (state === null) return null;
  const now = Date.now();
  const progress = core.levelProgress(state.xp);
  const stage = core.lifeStageFor(state, now);
  return {
    name: state.name,
    hatched: state.hatched === true,
    // 四维
    satiety: state.satiety,
    happiness: state.happiness,
    cleanliness: state.cleanliness,
    health: state.health,
    healthMax: 5,
    // 等级（D10：纯展示，不做解锁门槛）
    level: progress.level,
    levelPercent: progress.percent,
    levelTitle: progress.title?.label ?? "",
    xp: state.xp,
    toNext: progress.toNext,
    // 形态 / 皮肤
    stageKey: stage.key,
    stageLabel: stage.label,
    skin: state.skin,
    // 当前皮肤的调色板；**默认皮肤是 null**（界面据此走原图直出的快路径）
    skinPalette: core.skinPalette(state),
    // 心情一句话
    mood: core.mood(state, now),
    // 年龄
    ageDays: Math.floor(core.ageDays(state, now)),
    // 背包（P2 做面板时用）
    inventory: core.inventoryView(state),
    // 哪些动作现在可用
    care: core.careView(state),
    // 台词气泡当前是否开着（用于判断能否回复）
    openLine: state.dialogue?.open ? { id: state.dialogue.open.id } : null,
  };
}
