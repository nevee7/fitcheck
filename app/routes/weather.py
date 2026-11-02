"""Weather endpoint. Every page load calls this; the service handles caching."""
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from ..models import WeatherResponse
from ..weather import get_weather

router = APIRouter(prefix="/api", tags=["weather"])


@router.get("/weather", response_model=WeatherResponse)
def weather(
    lat: Optional[float] = Query(None, ge=-90, le=90),
    lon: Optional[float] = Query(None, ge=-180, le=180),
):
    if (lat is None) != (lon is None):
        raise HTTPException(400, "Provide both lat and lon, or neither.")
    return get_weather(lat, lon)
