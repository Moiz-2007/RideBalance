"""The four allocation strategies (plus two RideBalance ablations).

All strategies see the same DecisionState and return a list of Move objects.
They only ever move IDLE drivers, at most once each, within cfg.max_move_cells,
and at most cfg.max_move_fraction of the idle fleet per decision.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .city import City
from .config import SimConfig
from .shortage import DemandModel, arrival_prob


@dataclass
class Move:
    driver: int
    src: int
    dst: int
    dist_km: float = 0.0
    net_benefit: float = float("nan")      # RideBalance / B2 score (INR-equivalent)
    service_gain: float = float("nan")
    reloc_cost: float = float("nan")
    oversupply_penalty: float = float("nan")
    accepted: bool = False


@dataclass
class DecisionState:
    t: int
    window: int
    horizon: float
    idle_ids: list              # zone -> list of idle driver ids (ascending)
    idle_count: np.ndarray      # (Z,)
    inbound: list               # [(driver, dst_zone, eta_remaining_min)] for drivers already repositioning
    forecast: np.ndarray        # (Z,) predicted demand over the window (with forecast error)
    speed_factor: float
    city: City
    cfg: SimConfig
    rng: np.random.Generator


def move_cap(cfg: SimConfig, idle_total: int) -> int:
    if idle_total <= 0 or cfg.max_move_fraction <= 0:
        return 0
    return max(1, int(np.floor(cfg.max_move_fraction * idle_total)))


def _feasible(city: City, cfg: SimConfig) -> np.ndarray:
    return (city.dist_cells <= cfg.max_move_cells) & (city.dist_cells > 0)


class Strategy:
    key = "?"

    def decide(self, st: DecisionState) -> list:
        raise NotImplementedError


class StayPut(Strategy):
    """B0: drivers remain where they are."""
    key = "B0"

    def decide(self, st):
        return []


class DemandOnlyHeatmap(Strategy):
    """B1: shares the idle fleet out in proportion to predicted demand.

    Ignores relocation cost, drivers already en route and uncertainty. Sources
    are chosen by largest surplus (not nearest), so empty travel is not minimised.
    """
    key = "B1"

    def decide(self, st):
        cfg, city = st.cfg, st.city
        idle_total = int(st.idle_count.sum())
        f = st.forecast
        if idle_total == 0 or f.sum() <= 0:
            return []
        raw = f / f.sum() * idle_total
        target = np.floor(raw).astype(int)
        rem = idle_total - target.sum()
        order = sorted(range(len(f)), key=lambda z: (-(raw[z] - target[z]), z))
        for z in order[:rem]:
            target[z] += 1
        deficit = np.maximum(0, target - st.idle_count)
        surplus = np.maximum(0, st.idle_count - target)
        feas = _feasible(city, cfg)
        lists = [list(x) for x in st.idle_ids]
        cap, moves = move_cap(cfg, idle_total), []
        for dst in sorted(range(len(f)), key=lambda z: (-f[z], z)):
            need = int(deficit[dst])
            if need == 0:
                continue
            for src in sorted(range(len(f)), key=lambda z: (-surplus[z], z)):
                if need == 0 or len(moves) >= cap:
                    break
                if surplus[src] == 0 or not feas[src, dst]:
                    continue
                take = int(min(need, surplus[src], cap - len(moves)))
                for _ in range(take):
                    moves.append(Move(lists[src].pop(0), src, dst, float(city.dist_km[src, dst])))
                surplus[src] -= take
                need -= take
            if len(moves) >= cap:
                break
        return moves


class CostAwareHeatmap(Strategy):
    """B2: point-forecast, cost-aware greedy.

    Marginal value of a driver in zone z with idle supply S is the fluid
    approximation min(1, max(0, forecast - S)). A move is made only if
    V*(gain at destination - loss at origin) - cost_per_km*distance > 0.
    It counts moves it issues in the current decision, but NOT drivers already
    en route from earlier windows, and it has no uncertainty or oversupply term.
    """
    key = "B2"

    def decide(self, st):
        cfg, city = st.cfg, st.city
        f = st.forecast
        idle_rem = st.idle_count.copy()
        if idle_rem.sum() == 0:
            return []
        S = st.idle_count.astype(float)
        feas = _feasible(city, cfg)
        lists = [list(x) for x in st.idle_ids]
        cap, moves = move_cap(cfg, int(idle_rem.sum())), []
        cost = cfg.reloc_cost_per_km * city.dist_km
        while len(moves) < cap:
            gain = np.clip(f - S, 0, 1)[None, :]
            loss = np.clip(f - (S - 1), 0, 1)[:, None]
            gross = cfg.value_per_request * (gain - loss)
            net = np.where(feas & (idle_rem[:, None] > 0), gross - cost, -np.inf)
            i = int(np.argmax(net))
            src, dst = divmod(i, len(f))
            if not np.isfinite(net[src, dst]) or net[src, dst] <= 0:
                break
            moves.append(Move(lists[src].pop(0), src, dst, float(city.dist_km[src, dst]),
                              net_benefit=float(net[src, dst]), service_gain=float(gross[src, dst]),
                              reloc_cost=float(cost[src, dst])))
            S[src] -= 1
            S[dst] += 1
            idle_rem[src] -= 1
        return moves


class RideBalance(Strategy):
    """P: risk-aware allocation.

    For each zone: effective supply S = idle + sum over en-route drivers of
    P(arrive before the deadline); demand D ~ Poisson(forecast * lognormal
    noise) sampled by Monte-Carlo; shortage risk = P(D > S).
    Candidate move src->dst scores
        service_gain = V * [dE_served(dst; +p) - dE_served(src; -1)]
        penalty      = idle_cost * [p - dE_served(dst; +p)]    (extra expected idle at dst)
        cost         = reloc_cost_per_km * km
        net          = service_gain - cost - penalty
    where p = P(the moved driver arrives in time). Moves are applied greedily
    (best net first, updating S) and only while net > 0.
    The origin-side idle saving is deliberately NOT credited (conservative).
    """

    def __init__(self, use_enroute: bool = True, use_uncertainty: bool = True):
        self.use_enroute = use_enroute
        self.use_uncertainty = use_uncertainty
        self.key = "P" if use_enroute and use_uncertainty else (
            "P_noEnroute" if use_uncertainty else "P_noUncert")

    def decide(self, st):
        cfg, city = st.cfg, st.city
        Z = city.n_zones
        idle_rem = st.idle_count.copy()
        if idle_rem.sum() == 0 or st.forecast.sum() <= 0:
            return []
        sigma = cfg.forecast_sigma if self.use_uncertainty else 0.0
        model = DemandModel(st.forecast, sigma, cfg.mc_samples, st.rng, cfg.n_drivers + 2)
        deadline = cfg.arrival_deadline_frac * st.horizon
        S = st.idle_count.astype(float)
        if self.use_enroute:
            for _d, dst, eta in st.inbound:
                S[dst] += arrival_prob(eta, deadline, cfg.travel_time_cv)
        speed = cfg.base_speed_kmph * st.speed_factor
        p_arr = arrival_prob(city.dist_km / speed * 60.0, deadline, cfg.travel_time_cv)
        feas = _feasible(city, cfg)
        lists = [list(x) for x in st.idle_ids]
        cap, moves = move_cap(cfg, int(idle_rem.sum())), []
        cost = cfg.reloc_cost_per_km * city.dist_km
        V, ci = cfg.value_per_request, cfg.idle_cost_per_window
        while len(moves) < cap:
            now = model.expected_served(S)
            gain_dst = model.expected_served(S[None, :] + p_arr) - now[None, :]
            loss_src = now - model.expected_served(np.maximum(S - 1, 0))
            service = V * (gain_dst - loss_src[:, None])
            penalty = ci * (p_arr - gain_dst)
            net = np.where(feas & (idle_rem[:, None] > 0), service - cost - penalty, -np.inf)
            i = int(np.argmax(net))
            src, dst = divmod(i, Z)
            if not np.isfinite(net[src, dst]) or net[src, dst] <= 0:
                break
            moves.append(Move(lists[src].pop(0), src, dst, float(city.dist_km[src, dst]),
                              net_benefit=float(net[src, dst]), service_gain=float(service[src, dst]),
                              reloc_cost=float(cost[src, dst]), oversupply_penalty=float(penalty[src, dst])))
            S[src] -= 1
            S[dst] += p_arr[src, dst]
            idle_rem[src] -= 1
        return moves


def make_strategy(key: str) -> Strategy:
    if key == "B0":
        return StayPut()
    if key == "B1":
        return DemandOnlyHeatmap()
    if key == "B2":
        return CostAwareHeatmap()
    if key == "P":
        return RideBalance()
    if key == "P_noEnroute":
        return RideBalance(use_enroute=False)
    if key == "P_noUncert":
        return RideBalance(use_uncertainty=False)
    raise ValueError(f"Unknown strategy {key!r}")
