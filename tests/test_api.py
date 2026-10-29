"""Integration tests for the RideBalance FastAPI backend."""
from fastapi.testclient import TestClient
from api import app

client = TestClient(app)


def test_api_health():
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok", "version": "1.0.0"}


def test_api_defaults():
    res = client.get("/api/config/defaults")
    assert res.status_code == 200
    data = res.json()
    assert "defaults" in data
    assert "strategies" in data
    assert "scenarios" in data
    assert len(data["core_strategies"]) == 4


def test_api_simulate_single():
    payload = {
        "n_zones": 16,
        "n_drivers": 40,
        "duration_min": 60,
        "decision_interval": 15,
        "seed": 42,
        "n_runs": 1,
    }
    res = client.post("/api/simulate", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["mode"] == "single"
    assert data["city"]["n_zones"] == 16
    assert set(data["strategies"].keys()) == {"B0", "B1", "B2", "P"}
    p_metrics = data["strategies"]["P"]["metrics"]
    assert "service_rate" in p_metrics
    assert "avg_wait_min" in p_metrics
    assert "empty_km_total" in p_metrics


def test_api_simulate_batch():
    payload = {
        "n_zones": 9,
        "n_drivers": 20,
        "duration_min": 45,
        "decision_interval": 15,
        "seed": 42,
        "n_runs": 3,
    }
    res = client.post("/api/simulate", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["mode"] == "batch"
    assert data["n_runs"] == 3
    assert "summary" in data
    assert len(data["summary"]) > 0
    assert "paired" in data


def test_api_scenario_sweep():
    payload = {
        "n_zones": 9,
        "n_drivers": 20,
        "duration_min": 45,
        "decision_interval": 15,
        "seed": 42,
        "n_runs": 2,
    }
    res = client.post("/api/scenario-sweep", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert "cases" in data
    assert len(data["cases"]) == 7  # none, school, office, event, rain, transit, all
