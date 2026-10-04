/**
 * 设置窗口逻辑（P2-5）。
 *
 * 设计原则：**改完立即生效，不设「保存」按钮**。
 * 每个控件 `change` 时就发一个 `{ path: value }` 的局部补丁给 Rust，
 * Rust 合并 → 夹紧 → 存盘 → 应用副作用，再把**夹紧后**的完整配置回传。
 * 回传值用来回写控件 —— 用户把滑块拖到 100 但上限是 90 时，
 * 滑块必须自己弹回 90，否则界面显示的和实际存的对不上。
 */

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

/** 当前配置（Rust 侧 Config 的镜像）。 */
let cfg = null;

// ---------------------------------------------------------------- 工具

function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  let cur = obj;
  for (const k of keys) {
    if (typeof cur[k] !== "object" || cur[k] === null) cur[k] = {};
    cur = cur[k];
  }
  cur[last] = value;
}

function toast(msg, isError = false) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.toggle("err", isError);
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2200);
}

// ---------------------------------------------------------------- 从配置回写界面

/** 每个 data-path 控件的显示格式。 */
function formatValue(el, value) {
  if (el.type === "checkbox") return null;
  const unit = el.dataset.unit ?? "";
  return `${value}${unit}`;
}

function applyConfig(next) {
  cfg = next;
  for (const el of document.querySelectorAll("[data-path]")) {
    const v = getPath(cfg, el.dataset.path);
    if (v === undefined) continue;
    if (el.type === "checkbox") el.checked = Boolean(v);
    else el.value = String(v);
  }
  // 滑块的数值回显
  for (const el of document.querySelectorAll('input[type="range"][data-path]')) {
    const out = document.getElementById(`${el.id}Out`);
    if (out) out.textContent = formatValue(el, el.value);
  }
  syncHoverOptions();
}

/** 悬停让位关掉时，把它的三个子项灰掉 —— 避免用户以为调了没反应。 */
function syncHoverOptions() {
  const on = document.getElementById("hoverThrough").checked;
  for (const el of document.querySelectorAll("#hoverOpts, .row.indent")) {
    el.classList.toggle("off", !on);
  }
}

// ---------------------------------------------------------------- 推送补丁

async function push(patch, el) {
  try {
    const next = await invoke("set_config", { patch });
    applyConfig(next);
    // 夹紧回写：把控件拉到实际生效的值
    if (el && el.type !== "checkbox") {
      const v = getPath(next, el.dataset.path);
      if (v !== undefined && String(el.value) !== String(v)) {
        el.value = String(v);
        const out = document.getElementById(`${el.id}Out`);
        if (out) out.textContent = formatValue(el, v);
        toast(`已调整为 ${v}${el.dataset.unit ?? ""}（超出允许范围）`);
      }
    }
  } catch (e) {
    toast(`保存失败：${e}`, true);
  }
}

// ---------------------------------------------------------------- 快捷键捕获

const MOD_KEYS = new Set(["Control", "Alt", "Shift", "Meta"]);

/** 把键盘事件翻成 `global-hotkey` 认的组合键字符串。 */
function comboFromEvent(e) {
  const parts = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Super");

  // 只按修饰键本身不算
  if (MOD_KEYS.has(e.key)) return { needKey: true };

  const code = e.code;
  let key = null;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) key = code;
  else if (code === "Space") key = "Space";
  else if (code === "Enter") key = "Enter";
  else if (code === "Escape") key = null;
  else if (code.startsWith("Arrow")) key = code.slice(5);
  else if (code === "Backquote") key = "Backquote";
  else if (code === "Minus") key = "Minus";
  else if (code === "Equal") key = "Equal";
  else if (code === "BracketLeft") key = "BracketLeft";
  else if (code === "BracketRight") key = "BracketRight";
  else if (code === "Backslash") key = "Backslash";
  else if (code === "Semicolon") key = "Semicolon";
  else if (code === "Quote") key = "Quote";
  else if (code === "Comma") key = "Comma";
  else if (code === "Period") key = "Period";
  else if (code === "Slash") key = "Slash";
  else if (code === "Insert" || code === "Delete" || code === "Home"
        || code === "End" || code === "PageUp" || code === "PageDown") key = code;

  if (key === null) return { invalid: true };
  // 没有修饰键的全局快捷键会抢走正常打字，必须拒绝
  if (parts.length === 0) return { needMod: true };
  parts.push(key);
  return { combo: parts.join("+") };
}

function setupKeyCapture(id, path) {
  const el = document.getElementById(id);

  el.addEventListener("focus", () => {
    el.classList.add("capturing");
    el.dataset.prev = el.value;
    el.value = "按下组合键…";
  });

  el.addEventListener("blur", () => {
    el.classList.remove("capturing");
    if (el.value === "按下组合键…") el.value = el.dataset.prev ?? "";
  });

  el.addEventListener("keydown", (e) => {
    e.preventDefault();
    if (e.key === "Escape") { el.blur(); return; }

    const r = comboFromEvent(e);
    if (r.needKey) { el.value = "继续按一个主键…"; return; }
    if (r.needMod) { el.value = "必须带 Ctrl / Alt / Shift / Win"; return; }
    if (r.invalid) { el.value = "这个键不支持"; return; }

    el.value = r.combo;
    el.blur();
    push({ shortcuts: path === "toggleClickThrough"
      ? { toggleClickThrough: r.combo }
      : { toggleVisibility: r.combo } }, null);
  });
}

// ---------------------------------------------------------------- 模式/冲突回显

function renderMode(snap) {
  const ct = document.getElementById("boundCt");
  const vis = document.getElementById("boundVis");
  ct.innerHTML = snap.boundToggleClickThrough
    ? `实际生效：<b>${snap.boundToggleClickThrough}</b>`
    : `<b>未生效</b>（全部候选都被占用）`;
  vis.innerHTML = snap.boundToggleVisibility
    ? `实际生效：<b>${snap.boundToggleVisibility}</b>`
    : `<b>未生效</b>（全部候选都被占用）`;

  const box = document.getElementById("problems");
  const list = snap.shortcutProblems ?? [];
  box.hidden = list.length === 0;
  box.innerHTML = list.map((p) => `<div>⚠️ ${p}</div>`).join("");
}

// ---------------------------------------------------------------- 诊断

async function renderDiag() {
  const el = document.getElementById("diag");
  try {
    el.textContent = await invoke("diagnostics");
  } catch (e) {
    el.textContent = `读取失败：${e}`;
  }
}

// ---------------------------------------------------------------- 启动

window.addEventListener("DOMContentLoaded", async () => {
  applyConfig(await invoke("get_config"));

  // 落一条日志：证明设置窗口的 JS **真的能 invoke**
  // （capability 配错时 `invoke` 会被 ACL 拒掉，界面看着是好的但控件全是空的）。
  const o = cfg.overlay, s = cfg.shortcuts;
  await invoke("log_from_js", {
    msg: `设置界面就绪: clickThrough=${o.clickThrough} hoverThrough=${o.hoverThrough} `
       + `alpha=${o.hoverThroughAlpha} wake=${o.hoverWakeDelayMs} restore=${o.hoverRestoreDelayMs} `
       + `opacity=${o.opacityPercent} scale=${o.scalePercent} `
       + `hotkeyCT=${s.toggleClickThrough} hotkeyVis=${s.toggleVisibility}`,
  }).catch((e) => toast(`与主进程通信失败：${e}`, true));

  // 滑块：拖动时只更新数字，松手才落盘（避免每帧一次 IPC + 写文件）
  for (const el of document.querySelectorAll('input[type="range"][data-path]')) {
    el.addEventListener("input", () => {
      const out = document.getElementById(`${el.id}Out`);
      if (out) out.textContent = formatValue(el, el.value);
    });
    el.addEventListener("change", () => {
      const patch = {};
      setPath(patch, el.dataset.path, Number(el.value));
      push(patch, el);
    });
  }

  // 勾选框：立即落盘
  for (const el of document.querySelectorAll('input[type="checkbox"][data-path]')) {
    el.addEventListener("change", () => {
      const patch = {};
      setPath(patch, el.dataset.path, el.checked);
      push(patch, null);
      if (el.id === "hoverThrough") syncHoverOptions();
    });
  }

  setupKeyCapture("toggleClickThrough", "toggleClickThrough");
  setupKeyCapture("toggleVisibility", "toggleVisibility");

  // 开机自启：单独走命令，并且**读注册表**回显真实状态
  const auto = document.getElementById("launchAtLogin");
  auto.checked = await invoke("get_autostart");
  auto.addEventListener("change", async () => {
    try {
      const now = await invoke("set_autostart", { enabled: auto.checked });
      auto.checked = now;
      toast(now ? "已设置开机自启" : "已取消开机自启");
    } catch (e) {
      auto.checked = !auto.checked;
      toast(`设置失败：${e}`, true);
    }
  });

  // 快捷键实际生效情况 + 冲突提示，由主进程广播
  try {
    renderMode(await invoke("get_mode"));
  } catch (_) { /* 忽略 */ }
  await listen("piggy://mode", (ev) => renderMode(ev.payload));

  await renderDiag();
});
