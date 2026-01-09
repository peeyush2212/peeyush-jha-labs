import math

import pytest


def test_meta_catalog_available(client):
    r = client.get("/api/v1/meta/instruments")
    assert r.status_code == 200
    data = r.json()
    assert "market_params" in data
    assert "instruments" in data
    assert any(x["key"] == "vanilla" for x in data["instruments"])


def test_instrument_endpoint_vanilla_matches_dedicated_vanilla(client):
    market = {"spot": 100, "rate": 0.05, "dividend_yield": 0.0, "vol": 0.20}
    leg = {
        "leg_id": "L1",
        "instrument_type": "vanilla",
        "method": "black_scholes",
        "quantity": 1,
        "params": {"option_type": "call", "strike": 100, "time_to_expiry": 1.0},
    }

    r = client.post("/api/v1/pricing/instrument", json={"market": market, "leg": leg})
    assert r.status_code == 200
    res = r.json()["result"]

    r2 = client.post(
        "/api/v1/pricing/vanilla",
        json={
            "option_type": "call",
            "spot": market["spot"],
            "strike": 100,
            "rate": market["rate"],
            "dividend_yield": market["dividend_yield"],
            "vol": market["vol"],
            "time_to_expiry": 1.0,
            "quantity": 1,
        },
    )
    assert r2.status_code == 200
    vanilla = r2.json()

    assert res["status"] == "ok"
    assert res["price_per_unit"] == pytest.approx(vanilla["price_per_unit"], rel=1e-12, abs=1e-12)


def test_binomial_european_close_to_bs(client):
    market = {"spot": 100, "rate": 0.03, "dividend_yield": 0.0, "vol": 0.25}
    leg = {
        "leg_id": "L1",
        "instrument_type": "vanilla",
        "method": "binomial_crr",
        "quantity": 1,
        "params": {"option_type": "call", "strike": 100, "time_to_expiry": 1.0, "steps": 300},
    }
    r = client.post("/api/v1/pricing/instrument", json={"market": market, "leg": leg})
    assert r.status_code == 200
    binom = r.json()["result"]["price_per_unit"]

    bs = client.post(
        "/api/v1/pricing/vanilla",
        json={
            "option_type": "call",
            "spot": market["spot"],
            "strike": 100,
            "rate": market["rate"],
            "dividend_yield": market["dividend_yield"],
            "vol": market["vol"],
            "time_to_expiry": 1.0,
            "quantity": 1,
        },
    ).json()["price_per_unit"]

    assert binom == pytest.approx(bs, rel=0.0, abs=0.25)


def test_american_put_ge_european_put(client):
    market = {"spot": 40.0, "rate": 0.06, "dividend_yield": 0.0, "vol": 0.25}
    K = 50.0
    T = 1.0

    european_put = client.post(
        "/api/v1/pricing/vanilla",
        json={
            "option_type": "put",
            "spot": market["spot"],
            "strike": K,
            "rate": market["rate"],
            "dividend_yield": market["dividend_yield"],
            "vol": market["vol"],
            "time_to_expiry": T,
            "quantity": 1,
        },
    ).json()["price_per_unit"]

    american_leg = {
        "leg_id": "A1",
        "instrument_type": "american",
        "method": "binomial_crr",
        "quantity": 1,
        "params": {"option_type": "put", "strike": K, "time_to_expiry": T, "steps": 400},
    }
    american_put = client.post(
        "/api/v1/pricing/instrument",
        json={"market": market, "leg": american_leg},
    ).json()["result"]["price_per_unit"]

    assert american_put + 1e-9 >= european_put - 0.05


def test_portfolio_crud_and_pricing(client):
    # Create
    cr = client.post("/api/v1/portfolios", json={"name": "Test Portfolio"})
    assert cr.status_code == 200
    detail = cr.json()
    pid = detail["portfolio_id"]

    # Update with legs
    legs = [
        {
            "leg_id": "L1",
            "instrument_type": "vanilla",
            "method": "black_scholes",
            "quantity": 1,
            "params": {"option_type": "call", "strike": 95.0, "time_to_expiry": 0.75},
        },
        {
            "leg_id": "L2",
            "instrument_type": "vanilla",
            "method": "black_scholes",
            "quantity": -1,
            "params": {"option_type": "call", "strike": 110.0, "time_to_expiry": 0.75},
        },
    ]

    up = client.put(
        f"/api/v1/portfolios/{pid}",
        json={"name": "Test Portfolio", "portfolio": {"name": "Test Portfolio", "legs": legs}},
    )
    assert up.status_code == 200

    # List includes it
    ls = client.get("/api/v1/portfolios?limit=50&offset=0")
    assert ls.status_code == 200
    assert any(x["portfolio_id"] == pid for x in ls.json())

    # Price matches call spread
    market = {"spot": 100.0, "rate": 0.04, "dividend_yield": 0.0, "vol": 0.22}
    port_price = client.post(
        "/api/v1/portfolio/price",
        json={"market": market, "portfolio": {"name": "Test Portfolio", "legs": legs}, "strict": False},
    )
    assert port_price.status_code == 200
    pv = port_price.json()["total_price"]

    spread = client.post(
        "/api/v1/pricing/call-spread",
        json={
            "spot": market["spot"],
            "strike_long": 95.0,
            "strike_short": 110.0,
            "rate": market["rate"],
            "dividend_yield": market["dividend_yield"],
            "vol": market["vol"],
            "time_to_expiry": 0.75,
            "quantity": 1,
        },
    ).json()["price_per_unit"]

    assert pv == pytest.approx(spread, rel=1e-10, abs=1e-10)

    # Payoff excludes barrier
    legs_with_barrier = legs + [
        {
            "leg_id": "B1",
            "instrument_type": "barrier",
            "method": "mc_discrete",
            "quantity": 1,
            "params": {
                "option_type": "call",
                "strike": 100.0,
                "time_to_expiry": 0.75,
                "barrier_level": 130.0,
                "barrier_direction": "up",
                "paths": 1000,
                "steps": 24,
                "seed": 7,
            },
        }
    ]
    po = client.post(
        "/api/v1/portfolio/payoff",
        json={"portfolio": {"name": "X", "legs": legs_with_barrier}, "spot_min": 50, "spot_max": 150, "steps": 11},
    )
    assert po.status_code == 200
    excluded = po.json()["excluded"]
    assert any(x["leg_id"] == "B1" for x in excluded)

    # Scenario grid returns expected shape
    grid = client.post(
        "/api/v1/portfolio/scenario-grid",
        json={
            "market": market,
            "portfolio": {"name": "X", "legs": legs},
            "spot_shifts_pct": [-10, 0, 10],
            "vol_shifts": [-0.02, 0.0, 0.02],
            "rate_shift_bps": 0,
        },
    )
    assert grid.status_code == 200
    gj = grid.json()
    assert len(gj["grid_totals"]) == 3
    assert len(gj["grid_totals"][0]) == 3

    # Delete
    dl = client.delete(f"/api/v1/portfolios/{pid}")
    assert dl.status_code == 200
