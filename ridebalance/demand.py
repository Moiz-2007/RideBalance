"""Synthetic demand generation.

Everything here is *synthetic*: scenario shapes are modelling assumptions
(see ScenarioParams), not observations. Each scenario produces an "effect"
array delta[t, z] >= 0 so the demand multiplier is 1 + delta. Several
scenarios are combined either multiplicatively (prod of 1+delta) or
additively (1 + sum of delta); the result is capped at cfg.max_multiplier.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .city import City, build_city
from .config import SimConfig


def _pulse(frac, peak, width):
    return np.exp(-0.5 * ((frac - peak) / max(width, 1e-6)) ** 2)


def _ramp(frac, start, ramp):
    return np.clip((frac - start) / max(ramp, 1e-6), 0.0, 1.0)


def _profile(city: City, centre: int, ratio: float) -> np.ndarray:
    v = np.zeros(city.n_zones)
    v[centre] = 1.0
    v[city.neighbors[centre]] = ratio
    return v


def scenario_effects(cfg: SimConfig, city: City):
    """Return ({scenario: delta (T, Z)}, speed_factor (T,))."""
    T, Z, sp = cfg.duration_min, city.n_zones, cfg.sp
    frac = (np.arange(T) + 0.5) / T
    res, biz = city.mask("residential"), city.mask("business")
    effects: dict = {}
    speed = np.ones(T)
    for name, sev in cfg.scenarios.items():
        if sev <= 0:
            continue
        if name == "school":
            p = _pulse(frac, sp.school_peak_frac, sp.school_width_frac)
            prof = _profile(city, city.roles["school"][0], sp.neighbor_ratio)
            effects[name] = sev * sp.school_amp * p[:, None] * prof[None, :]
        elif name == "office":
            ramp = _pulse(frac, sp.office_peak_frac, sp.office_width_frac)
            if cfg.commute_period == "morning":
                w = sp.office_primary_amp * res + sp.office_secondary_amp * biz
            else:
                w = sp.office_primary_amp * biz + sp.office_secondary_amp * res
            effects[name] = sev * ramp[:, None] * w[None, :]
        elif name == "event":
            if cfg.event_mode == "dispersal":
                p = _pulse(frac, sp.event_peak_frac, sp.event_width_frac)
                prof = _profile(city, city.roles["stadium"][0], sp.neighbor_ratio)
                effects[name] = sev * sp.event_amp * p[:, None] * prof[None, :]
            else:
                p = _pulse(frac, sp.event_peak_frac - sp.event_arrival_lead_frac, 2 * sp.event_width_frac)
                effects[name] = sev * sp.event_arrival_amp * p[:, None] * res[None, :].astype(float)
        elif name == "rain":
            s = _ramp(frac, sp.rain_start_frac, sp.ramp_frac)
            effects[name] = sev * sp.rain_demand_amp * s[:, None] * np.ones((1, Z))
            speed = speed * np.clip(1 - sev * sp.rain_speed_drop * s, 0.4, 1.0)
        elif name == "transit":
            s = _ramp(frac, sp.transit_start_frac, sp.ramp_frac)
            prof = _profile(city, city.roles["station"][0], sp.neighbor_ratio + 0.05)
            effects[name] = sev * sp.transit_amp * s[:, None] * prof[None, :]
        else:
            raise ValueError(f"Unknown scenario {name!r}")
    return effects, speed


def combine_effects(effects: dict, mode: str, shape: tuple, cap: float) -> np.ndarray:
    if not effects:
        return np.ones(shape)
    if mode == "multiplicative":
        m = np.ones(shape)
        for d in effects.values():
            m = m * (1 + d)
    elif mode == "additive":
        m = 1 + sum(effects.values())
    else:
        raise ValueError("combine mode must be 'multiplicative' or 'additive'")
    return np.minimum(m, cap)


def expected_rate(cfg: SimConfig, city: City):
    """Expected requests per zone per minute, shape (T, Z), plus speed factor and components."""
    effects, speed = scenario_effects(cfg, city)
    mult = combine_effects(effects, cfg.combine_mode, (cfg.duration_min, city.n_zones), cfg.max_multiplier)
    rate = cfg.demand_intensity * city.base_weight[None, :] * mult
    return rate, speed, effects


def destination_probs(cfg: SimConfig, city: City) -> np.ndarray:
    """Row-stochastic (Z, Z) destination distribution with a zero diagonal (assumed, time-invariant)."""
    w = city.base_weight.copy()
    res, biz = city.mask("residential"), city.mask("business")
    for name, sev in cfg.scenarios.items():
        if sev <= 0:
            continue
        if name == "office":
            if cfg.commute_period == "morning":
                w[biz] *= 1 + 2.0 * sev
            else:
                w[res] *= 1 + 1.0 * sev
        elif name == "event":
            if cfg.event_mode == "dispersal":
                w[res] *= 1 + 0.5 * sev
            else:
                w[city.roles["stadium"]] *= 1 + 4.0 * sev
        elif name == "school":
            w[res] *= 1 + 0.5 * sev
    P = np.tile(w, (city.n_zones, 1))
    np.fill_diagonal(P, 0.0)
    return P / P.sum(1, keepdims=True)


def _lognormal_mean1(rng, sigma, size):
    if sigma <= 0:
        return np.ones(size)
    return np.exp(sigma * rng.standard_normal(size) - sigma ** 2 / 2)


@dataclass
class Realization:
    """One fully pre-drawn world. Every strategy is run on the SAME Realization,
    so differences between strategies cannot come from different random draws."""
    cfg: SimConfig
    city: City
    rate: np.ndarray            # (T, Z) expected requests / minute
    speed_factor: np.ndarray    # (T,)
    req_t: np.ndarray           # (R,) arrival minute, sorted
    req_o: np.ndarray           # (R,) origin zone
    req_d: np.ndarray           # (R,) destination zone
    window_expected: np.ndarray # (W, Z) expected demand per decision window
    forecast: np.ndarray        # (W, Z) forecast with error
    init_zone: np.ndarray       # (N,)
    accept_u: np.ndarray        # (N, W) uniforms for driver acceptance
    travel_noise: np.ndarray    # (N, W) multiplicative travel-time noise
    actual_window: np.ndarray   # (W, Z) realised request counts per window
    effects: dict


def n_windows(cfg: SimConfig) -> int:
    return int(np.ceil(cfg.duration_min / cfg.decision_interval))


def generate_realization(cfg: SimConfig) -> Realization:
    city = build_city(cfg.n_zones, cfg.km_per_cell)
    T, Z, N, H = cfg.duration_min, city.n_zones, cfg.n_drivers, cfg.decision_interval
    W = n_windows(cfg)
    streams = [np.random.default_rng(s) for s in np.random.SeedSequence(cfg.seed).spawn(5)]
    r_dem, r_shock, r_fc, r_drv, r_beh = streams

    rate, speed, effects = expected_rate(cfg, city)
    win_of_t = np.minimum(np.arange(T) // H, W - 1)
    window_expected = np.zeros((W, Z))
    np.add.at(window_expected, win_of_t, rate)

    shock = _lognormal_mean1(r_shock, cfg.demand_shock_sigma, (W, Z))
    counts = r_dem.poisson(rate * shock[win_of_t])           # (T, Z)
    req_t = np.repeat(np.repeat(np.arange(T), Z), counts.ravel())
    req_o = np.repeat(np.tile(np.arange(Z), T), counts.ravel())
    P = destination_probs(cfg, city)
    cum = np.cumsum(P[req_o], axis=1)
    u = r_dem.random(len(req_o))
    req_d = np.minimum((u[:, None] > cum).sum(1), Z - 1)

    forecast = window_expected * _lognormal_mean1(r_fc, cfg.forecast_sigma, (W, Z))
    init_zone = r_drv.choice(Z, size=N, p=city.base_weight / city.base_weight.sum())
    accept_u = r_beh.random((N, W))
    s2 = np.log(1 + cfg.travel_time_cv ** 2)
    travel_noise = np.exp(np.sqrt(s2) * r_beh.standard_normal((N, W)) - s2 / 2) if cfg.travel_time_cv > 0 else np.ones((N, W))

    actual_window = np.zeros((W, Z))
    np.add.at(actual_window, win_of_t, counts)
    return Realization(cfg, city, rate, speed, req_t, req_o, req_d, window_expected, forecast,
                       init_zone, accept_u, travel_noise, actual_window, effects)
