from fastapi import APIRouter, HTTPException, Depends
from app.core.security import get_current_user
from app.models.user import User
from app.core.weather_service import get_current_temperature
from app.core.config import CITY_NAME

router = APIRouter()

@router.get("/weather/current")
async def get_current_weather(current_user: User = Depends(get_current_user)):
    try:
        temp = get_current_temperature()
        return {
            "temperature_c": temp,
            "city": CITY_NAME,
            "source": "open-meteo"
        }
    except Exception as e:
        raise HTTPException(status_code=503, detail="Weather service unavailable")
