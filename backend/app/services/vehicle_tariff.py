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
