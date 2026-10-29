import React from 'react';
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { EmptyState, Spinner, SectionHeading, Note, StatRow } from '../components/ui';
import { BatchCIChart } from '../components/AnalyticalCharts';
import type { SimulationResult } from '../types';
import { STRATEGY_COLORS, STRATEGY_LABELS } from '../types';

interface ResultsPageProps {
  result: SimulationResult | null;
  loading: boolean;
}

const KEY_METRICS = [
  { key: 'service_rate', label: 'Service Rate', higherBetter: true, format: (v: number) => (v * 100).toFixed(1) + '%' },
  { key: 'avg_wait_min', label: 'Avg Wait', higherBetter: false, format: (v: number) => v.toFixed(2) + ' min' },
  { key: 'empty_km_total', label: 'Total Empty km', higherBetter: false, format: (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: 0 }) + ' km' },
  { key: 'relocation_cost_est', label: 'Relocation Cost', higherBetter: false, format: (v: number) => '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 }) },
];

function parseExplanation(text: string): React.ReactNode {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i} className="text-text-primary font-semibold">{part}</strong> : part
  );
}

export default function ResultsPage({ result, loading }: ResultsPageProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size={28} />
        <span className="ml-3 text-text-secondary text-sm">Running simulation…</span>
      </div>
    );
  }

  if (!result) {
    return <EmptyState message="No results yet" sub="Run a simulation to see results and interpretation." />;
  }

  const strategies = Object.keys(result.strategies);
  
  // Determine best per metric from single-run or batch
  const getMetricValue = (strategy: string, metric: string): number | null => {
    if (result.mode === 'batch' && result.summary) {
      const row = result.summary.find(r => r.strategy === strategy && r.metric === metric);
      return row?.mean ?? null;
    }
    const m = result.strategies[strategy]?.metrics;
    return (m?.[metric] as number) ?? null;
  };

  const getBest = (metric: string, higherBetter: boolean): string => {
    let best: string | null = null;
    let bestVal = higherBetter ? -Infinity : Infinity;
    for (const s of strategies) {
      const v = getMetricValue(s, metric);
      if (v === null) continue;
      if ((higherBetter && v > bestVal) || (!higherBetter && v < bestVal)) {
        best = s;
        bestVal = v;
      }
    }
    return best ?? strategies[0];
  };

  // Chart: service rate comparison
  const serviceRateData = strategies.map(s => ({
    strategy: s,
    label: s,
    value: (getMetricValue(s, 'service_rate') ?? 0) * 100,
  }));

  const emptyKmData = strategies.map(s => ({
    strategy: s,
    label: s,
    value: getMetricValue(s, 'empty_km_total') ?? 0,
  }));

  // Trade-off analysis
  const pServiceRate = getMetricValue('P', 'service_rate');
  const b0ServiceRate = getMetricValue('B0', 'service_rate');
  const pRelocCost = getMetricValue('P', 'relocation_cost_est');
  const b0RelocCost = getMetricValue('B0', 'relocation_cost_est');

  return (
    <div className="flex flex-col gap-6">
      <SectionHeading sub={`Analysis based on ${result.mode === 'batch' ? `${result.n_runs} repeated runs` : 'a single simulation run'}.`}>
        Results &amp; Interpretation
      </SectionHeading>

      <Note>
        Results are generated from the actual simulation engine. No values are fabricated.
        {result.mode === 'single' && ' For statistically reliable conclusions, re-run with n_runs ≥ 10.'}
      </Note>

      {/* Best performer cards */}
      <div>
        <SectionHeading sub="Which strategy had the best mean for each metric">Best Performer per Metric</SectionHeading>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {KEY_METRICS.map(m => {
            const best = getBest(m.key, m.higherBetter);
            const val = getMetricValue(best, m.key);
            const pVal = getMetricValue('P', m.key);
            const isP = best === 'P';
            return (
              <div
                key={m.key}
                className={`card p-4 ${isP ? 'border-accent/30' : ''}`}
              >
                <div className="label mb-2">{m.label}</div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STRATEGY_COLORS[best] }} />
                  <span className="text-xs text-text-secondary">{STRATEGY_LABELS[best] ?? best}</span>
                </div>
                <div className={`text-xl font-bold font-mono ${isP ? 'text-accent' : 'text-text-primary'}`}>
                  {val !== null ? m.format(val) : '—'}
                </div>
                {!isP && pVal !== null && val !== null && (
                  <div className="text-xs text-text-muted mt-1">
                    P: {m.format(pVal)}
                    {' '}({m.higherBetter
                      ? ((pVal - val) / Math.abs(val) * 100).toFixed(1) + '% behind'
                      : ((val - pVal) / Math.abs(val) * 100).toFixed(1) + '% behind'
                    })
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-4">
          <SectionHeading>Service Rate by Strategy</SectionHeading>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={serviceRateData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3347" />
              <XAxis dataKey="label" tick={{ fill: '#8892a4', fontSize: 11 }} />
              <YAxis tick={{ fill: '#8892a4', fontSize: 11 }} tickFormatter={v => v.toFixed(0) + '%'} domain={[0, 100]} />
              <Tooltip
                contentStyle={{ backgroundColor: '#161b25', border: '1px solid #2a3347', borderRadius: 6 }}
                formatter={(v: any) => [Number(v ?? 0).toFixed(1) + '%', 'Service Rate']}
              />
              <Bar dataKey="value" name="Service Rate" radius={[3, 3, 0, 0]}>
                {serviceRateData.map(d => (
                  <Cell key={d.strategy} fill={STRATEGY_COLORS[d.strategy]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card p-4">
          <SectionHeading>Total Empty km by Strategy</SectionHeading>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={emptyKmData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a3347" />
              <XAxis dataKey="label" tick={{ fill: '#8892a4', fontSize: 11 }} />
              <YAxis tick={{ fill: '#8892a4', fontSize: 11 }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#161b25', border: '1px solid #2a3347', borderRadius: 6 }}
                formatter={(v: any) => [Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 }), 'Empty km']}
              />
              <Bar dataKey="value" name="Empty km" radius={[3, 3, 0, 0]}>
                {emptyKmData.map(d => (
                  <Cell key={d.strategy} fill={STRATEGY_COLORS[d.strategy]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Uncertainty Intervals (when batch available) */}
      <BatchCIChart result={result} metricKey="service_rate" metricLabel="Service Rate" />

      {/* Trade-off analysis */}
      {pServiceRate !== null && b0ServiceRate !== null && (
        <div className="card p-4">
          <SectionHeading>Trade-off Analysis: RideBalance vs Baseline</SectionHeading>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-text-secondary">
            <div>
              <p className="label mb-2">Service rate impact (P vs B0)</p>
              <p>
                RideBalance achieved{' '}
                <span className={`font-mono font-medium ${pServiceRate > b0ServiceRate ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {(pServiceRate * 100).toFixed(1)}%
                </span>{' '}
                vs B0's{' '}
                <span className="font-mono text-text-primary">{(b0ServiceRate * 100).toFixed(1)}%</span>.
                {pServiceRate > b0ServiceRate
                  ? ` That is ${((pServiceRate - b0ServiceRate) * 100).toFixed(2)} percentage points higher.`
                  : ` RideBalance did not outperform the no-repositioning baseline on this run. This can happen with a small synthetic fleet where demand fits the initial distribution.`}
              </p>
            </div>
            {pRelocCost !== null && b0RelocCost !== null && (
              <div>
                <p className="label mb-2">Relocation cost trade-off</p>
                <p>
                  RideBalance spent an estimated{' '}
                  <span className="font-mono text-accent">₹{pRelocCost.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>{' '}
                  on repositioning vs{' '}
                  <span className="font-mono text-text-primary">₹{b0RelocCost.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>{' '}
                  for B0.{' '}
                  {pRelocCost > b0RelocCost
                    ? 'Higher repositioning cost is expected — the key question is whether the service-rate gain justifies it.'
                    : 'Remarkably, repositioning cost is similar or lower.'}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Key findings */}
      <div className="card p-4">
        <SectionHeading>Key Findings</SectionHeading>
        <div className="flex flex-col gap-2 text-sm text-text-secondary">
          {strategies.map(s => {
            const sr = getMetricValue(s, 'service_rate');
            const wt = getMetricValue(s, 'avg_wait_min');
            const km = getMetricValue(s, 'empty_km_total');
            return (
              <div key={s} className="flex gap-3">
                <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: STRATEGY_COLORS[s] }} />
                <p>
                  <span style={{ color: STRATEGY_COLORS[s] }} className="font-medium">{STRATEGY_LABELS[s] ?? s}</span>
                  {': '}
                  {sr !== null ? `${(sr * 100).toFixed(1)}% service rate` : '—'}
                  {wt !== null ? `, ${wt.toFixed(2)} min avg wait` : ''}
                  {km !== null ? `, ${km.toLocaleString('en-IN', { maximumFractionDigits: 0 })} total empty km` : ''}
                  .
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Explanation from engine */}
      {result.explanation && result.explanation.length > 0 && (
        <div className="card p-4">
          <SectionHeading>Statistical Interpretation</SectionHeading>
          <div className="flex flex-col gap-2">
            {result.explanation.map((line, i) => (
              <p key={i} className={`text-sm ${line.startsWith('-') ? 'text-text-secondary pl-4' : 'text-text-primary font-medium'}`}>
                {parseExplanation(line)}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Limitations */}
      <div className="card p-4 border-amber-800/20">
        <SectionHeading>Limitations</SectionHeading>
        <ul className="text-sm text-text-secondary list-disc pl-5 flex flex-col gap-1.5">
          <li>Results are from a <strong className="text-text-primary">synthetic simulation</strong>, not real Ola/Uber data.</li>
          <li>On a small 16-zone city, all strategies may produce similar results — the gap may be larger in real, larger cities.</li>
          <li>Driver acceptance probability (90%) is an assumption, not a measured value.</li>
          <li>Cost estimates (₹150/request, ₹8/km) are model inputs, not real tariffs.</li>
          {result.mode === 'single' && (
            <li>Single-run results have high run-to-run variability. Confidence intervals require n_runs ≥ 5.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
