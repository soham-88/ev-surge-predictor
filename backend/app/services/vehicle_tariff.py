"""
Vehicle-Adjusted Tariff Calculation Service.
Provides category-specific tariff adjustments based on EV charging characteristics.
"""

from typing import Any, Dict

VEHICLE_TARIFF_TABLE: Dict[str, Dict[str, Any]] = {
    "two_wheeler": {
        "label": "Two-Wheeler EV (e.g., Ola S1)",
        "avg_power_kw": 1.2,
        "multiplier": 0.85,
    },
    "standard_4w": {
        "label": "Standard 4W EV (e.g., Tata Nexon EV)",
        "avg_power_kw": 7.2,
        "multiplier": 1.00,
    },
    "fast_charging": {
        "label": "Fast-Charging EV (e.g., MG ZS EV DC)",
        "avg_power_kw": 45.0,
        "multiplier": 1.35,
    },
}

FALLBACK_CATEGORY = "standard_4w"


def calculate_vehicle_adjusted_tariff(base_multiplier: float, vehicle_type: str) -> dict:
    """
    Safely calculates vehicle-adjusted tariff multiplier.
    Falls back to 'standard_4w' if vehicle_type is invalid or missing.
    Guaranteed never to raise an exception.
    """
    try:
        try:
            base_mult = float(base_multiplier)
            # Security & logic guard: clamp multiplier to valid operating range [0.5, 5.0]
            base_mult = max(0.5, min(5.0, base_mult))
        except (TypeError, ValueError):
            base_mult = 1.0

        if not vehicle_type or not isinstance(vehicle_type, str):
            selected_type = FALLBACK_CATEGORY
        else:
            normalized = vehicle_type.strip().lower()
            if normalized in VEHICLE_TARIFF_TABLE:
                selected_type = normalized
            else:
                selected_type = FALLBACK_CATEGORY

        info = VEHICLE_TARIFF_TABLE.get(selected_type, VEHICLE_TARIFF_TABLE[FALLBACK_CATEGORY])
        vehicle_multiplier = info["multiplier"]
        final_tariff_multiplier = round(base_mult * vehicle_multiplier, 3)

        return {
            "vehicle_type": selected_type,
            "vehicle_label": info["label"],
            "avg_power_kw": info["avg_power_kw"],
            "base_surge_multiplier": base_mult,
            "vehicle_multiplier": vehicle_multiplier,
            "final_tariff_multiplier": final_tariff_multiplier,
        }
    except Exception:
        fallback_info = VEHICLE_TARIFF_TABLE[FALLBACK_CATEGORY]
        return {
            "vehicle_type": FALLBACK_CATEGORY,
            "vehicle_label": fallback_info["label"],
            "avg_power_kw": fallback_info["avg_power_kw"],
            "base_surge_multiplier": 1.0,
            "vehicle_multiplier": fallback_info["multiplier"],
            "final_tariff_multiplier": round(1.0 * fallback_info["multiplier"], 3),
        }


_CACHED_TARIFF_CURVE: Dict[str, Any] | None = None


def get_tariff_curve_data() -> dict:
    """
    Computes tariff multipliers across 0-100% capacity utilization directly from
    the optimizer surge and tariff policies, combined with vehicle category factors.
    Precomputed and cached for high performance.
    """
    global _CACHED_TARIFF_CURVE
    if _CACHED_TARIFF_CURVE is not None:
        return _CACHED_TARIFF_CURVE

    from app.models.optimizer import classify_surge, compute_tariff

    bands = [
        {
            "name": "Normal",
            "surge_status": "NORMAL",
            "min_pct": 0.0,
            "max_pct": 65.0,
            "base_multiplier": compute_tariff("NORMAL", 0.0),
            "multipliers": {
                cat: calculate_vehicle_adjusted_tariff(compute_tariff("NORMAL", 0.0), cat)["final_tariff_multiplier"]
                for cat in VEHICLE_TARIFF_TABLE
            },
        },
        {
            "name": "Warning",
            "surge_status": "WARNING",
            "min_pct": 65.0,
            "max_pct": 80.0,
            "base_multiplier": compute_tariff("WARNING", 65.0),
            "multipliers": {
                cat: calculate_vehicle_adjusted_tariff(compute_tariff("WARNING", 65.0), cat)["final_tariff_multiplier"]
                for cat in VEHICLE_TARIFF_TABLE
            },
        },
        {
            "name": "Critical",
            "surge_status": "CRITICAL",
            "min_pct": 80.0,
            "max_pct": 95.0,
            "base_multiplier": compute_tariff("CRITICAL", 80.0),
            "multipliers": {
                cat: calculate_vehicle_adjusted_tariff(compute_tariff("CRITICAL", 80.0), cat)["final_tariff_multiplier"]
                for cat in VEHICLE_TARIFF_TABLE
            },
        },
        {
            "name": "Severe",
            "surge_status": "CRITICAL",
            "min_pct": 95.0,
            "max_pct": 100.0,
            "base_multiplier": compute_tariff("CRITICAL", 95.0),
            "multipliers": {
                cat: calculate_vehicle_adjusted_tariff(compute_tariff("CRITICAL", 95.0), cat)["final_tariff_multiplier"]
                for cat in VEHICLE_TARIFF_TABLE
            },
        },
    ]

    points = []
    for pct in range(0, 101):
        pct_float = float(pct)
        surge = classify_surge(pct_float)
        base_mult = compute_tariff(surge, pct_float)
        points.append({
            "utilization_pct": pct,
            "surge_status": surge,
            "base_multiplier": base_mult,
            "two_wheeler": calculate_vehicle_adjusted_tariff(base_mult, "two_wheeler")["final_tariff_multiplier"],
            "standard_4w": calculate_vehicle_adjusted_tariff(base_mult, "standard_4w")["final_tariff_multiplier"],
            "fast_charging": calculate_vehicle_adjusted_tariff(base_mult, "fast_charging")["final_tariff_multiplier"],
        })

    categories = {
        key: {
            "key": key,
            "label": info["label"],
            "category_multiplier": info["multiplier"],
            "avg_power_kw": info["avg_power_kw"],
        }
        for key, info in VEHICLE_TARIFF_TABLE.items()
    }

    _CACHED_TARIFF_CURVE = {
        "bands": bands,
        "points": points,
        "categories": categories,
    }
    return _CACHED_TARIFF_CURVE

