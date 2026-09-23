#!/usr/bin/env python3
"""Derive every iOS / Android launcher + splash asset from the approved icon master.

Source of truth (never edited, never redrawn):
    artifacts/mockup-sandbox/public/images/tastekin/TASTEKIN_app_icon_v2_1024.png
    (1024x1024 RGBA: ivory gradient tile with rounded corners, white disc,
    oxblood + deep-ink KIN Link frames, Burnt Coral centre dot.)

What this script does — purely mechanical derivations, no redesign:
  * iOS AppIcon (1024x1024, opaque, square): the master's transparent rounded
    corners are filled by extending the tile's own diagonal gradient
    (measured from the master), because Apple applies the corner mask itself.
  * Android legacy launcher PNGs (mipmap-*dpi ic_launcher / ic_launcher_round):
    the square icon above, downscaled; the round variant is masked to a circle.
  * Android adaptive icon: background = the extended gradient tile,
    foreground = the white disc + mark cut from the master and scaled to sit
    inside the 66% safe zone (adaptive icons are cropped to circles / squircles).
  * Android monochrome (themed) icon: an alpha mask of the mark shapes
    (frames + dot) only — Android tints it with the wallpaper colour.
  * Splash / launch image: Warm Ivory (#F5F1E9) canvas with the mark
    (frames + dot, lifted from the master) centred. iOS 2732x2732 universal;
    Android drawable / drawable-port-* / drawable-land-*.

Run from artifacts/tastekin:  python3 native/generate-assets.py
Requires Pillow + numpy (python3 -m pip install pillow numpy).
"""
from __future__ import annotations

import pathlib
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = pathlib.Path(__file__).resolve().parent
APP = HERE.parent
REPO = APP.parent.parent
MASTER = REPO / "artifacts/mockup-sandbox/public/images/tastekin/TASTEKIN_app_icon_v2_1024.png"
IOS_ASSETS = APP / "ios/App/App/Assets.xcassets"
ANDROID_RES = APP / "android/app/src/main/res"

WARM_IVORY = (245, 241, 233)  # #F5F1E9 (brand guide)


def load_master() -> np.ndarray:
    im = Image.open(MASTER).convert("RGBA")
    if im.size != (1024, 1024):
        sys.exit(f"master must be 1024x1024, got {im.size}")
    return np.asarray(im).astype(np.float32)


def tile_gradient(master: np.ndarray) -> np.ndarray:
    """Reconstruct the tile's diagonal gradient as a full 1024x1024 opaque RGB array.

    The tile colour depends only on x+y (sampled: left-middle == top-middle and
    right-middle == bottom-middle). Fit a line per channel through the opaque
    pixels along the two centre lines and evaluate it everywhere, including
    the transparent corners.
    """
    h, w, _ = master.shape
    ys, xs = np.mgrid[0:h, 0:w]
    s = (xs + ys).astype(np.float32)
    alpha = master[..., 3]
    # Sample the plain tile along the centre row/column but away from the disc.
    samples = []
    for x in range(0, w):
        for y in (0, h - 1):
            if alpha[y, x] == 255:
                samples.append((x + y, master[y, x, :3]))
    for y in range(0, h):
        for x in (0, w - 1):
            if alpha[y, x] == 255:
                samples.append((x + y, master[y, x, :3]))
    ss = np.array([p[0] for p in samples], dtype=np.float32)
    cs = np.array([p[1] for p in samples], dtype=np.float32)
    out = np.zeros((h, w, 3), dtype=np.float32)
    for c in range(3):
        slope, intercept = np.polyfit(ss, cs[:, c], 1)
        out[..., c] = np.clip(slope * s + intercept, 0, 255)
    return out


def square_icon(master: np.ndarray, gradient: np.ndarray) -> Image.Image:
    """Opaque 1024x1024 icon: master composited over its own extended gradient."""
    a = (master[..., 3:4] / 255.0)
    rgb = master[..., :3] * a + gradient * (1 - a)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def disc_bounds(master: np.ndarray) -> tuple[int, int, int]:
    """Centre (cx, cy) and radius of the white disc, measured from the master."""
    rgb = master[..., :3]
    white = (rgb.min(axis=2) >= 250) & (master[..., 3] == 255)
    # Only the disc is pure white (the tile is ivory); take the widest white run
    # on the centre row / column.
    row = np.where(white[512])[0]
    col = np.where(white[:, 512])[0]
    cx = int((row.min() + row.max()) / 2)
    cy = int((col.min() + col.max()) / 2)
    r = int(max(row.max() - row.min(), col.max() - col.min()) / 2)
    return cx, cy, r


def mark_alpha(master: np.ndarray) -> np.ndarray:
    """Soft alpha mask (0..1) of the KIN Link frames + coral dot, from the master."""
    rgb = master[..., :3]
    lum = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    # Everything that is neither white disc nor ivory tile: frames (~40 lum),
    # coral dot (~130 lum), dot outline. Ramp between 225 and 200 keeps the
    # anti-aliased edges soft.
    a = np.clip((225.0 - lum) / 25.0, 0, 1)
    # Restrict to the disc area so tile shading never leaks into the mask.
    cx, cy, r = disc_bounds(master)
    ys, xs = np.mgrid[0:1024, 0:1024]
    inside = ((xs - cx) ** 2 + (ys - cy) ** 2) <= (r - 4) ** 2
    return a * inside


def mark_rgba(master: np.ndarray) -> Image.Image:
    """The mark alone (frames + dot) on transparency, colours straight from the master."""
    a = mark_alpha(master)
    out = np.zeros((1024, 1024, 4), dtype=np.float32)
    out[..., :3] = master[..., :3]
    out[..., 3] = a * 255
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGBA")


def crop_to_content(im: Image.Image, pad: int = 0) -> Image.Image:
    bbox = im.getchannel("A").getbbox()
    if not bbox:
        sys.exit("empty mark")
    l, t, r, b = bbox
    return im.crop((max(0, l - pad), max(0, t - pad), min(im.width, r + pad), min(im.height, b + pad)))


def adaptive_foreground(master: np.ndarray, gradient: np.ndarray) -> Image.Image:
    """1024x1024 RGBA: disc (with its soft shadow) + mark, scaled into the 66% safe zone."""
    cx, cy, r = disc_bounds(master)
    shadow_pad = 28  # the disc's soft drop shadow extends a little past the rim
    cut_r = r + shadow_pad
    # Circular cut of the *square icon* (so the shadow sits on the right ivory).
    icon = np.asarray(square_icon(master, gradient)).astype(np.float32)
    ys, xs = np.mgrid[0:1024, 0:1024]
    d = np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2)
    circ_a = np.clip(cut_r + 0.5 - d, 0, 1)  # 1px anti-aliased edge
    cut = np.zeros((1024, 1024, 4), dtype=np.float32)
    cut[..., :3] = icon
    cut[..., 3] = circ_a * 255
    cut_im = Image.fromarray(np.clip(cut, 0, 255).astype(np.uint8), "RGBA")
    cut_im = cut_im.crop((cx - cut_r, cy - cut_r, cx + cut_r, cy + cut_r))
    safe = int(1024 * 0.66)
    scaled = cut_im.resize((safe, safe), Image.LANCZOS)
    canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    canvas.alpha_composite(scaled, ((1024 - safe) // 2, (1024 - safe) // 2))
    return canvas


def monochrome_icon(master: np.ndarray) -> Image.Image:
    """1024x1024 RGBA: mark silhouette (white, alpha) inside the safe zone."""
    a = mark_alpha(master)
    sil = np.zeros((1024, 1024, 4), dtype=np.float32)
    sil[..., :3] = 255
    sil[..., 3] = a * 255
    sil_im = crop_to_content(Image.fromarray(np.clip(sil, 0, 255).astype(np.uint8), "RGBA"))
    # Fit the silhouette's longest side to ~56% of the canvas (well inside the
    # 66% safe zone, matching how the disc foreground reads at launcher size).
    target = int(1024 * 0.56)
    scale = target / max(sil_im.size)
    sized = sil_im.resize((max(1, round(sil_im.width * scale)), max(1, round(sil_im.height * scale))), Image.LANCZOS)
    canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    canvas.alpha_composite(sized, ((1024 - sized.width) // 2, (1024 - sized.height) // 2))
    return canvas


def splash(master: np.ndarray, size: tuple[int, int]) -> Image.Image:
    """Warm Ivory canvas with the mark centred; mark width = 26% of the short side."""
    w, h = size
    canvas = Image.new("RGBA", size, WARM_IVORY + (255,))
    mark = crop_to_content(mark_rgba(master), pad=2)
    target_w = int(min(w, h) * 0.26)
    scale = target_w / mark.width
    sized = mark.resize((max(1, round(mark.width * scale)), max(1, round(mark.height * scale))), Image.LANCZOS)
    canvas.alpha_composite(sized, ((w - sized.width) // 2, (h - sized.height) // 2))
    return canvas.convert("RGB")


def circle_mask(im: Image.Image) -> Image.Image:
    size = im.size
    mask = Image.new("L", (size[0] * 4, size[1] * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size[0] * 4 - 1, size[1] * 4 - 1), fill=255)
    mask = mask.resize(size, Image.LANCZOS)
    out = im.convert("RGBA")
    out.putalpha(mask)
    return out


def save(im: Image.Image, path: pathlib.Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "PNG", optimize=True)
    print(f"wrote {path.relative_to(APP)} {im.size[0]}x{im.size[1]}")


def main() -> None:
    master = load_master()
    gradient = tile_gradient(master)
    icon = square_icon(master, gradient)
    fg = adaptive_foreground(master, gradient)
    mono = monochrome_icon(master)
    bg = Image.fromarray(np.clip(gradient, 0, 255).astype(np.uint8), "RGB")

    # iOS ---------------------------------------------------------------
    save(icon, IOS_ASSETS / "AppIcon.appiconset/AppIcon-512@2x.png")
    ios_splash = splash(master, (2732, 2732))
    for name in ("splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"):
        save(ios_splash, IOS_ASSETS / f"Splash.imageset/{name}")

    # Android launcher icons ---------------------------------------------
    densities = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
    for density, mult in densities.items():
        legacy = int(48 * mult)
        adaptive = int(108 * mult)
        save(icon.resize((legacy, legacy), Image.LANCZOS), ANDROID_RES / f"mipmap-{density}/ic_launcher.png")
        save(circle_mask(icon.resize((legacy, legacy), Image.LANCZOS)), ANDROID_RES / f"mipmap-{density}/ic_launcher_round.png")
        save(fg.resize((adaptive, adaptive), Image.LANCZOS), ANDROID_RES / f"mipmap-{density}/ic_launcher_foreground.png")
        save(bg.resize((adaptive, adaptive), Image.LANCZOS), ANDROID_RES / f"mipmap-{density}/ic_launcher_background.png")
        save(mono.resize((adaptive, adaptive), Image.LANCZOS), ANDROID_RES / f"mipmap-{density}/ic_launcher_monochrome.png")

    # Android splash ------------------------------------------------------
    save(splash(master, (480, 320)), ANDROID_RES / "drawable/splash.png")
    port = {"mdpi": (320, 480), "hdpi": (480, 800), "xhdpi": (720, 1280), "xxhdpi": (960, 1600), "xxxhdpi": (1280, 1920)}
    for density, (w, h) in port.items():
        save(splash(master, (w, h)), ANDROID_RES / f"drawable-port-{density}/splash.png")
        save(splash(master, (h, w)), ANDROID_RES / f"drawable-land-{density}/splash.png")

    # Previews for review (not shipped) -------------------------------------
    preview = HERE / "preview"
    preview.mkdir(exist_ok=True)
    save(icon, preview / "ios-appicon-1024.png")
    save(fg, preview / "android-adaptive-foreground.png")
    save(bg, preview / "android-adaptive-background.png")
    save(mono, preview / "android-monochrome.png")
    save(splash(master, (1170, 2532)), preview / "splash-iphone-portrait.png")


if __name__ == "__main__":
    main()
