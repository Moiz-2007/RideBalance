import React from 'react';
import { Info } from 'lucide-react';

// ── KPI Card ──────────────────────────────────────────────────────────────────
interface KpiCardProps {
  label: string;
  value: string | number | null;
  unit?: string;
  tooltip?: string;
  accent?: boolean;
  trend?: 'up' | 'down' | 'neutral';
  trendGood?: boolean; // is "up" good?
}

export function KpiCard({ label, value, unit, tooltip, accent }: KpiCardProps) {
  return (
    <div className={`card p-4 flex flex-col gap-1 ${accent ? 'border-accent/40' : ''}`}>
      <div className="flex items-center gap-1.5">
        <span className="label">{label}</span>
        {tooltip && (
          <span className="group relative">
            <Info size={12} className="text-text-muted cursor-help" />
            <span className="absolute z-50 bottom-full left-0 mb-1 w-56 p-2 bg-surface-300 border border-border rounded text-xs text-text-secondary hidden group-hover:block shadow-lg">
              {tooltip}
            </span>
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={`text-2xl font-bold font-mono ${accent ? 'text-accent' : 'text-text-primary'}`}>
          {value === null || value === undefined ? '—' : value}
        </span>
        {unit && <span className="text-xs text-text-secondary">{unit}</span>}
      </div>
    </div>
  );
}

// ── Section heading ───────────────────────────────────────────────────────────
export function SectionHeading({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-semibold text-text-primary">{children}</h2>
      {sub && <p className="text-xs text-text-secondary mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Loading spinner ───────────────────────────────────────────────────────────
export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg
      className="animate-spin text-accent"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.2" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
export function EmptyState({ message, sub }: { message: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-12 h-12 rounded-full bg-surface-200 flex items-center justify-center mb-3">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-text-muted">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <p className="text-sm text-text-secondary font-medium">{message}</p>
      {sub && <p className="text-xs text-text-muted mt-1 max-w-xs">{sub}</p>}
    </div>
  );
}

// ── Error box ─────────────────────────────────────────────────────────────────
export function ErrorBox({ message }: { message: string }) {
  return (
    <div className="rounded border border-red-800/50 bg-red-950/30 px-4 py-3 text-sm text-red-400">
      <strong>Error:</strong> {message}
    </div>
  );
}

// ── Strategy badge ────────────────────────────────────────────────────────────
const badgeCls: Record<string, string> = {
  B0: 'badge badge-B0',
  B1: 'badge badge-B1',
  B2: 'badge badge-B2',
  P: 'badge badge-P',
};

export function StrategyBadge({ key: k }: { key: string }) {
  return <span className={badgeCls[k] ?? 'badge bg-surface-200 text-text-secondary'}>{k}</span>;
}

// ── Stat row ──────────────────────────────────────────────────────────────────
export function StatRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string | number | null;
  highlight?: boolean;
}) {
  return (
    <div className={`flex justify-between items-center py-1.5 px-3 rounded text-sm ${highlight ? 'bg-accent/10' : ''}`}>
      <span className="text-text-secondary">{label}</span>
      <span className={`font-mono font-medium ${highlight ? 'text-accent' : 'text-text-primary'}`}>
        {value === null || value === undefined ? '—' : value}
      </span>
    </div>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────
export function ProgressBar({
  value,
  max = 1,
  color = 'bg-accent',
}: {
  value: number;
  max?: number;
  color?: string;
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="h-1.5 bg-surface-300 rounded-full overflow-hidden">
      <div className={`h-full ${color} transition-all duration-300`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ── Note / callout ────────────────────────────────────────────────────────────
export function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs text-text-muted bg-surface-200/50 rounded px-3 py-2 border-l-2 border-border">
      {children}
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
interface TabsProps {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}

export function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <div className="flex gap-1 border-b border-border mb-4">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors duration-150 -mb-px ${
            active === t.id
              ? 'border-accent text-accent'
              : 'border-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ── Select ────────────────────────────────────────────────────────────────────
interface SelectProps {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  label?: string;
  className?: string;
}

export function Select({ value, onChange, options, label, className = '' }: SelectProps) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && <span className="label">{label}</span>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-surface-200 border border-border rounded px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

// ── Range slider ──────────────────────────────────────────────────────────────
interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}

export function Slider({ label, value, min, max, step = 1, onChange, format }: SliderProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between">
        <span className="label">{label}</span>
        <span className="text-xs font-mono text-accent">{format ? format(value) : value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent h-1.5 rounded cursor-pointer"
      />
    </div>
  );
}
