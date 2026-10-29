// Shared types mirroring the Python API responses

export interface ZoneInfo {
  id: string;
  idx: number;
  role: string;
  row: number;
  col: number;
  base_weight: number;
}

export interface CityInfo {
  n_zones: number;
  rows: number;
  cols: number;
  ids: string[];
  roles: Record<string, number[]>;
  role_of: string[];
  rc: [number, number][];
  base_weight: number[];
  dist_cells: number[][];
}

export interface MoveInfo {
  driver: number;
  src: number;
  src_id: string;
  dst: number;
  dst_id: string;
  dist_km: number;
  accepted: boolean;
  net_benefit: number | null;
  service_gain: number | null;
  reloc_cost: number | null;
  oversupply_penalty: number | null;
}

export interface DecisionWindow {
  window: number;
  t: number;
  forecast: (number | null)[];
  actual: (number | null)[];
  idle: number[];
  incoming: number[];
  eff_supply: (number | null)[];
  risk: (number | null)[];
  moves_in: number[];
  moves_out: number[];
  moves: MoveInfo[];
}

export interface Metrics {
  requests_generated: number;
  requests_served: number;
  requests_unserved: number;
  unserved_abandoned: number;
  unserved_waiting_at_end: number;
  service_rate: number | null;
  avg_wait_min: number | null;
  empty_km_pickup: number;
  empty_km_reposition: number;
  empty_km_total: number;
  moves_recommended: number;
  moves_made: number;
  redundant_moves: number;
  idle_in_hot_zones_avg: number | null;
  relocation_cost_est: number;
  empty_cost_est: number;
  served_per_empty_km: number | null;
}

export interface StrategyResult {
  strategy: string;
  label: string;
  metrics: Metrics;
  decisions: DecisionWindow[];
}

export interface SummaryRow {
  strategy: string;
  metric: string;
  n: number;
  mean: number | null;
  ci_low: number | null;
  ci_high: number | null;
  sd: number | null;
}

export interface PairedRow {
  metric: string;
  vs: string;
  n: number;
  mean_diff: number | null;
  ci_low: number | null;
  ci_high: number | null;
  effect_size_dz: number | null;
  test: string;
  p: number | null;
  p_holm_primary: number | null;
}

export interface SimulationResult {
  mode: 'single' | 'batch';
  seed: number;
  n_runs: number;
  city: CityInfo;
  strategies: Record<string, StrategyResult>;
  summary?: SummaryRow[];
  paired?: PairedRow[];
  explanation?: string[];
}

export interface SweepScenarioEntry {
  case: string;
  label: string;
  strategies: Record<string, {
    service_rate_mean: number | null;
    service_rate_ci_low: number | null;
    service_rate_ci_high: number | null;
    avg_wait_mean: number | null;
    avg_wait_ci_low: number | null;
    avg_wait_ci_high: number | null;
    n: number;
  }>;
}

export interface SweepResult {
  cases: SweepScenarioEntry[];
  scenario_names: Record<string, string>;
  explanation: string[];
}

export interface ConfigDefaults {
  defaults: Record<string, unknown>;
  strategies: Record<string, string>;
  core_strategies: string[];
  scenarios: Record<string, string>;
  sweep_cases: string[];
  metric_info: Record<string, { label: string; higher_is_better: boolean | null; kind: string }>;
}

// ── API request shapes ─────────────────────────────────────────────────────
export interface SimRequest {
  n_zones?: number;
  n_drivers?: number;
  duration_min?: number;
  decision_interval?: number;
  demand_intensity?: number;
  seed?: number;
  scenarios?: { name: string; severity: number }[];
  combine_mode?: string;
  strategies?: string[];
  n_runs?: number;
}

export interface SweepRequest {
  n_zones?: number;
  n_drivers?: number;
  duration_min?: number;
  decision_interval?: number;
  demand_intensity?: number;
  seed?: number;
  n_runs?: number;
  severity?: number;
  strategies?: string[];
}

// Strategy color map
export const STRATEGY_COLORS: Record<string, string> = {
  B0: '#64748b',
  B1: '#f59e0b',
  B2: '#3b82f6',
  P: '#10b981',
};

export const STRATEGY_LABELS: Record<string, string> = {
  B0: 'B0 — Stay Put',
  B1: 'B1 — Demand-Only Heatmap',
  B2: 'B2 — Cost-Aware Heatmap',
  P: 'P — RideBalance',
};

export const ROLE_COLORS: Record<string, string> = {
  business: '#3b82f6',
  station: '#f59e0b',
  school: '#a78bfa',
  stadium: '#ef4444',
  residential: '#64748b',
};
