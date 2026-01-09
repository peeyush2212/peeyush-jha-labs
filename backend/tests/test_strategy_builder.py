from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import create_app


def test_strategy_recommend_and_analyze_roundtrip():
    app = create_app(database_url="sqlite://")
    client = TestClient(app)

    recommend_req = {
        "market": {"spot": 100.0, "rate": 0.03, "dividend_yield": 0.0, "vol": 0.20},
        "view": {
            "direction": "bullish",
            "move_pct": 5.0,
            "target_price": None,
            "horizon_days": 21,
            "vol_view": "flat",
            "vol_shift": 0.0,
            "confidence": None,
            "event": False,
        },
        "constraints": {
            "max_loss": None,
            "defined_risk_only": True,
            "income_vs_convexity": 0.55,
            "max_legs": 4,
            "allow_multi_expiry": True,
        },
        "generation": {
            "strike_step": 1.0,
            "width_pct": None,
            "expiry_days": 90,
            "long_expiry_days": 120,
            "tree_steps": 200,
        },
        "method": "black_scholes",
    }

    r = client.post("/api/v1/strategy/recommend", json=recommend_req)
    assert r.status_code == 200, r.text
    payload = r.json()
    assert payload.get("run_id")
    assert isinstance(payload.get("candidates"), list)
    assert len(payload["candidates"]) >= 1

    cand = payload["candidates"][0]
    assert cand.get("candidate_id")
    assert cand.get("strategy_key")
    assert cand.get("name")
    assert isinstance(cand.get("legs"), list)
    assert len(cand["legs"]) >= 1

    analyze_req = {
        "market": recommend_req["market"],
        "view": recommend_req["view"],
        "strategy_key": cand["strategy_key"],
        "name": cand["name"],
        "legs": cand["legs"],
        "settings": {
            "spot_range_pct": 35,
            "spot_steps": 61,
            "grid_spot_shifts_pct": [-10, 0, 10],
            "grid_vol_shifts": [-0.05, 0.0, 0.05],
            "grid_rate_shift_bps": 0,
        },
    }

    r2 = client.post("/api/v1/strategy/analyze", json=analyze_req)
    assert r2.status_code == 200, r2.text
    a = r2.json()
    assert a.get("run_id")
    assert "base_total" in a
    assert "total_greeks" in a
    assert "payoff" in a and len(a["payoff"]["spots"]) == len(a["payoff"]["values"])
    assert "horizon" in a and len(a["horizon"]["spots"]) == len(a["horizon"]["values"])
    assert "heatmap" in a
    assert "scenario_pack" in a


def test_portfolio_import_endpoint():
    app = create_app(database_url="sqlite://")
    client = TestClient(app)

    # Create a simple single-leg portfolio
    payload = {
        "name": "Imported",
        "portfolio": {
            "name": "Imported",
            "legs": [
                {
                    "leg_id": "L1",
                    "instrument_type": "vanilla",
                    "method": "black_scholes",
                    "quantity": 1.0,
                    "params": {"option_type": "call", "strike": 100.0, "time_to_expiry": 1.0},
                }
            ],
        },
    }

    r = client.post("/api/v1/portfolios/import", json=payload)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out.get("portfolio_id")
    assert out.get("name") == "Imported"
    assert out.get("portfolio") and len(out["portfolio"]["legs"]) == 1
