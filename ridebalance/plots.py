"""Plotly figures. Kept thin: all numbers come from the simulation modules."""
from __future__ import annotations

import numpy as np
import plotly.graph_objects as go

from .config import SCENARIO_LABELS
from .experiments import METRIC_INFO
from .reporting import label

PALETTE = {"B0": "#7f8c8d", "B1": "#e67e22", "B2": "#2980b9", "P": "#27ae60",
           "P_noEnroute": "#8e44ad", "P_noUncert": "#c0392b"}


def zone_grid_figure(city, values, texts, title, moves=None, colorbar_title="", colorscale="YlOrRd"):
    z = np.full((city.rows, city.cols), np.nan)
    txt = [[""] * city.cols for _ in range(city.rows)]
    for i, (r, c) in enumerate(city.rc):
        z[r, c] = values[i]
        txt[r][c] = texts[i]
    fig = go.Figure(go.Heatmap(z=z, text=txt, texttemplate="%{text}", colorscale=colorscale,
                               colorbar=dict(title=colorbar_title), hoverinfo="text", xgap=3, ygap=3))
    if moves:
        agg: dict = {}
        for m in moves:
            agg[(m.src, m.dst)] = agg.get((m.src, m.dst), 0) + 1
        for (s, d), n in agg.items():
            fig.add_annotation(x=float(city.rc[d][1]), y=float(city.rc[d][0]), ax=float(city.rc[s][1]),
                               ay=float(city.rc[s][0]), xref="x", yref="y", axref="x", ayref="y",
                               showarrow=True, arrowhead=3, arrowwidth=1 + min(n, 6) * 0.7, arrowcolor="#1f3b73")
    fig.update_yaxes(autorange="reversed", showticklabels=False, scaleanchor="x")
    fig.update_xaxes(showticklabels=False)
    fig.update_layout(title=title, height=460, margin=dict(l=10, r=10, t=50, b=10))
    return fig


def ci_bar(summary, metric, title=None):
    sub = summary[summary.metric == metric]
    fig = go.Figure()
    for _, r in sub.iterrows():
        err = None
        if not np.isnan(r.ci_low):
            err = dict(type="data", symmetric=False, array=[r.ci_high - r["mean"]], arrayminus=[r["mean"] - r.ci_low])
        fig.add_trace(go.Bar(x=[label(r.strategy)], y=[r["mean"]], name=label(r.strategy),
                             marker_color=PALETTE.get(r.strategy), error_y=err, showlegend=False))
    fig.update_layout(title=title or f"{METRIC_INFO[metric][0]} — mean with 95% CI", height=340,
                      margin=dict(l=10, r=10, t=50, b=10))
    return fig


def single_bar(results: dict, metric, title=None):
    fig = go.Figure(go.Bar(x=[label(k) for k in results], y=[r.metrics[metric] for r in results.values()],
                           marker_color=[PALETTE.get(k) for k in results]))
    fig.update_layout(title=title or METRIC_INFO[metric][0], height=320, margin=dict(l=10, r=10, t=50, b=10))
    return fig


def sweep_figure(sweep, metric="service_rate"):
    names = {"none": "No scenario", "all": "All combined", **{k: v.split(" /")[0].split(",")[0] for k, v in SCENARIO_LABELS.items()}}
    g = sweep.groupby(["case", "strategy"])[metric].agg(["mean", "std", "count"]).reset_index()
    fig = go.Figure()
    for strat in g.strategy.unique():
        s = g[g.strategy == strat]
        half = 1.96 * s["std"].fillna(0) / np.sqrt(s["count"])   # normal approx for display only
        fig.add_trace(go.Bar(x=[names[c] for c in s.case], y=s["mean"], name=label(strat),
                             marker_color=PALETTE.get(strat), error_y=dict(type="data", array=half)))
    fig.update_layout(barmode="group", title=f"{METRIC_INFO[metric][0]} by scenario (error bars: ~95% normal approx.)",
                      height=420, margin=dict(l=10, r=10, t=50, b=10))
    return fig


def demand_timeline(real):
    t = np.arange(real.rate.shape[0])
    fig = go.Figure()
    fig.add_trace(go.Scatter(x=t, y=real.rate.sum(1), name="All zones", mode="lines"))
    hot = int(np.argmax(real.rate.max(0)))
    fig.add_trace(go.Scatter(x=t, y=real.rate[:, hot], name=f"Busiest zone ({real.city.ids[hot]})", mode="lines"))
    fig.update_layout(title="Expected requests per minute (synthetic generator)", xaxis_title="minute",
                      yaxis_title="requests / min", height=320, margin=dict(l=10, r=10, t=50, b=10))
    return fig


def status_timeseries(res):
    ts = res.timeseries
    fig = go.Figure()
    for col, nm, colr in [("idle", "Idle", "#95a5a6"), ("transit", "Repositioning", "#f39c12"), ("serving", "Serving", "#27ae60")]:
        fig.add_trace(go.Scatter(x=ts.minute, y=ts[col], name=nm, stackgroup="one", line=dict(color=colr)))
    fig.update_layout(title=f"Driver status over time — {label(res.strategy)}", xaxis_title="minute",
                      yaxis_title="drivers", height=320, margin=dict(l=10, r=10, t=50, b=10))
    return fig


def uncertainty_hist(samples, forecast, actual, supply, title):
    fig = go.Figure(go.Histogram(x=samples, nbinsx=30, marker_color="#2980b9", opacity=0.8, name="sampled demand"))
    fig.add_vline(x=forecast, line_dash="dash", annotation_text="forecast")
    fig.add_vline(x=actual, line_color="#c0392b", annotation_text="actual", annotation_position="top left")
    fig.add_vline(x=supply, line_color="#27ae60", annotation_text="effective supply", annotation_position="bottom right")
    fig.update_layout(title=title, xaxis_title="requests in window", yaxis_title="samples", height=340,
                      margin=dict(l=10, r=10, t=50, b=10), showlegend=False)
    return fig
