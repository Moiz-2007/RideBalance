import React, { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ComposedChart, ErrorBar,
} from 'recharts';
import { Spinner, EmptyState, Slider, Note, SectionHeading, Select } from '../components/ui';
import { api } from '../api';
import type { SweepResult } from '../types';
import { STRATEGY_COLORS, STRATEGY_LABELS } from '../types';

const CORE_STRATEGIES = ['B0', 'B1', 'B2', 'P'];

interface ScenarioPageProps {
  nZones?: number;
  nDrivers?: number;
  durationMin?: number;
  seed?: number;
}

export default function ScenarioPage({ nZones = 16, nDrivers = 60, durationMin = 120, seed = 42 }: ScenarioPageProps) {
  const [nRuns, setNRuns] = useState(5);
  const [severity, setSeverity] = useState(1.0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SweepResult | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<'service_rate' | 'avg_wait'>('service_rate');

  const runSweep = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.scenarioSweep({
        n_zones: nZones,
        n_drivers: nDrivers,
        duration_min: durationMin,
        seed,
        n_runs: nRuns,
        severity,
        strategies: CORE_STRATEGIES,
      });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sweep failed');
    } finally {
      setLoading(false);
    }
  };

  // Build chart data
  const chartData = result?.cases.map(c => {
    const entry: Record<string, string | number | null> = { scenario: c.label };
    CORE_STRATEGIES.forEach(s => {
      const d = c.strategies[s];
      if (d) {
        entry[s] = selectedMetric === 'service_rate'
          ? (d.service_rate_mean !== null ? d.service_rate_mean * 100 : null)
          : d.avg_wait_mean;
      }
    });
    return entry;
  }) ?? [];

  function parseExplanation(text: string): React.ReactNode {
    const parts = text.split(/\*\*(.*?)\*\*/g);
    return parts.map((part, i) =>
      i % 2 === 1 ? <strong key={i} className="text-text-primary font-semibold">{part}</strong> : part
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <SectionHeading sub="Compare strategy performance across all built-in scenarios, each run repeatedly for reliable estimates.">
          Scenario Lab
        </SectionHeading>
        <Note>
          The sweep runs each of {CORE_STRATEGIES.join(', ')} on every scenario at the given severity level, {nRuns} times each.
          All five scenarios (school, office, event, rain, transit) plus no-scenario baseline and all-combined are tested.
          Synthetic scenarios only — no real-world data.
        </Note>
      </div>

      {/* Config */}
      <div className="card p-4">
        <SectionHeading>Sweep Configuration</SectionHeading>
        <div className="flex flex-wrap gap-6">
          <Slider
            label="Repeated runs per scenario/strategy"
            value={nRuns}
            min={2}
            max={20}
            step={1}
            onChange={setNRuns}
          />
          <Slider
            label="Scenario severity"
            value={severity}
            min={0.25}
            max={3}
            step={0.25}
            onChange={setSeverity}
            format={v => v.toFixed(2) + '×'}
          />
        </div>
        <div className="mt-4">
          <button
            className="btn-primary"
            onClick={runSweep}
            disabled={loading}
          >
            {loading ? <><Spinner size={14} /> Running sweep…</> : '▶ Run Scenario Sweep'}
          </button>
          {loading && (
            <p className="text-xs text-text-muted mt-2">
              This may take 1–2 minutes depending on n_runs and city size.
            </p>
          )}
        </div>
        {error && <p className="text-sm text-red-400 mt-2">{error}</p>}
      </div>

      {/* Results */}
      {result ? (
        <>
          <div className="flex items-center gap-4">
            <Select
              label="Metric"
              value={selectedMetric}
              onChange={v => setSelectedMetric(v as 'service_rate' | 'avg_wait')}
              options={[
                { value: 'service_rate', label: 'Service Rate (%)' },
                { value: 'avg_wait', label: 'Avg Wait (min)' },
              ]}
            />
          </div>

          <div className="card p-4">
            <SectionHeading sub="Mean across repeated runs per scenario. Error bars not shown in this chart.">
              {selectedMetric === 'service_rate' ? 'Service Rate by Scenario' : 'Avg Wait by Scenario'}
            </SectionHeading>
            <ResponsiveContainer width="100%" height={380}>
              <BarChart data={chartData} margin={{ top: 8, right: 24, left: 24, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a3347" />
                <XAxis
                  dataKey="scenario"
                  tick={{ fill: '#8892a4', fontSize: 10 }}
                  angle={-30}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis
                  tick={{ fill: '#8892a4', fontSize: 11 }}
                  tickFormatter={v => selectedMetric === 'service_rate' ? v.toFixed(0) + '%' : v.toFixed(1)}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#161b25', border: '1px solid #2a3347', borderRadius: 6 }}
                  labelStyle={{ color: '#e8ecf4', fontSize: 12 }}
                  formatter={(v: any, name: any) => [
                    selectedMetric === 'service_rate' ? Number(v ?? 0).toFixed(1) + '%' : Number(v ?? 0).toFixed(2) + ' min',
                    STRATEGY_LABELS[name as string] ?? name,
                  ]}
                />
                <Legend
                  formatter={s => STRATEGY_LABELS[s] ?? s}
                  wrapperStyle={{ paddingTop: '12px' }}
                />
                {CORE_STRATEGIES.map(s => (
                  <Bar key={s} dataKey={s} fill={STRATEGY_COLORS[s]} radius={[2, 2, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* CI table per scenario */}
          <div className="card p-4">
            <SectionHeading sub="Service rate mean [95% CI] per scenario">Detailed Results</SectionHeading>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 label">Scenario</th>
                    {CORE_STRATEGIES.map(s => (
                      <th key={s} className="text-right py-2 px-3 label" style={{ color: STRATEGY_COLORS[s] }}>{s}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.cases.map(c => (
                    <tr key={c.case} className="border-b border-border/50 hover:bg-surface-200/30">
                      <td className="py-2 px-3 text-text-secondary">{c.label}</td>
                      {CORE_STRATEGIES.map(s => {
                        const d = c.strategies[s];
                        if (!d || d.service_rate_mean === null) return <td key={s} className="py-2 px-3 text-right font-mono text-text-muted">—</td>;
                        const ci = d.service_rate_ci_low !== null && d.service_rate_ci_high !== null
                          ? ` [${(d.service_rate_ci_low * 100).toFixed(1)}, ${(d.service_rate_ci_high * 100).toFixed(1)}]`
                          : '';
                        return (
                          <td key={s} className="py-2 px-3 text-right font-mono text-xs">
                            <span className="text-text-primary">{(d.service_rate_mean * 100).toFixed(1)}%</span>
                            <span className="text-text-muted">{ci}</span>
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
          {result.explanation.length > 0 && (
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
        </>
      ) : !loading && (
        <EmptyState
          message="No sweep results yet"
          sub="Configure the sweep parameters above and click 'Run Scenario Sweep' to start."
        />
      )}
    </div>
  );
}
