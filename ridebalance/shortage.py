"""Probability model used by RideBalance (and by the app's shortage-risk display).

POISSON DISTRIBUTION WITH LOG-NORMAL DISTRIBUTION AND MONTE-CARLO DISTRIBUTION

ASSUMPTION (not validated on real data): demand D_z for one decision window is
a Poisson count whose mean is the forecast multiplied by a log-normal factor
with mean 1 and spread `sigma`. With sigma = 0 it reduces to a plain Poisson.
Probabilities are estimated by Monte-Carlo sampling ("empirical sampling").

Useful identities (S = effective supply, integer case):
    shortage risk          P(D > S)
    E[served]              E[min(D, S)]  = sum_{k<S} P(D > k)
    marginal service gain  E[min(D,S+1)] - E[min(D,S)] = P(D > S)
    expected idle drivers  E[(S - D)+]   = S - E[min(D, S)]
For fractional S (expected arrivals) E[min(D,S)] is linearly interpolated.
"""
from __future__ import annotations

import numpy as np
from scipy.stats import norm


class DemandModel:
    def __init__(self, mu, sigma: float, n_samples: int, rng, k_max: int):
        mu = np.asarray(mu, dtype=float)
        Z = len(mu)
        if sigma > 0:
            scale = np.exp(sigma * rng.standard_normal((n_samples, Z)) - sigma ** 2 / 2)
        else:
            scale = np.ones((n_samples, Z))
        self.samples = rng.poisson(mu[None, :] * scale)
        self.k_max = K = int(k_max)
        pmf = np.zeros((K + 2, Z))
        for z in range(Z):
            pmf[:, z] = np.bincount(np.minimum(self.samples[:, z], K + 1), minlength=K + 2) / n_samples
        self.tail = 1.0 - np.cumsum(pmf, axis=0)             # tail[k, z] = P(D_z > k)
        self.emin = np.zeros((K + 3, Z))
        self.emin[1:] = np.cumsum(self.tail, axis=0)         # emin[k, z] = E[min(D_z, k)]
        self._zidx = np.arange(Z)

    def shortage_risk(self, S) -> np.ndarray:
        S = np.clip(np.asarray(S, dtype=float), 0, self.k_max + 1)
        return self.tail[np.floor(S).astype(int), self._zidx]

    def expected_served(self, S) -> np.ndarray:
        S = np.clip(np.asarray(S, dtype=float), 0, self.k_max + 1)
        f = np.floor(S).astype(int)
        r = S - f
        return self.emin[f, self._zidx] * (1 - r) + self.emin[f + 1, self._zidx] * r


def arrival_prob(eta_min, deadline_min: float, cv: float):
    """P(a driver with nominal remaining time `eta_min` arrives within `deadline_min`).

    Remaining time is modelled as eta * X, X log-normal with mean 1 and the given cv.
    """
    eta = np.asarray(eta_min, dtype=float)
    if cv <= 0:
        return (eta <= deadline_min).astype(float) if eta.ndim else float(eta <= deadline_min)
    s2 = np.log(1 + cv ** 2)
    s = np.sqrt(s2)
    with np.errstate(divide="ignore", invalid="ignore"):
        p = norm.cdf((np.log(deadline_min / np.maximum(eta, 1e-9)) + s2 / 2) / s)
    p = np.where(eta <= 0, 1.0, p)
    return p if eta.ndim else float(p)
