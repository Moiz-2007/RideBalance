import React from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
  ErrorBar,
} from 'recharts';
import type { SimulationResult, DecisionWindow, CityInfo } from '../types';
import { STRATEGY_COLORS, STRATEGY_LABELS, ROLE_COLORS } from '../types';
import { SectionHeading } from './ui';

// ── Chart 1: Demand & Effective Supply Over Simulation Time ──────────────────

interface DemandSupplyTimelineProps {
  decisions: DecisionWindow[];
  strategyName?: string;
}

export function DemandSupplyTimeline({ decisions, strategyName = 'P' }: DemandSupplyTimelineProps) {
  if (!decisions || decisions.length === 0) {
    return (
      <div className="card p-4 text-center text-xs text-text-muted">
        No decision window time-series available.
      </div>
    );
  }

  const timelineData = decisions.map((d) => {
    const totalActual = d.actual.reduce<number>((acc, v) => acc + (v ?? 0), 0);
    const totalForecast = d.forecast.reduce<number>((acc, v) => acc + (v ?? 0), 0);
    const totalEffSupply = d.eff_supply.reduce<number>((acc, v) => acc + (v ?? 0), 0);
    const totalIdle = d.idle.reduce<number>((acc, v) => acc + v, 0);
    const totalIncoming = d.incoming.reduce<number>((acc, v) => acc + v, 0);

    return {
      time: `${d.t}m`,
      minute: d.t,
      window: `W${d.window}`,
      'Actual Demand': Number(totalActual.toFixed(1)),
      'Predicted Demand': Number(totalForecast.toFixed(1)),
      'Effective Supply': Number(totalEffSupply.toFixed(1)),
      'Idle Drivers': totalIdle,
      'Incoming Drivers': totalIncoming,
    };
  });

  return (
    <div className="card p-4">
      <SectionHeading
        sub={`Total system-wide demand vs effective supply across 15-min decision windows for strategy ${STRATEGY_LABELS[strategyName] ?? strategyName}. Units: requests / driver supply units.`}
      >
        Demand and Effective Supply Over Simulation Time
      </SectionHeading>

      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={timelineData} margin={{ top: 12, right: 24, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a3347" />
          <XAxis
            dataKey="time"
            tick={{ fill: '#8892a4', fontSize: 11 }}
            label={{ value: 'Simulation Time (min)', position: 'insideBottom', offset: -4, fill: '#64748b', fontSize: 11 }}
          />
          <YAxis
            tick={{ fill: '#8892a4', fontSize: 11 }}
            label={{ value: 'Fleet / Request Count', angle: -90, position: 'insideLeft', offset: 8, fill: '#64748b', fontSize: 11 }}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#161b25', border: '1px solid #2a3347', borderRadius: 6 }}
            labelStyle={{ color: '#e8ecf4', fontSize: 12, fontWeight: 600 }}
            formatter={(value: any, name: any) => [`${value} units`, name]}
          />
          <Legend
            wrapperStyle={{ paddingTop: 14, fontSize: 11 }}
            formatter={(val) => <span style={{ color: '#cbd5e1' }}>{val}</span>}
          />
          <Line
            type="monotone"
            dataKey="Actual Demand"
            stroke="#f59e0b"
            strokeWidth={2}
            dot={{ r: 3 }}
            name="Actual Demand"
          />
          <Line
            type="monotone"
            dataKey="Predicted Demand"
            stroke="#a78bfa"
            strokeWidth={2}
            strokeDasharray="4 4"
            dot={{ r: 2 }}
            name="Predicted Demand"
          />
          <Line
            type="monotone"
            dataKey="Effective Supply"
            stroke="#10b981"
            strokeWidth={2.5}
            dot={{ r: 4 }}
            name="Effective Supply"
          />
          <Line
            type="monotone"
            dataKey="Idle Drivers"
            stroke="#38bdf8"
            strokeWidth={1.5}
            strokeDasharray="2 2"
            dot={false}
            name="Idle Drivers"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Chart 2: Predicted Demand & Shortage Risk by Zone ────────────────────────

interface ZoneDemandRiskChartProps {
  city: CityInfo;
  decision: DecisionWindow | null;
  windowIndex: number;
}

export function ZoneDemandRiskChart({ city, decision, windowIndex }: ZoneDemandRiskChartProps) {
  if (!decision) {
    return (
      <div className="card p-4 text-center text-xs text-text-muted">
        No decision data for window {windowIndex}.
      </div>
    );
  }

  const zoneData = city.ids.map((id, idx) => {
    const forecast = decision.forecast[idx] ?? 0;
    const actual = decision.actual[idx] ?? 0;
    const risk = (decision.risk[idx] ?? 0) * 100;
    const effSupply = decision.eff_supply[idx] ?? 0;
    const role = city.role_of[idx];

    return {
      zone: id,
      role,
      roleColor: ROLE_COLORS[role] ?? '#64748b',
      'Predicted Demand (req)': Number(forecast.toFixed(1)),
      'Actual Demand (req)': actual,
      'Effective Supply': Number(effSupply.toFixed(1)),
      'Shortage Risk (%)': Number(risk.toFixed(1)),
    };
  });

  return (
    <div className="card p-4">
      <SectionHeading
        sub={`Zone-level metrics for Window ${windowIndex} (t=${decision.t}–${decision.t + 15} min). Left axis: demand requests; Right axis: shortage risk percentage (independent axes to prevent misleading scale distortion).`}
      >
        Predicted Demand and Shortage Risk by Zone
      </SectionHeading>

      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={zoneData} margin={{ top: 12, right: 30, left: 10, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a3347" />
          <XAxis
            dataKey="zone"
            tick={{ fill: '#8892a4', fontSize: 10, fontFamily: 'monospace' }}
            label={{ value: 'Synthetic Zones (Z00–Z15)', position: 'insideBottom', offset: -10, fill: '#64748b', fontSize: 11 }}
          />
          <YAxis
            yAxisId="left"
            tick={{ fill: '#8892a4', fontSize: 11 }}
            label={{ value: 'Predicted Demand (requests)', angle: -90, position: 'insideLeft', offset: 6, fill: '#38bdf8', fontSize: 10 }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            domain={[0, 100]}
            tick={{ fill: '#8892a4', fontSize: 11 }}
            tickFormatter={(v) => `${v}%`}
            label={{ value: 'Shortage Risk (%)', angle: 90, position: 'insideRight', offset: 10, fill: '#ef4444', fontSize: 10 }}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#161b25', border: '1px solid #2a3347', borderRadius: 6 }}
            labelStyle={{ color: '#e8ecf4', fontSize: 12, fontWeight: 700 }}
            formatter={(value: any, name: any) => {
              if (name === 'Shortage Risk (%)') return [`${value}%`, name];
              if (name === 'Predicted Demand (req)') return [`${value} req`, name];
              if (name === 'Effective Supply') return [`${value} drivers`, name];
              return [value, name];
            }}
          />
          <Legend
            wrapperStyle={{ paddingTop: 14, fontSize: 11 }}
            formatter={(val) => <span style={{ color: '#cbd5e1' }}>{val}</span>}
          />
          <Bar
            yAxisId="left"
            dataKey="Predicted Demand (req)"
            fill="#3b82f6"
            opacity={0.85}
            radius={[3, 3, 0, 0]}
          />
          <Bar
            yAxisId="left"
            dataKey="Effective Supply"
            fill="#10b981"
            opacity={0.7}
            radius={[3, 3, 0, 0]}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="Shortage Risk (%)"
            stroke="#ef4444"
            strokeWidth={2.5}
            dot={{ r: 3, fill: '#ef4444' }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Chart 3: Service Rate & Average Wait Across Strategies ───────────────────

interface ServiceWaitComparisonProps {
  result: SimulationResult;
}

export function ServiceWaitComparison({ result }: ServiceWaitComparisonProps) {
  const strategies = Object.keys(result.strategies);

  const getMetric = (s: string, metric: string): number => {
    if (result.mode === 'batch' && result.summary) {
      const row = result.summary.find((r) => r.strategy === s && r.metric === metric);
      if (row && row.mean !== null) return row.mean;
    }
    return (result.strategies[s]?.metrics[metric] as number) ?? 0;
  };

  const chartData = strategies.map((s) => ({
    strategy: s,
    label: s,
    fullName: STRATEGY_LABELS[s] ?? s,
    'Service Rate (%)': Number((getMetric(s, 'service_rate') * 100).toFixed(1)),
    'Avg Wait (min)': Number(getMetric(s, 'avg_wait_min').toFixed(2)),
  }));

  return (
    <div className="card p-4">
      <SectionHeading
        sub="Comparing customer experience metrics across B0, B1, B2, and P. Left Y-axis: Service Rate (% served); Right Y-axis: Average Wait (minutes for served rides). Separate axes preserve genuine unit scales."
      >
        Service Rate and Average Wait Across Strategies
      </SectionHeading>

      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={chartData} margin={{ top: 12, right: 30, left: 10, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a3347" />
          <XAxis dataKey="label" tick={{ fill: '#8892a4', fontSize: 11 }} />
          <YAxis
            yAxisId="left"
            domain={[0, 100]}
            tick={{ fill: '#8892a4', fontSize: 11 }}
            tickFormatter={(v) => `${v}%`}
            label={{ value: 'Service Rate (%)', angle: -90, position: 'insideLeft', offset: 6, fill: '#10b981', fontSize: 11 }}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fill: '#8892a4', fontSize: 11 }}
            tickFormatter={(v) => `${v}m`}
            label={{ value: 'Average Wait (min)', angle: 90, position: 'insideRight', offset: 12, fill: '#f59e0b', fontSize: 11 }}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#161b25', border: '1px solid #2a3347', borderRadius: 6 }}
            formatter={(value: any, name: any) => {
              if (name === 'Service Rate (%)') return [`${value}%`, name];
              if (name === 'Avg Wait (min)') return [`${value} min`, name];
              return [value, name];
            }}
            labelFormatter={(lbl) => STRATEGY_LABELS[lbl as string] ?? lbl}
          />
          <Legend
            wrapperStyle={{ paddingTop: 10, fontSize: 11 }}
            formatter={(val) => <span style={{ color: '#cbd5e1' }}>{val}</span>}
          />
          <Bar yAxisId="left" dataKey="Service Rate (%)" radius={[3, 3, 0, 0]}>
            {chartData.map((entry) => (
              <Cell key={entry.strategy} fill={STRATEGY_COLORS[entry.strategy] ?? '#64748b'} />
            ))}
          </Bar>
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="Avg Wait (min)"
            stroke="#f59e0b"
            strokeWidth={3}
            dot={{ r: 5, fill: '#f59e0b' }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Chart 4: Empty Travel Distance & Repositioning Cost by Strategy ──────────

interface EmptyTravelCostChartProps {
  result: SimulationResult;
}

export function EmptyTravelCostChart({ result }: EmptyTravelCostChartProps) {
  const strategies = Object.keys(result.strategies);

  const getMetric = (s: string, metric: string): number => {
    if (result.mode === 'batch' && result.summary) {
      const row = result.summary.find((r) => r.strategy === s && r.metric === metric);
      if (row && row.mean !== null) return row.mean;
    }
    return (result.strategies[s]?.metrics[metric] as number) ?? 0;
  };

  const kmData = strategies.map((s) => ({
    strategy: s,
    label: s,
    'Pickup Empty km': Math.round(getMetric(s, 'empty_km_pickup')),
    'Repositioning Empty km': Math.round(getMetric(s, 'empty_km_reposition')),
    'Total Empty km': Math.round(getMetric(s, 'empty_km_total')),
  }));

  const costData = strategies.map((s) => ({
    strategy: s,
    label: s,
    'Relocation Cost (₹)': Math.round(getMetric(s, 'relocation_cost_est')),
    'Total Empty Cost (₹)': Math.round(getMetric(s, 'empty_cost_est')),
  }));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Distance Chart */}
      <div className="card p-4">
        <SectionHeading
          sub="Breakdown of kilometres traveled without passengers. Pickup empty km vs proactive repositioning empty km."
        >
          Empty Travel Distance by Strategy (km)
        </SectionHeading>

        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={kmData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a3347" />
            <XAxis dataKey="label" tick={{ fill: '#8892a4', fontSize: 11 }} />
            <YAxis
              tick={{ fill: '#8892a4', fontSize: 11 }}
              label={{ value: 'Distance (km)', angle: -90, position: 'insideLeft', offset: 8, fill: '#64748b', fontSize: 10 }}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#161b25', border: '1px solid #2a3347', borderRadius: 6 }}
              formatter={(v: any, name: any) => [`${Number(v).toLocaleString()} km`, name]}
              labelFormatter={(lbl) => STRATEGY_LABELS[lbl as string] ?? lbl}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="Pickup Empty km" stackId="km" fill="#64748b" radius={[0, 0, 0, 0]} />
            <Bar dataKey="Repositioning Empty km" stackId="km" fill="#3b82f6" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Cost Chart */}
      <div className="card p-4">
        <SectionHeading
          sub="Estimated operational cost based on fuel/wear per empty km (model assumption: ₹8/km). Displayed on dedicated ₹ axis."
        >
          Repositioning & Empty Travel Cost (₹)
        </SectionHeading>

        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={costData} margin={{ top: 8, right: 16, left: 16, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a3347" />
            <XAxis dataKey="label" tick={{ fill: '#8892a4', fontSize: 11 }} />
            <YAxis
              tick={{ fill: '#8892a4', fontSize: 11 }}
              tickFormatter={(v) => `₹${v}`}
              label={{ value: 'Cost (₹)', angle: -90, position: 'insideLeft', offset: 6, fill: '#64748b', fontSize: 10 }}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#161b25', border: '1px solid #2a3347', borderRadius: 6 }}
              formatter={(v: any, name: any) => [`₹${Number(v).toLocaleString()}`, name]}
              labelFormatter={(lbl) => STRATEGY_LABELS[lbl as string] ?? lbl}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="Relocation Cost (₹)" fill="#f59e0b" radius={[2, 2, 0, 0]} />
            <Bar dataKey="Total Empty Cost (₹)" fill="#a78bfa" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Chart 5: Batch Uncertainty Intervals ─────────────────────────────────────

interface BatchCIChartProps {
  result: SimulationResult;
  metricKey?: string;
  metricLabel?: string;
}

export function BatchCIChart({
  result,
  metricKey = 'service_rate',
  metricLabel = 'Service Rate',
}: BatchCIChartProps) {
  if (result.mode !== 'batch' || !result.summary) {
    return (
      <div className="card p-4 text-xs text-text-secondary bg-surface-200/40 border border-border">
        <p className="font-semibold text-text-primary mb-1">Batch Uncertainty & Confidence Intervals</p>
        <p className="text-text-muted">
          Current run is a single simulation run. To view 95% confidence intervals and paired statistical comparisons,
          increase <code className="text-accent">n_runs ≥ 5</code> in Config and click <strong>Apply & Re-run</strong>.
        </p>
      </div>
    );
  }

  const strategies = [...new Set(result.summary.map((r) => r.strategy))];

  const chartData = strategies
    .map((s) => {
      const row = result.summary!.find((r) => r.strategy === s && r.metric === metricKey);
      if (!row || row.mean === null) return null;

      const isRate = metricKey === 'service_rate';
      const factor = isRate ? 100 : 1;

      const meanVal = row.mean * factor;
      const ciLowDiff = row.ci_low !== null ? (row.mean - row.ci_low) * factor : 0;
      const ciHighDiff = row.ci_high !== null ? (row.ci_high - row.mean) * factor : 0;

      return {
        strategy: s,
        label: STRATEGY_LABELS[s] ?? s,
        mean: Number(meanVal.toFixed(2)),
        ci_high: Number(ciHighDiff.toFixed(2)),
        ci_low: Number(ciLowDiff.toFixed(2)),
        raw_ci_low: row.ci_low !== null ? (row.ci_low * factor).toFixed(2) : null,
        raw_ci_high: row.ci_high !== null ? (row.ci_high * factor).toFixed(2) : null,
      };
    })
    .filter(Boolean) as {
    strategy: string;
    label: string;
    mean: number;
    ci_high: number;
    ci_low: number;
    raw_ci_low: string | null;
    raw_ci_high: string | null;
  }[];

  return (
    <div className="card p-4">
      <SectionHeading
        sub={`Mean ± 95% Confidence Intervals over ${result.n_runs} matched-seed simulation runs for ${metricLabel}.`}
      >
        Repeated-Run Uncertainty Intervals ({metricLabel})
      </SectionHeading>

      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={chartData} margin={{ top: 20, right: 24, left: 16, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a3347" />
          <XAxis dataKey="label" tick={{ fill: '#8892a4', fontSize: 11 }} />
          <YAxis
            tick={{ fill: '#8892a4', fontSize: 11 }}
            tickFormatter={(v) => (metricKey === 'service_rate' ? `${v}%` : String(v))}
          />
          <Tooltip
            contentStyle={{ backgroundColor: '#161b25', border: '1px solid #2a3347', borderRadius: 6 }}
            formatter={(value: any, name: any, item: any) => {
              const d = item.payload;
              const unit = metricKey === 'service_rate' ? '%' : '';
              return [
                `${value}${unit} [95% CI: ${d.raw_ci_low}${unit} – ${d.raw_ci_high}${unit}]`,
                'Mean',
              ];
            }}
          />
          <Bar dataKey="mean" radius={[3, 3, 0, 0]}>
            {chartData.map((entry) => (
              <Cell key={entry.strategy} fill={STRATEGY_COLORS[entry.strategy] ?? '#64748b'} />
            ))}
            <ErrorBar dataKey="ci_high" width={8} strokeWidth={2} stroke="#cbd5e1" direction="y" />
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
