# Step history (original 1 → 12)

The original delivery was split into incremental “steps”. This file summarizes what each step introduced so you can
trace where a feature came from.

## Step 1 — Vanilla pricer (foundation)

- FastAPI app skeleton + health endpoint
- Vanilla option pricing (Black–Scholes) + Greeks
- Minimal static UI scaffold

## Step 2 — UI wiring + schemas

- Stronger request/response schemas (Pydantic)
- Cleaner API routing structure
- Frontend wiring for the pricer endpoints

## Step 3 — Call spread

- Call-spread pricing endpoint and UI support
- Test coverage for call spread

## Step 4 — Runs + scenario + batch

- SQLite persistence for “runs” (input/output snapshots)
- Scenario “shock & reprice” endpoint
- Batch CSV upload/pricing + downloadable results

## Step 5 — Portfolio module

- Instrument catalog (static metadata consumed by UI)
- Generic instrument pricer endpoint (instrument + method)
- Portfolio definitions (legs) + portfolio pricing/payoff + scenario grid
- Portfolio CRUD storage endpoints

## Step 6 — Refinements

- Mostly UX polish and robustness tweaks
- Test coverage expanded for existing modules

## Step 7 — Strategy builder

- Strategy-builder endpoint(s) and UI
- Generates multi-leg option structures that can be priced/saved

## Step 8 — Macro analytics

- Bundled offline macro CSV snapshots (India-context series)
- Macro scenario and grid endpoints (rates + FX shock framework)
- Macro UI page

## Step 9 — Users & stress packs

- “Profiles” (simple users) for scoping saved data
- Macro stress-pack library (built-ins + DB-stored packs)

## Step 10 — Tax module

- Tax calculator endpoints + UI
- Test coverage for tax calculations

## Step 11 — Run reports

- PDF report generation for stored runs (ReportLab)
- Runs UI improvements + download flows

## Step 12 — Demo Center + Capital Budgeting

- Interview/demo-friendly **Autopilot** tour in the UI
- Capital budgeting module (NPV/IRR/MIRR/payback + sensitivity)
- Extra UX reliability tweaks (pytest plugin autoload hardening)

---

## Where things live now (in the consolidated codebase)

Everything is under `backend/`:

- API routes: `backend/app/api/endpoints/`
- Business logic: `backend/app/services/`
- DB + repository helpers: `backend/app/db/`
- Schemas: `backend/app/schemas/`
- Static UI: `backend/app/static/`
- Macro bundled data: `backend/app/data/macro/bundled/`
