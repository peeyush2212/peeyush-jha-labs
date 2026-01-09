import {
  clearError,
  fmt,
  mountHtml,
  postJson,
  setLoading,
  showError,
} from "./shared.js";

function readNumber(inputEl) {
  const v = parseFloat(inputEl.value);
  return Number.isFinite(v) ? v : null;
}

function buildRequest(fields) {
  const req = {
    quantity: readNumber(fields.quantity),
    spot: readNumber(fields.spot),
    strike_long: readNumber(fields.strikeLong),
    strike_short: readNumber(fields.strikeShort),
    rate: readNumber(fields.rate),
    dividend_yield: readNumber(fields.dividend),
    vol: readNumber(fields.vol),
    time_to_expiry: readNumber(fields.tte),
  };

  for (const [k, v] of Object.entries(req)) {
    if (v === null) {
      throw new Error(`Missing or invalid number: ${k}`);
    }
  }

  if (req.strike_short <= req.strike_long) {
    throw new Error("Strike short must be greater than strike long");
  }

  return req;
}

function renderResults(out, json) {
  out.runId.textContent = json.run_id;
  out.pricePerUnit.textContent = fmt(json.price_per_unit);
  out.priceTotal.textContent = fmt(json.price_total);

  const g = json.greeks;
  out.gDelta.textContent = fmt(g.delta);
  out.gGamma.textContent = fmt(g.gamma);
  out.gVega.textContent = fmt(g.vega);
  out.gTheta.textContent = fmt(g.theta);
  out.gRho.textContent = fmt(g.rho);

  out.rawJson.textContent = JSON.stringify(json, null, 2);
  out.emptyState.hidden = true;
  out.results.hidden = false;
}

export function renderCallSpread(viewEl) {
  mountHtml(
    viewEl,
    `
      <section class="grid">
        <div class="card">
          <div class="card__header">
            <h2>Call spread</h2>
            <p class="card__hint">Long call (lower strike) • short call (higher strike)</p>
          </div>

          <form class="form" id="spreadForm">
            <div class="row">
              <label class="label">
                Quantity
                <input class="control" id="quantity" type="number" step="0.01" value="10" />
              </label>
              <label class="label">
                Spot
                <input class="control" id="spot" type="number" step="0.0001" value="100" />
              </label>
            </div>

            <div class="row">
              <label class="label">
                Strike long
                <input class="control" id="strikeLong" type="number" step="0.0001" value="95" />
              </label>
              <label class="label">
                Strike short
                <input class="control" id="strikeShort" type="number" step="0.0001" value="110" />
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

            <div class="actions">
              <button class="btn btn--primary" id="runBtn" type="submit">
                <span class="spinner" aria-hidden="true"></span>
                <span class="btn__label">Compute Price</span>
              </button>
              <button class="btn" id="exampleBtn" type="button">Example inputs</button>
            </div>

            <div class="error" id="errorBox" hidden></div>
          </form>
        </div>

        <div class="card">
          <div class="card__header">
            <h2>Results</h2>
            <p class="card__hint">Run ID • KPIs • raw JSON</p>
          </div>

          <div class="empty" id="emptyState">
            <div class="empty__icon">↗</div>
            <div>
              <div class="empty__title">No run yet</div>
              <div class="empty__text">Run a set of inputs to see outputs here.</div>
            </div>
          </div>

          <div class="results" id="results" hidden>
            <div class="kpis">
              <div class="kpi">
                <div class="kpi__label">Run ID</div>
                <div class="kpi__value mono" id="runId">—</div>
              </div>
              <div class="kpi">
                <div class="kpi__label">Price / unit</div>
                <div class="kpi__value" id="pricePerUnit">—</div>
              </div>
              <div class="kpi">
                <div class="kpi__label">Price total</div>
                <div class="kpi__value" id="priceTotal">—</div>
              </div>
            </div>

            <div class="section">
              <h3>Greeks</h3>
              <div class="table">
                <div class="trow"><div class="tcell label">Delta</div><div class="tcell mono" id="gDelta">—</div></div>
                <div class="trow"><div class="tcell label">Gamma</div><div class="tcell mono" id="gGamma">—</div></div>
                <div class="trow"><div class="tcell label">Vega</div><div class="tcell mono" id="gVega">—</div></div>
                <div class="trow"><div class="tcell label">Theta (per year)</div><div class="tcell mono" id="gTheta">—</div></div>
                <div class="trow"><div class="tcell label">Rho</div><div class="tcell mono" id="gRho">—</div></div>
              </div>
            </div>

            <details class="raw">
              <summary>Raw JSON</summary>
              <pre id="rawJson"></pre>
            </details>

            <div class="actions" style="margin-top: 12px;">
              <button class="btn" id="copyBtn" type="button">Copy JSON</button>
            </div>
          </div>
        </div>
      </section>
    `
  );

  const form = document.getElementById("spreadForm");
  const runBtn = document.getElementById("runBtn");
  const errorBox = document.getElementById("errorBox");

  const out = {
    emptyState: document.getElementById("emptyState"),
    results: document.getElementById("results"),
    runId: document.getElementById("runId"),
    pricePerUnit: document.getElementById("pricePerUnit"),
    priceTotal: document.getElementById("priceTotal"),
    gDelta: document.getElementById("gDelta"),
    gGamma: document.getElementById("gGamma"),
    gVega: document.getElementById("gVega"),
    gTheta: document.getElementById("gTheta"),
    gRho: document.getElementById("gRho"),
    rawJson: document.getElementById("rawJson"),
  };

  const fields = {
    quantity: document.getElementById("quantity"),
    spot: document.getElementById("spot"),
    strikeLong: document.getElementById("strikeLong"),
    strikeShort: document.getElementById("strikeShort"),
    rate: document.getElementById("rate"),
    dividend: document.getElementById("dividend"),
    vol: document.getElementById("vol"),
    tte: document.getElementById("tte"),
  };

  let lastPayload = null;

  async function run() {
    clearError(errorBox);
    setLoading(runBtn, true);

    try {
      const req = buildRequest(fields);
      const data = await postJson("/api/v1/pricing/call-spread", req);
      lastPayload = data;
      renderResults(out, data);
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

  document.getElementById("exampleBtn").addEventListener("click", () => {
    fields.quantity.value = "10";
    fields.spot.value = "100";
    fields.strikeLong.value = "95";
    fields.strikeShort.value = "110";
    fields.rate.value = "0.04";
    fields.dividend.value = "0";
    fields.vol.value = "0.22";
    fields.tte.value = "0.75";
    clearError(errorBox);
  });

  document.getElementById("copyBtn").addEventListener("click", async () => {
    if (!lastPayload) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(lastPayload, null, 2));
    } catch (e) {
      showError(errorBox, "Copy failed (clipboard permissions)");
    }
  });
}
