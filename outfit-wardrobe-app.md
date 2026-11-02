# Implementation Plan — Digital Wardrobe / Outfit Generator

Plan file location note: you asked for `/Users/nevem/Desktop/x`, but macOS TCC blocks this
shell from touching `~/Desktop` (`ls ~/Desktop` → `Operation not permitted`). This plan lives in
`~/.opencode/plan/`. The app itself should be created at a path outside Desktop, or Desktop access
must be granted first (see "Open items").

---

## 1. Goal

A local web app that acts as a digital wardrobe:

- **Main page**: three widgets (Top, Bottom, Shoes) on the left. A **Generate** button randomizes
  each widget. A **heart** button saves the current combination to Outfits. Per-widget left/right
  arrows swap the picture within that category.
- **Right rail**: two buttons, **Outfits** and **Wardrobe**.
- **Outfits page**: all liked outfits.
- **Wardrobe page**: all uploaded pictures grouped by Top / Bottom / Shoes, browsable sideways with
  arrows; clicking a picture opens a modal with description, weather, type, and Delete.
- Outfit generation is **weather-aware**, using today's real weather, refreshed every time the app
  is opened.

## 2. Stack decision

| Concern | Choice | Why |
|---|---|---|
| Runtime | Python 3.9.6 (system) managed by `uv` | Node/npm and Homebrew are **not installed**; `uv` is. |
| Backend | FastAPI + Uvicorn | Tiny, typed, auto docs at `/docs`. |
| DB | SQLite via stdlib `sqlite3` | No server, no ORM dependency, file-based. |
| Frontend | Vanilla HTML/CSS/JS, 3 pages | No build step, no bundler, instant reload. |
| Images | Files on disk + static mount | DB stores only paths, as required. |
| Weather | Open-Meteo (no API key) | Free, no signup. |

Run command (single command, no install step):

    uv run --with fastapi --with "uvicorn[standard]" --with python-multipart --with pillow \
      uvicorn app.main:app --reload --port 8000

A `pyproject.toml` will pin the same deps so `uv sync && uv run ...` also works.

Constraints to respect: Python 3.9 → use `Optional[X]`, `List[X]`, `dict(...)`; no `X | None`,
no `match`. Desktop-first layout, but it must not break below 1000 px.

## 3. Project layout

    <project-root>/
    ├─ pyproject.toml
    ├─ README.md
    ├─ .gitignore                # wardrobe.db, uploads/, __pycache__, .venv
    ├─ app/
    │  ├─ __init__.py
    │  ├─ main.py                # FastAPI app, static mounts, page routes, startup
    │  ├─ config.py              # paths, temp threshold, cache TTL, max upload size
    │  ├─ db.py                  # connection helper, schema init, row->dict
    │  ├─ models.py              # pydantic request/response models
    │  ├─ weather.py             # Open-Meteo + geolocation/IP fallback + cold/hot mapping
    │  ├─ images.py              # save/validate/delete files, thumbnail generation
    │  └─ routes/
    │     ├─ items.py
    │     ├─ outfits.py
    │     ├─ generate.py
    │     └─ weather.py
    ├─ static/
    │  ├─ css/styles.css
    │  ├─ js/api.js              # fetch wrappers + error handling
    │  ├─ js/ui.js               # modal, toast, image crossfade helpers
    │  ├─ js/main.js             # main page logic
    │  ├─ js/wardrobe.js         # rails, modal, delete/replace flow, upload
    │  └─ js/outfits.js
    ├─ templates/                # plain .html served as files
    │  ├─ index.html
    │  ├─ wardrobe.html
    │  └─ outfits.html
    ├─ uploads/                  # runtime, created on startup
    │  ├─ top/  bottom/  shoes/
    └─ wardrobe.db               # runtime, created on startup

## 4. Data model

    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS clothing_items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT    NOT NULL DEFAULT '',
      weather     TEXT    NOT NULL CHECK (weather IN ('cold','hot')),
      type        TEXT    NOT NULL CHECK (type   IN ('top','bottom','shoes')),
      path        TEXT    NOT NULL UNIQUE,   -- e.g. "top/ab12cd.jpg", relative to uploads/
      thumb_path  TEXT,                       -- e.g. "top/ab12cd_thumb.jpg"
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_items_type_weather ON clothing_items(type, weather);

    CREATE TABLE IF NOT EXISTS outfits (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      top_id     INTEGER NOT NULL REFERENCES clothing_items(id),
      bottom_id  INTEGER NOT NULL REFERENCES clothing_items(id),
      shoes_id   INTEGER NOT NULL REFERENCES clothing_items(id),
      weather    TEXT    NOT NULL,            -- weather at generation time (snapshot)
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE (top_id, bottom_id, shoes_id)
    );

    CREATE TABLE IF NOT EXISTS weather_cache (
      day          TEXT PRIMARY KEY,          -- YYYY-MM-DD (local)
      temperature  REAL,
      apparent     REAL,
      weather_code INTEGER,
      weather      TEXT,                      -- 'cold' | 'hot'
      label        TEXT,                      -- e.g. "Partly cloudy"
      source       TEXT,                      -- 'geo' | 'ip' | 'default'
      fetched_at   TEXT NOT NULL
    );

Notes
- FKs are declared but **deletion is orchestrated in code** (no `ON DELETE CASCADE`) so the
  replace-or-delete prompt can run first. The DB is the tripwire: a bad delete raises an FK error.
- `outfits.weather` is a snapshot; today's weather may differ from when the outfit was liked.
- Duplicate likes are idempotent: `POST /api/outfits` returns the existing row instead of erroring.

## 5. Weather design

**Fetch path**
1. Browser tries `navigator.geolocation` (5 s timeout, only if permission is already granted — no
   blocking prompt on first load).
2. Server-side fallback: `GET https://ipapi.co/json/` → lat/long. If that fails, use
   `config.DEFAULT_LAT/LON` (a constant, clearly labelled in the UI).
3. `GET https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..&current=temperature_2m,apparent_temperature,weather_code&timezone=auto`.
4. Map to clothing weather: `apparent >= config.HOT_THRESHOLD (default 18.0)` → `hot`, else `cold`.
5. Map `weather_code` → short label + emoji via a small lookup table.

**Caching / "updated when accessed"**
- `GET /api/weather` is called on every page load.
- If a `weather_cache` row exists for today **and** `fetched_at` is newer than 30 min, return it
  with `source: "cache"`. Otherwise refetch, upsert, return `source: "fresh"`.
- Network failure → return today's cached row if any (with `stale: true`), else `{ weather: null }`,
  and the UI shows a banner plus a manual cold/hot override so the app stays usable offline.
- Date rollover: the `day` key means a request after midnight always misses the cache.

**Use in generation**
- Pool = items where `type = ?` AND `weather = today.weather`.
- If that pool is empty for a category, fall back in this order and tell the user:
  (a) all items of that type ignoring weather, flagged "not weather-appropriate";
  (b) empty state with an "Add a top" link to the Wardrobe page.

## 6. API surface

| Method | Path | Body / Query | Response |
|---|---|---|---|
| GET | `/api/health` | — | `{"ok": true}` |
| GET | `/api/weather` | `?lat=&lon=` optional | `{date, temperature, apparent, weather, label, code, source, fetchedAt, stale}` |
| GET | `/api/items` | `?type=&weather=` | `[{id, description, weather, type, path, thumbPath, createdAt}]` |
| POST | `/api/items` | multipart: `file`, `description`, `weather`, `type` | created item, `201` |
| GET | `/api/items/{id}` | — | item |
| GET | `/api/items/{id}/outfits` | — | `[{id, createdAt}]` — outfits that reference it |
| POST | `/api/items/{id}/replace` | `{replacementId}` | `{replaced: n, outfits: [...]}` |
| DELETE | `/api/items/{id}` | `?force=true` | `204`; `409 {detail, affectedOutfits:[...]}` when used and not forced |
| POST | `/api/generate` | `{weather, exclude?: {top,bottom,shoes}}` | `{top, bottom, shoes, weather, fallbackUsed: bool}` |
| GET | `/api/outfits` | — | `[{id, createdAt, weather, top, bottom, shoes}]` |
| POST | `/api/outfits` | `{topId, bottomId, shoesId, weather}` | `201` outfit (or existing, `200`) |
| DELETE | `/api/outfits/{id}` | — | `204` |

Validation: `type`/`weather` whitelists, upload content-type + Pillow verify, 10 MB cap, and a
`409` when trying to replace an item with one of a different `type`.

**Generation algorithm** (`routes/generate.py`)
1. Resolve `weather` (request override, else today's).
2. For each of `top/bottom/shoes`: `SELECT ... WHERE type=? AND weather=?`; if `exclude` contains
   the current item and the pool has > 1 member, drop it so Generate always visibly changes
   something.
3. `random.choice` with a normal RNG (no global `random.seed`).
4. Return the three items plus `fallbackUsed`, which the UI turns into a subtle badge.

## 7. UI specification

### 7.1 Shared
- `styles.css`: CSS custom properties, dark-neutral theme, 8 px spacing scale, rounded cards, soft
  shadows, 200 ms transitions. No framework.
- `ui.js`: `openModal(node)`, `closeModal()`, `toast(msg, kind)`, `crossfade(imgEl, newSrc)`.
- `api.js`: thin `fetch` wrappers that surface `detail` from error JSON into a toast.
- All pages show the weather chip (icon + temp + cold/hot) in the top-right.

### 7.2 `index.html` — Main
Layout: two columns. Left (≈ 1fr) = three stacked widgets in a vertical rail; right (≈ 280 px) =
actions rail.

Each widget
- 3:4 image card, `object-fit: cover`, `alt` = description.
- Category label pill (Top / Bottom / Shoes).
- Left and right circular arrow buttons, vertically centered, over the image.
- Weather-mismatch dot + tooltip when the shown item's weather differs from today's.
- Empty state: dashed placeholder, "No tops for cold weather — add one" linking to Wardrobe.
- Arrows cycle locally through the pre-fetched pool (no server round trip). Disabled (grayed,
  `aria-disabled`) when the pool size is <= 1. Wrapping allowed. Crossfade on change.

Below the widgets: a **Generate** primary button, full width, with a 400 ms shuffle animation
(rapid src swaps) then the final combo.

Heart button sits directly under/next to Generate: outline heart → filled + scale pop on like.
Labels: "Generate", "Like this look". `aria-pressed` reflects liked state for the current combo.
If the exact combo is already saved, the heart renders filled when that combo is displayed.

Right rail
- **Outfits** button → `outfits.html`.
- **Wardrobe** button → `wardrobe.html`.
- Small weather line + "updated 2 min ago" and a refresh glyph.

State object in `main.js`:
`{ weather, pools: {top:[...], bottom:[...], shoes:[...]}, index: {top:0,...}, current: {top:item,...}, liked: bool }`

Sequence on load: `GET /api/weather` → `GET /api/items` per type for that weather (3 parallel
requests) → render pools at a random starting index → enable buttons.

### 7.3 `wardrobe.html`
- Upload panel at the top: drag-and-drop zone + file input, description text field, weather
  segmented control (Cold / Hot), type segmented control (Top / Bottom / Shoes), Upload button,
  progress + inline validation errors. After success, the matching rail refreshes.
- Three horizontal **rails**, one per category: section title + count, a horizontally scrolling flex
  strip of 120×160 thumbnails, and left/right buttons that scroll by ~3 cards (`scrollBy`, smooth).
  Native trackpad scroll still works; arrows are just an affordance.
- Clicking a thumbnail opens the modal.
- **Item modal**: large image on the left; right side shows description, weather chip, type chip,
  date added, and a red **Delete** button. Esc / backdrop / × closes it.
- **Delete flow** (the important one):
  1. `DELETE /api/items/{id}` → `409` with `affectedOutfits`.
  2. Modal switches to a two-step confirm: "This Top is used in 3 outfits."
     - **Option A — Replace it**: a grid/list of candidate items of the *same type* (radio select),
       plus a "show only items matching the deleted item's weather" toggle. Choosing one and
       pressing *Replace & delete* calls `POST /api/items/{id}/replace`, then retries the delete
       with `force=true`. Saved outfits keep working, now with the substitute item.
     - **Option B — Delete the outfits too**: an explicit destructive confirm listing affected
       outfit thumbnails, then `DELETE ?force=true`, which removes the outfits first, then the item
       and its files.
     - Cancel leaves everything untouched.
     - If no same-type candidate exists, Option A is disabled with an explanation and Option B is
       the only path.
  3. Success: toast, rail refreshes, modal closes.

### 7.4 `outfits.html`
- Grid of outfit cards, newest first, grouped by date header (Today, Yesterday, 12 Mar).
- Each card: three images in a row (top / bottom / shoes) with tiny labels, the weather chip from
  the day it was generated, and a remove (×) action with confirm.
- If today's weather differs from the outfit's snapshot, show a "made for cold · today is hot" hint.
- Empty state: "No outfits yet — hit Generate and tap the heart."

## 8. Implementation phases

Each phase ends with something runnable and verifiable.

**Phase 0 — Scaffold (~30 min)**
- Create project dir, `pyproject.toml`, `.gitignore`, `README.md` run instructions.
- Verify `uv run ... uvicorn` serves `GET /api/health` → `{"ok": true}`.
- Checkpoint: server starts from a clean shell.

**Phase 1 — DB + config (~45 min)**
- `config.py` (paths, threshold, TTL, max upload), `db.py` with `init_db()` on startup,
  `get_conn()` with `row_factory` + `PRAGMA foreign_keys=ON`.
- Checkpoint: `sqlite3 wardrobe.db ".schema"` shows all three tables and the index.

**Phase 2 — Weather service (~45 min)**
- `weather.py`: IP lookup, Open-Meteo call, code→label table, threshold mapping, cache upsert and
  TTL logic, all wrapped so no exception escapes as a 500.
- Checkpoint: `curl localhost:8000/api/weather` twice → second shows `source: cache`; point the base
  URL at a bad host → cached response with `stale: true`.

**Phase 3 — Items + images (~1.5 h)**
- `images.py`: extension whitelist, Pillow verify, uuid filename, 600 px thumbnail, safe delete
  (only inside `uploads/`).
- `routes/items.py`: list/filter, create, get, usage, replace, delete (+`force`).
- Mount `/uploads` statically; serve the three pages.
- Checkpoint: upload via `curl -F`, see the file on disk, the row in the DB, and the image at
  `/uploads/top/x.jpg`; delete it and confirm the file and row are gone.

**Phase 4 — Generate + outfits (~1 h)**
- `routes/generate.py` (weather filter, exclusion, fallback flag), `routes/outfits.py` (idempotent
  create, list with joined items, delete).
- Checkpoint: with a cold-only and a hot-only wardrobe, `POST /api/generate {"weather":"cold"}`
  returns only cold items; repeated calls vary; one item per category returns that item instead of
  erroring.

**Phase 5 — Main page (~2 h)**
- `index.html` + `main.js`: layout, widgets, arrows, generate animation, heart, weather chip,
  empty/fallback states, right rail navigation.
- Checkpoint: full flow Generate → like → appears in `GET /api/outfits`.

**Phase 6 — Wardrobe page (~2.5 h)**
- Rails, arrow scrolling, modal, upload panel, and the replace-or-delete flow (largest single chunk
  of UI work, deliberately after the API is stable).
- Checkpoint: delete an unused item (plain confirm); delete a used item via replace (outfits update
  in place); delete via "delete outfits too" (outfits vanish); cancel changes nothing.

**Phase 7 — Outfits page (~1 h)**
- Grid, date grouping, remove, empty state.

**Phase 8 — Polish + docs (~1 h)**
- Responsive pass under 1000 px, keyboard focus rings, `aria-label`s, toasts, error banners, README
  with setup, port, and where data/files live.

Total: roughly 9–10 hours of focused work.

## 9. Acceptance criteria

1. Loading `/` shows three widgets, today's weather, and the two right-side buttons.
2. Pressing Generate changes all three images, animated, never duplicating within a combo.
3. Generated items always match today's cold/hot weather unless the explicit fallback badge is
   shown.
4. Heart saves the combo; it appears immediately in Outfits; the heart shows filled state for
   already-saved combos; pressing again does not create duplicates.
5. Arrows move forward/backward within the correct category and wrap; disabled when only one
   candidate exists.
6. Wardrobe shows every uploaded image grouped by type and scrolls horizontally via arrows.
7. Clicking a thumbnail opens the modal with image, description, weather, type, delete.
8. Deleting an unused item removes the row **and** the files.
9. Deleting a used item always offers "replace with a same-type item" or "delete the outfit(s)";
   cancellation is a no-op.
10. Weather is refetched on each page load and the day's cache row is updated; no API keys required.
11. After a restart, all items, outfits, and images are still there.

## 10. Edge cases to handle explicitly

- Empty wardrobe / empty pool for today's weather (primary empty state, link to upload).
- One item per category (arrows disabled, Generate returns the same combo, no infinite loop).
- Duplicate like, double-click on Generate/like (disable buttons while a request is in flight).
- Geolocation denied, slow, or unavailable → IP → default coords, with a visible source hint.
- Open-Meteo/ipapi outage, timeout (5 s), rate limit → cached/served stale, banner shown.
- Midnight rollover while the tab is open (date-keyed cache; refresh on visibility change).
- Non-image or oversized upload, wrong extension, HEIC files → clear error message.
- Deleting a file already missing on disk → DB delete still succeeds.
- Outfit references a missing item (should be impossible with FKs on, but list joins use LEFT JOIN
  + placeholder tile so the page never 500s).
- Very long descriptions → truncate in cards, full text in modal.
- Path traversal in `path` values → all file operations resolved against the uploads root.

## 11. Open items / risks

1. **Project location**: `~/Desktop` is TCC-protected in this shell. Either grant Full Disk Access
   to the terminal/agent host app, or put the project at e.g. `~/Projects/outfit-wardrobe`. The plan
   and code are identical either way.
2. **Python 3.9**: the system version caps language features; if anything needs 3.10+,
   `uv python install 3.12` is a one-liner. Not expected to be necessary.
3. **Weather accuracy**: Open-Meteo is point-forecast data; the IP fallback can be city-level wrong
   behind a VPN. Mitigated by the browser geolocation path and the manual override.
4. **18 °C cold/hot threshold** is a single config value; easy to change later or split into three
   bands (cold/mild/hot), but v1 keeps two as specified.
5. **No auth / single user**: the app is local-only (bind `127.0.0.1`). Do not expose it publicly
   without adding auth and upload limits at the proxy.
6. **Image storage growth**: originals + thumbnails; no dedupe in v1. Acceptable for a wardrobe.
