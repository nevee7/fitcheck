"""Import images the user drops straight into the weather folders.

Files are never moved: ``uploads/top/hot/linen-shirt.jpg`` becomes a hot top,
``uploads/top/cold/...`` a cold top, and ``uploads/top/both/...`` a piece that
works in either forecast. The filename (minus extension, with underscores and
dashes turned into spaces) becomes the description.
"""
import logging
from pathlib import Path
from typing import Any, Dict, Iterator, Tuple

from . import config, db, images

log = logging.getLogger(__name__)


def _candidates() -> Iterator[Tuple[str, str, Path]]:
    for item_type in config.ITEM_TYPES:
        for weather in config.FOLDER_WEATHERS:
            folder = config.UPLOAD_DIR / item_type / weather
            try:
                entries = sorted(folder.iterdir(), key=lambda p: p.name.lower())
            except OSError:
                continue
            for path in entries:
                if not path.is_file() or path.name.startswith("."):
                    continue
                if path.stem.endswith("_thumb"):
                    continue
                if path.suffix.lower() not in config.ALLOWED_EXTENSIONS:
                    continue
                yield item_type, weather, path


def sync_uploads() -> Dict[str, Any]:
    """Register any new files found in the weather folders.

    Safe to call often: paths already in the database are left alone.
    """
    imported = 0
    skipped = 0
    errors = []

    with images.UPLOAD_LOCK:
        with db.db() as conn:
            known = {
                row["path"]
                for row in conn.execute("SELECT path FROM clothing_items").fetchall()
            }

            for item_type, weather, path in _candidates():
                relative = path.relative_to(config.UPLOAD_DIR).as_posix()
                if relative in known:
                    skipped += 1
                    continue

                try:
                    original_path, thumb_path = images.import_existing_image(
                        path, relative
                    )
                except images.ImageValidationError as exc:
                    errors.append({"file": relative, "error": str(exc)})
                    continue

                description = images.description_from_filename(path.name)
                cursor = conn.execute(
                    "INSERT OR IGNORE INTO clothing_items "
                    "(description, weather, type, path, thumb_path) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (description, weather, item_type, original_path, thumb_path),
                )
                if cursor.rowcount:
                    imported += 1
                    known.add(relative)
                else:
                    skipped += 1

    if errors:
        for entry in errors:
            log.warning("Skipped %s: %s", entry["file"], entry["error"])

    return {"imported": imported, "skipped": skipped, "errors": errors}
