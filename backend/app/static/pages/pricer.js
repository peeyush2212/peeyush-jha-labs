import { clearError, consumeDraft, fmt, getJson, mountHtml, postJson, setLoading, showError, toast } from "./shared.js";

let CATALOG = null;

async function loadCatalog() {
  if (CATALOG) return CATALOG;
  CATALOG = await getJson("/api/v1/meta/instruments");
  return CATALOG;
}

function byKey(list, key) {
  return (list || []).find((x) => x.key === key) || null;
}

function ensureDefaults(state, instrumentDef, methodDef) {
  // Ensure market defaults
  state.market = state.market || {};
  for (const p of CATALOG.market_params) {
    if (state.market[p.key] === undefined) state.market[p.key] = p.default;
  }

  // Ensure quantity default
  if (state.quantity === undefined) state.quantity = 1;

  // Ensure params defaults (base + method extra)
  state.params = state.params || {};
  const allParams = [...(instrumentDef?.base_params || []), ...(methodDef?.extra_params || [])];
  for (const p of allParams) {
    if (state.params[p.key] === undefined) state.params[p.key] = p.default;
  }
}

function renderParamInput(prefix, def, value) {
  const id = `${prefix}_${def.key}`;
  const label = def.label;
  if (def.type === "select") {
    const opts = (def.options || [])
      .map((o) => `<option value="${o.value}">${o.label}</option>`)
      .join("");
    return `
      <div class="field">
        <label for="${id}">${label}</label>
        <select id="${id}" data-k="${def.key}">
          ${opts}
        </select>
      </div>
    `;
  }

  // number
  const step = def.step ?? "any";
  const min = def.min ?? "";
  const max = def.max ?? "";
  return `
    <div class="field">
      <label for="${id}">${label}</label>
      <input id="${id}" data-k="${def.key}" type="number" step="${step}" min="${min}" max="${max}" value="${value}" />
    </div>
  `;
}

function renderResultBox(result) {
  if (!result) {
    return `<div class="muted" style="font-size: 12.5px;">Run a price to see output.</div>`;
  }

  if (result.status !== "ok") {
    return `
      <div class="error-box">${result.error || "Pricing failed"}</div>
    `;
  }

  const g = result.greeks || {};
  return `
    <div class="result-grid">
      <div class="kv"><div class="muted">Price / unit</div><div class="mono">${fmt(result.price_per_unit)}</div></div>
      <div class="kv"><div class="muted">Price total</div><div class="mono">${fmt(result.price_total)}</div></div>
      <div class="kv"><div class="muted">Delta</div><div class="mono">${fmt(g.delta)}</div></div>
      <div class="kv"><div class="muted">Gamma</div><div class="mono">${fmt(g.gamma)}</div></div>
      <div class="kv"><div class="muted">Vega</div><div class="mono">${fmt(g.vega)}</div></div>
      <div class="kv"><div class="muted">Theta</div><div class="mono">${fmt(g.theta)}</div></div>
      <div class="kv"><div class="muted">Rho</div><div class="mono">${fmt(g.rho)}</div></div>
    </div>
  `;
}

export function renderPricer(viewEl) {
  mountHtml(
    viewEl,
    `
      <section class="grid">
        <div class="card">
          <div class="card__header">
            <h2>Instrument pricer</h2>
            <p class="card__hint">Choose an instrument, pick a method, enter inputs → get a result.</p>
          </div>

          <div id="pricerError" class="error-box" hidden></div>
          <div id="pricerForm" class="pricer-form">
            <div class="muted" style="font-size: 12.5px;">Loading…</div>
          </div>
        </div>

        <div class="card">
          <div class="card__header">
            <h2>Output</h2>
            <p class="card__hint">Prices + Greeks (Greeks may be finite-difference estimates for some methods).</p>
          </div>
          <div id="pricerOutput">Loading…</div>
          <div class="muted" style="margin-top: 10px; font-size: 12.5px;">Saved in <a href="/runs" data-link>Runs</a>.</div>
        </div>
      </section>
    `
  );

  const state = {
    instrument: "vanilla",
    method: "black_scholes",
    quantity: 1,
    market: { spot: 100, rate: 0.02, dividend_yield: 0.0, vol: 0.2 },
    params: { option_type: "call", strike: 100, time_to_expiry: 1.0 },
    last: null,
  };

// If a run was cloned from the Runs page, apply it as a draft.
const draft = consumeDraft("/pricer");
if (draft?.payload) {
  Object.assign(state, draft.payload);
  toast("Draft loaded from Runs", "success");
}


  const errEl = document.getElementById("pricerError");
  const formEl = document.getElementById("pricerForm");
  const outEl = document.getElementById("pricerOutput");

  function render(catalog) {
    const instrumentDef = byKey(catalog.instruments, state.instrument) || catalog.instruments[0];
    const methods = instrumentDef.methods || [];
    let methodDef = byKey(methods, state.method);
    if (!methodDef) {
      state.method = methods[0]?.key;
      methodDef = byKey(methods, state.method);
    }
    ensureDefaults(state, instrumentDef, methodDef);

    // Market fields
    const marketHtml = catalog.market_params
      .map((p) => renderParamInput("mkt", p, state.market[p.key]))
      .join("");

    // Instrument select
    const instrumentOpts = catalog.instruments
      .map((inst) => `<option value="${inst.key}">${inst.label}</option>`)
      .join("");

    const methodOpts = methods.map((m) => `<option value="${m.key}">${m.label}</option>`).join("");
    const note = (methodDef?.note || "").replaceAll('"', "&quot;");

    const baseParams = instrumentDef.base_params || [];
    const extraParams = methodDef?.extra_params || [];
    const paramHtml = [...baseParams, ...extraParams]
      .map((p) => renderParamInput("p", p, state.params[p.key]))
      .join("");

    formEl.innerHTML = `
      <div class="pricer-form__top">
        <div class="pricer-topgrid">
          <div class="field">
            <label>Instrument</label>
            <select id="instSel">${instrumentOpts}</select>
          </div>

          <div class="field">
            <label>Method</label>
            <div class="row pricer-methodrow">
              <select id="methodSel" style="flex: 1;">${methodOpts}</select>
              <span class="info" data-tooltip="${note}">i</span>
            </div>
          </div>

          <div class="field">
            <label>Quantity</label>
            <input id="qty" type="number" step="0.01" value="${state.quantity}" />
          </div>
        </div>
      </div>

      <div class="pricer-form__panels">
        <div class="pricer-panel">
          <div class="pricer-panel__header">
            <h3>Parameters</h3>
            <p class="card__hint">Inputs depend on the selected instrument + method.</p>
          </div>
          <div class="form-grid form-grid--two">${paramHtml}</div>
        </div>

        <div class="pricer-panel">
          <div class="pricer-panel__header">
            <h3>Market</h3>
            <p class="card__hint">Single set of market inputs used for this instrument.</p>
          </div>
          <div class="form-grid form-grid--two">${marketHtml}</div>
        </div>
      </div>

      <div class="pricer-form__actions">
        <button id="runBtn" class="btn btn--primary" type="button">
          <span class="spinner" aria-hidden="true"></span>
          <span class="btn__label">Compute Price</span>
        </button>
        <div class="muted" style="font-size: 12.5px; line-height: 1.35;">
          Hover the <span class="mono">i</span> icon next to <b>Method</b> for methodology. Each run is saved automatically.
        </div>
      </div>
    `;

    // Set selected values
    const instSel = document.getElementById("instSel");
    const methodSel = document.getElementById("methodSel");
    instSel.value = instrumentDef.key;
    methodSel.value = state.method;

    // Bind instrument/method changes
    instSel.addEventListener("change", () => {
      state.instrument = instSel.value;
      // Reset method to first available for new instrument
      const newDef = byKey(catalog.instruments, state.instrument);
      state.method = newDef?.methods?.[0]?.key || "";
      render(catalog);
    });

    methodSel.addEventListener("change", () => {
      state.method = methodSel.value;
      render(catalog);
    });

    // Bind quantity
    document.getElementById("qty").addEventListener("input", (e) => {
      state.quantity = Number(e.target.value);
    });

    // Bind market inputs
    document.querySelectorAll("#pricerForm #mkt_spot, #pricerForm #mkt_rate, #pricerForm #mkt_dividend_yield, #pricerForm #mkt_vol").forEach((el) => {
      el.addEventListener("input", (e) => {
        const k = e.target.getAttribute("data-k");
        state.market[k] = Number(e.target.value);
      });
    });

    // Bind params inputs
    document.querySelectorAll("#pricerForm [id^='p_']").forEach((el) => {
      el.addEventListener("input", (e) => {
        const k = e.target.getAttribute("data-k");
        if (e.target.tagName === "SELECT") {
          state.params[k] = e.target.value;
        } else {
          state.params[k] = Number(e.target.value);
        }
      });
      // set value for selects (HTML string doesn't set selected by default for dynamic)
      const k = el.getAttribute("data-k");
      if (el.tagName === "SELECT") {
        el.value = String(state.params[k]);
      }
    });

    // Render output
    outEl.innerHTML = renderResultBox(state.last?.result);

    // Run
    const runBtn = document.getElementById("runBtn");
    runBtn.addEventListener("click", async () => {
      clearError(errEl);
      setLoading(runBtn, true);
      try {
        const payload = {
          market: state.market,
          leg: {
            leg_id: "single",
            instrument_type: state.instrument,
            method: state.method,
            quantity: Number(state.quantity),
            params: state.params,
          },
        };
        const data = await postJson("/api/v1/pricing/instrument", payload);
        state.last = data;
        window.dispatchEvent(new CustomEvent("pricer:computed", { detail: { run_id: data.run_id || null } }));
        outEl.innerHTML = renderResultBox(data.result);
      } catch (e) {
        showError(errEl, e.message || String(e));
      } finally {
        setLoading(runBtn, false);
      }
    });
  }

  // Load catalog then render
  loadCatalog()
    .then((catalog) => render(catalog))
    .catch((e) => {
      showError(errEl, e.message || String(e));
      formEl.innerHTML = `<div class="muted" style="font-size: 12.5px;">Failed to load catalog.</div>`;
      outEl.innerHTML = `<div class="muted" style="font-size: 12.5px;">—</div>`;
    });
}
