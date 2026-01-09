import {
  clearError,
  fmt,
  mountHtml,
  setLoading,
  showError,
  uploadFile,
} from "./shared.js";

function renderPreview(previewEl, preview) {
  if (!preview || !preview.length) {
    previewEl.innerHTML = `<div class="muted" style="font-size: 12.5px;">No rows.</div>`;
    return;
  }

  const head = `
    <div class="table table--compact table--preview">
      <div class="trow thead">
        <div class="tcell label">Row</div>
        <div class="tcell label">Status</div>
        <div class="tcell label">Price/unit</div>
        <div class="tcell label">Price total</div>
        <div class="tcell label">Error</div>
      </div>
  `;

  const rows = preview
    .map((r) => {
      const out = r.output || {};
      return `
        <div class="trow">
          <div class="tcell mono">${r.row_index}</div>
          <div class="tcell">
            <span class="pill ${r.status === "ok" ? "pill--ok" : "pill--bad"}">${r.status}</span>
          </div>
          <div class="tcell mono">${out.price_per_unit == null ? "—" : fmt(out.price_per_unit)}</div>
          <div class="tcell mono">${out.price_total == null ? "—" : fmt(out.price_total)}</div>
          <div class="tcell mono" style="white-space: normal; overflow-wrap: anywhere;">${r.error || ""}</div>
        </div>
      `;
    })
    .join("");

  previewEl.innerHTML = head + rows + "</div>";
}

function requiredColumns(kind) {
  if (kind === "call_spread") {
    return ["spot","strike_long","strike_short","rate","dividend_yield","vol","time_to_expiry","quantity"];
  }
  return ["option_type","spot","strike","rate","dividend_yield","vol","time_to_expiry","quantity"];
}

function templateCsv(kind) {
  const cols = requiredColumns(kind);
  return cols.join(",") + "\n";
}

export function renderBatch(viewEl) {
  mountHtml(
    viewEl,
    `
      <section class="grid">
        <div class="card">
          <div class="card__header">
            <h2>CSV batch upload</h2>
            <p class="card__hint">Upload deals → get results + downloadable CSV</p>
          </div>

          <div class="form">
            <div class="row">
              <label class="label">
                Batch type
                <select class="control" id="kind">
                  <option value="vanilla">Vanilla</option>
                  <option value="call_spread">Call spread</option>
                </select>
              </label>

              <label class="label">
                CSV file
                <input class="control" id="file" type="file" accept=".csv,text/csv" />
              </label>
            </div>

            <div class="actions">
              <button class="btn btn--primary" id="uploadBtn" type="button">
                <span class="spinner" aria-hidden="true"></span>
                <span class="btn__label">Upload + run</span>
              </button>
              <button class="btn" id="copyTemplateBtn" type="button">Copy header template</button>
              <a class="btn" href="/runs" data-link>View runs</a>
            </div>

            <div class="hint" style="margin-top: 10px;">
              <div class="hint__label">Required columns</div>
              <div class="hint__text mono" id="cols"></div>
            </div>

            <div class="error" id="errorBox" hidden></div>
          </div>
        </div>

        <div class="card">
          <div class="card__header">
            <h2>Results</h2>
            <p class="card__hint">Summary • preview • download</p>
          </div>

          <div class="empty" id="emptyState">
            <div class="empty__icon">⬆</div>
            <div>
              <div class="empty__title">No batch yet</div>
              <div class="empty__text">Upload a CSV to generate outputs.</div>
            </div>
          </div>

          <div id="results" hidden>
            <div class="kpis">
              <div class="kpi">
                <div class="kpi__label">Run ID</div>
                <div class="kpi__value mono" id="runId">—</div>
              </div>
              <div class="kpi">
                <div class="kpi__label">Total rows</div>
                <div class="kpi__value" id="totalRows">—</div>
              </div>
              <div class="kpi">
                <div class="kpi__label">Success</div>
                <div class="kpi__value" id="okRows">—</div>
              </div>
              <div class="kpi">
                <div class="kpi__label">Failed</div>
                <div class="kpi__value" id="badRows">—</div>
              </div>
            </div>

            <div class="actions" style="margin-top: 12px;">
              <a class="btn btn--primary" id="downloadBtn" href="#" target="_blank" rel="noreferrer">Download results CSV</a>
              <button class="btn" id="copyBtn" type="button">Copy JSON</button>
            </div>

            <div class="divider" style="margin: 18px 0;"></div>

            <div>
              <div class="muted" style="font-size: 12.5px; margin-bottom: 8px;">Preview (first rows)</div>
              <div id="preview"></div>
            </div>

            <details class="raw" style="margin-top: 12px;">
              <summary>Raw JSON</summary>
              <pre id="rawJson"></pre>
            </details>
          </div>
        </div>
      </section>
    `
  );

  const kindEl = document.getElementById("kind");
  const fileEl = document.getElementById("file");
  const uploadBtn = document.getElementById("uploadBtn");
  const copyTemplateBtn = document.getElementById("copyTemplateBtn");
  const errorBox = document.getElementById("errorBox");
  const colsEl = document.getElementById("cols");

  const out = {
    emptyState: document.getElementById("emptyState"),
    results: document.getElementById("results"),
    runId: document.getElementById("runId"),
    totalRows: document.getElementById("totalRows"),
    okRows: document.getElementById("okRows"),
    badRows: document.getElementById("badRows"),
    downloadBtn: document.getElementById("downloadBtn"),
    preview: document.getElementById("preview"),
    rawJson: document.getElementById("rawJson"),
  };

  let lastPayload = null;

  function refreshCols() {
    const kind = kindEl.value;
    colsEl.textContent = requiredColumns(kind).join(", ");
  }

  refreshCols();
  kindEl.addEventListener("change", refreshCols);

  copyTemplateBtn.addEventListener("click", async () => {
    const kind = kindEl.value;
    try {
      await navigator.clipboard.writeText(templateCsv(kind));
    } catch (e) {
      showError(errorBox, "Copy failed (clipboard permissions)");
    }
  });

  async function upload() {
    clearError(errorBox);

    const kind = kindEl.value;
    const file = fileEl.files?.[0];
    if (!file) {
      showError(errorBox, "Please choose a CSV file.");
      return;
    }

    setLoading(uploadBtn, true);
    try {
      const url =
        kind === "call_spread"
          ? "/api/v1/batch/call-spread/csv"
          : "/api/v1/batch/vanilla/csv";

      const data = await uploadFile(url, file);
      lastPayload = data;

      out.runId.textContent = data.run_id;
      out.totalRows.textContent = String(data.summary.total_rows);
      out.okRows.textContent = String(data.summary.success_rows);
      out.badRows.textContent = String(data.summary.failed_rows);

      out.downloadBtn.href = data.download_csv_url;

      renderPreview(out.preview, data.preview);
      out.rawJson.textContent = JSON.stringify(data, null, 2);

      out.emptyState.hidden = true;
      out.results.hidden = false;
    } catch (e) {
      showError(errorBox, e?.message ? String(e.message) : "Upload failed");
    } finally {
      setLoading(uploadBtn, false);
    }
  }

  uploadBtn.addEventListener("click", upload);

  document.getElementById("copyBtn").addEventListener("click", async () => {
    if (!lastPayload) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(lastPayload, null, 2));
    } catch (e) {
      showError(errorBox, "Copy failed (clipboard permissions)");
    }
  });
}
