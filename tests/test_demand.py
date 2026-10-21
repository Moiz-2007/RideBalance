import numpy as np
from dataclasses import replace

from ridebalance.city import build_city
from ridebalance.config import SCENARIO_LABELS, SimConfig, validate
from ridebalance.demand import combine_effects, expected_rate, generate_realization, destination_probs


def test_city_roles_are_distinct_and_cover_grid():
    for z in (4, 6, 9, 12, 16, 25, 30):
        c = build_city(z)
        special = c.roles["business"] + c.roles["station"] + c.roles["school"] + c.roles["stadium"]
        assert len(set(special)) == len(special)
        assert sorted(special + c.roles["residential"]) == list(range(z))
        assert abs(c.base_weight.mean() - 1) < 1e-9
        assert (c.dist_cells == c.dist_cells.T).all() and (np.diag(c.dist_cells) == 0).all()


def test_shapes_nonnegative_and_reproducible():
    cfg = SimConfig(scenarios={"school": 1.0}, seed=5)
    a, b = generate_realization(cfg), generate_realization(cfg)
    assert a.rate.shape == (cfg.duration_min, cfg.n_zones)
    assert (a.rate >= 0).all() and (a.forecast >= 0).all()
    assert np.array_equal(a.req_t, b.req_t) and np.array_equal(a.req_o, b.req_o) and np.array_equal(a.req_d, b.req_d)
    assert np.array_equal(a.init_zone, b.init_zone)
    c = generate_realization(replace(cfg, seed=6))
    assert not (len(c.req_t) == len(a.req_t) and np.array_equal(c.req_o, a.req_o))
    assert (np.diff(a.req_t) >= 0).all()
    assert (a.req_o != a.req_d).all()


def test_school_surge_is_local_to_school_zone():
    cfg = SimConfig(scenarios={"school": 1.0})
    city = build_city(cfg.n_zones)
    base, _, _ = expected_rate(replace(cfg, scenarios={}), city)
    rate, _, _ = expected_rate(cfg, city)
    s = city.roles["school"][0]
    peak = int(cfg.duration_min * cfg.sp.school_peak_frac)
    ratio = rate[peak, s] / base[peak, s]
    assert 4.5 < ratio <= 5.0 + 1e-9               # 1 + severity * amp at the pulse peak
    far = [z for z in range(cfg.n_zones) if z != s and z not in city.neighbors[s]]
    assert np.allclose(rate[:, far], base[:, far])
    nb = city.neighbors[s][0]
    assert 1 < rate[peak, nb] / base[peak, nb] < ratio


def test_office_commute_depends_on_period():
    city = build_city(9)
    res, biz = city.mask("residential"), city.mask("business")
    cfg_m = SimConfig(scenarios={"office": 1.0}, commute_period="morning")
    cfg_e = replace(cfg_m, commute_period="evening")
    base, _, _ = expected_rate(replace(cfg_m, scenarios={}), city)
    pk = int(cfg_m.duration_min * cfg_m.sp.office_peak_frac)
    rm, _, _ = expected_rate(cfg_m, city)
    re_, _, _ = expected_rate(cfg_e, city)
    up = lambda r, m: (r[pk, m] / base[pk, m]).mean()
    assert up(rm, res) > up(rm, biz)
    assert up(re_, biz) > up(re_, res)


def test_event_rain_and_transit_effects():
    city = build_city(9)
    cfg = SimConfig()
    base, sp0, _ = expected_rate(cfg, city)
    # event dispersal at the stadium
    ev, _, _ = expected_rate(replace(cfg, scenarios={"event": 1.0}), city)
    st = city.roles["stadium"][0]
    pk = int(cfg.duration_min * cfg.sp.event_peak_frac)
    assert ev[pk, st] / base[pk, st] > 5
    # event arrival mode raises residential demand instead
    ea, _, _ = expected_rate(replace(cfg, scenarios={"event": 1.0}, event_mode="arrival"), city)
    assert ea[:, city.mask("residential")].sum() > base[:, city.mask("residential")].sum()
    # rain: more demand everywhere late in the run, and slower travel
    rn, sp, _ = expected_rate(replace(cfg, scenarios={"rain": 1.0}), city)
    assert (rn[-1] > base[-1]).all() and sp[-1] < 1 and sp[0] == 1
    assert sp.min() >= 0.4
    # transit disruption at the station zone
    tr, _, _ = expected_rate(replace(cfg, scenarios={"transit": 1.0}), city)
    s = city.roles["station"][0]
    assert tr[-1, s] / base[-1, s] > 3


def test_combination_modes_and_cap():
    eff = {"a": np.array([[1.0]]), "b": np.array([[2.0]])}
    assert combine_effects(eff, "multiplicative", (1, 1), 100)[0, 0] == 6.0
    assert combine_effects(eff, "additive", (1, 1), 100)[0, 0] == 4.0
    assert combine_effects(eff, "multiplicative", (1, 1), 5)[0, 0] == 5.0
    assert combine_effects({}, "additive", (2, 3), 5).shape == (2, 3)


def test_overlap_exceeds_each_single_scenario():
    cfg = SimConfig()
    city = build_city(cfg.n_zones)
    allsc = {k: 1.0 for k in SCENARIO_LABELS}
    tot = expected_rate(replace(cfg, scenarios=allsc), city)[0].sum()
    for k in SCENARIO_LABELS:
        assert tot > expected_rate(replace(cfg, scenarios={k: 1.0}), city)[0].sum()
        assert expected_rate(replace(cfg, scenarios={k: 1.0}), city)[0].sum() > expected_rate(cfg, city)[0].sum()


def test_destination_probs_valid():
    cfg = SimConfig(scenarios={k: 1.0 for k in SCENARIO_LABELS})
    P = destination_probs(cfg, build_city(9))
    assert np.allclose(P.sum(1), 1) and (np.diag(P) == 0).all()


def test_validation_messages():
    assert validate(SimConfig()) == []
    assert validate(SimConfig(duration_min=20, decision_interval=15))
    assert validate(SimConfig(n_zones=2))
    assert validate(SimConfig(scenarios={"school": -1.0}))
    assert validate(SimConfig(acceptance_prob=1.5))
    assert SimConfig.from_json(SimConfig(scenarios={"rain": 0.5}).to_json()) == SimConfig(scenarios={"rain": 0.5})
