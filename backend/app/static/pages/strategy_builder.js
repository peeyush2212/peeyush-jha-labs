import { fmt, toPct, getJson, postJson, mountHtml, showError, clearError, ensureMarketDefaults, toast, consumeDraft } from "./shared.js";

function fmtMoney(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  const v = Number(x);
  const s = Math.abs(v) >= 1000 ? fmt(v, 2) : fmt(v, 4);
  return s;
}

function fmtMaybeUnlimited(x) {
  if (x === null || x === undefined) return "Unlimited";
  return fmtMoney(x);
}

function parseNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseOptionalNum(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function setActiveTab(root, tabKey) {
  const tabs = Array.from(root.querySelectorAll(".tab"));
  tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === tabKey));
  const panels = Array.from(root.querySelectorAll("[data-panel]"));
  panels.forEach((p) => {
    p.hidden = p.dataset.panel !== tabKey;
  });
}

function drawLineChart(canvas, xs, ys, yLabel) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 640;
  const h = canvas.clientHeight || 280;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, w, h);

  if (!xs || !ys || xs.length < 2 || ys.length < 2) {
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.font = "12px ui-monospace";
    ctx.fillText("No data", 12, 24);
    return;
  }

  const pad = 26;
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const yRange = (yMax - yMin) || 1;

  const xTo = (x) => pad + ((x - xMin) / (xMax - xMin)) * (w - pad * 2);
  const yTo = (y) => (h - pad) - ((y - yMin) / yRange) * (h - pad * 2);

  // Axes
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, h - pad);
  ctx.lineTo(w - pad, h - pad);
  ctx.stroke();

  // Zero line
  if (yMin < 0 && yMax > 0) {
    const y0 = yTo(0);
    ctx.strokeStyle = "rgba(122, 168, 255, 0.25)";
    ctx.beginPath();
    ctx.moveTo(pad, y0);
    ctx.lineTo(w - pad, y0);
    ctx.stroke();
  }

  // Line
  ctx.strokeStyle = "rgba(255,255,255,0.80)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(xTo(xs[0]), yTo(ys[0]));
  for (let i = 1; i < xs.length; i++) {
    ctx.lineTo(xTo(xs[i]), yTo(ys[i]));
  }
  ctx.stroke();

  // Labels
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.font = "11px ui-monospace";
  ctx.fillText(`S: ${fmt(xMin, 4)} → ${fmt(xMax, 4)}`, pad, 16);
  const lbl = yLabel || "Value";
  ctx.fillText(`${lbl}: ${fmt(yMin, 4)} → ${fmt(yMax, 4)}`, pad + 180, 16);
}

function colorForValue(v, vMin, vMax) {
  // Map v to [-1, 1] and use a subtle red/blue scale.
  const denom = (vMax - vMin) || 1;
  const t = (v - vMin) / denom; // 0..1
  // Convert to signed where 0.5 is zero-ish.
  const s = (t - 0.5) * 2; // -1..1
  const mag = Math.min(1, Math.abs(s));
  // Use HSL-like rgba via two anchors.
  // Positive => green-ish, Negative => red-ish.
  if (s >= 0) {
    return `rgba(80, 200, 120, ${0.08 + 0.22 * mag})`;
  }
  return `rgba(255, 120, 120, ${0.08 + 0.22 * mag})`;
}

function renderHeatmap(heatmap) {
  if (!heatmap) {
    return `<div class="muted" style="font-size: 12.5px;">Run an analysis to generate a heatmap.</div>`;
  }

  const spot = heatmap.spot_shifts_pct || [];
  const vol = heatmap.vol_shifts || [];
  const grid = heatmap.grid_pnl || [];

  const all = [];
  for (let i = 0; i < grid.length; i++) {
    for (let j = 0; j < (grid[i] || []).length; j++) {
      all.push(grid[i][j]);
    }
  }
  const vMin = Math.min(...all);
  const vMax = Math.max(...all);

  const head = `<tr><th>Δvol</th>${spot.map((s) => `<th class="mono">${s}%</th>`).join("")}</tr>`;

  const focus = heatmap.focus_ij;

  const rows = vol
    .map((dv, i) => {
      const cells = (grid[i] || []).map((x, j) => {
        const bg = colorForValue(x, vMin, vMax);
        const cls = focus && focus[0] === j && focus[1] === i ? "heatcell-focus" : "";
        // Note: focus_ij in backend is (spot_index, vol_index)
        const isFocus = focus && focus[0] === j && focus[1] === i;
        const cls2 = isFocus ? "heatcell-focus" : "";
        return `<td class="mono ${cls2}" style="background:${bg}">${fmtMoney(x)}</td>`;
      }).join("");
      return `<tr><th class="mono">${dv}</th>${cells}</tr>`;
    })
    .join("");

  return `
    <div class="heatmap">
      <table>
        <thead>${head}</thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="muted" style="margin-top: 8px; font-size: 12px;">Values are <span class="mono">P&L vs initial premium</span> at the horizon under spot/vol shifts (rate shift = ${heatmap.rate_shift_bps ?? 0}bp).</div>
  `;
}

function renderScenarioPack(rows) {
  if (!rows || rows.length === 0) {
    return `<div class="muted" style="font-size: 12.5px;">No scenarios yet.</div>`;
  }

  const body = rows
    .map((r) => {
      return `
        <tr>
          <td>${r.label}</td>
          <td class="mono">${r.spot_shift_pct}%</td>
          <td class="mono">${fmt(r.vol_shift, 4)}</td>
          <td class="mono">${fmt(r.rate_shift_bps, 2)}</td>
          <td class="mono">${fmtMoney(r.total_value)}</td>
          <td class="mono">${fmtMoney(r.pnl_vs_initial)}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <table class="grid-table">
      <thead>
        <tr>
          <th>Scenario</th>
          <th>Spot</th>
          <th>Δvol</th>
          <th>Δr (bp)</th>
          <th>Total</th>
          <th>P&L vs initial</th>
        </tr>
      </thead>
      <tbody>
        ${body}
      </tbody>
    </table>
  `;
}

function exportJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function spaNavigate(url) {
  window.history.pushState({}, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export async function renderStrategyBuilder(viewEl) {
  mountHtml(
    viewEl,
    `
    <section class="split-right">
      <div>
        <div class="card">
          <div class="card__header">
            <h2>Strategy builder</h2>
            <div class="card__hint">Define a view (direction, move, horizon, vol) and constraints. The app will propose candidate structures and compute a scenario analysis for a selected candidate.</div>
          </div>

          <div class="tabs" id="sbTabs">
            <button class="tab active" data-tab="view">View</button>
            <button class="tab" data-tab="candidates">Candidates</button>
            <button class="tab" data-tab="scenarios">Scenarios</button>
            <button class="tab" data-tab="export">Export</button>
          </div>

          <div id="sbError" class="error-box" hidden></div>

          <div data-panel="view" id="sbPanelView"></div>
          <div data-panel="candidates" id="sbPanelCandidates" hidden></div>
          <div data-panel="scenarios" id="sbPanelScenarios" hidden></div>
          <div data-panel="export" id="sbPanelExport" hidden></div>
        </div>
      </div>

      <div class="sidebar-right">
        <div class="card card--tight" id="sbSummary"></div>
      </div>
    </section>
    `
  );

  const errEl = document.getElementById("sbError");
  const tabsRoot = document.getElementById("sbTabs");

  const panelView = document.getElementById("sbPanelView");
  const panelCandidates = document.getElementById("sbPanelCandidates");
  const panelScenarios = document.getElementById("sbPanelScenarios");
  const panelExport = document.getElementById("sbPanelExport");
  const summaryEl = document.getElementById("sbSummary");

  const state = {
    catalog: null,
    market: { spot: 100, rate: 0.03, dividend_yield: 0.0, vol: 0.20 },
    view: {
      direction: "bullish",
      move_mode: "pct",
      move_pct: 5,
      target_price: null,
      horizon_days: 30,
      vol_view: "flat",
      vol_shift: 0.0,
      confidence: "",
      event: false,
    },
    constraints: {
      max_loss: "",
      defined_risk_only: true,
      income_vs_convexity: 0.5,
      max_legs: 4,
      allow_multi_expiry: true,
    },
    generation: {
      expiry_days: 90,
      long_expiry_days: 120,
      strike_step: 1,
      width_pct: "",
      tree_steps: 200,
    },
    method: "black_scholes",
    lastRecommend: null,
    candidates: [],
    selected: null,
    analysis: null,
  };

const draft = consumeDraft("/strategy");
if (draft?.payload) {
  // Best-effort merge – ignore unknown fields to keep it robust.
  try {
    if (draft.payload.market) state.market = { ...state.market, ...draft.payload.market };
    if (draft.payload.view) state.view = { ...state.view, ...draft.payload.view };
    if (draft.payload.constraints) state.constraints = { ...state.constraints, ...draft.payload.constraints };
  } catch (_) {
    // ignore
  }
  toast("Draft loaded from Runs", "success");
}


  function renderSummary() {
    if (!summaryEl) return;
    const sel = state.selected;
    const a = state.analysis;

    const moveText = state.view.move_mode === "target"
      ? `Target ${fmtMoney(state.view.target_price)}`
      : `${state.view.move_pct}%`;

    summaryEl.innerHTML = `
      <div style="display:flex; align-items:center; justify-content: space-between; gap: 12px;">
        <div>
          <div class="muted" style="font-size: 12px;">Current view</div>
          <div style="font-size: 14px; font-weight: 600;">${state.view.direction} • ${moveText} • ${state.view.horizon_days}d</div>
        </div>
        <div class="pill">v${state.catalog ? state.catalog.ui_version : "—"}</div>
      </div>

      <div style="height: 10px;"></div>

      <div class="grid-2">
        <div>
          <div class="muted" style="font-size: 11px;">Spot</div>
          <div class="mono">${fmtMoney(state.market.spot)}</div>
        </div>
        <div>
          <div class="muted" style="font-size: 11px;">Vol</div>
          <div class="mono">${fmt(state.market.vol, 4)}</div>
        </div>
        <div>
          <div class="muted" style="font-size: 11px;">Rate</div>
          <div class="mono">${fmt(state.market.rate, 4)}</div>
        </div>
        <div>
          <div class="muted" style="font-size: 11px;">Div</div>
          <div class="mono">${fmt(state.market.dividend_yield, 4)}</div>
        </div>
      </div>

      <div style="height: 10px;"></div>

      <div class="muted" style="font-size: 12px;">Selection</div>
      ${sel ? `
        <div style="display:flex; align-items:center; justify-content: space-between; gap: 10px;">
          <div style="font-weight: 600;">${sel.name}</div>
          <div class="pill">Score ${sel.fit_score}</div>
        </div>
        <div class="muted" style="margin-top: 6px; font-size: 12px;">${sel.rationale}</div>
        <div style="margin-top: 10px;" class="grid-2">
          <div>
            <div class="muted" style="font-size: 11px;">Premium</div>
            <div class="mono">${fmtMoney(sel.net_premium)}</div>
          </div>
          <div>
            <div class="muted" style="font-size: 11px;">Max loss</div>
            <div class="mono">${fmtMaybeUnlimited(sel.max_loss)}</div>
          </div>
        </div>
      ` : `<div class="muted" style="font-size: 12.5px;">No strategy selected yet.</div>`}

      ${a ? `
        <div style="height: 12px;"></div>
        <div class="muted" style="font-size: 12px;">Analysis</div>
        <div class="grid-2" style="margin-top: 8px;">
          <div>
            <div class="muted" style="font-size: 11px;">Base total</div>
            <div class="mono">${fmtMoney(a.base_total)}</div>
          </div>
          <div>
            <div class="muted" style="font-size: 11px;">Δ</div>
            <div class="mono">${fmt(a.total_greeks.delta, 4)}</div>
          </div>
          <div>
            <div class="muted" style="font-size: 11px;">ν</div>
            <div class="mono">${fmt(a.total_greeks.vega, 4)}</div>
          </div>
          <div>
            <div class="muted" style="font-size: 11px;">θ</div>
            <div class="mono">${fmt(a.total_greeks.theta, 4)}</div>
          </div>
        </div>
      ` : ""}
    `;
  }

  function renderViewPanel() {
    if (!panelView) return;

    const methodNote = (() => {
      try {
        const inst = (state.catalog.instruments || []).find((x) => x.key === "vanilla");
        if (!inst) return "";
        const m = (inst.methods || []).find((x) => x.key === state.method);
        return (m && m.note) ? String(m.note) : "";
      } catch {
        return "";
      }
    })();

    panelView.innerHTML = `
      <div class="grid-2">
        <div class="card card--tight">
          <div style="display:flex; align-items:center; justify-content: space-between; gap: 8px;">
            <div style="font-weight: 600;">Market inputs</div>
            <div class="muted" style="font-size: 12px;">Model-based (no external data).</div>
          </div>
          <div class="grid-2" style="margin-top: 12px;">
            <div class="field"><label>Spot</label><input id="sbSpot" type="number" step="any" value="${state.market.spot}" /></div>
            <div class="field"><label>Vol (σ)</label><input id="sbVol" type="number" step="any" value="${state.market.vol}" /></div>
            <div class="field"><label>Rate (r)</label><input id="sbRate" type="number" step="any" value="${state.market.rate}" /></div>
            <div class="field"><label>Dividend (q)</label><input id="sbDiv" type="number" step="any" value="${state.market.dividend_yield}" /></div>
          </div>
        </div>

        <div class="card card--tight">
          <div style="display:flex; align-items:center; justify-content: space-between; gap: 8px;">
            <div style="font-weight: 600;">View</div>
            <div class="muted" style="font-size: 12px;">Direction, move, horizon, vol.</div>
          </div>

          <div class="grid-2" style="margin-top: 12px;">
            <div class="field">
              <label>Direction</label>
              <select id="sbDir">
                <option value="bullish" ${state.view.direction === "bullish" ? "selected" : ""}>Bullish</option>
                <option value="bearish" ${state.view.direction === "bearish" ? "selected" : ""}>Bearish</option>
                <option value="neutral" ${state.view.direction === "neutral" ? "selected" : ""}>Neutral</option>
              </select>
            </div>

            <div class="field">
              <label>Horizon (days)</label>
              <input id="sbHorizon" type="number" min="1" step="1" value="${state.view.horizon_days}" />
            </div>

            <div class="field">
              <label>Move input</label>
              <select id="sbMoveMode">
                <option value="pct" ${state.view.move_mode === "pct" ? "selected" : ""}>% move</option>
                <option value="target" ${state.view.move_mode === "target" ? "selected" : ""}>Target price</option>
              </select>
            </div>

            <div class="field">
              <label id="sbMoveLabel">${state.view.move_mode === "target" ? "Target price" : "Move (%)"}</label>
              <input id="sbMove" type="number" step="any" value="${state.view.move_mode === "target" ? (state.view.target_price ?? "") : state.view.move_pct}" />
            </div>

            <div class="field">
              <label>IV view</label>
              <select id="sbVolView">
                <option value="flat" ${state.view.vol_view === "flat" ? "selected" : ""}>Flat</option>
                <option value="up" ${state.view.vol_view === "up" ? "selected" : ""}>Up</option>
                <option value="down" ${state.view.vol_view === "down" ? "selected" : ""}>Down</option>
              </select>
            </div>

            <div class="field">
              <label>IV shift (abs)</label>
              <input id="sbVolShift" type="number" step="any" min="0" value="${state.view.vol_shift}" />
            </div>
          </div>

          <div class="grid-2" style="margin-top: 10px;">
            <div class="field">
              <label>Confidence (optional)</label>
              <select id="sbConf">
                <option value="" ${state.view.confidence === "" ? "selected" : ""}>—</option>
                <option value="low" ${state.view.confidence === "low" ? "selected" : ""}>Low</option>
                <option value="medium" ${state.view.confidence === "medium" ? "selected" : ""}>Medium</option>
                <option value="high" ${state.view.confidence === "high" ? "selected" : ""}>High</option>
              </select>
            </div>
            <div class="field" style="display:flex; align-items:center; gap: 8px; padding-top: 26px;">
              <input id="sbEvent" type="checkbox" ${state.view.event ? "checked" : ""} />
              <label for="sbEvent" style="margin:0;">Event / binary feel</label>
            </div>
          </div>
        </div>
      </div>

      <div style="height: 14px;"></div>

      <div class="grid-2">
        <div class="card card--tight">
          <div style="display:flex; align-items:center; justify-content: space-between; gap: 8px;">
            <div style="font-weight: 600;">Constraints</div>
            <div class="muted" style="font-size: 12px;">Used to filter and rank candidates.</div>
          </div>

          <div class="grid-2" style="margin-top: 12px;">
            <div class="field">
              <label>Max loss (optional)</label>
              <input id="sbMaxLoss" type="number" step="any" value="${state.constraints.max_loss}" placeholder="e.g. 2.5" />
            </div>
            <div class="field">
              <label>Max legs</label>
              <select id="sbMaxLegs">
                <option value="2" ${state.constraints.max_legs === 2 ? "selected" : ""}>2</option>
                <option value="3" ${state.constraints.max_legs === 3 ? "selected" : ""}>3</option>
                <option value="4" ${state.constraints.max_legs === 4 ? "selected" : ""}>4</option>
              </select>
            </div>
          </div>

          <div style="margin-top: 10px; display:flex; align-items:center; gap: 10px;">
            <input id="sbDefRisk" type="checkbox" ${state.constraints.defined_risk_only ? "checked" : ""} />
            <label for="sbDefRisk" style="margin:0;">Defined-risk only</label>
          </div>

          <div style="margin-top: 10px; display:flex; align-items:center; gap: 10px;">
            <input id="sbMulti" type="checkbox" ${state.constraints.allow_multi_expiry ? "checked" : ""} />
            <label for="sbMulti" style="margin:0;">Allow multi-expiry candidates</label>
          </div>

          <div style="margin-top: 14px;">
            <div style="display:flex; align-items:center; justify-content: space-between;">
              <label style="margin:0;">Income ↔ Convexity</label>
              <div class="mono">${fmt(state.constraints.income_vs_convexity, 2)}</div>
            </div>
            <input id="sbPref" class="range" type="range" min="0" max="1" step="0.01" value="${state.constraints.income_vs_convexity}" />
            <div class="range-value">0 = premium / credit bias • 1 = convexity (gamma/vega) bias</div>
          </div>
        </div>

        <div class="card card--tight">
          <div style="display:flex; align-items:center; justify-content: space-between; gap: 8px;">
            <div style="font-weight: 600;">Construction + pricing</div>
            <div class="muted" style="font-size: 12px;">Strikes, expiries, engine.</div>
          </div>

          <div class="grid-2" style="margin-top: 12px;">
            <div class="field">
              <label>Method <span class="info" data-tooltip="${(methodNote || "").replaceAll('"', '&quot;')}">i</span></label>
              <select id="sbMethod">
                <option value="black_scholes" ${state.method === "black_scholes" ? "selected" : ""}>Closed-form</option>
                <option value="binomial_crr" ${state.method === "binomial_crr" ? "selected" : ""}>Tree (CRR)</option>
              </select>
            </div>

            <div class="field">
              <label>Strike step</label>
              <input id="sbStrikeStep" type="number" step="any" min="0.0001" value="${state.generation.strike_step}" />
            </div>

            <div class="field">
              <label>Expiry (days)</label>
              <input id="sbExp" type="number" min="1" step="1" value="${state.generation.expiry_days}" />
            </div>

            <div class="field">
              <label>Long expiry (days)</label>
              <input id="sbExpLong" type="number" min="1" step="1" value="${state.generation.long_expiry_days}" ${state.constraints.allow_multi_expiry ? "" : "disabled"} />
            </div>

            <div class="field">
              <label>Width override (% optional)</label>
              <input id="sbWidth" type="number" step="any" value="${state.generation.width_pct}" placeholder="auto" />
            </div>

            <div class="field">
              <label>Tree steps</label>
              <input id="sbSteps" type="number" step="1" min="10" value="${state.generation.tree_steps}" ${state.method === "binomial_crr" ? "" : "disabled"} />
            </div>
          </div>

          <div style="margin-top: 14px; display:flex; gap: 10px; align-items:center;">
            <button class="btn" id="sbFind">Find candidates</button>
            <div class="muted" style="font-size: 12px;">Top candidates are ranked by Δ/ν alignment, risk, and payoff at target.</div>
          </div>
        </div>
      </div>
    `;

    // Wire events
    const el = (id) => document.getElementById(id);

    el("sbSpot").addEventListener("input", () => {
      state.market.spot = parseNum(el("sbSpot").value, state.market.spot);
      renderSummary();
    });
    el("sbVol").addEventListener("input", () => {
      state.market.vol = parseNum(el("sbVol").value, state.market.vol);
      renderSummary();
    });
    el("sbRate").addEventListener("input", () => {
      state.market.rate = parseNum(el("sbRate").value, state.market.rate);
      renderSummary();
    });
    el("sbDiv").addEventListener("input", () => {
      state.market.dividend_yield = parseNum(el("sbDiv").value, state.market.dividend_yield);
      renderSummary();
    });

    el("sbDir").addEventListener("change", () => {
      state.view.direction = el("sbDir").value;
      renderSummary();
    });
    el("sbHorizon").addEventListener("input", () => {
      state.view.horizon_days = parseNum(el("sbHorizon").value, state.view.horizon_days);
      renderSummary();
    });

    el("sbMoveMode").addEventListener("change", () => {
      state.view.move_mode = el("sbMoveMode").value;
      // Adjust label and current value
      renderViewPanel();
      renderSummary();
    });

    el("sbVolView").addEventListener("change", () => {
      state.view.vol_view = el("sbVolView").value;
      renderSummary();
    });
    el("sbVolShift").addEventListener("input", () => {
      state.view.vol_shift = parseNum(el("sbVolShift").value, state.view.vol_shift);
      renderSummary();
    });

    el("sbConf").addEventListener("change", () => {
      state.view.confidence = el("sbConf").value;
      renderSummary();
    });
    el("sbEvent").addEventListener("change", () => {
      state.view.event = el("sbEvent").checked;
      renderSummary();
    });

    // Move input
    el("sbMove").addEventListener("input", () => {
      const v = el("sbMove").value;
      if (state.view.move_mode === "target") {
        state.view.target_price = parseOptionalNum(v);
        state.view.move_pct = null;
      } else {
        state.view.move_pct = parseNum(v, state.view.move_pct);
        state.view.target_price = null;
      }
      renderSummary();
    });

    // Constraints
    el("sbMaxLoss").addEventListener("input", () => {
      state.constraints.max_loss = el("sbMaxLoss").value;
    });
    el("sbMaxLegs").addEventListener("change", () => {
      state.constraints.max_legs = parseNum(el("sbMaxLegs").value, state.constraints.max_legs);
    });
    el("sbDefRisk").addEventListener("change", () => {
      state.constraints.defined_risk_only = el("sbDefRisk").checked;
    });
    el("sbMulti").addEventListener("change", () => {
      state.constraints.allow_multi_expiry = el("sbMulti").checked;
      renderViewPanel();
    });
    el("sbPref").addEventListener("input", () => {
      state.constraints.income_vs_convexity = parseNum(el("sbPref").value, state.constraints.income_vs_convexity);
      // Update the label number
      renderViewPanel();
      renderSummary();
    });

    // Generation
    el("sbMethod").addEventListener("change", () => {
      state.method = el("sbMethod").value;
      renderViewPanel();
    });
    el("sbStrikeStep").addEventListener("input", () => {
      state.generation.strike_step = parseNum(el("sbStrikeStep").value, state.generation.strike_step);
    });
    el("sbExp").addEventListener("input", () => {
      state.generation.expiry_days = parseNum(el("sbExp").value, state.generation.expiry_days);
    });
    const expLong = el("sbExpLong");
    if (expLong) {
      expLong.addEventListener("input", () => {
        state.generation.long_expiry_days = parseNum(expLong.value, state.generation.long_expiry_days);
      });
    }
    el("sbWidth").addEventListener("input", () => {
      state.generation.width_pct = el("sbWidth").value;
    });
    const stepsEl = el("sbSteps");
    if (stepsEl) {
      stepsEl.addEventListener("input", () => {
        state.generation.tree_steps = parseNum(stepsEl.value, state.generation.tree_steps);
      });
    }

    el("sbFind").addEventListener("click", async () => {
      clearError(errEl);
      const btn = el("sbFind");
      btn.disabled = true;
      btn.textContent = "Finding…";

      try {
        // Prepare request
        const move_mode = state.view.move_mode;
        const viewPayload = {
          direction: state.view.direction,
          horizon_days: Number(state.view.horizon_days),
          vol_view: state.view.vol_view,
          vol_shift: Number(state.view.vol_shift),
          confidence: state.view.confidence || null,
          event: Boolean(state.view.event),
        };
        if (move_mode === "target") {
          viewPayload.target_price = parseOptionalNum(state.view.target_price);
          viewPayload.move_pct = null;
        } else {
          viewPayload.move_pct = Number(state.view.move_pct);
          viewPayload.target_price = null;
        }

        const req = {
          market: {
            spot: Number(state.market.spot),
            rate: Number(state.market.rate),
            dividend_yield: Number(state.market.dividend_yield),
            vol: Number(state.market.vol),
          },
          view: viewPayload,
          constraints: {
            max_loss: parseOptionalNum(state.constraints.max_loss),
            defined_risk_only: Boolean(state.constraints.defined_risk_only),
            income_vs_convexity: Number(state.constraints.income_vs_convexity),
            max_legs: Number(state.constraints.max_legs),
            allow_multi_expiry: Boolean(state.constraints.allow_multi_expiry),
          },
          generation: {
            strike_step: Number(state.generation.strike_step),
            width_pct: parseOptionalNum(state.generation.width_pct),
            expiry_days: Number(state.generation.expiry_days),
            long_expiry_days: Number(state.generation.long_expiry_days),
            tree_steps: Number(state.generation.tree_steps),
          },
          method: state.method,
        };

        const resp = await postJson("/api/v1/strategy/recommend", req);
        state.lastRecommend = resp;
        state.candidates = resp.candidates || [];
        window.dispatchEvent(new CustomEvent("strategy:computed", { detail: { kind: "recommend", run_id: resp.run_id || null } }));
        state.selected = null;
        state.analysis = null;

        renderCandidatesPanel();
        renderScenariosPanel();
        renderExportPanel();
        renderSummary();
        setActiveTab(viewEl, "candidates");
      } catch (err) {
        showError(errEl, err);
      } finally {
        btn.disabled = false;
        btn.textContent = "Find candidates";
      }
    });
  }

  function renderCandidatesPanel() {
    if (!panelCandidates) return;

    const candidates = state.candidates || [];
    if (candidates.length === 0) {
      panelCandidates.innerHTML = `<div class="muted" style="font-size: 13px;">No candidates yet. Go to the <b>View</b> tab and click <b>Find candidates</b>.</div>`;
      return;
    }

    const cards = candidates
      .map((c, idx) => {
        const premium = c.net_premium;
        const premiumLabel = premium < 0 ? "credit" : "debit";
        const be = (c.breakevens || []).map((x) => fmt(x, 4)).join(", ") || "—";

        const selected = state.selected && state.selected.candidate_id === c.candidate_id;

        return `
          <div class="card card--tight" style="margin-bottom: 12px; border-color: ${selected ? "rgba(122,168,255,0.45)" : "rgba(255,255,255,0.12)"};">
            <div style="display:flex; align-items:flex-start; justify-content: space-between; gap: 12px;">
              <div>
                <div style="display:flex; align-items:center; gap: 8px;">
                  <div style="font-size: 15px; font-weight: 700;">${idx + 1}. ${c.name}</div>
                  <span class="info" data-tooltip="${(c.strategy_note || "").replaceAll('"', '&quot;')}">i</span>
                </div>
                <div class="muted" style="font-size: 12px; margin-top: 6px;">${c.rationale}</div>
              </div>
              <div class="pill">Score ${c.fit_score}</div>
            </div>

            <div style="height: 10px;"></div>

            <div class="grid-2">
              <div>
                <div class="muted" style="font-size: 11px;">Premium (${premiumLabel})</div>
                <div class="mono">${fmtMoney(premium)}</div>
              </div>
              <div>
                <div class="muted" style="font-size: 11px;">Max loss</div>
                <div class="mono">${fmtMaybeUnlimited(c.max_loss)}</div>
              </div>
              <div>
                <div class="muted" style="font-size: 11px;">Max profit</div>
                <div class="mono">${fmtMaybeUnlimited(c.max_profit)}</div>
              </div>
              <div>
                <div class="muted" style="font-size: 11px;">Breakevens</div>
                <div class="mono">${be}</div>
              </div>
            </div>

            <div style="height: 10px;"></div>

            <div class="muted" style="font-size: 12px;">Method: ${c.legs?.[0]?.method || state.method} <span class="info" data-tooltip="${(c.method_note || "").replaceAll('"', '&quot;')}">i</span></div>

            <div style="margin-top: 12px; display:flex; gap: 10px; flex-wrap: wrap;">
              <button class="btn" data-act="analyze" data-id="${c.candidate_id}">Compute scenarios</button>
              <button class="btn btn--secondary" data-act="save" data-id="${c.candidate_id}">Save as portfolio</button>
              <button class="btn btn--secondary" data-act="select" data-id="${c.candidate_id}">${selected ? "Selected" : "Select"}</button>
            </div>
          </div>
        `;
      })
      .join("");

    panelCandidates.innerHTML = `
      <div class="muted" style="margin-bottom: 10px; font-size: 12.5px;">Showing top ${candidates.length} candidates (ranked).</div>
      ${cards}
    `;

    panelCandidates.querySelectorAll("button[data-act]").forEach((b) => {
      b.addEventListener("click", async () => {
        const act = b.dataset.act;
        const id = b.dataset.id;
        const cand = (state.candidates || []).find((x) => x.candidate_id === id);
        if (!cand) return;

        if (act === "select") {
          state.selected = cand;
          state.analysis = null;
          renderSummary();
          renderCandidatesPanel();
          renderScenariosPanel();
          renderExportPanel();
          return;
        }

        if (act === "save") {
          clearError(errEl);
          try {
            const name = `${cand.name} (${new Date().toISOString().slice(0, 10)})`;
            const payload = {
              name,
              portfolio: {
                name,
                legs: cand.legs,
              },
            };
            const created = await postJson("/api/v1/portfolios/import", payload);
            const pid = created.portfolio_id;
            // Navigate to portfolio and auto-open.
            spaNavigate(`/portfolio?portfolio_id=${encodeURIComponent(pid)}`);
          } catch (err) {
            showError(errEl, err);
          }
          return;
        }

        if (act === "analyze") {
          clearError(errEl);
          state.selected = cand;
          state.analysis = null;
          renderSummary();
          renderCandidatesPanel();
          renderScenariosPanel();
          setActiveTab(viewEl, "scenarios");

          // Compute
          try {
            b.disabled = true;
            b.textContent = "Computing…";
            const viewPayload = {
              direction: state.view.direction,
              horizon_days: Number(state.view.horizon_days),
              vol_view: state.view.vol_view,
              vol_shift: Number(state.view.vol_shift),
              confidence: state.view.confidence || null,
              event: Boolean(state.view.event),
            };
            if (state.view.move_mode === "target") {
              viewPayload.target_price = parseOptionalNum(state.view.target_price);
              viewPayload.move_pct = null;
            } else {
              viewPayload.move_pct = Number(state.view.move_pct);
              viewPayload.target_price = null;
            }

            const req = {
              market: {
                spot: Number(state.market.spot),
                rate: Number(state.market.rate),
                dividend_yield: Number(state.market.dividend_yield),
                vol: Number(state.market.vol),
              },
              view: viewPayload,
              strategy_key: cand.strategy_key,
              name: cand.name,
              legs: cand.legs,
              settings: {
                spot_range_pct: 35,
                spot_steps: 101,
                grid_spot_shifts_pct: [-20, -10, -5, 0, 5, 10, 20],
                grid_vol_shifts: [-0.10, -0.05, 0, 0.05, 0.10],
                grid_rate_shift_bps: 0,
              },
            };

            const resp = await postJson("/api/v1/strategy/analyze", req);
            state.analysis = resp;
            renderSummary();
            renderScenariosPanel();
            window.dispatchEvent(new CustomEvent("strategy:computed", { detail: { kind: "analyze", run_id: resp.run_id || null } }));
            renderExportPanel();
          } catch (err) {
            showError(errEl, err);
            // Stay on scenarios tab but show placeholder.
            renderScenariosPanel();
          } finally {
            b.disabled = false;
            b.textContent = "Compute scenarios";
          }
        }
      });
    });
  }

  function renderScenariosPanel() {
    if (!panelScenarios) return;

    const cand = state.selected;
    const a = state.analysis;

    if (!cand) {
      panelScenarios.innerHTML = `<div class="muted" style="font-size: 13px;">Select a candidate and click <b>Compute scenarios</b> to view the analysis.</div>`;
      return;
    }

    if (!a) {
      panelScenarios.innerHTML = `
        <div class="muted" style="font-size: 13px;">Computing analysis… (or not computed yet). Use <b>Compute scenarios</b> from the Candidates tab.</div>
      `;
      return;
    }

    const be = (a.breakevens || []).map((x) => fmt(x, 4)).join(", ") || "—";

    const legsTable = (a.per_leg || []).map((l) => {
      const ok = l.status === "ok";
      return `
        <tr>
          <td class="mono">${l.leg_id}</td>
          <td>${l.instrument_type}</td>
          <td>${l.method}</td>
          <td class="mono">${fmt(l.quantity, 4)}</td>
          <td class="mono">${ok ? fmtMoney(l.price_per_unit) : "—"}</td>
          <td class="mono">${ok ? fmtMoney(l.price_total) : "—"}</td>
          <td>${ok ? `<span class="pill pill--ok">ok</span>` : `<span class="pill pill--bad">error</span>`}</td>
        </tr>
      `;
    }).join("");

    panelScenarios.innerHTML = `
      <div class="grid-2">
        <div class="card card--tight">
          <div style="display:flex; align-items:center; justify-content: space-between; gap: 12px;">
            <div>
              <div style="font-weight: 700;">${cand.name}</div>
              <div class="muted" style="margin-top: 6px; font-size: 12px;">${cand.strategy_note || ""}</div>
            </div>
            <div class="pill">Run ${a.run_id}</div>
          </div>

          <div style="height: 10px;"></div>

          <div class="grid-2">
            <div>
              <div class="muted" style="font-size: 11px;">Initial premium</div>
              <div class="mono">${fmtMoney(a.base_total)}</div>
            </div>
            <div>
              <div class="muted" style="font-size: 11px;">Breakevens</div>
              <div class="mono">${be}</div>
            </div>
            <div>
              <div class="muted" style="font-size: 11px;">Max profit</div>
              <div class="mono">${fmtMaybeUnlimited(a.max_profit)}</div>
            </div>
            <div>
              <div class="muted" style="font-size: 11px;">Max loss</div>
              <div class="mono">${fmtMaybeUnlimited(a.max_loss)}</div>
            </div>
          </div>

          <div style="height: 12px;"></div>

          <div class="muted" style="font-size: 12px; margin-bottom: 8px;">Legs</div>
          <table class="grid-table">
            <thead>
              <tr>
                <th>Leg</th>
                <th>Type</th>
                <th>Method</th>
                <th>Qty</th>
                <th>Price/unit</th>
                <th>Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${legsTable}
            </tbody>
          </table>
        </div>

        <div class="card card--tight">
          <div style="font-weight: 600; margin-bottom: 10px;">Greeks (total)</div>
          <div class="grid-2">
            <div>
              <div class="muted" style="font-size: 11px;">Δ</div>
              <div class="mono">${fmt(a.total_greeks.delta, 6)}</div>
            </div>
            <div>
              <div class="muted" style="font-size: 11px;">Γ</div>
              <div class="mono">${fmt(a.total_greeks.gamma, 6)}</div>
            </div>
            <div>
              <div class="muted" style="font-size: 11px;">ν</div>
              <div class="mono">${fmt(a.total_greeks.vega, 6)}</div>
            </div>
            <div>
              <div class="muted" style="font-size: 11px;">θ</div>
              <div class="mono">${fmt(a.total_greeks.theta, 6)}</div>
            </div>
            <div>
              <div class="muted" style="font-size: 11px;">ρ</div>
              <div class="mono">${fmt(a.total_greeks.rho, 6)}</div>
            </div>
          </div>

          <div style="height: 14px;"></div>

          <div style="font-weight: 600; margin-bottom: 10px;">Payoff (expiry) P&L</div>
          <canvas id="sbPayoff" style="width: 100%; height: 260px; border-radius: 14px; border: 1px solid rgba(255,255,255,0.12);"></canvas>

          <div style="height: 14px;"></div>

          <div style="font-weight: 600; margin-bottom: 10px;">Mark-to-model at horizon (P&L)</div>
          <canvas id="sbHorizonChart" style="width: 100%; height: 260px; border-radius: 14px; border: 1px solid rgba(255,255,255,0.12);"></canvas>
        </div>
      </div>

      <div style="height: 14px;"></div>

      <div class="grid-2">
        <div class="card card--tight">
          <div style="display:flex; align-items:center; justify-content: space-between; gap: 10px;">
            <div style="font-weight: 600;">Spot × vol heatmap</div>
            <div class="muted" style="font-size: 12px;">Crosshair at expected move + IV view.</div>
          </div>
          <div style="height: 10px;"></div>
          <div id="sbHeatmap"></div>
        </div>

        <div class="card card--tight">
          <div style="display:flex; align-items:center; justify-content: space-between; gap: 10px;">
            <div style="font-weight: 600;">Scenario pack</div>
            <div class="muted" style="font-size: 12px;">All values are at horizon.</div>
          </div>
          <div style="height: 10px;"></div>
          <div id="sbScenarios"></div>
        </div>
      </div>
    `;

    // Render charts
    try {
      const payoffCanvas = document.getElementById("sbPayoff");
      drawLineChart(payoffCanvas, a.payoff.spots, a.payoff.values, "P&L");
      // NOTE: "sbHorizon" is used for the horizon input in the View panel.
      // The analysis canvas must have a distinct id to avoid duplicate-id bugs.
      const horCanvas = document.getElementById("sbHorizonChart");
      drawLineChart(horCanvas, a.horizon.spots, a.horizon.values, "P&L");

      const hmEl = document.getElementById("sbHeatmap");
      if (hmEl) hmEl.innerHTML = renderHeatmap(a.heatmap);

      const scEl = document.getElementById("sbScenarios");
      if (scEl) scEl.innerHTML = renderScenarioPack(a.scenario_pack);
    } catch {
      // ignore drawing errors
    }
  }

  function renderExportPanel() {
    if (!panelExport) return;

    const cand = state.selected;
    const rec = state.lastRecommend;
    const analysis = state.analysis;

    panelExport.innerHTML = `
      <div class="card card--tight">
        <div style="font-weight: 600;">Export</div>
        <div class="muted" style="margin-top: 6px; font-size: 12.5px;">Download JSON so you can version it, share it, or reuse it later.</div>

        <div style="height: 12px;"></div>

        <div style="display:flex; gap: 10px; flex-wrap: wrap;">
          <button class="btn btn--secondary" id="sbDlRecommend" ${rec ? "" : "disabled"}>Download recommendations</button>
          <button class="btn btn--secondary" id="sbDlSelected" ${cand ? "" : "disabled"}>Download selected strategy</button>
          <button class="btn btn--secondary" id="sbDlAnalysis" ${analysis ? "" : "disabled"}>Download analysis</button>
        </div>

        <div style="height: 14px;"></div>

        <div class="muted" style="font-size: 12px;">Tip: if you saved a strategy as a portfolio, you can use the Portfolio page to edit legs and run additional grids.</div>
      </div>
    `;

    const dlRec = document.getElementById("sbDlRecommend");
    if (dlRec) {
      dlRec.addEventListener("click", () => {
        if (!state.lastRecommend) return;
        exportJson("recommendations.json", state.lastRecommend);
      });
    }

    const dlSel = document.getElementById("sbDlSelected");
    if (dlSel) {
      dlSel.addEventListener("click", () => {
        if (!state.selected) return;
        exportJson("selected_strategy.json", state.selected);
      });
    }

    const dlAn = document.getElementById("sbDlAnalysis");
    if (dlAn) {
      dlAn.addEventListener("click", () => {
        if (!state.analysis) return;
        exportJson("analysis.json", state.analysis);
      });
    }
  }

  // Tabs
  tabsRoot.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    const t = btn.dataset.tab;
    if (!t) return;
    setActiveTab(viewEl, t);
  });

  // Initial load
  try {
    const catalog = await getJson("/api/v1/meta/instruments");
    state.catalog = catalog;
    // attach ui_version for summary
    state.catalog.ui_version = catalog.ui_version || "0.7";
    state.market = ensureMarketDefaults(state.market, catalog);
    renderViewPanel();
    renderCandidatesPanel();
    renderScenariosPanel();
    renderExportPanel();
    renderSummary();
  } catch (err) {
    showError(errEl, err);
  }
}
