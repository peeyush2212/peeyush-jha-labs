from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from app.api.router import api_router
from app.db.session import Database


def create_app(database_url: str | None = None) -> FastAPI:
    app = FastAPI(title="Peeyush Jha Labs API", version="0.9.0")

    # Database (SQLite by default)
    app.state.db = Database.from_url(database_url)
    app.state.db.create_tables()

    # API routes
    app.include_router(api_router, prefix="/api")

    # Static UI (single-page app)
    static_dir = Path(__file__).resolve().parent / "static"
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    @app.get("/", response_class=HTMLResponse)
    def home() -> HTMLResponse:
        """Serve the UI."""
        index_path = static_dir / "index.html"
        return HTMLResponse(index_path.read_text(encoding="utf-8"))

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    @app.get("/{full_path:path}", response_class=HTMLResponse)
    def spa_fallback(full_path: str) -> HTMLResponse:
        """Serve the SPA shell for any non-API path."""
        if full_path.startswith("api") or full_path.startswith("static"):
            raise HTTPException(status_code=404)
        index_path = static_dir / "index.html"
        return HTMLResponse(index_path.read_text(encoding="utf-8"))

    return app


app = create_app()
