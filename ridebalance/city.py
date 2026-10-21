"""Synthetic city grid. Zones are abstract cells, not real streets."""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np


@dataclass
class City:
    n_zones: int
    rows: int
    cols: int
    ids: list
    rc: np.ndarray            # (Z, 2) row/col of each zone
    dist_cells: np.ndarray    # (Z, Z) Manhattan distance in cells
    dist_km: np.ndarray       # (Z, Z)
    roles: dict               # role -> list of zone indices
    role_of: list             # zone index -> role label
    base_weight: np.ndarray   # (Z,) relative base demand, mean 1
    neighbors: list           # zone index -> array of adjacent zone indices

    def mask(self, role: str) -> np.ndarray:
        m = np.zeros(self.n_zones, dtype=bool)
        m[self.roles.get(role, [])] = True
        return m


ROLE_WEIGHT = {"business": 1.4, "station": 1.3, "residential": 1.0, "school": 0.9, "stadium": 0.7}


def build_city(n_zones: int, km_per_cell: float = 1.5) -> City:
    if n_zones < 4:
        raise ValueError("A city needs at least 4 zones.")
    Z = int(n_zones)
    cols = math.ceil(math.sqrt(Z))
    rows = math.ceil(Z / cols)
    rc = np.array([(i // cols, i % cols) for i in range(Z)])
    dist = np.abs(rc[:, None, :] - rc[None, :, :]).sum(-1)
    centre = np.array([(rows - 1) / 2, (cols - 1) / 2])
    d_centre = np.abs(rc - centre).sum(1)

    business = [int(np.argmin(d_centre))]
    used = set(business)

    def pick(key):
        cand = [i for i in range(Z) if i not in used]
        best = min(cand, key=key)
        used.add(best)
        return best

    if Z >= 16:
        business.append(pick(lambda i: (dist[business[0], i], i)))
    station = pick(lambda i: (dist[business[0], i], i))
    school = pick(lambda i: (-dist[business[0], i], i))
    stadium = pick(lambda i: (-dist[school, i], i))
    residential = [i for i in range(Z) if i not in used]

    roles = {"business": business, "station": [station], "school": [school],
             "stadium": [stadium], "residential": residential}
    role_of = ["residential"] * Z
    for r, idxs in roles.items():
        for i in idxs:
            role_of[i] = r
    w = np.array([ROLE_WEIGHT[r] for r in role_of], dtype=float)
    w = w / w.mean()
    neighbors = [np.flatnonzero(dist[i] == 1) for i in range(Z)]
    return City(Z, rows, cols, [f"Z{i:02d}" for i in range(Z)], rc, dist,
                dist * km_per_cell, roles, role_of, w, neighbors)
