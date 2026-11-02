"""Weather-aware outfit generation."""
import random
from typing import List, Optional

from fastapi import APIRouter, HTTPException

from .. import config, db
from ..models import GenerateRequest, GenerateResponse
from ..weather import get_weather

router = APIRouter(prefix="/api", tags=["generate"])


@router.post("/generate", response_model=GenerateResponse)
def generate(payload: GenerateRequest):
    if payload.weather is not None and payload.weather not in config.WEATHER_KINDS:
        raise HTTPException(400, "weather must be one of: cold, hot")

    weather = payload.weather
    if weather is None:
        reading = get_weather()
        weather = reading.get("weather") or "cold"

    exclude = payload.exclude or {}
    result = {}
    fallback_types: List[str] = []

    with db.db() as conn:
        for item_type in config.ITEM_TYPES:
            rows = conn.execute(
                "SELECT * FROM clothing_items "
                "WHERE type = ? AND (weather = ? OR weather = 'both')",
                (item_type, weather),
            ).fetchall()

            if not rows:
                rows = conn.execute(
                    "SELECT * FROM clothing_items WHERE type = ?", (item_type,)
                ).fetchall()
                if rows:
                    fallback_types.append(item_type)

            candidates = list(rows)
            excluded_id: Optional[int] = exclude.get(item_type)
            if excluded_id is not None and len(candidates) > 1:
                remaining = [r for r in candidates if r["id"] != excluded_id]
                if remaining:
                    candidates = remaining

            if candidates:
                result[item_type] = db.item_to_dict(random.choice(candidates))
            else:
                result[item_type] = None

    return {
        "top": result.get("top"),
        "bottom": result.get("bottom"),
        "shoes": result.get("shoes"),
        "weather": weather,
        "fallbackUsed": bool(fallback_types),
        "fallbackTypes": fallback_types,
    }
