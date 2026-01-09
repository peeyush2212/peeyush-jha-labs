from __future__ import annotations

from fastapi.testclient import TestClient


def test_tax_equity_stcg_111a_post_reform_rate(client: TestClient) -> None:
    payload = {
        "asset_type": "listed_equity_stt",
        "acquired_date": "2025-01-01",
        "sold_date": "2025-06-01",
        "purchase_value": 100_000,
        "sale_value": 120_000,
        "transfer_expenses": 0,
        "stt_paid": True,
        "other_112a_ltcg_in_same_fy": 0,
        "basic_exemption_remaining": 0,
        "marginal_rate": 0.30,
        "surcharge_rate": 0.0,
        "cess_rate": 0.04,
    }

    res = client.post("/api/v1/tax/compute", json=payload)
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["classification"].startswith("STCG")
    # Post-23 Jul 2024 STCG rate is 20%
    assert abs(out["base_rate"] - 0.20) < 1e-9
    assert abs(out["base_tax"] - 4_000.0) < 1e-6
    assert abs(out["total_tax"] - 4_160.0) < 1e-6


def test_tax_equity_ltcg_112a_threshold_and_rate(client: TestClient) -> None:
    payload = {
        "asset_type": "listed_equity_stt",
        "acquired_date": "2024-01-01",
        "sold_date": "2025-02-02",
        "purchase_value": 100_000,
        "sale_value": 250_000,
        "transfer_expenses": 0,
        "stt_paid": True,
        "other_112a_ltcg_in_same_fy": 0,
        "basic_exemption_remaining": 0,
        "marginal_rate": 0.30,
        "surcharge_rate": 0.0,
        "cess_rate": 0.04,
    }

    res = client.post("/api/v1/tax/compute", json=payload)
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["classification"].startswith("LTCG")
    assert abs(out["base_rate"] - 0.125) < 1e-9
    # Gain: 150k, exemption 125k -> taxable 25k -> base tax 3125 -> +4% cess = 3250
    assert abs(out["taxable_gain"] - 25_000.0) < 1e-6
    assert abs(out["base_tax"] - 3_125.0) < 1e-6
    assert abs(out["total_tax"] - 3_250.0) < 1e-6


def test_tax_equity_112a_grandfathering_cost_basis(client: TestClient) -> None:
    payload = {
        "asset_type": "listed_equity_stt",
        "acquired_date": "2017-01-01",
        "sold_date": "2025-02-02",
        "purchase_value": 100_000,
        "sale_value": 400_000,
        "transfer_expenses": 0,
        "stt_paid": True,
        "fmv_31jan2018": 180_000,
        "other_112a_ltcg_in_same_fy": 0,
        "basic_exemption_remaining": 0,
        "marginal_rate": 0.30,
        "surcharge_rate": 0.0,
        "cess_rate": 0.04,
    }
    res = client.post("/api/v1/tax/compute", json=payload)
    assert res.status_code == 200, res.text
    out = res.json()
    # Cost basis becomes max(100k, min(180k, 400k)) = 180k -> gain 220k -> taxable 95k
    assert abs(out["taxable_gain"] - 95_000.0) < 1e-6
    assert abs(out["base_tax"] - (95_000.0 * 0.125)) < 1e-6


def test_tax_property_comparison_can_reduce_tax_to_zero(client: TestClient) -> None:
    payload = {
        "asset_type": "land_building",
        "acquired_date": "2010-04-01",
        "sold_date": "2025-08-01",
        "purchase_value": 1_000_000,
        "sale_value": 1_500_000,
        "transfer_expenses": 0,
        "improvement_cost": 0,
        "improvement_date": None,
        "resident_individual_or_huf": True,
        "marginal_rate": 0.30,
        "surcharge_rate": 0.0,
        "cess_rate": 0.04,
    }
    res = client.post("/api/v1/tax/compute", json=payload)
    assert res.status_code == 200, res.text
    out = res.json()
    # With heavy indexation, old-method taxable gain can be <= 0 so tax becomes 0
    assert out["classification"].startswith("LTCG")
    assert out["total_tax"] >= 0
    assert abs(out["total_tax"] - 0.0) < 1e-6


def test_tax_50aa_deemed_stcg_uses_marginal_rate(client: TestClient) -> None:
    payload = {
        "asset_type": "specified_mutual_fund_50aa",
        "acquired_date": "2024-04-01",
        "sold_date": "2025-04-01",
        "purchase_value": 100_000,
        "sale_value": 120_000,
        "transfer_expenses": 0,
        "marginal_rate": 0.30,
        "surcharge_rate": 0.0,
        "cess_rate": 0.04,
    }
    res = client.post("/api/v1/tax/compute", json=payload)
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["classification"].startswith("Deemed STCG")
    assert abs(out["base_rate"] - 0.30) < 1e-9
    assert abs(out["base_tax"] - 6_000.0) < 1e-6
    assert abs(out["total_tax"] - 6_240.0) < 1e-6


def test_tax_vda_ignores_expenses_and_taxes_at_30pct(client: TestClient) -> None:
    payload = {
        "asset_type": "virtual_digital_asset",
        "acquired_date": "2025-01-01",
        "sold_date": "2025-12-01",
        "purchase_value": 100_000,
        "sale_value": 120_000,
        "transfer_expenses": 5_000,
        "surcharge_rate": 0.0,
        "cess_rate": 0.04,
    }
    res = client.post("/api/v1/tax/compute", json=payload)
    assert res.status_code == 200, res.text
    out = res.json()
    assert out["classification"].startswith("VDA")
    assert abs(out["base_rate"] - 0.30) < 1e-9
    # Expenses ignored: gain=20k
    assert abs(out["gain"] - 20_000.0) < 1e-6
    assert abs(out["total_tax"] - 6_240.0) < 1e-6
