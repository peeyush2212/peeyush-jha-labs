import { toast } from "./shared.js";

const LS_DEMO_ENABLED = "demoModeEnabled";
const LS_DEMO_TASKS = "demoModeTasks";
const LS_DEMO_WELCOME_DISMISSED = "demoWelcomeDismissed:v1";
const LS_AUTOPILOT_SEEN = "autopilotDemoSeen:v1";

function isTypingTarget(el) {
  if (!el) return false;
  const tag = String(el.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
}

function hasHiddenAncestor(el) {
  try {
    return !!el.closest("[hidden]");
  } catch (_) {
    return false;
  }
}

function isVisibleElement(el) {
  if (!el) return false;
  if (hasHiddenAncestor(el)) return false;

  const style = window.getComputedStyle(el);
  if (!style) return false;
  if (style.display === "none" || style.visibility === "hidden") return false;

  const r = el.getBoundingClientRect?.();
  if (!r) return false;
  // Tiny rects are often collapsed/detached; avoid highlighting them.
  if (r.width < 2 || r.height < 2) return false;

  return true;
}

function queryVisible(selector) {
  const nodes = Array.from(document.querySelectorAll(selector));
  for (const n of nodes) {
    if (isVisibleElement(n)) return n;
  }
  return nodes[0] || null;
}

function pickHighlightTarget(el) {
  if (!el) return null;
  const tag = String(el.tagName || "").toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea") {
    const field = el.closest?.(".field");
    if (field) return field;
  }
  return el;
}

function bumpRadius(radiusStr, bumpPx = 10) {
  const s = String(radiusStr || "").trim();
  if (!s) return "18px";
  // Only adjust simple `Npx` radii. Complex shorthand stays as-is.
  if (s.includes(" ") || s.includes("/")) return s;
  const m = s.match(/^([0-9.]+)px$/);
  if (!m) return s;
  try {
    const n = parseFloat(m[1]);
    if (isNaN(n)) return s;
    return `${n + Number(bumpPx || 0)}px`;
  } catch (_) {
    return s;
  }
}


function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {
    // ignore
  }
}

function welcomeDismissed() {
  return !!loadJson(LS_DEMO_WELCOME_DISMISSED, false);
}

function setWelcomeDismissed(v = true) {
  saveJson(LS_DEMO_WELCOME_DISMISSED, !!v);
}

function setAutopilotSeen(v = true) {
  saveJson(LS_AUTOPILOT_SEEN, !!v);
}

// ------------------------
// Demo mode (guided panel)
// ------------------------

const DEMO_TASKS = [
  {
    key: "profile",
    label: "Switch profile",
    hint: "Open the profile menu and switch personas",
    go: ({ openProfiles }) => openProfiles(),
  },
  {
    key: "price",
    label: "Compute a price",
    hint: "Use the Pricer (Barrier + Monte Carlo)",
    go: ({ go }) => go("/pricer"),
  },
  {
    key: "stresspack",
    label: "Load a stress pack",
    hint: "Apply a preset macro stress scenario",
    go: ({ go }) => go("/macro"),
  },
  {
    key: "scenario",
    label: "Compute scenario",
    hint: "Run a scenario and save a run",
    go: ({ go }) => go("/macro"),
  },
  {
    key: "compare",
    label: "Compare 2 packs",
    hint: "Select 2+ packs and compare side-by-side",
    go: ({ go }) => go("/macro"),
  },
  {
    key: "strategy",
    label: "Get strategy candidates",
    hint: "Generate candidate structures from a view",
    go: ({ go }) => go("/strategy"),
  },
  {
    key: "capbud",
    label: "Capital budgeting",
    hint: "Compute NPV/IRR and explore sensitivity",
    go: ({ go }) => go("/capbud"),
  },
  {
    key: "report",
    label: "Export a PDF report",
    hint: "Open Runs and export a PDF report for a saved run",
    go: ({ go }) => go("/runs"),
  },
];

function demoEnabled() {
  return loadJson(LS_DEMO_ENABLED, false) === true;
}

function setDemoEnabled(v) {
  saveJson(LS_DEMO_ENABLED, Boolean(v));
}

function demoTasks() {
  return loadJson(LS_DEMO_TASKS, {});
}

function setDemoTaskDone(key, done = true) {
  const t = demoTasks();
  t[key] = Boolean(done);
  saveJson(LS_DEMO_TASKS, t);
}

function resetDemoTasks() {
  saveJson(LS_DEMO_TASKS, {});
}

function renderDemoPanel(ctx) {
  const existing = document.getElementById("demoPanel");
  if (existing) existing.remove();

  if (!demoEnabled()) return;

  const panel = document.createElement("div");
  panel.id = "demoPanel";
  panel.className = "demo-panel";
  panel.innerHTML = `
    <div class="demo-panel__head">
      <div>
        <div class="demo-panel__title">Demo mode</div>
        <div class="demo-panel__sub">A 60-second guided checklist</div>
      </div>
      <button class="icon-btn icon-btn--small" id="demoClose" aria-label="Close demo">✕</button>
    </div>

    <div class="demo-panel__list" id="demoList"></div>

    <div class="demo-panel__foot">
      <button class="btn btn--ghost" id="demoReset" type="button">Reset</button>
      <button class="btn btn--primary" id="demoPalette" type="button">Command palette</button>
    </div>
  `;

  document.body.appendChild(panel);

  const tasks = demoTasks();
  const list = panel.querySelector("#demoList");
  list.innerHTML = DEMO_TASKS.map((t) => {
    const done = Boolean(tasks[t.key]);
    return `
      <button class="demo-task ${done ? "demo-task--done" : ""}" data-task="${t.key}" type="button">
        <span class="demo-task__check" aria-hidden="true">${done ? "✓" : "○"}</span>
        <span class="demo-task__meta">
          <span class="demo-task__label">${t.label}</span>
          <span class="demo-task__hint">${t.hint}</span>
        </span>
      </button>
    `;
  }).join("");

  panel.querySelector("#demoClose").addEventListener("click", () => {
    setDemoEnabled(false);
    renderDemoPanel(ctx);
    syncDemoToggle();
  });

  panel.querySelector("#demoReset").addEventListener("click", () => {
    resetDemoTasks();
    renderDemoPanel(ctx);
    toast("Checklist reset", "info");
  });

  panel.querySelector("#demoPalette").addEventListener("click", () => {
    ctx.openPalette();
  });

  list.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-task]");
    if (!btn) return;
    const key = btn.getAttribute("data-task");
    const task = DEMO_TASKS.find((x) => x.key === key);
    if (!task) return;
    task.go(ctx);
  });
}

function syncDemoToggle() {
  const btn = document.getElementById("demoToggle");
  if (!btn) return;
  btn.setAttribute("aria-pressed", demoEnabled() ? "true" : "false");
  btn.classList.toggle("pill--active", demoEnabled());
  const seenAuto = !!loadJson(LS_AUTOPILOT_SEEN, false);
  btn.classList.toggle("pill--nudge", !welcomeDismissed() && !seenAuto);
  btn.setAttribute("title", "Demo: start an autopilot tour or open the checklist panel");
}

function markDemoTask(key) {
  if (!demoEnabled()) return;
  setDemoTaskDone(key, true);
  // Re-render to show it checked (simple + robust).
  // This is small UI so perf is a non-issue.
  renderDemoPanel(window.__ux_ctx);
}

// ------------------------
// Command palette (Ctrl+K)
// ------------------------

function openModal({ title, bodyHtml, onMount, className = "palette" }) {
  const root = document.getElementById("modalRoot");
  if (!root) return () => {};

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const cls = String(className || "").trim();

  backdrop.innerHTML = `
    <div class="modal ${cls}" role="dialog" aria-modal="true">
      <div class="modal__header">
        <div class="modal__title">${title}</div>
        <button class="icon-btn icon-btn--small" id="modalClose" aria-label="Close">✕</button>
      </div>
      <div class="modal__body">${bodyHtml}</div>
    </div>
  `;

  function close() {
    backdrop.remove();
    window.removeEventListener("keydown", onKeydown);
  }

  function onKeydown(e) {
    if (e.key === "Escape") close();
  }

  window.addEventListener("keydown", onKeydown);
  root.appendChild(backdrop);

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });

  const closeBtn = backdrop.querySelector("#modalClose");
  closeBtn?.addEventListener("click", close);

  onMount?.(backdrop, close);

  return close;
}

function buildActions({ go, toggleDemo, openProfiles, openDemoCenter, startAutopilot }) {
  const nav = [
    ["/", "Go: Home"],
    ["/pricer", "Go: Pricer"],
    ["/portfolio", "Go: Portfolio"],
    ["/strategy", "Go: Strategy Builder"],
    ["/macro", "Go: Macro"],
    ["/tax", "Go: Tax"],
    ["/capbud", "Go: Capital Budgeting"],
    ["/scenario", "Go: Scenario"],
    ["/batch", "Go: Batch"],
    ["/runs", "Go: Runs"],
  ].map(([path, label]) => ({
    id: `nav:${path}`,
    label,
    hint: path,
    run: () => go(path),
  }));

  const misc = [
    {
      id: "demo:center",
      label: "Demo: Open demo center",
      hint: "Autopilot + checklist",
      run: () => openDemoCenter?.(),
    },
    {
      id: "demo:autopilot",
      label: "Demo: Start autopilot tour",
      hint: "The site drives itself (you can take control anytime)",
      run: () => startAutopilot?.("full"),
    },
    {
      id: "demo:pricer",
      label: "Demo: Pricer (Barrier + Monte Carlo)",
      hint: "Select an instrument, set params, compute, view Greeks",
      run: () => startAutopilot?.("pricer"),
    },
    {
      id: "demo:strategy",
      label: "Demo: Strategy (Find best candidate)",
      hint: "Encode a view, rank structures, run scenario analysis",
      run: () => startAutopilot?.("strategy"),
    },
    {
      id: "demo:portfolio",
      label: "Demo: Portfolio (Multi-leg compute)",
      hint: "Add legs, compute aggregate results",
      run: () => startAutopilot?.("portfolio"),
    },
    {
      id: "demo:macro",
      label: "Demo: Macro (Stress pack scenario)",
      hint: "Apply a pack and compute scenario grid",
      run: () => startAutopilot?.("macro"),
    },
    {
      id: "demo:capbud",
      label: "Demo: Capital Budgeting (NPV/IRR)",
      hint: "Evaluate a project and read the sensitivity/NPV profile",
      run: () => startAutopilot?.("capbud"),
    },
    {
      id: "demo:runs",
      label: "Demo: Runs (Export PDF report)",
      hint: "Open a saved run and export a PDF",
      run: () => startAutopilot?.("runs"),
    },
    {
      id: "toggle:demo",
      label: demoEnabled() ? "Toggle: Demo mode (on)" : "Toggle: Demo mode (off)",
      hint: "Guided checklist panel",
      run: () => toggleDemo(),
    },
    {
      id: "profile:switch",
      label: "Profile: Switch",
      hint: "Open profile menu",
      run: () => openProfiles(),
    },
    {
      id: "help:shortcuts",
      label: "Help: Keyboard shortcuts",
      hint: "Show shortcuts",
      run: () => showShortcuts(),
    },
  ];

  return [...misc, ...nav];
}

function showShortcuts() {
  openModal({
    title: "Keyboard shortcuts",
    bodyHtml: `
      <div class="stack">
        <div class="kpi"><div class="kpi__label">Ctrl/Cmd + K</div><div class="kpi__value">Open command palette</div></div>
        <div class="kpi"><div class="kpi__label">Esc</div><div class="kpi__value">Close dialogs</div></div>
        <div class="kpi"><div class="kpi__label">?</div><div class="kpi__value">Show this help</div></div>
        <div class="muted" style="font-size:12.5px; margin-top:8px;">Tip: the palette can navigate anywhere and toggle Demo mode.</div>
      </div>
    `,
  });
}

function openPalette(ctx) {
  const go = (path) => ctx.go(path);
  const toggleDemo = () => ctx.toggleDemo();
  const openProfiles = () => ctx.openProfiles();

  const openDemoCenter = () => ctx.openDemoCenter?.();
  const startAutopilot = (flow) => ctx.startAutopilot?.(flow);

  const actions = buildActions({ go, toggleDemo, openProfiles, openDemoCenter, startAutopilot });

  let q = "";
  let idx = 0;

  function filtered() {
    const s = q.trim().toLowerCase();
    if (!s) return actions;
    return actions.filter((a) => a.label.toLowerCase().includes(s) || a.hint.toLowerCase().includes(s));
  }

  const close = openModal({
    title: "Command palette",
    bodyHtml: `
      <div class="palette__wrap">
        <input id="paletteInput" class="input" placeholder="Type to search… (e.g., macro, runs, demo)" autocomplete="off" />
        <div id="paletteList" class="palette__list" role="listbox"></div>
        <div class="palette__tip muted">↑↓ to select · Enter to run · Esc to close</div>
      </div>
    `,
    onMount: (rootEl, doClose) => {
      const input = rootEl.querySelector("#paletteInput");
      const list = rootEl.querySelector("#paletteList");

      function render() {
        const items = filtered();
        if (!items.length) {
          list.innerHTML = `<div class="muted" style="font-size:12.5px;">No matches.</div>`;
          return;
        }
        idx = Math.max(0, Math.min(idx, items.length - 1));

        list.innerHTML = items
          .map((a, i) => {
            const active = i === idx;
            return `
              <button class="palette-item ${active ? "active" : ""}" role="option" aria-selected="${active}" data-id="${a.id}" type="button">
                <span class="palette-item__label">${a.label}</span>
                <span class="palette-item__hint mono">${a.hint}</span>
              </button>
            `;
          })
          .join("");
      }

      function runSelected() {
        const items = filtered();
        if (!items.length) return;
        const a = items[idx];
        doClose();
        a.run();
      }

      function onKey(e) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          idx += 1;
          render();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          idx -= 1;
          render();
        } else if (e.key === "Enter") {
          e.preventDefault();
          runSelected();
        }
      }

      input.addEventListener("input", () => {
        q = input.value;
        idx = 0;
        render();
      });

      input.addEventListener("keydown", onKey);

      list.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-id]");
        if (!btn) return;
        const id = btn.getAttribute("data-id");
        const items = filtered();
        const a = items.find((x) => x.id === id);
        if (!a) return;
        doClose();
        a.run();
      });

      render();
      input.focus();
    },
  });

  return close;
}

// ------------------------
// Autopilot demo + Demo center
// ------------------------

let AUTOPILOT = null;

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function _isAutopilotRunning() {
  return !!(AUTOPILOT && AUTOPILOT.running);
}

function _sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function _raf() {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

async function waitForStableRect(el, { signal, timeoutMs = 1200, settleFrames = 3 } = {}) {
  if (!el) return null;
  const t0 = Date.now();
  let last = el.getBoundingClientRect();
  let stable = 0;

  while (Date.now() - t0 < timeoutMs) {
    if (signal?.aborted) return null;
    await _raf();
    const r = el.getBoundingClientRect();
    const close =
      Math.abs(r.left - last.left) < 0.5 &&
      Math.abs(r.top - last.top) < 0.5 &&
      Math.abs(r.width - last.width) < 0.5 &&
      Math.abs(r.height - last.height) < 0.5;

    if (close) stable += 1;
    else stable = 0;

    last = r;
    if (stable >= settleFrames) return r;
  }
  return last;
}

function createAutopilotOverlay({ onStop, onNext }) {
  const existing = document.getElementById("autopilotOverlay");
  existing?.remove();

  const overlay = document.createElement("div");
  overlay.id = "autopilotOverlay";
  overlay.className = "autopilot-overlay";
  overlay.innerHTML = `
    <div class="autopilot-spotlight autopilot-spotlight--hidden" id="autopilotSpotlight"></div>

    <div class="autopilot-menu autopilot-menu--hidden" id="autopilotMenu" aria-hidden="true"></div>

    <div class="autopilot-hud" id="autopilotHud" role="status" aria-live="polite">
      <div class="autopilot-hud__left">
        <div class="autopilot-badge" id="autopilotBadge">Autopilot demo</div>
        <div class="autopilot-progress" id="autopilotProgress">Step 1 / 1</div>
      </div>
      <div class="autopilot-hud__right">
        <button class="btn btn--ghost" id="autoTake" type="button">Take control</button>
        <button class="btn btn--primary" id="autoNext" type="button">Next →</button>
        <button class="icon-btn icon-btn--small" id="autoClose" type="button" aria-label="End demo">✕</button>
      </div>
    </div>

    <div class="autopilot-bubble" id="autopilotBubble" role="dialog" aria-label="Demo step">
      <div class="autopilot-bubble__title" id="autoTitle">…</div>
      <div class="autopilot-bubble__text" id="autoText"></div>
      <div class="autopilot-bubble__actions" aria-label="Demo controls">
        <button class="btn btn--primary" id="autoNext2" type="button">Next →</button>
        <button class="btn btn--ghost" id="autoTake2" type="button">Take control</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const spotlight = overlay.querySelector("#autopilotSpotlight");
  const menu = overlay.querySelector("#autopilotMenu");
  const bubble = overlay.querySelector("#autopilotBubble");
  const titleEl = overlay.querySelector("#autoTitle");
  const textEl = overlay.querySelector("#autoText");
  const badgeEl = overlay.querySelector("#autopilotBadge");
  const progressEl = overlay.querySelector("#autopilotProgress");

  // HUD controls
  overlay.querySelector("#autoTake")?.addEventListener("click", () => onStop?.("take-control"));
  overlay.querySelector("#autoNext")?.addEventListener("click", () => onNext?.());
  overlay.querySelector("#autoClose")?.addEventListener("click", () => onStop?.("close"));

  // Bubble controls (keep the primary CTA near the step text)
  overlay.querySelector("#autoTake2")?.addEventListener("click", () => onStop?.("take-control"));
  overlay.querySelector("#autoNext2")?.addEventListener("click", () => onNext?.());

  // Prevent clicks from reaching the app during autoplay.
  overlay.addEventListener("click", (e) => {
    // Allow interactions inside bubble/hud.
    if (e.target.closest(".autopilot-hud") || e.target.closest(".autopilot-bubble")) return;
    e.preventDefault();
    e.stopPropagation();
  });

  const onKeydown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onStop?.("escape");
      return;
    }

    // Next step (presentation clicker)
    if (e.key === "ArrowRight") {
      e.preventDefault();
      onNext?.();
      return;
    }

    // Prevent background scrolling while the overlay is active.
    if (
      e.key === "ArrowDown" ||
      e.key === "ArrowUp" ||
      e.key === "PageDown" ||
      e.key === "PageUp" ||
      e.key === "Home" ||
      e.key === "End" ||
      e.key === " "
    ) {
      e.preventDefault();
    }
  };
  window.addEventListener("keydown", onKeydown, true);

  // Prevent wheel/touch scrolling while the overlay is active.
  // Programmatic scroll (scrollIntoView) still works.
  const stopScroll = (e) => {
    // Allow scroll inside the demo bubble if it overflows.
    if (e.target?.closest?.(".autopilot-bubble")) return;
    e.preventDefault();
  };
  overlay.addEventListener("wheel", stopScroll, { passive: false });
  overlay.addEventListener("touchmove", stopScroll, { passive: false });

  function setProgress(step, total) {
    if (!progressEl) return;
    progressEl.textContent = `Step ${step} / ${total}`;
  }

  function setBadge(text) {
    if (!badgeEl) return;
    badgeEl.textContent = text || "Autopilot demo";
  }

  function hideSpotlight() {
    spotlight?.classList.add("autopilot-spotlight--hidden");
  }

  function showSpotlightForRect(rect, { radius } = {}) {
    if (!spotlight || !rect) return;
    spotlight.classList.remove("autopilot-spotlight--hidden");

    const margin = 8;
    const pad = 10;
    let width = rect.width + pad * 2;
    let height = rect.height + pad * 2;

    // Ensure width/height fit the viewport. Then clamp left/top against those.
    width = clamp(width, 32, window.innerWidth - margin * 2);
    height = clamp(height, 26, window.innerHeight - margin * 2);

    let left = rect.left - pad;
    let top = rect.top - pad;
    left = clamp(left, margin, window.innerWidth - margin - width);
    top = clamp(top, margin, window.innerHeight - margin - height);

    spotlight.style.left = `${left}px`;
    spotlight.style.top = `${top}px`;
    spotlight.style.width = `${width}px`;
    spotlight.style.height = `${height}px`;

    if (radius) {
      spotlight.style.borderRadius = String(radius);
    } else {
      spotlight.style.borderRadius = "18px";
    }
  }

  function hideMenu() {
    menu?.classList.add("autopilot-menu--hidden");
    if (menu) menu.innerHTML = "";
  }

  function showMenuForRect(rect, { title = "", items = [], activeIndex = -1 } = {}) {
    if (!menu || !rect) return;
    const safeItems = Array.isArray(items) ? items : [];
    menu.innerHTML = `
      <div class="autopilot-menu__title">${title}</div>
      <div class="autopilot-menu__items">
        ${safeItems
          .map((it, i) => {
            const label = typeof it === "string" ? it : String(it?.label ?? "");
            const meta = typeof it === "string" ? "" : String(it?.meta ?? "");
            return `
              <div class="autopilot-menu__item ${i === activeIndex ? "autopilot-menu__item--active" : ""}">
                <div>${label}</div>
                ${meta ? `<div class="autopilot-menu__meta">${meta}</div>` : ""}
              </div>
            `;
          })
          .join("")}
      </div>
    `;

    menu.classList.remove("autopilot-menu--hidden");

    const margin = 8;
    const mr = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = rect.left;
    let top = rect.bottom + 8;

    // Keep inside viewport
    left = clamp(left, margin, vw - mr.width - margin);
    if (top + mr.height > vh - margin) {
      top = rect.top - mr.height - 8;
    }
    top = clamp(top, margin, vh - mr.height - margin);

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function setCopy({ title, text }) {
    if (titleEl) titleEl.textContent = title || "";
    if (textEl) textEl.innerHTML = text || "";
  }

  function positionBubbleNearRect(rect) {
    if (!bubble) return;
    const margin = 14;
    // Reset to allow measuring size.
    bubble.style.left = "0px";
    bubble.style.top = "0px";

    const br = bubble.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (!rect) {
      const left = clamp(Math.round((vw - br.width) / 2), margin, vw - br.width - margin);
      const top = clamp(Math.round(vh * 0.16), margin, vh - br.height - margin);
      bubble.style.left = `${left}px`;
      bubble.style.top = `${top}px`;
      return;
    }

    let left = rect.right + margin;
    let top = rect.top;

    // Prefer right side
    if (left + br.width > vw - margin) {
      left = rect.left - br.width - margin;
    }

    // Fallback: align under
    if (left < margin) {
      left = clamp(rect.left, margin, vw - br.width - margin);
      top = rect.bottom + margin;
    }

    // Clamp vertically
    top = clamp(top, margin, vh - br.height - margin);

    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
  }

  function destroy() {
    window.removeEventListener("keydown", onKeydown, true);
    overlay.removeEventListener("wheel", stopScroll);
    overlay.removeEventListener("touchmove", stopScroll);
    overlay.remove();
  }

  return {
    setBadge,
    setProgress,
    setCopy,
    hideSpotlight,
    showSpotlightForRect,
    positionBubbleNearRect,
    hideMenu,
    showMenuForRect,
    destroy,
  };
}

function createStepGate() {
  // A tiny “presentation clicker” gate.
  // Each call to wait() pauses until signal() is called.
  // If the user clicks Next early, the next wait resolves immediately.
  let resolver = null;
  let queued = false;

  function signal() {
    if (resolver) {
      const r = resolver;
      resolver = null;
      r(true);
      return;
    }
    queued = true;
  }

  function wait({ signal: abortSignal } = {}) {
    if (queued) {
      queued = false;
      return Promise.resolve(true);
    }
    if (abortSignal?.aborted) return Promise.resolve(false);

    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        resolver = null;
        resolve(!!ok);
      };

      resolver = finish;

      if (abortSignal) {
        abortSignal.addEventListener(
          "abort",
          () => {
            finish(false);
          },
          { once: true }
        );
      }
    });
  }

  return { signal, wait };
}

async function waitForSelector(sel, { timeoutMs = 12000, pollMs = 50, signal }) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (signal?.aborted) return null;
    const el = queryVisible(sel);
    if (el) return el;
    await _sleep(pollMs);
  }
  return null;
}

async function waitForCondition(checkFn, { timeoutMs = 12000, pollMs = 80, signal } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (signal?.aborted) return false;
    try {
      if (checkFn()) return true;
    } catch (_) {
      // ignore
    }
    await _sleep(pollMs);
  }
  return false;
}

async function waitForEvent(name, { timeoutMs = 12000, signal, predicate } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const timer = window.setTimeout(() => {
      if (done) return;
      done = true;
      window.removeEventListener(name, onEvent);
      resolve(null);
    }, timeoutMs);

    function cleanup(payload) {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      window.removeEventListener(name, onEvent);
      resolve(payload ?? null);
    }

    function onEvent(e) {
      try {
        if (predicate && !predicate(e)) return;
        cleanup(e);
      } catch (_) {
        cleanup(e);
      }
    }

    if (signal?.aborted) {
      cleanup(null);
      return;
    }

    window.addEventListener(name, onEvent);

    if (signal) {
      const onAbort = () => cleanup(null);
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

async function typeInto(el, value, { signal, delayMs = 28 } = {}) {
  if (!el) return;
  const str = String(value);
  try {
    el.focus?.();
  } catch (_) {
    // ignore
  }

  // Clear
  el.value = "";
  el.dispatchEvent(new Event("input", { bubbles: true }));

  for (let i = 0; i < str.length; i++) {
    if (signal?.aborted) return;
    el.value = str.slice(0, i + 1);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await _sleep(delayMs);
  }
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

async function runAutopilot(ctx, { flow = "full" } = {}) {
  if (_isAutopilotRunning()) return;

  // Mark “seen” so the welcome prompt doesn't keep appearing.
  setAutopilotSeen(true);
  setWelcomeDismissed(true);
  syncDemoToggle();

  // Keep the checklist panel visible during demos.
  if (!demoEnabled()) {
    setDemoEnabled(true);
    syncDemoToggle();
    renderDemoPanel(window.__ux_ctx);
  }

  const aborter = new AbortController();
  const autoState = {
    running: true,
    stop: (reason = "") => {
      aborter.abort();
      autoState.running = false;
      if (reason) toast("Demo ended", "info", 2000);
    },
  };

  const gate = createStepGate();

  const overlay = createAutopilotOverlay({
    onStop: () => autoState.stop("user"),
    onNext: () => gate.signal(),
  });

  AUTOPILOT = autoState;

  // ------------------------
  // Flow definitions
  // ------------------------

  const FLOW = {
    full: {
      badge: "Autopilot demo",
      intro: "I’ll run an end‑to‑end walkthrough: <b>Barrier pricing (Monte Carlo)</b> → <b>Strategy recommendations</b> → <b>Exportable report</b>.<div class='muted' style='margin-top:8px;'>Click <b>Next</b> (→) to advance at your own pace.</div>",
      steps: ["pricer", "strategy", "runs"],
    },
    pricer: {
      badge: "Pricer demo",
      intro: "Let’s price a <b>Barrier option</b> with a <b>Monte Carlo</b> engine and show the full parameter flow.<div class='muted' style='margin-top:8px;'>Click <b>Next</b> (→) to advance.</div>",
      steps: ["pricer"],
    },
    strategy: {
      badge: "Strategy demo",
      intro: "Let’s encode a view and generate <b>ranked strategy candidates</b>, then run a quick scenario analysis.<div class='muted' style='margin-top:8px;'>Click <b>Next</b> (→) to advance.</div>",
      steps: ["strategy"],
    },
    portfolio: {
      badge: "Portfolio demo",
      intro: "Let’s build a small multi‑leg portfolio and compute the aggregated results.<div class='muted' style='margin-top:8px;'>Click <b>Next</b> (→) to advance.</div>",
      steps: ["portfolio"],
    },
    macro: {
      badge: "Macro demo",
      intro: "Let’s apply a stress pack and compute a macro scenario grid.<div class='muted' style='margin-top:8px;'>Click <b>Next</b> (→) to advance.</div>",
      steps: ["macro"],
    },
    capbud: {
      badge: "Capital budgeting demo",
      intro: "Let’s evaluate a project: cashflows → <b>NPV/IRR/MIRR</b> → sensitivity and NPV profile.<div class='muted' style='margin-top:8px;'>Click <b>Next</b> (→) to advance.</div>",
      steps: ["capbud"],
    },
    runs: {
      badge: "Runs demo",
      intro: "Let’s open a saved run and export a PDF report.<div class='muted' style='margin-top:8px;'>Click <b>Next</b> (→) to advance.</div>",
      steps: ["runs"],
    },
  };

  const plan = FLOW[flow] || FLOW.full;
  overlay.setBadge(plan.badge || "Autopilot demo");

  const total = (plan.steps?.length || 0) + 2; // intro + steps + outro
  let step = 0;

  async function tinyDelay(ms = 140) {
    if (aborter.signal.aborted) return false;
    await _sleep(ms);
    return true;
  }

  async function waitNext() {
    if (aborter.signal.aborted) return false;
    return gate.wait({ signal: aborter.signal });
  }

  async function waitNextOrTimeout(timeoutMs = 2600) {
    // Used for the final step so the demo auto-dismisses even if the user
    // doesn't click Next again.
    if (aborter.signal.aborted) return false;
    const TIMEOUT = Symbol("timeout");
    const result = await Promise.race([waitNext(), _sleep(timeoutMs).then(() => TIMEOUT)]);
    if (result === TIMEOUT) {
      // Best-effort cleanup: if a gate wait is pending, resolve it.
      gate.signal();
      return false;
    }
    return result;
  }

  async function focus(sel, { title, text } = {}) {
    if (aborter.signal.aborted) return null;

    const el = typeof sel === "string" ? await waitForSelector(sel, { signal: aborter.signal }) : sel;
    if (!el) return null;

    const hl = pickHighlightTarget(el) || el;

    try {
      hl.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
    } catch (_) {
      // ignore
    }

    // Try to keep keyboard focus aligned with the highlighted control.
    try {
      el.focus?.({ preventScroll: true });
    } catch (_) {
      // ignore
    }

    const rect = await waitForStableRect(hl, { signal: aborter.signal, timeoutMs: 1800, settleFrames: 5 });
    if (aborter.signal.aborted) return null;

    const cs = window.getComputedStyle(hl);
    const radius = cs?.borderRadius ? bumpRadius(cs.borderRadius, 10) : "18px";

    overlay.setCopy({ title: title || "", text: text || "" });
    overlay.hideMenu();
    overlay.showSpotlightForRect(rect, { radius });
    overlay.positionBubbleNearRect(rect);

    await tinyDelay(120);
    return el;
  }

  async function message({ title, text }) {
    overlay.setCopy({ title, text });
    overlay.hideSpotlight();
    overlay.hideMenu();
    overlay.positionBubbleNearRect(null);
    await tinyDelay(160);
  }

  async function safeStep(label, fn) {
    if (aborter.signal.aborted) return;
    try {
      await fn();
    } catch (_) {
      overlay.setCopy({ title: label, text: "Skipped (not available in this environment)." });
      overlay.hideSpotlight();
      overlay.hideMenu();
      overlay.positionBubbleNearRect(null);
      await waitNext();
    }
  }

  // ------------------------
  // Small helpers for reliable UI manipulation
  // ------------------------

  function setSelectValue(el, value) {
    if (!el) return;
    el.value = String(value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setCheckbox(el, checked) {
    if (!el) return;
    el.checked = !!checked;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function setInputValue(el, value, { delayMs = 12 } = {}) {
    if (!el) return;
    // Use the existing type helper for visible “autopilot typing”.
    await typeInto(el, String(value), { signal: aborter.signal, delayMs });
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function showSelectOptions(el, { title, activeValue } = {}) {
    if (!el) return;
    const rect = await waitForStableRect(el, { signal: aborter.signal, timeoutMs: 900, settleFrames: 2 });
    if (!rect) return;
    const opts = Array.from(el.options || []).map((o) => ({
      label: (o.textContent || "").trim(),
      meta: (o.value || "").trim(),
      value: o.value,
    }));
    const activeIndex = Math.max(
      0,
      opts.findIndex((o) => o.value === activeValue)
    );
    overlay.showMenuForRect(rect, {
      title: title || "Options",
      items: opts,
      activeIndex,
    });
  }

  function expandSelectList(el, { maxRows = 10 } = {}) {
    if (!el) return () => {};
    if (String(el.tagName || "").toUpperCase() !== "SELECT") return () => {};
    const prev = el.getAttribute("size");
    const count = Math.max(1, (el.options || []).length);
    const rows = Math.min(count, Math.max(2, Number(maxRows) || 10));
    el.setAttribute("size", String(rows));
    el.classList.add("demo-select-expanded");
    return () => {
      try {
        el.classList.remove("demo-select-expanded");
        if (prev === null) el.removeAttribute("size");
        else el.setAttribute("size", prev);
      } catch (_) {
        // ignore
      }
    };
  }

  async function updateSpotlight(el) {
    if (!el || aborter.signal.aborted) return;
    const hl = pickHighlightTarget(el) || el;
    const rect = await waitForStableRect(hl, { signal: aborter.signal, timeoutMs: 900, settleFrames: 3 });
    if (!rect || aborter.signal.aborted) return;
    const cs = window.getComputedStyle(hl);
    const radius = cs?.borderRadius ? bumpRadius(cs.borderRadius, 10) : "18px";
    overlay.showSpotlightForRect(rect, { radius });
    overlay.positionBubbleNearRect(rect);
    await tinyDelay(80);
  }


  // ------------------------
  // Step implementations
  // ------------------------

  async function stepPricerBarrierMc() {
    ctx.go("/pricer");
    await waitForSelector("#pricerForm", { signal: aborter.signal, timeoutMs: 12000 });

    // --- Instrument dropdown ---
    const instSel = await focus("#instSel", {
      title: "Pricing instruments",
      text:
        "We start in the <b>Pricer</b>. This dropdown is driven by a shared <b>instrument catalog</b> (UI + API).<div class='muted' style='margin-top:8px;'>Click <b>Next</b> (→) and I’ll pick <b>Barrier (knock-out)</b>.</div>",
    });
    if (!instSel) return;

    // Show the available options reliably (native <select> dropdowns can't be programmatically opened).
    await showSelectOptions(instSel, { title: "Instrument options", activeValue: instSel.value });
    await waitNext();
    overlay.hideMenu();

    // Select Barrier
    setSelectValue(instSel, "barrier");

    // After changing instrument, the form re-renders.
    await waitForCondition(() => document.getElementById("instSel")?.value === "barrier", {
      signal: aborter.signal,
      timeoutMs: 9000,
    });

    // --- Barrier style ---
    const barrierDir = await focus("#p_barrier_direction", {
      title: "Barrier type",
      text:
        "Barrier instruments add a few specific parameters. Click <b>Next</b> to preview the barrier styles (Up‑and‑out / Down‑and‑out).",
    });
    if (barrierDir) {
      await showSelectOptions(barrierDir, { title: "Barrier styles", activeValue: barrierDir.value });
      await waitNext();
      overlay.hideMenu();
      // Keep the current selection (default is fine), but trigger change for clarity.
      setSelectValue(barrierDir, barrierDir.value || "up");
      await tinyDelay(180);
    }

    // --- Method dropdown ---
    const methodSel = await focus("#methodSel", {
      title: "Pricing engine",
      text:
        "Now choose the pricing method. For barriers, the most robust approach here is <b>Monte Carlo</b>. Click <b>Next</b> and I’ll select <b>Brownian‑bridge MC</b> to reduce discrete barrier miss bias.",
    });
    if (!methodSel) return;

    await showSelectOptions(methodSel, { title: "Methods", activeValue: methodSel.value });
    await waitNext();
    overlay.hideMenu();

    const preferredMethod = methodSel.querySelector('option[value="mc_bridge"]') ? "mc_bridge" : methodSel.value;
    setSelectValue(methodSel, preferredMethod);

    await waitForCondition(() => document.getElementById("methodSel")?.value === preferredMethod, {
      signal: aborter.signal,
      timeoutMs: 9000,
    });

    // --- Inputs (each step waits for user 'Next') ---
    const volEl = await focus("#mkt_vol", {
      title: "Market snapshot",
      text: "Market inputs are shared. Click <b>Next</b> and I’ll set <span class='mono'>σ = 0.22</span>.",
    });
    if (volEl) {
      await waitNext();
      await setInputValue(volEl, "0.22", { delayMs: 10 });
      await tinyDelay(220);
    }

    const barrierLevel = await focus("#p_barrier_level", {
      title: "Barrier level",
      text: "Click <b>Next</b> and I’ll set <span class='mono'>Barrier = 120</span>.",
    });
    if (barrierLevel) {
      await waitNext();
      await setInputValue(barrierLevel, "120", { delayMs: 12 });
      await tinyDelay(220);
    }

    const pathsEl = await focus("#p_paths", {
      title: "Monte Carlo precision",
      text:
        "Paths controls accuracy vs speed. Click <b>Next</b> and I’ll use <span class='mono'>10000</span> so the demo stays snappy.",
    });
    if (pathsEl) {
      await waitNext();
      await setInputValue(pathsEl, "10000", { delayMs: 10 });
      await tinyDelay(220);
    }

    const stepsEl = await focus("#p_steps", {
      title: "Time discretization",
      text:
        "Steps controls monitoring frequency. Click <b>Next</b> and I’ll set <span class='mono'>96</span> steps.",
    });
    if (stepsEl) {
      await waitNext();
      await setInputValue(stepsEl, "96", { delayMs: 10 });
      await tinyDelay(220);
    }

    // --- Compute ---
    const runBtn = await focus("#runBtn", {
      title: "Compute price",
      text:
        "Ready? Click <b>Next</b> and I’ll run the pricing engine. This run is <b>auto‑saved</b>, so you can inspect or export it later in <b>Runs</b>.",
    });
    if (!runBtn) return;

    await waitNext();
    runBtn.click();

    await waitForEvent("pricer:computed", { timeoutMs: 25000, signal: aborter.signal });

    await focus("#pricerOutput", {
      title: "Results",
      text:
        "You get a clean output box: <b>price</b> and key <b>Greeks</b>. Next we’ll switch to <b>Strategy Builder</b> to propose a structure.",
    });
    await waitNext();
  }

  async function stepStrategyRecommend() {
    ctx.go("/strategy");
    await waitForSelector("#sbFind", { signal: aborter.signal, timeoutMs: 12000 });

    // --- Direction ---
    const dirSel = await focus("#sbDir", {
      title: "Strategy builder",
      text:
        "Next: <b>Strategy</b>. We encode a market view and the app generates <b>ranked candidate structures</b>.<div class='muted' style='margin-top:8px;'>Click <b>Next</b> (→) and I’ll set the view to <b>Bearish</b>.</div>",
    });
    if (!dirSel) return;

    await showSelectOptions(dirSel, { title: "Direction", activeValue: dirSel.value });
    await waitNext();
    overlay.hideMenu();
    setSelectValue(dirSel, "bearish");
    await tinyDelay(200);

    // --- Horizon ---
    const horizonEl = await focus("#sbHorizon", {
      title: "Horizon",
      text: "Horizon (days) sets the decision window. Click <b>Next</b> and I’ll use <span class='mono'>21</span>.",
    });
    if (horizonEl) {
      await waitNext();
      await setInputValue(horizonEl, "21", { delayMs: 12 });
      await tinyDelay(180);
    }

    // --- Move input mode ---
    const moveModeEl = await focus("#sbMoveMode", {
      title: "Move input",
      text:
        "You can specify a <b>% move</b> or a <b>target price</b>. Click <b>Next</b> to preview options (we’ll keep % move for the demo).",
    });
    if (moveModeEl) {
      await showSelectOptions(moveModeEl, { title: "Move mode", activeValue: moveModeEl.value });
      await waitNext();
      overlay.hideMenu();
      setSelectValue(moveModeEl, "pct");
      await tinyDelay(180);
    }

    // The panel may re-render after changing move mode; wait for the input to exist.
    await waitForSelector("#sbMove", { signal: aborter.signal, timeoutMs: 8000 });

    const moveEl = await focus("#sbMove", {
      title: "Expected move",
      text: "Click <b>Next</b> and I’ll set an expected move of <span class='mono'>4%</span>.",
    });
    if (moveEl) {
      await waitNext();
      await setInputValue(moveEl, "4", { delayMs: 12 });
      await tinyDelay(180);
    }

    // --- Constraints ---
    const maxLossEl = await focus("#sbMaxLoss", {
      title: "Constraints",
      text:
        "Now guardrails. Click <b>Next</b> and I’ll cap max loss at <span class='mono'>2.0</span> and require <b>defined-risk</b> structures.",
    });
    if (maxLossEl) {
      await waitNext();
      await setInputValue(maxLossEl, "2.0", { delayMs: 12 });
      const defRiskEl = document.getElementById("sbDefRisk");
      if (defRiskEl) setCheckbox(defRiskEl, true);
      await tinyDelay(180);
    }

    // --- Find candidates ---
    const findBtn = await focus("#sbFind", {
      title: "Find the best strategy",
      text:
        "Click <b>Next</b> and I’ll generate + rank candidates using the view + constraints. Watch the <b>Candidates</b> tab populate.",
    });
    if (!findBtn) return;

    await waitNext();
    findBtn.click();

    await waitForEvent("strategy:computed", {
      timeoutMs: 25000,
      signal: aborter.signal,
      predicate: (e) => e?.detail?.kind === "recommend",
    });

    const topCard = await waitForSelector("#sbPanelCandidates .card.card--tight", { signal: aborter.signal, timeoutMs: 12000 });
    if (topCard) {
      await focus(topCard, {
        title: "Top-ranked candidate",
        text:
          "This is the #1 candidate for the view. You get premium, breakevens, max profit/loss, legs, plus a rationale (why it was suggested).",
      });
      await waitNext();
    }

    const analyzeBtn = queryVisible('#sbPanelCandidates button[data-act="analyze"]');
    if (!analyzeBtn) {
      await message({
        title: "Scenario analysis",
        text: "No candidates available to analyze right now — try a different view or loosen constraints.",
      });
      await waitNext();
      return;
    }

    await focus(analyzeBtn, {
      title: "Scenario analysis",
      text: "Click <b>Next</b> to compute payoff + horizon P&L and a <b>spot × vol</b> heatmap.",
    });
    await waitNext();
    analyzeBtn.click();

    await waitForEvent("strategy:computed", {
      timeoutMs: 30000,
      signal: aborter.signal,
      predicate: (e) => e?.detail?.kind === "analyze",
    });

    const heat = await waitForSelector("#sbHeatmap", { signal: aborter.signal, timeoutMs: 25000 });
    if (heat) {
      await focus(heat, {
        title: "Heatmap",
        text:
          "This heatmap visualizes sensitivity across spot + vol. It’s a fast way to communicate risk to non‑quants.",
      });
      await waitNext();
    }
  }

  async function stepPortfolio() {
    ctx.go("/portfolio");
    await waitForSelector("#addLeg", { signal: aborter.signal, timeoutMs: 12000 });

    const addBtn = await focus("#addLeg", {
      title: "Portfolio builder",
      text:
        "Build a multi‑leg portfolio, then compute aggregate price + Greeks. Click <b>Next</b> and I’ll add a sample leg.",
    });
    if (addBtn) {
      await waitNext();
      addBtn.click();
    }

    await waitForSelector(".leg-card", { signal: aborter.signal, timeoutMs: 8000 });

    const run = await focus("#runPortfolio", {
      title: "Compute portfolio",
      text: "Click <b>Next</b> to compute the portfolio and auto-save a run for later review.",
    });
    if (run) {
      await waitNext();
      run.click();
    }

    await waitForEvent("portfolio:computed", { timeoutMs: 20000, signal: aborter.signal });

    const out = await waitForSelector("#portfolioOutput", { signal: aborter.signal, timeoutMs: 12000 });
    if (out) {
      await focus(out, {
        title: "Portfolio results",
        text: "Aggregate results + per‑leg breakdown. Great for explaining structure composition.",
      });
      await waitNext();
    }
  }

  async function stepMacro() {
    ctx.go("/macro");
    await waitForSelector("#macroPacks", { signal: aborter.signal, timeoutMs: 12000 });

    const first = document.querySelector('#macroPacks input[type="checkbox"]');
    if (first) {
      await focus(first, {
        title: "Stress packs",
        text: "Stress packs let you apply a pre-baked macro shock. Click <b>Next</b> and I’ll apply one.",
      });
      await waitNext();
      first.click();
      await tinyDelay(240);
    }

    const runBtn = await focus("#macroRun", {
      title: "Run scenario",
      text: "Click <b>Next</b> to compute the scenario grid and save it as a Run.",
    });
    if (runBtn) {
      await waitNext();
      runBtn.click();
    }

    await waitForEvent("scenario:computed", { timeoutMs: 25000, signal: aborter.signal });

    const grid = await waitForSelector("#macroGrid", { signal: aborter.signal, timeoutMs: 12000 });
    if (grid) {
      await focus(grid, {
        title: "Scenario grid",
        text: "A compact grid view for quick stress‑testing and communication.",
      });
      await waitNext();
    }
  }

  async function stepCapBud() {
    ctx.go("/capbud");
    await waitForSelector("#capbudForm", { signal: aborter.signal, timeoutMs: 12000 });

    const sample = document.getElementById("cbLoadSample");
    if (sample) {
      await focus(sample, {
        title: "Capital budgeting",
        text: "We model a project as a cashflow series. Click <b>Next</b> and I’ll load a sample project.",
      });
      await waitNext();
      sample.click();
      await tinyDelay(250);
    }

    const dr = document.getElementById("cbDiscount");
    if (dr) {
      await focus(dr, {
        title: "Hurdle rate",
        text: "This is your WACC / hurdle rate. NPV is computed at this rate.",
      });
      await waitNext();
    }

    const cf = document.getElementById("cbCashflowTable");
    if (cf) {
      await focus(cf, {
        title: "Cashflow schedule",
        text: "Year 0 is the initial investment. Years 1..N are net inflows. You can edit cells or paste a list.",
      });
      await waitNext();
    }

    const compute = document.getElementById("cbCompute");
    if (compute) {
      await focus(compute, {
        title: "Compute",
        text: "Click <b>Next</b> and I’ll compute NPV/IRR and save a run automatically.",
      });
      await waitNext();
      compute.click();
      await waitForEvent("capbud:computed", { timeoutMs: 25000, signal: aborter.signal });
    }

    const kpis = document.getElementById("capbudKpis");
    if (kpis) {
      await focus(kpis, {
        title: "Key metrics",
        text: "NPV, IRR and MIRR summarise the project at a glance — great for quick screening.",
      });
      await waitNext();
    }

    const npvChart = document.getElementById("cbNpvChart");
    if (npvChart) {
      await focus(npvChart, {
        title: "NPV profile",
        text: "This curve shows how NPV changes as the discount rate changes. The zero-crossing corresponds to IRR.",
      });
      await waitNext();
    }

    const sens = document.getElementById("cbSensitivityCard");
    if (sens) {
      await focus(sens, {
        title: "Sensitivity",
        text: "A fast 2D sensitivity grid: discount rate shifts (columns) × cashflow scale (rows).",
      });
      await waitNext();
    }
  }

  async function stepRuns() {
    ctx.go("/runs");
    await waitForSelector("#runsTable", { signal: aborter.signal, timeoutMs: 12000 });

    const row = document.querySelector("#runsTable .trow--click");
    if (!row) {
      await message({
        title: "Runs",
        text: "No runs found yet — compute a price/strategy first, then come back here.",
      });
      await waitNext();
      return;
    }

    await focus(row, {
      title: "Runs (audit trail)",
      text: "Every compute can be persisted. Click <b>Next</b> and I’ll open a run to show the full inputs + outputs.",
    });
    await waitNext();
    row.click();

    await waitForSelector("#runDetail", { signal: aborter.signal, timeoutMs: 12000 });

    const pdf = document.querySelector('#runDetail button[data-act="pdf"]');
    if (pdf) {
      await focus(pdf, {
        title: "Export PDF report",
        text: "Click <b>Next</b> to generate a clean PDF summary (inputs + outputs). Perfect for sharing in interviews.",
      });
      await waitNext();
      pdf.click();
      await tinyDelay(300);
      await message({
        title: "PDF export",
        text: "A PDF download should start. This is a client-friendly artifact you can attach in emails or share during interviews.",
      });
      await waitNext();
    }
  }

  const STEP_BY_KEY = {
    pricer: stepPricerBarrierMc,
    strategy: stepStrategyRecommend,
    portfolio: stepPortfolio,
    macro: stepMacro,
    capbud: stepCapBud,
    runs: stepRuns,
  };

  const STEP_LABEL = {
    pricer: "Pricer",
    strategy: "Strategy builder",
    portfolio: "Portfolio builder",
    macro: "Macro scenarios",
    capbud: "Capital budgeting",
    runs: "Runs & report",
  };

  try {
    step += 1;
    overlay.setProgress(step, total);
    await message({
      title: plan.badge || "Autopilot demo",
      text: plan.intro || "I’ll drive the UI and point out key features. You can <b>Take control</b> anytime.",
    });
    await waitNext();

    for (const key of plan.steps || []) {
      if (aborter.signal.aborted) break;
      const fn = STEP_BY_KEY[key];
      if (!fn) continue;
      step += 1;
      overlay.setProgress(step, total);
      await safeStep(STEP_LABEL[key] || key, fn);
    }

    step += 1;
    overlay.setProgress(step, total);
    await message({
      title: "You’re in control",
      text: "Demo complete. Pro tips: press <span class='mono'>Ctrl + K</span> for the command palette, or use the <b>Demo</b> button to run focused mini‑demos anytime.",
    });
    await waitNextOrTimeout(3200);
  } finally {
    overlay.destroy();
    autoState.running = false;
    AUTOPILOT = null;
  }
}

function openDemoCenter(ctx) {
  const enabled = demoEnabled();

  const close = openModal({
    title: "Demo",
    className: "",
    bodyHtml: `
      <div class="stack">
        <div class="card card--tight" style="margin: 0;">
          <div class="card__header" style="padding-bottom: 8px;">
            <h3 style="margin:0;">Autopilot demo</h3>
            <p class="card__hint">The site drives itself: <b>Barrier pricing (Monte Carlo)</b> → <b>Strategy recommendations</b> → <b>Runs + PDF</b>.</p>
          </div>
          <div class="row" style="gap: 10px; flex-wrap: wrap;">
            <button class="btn btn--primary" id="demoStartAuto" type="button">Start autopilot</button>
            <button class="btn btn--ghost" id="demoTakeChecklist" type="button">Open checklist panel</button>
          </div>
          <div class="muted" style="margin-top:10px; font-size:12.5px;">Tip: click <b>Next</b> (→) to advance, or <b>Take control</b> anytime.</div>
        </div>

        <div class="card card--tight" style="margin: 0;">
          <div class="card__header" style="padding-bottom: 8px;">
            <h3 style="margin:0;">Mini demos</h3>
            <p class="card__hint">Short, focused walkthroughs (great for interviews).</p>
          </div>
          <div class="row" style="gap: 10px; flex-wrap: wrap;">
            <button class="btn" id="demoFlowPricer" type="button">Pricer</button>
            <button class="btn" id="demoFlowStrategy" type="button">Strategy</button>
            <button class="btn" id="demoFlowPortfolio" type="button">Portfolio</button>
            <button class="btn" id="demoFlowMacro" type="button">Macro</button>
            <button class="btn" id="demoFlowCapBud" type="button">Capital</button>
            <button class="btn" id="demoFlowRuns" type="button">Runs & PDF</button>
          </div>
          <div class="muted" style="margin-top:10px; font-size:12.5px;">Tip: you can run these from anywhere via the <b>Demo</b> button.</div>
        </div>

        <div class="card card--tight" style="margin: 0;">
          <div class="card__header" style="padding-bottom: 8px;">
            <h3 style="margin:0;">Checklist panel</h3>
            <p class="card__hint">A lightweight checklist that marks itself as you explore.</p>
          </div>
          <div class="row" style="gap: 10px; flex-wrap: wrap;">
            <button class="btn" id="demoToggleChecklist" type="button">${enabled ? "Turn off" : "Turn on"}</button>
            <button class="btn btn--ghost" id="demoResetChecklist" type="button">Reset checklist</button>
          </div>
        </div>

        <div class="card card--tight" style="margin: 0;">
          <div class="card__header" style="padding-bottom: 8px;">
            <h3 style="margin:0;">Shortcuts</h3>
            <p class="card__hint">Power navigation and quick actions.</p>
          </div>
          <div class="row" style="gap: 10px; flex-wrap: wrap;">
            <button class="btn btn--ghost" id="demoOpenPalette" type="button">Open palette (Ctrl/Cmd+K)</button>
            <button class="btn btn--ghost" id="demoShortcuts" type="button">Show shortcuts (?)</button>
          </div>
        </div>

        <div class="muted" style="font-size: 12.5px;">Hold <span class="mono">Alt</span> while clicking the Demo button to quickly toggle the checklist panel.</div>
      </div>
    `,
    onMount: (rootEl, doClose) => {
      rootEl.querySelector("#demoStartAuto")?.addEventListener("click", () => {
        doClose();
        runAutopilot(ctx, { flow: "full" });
      });

      rootEl.querySelector("#demoFlowPricer")?.addEventListener("click", () => {
        doClose();
        runAutopilot(ctx, { flow: "pricer" });
      });
      rootEl.querySelector("#demoFlowStrategy")?.addEventListener("click", () => {
        doClose();
        runAutopilot(ctx, { flow: "strategy" });
      });
      rootEl.querySelector("#demoFlowPortfolio")?.addEventListener("click", () => {
        doClose();
        runAutopilot(ctx, { flow: "portfolio" });
      });
      rootEl.querySelector("#demoFlowMacro")?.addEventListener("click", () => {
        doClose();
        runAutopilot(ctx, { flow: "macro" });
      });
      rootEl.querySelector("#demoFlowCapBud")?.addEventListener("click", () => {
        doClose();
        runAutopilot(ctx, { flow: "capbud" });
      });
      rootEl.querySelector("#demoFlowRuns")?.addEventListener("click", () => {
        doClose();
        runAutopilot(ctx, { flow: "runs" });
      });
      rootEl.querySelector("#demoTakeChecklist")?.addEventListener("click", () => {
        doClose();
        if (!demoEnabled()) {
          setDemoEnabled(true);
          syncDemoToggle();
          renderDemoPanel(window.__ux_ctx);
          toast("Checklist panel enabled", "info");
        }
      });
      rootEl.querySelector("#demoToggleChecklist")?.addEventListener("click", () => {
        setDemoEnabled(!demoEnabled());
        syncDemoToggle();
        renderDemoPanel(window.__ux_ctx);
        toast(demoEnabled() ? "Checklist panel enabled" : "Checklist panel disabled", "info");
        doClose();
      });
      rootEl.querySelector("#demoResetChecklist")?.addEventListener("click", () => {
        resetDemoTasks();
        toast("Checklist reset", "success");
        doClose();
      });
      rootEl.querySelector("#demoOpenPalette")?.addEventListener("click", () => {
        doClose();
        ctx.openPalette?.();
      });
      rootEl.querySelector("#demoShortcuts")?.addEventListener("click", () => {
        doClose();
        showShortcuts();
      });
    },
  });

  return close;
}

function maybeShowWelcome(ctx) {
  // Only show once per browser (and only for users who haven't run a demo).
  if (welcomeDismissed()) return;
  const seenAuto = !!loadJson(LS_AUTOPILOT_SEEN, false);
  if (seenAuto) return;

  window.setTimeout(() => {
    if (welcomeDismissed()) return;
    if (seenAuto) return;
    // Don't interrupt if an autopilot demo is already running.
    if (_isAutopilotRunning()) return;

    // Only nudge on the home page — let people land first.
    const path = window.location.pathname || "/";
    if (path !== "/") return;

    const existing = document.getElementById("welcomeNudge");
    if (existing) return;

    const nudge = document.createElement("div");
    nudge.id = "welcomeNudge";
    nudge.className = "welcome-nudge";
    nudge.innerHTML = `
      <div class="welcome-nudge__head">
        <div class="welcome-nudge__title">New here?</div>
        <button class="icon-btn icon-btn--small" id="welcomeNudgeClose" type="button" aria-label="Dismiss">✕</button>
      </div>
      <div class="welcome-nudge__text">
        Want a quick tour? Click <b>Demo</b> (top right) or start it here.
        <span class="muted">Barrier pricing → Strategy → PDF report.</span>
      </div>
      <div class="welcome-nudge__actions">
        <button class="btn btn--primary" id="welcomeNudgeStart" type="button">Start demo</button>
        <button class="btn btn--ghost" id="welcomeNudgeLater" type="button">Not now</button>
      </div>
    `;
    document.body.appendChild(nudge);

    const dismiss = () => {
      setWelcomeDismissed(true);
      syncDemoToggle();
      nudge.remove();
    };

    nudge.querySelector("#welcomeNudgeClose")?.addEventListener("click", dismiss);
    nudge.querySelector("#welcomeNudgeLater")?.addEventListener("click", dismiss);
    nudge.querySelector("#welcomeNudgeStart")?.addEventListener("click", () => {
      dismiss();
      runAutopilot(ctx, { flow: "full" });
    });
  }, 3200);
}

// ------------------------
// Public initializer
// ------------------------

export function initUX({ navigateTo, routes }) {
  const go = (path) => {
    if (!routes[path]) {
      navigateTo("/");
      return;
    }
    navigateTo(path);
  };

  const openProfiles = () => {
    const btn = document.getElementById("profileButton");
    if (btn) btn.click();
  };

  const toggleDemo = () => {
    setDemoEnabled(!demoEnabled());
    syncDemoToggle();
    renderDemoPanel(window.__ux_ctx);
    toast(demoEnabled() ? "Checklist panel enabled" : "Checklist panel disabled", "info");
  };

  const ctx = {
    go,
    toggleDemo,
    openProfiles,
    openPalette: () => openPalette(ctx),
    openDemoCenter: () => openDemoCenter(ctx),
    startAutopilot: (flow = "full") => runAutopilot(ctx, { flow }),
  };

  // Expose for internal re-render hooks (demo panel)
  window.__ux_ctx = ctx;

  // Buttons
  const demoBtn = document.getElementById("demoToggle");
  demoBtn?.addEventListener("click", (e) => {
    // Quick toggle with Alt-click
    if (e?.altKey) {
      toggleDemo();
      return;
    }

    // New visitors: one click immediately starts the autopilot demo.
    const seenAuto = !!loadJson(LS_AUTOPILOT_SEEN, false);
    if (!seenAuto) {
      ctx.startAutopilot?.();
      return;
    }

    openDemoCenter(ctx);
  });

  const palBtn = document.getElementById("paletteButton");
  palBtn?.addEventListener("click", () => openPalette(ctx));

  // Keyboard shortcuts
  window.addEventListener("keydown", (e) => {
    const active = document.activeElement;
    const isTyping = isTypingTarget(active);

    // Ctrl/Cmd + K
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openPalette(ctx);
      return;
    }

    // '?' for help (only when not typing)
    if (!isTyping && e.key === "?") {
      e.preventDefault();
      showShortcuts();
    }
  });

  // Demo mode events (tasks)
  window.addEventListener("profile:changed", () => markDemoTask("profile"));
  window.addEventListener("pricer:computed", () => markDemoTask("price"));
  window.addEventListener("stresspack:applied", () => markDemoTask("stresspack"));
  window.addEventListener("stresspack:compared", () => markDemoTask("compare"));
  window.addEventListener("macro:computed", () => markDemoTask("scenario"));
  window.addEventListener("scenario:computed", () => markDemoTask("scenario"));
  window.addEventListener("strategy:computed", () => markDemoTask("strategy"));
  window.addEventListener("capbud:computed", () => markDemoTask("capbud"));
  window.addEventListener("run:report", () => markDemoTask("report"));

  // Initial render
  syncDemoToggle();
  renderDemoPanel(ctx);

  // One-time welcome prompt for first-time visitors.
  maybeShowWelcome(ctx);
}
