from datetime import datetime, timezone
from sqlalchemy import Column, Integer, Float, String, DateTime
from app.core.database import Base


class Incident(Base):
    __tablename__ = "incidents"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True)
    surge_status = Column(String, nullable=False, index=True)  # 'WARNING' or 'CRITICAL'
    predicted_load_kw = Column(Float, nullable=False)
    capacity_utilization_pct = Column(Float, nullable=False)
    tariff_multiplier = Column(Float, nullable=False)
    throttled_bays_count = Column(Integer, default=0, nullable=False)
    shed_bays_count = Column(Integer, default=0, nullable=False)
    operator_username = Column(String, nullable=True)
