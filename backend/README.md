# Peeyush Jha Labs — FastAPI + SPA demo app

This repo contains a **single deployable web app**:

- A REST API under `/api/v1/...` (FastAPI)
- A static JS single‑page app (served from `/static/...`)

It started life as 12 incremental “steps”; it has now been **consolidated** into one codebase with the same API routes and UI behaviour.

## Feature modules (what the UI exposes)

- **Pricer**
  - Vanilla option (Black–Scholes)
  - Call spread
  - Generic instrument pricer (supports multiple instrument types/methods via the catalog)
- **Batch**
  - Upload CSV, run pricing in bulk, download results CSV
- **Scenario**
  - Shock/reprice workflow (and optionally save a Run)
- **Portfolio**
  - Save portfolio definitions (legs)
  - Price portfolio, payoff chart, scenario grid
- **Strategy Builder**
  - Build common multi‑leg option strategies
- **Macro**
  - Bundled India‑context macro time series
  - Scenario / grid / compare + “stress packs” (built‑in + user‑saved)
- **Profiles**
  - Simple user/profile CRUD (used for scoping saved items)
- **Tax**
  - A small tax calculator module
- **Runs**
  - Saved run history
  - Download stored CSV (when available)
  - Generate a compact **PDF run report**
- **Capital Budgeting**
  - NPV / IRR / MIRR / Payback
  - NPV profile + sensitivity grid
  - Saved automatically to Runs (PDF exportable)
- **Demo Center + Autopilot**
  - Interview‑friendly guided flow through key modules

---

## Run locally

> Run commands from the `backend/` folder (the one that contains `requirements.txt`).

```bash
cd backend

python -m venv .venv
source .venv/bin/activate  # (Windows: .\.venv\Scripts\activate)

pip install -r requirements.txt
pytest
uvicorn app.main:app --reload --port 8000
```

Open:

- UI: http://127.0.0.1:8000
- Docs (Swagger): http://127.0.0.1:8000/docs
- Health: http://127.0.0.1:8000/health

---

## Configuration

Optional environment variables (see `.env.example`):

- `DATABASE_URL`
  - Default if unset: local SQLite
  - Example: `sqlite:///./app.db`
  - Example: `postgresql+psycopg://user:pass@host:5432/dbname`

---

## Testing

```bash
cd backend
pytest
```

This repo includes a `sitecustomize.py` that disables third‑party pytest plugin auto‑loading
to avoid “mysterious” pytest failures on developer machines with unrelated global plugins.

---

## Architecture

```
backend/
  app/
    api/            # FastAPI routes
    db/             # SQLAlchemy models + repository helpers
    schemas/        # Pydantic request/response models
    services/       # Business logic (pricing, portfolio, macro, reports, capbud, …)
    static/         # Frontend SPA (no build step)
    meta/           # Static instrument/method catalog used by UI
    data/           # Bundled offline macro CSV snapshots
  tests/
```
