"""
POST /api/v1/simulate
Executes user-driven stress tests by perturbing input vectors.
Generates a 3-hour forecast timeline (baseline vs. simulated).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import numpy as np
from fastapi import APIRouter, Depends
from app.core.security import require_operator
from app.models.user import User

from app.core.config import TRANSFORMER_CAPACITY_KW, SURGE_THRESHOLD_PCT
from app.models.ml_engine import engine
from app.models.optimizer import classify_surge, compute_tariff
from app.schemas.telemetry import (
    DispatchedMitigations,
    SimulateRequest,
    SimulateResponse,
    TimelinePoint,
)

router = APIRouter()


def _generate_baseline_profile(n_points: int = 7) -> list[float]:
    """Generate a realistic baseline load curve over 3 hours.

    Simulates a gentle afternoon ramp peaking around hour 2.
    """
    rng = np.random.default_rng(12345)
    base = np.linspace(140, 190, n_points)
    # Add a slight hump in the middle
    hump = 15 * np.exp(-0.5 * ((np.arange(n_points) - n_points * 0.65) / 1.5) ** 2)
    noise = rng.normal(0, 3, n_points)
    return list(np.clip(base + hump + noise, 80, 250).round(1))


@router.post("/simulate", response_model=SimulateResponse)
async def simulate(req: SimulateRequest, current_user: User = Depends(require_operator)) -> SimulateResponse:
    """Run what-if stress test with temperature, traffic, and outage perturbations."""

    sim_id = f"sim_{uuid.uuid4().hex[:5]}"
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)

    n_points = 7  # 30-min intervals over 3 hours
    baseline_profile = _generate_baseline_profile(n_points)

    # Apply perturbations to create simulated profile
    temp_uplift_kw = max(0, req.temp_delta_c * 3.5)  # ~3.5 kW per degree above delta
    traffic_uplift_kw = (req.traffic_surge_pct / 100.0) * 35.0  # up to 35 kW extra at 100%
    outage_penalty_kw = len(req.forced_outage_stalls) * 8.0  # redistributed load per shed bay

    total_uplift = temp_uplift_kw + traffic_uplift_kw + outage_penalty_kw

    # Uplift ramps in progressively (stress builds over time)
    ramp = np.linspace(0, 1.0, n_points)
    simulated_profile = [
        round(b + total_uplift * r, 1)
        for b, r in zip(baseline_profile, ramp)
    ]

    # Build timeline
    timeline = []
    for i in range(n_points):
        t = now + timedelta(minutes=30 * i)
        timeline.append(
            TimelinePoint(
                timestamp=t.isoformat(),
                baseline_kw=baseline_profile[i],
                simulated_kw=simulated_profile[i],
            )
        )

    baseline_peak = max(baseline_profile)
    simulated_peak = max(simulated_profile)

    # Peak time delta from now
    peak_idx = simulated_profile.index(simulated_peak)
    peak_time_delta_min = peak_idx * 30

    # Surge risk classification
    capacity_pct = (simulated_peak / TRANSFORMER_CAPACITY_KW) * 100
    surge_risk = classify_surge(capacity_pct)
    tariff = compute_tariff(surge_risk, capacity_pct)

    # Throttled stalls: if critical, throttle stalls near the forced ones
    throttled_stalls = []
    if surge_risk == "CRITICAL":
        # Throttle adjacent stalls to the forced outages
        all_stalls = set(range(1, 9))
        forced = set(req.forced_outage_stalls)
        available = sorted(all_stalls - forced)
        # Throttle up to 3 stalls
        throttled_stalls = available[:3]

    return SimulateResponse(
        simulation_id=sim_id,
        baseline_peak_kw=round(baseline_peak, 1),
        simulated_peak_kw=round(simulated_peak, 1),
        peak_time_delta_min=peak_time_delta_min,
        surge_risk=surge_risk,
        timeline=timeline,
        dispatched_mitigations=DispatchedMitigations(
            dynamic_tariff_multiplier=tariff,
            throttled_stalls=throttled_stalls,
        ),
    )
