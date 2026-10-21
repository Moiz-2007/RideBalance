"""REPEATED EXPERIMENTS: compute MEAN AND CONFIDENCE INTERVAL, and optionally run a SCENARIO SWEEP.
MEAN AND STANDARD DEVIATION
HYPOTHESIS TESTING
95% CONFIDENCE INTERVAL
, scenario sweeps and the statistics on top of them."""

from __future__ import annotations

from dataclasses import replace

import numpy as np
import pandas as pd
from scipy import stats

from .config import CORE_STRATEGIES, SCENARIO_LABELS, SimConfig
from .demand import generate_realization
from .simulator import simulate

# label, higher_is_better (None = informational), kind
METRIC_INFO = {
    "requests_generated": ("Requests generated", None, "simulation output"),
    "requests_served": ("Requests served", True, "simulation output"),
    "requests_unserved": ("Unserved requests", False, "simulation output"),
    "service_rate": ("Service rate", True, "simulation output"),
    "avg_wait_min": ("Avg passenger wait (min)", False, "simulation output"),
    "empty_km_pickup": ("Empty km: pickups", False, "simulation output"),
    "empty_km_reposition": ("Empty km: repositioning", False, "simulation output"),
    "empty_km_total": ("Empty km: total", False, "simulation output"),
    "moves_made": ("Repositioning moves made", None, "simulation output"),
    "redundant_moves": ("Redundant moves (post-hoc)", False, "simulation output"),
    "idle_in_hot_zones_avg": ("Idle drivers in high-demand zones (avg)", False, "simulation output"),
    "relocation_cost_est": ("Relocation cost (INR, estimate)", False, "estimate from cost assumption"),
    "empty_cost_est": ("Total empty-travel cost (INR, estimate)", False, "estimate from cost assumption"),
    "served_per_empty_km": ("Requests served per empty km", True, "simulation output"),
}
PRIMARY_METRIC = "service_rate"


def run_batch(cfg: SimConfig, strategies=None, n_runs: int = 20) -> pd.DataFrame:
    """Run every strategy on the same matched worlds, seeds cfg.seed .. cfg.seed+n_runs-1."""
    strategies = list(strategies or CORE_STRATEGIES)
    rows = []
    for i in range(int(n_runs)):
        c = replace(cfg, seed=cfg.seed + i)
        real = generate_realization(c)
        for key in strategies:
            m = simulate(real, key, detail=False).metrics
            rows.append(dict(seed=c.seed, strategy=key, **m))
    return pd.DataFrame(rows)


def mean_ci(x, level: float = 0.95):
    x = np.asarray(x, dtype=float)
    x = x[~np.isnan(x)]
    n = len(x)
    if n == 0:
        return float("nan"), float("nan"), float("nan"), 0
    m = float(x.mean())
    if n < 2:
        return m, float("nan"), float("nan"), n
    h = stats.t.ppf(0.5 + level / 2, n - 1) * x.std(ddof=1) / np.sqrt(n)
    return m, m - float(h), m + float(h), n


def summarize(df: pd.DataFrame, metrics=None) -> pd.DataFrame:
    metrics = metrics or list(METRIC_INFO)
    out = []
    for strat, g in df.groupby("strategy", sort=False):
        for met in metrics:
            m, lo, hi, n = mean_ci(g[met])
            out.append(dict(strategy=strat, metric=met, n=n, mean=m, ci_low=lo, ci_high=hi,
                            sd=float(np.nanstd(g[met], ddof=1)) if n > 1 else float("nan")))
    return pd.DataFrame(out)


def holm(pvals) -> list:
    p = np.asarray(pvals, dtype=float)
    order = np.argsort(np.where(np.isnan(p), np.inf, p))
    adj = np.full(len(p), np.nan)
    running, m = 0.0, int((~np.isnan(p)).sum())
    for rank, i in enumerate(order[:m]):
        running = max(running, (m - rank) * p[i])
        adj[i] = min(1.0, running)
    return list(adj)


def paired_test(a, b):
    """Paired comparison of a - b. Returns dict(n, mean_diff, ci_low, ci_high, effect_size_dz, test, p).

    Test choice: with n >= 8 a Shapiro-Wilk test on the differences is run; if it
    rejects normality (p < 0.05) a Wilcoxon signed-rank test is used, otherwise a
    paired t-test. With fewer runs a paired t-test is used and flagged as weak.
    """
    d = np.asarray(a, dtype=float) - np.asarray(b, dtype=float)
    d = d[~np.isnan(d)]
    n = len(d)
    res = dict(n=n, mean_diff=float("nan"), ci_low=float("nan"), ci_high=float("nan"),
               effect_size_dz=float("nan"), test="n/a (need >= 3 runs)", p=float("nan"))
    if n == 0:
        return res
    res["mean_diff"] = float(d.mean())
    if n < 2:
        return res
    sd = d.std(ddof=1)
    _, lo, hi, _ = mean_ci(d)
    res["ci_low"], res["ci_high"] = lo, hi
    if sd == 0:
        res["test"] = "identical in every run" if d.mean() == 0 else "constant difference"
        return res
    res["effect_size_dz"] = float(d.mean() / sd)
    if n < 3:
        return res
    use_wilcoxon = False
    if n >= 8:
        use_wilcoxon = stats.shapiro(d).pvalue < 0.05
    if use_wilcoxon:
        try:
            res["p"] = float(stats.wilcoxon(d).pvalue)
            res["test"] = "Wilcoxon signed-rank (differences not normal)"
        except ValueError:
            res["test"] = "Wilcoxon failed"
    else:
        res["p"] = float(stats.ttest_rel(np.asarray(a, float), np.asarray(b, float), nan_policy="omit").pvalue)
        res["test"] = "paired t-test" + ("" if n >= 8 else " (small n: normality unchecked)")
    return res


def paired_comparison(df: pd.DataFrame, focal: str = "P", baselines=None, metrics=None) -> pd.DataFrame:
    """focal minus each baseline, matched by seed. Holm correction is applied across
    baselines for the pre-specified primary metric only; other metrics are exploratory."""
    metrics = metrics or list(METRIC_INFO)
    baselines = baselines or [s for s in df.strategy.unique() if s != focal]
    piv = {m: df.pivot(index="seed", columns="strategy", values=m) for m in metrics}
    rows = []
    for met in metrics:
        for b in baselines:
            if focal not in piv[met] or b not in piv[met]:
                continue
            r = paired_test(piv[met][focal], piv[met][b])
            rows.append(dict(metric=met, vs=b, **r))
    out = pd.DataFrame(rows)
    out["p_holm_primary"] = np.nan
    prim = out.metric == PRIMARY_METRIC
    if prim.any():
        out.loc[prim, "p_holm_primary"] = holm(out.loc[prim, "p"].values)
    return out


SWEEP_CASES = ["none"] + list(SCENARIO_LABELS) + ["all"]


def sweep_case_config(cfg: SimConfig, case: str, severity: float = 1.0) -> SimConfig:
    if case == "none":
        sc = {}
    elif case == "all":
        sc = {k: severity for k in SCENARIO_LABELS}
    else:
        sc = {case: severity}
    return replace(cfg, scenarios=sc)


def scenario_sweep(cfg: SimConfig, strategies=None, n_runs: int = 10, severity: float = 1.0) -> pd.DataFrame:
    frames = []
    for case in SWEEP_CASES:
        df = run_batch(sweep_case_config(cfg, case, severity), strategies, n_runs)
        df.insert(0, "case", case)
        frames.append(df)
    return pd.concat(frames, ignore_index=True)
