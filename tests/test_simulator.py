import numpy as np
from dataclasses import replace

from ridebalance.city import build_city
from ridebalance.config import CORE_STRATEGIES, SCENARIO_LABELS, SimConfig
from ridebalance.demand import generate_realization
from ridebalance.simulator import simulate
from ridebalance.strategies import DecisionState, Move, RideBalance, Strategy, make_strategy, CostAwareHeatmap, DemandOnlyHeatmap


class Fixed(Strategy):
    key = "FIX"
    def __init__(self, moves): self.moves = moves
    def decide(self, st): return self.moves if st.window == 0 else []


def tiny(requests, drivers, **kw):
    cfg = SimConfig(n_zones=4, n_drivers=len(drivers), duration_min=30, decision_interval=15,
                    max_pickup_cells=1, max_wait_min=3, acceptance_prob=1.0, max_move_cells=1, **kw)
    real = generate_realization(cfg)
    t, o, d = (np.array(x) for x in zip(*requests)) if requests else (np.array([], int),) * 3
    return replace(real, req_t=t.astype(int), req_o=o.astype(int), req_d=d.astype(int),
                   init_zone=np.array(drivers), accept_u=np.zeros_like(real.accept_u))


# ---------------- metric calculations on a hand-computed world ----------------
def test_metrics_hand_computed():
    # 2 drivers in zone 0, 3 simultaneous requests 0 -> 1. Third one cannot be served and abandons.
    real = tiny([(0, 0, 1)] * 3, [0, 0])
    m = simulate(real, "B0").metrics
    assert (m["requests_generated"], m["requests_served"], m["requests_unserved"]) == (3, 2, 1)
    assert m["unserved_abandoned"] == 1 and m["unserved_waiting_at_end"] == 0
    assert abs(m["service_rate"] - 2 / 3) < 1e-12
    pickup_min = 0.5 / 24 * 60                         # intra-zone pickup 0.5 km at 24 km/h
    assert abs(m["avg_wait_min"] - pickup_min) < 1e-9
    assert abs(m["empty_km_pickup"] - 1.0) < 1e-9 and m["empty_km_reposition"] == 0
    assert m["moves_made"] == 0 and m["relocation_cost_est"] == 0


def test_request_waits_then_is_served():
    # one driver, two requests at t=0: second waits until the driver is free (~5 min) but max_wait=8 allows it
    real = tiny([(0, 0, 1)] * 2, [0])
    real = replace(real, cfg=replace(real.cfg, max_wait_min=8))
    m = simulate(real, "B0").metrics
    assert m["requests_served"] == 2
    assert m["avg_wait_min"] > 0.5 / 24 * 60 + 1       # the second rider queued for several minutes


def test_reposition_cost_and_distance():
    real = tiny([], [0, 0])
    mv = Move(driver=0, src=0, dst=1, dist_km=real.city.dist_km[0, 1])
    m = simulate(real, Fixed([mv])).metrics
    assert m["moves_made"] == 1 and abs(m["empty_km_reposition"] - 1.5) < 1e-9
    assert abs(m["relocation_cost_est"] - 1.5 * real.cfg.reloc_cost_per_km) < 1e-9


def test_declined_move_costs_nothing():
    real = tiny([], [0, 0])
    real = replace(real, accept_u=np.ones_like(real.accept_u), cfg=replace(real.cfg, acceptance_prob=0.5))
    m = simulate(real, Fixed([Move(0, 0, 1, 1.5)])).metrics
    assert m["moves_recommended"] == 1 and m["moves_made"] == 0 and m["empty_km_reposition"] == 0


# ---------------- movement feasibility ----------------
def _raises(real, moves):
    try:
        simulate(real, Fixed(moves))
    except ValueError:
        return True
    return False


def test_simulator_rejects_invalid_moves():
    real = tiny([], [0, 0])
    assert _raises(real, [Move(0, 0, 3, 3.0)])                          # 2 cells > max_move_cells=1
    assert _raises(real, [Move(0, 0, 0, 0.0)])                          # same zone
    assert _raises(real, [Move(0, 0, 1, 1.5), Move(0, 0, 2, 1.5)])      # driver used twice
    assert _raises(real, [Move(0, 1, 0, 1.5)])                          # driver is not in that zone


def test_strategies_respect_constraints_on_real_runs():
    for sc in ({"school": 1.5}, {k: 1.0 for k in SCENARIO_LABELS}):
        real = generate_realization(SimConfig(scenarios=sc, seed=3))
        cfg, city = real.cfg, real.city
        for k in CORE_STRATEGIES:
            res = simulate(real, k)                 # the simulator itself raises on any violation
            for d in res.decisions:
                drivers = [m.driver for m in d["moves"]]
                assert len(drivers) == len(set(drivers))
                assert len(drivers) <= max(1, int(cfg.max_move_fraction * d["idle"].sum())) or not drivers
                for m in d["moves"]:
                    assert 0 < city.dist_cells[m.src, m.dst] <= cfg.max_move_cells


# ---------------- driver accounting ----------------
def test_driver_counts_consistent_every_minute():
    real = generate_realization(SimConfig(scenarios={k: 1.0 for k in SCENARIO_LABELS}, seed=11))
    for k in CORE_STRATEGIES:
        res = simulate(real, k)
        ts = res.timeseries
        assert ((ts.idle + ts.transit + ts.serving) == real.cfg.n_drivers).all()
        assert len(ts) == real.cfg.duration_min
        for s in res.snapshots:
            assert len(s["status"]) == real.cfg.n_drivers
        for d in res.decisions:
            assert d["idle"].sum() + d["incoming"].sum() <= real.cfg.n_drivers


def test_transit_drivers_are_tracked_and_not_reassigned():
    real = tiny([], [0, 0, 0, 0])
    real = replace(real, cfg=replace(real.cfg, base_speed_kmph=1.0))    # very slow: still in transit at window 1
    res = simulate(real, Fixed([Move(0, 0, 1, 1.5)]))
    snap = res.snapshots[1]
    assert snap["status"][0] == 1 and snap["target"][0] == 1             # still repositioning
    assert res.decisions[1]["incoming"][1] == 1                          # visible to the next decision
    assert res.decisions[1]["idle"].sum() == 3                           # not counted as idle


def test_matched_stimuli_and_reproducibility():
    cfg = SimConfig(scenarios={"event": 1.0}, seed=21)
    real = generate_realization(cfg)
    gen = {simulate(real, k, detail=False).metrics["requests_generated"] for k in CORE_STRATEGIES}
    assert len(gen) == 1
    a = simulate(real, "P", detail=False).metrics
    b = simulate(generate_realization(cfg), "P", detail=False).metrics
    assert a == b


def test_all_scenarios_and_overlap_run_for_all_strategies():
    for sc in [{}] + [{k: 1.0} for k in SCENARIO_LABELS] + [{k: 1.0 for k in SCENARIO_LABELS}]:
        real = generate_realization(SimConfig(scenarios=sc, seed=2))
        for k in CORE_STRATEGIES:
            m = simulate(real, k, detail=False).metrics
            assert m["requests_served"] + m["requests_unserved"] == m["requests_generated"]
            assert 0 <= m["service_rate"] <= 1


def test_empty_demand_is_handled():
    real = tiny([], [0, 1])
    m = simulate(real, "P").metrics
    assert m["requests_generated"] == 0 and np.isnan(m["service_rate"]) and np.isnan(m["avg_wait_min"])


# ---------------- strategies are genuinely different ----------------
def test_strategies_differ():
    real = generate_realization(SimConfig(scenarios={"school": 1.0, "rain": 1.0}, seed=4))
    sig = {}
    for k in CORE_STRATEGIES:
        m = simulate(real, k, detail=False).metrics
        sig[k] = (m["moves_made"], round(m["empty_km_total"], 3), m["requests_served"])
    assert sig["B0"][0] == 0
    assert len(set(sig.values())) == 4, sig


def _manual_state(inbound, cfg=None):
    cfg = cfg or SimConfig()
    city = build_city(9)
    idle_ids = [[] for _ in range(9)]
    idle_ids[1], idle_ids[3] = [0, 1, 2], [3, 4, 5]
    idle = np.array([len(x) for x in idle_ids])
    fc = np.full(9, 0.5); fc[4] = 6.0
    return DecisionState(0, 0, 15.0, idle_ids, idle, inbound, fc, 1.0, city, cfg, np.random.default_rng(1))


def test_ridebalance_counts_en_route_supply():
    uncapped = SimConfig(max_move_fraction=1.0)          # the 35% cap would otherwise hide the effect
    inbound = [(10 + i, 4, 2.0) for i in range(5)]       # five drivers about to arrive at zone 4
    into = lambda mv: sum(1 for m in mv if m.dst == 4)
    with_en = RideBalance().decide(_manual_state(inbound, uncapped))
    without = RideBalance(use_enroute=False).decide(_manual_state(inbound, uncapped))
    assert into(with_en) < into(without)
    assert with_en[0].net_benefit < without[0].net_benefit   # same first move, but far less valuable
    # a driver arriving too late (eta well past the deadline) is NOT counted as supply
    late = [(10 + i, 4, 60.0) for i in range(5)]
    assert into(RideBalance().decide(_manual_state(late, uncapped))) == into(without)
    assert into(DemandOnlyHeatmap().decide(_manual_state(inbound, uncapped))) >= 1   # B1 ignores en-route supply


def test_ridebalance_moves_have_positive_net_benefit_and_cost_aware_b2_too():
    for strat in (RideBalance(), CostAwareHeatmap()):
        for m in strat.decide(_manual_state([])):
            assert m.net_benefit > 0
    assert RideBalance().decide(_manual_state([]))
    # with free relocation made expensive, nothing should move
    pricey = SimConfig(reloc_cost_per_km=10_000.0)
    assert RideBalance().decide(_manual_state([], pricey)) == []
    assert CostAwareHeatmap().decide(_manual_state([], pricey)) == []
