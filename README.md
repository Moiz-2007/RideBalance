# RideBalance — risk-aware ride-hailing demand–supply balancing (prototype)

A Streamlit + Python **simulation** for a Probability & Statistics project. It estimates demand across
city zones, counts idle and en-route drivers, recommends driver moves, and compares four allocation
strategies on identical simulated conditions.

> **This is a synthetic simulation prototype, not a live Ola/Uber integration.** All demand, driver
> positions, travel times and scenarios are modelling assumptions. Nothing the app shows is real-world
> evidence about any city or platform.

## Quick start

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
streamlit run app.py
```

Optional tests (no Streamlit needed for the engine tests):

```bash
python -m tests.run_tests          # built-in runner, no extra packages
pip install pytest && pytest       # same tests under pytest (+ Streamlit AppTest smoke tests)
```

## Deploy on Streamlit Community Cloud

1. Create a GitHub repository and push this folder (`app.py`, `ridebalance/`, `requirements.txt`, `tests/`, `README.md`).
   ```bash
   git init && git add . && git commit -m "RideBalance prototype"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
2. Go to <https://share.streamlit.io>, sign in with GitHub and choose **Create app**.
3. Select the repository, branch `main`, and main file path `app.py`.
4. Under *Advanced settings* pick Python 3.11 or 3.12, then **Deploy**.
5. No secrets, API keys, databases or logins are needed. Dependencies come from `requirements.txt`.

## Project layout

| Path | Purpose |
|---|---|
| `app.py` | Streamlit UI (sidebar controls, tabs, Run/Reset, caching) |
| `ridebalance/config.py` | `SimConfig`, scenario parameters, validation, parameter docs |
| `ridebalance/city.py` | Synthetic grid, zone IDs, roles, distances |
| `ridebalance/demand.py` | Scenario demand generator and the pre-drawn `Realization` |
| `ridebalance/shortage.py` | Demand probability model, shortage risk, arrival probability |
| `ridebalance/strategies.py` | B0, B1, B2, P (RideBalance) and two ablations |
| `ridebalance/simulator.py` | Minute-by-minute driver/request simulator and metrics |
| `ridebalance/experiments.py` | Repeated runs, scenario sweep, CIs, paired tests |
| `ridebalance/reporting.py` | Tables and data-generated explanations |
| `ridebalance/plots.py` | Plotly figures |
| `tests/` | Engine tests (demand, accounting, feasibility, metrics, statistics) |

## The five scenarios (all synthetic)

1. **School / college dismissal** — Gaussian-in-time surge at a school zone, a share of it in adjacent zones.
2. **Office commute peaks** — broad peak; residential zones in the morning, business zones in the evening.
3. **Sports, concerts, festivals** — dispersal surge at the stadium zone (or a mild pre-event build-up in *arrival* mode).
4. **Rain** — more requests everywhere from a start time, and slower travel (speed multiplier ≥ 0.4).
5. **Public-transport disruption** — ramped surge at a station zone and its neighbours.

Each has a severity (0–2). Selecting several overlaps them. Effects combine **multiplicatively**
(product of `1 + effect`) or **additively** (`1 + sum of effects`), capped at 12× the baseline.
All shape parameters live in `ScenarioParams` (`config.py`).

## Strategies

| Key | Strategy | What it uses | What it ignores |
|---|---|---|---|
| B0 | Stay put | nothing | everything |
| B1 | Demand-only heatmap | forecast demand shares; fleet and movement limits | cost, en-route drivers, uncertainty; picks sources by largest surplus (not nearest) |
| B2 | Cost-aware heatmap | point forecast, idle supply, empty-km cost; counts moves it issues this window | uncertainty, en-route drivers from earlier windows, oversupply |
| P | RideBalance | forecast uncertainty, effective supply (idle + expected arrivals), shortage risk, relocation cost, oversupply penalty | driver acceptance behaviour |

All strategies may only move **idle** drivers, once each, within `max_move_cells`, and at most
`max_move_fraction` of the idle fleet per decision window. The simulator raises an error if a strategy
violates this.

## RideBalance decision rule

At every decision window, for each zone *z*:

1. Forecast demand `f_z` for the window (the strategy sees the true expected demand times a log-normal error).
2. Idle drivers `I_z`.
3. Each en-route driver contributes the probability it arrives before the deadline
   (`arrival_deadline_frac` × window); remaining time is log-normal with mean = ETA and CV `travel_time_cv`.
4. Effective supply `S_z = I_z + Σ arrival probabilities`.
5. Demand model: `D_z ~ Poisson(f_z × L)`, `L` log-normal with mean 1 and sigma `forecast_sigma`;
   estimated by `mc_samples` Monte-Carlo draws. Shortage risk `P(D_z > S_z)`.
6. Candidate move `a → b` (feasible, idle driver available in `a`), with `p` = probability the mover arrives in time:
   - service gain = `V · [ E min(D_b, S_b+p) − E min(D_b, S_b)  −  ( E min(D_a, S_a) − E min(D_a, S_a−1) ) ]`
   - oversupply penalty = `c_idle · [ p − (E min(D_b, S_b+p) − E min(D_b, S_b)) ]` (expected extra idle at `b`)
   - relocation cost = `c_km · km(a,b)`
   - net benefit = service gain − relocation cost − oversupply penalty
7. Apply the best move only if its net benefit is **positive**, update `S`, repeat until none remain or the cap is hit.

The identities used: the marginal service gain of one more driver is `P(D > S)`, and expected idle drivers are
`S − E min(D, S)`. For fractional `S`, `E min(D, S)` is linearly interpolated.

**Documented, configurable weights** (defaults are assumptions, not estimates): `V = 150 INR` per served request,
`c_km = 8 INR` per empty km, `c_idle = 20 INR` per idle driver per window. The origin-side idle saving is deliberately
not credited (conservative). The Poisson–log-normal model is an **unvalidated simplification**.

## Simulation rules

* Time step 1 minute. Statuses: idle, in transit (repositioning), serving. Counts always sum to the fleet size (asserted every minute).
* A request goes to the nearest idle driver within `max_pickup_cells` (ties: lowest ID); otherwise it waits up to `max_wait_min` minutes, then is unserved. Requests still queued at the end count as unserved.
* "Served" means a driver was assigned (the trip may finish after the window).
* Passenger wait = queue time + pickup travel time. Same-zone pickups assume `intra_zone_pickup_km`.
* A driver follows a recommendation with probability `acceptance_prob` (pre-drawn, so identical across strategies).
* **Matching:** all randomness (requests, forecast errors, initial drivers, acceptance, travel noise) is drawn once per seed
  and reused by every strategy.

## Metrics

Direct simulation outputs: requests generated/served/unserved, service rate, average wait, empty km (pickup and repositioning),
moves recommended/made, idle drivers in high-demand zones (time-average count of idle drivers in zones whose expected demand is
in the top quartile that minute), and **redundant moves** (post-hoc: a move into a zone that ended the window with more
drivers — idle + en route + arriving — than actual requests). **Estimates**: relocation cost = repositioning km × `c_km`
(an assumption, labelled as an estimate in the app).

## Statistics

* Repeated runs use seeds `seed … seed+n−1`; each seed gives all strategies the same world.
* Mean and 95% confidence interval: t-interval over runs (needs ≥ 2 runs).
* RideBalance vs each baseline: paired differences by seed, mean difference with 95% CI, effect size `d_z`.
  For n ≥ 8 a Shapiro–Wilk test on the differences chooses Wilcoxon signed-rank (if normality is rejected) or the paired t-test;
  for n < 8 a paired t-test is used with normality unchecked; with n < 3 no p-value is reported.
* Holm correction across the three baselines for the **pre-specified primary metric (service rate)** only. Every other row is exploratory.
* Optional ablations remove en-route supply or uncertainty from RideBalance.
* The *Results & interpretation* tab is generated from the numbers; it reports baseline wins and null results as they are.
  Runs are independent seeds of one synthetic model, so tests say nothing about real cities.

## Limitations

* Synthetic everything: no real trip data. The proposal mentions NYC TLC / DiDi data; this prototype does not use them.
* The forecaster is given the true expected demand (including scenarios) plus noise, rather than being a trained model.
* Grid distances, constant base speed, simple nearest-driver matching, no surge pricing, no rider cancellations other than timeouts.
* RideBalance does not model driver acceptance; acceptance is a simulation parameter.
* Cost/benefit values are assumptions; conclusions depend on them, on fleet size, demand intensity and scenario severities.
* With defaults the differences between strategies can be small, and the fleet may be the bottleneck (when every strategy
  serves a low share, moving drivers cannot create capacity). Report what the app shows, including null results.

## Tested vs not tested

Tested by the included tests (all pass in the authoring environment): demand generation and reproducibility, scenario effects,
scenario overlap, driver accounting every minute, in-transit tracking, movement feasibility, hand-computed metrics, strategy
differences, en-route supply handling, statistics helpers.
The Streamlit UI could not be run in the authoring sandbox (no network to install Streamlit/Plotly); see the notes delivered with this project.
