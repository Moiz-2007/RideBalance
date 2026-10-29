import React, { useState } from 'react';
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ErrorBar, ComposedChart,
} from 'recharts';
import { EmptyState, Spinner, Select, SectionHeading, Note } from '../components/ui';
import type { SimulationResult, SummaryRow } from '../types';
import { STRATEGY_COLORS, STRATEGY_LABELS } from '../types';

interface StatisticsPageProps {
  result: SimulationResult | null;
  loading: boolean;
}

const METRICS = [
  { key: 'service_rate', label: 'Service Rate', format: (v: number) => (v * 100).toFixed(2) + '%' },
  { key: 'requests_served', label: 'Requests Served', format: (v: number) => v.toFixed(0) },
  { key: 'requests_unserved', label: 'Unserved Requests', format: (v: number) => v.toFixed(0) },
  { key: 'avg_wait_min', label: 'Avg Wait (min)', format: (v: number) => v.toFixed(2) },
  { key: 'empty_km_total', label: 'Total Empty km', format: (v: number) => v.toFixed(0) },
  { key: 'moves_made', label: 'Repositioning Moves', format: (v: number) => v.toFixed(0) },
  { key: 'relocation_cost_est', label: 'Relocation Cost (₹)', format: (v: number) => '₹' + v.toLocaleString() },
  { key: 'idle_in_hot_zones_avg', label: 'Idle in Hot Zones (avg)', format: (v: number) => v.toFixed(2) },
];

function parseExplanation(text: string): React.ReactNode {
  // Bold **text** -> <strong>
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i} className="text-text-primary font-semibold">{part}</strong> : part
  );
}

export default function StatisticsPage({ result, loading }: StatisticsPageProps) {
  const [selectedMetric, setSelectedMetric] = useState('service_rate');

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size={28} />
        <span className="ml-3 text-text-secondary text-sm">Computing statistics…</span>
      </div>
    );
  }

  if (!result) {
    return <EmptyState message="No simulation data" sub="Run a simulation to see statistics." />;
  }

  if (result.mode === 'single') {
    return (
      <div className="flex flex-col gap-4">
        <SectionHeading>Statistics</SectionHeading>
        <div className="card p-6">
          <p className="text-text-secondary text-sm">
            This was a single-run simulation. To see means, confidence intervals, and statistical tests, set{' '}
            <strong className="text-accent font-mono">n_runs ≥ 5</strong> in the simulation configuration and re-run.
          </p>
          <p className="text-xs text-text-muted mt-2">
            Repeated runs use matched seeds: each strategy runs on the same demand realization per seed, so
            differences reflect strategy logic rather than randomness.
          </p>
        </div>

        {/* Single-run values still shown as a table */}
        <div className="card p-4">
          <SectionHeading sub="Single run metrics (no confidence intervals available)">Single Run Results</SectionHeading>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 label">Metric</th>
                  {Object.keys(result.strategies).map(s => (
                    <th key={s} className="text-right py-2 px-3 label" style={{ color: STRATEGY_COLORS[s] }}>
                      {s}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {METRICS.map(m => (
                  <tr key={m.key} className="border-b border-border/50 hover:bg-surface-200/30">
                    <td className="py-2 px-3 text-text-secondary">{m.label}</td>
                    {Object.entries(result.strategies).map(([s, r]) => {
                      const v = r.metrics[m.key] as number | null | undefined;
                      return (
                        <td key={s} className="py-2 px-3 text-right font-mono text-text-primary">
                          {v === null || v === undefined ? '—' : m.format(v)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // Batch mode
  const summary = result.summary ?? [];
  const paired = result.paired ?? [];
  const strategies = [...new Set(summary.map(r => r.strategy))];

  const metaInfo = METRICS.find(m => m.key === selectedMetric);

  // Build chart data for error bars
  const chartData = strategies.map(s => {
    const row = summary.find(r => r.strategy === s && r.metric === selectedMetric);
    if (!row || row.mean === null) return null;
    return {
      strategy: s,
      label: STRATEGY_LABELS[s] ?? s,
      mean: row.mean,
      ci_low: row.ci_low !== null ? row.mean - row.ci_low : 0,
      ci_high: row.ci_high !== null ? row.ci_high - row.mean : 0,
    };
  }).filter(Boolean) as { strategy: string; label: string; mean: number; ci_low: number; ci_high: number }[];

  const metricPaired = paired.filter(r => r.metric === selectedMetric);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <SectionHeading sub={`Results averaged over ${result.n_runs} repeated runs with matched seeds.`}>
          Statistical Summary
        </SectionHeading>
        <Note>
          95% confidence intervals computed from the t-distribution. Each strategy ran on the same {result.n_runs} demand realizations,
          enabling paired comparisons. CIs reflect run-to-run variability, not algorithmic uncertainty.
        </Note>
      </div>

      {/* Metric selector */}
      <Select
        label="Metric"
        value={selectedMetric}
        onChange={setSelectedMetric}
        options={METRICS.map(m => ({ value: m.key, label: m.label }))}
        className="max-w-xs"
      />

      {/* Error-bar chart */}
      <div className="card p-4">
        <SectionHeading sub="Mean ± 95% CI across repeated runs">{metaInfo?.label}</SectionHeading>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={chartData} margin={{ top: 16, right: 24, left: 24, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a3347" />
            <XAxis dataKey="label" tick={{ fill: '#8892a4', fontSize: 11 }} />
            <YAxis
              tick={{ fill: '#8892a4', fontSize: 11 }}
              tickFormatter={v => selectedMetric === 'service_rate' ? (v * 100).toFixed(0) + '%' : v.toFixed(1)}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#161b25', border: '1px solid #2a3347', borderRadius: 6 }}
              labelStyle={{ color: '#e8ecf4', fontSize: 12 }}
              itemStyle={{ color: '#8892a4', fontSize: 11 }}
              formatter={(v: any, name: any) => {
                if (name === 'mean') return [metaInfo?.format(Number(v ?? 0)) ?? Number(v ?? 0).toFixed(3), 'Mean'];
                return [Number(v ?? 0).toFixed(3), name];
              }}
            />
            <Bar dataKey="mean" radius={[3, 3, 0, 0]}>
              {chartData.map((entry) => (
                <Cell key={entry.strategy} fill={STRATEGY_COLORS[entry.strategy] ?? '#64748b'} />
              ))}
              <ErrorBar dataKey="ci_high" width={8} strokeWidth={2} stroke="#8892a4" direction="y" />
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
        <div className="flex justify-center gap-4 mt-2 flex-wrap">
          {chartData.map(d => (
            <div key={d.strategy} className="flex items-center gap-1.5 text-xs text-text-secondary">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: STRATEGY_COLORS[d.strategy] ?? '#64748b' }} />
              {d.label}
            </div>
          ))}
        </div>
      </div>

      {/* Paired comparison for selected metric */}
      {metricPaired.length > 0 && (
        <div className="card p-4">
          <SectionHeading sub="RideBalance (P) minus each baseline, paired by seed">
            Paired Comparison: {metaInfo?.label}
          </SectionHeading>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  {['vs Baseline', 'n', 'Mean diff', '95% CI', 'Effect (dz)', 'Test', 'p-value', 'Holm adj.'].map(h => (
                    <th key={h} className="text-left py-2 px-3 label">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {metricPaired.map(r => (
                  <tr key={r.vs} className="border-b border-border/50 hover:bg-surface-200/30">
                    <td className="py-2 px-3" style={{ color: STRATEGY_COLORS[r.vs] }}>{STRATEGY_LABELS[r.vs] ?? r.vs}</td>
                    <td className="py-2 px-3 font-mono text-text-secondary">{r.n}</td>
                    <td className={`py-2 px-3 font-mono font-medium ${r.mean_diff !== null && r.mean_diff > 0 ? 'text-emerald-400' : r.mean_diff !== null && r.mean_diff < 0 ? 'text-red-400' : 'text-text-secondary'}`}>
                      {r.mean_diff !== null ? (r.mean_diff > 0 ? '+' : '') + r.mean_diff.toFixed(4) : '—'}
                    </td>
                    <td className="py-2 px-3 font-mono text-text-secondary text-xs">
                      {r.ci_low !== null && r.ci_high !== null
                        ? `[${r.ci_low.toFixed(3)}, ${r.ci_high.toFixed(3)}]`
                        : '—'}
                    </td>
                    <td className="py-2 px-3 font-mono text-text-secondary">
                      {r.effect_size_dz !== null ? r.effect_size_dz.toFixed(2) : '—'}
                    </td>
                    <td className="py-2 px-3 text-text-muted text-xs">{r.test}</td>
                    <td className="py-2 px-3 font-mono text-text-secondary">
                      {r.p !== null ? r.p.toFixed(4) : '—'}
                    </td>
                    <td className={`py-2 px-3 font-mono font-medium ${r.p_holm_primary !== null && r.p_holm_primary < 0.05 ? 'text-emerald-400' : 'text-text-secondary'}`}>
                      {r.p_holm_primary !== null ? r.p_holm_primary.toFixed(4) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Full summary table */}
      <div className="card p-4">
        <SectionHeading sub="Mean [95% CI] across all runs">All Metrics Summary</SectionHeading>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-3 label">Metric</th>
                {strategies.map(s => (
                  <th key={s} className="text-right py-2 px-3 label" style={{ color: STRATEGY_COLORS[s] }}>
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {METRICS.map(m => (
                <tr key={m.key} className="border-b border-border/50 hover:bg-surface-200/30">
                  <td className="py-2 px-3 text-text-secondary">{m.label}</td>
                  {strategies.map(s => {
                    const row = summary.find(r => r.strategy === s && r.metric === m.key);
                    if (!row || row.mean === null) return <td key={s} className="py-2 px-3 text-right font-mono text-text-muted">—</td>;
                    const ci = row.ci_low !== null && row.ci_high !== null
                      ? ` [${m.format(row.ci_low)}, ${m.format(row.ci_high)}]`
                      : '';
                    return (
                      <td key={s} className="py-2 px-3 text-right font-mono text-xs text-text-primary">
                        {m.format(row.mean)}<span className="text-text-muted">{ci}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Explanation */}
      {result.explanation && result.explanation.length > 0 && (
        <div className="card p-4">
          <SectionHeading>Automated Interpretation</SectionHeading>
          <div className="flex flex-col gap-2">
            {result.explanation.map((line, i) => (
              <p key={i} className={`text-sm ${line.startsWith('-') ? 'text-text-secondary pl-4' : 'text-text-primary font-medium'}`}>
                {parseExplanation(line)}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
