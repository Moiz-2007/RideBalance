"""Minute-by-minute simulator.

Driver status: IDLE (waiting in a zone), TRANSIT (repositioning, empty) or
SERVING (driving to a pickup and then carrying the rider). A driver has exactly
one status at any time, so idle + transit + serving == n_drivers every minute
(checked on every step).

Rules per simulated minute t:
 1. Drivers whose activity ends by t become IDLE in their target zone.
 2. If t is a decision time, the strategy proposes moves for IDLE drivers.
    A driver accepts with probability cfg.acceptance_prob (pre-drawn).
 3. New requests join a FIFO queue. Each queued request is matched to the
    nearest IDLE driver within cfg.max_pickup_cells (ties: lowest driver id).
    Unmatched requests wait; after cfg.max_wait_min minutes they are unserved.
 4. Requests still queued at the end of the run are counted as unserved.
A request counts as "served" when a driver is assigned, even if the trip ends
after the simulation window.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .demand import Realization
from .shortage import DemandModel, arrival_prob
from .strategies import DecisionState, Move, Strategy, make_strategy

IDLE, TRANSIT, SERVING = 0, 1, 2


@dataclass
class SimResult:
    strategy: str
    seed: int
    metrics: dict
    decisions: list = field(default_factory=list)   # one dict per decision window
    moves: pd.DataFrame = None
    timeseries: pd.DataFrame = None
    snapshots: list = field(default_factory=list)    # per window: dict(status, zone, target)


def simulate(real: Realization, strategy, detail: bool = True) -> SimResult:
    if isinstance(strategy, str):
        strategy = make_strategy(strategy)
    cfg, city = real.cfg, real.city
    Z, N, T, H = city.n_zones, cfg.n_drivers, cfg.duration_min, cfg.decision_interval
    W = real.accept_u.shape[1]

    status = np.zeros(N, dtype=int)
    zone = real.init_zone.copy()
    target = zone.copy()
    free_at = np.zeros(N)

    queue: list = []
    ptr, R = 0, len(real.req_t)
    served = abandoned = 0
    waits: list = []
    pickup_km_total = reposition_km = 0.0
    n_moves = n_recommended = 0
    idle_hot_sum = 0.0
    decisions, move_rows, snapshots = [], [], []
    ts = {"minute": [], "idle": [], "transit": [], "serving": [], "queue": []}
    hot_thresh = np.quantile(real.rate, 0.75, axis=1)
    redundant_inputs = []   # (w, idle_count, inbound_count, moves_in accepted)

    for t in range(T):
        done = (status != IDLE) & (free_at <= t + 1e-9)
        if done.any():
            zone[done] = target[done]
            status[done] = IDLE

        # ---- decision step ----
        if t % H == 0:
            w = t // H
            idle_mask = status == IDLE
            idle_ids = [[] for _ in range(Z)]
            for d in np.flatnonzero(idle_mask):
                idle_ids[zone[d]].append(int(d))
            idle_count = np.array([len(x) for x in idle_ids])
            inbound = [(int(d), int(target[d]), float(free_at[d] - t)) for d in np.flatnonzero(status == TRANSIT)]
            inbound_count = np.zeros(Z, dtype=int)
            for _d, dst, _e in inbound:
                inbound_count[dst] += 1
            sf = float(real.speed_factor[t])
            st = DecisionState(t, w, float(H), idle_ids, idle_count, inbound, real.forecast[w].copy(),
                               sf, city, cfg, np.random.default_rng([cfg.seed, w, 7]))
            moves = strategy.decide(st)

            seen = set()
            for mv in moves:
                if mv.driver in seen:
                    raise ValueError(f"driver {mv.driver} assigned twice in one decision")
                seen.add(mv.driver)
                if not idle_mask[mv.driver] or zone[mv.driver] != mv.src:
                    raise ValueError(f"driver {mv.driver} is not idle in zone {mv.src}")
                if mv.src == mv.dst or city.dist_cells[mv.src, mv.dst] > cfg.max_move_cells:
                    raise ValueError("infeasible move (same zone or beyond max_move_cells)")
            moves_in = np.zeros(Z, dtype=int)
            moves_out = np.zeros(Z, dtype=int)
            for mv in moves:
                n_recommended += 1
                moves_out[mv.src] += 1
                mv.accepted = bool(real.accept_u[mv.driver, w] < cfg.acceptance_prob)
                if mv.accepted:
                    speed = cfg.base_speed_kmph * sf
                    tt = max(1.0, mv.dist_km / speed * 60.0 * real.travel_noise[mv.driver, w])
                    status[mv.driver] = TRANSIT
                    target[mv.driver] = mv.dst
                    free_at[mv.driver] = t + tt
                    reposition_km += mv.dist_km
                    n_moves += 1
                    moves_in[mv.dst] += 1
                move_rows.append(dict(window=w, t=t, driver=mv.driver, src=city.ids[mv.src], dst=city.ids[mv.dst],
                                      dist_km=mv.dist_km, accepted=mv.accepted, net_benefit=mv.net_benefit,
                                      service_gain=mv.service_gain, reloc_cost=mv.reloc_cost,
                                      oversupply_penalty=mv.oversupply_penalty))
            redundant_inputs.append((w, idle_count.copy(), inbound_count.copy(), moves_in.copy()))

            if detail:
                deadline = cfg.arrival_deadline_frac * H
                eff = idle_count.astype(float)
                for _d, dst, eta in inbound:
                    eff[dst] += arrival_prob(eta, deadline, cfg.travel_time_cv)
                view = DemandModel(real.forecast[w], cfg.forecast_sigma, cfg.mc_samples,
                                   np.random.default_rng([cfg.seed, w, 99]), N + 2)
                decisions.append(dict(window=w, t=t, forecast=real.forecast[w].copy(),
                                      actual=real.actual_window[w].copy(), idle=idle_count.copy(),
                                      incoming=inbound_count.copy(), eff_supply=eff,
                                      risk=view.shortage_risk(eff), moves_in=moves_in, moves_out=moves_out,
                                      moves=[m for m in moves]))
                snapshots.append(dict(status=status.copy(), zone=zone.copy(), target=target.copy()))

        # ---- requests ----
        while ptr < R and real.req_t[ptr] == t:
            queue.append(ptr)
            ptr += 1
        if queue:
            idle_idx = np.flatnonzero(status == IDLE)
            keep = []
            speed_now = cfg.base_speed_kmph * real.speed_factor[t]
            for r in queue:
                if idle_idx.size:
                    o = real.req_o[r]
                    dd = city.dist_cells[zone[idle_idx], o]
                    k = int(np.argmin(dd))
                    if dd[k] <= cfg.max_pickup_cells:
                        d = int(idle_idx[k])
                        pk = city.dist_km[zone[d], o] if zone[d] != o else cfg.intra_zone_pickup_km
                        trip = city.dist_km[o, real.req_d[r]]
                        pickup_min = pk / speed_now * 60.0
                        trip_min = trip / speed_now * 60.0
                        status[d] = SERVING
                        target[d] = real.req_d[r]
                        free_at[d] = t + pickup_min + trip_min
                        pickup_km_total += pk
                        waits.append((t - real.req_t[r]) + pickup_min)
                        served += 1
                        idle_idx = np.delete(idle_idx, k)
                        continue
                if t - real.req_t[r] >= cfg.max_wait_min:
                    abandoned += 1
                else:
                    keep.append(r)
            queue = keep

        # ---- bookkeeping ----
        n_idle = int((status == IDLE).sum())
        n_tr = int((status == TRANSIT).sum())
        n_sv = int((status == SERVING).sum())
        if n_idle + n_tr + n_sv != N:
            raise AssertionError("driver accounting broke: statuses do not sum to the fleet size")
        hot = real.rate[t] >= hot_thresh[t]
        idle_hot_sum += int(hot[zone[status == IDLE]].sum())
        ts["minute"].append(t); ts["idle"].append(n_idle); ts["transit"].append(n_tr)
        ts["serving"].append(n_sv); ts["queue"].append(len(queue))

    still_waiting = len(queue)
    unserved = R - served
    redundant = 0
    for w, idle_c, inb_c, m_in in redundant_inputs:
        supply = idle_c + inb_c + m_in
        redundant += int(np.minimum(m_in, np.maximum(0, supply - real.actual_window[w])).sum())

    empty_total = pickup_km_total + reposition_km
    metrics = dict(
        requests_generated=R,
        requests_served=served,
        requests_unserved=unserved,
        unserved_abandoned=abandoned,
        unserved_waiting_at_end=still_waiting,
        service_rate=served / R if R else float("nan"),
        avg_wait_min=float(np.mean(waits)) if waits else float("nan"),
        empty_km_pickup=pickup_km_total,
        empty_km_reposition=reposition_km,
        empty_km_total=empty_total,
        moves_recommended=n_recommended,
        moves_made=n_moves,
        redundant_moves=redundant,
        idle_in_hot_zones_avg=idle_hot_sum / T,
        relocation_cost_est=reposition_km * cfg.reloc_cost_per_km,
        empty_cost_est=empty_total * cfg.reloc_cost_per_km,
        served_per_empty_km=served / empty_total if empty_total > 0 else float("nan"),
    )
    metrics = {k: (float(v) if isinstance(v, (float, np.floating)) else int(v)) for k, v in metrics.items()}
    moves_df = pd.DataFrame(move_rows, columns=["window", "t", "driver", "src", "dst", "dist_km", "accepted",
                                                "net_benefit", "service_gain", "reloc_cost", "oversupply_penalty"])
    return SimResult(strategy.key, cfg.seed, metrics, decisions, moves_df, pd.DataFrame(ts), snapshots)
