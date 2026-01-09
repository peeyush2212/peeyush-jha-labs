import { clearError, fmt, mountHtml, postJson, setLoading, showError, toast, consumeDraft } from "./shared.js";

const ASSETS = [
  {
    key: "listed_equity_stt",
    label: "Listed equity / equity-oriented fund (STT)",
    note:
      "Uses special-rate equity capital gains rules: STCG under 111A and LTCG under 112A (with 112A exemption). " +
      "Supports grandfathering cost basis for acquisitions before 1-Feb-2018 (FMV on 31-Jan-2018).",
  },
  {
    key: "listed_security_other",
    label: "Other listed security (non-equity)",
    note:
      "Generic listed security bucket (e.g., listed bond / ETF that is not equity-oriented). " +
      "Short-term typically slab-taxed; long-term typically under section 112.",
  },
  {
    key: "land_building",
    label: "Land / Building (property)",
    note:
      "Property capital gains. Includes the post-23-Jul-2024 comparison rule for resident individuals/HUF " +
      "(12.5% without indexation vs 20% with indexation) for assets acquired before 23-Jul-2024.",
  },
  {
    key: "other_capital_asset",
    label: "Other capital asset (unlisted / gold / etc.)",
    note:
      "Generic non-listed capital asset. Uses 24-month holding rule and section 112 rates for long-term gains. " +
      "If your asset has a special carve-out, pick a more specific category.",
  },
  {
    key: "specified_mutual_fund_50aa",
    label: "Specified mutual fund (50AA)",
    note:
      "Section 50AA: gains are deemed short-term for specified mutual funds acquired on/after 1-Apr-2023. " +
      "Taxed at your marginal slab rate (you input it here).",
  },
  {
    key: "market_linked_debenture_50aa",
    label: "Market linked debenture (50AA)",
    note:
      "Section 50AA: gains deemed short-term for market linked debentures (MLDs). Taxed at marginal slab rate.",
  },
  {
    key: "unlisted_bond_debenture_50aa",
    label: "Unlisted bond / debenture (50AA)",
    note:
      "Section 50AA expanded: for unlisted bonds/debentures transferred/redeemed/matured on/after 23-Jul-2024, gains are deemed short-term. " +
      "Taxed at marginal slab rate.",
  },
  {
    key: "virtual_digital_asset",
    label: "Virtual digital asset (115BBH)",
    note:
      "Section 115BBH: 30% on gains; deductions other than cost are restricted (transfer expenses ignored here).",
  },
];

function byKey(k) {
  return ASSETS.find((a) => a.key === k) || ASSETS[0];
}

function fmtInr(x) {
  if (typeof x !== "number" || !Number.isFinite(x)) return "—";
  try {
    return x.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch (_) {
    return x.toFixed(2);
  }
}

function dateToInputValue(d) {
  // d: Date
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isBefore(dateStr, yyyy, mm, dd) {
  const d = new Date(`${dateStr}T00:00:00`);
  const cutoff = new Date(Date.UTC(yyyy, mm - 1, dd));
  return d.getTime() < cutoff.getTime();
}

function renderOutput(result) {
  if (!result) {
    return `<div class="muted" style="font-size: 12.5px;">Compute tax to see output.</div>`;
  }

  const ratePct = result.base_rate != null ? `${(result.base_rate * 100).toFixed(2)}%` : "—";
  const sPct = result.surcharge_rate != null ? `${(result.surcharge_rate * 100).toFixed(2)}%` : "—";
  const cPct = result.cess_rate != null ? `${(result.cess_rate * 100).toFixed(2)}%` : "—";

  const notes = (result.notes || [])
    .slice(0, 10)
    .map((n) => `<li>${String(n)}</li>`)
    .join("");

  const scenarioRows = (result.scenario_rows || [])
    .map(
      (r) => `
        <div class="trow">
          <div class="tcell mono">${r.label}</div>
          <div class="tcell mono">₹${fmtInr(r.sale_value)}</div>
          <div class="tcell mono">₹${fmtInr(r.gain)}</div>
          <div class="tcell mono">₹${fmtInr(r.total_tax)}</div>
          <div class="tcell mono">₹${fmtInr(r.post_tax_proceeds)}</div>
        </div>
      `
    )
    .join("");

  const planner =
    result.earliest_ltcg_date && result.tax_if_sold_on_earliest_ltcg_date != null
      ? `
        <div class="card" style="margin-top: 12px;">
          <div class="card__header" style="padding-bottom: 6px;">
            <h3>Planner</h3>
            <p class="card__hint">Quick what-if for holding-period optimization</p>
          </div>

          <div class="table">
            <div class="trow">
              <div class="tcell label">Earliest LTCG date</div>
              <div class="tcell mono">${String(result.earliest_ltcg_date)}</div>
            </div>
            <div class="trow">
              <div class="tcell label">Tax if sold on that date</div>
              <div class="tcell mono">₹${fmtInr(result.tax_if_sold_on_earliest_ltcg_date)}</div>
            </div>
            <div class="trow">
              <div class="tcell label">Estimated tax saving</div>
              <div class="tcell mono">₹${fmtInr(result.tax_saving_if_wait || 0)}</div>
            </div>
          </div>

          <div class="muted" style="margin-top: 10px; font-size: 12.5px;">
            This planner assumes the same sale value; market moves can dominate the result.
          </div>
        </div>
      `
      : "";

  return `
    <div class="table">
      <div class="trow">
        <div class="tcell label">Classification</div>
        <div class="tcell mono">${result.classification}</div>
      </div>
      <div class="trow">
        <div class="tcell label">Holding days</div>
        <div class="tcell mono">${result.holding_days}</div>
      </div>
      <div class="trow">
        <div class="tcell label">Holding rule</div>
        <div class="tcell">${result.holding_period_rule}</div>
      </div>
    </div>

    <div class="grid" style="gap: 10px; margin-top: 12px;">
      <div class="card">
        <div class="card__header" style="padding-bottom: 6px;">
          <h3>Tax breakdown</h3>
          <p class="card__hint">All values in INR</p>
        </div>
        <div class="result-grid">
          <div class="kv"><div class="muted">Gain</div><div class="mono">₹${fmtInr(result.gain)}</div></div>
          <div class="kv"><div class="muted">Taxable gain</div><div class="mono">₹${fmtInr(result.taxable_gain)}</div></div>
          <div class="kv"><div class="muted">Base rate</div><div class="mono">${ratePct}</div></div>
          <div class="kv"><div class="muted">Base tax</div><div class="mono">₹${fmtInr(result.base_tax)}</div></div>
          <div class="kv"><div class="muted">Surcharge (${sPct})</div><div class="mono">₹${fmtInr(result.surcharge)}</div></div>
          <div class="kv"><div class="muted">Cess (${cPct})</div><div class="mono">₹${fmtInr(result.cess)}</div></div>
          <div class="kv"><div class="muted">Total tax</div><div class="mono">₹${fmtInr(result.total_tax)}</div></div>
          <div class="kv"><div class="muted">Post-tax proceeds</div><div class="mono">₹${fmtInr(result.post_tax_proceeds)}</div></div>
        </div>
      </div>

      <div class="card">
        <div class="card__header" style="padding-bottom: 6px;">
          <h3>Methodology</h3>
          <p class="card__hint">Hover for section-level hint</p>
        </div>
        <div class="row" style="gap: 8px; align-items: center;">
          <span class="info" data-tooltip="${String(result.methodology || "").replaceAll('"', "&quot;")}">i</span>
          <div class="muted" style="font-size: 12.5px;">Hover the icon to see the applied rule.</div>
        </div>

        <div style="margin-top: 10px;">
          <div class="muted" style="font-size: 12.5px; margin-bottom: 6px;">Notes</div>
          <ul class="muted" style="margin: 0; padding-left: 18px; font-size: 12.5px; line-height: 1.45;">
            ${notes || "<li>No notes</li>"}
          </ul>
        </div>
      </div>
    </div>

    <div class="card" style="margin-top: 12px;">
      <div class="card__header" style="padding-bottom: 6px;">
        <h3>Sale-value scenarios</h3>
        <p class="card__hint">±10% sensitivity (same dates & settings)</p>
      </div>

      <div class="table" style="grid-template-columns: 0.6fr 1fr 1fr 1fr 1fr;">
        <div class="trow thead">
          <div class="tcell">Shift</div>
          <div class="tcell">Sale value</div>
          <div class="tcell">Gain</div>
          <div class="tcell">Total tax</div>
          <div class="tcell">Post-tax</div>
        </div>
        ${scenarioRows}
      </div>
    </div>
    ${planner}

    <div class="muted" style="margin-top: 12px; font-size: 12.5px;">
      Saved in <a href="/runs" data-link>Runs</a> as <span class="mono">tax.compute</span>.
    </div>
  `;
}

export function renderTax(viewEl) {
  // Defaults: last 1 year window
  const today = new Date();
  const d1 = new Date(today.getTime());
  d1.setFullYear(d1.getFullYear() - 1);

  const state = {
    asset_type: "listed_equity_stt",
    acquired_date: dateToInputValue(d1),
    sold_date: dateToInputValue(today),
    purchase_value: 100000,
    sale_value: 120000,
    transfer_expenses: 0,
    stt_paid: true,
    fmv_31jan2018: 0,
    other_112a_ltcg_in_same_fy: 0,
    basic_exemption_remaining: 0,
    marginal_rate: 0.30,
    surcharge_rate: 0.0,
    cess_rate: 0.04,
    improvement_cost: 0,
    improvement_date: "",
    resident_individual_or_huf: true,
    last: null,
  };

  mountHtml(
    viewEl,
    `
      <section class="grid">
        <div class="card">
          <div class="card__header">
            <h2>Tax calculator</h2>
            <p class="card__hint">India context • capital gains &amp; VDA • user-input driven</p>
          </div>

          <div id="taxError" class="error-box" hidden></div>

          <div id="taxForm" class="grid" style="gap: 12px;"></div>

          <div class="muted" style="margin-top: 12px; font-size: 12.5px; line-height: 1.45;">
            This is an estimation tool, not filing advice. Rules change; confirm against the Act/notifications or a professional.
          </div>
        </div>

        <div class="card">
          <div class="card__header">
            <h2>Output</h2>
            <p class="card__hint">Breakdown + what-if scenarios</p>
          </div>
          <div id="taxOut">Compute tax to see output.</div>
        </div>
      </section>
    `
  );
const draft = consumeDraft("/tax");
if (draft?.payload) {
  try {
    const setVal = (id, v) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.value = String(v ?? el.value);
    };
    const p = draft.payload;

    setVal("assetType", p.asset_type);
    setVal("acquiredDate", p.acquired_date);
    setVal("soldDate", p.sold_date);
    setVal("purchaseValue", p.purchase_value);
    setVal("saleValue", p.sale_value);
    setVal("transferExpenses", p.transfer_expenses ?? 0);
    setVal("sttPaid", p.stt_paid ? "yes" : "no");
    setVal("other112a", p.other_112a_gains ?? 0);
    setVal("basicEx", p.basic_exemption_remaining ?? 0);
    setVal("fmv2018", p.fmv_2018_01_31 ?? "");
    setVal("improvementCost", p.improvement_cost ?? 0);
    setVal("improvementDate", p.improvement_date ?? "");
    setVal("residentIH", p.resident_individual_or_huf ? "yes" : "no");
    setVal("marginalRate", p.marginal_rate_pct ?? 0);
    setVal("surchargeRate", p.surcharge_rate_pct ?? 0);
    setVal("cessRate", p.cess_rate_pct ?? 4.0);

    toast("Draft loaded from Runs", "success");
  } catch (_) {
    // ignore
  }
}



  const errEl = document.getElementById("taxError");
  const formEl = document.getElementById("taxForm");
  const outEl = document.getElementById("taxOut");

  function renderForm() {
    const asset = byKey(state.asset_type);

    const assetOpts = ASSETS.map((a) => `<option value="${a.key}">${a.label}</option>`).join("");
    const note = (asset.note || "").replaceAll('"', "&quot;");

    const showEquity = state.asset_type === "listed_equity_stt";
    const showProperty = state.asset_type === "land_building";
    const showFmv2018 =
      showEquity && state.acquired_date && isBefore(state.acquired_date, 2018, 2, 1);

    const showSlabHint =
      state.asset_type === "specified_mutual_fund_50aa" ||
      state.asset_type === "market_linked_debenture_50aa" ||
      state.asset_type === "unlisted_bond_debenture_50aa";

    formEl.innerHTML = `
      <div class="form-grid">
        <div class="field">
          <label>Asset type</label>
          <div class="row" style="gap: 8px;">
            <select id="assetType" style="flex: 1;">${assetOpts}</select>
            <span class="info" data-tooltip="${note}">i</span>
          </div>
        </div>

        <div class="field">
          <label>Acquired date</label>
          <input id="acquiredDate" type="date" value="${state.acquired_date}" />
        </div>
        <div class="field">
          <label>Sold date</label>
          <input id="soldDate" type="date" value="${state.sold_date}" />
        </div>

        <div class="field">
          <label>Cost of acquisition (₹)</label>
          <input id="purchaseValue" type="number" step="any" min="0" value="${state.purchase_value}" />
        </div>
        <div class="field">
          <label>Sale value (₹)</label>
          <input id="saleValue" type="number" step="any" min="0" value="${state.sale_value}" />
        </div>
        <div class="field">
          <label>Transfer expenses (₹)</label>
          <input id="transferExpenses" type="number" step="any" min="0" value="${state.transfer_expenses}" />
        </div>
      </div>

      ${
        showEquity
          ? `
            <div class="card" style="margin-top: 12px;">
              <div class="card__header" style="padding-bottom: 6px;">
                <h3>Equity-specific inputs</h3>
                <p class="card__hint">Used for 111A/112A computations</p>
              </div>
              <div class="form-grid">
                <div class="field">
                  <label>STT paid (eligible for 111A/112A)</label>
                  <div class="row" style="gap: 10px;">
                    <input id="sttPaid" type="checkbox" ${state.stt_paid ? "checked" : ""} />
                    <div class="muted" style="font-size: 12.5px;">Uncheck if you want to estimate using general capital gains rules.</div>
                  </div>
                </div>

                <div class="field">
                  <label>Other 112A LTCG in same FY (₹)</label>
                  <input id="other112a" type="number" step="any" min="0" value="${state.other_112a_ltcg_in_same_fy}" />
                </div>
                <div class="field">
                  <label>Basic exemption remaining (₹)</label>
                  <input id="basicEx" type="number" step="any" min="0" value="${state.basic_exemption_remaining}" />
                </div>
                ${
                  showFmv2018
                    ? `
                      <div class="field">
                        <label>FMV on 31-Jan-2018 (₹)</label>
                        <input id="fmv2018" type="number" step="any" min="0" value="${state.fmv_31jan2018}" />
                      </div>
                    `
                    : `
                      <div class="muted" style="font-size: 12.5px;">FMV on 31-Jan-2018 appears only if acquired before 1-Feb-2018.</div>
                    `
                }
              </div>
            </div>
          `
          : ""
      }

      ${
        showProperty
          ? `
            <div class="card" style="margin-top: 12px;">
              <div class="card__header" style="padding-bottom: 6px;">
                <h3>Property inputs</h3>
                <p class="card__hint">Indexation comparison applies only in some cases</p>
              </div>
              <div class="form-grid">
                <div class="field">
                  <label>Cost of improvement (₹)</label>
                  <input id="improvementCost" type="number" step="any" min="0" value="${state.improvement_cost}" />
                </div>
                <div class="field">
                  <label>Improvement date</label>
                  <input id="improvementDate" type="date" value="${state.improvement_date}" />
                </div>
                <div class="field">
                  <label>Resident individual / HUF</label>
                  <div class="row" style="gap: 10px;">
                    <input id="residentIH" type="checkbox" ${state.resident_individual_or_huf ? "checked" : ""} />
                    <div class="muted" style="font-size: 12.5px;">Enables the land/building "lower tax" comparison where eligible.</div>
                  </div>
                </div>
              </div>
            </div>
          `
          : ""
      }

      <div class="card" style="margin-top: 12px;">
        <div class="card__header" style="padding-bottom: 6px;">
          <h3>Rates</h3>
          <p class="card__hint">Only some fields apply depending on the classification</p>
        </div>

        <div class="form-grid">
          <div class="field">
            <label>Marginal slab rate (decimal)</label>
            <input id="marginalRate" type="number" step="0.01" min="0" max="0.60" value="${state.marginal_rate}" />
            <div class="muted" style="font-size: 12.5px; margin-top: 4px;">
              Example: <span class="mono">0.30</span> = 30%. Used for slab-taxed cases (e.g., 50AA).
              ${showSlabHint ? "" : "If your result is special-rate (111A/112A), this may be ignored."}
            </div>
          </div>

          <div class="field">
            <label>Surcharge rate (decimal)</label>
            <input id="surchargeRate" type="number" step="0.01" min="0" max="1.0" value="${state.surcharge_rate}" />
          </div>

          <div class="field">
            <label>Cess rate (decimal)</label>
            <input id="cessRate" type="number" step="0.01" min="0" max="0.10" value="${state.cess_rate}" />
          </div>
        </div>
      </div>

      <div class="row" style="gap: 10px; align-items: end; margin-top: 12px;">
        <button id="computeBtn" class="btn btn--primary" type="button">
          <span class="spinner" aria-hidden="true"></span>
          <span class="btn__label">Compute tax</span>
        </button>
        <div class="muted" style="font-size: 12.5px; line-height: 1.35;">
          Hover the <span class="mono">i</span> icons for methodology notes. Runs are saved automatically.
        </div>
      </div>
    `;

    // Bind
    const assetSel = document.getElementById("assetType");
    assetSel.value = state.asset_type;
    assetSel.addEventListener("change", () => {
      state.asset_type = assetSel.value;
      // reset some fields when switching asset types (keep amounts)
      renderForm();
    });

    document.getElementById("acquiredDate").addEventListener("change", (e) => {
      state.acquired_date = e.target.value;
      renderForm();
    });
    document.getElementById("soldDate").addEventListener("change", (e) => {
      state.sold_date = e.target.value;
    });

    document.getElementById("purchaseValue").addEventListener("input", (e) => {
      state.purchase_value = Number(e.target.value);
    });
    document.getElementById("saleValue").addEventListener("input", (e) => {
      state.sale_value = Number(e.target.value);
    });
    document.getElementById("transferExpenses").addEventListener("input", (e) => {
      state.transfer_expenses = Number(e.target.value);
    });

    const stt = document.getElementById("sttPaid");
    if (stt) stt.addEventListener("change", (e) => (state.stt_paid = e.target.checked));

    const other112a = document.getElementById("other112a");
    if (other112a) other112a.addEventListener("input", (e) => (state.other_112a_ltcg_in_same_fy = Number(e.target.value || 0)));

    const basicEx = document.getElementById("basicEx");
    if (basicEx) basicEx.addEventListener("input", (e) => (state.basic_exemption_remaining = Number(e.target.value || 0)));

    const fmv = document.getElementById("fmv2018");
    if (fmv) fmv.addEventListener("input", (e) => (state.fmv_31jan2018 = Number(e.target.value || 0)));

    const impCost = document.getElementById("improvementCost");
    if (impCost) impCost.addEventListener("input", (e) => (state.improvement_cost = Number(e.target.value || 0)));
    const impDate = document.getElementById("improvementDate");
    if (impDate) impDate.addEventListener("change", (e) => (state.improvement_date = e.target.value));
    const residentIH = document.getElementById("residentIH");
    if (residentIH) residentIH.addEventListener("change", (e) => (state.resident_individual_or_huf = e.target.checked));

    document.getElementById("marginalRate").addEventListener("input", (e) => {
      state.marginal_rate = Number(e.target.value);
    });
    document.getElementById("surchargeRate").addEventListener("input", (e) => {
      state.surcharge_rate = Number(e.target.value);
    });
    document.getElementById("cessRate").addEventListener("input", (e) => {
      state.cess_rate = Number(e.target.value);
    });

    const btn = document.getElementById("computeBtn");
    btn.addEventListener("click", async () => {
      clearError(errEl);
      setLoading(btn, true);
      try {
        const payload = {
          asset_type: state.asset_type,
          acquired_date: state.acquired_date,
          sold_date: state.sold_date,
          purchase_value: Number(state.purchase_value),
          sale_value: Number(state.sale_value),
          transfer_expenses: Number(state.transfer_expenses || 0),
          stt_paid: !!state.stt_paid,
          fmv_31jan2018: showFmv2018 && state.fmv_31jan2018 > 0 ? Number(state.fmv_31jan2018) : null,
          other_112a_ltcg_in_same_fy: Number(state.other_112a_ltcg_in_same_fy || 0),
          basic_exemption_remaining: Number(state.basic_exemption_remaining || 0),
          marginal_rate: Number.isFinite(state.marginal_rate) ? Number(state.marginal_rate) : null,
          surcharge_rate: Number(state.surcharge_rate || 0),
          cess_rate: Number(state.cess_rate || 0.04),
          improvement_cost: Number(state.improvement_cost || 0),
          improvement_date: state.improvement_date ? state.improvement_date : null,
          resident_individual_or_huf: !!state.resident_individual_or_huf,
        };

        const res = await postJson("/api/v1/tax/compute", payload);
        window.dispatchEvent(new CustomEvent("tax:computed", { detail: { run_id: res.run_id || null } }));
        state.last = res;
        outEl.innerHTML = renderOutput(res);
        toast(`Saved run ${res.run_id}`, "success");
      } catch (e) {
        showError(errEl, String(e.message || e));
      } finally {
        setLoading(btn, false);
      }
    });
  }

  renderForm();
}
