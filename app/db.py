"""SQLite helpers and the database schema.

The schema mirrors the implementation plan: FKs are declared, but deletes are
orchestrated in application code so the UI can offer "replace or delete"
before an item disappears.
"""
import sqlite3
from contextlib import contextmanager
from typing import Any, Dict, Iterable, List, Optional

from . import config

_ITEMS_COLUMNS = """
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  description TEXT    NOT NULL DEFAULT '',
  weather     TEXT    NOT NULL CHECK (weather IN ('cold','hot','both')),
  type        TEXT    NOT NULL CHECK (type   IN ('top','bottom','shoes')),
  path        TEXT    NOT NULL UNIQUE,
  thumb_path  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
"""

SCHEMA = (
    "CREATE TABLE IF NOT EXISTS clothing_items (" + _ITEMS_COLUMNS + ");\n"
    "CREATE INDEX IF NOT EXISTS idx_items_type_weather"
    "  ON clothing_items(type, weather);\n"
    """
CREATE TABLE IF NOT EXISTS outfits (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  top_id     INTEGER NOT NULL REFERENCES clothing_items(id),
  bottom_id  INTEGER NOT NULL REFERENCES clothing_items(id),
  shoes_id   INTEGER NOT NULL REFERENCES clothing_items(id),
  weather    TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (top_id, bottom_id, shoes_id)
);

CREATE TABLE IF NOT EXISTS weather_cache (
  day          TEXT PRIMARY KEY,
  temperature  REAL,
  apparent     REAL,
  weather_code INTEGER,
  weather      TEXT,
  label        TEXT,
  source       TEXT,
  fetched_at   TEXT NOT NULL
);
"""
)


def ensure_dirs() -> None:
    """Create the upload root and one folder per category/weather."""
    config.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    for item_type in config.ITEM_TYPES:
        for weather in config.FOLDER_WEATHERS:
            (config.UPLOAD_DIR / item_type / weather).mkdir(
                parents=True, exist_ok=True
            )


def _migrate_item_weather(conn: sqlite3.Connection) -> None:
    """Allow weather='both' in databases created before it was supported."""
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'clothing_items'"
    ).fetchone()
    if row is None or "'both'" in (row[0] or ""):
        return

    # Build a replacement table, copy the rows, then swap it in. Foreign keys
    # are off in init_db(), so dropping the old table is safe here.
    conn.execute("CREATE TABLE clothing_items_new (" + _ITEMS_COLUMNS + ")")
    conn.execute(
        "INSERT INTO clothing_items_new "
        "(id, description, weather, type, path, thumb_path, created_at) "
        "SELECT id, description, weather, type, path, thumb_path, created_at "
        "FROM clothing_items"
    )
    conn.execute("DROP TABLE clothing_items")
    conn.execute("ALTER TABLE clothing_items_new RENAME TO clothing_items")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_items_type_weather "
        "ON clothing_items(type, weather)"
    )


def init_db() -> None:
    ensure_dirs()
    config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(config.DB_PATH))
    try:
        conn.executescript(SCHEMA)
        _migrate_item_weather(conn)
        conn.commit()
    finally:
        conn.close()


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(config.DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def db():
    """Transaction-scoped connection. Commits on success, rolls back on error."""
    conn = get_conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def item_to_dict(row: Optional[sqlite3.Row]) -> Optional[Dict[str, Any]]:
    if row is None:
        return None
    return {
        "id": row["id"],
        "description": row["description"],
        "weather": row["weather"],
        "type": row["type"],
        "path": row["path"],
        "thumbPath": row["thumb_path"],
        "createdAt": row["created_at"],
    }


def fetch_item(conn: sqlite3.Connection, item_id: int) -> Optional[Dict[str, Any]]:
    row = conn.execute(
        "SELECT * FROM clothing_items WHERE id = ?", (item_id,)
    ).fetchone()
    return item_to_dict(row)


def list_items(
    conn: sqlite3.Connection,
    item_type: Optional[str] = None,
    weather: Optional[str] = None,
) -> List[Dict[str, Any]]:
    clauses = []
    params: List[Any] = []
    if item_type:
        clauses.append("type = ?")
        params.append(item_type)
    if weather:
        if weather == "both":
            clauses.append("weather = 'both'")
        else:
            clauses.append("(weather = ? OR weather = 'both')")
            params.append(weather)
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
    rows = conn.execute(
        "SELECT * FROM clothing_items" + where + " ORDER BY id DESC", params
    ).fetchall()
    return [item_to_dict(row) for row in rows if row is not None]


def _items_by_id(
    conn: sqlite3.Connection, ids: Iterable[int]
) -> Dict[int, Dict[str, Any]]:
    unique = {int(i) for i in ids}
    if not unique:
        return {}
    placeholders = ",".join("?" for _ in unique)
    rows = conn.execute(
        "SELECT * FROM clothing_items WHERE id IN (%s)" % placeholders,
        tuple(unique),
    ).fetchall()
    result: Dict[int, Dict[str, Any]] = {}
    for row in rows:
        item = item_to_dict(row)
        if item is not None:
            result[item["id"]] = item
    return result


def outfit_to_dict(
    row: sqlite3.Row, item_map: Dict[int, Optional[Dict[str, Any]]]
) -> Dict[str, Any]:
    return {
        "id": row["id"],
        "createdAt": row["created_at"],
        "weather": row["weather"],
        "top": item_map.get(row["top_id"]),
        "bottom": item_map.get(row["bottom_id"]),
        "shoes": item_map.get(row["shoes_id"]),
    }


def list_outfits(conn: sqlite3.Connection) -> List[Dict[str, Any]]:
    rows = conn.execute("SELECT * FROM outfits ORDER BY id DESC").fetchall()
    ids: List[int] = []
    for row in rows:
        ids.extend((row["top_id"], row["bottom_id"], row["shoes_id"]))
    item_map: Dict[int, Optional[Dict[str, Any]]] = dict(_items_by_id(conn, ids))
    return [outfit_to_dict(row, item_map) for row in rows]


def fetch_outfit(
    conn: sqlite3.Connection, outfit_id: int
) -> Optional[Dict[str, Any]]:
    row = conn.execute("SELECT * FROM outfits WHERE id = ?", (outfit_id,)).fetchone()
    if row is None:
        return None
    item_map = _items_by_id(
        conn, (row["top_id"], row["bottom_id"], row["shoes_id"])
    )
    return outfit_to_dict(row, item_map)


def outfits_using_item(
    conn: sqlite3.Connection, item_id: int
) -> List[Dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM outfits "
        "WHERE top_id = ? OR bottom_id = ? OR shoes_id = ? "
        "ORDER BY id DESC",
        (item_id, item_id, item_id),
    ).fetchall()
    ids: List[int] = []
    for row in rows:
        ids.extend((row["top_id"], row["bottom_id"], row["shoes_id"]))
    item_map: Dict[int, Optional[Dict[str, Any]]] = dict(_items_by_id(conn, ids))
    return [outfit_to_dict(row, item_map) for row in rows]
