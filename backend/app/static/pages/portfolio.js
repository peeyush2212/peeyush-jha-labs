import { clearError, consumeDraft, fmt, getJson, mountHtml, postJson, putJson, setLoading, showError, toast } from "./shared.js";

let CATALOG = null;

async function loadCatalog() {
  if (CATALOG) return CATALOG;
  CATALOG = await getJson("/api/v1/meta/instruments");
  return CATALOG;
}

function uid() {
  return (
    Math.random().toString(16).slice(2, 10) +
    Math.random().toString(16).slice(2, 10)
  );
}

function byKey(list, key) {
  return (list || []).find((x) => x.key === key) || null;
}

function ensureMarketDefaults(market, catalog) {
  market = market || {};
  for (const p of catalog.market_params) {
    if (market[p.key] === undefined) market[p.key] = p.default;
  }
  return market;
}

function ensureLegDefaults(leg, catalog) {
  const inst = byKey(catalog.instruments, leg.instrument_type) || catalog.instruments[0];
  leg.instrument_type = inst.key;
  if (!leg.method) leg.method = inst.methods?.[0]?.key;
  const m = byKey(inst.methods, leg.method) || inst.methods?.[0];
  leg.method = m?.key || "";

  if (leg.quantity === undefined) leg.quantity = 1;
  leg.params = leg.params || {};
  const allParams = [...(inst.base_params || []), ...(m?.extra_params || [])];
  for (const p of allParams) {
    if (leg.params[p.key] === undefined) leg.params[p.key] = p.default;
  }
  return { inst, method: m };
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

function drawLineChart(canvas, xs, ys) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 600;
  const h = canvas.clientHeight || 260;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, w, h);

  if (!xs || !ys || xs.length < 2 || ys.length < 2) {
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.font = "12px ui-monospace";
    ctx.fillText("No payoff data", 12, 24);
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
  ctx.fillText(`Payoff: ${fmt(yMin, 4)} → ${fmt(yMax, 4)}`, pad + 170, 16);
}

function renderLegTable(legs) {
  const rows = (legs || []).map((r) => {
    const ok = r.status === "ok";
    return `
      <tr>
        <td class="mono">${r.leg_id}</td>
        <td>${r.instrument_type}</td>
        <td>${r.method}</td>
        <td class="mono">${fmt(r.quantity, 4)}</td>
        <td class="mono">${ok ? fmt(r.price_per_unit) : "—"}</td>
        <td class="mono">${ok ? fmt(r.price_total) : "—"}</td>
        <td>${ok ? `<span class="pill pill--ok">ok</span>` : `<span class="pill pill--bad">error</span>`}</td>
      </tr>
    `;
  });

  return `
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
        ${rows.join("")}
      </tbody>
    </table>
  `;
}

function renderScenarioGrid(grid, spotShifts, volShifts) {
  if (!grid) return `<div class="muted" style="font-size: 12.5px;">Generate a grid to see values.</div>`;
  const head = `<tr><th>Δvol</th>${spotShifts
    .map((s) => `<th class="mono">${s}%</th>`)
    .join("")}</tr>`;
  const rows = volShifts
    .map((v, i) => {
      const cells = (grid[i] || []).map((x) => `<td class="mono">${fmt(x)}</td>`).join("");
      return `<tr><th class="mono">${v}</th>${cells}</tr>`;
    })
    .join("");
  return `
    <table class="grid-table">
      <thead>${head}</thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

export function renderPortfolio(viewEl) {
  mountHtml(
    viewEl,
    `
      <section class="split">
        <div class="sidebar">
          <div class="card">
            <div class="card__header">
              <h2>Portfolios</h2>
              <p class="card__hint">Saved locally in your app DB.</p>
            </div>
            <div id="pfSidebar" class="muted" style="font-size: 12.5px;">Loading…</div>
          </div>
        </div>

        <div>
          <div class="card">
            <div class="card__header">
              <h2>Builder</h2>
              <p class="card__hint">Multi-leg builder + pricing + scenario grid + payoff preview.</p>
            </div>
            <div id="pfError" class="error-box" hidden></div>
            <div id="pfMain" class="muted" style="font-size: 12.5px;">Loading…</div>
          </div>

          <div class="card" style="margin-top: 16px;">
            <div class="card__header">
              <h2>Results</h2>
              <p class="card__hint">Totals + per-leg breakdown. Scenario grid and payoff are optional.</p>
            </div>
            <div id="pfResults" class="muted" style="font-size: 12.5px;">—</div>
          </div>
        </div>
      </section>
    `
  );

  const sidebarEl = document.getElementById("pfSidebar");
  const mainEl = document.getElementById("pfMain");
  const resEl = document.getElementById("pfResults");
  const errEl = document.getElementById("pfError");

  const urlParams = new URLSearchParams(window.location.search || "");
  const preselectId = urlParams.get("portfolio_id");
  const draft = consumeDraft("/portfolio");

  const state = {
    catalog: null,
    portfolios: [],
    selectedId: null,
    meta: { created_at: null, updated_at: null },
    portfolio: { portfolio_id: null, name: "", legs: [] },
    market: null,
    results: { price: null, grid: null, payoff: null },
  };

  function renderSidebar() {
    const items = (state.portfolios || []).map((p) => {
      const active = p.portfolio_id === state.selectedId;
      return `
        <div class="list-item ${active ? "active" : ""}" data-open="${p.portfolio_id}">
          <div>
            <div class="list-item__title">${p.name}</div>
            <div class="list-item__meta mono">${p.portfolio_id.slice(0, 8)}…</div>
          </div>
          <div class="pill">open</div>
        </div>
      `;
    });

    sidebarEl.innerHTML = `
      <div class="row" style="gap: 10px; margin-bottom: 10px;">
        <button id="pfNew" class="btn btn-outline" style="flex: 1;">New</button>
        <button id="pfRefresh" class="btn btn-outline">Refresh</button>
      </div>
      <div class="list">${items.join("") || `<div class="muted" style="font-size: 12.5px;">No portfolios yet. Click <b>New</b>.</div>`}</div>
    `;

    document.getElementById("pfNew").addEventListener("click", async () => {
      clearError(errEl);
      const name = window.prompt("Portfolio name", "My portfolio");
      if (!name) return;
      try {
        const created = await postJson("/api/v1/portfolios", { name });
        await refreshList();
        await openPortfolio(created.portfolio_id);
      } catch (e) {
        showError(errEl, e.message || String(e));
      }
    });

    document.getElementById("pfRefresh").addEventListener("click", async () => {
      clearError(errEl);
      try {
        await refreshList();
      } catch (e) {
        showError(errEl, e.message || String(e));
      }
    });

    sidebarEl.querySelectorAll(".list-item[data-open]").forEach((el) => {
      el.addEventListener("click", () => openPortfolio(el.getAttribute("data-open")));
    });
  }

  function renderMain() {
    const pf = state.portfolio;
    if (!pf.portfolio_id) {
      mainEl.innerHTML = `<div class="muted" style="font-size: 12.5px;">Create or open a portfolio to start.</div>`;
      return;
    }

    state.market = ensureMarketDefaults(state.market, state.catalog);

    const marketHtml = state.catalog.market_params
      .map((p) => renderParamInput("m", p, state.market[p.key]))
      .join("");

    const legsHtml = (pf.legs || []).map((leg) => {
      const meta = ensureLegDefaults(leg, state.catalog);
      const inst = meta.inst;
      const method = meta.method;

      const instOpts = state.catalog.instruments
        .map((i) => `<option value="${i.key}">${i.label}</option>`)
        .join("");
      const mOpts = (inst.methods || []).map((m) => `<option value="${m.key}">${m.label}</option>`).join("");
      const note = (method?.note || "").replaceAll('"', "&quot;");

      const paramDefs = [...(inst.base_params || []), ...(method?.extra_params || [])];
      const paramsHtml = paramDefs.map((p) => renderParamInput(`leg_${leg.leg_id}`, p, leg.params[p.key])).join("");

      return `
        <details class="leg" open>
          <summary>
            <div class="leg-summary">
              <span class="pill">${inst.label}</span>
              <span class="muted">${method?.label || ""}</span>
              <span class="spacer"></span>
              <span class="mono">qty: ${fmt(leg.quantity, 4)}</span>
            </div>
          </summary>
          <div class="leg-body" data-leg="${leg.leg_id}">
            <div class="form-grid">
              <div class="field">
                <label>Instrument</label>
                <select class="leg-inst">${instOpts}</select>
              </div>
              <div class="field">
                <label>Method</label>
                <div class="row" style="gap: 8px;">
                  <select class="leg-method" style="flex: 1;">${mOpts}</select>
                  <span class="info" data-tooltip="${note}">i</span>
                </div>
              </div>
              <div class="field">
                <label>Quantity</label>
                <input class="leg-qty" type="number" step="0.01" value="${leg.quantity}" />
              </div>
            </div>

            <div class="form-grid" style="margin-top: 10px;">
              ${paramsHtml}
            </div>

            <div class="row" style="justify-content: space-between; margin-top: 10px;">
              <div class="muted" style="font-size: 12.5px;">Leg id: <span class="mono">${leg.leg_id}</span></div>
              <button class="btn btn-outline small" data-remove="${leg.leg_id}">Remove</button>
            </div>
          </div>
        </details>
      `;
    });

    mainEl.innerHTML = `
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="muted" style="font-size: 12px;">Portfolio id</div>
          <div class="mono">${pf.portfolio_id}</div>
        </div>
        <div class="row" style="gap: 10px;">
          <button id="pfDelete" class="btn btn-outline">Delete</button>
          <button id="pfSave" class="btn">Save</button>
        </div>
      </div>

      <div class="form-grid" style="margin-top: 12px;">
        <div class="field">
          <label>Name</label>
          <input id="pfName" type="text" value="${pf.name}" />
        </div>
      </div>

      <div class="card" style="margin-top: 12px;">
        <div class="card__header" style="padding-bottom: 6px;">
          <h3>Market</h3>
          <p class="card__hint">One market snapshot for pricing + scenarios.</p>
        </div>
        <div class="form-grid">${marketHtml}</div>
      </div>

      <div class="row" style="justify-content: space-between; margin-top: 12px;">
        <h3 style="margin: 0;">Legs</h3>
        <button id="pfAddLeg" class="btn btn-outline">Add leg</button>
      </div>

      <div class="grid" style="gap: 12px; margin-top: 8px;">
        ${legsHtml.join("") || `<div class="muted" style="font-size: 12.5px;">No legs yet. Click <b>Add leg</b>.</div>`}
      </div>

      <div class="card" style="margin-top: 12px;">
        <div class="card__header" style="padding-bottom: 6px;">
          <h3>Actions</h3>
          <p class="card__hint">Price the portfolio, then (optionally) generate scenario grid and payoff preview.</p>
        </div>

        <div class="row" style="gap: 10px; flex-wrap: wrap;">
          <button id="pfPrice" class="btn btn--primary">Compute Price</button>
          <button id="pfGrid" class="btn btn-outline">Scenario grid</button>
          <button id="pfPayoff" class="btn btn-outline">Payoff preview</button>
          <div class="muted" style="font-size: 12.5px;">Hover (i) for methodology.</div>
        </div>

        <div class="grid-2" style="margin-top: 12px;">
          <div class="card" style="margin: 0;">
            <div class="card__header" style="padding-bottom: 6px;">
              <h3>Scenario grid inputs</h3>
              <p class="card__hint">2D grid: spot shift (%) × vol shift (abs).</p>
            </div>
            <div class="form-grid">
              <div class="field"><label>Spot shifts (comma %)</label><input id="sgSpot" type="text" value="-20,-10,0,10,20" /></div>
              <div class="field"><label>Vol shifts (comma)</label><input id="sgVol" type="text" value="-0.05,0,0.05" /></div>
              <div class="field"><label>Rate shift (bps)</label><input id="sgRate" type="number" step="1" value="0" /></div>
            </div>
          </div>

          <div class="card" style="margin: 0;">
            <div class="card__header" style="padding-bottom: 6px;">
              <h3>Payoff preview inputs</h3>
              <p class="card__hint">Terminal payoff vs spot (path-dependent legs excluded).</p>
            </div>
            <div class="form-grid">
              <div class="field"><label>Spot min</label><input id="poMin" type="number" step="0.01" value="50" /></div>
              <div class="field"><label>Spot max</label><input id="poMax" type="number" step="0.01" value="150" /></div>
              <div class="field"><label>Steps</label><input id="poSteps" type="number" step="1" min="11" max="201" value="61" /></div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Set selections & bind events
    document.getElementById("pfName").addEventListener("input", (e) => {
      state.portfolio.name = e.target.value;
    });

    // Market bindings
    mainEl.querySelectorAll("[id^='m_']").forEach((el) => {
      el.addEventListener("input", (e) => {
        const k = e.target.getAttribute("data-k");
        state.market[k] = Number(e.target.value);
      });
    });

    // Add/remove leg
    document.getElementById("pfAddLeg").addEventListener("click", () => {
      const first = state.catalog.instruments[0];
      const leg = {
        leg_id: uid(),
        instrument_type: first.key,
        method: first.methods?.[0]?.key,
        quantity: 1,
        params: {},
      };
      ensureLegDefaults(leg, state.catalog);
      state.portfolio.legs.push(leg);
      renderAll();
    });

    mainEl.querySelectorAll("button[data-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-remove");
        state.portfolio.legs = state.portfolio.legs.filter((l) => l.leg_id !== id);
        renderAll();
      });
    });

    // Leg bindings
    mainEl.querySelectorAll(".leg-body[data-leg]").forEach((box) => {
      const legId = box.getAttribute("data-leg");
      const leg = state.portfolio.legs.find((l) => l.leg_id === legId);
      if (!leg) return;

      const instSel = box.querySelector("select.leg-inst");
      const mSel = box.querySelector("select.leg-method");
      const qtyEl = box.querySelector("input.leg-qty");

      instSel.value = leg.instrument_type;
      mSel.value = leg.method;

      instSel.addEventListener("change", () => {
        leg.instrument_type = instSel.value;
        const inst = byKey(state.catalog.instruments, leg.instrument_type);
        leg.method = inst?.methods?.[0]?.key || "";
        leg.params = {};
        ensureLegDefaults(leg, state.catalog);
        renderAll();
      });

      mSel.addEventListener("change", () => {
        leg.method = mSel.value;
        // Reset params not in new schema (simpler, predictable)
        leg.params = {};
        ensureLegDefaults(leg, state.catalog);
        renderAll();
      });

      qtyEl.addEventListener("input", (e) => {
        leg.quantity = Number(e.target.value);
        // update summary qty text without full rerender
      });

      // Params within this leg
      box.querySelectorAll("[id^='leg_']").forEach((el) => {
        const k = el.getAttribute("data-k");
        if (!k) return;
        if (el.tagName === "SELECT") {
          el.value = String(leg.params[k]);
          el.addEventListener("change", (e) => {
            leg.params[k] = e.target.value;
          });
        } else {
          el.addEventListener("input", (e) => {
            leg.params[k] = Number(e.target.value);
          });
        }
      });
    });

    // Save/delete
    document.getElementById("pfSave").addEventListener("click", async (e) => {
      clearError(errEl);
      const btn = e.target;
      setLoading(btn, true);
      try {
        const payload = {
          name: state.portfolio.name,
          portfolio: { name: state.portfolio.name, legs: state.portfolio.legs },
        };
        await putJson(`/api/v1/portfolios/${state.portfolio.portfolio_id}`, payload);
        await refreshList();
      } catch (err) {
        showError(errEl, err.message || String(err));
      } finally {
        setLoading(btn, false);
      }
    });

    document.getElementById("pfDelete").addEventListener("click", async () => {
      clearError(errEl);
      if (!window.confirm("Delete this portfolio?")) return;
      try {
        await fetch(`/api/v1/portfolios/${state.portfolio.portfolio_id}`, { method: "DELETE" });
        state.selectedId = null;
        state.portfolio = { portfolio_id: null, name: "", legs: [] };
        state.results = { price: null, grid: null, payoff: null };
        await refreshList();
        renderAll();
      } catch (e) {
        showError(errEl, e.message || String(e));
      }
    });

    // Actions
    document.getElementById("pfPrice").addEventListener("click", async (e) => {
      clearError(errEl);
      const btn = e.target;
      setLoading(btn, true);
      try {
        const payload = {
          market: state.market,
          portfolio: { name: state.portfolio.name, legs: state.portfolio.legs },
          strict: false,
        };
        const data = await postJson("/api/v1/portfolio/price", payload);
        state.results.price = data;
        renderResults();
      } catch (err) {
        showError(errEl, err.message || String(err));
      } finally {
        setLoading(btn, false);
      }
    });

    document.getElementById("pfGrid").addEventListener("click", async (e) => {
      clearError(errEl);
      const btn = e.target;
      setLoading(btn, true);
      try {
        const parseList = (txt) =>
          txt
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length)
            .map((s) => Number(s));

        const spotShifts = parseList(document.getElementById("sgSpot").value);
        const volShifts = parseList(document.getElementById("sgVol").value);
        const rateShift = Number(document.getElementById("sgRate").value);

        const payload = {
          market: state.market,
          portfolio: { name: state.portfolio.name, legs: state.portfolio.legs },
          spot_shifts_pct: spotShifts,
          vol_shifts: volShifts,
          rate_shift_bps: rateShift,
        };
        const data = await postJson("/api/v1/portfolio/scenario-grid", payload);
        state.results.grid = data;
        renderResults();
      } catch (err) {
        showError(errEl, err.message || String(err));
      } finally {
        setLoading(btn, false);
      }
    });

    document.getElementById("pfPayoff").addEventListener("click", async (e) => {
      clearError(errEl);
      const btn = e.target;
      setLoading(btn, true);
      try {
        const payload = {
          portfolio: { name: state.portfolio.name, legs: state.portfolio.legs },
          spot_min: Number(document.getElementById("poMin").value),
          spot_max: Number(document.getElementById("poMax").value),
          steps: Number(document.getElementById("poSteps").value),
        };
        const data = await postJson("/api/v1/portfolio/payoff", payload);
        state.results.payoff = data;
        renderResults();
      } catch (err) {
        showError(errEl, err.message || String(err));
      } finally {
        setLoading(btn, false);
      }
    });
  }

  function renderResults() {
    const price = state.results.price;
    const grid = state.results.grid;
    const payoff = state.results.payoff;

    let html = "";
    if (price) {
      const g = price.total_greeks || {};
      html += `
        <div class="result-grid">
          <div class="kv"><div class="muted">Total price</div><div class="mono">${fmt(price.total_price)}</div></div>
          <div class="kv"><div class="muted">Delta</div><div class="mono">${fmt(g.delta)}</div></div>
          <div class="kv"><div class="muted">Gamma</div><div class="mono">${fmt(g.gamma)}</div></div>
          <div class="kv"><div class="muted">Vega</div><div class="mono">${fmt(g.vega)}</div></div>
          <div class="kv"><div class="muted">Theta</div><div class="mono">${fmt(g.theta)}</div></div>
          <div class="kv"><div class="muted">Rho</div><div class="mono">${fmt(g.rho)}</div></div>
        </div>

        <div style="margin-top: 12px;">
          <h3 style="margin: 0 0 8px;">Leg breakdown</h3>
          ${renderLegTable(price.legs)}
          <div class="muted" style="margin-top: 8px; font-size: 12.5px;">Saved in <a href="/runs" data-link>Runs</a> (${price.run_id}).</div>
        </div>
      `;
    } else {
      html += `<div class="muted" style="font-size: 12.5px;">No pricing run yet.</div>`;
    }

    html += `<hr style="border: none; border-top: 1px solid rgba(255,255,255,0.10); margin: 14px 0;" />`;

    html += `
      <h3 style="margin: 0 0 8px;">Scenario grid</h3>
      ${grid ? renderScenarioGrid(grid.grid_totals, grid.spot_shifts_pct, grid.vol_shifts) : `<div class="muted" style="font-size: 12.5px;">—</div>`}
    `;

    if (grid) {
      html += `<div class="muted" style="margin-top: 8px; font-size: 12.5px;">Saved in <a href="/runs" data-link>Runs</a> (${grid.run_id}).</div>`;
    }

    html += `<hr style="border: none; border-top: 1px solid rgba(255,255,255,0.10); margin: 14px 0;" />`;

    html += `
      <h3 style="margin: 0 0 8px;">Payoff preview</h3>
      <canvas id="payoffChart" class="chart"></canvas>
    `;
    if (payoff) {
      const ex = payoff.excluded || [];
      if (ex.length) {
        html += `<div class="muted" style="margin-top: 10px; font-size: 12.5px;">Excluded legs: ${ex
          .map((x) => `<span class="mono">${x.leg_id}</span> (${x.reason})`)
          .join(", ")}</div>`;
      }
      html += `<div class="muted" style="margin-top: 8px; font-size: 12.5px;">Saved in <a href="/runs" data-link>Runs</a> (${payoff.run_id}).</div>`;
    } else {
      html += `<div class="muted" style="margin-top: 10px; font-size: 12.5px;">Generate payoff preview to see a curve.</div>`;
    }

    resEl.innerHTML = html;

    // Draw chart
    const canvas = document.getElementById("payoffChart");
    if (payoff) {
      drawLineChart(canvas, payoff.spots, payoff.payoff);
    } else {
      drawLineChart(canvas, [], []);
    }
  }

  async function refreshList() {
    state.portfolios = await getJson("/api/v1/portfolios?limit=200&offset=0");
    renderSidebar();
  }

  async function openPortfolio(portfolioId) {
    clearError(errEl);
    if (!portfolioId) return;
    const data = await getJson(`/api/v1/portfolios/${portfolioId}`);
    state.selectedId = portfolioId;
    state.meta = { created_at: data.created_at, updated_at: data.updated_at };
    state.portfolio = {
      portfolio_id: data.portfolio_id,
      name: data.portfolio.name || data.name,
      legs: data.portfolio.legs || [],
    };

    // Ensure each leg has an id
    for (const l of state.portfolio.legs) {
      if (!l.leg_id) l.leg_id = uid();
    }

    state.results = { price: null, grid: null, payoff: null };
    renderAll();
  }

  function renderAll() {
    renderSidebar();
    renderMain();
    renderResults();
  }

  // Init
  loadCatalog()
    .then(async (catalog) => {
      state.catalog = catalog;
      state.market = ensureMarketDefaults({}, catalog);
      await refreshList();
// If a run was cloned from Runs, load it as a draft portfolio in the editor.
if (draft?.payload?.portfolio) {
  try {
    const p = draft.payload.portfolio;
    const mkt = draft.payload.market || {};
    p.legs = Array.isArray(p.legs) ? p.legs : [];
    for (const leg of p.legs) ensureLegDefaults(leg, catalog);

    state.market = ensureMarketDefaults(mkt, catalog);
    state.portfolio = p;
    state.selectedId = null;
    state.meta = { created_at: null, updated_at: null };
    renderAll();
    toast("Draft loaded from Runs", "success");
    return;
  } catch (_) {
    // ignore and continue normal flow
  }
}


      if (preselectId) {
        // If we have a requested portfolio id in the URL, try to open it.
        try {
          await openPortfolio(preselectId);
          return;
        } catch (e) {
          // Fall back to the most recent one.
          console.warn("Failed to open preselected portfolio", e);
        }
      }
      if (state.portfolios.length) {
        await openPortfolio(state.portfolios[0].portfolio_id);
      } else {
        renderAll();
      }
    })
    .catch((e) => {
      showError(errEl, e.message || String(e));
      sidebarEl.innerHTML = `<div class="muted" style="font-size: 12.5px;">Failed to load.</div>`;
      mainEl.innerHTML = `<div class="muted" style="font-size: 12.5px;">—</div>`;
      resEl.innerHTML = `<div class="muted" style="font-size: 12.5px;">—</div>`;
    });
}
