// 谷歌猪桌宠 · 宿主脚本
//
// 职责：
//   ① 量内容栈的**布局盒** → 上报主进程改窗口尺寸（铁律 1）
//   ② 跟随模式事件切 UI（互动 / 穿透）
//   ③ 拖动 / 单击摸摸 / 右键固定面板
//   ④ 把 core/ 的四维状态、等级、台词渲染到面板与气泡
//
// 铁律：测量只用**布局盒**（offsetWidth/offsetHeight），
//       绝不用 getBoundingClientRect —— 后者会被动画的 transform 污染。

import {
  initPet, petView, doCare, tickNow, takeLine, petSay, saveNow,
  replyLine, getState, setSkin, skinsView,
} from "./pet.js";
// 皮肤槽位表和调色板都在领域层，前端只负责「把颜色替换进 SVG 文本」。
import * as core from "./core/index.js";

const { invoke } = window.__TAURI__.core;
const { listen, emit } = window.__TAURI__.event;
const { getCurrentWindow } = window.__TAURI__.window;

const win = getCurrentWindow();
const stackEl = document.getElementById("stack");
const pigEl = document.getElementById("pig");
const pigArtEl = document.getElementById("pig-art");
const bubbleEl = document.getElementById("bubble");
const panelEl = document.getElementById("panel");
const hudModeEl = document.getElementById("hud-mode");
const hudNoteEl = document.getElementById("hud-note");
const lvNumEl = document.getElementById("lv-num");
const lvTitleEl = document.getElementById("lv-title");
const actionsEl = document.getElementById("actions");

/** 窗口内容四周留一点空隙，避免阴影被裁掉。 */
const PADDING = 8;

/** 当前模式快照，由 Rust 侧 piggy://mode 事件推送。 */
let mode = {
  clickThrough: false,
  visible: true,
  maximumFps: 30,
  hoverThrough: false,
  hoverThroughAlpha: 35,
  hoverRestoreDelayMs: 300,
  hoverWakeDelayMs: 600,
  opacityPercent: 100,
  scalePercent: 100,
  ghost: false,
  shortcutProblems: [],
};

/** 前端日志桥：release 构建没有控制台，诊断信息必须经 Rust 落盘。 */
function jlog(msg) {
  console.log("[piggy]", msg);
  try {
    invoke("log_from_js", { msg: String(msg) });
  } catch (_) {
    /* 忽略 */
  }
}

// 图片加载诊断 + 断图兜底。
//
// ⚠️ 兜底不是可选项：参考项目就栽在这里 —— 切换形态之后去请求不存在的
// `*-fish.svg`，而它的 `<img>` **没有 onerror 回退**，结果猪直接变成空白
// （`client.js:2017`，已记在 `桌宠功能清单.md` 的缺陷表第 10 条）。
// 素材加载失败会让「窗口在、但什么都看不见」，用户只能去托盘里猜。
if (pigArtEl) {
  pigArtEl.addEventListener("error", () => {
    jlog(`pig-art ERROR src=${pigArtEl.src} complete=${pigArtEl.complete}`);
    if (currentScene !== "idle") {
      jlog("断图 → 回落到 idle");
      currentScene = "idle";
      pigArtEl.src = SCENE_SRC.idle;
    }
  });
}

// ---------------- ① 贴合内容 ----------------

/** 猪中心在**内容框**里的偏移（布局盒，不受呼吸动画的 transform 影响）。 */
function measurePigOffset() {
  return {
    x: PADDING + (pigEl.offsetLeft - stackEl.offsetLeft) + pigEl.offsetWidth / 2,
    y: PADDING + (pigEl.offsetTop - stackEl.offsetTop) + pigEl.offsetHeight / 2,
  };
}

function measureContentBox() {
  // 布局盒：不受 transform 影响（铁律 1）。
  // 量的是 #stack（气泡/面板/猪都在里面），所以任一元素显隐都会自然反映到尺寸上。
  const w = Math.ceil(stackEl.offsetWidth) + PADDING * 2;
  const h = Math.ceil(stackEl.offsetHeight) + PADDING * 2;
  return { w, h, pig: measurePigOffset() };
}

let lastReported = "";
/**
 * 把内容尺寸 + 猪的新旧锚点报给主进程，由它把窗口摆到「猪不动」的位置。
 *
 * `prevPig`：**改动布局之前**猪在内容框里的偏移。必须由调用方在改 DOM 之前量好，
 * 因为主进程需要它来还原「猪此刻在屏幕上的绝对位置」——
 * 绝对位置 = 窗口当前原点 + prevPig × 缩放。
 *
 * 主进程每次都读**实时**的窗口原点，不缓存，所以用户拖过窗口、或者外部把窗口
 * 挪走之后再打开面板，都不会算错（早期版本缓存了原点，实测会跳 380px）。
 */
async function reportContentBox(prevPig) {
  const { w, h, pig } = measureContentBox();
  const prev = prevPig || pig;
  const key = `${w}x${h}@${Math.round(pig.x)},${Math.round(pig.y)}`;
  if (key === lastReported) return; // 没变就不打扰主进程
  lastReported = key;
  // 诊断：尺寸变化时把「谁在占地方」一并写进日志，否则窗口大小不对时无从下手。
  jlog(
    `BOX ${w}x${h} pigAnchor=${Math.round(pig.x)},${Math.round(pig.y)} ` +
      `(prev=${Math.round(prev.x)},${Math.round(prev.y)}) ` +
      `stack=${stackEl.offsetWidth}x${stackEl.offsetHeight} ` +
      `pig=${pigEl.offsetWidth}x${pigEl.offsetHeight}@${pigEl.offsetLeft},${pigEl.offsetTop} ` +
      `panel=${panelEl.hidden ? "hidden" : panelEl.offsetWidth + "x" + panelEl.offsetHeight} ` +
      `bubble=${bubbleEl.hidden ? "hidden" : bubbleEl.offsetWidth + "x" + bubbleEl.offsetHeight}`
  );
  try {
    await invoke("report_content_box", {
      width: w,
      height: h,
      pigCx: pig.x,
      pigCy: pig.y,
      prevPigCx: prev.x,
      prevPigCy: prev.y,
    });
  } catch (e) {
    jlog(`report_content_box failed: ${e}`);
  }
}

// ---------------- 呼吸动画（低帧率驱动，省 CPU） ----------------
//
// 为什么不用 CSS animation：
//   实测常驻 CSS 动画（transform + will-change）会让整棵进程树空闲占用
//   **约 14% 单核**——WebView2 每帧都要走一遍合成/提交。桌宠要常驻一整天，
//   这个代价不可接受。改成 setInterval 定时器后，帧率可以真正降档，
//   并且窗口隐藏时能彻底停掉。
//
// 铁律 1 依然遵守：只改 transform，绝不碰 width/height/top/left。

const BREATHE_PERIOD_MS = 2600;
const BREATHE_SCALE = 0.035;
const BREATHE_LIFT_PX = 1.0;

let breatheTimer = null;
let breathePhase = 0;
let lastBreatheFps = -1;

/** 当前目标帧率：穿透模式下进一步降档（M2：动画继续播，但更省电）。 */
function breatheFps() {
  const base = mode.clickThrough ? 8 : 12;
  return Math.max(4, Math.min(base, mode.maximumFps || 30));
}

function startBreathing() {
  stopBreathing();
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const stepMs = Math.round(1000 / breatheFps());
  breatheTimer = window.setInterval(() => {
    breathePhase = (breathePhase + stepMs) % BREATHE_PERIOD_MS;
    const t = 0.5 - 0.5 * Math.cos((2 * Math.PI * breathePhase) / BREATHE_PERIOD_MS);
    const scale = 1 + BREATHE_SCALE * t;
    const lift = -BREATHE_LIFT_PX * t;
    pigEl.style.transform = `scale(${scale.toFixed(4)}) translateY(${lift.toFixed(2)}px)`;
  }, stepMs);
}

function stopBreathing() {
  if (breatheTimer !== null) {
    window.clearInterval(breatheTimer);
    breatheTimer = null;
  }
}

/** 按当前状态决定动画该不该跑：隐藏 / 不可见时必须彻底停掉。 */
function syncBreathing() {
  const shouldRun = !document.hidden && mode.visible !== false;
  if (shouldRun) startBreathing();
  else stopBreathing();
}

document.addEventListener("visibilitychange", () => {
  syncBreathing();
  // 从隐藏恢复时把这段时间一次性补上
  if (!document.hidden) tickNow();
});

// ---------------- ② 跟随模式 ----------------

function renderMode() {
  const ct = mode.clickThrough;
  hudModeEl.textContent = ct ? "穿透" : "互动";

  // 穿透模式下必须隐藏气泡与面板（会挡住游戏画面）。
  if (ct) {
    hideBubble();
    setPanelPinned(false);
  }
  syncPanel();

  // 显示**实际生效**的组合键（首选被占用时会自动退到备选）。
  const boundCt = mode.boundToggleClickThrough || "（未注册）";
  const boundVis = mode.boundToggleVisibility || "（未注册）";
  if (mode.shortcutProblems && mode.shortcutProblems.length) {
    hudNoteEl.textContent = `⚠ ${mode.shortcutProblems[0]}`;
    hudNoteEl.style.color = "#c0392b";
  } else {
    hudNoteEl.textContent = `${boundCt} 切穿透 · ${boundVis} 显隐`;
    hudNoteEl.style.color = "";
  }

  // 帧率可能随模式变化，需要按新帧率重建定时器
  const fps = breatheFps();
  if (fps !== lastBreatheFps) {
    lastBreatheFps = fps;
    syncBreathing();
  }
  pigEl.classList.toggle("is-click-through", ct);
}

async function initMode() {
  try {
    mode = await invoke("get_mode");
  } catch (e) {
    jlog(`get_mode failed: ${e}`);
  }
  jlog(`MODE 初始: clickThrough=${mode.clickThrough} visible=${mode.visible}`);
  renderMode();

  await listen("piggy://mode", (ev) => {
    const prev = mode.clickThrough;
    mode = ev.payload;
    if (prev !== mode.clickThrough) {
      jlog(`MODE 变化: clickThrough ${prev} -> ${mode.clickThrough}`);
    }
    applyOpacity();
    applyScale();
    renderMode();
  });

  // 悬停状态由主进程轮询 `GetCursorPos` 决定，只在翻转时通知（见 setHovering）。
  await listen("piggy://hover", (ev) => setHovering(ev.payload === true));

  // 悬停让位（P2-6）：主进程算好了「路过 / 想互动」，前端只负责淡出淡入。
  await listen("piggy://ghost", (ev) => setGhost(ev.payload === true));

  // 换皮肤（P2-1）：设置窗口广播过来，这里改存档 + 重着色 + 回播当前值。
  // 为什么绕一圈事件而不是设置窗口直接写 pet.json：
  // 存档在**桌宠窗口的内存里**，直接改文件会让内存态变成旧的，
  // 下一次防抖存盘就把皮肤改回去了。
  await listen("piggy://select-skin", async (ev) => {
    const key = ev.payload?.key;
    const result = setSkin(key);
    jlog(`换皮肤 ${key} -> ${result.ok ? "成功" : result.reason}`);
    if (result.ok) {
      await applySkin(core.skinPalette(getState()));
      broadcastSkin();
    }
  });
  applyOpacity();
  applyScale();
  broadcastSkin();

  // 位置变化时保存（防抖）
  await listen("tauri://move", debounce(savePosition, 400));
}

// ---------------- 不透明度（P2-6 让位 / P2-7 常态） ----------------

/**
 * 把不透明度写成 CSS 变量。
 *
 * 🔴 为什么不用 Win32 的 `SetLayeredWindowAttributes(LWA_ALPHA)`：
 * 那个 API 要求窗口带 `WS_EX_LAYERED`，而**互动模式下实测 `ex=0x8000198` 没有这一位**
 * （只有穿透模式才成对设上 TRANSPARENT|LAYERED）。为了改不透明度去硬加 LAYERED，
 * 会改变 DirectComposition 透明窗口的合成路径 —— 有把整块透明底变黑的风险。
 * CSS 变量零风险，而且天然参与 GPU 合成，淡入淡出免费。
 *
 * `transition` 写在 CSS 里（`.dp-scene { transition: opacity .3s }`），
 * 所以这里只要改值，动画自动跑。
 */
function applyOpacity() {
  const ghost = document.documentElement.dataset.ghost === "1";
  const percent = ghost
    ? (mode.hoverThroughAlpha ?? 35)
    : (mode.opacityPercent ?? 100);
  document.documentElement.style.setProperty("--piggy-opacity", String(percent / 100));
}

/** 主进程判定「指针路过」→ 让位（淡出 + 已在 Rust 侧穿透）。 */
function setGhost(on) {
  if (document.documentElement.dataset.ghost === (on ? "1" : "0")) return;
  document.documentElement.dataset.ghost = on ? "1" : "0";
  jlog(`GHOST 界面 -> ${on ? "让位" : "唤醒"}`);
  applyOpacity();
}

// ---------------- 宠物大小（P2-7 scalePercent） ----------------

/** 100% 时猪的边长（px），与 CSS 里 `--pig-size` 的默认值保持一致。 */
const BASE_PIG_SIZE = 64;

/**
 * 缩放猪。
 *
 * 🔴 改的是**尺寸**不是 `transform: scale()`：铁律 1 要求用布局盒量内容，
 * 而 transform 不参与布局 —— 套了 scale 之后 `offsetWidth` 还是 64，
 * 窗口尺寸会算错（猪被裁掉，或者留一块透明死区挡住下层点击）。
 * 直接改 width/height 走布局，量出来天然是对的。
 *
 * 尺寸变了必须**重新上报内容盒**，否则窗口还是旧大小。
 */
function applyScale() {
  const percent = mode.scalePercent ?? 100;
  const px = Math.round((BASE_PIG_SIZE * percent) / 100);
  const cur = document.documentElement.style.getPropertyValue("--pig-size");
  if (cur === `${px}px`) return;
  document.documentElement.style.setProperty("--pig-size", `${px}px`);
  jlog(`SCALE -> ${percent}% (${px}px)`);
  reportContentBox();
}

let lastPos = null;
function savePosition() {
  win.outerPosition().then((p) => {
    if (lastPos && lastPos.x === p.x && lastPos.y === p.y) return;
    lastPos = p;
    invoke("save_position", { x: p.x, y: p.y }).catch(() => {});
  });
}

function debounce(fn, ms) {
  let t = null;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

// ---------------- ③ 拖动 / 点击 ----------------

const DRAG_THRESHOLD = 4; // px，超过才算拖动
let down = null;

pigEl.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return; // 右键不做任何事（避开参考项目「右键也摸摸」的缺陷）
  down = { x: e.screenX, y: e.screenY, dragging: false };
  pigEl.setPointerCapture?.(e.pointerId);
});

pigEl.addEventListener("pointermove", async (e) => {
  if (!down || down.dragging) return;
  const dx = e.screenX - down.x;
  const dy = e.screenY - down.y;
  if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
  down.dragging = true;
  try {
    // 交给系统拖动；因为已设 WS_EX_NOACTIVATE，不会抢焦点
    await win.startDragging();
  } catch (err) {
    jlog(`startDragging failed: ${err}`);
  }
});

pigEl.addEventListener("pointerup", (e) => {
  if (!down) return;
  const wasDrag = down.dragging;
  down = null;
  if (e.button !== 0 || wasDrag) return;
  // 纯点击 = 摸摸
  onPet();
});

// 右键：只切换面板固定，不触发互动（避开参考项目缺陷）
window.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  setPanelPinned(!panelPinned);
});

// 悬停：显示面板（鼠标在猪或面板上时都保持显示）
let hovering = false;

// 诊断：确认窗口到底收不收得到指针事件，以及指针落在哪个元素上。
window.addEventListener("pointerover", (e) => {
  jlog(`POINTER over the pet window, target=${e.target?.id || e.target?.tagName}`);
}, { once: true });
window.addEventListener("mousemove", (e) => {
  const r = pigEl.getBoundingClientRect();
  jlog(
    `MOUSEMOVE client=(${e.clientX},${e.clientY}) ` +
      `pig=(${Math.round(r.left)},${Math.round(r.top)})-(${Math.round(r.right)},${Math.round(r.bottom)}) ` +
      `viewport=${window.innerWidth}x${window.innerHeight}`
  );
}, { once: true });

/**
 * 悬停状态 —— **由主进程说了算**。
 *
 * Rust 每 150ms 轮询一次 `GetCursorPos` 跟窗口的屏幕矩形比对，只在状态翻转时
 * 发 `piggy://hover`。前端不自己判断，因为两条路都实测撞过墙：
 *
 *  1. 窗口 resize / move 时 WebView2 会**补发一次假的 `pointerleave`** ——
 *     光标其实一动没动，面板刚打开就被自己关掉；而且窗口移动后光标没动、
 *     不会再补 `pointerenter`，面板就彻底打不开了。
 *     （实测日志：`POINTERENTER → BOX 166x240 → BOX 80x80`，一次就结束。）
 *  2. 光标**真的**移出窗口时 Windows 不再发 `WM_MOUSEMOVE`，手里最后一个坐标
 *     还停在窗口内 —— 想用几何复核去识别假 leave，就会把真 leave 也当成假的，
 *     面板再也收不起来。
 *
 * 附带一个坑：`pointerenter` / `pointerleave` **不冒泡**，而 `document` 不是
 * Element，所以 `document.addEventListener('pointerenter', ...)` 在 Chromium 里
 * **永远不触发** —— 这也是当初面板死活打不开的原因之一。
 */
let hideTimer = null;

function setHovering(on) {
  if (hovering !== on) jlog(`悬停 ${hovering} -> ${on}`);
  hovering = on;
  // 收起时给一个很短的缓冲，避免光标贴着窗口边缘抖动导致面板闪。
  if (on) {
    if (hideTimer !== null) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
    syncPanel();
    return;
  }
  if (hideTimer !== null) window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    hideTimer = null;
    syncPanel();
  }, 120);
}

// ---------------- ④ 面板 / 气泡 ----------------

/** 面板固定（右键切换）——固定后不随鼠标移开而消失。 */
let panelPinned = false;

function panelVisible() {
  return !mode.clickThrough && (hovering || panelPinned);
}

async function syncPanel() {
  const want = panelVisible();
  if (panelEl.hidden === !want) return; // 状态没变

  if (want) {
    // 先记下猪**此刻的屏幕位置**。锚定会让它保持不动，所以这个值在显示
    // 面板之后依然成立，可以拿来判断「上方还剩多少空间」。
    let pigScreenTop = null;
    let scale = 1;
    try {
      scale = await win.scaleFactor();
      const pos = await win.outerPosition();
      pigScreenTop = pos.y + pigEl.offsetTop * scale;
    } catch (e) {
      jlog(`读窗口位置失败（面板方向按默认处理）：${e}`);
    }

    // ⚠️ 顺序很关键：**先让面板占位，等窗口长完，再让它可见**。
    //
    // 如果直接 `hidden = false`：面板会在**旧的 80×80 视口**里排版，于是它盖住
    // 光标、把猪挤出光标位置，WebView2 立刻补发 `pointerleave` —— 刚打开的面板
    // 被自己关掉，而且窗口移动后光标没动、不会再补 `pointerenter`，面板就再也不开。
    // （实测日志里就是「POINTERENTER → BOX 166x240 → BOX 80x80」一次就没了。）
    //
    // 用 `visibility: hidden` 占位：它照常参与布局（offsetHeight 有效），
    // 但既不可见也不参与命中测试，所以这一瞬间光标下面的元素没有变化。
    const prevPig = measurePigOffset(); // 必须在改 DOM **之前**量
    panelEl.hidden = false;
    panelEl.classList.add("is-measuring");

    // 猪贴着屏幕顶部时，面板放上面会被屏幕边缘裁掉 → 翻到下面。
    // 翻面之后主进程会照着新的猪锚点重新摆窗口，猪依然不动 —— 这正是把锚点
    // 做成「猪中心在内容框里的偏移」而不是「底边」的原因。
    if (pigScreenTop !== null) {
      const needAbove = panelEl.offsetHeight * scale + 8;
      const below = pigScreenTop < needAbove;
      stackEl.classList.toggle("is-below", below);
      if (below) {
        jlog(`面板翻到猪下方（上方只有 ${Math.round(pigScreenTop)}px，需要 ${Math.round(needAbove)}px）`);
      }
    }

    await reportContentBox(prevPig);
    await nextFrame();
    await nextFrame();
    panelEl.classList.remove("is-measuring");
    panelEl.classList.remove("is-hiding");
    setTimeout(logPanelGeometry, 120);
  } else {
    const prevPig = measurePigOffset(); // 面板还显示着的时候量
    panelEl.hidden = true;
    stackEl.classList.remove("is-below");
    reportContentBox(prevPig);
  }
}

/** 等一帧，让浏览器把刚才的布局改动落实。 */
function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * 诊断：面板一显示就把各按钮的**屏幕坐标**写进日志。
 *
 * 为什么需要：验收必须点**真实鼠标**——合成 DOM 事件只能证明监听器写对了，
 * 证明不了「窗口收不收得到这个点击」（穿透位设错时事件根本不会到达）。
 * 验收脚本读这行日志拿到坐标，再用 SetCursorPos + mouse_event 真点。
 *
 * ⚠️ 这里用 getBoundingClientRect 是**故意**的：它只用来定位鼠标，
 * 不参与任何尺寸决策（铁律 1 管的是测量窗口大小）。
 */
async function logPanelGeometry() {
  // 面板收起时量到的是全 0，别把这种噪声写进日志。
  if (panelEl.hidden) return;
  try {
    const scale = await win.scaleFactor();
    const pos = await win.outerPosition();
    const toScreen = (el) => {
      const r = el.getBoundingClientRect();
      return {
        cx: Math.round(pos.x + (r.left + r.width / 2) * scale),
        cy: Math.round(pos.y + (r.top + r.height / 2) * scale),
      };
    };
    const pig = toScreen(pigEl);
    const parts = [];
    for (const btn of actionsEl.querySelectorAll("button[data-act]")) {
      const p = toScreen(btn);
      parts.push(`${btn.dataset.act}@${p.cx},${p.cy}${btn.disabled ? "(disabled)" : ""}`);
    }
    jlog(
      `PANEL-GEOM scale=${scale} origin=${pos.x},${pos.y} ` +
        `pig=${pig.cx},${pig.cy} btns=${parts.join(" ")}`
    );
  } catch (e) {
    jlog(`PANEL-GEOM failed: ${e}`);
  }
}

function setPanelPinned(on) {
  panelPinned = on && !mode.clickThrough;
  syncPanel();
}

let bubbleTimer = null;

function showBubble(text, ms = 2600) {
  if (mode.clickThrough) return; // 穿透模式不显示气泡
  bubbleEl.textContent = text;
  bubbleEl.hidden = false;
  reportContentBox();
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(hideBubble, ms);
}

function hideBubble() {
  if (bubbleEl.hidden) return;
  bubbleEl.hidden = true;
  clearTimeout(bubbleTimer);
  bubbleTimer = null;
  reportContentBox();
}

/** 把 core/ 排队的台词取出来显示。 */
function flushLines() {
  const line = takeLine();
  if (line) showBubble(line.text);
}

// ---------------- ⑤ 渲染四维 / 等级 ----------------

const STAT_KEYS = ["satiety", "happiness", "cleanliness", "health"];

function renderPet() {
  const v = petView();
  if (v === null) return;

  // 等级（D10：纯展示）
  lvNumEl.textContent = String(v.level);
  lvTitleEl.textContent = v.levelTitle || v.stageLabel || "";

  // 四维条：用 transform:scaleX() 而不是动画 width（铁律 1）
  for (const key of STAT_KEYS) {
    const value = Number(v[key]) || 0;
    const max = key === "health" ? v.healthMax : 100;
    const ratio = Math.max(0, Math.min(1, value / max));
    const fill = document.getElementById(`bar-${key}`);
    const label = document.getElementById(`val-${key}`);
    if (fill) fill.style.transform = `scaleX(${ratio.toFixed(4)})`;
    if (label) label.textContent = String(Math.round(value));
    const row = fill?.closest(".dp-bar");
    if (row) row.classList.toggle("is-low", ratio < 0.25);
  }

  // 动作可用性（没有食物时喂食按钮置灰）
  for (const btn of actionsEl.querySelectorAll("button[data-act]")) {
    const act = btn.dataset.act;
    const options = v.care?.[act];
    // careView 只覆盖 feed/bathe/play；pet 永远可用
    const usable = act === "pet" ? true : Array.isArray(options) && options.length > 0;
    btn.disabled = !usable;
    btn.style.opacity = usable ? "" : "0.4";
  }
}

function flashButton(btn) {
  if (!btn) return;
  btn.classList.add("is-used");
  setTimeout(() => btn.classList.remove("is-used"), 220);
}

// ---------------- 互动 ----------------

const CARE_FAIL_TEXT = {
  "no-item": "背包里没有可用的东西了",
  box: "它还是个纸盒呢",
  absent: "猪不见了",
  unknown: "没有这个动作",
  cooldown: "等一下下",
};

function onPet() {
  const result = doCare("pet");
  if (!result.ok) {
    showBubble(CARE_FAIL_TEXT[result.reason] ?? "现在不行");
    return;
  }
  playScene("pet");
  renderPet();
  flushLines();
}

// ---------------- 动作场景 ----------------

/**
 * 动作场景图。
 *
 * 5 张都是 `gen-scenes.py` 从 `piglet.svg` 派生的：身体**逐位一致**，只换表情、
 * 加道具（`verify-scenes.py` 会渲染出来逐像素验证这一点），所以切换时猪不会
 * 「变形」，只有表情和身边的小物件在变。
 */
const SCENE_SRC = {
  idle: "assets/piglet.svg",
  eat: "assets/piglet-eat.svg",
  bathe: "assets/piglet-bathe.svg",
  play: "assets/piglet-play.svg",
  pet: "assets/piglet-pet.svg",
  relax: "assets/piglet-relax.svg",
};
/** 动作名 → 场景名（只有「喂食」和场景名不同）。 */
const SCENE_OF_ACTION = { feed: "eat", bathe: "bathe", play: "play", pet: "pet" };
const SCENE_HOLD_MS = 1800;

let sceneTimer = null;
let currentScene = "idle";

// ---------------- 皮肤：运行时重着色（P2-1）----------------
//
// 皮肤是**一套调色板**，不是一套新图：猪本体只用了 6 个颜色，其余都是道具色。
// 所以换皮肤 = 把基础 SVG 里的 6 个色值换掉，生成 blob 图。
// 一个皮肤 **0 字节磁盘占用**，也不会让「美术 < 30 KB」的预算随皮肤数量膨胀。
//
// 🔴 默认皮肤走**原图直出**的快路径（不 fetch、不重着色、不建 blob）：
// 那是最常见的路径，开销必须严格为 0，也保证行为与加皮肤之前**逐字节一致**。

/** 场景名 → 该场景的 blob URL（当前皮肤）。换皮肤时整表清空。 */
const skinUrlCache = new Map();
/** 基础 SVG 的文本缓存，换皮肤时不清 —— 它和皮肤无关。 */
const svgTextCache = new Map();
/** 当前生效的调色板；null = 默认皮肤（原图直出）。 */
let activePalette = null;

/** 把基础 SVG 文本里的 6 个槽位色换掉。 */
function recolorSvg(text, palette) {
  const map = new Map();
  for (const [slot, from] of Object.entries(core.SKIN_SLOTS)) {
    const to = palette[slot];
    if (typeof to === "string" && to.toUpperCase() !== from.toUpperCase()) {
      map.set(from.toUpperCase(), to.toUpperCase());
    }
  }
  if (map.size === 0) return text;
  // ⚠️ 必须**单趟**替换：分 6 次 `split/join` 会级联
  //（比如 A→B 之后，下一轮的 B→C 又会把刚换上的 B 再换一次）。
  return text.replace(/#[0-9A-Fa-f]{6}/g, (m) => map.get(m.toUpperCase()) ?? m);
}

async function baseSvgText(scene) {
  if (svgTextCache.has(scene)) return svgTextCache.get(scene);
  const res = await fetch(SCENE_SRC[scene]);
  if (!res.ok) throw new Error(`加载 ${SCENE_SRC[scene]} 失败: HTTP ${res.status}`);
  const text = await res.text();
  svgTextCache.set(scene, text);
  return text;
}

/** 取某场景在当前皮肤下的图 URL。默认皮肤直接给原图路径。 */
async function sceneArtUrl(scene) {
  if (activePalette === null) return SCENE_SRC[scene];
  if (skinUrlCache.has(scene)) return skinUrlCache.get(scene);
  const recolored = recolorSvg(await baseSvgText(scene), activePalette);
  const url = URL.createObjectURL(new Blob([recolored], { type: "image/svg+xml" }));
  skinUrlCache.set(scene, url);
  return url;
}

/**
 * 切到某套调色板（`null` = 默认皮肤）。
 *
 * 清掉旧 blob 释放内存，然后重画当前场景。
 */
async function applySkin(palette) {
  const same =
    (palette === null && activePalette === null) ||
    (palette !== null && activePalette !== null &&
      core.SKIN_SLOT_ORDER.every((s) => palette[s] === activePalette[s]));
  if (same) return;

  for (const url of skinUrlCache.values()) URL.revokeObjectURL(url);
  skinUrlCache.clear();
  activePalette = palette;
  jlog(`皮肤 -> ${palette === null ? "默认" : Object.values(palette).join(",")}`);

  // 预载当前皮肤的全部场景，避免第一次切换时闪空白
  const all = Object.keys(SCENE_SRC);
  await Promise.all(all.map((s) => sceneArtUrl(s).catch(() => null)));

  // 重画当前场景（`setScene` 会因为同名而提前返回，所以这里直接换 src）
  const url = await sceneArtUrl(currentScene).catch(() => SCENE_SRC.idle);
  if (url) pigArtEl.src = url;
}

/** 把当前皮肤广播给设置窗口（改完皮肤后回显用）。 */
function broadcastSkin() {
  const state = getState();
  emit("piggy://skin", {
    key: state?.skin ?? "default",
    entries: skinsView().entries.map((e) => ({ key: e.key, label: e.label, emoji: e.emoji })),
  });
}

/** 异步换图；期间用户可能又切了场景，所以回来要再确认一次。 */
async function applySceneArt(scene) {
  const url = await sceneArtUrl(scene).catch((e) => {
    jlog(`场景图失败 ${scene}: ${e}`);
    return SCENE_SRC.idle;
  });
  if (currentScene !== scene) return; // 已经切走了，别覆盖
  pigArtEl.src = url;
}

function setScene(name) {
  const next = SCENE_SRC[name] ? name : "idle";
  if (next === currentScene) return;
  currentScene = next;
  if (activePalette === null) {
    // 默认皮肤：同步直出，和加皮肤之前**完全一样**
    pigArtEl.src = SCENE_SRC[next];
  } else {
    applySceneArt(next);
  }
  jlog(`场景 -> ${next}`);
}

/** 播一个动作场景，`SCENE_HOLD_MS` 之后自动回到待机（或「累」的表情）。 */
function playScene(name) {
  setScene(name);
  if (sceneTimer !== null) window.clearTimeout(sceneTimer);
  sceneTimer = window.setTimeout(() => {
    sceneTimer = null;
    setScene(idleScene());
  }, SCENE_HOLD_MS);
}

/** 没在播动作时该用哪张：状态偏低就摆出「累」的表情。 */
function idleScene() {
  const v = petView();
  const low =
    v.satiety < 25 || v.happiness < 25 || v.cleanliness < 25 || v.health / v.healthMax < 0.4;
  return low ? "relax" : "idle";
}

/** 启动时把所有场景图预载进缓存，避免第一次切换时闪一下空白。 */
function preloadScenes() {
  for (const src of Object.values(SCENE_SRC)) {
    const img = new Image();
    img.src = src;
  }
}

actionsEl.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn || btn.disabled) return;
  const action = btn.dataset.act;
  const result = doCare(action);
  flashButton(btn);
  if (!result.ok) {
    showBubble(CARE_FAIL_TEXT[result.reason] ?? "现在不行");
    return;
  }
  const scene = SCENE_OF_ACTION[action];
  if (scene) playScene(scene);
  renderPet();
  flushLines();
  // 面板尺寸不变，但数值变了要立刻反映
  reportContentBox();
});

// ---------------- 启动 ----------------

window.addEventListener("DOMContentLoaded", async () => {
  await initMode();

  // 领域模型：载入存档 + 补离线时间
  try {
    await initPet(invoke, jlog);
    jlog("宠物核心已就绪");
  } catch (e) {
    jlog(`宠物核心初始化失败：${e}`);
  }

  renderPet();
  flushLines();
  await reportContentBox();
  syncBreathing();

  // 先把 6 张场景图都塞进浏览器缓存，免得第一次切场景时闪一下空白。
  preloadScenes();
  // 存档里带的皮肤（D6：换皮肤）。默认皮肤时 `applySkin(null)` 直接返回，
  // 一行都不做 —— 常见路径的开销严格为 0。
  await applySkin(core.skinPalette(getState()));
  setScene(idleScene());

  // 每秒刷新一次显示（衰减由 pet.js 自己的 20 秒 tick 推进并存档；
  // 这里只重绘，避免每秒都触发一次存档写入）。
  window.setInterval(() => {
    renderPet();
    flushLines();
    // 没在播动作时，按状态决定摆哪张脸（状态偏低 → relax）。
    // setScene 内部会先比对，没变就直接返回，所以这里是廉价的。
    if (sceneTimer === null) setScene(idleScene());
  }, 1000);

  // 退出/隐藏前落盘
  window.addEventListener("beforeunload", () => saveNow());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) saveNow();
  });

  // 让 Rust 侧在窗口真正显示后巩固一次窗口样式，并回读作为验收凭据。
  await reinforceStyles();
  window.addEventListener("load", () => {
    reportContentBox();
    reinforceStyles();
  });
  window.addEventListener("resize", debounce(reportContentBox, 120));
});

/** 让 Rust 再套一遍窗口样式（wry 会在显示/webview 初始化时覆盖样式）。 */
async function reinforceStyles() {
  try {
    const styles = await invoke("frontend_ready");
    jlog(`overlay styles: ${styles}`);
    return styles;
  } catch (e) {
    jlog(`frontend_ready failed: ${e}`);
    return null;
  }
}

// 暴露给控制台便于实测验收
window.__piggy = {
  invoke,
  getMode: () => mode,
  getState,
  getView: petView,
  reportContentBox,
  measureContentBox,
  doCare,
  renderPet,
  petSay,
  replyLine,
  setScene,
  playScene,
  getScene: () => currentScene,
};
