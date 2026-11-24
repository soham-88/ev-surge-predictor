from datetime import datetime, timezone
from sqlalchemy import Column, Integer, Float, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base


class Incident(Base):
    __tablename__ = "incidents"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    station_id = Column(Integer, ForeignKey("stations.id"), nullable=False, index=True)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True)
    surge_status = Column(String, nullable=False, index=True)  # 'WARNING' or 'CRITICAL'
    predicted_load_kw = Column(Float, nullable=False)
    capacity_utilization_pct = Column(Float, nullable=False)
    tariff_multiplier = Column(Float, nullable=False)
    throttled_bays_count = Column(Integer, default=0, nullable=False)
    shed_bays_count = Column(Integer, default=0, nullable=False)
    operator_username = Column(String, nullable=True)
    source = Column(String, nullable=False, default="LIVE")  # LIVE, SCENARIO, SANDBOX, SIMULATOR

    station = relationship("Station", back_populates="incidents")
