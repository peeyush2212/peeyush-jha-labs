export const UI_VERSION = "1.3";

export function fmt(x, decimals = 6) {
  if (typeof x !== "number" || !Number.isFinite(x)) return "—";
  const abs = Math.abs(x);
  if (abs >= 1000) return x.toFixed(2);
  if (abs >= 1) return x.toFixed(4);
  return x.toFixed(decimals);
}

export function setActiveNav(pathname) {
  document.querySelectorAll(".nav-link").forEach((a) => {
    const href = a.getAttribute("href");
    a.classList.toggle("active", href === pathname);
  });
}

export function getActiveUserId() {
  try {
    return (localStorage.getItem("activeUserId") || "").trim();
  } catch (_) {
    return "";
  }
}

function _userHeaders() {
  const uid = getActiveUserId();
  return uid ? { "X-User-Id": uid } : {};
}

export async function checkHealth() {
  const apiStatus = document.getElementById("apiStatus");
  try {
    const r = await fetch("/health");
    if (!r.ok) throw new Error("health not ok");
    const j = await r.json();
    if (j.status !== "ok") throw new Error("unexpected health payload");

    apiStatus.textContent = "API: online";
    apiStatus.style.borderColor = "rgba(122, 168, 255, 0.42)";
    apiStatus.style.color = "rgba(255,255,255,0.80)";
  } catch (e) {
    apiStatus.textContent = "API: offline";
    apiStatus.style.borderColor = "rgba(255, 90, 122, 0.55)";
    apiStatus.style.color = "rgba(255,255,255,0.80)";
  }
}

export function setLoading(btnEl, isLoading) {
  if (!btnEl) return;
  if (isLoading) {
    btnEl.classList.add("loading");
    btnEl.disabled = true;
  } else {
    btnEl.classList.remove("loading");
    btnEl.disabled = false;
  }
}

export function showError(boxEl, message) {
  if (!boxEl) return;
  boxEl.hidden = false;
  boxEl.textContent = message;
}

export function clearError(boxEl) {
  if (!boxEl) return;
  boxEl.hidden = true;
  boxEl.textContent = "";
}

export function toast(message, kind = "info", timeoutMs = 3200) {
  const root = document.getElementById("toastRoot");
  if (!root) return;

  const el = document.createElement("div");
  el.className = `toast toast--${kind}`;
  el.textContent = message;

  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add("toast--show"));

  window.setTimeout(() => {
    el.classList.remove("toast--show");
    window.setTimeout(() => el.remove(), 220);
  }, timeoutMs);
}

export async function postJson(url, payload) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ..._userHeaders() },
    body: JSON.stringify(payload),
  });

  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    const msg = data?.detail ? String(data.detail) : `HTTP ${resp.status}`;
    throw new Error(msg);
  }
  return data;
}

export async function putJson(url, payload) {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ..._userHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${txt}`);
  }
  return await res.json();
}

export async function getJson(url) {
  const resp = await fetch(url, { method: "GET", headers: { ..._userHeaders() } });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    const msg = data?.detail ? String(data.detail) : `HTTP ${resp.status}`;
    throw new Error(msg);
  }
  return data;
}

export async function uploadFile(url, file) {
  const form = new FormData();
  form.append("file", file);

  const resp = await fetch(url, { method: "POST", headers: { ..._userHeaders() }, body: form });
  const data = await resp.json().catch(() => null);
  if (!resp.ok) {
    const msg = data?.detail ? String(data.detail) : `HTTP ${resp.status}`;
    throw new Error(msg);
  }
  return data;
}

export function mountHtml(viewEl, html) {
  viewEl.innerHTML = html;
}

// --- Shared helpers for multi-page modules ---
export function toPct(x, decimals = 2) {
  if (typeof x !== "number" || !Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(decimals)}%`;
}

export function ensureMarketDefaults(market, catalog) {
  market = market || {};
  if (!catalog || !Array.isArray(catalog.market_params)) return market;
  for (const p of catalog.market_params) {
    if (market[p.key] === undefined) market[p.key] = p.default;
  }
  return market;
}

// ------------------------
// Drafts (clone-from-runs)
// ------------------------
const LS_DRAFT = "pjDraftV1";

export function setDraft(draft) {
  try {
    localStorage.setItem(LS_DRAFT, JSON.stringify(draft || {}));
  } catch (_) {
    // ignore
  }
}

export function peekDraft() {
  try {
    const raw = localStorage.getItem(LS_DRAFT);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

export function consumeDraft(targetPath) {
  const d = peekDraft();
  if (!d || !d.target) return null;
  if (String(d.target) !== String(targetPath)) return null;
  try {
    localStorage.removeItem(LS_DRAFT);
  } catch (_) {
    // ignore
  }
  return d;
}

export function clearDraft() {
  try {
    localStorage.removeItem(LS_DRAFT);
  } catch (_) {
    // ignore
  }
}

// ------------------------
// Downloads
// ------------------------
export function downloadText(filename, text, mime = "text/plain") {
  const blob = new Blob([String(text)], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "download.txt";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
