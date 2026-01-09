import {
  clearError,
  fmt,
  mountHtml,
  postJson,
  setLoading,
  showError,
  toast,
  consumeDraft,
  toPct,
} from "./shared.js";

function fmtNum(x, decimals = 2) {
  if (typeof x !== "number" || !Number.isFinite(x)) return "—";
  return x.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtMoney(x, currency = "USD") {
  if (typeof x !== "number" || !Number.isFinite(x)) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(x);
  } catch (_) {
    const sign = x < 0 ? "-" : "";
    return `${sign}${currency} ${fmtNum(Math.abs(x), 2)}`;
  }
}

function drawLineChart(canvas, xs, ys) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600;
  const h = canvas.clientHeight || 260;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, w, h);
  ctx.globalAlpha = 1;

  if (!xs.length || !ys.length || xs.length !== ys.length) return;

  const pad = 26;
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);

  const dx = xMax - xMin || 1;
  const dy = yMax - yMin || 1;

  // axes
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, h - pad);
  ctx.lineTo(w - pad, h - pad);
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, h - pad);
  ctx.stroke();

  // polyline
  ctx.strokeStyle = "rgba(122,168,255,0.85)";
  ctx.lineWidth = 2;
  ctx.beginPath();

  for (let i = 0; i < xs.length; i++) {
    const x = pad + ((xs[i] - xMin) / dx) * (w - pad * 2);
    const y = h - pad - ((ys[i] - yMin) / dy) * (h - pad * 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // zero line (if within bounds)
  if (yMin < 0 && yMax > 0) {
    const y0 = h - pad - ((0 - yMin) / dy) * (h - pad * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, y0);
    ctx.lineTo(w - pad, y0);
    ctx.stroke();
  }
}

function drawBarChart(canvas, xs, ys) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600;
  const h = canvas.clientHeight || 260;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  if (!xs.length || !ys.length || xs.length !== ys.length) return;

  const pad = 26;
  const yMin = Math.min(...ys, 0);
  const yMax = Math.max(...ys, 0);
  const dy = yMax - yMin || 1;

  // axes
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, h - pad);
  ctx.lineTo(w - pad, h - pad);
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, h - pad);
  ctx.stroke();

  const barW = (w - pad * 2) / xs.length;
  const y0 = h - pad - ((0 - yMin) / dy) * (h - pad * 2);

  for (let i = 0; i < xs.length; i++) {
    const v = ys[i];
    const x = pad + i * barW;
    const yv = h - pad - ((v - yMin) / dy) * (h - pad * 2);
    const top = Math.min(yv, y0);
    const height = Math.abs(y0 - yv);
    ctx.fillStyle = v >= 0 ? "rgba(92,204,150,0.70)" : "rgba(255,90,122,0.70)";
    ctx.fillRect(x + 2, top, Math.max(1, barW - 4), height);
  }

  // zero line
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, y0);
  ctx.lineTo(w - pad, y0);
  ctx.stroke();
}

function normalizeCashflowsInput(txt) {
  const raw = String(txt || "")
    .trim()
    .split(/\s*,\s*|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const cfs = raw.map((s) => Number(s)).filter((x) => Number.isFinite(x));
  return cfs;
}

function renderCashflowEditor(state) {
  const rows = state.cashflows
    .map((cf, i) => {
      return `
        <div class="trow" style="grid-template-columns: 0.25fr 1fr 0.25fr; align-items: center;">
          <div class="tcell mono">${i}</div>
          <div class="tcell">
            <input class="control" type="number" step="0.01" value="${cf}" data-cf-idx="${i}" />
          </div>
          <div class="tcell muted" style="font-size: 12px;">Year ${i}</div>
        </div>
      `;
    })
    .join("");

  return `
    <div class="table" id="cbCashflowTable" style="margin-top: 8px;">
      <div class="trow thead" style="grid-template-columns: 0.25fr 1fr 0.25fr;">
        <div class="tcell label">t</div>
        <div class="tcell label">Cash flow</div>
        <div class="tcell label">Note</div>
      </div>
      ${rows}
    </div>
  `;
}

function renderOutput(result) {
  if (!result) {
    return `<div class="muted" style="font-size: 12.5px;">Compute to see NPV / IRR / payback.</div>`;
  }

  const notes = (result.notes || [])
    .map((n) => `<li>${String(n)}</li>`)
    .join("");

  const irrText = result.irr != null ? toPct(result.irr, 2) : "—";
  const mirrText = result.mirr != null ? toPct(result.mirr, 2) : "—";
  const piText = result.profitability_index != null ? fmtNum(result.profitability_index, 4) : "—";
  const pbText = result.payback_period != null ? `${fmtNum(result.payback_period, 2)} yrs` : "—";
  const dpbText =
    result.discounted_payback_period != null ? `${fmtNum(result.discounted_payback_period, 2)} yrs` : "—";

  // Sensitivity table
  const rs = result.sensitivity?.rate_shifts || [];
  const ss = result.sensitivity?.scale_shifts || [];
  const grid = result.sensitivity?.npv_grid || [];

  const sensHeader = rs
    .map((d) => `<div class="tcell mono">${d >= 0 ? "+" : ""}${(d * 100).toFixed(0)}bp</div>`)
    .join("");

  const sensRows = ss
    .map((s, i) => {
      const row = (grid[i] || [])
        .map((v) => `<div class="tcell mono">${fmtNum(v, 2)}</div>`)
        .join("");
      return `
        <div class="trow" style="grid-template-columns: 0.7fr repeat(${rs.length}, 1fr);">
          <div class="tcell mono">${s >= 0 ? "+" : ""}${(s * 100).toFixed(0)}%</div>
          ${row}
        </div>
      `;
    })
    .join("");

  return `
    <div class="kpis" id="capbudKpis">
      <div class="kpi">
        <div class="kpi__label">NPV</div>
        <div class="kpi__value mono">${fmtNum(result.npv, 2)}</div>
      </div>
      <div class="kpi">
        <div class="kpi__label">IRR</div>
        <div class="kpi__value mono">${irrText}</div>
      </div>
      <div class="kpi">
        <div class="kpi__label">MIRR</div>
        <div class="kpi__value mono">${mirrText}</div>
      </div>
      <div class="kpi">
        <div class="kpi__label">Profitability Index</div>
        <div class="kpi__value mono">${piText}</div>
      </div>
    </div>

    <div class="table" style="margin-top: 10px;">
      <div class="trow">
        <div class="tcell label">Payback</div>
        <div class="tcell mono">${pbText}</div>
      </div>
      <div class="trow">
        <div class="tcell label">Discounted payback</div>
        <div class="tcell mono">${dpbText}</div>
      </div>
      <div class="trow">
        <div class="tcell label">Decision</div>
        <div class="tcell">${String(result.decision || "—")}</div>
      </div>
    </div>

    <div class="grid" style="gap: 10px; margin-top: 10px;">
      <div class="card card--tight" style="margin: 0;">
        <div class="card__header" style="padding-bottom: 6px;">
          <h3>Cashflow chart</h3>
          <p class="card__hint">Project cashflows by year (green=inflows, red=outflows)</p>
        </div>
        <canvas id="cbCashflowChart" class="chart"></canvas>
      </div>

      <div class="card card--tight" style="margin: 0;">
        <div class="card__header" style="padding-bottom: 6px;">
          <h3>NPV profile</h3>
          <p class="card__hint">NPV vs discount rate (0% → 30%+)</p>
        </div>
        <canvas id="cbNpvChart" class="chart"></canvas>
      </div>
    </div>

    <div class="card" id="cbSensitivityCard" style="margin-top: 10px;">
      <div class="card__header" style="padding-bottom: 6px;">
        <h3>Sensitivity</h3>
        <p class="card__hint">NPV sensitivity to discount rate (columns) and cashflow scale (rows)</p>
      </div>

      <div class="table" style="grid-template-columns: 0.7fr repeat(${rs.length}, 1fr);">
        <div class="trow thead" style="grid-template-columns: 0.7fr repeat(${rs.length}, 1fr);">
          <div class="tcell label">CF scale</div>
          ${sensHeader}
        </div>
        ${sensRows || `<div class="trow"><div class="tcell muted">No sensitivity grid</div><div class="tcell"></div></div>`}
      </div>
    </div>

    <div class="card" style="margin-top: 10px;">
      <div class="card__header" style="padding-bottom: 6px;">
        <h3>Notes</h3>
        <p class="card__hint">Edge cases & interpretation</p>
      </div>
      <ul class="muted" style="margin: 0; padding-left: 18px; font-size: 12.5px; line-height: 1.45;">
        ${notes || "<li>No notes</li>"}
      </ul>
    </div>

    <div class="muted" style="margin-top: 12px; font-size: 12.5px;">
      Saved in <a href="/runs" data-link>Runs</a> as <span class="mono">capbud.compute</span>.
    </div>
  `;
}

function defaultState() {
  return {
    project_name: "Expansion Project",
    currency: "USD",
    discount_rate: 0.1,
    convention: "end_of_period",
    finance_rate: "",
    reinvest_rate: "",
    // A small, interview-friendly project: initial outlay + 5 years of inflows
    cashflows: [-1000, 300, 300, 300, 300, 300],
  };
}

export function renderCapBud(viewEl) {
  let state = defaultState();

  const draft = consumeDraft("/capbud");
  if (draft?.payload) {
    state = {
      ...state,
      ...draft.payload,
      cashflows: Array.isArray(draft.payload.cashflows) ? draft.payload.cashflows : state.cashflows,
    };
  }

  mountHtml(
    viewEl,
    `
      <section class="grid grid--twoone">
        <div class="card">
          <div class="card__header">
            <h2>Capital Budgeting</h2>
            <p class="card__hint">NPV / IRR / MIRR / Payback + NPV profile & sensitivity</p>
          </div>

          <div class="row" style="gap: 10px; flex-wrap: wrap;">
            <button class="btn" id="capbudDemo" type="button">Demo this page</button>
            <button class="btn btn--ghost" id="cbLoadSample" type="button">Load sample</button>
            <button class="btn btn--ghost" id="cbAddYear" type="button">Add year</button>
            <button class="btn btn--ghost" id="cbRemoveYear" type="button">Remove year</button>
          </div>

          <form id="capbudForm" class="form" style="margin-top: 12px;">
            <div class="grid" style="grid-template-columns: 1.4fr 0.7fr 0.7fr; gap: 10px;">
              <div class="field">
                <label>Project name</label>
                <input id="cbProject" type="text" value="${state.project_name}" />
              </div>

              <div class="field">
                <label>Currency</label>
                <select id="cbCurrency">
                  <option value="USD">USD</option>
                  <option value="INR">INR</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                </select>
              </div>

              <div class="field">
                <label>Discount rate (decimal)</label>
                <input id="cbDiscount" type="number" step="0.001" value="${state.discount_rate}" />
              </div>
            </div>

            <details id="cbWaccDetails" style="margin-top: 10px;">
              <summary class="muted" style="cursor: pointer; font-size: 12.5px;">WACC helper (optional)</summary>
              <div class="muted" style="margin-top: 8px; font-size: 12.5px;">
                Compute a quick WACC and optionally use it as your discount rate.
              </div>

              <div class="grid" style="grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 10px;">
                <div class="field">
                  <label>Cost of equity (Re)</label>
                  <input id="cbRe" type="number" step="0.001" value="0.12" />
                </div>
                <div class="field">
                  <label>Cost of debt (Rd)</label>
                  <input id="cbRd" type="number" step="0.001" value="0.06" />
                </div>
                <div class="field">
                  <label>Tax rate (T)</label>
                  <input id="cbTaxRate" type="number" step="0.001" value="0.25" />
                </div>
                <div class="field">
                  <label>Equity weight (wE)</label>
                  <input id="cbWe" type="number" step="0.01" value="0.6" />
                </div>
                <div class="field">
                  <label>Debt weight (wD)</label>
                  <input id="cbWd" type="number" step="0.01" value="0.4" />
                </div>
                <div class="field">
                  <label>WACC</label>
                  <input id="cbWaccOut" class="control" type="text" readonly value="" placeholder="—" />
                </div>
              </div>

              <div class="row" style="gap: 10px; margin-top: 10px;">
                <button class="btn btn--ghost" id="cbCalcWacc" type="button">Compute WACC</button>
                <button class="btn btn--ghost" id="cbUseWacc" type="button">Use WACC as discount rate</button>
              </div>
            </details>

            <div class="grid" style="grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-top: 10px;">
              <div class="field">
                <label>Convention</label>
                <select id="cbConvention">
                  <option value="end_of_period">End of period</option>
                  <option value="mid_year">Mid-year</option>
                </select>
              </div>

              <div class="field">
                <label>Finance rate (MIRR, optional)</label>
                <input id="cbFinance" type="number" step="0.001" placeholder="Defaults to discount rate" value="${state.finance_rate}" />
              </div>

              <div class="field">
                <label>Reinvest rate (MIRR, optional)</label>
                <input id="cbReinvest" type="number" step="0.001" placeholder="Defaults to discount rate" value="${state.reinvest_rate}" />
              </div>
            </div>

            <div class="muted" style="margin-top: 10px; font-size: 12.5px;">
              Cashflows are annual and start at <span class="mono">t=0</span> (initial investment). Use negative numbers for outflows.
            </div>

            <div id="cbCashflowEditor">${renderCashflowEditor(state)}</div>

            <div class="field" style="margin-top: 10px;">
              <label>Quick paste (comma or newline separated)</label>
              <textarea id="cbPaste" rows="3" placeholder="-1000, 300, 300, 300, 300, 300"></textarea>
            </div>

            <div class="row" style="gap: 10px; margin-top: 12px;">
              <button class="btn btn--primary" id="cbCompute" type="button">
                <span class="spinner" aria-hidden="true"></span>
                <span class="btn__label">Compute</span>
              </button>
              <button class="btn btn--ghost" id="cbClear" type="button">Clear output</button>
            </div>
          </form>

          <div class="error" id="cbError" hidden></div>
        </div>

        <div class="card">
          <div class="card__header">
            <h2>Output</h2>
            <p class="card__hint">Saved automatically to Runs</p>
          </div>

          <div id="capbudOutput" class="stack"></div>
        </div>
      </section>
    `
  );

  // Set dropdown defaults
  const curSel = document.getElementById("cbCurrency");
  const convSel = document.getElementById("cbConvention");
  if (curSel) curSel.value = state.currency;
  if (convSel) convSel.value = state.convention;

  const editorHost = document.getElementById("cbCashflowEditor");
  const outEl = document.getElementById("capbudOutput");
  const errEl = document.getElementById("cbError");
  const computeBtn = document.getElementById("cbCompute");

  function computeWacc() {
    const re = Number(document.getElementById("cbRe")?.value);
    const rd = Number(document.getElementById("cbRd")?.value);
    const tax = Number(document.getElementById("cbTaxRate")?.value);
    let wE = Number(document.getElementById("cbWe")?.value);
    let wD = Number(document.getElementById("cbWd")?.value);

    if (![re, rd, tax, wE, wD].every((x) => Number.isFinite(x))) {
      toast("Enter Re, Rd, tax rate and weights", "warn");
      return null;
    }

    const sum = wE + wD;
    if (sum <= 0) {
      toast("Weights must be > 0", "warn");
      return null;
    }

    // Normalize if the user didn't make them sum to 1
    if (Math.abs(sum - 1) > 1e-6) {
      wE = wE / sum;
      wD = wD / sum;
    }

    const wacc = wE * re + wD * rd * (1 - tax);
    const out = document.getElementById("cbWaccOut");
    if (out) out.value = `${toPct(wacc, 2)} (${wacc.toFixed(4)})`;
    return wacc;
  }

  document.getElementById("cbCalcWacc")?.addEventListener("click", () => {
    const w = computeWacc();
    if (w != null) toast("WACC computed", "success");
  });

  document.getElementById("cbUseWacc")?.addEventListener("click", () => {
    const w = computeWacc();
    if (w == null) return;
    const dr = document.getElementById("cbDiscount");
    if (dr) dr.value = String(Number(w.toFixed(4)));
    state.discount_rate = w;
    toast("Discount rate updated from WACC", "success");
  });

  function syncStateFromForm() {
    const pn = document.getElementById("cbProject");
    const dr = document.getElementById("cbDiscount");
    const fr = document.getElementById("cbFinance");
    const rr = document.getElementById("cbReinvest");

    state.project_name = pn?.value || state.project_name;
    state.currency = curSel?.value || state.currency;
    state.convention = convSel?.value || state.convention;
    state.discount_rate = Number(dr?.value);
    state.finance_rate = fr?.value || "";
    state.reinvest_rate = rr?.value || "";
  }

  function rerenderCashflows() {
    if (!editorHost) return;
    editorHost.innerHTML = renderCashflowEditor(state);
  }

  // Update state when cashflow inputs change
  viewEl.addEventListener("input", (e) => {
    const inp = e.target.closest("input[data-cf-idx]");
    if (!inp) return;
    const idx = Number(inp.getAttribute("data-cf-idx"));
    if (!Number.isFinite(idx)) return;
    const v = Number(inp.value);
    if (Number.isFinite(v)) state.cashflows[idx] = v;
  });

  document.getElementById("cbAddYear")?.addEventListener("click", () => {
    state.cashflows.push(0);
    rerenderCashflows();
  });

  document.getElementById("cbRemoveYear")?.addEventListener("click", () => {
    if (state.cashflows.length <= 2) {
      toast("Need at least t=0 and t=1", "warn");
      return;
    }
    state.cashflows.pop();
    rerenderCashflows();
  });

  document.getElementById("cbLoadSample")?.addEventListener("click", () => {
    state = {
      ...state,
      project_name: "Expansion Project",
      discount_rate: 0.1,
      convention: "end_of_period",
      finance_rate: "",
      reinvest_rate: "",
      cashflows: [-1000, 300, 300, 300, 300, 300],
    };

    // Sync form
    document.getElementById("cbProject").value = state.project_name;
    document.getElementById("cbDiscount").value = String(state.discount_rate);
    curSel.value = state.currency;
    convSel.value = state.convention;
    document.getElementById("cbFinance").value = "";
    document.getElementById("cbReinvest").value = "";

    rerenderCashflows();
    toast("Sample loaded", "success");
  });

  document.getElementById("cbClear")?.addEventListener("click", () => {
    outEl.innerHTML = `<div class="muted" style="font-size: 12.5px;">Compute to see output.</div>`;
    toast("Output cleared", "info");
  });

  // Quick paste
  document.getElementById("cbPaste")?.addEventListener("change", (e) => {
    const txt = e.target.value;
    const cfs = normalizeCashflowsInput(txt);
    if (cfs.length < 2) {
      toast("Paste at least two cashflows", "warn");
      return;
    }
    state.cashflows = cfs;
    rerenderCashflows();
    toast("Cashflows updated", "success");
  });

  async function compute() {
    clearError(errEl);
    setLoading(computeBtn, true);
    syncStateFromForm();

    try {
      const payload = {
        project_name: state.project_name,
        currency: state.currency,
        discount_rate: Number(state.discount_rate),
        cashflows: state.cashflows.map((x) => Number(x)),
        convention: state.convention,
      };

      if (state.finance_rate !== "") payload.finance_rate = Number(state.finance_rate);
      if (state.reinvest_rate !== "") payload.reinvest_rate = Number(state.reinvest_rate);

      const res = await postJson("/api/v1/capbud/compute", payload);
      outEl.innerHTML = renderOutput(res);

      // Charts
      const years = res.cashflow_table?.years || [];
      const cfs = res.cashflow_table?.cashflows || [];
      drawBarChart(document.getElementById("cbCashflowChart"), years, cfs);

      const rates = (res.npv_profile?.rates || []).map((x) => x * 100); // % for x-axis
      const npvs = res.npv_profile?.npvs || [];
      drawLineChart(document.getElementById("cbNpvChart"), rates, npvs);

      toast("Computed and saved", "success");
      window.dispatchEvent(new CustomEvent("capbud:computed", { detail: { run_id: res.run_id } }));
    } catch (e) {
      showError(errEl, e?.message ? String(e.message) : "Failed to compute");
    } finally {
      setLoading(computeBtn, false);
    }
  }

  computeBtn?.addEventListener("click", compute);

  // Demo button inside the page
  document.getElementById("capbudDemo")?.addEventListener("click", () => {
    if (window.__ux_ctx?.startAutopilot) {
      window.__ux_ctx.startAutopilot("capbud");
    } else {
      toast("Demo system not ready", "warn");
    }
  });

  // Initial output
  outEl.innerHTML = `<div class="muted" style="font-size: 12.5px;">Compute to see output.</div>`;
}
