#!/usr/bin/env python3
"""Generate apps/desktop/build/icon.png — no image libraries, no network.

The mark is the Sudarshan chakra rendered as a control surface: a ring (the
boundary the agent cannot cross), eight spokes (the capabilities that can be
attached and removed), and a solid hub (the harness core that stays).

Anti-aliasing is analytic: every band is a smoothstep on a signed distance, so
edges stay crisp at 1024px without supersampling. Run:

    python3 apps/desktop/scripts/make_icon.py
"""
import math
import os
import struct
import zlib

SIZE = 1024
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "build", "icon.png")

BG_TOP = (18, 18, 27, 255)
BG_BOT = (8, 8, 12, 255)
CYAN = (125, 211, 252, 255)
CYAN_SOFT = (125, 211, 252, 90)
WHITE = (233, 244, 252, 255)
VIOLET = (167, 139, 250, 255)


def clamp01(v):
    return 0.0 if v < 0.0 else (1.0 if v > 1.0 else v)


def smooth(edge0, edge1, x):
    t = clamp01((x - edge0) / (edge1 - edge0)) if edge1 != edge0 else (1.0 if x >= edge1 else 0.0)
    return t * t * (3.0 - 2.0 * t)


def band(lo, hi, feather, d):
    """1.0 inside [lo, hi], feathered on both sides by `feather` (in d units)."""
    return smooth(lo - feather, lo + feather, d) * (1.0 - smooth(hi - feather, hi + feather, d))


def over(dst, src, alpha):
    if alpha <= 0.0:
        return dst
    a = alpha * (src[3] / 255.0)
    da = dst[3] / 255.0
    out_a = a + da * (1.0 - a)
    if out_a <= 0.0:
        return (0, 0, 0, 0)
    rgb = tuple(
        int(round((src[i] * a + dst[i] * da * (1.0 - a)) / out_a)) for i in range(3)
    )
    return (rgb[0], rgb[1], rgb[2], int(round(out_a * 255.0)))


def rounded_square_alpha(x, y, half, radius, feather):
    """Signed distance to a rounded square, returned as coverage."""
    qx = abs(x) - (half - radius)
    qy = abs(y) - (half - radius)
    outside = math.hypot(max(qx, 0.0), max(qy, 0.0))
    inside = min(max(qx, qy), 0.0)
    d = outside + inside - radius
    return 1.0 - smooth(-feather, feather, d)


def main():
    px = SIZE
    rows = []
    spokes = 8
    half = 0.94
    radius = 0.30

    for j in range(px):
        row = bytearray()
        row.append(0)  # PNG filter: none
        y = (0.5 - (j + 0.5) / px) * 2.0  # +1 at the top
        for i in range(px):
            x = ((i + 0.5) / px - 0.5) * 2.0
            r = math.hypot(x, y)

            bg_a = rounded_square_alpha(x, y, half, radius, 0.012)
            if bg_a <= 0.0:
                row += b"\x00\x00\x00\x00"
                continue

            mix = smooth(-half, half, -y)  # 1 at the top
            bg = (
                int(BG_BOT[0] + (BG_TOP[0] - BG_BOT[0]) * mix),
                int(BG_BOT[1] + (BG_TOP[1] - BG_BOT[1]) * mix),
                int(BG_BOT[2] + (BG_TOP[2] - BG_BOT[2]) * mix),
                255,
            )
            col = (bg[0], bg[1], bg[2], int(bg_a * 255))

            # faint outer glow just inside the tile edge
            glow = band(0.78, 0.93, 0.05, r) * 0.16
            col = over(col, CYAN_SOFT, glow)

            # the ring: the boundary
            ring = band(0.60, 0.70, 0.008, r)
            col = over(col, CYAN, ring)

            # ring highlight (upper-left light)
            ang = math.atan2(y, x)
            light = 0.5 + 0.5 * math.cos(ang - math.radians(135))
            col = over(col, WHITE, ring * light * 0.28)

            # spokes: attachable capabilities
            if r < 0.60:
                sector = (ang / (2.0 * math.pi)) % 1.0 * spokes
                frac = abs(sector - math.floor(sector) - 0.5)  # 0 at spoke centre
                width = 0.16 + 0.20 * smooth(0.18, 0.58, r)     # taper outward
                spoke = (1.0 - smooth(width - 0.06, width + 0.06, frac)) * smooth(0.17, 0.24, r) * (1.0 - smooth(0.545, 0.595, r))
                col = over(col, CYAN, spoke * 0.92)

            # hub: the core that never moves
            hub = 1.0 - smooth(0.155, 0.175, r)
            col = over(col, CYAN, hub)
            core = 1.0 - smooth(0.055, 0.075, r)
            col = over(col, WHITE, core * 0.85)

            # a single violet spoke accent: the human approval channel
            vsector = (ang / (2.0 * math.pi)) % 1.0 * spokes
            vfrac = abs(vsector - math.floor(vsector) - 0.5)
            vacc = (1.0 - smooth(0.10, 0.20, vfrac)) * band(0.70, 0.78, 0.01, r)
            col = over(col, VIOLET, vacc * 0.85)

            row += bytes((col[0], col[1], col[2], col[3]))
        rows.append(bytes(row))

    raw = b"".join(rows)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", px, px, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "wb") as fh:
        fh.write(png)
    print(f"wrote {os.path.normpath(OUT)} ({len(png) // 1024} KiB, {px}x{px})")


if __name__ == "__main__":
    main()
