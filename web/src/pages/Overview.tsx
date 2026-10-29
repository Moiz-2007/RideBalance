import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Activity, AlertTriangle, Clock, MapPin, Navigation, TrendingUp, ChevronRight } from 'lucide-react';
import { KpiCard, EmptyState, Spinner, Note, SectionHeading } from '../components/ui';
import type { SimulationResult } from '../types';
import { STRATEGY_COLORS, STRATEGY_LABELS } from '../types';

interface OverviewProps {
  result: SimulationResult | null;
  loading: boolean;
  onNavigate: (page: string) => void;
}

function fmt(v: number | null | undefined, decimals = 0): string {
  if (v === null || v === undefined) return '—';
  return v.toLocaleString('en-IN', { maximumFractionDigits: decimals });
}

export default function Overview({ result, loading, onNavigate }: OverviewProps) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <Spinner size={32} />
        <span className="text-text-secondary text-sm">Simulation in progress…</span>
        <p className="text-xs text-text-muted">This may take a few seconds.</p>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex flex-col gap-8">
        {/* Hero / intro */}
        <div className="card p-8 flex flex-col gap-3 items-start border-accent/20">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-lg bg-accent/15 flex items-center justify-center">
              <Activity size={20} className="text-accent" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-text-primary">RideBalance</h1>
              <p className="text-xs text-text-secondary">Risk-aware fleet repositioning simulation</p>
            </div>
          </div>
          <p className="text-sm text-text-secondary max-w-2xl">
            RideBalance is a simulation-based decision-support system studying how a limited ride-hailing fleet can be
            repositioned when demand is uncertain. It compares four strategies —{' '}
            <span className="text-slate-400 font-medium">B0 Stay Put</span>,{' '}
            <span className="text-amber-400 font-medium">B1 Demand-Only Heatmap</span>,{' '}
            <span className="text-blue-400 font-medium">B2 Cost-Aware Heatmap</span>, and{' '}
            <span className="text-accent font-medium">P RideBalance</span> — on a synthetic 16-zone city.
          </p>
          <Note>
            This uses entirely <strong>synthetic data</strong>. No real Ola/Uber fleet data is connected.
            The simulation runs locally in your browser via the Python engine.
          </Note>
          <p className="text-xs text-text-muted mt-2">
            Click <strong className="text-accent">Run Simulation</strong> in the header to start.
          </p>
        </div>
      </div>
    );
  }

  // Pick the RideBalance (P) result as primary for KPIs, or fall back to first strategy
  const primaryKey = result.strategies['P'] ? 'P' : Object.keys(result.strategies)[0];
  const primary = result.strategies[primaryKey];
  const m = primary.metrics;

  // Build comparison chart data
  const strategies = Object.keys(result.strategies);

  const getVal = (s: string, metric: string): number => {
    if (result.mode === 'batch' && result.summary) {
      const row = result.summary.find(r => r.strategy === s && r.metric === metric);
      return row?.mean ?? (result.strategies[s].metrics as Record<string, number | null>)[metric] ?? 0;
    }
    return (result.strategies[s].metrics as Record<string, number | null>)[metric] ?? 0;
  };

  const comparisonData = [
    {
      metric: 'Service Rate (%)',
      ...Object.fromEntries(strategies.map(s => [s, (getVal(s, 'service_rate') * 100)])),
    },
    {
      metric: 'Avg Wait (min)',
      ...Object.fromEntries(strategies.map(s => [s, getVal(s, 'avg_wait_min')])),
    },
    {
      metric: 'Empty km (÷10)',
      ...Object.fromEntries(strategies.map(s => [s, getVal(s, 'empty_km_total') / 10])),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* KPI cards */}
      <div>
        <SectionHeading sub={`RideBalance (P) strategy results · Seed ${result.seed} · ${result.city.n_zones} zones · ${result.strategies[primaryKey].metrics.requests_generated} total requests`}>
          Simulation Summary
        </SectionHeading>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard
            label="Service Rate"
            value={m.service_rate !== null ? (m.service_rate * 100).toFixed(1) + '%' : '—'}
            tooltip="Fraction of generated ride requests that were matched to a driver within the wait limit."
            accent
          />
          <KpiCard
            label="Requests Served"
            value={fmt(m.requests_served)}
            unit={`/ ${fmt(m.requests_generated)}`}
            tooltip="Number of requests successfully matched to a driver. Denominator is all generated requests."
          />
          <KpiCard
            label="Unserved"
            value={fmt(m.requests_unserved)}
            tooltip="Requests that timed out (waited > 8 min) or were still queued at simulation end. Lower is better."
          />
          <KpiCard
            label="Avg Wait"
            value={m.avg_wait_min !== null ? m.avg_wait_min.toFixed(2) : '—'}
            unit="min"
            tooltip="Mean passenger waiting time from request arrival to driver pickup, for served requests only."
          />
          <KpiCard
            label="Empty km"
            value={fmt(m.empty_km_total)}
            unit="km"
            tooltip="Total kilometres driven without a passenger — pickup travel plus repositioning travel. Lower is better."
          />
          <KpiCard
            label="Reloc. Cost"
            value={m.relocation_cost_est !== null ? '₹' + fmt(m.relocation_cost_est) : '—'}
            tooltip={`Estimated repositioning cost at ₹8/empty km. This is a model assumption, not a real tariff.`}
          />
        </div>
      </div>

      {/* Strategy comparison chart */}
      <div className="card p-4">
        <SectionHeading sub="Normalised for display — actual values on Strategy Comparison page">
          Strategy Comparison Overview
        </SectionHeading>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={comparisonData} margin={{ top: 8, right: 24, left: 16, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a3347" />
            <XAxis dataKey="metric" tick={{ fill: '#8892a4', fontSize: 11 }} />
            <YAxis tick={{ fill: '#8892a4', fontSize: 11 }} />
            <Tooltip
              contentStyle={{ backgroundColor: '#161b25', border: '1px solid #2a3347', borderRadius: 6 }}
              labelStyle={{ color: '#e8ecf4', fontSize: 12 }}
              itemStyle={{ fontSize: 11 }}
              formatter={(v: number, name: string) => [v.toFixed(2), STRATEGY_LABELS[name] ?? name]}
            />
            <Legend formatter={s => STRATEGY_LABELS[s] ?? s} />
            {strategies.map(s => (
              <Bar key={s} dataKey={s} fill={STRATEGY_COLORS[s]} radius={[2, 2, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
        <button
          onClick={() => onNavigate('strategy')}
          className="btn-ghost mt-2 text-accent"
        >
          View full strategy comparison <ChevronRight size={14} />
        </button>
      </div>

      {/* Demand vs supply summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card p-4">
          <SectionHeading>Demand vs Supply</SectionHeading>
          <div className="flex flex-col gap-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-text-secondary">Total requests generated</span>
              <span className="font-mono text-text-primary">{fmt(m.requests_generated)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">Served</span>
              <span className="font-mono text-emerald-400">{fmt(m.requests_served)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">Unserved (timed out)</span>
              <span className="font-mono text-amber-400">{fmt(m.unserved_abandoned)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">Still in queue at end</span>
              <span className="font-mono text-red-400">{fmt(m.unserved_waiting_at_end)}</span>
            </div>
            <div className="flex justify-between mt-2 pt-2 border-t border-border">
              <span className="text-text-secondary">Fleet size</span>
              <span className="font-mono text-text-primary">{result.city.n_zones && result.strategies[primaryKey] ? `${m.requests_generated > 0 ? result.city.n_zones : '—'} zones` : '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">Repositioning moves</span>
              <span className="font-mono text-text-primary">{fmt(m.moves_made)}</span>
            </div>
          </div>
        </div>

        {/* Config summary */}
        <div className="card p-4">
          <SectionHeading>Run Configuration</SectionHeading>
          <div className="flex flex-col gap-1.5 text-sm">
            {[
              ['Seed', result.seed],
              ['Zones', result.city.n_zones],
              ['Grid', `${result.city.rows}×${result.city.cols}`],
              ['n_runs', result.n_runs],
              ['Mode', result.mode === 'batch' ? 'Batch (statistical)' : 'Single run'],
              ['Strategies compared', Object.keys(result.strategies).join(', ')],
            ].map(([k, v]) => (
              <div key={k as string} className="flex justify-between">
                <span className="text-text-secondary">{k}</span>
                <span className="font-mono text-text-primary">{String(v)}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2 flex-wrap">
            <button onClick={() => onNavigate('city')} className="btn-ghost text-xs text-accent">
              Zone map <ChevronRight size={12} />
            </button>
            <button onClick={() => onNavigate('results')} className="btn-ghost text-xs text-accent">
              Full analysis <ChevronRight size={12} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
