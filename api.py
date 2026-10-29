"""FastAPI backend for RideBalance web application.

Wraps the existing simulation engine (ridebalance/) and exposes typed JSON endpoints.
Never accepts filesystem paths or executes user-supplied code.
"""
from __future__ import annotations

import asyncio
import uuid
from dataclasses import replace
from typing import Any, Optional
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

from ridebalance.config import CORE_STRATEGIES, SCENARIO_LABELS, STRATEGY_LABELS, SimConfig, validate
from ridebalance.demand import generate_realization
from ridebalance.experiments import (
    METRIC_INFO, SWEEP_CASES, mean_ci, paired_comparison,
    run_batch, scenario_sweep, summarize, sweep_case_config,
)
from ridebalance.reporting import explain_results, explain_sweep, zone_table
from ridebalance.simulator import simulate

app = FastAPI(title="RideBalance API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_executor = ThreadPoolExecutor(max_workers=4)

# ── In-memory job store ────────────────────────────────────────────────────────
_jobs: dict[str, dict] = {}  # run_id -> {status, result, error}


# ── Pydantic models ───────────────────────────────────────────────────────────
class ScenarioInput(BaseModel):
    name: str
    severity: float = Field(default=1.0, ge=0.0, le=5.0)

    @field_validator("name")
    @classmethod
    def valid_scenario(cls, v):
        if v not in SCENARIO_LABELS:
            raise ValueError(f"Unknown scenario '{v}'. Valid: {list(SCENARIO_LABELS)}")
        return v


class SimRequest(BaseModel):
    n_zones: int = Field(default=16, ge=4, le=36)
    n_drivers: int = Field(default=60, ge=1, le=500)
    duration_min: int = Field(default=120, ge=30, le=480)
    decision_interval: int = Field(default=15, ge=5, le=60)
    demand_intensity: float = Field(default=0.50, gt=0)
    seed: int = Field(default=42, ge=0)
    scenarios: list[ScenarioInput] = Field(default_factory=list)
    combine_mode: str = Field(default="multiplicative")
    strategies: list[str] = Field(default_factory=lambda: list(CORE_STRATEGIES))
    n_runs: int = Field(default=1, ge=1, le=50)
    async_run: bool = Field(default=False)

    @field_validator("combine_mode")
    @classmethod
    def valid_combine(cls, v):
        if v not in ("multiplicative", "additive"):
            raise ValueError("combine_mode must be 'multiplicative' or 'additive'")
        return v

    @field_validator("strategies")
    @classmethod
    def valid_strategies(cls, v):
        allowed = set(CORE_STRATEGIES) | {"P_noEnroute", "P_noUncert"}
        bad = [s for s in v if s not in allowed]
        if bad:
            raise ValueError(f"Unknown strategies: {bad}")
        return v


class SweepRequest(BaseModel):
    n_zones: int = Field(default=16, ge=4, le=36)
    n_drivers: int = Field(default=60, ge=1, le=500)
    duration_min: int = Field(default=120, ge=30, le=480)
    decision_interval: int = Field(default=15, ge=5, le=60)
    demand_intensity: float = Field(default=0.50, gt=0)
    seed: int = Field(default=42, ge=0)
    n_runs: int = Field(default=5, ge=1, le=30)
    severity: float = Field(default=1.0, ge=0.0, le=5.0)
    strategies: list[str] = Field(default_factory=lambda: list(CORE_STRATEGIES))


# ── Helpers ───────────────────────────────────────────────────────────────────
def _make_cfg(req: SimRequest) -> SimConfig:
    sc = {s.name: s.severity for s in req.scenarios}
    return SimConfig(
        n_zones=req.n_zones,
        n_drivers=req.n_drivers,
        duration_min=req.duration_min,
        decision_interval=req.decision_interval,
        demand_intensity=req.demand_intensity,
        seed=req.seed,
        scenarios=sc,
        combine_mode=req.combine_mode,
    )


def _safe_float(v):
    """Convert nan/inf to None for JSON serialization."""
    if v is None:
        return None
    if isinstance(v, float) and (np.isnan(v) or np.isinf(v)):
        return None
    return v


def _clean_metrics(m: dict) -> dict:
    return {k: _safe_float(v) for k, v in m.items()}


def _decisions_to_json(decisions: list, city) -> list:
    out = []
    for d in decisions:
        moves_info = [
            {
                "driver": int(mv.driver),
                "src": int(mv.src),
                "src_id": city.ids[mv.src],
                "dst": int(mv.dst),
                "dst_id": city.ids[mv.dst],
                "dist_km": float(mv.dist_km),
                "accepted": bool(mv.accepted),
                "net_benefit": _safe_float(mv.net_benefit),
                "service_gain": _safe_float(mv.service_gain),
                "reloc_cost": _safe_float(mv.reloc_cost),
                "oversupply_penalty": _safe_float(mv.oversupply_penalty),
            }
            for mv in d["moves"]
        ]
        out.append({
            "window": int(d["window"]),
            "t": int(d["t"]),
            "forecast": [_safe_float(x) for x in d["forecast"].tolist()],
            "actual": [_safe_float(x) for x in d["actual"].tolist()],
            "idle": [int(x) for x in d["idle"].tolist()],
            "incoming": [int(x) for x in d["incoming"].tolist()],
            "eff_supply": [_safe_float(x) for x in d["eff_supply"].tolist()],
            "risk": [_safe_float(x) for x in d["risk"].tolist()],
            "moves_in": [int(x) for x in d["moves_in"].tolist()],
            "moves_out": [int(x) for x in d["moves_out"].tolist()],
            "moves": moves_info,
        })
    return out


def _run_simulation_sync(req: SimRequest) -> dict:
    cfg = _make_cfg(req)
    errors = validate(cfg)
    if errors:
        raise ValueError("; ".join(errors))

    strategies = req.strategies or list(CORE_STRATEGIES)

    if req.n_runs == 1:
        real = generate_realization(cfg)
        city = real.city
        results = {}
        for key in strategies:
            res = simulate(real, key, detail=True)
            results[key] = res

        # Build city info
        city_info = {
            "n_zones": city.n_zones,
            "rows": city.rows,
            "cols": city.cols,
            "ids": city.ids,
            "roles": {k: [int(i) for i in v] for k, v in city.roles.items()},
            "role_of": city.role_of,
            "rc": [[int(r), int(c)] for r, c in city.rc.tolist()],
            "base_weight": [float(w) for w in city.base_weight.tolist()],
            "dist_cells": [[int(x) for x in row] for row in city.dist_cells.tolist()],
        }

        strategy_results = {}
        for key, res in results.items():
            strategy_results[key] = {
                "strategy": key,
                "label": STRATEGY_LABELS.get(key, key),
                "metrics": _clean_metrics(res.metrics),
                "decisions": _decisions_to_json(res.decisions, city),
            }

        return {
            "mode": "single",
            "seed": cfg.seed,
            "n_runs": 1,
            "city": city_info,
            "strategies": strategy_results,
        }
    else:
        # Multiple runs → batch statistics
        df = run_batch(cfg, strategies, req.n_runs)
        summary = summarize(df)
        paired = paired_comparison(df, focal="P", baselines=[s for s in strategies if s != "P"])

        def _row_to_dict(row):
            return {k: _safe_float(v) if isinstance(v, float) else v for k, v in row.items()}

        summary_list = [_row_to_dict(r) for r in summary.to_dict("records")]
        paired_list = [_row_to_dict(r) for r in paired.to_dict("records")]
        explanation = explain_results(summary, paired, focal="P")

        # Also do one single run for the city visualization
        real = generate_realization(cfg)
        city = real.city
        single_results = {}
        for key in strategies:
            res = simulate(real, key, detail=True)
            single_results[key] = {
                "strategy": key,
                "label": STRATEGY_LABELS.get(key, key),
                "metrics": _clean_metrics(res.metrics),
                "decisions": _decisions_to_json(res.decisions, city),
            }

        city_info = {
            "n_zones": city.n_zones,
            "rows": city.rows,
            "cols": city.cols,
            "ids": city.ids,
            "roles": {k: [int(i) for i in v] for k, v in city.roles.items()},
            "role_of": city.role_of,
            "rc": [[int(r), int(c)] for r, c in city.rc.tolist()],
            "base_weight": [float(w) for w in city.base_weight.tolist()],
            "dist_cells": [[int(x) for x in row] for row in city.dist_cells.tolist()],
        }

        return {
            "mode": "batch",
            "seed": cfg.seed,
            "n_runs": req.n_runs,
            "city": city_info,
            "strategies": single_results,
            "summary": summary_list,
            "paired": paired_list,
            "explanation": explanation,
        }


def _run_sweep_sync(req: SweepRequest) -> dict:
    cfg = SimConfig(
        n_zones=req.n_zones,
        n_drivers=req.n_drivers,
        duration_min=req.duration_min,
        decision_interval=req.decision_interval,
        demand_intensity=req.demand_intensity,
        seed=req.seed,
    )
    errors = validate(cfg)
    if errors:
        raise ValueError("; ".join(errors))

    sweep = scenario_sweep(cfg, req.strategies, req.n_runs, req.severity)
    explanation = explain_sweep(sweep, focal="P")

    # Build per-scenario summary
    cases = SWEEP_CASES
    scenario_names = {
        "none": "No scenario (baseline)",
        "all": "All combined",
        **SCENARIO_LABELS,
    }

    result_by_case = []
    for case in cases:
        sub = sweep[sweep.case == case]
        if sub.empty:
            continue
        case_data = {"case": case, "label": scenario_names.get(case, case), "strategies": {}}
        for strat in req.strategies:
            sg = sub[sub.strategy == strat]
            if sg.empty:
                continue
            m, lo, hi, n = mean_ci(sg["service_rate"])
            wm, wlo, whi, _ = mean_ci(sg["avg_wait_min"])
            case_data["strategies"][strat] = {
                "service_rate_mean": _safe_float(m),
                "service_rate_ci_low": _safe_float(lo),
                "service_rate_ci_high": _safe_float(hi),
                "avg_wait_mean": _safe_float(wm),
                "avg_wait_ci_low": _safe_float(wlo),
                "avg_wait_ci_high": _safe_float(whi),
                "n": int(n),
            }
        result_by_case.append(case_data)

    return {
        "cases": result_by_case,
        "scenario_names": scenario_names,
        "explanation": explanation,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────
@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}


@app.get("/api/config/defaults")
async def config_defaults():
    cfg = SimConfig()
    d = cfg.to_dict()
    return {
        "defaults": d,
        "strategies": STRATEGY_LABELS,
        "core_strategies": CORE_STRATEGIES,
        "scenarios": SCENARIO_LABELS,
        "sweep_cases": SWEEP_CASES,
        "metric_info": {k: {"label": v[0], "higher_is_better": v[1], "kind": v[2]} for k, v in METRIC_INFO.items()},
    }


@app.post("/api/simulate")
async def run_simulate(req: SimRequest):
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(_executor, _run_simulation_sync, req)
        return result
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Simulation error: {str(e)}")


@app.post("/api/simulate/async")
async def run_simulate_async(req: SimRequest, background_tasks: BackgroundTasks):
    run_id = str(uuid.uuid4())
    _jobs[run_id] = {"status": "running", "result": None, "error": None}

    def _do_work():
        try:
            result = _run_simulation_sync(req)
            _jobs[run_id]["result"] = result
            _jobs[run_id]["status"] = "done"
        except Exception as e:
            _jobs[run_id]["error"] = str(e)
            _jobs[run_id]["status"] = "error"

    background_tasks.add_task(_do_work)
    return {"run_id": run_id, "status": "running"}


@app.get("/api/results/{run_id}")
async def get_results(run_id: str):
    if run_id not in _jobs:
        raise HTTPException(status_code=404, detail="Run ID not found")
    job = _jobs[run_id]
    if job["status"] == "running":
        return {"run_id": run_id, "status": "running"}
    if job["status"] == "error":
        raise HTTPException(status_code=500, detail=job["error"])
    return {"run_id": run_id, "status": "done", **job["result"]}


@app.post("/api/scenario-sweep")
async def run_scenario_sweep(req: SweepRequest):
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(_executor, _run_sweep_sync, req)
        return result
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Sweep error: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)
