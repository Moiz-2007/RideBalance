import type {
  ConfigDefaults,
  SimRequest,
  SimulationResult,
  SweepRequest,
  SweepResult,
} from './types';

const BASE = '/api';

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => fetchJSON<{ status: string; version: string }>(`${BASE}/health`),

  getDefaults: () => fetchJSON<ConfigDefaults>(`${BASE}/config/defaults`),

  simulate: (req: SimRequest): Promise<SimulationResult> =>
    fetchJSON(`${BASE}/simulate`, {
      method: 'POST',
      body: JSON.stringify(req),
    }),

  scenarioSweep: (req: SweepRequest): Promise<SweepResult> =>
    fetchJSON(`${BASE}/scenario-sweep`, {
      method: 'POST',
      body: JSON.stringify(req),
    }),
};
