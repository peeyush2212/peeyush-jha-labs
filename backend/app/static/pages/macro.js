import { mountHtml, getJson, postJson, setLoading, showError, clearError, fmt, toast, consumeDraft } from "./shared.js";

function parseNum(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function parseList(v) {
  return String(v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((x) => Number.isFinite(x));
}

function drawLineChart(canvas, values, labelLeft, labelRight) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(0,0,0,0)";
  ctx.fillRect(0, 0, w, h);

  if (!values || values.length < 2) {
    ctx.fillStyle = "rgba(255,255,255,0.70)";
    ctx.font = "12px system-ui";
    ctx.fillText("No data", 10, 22);
    return;
  }

  const xs = values.map((_, i) => i);
  const ys = values.map((v) => v);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = 10;
  const x0 = pad;
  const y0 = pad;
  const x1 = w - pad;
  const y1 = h - pad;

  const sx = (x) => x0 + (x / (xs.length - 1)) * (x1 - x0);
  const sy = (y) => {
    if (maxY === minY) return (y0 + y1) / 2;
    return y1 - ((y - minY) / (maxY - minY)) * (y1 - y0);
  };

  // grid line
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, sy(minY));
  ctx.lineTo(x1, sy(minY));
  ctx.stroke();

  // line
  ctx.strokeStyle = "rgba(122,168,255,0.85)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sx(xs[0]), sy(ys[0]));
  for (let i = 1; i < xs.length; i++) {
    ctx.lineTo(sx(xs[i]), sy(ys[i]));
  }
  ctx.stroke();

  // labels
  ctx.fillStyle = "rgba(255,255,255,0.70)";
  ctx.font = "11px system-ui";
  ctx.fillText(labelLeft || "", 10, h - 10);
  ctx.fillText(labelRight || "", w - 90, h - 10);
}

function pnlClass(x) {
  if (typeof x !== "number" || !Number.isFinite(x)) return "";
  if (x > 0) return "pnl-pos";
  if (x < 0) return "pnl-neg";
  return "";
}

function renderSnapshotRow(meta) {
  const d = meta.last_date ? String(meta.last_date) : "—";
  const v = typeof meta.last_value === "number" ? meta.last_value : null;
  return `
    <div class="trow">
      <div class="tcell label">
        <div style="font-weight:650;">${meta.name}</div>
        <div class="muted" style="font-size:12px;">${meta.series_id} · ${meta.frequency}</div>
      </div>
      <div class="tcell" style="text-align:right;">
        <div class="mono" style="font-weight:700;">${v === null ? "—" : fmt(v)}</div>
        <div class="muted" style="font-size:12px;">${d}</div>
      </div>
    </div>
  `;
}

function fiRow(pos, idx) {
  return `
    <div class="trow">
      <div class="tcell">
        <input class="input" data-fi="label" data-idx="${idx}" value="${pos.label}" />
      </div>
      <div class="tcell" style="max-width:150px;">
        <input class="input" data-fi="notional" data-idx="${idx}" type="number" step="0.01" value="${pos.notional_inr}" />
      </div>
      <div class="tcell" style="max-width:120px;">
        <input class="input" data-fi="dur" data-idx="${idx}" type="number" step="0.01" value="${pos.modified_duration}" />
      </div>
      <div class="tcell" style="max-width:120px;">
        <input class="input" data-fi="conv" data-idx="${idx}" type="number" step="0.01" value="${pos.convexity}" />
      </div>
      <div class="tcell" style="max-width:120px;">
        <select class="select" data-fi="bucket" data-idx="${idx}">
          <option value="long" ${pos.rate_bucket === "long" ? "selected" : ""}>Long</option>
          <option value="short" ${pos.rate_bucket === "short" ? "selected" : ""}>Short</option>
        </select>
      </div>
      <div class="tcell" style="max-width:80px; text-align:right;">
        <button class="button button--ghost" data-fi-remove="${idx}">Remove</button>
      </div>
    </div>
  `;
}

function fxRow(pos, idx) {
  return `
    <div class="trow">
      <div class="tcell">
        <input class="input" data-fx="label" data-idx="${idx}" value="${pos.label}" />
      </div>
      <div class="tcell" style="max-width:180px;">
        <input class="input" data-fx="notional" data-idx="${idx}" type="number" step="0.01" value="${pos.notional_usd}" />
      </div>
      <div class="tcell" style="max-width:80px; text-align:right;">
        <button class="button button--ghost" data-fx-remove="${idx}">Remove</button>
      </div>
    </div>
  `;
}

function renderPnlTable(result) {
  const rows = (result.positions || []).map((p) => {
    return `
      <div class="trow">
        <div class="tcell label">${p.label}</div>
        <div class="tcell muted">${p.kind}</div>
        <div class="tcell mono ${pnlClass(p.pnl_inr)}" style="text-align:right;">${fmt(p.pnl_inr, 2)}</div>
      </div>
    `;
  });
  return `
    <div class="table" style="margin-top:10px;">
      <div class="trow thead">
        <div class="tcell">Position</div>
        <div class="tcell">Type</div>
        <div class="tcell" style="text-align:right;">P&amp;L (INR)</div>
      </div>
      ${rows.join("")}
      <div class="trow">
        <div class="tcell label">TOTAL</div>
        <div class="tcell muted">—</div>
        <div class="tcell mono ${pnlClass(result.total_pnl_inr)}" style="text-align:right; font-weight:750;">${fmt(result.total_pnl_inr, 2)}</div>
      </div>
    </div>
  `;
}

function renderGridTable(title, xLabel, xVals, yLabel, yVals, matrix) {
  if (!matrix || !xVals || !yVals) return "";
  const head = `
    <div class="trow thead">
      <div class="tcell">${yLabel} \ ${xLabel}</div>
      ${xVals.map((x) => `<div class="tcell" style="text-align:right;">${fmt(x)}</div>`).join("")}
    </div>
  `;

  const rows = yVals
    .map((y, i) => {
      const row = matrix[i] || [];
      return `
        <div class="trow">
          <div class="tcell label">${fmt(y)}</div>
          ${xVals
            .map((_, j) => {
              const v = row[j];
              return `<div class="tcell mono ${pnlClass(v)}" style="text-align:right;">${fmt(v, 2)}</div>`;
            })
            .join("")}
        </div>
      `;
    })
    .join("");

  return `
    <div class="subhead" style="margin-top:12px;">${title}</div>
    <div class="table" style="overflow:auto;">
      ${head}
      ${rows}
    </div>
  `;
}

export async function renderMacro(viewEl) {
  const state = {
    series: [],
    timeline: [],
    chartKey: "usdinr",
    stressPacks: [],
    packSearch: "",
    comparePackIds: [],
    lastCompare: null,
    fixedIncome: [
      {
        label: "G-sec proxy",
        notional_inr: 10000000,
        modified_duration: 5.0,
        convexity: 80.0,
        rate_bucket: "long",
      },
    ],
    fx: [
      {
        label: "USDINR",
        notional_usd: 100000,
      },
    ],
  };
const draft = consumeDraft("/macro");
if (draft?.payload) {
  try {
    if (Array.isArray(draft.payload.fixed_income)) state.fixedIncome = draft.payload.fixed_income;
    if (Array.isArray(draft.payload.fx)) state.fx = draft.payload.fx;
  } catch (_) {
    // ignore
  }
}



  mountHtml(
    viewEl,
    `
      <section class="grid grid--twoone">
        <div class="card">
          <div class="card__header">
            <h2>Macro → Rates/FX scenario explorer</h2>
            <p class="card__hint">India-context indicators · input shocks → portfolio P&amp;L</p>
          </div>

          <div id="macroErr" class="error" hidden></div>

          <div class="subhead">Market snapshot</div>
          <div id="snapBox" class="table"></div>

          <div class="row" style="margin-top:10px; gap:10px; align-items:flex-end;">
            <div style="flex:1;">
              <label class="label">Refresh series (optional)</label>
              <select id="refreshSeries" class="select" style="width:100%;"></select>
            </div>
            <div>
              <button id="btnRefresh" class="button button--ghost">Refresh from source</button>
            </div>
          </div>

          <hr class="divider" />

          <div class="subhead">Scenario library (stress packs)</div>
          <div class="muted" style="font-size:12.5px; margin-bottom:8px;">
            One-click apply → fill shocks. Select 2+ packs to compare side-by-side.
          </div>

          <div class="row" style="margin-top:6px; gap:10px; align-items:flex-end;">
            <div style="flex:1;">
              <label class="label">Search packs</label>
              <input id="packSearch" class="input" placeholder="e.g., INR risk-off, curve steepener..." />
            </div>
            <div>
              <button id="btnSavePack" class="button button--ghost">Save current as pack</button>
            </div>
          </div>

          <div id="packsBox" class="pack-grid" style="margin-top:12px;"></div>
          <div id="compareBox" style="margin-top:12px;"></div>

          <hr class="divider" />

          <div class="subhead">Scenario inputs</div>

          <div class="grid" style="grid-template-columns: repeat(2, minmax(0, 1fr)); gap:12px;">
            <div>
              <label class="label">Short-rate shock (bps)</label>
              <input id="inShort" class="input" type="number" step="1" value="0" />
              <div class="muted" style="font-size:12px; margin-top:4px;">Applied to positions tagged <span class="mono">Short</span> and to FX carry.</div>
            </div>
            <div>
              <label class="label">Long-rate shock (bps)</label>
              <input id="inLong" class="input" type="number" step="1" value="0" />
              <div class="muted" style="font-size:12px; margin-top:4px;">Applied to positions tagged <span class="mono">Long</span>.</div>
            </div>
            <div>
              <label class="label">USDINR spot shock (%)</label>
              <input id="inFx" class="input" type="number" step="0.1" value="0" />
              <div class="muted" style="font-size:12px; margin-top:4px;">+% means USDINR higher (INR depreciation).</div>
            </div>
            <div>
              <label class="label">Funding rate (%)</label>
              <input id="inFunding" class="input" type="number" step="0.01" value="0" />
              <div class="muted" style="font-size:12px; margin-top:4px;">Used in carry proxy: (domestic short rate − funding).</div>
            </div>
            <div>
              <label class="label">Carry horizon (days)</label>
              <input id="inHorizon" class="input" type="number" step="1" value="30" />
            </div>
            <div style="display:flex; align-items:flex-end; gap:10px;">
              <label class="checkbox" style="margin-bottom:2px;">
                <input id="chkSave" type="checkbox" checked />
                <span>Save to Runs</span>
              </label>
            </div>
          </div>

          <hr class="divider" />

          <div class="subhead">Positions</div>
          <div class="muted" style="font-size:12.5px; margin-bottom:8px;">
            Fixed income uses a duration/convexity approximation. FX uses spot P&amp;L + a simple carry proxy.
          </div>

          <div class="subhead" style="margin-top:10px;">Fixed income</div>
          <div class="table">
            <div class="trow thead">
              <div class="tcell">Label</div>
              <div class="tcell" style="text-align:right;">Notional (INR)</div>
              <div class="tcell" style="text-align:right;">ModDur</div>
              <div class="tcell" style="text-align:right;">Convexity</div>
              <div class="tcell">Bucket</div>
              <div class="tcell"></div>
            </div>
            <div id="fiRows"></div>
          </div>
          <button id="btnAddFi" class="button button--ghost" style="margin-top:8px;">+ Add fixed income</button>

          <div class="subhead" style="margin-top:14px;">FX</div>
          <div class="table">
            <div class="trow thead">
              <div class="tcell">Label</div>
              <div class="tcell" style="text-align:right;">Notional (USD)</div>
              <div class="tcell"></div>
            </div>
            <div id="fxRows"></div>
          </div>
          <button id="btnAddFx" class="button button--ghost" style="margin-top:8px;">+ Add FX</button>

          <div class="row" style="margin-top:14px; gap:10px;">
            <button id="btnScenario" class="button">Compute scenario</button>
            <a class="button button--ghost" href="/runs" data-link>Open Runs</a>
          </div>

          <div id="scenarioOut"></div>

          <hr class="divider" />

          <div class="subhead">Scenario grid</div>
          <div class="muted" style="font-size:12.5px; margin-bottom:8px;">
            Compute total portfolio P&amp;L across a grid of shocks (comma-separated lists).
          </div>

          <div class="grid" style="grid-template-columns: repeat(2, minmax(0, 1fr)); gap:12px;">
            <div>
              <label class="label">FX shocks (%)</label>
              <input id="gridFx" class="input" value="-2,-1,0,1,2" />
            </div>
            <div>
              <label class="label">Short-rate shocks (bps)</label>
              <input id="gridShort" class="input" value="-100,-50,0,50,100" />
            </div>
            <div>
              <label class="label">Long-rate shocks (bps)</label>
              <input id="gridLong" class="input" value="-100,-50,0,50,100" />
            </div>
            <div style="display:flex; align-items:flex-end;">
              <button id="btnGrid" class="button button--ghost">Compute grid</button>
            </div>
          </div>

          <div id="gridOut"></div>
        </div>

        <div class="card">
          <div class="card__header">
            <h2>Timeline</h2>
            <p class="card__hint">Monthly alignment for key series</p>
          </div>

          <div class="row" style="gap:10px; align-items:flex-end;">
            <div style="flex:1;">
              <label class="label">Chart series</label>
              <select id="chartKey" class="select" style="width:100%;">
                <option value="usdinr">USDINR</option>
                <option value="rate_3m_pct">3M rate (%)</option>
                <option value="rate_10y_pct">10Y yield (%)</option>
                <option value="cpi_yoy_pct">CPI YoY (%)</option>
                <option value="curve_slope_bps">Curve slope (bps)</option>
              </select>
            </div>
            <div>
              <button id="btnReload" class="button button--ghost">Reload</button>
            </div>
          </div>

          <canvas id="macroChart" width="560" height="220" style="margin-top:12px; width:100%; height:auto;"></canvas>

          <details style="margin-top:12px;">
            <summary class="muted" style="cursor:pointer;">Show monthly table</summary>
            <div id="timelineTable" class="table" style="margin-top:10px; overflow:auto;"></div>
          </details>

          <div class="hint" style="margin-top:14px;">
            <div class="hint__label">Notes</div>
            <div class="hint__text">
              <ul style="margin:8px 0 0 18px;">
                <li>Rates use a duration/convexity approximation for quick stress testing.</li>
                <li>FX includes spot P&amp;L and a carry proxy based on the domestic short rate and a user-supplied funding rate.</li>
                <li>Data ships with a bundled offline snapshot; you can optionally refresh from public sources.</li>
              </ul>
            </div>
          </div>
        </div>
      </section>
    `
  );
// Apply draft values to form fields (best-effort).
if (draft?.payload) {
  try {
    const s = draft.payload.scenario || {};
    if (document.getElementById("inShort")) document.getElementById("inShort").value = String(s.short_rate_shock_bps ?? 0);
    if (document.getElementById("inLong")) document.getElementById("inLong").value = String(s.long_rate_shock_bps ?? 0);
    if (document.getElementById("inFx")) document.getElementById("inFx").value = String(s.fx_spot_shock_pct ?? 0);
    if (document.getElementById("inInfl")) document.getElementById("inInfl").value = String(s.inflation_shock_pp ?? 0);

    const carry = draft.payload.carry || {};
    if (document.getElementById("inHorizon")) document.getElementById("inHorizon").value = String(carry.horizon_days ?? 30);
    if (document.getElementById("inFunding")) document.getElementById("inFunding").value = String(carry.funding_rate_pct ?? 0);

    // Grid axes (if present)
    if (Array.isArray(draft.payload.fx_spot_shocks_pct) && document.getElementById("gridFx")) {
      document.getElementById("gridFx").value = draft.payload.fx_spot_shocks_pct.join(", ");
    }
    if (Array.isArray(draft.payload.short_rate_shocks_bps) && document.getElementById("gridShort")) {
      document.getElementById("gridShort").value = draft.payload.short_rate_shocks_bps.join(", ");
    }
    if (Array.isArray(draft.payload.long_rate_shocks_bps) && document.getElementById("gridLong")) {
      document.getElementById("gridLong").value = draft.payload.long_rate_shocks_bps.join(", ");
    }

    toast("Draft loaded from Runs", "success");
  } catch (_) {
    // ignore
  }
}



  const errEl = document.getElementById("macroErr");
  const snapBox = document.getElementById("snapBox");
  const scenarioOut = document.getElementById("scenarioOut");
  const gridOut = document.getElementById("gridOut");
  const packsBox = document.getElementById("packsBox");
  const compareBox = document.getElementById("compareBox");

  const fiRows = document.getElementById("fiRows");
  const fxRows = document.getElementById("fxRows");

  function paintPositions() {
    fiRows.innerHTML = state.fixedIncome.map(fiRow).join("");
    fxRows.innerHTML = state.fx.map(fxRow).join("");
  }

  function _escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function currentScenarioFromForm() {
    return {
      short_rate_shock_bps: parseNum(document.getElementById("inShort").value, 0),
      long_rate_shock_bps: parseNum(document.getElementById("inLong").value, 0),
      fx_spot_shock_pct: parseNum(document.getElementById("inFx").value, 0),
      inflation_shock_pp: 0,
    };
  }

  function buildPositionsPayload() {
    return {
      fixed_income: state.fixedIncome.map((p) => ({
        label: p.label,
        notional_inr: parseNum(p.notional_inr, 0),
        modified_duration: parseNum(p.modified_duration, 0),
        convexity: parseNum(p.convexity, 0),
        rate_bucket: p.rate_bucket,
      })),
      fx: state.fx.map((p) => ({
        label: p.label,
        notional_usd: parseNum(p.notional_usd, 0),
      })),
    };
  }

  function buildCarryPayload() {
    return {
      horizon_days: Math.max(1, Math.floor(parseNum(document.getElementById("inHorizon").value, 30))),
      funding_rate_pct: parseNum(document.getElementById("inFunding").value, 0),
    };
  }

  function _packSummary(pack) {
    const s = pack?.scenario || {};
    const sr = s.short_rate_shock_bps ?? 0;
    const lr = s.long_rate_shock_bps ?? 0;
    const fx = s.fx_spot_shock_pct ?? 0;
    return `Short ${sr}bps · Long ${lr}bps · USDINR ${fx}%`;
  }

  function _packMatches(pack, q) {
    if (!q) return true;
    const hay = `${pack.name || ""} ${pack.description || ""} ${(pack.tags || []).join(" ")}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  }

  function _selectedPacks() {
    const sel = new Set(state.comparePackIds || []);
    return (state.stressPacks || []).filter((p) => sel.has(p.pack_id));
  }

  function renderPackCard(pack) {
    const sel = (state.comparePackIds || []).includes(pack.pack_id);
    const tagLine = (pack.tags && pack.tags.length)
      ? `<div class="pack-tags">${pack.tags.slice(0, 4).map((t) => `<span class="tag">${_escapeHtml(t)}</span>`).join(" ")}</div>`
      : ``;

    return `
      <div class="pack-card ${sel ? "pack-card--selected" : ""}">
        <div class="pack-card__title">${_escapeHtml(pack.name)}</div>
        <div class="pack-card__meta">${_escapeHtml(pack.description || "")}</div>
        <div class="pack-card__summary mono">${_escapeHtml(_packSummary(pack))}</div>
        ${tagLine}
        <div class="row" style="margin-top:10px; gap:8px;">
          <button class="button button--ghost" data-pack-action="apply" data-pack-id="${_escapeHtml(pack.pack_id)}">Apply</button>
          <button class="button ${sel ? "" : "button--ghost"}" data-pack-action="toggle" data-pack-id="${_escapeHtml(pack.pack_id)}">${sel ? "Selected" : "Compare"}</button>
        </div>
      </div>
    `;
  }

  function renderCompareBox() {
    const sel = _selectedPacks();
    if (sel.length < 2) {
      return `<div class="muted" style="font-size:12.5px;">Select at least two packs to compare.</div>`;
    }

    const chips = sel.map((p) => `<span class="chip">${_escapeHtml(p.name)}</span>`).join(" ");

    const actions = `
      <div class="row" style="margin-top:10px; gap:10px;">
        <button class="button button--ghost" data-compare-action="clear">Clear compare</button>
        <button class="button" data-compare-action="run">Compute compare</button>
      </div>
    `;

    const out = state.lastCompare ? renderCompareTable(state.lastCompare) : `<div class="muted" style="font-size:12.5px; margin-top:10px;">No comparison computed yet.</div>`;

    return `
      <div class="compare-panel">
        <div class="subhead">Compare (side-by-side)</div>
        <div class="chip-row" style="margin-top:8px;">${chips}</div>
        ${actions}
        ${out}
      </div>
    `;
  }

  function paintPacks() {
    if (!packsBox) return;
    const q = (state.packSearch || "").trim();
    const packs = (state.stressPacks || []).filter((p) => _packMatches(p, q));
    packsBox.innerHTML = packs.length ? packs.map(renderPackCard).join("") : `<div class="muted" style="font-size:12.5px;">No packs found.</div>`;
    if (compareBox) compareBox.innerHTML = renderCompareBox();
  }

  function applyPack(packId) {
    const pack = (state.stressPacks || []).find((p) => p.pack_id === packId);
    if (!pack) return;
    const s = pack.scenario || {};
    document.getElementById("inShort").value = String(s.short_rate_shock_bps ?? 0);
    document.getElementById("inLong").value = String(s.long_rate_shock_bps ?? 0);
    document.getElementById("inFx").value = String(s.fx_spot_shock_pct ?? 0);
    toast(`Applied: ${pack.name}`, "success");
    window.dispatchEvent(new CustomEvent("stresspack:applied", { detail: { pack_id: pack.pack_id, name: pack.name } }));
  }

  function toggleCompare(packId) {
    const cur = new Set(state.comparePackIds || []);
    if (cur.has(packId)) cur.delete(packId);
    else cur.add(packId);
    // Keep at most 4
    state.comparePackIds = Array.from(cur).slice(0, 4);
    state.lastCompare = null;
    paintPacks();
  }

  function renderCompareTable(res) {
    const items = res.items || [];
    if (!items.length) return "";

    // Build row map across all positions
    const rowMap = new Map(); // key -> {label, kind, pnls: {name->pnl}}
    for (const it of items) {
      const name = it.name;
      for (const p of (it.positions || [])) {
        const key = `${p.kind}::${p.label}`;
        if (!rowMap.has(key)) {
          rowMap.set(key, { label: p.label, kind: p.kind, pnls: {} });
        }
        rowMap.get(key).pnls[name] = p.pnl_inr;
      }
    }

    const scenarioNames = items.map((it) => it.name);

    const header = `
      <div class="trow thead">
        <div class="tcell">Position</div>
        ${scenarioNames.map((n) => `<div class="tcell" style="text-align:right;">${_escapeHtml(n)}</div>`).join("")}
      </div>
    `;

    const totalRow = `
      <div class="trow">
        <div class="tcell"><span class="mono">Total P&amp;L (INR)</span></div>
        ${items.map((it) => `<div class="tcell mono" style="text-align:right;">${fmt(it.total_pnl_inr)}</div>`).join("")}
      </div>
    `;

    const rows = Array.from(rowMap.values())
      .sort((a, b) => (a.kind + a.label).localeCompare(b.kind + b.label))
      .map((r) => {
        const left = `<div class="tcell">${_escapeHtml(r.label)} <span class="muted" style="font-size:12px;">(${_escapeHtml(r.kind)})</span></div>`;
        const cols = scenarioNames
          .map((n) => {
            const v = r.pnls[n];
            return `<div class="tcell mono" style="text-align:right;">${v == null ? "—" : fmt(v)}</div>`;
          })
          .join("");
        return `<div class="trow">${left}${cols}</div>`;
      })
      .join("");

    const base = `
      <div class="table" style="margin-top:10px;">
        <div class="trow">
          <div class="tcell label">Base USDINR</div>
          <div class="tcell mono" style="text-align:right;">${fmt(res.base_usdinr)}</div>
        </div>
        <div class="trow">
          <div class="tcell label">Base 3M rate (%)</div>
          <div class="tcell mono" style="text-align:right;">${fmt(res.base_rate_3m_pct)}</div>
        </div>
        <div class="trow">
          <div class="tcell label">Base 10Y yield (%)</div>
          <div class="tcell mono" style="text-align:right;">${fmt(res.base_rate_10y_pct)}</div>
        </div>
      </div>
    `;

    return base + `<div class="table" style="margin-top:12px; overflow:auto;">${header}${totalRow}${rows}</div>`;
  }

  async function runCompare() {
    const sel = _selectedPacks();
    if (sel.length < 2) return;

    const btn = viewEl.querySelector('button[data-compare-action="run"]');
    if (btn) setLoading(btn, true);

    try {
      const pos = buildPositionsPayload();
      const payload = {
        ...pos,
        carry: buildCarryPayload(),
        scenarios: sel.map((p) => ({ name: p.name, scenario: p.scenario })),
        save_run: !!document.getElementById("chkSave").checked,
      };
      const res = await postJson("/api/v1/macro/compare", payload);
      state.lastCompare = res;
      toast("Comparison computed", "success");
      window.dispatchEvent(new CustomEvent("stresspack:compared"));
      paintPacks();
    } catch (e) {
      toast(String(e.message || e), "error");
    } finally {
      if (btn) setLoading(btn, false);
    }
  }

  function _showPackModal() {
    const modalRoot = document.getElementById("modalRoot");
    if (!modalRoot) return;

    const scenario = currentScenarioFromForm();
    const defaults = {
      name: "",
      description: _packSummary({ scenario }),
    };

    modalRoot.innerHTML = `
      <div class="modal-backdrop" role="dialog" aria-modal="true">
        <div class="modal">
          <div class="modal__header">
            <div>
              <div class="modal__title">Save current shocks as a pack</div>
              <div class="modal__subtitle">Name it once, reuse with one click.</div>
            </div>
            <button class="modal__close" id="packModalClose" aria-label="Close">✕</button>
          </div>
          <div class="modal__body">
            <div class="form" style="gap:10px;">
              <div>
                <label class="label">Pack name</label>
                <input id="packName" class="input" placeholder="e.g., Inflation spike + INR risk-off" value="${_escapeHtml(defaults.name)}" />
              </div>
              <div>
                <label class="label">Description (optional)</label>
                <input id="packDesc" class="input" value="${_escapeHtml(defaults.description)}" />
              </div>
              <div class="muted" style="font-size:12.5px;">
                This will save: <span class="mono">${_escapeHtml(_packSummary({ scenario }))}</span>
              </div>
            </div>
          </div>
          <div class="modal__footer">
            <button class="button button--ghost" id="packModalCancel">Cancel</button>
            <button class="button" id="packModalSave">Save pack</button>
          </div>
        </div>
      </div>
    `;

    const close = () => {
      modalRoot.innerHTML = "";
    };

    modalRoot.querySelector(".modal-backdrop").addEventListener("click", (e) => {
      if (e.target.classList.contains("modal-backdrop")) close();
    });

    modalRoot.querySelector("#packModalClose").addEventListener("click", close);
    modalRoot.querySelector("#packModalCancel").addEventListener("click", close);

    modalRoot.querySelector("#packModalSave").addEventListener("click", async () => {
      const btn = modalRoot.querySelector("#packModalSave");
      setLoading(btn, true);
      try {
        const name = (modalRoot.querySelector("#packName").value || "").trim();
        const description = (modalRoot.querySelector("#packDesc").value || "").trim();
        if (!name) {
          toast("Please enter a pack name", "warning");
          return;
        }
        const payload = {
          name,
          description,
          tags: [],
          scenario: currentScenarioFromForm(),
        };
        await postJson("/api/v1/macro/stress-packs", payload);
        toast("Stress pack saved", "success");
        close();
        state.stressPacks = await getJson("/api/v1/macro/stress-packs");
        paintPacks();
      } catch (e) {
        toast(String(e.message || e), "error");
      } finally {
        setLoading(btn, false);
      }
    });
  }

  function renderTimelineTable(points) {
    if (!points || !points.length) {
      return `<div class="muted" style="font-size:12.5px;">No data</div>`;
    }
    const head = `
      <div class="trow thead">
        <div class="tcell">Month</div>
        <div class="tcell" style="text-align:right;">USDINR</div>
        <div class="tcell" style="text-align:right;">3M (%)</div>
        <div class="tcell" style="text-align:right;">10Y (%)</div>
        <div class="tcell" style="text-align:right;">CPI YoY (%)</div>
        <div class="tcell" style="text-align:right;">Slope (bps)</div>
      </div>
    `;
    const rows = points
      .map((p) => {
        return `
          <div class="trow">
            <div class="tcell mono">${String(p.month).slice(0, 7)}</div>
            <div class="tcell mono" style="text-align:right;">${p.usdinr == null ? "—" : fmt(p.usdinr)}</div>
            <div class="tcell mono" style="text-align:right;">${p.rate_3m_pct == null ? "—" : fmt(p.rate_3m_pct)}</div>
            <div class="tcell mono" style="text-align:right;">${p.rate_10y_pct == null ? "—" : fmt(p.rate_10y_pct)}</div>
            <div class="tcell mono" style="text-align:right;">${p.cpi_yoy_pct == null ? "—" : fmt(p.cpi_yoy_pct)}</div>
            <div class="tcell mono" style="text-align:right;">${p.curve_slope_bps == null ? "—" : fmt(p.curve_slope_bps)}</div>
          </div>
        `;
      })
      .join("");
    return head + rows;
  }

  function paintChart() {
    const pts = state.timeline || [];
    const key = state.chartKey;
    const values = pts.map((p) => p[key]).filter((v) => typeof v === "number" && Number.isFinite(v));
    const left = pts.length ? String(pts[0].month).slice(0, 7) : "";
    const right = pts.length ? String(pts[pts.length - 1].month).slice(0, 7) : "";
    const canvas = document.getElementById("macroChart");
    drawLineChart(canvas, values, left, right);
  }

  async function loadAll() {
    clearError(errEl);
    try {
      state.series = await getJson("/api/v1/macro/series");
      // /timeline returns { points: [...] } (response model), but older builds returned the array directly.
      const tl = await getJson("/api/v1/macro/timeline?months=48");
      state.timeline = Array.isArray(tl) ? tl : tl?.points || [];
      state.stressPacks = await getJson("/api/v1/macro/stress-packs");

      snapBox.innerHTML = (state.series || []).map(renderSnapshotRow).join("") || "";

      // refresh dropdown
      const sel = document.getElementById("refreshSeries");
      sel.innerHTML = (state.series || [])
        .map((s) => `<option value="${s.series_id}">${s.series_id} · ${s.name}</option>`)
        .join("");

      const tEl = document.getElementById("timelineTable");
      tEl.innerHTML = renderTimelineTable(state.timeline);
      paintChart();
      paintPositions();
      paintPacks();
    } catch (e) {
      showError(errEl, String(e.message || e));
    }
  }

  // Handlers
  document.getElementById("btnReload").addEventListener("click", loadAll);

  document.getElementById("chartKey").addEventListener("change", (e) => {
    state.chartKey = e.target.value;
    paintChart();
  });

  document.getElementById("btnAddFi").addEventListener("click", () => {
    state.fixedIncome.push({
      label: "Fixed income",
      notional_inr: 5000000,
      modified_duration: 3.0,
      convexity: 50.0,
      rate_bucket: "long",
    });
    paintPositions();
  });

  document.getElementById("btnAddFx").addEventListener("click", () => {
    state.fx.push({ label: "USDINR", notional_usd: 50000 });
    paintPositions();
  });

  // Stress pack search + save
  document.getElementById("packSearch").addEventListener("input", (e) => {
    state.packSearch = e.target.value || "";
    paintPacks();
  });

  document.getElementById("btnSavePack").addEventListener("click", () => {
    _showPackModal();
  });

  // Delegate position edits
  viewEl.addEventListener("input", (e) => {
    const t = e.target;
    if (t?.dataset?.fi) {
      const idx = Number(t.dataset.idx);
      const key = t.dataset.fi;
      if (!Number.isFinite(idx) || !state.fixedIncome[idx]) return;
      const row = state.fixedIncome[idx];
      if (key === "label") row.label = t.value;
      if (key === "notional") row.notional_inr = parseNum(t.value, row.notional_inr);
      if (key === "dur") row.modified_duration = parseNum(t.value, row.modified_duration);
      if (key === "conv") row.convexity = parseNum(t.value, row.convexity);
    }
    if (t?.dataset?.fx) {
      const idx = Number(t.dataset.idx);
      const key = t.dataset.fx;
      if (!Number.isFinite(idx) || !state.fx[idx]) return;
      const row = state.fx[idx];
      if (key === "label") row.label = t.value;
      if (key === "notional") row.notional_usd = parseNum(t.value, row.notional_usd);
    }
  });

  viewEl.addEventListener("click", (e) => {
    const btnFi = e.target.closest("button[data-fi-remove]");
    if (btnFi) {
      const idx = Number(btnFi.dataset.fiRemove);
      if (Number.isFinite(idx)) {
        state.fixedIncome.splice(idx, 1);
        paintPositions();
      }
    }
    const btnFx = e.target.closest("button[data-fx-remove]");
    if (btnFx) {
      const idx = Number(btnFx.dataset.fxRemove);
      if (Number.isFinite(idx)) {
        state.fx.splice(idx, 1);
        paintPositions();
      }
    }

    const packBtn = e.target.closest("button[data-pack-action]");
    if (packBtn) {
      const packId = packBtn.dataset.packId;
      const action = packBtn.dataset.packAction;
      if (action === "apply") applyPack(packId);
      if (action === "toggle") toggleCompare(packId);
    }

    const cmpBtn = e.target.closest("button[data-compare-action]");
    if (cmpBtn) {
      const action = cmpBtn.dataset.compareAction;
      if (action === "clear") {
        state.comparePackIds = [];
        state.lastCompare = null;
        paintPacks();
      }
      if (action === "run") {
        runCompare();
      }
    }
  });

  document.getElementById("btnRefresh").addEventListener("click", async () => {
    const btn = document.getElementById("btnRefresh");
    const seriesId = document.getElementById("refreshSeries").value;
    clearError(errEl);
    setLoading(btn, true);
    try {
      await postJson(`/api/v1/macro/refresh?series_id=${encodeURIComponent(seriesId)}`, {});
      await loadAll();
    } catch (e) {
      showError(errEl, String(e.message || e));
    } finally {
      setLoading(btn, false);
    }
  });

  document.getElementById("btnScenario").addEventListener("click", async () => {
    const btn = document.getElementById("btnScenario");
    clearError(errEl);
    setLoading(btn, true);
    scenarioOut.innerHTML = "";
    try {
      const payload = {
        scenario: {
          short_rate_shock_bps: parseNum(document.getElementById("inShort").value, 0),
          long_rate_shock_bps: parseNum(document.getElementById("inLong").value, 0),
          fx_spot_shock_pct: parseNum(document.getElementById("inFx").value, 0),
          inflation_shock_pp: 0,
        },
        fixed_income: state.fixedIncome.map((p) => ({
          label: p.label,
          notional_inr: parseNum(p.notional_inr, 0),
          modified_duration: parseNum(p.modified_duration, 0),
          convexity: parseNum(p.convexity, 0),
          rate_bucket: p.rate_bucket,
        })),
        fx: state.fx.map((p) => ({
          label: p.label,
          notional_usd: parseNum(p.notional_usd, 0),
        })),
        carry: {
          horizon_days: Math.max(1, Math.floor(parseNum(document.getElementById("inHorizon").value, 30))),
          funding_rate_pct: parseNum(document.getElementById("inFunding").value, 0),
        },
        save_run: !!document.getElementById("chkSave").checked,
      };

      const res = await postJson("/api/v1/macro/scenario", payload);

      window.dispatchEvent(new CustomEvent("macro:computed", { detail: { run_id: res.run_id || null } }));

      scenarioOut.innerHTML = `
        <div class="subhead" style="margin-top:14px;">Scenario result</div>
        <div class="muted" style="font-size:12.5px;">Run ID: <span class="mono">${res.run_id || "(not saved)"}</span></div>
        <div class="table" style="margin-top:10px;">
          <div class="trow">
            <div class="tcell label">Base USDINR</div>
            <div class="tcell mono" style="text-align:right;">${fmt(res.base_usdinr)}</div>
          </div>
          <div class="trow">
            <div class="tcell label">Base 3M rate (%)</div>
            <div class="tcell mono" style="text-align:right;">${fmt(res.base_rate_3m_pct)}</div>
          </div>
          <div class="trow">
            <div class="tcell label">Base 10Y yield (%)</div>
            <div class="tcell mono" style="text-align:right;">${fmt(res.base_rate_10y_pct)}</div>
          </div>
        </div>
        ${renderPnlTable(res)}
      `;
    } catch (e) {
      showError(errEl, String(e.message || e));
    } finally {
      setLoading(btn, false);
    }
  });

  document.getElementById("btnGrid").addEventListener("click", async () => {
    const btn = document.getElementById("btnGrid");
    clearError(errEl);
    setLoading(btn, true);
    gridOut.innerHTML = "";
    try {
      const payload = {
        scenario: {
          short_rate_shock_bps: parseNum(document.getElementById("inShort").value, 0),
          long_rate_shock_bps: parseNum(document.getElementById("inLong").value, 0),
          fx_spot_shock_pct: 0,
          inflation_shock_pp: 0,
        },
        fixed_income: state.fixedIncome.map((p) => ({
          label: p.label,
          notional_inr: parseNum(p.notional_inr, 0),
          modified_duration: parseNum(p.modified_duration, 0),
          convexity: parseNum(p.convexity, 0),
          rate_bucket: p.rate_bucket,
        })),
        fx: state.fx.map((p) => ({
          label: p.label,
          notional_usd: parseNum(p.notional_usd, 0),
        })),
        carry: {
          horizon_days: Math.max(1, Math.floor(parseNum(document.getElementById("inHorizon").value, 30))),
          funding_rate_pct: parseNum(document.getElementById("inFunding").value, 0),
        },
        fx_spot_shocks_pct: parseList(document.getElementById("gridFx").value),
        short_rate_shocks_bps: parseList(document.getElementById("gridShort").value),
        long_rate_shocks_bps: parseList(document.getElementById("gridLong").value),
        save_run: !!document.getElementById("chkSave").checked,
      };

      const res = await postJson("/api/v1/macro/grid", payload);

      const parts = [];
      parts.push(`<div class="subhead" style="margin-top:14px;">Grid result</div>`);
      parts.push(`<div class="muted" style="font-size:12.5px;">Run ID: <span class="mono">${res.run_id || "(not saved)"}</span></div>`);
      if (res.short_rate_grid_pnl && res.short_rate_shocks_bps) {
        parts.push(
          renderGridTable(
            "Short-rate grid (total P&L)",
            "Short bps",
            res.short_rate_shocks_bps,
            "FX %",
            res.fx_spot_shocks_pct,
            res.short_rate_grid_pnl
          )
        );
      }
      if (res.long_rate_grid_pnl && res.long_rate_shocks_bps) {
        parts.push(
          renderGridTable(
            "Long-rate grid (total P&L)",
            "Long bps",
            res.long_rate_shocks_bps,
            "FX %",
            res.fx_spot_shocks_pct,
            res.long_rate_grid_pnl
          )
        );
      }
      gridOut.innerHTML = parts.join("\n");
    } catch (e) {
      showError(errEl, String(e.message || e));
    } finally {
      setLoading(btn, false);
    }
  });

  await loadAll();
}
