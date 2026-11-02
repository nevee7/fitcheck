"""Weather service: geolocation-aware, cached, and failure-tolerant.

The browser may pass coordinates (when geolocation was already granted). The
server falls back to an IP lookup and finally to configured default
coordinates. Readings are cached per local day and reused for
WEATHER_TTL_MINUTES; an outage serves the last cached reading with stale=True.
"""
import json
from datetime import date, datetime, timezone
from typing import Any, Dict, Iterator, Optional, Tuple
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from . import config, db

# WMO weather codes -> (label, emoji)
WMO_CODES: Dict[int, Tuple[str, str]] = {
    0: ("Clear sky", "\u2600\ufe0f"),
    1: ("Mainly clear", "\U0001f324\ufe0f"),
    2: ("Partly cloudy", "\u26c5"),
    3: ("Overcast", "\u2601\ufe0f"),
    45: ("Fog", "\U0001f32b\ufe0f"),
    48: ("Rime fog", "\U0001f32b\ufe0f"),
    51: ("Light drizzle", "\U0001f326\ufe0f"),
    53: ("Drizzle", "\U0001f326\ufe0f"),
    55: ("Heavy drizzle", "\U0001f326\ufe0f"),
    56: ("Freezing drizzle", "\U0001f327\ufe0f"),
    57: ("Freezing drizzle", "\U0001f327\ufe0f"),
    61: ("Light rain", "\U0001f327\ufe0f"),
    63: ("Rain", "\U0001f327\ufe0f"),
    65: ("Heavy rain", "\U0001f327\ufe0f"),
    66: ("Freezing rain", "\U0001f327\ufe0f"),
    67: ("Freezing rain", "\U0001f327\ufe0f"),
    71: ("Light snow", "\u2744\ufe0f"),
    73: ("Snow", "\u2744\ufe0f"),
    75: ("Heavy snow", "\u2744\ufe0f"),
    77: ("Snow grains", "\u2744\ufe0f"),
    80: ("Light showers", "\U0001f326\ufe0f"),
    81: ("Rain showers", "\U0001f327\ufe0f"),
    82: ("Violent showers", "\u26c8\ufe0f"),
    85: ("Snow showers", "\U0001f328\ufe0f"),
    86: ("Heavy snow showers", "\U0001f328\ufe0f"),
    95: ("Thunderstorm", "\u26c8\ufe0f"),
    96: ("Thunderstorm & hail", "\u26c8\ufe0f"),
    99: ("Thunderstorm & hail", "\u26c8\ufe0f"),
}


def describe_code(code: Optional[int]) -> Tuple[str, str]:
    if code is None:
        return ("Unknown", "\U0001f321\ufe0f")
    return WMO_CODES.get(int(code), ("Unknown", "\U0001f321\ufe0f"))


def classify(apparent: Optional[float], temperature: Optional[float]) -> str:
    """Map a temperature to the two wardrobe bands."""
    value = apparent if apparent is not None else temperature
    if value is None:
        return "cold"
    return "hot" if value >= config.HOT_THRESHOLD else "cold"


def _get_json(url: str) -> Any:
    request = Request(
        url,
        headers={
            "User-Agent": "Fitcheck/0.1 (local digital wardrobe)",
            "Accept": "application/json",
        },
    )
    with urlopen(request, timeout=config.HTTP_TIMEOUT) as response:
        return json.loads(response.read().decode("utf-8"))


def ip_lookup() -> Tuple[float, float]:
    """Best-effort city-level coordinates. Raises on failure."""
    data = _get_json("https://ipapi.co/json/")
    if not isinstance(data, dict) or data.get("error"):
        raise ValueError("IP lookup failed")
    lat = data.get("latitude")
    lon = data.get("longitude")
    if lat is None or lon is None:
        raise ValueError("IP lookup returned no coordinates")
    return float(lat), float(lon)


def fetch_open_meteo(lat: float, lon: float) -> Dict[str, Any]:
    query = urlencode(
        {
            "latitude": lat,
            "longitude": lon,
            "current": "temperature_2m,apparent_temperature,weather_code",
            "timezone": "auto",
        }
    )
    data = _get_json("https://api.open-meteo.com/v1/forecast?" + query)
    current = (data or {}).get("current") or {}
    temperature = current.get("temperature_2m")
    apparent = current.get("apparent_temperature")
    code = current.get("weather_code")
    if temperature is None and apparent is None:
        raise ValueError("Open-Meteo returned no temperature")
    label, _emoji = describe_code(code)
    weather = classify(apparent, temperature)
    fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    return {
        "day": date.today().isoformat(),
        "temperature": float(temperature) if temperature is not None else None,
        "apparent": float(apparent) if apparent is not None else None,
        "weather_code": int(code) if code is not None else None,
        "weather": weather,
        "label": label,
        "source": "unknown",
        "fetched_at": fetched_at,
    }


def _is_fresh(fetched_at: Optional[str]) -> bool:
    if not fetched_at:
        return False
    try:
        stamp = datetime.fromisoformat(fetched_at)
    except ValueError:
        return False
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    age = (datetime.now(timezone.utc) - stamp).total_seconds()
    return age < config.WEATHER_TTL_MINUTES * 60


def _read_cache(day: str) -> Optional[Dict[str, Any]]:
    conn = db.get_conn()
    try:
        row = conn.execute(
            "SELECT * FROM weather_cache WHERE day = ?", (day,)
        ).fetchone()
        return dict(row) if row is not None else None
    finally:
        conn.close()


def _write_cache(reading: Dict[str, Any]) -> None:
    with db.db() as conn:
        conn.execute(
            """
            INSERT INTO weather_cache
                (day, temperature, apparent, weather_code, weather, label,
                 source, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(day) DO UPDATE SET
                temperature  = excluded.temperature,
                apparent     = excluded.apparent,
                weather_code = excluded.weather_code,
                weather      = excluded.weather,
                label        = excluded.label,
                source       = excluded.source,
                fetched_at   = excluded.fetched_at
            """,
            (
                reading["day"],
                reading["temperature"],
                reading["apparent"],
                reading["weather_code"],
                reading["weather"],
                reading["label"],
                reading["source"],
                reading["fetched_at"],
            ),
        )


def _format(
    reading: Dict[str, Any], source: str, stale: bool
) -> Dict[str, Any]:
    label, emoji = describe_code(reading.get("weather_code"))
    return {
        "date": reading["day"],
        "temperature": reading.get("temperature"),
        "apparent": reading.get("apparent"),
        "weather": reading.get("weather"),
        "label": reading.get("label") or label,
        "code": reading.get("weather_code"),
        "emoji": emoji,
        "source": source,
        "origin": reading.get("source"),
        "fetchedAt": reading.get("fetched_at"),
        "stale": stale,
    }


def _candidates(
    lat: Optional[float], lon: Optional[float]
) -> Iterator[Tuple[float, float, str]]:
    """Lazy (lat, lon, source) candidates, most accurate first.

    The IP lookup only happens if the browser supplied no coordinates or the
    Open-Meteo call with those coordinates failed.
    """
    if lat is not None and lon is not None:
        yield (float(lat), float(lon), "geo")
    try:
        ip_lat, ip_lon = ip_lookup()
        yield (ip_lat, ip_lon, "ip")
    except Exception:
        pass
    yield (config.DEFAULT_LAT, config.DEFAULT_LON, "default")


def get_weather(
    lat: Optional[float] = None, lon: Optional[float] = None
) -> Dict[str, Any]:
    """Return today's weather, never raising."""
    day = date.today().isoformat()
    cached = _read_cache(day)

    if cached is not None and _is_fresh(cached.get("fetched_at")):
        return _format(cached, source="cache", stale=False)

    last_error: Optional[Exception] = None
    for cand_lat, cand_lon, origin in _candidates(lat, lon):
        try:
            reading = fetch_open_meteo(cand_lat, cand_lon)
            reading["source"] = origin
            _write_cache(reading)
            return _format(reading, source=origin, stale=False)
        except Exception as exc:  # network, timeout, bad payload
            last_error = exc

    if cached is not None:
        return _format(cached, source=cached.get("source") or "error", stale=True)

    return {
        "date": day,
        "temperature": None,
        "apparent": None,
        "weather": None,
        "label": None,
        "code": None,
        "emoji": "\U0001f321\ufe0f",
        "source": "error",
        "origin": None,
        "fetchedAt": None,
        "stale": True,
        "error": str(last_error) if last_error else "Weather unavailable",
    }


def source_label(source: Optional[str]) -> str:
    return {
        "geo": "your location",
        "ip": "approximate location",
        "default": "default location (%s)" % config.DEFAULT_LOCATION_LABEL,
        "cache": "cached reading",
        "error": "unavailable",
    }.get(source or "", source or "unknown")
