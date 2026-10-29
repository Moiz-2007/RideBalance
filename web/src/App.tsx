import React, { useState, useEffect } from 'react';
import {
  Activity,
  Layers,
  BarChart2,
  TrendingUp,
  FlaskConical,
  Award,
  BookOpen,
  Play,
  RotateCcw,
  Settings,
  AlertCircle,
  CheckCircle2,
  Sliders,
  ChevronDown,
  X,
} from 'lucide-react';
import { api } from './api';
import type { SimRequest, SimulationResult } from './types';
import Overview from './pages/Overview';
import CityZonesPage from './pages/CityZones';
import StrategyComparison from './pages/StrategyComparison';
import StatisticsPage from './pages/Statistics';
import ScenarioLab from './pages/ScenarioLab';
import ResultsPage from './pages/Results';
import Methodology from './pages/Methodology';
import { Spinner } from './components/ui';

type NavPage =
  | 'overview'
  | 'city'
  | 'strategy'
  | 'statistics'
  | 'scenario'
  | 'results'
  | 'methodology';

const NAV_ITEMS: { id: NavPage; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'city', label: 'City & Zones', icon: Layers },
  { id: 'strategy', label: 'Strategy Comparison', icon: BarChart2 },
  { id: 'statistics', label: 'Statistics', icon: TrendingUp },
  { id: 'scenario', label: 'Scenario Lab', icon: FlaskConical },
  { id: 'results', label: 'Results & Interpretation', icon: Award },
  { id: 'methodology', label: 'Method & Assumptions', icon: BookOpen },
];

const SCENARIO_OPTIONS = [
  { id: 'none', label: 'No scenario (standard base demand)' },
  { id: 'school', label: 'School / college dismissal' },
  { id: 'office', label: 'Office commute peaks' },
  { id: 'event', label: 'Sports, concerts & festivals' },
  { id: 'rain', label: 'Weather change (rain)' },
  { id: 'transit', label: 'Public-transport disruption' },
  { id: 'all', label: 'All 5 scenarios combined' },
];

export default function App() {
  const [activePage, setActivePage] = useState<NavPage>('overview');
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  // Simulation parameters
  const [nZones, setNZones] = useState(16);
  const [nDrivers, setNDrivers] = useState(60);
  const [durationMin, setDurationMin] = useState(120);
  const [decisionInterval, setDecisionInterval] = useState(15);
  const [demandIntensity, setDemandIntensity] = useState(0.5);
  const [seed, setSeed] = useState(42);
  const [selectedScenario, setSelectedScenario] = useState('none');
  const [scenarioSeverity, setScenarioSeverity] = useState(1.0);
  const [nRuns, setNRuns] = useState(1);

  // Execute simulation
  const runSimulation = async (customParams?: Partial<SimRequest>) => {
    setLoading(true);
    setError(null);

    let scenariosList: { name: string; severity: number }[] = [];
    if (selectedScenario === 'all') {
      scenariosList = [
        { name: 'school', severity: scenarioSeverity },
        { name: 'office', severity: scenarioSeverity },
        { name: 'event', severity: scenarioSeverity },
        { name: 'rain', severity: scenarioSeverity },
        { name: 'transit', severity: scenarioSeverity },
      ];
    } else if (selectedScenario !== 'none') {
      scenariosList = [{ name: selectedScenario, severity: scenarioSeverity }];
    }

    const payload: SimRequest = {
      n_zones: nZones,
      n_drivers: nDrivers,
      duration_min: durationMin,
      decision_interval: decisionInterval,
      demand_intensity: demandIntensity,
      seed,
      scenarios: scenariosList,
      combine_mode: 'multiplicative',
      strategies: ['B0', 'B1', 'B2', 'P'],
      n_runs: nRuns,
      ...customParams,
    };

    try {
      const res = await api.simulate(payload);
      setResult(res);
    } catch (err) {
      console.error('Simulation execution error:', err);
      setError(err instanceof Error ? err.message : 'Simulation failed to run.');
    } finally {
      setLoading(false);
    }
  };

  // Run initial simulation on load for seamless demonstration
  useEffect(() => {
    runSimulation();
  }, []);

  return (
    <div className="flex h-screen w-full bg-surface text-text-primary overflow-hidden font-sans">
      {/* ── Left Sidebar Navigation ── */}
      <aside className="w-64 border-r border-border bg-surface-100 flex flex-col shrink-0 select-none">
        {/* Brand */}
        <div className="p-5 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-accent">
              <Activity size={18} />
            </div>
            <div>
              <div className="font-bold tracking-tight text-text-primary text-base leading-none">
                RideBalance
              </div>
              <div className="text-[11px] text-text-muted mt-1 font-mono tracking-tight">
                Decision-Support v1.0
              </div>
            </div>
          </div>
        </div>

        {/* Nav Links */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activePage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActivePage(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-emerald-950/40 text-accent border-l-2 border-accent'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface-200'
                }`}
              >
                <Icon size={16} className={isActive ? 'text-accent' : 'text-text-muted'} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Sidebar Footer info */}
        <div className="p-4 border-t border-border bg-surface/50 text-[11px] text-text-muted space-y-1">
          <div className="flex items-center justify-between">
            <span>Synthetic City</span>
            <span className="font-mono text-text-secondary">4×4 (16 zones)</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Engine</span>
            <span className="font-mono text-accent">Python / FastAPI</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Fallback App</span>
            <span className="font-mono text-text-secondary">Streamlit intact</span>
          </div>
        </div>
      </aside>

      {/* ── Main Content Area ── */}
      <div className="flex-1 flex flex-col h-screen min-w-0 overflow-hidden">
        {/* Top Header */}
        <header className="h-16 border-b border-border bg-surface-100 px-6 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <span className="font-semibold text-text-primary text-sm">
              {NAV_ITEMS.find((n) => n.id === activePage)?.label}
            </span>

            {/* Status indicator */}
            <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-surface-200 border border-border text-xs">
              <span
                className={`w-2 h-2 rounded-full ${
                  loading ? 'bg-amber-400 animate-pulse' : result ? 'bg-emerald-400' : 'bg-slate-400'
                }`}
              />
              <span className="text-text-secondary text-[11px]">
                {loading ? 'Running simulation…' : result ? 'Ready / Synced' : 'Awaiting Run'}
              </span>
            </div>

            {/* Active scenario pill */}
            <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-200 text-xs text-text-secondary border border-border">
              <span className="text-text-muted text-[11px]">Scenario:</span>
              <span className="font-medium text-text-primary">
                {SCENARIO_OPTIONS.find((s) => s.id === selectedScenario)?.label.split('(')[0] || 'Base'}
              </span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowConfig(true)}
              className="btn-secondary text-xs py-1.5 px-3"
              title="Simulation parameters"
            >
              <Settings size={14} />
              <span>Config</span>
            </button>

            <button
              onClick={() => runSimulation()}
              disabled={loading}
              className="btn-primary text-xs py-1.5 px-4 font-semibold shadow-sm"
            >
              {loading ? (
                <>
                  <Spinner size={14} />
                  <span>Computing…</span>
                </>
              ) : (
                <>
                  <Play size={14} fill="currentColor" />
                  <span>Run Simulation</span>
                </>
              )}
            </button>
          </div>
        </header>

        {/* Global Error Banner if any */}
        {error && (
          <div className="bg-red-950/60 border-b border-red-800/60 px-6 py-2.5 text-xs text-red-300 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-white">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Body content scroll area */}
        <main className="flex-1 overflow-y-auto p-6 bg-surface">
          <div className="max-w-7xl mx-auto pb-12">
            {activePage === 'overview' && (
              <Overview
                result={result}
                loading={loading}
                onNavigate={(page) => setActivePage(page as NavPage)}
              />
            )}

            {activePage === 'city' && (
              <CityZonesPage result={result} loading={loading} />
            )}

            {activePage === 'strategy' && (
              <StrategyComparison result={result} loading={loading} />
            )}

            {activePage === 'statistics' && (
              <StatisticsPage result={result} loading={loading} />
            )}

            {activePage === 'scenario' && (
              <ScenarioLab
                nZones={nZones}
                nDrivers={nDrivers}
                durationMin={durationMin}
                seed={seed}
              />
            )}

            {activePage === 'results' && (
              <ResultsPage result={result} loading={loading} />
            )}

            {activePage === 'methodology' && <Methodology />}
          </div>
        </main>
      </div>

      {/* ── Slide-Over Config Drawer ── */}
      {showConfig && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs transition-opacity">
          <div className="w-96 bg-surface-100 border-l border-border h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold text-sm text-text-primary">
                <Sliders size={16} className="text-accent" />
                <span>Simulation Parameters</span>
              </div>
              <button
                onClick={() => setShowConfig(false)}
                className="text-text-muted hover:text-text-primary p-1 rounded"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 p-5 overflow-y-auto space-y-5 text-xs">
              {/* Fleet & Grid */}
              <div className="space-y-3">
                <span className="label block">Fleet &amp; City Grid</span>
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-text-secondary">Number of zones</span>
                    <span className="font-mono text-text-primary">{nZones} (4×4 grid)</span>
                  </div>
                  <input
                    type="range"
                    min="9"
                    max="25"
                    step="1"
                    value={nZones}
                    onChange={(e) => setNZones(Number(e.target.value))}
                    className="w-full accent-accent h-1.5 rounded cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-text-secondary">Number of drivers</span>
                    <span className="font-mono text-text-primary">{nDrivers}</span>
                  </div>
                  <input
                    type="range"
                    min="15"
                    max="150"
                    step="5"
                    value={nDrivers}
                    onChange={(e) => setNDrivers(Number(e.target.value))}
                    className="w-full accent-accent h-1.5 rounded cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-text-secondary">Simulation duration (min)</span>
                    <span className="font-mono text-text-primary">{durationMin} min (2h)</span>
                  </div>
                  <input
                    type="range"
                    min="60"
                    max="240"
                    step="30"
                    value={durationMin}
                    onChange={(e) => setDurationMin(Number(e.target.value))}
                    className="w-full accent-accent h-1.5 rounded cursor-pointer"
                  />
                </div>
              </div>

              {/* Demand & Scenario */}
              <div className="space-y-3 pt-3 border-t border-border">
                <span className="label block">Demand &amp; Scenario</span>

                <div>
                  <label className="text-text-secondary block mb-1">Active Scenario</label>
                  <select
                    value={selectedScenario}
                    onChange={(e) => setSelectedScenario(e.target.value)}
                    className="w-full bg-surface-200 border border-border rounded px-3 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent"
                  >
                    {SCENARIO_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedScenario !== 'none' && (
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-text-secondary">Scenario severity</span>
                      <span className="font-mono text-text-primary">{scenarioSeverity.toFixed(1)}×</span>
                    </div>
                    <input
                      type="range"
                      min="0.5"
                      max="3.0"
                      step="0.5"
                      value={scenarioSeverity}
                      onChange={(e) => setScenarioSeverity(Number(e.target.value))}
                      className="w-full accent-accent h-1.5 rounded cursor-pointer"
                    />
                  </div>
                )}

                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-text-secondary">Demand intensity (req/min/zone)</span>
                    <span className="font-mono text-text-primary">{demandIntensity.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0.2"
                    max="1.5"
                    step="0.1"
                    value={demandIntensity}
                    onChange={(e) => setDemandIntensity(Number(e.target.value))}
                    className="w-full accent-accent h-1.5 rounded cursor-pointer"
                  />
                </div>
              </div>

              {/* Statistical & Seed */}
              <div className="space-y-3 pt-3 border-t border-border">
                <span className="label block">Batch &amp; Randomness</span>

                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-text-secondary">Repeated runs (n_runs)</span>
                    <span className="font-mono text-text-primary">
                      {nRuns === 1 ? '1 (Single run)' : `${nRuns} (Batch with 95% CIs)`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="15"
                    step="1"
                    value={nRuns}
                    onChange={(e) => setNRuns(Number(e.target.value))}
                    className="w-full accent-accent h-1.5 rounded cursor-pointer"
                  />
                  <p className="text-[11px] text-text-muted mt-1">
                    Set n_runs ≥ 5 to generate confidence intervals and paired tests in the Statistics tab.
                  </p>
                </div>

                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-text-secondary">Random Seed</span>
                    <span className="font-mono text-text-primary">{seed}</span>
                  </div>
                  <input
                    type="number"
                    value={seed}
                    onChange={(e) => setSeed(Number(e.target.value))}
                    className="w-full bg-surface-200 border border-border rounded px-3 py-1.5 text-xs text-text-primary font-mono focus:outline-none focus:border-accent"
                  />
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-border flex gap-3">
              <button
                onClick={() => {
                  setShowConfig(false);
                  runSimulation();
                }}
                disabled={loading}
                className="btn-primary w-full justify-center text-xs"
              >
                Apply &amp; Re-run
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
