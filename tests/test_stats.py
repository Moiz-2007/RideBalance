import numpy as np
import pandas as pd
from scipy import stats

from ridebalance.config import SimConfig
from ridebalance.experiments import holm, mean_ci, paired_comparison, paired_test, run_batch, summarize
from ridebalance.shortage import DemandModel, arrival_prob


def test_mean_ci_matches_formula():
    m, lo, hi, n = mean_ci([1, 2, 3, 4, 5])
    half = stats.t.ppf(0.975, 4) * np.std([1, 2, 3, 4, 5], ddof=1) / np.sqrt(5)
    assert (m, n) == (3.0, 5) and abs(hi - m - half) < 1e-12 and abs(m - lo - half) < 1e-12
    assert np.isnan(mean_ci([1.0])[1]) and mean_ci([])[3] == 0


def test_paired_test_choices():
    rng = np.random.default_rng(0)
    b = rng.normal(0, 1, 12)
    a = b + rng.normal(0.5, 0.2, 12)
    r = paired_test(a, b)
    assert r["test"].startswith("paired t-test") and abs(r["p"] - stats.ttest_rel(a, b).pvalue) < 1e-12
    skew = np.array([1.0] * 9 + [50.0])
    assert paired_test(skew + 5, np.full(10, 5.0))["test"].startswith("Wilcoxon")
    same = paired_test(np.ones(5), np.ones(5))
    assert np.isnan(same["p"]) and "identical" in same["test"]
    assert np.isnan(paired_test([1.0, 2.0], [1.5, 2.5])["p"])        # n < 3: no p-value claimed


def test_holm():
    assert np.allclose(holm([0.01, 0.04, 0.03]), [0.03, 0.06, 0.06])


def test_batch_is_matched_and_summaries_work():
    cfg = SimConfig(scenarios={"school": 1.0})
    df = run_batch(cfg, n_runs=4)
    assert len(df) == 16
    assert (df.groupby("seed").requests_generated.nunique() == 1).all()
    s = summarize(df, ["service_rate"])
    assert set(s.strategy) == {"B0", "B1", "B2", "P"} and (s.n == 4).all()
    pc = paired_comparison(df, "P", ["B0"], ["service_rate"])
    assert len(pc) == 1 and pc.iloc[0].n == 4
    one = summarize(run_batch(cfg, n_runs=1), ["service_rate"])
    assert one.ci_low.isna().all()                                    # single run: no interval claimed


def test_demand_model_matches_poisson_when_sigma_zero():
    rng = np.random.default_rng(1)
    m = DemandModel([3.0, 0.5], 0.0, 40000, rng, 20)
    for k in range(6):
        assert abs(m.tail[k, 0] - stats.poisson.sf(k, 3.0)) < 0.01
    assert abs(m.expected_served([3.0, 3.0])[0] - sum(stats.poisson.sf(k, 3.0) for k in range(3))) < 0.02
    assert (np.diff(m.tail, axis=0) <= 1e-12).all()
    lo, hi = m.emin[2, 0], m.emin[3, 0]
    assert lo < m.expected_served([2.5, 0.0])[0] < hi
    wide = DemandModel([3.0], 0.5, 40000, np.random.default_rng(2), 30)
    assert wide.samples.var() > m.samples[:, 0].var()                  # uncertainty widens the distribution


def test_arrival_prob():
    assert arrival_prob(0.0, 7.5, 0.15) == 1.0
    assert arrival_prob(3.0, 7.5, 0.15) > 0.99 and arrival_prob(20.0, 7.5, 0.15) < 0.01
    v = arrival_prob(np.array([2.0, 7.5, 12.0]), 7.5, 0.15)
    assert v[0] > v[1] > v[2]
