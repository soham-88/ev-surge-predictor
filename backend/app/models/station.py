from datetime import datetime, timezone
from sqlalchemy import Column, Integer, Float, String, Boolean, DateTime
from sqlalchemy.orm import relationship
from app.core.database import Base


class Station(Base):
    __tablename__ = "stations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    code = Column(String, unique=True, nullable=False, index=True)
    capacity_kw = Column(Float, nullable=False, default=250.0)
    warning_pct = Column(Float, nullable=False, default=65.0)
    critical_pct = Column(Float, nullable=False, default=80.0)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    timezone = Column(String, nullable=False, default="Asia/Kolkata")
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)

    incidents = relationship("Incident", back_populates="station", cascade="all, delete-orphan")
