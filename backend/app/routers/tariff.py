"""
FastAPI Router for Vehicle-Adjusted Tariff endpoints.
"""

from typing import Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.services.vehicle_tariff import (
    VEHICLE_TARIFF_TABLE,
    calculate_vehicle_adjusted_tariff,
)

router = APIRouter(prefix="/api/v1/tariff", tags=["tariff"])


class VehicleAdjustedTariffRequest(BaseModel):
    base_surge_multiplier: float = Field(..., description="Base surge multiplier")
    vehicle_type: Optional[str] = Field(default="standard_4w", description="Vehicle category: two_wheeler, standard_4w, or fast_charging")


@router.get("/vehicle-options")
async def get_vehicle_options():
    """Retrieve the vehicle tariff configuration table."""
    return VEHICLE_TARIFF_TABLE


@router.post("/vehicle-adjusted")
async def post_vehicle_adjusted(payload: VehicleAdjustedTariffRequest):
    """Calculate the vehicle-adjusted surge tariff multiplier."""
    return calculate_vehicle_adjusted_tariff(
        base_multiplier=payload.base_surge_multiplier,
        vehicle_type=payload.vehicle_type,
    )
