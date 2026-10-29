import React from 'react';
import { SectionHeading, Note } from '../components/ui';

export default function Methodology() {
  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <SectionHeading sub="How the RideBalance simulation works — source of truth is the Python code in ridebalance/.">
        Method &amp; Assumptions
      </SectionHeading>

      <div className="card p-5">
        <h3 className="font-semibold text-text-primary mb-2">1. Synthetic City &amp; Zones</h3>
        <div className="text-sm text-text-secondary flex flex-col gap-2">
          <p>The city is an abstract grid — not a real place. With 16 zones, it forms a 4×4 grid (Z00–Z15). Zone layout is computed by <code className="bg-surface-200 px-1 rounded text-xs text-accent">ridebalance/city.py</code>.</p>
          <p><strong className="text-text-primary">Zone roles</strong> are assigned deterministically from the grid centre outward:</p>
          <ul className="list-disc pl-5 flex flex-col gap-1 text-xs">
            <li><strong className="text-blue-400">Business</strong> (1 or 2 zones) — city centre; base demand weight 1.4×</li>
            <li><strong className="text-amber-400">Station</strong> (1 zone) — transport hub near centre; weight 1.3×</li>
            <li><strong className="text-purple-400">School</strong> (1 zone) — far from centre; weight 0.9×</li>
            <li><strong className="text-red-400">Stadium</strong> (1 zone) — far from school; weight 0.7×</li>
            <li><strong className="text-slate-400">Residential</strong> — remaining zones; weight 1.0×</li>
          </ul>
          <p>Base weights are normalised to mean 1, so <code className="bg-surface-200 px-1 rounded text-xs text-accent">demand_intensity</code> is the average requests per zone per minute.</p>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="font-semibold text-text-primary mb-2">2. Demand Generation</h3>
        <div className="text-sm text-text-secondary flex flex-col gap-2">
          <p>Demand is synthetic (Poisson). For each minute <em>t</em> and zone <em>z</em>:</p>
          <pre className="bg-surface-200 rounded p-3 text-xs text-accent overflow-x-auto">
{`rate[t,z] = demand_intensity × base_weight[z] × scenario_multiplier[t,z]
shock[w,z] ~ LogNormal(mean=1, sigma=demand_shock_sigma)
requests[t,z] ~ Poisson(rate[t,z] × shock[window_of_t, z])`}
          </pre>
          <p>Scenarios add a time-varying multiplier:</p>
          <ul className="list-disc pl-5 flex flex-col gap-1 text-xs">
            <li><strong>School dismissal</strong>: Gaussian pulse at t=50% of run, amplitude 4× at severity 1</li>
            <li><strong>Office commute</strong>: pulse at 40%, affecting residential (morning) or business (evening)</li>
            <li><strong>Event dispersal</strong>: sharp pulse at 60%, amplitude 6× at stadium zone</li>
            <li><strong>Rain</strong>: ramp from t=25%, +35% demand everywhere, −30% speed at severity 1</li>
            <li><strong>Transit disruption</strong>: ramp from t=20%, 3× demand at station zone</li>
          </ul>
          <p>Multiple scenarios are combined multiplicatively by default (product of 1+delta), capped at <code className="bg-surface-200 px-1 rounded text-xs text-accent">max_multiplier</code> (12×).</p>
          <p><strong className="text-text-primary">Forecast error</strong>: strategies see a log-normal-perturbed forecast (<code className="bg-surface-200 px-1 rounded text-xs text-accent">forecast_sigma=0.20</code>).</p>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="font-semibold text-text-primary mb-2">3. Strategy Logic</h3>
        <div className="text-sm text-text-secondary flex flex-col gap-6">
          <div>
            <p className="font-medium text-text-primary mb-1">B0 — Stay Put</p>
            <p>No repositioning. Drivers remain where they finished their last trip. This is the pure baseline: zero repositioning cost, zero relocation benefit.</p>
          </div>
          <div>
            <p className="font-medium text-text-primary mb-1">B1 — Demand-Only Heatmap</p>
            <p>Allocates the idle fleet proportionally to predicted demand per zone: <code className="bg-surface-200 px-1 rounded text-xs text-accent">target[z] = floor(forecast[z] / sum(forecast) × idle_total)</code>. Sources zones with the largest surplus drive to zones with the largest deficit. Does not account for travel cost, en-route drivers, or demand uncertainty.</p>
          </div>
          <div>
            <p className="font-medium text-text-primary mb-1">B2 — Cost-Aware Heatmap</p>
            <p>Greedy moves using a point-forecast marginal value: <code className="bg-surface-200 px-1 rounded text-xs text-accent">net = V × (gain at dst − loss at src) − reloc_cost_per_km × distance</code>. Moves while net &gt; 0. No en-route supply accounting or uncertainty.</p>
          </div>
          <div>
            <p className="font-medium text-text-primary mb-1">P — RideBalance</p>
            <p>Accounts for effective supply, demand uncertainty, and expected idle penalty:</p>
            <pre className="bg-surface-200 rounded p-3 text-xs text-accent overflow-x-auto">
{`eff_supply[z] = idle[z] + Σ P(en-route driver arrives before deadline)
P(arrive) = P(η × X ≤ deadline), X ~ LogNormal(mean=1, cv=travel_time_cv)

D[z] ~ Poisson(forecast[z] × LogNormal(1, forecast_sigma))  [Monte-Carlo]
shortage_risk[z] = P(D[z] > eff_supply[z])

service_gain = V × [E_served(dst; +p) − E_served(src; −1)]
penalty = idle_cost × [p − E_served(dst; +p)]   (oversupply at dst)
net = service_gain − reloc_cost_per_km × km − penalty
Move while net > 0, update S greedily.`}
            </pre>
          </div>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="font-semibold text-text-primary mb-2">4. Simulation Rules</h3>
        <div className="text-sm text-text-secondary flex flex-col gap-2">
          <p>The simulator runs minute-by-minute (<code className="bg-surface-200 px-1 rounded text-xs text-accent">ridebalance/simulator.py</code>). Drivers have three states:</p>
          <ul className="list-disc pl-5 flex flex-col gap-1 text-xs">
            <li><strong className="text-text-primary">IDLE</strong>: waiting in a zone, available for pickup or repositioning</li>
            <li><strong className="text-text-primary">TRANSIT</strong>: repositioning (empty, not available)</li>
            <li><strong className="text-text-primary">SERVING</strong>: driving to pickup and carrying rider</li>
          </ul>
          <p className="mt-1">Key parameters:</p>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs mt-1">
            {[
              ['decision_interval', '15 min — how often strategies decide'],
              ['max_pickup_cells', '1 — max distance to match driver to rider'],
              ['max_wait_min', '8 min — request timeout before "unserved"'],
              ['max_move_cells', '3 — max repositioning distance'],
              ['max_move_fraction', '0.35 — max fraction of idle fleet moved per window'],
              ['acceptance_prob', '0.90 — probability a driver follows the recommendation'],
              ['km_per_cell', '1.5 km — distance between adjacent zone centres'],
              ['base_speed_kmph', '24 km/h — free-flow speed (reduced by rain)'],
            ].map(([k, v]) => (
              <React.Fragment key={k}>
                <code className="text-accent text-xs">{k}</code>
                <span className="text-text-muted">{v}</span>
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>

      <div className="card p-5">
        <h3 className="font-semibold text-text-primary mb-2">5. Statistics &amp; Inference</h3>
        <div className="text-sm text-text-secondary flex flex-col gap-2">
          <p>Repeated runs use <strong className="text-text-primary">matched seeds</strong>: all four strategies run on the same demand realization per seed (seeds cfg.seed, cfg.seed+1, …). This eliminates demand randomness as a confounder.</p>
          <ul className="list-disc pl-5 flex flex-col gap-1 text-xs">
            <li><strong>95% CIs</strong>: t-distribution, <code className="bg-surface-200 px-1 rounded text-xs text-accent">mean ± t(n−1, 0.975) × sd/√n</code></li>
            <li><strong>Paired test</strong>: Shapiro-Wilk normality on differences (n ≥ 8); if p &lt; 0.05 → Wilcoxon signed-rank; else paired t-test</li>
            <li><strong>Holm correction</strong>: applied across baselines for the primary metric (service rate) only; other metrics are exploratory</li>
            <li><strong>Effect size</strong>: Cohen's d_z = mean(d)/sd(d), d = P − baseline per seed</li>
          </ul>
        </div>
      </div>

      <div className="card p-5 border-amber-800/30">
        <h3 className="font-semibold text-amber-400 mb-2">6. Assumptions &amp; Limitations</h3>
        <div className="text-sm text-text-secondary flex flex-col gap-2">
          <ul className="list-disc pl-5 flex flex-col gap-2 text-xs">
            <li><strong className="text-text-primary">No real data.</strong> All demand, zones, and scenarios are entirely synthetic. Results cannot be directly applied to real Ola/Uber operations.</li>
            <li><strong className="text-text-primary">Driver acceptance is a parameter.</strong> <code className="bg-surface-200 px-1 rounded text-xs text-accent">acceptance_prob = 0.90</code> is an assumption, not a measured value.</li>
            <li><strong className="text-text-primary">Cost estimates are assumptions.</strong> ₹150/request and ₹8/km are modelling inputs, not tariff data.</li>
            <li><strong className="text-text-primary">Abstract geography.</strong> Manhattan-distance travel times on a grid underestimate real city travel complexity.</li>
            <li><strong className="text-text-primary">No surge pricing.</strong> Demand is inelastic to supply; the model doesn't simulate price responses.</li>
            <li><strong className="text-text-primary">Decisions every 15 minutes.</strong> Real platforms reposition continuously; the discrete window is a simplification.</li>
            <li><strong className="text-text-primary">Variance explanation.</strong> With a small fleet on a small synthetic grid, the gap between strategies may be narrow. This is expected and noted in the interpretation.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
