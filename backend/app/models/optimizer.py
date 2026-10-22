"""
Rule-Based Dynamic Load-Shedding & Tariff Engine.
Computes surge status, tariff multipliers, and stall shedding decisions
based on predicted load vs. transformer capacity.
"""

from __future__ import annotations

from typing import List, Tuple

from app.core.config import (
    BASE_TARIFF_MULTIPLIER,
    CRITICAL_TARIFF_MULTIPLIER,
    NUM_STALLS,
    SEVERE_TARIFF_MULTIPLIER,
    SURGE_THRESHOLD_PCT,
    THROTTLE_PER_STALL_CAP_KW,
    TRANSFORMER_CAPACITY_KW,
    WARNING_TARIFF_MULTIPLIER,
    WARNING_THRESHOLD_PCT,
)


def classify_surge(capacity_pct: float) -> str:
    """Classify surge status from capacity utilization percentage."""
    if capacity_pct >= SURGE_THRESHOLD_PCT * 100:
        return "CRITICAL"
    elif capacity_pct >= WARNING_THRESHOLD_PCT * 100:
        return "WARNING"
    return "NORMAL"


def compute_tariff(surge_status: str, capacity_pct: float) -> float:
    """Compute dynamic tariff multiplier based on surge status."""
    if surge_status == "CRITICAL":
        if capacity_pct >= 95:
            return SEVERE_TARIFF_MULTIPLIER
        return CRITICAL_TARIFF_MULTIPLIER
    elif surge_status == "WARNING":
        return WARNING_TARIFF_MULTIPLIER
    return BASE_TARIFF_MULTIPLIER


def compute_shed_stalls(
    predicted_load_kw: float,
    active_plugs: int,
    forced_outage_stalls: List[int] | None = None,
) -> List[int]:
    """Determine which stalls to shed to bring load under threshold.

    Sheds highest-numbered active stalls first (simple priority scheme).
    """
    target_kw = TRANSFORMER_CAPACITY_KW * SURGE_THRESHOLD_PCT
    if predicted_load_kw <= target_kw:
        return forced_outage_stalls or []

    excess_kw = predicted_load_kw - target_kw
    # Assume even distribution across active plugs
    if active_plugs > 0:
        kw_per_plug = predicted_load_kw / active_plugs
    else:
        kw_per_plug = THROTTLE_PER_STALL_CAP_KW

    stalls_to_shed = max(1, int(excess_kw / kw_per_plug) + 1)

    # Build shed list from highest bay numbers down, excluding already-forced
    forced = set(forced_outage_stalls or [])
    available = [i for i in range(NUM_STALLS, 0, -1) if i not in forced]
    shed = list(forced) + available[:stalls_to_shed]

    return sorted(set(shed))


def compute_mitigations(
    predicted_load_kw: float,
    active_plugs: int,
    forced_outage_stalls: List[int] | None = None,
) -> dict:
    """Full mitigation policy: tariff + throttle + shed decisions."""
    capacity_pct = (predicted_load_kw / TRANSFORMER_CAPACITY_KW) * 100
    surge_status = classify_surge(capacity_pct)
    tariff = compute_tariff(surge_status, capacity_pct)
    throttle_active = surge_status in ("CRITICAL", "WARNING")

    shed_stalls = []
    if surge_status == "CRITICAL":
        shed_stalls = compute_shed_stalls(
            predicted_load_kw, active_plugs, forced_outage_stalls
        )

    return {
        "capacity_utilization_pct": round(capacity_pct, 2),
        "surge_status": surge_status,
        "dynamic_tariff_multiplier": tariff,
        "throttle_active": throttle_active,
        "per_stall_cap_kw": THROTTLE_PER_STALL_CAP_KW,
        "shed_stalls": shed_stalls,
    }
