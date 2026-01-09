import { mountHtml } from "./shared.js";

export function renderHome(viewEl) {
  mountHtml(
    viewEl,
    `
      <section class="grid">
        <div class="card">
          <div class="card__header">
            <h2>Overview</h2>
            <p class="card__hint">Quick entry points</p>
          </div>

          <div class="home-cards">
            <a class="home-card" href="/pricer" data-link>
              <div class="home-card__title">Instrument pricer</div>
              <div class="home-card__text">Pick an instrument + method, then run inputs → outputs.</div>
            </a>

            <a class="home-card" href="/portfolio" data-link>
              <div class="home-card__title">Portfolio workbench</div>
              <div class="home-card__text">Multi-leg builder, payoff profile, scenario grid, saved portfolios.</div>
            </a>

            <a class="home-card" href="/strategy" data-link>
              <div class="home-card__title">Strategy builder</div>
              <div class="home-card__text">View → candidate structures → scenario analysis → save as portfolio.</div>
            </a>

            <a class="home-card" href="/macro" data-link>
              <div class="home-card__title">Macro scenario explorer</div>
              <div class="home-card__text">Rates/FX stress testing (India-context indicators) + portfolio P&amp;L grids.</div>
            </a>

            <a class="home-card" href="/scenario" data-link>
              <div class="home-card__title">Scenario reprice</div>
              <div class="home-card__text">Apply shocks and compare base vs shocked outputs.</div>
            </a>

            <a class="home-card" href="/tax" data-link>
              <div class="home-card__title">Tax calculator</div>
              <div class="home-card__text">Indian capital gains &amp; VDA estimation + what-if scenarios.</div>
            </a>

            <a class="home-card" href="/batch" data-link>
              <div class="home-card__title">CSV batch</div>
              <div class="home-card__text">Upload a CSV and download results.</div>
            </a>

            <a class="home-card" href="/runs" data-link>
              <div class="home-card__title">Run history</div>
              <div class="home-card__text">Browse saved runs and download CSV outputs.</div>
            </a>
          </div>

          <div class="muted" style="margin-top: 14px; font-size: 12.5px;">
            Everything here is input-driven. Each run returns a Run ID.
          </div>

          <div class="home-cta" style="margin-top: 14px;">
            <button class="btn btn--primary" id="homeStartAutopilot" type="button">Start guided demo</button>
            <button class="btn btn--ghost" id="homeOpenDemoCenter" type="button">Demo menu</button>
            <a class="btn btn--ghost" href="/pricer" data-link>Open Pricer</a>
          </div>
        </div>

        <div class="card">
          <div class="card__header">
            <h2>What the site can do</h2>
            <p class="card__hint">Designed for fast, reusable quant workflows</p>
          </div>

          <div class="home-features">
            <div class="home-feature">
              <div class="home-feature__title">Prices + Greeks</div>
              <div class="home-feature__text">Closed‑form and Monte Carlo methods with per‑unit + total outputs.</div>
            </div>

            <div class="home-feature">
              <div class="home-feature__title">Strategy search + risk views</div>
              <div class="home-feature__text">Generate candidates, compare scenarios, and visualize spot×vol sensitivity heatmaps.</div>
            </div>

            <div class="home-feature">
              <div class="home-feature__title">Macro stress packs</div>
              <div class="home-feature__text">Apply prebuilt shocks for rates/FX and roll the P&amp;L through tagged positions.</div>
            </div>

            <div class="home-feature">
              <div class="home-feature__title">Saved runs + exports</div>
              <div class="home-feature__text">Every compute is saved as a Run ID (SQL by default) with CSV/PDF export flows.</div>
            </div>
          </div>

          <div class="muted" style="margin-top: 14px; font-size: 12.5px;">
            Pro tip: press <span class="mono">Ctrl + K</span> for the command palette, or toggle <b>Demo</b> for guided checklists.
          </div>
        </div>
      </section>
    `
  );

  // Wire up home CTAs (guarded so it never throws if UX hasn't mounted yet)
  viewEl.querySelector("#homeStartAutopilot")?.addEventListener("click", () => {
    window.__ux_ctx?.startAutopilot?.("full");
  });
  viewEl.querySelector("#homeOpenDemoCenter")?.addEventListener("click", () => {
    window.__ux_ctx?.openDemoCenter?.();
  });
}
