#!/usr/bin/env python3
"""Erzeugt die PNG-Icons für die PWA - ohne externe Bibliotheken.

Aufruf:  python3 tools/make_icons.py
"""
import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "icons"
SS = 3  # Supersampling gegen Treppchen


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def rounded_rect(x, y, size, radius):
    """Innerhalb der abgerundeten Kachel?"""
    r = radius
    cx = min(max(x, r), size - r)
    cy = min(max(y, r), size - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def sample(x, y, size, maskable):
    """Farbe (r, g, b, a) für einen Punkt in Gerätekoordinaten."""
    pad = size * 0.14 if maskable else 0.0
    inner = size - 2 * pad

    if not maskable and not rounded_rect(x, y, size, size * 0.23):
        return (0, 0, 0, 0)

    # Hintergrundverlauf
    bg = lerp((27, 33, 69), (8, 11, 24), y / size)

    # Sterne
    for sx, sy, sr in ((0.24, 0.26, 0.020), (0.76, 0.20, 0.014), (0.30, 0.74, 0.013),
                       (0.70, 0.78, 0.018), (0.18, 0.52, 0.010)):
        px, py = pad + sx * inner, pad + sy * inner
        d = math.hypot(x - px, y - py)
        if d <= sr * inner:
            t = 1 - d / (sr * inner)
            bg = lerp(bg, (255, 255, 255), min(1.0, 0.35 + t))

    # Mondsichel: großer Kreis minus versetzter Kreis
    cx, cy = pad + 0.53 * inner, pad + 0.50 * inner
    r_out = 0.30 * inner
    bx, by = cx + 0.20 * inner, cy - 0.13 * inner
    r_bite = 0.28 * inner
    d_out = math.hypot(x - cx, y - cy)
    d_bite = math.hypot(x - bx, y - by)
    if d_out <= r_out and d_bite > r_bite:
        t = (x - (cx - r_out)) / (2 * r_out)
        moon = lerp((139, 125, 255), (74, 208, 216), max(0.0, min(1.0, t)))
        return (*moon, 255)

    return (*bg, 255)


def render(size, maskable=False):
    px = bytearray()
    for y in range(size):
        px.append(0)  # Filterbyte
        for x in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(SS):
                for sx in range(SS):
                    c = sample(
                        x + (sx + 0.5) / SS,
                        y + (sy + 0.5) / SS,
                        size,
                        maskable,
                    )
                    for i in range(4):
                        acc[i] += c[i]
            n = SS * SS
            px.extend(bytes(v // n for v in acc))
    return bytes(px)


def write_png(path, size, maskable=False):
    raw = render(size, maskable)

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)
    print(f"{path.name}: {len(png) // 1024} KB")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    write_png(OUT / "icon-192.png", 192)
    write_png(OUT / "icon-512.png", 512)
    write_png(OUT / "icon-maskable-512.png", 512, maskable=True)
