from __future__ import annotations

from fastapi.testclient import TestClient


def test_macro_series_list(client: TestClient) -> None:
    data = client.get("/api/v1/macro/series").json()
    ids = {row["series_id"] for row in data}
    assert "DEXINUS" in ids
    assert "INDIRLTLT01STM" in ids



def test_macro_series_detail(client: TestClient) -> None:
    res = client.get("/api/v1/macro/series/DEXINUS")
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["series"]["series_id"] == "DEXINUS"
    assert isinstance(data["points"], list)
    assert len(data["points"]) > 0
    assert "date" in data["points"][0]
    assert "value" in data["points"][0]


def test_macro_series_unknown_returns_404(client: TestClient) -> None:
    res = client.get("/api/v1/macro/series/NOT_A_REAL_SERIES")
    assert res.status_code == 404
def test_macro_timeline(client: TestClient) -> None:
    data = client.get("/api/v1/macro/timeline?months=12").json()
    pts = data["points"]
    assert 6 <= len(pts) <= 12
    sample = pts[-1]
    assert "month" in sample
    assert "usdinr" in sample
    assert "rate_3m_pct" in sample
    assert "rate_10y_pct" in sample


def test_macro_scenario_overrides(client: TestClient) -> None:
    payload = {
        "scenario": {
            "short_rate_shock_bps": 0,
            "long_rate_shock_bps": 100,
            "fx_spot_shock_pct": 2,
            "inflation_shock_pp": 0,
        },
        "fixed_income": [
            {
                "label": "Bond",
                "notional_inr": 1_000_000,
                "modified_duration": 5.0,
                "convexity": 0.0,
                "rate_bucket": "long",
            }
        ],
        "fx": [{"label": "USD", "notional_usd": 1000}],
        "carry": {"horizon_days": 30, "funding_rate_pct": 0.0},
        "base_usdinr": 90.0,
        "base_rate_3m_pct": 5.0,
        "base_rate_10y_pct": 6.0,
        "save_run": False,
    }
    res = client.post("/api/v1/macro/scenario", json=payload)
    assert res.status_code == 200, res.text
    out = res.json()

    # Bond: -Dur * dY = -5 * 0.01 = -0.05 → -50,000
    # FX spot: 1000 * (90*1.02 - 90) = 1,800
    # FX carry: 1000 * 90 * 0.05 * (30/365) ≈ 369.863
    # Total ≈ -47,830.137
    assert out["run_id"] is None
    assert abs(out["total_pnl_inr"] - (-47_830.137)) < 2.0


def test_macro_grid_shapes(client: TestClient) -> None:
    payload = {
        "scenario": {
            "short_rate_shock_bps": 0,
            "long_rate_shock_bps": 0,
            "fx_spot_shock_pct": 0,
            "inflation_shock_pp": 0,
        },
        "fixed_income": [
            {
                "label": "Bond",
                "notional_inr": 1_000_000,
                "modified_duration": 5.0,
                "convexity": 0.0,
                "rate_bucket": "long",
            }
        ],
        "fx": [{"label": "USD", "notional_usd": 1000}],
        "carry": {"horizon_days": 30, "funding_rate_pct": 0.0},
        "base_usdinr": 90.0,
        "base_rate_3m_pct": 5.0,
        "base_rate_10y_pct": 6.0,
        "fx_spot_shocks_pct": [-1, 0, 1],
        "short_rate_shocks_bps": [],
        "long_rate_shocks_bps": [0, 100],
        "save_run": False,
    }
    res = client.post("/api/v1/macro/grid", json=payload)
    assert res.status_code == 200, res.text
    out = res.json()

    assert out["run_id"] is None
    assert out["fx_spot_shocks_pct"] == [-1, 0, 1]
    assert out["long_rate_shocks_bps"] == [0, 100]
    grid = out["long_rate_grid_pnl"]
    assert len(grid) == 3
    assert all(len(row) == 2 for row in grid)


def test_macro_scenario_can_save_run(client: TestClient) -> None:
    """Regression: saving macro runs must not crash on date serialization."""

    payload = {
        "scenario": {
            "short_rate_shock_bps": 0,
            "long_rate_shock_bps": 100,
            "fx_spot_shock_pct": 2,
            "inflation_shock_pp": 0,
        },
        "fixed_income": [
            {
                "label": "Bond",
                "notional_inr": 1_000_000,
                "modified_duration": 5.0,
                "convexity": 0.0,
                "rate_bucket": "long",
            }
        ],
        "fx": [{"label": "USD", "notional_usd": 1000}],
        "carry": {"horizon_days": 30, "funding_rate_pct": 0.0},
        "base_usdinr": 90.0,
        "base_rate_3m_pct": 5.0,
        "base_rate_10y_pct": 6.0,
        "save_run": True,
    }

    res = client.post("/api/v1/macro/scenario", json=payload)
    assert res.status_code == 200, res.text
    out = res.json()
    assert isinstance(out.get("run_id"), str)
    assert len(out["run_id"]) > 10


def test_macro_grid_can_save_run(client: TestClient) -> None:
    """Regression: saving grid runs must not crash on date serialization."""

    payload = {
        "scenario": {
            "short_rate_shock_bps": 0,
            "long_rate_shock_bps": 0,
            "fx_spot_shock_pct": 0,
            "inflation_shock_pp": 0,
        },
        "fixed_income": [
            {
                "label": "Bond",
                "notional_inr": 1_000_000,
                "modified_duration": 5.0,
                "convexity": 0.0,
                "rate_bucket": "long",
            }
        ],
        "fx": [{"label": "USD", "notional_usd": 1000}],
        "carry": {"horizon_days": 30, "funding_rate_pct": 0.0},
        "base_usdinr": 90.0,
        "base_rate_3m_pct": 5.0,
        "base_rate_10y_pct": 6.0,
        "fx_spot_shocks_pct": [-1, 0, 1],
        "short_rate_shocks_bps": [],
        "long_rate_shocks_bps": [0, 100],
        "save_run": True,
    }

    res = client.post("/api/v1/macro/grid", json=payload)
    assert res.status_code == 200, res.text
    out = res.json()
    assert isinstance(out.get("run_id"), str)
    assert len(out["run_id"]) > 10
