"""Pydantic request/response models.

Field names use camelCase where the browser API expects it, keeping the JSON
surface stable while the SQLite layer stays snake_case.
"""
from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class Item(BaseModel):
    id: int
    description: str
    weather: str
    type: str
    path: str
    thumbPath: Optional[str] = None
    createdAt: str


class Outfit(BaseModel):
    id: int
    createdAt: str
    weather: str
    top: Optional[Item] = None
    bottom: Optional[Item] = None
    shoes: Optional[Item] = None


class OutfitSummary(BaseModel):
    id: int
    createdAt: str


class ReplaceRequest(BaseModel):
    replacementId: int


class ReplaceResponse(BaseModel):
    replaced: int
    outfits: List[Outfit] = Field(default_factory=list)


class OutfitCreate(BaseModel):
    topId: int
    bottomId: int
    shoesId: int
    weather: str


class GenerateRequest(BaseModel):
    weather: Optional[str] = None
    exclude: Optional[Dict[str, int]] = None


class GenerateResponse(BaseModel):
    top: Optional[Item] = None
    bottom: Optional[Item] = None
    shoes: Optional[Item] = None
    weather: str
    fallbackUsed: bool
    fallbackTypes: List[str] = Field(default_factory=list)


class SyncError(BaseModel):
    file: str
    error: str


class SyncResult(BaseModel):
    imported: int
    skipped: int
    errors: List[SyncError] = Field(default_factory=list)


class WeatherResponse(BaseModel):
    date: str
    temperature: Optional[float] = None
    apparent: Optional[float] = None
    weather: Optional[str] = None
    label: Optional[str] = None
    code: Optional[int] = None
    emoji: Optional[str] = None
    source: str
    origin: Optional[str] = None
    fetchedAt: Optional[str] = None
    stale: bool = False
