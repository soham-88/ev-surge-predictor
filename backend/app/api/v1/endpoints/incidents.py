"""
GET /api/v1/incidents
DELETE /api/v1/incidents
Persistent incident log for grid surge events.
"""

from __future__ import annotations

from typing import Optional
from fastapi import APIRouter, Depends, Query, HTTPException, status
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.security import get_current_user, require_operator
from app.models.user import User
from app.models.incident import Incident
from app.schemas.telemetry import IncidentHistoryResponse, IncidentItem

router = APIRouter()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@router.get("/incidents", response_model=IncidentHistoryResponse)
async def get_incident_history(
    limit: int = Query(50, ge=1, le=500),
    surge_status: Optional[str] = Query(None, pattern="^(WARNING|CRITICAL)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> IncidentHistoryResponse:
    """Retrieve logged surge incidents ordered by newest first."""
    query = db.query(Incident)
    if surge_status:
        query = query.filter(Incident.surge_status == surge_status)

    total = query.count()
    records = query.order_by(Incident.timestamp.desc()).limit(limit).all()

    return IncidentHistoryResponse(
        total=total,
        incidents=[
            IncidentItem(
                id=inc.id,
                timestamp=inc.timestamp.isoformat() if inc.timestamp else "",
                surge_status=inc.surge_status,
                predicted_load_kw=inc.predicted_load_kw,
                capacity_utilization_pct=inc.capacity_utilization_pct,
                tariff_multiplier=inc.tariff_multiplier,
                throttled_bays_count=inc.throttled_bays_count,
                shed_bays_count=inc.shed_bays_count,
                operator_username=inc.operator_username,
            )
            for inc in records
        ],
    )


@router.delete("/incidents", status_code=status.HTTP_200_OK)
async def clear_incident_history(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_operator),
):
    """Clear all logged incidents (Operator only)."""
    deleted_count = db.query(Incident).delete()
    db.commit()
    return {"message": "Incident history cleared", "deleted_count": deleted_count}
