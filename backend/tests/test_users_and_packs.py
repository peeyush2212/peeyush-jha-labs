from __future__ import annotations

from fastapi.testclient import TestClient


def test_user_profiles_crud(client: TestClient) -> None:
    # Create
    res = client.post("/api/v1/users", json={"display_name": "Analyst", "email": "a@example.com"})
    assert res.status_code == 200, res.text
    user = res.json()
    uid = user["user_id"]
    assert uid

    # List
    res = client.get("/api/v1/users")
    assert res.status_code == 200, res.text
    users = res.json()
    assert any(u["user_id"] == uid for u in users)

    # Read
    res = client.get(f"/api/v1/users/{uid}")
    assert res.status_code == 200, res.text
    assert res.json()["display_name"] == "Analyst"

    # Update
    res = client.put(f"/api/v1/users/{uid}", json={"display_name": "Analyst 2", "email": None})
    assert res.status_code == 200, res.text
    assert res.json()["display_name"] == "Analyst 2"

    # Delete
    res = client.delete(f"/api/v1/users/{uid}")
    assert res.status_code == 200, res.text
    assert res.json().get("status") == "deleted"

    # Gone
    res = client.get(f"/api/v1/users/{uid}")
    assert res.status_code == 404


def test_stress_packs_library_and_custom_pack(client: TestClient) -> None:
    # Create a user and use X-User-Id to scope custom packs
    res = client.post("/api/v1/users", json={"display_name": "User", "email": None})
    assert res.status_code == 200, res.text
    uid = res.json()["user_id"]
    headers = {"X-User-Id": uid}

    res = client.get("/api/v1/macro/stress-packs", headers=headers)
    assert res.status_code == 200, res.text
    packs = res.json()
    assert len(packs) >= 3
    assert any(p.get("is_builtin") for p in packs)

    # Create custom pack
    payload = {
        "name": "Test pack",
        "description": "Unit-test created",
        "tags": ["test"],
        "scenario": {
            "short_rate_shock_bps": 10,
            "long_rate_shock_bps": 20,
            "fx_spot_shock_pct": 1.5,
            "inflation_shock_pp": 0,
        },
    }
    res = client.post("/api/v1/macro/stress-packs", json=payload, headers=headers)
    assert res.status_code == 200, res.text
    created = res.json()
    assert created["name"] == "Test pack"
    assert created["owner_user_id"] == uid
    assert created["is_builtin"] is False

    # List includes it
    res = client.get("/api/v1/macro/stress-packs", headers=headers)
    assert res.status_code == 200, res.text
    packs = res.json()
    assert any(p["pack_id"] == created["pack_id"] for p in packs)


def test_macro_compare_endpoint(client: TestClient) -> None:
    # Use overrides so the test is deterministic and does not depend on remote macro data.
    req = {
        "fixed_income": [
            {
                "label": "10Y G-Sec (DV01 approx)",
                "notional_inr": 1_000_000,
                "modified_duration": 6.0,
                "is_receiver": True,
            }
        ],
        "fx": [{"label": "USDINR", "notional_usd": 10_000}],
        "carry": {"horizon_days": 30, "funding_rate_pct": 7.0},
        "base_usdinr": 83.0,
        "base_rate_3m_pct": 7.1,
        "base_rate_10y_pct": 7.2,
        "scenarios": [
            {
                "name": "Risk-off",
                "scenario": {
                    "short_rate_shock_bps": 50,
                    "long_rate_shock_bps": 150,
                    "fx_spot_shock_pct": 3.0,
                    "inflation_shock_pp": 0,
                },
            },
            {
                "name": "Risk-on",
                "scenario": {
                    "short_rate_shock_bps": -25,
                    "long_rate_shock_bps": -75,
                    "fx_spot_shock_pct": -1.0,
                    "inflation_shock_pp": 0,
                },
            },
        ],
        "save_run": False,
    }

    res = client.post("/api/v1/macro/compare", json=req)
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["base_usdinr"] == 83.0
    assert len(out["items"]) == 2
    assert out["items"][0]["name"] == "Risk-off"

    totals = [item["total_pnl_inr"] for item in out["items"]]
    # Different scenarios should not have identical totals
    assert totals[0] != totals[1]
