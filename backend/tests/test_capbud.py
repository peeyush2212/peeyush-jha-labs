import math


def test_capbud_compute_and_persist_run(client):
    payload = {
        "project_name": "Demo Project",
        "currency": "USD",
        "discount_rate": 0.10,
        "cashflows": [-1000.0, 300.0, 300.0, 300.0, 300.0, 300.0],
        "convention": "end_of_period",
    }

    r = client.post("/api/v1/capbud/compute", json=payload)
    assert r.status_code == 200

    j = r.json()
    assert j["run_type"] == "capbud.compute"
    assert "run_id" in j and isinstance(j["run_id"], str)

    # NPV should be positive for this toy project at 10%.
    assert math.isfinite(j["npv"])
    assert j["npv"] > 0

    # IRR should be around 15.24%
    assert j["irr"] is not None
    assert abs(j["irr"] - 0.152382) < 1e-3

    # Run should be persisted.
    run_id = j["run_id"]
    r2 = client.get(f"/api/v1/runs/{run_id}")
    assert r2.status_code == 200
    run = r2.json()
    assert run["run_type"] == "capbud.compute"
