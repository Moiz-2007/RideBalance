import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  MapContainer,
  Rectangle,
  Polyline,
  Tooltip,
  Popup,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ROLE_COLORS, STRATEGY_COLORS } from '../types';
import type { CityInfo, DecisionWindow } from '../types';

// ── Types ──────────────────────────────────────────────────────────────────

interface LeafletCityMapProps {
  city: CityInfo;
  decisions: DecisionWindow[];
  strategy: string;
  windowIndex: number;
}

type ColorMode = 'demand' | 'risk' | 'idle' | 'incoming' | 'eff_supply' | 'role';

const COLOR_MODES: { id: ColorMode; label: string }[] = [
  { id: 'demand', label: 'Predicted Demand' },
  { id: 'risk', label: 'Shortage Risk' },
  { id: 'idle', label: 'Idle Drivers' },
  { id: 'incoming', label: 'Incoming Drivers' },
  { id: 'eff_supply', label: 'Effective Supply' },
  { id: 'role', label: 'Zone Roles' },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function heatColor(value: number, max: number): string {
  const t = max > 0 ? value / max : 0;
  const r = Math.round(lerp(16, 251, t));
  const g = Math.round(lerp(185, 191, t * 0.5));
  const b = Math.round(lerp(129, 36, t));
  return `rgb(${r},${g},${b})`;
}

function riskColor(risk: number): string {
  if (risk < 0.3) return '#10b981';
  if (risk < 0.6) return '#f59e0b';
  return '#ef4444';
}

function getZoneColor(
  idx: number,
  mode: ColorMode,
  decision: DecisionWindow | null,
  city: CityInfo,
): string {
  if (mode === 'role') {
    const role = city.role_of[idx];
    return ROLE_COLORS[role] ?? '#64748b';
  }
  if (!decision) return '#1e2535';

  const maxForecast = Math.max(...(decision.forecast.filter(Boolean) as number[]), 1);
  const maxIdle = Math.max(...decision.idle, 1);
  const maxIncoming = Math.max(...decision.incoming, 1);
  const maxEff = Math.max(...(decision.eff_supply.filter(Boolean) as number[]), 1);

  if (mode === 'demand') return heatColor(decision.forecast[idx] ?? 0, maxForecast);
  if (mode === 'risk') return riskColor(decision.risk[idx] ?? 0);
  if (mode === 'idle') return heatColor(decision.idle[idx], maxIdle);
  if (mode === 'incoming') return heatColor(decision.incoming[idx], maxIncoming);
  if (mode === 'eff_supply') return heatColor(decision.eff_supply[idx] ?? 0, maxEff);
  return '#1e2535';
}

function metricValue(idx: number, mode: ColorMode, d: DecisionWindow): string {
  switch (mode) {
    case 'demand':
      return (d.forecast[idx] ?? 0).toFixed(1);
    case 'risk':
      return ((d.risk[idx] ?? 0) * 100).toFixed(0) + '%';
    case 'idle':
      return String(d.idle[idx]);
    case 'incoming':
      return String(d.incoming[idx]);
    case 'eff_supply':
      return (d.eff_supply[idx] ?? 0).toFixed(1);
    default:
      return '';
  }
}

// ── Map controller for bounds & view synchronization ───────────────────────

function MapController({ bounds }: { bounds: L.LatLngBounds }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(bounds, { padding: [16, 16], animate: false });
  }, [map, bounds]);
  return null;
}

// ── Arrow head marker component ────────────────────────────────────────────

function ArrowHead({
  from,
  to,
  color,
}: {
  from: [number, number];
  to: [number, number];
  color: string;
}) {
  const map = useMap();
  const arrowRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    const dx = to[1] - from[1];
    const dy = to[0] - from[0];
    const angle = (Math.atan2(dx, dy) * 180) / Math.PI;

    // Place arrow head at 70% along the path towards destination
    const midLat = from[0] + (to[0] - from[0]) * 0.7;
    const midLng = from[1] + (to[1] - from[1]) * 0.7;

    const icon = L.divIcon({
      html: `<svg width="16" height="16" viewBox="0 0 16 16" style="transform: rotate(${angle}deg); filter: drop-shadow(0 1px 2px rgba(0,0,0,0.6));">
        <path d="M8,1 L15,15 L8,11 L1,15 Z" fill="${color}" opacity="0.95"/>
      </svg>`,
      className: '',
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });

    const marker = L.marker([midLat, midLng], { icon, interactive: false, zIndexOffset: 800 });
    marker.addTo(map);
    arrowRef.current = marker;

    return () => {
      if (arrowRef.current) {
        map.removeLayer(arrowRef.current);
      }
    };
  }, [map, from, to, color]);

  return null;
}

// ── Main component ─────────────────────────────────────────────────────────

export default function LeafletCityMap({
  city,
  decisions,
  strategy,
  windowIndex,
}: LeafletCityMapProps) {
  const [colorMode, setColorMode] = useState<ColorMode>('risk');
  const [selectedZone, setSelectedZone] = useState<number | null>(null);
  const [showMoves, setShowMoves] = useState(true);

  const decision = decisions[windowIndex] ?? null;

  // CRS.Simple coordinate space:
  // Each zone is 1 unit wide and high.
  // Row 0 is at top (high Lat), Row (rows-1) is at bottom (low Lat).
  const rows = city.rows;
  const cols = city.cols;
  const bounds = useMemo(() => L.latLngBounds([0, 0], [rows, cols]), [rows, cols]);

  const zoneCenter = (row: number, col: number): [number, number] => [
    rows - row - 0.5,
    col + 0.5,
  ];

  const zoneBounds = (row: number, col: number): L.LatLngBoundsExpression => [
    [rows - row - 1, col],
    [rows - row, col + 1],
  ];

  // Detect high demand or high shortage risk
  const avgForecast = useMemo(() => {
    if (!decision) return 0;
    const vals = decision.forecast.filter((v) => v != null) as number[];
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }, [decision]);

  const isHighDemand = (idx: number) =>
    decision && colorMode === 'demand' && (decision.forecast[idx] ?? 0) > avgForecast;
  const isHighRisk = (idx: number) =>
    decision && colorMode === 'risk' && (decision.risk[idx] ?? 0) > 0.6;

  // Compute accepted repositioning lines
  const moveLines = useMemo(() => {
    if (!decision || !showMoves) return [];
    return decision.moves
      .filter((m) => m.accepted)
      .map((mv) => {
        const [sr, sc] = city.rc[mv.src];
        const [dr, dc] = city.rc[mv.dst];
        const from = zoneCenter(sr, sc);
        const to = zoneCenter(dr, dc);
        return { from, to, mv };
      });
  }, [decision, showMoves, city.rc]);

  const arrowColor = STRATEGY_COLORS[strategy] ?? '#10b981';

  return (
    <div className="flex gap-6 flex-wrap lg:flex-nowrap">
      {/* Controls & Layer Selector */}
      <div className="flex flex-col gap-4 min-w-[210px]">
        <div>
          <span className="label block mb-2">Map Layer / Metric</span>
          <div className="flex flex-col gap-1">
            {COLOR_MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => setColorMode(m.id)}
                className={`text-left px-3 py-1.5 rounded text-xs transition-colors flex items-center justify-between ${
                  colorMode === m.id
                    ? 'bg-accent/20 text-accent border border-accent/40 font-medium'
                    : 'text-text-secondary hover:text-text-primary hover:bg-surface-200'
                }`}
              >
                <span>{m.label}</span>
                {colorMode === m.id && <span className="text-[10px] text-accent">●</span>}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={showMoves}
            onChange={(e) => setShowMoves(e.target.checked)}
            className="accent-accent cursor-pointer"
          />
          <span>Show repositioning flows ({decision?.moves.filter(m => m.accepted).length ?? 0})</span>
        </label>

        {/* Legend */}
        <div className="card-sm p-3 bg-surface-100 border border-border">
          <span className="label block mb-2">Layer Legend</span>
          {colorMode === 'role' ? (
            <div className="flex flex-col gap-1.5">
              {Object.entries(ROLE_COLORS).map(([role, color]) => (
                <div key={role} className="flex items-center gap-2 text-xs text-text-secondary">
                  <div className="w-3 h-3 rounded-xs shrink-0" style={{ backgroundColor: color }} />
                  <span className="capitalize">{role}</span>
                </div>
              ))}
            </div>
          ) : colorMode === 'risk' ? (
            <div className="flex flex-col gap-1.5 text-xs text-text-secondary">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-xs bg-emerald-500 shrink-0" /> Low Shortage (&lt;30%)
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-xs bg-amber-500 shrink-0" /> Medium Risk (30–60%)
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-xs bg-red-500 shrink-0" /> Severe Shortage (&gt;60%)
              </div>
            </div>
          ) : (
            <div className="space-y-1.5 text-xs text-text-secondary">
              <div className="flex items-center gap-2">
                <div className="h-2 flex-1 rounded bg-gradient-to-r from-[#10b981] via-[#fbbf24] to-[#f59e0b]" />
              </div>
              <div className="flex justify-between text-[10px] text-text-muted">
                <span>Low</span>
                <span>High</span>
              </div>
            </div>
          )}

          {/* Driver count marker key */}
          <div className="mt-3 pt-2 border-t border-border/60 text-[11px] text-text-muted space-y-1">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-text-secondary">Driver Supply Counts:</div>
            <div className="flex items-center gap-2">
              <span className="text-emerald-400 font-bold">● N</span>
              <span>Idle in zone</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-amber-400 font-bold">→ N</span>
              <span>Incoming en-route</span>
            </div>
          </div>
        </div>

        {/* Geofence notice */}
        <div className="text-[11px] text-text-muted leading-tight border-l-2 border-border pl-2.5">
          <strong className="text-text-secondary">Simulated Geofences:</strong> Cell boundaries represent simulated zones in a synthetic local coordinate system.
        </div>
      </div>

      {/* Leaflet Map Display */}
      <div className="flex-1 min-w-0">
        {/* Synthetic Disclaimer Banner */}
        <div className="flex items-center justify-between mb-2 px-3 py-1.5 rounded bg-surface-200 border border-border text-xs">
          <div className="flex items-center gap-2 text-amber-400 font-medium">
            <span>⚠</span>
            <span>SYNTHETIC CITY MAP — Synthetic Coordinate System (CRS.Simple) · Not Real Geography</span>
          </div>
          <span className="text-[11px] font-mono text-text-muted">
            {city.rows}×{city.cols} Grid · {city.n_zones} Simulated Geofences
          </span>
        </div>

        <div
          className="border border-border rounded overflow-hidden shadow-inner bg-surface"
          style={{ height: 500 }}
        >
          <MapContainer
            key={`map-${city.n_zones}`}
            crs={L.CRS.Simple}
            bounds={bounds}
            maxBounds={L.latLngBounds([-0.5, -0.5], [rows + 0.5, cols + 0.5])}
            maxBoundsViscosity={1.0}
            minZoom={-0.5}
            maxZoom={3.5}
            zoomSnap={0.25}
            zoomDelta={0.5}
            style={{ height: '100%', width: '100%', background: '#0f1117' }}
            attributionControl={false}
          >
            <MapController bounds={bounds} />

            {/* Simulated Zone Boundaries / Geofence Rectangles */}
            {city.rc.map(([row, col], idx) => {
              const color = getZoneColor(idx, colorMode, decision, city);
              const highlight = isHighDemand(idx) || isHighRisk(idx);
              const isSelected = selectedZone === idx;

              return (
                <Rectangle
                  key={`zone-${idx}-${colorMode}-${windowIndex}`}
                  bounds={zoneBounds(row, col)}
                  pathOptions={{
                    color: isSelected
                      ? '#ffffff'
                      : highlight
                        ? '#fbbf24'
                        : '#2a3347',
                    weight: isSelected ? 3 : highlight ? 2.5 : 1,
                    fillColor: color,
                    fillOpacity: 0.85,
                    dashArray: highlight && !isSelected ? '6,3' : undefined,
                  }}
                  eventHandlers={{
                    click: () => setSelectedZone(idx === selectedZone ? null : idx),
                  }}
                >
                  <Tooltip
                    direction="center"
                    permanent
                    className="zone-tooltip-transparent"
                  >
                    <div style={{ textAlign: 'center', lineHeight: 1.25, pointerEvents: 'none' }}>
                      <div
                        style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 11,
                          fontWeight: 700,
                          color: 'rgba(255,255,255,0.95)',
                          letterSpacing: '0.04em',
                        }}
                      >
                        {city.ids[idx]}
                      </div>
                      <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.6)', textTransform: 'capitalize' }}>
                        {city.role_of[idx]}
                      </div>
                      {decision && colorMode !== 'role' && (
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            fontFamily: "'JetBrains Mono', monospace",
                            color: 'rgba(255,255,255,0.98)',
                            marginTop: 2,
                            textShadow: '0 1px 3px rgba(0,0,0,0.8)',
                          }}
                        >
                          {metricValue(idx, colorMode, decision)}
                        </div>
                      )}
                      {decision && (decision.idle[idx] > 0 || decision.incoming[idx] > 0) && (
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', fontSize: 9, marginTop: 2 }}>
                          {decision.idle[idx] > 0 && (
                            <span style={{ color: '#10b981', fontWeight: 600 }}>●{decision.idle[idx]}</span>
                          )}
                          {decision.incoming[idx] > 0 && (
                            <span style={{ color: '#f59e0b', fontWeight: 600 }}>→{decision.incoming[idx]}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </Tooltip>
                  <Popup>
                    <div style={{ minWidth: 200, color: '#e8ecf4', fontSize: 12, lineHeight: 1.6 }}>
                      <div style={{ fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", marginBottom: 2 }}>
                        {city.ids[idx]}{' '}
                        <span style={{ fontWeight: 400, fontSize: 10, textTransform: 'capitalize', color: ROLE_COLORS[city.role_of[idx]] }}>
                          ({city.role_of[idx]})
                        </span>
                      </div>
                      <div style={{ fontSize: 10, color: '#8892a4', marginBottom: 8, borderBottom: '1px solid #2a3347', paddingBottom: 4 }}>
                        Simulated Geofence · Row {row}, Col {col}
                      </div>
                      {decision ? (
                        <table style={{ width: '100%', fontSize: 11 }}>
                          <tbody>
                            {([
                              ['Predicted demand', (decision.forecast[idx] ?? 0).toFixed(2)],
                              ['Actual demand', String(decision.actual[idx] ?? 0)],
                              ['Idle drivers', String(decision.idle[idx])],
                              ['Incoming (en-route)', String(decision.incoming[idx])],
                              ['Effective supply', (decision.eff_supply[idx] ?? 0).toFixed(2)],
                              ['Shortage risk', ((decision.risk[idx] ?? 0) * 100).toFixed(1) + '%'],
                              ['Moves out', String(decision.moves_out[idx])],
                              ['Moves in', String(decision.moves_in[idx])],
                            ] as [string, string][]).map(([label, value]) => (
                              <tr key={label}>
                                <td style={{ color: '#8892a4', paddingRight: 8, paddingBottom: 2 }}>{label}</td>
                                <td style={{ fontFamily: "'JetBrains Mono', monospace", textAlign: 'right', fontWeight: 500 }}>
                                  {value}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        <div style={{ color: '#4d5a70' }}>No simulation decision for this window.</div>
                      )}
                    </div>
                  </Popup>
                </Rectangle>
              );
            })}

            {/* Repositioning Movement Arrows */}
            {moveLines.map(({ from, to, mv }, i) => (
              <React.Fragment key={`move-${i}`}>
                <Polyline
                  positions={[from, to]}
                  pathOptions={{
                    color: arrowColor,
                    weight: 2.5,
                    opacity: 0.65,
                    dashArray: '5,5',
                  }}
                />
                <ArrowHead from={from} to={to} color={arrowColor} />
              </React.Fragment>
            ))}
          </MapContainer>
        </div>

        <div className="flex justify-between items-center text-xs text-text-muted mt-2">
          <span>Click any zone to inspect actual simulation outputs.</span>
          {decision && (
            <span className="font-mono text-accent">
              Window {windowIndex} (t={decision.t}–{decision.t + 15} min) · {decision.moves.filter(m => m.accepted).length} repositioning moves accepted
            </span>
          )}
        </div>
      </div>

      {/* Zone Detail Side Panel */}
      {selectedZone !== null && (
        <div className="card p-4 min-w-[220px] max-w-xs shrink-0 animate-in fade-in duration-150">
          <div className="flex items-center justify-between mb-3 border-b border-border pb-2">
            <div className="flex items-center gap-2">
              <div
                className="w-3.5 h-3.5 rounded-xs"
                style={{ backgroundColor: ROLE_COLORS[city.role_of[selectedZone]] ?? '#64748b' }}
              />
              <div>
                <div className="font-mono font-bold text-sm text-text-primary">
                  {city.ids[selectedZone]}
                </div>
                <div className="text-[10px] text-text-secondary capitalize">
                  {city.role_of[selectedZone]} zone
                </div>
              </div>
            </div>
            <button
              onClick={() => setSelectedZone(null)}
              className="text-text-muted hover:text-text-primary text-xs p-1"
            >
              ✕
            </button>
          </div>

          <div className="text-[10px] text-text-muted mb-3 font-mono">
            Simulated Geofence · Row {city.rc[selectedZone][0]}, Col {city.rc[selectedZone][1]}
          </div>

          {decision ? (
            <div className="flex flex-col gap-1.5 text-xs">
              {([
                ['Predicted demand', (decision.forecast[selectedZone] ?? 0).toFixed(2)],
                ['Actual demand', (decision.actual[selectedZone] ?? 0).toFixed(0)],
                ['Idle drivers', decision.idle[selectedZone]],
                ['Incoming drivers', decision.incoming[selectedZone]],
                ['Effective supply', (decision.eff_supply[selectedZone] ?? 0).toFixed(2)],
                ['Shortage risk', ((decision.risk[selectedZone] ?? 0) * 100).toFixed(1) + '%'],
                ['Moves recommended out', decision.moves_out[selectedZone]],
                ['Moves recommended in', decision.moves_in[selectedZone]],
              ] as [string, string | number][]).map(([label, value]) => (
                <div key={label as string} className="flex justify-between gap-2 py-0.5 border-b border-border/40 last:border-0">
                  <span className="text-text-muted">{label}</span>
                  <span className="font-mono text-text-primary font-medium">{value}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-text-muted">No decision data for this window.</p>
          )}
        </div>
      )}
    </div>
  );
}
