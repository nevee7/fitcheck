"""Item (clothing piece) endpoints, including upload, replace, and delete."""
from typing import List, Optional

from fastapi import APIRouter, File, Form, HTTPException, Query, Response, UploadFile
from fastapi.responses import JSONResponse

from .. import config, db, images, importer
from ..models import (
    Item,
    OutfitSummary,
    ReplaceRequest,
    ReplaceResponse,
    SyncResult,
)

router = APIRouter(prefix="/api/items", tags=["items"])


def _validate_item_type(value: str) -> str:
    if value not in config.ITEM_TYPES:
        raise HTTPException(400, "type must be one of: top, bottom, shoes")
    return value


def _validate_weather(value: str) -> str:
    if value not in config.ITEM_WEATHERS:
        raise HTTPException(400, "weather must be one of: cold, hot, both")
    return value


@router.get("", response_model=List[Item])
def list_items(
    type: Optional[str] = Query(None),
    weather: Optional[str] = Query(None),
):
    # Pick up anything the user dropped into uploads/<type>/<weather>/.
    importer.sync_uploads()

    if type is not None:
        _validate_item_type(type)
    if weather is not None:
        _validate_weather(weather)
    with db.db() as conn:
        return db.list_items(conn, item_type=type, weather=weather)


@router.post("/sync", response_model=SyncResult)
def sync_uploads():
    """Scan the hot/cold/both folders and register new images."""
    return importer.sync_uploads()


@router.post("", response_model=Item, status_code=201)
async def create_item(
    file: UploadFile = File(...),
    description: str = Form(""),
    weather: str = Form(...),
    type: str = Form(...),
):
    _validate_item_type(type)
    _validate_weather(weather)
    description = (description or "").strip()[:500]

    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(400, "Please upload an image file.")

    chunks = bytearray()
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        chunks.extend(chunk)
        if len(chunks) > config.MAX_UPLOAD_BYTES:
            raise HTTPException(413, "Image is larger than 10 MB.")

    with images.UPLOAD_LOCK:
        try:
            original_path, thumb_path = images.save_image(
                bytes(chunks), type, weather, file.filename or ""
            )
        except images.ImageValidationError as exc:
            raise HTTPException(400, str(exc))

        try:
            with db.db() as conn:
                cursor = conn.execute(
                    "INSERT INTO clothing_items "
                    "(description, weather, type, path, thumb_path) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (description, weather, type, original_path, thumb_path),
                )
                row = conn.execute(
                    "SELECT * FROM clothing_items WHERE id = ?",
                    (cursor.lastrowid,),
                ).fetchone()
                return db.item_to_dict(row)
        except Exception:
            images.delete_item_files(original_path, thumb_path)
            raise


@router.get("/{item_id}", response_model=Item)
def get_item(item_id: int):
    with db.db() as conn:
        item = db.fetch_item(conn, item_id)
    if item is None:
        raise HTTPException(404, "Item not found")
    return item


@router.get("/{item_id}/outfits", response_model=List[OutfitSummary])
def item_outfits(item_id: int):
    with db.db() as conn:
        if db.fetch_item(conn, item_id) is None:
            raise HTTPException(404, "Item not found")
        outfits = db.outfits_using_item(conn, item_id)
    return [{"id": o["id"], "createdAt": o["createdAt"]} for o in outfits]


@router.post("/{item_id}/replace", response_model=ReplaceResponse)
def replace_item(item_id: int, payload: ReplaceRequest):
    with db.db() as conn:
        old = db.fetch_item(conn, item_id)
        replacement = db.fetch_item(conn, payload.replacementId)
        if old is None:
            raise HTTPException(404, "Item not found")
        if replacement is None:
            raise HTTPException(404, "Replacement item not found")
        if old["id"] == replacement["id"]:
            raise HTTPException(400, "Choose a different item to replace with.")
        if old["type"] != replacement["type"]:
            raise HTTPException(
                409,
                "Replacement must be the same type as the item being removed.",
            )

        affected = db.outfits_using_item(conn, item_id)
        column_by_type = {"top": "top_id", "bottom": "bottom_id", "shoes": "shoes_id"}
        replaced = 0
        updated_ids = []

        for outfit in affected:
            if outfit["top"] and outfit["top"]["id"] == item_id:
                column = column_by_type["top"]
            elif outfit["bottom"] and outfit["bottom"]["id"] == item_id:
                column = column_by_type["bottom"]
            else:
                column = column_by_type["shoes"]

            combo = [
                outfit["top"]["id"] if outfit["top"] else None,
                outfit["bottom"]["id"] if outfit["bottom"] else None,
                outfit["shoes"]["id"] if outfit["shoes"] else None,
            ]
            combo[("top_id", "bottom_id", "shoes_id").index(column)] = replacement["id"]

            duplicate = conn.execute(
                "SELECT id FROM outfits "
                "WHERE top_id = ? AND bottom_id = ? AND shoes_id = ? AND id != ?",
                (combo[0], combo[1], combo[2], outfit["id"]),
            ).fetchone()
            if duplicate is not None:
                # The substitute combination already exists; keep one copy.
                conn.execute("DELETE FROM outfits WHERE id = ?", (duplicate["id"],))

            cursor = conn.execute(
                "UPDATE outfits SET %s = ? WHERE id = ?" % column,
                (replacement["id"], outfit["id"]),
            )
            if cursor.rowcount:
                replaced += 1
                updated_ids.append(outfit["id"])

        db_updates = []
        for outfit_id in updated_ids:
            refreshed = db.fetch_outfit(conn, outfit_id)
            if refreshed is not None:
                db_updates.append(refreshed)

        return {"replaced": replaced, "outfits": db_updates}


@router.delete("/{item_id}", status_code=204)
def delete_item(item_id: int, force: bool = Query(False)):
    with db.db() as conn:
        item = db.fetch_item(conn, item_id)
        if item is None:
            raise HTTPException(404, "Item not found")

        affected = db.outfits_using_item(conn, item_id)
        if affected and not force:
            noun = "outfit" if len(affected) == 1 else "outfits"
            return JSONResponse(
                status_code=409,
                content={
                    "detail": "This %s is used in %d %s."
                    % (item["type"], len(affected), noun),
                    "affectedOutfits": affected,
                },
            )

        if affected:
            conn.execute(
                "DELETE FROM outfits "
                "WHERE top_id = ? OR bottom_id = ? OR shoes_id = ?",
                (item_id, item_id, item_id),
            )
        conn.execute("DELETE FROM clothing_items WHERE id = ?", (item_id,))

    images.delete_item_files(item["path"], item["thumbPath"] or "")
    return Response(status_code=204)
