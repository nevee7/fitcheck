"""Image validation, storage, thumbnailing, and safe deletion."""
import io
import re
import threading
from pathlib import Path
from typing import Tuple
from uuid import uuid4

from PIL import Image, ImageOps

from . import config

# Serialises uploads and folder scans so a half-written file is never imported.
UPLOAD_LOCK = threading.RLock()

_EXT_BY_FORMAT = {
    "JPEG": ".jpg",
    "PNG": ".png",
    "WEBP": ".webp",
    "GIF": ".gif",
}


class ImageValidationError(ValueError):
    """Raised for uploads the user can fix (wrong type, too large, corrupt)."""


def _validate_extension(filename: str) -> None:
    suffix = Path(filename or "").suffix.lower()
    if suffix in (".heic", ".heif"):
        raise ImageValidationError(
            "HEIC/HEIF images are not supported. Export the photo as JPG or PNG first."
        )
    if suffix not in config.ALLOWED_EXTENSIONS:
        raise ImageValidationError(
            "Unsupported file type. Use JPG, PNG, WEBP, or GIF."
        )


def _prepare_thumbnail(image: Image.Image) -> Image.Image:
    image = ImageOps.exif_transpose(image)
    if image.mode in ("RGBA", "LA", "P"):
        rgba = image.convert("RGBA")
        background = Image.new("RGB", rgba.size, (18, 19, 22))
        background.paste(rgba, mask=rgba.split()[-1])
        return background
    return image.convert("RGB")


def _write_thumbnail(source_path: Path, thumb_path: Path, image: Image.Image) -> None:
    """Write the catalog cutout if possible, otherwise a plain photo thumbnail."""
    try:
        from tools import digitize_thumbs

        wrote, _ = digitize_thumbs.render_catalog_thumb(source_path, thumb_path)
        if wrote:
            return
    except Exception:
        # Vision or the Swift toolchain is unavailable: keep the app working.
        pass

    thumb = _prepare_thumbnail(image)
    thumb.thumbnail(config.THUMB_MAX_SIZE, Image.LANCZOS)
    thumb.save(thumb_path, format="JPEG", quality=86, optimize=True)


def save_image(
    data: bytes, item_type: str, weather: str, original_filename: str
) -> Tuple[str, str]:
    """Validate image bytes, save the original and a thumbnail.

    Files land in ``uploads/<type>/<weather>/``. Returns (relative_path,
    relative_thumb_path), both relative to UPLOAD_DIR.
    """
    _validate_extension(original_filename)

    if not data:
        raise ImageValidationError("The selected file is empty.")
    if len(data) > config.MAX_UPLOAD_BYTES:
        raise ImageValidationError("Image is larger than 10 MB.")

    try:
        probe = Image.open(io.BytesIO(data))
        probe.verify()
        image = Image.open(io.BytesIO(data))
        image.load()
    except Exception:
        raise ImageValidationError(
            "That file isn't a readable image. Try a JPG, PNG, WEBP, or GIF."
        )

    image_format = (image.format or "").upper()
    extension = _EXT_BY_FORMAT.get(image_format)
    if extension is None:
        raise ImageValidationError(
            "Unsupported image format. Use JPG, PNG, WEBP, or GIF."
        )

    folder = config.UPLOAD_DIR / item_type / weather
    folder.mkdir(parents=True, exist_ok=True)

    stem = uuid4().hex
    original_name = stem + extension
    thumb_name = stem + "_thumb.jpg"
    original_path = folder / original_name
    thumb_path = folder / thumb_name

    try:
        original_path.write_bytes(data)
        _write_thumbnail(original_path, thumb_path, image)
    except Exception:
        original_path.unlink(missing_ok=True)
        thumb_path.unlink(missing_ok=True)
        raise ImageValidationError("Could not process that image. Try another file.")

    return (
        str(Path(item_type) / weather / original_name),
        str(Path(item_type) / weather / thumb_name),
    )


def import_existing_image(
    original_path: Path, relative_path: str
) -> Tuple[str, str]:
    """Validate a file already inside UPLOAD_DIR and create its thumbnail.

    Used when the user drops files straight into the weather folders. The
    original file is left where it is; only the thumbnail is written.
    """
    _validate_extension(original_path.name)

    try:
        size = original_path.stat().st_size
    except OSError:
        raise ImageValidationError("Could not read that file.")
    if size == 0:
        raise ImageValidationError("The file is empty.")
    if size > config.MAX_UPLOAD_BYTES:
        raise ImageValidationError("Image is larger than 10 MB.")

    thumb_path = original_path.with_name(original_path.stem + "_thumb.jpg")
    thumb_relative = str(
        Path(relative_path).with_name(original_path.stem + "_thumb.jpg")
    )

    try:
        with Image.open(original_path) as probe:
            probe.verify()
        with Image.open(original_path) as image:
            image.load()
            _write_thumbnail(original_path, thumb_path, image)
    except Exception:
        thumb_path.unlink(missing_ok=True)
        raise ImageValidationError(
            "That file isn't a readable image. Try a JPG, PNG, WEBP, or GIF."
        )

    return relative_path, thumb_relative


def description_from_filename(filename: str) -> str:
    """Turn ``cream_cable-knit.jpg`` into a readable default description."""
    text = re.sub(r"[_-]+", " ", Path(filename).stem)
    text = " ".join(text.split())
    return text[:500]


def resolve_path(relative_path: str) -> Path:
    """Resolve a stored path, refusing anything outside the uploads root."""
    root = config.UPLOAD_DIR.resolve()
    candidate = (root / relative_path).resolve()
    if candidate != root and root not in candidate.parents:
        raise ValueError("Path escapes the uploads directory")
    return candidate


def delete_item_files(*relative_paths: str) -> None:
    """Best-effort deletion; a missing file never blocks a DB delete."""
    for relative_path in relative_paths:
        if not relative_path:
            continue
        try:
            path = resolve_path(relative_path)
        except ValueError:
            continue
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
