"""Central configuration for the wardrobe app.

Every path is absolute and resolved from the project root so the app can be
started from any working directory.
"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

DB_PATH = Path(os.environ.get("WARDROBE_DB", str(BASE_DIR / "wardrobe.db")))
UPLOAD_DIR = Path(os.environ.get("WARDROBE_UPLOAD_DIR", str(BASE_DIR / "uploads")))
STATIC_DIR = BASE_DIR / "static"
TEMPLATES_DIR = BASE_DIR / "templates"

# Temperature at or above this apparent temperature is considered "hot".
HOT_THRESHOLD = float(os.environ.get("WARDROBE_HOT_THRESHOLD", "18.0"))

# How long a weather reading stays fresh.
WEATHER_TTL_MINUTES = int(os.environ.get("WARDROBE_WEATHER_TTL_MINUTES", "30"))

# Uploads.
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
THUMB_MAX_SIZE = (600, 600)
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}

# Fallback location when neither the browser nor the IP lookup works.
DEFAULT_LAT = float(os.environ.get("WARDROBE_DEFAULT_LAT", "51.5072"))
DEFAULT_LON = float(os.environ.get("WARDROBE_DEFAULT_LON", "-0.1276"))
DEFAULT_LOCATION_LABEL = os.environ.get("WARDROBE_DEFAULT_LOCATION", "London")

HTTP_TIMEOUT = 5.0

ITEM_TYPES = ("top", "bottom", "shoes")

# Forecast kinds returned by the weather service.
WEATHER_KINDS = ("cold", "hot")

# Weather tags an item can carry. "both" means it works in either forecast.
ITEM_WEATHERS = ("cold", "hot", "both")

# Directories scanned for manually dropped files: uploads/<type>/<weather>/.
FOLDER_WEATHERS = ("hot", "cold", "both")
