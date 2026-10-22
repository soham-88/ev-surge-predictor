import time
import logging
import requests
from app.core import config

logger = logging.getLogger(__name__)

# Simple in-memory cache
_cache = {
    "temp_c": None,
    "timestamp": 0
}

CACHE_TTL = 600  # 10 minutes (600 seconds)

def get_current_temperature(lat: float = None, lon: float = None) -> float:
    """Fetch live temperature from Open-Meteo with a 10-minute cache."""
    global _cache
    
    lat = lat if lat is not None else config.CITY_LAT
    lon = lon if lon is not None else config.CITY_LON
    
    now = time.time()
    
    # Return from cache if valid
    if _cache["temp_c"] is not None and (now - _cache["timestamp"]) < CACHE_TTL:
        return _cache["temp_c"]
        
    try:
        url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m"
        resp = requests.get(url, timeout=5.0)
        resp.raise_for_status()
        data = resp.json()
        
        temp = data["current"]["temperature_2m"]
        
        # Update cache
        _cache["temp_c"] = float(temp)
        _cache["timestamp"] = now
        
        return _cache["temp_c"]
        
    except Exception as e:
        logger.warning(f"Failed to fetch live temperature from Open-Meteo: {e}")
        # If we have a stale cache, we can return it, otherwise raise
        if _cache["temp_c"] is not None:
            logger.info("Returning stale cached temperature.")
            return _cache["temp_c"]
        raise e
