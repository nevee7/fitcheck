"""Saved outfit endpoints: list, idempotent create, delete."""
from typing import List

from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import JSONResponse

from .. import config, db
from ..models import Outfit, OutfitCreate

router = APIRouter(prefix="/api/outfits", tags=["outfits"])

_TYPE_KEYS = (("top", "topId"), ("bottom", "bottomId"), ("shoes", "shoesId"))


@router.get("", response_model=List[Outfit])
def list_outfits():
    with db.db() as conn:
        return db.list_outfits(conn)


@router.post("", response_model=Outfit, status_code=201)
def create_outfit(payload: OutfitCreate):
    if payload.weather not in config.WEATHER_KINDS:
        raise HTTPException(400, "weather must be one of: cold, hot")

    ids = {
        "top": payload.topId,
        "bottom": payload.bottomId,
        "shoes": payload.shoesId,
    }

    with db.db() as conn:
        for item_type, item_id in ids.items():
            item = db.fetch_item(conn, item_id)
            if item is None:
                raise HTTPException(400, "Item %d does not exist" % item_id)
            if item["type"] != item_type:
                raise HTTPException(
                    400,
                    "Item %d is a %s, not a %s"
                    % (item_id, item["type"], item_type),
                )

        existing = conn.execute(
            "SELECT * FROM outfits "
            "WHERE top_id = ? AND bottom_id = ? AND shoes_id = ?",
            (payload.topId, payload.bottomId, payload.shoesId),
        ).fetchone()
        if existing is not None:
            outfit = db.fetch_outfit(conn, existing["id"])
            return JSONResponse(status_code=200, content=outfit)

        cursor = conn.execute(
            "INSERT INTO outfits (top_id, bottom_id, shoes_id, weather) "
            "VALUES (?, ?, ?, ?)",
            (payload.topId, payload.bottomId, payload.shoesId, payload.weather),
        )
        outfit = db.fetch_outfit(conn, cursor.lastrowid)
        return JSONResponse(status_code=201, content=outfit)


@router.delete("/{outfit_id}", status_code=204)
def delete_outfit(outfit_id: int):
    with db.db() as conn:
        cursor = conn.execute("DELETE FROM outfits WHERE id = ?", (outfit_id,))
        if cursor.rowcount == 0:
            raise HTTPException(404, "Outfit not found")
    return Response(status_code=204)
