"""RideBalance — Streamlit prototype (synthetic simulation, not a live Ola/Uber integration)."""
from __future__ import annotations

import numpy as np
import pandas as pd
import streamlit as st

from ridebalance.config import (ABLATIONS, CORE_STRATEGIES, PARAM_DOCS, SCENARIO_LABELS, STRATEGY_LABELS,
                                SimConfig, validate)
from ridebalance.demand import generate_realization
from ridebalance.experiments import (METRIC_INFO, paired_comparison, run_batch, scenario_sweep, summarize)
from ridebalance.plots import (ci_bar, demand_timeline, single_bar, status_timeseries, sweep_figure,
                               uncertainty_hist, zone_grid_figure)
from ridebalance.reporting import (driver_table, explain_results, explain_sweep, label, mean_risk_by_zone,
                                   single_run_table, summary_table, uncertainty_samples, window_moves_table,
                                   zone_table)
from ridebalance.simulator import simulate

st.set_page_config(page_title="RideBalance prototype", layout="wide")

SCEN_BLURB = {
    "school": "Local surge around a school/college zone at dismissal time, smaller spill-over into adjacent zones.",
    "office": "Commute peak: residential zones surge in the morning, business zones in the evening.",
    "event": "Stadium zone surge when an event ends (dispersal) or a mild build-up before it starts (arrival).",
    "rain": "More requests everywhere and slower travel from a start time onward.",
    "transit": "A station zone (and its neighbours) sees extra demand as riders switch to ride-hailing.",
}

DEFAULTS = dict(
    n_zones=9, n_drivers=60, duration_min=120, decision_interval=15, demand_intensity=0.50, seed=42,
    scenarios_sel=["school"], combine_mode="multiplicative", commute_period="morning", event_mode="dispersal",
    sev_school=1.0, sev_office=1.0, sev_event=1.0, sev_rain=1.0, sev_transit=1.0,
    n_runs=20, include_ablations=False,
    acceptance_prob=0.90, forecast_sigma=0.20, demand_shock_sigma=0.15, travel_time_cv=0.15,
    max_move_cells=3, max_move_fraction=0.35, max_pickup_cells=1, max_wait_min=8,
    value_per_request=150.0, reloc_cost_per_km=8.0, idle_cost_per_window=20.0,
)

for _k, _v in DEFAULTS.items():
    st.session_state.setdefault(_k, list(_v) if isinstance(_v, list) else _v)


def reset_cb():
    for k, v in DEFAULTS.items():
        st.session_state[k] = list(v) if isinstance(v, list) else v
    for k in ("results", "sweep"):
        st.session_state.pop(k, None)


def build_config() -> SimConfig:
    ss = st.session_state
    return SimConfig(
        n_zones=int(ss["n_zones"]), n_drivers=int(ss["n_drivers"]), duration_min=int(ss["duration_min"]),
        decision_interval=int(ss["decision_interval"]), demand_intensity=float(ss["demand_intensity"]),
        seed=int(ss["seed"]),
        scenarios={s: float(ss.get(f"sev_{s}", DEFAULTS[f"sev_{s}"])) for s in ss["scenarios_sel"]},
        combine_mode=ss.get("combine_mode", DEFAULTS["combine_mode"]) if len(ss["scenarios_sel"]) > 1 else "multiplicative",
        commute_period=ss.get("commute_period", DEFAULTS["commute_period"]),
        event_mode=ss.get("event_mode", DEFAULTS["event_mode"]),
        max_pickup_cells=int(ss["max_pickup_cells"]), max_wait_min=int(ss["max_wait_min"]),
        max_move_cells=int(ss["max_move_cells"]), max_move_fraction=float(ss["max_move_fraction"]),
        acceptance_prob=float(ss["acceptance_prob"]), forecast_sigma=float(ss["forecast_sigma"]),
        demand_shock_sigma=float(ss["demand_shock_sigma"]), travel_time_cv=float(ss["travel_time_cv"]),
        value_per_request=float(ss["value_per_request"]), reloc_cost_per_km=float(ss["reloc_cost_per_km"]),
        idle_cost_per_window=float(ss["idle_cost_per_window"]),
    )


# ------------------------------------------------------------------ cached computation
@st.cache_data(show_spinner=False)
def cached_preview(cfg_json: str):
    return generate_realization(SimConfig.from_json(cfg_json))


@st.cache_data(show_spinner=False)
def cached_detail(cfg_json: str, strategies: tuple):
    real = generate_realization(SimConfig.from_json(cfg_json))
    return {k: simulate(real, k, detail=True) for k in strategies}


@st.cache_data(show_spinner=False)
def cached_batch(cfg_json: str, strategies: tuple, n_runs: int):
    return run_batch(SimConfig.from_json(cfg_json), strategies, n_runs)


@st.cache_data(show_spinner=False)
def cached_sweep(cfg_json: str, strategies: tuple, n_runs: int, severity: float):
    return scenario_sweep(SimConfig.from_json(cfg_json), strategies, n_runs, severity)


# ------------------------------------------------------------------ sidebar
sb = st.sidebar
sb.title("Simulation controls")
sb.caption("Synthetic simulation. Press **Run Simulation** to apply changes.")
sb.number_input("Number of city zones", min_value=4, max_value=36, step=1, key="n_zones")
sb.number_input("Number of drivers", min_value=1, max_value=500, step=5, key="n_drivers")
sb.number_input("Simulation duration (minutes)", min_value=20, max_value=480, step=10, key="duration_min")
sb.selectbox("Decision interval (minutes)", [10, 15, 20, 30], key="decision_interval")
sb.slider("Demand intensity (requests / zone / min, no scenario)", 0.05, 1.5, step=0.05, key="demand_intensity")
sb.number_input("Random seed", min_value=0, max_value=10_000_000, step=1, key="seed")
sb.multiselect("Demand scenarios (select several to overlap them)", list(SCENARIO_LABELS),
               format_func=lambda s: SCENARIO_LABELS[s], key="scenarios_sel")
# Streamlit drops the state of widgets that are not drawn in a run, so conditional
# widgets are re-seeded from DEFAULTS just before they are created.
for _s in st.session_state["scenarios_sel"]:
    st.session_state.setdefault(f"sev_{_s}", DEFAULTS[f"sev_{_s}"])
    sb.slider(f"Severity: {SCENARIO_LABELS[_s]}", 0.0, 2.0, step=0.1, key=f"sev_{_s}")
if len(st.session_state["scenarios_sel"]) > 1:
    st.session_state.setdefault("combine_mode", DEFAULTS["combine_mode"])
    sb.radio("How overlapping scenarios combine", ["multiplicative", "additive"], key="combine_mode",
             help="multiplicative: product of (1 + effect). additive: 1 + sum of effects. Capped at 12x.")
if "office" in st.session_state["scenarios_sel"]:
    st.session_state.setdefault("commute_period", DEFAULTS["commute_period"])
    sb.selectbox("Commute period", ["morning", "evening"], key="commute_period")
if "event" in st.session_state["scenarios_sel"]:
    st.session_state.setdefault("event_mode", DEFAULTS["event_mode"])
    sb.selectbox("Event surge type", ["dispersal", "arrival"], key="event_mode")
sb.slider("Repeated runs for statistics", 1, 100, key="n_runs")
sb.checkbox("Also run RideBalance ablations (no en-route supply / no uncertainty)", key="include_ablations")
with sb.expander("Advanced parameters"):
    st.slider("Driver acceptance probability", 0.0, 1.0, step=0.05, key="acceptance_prob")
    st.slider("Forecast error (log-normal sigma)", 0.0, 1.0, step=0.05, key="forecast_sigma")
    st.slider("True-demand fluctuation (sigma)", 0.0, 1.0, step=0.05, key="demand_shock_sigma")
    st.slider("Travel-time variability (cv)", 0.0, 0.6, step=0.05, key="travel_time_cv")
    st.number_input("Max relocation distance (cells)", min_value=1, max_value=10, key="max_move_cells")
    st.slider("Max share of idle drivers moved per decision", 0.0, 1.0, step=0.05, key="max_move_fraction")
    st.number_input("Max pickup distance (cells)", min_value=0, max_value=5, key="max_pickup_cells")
    st.number_input("Max rider wait (minutes)", min_value=0, max_value=60, key="max_wait_min")
    st.number_input("Value per served request (INR)", min_value=0.0, step=10.0, key="value_per_request")
    st.number_input("Cost per empty km (INR)", min_value=0.0, step=1.0, key="reloc_cost_per_km")
    st.number_input("Idle cost per driver per window (INR)", min_value=0.0, step=5.0, key="idle_cost_per_window")

run_clicked = sb.button("▶ Run Simulation", type="primary")
sb.button("↺ Reset Simulation", on_click=reset_cb)

cfg = build_config()
errors = validate(cfg)
for _e in errors:
    sb.error(_e)

if run_clicked and not errors:
    strategies = tuple(CORE_STRATEGIES + (ABLATIONS if st.session_state["include_ablations"] else []))
    with st.spinner("Running all strategies on matched scenarios..."):
        st.session_state["results"] = dict(
            cfg=cfg.to_dict(),
            detail=cached_detail(cfg.to_json(), tuple(CORE_STRATEGIES)),
            batch=cached_batch(cfg.to_json(), strategies, int(st.session_state["n_runs"])),
            n_runs=int(st.session_state["n_runs"]),
        )
        st.session_state.pop("sweep", None)

R = st.session_state.get("results")

# ------------------------------------------------------------------ main
st.title("RideBalance: Risk-Aware Ride-Hailing Demand–Supply Balancing and Driver Repositioning")
st.warning("**Simulation prototype.** All demand, drivers, travel times and scenarios are synthetic assumptions. "
           "This is not a live Ola/Uber integration and nothing here is real-world evidence.")
if R is not None and R["cfg"] != cfg.to_dict():
    st.info("Controls have changed since the last run. Press **Run Simulation** to update the results.")

tabs = st.tabs(["Overview", "City & zones", "Strategy comparison", "Statistics", "Scenarios", "Results & interpretation",
                "Method & assumptions"])

# ---- Overview
with tabs[0]:
    st.subheader("The problem")
    st.write("A demand hotspot does not automatically mean drivers should go there. A heatmap can send too many drivers "
             "to a busy zone if it ignores drivers already heading there or the uncertainty in the forecast, wasting "
             "empty kilometres and leaving other zones short. RideBalance asks, zone by zone, whether one more driver "
             "is worth the trip.")
    st.subheader("Five demand scenarios")
    for k, v in SCENARIO_LABELS.items():
        st.markdown(f"**{v}** — {SCEN_BLURB[k]}")
    st.subheader("How RideBalance decides (every decision window)")
    st.markdown(
        "1. Forecast demand for each zone for the next window.\n"
        "2. Count idle drivers per zone.\n"
        "3. Estimate how many en-route drivers will arrive in time.\n"
        "4. Effective supply = idle drivers + expected arrivals.\n"
        "5. Shortage risk = P(demand > effective supply), estimated by Monte-Carlo sampling.\n"
        "6. List feasible moves (within the maximum relocation distance, idle drivers only, one move per driver).\n"
        "7. Net benefit = expected service gain − relocation cost − oversupply penalty.\n"
        "8. Apply a move only if its net benefit is positive; repeat greedily, updating supply after each move.")
    if not errors:
        st.plotly_chart(demand_timeline(cached_preview(cfg.to_json())))
        st.caption("Preview of the synthetic demand generator for the current controls (expected values, before randomness).")
    if R is None:
        st.info("Set the controls in the sidebar and press **Run Simulation**.")

if R is None:
    for t in tabs[1:6]:
        with t:
            st.info("Run a simulation first.")
else:
    detail, batch = R["detail"], R["batch"]
    rcfg = SimConfig.from_dict(R["cfg"])
    city = cached_preview(rcfg.to_json()).city
    core_baselines = [s for s in CORE_STRATEGIES if s != "P"]
    summary = summarize(batch)
    core_summary = summary[summary.strategy.isin(CORE_STRATEGIES)]
    paired = paired_comparison(batch, "P", core_baselines)

    # ---- City & zones
    with tabs[1]:
        st.caption("Synthetic grid of abstract zones (not real streets). Arrows show recommended moves in this window; "
                   "not every driver accepts.")
        c1, c2, c3 = st.columns(3)
        skey = c1.selectbox("Strategy", CORE_STRATEGIES, index=3, format_func=label, key="city_strategy")
        res = detail[skey]
        nW = len(res.decisions)
        win = c2.slider("Decision window", 0, nW - 1, min(1, nW - 1), key="city_window")
        what = c3.selectbox("Colour by", ["Predicted demand", "Shortage risk", "Idle drivers", "Incoming drivers",
                                          "Effective supply"], key="city_what")
        d = res.decisions[win]
        vals = {"Predicted demand": d["forecast"], "Shortage risk": d["risk"], "Idle drivers": d["idle"],
                "Incoming drivers": d["incoming"], "Effective supply": d["eff_supply"]}[what]
        texts = [f"{city.ids[i]}<br>demand {d['forecast'][i]:.1f}<br>idle {d['idle'][i]} / in {d['incoming'][i]}"
                 f"<br>risk {d['risk'][i]:.0%}" for i in range(city.n_zones)]
        show = st.checkbox("Show recommended moves", value=True, key="city_moves")
        st.plotly_chart(zone_grid_figure(city, vals, texts,
                                         f"{label(skey)} — window {win} (t = {d['t']} min)",
                                         d["moves"] if show else None, colorbar_title=what))
        st.markdown("**Zone table**")
        st.dataframe(zone_table(res, win, city), hide_index=True)
        mv = window_moves_table(res, win, city)
        st.markdown("**Recommended moves this window**")
        if mv.empty:
            st.write("No moves recommended in this window.")
        else:
            st.dataframe(mv, hide_index=True)
        with st.expander("Where every driver is at decision time"):
            st.dataframe(driver_table(res, win, city), hide_index=True)
        st.plotly_chart(status_timeseries(res))

    # ---- Comparison
    with tabs[2]:
        st.subheader(f"One matched run (seed {rcfg.seed})")
        st.caption("Same scenario, fleet, demand draws and seed for all four strategies. 'simulation output' columns are "
                   "counted directly by the simulator; 'estimate' rows multiply simulated kilometres by the assumed cost.")
        tbl = single_run_table(detail)
        st.dataframe(tbl)
        cols = st.columns(2)
        for i, m in enumerate(["requests_served", "avg_wait_min", "empty_km_total", "idle_in_hot_zones_avg"]):
            cols[i % 2].plotly_chart(single_bar(detail, m))

    # ---- Statistics
    with tabs[3]:
        st.subheader(f"Repeated runs: {R['n_runs']} matched seeds ({rcfg.seed} … {rcfg.seed + R['n_runs'] - 1})")
        if R["n_runs"] < 2:
            st.warning("With a single run there are no confidence intervals or tests. Increase the number of runs.")
        st.markdown("**Mean [95% confidence interval]** — t-interval over runs.")
        st.dataframe(summary_table(summary))
        met = st.selectbox("Chart metric", list(METRIC_INFO)[1:], format_func=lambda m: METRIC_INFO[m][0],
                           index=2, key="stat_metric")
        st.plotly_chart(ci_bar(core_summary, met))
        st.markdown("**RideBalance minus each baseline (paired by seed)**")
        ptab = paired.copy()
        ptab["metric"] = ptab["metric"].map(lambda m: METRIC_INFO[m][0])
        ptab["vs"] = ptab["vs"].map(label)
        st.dataframe(ptab.rename(columns={"mean_diff": "mean diff", "ci_low": "CI low", "ci_high": "CI high",
                                          "effect_size_dz": "effect size d_z", "p_holm_primary": "p (Holm, primary)"}),
                     hide_index=True)
        st.caption("Test rule: n ≥ 8 → Shapiro–Wilk on the differences; if normality is rejected use Wilcoxon signed-rank, "
                   "otherwise a paired t-test. Smaller n uses a paired t-test with unchecked normality. Holm correction is "
                   "applied across the three baselines for the pre-specified primary metric (service rate) only; all "
                   "other rows are exploratory. Runs are independent seeds; strategies are paired within a seed.")
        if st.session_state["include_ablations"]:
            ab = paired_comparison(batch, "P", ABLATIONS, ["service_rate", "empty_km_total", "redundant_moves",
                                                          "idle_in_hot_zones_avg"])
            ab["metric"] = ab["metric"].map(lambda m: METRIC_INFO[m][0])
            ab["vs"] = ab["vs"].map(label)
            st.markdown("**Ablations: full RideBalance minus a reduced version**")
            st.dataframe(ab, hide_index=True)
        st.markdown("---")
        st.subheader("Shortage probability and demand uncertainty (single run)")
        skey2 = st.selectbox("Strategy state to inspect", CORE_STRATEGIES, index=3, format_func=label, key="unc_strat")
        res2 = detail[skey2]
        risk = mean_risk_by_zone(res2)
        txt = [f"{city.ids[i]}<br>{risk[i]:.0%}" for i in range(city.n_zones)]
        st.plotly_chart(zone_grid_figure(city, risk, txt, "Mean shortage probability over decision windows",
                                         colorbar_title="P(demand > supply)"))
        cz, cw = st.columns(2)
        zsel = cz.selectbox("Zone", list(range(city.n_zones)), format_func=lambda i: city.ids[i], key="unc_zone")
        wsel = cw.slider("Window", 0, len(res2.decisions) - 1, 1, key="unc_window")
        dd = res2.decisions[wsel]
        smp = uncertainty_samples(rcfg, res2, wsel, zsel)
        st.plotly_chart(uncertainty_hist(smp, float(dd["forecast"][zsel]), float(dd["actual"][zsel]),
                                         float(dd["eff_supply"][zsel]),
                                         f"{city.ids[zsel]}, window {wsel}: sampled demand vs effective supply"))
        st.caption(f"Shortage risk here = {100 * float(np.mean(smp > dd['eff_supply'][zsel])):.0f}% of sampled demand "
                   "draws exceed effective supply. Sampling model: Poisson with a log-normal forecast error.")

    # ---- Scenarios
    with tabs[4]:
        st.write("Runs no scenario, each scenario alone, and all five combined, with matched seeds, using the current "
                 "fleet and advanced parameters. This takes several seconds.")
        sev = st.slider("Severity used for every scenario in the sweep", 0.1, 2.0, 1.0, 0.1, key="sweep_sev")
        runs = st.slider("Runs per case", 3, 30, 10, key="sweep_runs")
        if st.button("Run scenario sweep"):
            with st.spinner("Running scenario sweep..."):
                st.session_state["sweep"] = dict(
                    cfg=rcfg.to_dict(),
                    df=cached_sweep(rcfg.to_json(), tuple(CORE_STRATEGIES), int(runs), float(sev)))
        sw = st.session_state.get("sweep")
        if sw is None:
            st.info("Press **Run scenario sweep**.")
        else:
            st.plotly_chart(sweep_figure(sw["df"]))
            agg = (sw["df"].groupby(["case", "strategy"])[["service_rate", "requests_unserved", "avg_wait_min",
                                                           "empty_km_total", "relocation_cost_est"]].mean().round(3))
            st.dataframe(agg)

    # ---- Results
    with tabs[5]:
        st.caption("Every sentence below is generated from the numbers in this session. If RideBalance does not win, "
                   "that is reported as it is.")
        for line in explain_results(core_summary, paired):
            st.markdown(line)
        sw = st.session_state.get("sweep")
        st.markdown("---")
        for line in explain_sweep(sw["df"] if sw else None):
            st.markdown(line)

# ---- Method
with tabs[6]:
    st.subheader("Strategies")
    st.markdown(
        "- **B0 — Stay put:** no repositioning.\n"
        "- **B1 — Demand-only heatmap:** shares the idle fleet in proportion to predicted demand; ignores cost, "
        "en-route drivers and uncertainty; picks source zones with the largest surplus, not the nearest.\n"
        "- **B2 — Cost-aware heatmap:** greedy moves using point forecasts; moves only if value of extra service minus "
        "empty-km cost is positive; ignores uncertainty, drivers already en route and oversupply.\n"
        "- **P — RideBalance:** effective supply (idle + probability-weighted arrivals), Monte-Carlo shortage "
        "probability, net benefit = service gain − relocation cost − oversupply penalty; greedy, positive-benefit moves only.")
    st.subheader("Probability model (assumption, not validated)")
    st.markdown("Demand in a zone for one window is Poisson with mean = forecast × a log-normal factor (mean 1, spread "
                "`forecast_sigma`). Shortage risk is P(D > S). Marginal service gain of one more driver is P(D > S); "
                "the oversupply penalty is the idle cost times the expected extra idle drivers it creates.")
    st.subheader("Parameters")
    st.table(pd.DataFrame(PARAM_DOCS, columns=["Parameter", "Meaning"]))
    st.subheader("Limitations")
    st.markdown("- Synthetic demand, drivers and scenario shapes; no real trip data are used.\n"
                "- Forecasts are the true expected demand plus random error (the forecaster 'knows' the scenario).\n"
                "- Grid distances, constant base speed, simple matching (nearest idle driver within a radius).\n"
                "- Driver acceptance is a parameter; RideBalance does not model it.\n"
                "- Cost/benefit values (INR) are assumptions. Results depend on them and on the chosen scenarios.\n"
                "- Statistical tests treat runs as independent seeds of the same synthetic model; "
                "they say nothing about real cities.")
