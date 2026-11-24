"""
FastAPI Router for Vehicle-Adjusted Tariff endpoints.
"""

from typing import Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.core.security import get_current_user
from app.models.user import User
from app.services.vehicle_tariff import (
    VEHICLE_TARIFF_TABLE,
    calculate_vehicle_adjusted_tariff,
    get_tariff_curve_data,
)

router = APIRouter(prefix="/api/v1/tariff", tags=["tariff"])


class VehicleAdjustedTariffRequest(BaseModel):
    base_surge_multiplier: float = Field(..., ge=0.5, le=5.0, description="Base surge multiplier (allowed: 0.5x to 5.0x)")
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


@router.get("/curve")
async def get_tariff_curve(current_user: User = Depends(get_current_user)):
    """Retrieve dynamic tariff curve points and bands across 0-100% capacity utilization."""
    return get_tariff_curve_data()

