"""Tileable painted ground textures (256 px = 8 m at 32 px/m) + a tileable RGB noise texture."""
from __future__ import annotations

import math

import numpy as np

from paint import Canvas, bands, fbm, mix, rgb


def mix_hex(a, b, t):
    return mix(a, b, t)

SIZE = 256

GRASS_A = ["#3e6236", "#56783a", "#6a8e3c", "#7fa042", "#9ab64e"]
GRASS_B = ["#45683a", "#5e823c", "#749a40", "#8aac47", "#a7c457"]
DIRT = ["#5e4232", "#7c5a3f", "#9a7450", "#b48b5e", "#cfa775"]
COBBLE = ["#4a4550", "#6f6a70", "#8f8a86", "#aaa49a", "#cbc5b6"]
MORTAR = "#4b4038"


def _wrap_stamp(arr_rgb, mask_fn, color, x, y, r):
    """Stamp a small shape at (x, y) with wrap-around (for tileable textures)."""
    n = arr_rgb.shape[0]
    xi, yi = int(math.floor(x)), int(math.floor(y))
    rr = int(math.ceil(r)) + 1
    for dy in range(-rr, rr + 1):
        for dx in range(-rr, rr + 1):
            if mask_fn(dx + xi + 0.5 - x, dy + yi + 0.5 - y):
                arr_rgb[(yi + dy) % n, (xi + dx) % n] = color


def _blades(arr, rng, count, pal_idx_fn, pal, lit, max_len=4):
    n = arr.shape[0]
    for _ in range(count):
        x, y = rng.uniform(0, n), rng.uniform(0, n)
        length = rng.integers(2, max_len + 1)
        slant = rng.choice([-1, 0, 0, 1])
        v = lit[int(y) % n, int(x) % n]
        col = rgb(pal[pal_idx_fn(v, rng)])
        for k in range(length):
            xx = int(x + slant * (k / max(1, length - 1)) * 0.9) % n
            yy = int(y - k) % n
            arr[yy, xx] = col


def grass(seed=0, pal=GRASS_A, flowers=0.0):
    """Mostly one mid tone with soft patches, covered by short brush-stroke blades (ref. 05)."""
    rng = np.random.default_rng(seed)
    big = fbm(SIZE, SIZE, 64, 3, seed, tile=True)
    mid = fbm(SIZE, SIZE, 16, 3, seed + 5, tile=True)
    v = big * 0.6 + mid * 0.4
    arr = bands(v, [0.27, 0.68], pal[1:4]).copy()

    def idx(val, r):
        base = 1 + int(np.digitize(val, [0.27, 0.68]))
        step = r.choice([-1, -1, 1, 1, 2]) if base < 3 else r.choice([-1, -2, 1])
        return int(np.clip(base + step, 0, 4))

    _blades(arr, rng, 5000, idx, pal, v, 5)  # no distinctive motifs: they reveal the 8 m tiling
    if flowers > 0:
        cols = ["#f4f1e6", "#f2d04a", "#a58ad6", "#7aa7e0"]
        for _ in range(int(60 * flowers)):
            cx, cy = rng.uniform(0, SIZE), rng.uniform(0, SIZE)
            col = rgb(cols[rng.integers(len(cols))])
            for _k in range(rng.integers(3, 8)):
                x, y = cx + rng.normal(0, 4), cy + rng.normal(0, 3)
                arr[int(y) % SIZE, int(x) % SIZE] = col
    c = Canvas(SIZE, SIZE)
    c.px[..., :3] = arr
    c.px[..., 3] = 1
    return c


def dirt(seed=0):
    """Packed earth: gentle tone patches, thin dark ruts, pebbles with light top-left."""
    rng = np.random.default_rng(seed)
    v = fbm(SIZE, SIZE, 48, 3, seed, tile=True) * 0.75 + fbm(SIZE, SIZE, 8, 2, seed + 3, tile=True) * 0.25
    arr = bands(v, [0.4, 0.7], [DIRT[2], DIRT[3], mix_hex(DIRT[3], DIRT[4], 0.5)]).copy()
    # short scuffs (no long ruts: the tile is not aligned with the paths)
    for _ in range(60):
        x, y = rng.uniform(0, SIZE), rng.uniform(0, SIZE)
        for k in range(int(rng.integers(3, 7))):
            arr[int(y) % SIZE, int(x + k) % SIZE] = rgb(DIRT[1])
    _blades(arr, rng, 300, lambda val, r: int(r.choice([1, 4])), DIRT, v, 2)
    for _ in range(140):
        x, y = rng.uniform(0, SIZE), rng.uniform(0, SIZE)
        r = rng.uniform(0.9, 2.0)
        _wrap_stamp(arr, lambda dx, dy: (dx / (r * 1.3)) ** 2 + (dy / r) ** 2 <= 1, rgb(DIRT[1]), x + 0.7, y + 0.7, r * 1.3)
        _wrap_stamp(arr, lambda dx, dy: (dx / (r * 1.3)) ** 2 + (dy / r) ** 2 <= 1, rgb(COBBLE[3]), x, y, r * 1.3)
        _wrap_stamp(arr, lambda dx, dy: dx * dx + dy * dy <= 0.5, rgb(COBBLE[4]), x - r * 0.4, y - r * 0.4, 1)
    c = Canvas(SIZE, SIZE)
    c.px[..., :3] = arr
    c.px[..., 3] = 1
    return c


def cobble(seed=0, cells=16):
    """Village plaza paving: jittered Voronoi stones, mortar gaps, bevel light/shadow, moss."""
    rng = np.random.default_rng(seed)
    cell = SIZE / cells
    pts = []
    for j in range(cells):
        for i in range(cells):
            pts.append(((i + 0.5 + rng.uniform(-0.3, 0.3)) * cell, (j + 0.5 + rng.uniform(-0.3, 0.3)) * cell))
    pts = np.array(pts)
    tiled = np.concatenate([pts + np.array([dx, dy]) * SIZE for dx in (-1, 0, 1) for dy in (-1, 0, 1)])
    ys, xs = np.mgrid[0:SIZE, 0:SIZE].astype(float) + 0.5
    best = np.full((SIZE, SIZE), np.inf)
    second = np.full((SIZE, SIZE), np.inf)
    owner = np.zeros((SIZE, SIZE), int)
    for k, (px, py) in enumerate(tiled):
        d = np.hypot(xs - px, ys - py)
        closer = d < best
        second = np.where(closer, best, np.minimum(second, d))
        owner = np.where(closer, k % len(pts), owner)
        best = np.where(closer, d, best)
    gap = second - best
    tone = rng.uniform(-0.12, 0.12, len(pts))[owner]
    # bevel: direction from the stone center
    cx = pts[owner, 0]
    cy = pts[owner, 1]
    dxv = (xs - cx + SIZE / 2) % SIZE - SIZE / 2
    dyv = (ys - cy + SIZE / 2) % SIZE - SIZE / 2
    edge = (gap < 3.2).astype(float)  # 1-2 px bevel ring inside each stone
    lit = 0.5 + tone + edge * np.sign(-(dxv + dyv)) * 0.32
    noise = fbm(SIZE, SIZE, 8, 3, seed + 2, tile=True)
    lit += (noise - 0.5) * 0.18
    arr = bands(lit, [0.25, 0.45, 0.68], COBBLE[1:5]).copy()
    arr[gap < 1.6] = rgb(MORTAR)
    moss = (gap < 3.0) & (fbm(SIZE, SIZE, 24, 3, seed + 9, tile=True) > 0.6)
    arr[moss & (gap < 2.2)] = rgb("#4f6438")
    c = Canvas(SIZE, SIZE)
    c.px[..., :3] = arr
    c.px[..., 3] = 1
    return c


def noise_rgb(seed=0, size=128):
    c = Canvas(size, size)
    for k in range(3):
        c.px[..., k] = fbm(size, size, 16, 4, seed + k * 17, tile=True)
    # stretch to [0,1]
    for k in range(3):
        ch = c.px[..., k]
        c.px[..., k] = (ch - ch.min()) / max(1e-6, ch.max() - ch.min())
    c.px[..., 3] = 1
    return c
