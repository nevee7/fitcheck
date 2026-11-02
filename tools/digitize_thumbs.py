#!/usr/bin/env python3
"""Turn flat-lay clothing photos into catalog-style wardrobe thumbnails.

Each photo is cut out with Apple Vision (tools/cutout.swift), then composited
onto the same 3:4 blush gradient with a soft shadow, so the wardrobe looks like
a designed digital closet instead of a camera roll.

Usage:
    .venv-app/bin/python tools/digitize_thumbs.py            # all uploads
    .venv-app/bin/python tools/digitize_thumbs.py uploads/top/hot/IMG_8002.jpeg

The original photos are never modified; only <name>_thumb.jpg is rewritten.
macOS 14+ with the Command Line Tools (for swiftc) is required.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
TOOLS_DIR = Path(__file__).resolve().parent
DEFAULT_UPLOADS = ROOT / "uploads"

CUTOUT_SOURCE = TOOLS_DIR / "cutout.swift"
CUTOUT_BIN = TOOLS_DIR / ".bin" / "cutout"

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".gif"}

OUT_W, OUT_H = 600, 800
TOP_COLOR = "#fffdfd"
BOTTOM_COLOR = "#f7dde8"
FIT = 0.80

SHADOW_COLOR = (92, 34, 62, 60)
SHADOW_BLUR = 12


class CatalogUnavailable(RuntimeError):
    """Raised when Apple Vision cannot be used on this machine."""


def ensure_cutout_binary() -> Path:
    """Compile the Vision helper once and reuse the binary afterwards."""
    if CUTOUT_BIN.exists() and CUTOUT_BIN.stat().st_mtime >= CUTOUT_SOURCE.stat().st_mtime:
        return CUTOUT_BIN

    if sys.platform != "darwin":
        raise CatalogUnavailable(
            "Catalog thumbnails need macOS (Apple Vision). "
            "Run this on the Mac that hosts Fitcheck."
        )

    CUTOUT_BIN.parent.mkdir(parents=True, exist_ok=True)
    print("Compiling Vision cutout helper…", flush=True)
    result = subprocess.run(
        ["xcrun", "swiftc", "-O", "-o", str(CUTOUT_BIN), str(CUTOUT_SOURCE)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise CatalogUnavailable(
            "Could not compile tools/cutout.swift.\n"
            "Install the Xcode Command Line Tools (xcode-select --install) and retry.\n\n"
            + result.stderr.strip()
        )
    return CUTOUT_BIN


def gradient_canvas() -> Image.Image:
    canvas = Image.new("RGB", (OUT_W, OUT_H), TOP_COLOR)
    bottom = Image.new("RGB", (OUT_W, OUT_H), BOTTOM_COLOR)
    mask = Image.new("L", (OUT_W, OUT_H), 0)
    draw = ImageDraw.Draw(mask)
    for y in range(OUT_H):
        draw.line([(0, y), (OUT_W, y)], fill=int(255 * (y / OUT_H)))
    return Image.composite(bottom, canvas, mask).convert("RGBA")


def soft_cutout(image: Image.Image) -> Image.Image:
    """Erode the Vision alpha slightly to hide the original background fringe."""
    image = image.convert("RGBA")
    alpha = (
        image.getchannel("A")
        .filter(ImageFilter.MinFilter(7))
        .filter(ImageFilter.GaussianBlur(2))
    )
    image.putalpha(alpha)
    box = alpha.getbbox()
    return image.crop(box) if box else image


def compose(cutout_path: Path, destination: Path) -> None:
    with Image.open(cutout_path) as cutout:
        item = soft_cutout(cutout)
    width, height = item.size

    canvas = gradient_canvas()
    scale = min(int(OUT_W * FIT) / width, int(OUT_H * FIT) / height)
    new_w, new_h = max(1, int(width * scale)), max(1, int(height * scale))
    item = item.resize((new_w, new_h), Image.LANCZOS)

    x = (OUT_W - new_w) // 2
    y = (OUT_H - new_h) // 2

    shadow = Image.new("RGBA", (OUT_W, OUT_H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(shadow)
    shadow_w = int(new_w * 0.60)
    shadow_h = max(8, int(new_h * 0.018))
    cy = y + new_h + shadow_h // 2
    draw.ellipse(
        (OUT_W // 2 - shadow_w // 2, cy - shadow_h, OUT_W // 2 + shadow_w // 2, cy + shadow_h),
        fill=SHADOW_COLOR,
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(SHADOW_BLUR))
    canvas = Image.alpha_composite(canvas, shadow)

    canvas.paste(item, (x, y), item)
    canvas.convert("RGB").save(destination, format="JPEG", quality=90, optimize=True)


def fallback_compose(photo: Path, destination: Path) -> None:
    """Used when Vision finds no meaningful foreground (e.g. a stock image)."""
    with Image.open(photo) as source:
        source = source.convert("RGB")
        scale = min(OUT_W * 0.92 / source.width, OUT_H * 0.92 / source.height)
        new_w = max(1, int(source.width * scale))
        new_h = max(1, int(source.height * scale))
        resized = source.resize((new_w, new_h), Image.LANCZOS)

    canvas = gradient_canvas()
    shadow = Image.new("RGBA", (OUT_W, OUT_H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(shadow)
    x = (OUT_W - new_w) // 2
    y = (OUT_H - new_h) // 2
    draw.rectangle((x, y, x + new_w, y + new_h), fill=(92, 34, 62, 40))
    shadow = shadow.filter(ImageFilter.GaussianBlur(14))
    canvas = Image.alpha_composite(canvas, shadow)

    canvas.paste(resized, (x, y))
    canvas.convert("RGB").save(destination, format="JPEG", quality=90, optimize=True)


def thumb_path_for(source: Path) -> Path:
    return source.with_name(source.stem + "_thumb.jpg")


def is_original(path: Path) -> bool:
    return (
        path.is_file()
        and path.suffix.lower() in IMAGE_SUFFIXES
        and not path.stem.endswith("_thumb")
        and not path.name.startswith(".")
    )


def process(source: Path, binary: Path, verbose: bool, destination: Path | None = None) -> tuple[Path, str]:
    destination = destination or thumb_path_for(source)
    with tempfile.TemporaryDirectory(prefix="fitcheck-cutout-") as tmp:
        cutout_path = Path(tmp) / "cutout.png"
        try:
            result = subprocess.run(
                [str(binary), str(source), str(cutout_path)],
                capture_output=True,
                text=True,
                timeout=120,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            result = None
            message = str(exc)
        else:
            message = (result.stderr or result.stdout or "unknown error").strip().splitlines()[-1]

        if result is not None and result.returncode == 0 and cutout_path.exists():
            compose(cutout_path, destination)
            return source, "ok"

        if verbose:
            print(f"  cutout failed ({message}); using photo fallback", flush=True)
        fallback_compose(source, destination)
        return source, f"fallback: {message}"


def render_catalog_thumb(source: Path, destination: Path) -> tuple[bool, str]:
    """Render one catalog thumbnail, for use by the app as well as the CLI.

    Returns ``(wrote, status)``. A Vision miss still writes the photo fallback,
    so the caller only needs its own fallback when ``wrote`` is False (for
    example on a machine without the Swift toolchain).
    """
    try:
        binary = ensure_cutout_binary()
    except CatalogUnavailable as exc:
        return False, str(exc)

    _, status = process(source, binary, verbose=False, destination=destination)
    return True, status


def gather(targets: list[str]) -> list[Path]:
    sources: list[Path] = []
    for target in targets:
        path = Path(target).expanduser()
        if path.is_dir():
            sources.extend(sorted(p for p in path.rglob("*") if is_original(p)))
        elif is_original(path):
            sources.append(path)
        else:
            print(f"Skipping {target}: not an image", file=sys.stderr)
    return sources


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "paths",
        nargs="*",
        default=[str(DEFAULT_UPLOADS)],
        help="files or folders to process (default: uploads/)",
    )
    parser.add_argument(
        "--jobs",
        type=int,
        default=min(4, os.cpu_count() or 1),
        help="parallel Vision processes (default: 4)",
    )
    parser.add_argument("-q", "--quiet", action="store_true", help="only print totals")
    args = parser.parse_args()

    sources = gather(args.paths)
    if not sources:
        print("No original photos found.")
        return

    try:
        binary = ensure_cutout_binary()
    except CatalogUnavailable as exc:
        print(f"Catalog thumbnails unavailable: {exc}", file=sys.stderr)
        raise SystemExit(1)
    print(f"Digitising {len(sources)} photo(s)…", flush=True)

    failures: list[tuple[Path, str]] = []
    done = 0
    with ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
        futures = {pool.submit(process, source, binary, not args.quiet): source for source in sources}
        for future in as_completed(futures):
            done += 1
            source, status = future.result()
            if status != "ok":
                failures.append((source, status))
            if not args.quiet:
                rel = source.relative_to(ROOT) if source.is_relative_to(ROOT) else source
                print(f"  [{done}/{len(sources)}] {rel} — {status}", flush=True)

    print(f"\nDone. {len(sources) - len(failures)} cut out, {len(failures)} fallback(s).")
    if failures and not args.quiet:
        for source, status in failures:
            print(f"  {source}: {status}")


if __name__ == "__main__":
    main()
