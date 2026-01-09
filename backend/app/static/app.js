import { UI_VERSION, checkHealth, mountHtml, setActiveNav } from "./pages/shared.js";
import { initProfiles } from "./pages/profiles.js";
import { renderHome } from "./pages/home.js";
import { renderVanilla } from "./pages/vanilla.js";
import { renderCallSpread } from "./pages/call_spread.js";
import { renderPricer } from "./pages/pricer.js";
import { renderPortfolio } from "./pages/portfolio.js";
import { renderScenario } from "./pages/scenario.js";
import { renderBatch } from "./pages/batch.js";
import { renderRuns } from "./pages/runs.js";
import { renderStrategyBuilder } from "./pages/strategy_builder.js";
import { renderMacro } from "./pages/macro.js";
import { renderTax } from "./pages/tax.js";
import { renderCapBud } from "./pages/capbud.js";
import { initUX } from "./pages/ux.js";
import { initQuantFx } from "./pages/quant_fx.js";

const routes = {
  "/": renderHome,
  "/pricer": renderPricer,
  "/portfolio": renderPortfolio,
  "/strategy": renderStrategyBuilder,
  "/macro": renderMacro,
  "/tax": renderTax,
  "/capbud": renderCapBud,
  "/vanilla": renderVanilla,
  "/call-spread": renderCallSpread,
  "/scenario": renderScenario,
  "/batch": renderBatch,
  "/runs": renderRuns,
};

function renderNotFound(viewEl, pathname) {
  mountHtml(
    viewEl,
    `
      <section class="grid">
        <div class="card">
          <div class="card__header">
            <h2>Page not found</h2>
            <p class="card__hint">${pathname}</p>
          </div>
          <div class="muted" style="font-size: 12.5px;">
            Use the navigation at the top to continue.
          </div>
        </div>
      </section>
    `
  );
}

function router() {
  const pathname = window.location.pathname || "/";
  const viewEl = document.getElementById("view");

  // Expose route for CSS-conditional UI (e.g., home-only background FX)
  document.body.dataset.route = pathname;

  setActiveNav(pathname);

  const view = routes[pathname];
  if (view) {
    view(viewEl);
  } else {
    renderNotFound(viewEl, pathname);
  }

  window.dispatchEvent(new CustomEvent("route:changed", { detail: { pathname } }));
}

function navigateTo(url) {
  history.pushState(null, null, url);
  router();
}

document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-link]");
  if (!a) return;

  const href = a.getAttribute("href");
  if (!href) return;

  // Only intercept same-origin app links
  if (href.startsWith("http")) return;

  e.preventDefault();
  navigateTo(href);
});

window.addEventListener("popstate", router);

window.addEventListener("profile:changed", () => {
  // Rerender current route so profile-scoped data refreshes.
  router();
});

(async () => {
  // Footer version
  const vEl = document.getElementById("uiVersion");
  if (vEl) vEl.textContent = UI_VERSION;

  await initProfiles();
  initUX({ navigateTo, routes });
  initQuantFx();
  checkHealth();
  router();
})();
