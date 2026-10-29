import React, { useState, useEffect, useRef } from 'react';
import { ROLE_COLORS, STRATEGY_COLORS } from '../types';
import type { CityInfo, DecisionWindow } from '../types';

interface CityZonesProps {
  city: CityInfo;
  decisions: DecisionWindow[];
  strategy: string;
  windowIndex: number;
}

type ColorMode = 'demand' | 'risk' | 'idle' | 'incoming' | 'eff_supply' | 'role';

const COLOR_MODES = [
  { id: 'demand', label: 'Predicted Demand' },
  { id: 'risk', label: 'Shortage Risk' },
  { id: 'idle', label: 'Idle Drivers' },
  { id: 'incoming', label: 'Incoming Drivers' },
  { id: 'eff_supply', label: 'Effective Supply' },
  { id: 'role', label: 'Zone Role' },
] as const;

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function heatColor(value: number, max: number): string {
  const t = max > 0 ? value / max : 0;
  // Dark teal → bright emerald → amber at high values
  const r = Math.round(lerp(16, 251, t));
  const g = Math.round(lerp(185, 191, t * 0.5));
  const b = Math.round(lerp(129, 36, t));
  return `rgb(${r},${g},${b})`;
}

function riskColor(risk: number): string {
  // green (low) → amber → red (high)
  if (risk < 0.3) return '#10b981';
  if (risk < 0.6) return '#f59e0b';
  return '#ef4444';
}

function getZoneColor(
  idx: number,
  mode: ColorMode,
  decision: DecisionWindow | null,
  city: CityInfo
): string {
  if (mode === 'role') {
    const role = city.role_of[idx];
    return ROLE_COLORS[role] ?? '#64748b';
  }
  if (!decision) return '#1e2535';

  const maxForecast = Math.max(...(decision.forecast.filter(Boolean) as number[]));
  const maxIdle = Math.max(...decision.idle, 1);
  const maxIncoming = Math.max(...decision.incoming, 1);
  const maxEff = Math.max(...(decision.eff_supply.filter(Boolean) as number[]), 1);

  if (mode === 'demand') {
    const v = decision.forecast[idx] ?? 0;
    return heatColor(v, maxForecast);
  }
  if (mode === 'risk') {
    const v = decision.risk[idx] ?? 0;
    return riskColor(v);
  }
  if (mode === 'idle') return heatColor(decision.idle[idx], maxIdle);
  if (mode === 'incoming') return heatColor(decision.incoming[idx], maxIncoming);
  if (mode === 'eff_supply') {
    const v = decision.eff_supply[idx] ?? 0;
    return heatColor(v, maxEff);
  }
  return '#1e2535';
}

export default function CityZones({ city, decisions, strategy, windowIndex }: CityZonesProps) {
  const [colorMode, setColorMode] = useState<ColorMode>('risk');
  const [selectedZone, setSelectedZone] = useState<number | null>(null);
  const [showMoves, setShowMoves] = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);

  const decision = decisions[windowIndex] ?? null;
  const CELL = 90;
  const PAD = 20;
  const W = city.cols * CELL + PAD * 2;
  const H = city.rows * CELL + PAD * 2;

  const cx = (col: number) => PAD + col * CELL + CELL / 2;
  const cy = (row: number) => PAD + row * CELL + CELL / 2;

  return (
    <div className="flex gap-6 flex-wrap lg:flex-nowrap">
      {/* Controls */}
      <div className="flex flex-col gap-4 min-w-[200px]">
        <div>
          <span className="label block mb-2">Colour by</span>
          <div className="flex flex-col gap-1">
            {COLOR_MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setColorMode(m.id as ColorMode)}
                className={`text-left px-3 py-1.5 rounded text-xs transition-colors ${
                  colorMode === m.id
                    ? 'bg-accent/20 text-accent border border-accent/40'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface-200'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={showMoves}
            onChange={(e) => setShowMoves(e.target.checked)}
            className="accent-accent"
          />
          Show moves
        </label>

        {/* Legend */}
        <div>
          <span className="label block mb-2">Legend</span>
          {colorMode === 'role' ? (
            <div className="flex flex-col gap-1.5">
              {Object.entries(ROLE_COLORS).map(([role, color]) => (
                <div key={role} className="flex items-center gap-2 text-xs text-text-secondary">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
                  {role.charAt(0).toUpperCase() + role.slice(1)}
                </div>
              ))}
            </div>
          ) : colorMode === 'risk' ? (
            <div className="flex flex-col gap-1.5 text-xs text-text-secondary">
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-sm bg-emerald-500" /> Low (&lt;30%)</div>
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-sm bg-amber-500" /> Medium</div>
              <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-sm bg-red-500" /> High (&gt;60%)</div>
            </div>
          ) : (
            <div className="text-xs text-text-muted">Darker = lower, brighter = higher</div>
          )}
        </div>
      </div>

      {/* SVG Grid */}
      <div className="flex-1 min-w-0">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full max-w-lg border border-border rounded bg-surface-200"
          style={{ aspectRatio: `${W}/${H}` }}
        >
          {/* Cells */}
          {city.rc.map(([row, col], idx) => {
            const color = getZoneColor(idx, colorMode, decision, city);
            const isSelected = selectedZone === idx;
            const role = city.role_of[idx];
            const movesOut = decision?.moves_out[idx] ?? 0;
            const movesIn = decision?.moves_in[idx] ?? 0;

            return (
              <g key={idx} onClick={() => setSelectedZone(idx === selectedZone ? null : idx)} className="cursor-pointer">
                <rect
                  x={PAD + col * CELL + 3}
                  y={PAD + row * CELL + 3}
                  width={CELL - 6}
                  height={CELL - 6}
                  rx={6}
                  fill={color}
                  fillOpacity={0.85}
                  stroke={isSelected ? '#ffffff' : '#2a3347'}
                  strokeWidth={isSelected ? 2.5 : 1}
                />
                {/* Zone ID */}
                <text
                  x={cx(col)}
                  y={cy(row) - 18}
                  textAnchor="middle"
                  fontSize={10}
                  fontWeight="600"
                  fill="rgba(255,255,255,0.9)"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {city.ids[idx]}
                </text>
                {/* Role */}
                <text
                  x={cx(col)}
                  y={cy(row) - 5}
                  textAnchor="middle"
                  fontSize={8}
                  fill="rgba(255,255,255,0.6)"
                >
                  {role}
                </text>
                {/* Metric value */}
                {decision && colorMode !== 'role' && (
                  <text
                    x={cx(col)}
                    y={cy(row) + 10}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight="700"
                    fill="rgba(255,255,255,0.95)"
                    fontFamily="JetBrains Mono, monospace"
                  >
                    {colorMode === 'demand' ? (decision.forecast[idx] ?? 0).toFixed(1) :
                     colorMode === 'risk' ? ((decision.risk[idx] ?? 0) * 100).toFixed(0) + '%' :
                     colorMode === 'idle' ? decision.idle[idx] :
                     colorMode === 'incoming' ? decision.incoming[idx] :
                     colorMode === 'eff_supply' ? (decision.eff_supply[idx] ?? 0).toFixed(1) : ''}
                  </text>
                )}
                {/* Move indicators */}
                {movesIn > 0 && (
                  <text x={cx(col) + 24} y={cy(row) + 22} fontSize={9} fill="#10b981" fontWeight="700">+{movesIn}</text>
                )}
                {movesOut > 0 && (
                  <text x={cx(col) - 32} y={cy(row) + 22} fontSize={9} fill="#f59e0b" fontWeight="700">-{movesOut}</text>
                )}
              </g>
            );
          })}

          {/* Move arrows */}
          {showMoves && decision && decision.moves.filter(m => m.accepted).map((mv, i) => {
            const [sr, sc] = city.rc[mv.src];
            const [dr, dc] = city.rc[mv.dst];
            const x1 = cx(sc), y1 = cy(sr), x2 = cx(dc), y2 = cy(dr);
            const mid_x = (x1 + x2) / 2, mid_y = (y1 + y2) / 2;
            return (
              <g key={i}>
                <defs>
                  <marker id={`arr-${i}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                    <path d="M0,0 L0,6 L6,3 z" fill={STRATEGY_COLORS[strategy] ?? '#10b981'} />
                  </marker>
                </defs>
                <line
                  x1={x1} y1={y1} x2={mid_x} y2={mid_y}
                  stroke={STRATEGY_COLORS[strategy] ?? '#10b981'}
                  strokeWidth={1.5}
                  strokeOpacity={0.6}
                  markerEnd={`url(#arr-${i})`}
                  strokeDasharray="4,2"
                />
              </g>
            );
          })}
        </svg>
        <p className="text-xs text-text-muted mt-2 text-center">
          Abstract 4×4 grid — not real geography. Click a cell to inspect.
          {decision && <> · Window {windowIndex} (t={decision.t}–{decision.t + 15} min)</>}
        </p>
      </div>

      {/* Zone detail panel */}
      {selectedZone !== null && (
        <div className="card p-4 min-w-[220px] max-w-xs">
          <div className="flex items-center gap-2 mb-3">
            <div
              className="w-4 h-4 rounded"
              style={{ backgroundColor: ROLE_COLORS[city.role_of[selectedZone]] ?? '#64748b' }}
            />
            <div>
              <div className="font-mono font-semibold text-sm text-text-primary">{city.ids[selectedZone]}</div>
              <div className="text-xs text-text-secondary capitalize">{city.role_of[selectedZone]}</div>
            </div>
          </div>
          {decision ? (
            <div className="flex flex-col gap-1.5 text-xs">
              {[
                ['Predicted demand', (decision.forecast[selectedZone] ?? 0).toFixed(2)],
                ['Actual demand', (decision.actual[selectedZone] ?? 0).toFixed(0)],
                ['Idle drivers', decision.idle[selectedZone]],
                ['Incoming (en route)', decision.incoming[selectedZone]],
                ['Effective supply', (decision.eff_supply[selectedZone] ?? 0).toFixed(2)],
                ['Shortage risk', ((decision.risk[selectedZone] ?? 0) * 100).toFixed(1) + '%'],
                ['Moves recommended out', decision.moves_out[selectedZone]],
                ['Moves recommended in', decision.moves_in[selectedZone]],
              ].map(([label, value]) => (
                <div key={label as string} className="flex justify-between gap-2">
                  <span className="text-text-muted">{label}</span>
                  <span className="font-mono text-text-primary">{value}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-muted">No decision data for this window.</p>
          )}
          <button
            onClick={() => setSelectedZone(null)}
            className="mt-3 text-xs text-text-muted hover:text-text-secondary"
          >
            ✕ Close
          </button>
        </div>
      )}
    </div>
  );
}
