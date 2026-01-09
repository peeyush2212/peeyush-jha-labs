import {
  clearError,
  consumeDraft,
  fmt,
  getJson,
  mountHtml,
  postJson,
  setLoading,
  showError,
  toast,
} from "./shared.js";

function readNumber(inputEl) {
  const v = parseFloat(inputEl.value);
  return Number.isFinite(v) ? v : null;
}

function buildRequest(fields) {
  const base = {
    option_type: fields.optionType.value,
    quantity: readNumber(fields.quantity),
    spot: readNumber(fields.spot),
    strike: readNumber(fields.strike),
    rate: readNumber(fields.rate),
    dividend_yield: readNumber(fields.dividend),
    vol: readNumber(fields.vol),
    time_to_expiry: readNumber(fields.tte),
  };

  const shocks = {
    spot_shift_pct: readNumber(fields.spotShock),
    vol_shift: readNumber(fields.volShock),
    rate_shift_bps: readNumber(fields.rateShock),
  };

  // Null checks
  for (const [k, v] of Object.entries(base)) {
    if (v === null && k !== "option_type") throw new Error(`Missing or invalid number: base.${k}`);
  }
  for (const [k, v] of Object.entries(shocks)) {
    if (v === null) throw new Error(`Missing or invalid number: shocks.${k}`);
  }

  return { base, shocks };
}

function renderSide(outEl, title, json) {
  const g = json.greeks;
  outEl.innerHTML = `
    <div class="mini-card__title">${title}</div>
    <div class="kpis" style="margin-top: 10px;">
      <div class="kpi">
        <div class="kpi__label">Price / unit</div>
        <div class="kpi__value">${fmt(json.price_per_unit)}</div>
      </div>
      <div class="kpi">
        <div class="kpi__label">Price total</div>
        <div class="kpi__value">${fmt(json.price_total)}</div>
      </div>
    </div>

    <div class="section" style="margin-top: 12px;">
      <h3 style="margin: 0 0 10px;">Greeks</h3>
      <div class="table">
        <div class="trow"><div class="tcell label">Delta</div><div class="tcell mono">${fmt(g.delta)}</div></div>
        <div class="trow"><div class="tcell label">Gamma</div><div class="tcell mono">${fmt(g.gamma)}</div></div>
        <div class="trow"><div class="tcell label">Vega</div><div class="tcell mono">${fmt(g.vega)}</div></div>
        <div class="trow"><div class="tcell label">Theta</div><div class="tcell mono">${fmt(g.theta)}</div></div>
        <div class="trow"><div class="tcell label">Rho</div><div class="tcell mono">${fmt(g.rho)}</div></div>
      </div>
    </div>
  `;
}

function renderDiff(diffEl, diff) {
  const g = diff.greeks;
  const sign = (x) => (x > 0 ? "+" : "");
  diffEl.innerHTML = `
    <div class="mini-card__title">Δ (shocked − base)</div>
    <div class="kpis" style="margin-top: 10px;">
      <div class="kpi">
        <div class="kpi__label">Price / unit</div>
        <div class="kpi__value mono">${sign(diff.price_per_unit)}${fmt(diff.price_per_unit)}</div>
      </div>
      <div class="kpi">
        <div class="kpi__label">Price total</div>
        <div class="kpi__value mono">${sign(diff.price_total)}${fmt(diff.price_total)}</div>
      </div>
    </div>

    <div class="section" style="margin-top: 12px;">
      <h3 style="margin: 0 0 10px;">Greeks Δ</h3>
      <div class="table">
        <div class="trow"><div class="tcell label">Delta</div><div class="tcell mono">${sign(g.delta)}${fmt(g.delta)}</div></div>
        <div class="trow"><div class="tcell label">Gamma</div><div class="tcell mono">${sign(g.gamma)}${fmt(g.gamma)}</div></div>
        <div class="trow"><div class="tcell label">Vega</div><div class="tcell mono">${sign(g.vega)}${fmt(g.vega)}</div></div>
        <div class="trow"><div class="tcell label">Theta</div><div class="tcell mono">${sign(g.theta)}${fmt(g.theta)}</div></div>
        <div class="trow"><div class="tcell label">Rho</div><div class="tcell mono">${sign(g.rho)}${fmt(g.rho)}</div></div>
      </div>
    </div>
  `;
}

async function loadRecentRuns(listEl, errorEl) {
  try {
    const data = await getJson("/api/v1/runs?limit=8&run_type=scenario_vanilla");
    if (!data.items.length) {
      listEl.innerHTML = `<div class="muted" style="font-size: 12.5px;">No scenario runs yet.</div>`;
      return;
    }
    listEl.innerHTML = `
      <div class="runs-list">
        ${data.items
          .map(
            (r) => `
          <a class="run-pill" href="/runs?run_id=${encodeURIComponent(r.run_id)}" data-link>
            <span class="mono">${r.run_id.slice(0, 8)}</span>
            <span class="muted">•</span>
            <span class="muted">${r.created_at.replace("T", " ").slice(0, 19)}</span>
          </a>
        `
          )
          .join("")}
      </div>
    `;
  } catch (e) {
    showError(errorEl, e?.message ? String(e.message) : "Failed to load recent runs");
  }
}

export function renderScenario(viewEl) {
  mountHtml(
    viewEl,
    `
      <section class="grid grid--twoone">
        <div class="card">
          <div class="card__header">
            <h2>Scenario reprice</h2>
            <p class="card__hint">Base inputs + shocks → base vs shocked outputs</p>
          </div>

          <form class="form" id="scenarioForm">
            <div class="row">
              <label class="label">
                Option type
                <select class="control" id="optionType">
                  <option value="call">Call</option>
                  <option value="put">Put</option>
                </select>
              </label>

              <label class="label">
                Quantity
                <input class="control" id="quantity" type="number" step="0.01" value="10" />
              </label>
            </div>

            <div class="row">
              <label class="label">
                Spot
                <input class="control" id="spot" type="number" step="0.0001" value="100" />
              </label>
              <label class="label">
                Strike
                <input class="control" id="strike" type="number" step="0.0001" value="100" />
              </label>
            </div>

            <div class="row">
              <label class="label">
                Rate (cc)
                <input class="control" id="rate" type="number" step="0.0001" value="0.04" />
              </label>
              <label class="label">
                Dividend (cc)
                <input class="control" id="dividend" type="number" step="0.0001" value="0" />
              </label>
            </div>

            <div class="row">
              <label class="label">
                Vol
                <input class="control" id="vol" type="number" step="0.0001" value="0.22" />
              </label>
              <label class="label">
                Time (years)
                <input class="control" id="tte" type="number" step="0.0001" value="0.75" />
              </label>
            </div>

            <div class="divider"></div>

            <div class="row">
              <label class="label">
                Spot shock (%)
                <input class="control" id="spotShock" type="number" step="0.01" value="5" />
              </label>
              <label class="label">
                Vol shock (abs)
                <input class="control" id="volShock" type="number" step="0.0001" value="0.01" />
              </label>
            </div>

            <div class="row">
              <label class="label">
                Rate shock (bps)
                <input class="control" id="rateShock" type="number" step="1" value="25" />
              </label>
              <div class="hint">
                <div class="hint__label">Note</div>
                <div class="hint__text">Spot uses percent; rate uses basis points; vol is absolute.</div>
              </div>
            </div>

            <div class="actions">
              <button class="btn btn--primary" id="runBtn" type="submit">
                <span class="spinner" aria-hidden="true"></span>
                <span class="btn__label">Run scenario</span>
              </button>
              <a class="btn" href="/runs" data-link>View runs</a>
            </div>

            <div class="error" id="errorBox" hidden></div>
          </form>
        </div>

        <div class="card">
          <div class="card__header">
            <h2>Results</h2>
            <p class="card__hint">Base • shocked • delta • raw JSON</p>
          </div>

          <div class="empty" id="emptyState">
            <div class="empty__icon">↗</div>
            <div>
              <div class="empty__title">No run yet</div>
              <div class="empty__text">Run a scenario to see outputs here.</div>
            </div>
          </div>

          <div id="results" hidden>
            <div class="kpis">
              <div class="kpi">
                <div class="kpi__label">Run ID</div>
                <div class="kpi__value mono" id="runId">—</div>
              </div>
            </div>

            <div class="mini-grid">
              <div class="mini-card" id="baseBox"></div>
              <div class="mini-card" id="shockedBox"></div>
              <div class="mini-card" id="diffBox"></div>
            </div>

            <details class="raw" style="margin-top: 12px;">
              <summary>Raw JSON</summary>
              <pre id="rawJson"></pre>
            </details>

            <div class="actions" style="margin-top: 12px;">
              <button class="btn" id="copyBtn" type="button">Copy JSON</button>
            </div>

            <div class="divider" style="margin: 18px 0;"></div>

            <div>
              <div class="muted" style="font-size: 12.5px; margin-bottom: 8px;">Recent scenario runs</div>
              <div id="recentRuns"></div>
              <div class="error" id="recentErr" hidden></div>
            </div>
          </div>
        </div>
      </section>
    `
  );
const draft = consumeDraft("/scenario");
if (draft?.payload) {
  try {
    const base = draft.payload.base || {};
    const shocks = draft.payload.shocks || {};
    const setVal = (id, v) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = String(v ?? el.value);
    };

    setVal("optionType", base.option_type ?? "call");
    setVal("quantity", base.quantity ?? 1);
    setVal("spot", base.spot ?? 100);
    setVal("strike", base.strike ?? 100);
    setVal("rate", base.rate ?? 0.02);
    setVal("dividend", base.dividend_yield ?? 0.0);
    setVal("vol", base.vol ?? 0.2);
    setVal("tte", base.time_to_expiry ?? 1.0);

    setVal("spotShock", shocks.spot_shift_pct ?? 0.0);
    setVal("volShock", shocks.vol_shift ?? 0.0);
    setVal("rateShock", shocks.rate_shift_bps ?? 0.0);

    toast("Draft loaded from Runs", "success");
  } catch (_) {
    // ignore
  }
}



  const form = document.getElementById("scenarioForm");
  const runBtn = document.getElementById("runBtn");
  const errorBox = document.getElementById("errorBox");

  const out = {
    emptyState: document.getElementById("emptyState"),
    results: document.getElementById("results"),
    runId: document.getElementById("runId"),
    baseBox: document.getElementById("baseBox"),
    shockedBox: document.getElementById("shockedBox"),
    diffBox: document.getElementById("diffBox"),
    rawJson: document.getElementById("rawJson"),
    recentRuns: document.getElementById("recentRuns"),
    recentErr: document.getElementById("recentErr"),
  };

  const fields = {
    optionType: document.getElementById("optionType"),
    quantity: document.getElementById("quantity"),
    spot: document.getElementById("spot"),
    strike: document.getElementById("strike"),
    rate: document.getElementById("rate"),
    dividend: document.getElementById("dividend"),
    vol: document.getElementById("vol"),
    tte: document.getElementById("tte"),
    spotShock: document.getElementById("spotShock"),
    volShock: document.getElementById("volShock"),
    rateShock: document.getElementById("rateShock"),
  };

  let lastPayload = null;

  async function run() {
    clearError(errorBox);
    setLoading(runBtn, true);

    try {
      const req = buildRequest(fields);
      const data = await postJson("/api/v1/scenario/vanilla-reprice", req);
      window.dispatchEvent(new CustomEvent("scenario:computed", { detail: { run_id: data.run_id || null } }));
      lastPayload = data;

      out.runId.textContent = data.run_id;
      renderSide(out.baseBox, "Base", data.base);
      renderSide(out.shockedBox, "Shocked", data.shocked);
      renderDiff(out.diffBox, data.diff);
      out.rawJson.textContent = JSON.stringify(data, null, 2);

      out.emptyState.hidden = true;
      out.results.hidden = false;

      clearError(out.recentErr);
      await loadRecentRuns(out.recentRuns, out.recentErr);
    } catch (e) {
      showError(errorBox, e?.message ? String(e.message) : "Something went wrong");
    } finally {
      setLoading(runBtn, false);
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    run();
  });

  document.getElementById("copyBtn").addEventListener("click", async () => {
    if (!lastPayload) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(lastPayload, null, 2));
    } catch (e) {
      showError(errorBox, "Copy failed (clipboard permissions)");
    }
  });

  loadRecentRuns(out.recentRuns, out.recentErr);
}
