"""Tables and data-driven explanations. Nothing here is hard-coded as a result:
every sentence is generated from the numbers passed in."""
from __future__ import annotations

import numpy as np
import pandas as pd

from .config import SCENARIO_LABELS, STRATEGY_LABELS, SimConfig
from .experiments import METRIC_INFO, PRIMARY_METRIC
from .shortage import DemandModel

TABLE_METRICS = ["requests_generated", "requests_served", "requests_unserved", "service_rate", "avg_wait_min",
                 "empty_km_pickup", "empty_km_reposition", "empty_km_total", "moves_made", "redundant_moves",
                 "idle_in_hot_zones_avg", "relocation_cost_est", "empty_cost_est"]


def label(s: str) -> str:
    return STRATEGY_LABELS.get(s, s)


def fmt(metric: str, v: float) -> str:
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return "n/a"
    if metric == "service_rate":
        return f"{100 * v:.1f}%"
    if metric in ("avg_wait_min", "idle_in_hot_zones_avg", "served_per_empty_km"):
        return f"{v:.2f}"
    if metric.startswith(("empty_km", "relocation", "empty_cost")):
        return f"{v:,.0f}"
    return f"{v:,.0f}"


def single_run_table(results: dict, metrics=None) -> pd.DataFrame:
    """Rows = metrics, columns = strategies, from one matched run."""
    metrics = metrics or TABLE_METRICS
    data = {}
    for key, res in results.items():
        data[label(key)] = [res.metrics[m] for m in metrics]
    df = pd.DataFrame(data, index=[METRIC_INFO[m][0] for m in metrics])
    df.insert(0, "Type", [METRIC_INFO[m][2] for m in metrics])
    return df


def summary_table(summary: pd.DataFrame, metrics=None) -> pd.DataFrame:
    metrics = metrics or ["service_rate", "requests_unserved", "avg_wait_min", "empty_km_total",
                          "moves_made", "redundant_moves", "idle_in_hot_zones_avg", "relocation_cost_est"]
    rows = []
    for m in metrics:
        row = {"Metric": METRIC_INFO[m][0]}
        for strat in summary.strategy.unique():
            r = summary[(summary.strategy == strat) & (summary.metric == m)].iloc[0]
            ci = "" if np.isnan(r.ci_low) else f"  [{fmt(m, r.ci_low)}, {fmt(m, r.ci_high)}]"
            row[label(strat)] = f"{fmt(m, r['mean'])}{ci}"
        rows.append(row)
    return pd.DataFrame(rows).set_index("Metric")


def zone_table(res, window: int, city) -> pd.DataFrame:
    d = res.decisions[window]
    return pd.DataFrame({
        "Zone": city.ids,
        "Role": city.role_of,
        "Predicted demand (window)": np.round(d["forecast"], 2),
        "Idle drivers": d["idle"],
        "Incoming (en route)": d["incoming"],
        "Effective supply": np.round(d["eff_supply"], 2),
        "Shortage risk": np.round(d["risk"], 3),
        "Moves out": d["moves_out"],
        "Moves in (recommended)": d["moves_in"],
    })


def window_moves_table(res, window: int, city) -> pd.DataFrame:
    d = res.decisions[window]
    rows = [dict(driver=m.driver, src=city.ids[m.src], dst=city.ids[m.dst], dist_km=m.dist_km,
                 accepted_by_driver=m.accepted,
                 net_benefit=m.net_benefit, service_gain=m.service_gain, reloc_cost=m.reloc_cost,
                 oversupply_penalty=m.oversupply_penalty) for m in d["moves"]]
    return pd.DataFrame(rows)


def driver_table(res, window: int, city) -> pd.DataFrame:
    s = res.snapshots[window]
    names = {0: "idle", 1: "in transit (repositioning)", 2: "serving a request"}
    return pd.DataFrame({
        "Driver": np.arange(len(s["status"])),
        "Status (decision time, before moves)": [names[x] for x in s["status"]],
        "Zone": [city.ids[z] for z in s["zone"]],
        "Heading to": [city.ids[z] if st else "-" for z, st in zip(s["target"], s["status"])],
    })


def mean_risk_by_zone(res) -> np.ndarray:
    return np.mean([d["risk"] for d in res.decisions], axis=0)


def uncertainty_samples(cfg: SimConfig, res, window: int, zone: int) -> np.ndarray:
    d = res.decisions[window]
    m = DemandModel(d["forecast"], cfg.forecast_sigma, cfg.mc_samples,
                    np.random.default_rng([cfg.seed, window, 99]), cfg.n_drivers + 2)
    return m.samples[:, zone]


# ---------------------------------------------------------------- explanations
def _best(summary, metric, higher):
    s = summary[summary.metric == metric].sort_values("mean", ascending=not higher)
    return s.iloc[0]


def _ci_text(r):
    return f"mean difference {r.mean_diff:+.4g}, 95% CI [{r.ci_low:+.4g}, {r.ci_high:+.4g}], n = {int(r.n)}"


def _excludes_zero(r):
    return not (np.isnan(r.ci_low) or np.isnan(r.ci_high)) and (r.ci_low > 0 or r.ci_high < 0)


def explain_results(summary: pd.DataFrame, paired: pd.DataFrame, focal: str = "P") -> list:
    out = []
    if summary.empty or focal not in summary.strategy.values:
        return ["Run the simulation to see results."]
    n = int(summary.n.max())
    if n < 5:
        out.append(f"Only {n} run(s): intervals and tests are unreliable. Increase the number of repeated runs.")

    out.append("**Which strategy had the best mean on each metric** (a best mean is not a proven win; "
               "see the note on overlapping intervals):")
    for m in ["service_rate", "requests_unserved", "avg_wait_min", "empty_km_total",
              "relocation_cost_est", "idle_in_hot_zones_avg", "redundant_moves"]:
        lab, higher, _ = METRIC_INFO[m]
        ranked = summary[summary.metric == m].sort_values("mean", ascending=not higher)
        b = ranked.iloc[0]
        note = ""
        if len(ranked) > 1:
            r2 = ranked.iloc[1]
            if not (np.isnan(b.ci_low) or np.isnan(r2.ci_low)) and r2.ci_high >= b.ci_low and r2.ci_low <= b.ci_high:
                note = f" Not clearly separated from {label(r2.strategy)} (95% intervals overlap)."
        extra = ""
        if b.strategy != focal:
            f = ranked[ranked.strategy == focal].iloc[0]
            extra = f" RideBalance: {fmt(m, f['mean'])}."
        out.append(f"- {lab}: **{label(b.strategy)}** ({fmt(m, b['mean'])}).{extra}{note}")

    if not paired.empty:
        out.append("")
        out.append("**Did RideBalance reduce unmet requests or empty travel? (paired by seed, P minus baseline)**")
        for m, word in [("requests_unserved", "unserved requests"), ("empty_km_total", "total empty km")]:
            for _, r in paired[paired.metric == m].iterrows():
                if np.isnan(r.mean_diff):
                    continue
                direction = "fewer" if r.mean_diff < 0 else "more"
                verdict = ("the interval excludes 0" if _excludes_zero(r) else "the interval includes 0, so no reliable difference")
                out.append(f"- vs {label(r.vs)}: RideBalance had {abs(r.mean_diff):,.1f} {direction} {word} on average "
                           f"({_ci_text(r)}; {verdict}).")

        out.append("")
        out.append("**Did better service cost more relocation? (P minus baseline)**")
        for b in paired.vs.unique():
            sr = paired[(paired.metric == PRIMARY_METRIC) & (paired.vs == b)]
            rc = paired[(paired.metric == "relocation_cost_est") & (paired.vs == b)]
            if sr.empty or rc.empty or np.isnan(sr.iloc[0].mean_diff):
                continue
            sr, rc = sr.iloc[0], rc.iloc[0]
            out.append(f"- vs {label(b)}: service rate {100 * sr.mean_diff:+.2f} percentage points; "
                       f"relocation cost {rc.mean_diff:+,.0f} INR (estimate).")

        prim = paired[paired.metric == PRIMARY_METRIC]
        if not prim.empty:
            out.append("")
            out.append("**Statistical check on the primary metric (service rate):**")
            for _, r in prim.iterrows():
                if np.isnan(r.p):
                    out.append(f"- vs {label(r.vs)}: {r.test}; no p-value available.")
                    continue
                sig = "below" if r.p_holm_primary < 0.05 else "not below"
                out.append(f"- vs {label(r.vs)}: {r.test}; p = {r.p:.4f}, Holm-adjusted p = {r.p_holm_primary:.4f} "
                           f"({sig} 0.05); effect size d_z = {r.effect_size_dz:.2f}.")
            out.append("Other metrics are exploratory and not corrected for multiple comparisons.")
    return out


def explain_sweep(sweep: pd.DataFrame, focal: str = "P") -> list:
    if sweep is None or sweep.empty:
        return ["Run the scenario sweep (Scenarios tab) to compare scenarios."]
    from .experiments import mean_ci
    names = {"none": "No scenario (baseline demand)", "all": "All five scenarios combined", **SCENARIO_LABELS}
    rates = sweep.groupby(["case", "strategy"])["service_rate"].mean().unstack()
    order = [c for c in names if c in rates.index]
    out = ["**Performance across scenarios (service rate; RideBalance minus the best-scoring baseline, paired by seed):**"]
    for c in order:
        g = sweep[sweep.case == c].pivot(index="seed", columns="strategy", values="service_rate")
        base = g.drop(columns=[focal], errors="ignore")
        if focal not in g or base.shape[1] == 0:
            continue
        bb = base.mean().idxmax()
        m, lo, hi, n = mean_ci(g[focal] - g[bb])
        if np.isnan(lo):
            verdict = "too few runs for an interval"
        else:
            verdict = "interval excludes 0" if (lo > 0 or hi < 0) else "interval includes 0, no reliable difference"
        out.append(f"- {names[c]}: RideBalance {100 * g[focal].mean():.1f}%, best baseline {label(bb)} "
                   f"{100 * base[bb].mean():.1f}%; difference {100 * m:+.2f} pp "
                   f"(95% CI [{100 * lo:+.2f}, {100 * hi:+.2f}], n = {n}; {verdict}).")
    out.append("Intervals are not corrected for comparing several scenarios.")
    spread = rates.max(axis=1) - rates.min(axis=1)
    low_cases = [names[c] for c in order if rates.loc[c].max() < 0.90]
    out.append("")
    out.append("**Possible reasons for differences (interpretation, not tested here):**")
    if low_cases:
        out.append(f"- Where every strategy serves under 90% ({', '.join(low_cases)}), demand exceeds what the whole fleet "
                   "can serve, so moving drivers around cannot create capacity.")
    if spread.max() < 0.02:
        out.append("- The gap between the best and worst strategy is under 2 percentage points in every case, "
                   "so repositioning changes outcomes only slightly in this synthetic setup.")
    out.append("- Local surges (school, event, transit) create short spatial imbalances that repositioning can address; "
               "city-wide shocks (rain) mostly reduce capacity because trips take longer.")
    return out
