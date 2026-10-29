import React, { useState } from 'react';
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { EmptyState, Spinner, Tabs, Note, SectionHeading } from '../components/ui';
import type { SimulationResult } from '../types';
import { STRATEGY_COLORS, STRATEGY_LABELS } from '../types';

interface StrategyComparisonProps {
  result: SimulationResult | null;
  loading: boolean;
}

const TABLE_METRICS = [
  { key: 'service_rate', label: 'Service Rate', format: (v: number) => (v * 100).toFixed(1) + '%', higherBetter: true },
  { key: 'requests_served', label: 'Requests Served', format: (v: number) => v.toLocaleString('en-IN'), higherBetter: true },
  { key: 'requests_unserved', label: 'Unserved Requests', format: (v: number) => v.toLocaleString('en-IN'), higherBetter: false },
  { key: 'avg_wait_min', label: 'Avg Wait (min)', format: (v: number) => v.toFixed(2), higherBetter: false },
  { key: 'empty_km_pickup', label: 'Empty km: Pickups', format: (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 0 }), higherBetter: false },
  { key: 'empty_km_reposition', label: 'Empty km: Repositioning', format: (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 0 }), higherBetter: false },
  { key: 'empty_km_total', label: 'Empty km: Total', format: (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 0 }), higherBetter: false },
  { key: 'moves_made', label: 'Repositioning Moves', format: (v: number) => v.toLocaleString('en-IN'), higherBetter: null },
  { key: 'moves_recommended', label: 'Moves Recommended', format: (v: number) => v.toLocaleString('en-IN'), higherBetter: null },
  { key: 'redundant_moves', label: 'Redundant Moves', format: (v: number) => v.toLocaleString('en-IN'), higherBetter: false },
  { key: 'idle_in_hot_zones_avg', label: 'Idle in Hot Zones (avg)', format: (v: number) => v.toFixed(2), higherBetter: false },
  { key: 'relocation_cost_est', label: 'Relocation Cost (₹)', format: (v: number) => '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 }), higherBetter: false },
  { key: 'empty_cost_est', label: 'Total Empty-Travel Cost (₹)', format: (v: number) => '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 }), higherBetter: false },
  { key: 'served_per_empty_km', label: 'Requests per Empty km', format: (v: number) => v.toFixed(3), higherBetter: true },
];

const CHART_METRICS = [
  { key: 'service_rate', label: 'Service Rate (%)', scale: (v: number) => v * 100, tickFmt: (v: number) => v.toFixed(0) + '%' },
  { key: 'avg_wait_min', label: 'Avg Wait (min)', scale: (v: number) => v, tickFmt: (v: number) => v.toFixed(1) },
  { key: 'empty_km_total', label: 'Empty km (total)', scale: (v: number) => v, tickFmt: (v: number) => v.toFixed(0) },
  { key: 'relocation_cost_est', label: 'Reloc. Cost (₹)', scale: (v: number) => v, tickFmt: (v: number) => v.toFixed(0) },
];

export default function StrategyComparison({ result, loading }: StrategyComparisonProps) {
  const [activeTab, setActiveTab] = useState('charts');

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size={28} />
        <span className="ml-3 text-text-secondary text-sm">Running simulation…</span>
      </div>
    );
  }

  if (!result) {
    return <EmptyState message="No simulation data" sub="Run a simulation to compare strategies." />;
  }

  const strategies = Object.keys(result.strategies);
  const isBatch = result.mode === 'batch';

  const getVal = (s: string, metric: string): number | null => {
    if (isBatch && result.summary) {
      const row = result.summary.find(r => r.strategy === s && r.metric === metric);
      if (row) return row.mean;
    }
    return (result.strategies[s].metrics[metric] as number) ?? null;
  };

  const findBest = (metric: string, higherBetter: boolean | null): string | null => {
    if (higherBetter === null) return null;
    let best: string | null = null;
    let bestVal = higherBetter ? -Infinity : Infinity;
    for (const s of strategies) {
      const v = getVal(s, metric);
      if (v === null) continue;
      if ((higherBetter && v > bestVal) || (!higherBetter && v < bestVal)) {
        best = s;
        bestVal = v;
      }
    }
    return best;
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading sub={isBatch
        ? `Mean results across ${result.n_runs} repeated runs with matched seeds.`
        : 'Single matched run — all strategies ran on the same demand realization.'}>
        Strategy Comparison
      </SectionHeading>
      <Note>
        {isBatch
          ? 'Batch mode: values shown are means. Confidence intervals are available on the Statistics page.'
          : 'Single run: differences may vary across seeds. Re-run with n_runs ≥ 10 for statistical reliability.'}
      </Note>

      <Tabs
        tabs={[
          { id: 'charts', label: 'Charts' },
          { id: 'table', label: 'Comparison Table' },
        ]}
        active={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === 'charts' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {CHART_METRICS.map(cm => {
            const chartData = strategies.map(s => ({
              strategy: s,
              label: s,
              value: (() => {
                const v = getVal(s, cm.key);
                return v !== null ? cm.scale(v) : null;
              })(),
            })).filter(d => d.value !== null);

            return (
              <div key={cm.key} className="card p-4">
                <SectionHeading>{cm.label}</SectionHeading>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData} margin={{ top: 8, right: 16, left: 16, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a3347" />
                    <XAxis dataKey="label" tick={{ fill: '#8892a4', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#8892a4', fontSize: 11 }} tickFormatter={cm.tickFmt} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#161b25', border: '1px solid #2a3347', borderRadius: 6 }}
                      formatter={(v: any, _name: any) => [cm.tickFmt(Number(v ?? 0)), cm.label]}
                      labelFormatter={(label) => STRATEGY_LABELS[label as string] ?? label}
                    />
                    <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                      {chartData.map(d => (
                        <Cell
                          key={d.strategy}
                          fill={STRATEGY_COLORS[d.strategy] ?? '#64748b'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap gap-3 justify-center mt-1">
                  {chartData.map(d => (
                    <div key={d.strategy} className="flex items-center gap-1.5 text-xs text-text-secondary">
                      <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: STRATEGY_COLORS[d.strategy] ?? '#64748b' }} />
                      {STRATEGY_LABELS[d.strategy] ?? d.strategy}:{' '}
                      <span className="font-mono text-text-primary">{cm.tickFmt(d.value!)}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activeTab === 'table' && (
        <div className="card p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 label">Metric</th>
                  <th className="text-left py-2 px-3 label text-xs text-text-muted">Type</th>
                  {strategies.map(s => (
                    <th
                      key={s}
                      className="text-right py-2 px-3 label"
                      style={{ color: STRATEGY_COLORS[s] ?? '#8892a4' }}
                    >
                      {s}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TABLE_METRICS.map(tm => {
                  const best = findBest(tm.key, tm.higherBetter as boolean | null);
                  return (
                    <tr key={tm.key} className="border-b border-border/50 hover:bg-surface-200/30">
                      <td className="py-2 px-3 text-text-secondary">{tm.label}</td>
                      <td className="py-2 px-3 text-text-muted text-xs">
                        {isBatch ? 'mean' : 'single run'}
                      </td>
                      {strategies.map(s => {
                        const v = getVal(s, tm.key);
                        const isBestForMetric = best === s;
                        return (
                          <td
                            key={s}
                            className={`py-2 px-3 text-right font-mono text-xs ${isBestForMetric ? 'font-semibold' : ''}`}
                            style={isBestForMetric ? { color: STRATEGY_COLORS[s] ?? '#10b981' } : { color: '#e8ecf4' }}
                          >
                            {v === null ? '—' : tm.format(v)}
                            {isBestForMetric && ' ✓'}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-text-muted mt-3">
            ✓ marks the best (or tied) value for each metric. Higher service rate / served_per_empty_km and lower wait / empty km / cost are better.
          </p>
        </div>
      )}
    </div>
  );
}
