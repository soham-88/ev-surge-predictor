"""
Station-local timezone resolution and conversion utilities.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo
import pandas as pd

from app.core.config import DEFAULT_STATION_TIMEZONE


def get_station_timezone(station_code: str = "MUM-01") -> str:
    """Read the station timezone from the stations table, falling back to config setting."""
    try:
        from app.core.database import SessionLocal
        from app.models.station import Station

        db = SessionLocal()
        try:
            station = db.query(Station).filter(Station.code == station_code).first()
            if station and station.timezone:
                return station.timezone
        finally:
            db.close()
    except Exception:
        pass
    return DEFAULT_STATION_TIMEZONE


def to_station_local(ts: Any, tz_name: str | None = None) -> Any:
    """Convert timestamp to station-local timezone.

    - If ts is timezone-aware, convert it to the station time zone with zoneinfo.
    - If ts is naive, treat it as already station-local and return it unchanged.
    - If ts is a pandas Series or DatetimeIndex, convert aware elements and keep naive unchanged.
    - If ts is an ISO string, parse it; if aware convert, if naive return naive datetime.
    """
    if tz_name is None:
        tz_name = get_station_timezone()

    tz = ZoneInfo(tz_name)

    # 1. Pandas Series
    if isinstance(ts, pd.Series):
        s = pd.to_datetime(ts)
        if s.dt.tz is not None:
            return s.dt.tz_convert(tz)
        return s

    # 2. Pandas DatetimeIndex
    if isinstance(ts, pd.DatetimeIndex):
        if ts.tz is not None:
            return ts.tz_convert(tz)
        return ts

    # 3. Python datetime (or pd.Timestamp)
    if isinstance(ts, datetime):
        if ts.tzinfo is not None and ts.tzinfo.utcoffset(ts) is not None:
            return ts.astimezone(tz)
        return ts

    # 4. ISO string
    if isinstance(ts, str):
        try:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00") if ts.endswith("Z") else ts)
            if dt.tzinfo is not None and dt.tzinfo.utcoffset(dt) is not None:
                return dt.astimezone(tz)
            return dt
        except Exception:
            return ts

    return ts
