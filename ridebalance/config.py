"""Configuration, labels and parameter documentation.

Every number that influences results lives here so it can be shown in the app,
changed from the sidebar and cited in the README.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field, fields

SCENARIO_LABELS = {
    "school": "School / college dismissal",
    "office": "Office commute peaks",
    "event": "Sports, concerts & festivals",
    "rain": "Weather change (rain)",
    "transit": "Public-transport disruption",
}

STRATEGY_LABELS = {
    "B0": "B0 — Stay put",
    "B1": "B1 — Demand-only heatmap",
    "B2": "B2 — Cost-aware heatmap",
    "P": "P — RideBalance",
    "P_noEnroute": "P ablation — no en-route supply",
    "P_noUncert": "P ablation — no uncertainty",
}
CORE_STRATEGIES = ["B0", "B1", "B2", "P"]
ABLATIONS = ["P_noEnroute", "P_noUncert"]


@dataclass
class ScenarioParams:
    """Shape of each synthetic scenario. All times are fractions of the run length.

    These are modelling assumptions, not estimates from real data.
    """
    school_peak_frac: float = 0.50
    school_width_frac: float = 0.10
    school_amp: float = 4.0          # extra demand multiplier at the school zone at severity 1
    neighbor_ratio: float = 0.30     # share of a local surge felt by adjacent zones
    office_peak_frac: float = 0.40
    office_width_frac: float = 0.25
    office_primary_amp: float = 1.0  # morning: residential zones; evening: business zones
    office_secondary_amp: float = 0.2
    event_peak_frac: float = 0.60
    event_width_frac: float = 0.08
    event_amp: float = 6.0           # dispersal surge at the stadium zone at severity 1
    event_arrival_amp: float = 0.6   # arrival mode: mild extra demand from residential zones
    event_arrival_lead_frac: float = 0.20
    rain_start_frac: float = 0.25
    rain_demand_amp: float = 0.35    # +35% requests everywhere at severity 1
    rain_speed_drop: float = 0.30    # -30% travel speed at severity 1
    transit_start_frac: float = 0.20
    transit_amp: float = 3.0         # extra demand multiplier at the affected station zone
    ramp_frac: float = 0.10


@dataclass
class SimConfig:
    # --- fleet / city / time ---
    n_zones: int = 9
    n_drivers: int = 60
    duration_min: int = 120
    decision_interval: int = 15
    demand_intensity: float = 0.50   # mean requests per zone per minute with no scenario
    seed: int = 42
    km_per_cell: float = 1.5
    base_speed_kmph: float = 24.0
    # --- scenarios ---
    scenarios: dict = field(default_factory=dict)   # name -> severity (>= 0)
    combine_mode: str = "multiplicative"            # or "additive"
    max_multiplier: float = 12.0
    commute_period: str = "morning"                 # or "evening"
    event_mode: str = "dispersal"                   # or "arrival"
    sp: ScenarioParams = field(default_factory=ScenarioParams)
    # --- service rules ---
    max_pickup_cells: int = 1
    max_wait_min: int = 8
    intra_zone_pickup_km: float = 0.5
    # --- repositioning constraints ---
    max_move_cells: int = 3
    max_move_fraction: float = 0.35
    acceptance_prob: float = 0.90
    # --- uncertainty ---
    forecast_sigma: float = 0.20
    demand_shock_sigma: float = 0.15
    travel_time_cv: float = 0.15
    mc_samples: int = 400
    arrival_deadline_frac: float = 0.50
    # --- economics (used by B2 and P, and for cost estimates) ---
    value_per_request: float = 150.0
    reloc_cost_per_km: float = 8.0
    idle_cost_per_window: float = 20.0

    def to_dict(self) -> dict:
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), sort_keys=True)

    @staticmethod
    def from_dict(d: dict) -> "SimConfig":
        d = dict(d)
        sp = ScenarioParams(**d.pop("sp", {}))
        known = {f.name for f in fields(SimConfig)}
        return SimConfig(sp=sp, **{k: v for k, v in d.items() if k in known and k != "sp"})

    @staticmethod
    def from_json(s: str) -> "SimConfig":
        return SimConfig.from_dict(json.loads(s))


def validate(cfg: SimConfig) -> list[str]:
    """Return human-readable problems; an empty list means the config is usable."""
    e: list[str] = []
    if not 4 <= cfg.n_zones <= 36:
        e.append("Number of zones must be between 4 and 36.")
    if not 1 <= cfg.n_drivers <= 500:
        e.append("Number of drivers must be between 1 and 500.")
    if cfg.decision_interval < 5:
        e.append("Decision interval must be at least 5 minutes.")
    if cfg.duration_min < 2 * cfg.decision_interval:
        e.append("Duration must cover at least two decision windows "
                 f"(>= {2 * cfg.decision_interval} min for a {cfg.decision_interval}-min interval).")
    if cfg.demand_intensity <= 0:
        e.append("Demand intensity must be greater than 0.")
    for name, sev in cfg.scenarios.items():
        if name not in SCENARIO_LABELS:
            e.append(f"Unknown scenario '{name}'.")
        elif sev < 0:
            e.append(f"Severity for '{SCENARIO_LABELS[name]}' cannot be negative.")
    if cfg.combine_mode not in ("multiplicative", "additive"):
        e.append("Combine mode must be 'multiplicative' or 'additive'.")
    if cfg.max_move_cells < 1:
        e.append("Maximum move distance must be at least 1 cell.")
    for nm in ("acceptance_prob", "max_move_fraction", "arrival_deadline_frac"):
        if not 0 <= getattr(cfg, nm) <= 1:
            e.append(f"{nm} must be between 0 and 1.")
    for nm in ("forecast_sigma", "demand_shock_sigma", "travel_time_cv"):
        if getattr(cfg, nm) < 0:
            e.append(f"{nm} cannot be negative.")
    if cfg.mc_samples < 50:
        e.append("Monte-Carlo samples should be at least 50.")
    return e


PARAM_DOCS = [
    ("demand_intensity", "Mean requests per zone per minute with no scenario active (scaled by zone weight)."),
    ("km_per_cell / base_speed_kmph", "Distance between adjacent zone centres and free-flow speed (synthetic)."),
    ("max_pickup_cells / max_wait_min", "A request is matched to the nearest idle driver within this many cells; it waits at most this many minutes, then is counted unserved."),
    ("intra_zone_pickup_km", "Average pickup distance when driver and rider are in the same zone."),
    ("max_move_cells / max_move_fraction", "Movement constraints: longest allowed relocation, and the largest share of idle drivers that may be moved per decision."),
    ("acceptance_prob", "Probability a driver follows a repositioning recommendation (simulation parameter, not measured)."),
    ("forecast_sigma", "Log-normal error of the demand forecast the strategies see. RideBalance also uses it as its uncertainty width."),
    ("demand_shock_sigma", "Log-normal window-level fluctuation of true demand around its expected value."),
    ("travel_time_cv", "Coefficient of variation of repositioning travel time."),
    ("arrival_deadline_frac", "An en-route driver counts as 'arriving in time' if it arrives within this fraction of the decision window."),
    ("value_per_request", "Assumed value of one served request (INR) used in the net-benefit score."),
    ("reloc_cost_per_km", "Assumed cost of one empty kilometre (INR)."),
    ("idle_cost_per_window", "Assumed opportunity cost of one idle driver for one decision window (INR); drives the oversupply penalty."),
    ("mc_samples", "Monte-Carlo draws used by RideBalance to estimate shortage probabilities."),
]
