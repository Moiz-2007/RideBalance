import React, { useState } from 'react';
import CityZonesViz from '../components/CityZones';
import { EmptyState, Spinner, Select, Slider, SectionHeading, Note } from '../components/ui';
import type { SimulationResult } from '../types';
import { STRATEGY_LABELS } from '../types';

interface CityZonesPageProps {
  result: SimulationResult | null;
  loading: boolean;
}

export default function CityZonesPage({ result, loading }: CityZonesPageProps) {
  const [selectedStrategy, setSelectedStrategy] = useState('P');
  const [windowIndex, setWindowIndex] = useState(0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size={28} />
        <span className="ml-3 text-text-secondary text-sm">Running simulation…</span>
      </div>
    );
  }

  if (!result) {
    return (
      <EmptyState
        message="No simulation data yet"
        sub="Run a simulation from the Overview page to see the zone visualization."
      />
    );
  }

  const strategies = Object.keys(result.strategies);
  const currentStratResult = result.strategies[selectedStrategy] ?? result.strategies[strategies[0]];
  const decisions = currentStratResult?.decisions ?? [];
  const nWindows = decisions.length;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <SectionHeading sub="Abstract 4×4 grid — not real-world geography. Each zone is a synthetic demand cell.">
          City &amp; Zones
        </SectionHeading>
        <Note>
          This visualization shows the synthetic RideBalance city: a {result.city.rows}×{result.city.cols} grid of {result.city.n_zones} zones (Z00–Z{String(result.city.n_zones - 1).padStart(2, '0')}). Zone roles determine base demand weights. No real Ola/Uber data is used.
        </Note>
      </div>

      {/* Controls row */}
      <div className="flex flex-wrap gap-4 items-end">
        <Select
          label="Strategy"
          value={selectedStrategy}
          onChange={(v) => { setSelectedStrategy(v); setWindowIndex(0); }}
          options={strategies.map(s => ({ value: s, label: STRATEGY_LABELS[s] ?? s }))}
          className="min-w-[220px]"
        />
        {nWindows > 1 && (
          <Slider
            label="Decision window"
            value={windowIndex}
            min={0}
            max={nWindows - 1}
            step={1}
            onChange={setWindowIndex}
            format={(v) => `Window ${v} (t=${v * (result.city ? 15 : 15)} min)`}
          />
        )}
      </div>

      <CityZonesViz
        city={result.city}
        decisions={decisions}
        strategy={selectedStrategy}
        windowIndex={windowIndex}
      />

      {/* Zone role summary */}
      <div className="card p-4">
        <SectionHeading>Zone Roles</SectionHeading>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {Object.entries(result.city.roles).map(([role, indices]) => (
            <div key={role} className="flex flex-col gap-1">
              <span className="label capitalize">{role}</span>
              <div className="flex flex-wrap gap-1">
                {(indices as number[]).map(idx => (
                  <span key={idx} className="font-mono text-xs text-text-primary bg-surface-200 px-1.5 py-0.5 rounded">
                    {result.city.ids[idx]}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
