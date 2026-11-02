"""FastAPI entrypoint: schema startup, static mounts, pages, and API routers."""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import config, db, importer
from .routes import generate, items, outfits, weather


@asynccontextmanager
async def lifespan(_app: FastAPI):
    db.init_db()
    importer.sync_uploads()
    yield


db.ensure_dirs()

app = FastAPI(
    title="Fitcheck",
    description="A local, weather-aware digital wardrobe.",
    version="0.1.0",
    lifespan=lifespan,
)

app.mount(
    "/static",
    StaticFiles(directory=str(config.STATIC_DIR)),
    name="static",
)
app.mount(
    "/uploads",
    StaticFiles(directory=str(config.UPLOAD_DIR)),
    name="uploads",
)

app.include_router(items.router)
app.include_router(outfits.router)
app.include_router(generate.router)
app.include_router(weather.router)


@app.get("/api/health", tags=["meta"])
def health():
    return {"ok": True}


@app.get("/", include_in_schema=False)
def index_page():
    return FileResponse(config.TEMPLATES_DIR / "index.html")


@app.get("/wardrobe", include_in_schema=False)
def wardrobe_page():
    return FileResponse(config.TEMPLATES_DIR / "wardrobe.html")


@app.get("/outfits", include_in_schema=False)
def outfits_page():
    return FileResponse(config.TEMPLATES_DIR / "outfits.html")
