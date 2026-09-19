#!/usr/bin/env python3
"""Generate the macOS menu-bar template icon from `tray-icon.svg`.

Why a template icon instead of reusing icons/icon.png:
  macOS renders tray images as *template* images — it uses only the ALPHA
  channel and paints the pixels with the current menu-bar foreground colour
  (white on a dark menu bar, black on a light one). Feeding the full-colour app
  icon therefore yields a solid rounded-square blob. A purpose-made monochrome
  silhouette is required.

Why not trace the app logo:
  The robot head was traced from app-icon.png and rejected — the head's bottom
  border merges into the shoulder in the artwork, so there is no clean cut
  between them, and the traced ink has an uneven weight that reads as mush at
  18pt. A purpose-drawn icon from an open-source set is the better trade.

Source icon:
  `tray-icon.svg` — Lucide `radio-tower`. Lucide is the icon set the app UI
  already uses (lucide-react), so the tray mark stays in the same visual
  language. A radio tower reads as "live broadcast", which is what the app
  actually does — deliberately not a TV-with-play, which was too generic.
  To swap icons, drop another Lucide SVG in as `tray-icon.svg` and re-run.

Licence (ISC):
  Copyright (c) 2026 Lucide Icons and Contributors

  Permission to use, copy, modify, and/or distribute this software for any
  purpose with or without fee is hereby granted, provided that the above
  copyright notice and this permission notice appear in all copies.

  THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
  WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
  MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
  SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
  WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
  OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
  CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

Pipeline:
  1. Rasterise the SVG at SUPERSAMPLE x the final size (needs `rsvg-convert` or
     headless Chrome — the only external step; there is no pure-Python SVG
     renderer here).
  2. Area-average the alpha down to GLYPH_BOX, which is exact box filtering and
     so antialiases properly.
  3. Centre that in a SIZE x SIZE canvas and write it with black RGB, because
     template images ignore RGB and this keeps the file correct in any
     non-template preview.

Usage:
  python3 gen_tray_icon.py                     # write icons/tray-icon.png
  python3 gen_tray_icon.py --preview p.png     # also write a 6x mock-up
"""

import argparse
import shutil
import struct
import subprocess
import sys
import tempfile
import zlib
from pathlib import Path

SIZE = 36  # output px == 18pt @2x (tray-icon scales the image to an 18pt box)
GLYPH_BOX = 32  # the SVG is drawn into this box, centred in SIZE
SUPERSAMPLE = 8  # render at GLYPH_BOX * SUPERSAMPLE, then box-filter down

HERE = Path(__file__).resolve().parent
SVG = HERE / "tray-icon.svg"
OUT = HERE / "tray-icon.png"

CHROME_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
]


# ── PNG decode ───────────────────────────────────────────────────────────────
def decode_png(path):
    """Decode an 8-bit RGBA, non-interlaced PNG to (w, h, pixels)."""
    data = Path(path).read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path} is not a PNG")

    pos = 8
    idat = bytearray()
    w = h = None
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        tag = data[pos + 4 : pos + 8]
        body = data[pos + 8 : pos + 8 + length]
        if tag == b"IHDR":
            w, h, depth, ctype, _comp, _filt, interlace = struct.unpack(
                ">IIBBBBB", body
            )
            if depth != 8 or ctype != 6 or interlace != 0:
                raise ValueError(
                    "expected 8-bit RGBA, non-interlaced "
                    f"(got depth={depth} colour_type={ctype} interlace={interlace})"
                )
        elif tag == b"IDAT":
            idat += body
        elif tag == b"IEND":
            break
        pos += 12 + length

    raw = zlib.decompress(bytes(idat))
    bpp = 4
    stride = w * bpp
    out = bytearray(h * stride)
    prev = bytearray(stride)
    p = 0
    for row in range(h):
        ftype = raw[p]
        p += 1
        line = bytearray(raw[p : p + stride])
        p += stride
        if ftype == 1:  # Sub
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 0xFF
        elif ftype == 2:  # Up
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ftype == 3:  # Average
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif ftype == 4:  # Paeth
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        elif ftype != 0:
            raise ValueError(f"unknown PNG filter {ftype} on row {row}")
        out[row * stride : (row + 1) * stride] = line
        prev = line
    return w, h, bytes(out)


# ── PNG encode ───────────────────────────────────────────────────────────────
def _chunk(tag, data):
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def write_png(path, rgba, size):
    stride = size * 4
    filtered = bytearray()
    for row in range(size):
        filtered.append(0)  # filter type 0 (None)
        filtered += rgba[row * stride : (row + 1) * stride]
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    Path(path).write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", ihdr)
        + _chunk(b"IDAT", zlib.compress(bytes(filtered), 9))
        + _chunk(b"IEND", b"")
    )


# ── rasterise the SVG ────────────────────────────────────────────────────────
def _find_chrome():
    for path in CHROME_CANDIDATES:
        if Path(path).exists():
            return path
    for name in ("google-chrome", "chromium", "chromium-browser"):
        found = shutil.which(name)
        if found:
            return found
    return None


def rasterize(svg, px):
    """Rasterise `svg` to a px x px RGBA PNG in a temp file; return its bytes."""
    tmp = Path(tempfile.mkdtemp(prefix="tray-icon-"))
    out = tmp / "render.png"

    # Prefer rsvg-convert: small, fast, no browser.
    rsvg = shutil.which("rsvg-convert")
    if rsvg:
        subprocess.run(
            [rsvg, "--width", str(px), "--height", str(px), "-o", str(out), str(svg)],
            check=True,
        )
        return out

    chrome = _find_chrome()
    if chrome:
        # Chrome screenshots a page, so wrap the SVG in one that centres it on a
        # transparent background at exactly px x px.
        page = tmp / "page.html"
        page.write_text(
            "<!doctype html><meta charset='utf-8'>"
            "<style>html,body{margin:0;padding:0;background:transparent;"
            f"width:{px}px;height:{px}px;overflow:hidden}}"
            f"svg{{width:{px}px;height:{px}px;display:block;color:#000}}</style>"
            + svg.read_text()
        )
        subprocess.run(
            [
                chrome,
                "--headless",
                "--disable-gpu",
                "--hide-scrollbars",
                "--default-background-color=00000000",
                f"--screenshot={out}",
                f"--window-size={px},{px}",
                page.as_uri(),
            ],
            check=True,
            capture_output=True,
        )
        if out.exists():
            return out

    raise SystemExit(
        "error: no SVG rasteriser found.\n"
        "       Install one of:\n"
        "         brew install librsvg      # provides rsvg-convert\n"
        "         Google Chrome / Chromium\n"
        f"       then re-run {Path(__file__).name}."
    )


def box_downscale(pix, src, factor):
    """Area-average a src x src RGBA buffer down by an integer factor."""
    dst = src // factor
    out = bytearray(dst * dst)
    for y in range(dst):
        for x in range(dst):
            acc = 0
            for sy in range(factor):
                row = (y * factor + sy) * src
                for sx in range(factor):
                    acc += pix[(row + x * factor + sx) * 4 + 3]
            out[y * dst + x] = int(round(acc / (factor * factor)))
    return out


def compose(glyph, gsize, size):
    """Centre a gsize x gsize alpha buffer in a size x size RGBA buffer."""
    off = (size - gsize) // 2
    rgba = bytearray()
    for y in range(size):
        for x in range(size):
            gy, gx = y - off, x - off
            a = glyph[gy * gsize + gx] if 0 <= gx < gsize and 0 <= gy < gsize else 0
            # Template images ignore RGB; keep it black so the file also looks
            # correct in any non-template preview.
            rgba += bytes((0, 0, 0, a))
    return bytes(rgba)


def preview_png(rgba, size, path, factor=6, bg=(40, 40, 42)):
    """Write a nearest-neighbour mock-up over a menu-bar-like background."""
    rows = []
    for row in range(size):
        line = bytearray()
        for col in range(size):
            line += bytes([rgba[(row * size + col) * 4 + 3]]) * factor
        for _ in range(factor):
            rows.append(line)
    out = bytearray()
    for line in rows:
        for a in line:
            t = a / 255.0
            out += bytes(
                (
                    int(round(255 * t + bg[0] * (1 - t))),
                    int(round(255 * t + bg[1] * (1 - t))),
                    int(round(255 * t + bg[2] * (1 - t))),
                    255,
                )
            )
    write_png(path, bytes(out), size * factor)


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--preview", metavar="PATH", help="also write a 6x mock-up PNG")
    ap.add_argument("--svg", metavar="PATH", help=f"source SVG (default {SVG.name})")
    args = ap.parse_args()

    svg = Path(args.svg) if args.svg else SVG
    if not svg.exists():
        raise SystemExit(f"error: source SVG not found at {svg}")

    px = GLYPH_BOX * SUPERSAMPLE
    print(f"rasterising {svg.name} at {px}x{px}")
    rendered = rasterize(svg, px)
    w, h, pix = decode_png(rendered)
    print(f"  rendered {w}x{h}")

    if w % SUPERSAMPLE or h % SUPERSAMPLE or w != h:
        raise SystemExit(
            f"error: expected a square render divisible by {SUPERSAMPLE}, got {w}x{h}"
        )

    glyph = box_downscale(pix, w, SUPERSAMPLE)
    rgba = compose(glyph, w // SUPERSAMPLE, SIZE)
    write_png(OUT, rgba, SIZE)

    inked = sum(1 for a in glyph if a > 8)
    print(f"wrote {OUT} ({SIZE}x{SIZE}, {OUT.stat().st_size} bytes)")
    print(f"  glyph {w // SUPERSAMPLE}x{w // SUPERSAMPLE} centred in {SIZE}x{SIZE}")
    print(f"  {inked} of {(w // SUPERSAMPLE) ** 2} glyph px inked")

    if args.preview:
        preview_png(rgba, SIZE, Path(args.preview))
        print(f"wrote {args.preview}")


if __name__ == "__main__":
    sys.exit(main())
