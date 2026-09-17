#!/usr/bin/env python3
"""Generate the macOS menu-bar template icon for the tray.

Why a generated icon instead of reusing icons/icon.png:
  macOS renders tray images as *template* images — it uses only the ALPHA
  channel and paints the pixels with the current menu-bar foreground colour
  (white on a dark menu bar, black on a light one). Feeding the full-colour
  app icon therefore yields a solid rounded-square blob. A purpose-made
  monochrome silhouette is required.

Output: icons/tray-icon.png — 36x36 px RGBA. tray-icon (the crate Tauri uses)
scales every tray image to an 18pt-tall box, so 36px == 18pt @2x.

Dependency-free: PNG is assembled by hand with zlib + struct.
Supersampled 8x for antialiasing.
"""

import struct
import zlib
from pathlib import Path

SIZE = 36  # px (18pt @2x)
SS = 8  # supersampling factor

# Geometry in the 36x36 design grid.
RECT = (4.0, 8.5, 32.0, 28.0)  # x0, y0, x1, y1  (display bezel)
RECT_RADIUS = 4.0
STROKE = 2.6
TRI = ((15.0, 13.0), (15.0, 23.5), (24.0, 18.25))  # play triangle


def in_rounded_rect(x, y, box, r):
    x0, y0, x1, y1 = box
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= r * r


def in_triangle(x, y, pts):
    (ax, ay), (bx, by), (cx, cy) = pts

    def sign(px, py, qx, qy, rx, ry):
        return (px - rx) * (qy - ry) - (qx - rx) * (py - ry)

    d1 = sign(x, y, ax, ay, bx, by)
    d2 = sign(x, y, bx, by, cx, cy)
    d3 = sign(x, y, cx, cy, ax, ay)
    has_neg = d1 < 0 or d2 < 0 or d3 < 0
    has_pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (has_neg and has_pos)


def glyph_alpha(x, y):
    """1.0 where the glyph is opaque, 0.0 elsewhere."""
    if in_triangle(x, y, TRI):
        return 1.0
    x0, y0, x1, y1 = RECT
    inner = (x0 + STROKE, y0 + STROKE, x1 - STROKE, y1 - STROKE)
    if in_rounded_rect(x, y, RECT, RECT_RADIUS) and not in_rounded_rect(
        x, y, inner, max(RECT_RADIUS - STROKE, 0.4)
    ):
        return 1.0
    return 0.0


def render():
    px = bytearray()
    step = 1.0 / SS
    for row in range(SIZE):
        px.append(0)  # PNG filter type 0 (None)
        for col in range(SIZE):
            acc = 0.0
            for sy in range(SS):
                y = row + (sy + 0.5) * step
                for sx in range(SS):
                    x = col + (sx + 0.5) * step
                    acc += glyph_alpha(x, y)
            a = int(round(255 * acc / (SS * SS)))
            # Template images ignore RGB; keep it black so the file also looks
            # correct in any non-template preview.
            px.extend((0, 0, 0, a))
    return bytes(px)


def chunk(tag, data):
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def write_png(path, raw):
    ihdr = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)  # 8-bit RGBA
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


if __name__ == "__main__":
    out = Path(__file__).with_name("tray-icon.png")
    write_png(out, render())
    print(f"wrote {out} ({out.stat().st_size} bytes, {SIZE}x{SIZE} RGBA)")
