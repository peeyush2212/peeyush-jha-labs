import { clearError, getJson, mountHtml, setDraft, downloadText, setLoading, showError, toast } from "./shared.js";

function qsParam(name) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name);
}

function shortId(runId) {
  return runId ? runId.slice(0, 8) : "—";
}


function spaNavigate(path) {
  history.pushState(null, null, path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function buildDraftFromRun(run) {
  const type = String(run.run_type || "");
  const input = run.input || {};

  // Default mapping
  let target = "/runs";
  let payload = input;

  if (type === "vanilla") {
    target = "/pricer";
    payload = {
      instrument: "vanilla",
      method: "black_scholes",
      quantity: input.quantity ?? 1,
      market: {
        spot: input.spot ?? 100,
        rate: input.rate ?? 0.02,
        dividend_yield: input.dividend_yield ?? 0.0,
        vol: input.vol ?? 0.2,
      },
      params: {
        option_type: input.option_type ?? "call",
        strike: input.strike ?? 100,
        time_to_expiry: input.time_to_expiry ?? 1.0,
      },
    };
  } else if (type === "call_spread") {
    target = "/pricer";
    payload = {
      instrument: "call_spread",
      method: "black_scholes",
      quantity: input.quantity ?? 1,
      market: {
        spot: input.spot ?? 100,
        rate: input.rate ?? 0.02,
        dividend_yield: input.dividend_yield ?? 0.0,
        vol: input.vol ?? 0.2,
      },
      params: {
        strike_low: input.strike_low ?? 95,
        strike_high: input.strike_high ?? 105,
        time_to_expiry: input.time_to_expiry ?? 1.0,
      },
    };
  } else if (type === "instrument") {
    target = "/pricer";
    payload = input;
  } else if (type.startsWith("macro.")) {
    target = "/macro";
    payload = input;
  } else if (type.startsWith("strategy.")) {
    target = "/strategy";
    payload = input;
  } else if (type.startsWith("tax.")) {
    target = "/tax";
    payload = input;
  } else if (type.startsWith("capbud.")) {
    target = "/capbud";
    payload = input;
  } else if (type.startsWith("scenario_")) {
    target = "/scenario";
    payload = input;
  } else if (type.startsWith("portfolio_")) {
    target = "/portfolio";
    payload = input;
  } else if (type.startsWith("batch_")) {
    target = "/batch";
    payload = input;
  } else {
    target = "/runs";
  }

  return { target, type, payload };
}

function renderList(listEl, items) {
  if (!items.length) {
    listEl.innerHTML = `<div class="muted" style="font-size: 12.5px;">No runs found.</div>`;
    return;
  }

  listEl.innerHTML = `
    <div class="table table--compact table--runs">
      <div class="trow thead">
        <div class="tcell label">Time</div>
        <div class="tcell label">Type</div>
        <div class="tcell label">Run ID</div>
        <div class="tcell label">CSV</div>
      </div>
      ${items
        .map((r) => {
          const when = r.created_at.replace("T", " ").slice(0, 19);
          const csv = r.has_result_csv ? "yes" : "";
          return `
            <div class="trow trow--click" data-run="${r.run_id}">
              <div class="tcell mono">${when}</div>
              <div class="tcell mono">${r.run_type}</div>
              <div class="tcell mono">${r.run_id}</div>
              <div class="tcell mono">${csv}</div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderDetail(detailEl, run) {
  const when = run.created_at.replace("T", " ").slice(0, 19);
  detailEl.innerHTML = `
    <div class="kpis">
      <div class="kpi">
        <div class="kpi__label">Run ID</div>
        <div class="kpi__value mono">${run.run_id}</div>
      </div>
      <div class="kpi">
        <div class="kpi__label">Type</div>
        <div class="kpi__value mono">${run.run_type}</div>
      </div>
      <div class="kpi">
        <div class="kpi__label">Created</div>
        <div class="kpi__value mono">${when}</div>
      </div>
    </div>

    <div class="actions" style="margin-top: 12px;">
      ${run.has_result_csv ? `<a class="btn btn--primary" href="/api/v1/runs/${run.run_id}/result.csv" target="_blank" rel="noreferrer">Download CSV</a>` : ""}
      <button class="btn" id="copyBtn" type="button">Copy JSON</button>
      <button class="btn" id="copyLinkBtn" type="button">Copy link</button>
      <button class="btn" id="downloadJsonBtn" type="button">Download JSON</button>
      <a class="btn btn--ghost" id="pdfBtn" href="/api/v1/runs/${run.run_id}/report.pdf" target="_blank" rel="noreferrer">PDF report</a>
      <button class="btn btn--primary" id="cloneBtn" type="button">Clone &amp; open</button>
    </div>

    <details class="raw" style="margin-top: 12px;" open>
      <summary>Run JSON</summary>
      <pre id="runJson"></pre>
    </details>
  `;

  const pre = detailEl.querySelector("#runJson");
  pre.textContent = JSON.stringify(run, null, 2);

  const copyBtn = detailEl.querySelector("#copyBtn");
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(run, null, 2));
    } catch (e) {
      // silently ignore; user will notice
    }
  });

const copyLinkBtn = detailEl.querySelector("#copyLinkBtn");
copyLinkBtn.addEventListener("click", async () => {
  try {
    const url = `${window.location.origin}/runs?run_id=${encodeURIComponent(run.run_id)}`;
    await navigator.clipboard.writeText(url);
    toast("Run link copied", "success");
  } catch (_) {
    toast("Could not copy link", "error");
  }
});

const downloadJsonBtn = detailEl.querySelector("#downloadJsonBtn");
downloadJsonBtn.addEventListener("click", () => {
  const txt = JSON.stringify(run, null, 2);
  downloadText(`run_${shortId(run.run_id)}.json`, txt, "application/json");
  toast("JSON downloaded", "success");
});

const pdfBtn = detailEl.querySelector("#pdfBtn");
pdfBtn.addEventListener("click", () => {
  window.dispatchEvent(new CustomEvent("run:report", { detail: { run_id: run.run_id } }));
});

const cloneBtn = detailEl.querySelector("#cloneBtn");
cloneBtn.addEventListener("click", () => {
  const draft = buildDraftFromRun(run);
  setDraft(draft);
  toast(`Draft loaded → ${draft.target}`, "success");
  spaNavigate(draft.target);
});

}

export function renderRuns(viewEl) {
  mountHtml(
    viewEl,
    `
      <section class="grid grid--twoone">
        <div class="card">
          <div class="card__header">
            <h2>Runs</h2>
            <p class="card__hint">Saved runs (SQLite by default)</p>
          </div>

          <div class="row" style="margin-bottom: 10px;">
            <label class="label" style="flex: 1;">
              Filter by type
              <select class="control" id="typeFilter">
                <option value="">All</option>
                <option value="vanilla">vanilla</option>
                <option value="call_spread">call_spread</option>
                <option value="instrument">instrument</option>
                <option value="scenario_vanilla">scenario_vanilla</option>
                <option value="macro_scenario">macro_scenario</option>
                <option value="macro_grid">macro_grid</option>
                <option value="macro.scenario">macro.scenario</option>
                <option value="macro.grid">macro.grid</option>
                <option value="macro.compare">macro.compare</option>
                <option value="strategy.recommend">strategy.recommend</option>
                <option value="strategy.analyze">strategy.analyze</option>
                <option value="portfolio_price">portfolio_price</option>
                <option value="portfolio_scenario_grid">portfolio_scenario_grid</option>
                <option value="portfolio_payoff">portfolio_payoff</option>
                <option value="tax.compute">tax.compute</option>
                <option value="capbud.compute">capbud.compute</option>
                <option value="batch_vanilla_csv">batch_vanilla_csv</option>
                <option value="batch_call_spread_csv">batch_call_spread_csv</option>
              </select>
            </label>

            <div class="actions" style="align-self: end;">
              <button class="btn btn--primary" id="refreshBtn" type="button">
                <span class="spinner" aria-hidden="true"></span>
                <span class="btn__label">Refresh</span>
              </button>
            </div>
          </div>

          <div class="error" id="errorBox" hidden></div>
          <div id="list"></div>
        </div>

        <div class="card">
          <div class="card__header">
            <h2>Details</h2>
            <p class="card__hint">Click a row to view the saved payload</p>
          </div>

          <div class="empty" id="emptyState">
            <div class="empty__icon">↗</div>
            <div>
              <div class="empty__title">No selection</div>
              <div class="empty__text">Pick a run from the left.</div>
            </div>
          </div>

          <div id="detail" hidden></div>
        </div>
      </section>
    `
  );

  const typeFilter = document.getElementById("typeFilter");
  const refreshBtn = document.getElementById("refreshBtn");
  const errorBox = document.getElementById("errorBox");
  const listEl = document.getElementById("list");
  const emptyState = document.getElementById("emptyState");
  const detailEl = document.getElementById("detail");

  async function loadList() {
    clearError(errorBox);
    setLoading(refreshBtn, true);

    try {
      const rt = typeFilter.value;
      const url = rt ? `/api/v1/runs?limit=50&run_type=${encodeURIComponent(rt)}` : "/api/v1/runs?limit=50";
      const data = await getJson(url);
      renderList(listEl, data.items);

      // If the page includes ?run_id=..., auto-select it
      const fromQuery = qsParam("run_id");
      if (fromQuery) {
        const rowEl = listEl.querySelector(`[data-run="${fromQuery}"]`);
        if (rowEl) rowEl.click();
      }
    } catch (e) {
      showError(errorBox, e?.message ? String(e.message) : "Failed to load runs");
    } finally {
      setLoading(refreshBtn, false);
    }
  }

  async function loadDetail(runId) {
    clearError(errorBox);
    try {
      const run = await getJson(`/api/v1/runs/${encodeURIComponent(runId)}`);
      renderDetail(detailEl, run);
      emptyState.hidden = true;
      detailEl.hidden = false;
    } catch (e) {
      showError(errorBox, e?.message ? String(e.message) : "Failed to load run detail");
    }
  }

  listEl.addEventListener("click", (e) => {
    const row = e.target.closest(".trow--click");
    if (!row) return;
    const runId = row.getAttribute("data-run");
    if (!runId) return;

    listEl.querySelectorAll(".trow--click").forEach((r) => r.classList.remove("selected"));
    row.classList.add("selected");

    loadDetail(runId);
  });

  refreshBtn.addEventListener("click", loadList);
  typeFilter.addEventListener("change", loadList);

  loadList();
}
