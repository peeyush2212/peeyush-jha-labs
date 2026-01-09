import math
import io

import pytest


def test_health_ok(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_vanilla_call_known_value(client):
    payload = {
        "option_type": "call",
        "spot": 100,
        "strike": 100,
        "rate": 0.05,
        "dividend_yield": 0.0,
        "vol": 0.20,
        "time_to_expiry": 1.0,
        "quantity": 1,
    }
    r = client.post("/api/v1/pricing/vanilla", json=payload)
    assert r.status_code == 200
    data = r.json()

    # Reference value for this parameter set (Black–Scholes) ≈ 10.4506
    assert abs(data["price_per_unit"] - 10.4505836) < 1e-3
    assert abs(data["price_total"] - data["price_per_unit"]) < 1e-9

    g = data["greeks"]
    for k in ["delta", "gamma", "vega", "theta", "rho"]:
        assert k in g
        assert isinstance(g[k], (int, float))


def test_put_call_parity(client):
    base = {
        "spot": 125.0,
        "strike": 130.0,
        "rate": 0.03,
        "dividend_yield": 0.01,
        "vol": 0.25,
        "time_to_expiry": 0.75,
        "quantity": 1,
    }

    call = client.post("/api/v1/pricing/vanilla", json={**base, "option_type": "call"}).json()
    put = client.post("/api/v1/pricing/vanilla", json={**base, "option_type": "put"}).json()

    lhs = call["price_per_unit"] - put["price_per_unit"]
    rhs = base["spot"] * math.exp(-base["dividend_yield"] * base["time_to_expiry"]) - base["strike"] * math.exp(
        -base["rate"] * base["time_to_expiry"]
    )

    assert abs(lhs - rhs) < 1e-6


def test_call_spread_matches_difference_of_calls(client):
    base = {
        "spot": 100.0,
        "rate": 0.04,
        "dividend_yield": 0.00,
        "vol": 0.22,
        "time_to_expiry": 0.75,
        "quantity": 1,
    }

    k1 = 95.0
    k2 = 110.0

    call1 = client.post("/api/v1/pricing/vanilla", json={**base, "option_type": "call", "strike": k1}).json()
    call2 = client.post("/api/v1/pricing/vanilla", json={**base, "option_type": "call", "strike": k2}).json()

    spread = client.post(
        "/api/v1/pricing/call-spread",
        json={
            **base,
            "strike_long": k1,
            "strike_short": k2,
        },
    )
    assert spread.status_code == 200
    data = spread.json()

    expected = call1["price_per_unit"] - call2["price_per_unit"]
    assert data["price_per_unit"] == pytest.approx(expected, rel=1e-12, abs=1e-12)


def test_call_spread_quantity_scales_total(client):
    payload = {
        "spot": 100.0,
        "strike_long": 95.0,
        "strike_short": 110.0,
        "rate": 0.04,
        "dividend_yield": 0.00,
        "vol": 0.22,
        "time_to_expiry": 0.75,
        "quantity": 12.5,
    }

    r = client.post("/api/v1/pricing/call-spread", json=payload)
    assert r.status_code == 200
    data = r.json()

    assert data["price_total"] == pytest.approx(data["price_per_unit"] * payload["quantity"], rel=1e-12, abs=1e-12)


def test_runs_are_persisted_and_retrievable(client):
    payload = {
        "option_type": "call",
        "spot": 100,
        "strike": 105,
        "rate": 0.03,
        "dividend_yield": 0.0,
        "vol": 0.25,
        "time_to_expiry": 0.5,
        "quantity": 3,
    }
    r = client.post("/api/v1/pricing/vanilla", json=payload)
    assert r.status_code == 200
    run_id = r.json()["run_id"]

    lr = client.get("/api/v1/runs?limit=10")
    assert lr.status_code == 200
    items = lr.json()["items"]
    assert any(x["run_id"] == run_id for x in items)

    gr = client.get(f"/api/v1/runs/{run_id}")
    assert gr.status_code == 200
    detail = gr.json()
    assert detail["run_id"] == run_id
    assert detail["run_type"] == "vanilla"
    assert detail["input"]["strike"] == 105
    assert "price_per_unit" in detail["output"]


def test_scenario_reprice_and_persist(client):
    payload = {
        "base": {
            "option_type": "call",
            "spot": 100,
            "strike": 100,
            "rate": 0.05,
            "dividend_yield": 0.0,
            "vol": 0.20,
            "time_to_expiry": 1.0,
            "quantity": 10,
        },
        "shocks": {"spot_shift_pct": 5.0, "vol_shift": 0.01, "rate_shift_bps": 25},
    }
    r = client.post("/api/v1/scenario/vanilla-reprice", json=payload)
    assert r.status_code == 200
    j = r.json()
    run_id = j["run_id"]
    assert j["base"]["price_total"] is not None
    assert j["shocked"]["price_total"] is not None

    gr = client.get(f"/api/v1/runs/{run_id}")
    assert gr.status_code == 200
    assert gr.json()["run_type"] == "scenario_vanilla"


def test_batch_vanilla_csv_upload_and_download(client):
    csv_text = (
        "option_type,spot,strike,rate,dividend_yield,vol,time_to_expiry,quantity\n"
        "call,100,100,0.05,0.0,0.2,1.0,1\n"
        "call,100,100,0.05,0.0,-0.2,1.0,1\n"
    )
    files = {"file": ("vanilla.csv", csv_text.encode("utf-8"), "text/csv")}
    r = client.post("/api/v1/batch/vanilla/csv", files=files)
    assert r.status_code == 200
    j = r.json()
    assert j["summary"]["total_rows"] == 2
    assert j["summary"]["success_rows"] == 1
    assert j["summary"]["failed_rows"] == 1

    run_id = j["run_id"]
    dl = client.get(j["download_csv_url"])
    assert dl.status_code == 200
    assert "row_index,status,error,price_per_unit" in dl.text
    assert f"run_{run_id}.csv" in dl.headers.get("content-disposition", "")


def test_batch_call_spread_csv_upload_and_download(client):
    csv_text = (
        "spot,strike_long,strike_short,rate,dividend_yield,vol,time_to_expiry,quantity\n"
        "100,95,110,0.04,0.0,0.22,0.75,1\n"
        "100,110,95,0.04,0.0,0.22,0.75,1\n"
    )
    files = {"file": ("spread.csv", csv_text.encode("utf-8"), "text/csv")}
    r = client.post("/api/v1/batch/call-spread/csv", files=files)
    assert r.status_code == 200
    j = r.json()
    assert j["summary"]["total_rows"] == 2
    assert j["summary"]["success_rows"] == 1
    assert j["summary"]["failed_rows"] == 1

    dl = client.get(j["download_csv_url"])
    assert dl.status_code == 200
    assert "row_index,status,error,price_per_unit" in dl.text
