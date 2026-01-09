def test_run_pdf_report_endpoint(client):
    # Create a run via vanilla pricer
    payload = {
        "option_type": "call",
        "spot": 100.0,
        "strike": 100.0,
        "rate": 0.02,
        "dividend_yield": 0.0,
        "vol": 0.2,
        "time_to_expiry": 1.0,
        "quantity": 1,
    }
    r = client.post("/api/v1/pricing/vanilla", json=payload)
    assert r.status_code == 200
    run_id = r.json()["run_id"]

    pdf = client.get(f"/api/v1/runs/{run_id}/report.pdf")
    assert pdf.status_code == 200
    assert pdf.headers["content-type"].startswith("application/pdf")
    assert pdf.content[:4] == b"%PDF"
