"""Painted nature sprites for the Campos de Rondoria biome.

Each painter returns (sprite: Canvas, anchor: (x, y), shadow: Canvas | None, shadow_anchor) where
anchor is the pixel where the object touches the ground (sprites are painted as seen by the game
camera: heights are foreshortened by cos(40°)).

Style rules (G1 review): big leafy lobes in 2-3 layers with a continuous soft ink arc under each
lobe, highlights only in small clusters at the upper-left, clean flat tones (no pixel noise),
light from the upper-left, warm lights and cool shadows, ink #1b1424.
"""
from __future__ import annotations

import math

import numpy as np

from paint import (
    COS_P, INK, PX_PER_M, SHADOW_DIR_PX, SHADOW_PER_M_HEIGHT, Canvas, bands, boundary, dilate, dome_normals,
    ellipse, fbm, fill_holes, ground_shadow, lambert, line_mask, mix, polygon, rgb, scallop, scatter_points, shift,
)

# ----------------------------------------------------------------------------- palettes

FOLIAGE = {  # deep, shadow, mid, light, highlight
    "oak": ["#1e3b36", "#2d5a3a", "#4b8535", "#78ad3d", "#b2d35c"],
    "oak_autumn": ["#3b2729", "#7a3c29", "#b8622d", "#e0983a", "#f6d26a"],
    "oak_blossom": ["#1e3b36", "#2d5a3a", "#4b8535", "#78ad3d", "#b2d35c"],
    "birch": ["#22403a", "#3a6a3e", "#64a03f", "#93c44d", "#cde47c"],
    "pine": ["#11292b", "#1d4036", "#2c5f41", "#4c8748", "#84b257"],
    "bush": ["#1c3a33", "#2b5737", "#478139", "#70a842", "#a9ce5b"],
}
BARK = ["#2b1d1c", "#553524", "#8a5a3a", "#b58256", "#d0a272"]
BIRCH_BARK = ["#2a2430", "#7d7680", "#c9c3b8", "#ece8dc", "#fbf8ef"]
DEAD_WOOD = ["#2a2226", "#4e4440", "#7a6d62", "#a39484", "#c4b6a2"]
STONE = ["#3d3a48", "#5f5b68", "#8c877f", "#b7b1a3", "#dcd6c6"]
MOSS = ["#3e6234", "#5b8f34", "#7aa83f"]
GRASS = ["#2b5236", "#3f7037", "#5e9640", "#86b84a", "#b4d66a"]
FLOWER = {  # dark, petal, center
    "white": ["#b9b3c4", "#f4f1e6", "#f2d04a"],
    "yellow": ["#b88a24", "#f2d04a", "#fff3b0"],
    "lilac": ["#6c58a4", "#a58ad6", "#f2d04a"],
    "blue": ["#3f63a8", "#7aa7e0", "#f4f1e6"],
    "red": ["#93302a", "#e0563f", "#f2d04a"],
    "pink": ["#a3496c", "#e889ac", "#fff0b0"],
}
SOFT_INK = mix(INK, "#1e3b36", 0.3)


def _m(meters):
    return meters * PX_PER_M


def _shadow_offset(height_m, factor=0.6):
    return SHADOW_DIR_PX * SHADOW_PER_M_HEIGHT * height_m * factor


def _darker(pal):
    """Cooler, darker variant of a foliage palette for the back layer."""
    return [mix(c, "#173040", 0.28) for c in pal]


# ----------------------------------------------------------------------------- canopy

def paint_lobes(c: Canvas, lobes, pal, seed, crown, blossoms=None):
    """Big leafy lobes (cx, cy, rx, ry, layer) painted back (layer 0) to front (layer 2)."""
    rng = np.random.default_rng(seed)
    gcx, gcy, grx, gry = crown
    gn = dome_normals(c, gcx, gcy, grx, gry / grx)
    xs, ys = c.grid()
    painted = np.zeros((c.h, c.w), bool)
    order = sorted(range(len(lobes)), key=lambda i: (lobes[i][4], lobes[i][1]))
    for idx in order:
        cx, cy, rx, ry, layer = lobes[idx]
        p = _darker(pal) if layer == 0 else pal
        m = scallop(c, cx, cy, rx, bumps=int(rng.integers(10, 14)), depth=0.085, phase=rng.uniform(0, 6.3),
                    squash=ry / rx, seed=seed * 31 + idx, wobble=0.05)
        n = 0.6 * dome_normals(c, cx - rx * 0.1, cy - ry * 0.15, rx * 1.05, ry / rx) + 0.4 * gn
        n /= np.linalg.norm(n, axis=-1, keepdims=True)
        lit = lambert(n) - (0.3 if layer == 0 else 0.08 if layer == 1 else 0.0)
        col = bands(lit, [-0.22, 0.18, 0.56], p[:4])
        # darker band along the bottom of the lobe (the "layer" read of ref. 05)
        bottom = m & ~shift(m, 0, -3)
        col[bottom & (lit > 0.18)] = rgb(p[2])
        col[bottom & (lit <= 0.18)] = rgb(p[1])
        # 2-3 sub-clumps on the lit upper-left: lighter, each with its own darker underside
        for k in range(int(rng.integers(2, 4))):
            sx = cx - rx * rng.uniform(0.05, 0.45)
            sy = cy - ry * rng.uniform(0.2, 0.5)
            sr = rx * rng.uniform(0.32, 0.45)
            sm = scallop(c, sx, sy, sr, bumps=int(rng.integers(7, 10)), depth=0.1, squash=0.85, seed=seed + 7 * k + idx) & m
            sl = lit + 0.12
            sub = bands(sl, [-0.22, 0.18, 0.56], p[:4])
            col = np.where(sm[..., None], sub, col)
            under = sm & ~shift(sm, 0, -1)
            col[under & (sl > 0.18)] = rgb(p[2])
        # highlight clusters (2-4 px) only on the brightest upper-left part
        for (px, py) in scatter_points(rng, m & (lit > 0.62) & (ys < cy), int(rng.integers(3, 7)), min_dist=5):
            for dx in (-1.6, 1.4) if rng.random() < 0.5 else (0.0,):  # 1-2 small leaf scales
                hl = ellipse(c, px + dx, py, 1.7, 1.3) & (ys <= py + 0.4) & m
                col[hl] = rgb(p[4])
                col[hl & ~shift(hl, 0, -1)] = rgb(p[3])
        c.fill(m, col)
        # continuous soft ink arc under the lobe where it overlaps what is behind it
        if painted.any():
            arc = boundary(m) & dilate(painted, 1) & (ys > cy - ry * 0.25)
            c.fill(arc, SOFT_INK)
        painted |= m
    holes = fill_holes(painted | (c.alpha > 0.5)) & ~(c.alpha > 0.5)
    c.fill(holes, pal[0])
    painted |= holes
    if blossoms:
        colors, count = blossoms
        for (px, py) in scatter_points(rng, painted & ~dilate(boundary(painted), 1), count, min_dist=5):
            f = FLOWER[colors[rng.integers(len(colors))]]
            c.fill(ellipse(c, px, py, 1.4, 1.2), f[1])
            c.fill(ellipse(c, px + 0.6, py + 0.6, 0.6, 0.6) & ~ellipse(c, px, py, 1.0, 0.9), f[0])
            c.fill(ellipse(c, px, py, 0.5, 0.5), f[2])
    return painted


def crown_lobes(rng, gcx, gcy, grx, gry, gap=True):
    """5-7 big round-ish lobes in three layers filling the crown ellipse; the front layer leaves a
    gap at the bottom center so the trunk fork shows through."""
    lobes = []

    def lobe(x, y, r, layer):
        rx = r * rng.uniform(0.95, 1.05)
        lobes.append((x + rng.uniform(-3, 3), y + rng.uniform(-2, 2), rx, rx * rng.uniform(0.8, 0.9), layer))

    r = grx * 0.5
    # back layer: the crown top
    for t in (-0.5, 0.0, 0.5):
        lobe(gcx + t * grx, gcy - gry * (0.55 - 0.25 * abs(t)), r * (0.95 if t else 1.05), 0)
    # middle layer: the bulk, slightly wider
    for t in (-0.62, 0.0, 0.62):
        lobe(gcx + t * grx, gcy - gry * 0.02, r * (0.92 if t else 1.0), 1)
    # front layer: bottom left/right with a gap for the fork, plus one upper-front lobe
    spread = 0.5 if gap else 0.3
    for t in (-spread, spread):
        lobe(gcx + t * grx, gcy + gry * 0.45, r * 0.86, 2)
    lobe(gcx - grx * 0.2, gcy - gry * 0.3, r * 0.82, 2)
    return lobes


# ----------------------------------------------------------------------------- trunks

def trunk_mask(c: Canvas, base_x, base_y, top_y, w_base, w_top, lean=0.0, flare=1.9, seed=0, roots=True):
    rng = np.random.default_rng(seed)
    pts_l, pts_r = [], []
    steps = 12
    for k in range(steps + 1):
        t = k / steps
        y = base_y + (top_y - base_y) * t
        x = base_x + lean * t * t + math.sin(t * 3.1 + rng.uniform(0, 1)) * 0.8
        w = w_base + (w_top - w_base) * t
        if t < 0.22:
            w *= 1 + (flare - 1) * (1 - t / 0.22) ** 2.2
        pts_l.append((x - w / 2, y))
        pts_r.append((x + w / 2, y))
    m = polygon(c, pts_l + pts_r[::-1])
    if roots:  # root knuckles spreading on the ground
        for sx, ln in ((-1, w_base * 1.25), (1, w_base * 1.1), (-0.3, w_base * 0.6)):
            m |= polygon(c, [(base_x + sx * w_base * 0.2, base_y - w_base * 0.5),
                             (base_x + sx * ln, base_y + 1.5), (base_x + sx * w_base * 0.25, base_y + 1)])
    return m


def branch_mask(c: Canvas, pts, w0, w1):
    m = np.zeros((c.h, c.w), bool)
    for i in range(len(pts) - 1):
        t0, t1 = i / (len(pts) - 1), (i + 1) / (len(pts) - 1)
        a, b = np.array(pts[i], float), np.array(pts[i + 1], float)
        d = b - a
        n = np.array([-d[1], d[0]]) / max(np.linalg.norm(d), 1e-6)
        wa, wb = (w0 + (w1 - w0) * t0) / 2, (w0 + (w1 - w0) * t1) / 2
        m |= polygon(c, [a - n * wa, b - n * wb, b + n * wb, a + n * wa])
    return m


def paint_wood(c: Canvas, m, pal, seed, grooves=True):
    """Cylindrical shading across each row (light left #b58256, dark right #553524) with sparse
    vertical grooves and light flecks on the lit side."""
    rows = np.where(m.any(axis=1))[0]
    rel = np.zeros((c.h, c.w))
    for y in rows:
        cols = np.where(m[y])[0]
        # handle several separate spans per row (forks)
        splits = np.where(np.diff(cols) > 1)[0]
        for seg in np.split(cols, splits + 1):
            x0, x1 = seg.min(), seg.max() + 1
            rel[y, x0:x1] = (np.arange(x0, x1) + 0.5 - x0) / max(1, x1 - x0)
    lit = 0.8 - rel * 1.55
    col = bands(lit, [-0.45, 0.05, 0.42], pal[1:5])
    if grooves:
        rng = np.random.default_rng(seed)
        g = np.zeros((c.h, c.w), bool)
        xs, ys = c.grid()
        for (px, py) in scatter_points(rng, m & (rel > 0.2) & (rel < 0.85), int(m.sum() / 55) + 1):
            ln = rng.uniform(4, 9)
            g |= line_mask(c, [(px, py), (px + rng.uniform(-0.8, 0.8), py + ln)], 1)
        col[g & m] = rgb(pal[1])
        for (px, py) in scatter_points(rng, m & (rel < 0.3), int(m.sum() / 80) + 1):
            col[line_mask(c, [(px, py), (px, py + rng.uniform(2, 4))], 1) & m] = rgb(pal[4])
    c.fill(m, col)


# ----------------------------------------------------------------------------- trees

OAK_SHAPES = {  # height m, crown width m, trunk width m, lean px, twin trunk
    "round": (6.2, 5.0, 0.58, 0, False),
    "wide": (6.0, 7.8, 0.8, 0, False),
    "tall": (8.0, 3.9, 0.5, 0, False),
    "lean": (6.4, 4.8, 0.54, 14, False),
    "twin": (6.8, 6.4, 0.44, 0, True),
    "hero": (9.6, 7.6, 1.0, 0, False),
}


def oak(seed=0, shape="round", pal_name="oak", blossoms=None):
    rng = np.random.default_rng(seed)
    height_m, width_m, trunk_m, lean, twin = OAK_SHAPES[shape]
    H0 = int(_m(height_m) * COS_P) + 12
    W = int(_m(width_m)) + 14 + abs(lean)
    H = H0 + 40  # headroom: lobes bulge above the nominal crown
    c = Canvas(W, H)
    base = (W / 2 - lean / 2 + rng.uniform(-2, 2), H - 5)
    crown_h = H0 * (0.62 if shape != "tall" else 0.7)
    top = 45
    gcx, gcy = W / 2 + lean / 2, top + crown_h * 0.5
    grx, gry = _m(width_m) * 0.48, crown_h * 0.5
    fork_y = gcy + gry * 0.55
    tw = _m(trunk_m)
    tm = np.zeros((c.h, c.w), bool)
    trunks = [(base[0] - tw * 0.3, -1), (base[0] + tw * 0.35, 1)] if twin else [(base[0], 0)]
    for bx, side in trunks:
        tm |= trunk_mask(c, bx, base[1], fork_y, tw * (0.8 if twin else 1), tw * 0.62, lean=lean + side * 10, seed=seed + side)
    # Y fork: two limbs reaching into the crown (visible through the gap between front lobes)
    fx = base[0] + lean
    for sx in (-1, 1):
        tm |= branch_mask(c, [(fx, fork_y + 4), (fx + sx * grx * 0.25, gcy + gry * 0.1), (fx + sx * grx * 0.42, gcy - gry * 0.2)],
                          tw * 0.55, tw * 0.25)
    paint_wood(c, tm, BARK, seed)
    lobes = crown_lobes(rng, gcx, gcy, grx, gry)
    if shape == "hero":  # extra lobes for the old giant
        lobes += [(gcx - grx * 0.85, gcy + gry * 0.05, grx * 0.32, gry * 0.38, 1),
                  (gcx + grx * 0.85, gcy + gry * 0.02, grx * 0.32, gry * 0.38, 1)]
    canopy = paint_lobes(c, lobes, FOLIAGE[pal_name], seed, (gcx, gcy, grx, gry), blossoms=blossoms)
    # crown shadow falling on the top of the trunk
    c.paint(tm & ~canopy & shift(canopy, 2, 9) & ~shift(canopy, 2, 0), BARK[1])
    c.outline(INK)
    shadow, sanchor = crown_shadow(canopy, base, height_m, tw, seed)
    sprite, (ox, oy) = c.crop_to_content()
    anchor = (base[0] - ox, base[1] - oy)
    return sprite, anchor, shadow, sanchor


def crown_shadow(canopy, base, height_m, trunk_w, seed, squash=0.42):
    """Ground shadow cast by the painted crown: the crown mask flattened and pushed toward the
    lower right, lobed edge, a trunk streak and a few sun flecks inside."""
    from PIL import Image as _Image
    rng = np.random.default_rng(seed)
    ys_, xs_ = np.where(canopy)
    x0, x1, y0, y1 = xs_.min(), xs_.max() + 1, ys_.min(), ys_.max() + 1
    crop = _Image.fromarray((canopy[y0:y1, x0:x1] * 255).astype(np.uint8))
    hh = max(4, int((y1 - y0) * squash))
    flat = np.asarray(crop.resize((x1 - x0, hh), _Image.NEAREST)) > 127
    off = _shadow_offset(height_m * 0.4, factor=0.5)
    pad = 12
    W = (x1 - x0) + int(abs(off[0])) + pad * 2
    H = hh + int(abs(off[1])) + pad * 2 + 10
    c = Canvas(W, H)
    c.binary_alpha = False
    # anchor (tree base) inside the shadow canvas: crown center lands below-right of the base
    bx = base[0] - x0 + pad
    by = pad + 4
    m = np.zeros((H, W), bool)
    ox, oy = int(pad + off[0] * 0.6), int(by + off[1] * 0.6 - hh * 0.35)
    m[max(0, oy):oy + hh, ox:ox + (x1 - x0)] = flat[max(0, -oy):, :][: H - max(0, oy), : W - ox]
    xs, ys = c.grid()
    for t in np.linspace(0, 0.8, 5):  # trunk streak from the base toward the crown shadow
        m |= ((xs - (bx + off[0] * 0.35 * t)) / (trunk_w * 0.5 + 1)) ** 2 + ((ys - (by + off[1] * 0.35 * t)) / 2.5) ** 2 <= 1
    for (px, py) in scatter_points(rng, m & ~dilate(boundary(m), 3), int(rng.integers(2, 5)), min_dist=8):
        m &= ~ellipse(c, px, py, rng.uniform(2, 3.5), rng.uniform(1.2, 2))  # sun flecks
    from paint import SHADOW_ALPHA, SHADOW_COLOR
    c.fill(m, SHADOW_COLOR, SHADOW_ALPHA)
    shadow, (sx, sy) = c.crop_to_content(0)
    return shadow, (bx - sx, by - sy)


def birch(seed=0, height_m=6.4):
    rng = np.random.default_rng(seed)
    H = int(_m(height_m) * COS_P) + 10
    W = int(_m(3.4)) + 12
    c = Canvas(W, H)
    base = (W / 2, H - 4)
    gcx, gcy = W / 2 + rng.uniform(-3, 3), H * 0.38
    grx, gry = W * 0.42, H * 0.3
    tm = trunk_mask(c, base[0], base[1], gcy - gry * 0.5, _m(0.24), _m(0.12), lean=rng.uniform(-5, 5), flare=1.5, seed=seed)
    paint_wood(c, tm, BIRCH_BARK, seed, grooves=False)
    # birch marks: short dark horizontal dashes
    for (px, py) in scatter_points(rng, tm, int(tm.sum() / 24), min_dist=3):
        c.paint(line_mask(c, [(px - 2, py), (px + 2, py + rng.uniform(-0.6, 0.6))], 1) & tm, BIRCH_BARK[0])
    lobes = []
    for k in range(7):  # loose, airy crown of small lobes
        a = k / 7 * math.pi * 2 + rng.uniform(-0.3, 0.3)
        r = rng.uniform(0.35, 0.75)
        lobes.append((gcx + math.cos(a) * grx * r, gcy + math.sin(a) * gry * r * 0.9, grx * rng.uniform(0.34, 0.42),
                      gry * rng.uniform(0.34, 0.42), 0 if math.sin(a) < -0.3 else (2 if math.sin(a) > 0.4 else 1)))
    lobes.append((gcx, gcy, grx * 0.45, gry * 0.45, 1))
    canopy = paint_lobes(c, lobes, FOLIAGE["birch"], seed, (gcx, gcy, grx, gry))
    c.paint(tm & ~canopy & shift(canopy, 1, 6) & ~shift(canopy, 1, 0), BIRCH_BARK[1])
    c.outline(INK)
    shadow, sanchor = crown_shadow(canopy, base, height_m, _m(0.24), seed)
    sprite, (ox, oy) = c.crop_to_content()
    return sprite, (base[0] - ox, base[1] - oy), shadow, sanchor


def dead_tree(seed=0, height_m=5.2):
    rng = np.random.default_rng(seed)
    H = int(_m(height_m) * COS_P) + 10
    W = int(_m(3.6)) + 10
    c = Canvas(W, H)
    base = (W / 2, H - 4)
    tw = _m(0.36)
    m = trunk_mask(c, base[0], base[1], H * 0.42, tw, tw * 0.55, lean=rng.uniform(-4, 4), seed=seed)

    def grow(x, y, ang, ln, w, depth):
        nonlocal m
        ex, ey = x + math.cos(ang) * ln, y - math.sin(ang) * ln
        m |= branch_mask(c, [(x, y), ((x + ex) / 2 + rng.uniform(-2, 2), (y + ey) / 2), (ex, ey)], w, max(1.2, w * 0.55))
        if depth > 0:
            for da in (-0.5, 0.45):
                grow(ex, ey, ang + da + rng.uniform(-0.2, 0.2), ln * rng.uniform(0.55, 0.7), max(1.2, w * 0.6), depth - 1)

    grow(base[0], H * 0.44, math.pi / 2 + 0.5, _m(1.0), tw * 0.5, 2)
    grow(base[0], H * 0.48, math.pi / 2 - 0.45, _m(1.1), tw * 0.5, 2)
    grow(base[0], H * 0.42, math.pi / 2, _m(1.2), tw * 0.45, 2)
    paint_wood(c, m, DEAD_WOOD, seed)
    c.outline(INK)
    sprite, (ox, oy) = c.crop_to_content()
    sw, sh = int(W + 20), 30
    shadow, (sx, sy) = ground_shadow(sw, sh, [(sw * 0.45 + 8, 12, W * 0.32, 5), (sw * 0.45, 6, tw * 0.6, 3)], seed).crop_to_content(0)
    return sprite, (base[0] - ox, base[1] - oy), shadow, (sw * 0.45 - sx, 6 - sy)


def pine(seed=0, height_m=7.0, width_m=3.2):
    rng = np.random.default_rng(seed)
    H = int(_m(height_m) * COS_P) + 10
    W = int(_m(width_m)) + 12
    c = Canvas(W, H)
    base = (W / 2, H - 4)
    pal = FOLIAGE["pine"]
    tm = trunk_mask(c, base[0], base[1], H * 0.6, _m(0.3), _m(0.18), flare=1.7, seed=seed)
    paint_wood(c, tm, BARK, seed)
    tiers = int(np.clip(round(height_m / 1.35), 4, 8))
    top = 4
    bottom = H - _m(0.8) * COS_P
    xs, ys = c.grid()
    painted = np.zeros((c.h, c.w), bool)
    for k in range(tiers):  # bottom tier first; upper tiers overlap it
        t = k / (tiers - 1)
        ty_bottom = bottom - (bottom - top) * 0.8 * t
        tier_h = (bottom - top) * (0.34 - 0.12 * t) * (5 / tiers) ** 0.5
        half_w = (W / 2 - 5) * (1 - 0.74 * t) * rng.uniform(0.94, 1.04)
        apex_y = ty_bottom - tier_h * 1.3
        cx = W / 2 + rng.uniform(-1.5, 1.5)
        u = (xs - cx) / half_w
        hem = ty_bottom - 3 * (1 - u * u) + 2.4 * np.abs(np.sin(u * (6 + k) * math.pi * 0.5 + seed))
        side = apex_y + (ty_bottom - apex_y) * np.abs(u) ** 0.8
        m = (np.abs(u) <= 1) & (ys >= side) & (ys <= hem)
        lit = -u * 0.85 + 0.2 + (1 - (ys - apex_y) / max(1, tier_h * 1.3)) * 0.3
        col = bands(lit, [-0.4, 0.0, 0.45], pal[1:5])
        # cold band under each tier (2-3 px above the hem)
        col[m & (ys > hem - 3)] = rgb("#1f3d32")
        # V-shaped needle tufts: two short diagonal strokes meeting at the bottom
        for (px, py) in scatter_points(rng, m & (ys < hem - 3), int(m.sum() / 26), min_dist=3):
            v = lit[int(py), int(px)]
            tone = pal[4] if v > 0.45 else (pal[3] if v > 0.0 else pal[1])
            vm = line_mask(c, [(px - 1.6, py - 1.6), (px, py), (px + 1.6, py - 1.6)], 1) & m
            col[vm] = rgb(tone)
        c.fill(m, col)
        if painted.any():
            c.fill(boundary(m) & painted & (ys > apex_y + tier_h * 0.6), SOFT_INK)
        painted |= m
    c.paint(shift(painted, 1, 5) & ~painted & tm, BARK[1])
    c.outline(INK)
    sprite, (ox, oy) = c.crop_to_content()
    off = _shadow_offset(height_m * 0.5)
    sw, sh = int(W + off[0] + 18), int(H * 0.35 + off[1] + 22)
    sax, say = sw * 0.32, sh * 0.25
    blobs = [(sax + off[0] * t, say + off[1] * t, 4 + (W * 0.32) * t, 3 + (W * 0.16) * t) for t in np.linspace(0, 1.05, 8)]
    shadow, (sx, sy) = ground_shadow(sw, sh, blobs, seed).crop_to_content(0)
    return sprite, (base[0] - ox, base[1] - oy), shadow, (sax - sx, say - sy)


# ----------------------------------------------------------------------------- bushes

def bush(seed=0, width_m=1.7, height_m=1.15, blossoms=None, berries=False, pal_name="bush"):
    rng = np.random.default_rng(seed)
    W = int(_m(width_m)) + 8
    H = int(_m(height_m) * COS_P) + 10
    c = Canvas(W, H)
    base = (W / 2, H - 3)
    gcx, gcy = W / 2, H * 0.55
    grx, gry = W * 0.46, H * 0.44
    lobes = [
        (gcx - grx * 0.42, gcy - gry * 0.2, grx * 0.55, gry * 0.6, 0),
        (gcx + grx * 0.4, gcy - gry * 0.25, grx * 0.55, gry * 0.6, 0),
        (gcx, gcy - gry * 0.35, grx * 0.55, gry * 0.6, 1),
        (gcx - grx * 0.45, gcy + gry * 0.3, grx * 0.5, gry * 0.52, 2),
        (gcx + grx * 0.42, gcy + gry * 0.28, grx * 0.52, gry * 0.52, 2),
    ]
    painted = paint_lobes(c, lobes, FOLIAGE[pal_name], seed, (gcx, gcy, grx, gry), blossoms=blossoms)
    if berries:
        for (px, py) in scatter_points(rng, painted & ~dilate(boundary(painted), 1), 10, min_dist=4):
            c.fill(ellipse(c, px, py, 1.4, 1.4), "#b8283a")
            c.fill(ellipse(c, px - 0.6, py - 0.6, 0.5, 0.5), "#ffb0a0")
    c.outline(INK)
    sprite, (ox, oy) = c.crop_to_content()
    off = _shadow_offset(height_m * 0.5)
    sw, sh = int(W + off[0] + 12), int(H * 0.6 + off[1] + 12)
    sax, say = sw * 0.42, sh * 0.35
    shadow, (sx, sy) = ground_shadow(sw, sh, [(sax + off[0] * 0.6, say + off[1] * 0.4, grx * 1.0, gry * 0.55)], seed).crop_to_content(0)
    return sprite, (base[0] - ox, base[1] - oy), shadow, (sax - sx, say - sy)


def hedge(seed=0, length_m=2.6):
    rng = np.random.default_rng(seed)
    W, H = int(_m(length_m)) + 10, int(_m(1.2) * COS_P) + 12
    c = Canvas(W, H)
    gcx, gcy, grx, gry = W / 2, H * 0.55, W * 0.47, H * 0.42
    lobes = []
    n = max(3, int(length_m / 0.7))
    for k in range(n):
        x = 6 + (W - 12) * (k + 0.5) / n
        lobes.append((x, gcy - gry * 0.25, (W - 12) / n * 0.75, gry * 0.62, 0 if k % 2 else 1))
        lobes.append((x + rng.uniform(-3, 3), gcy + gry * 0.3, (W - 12) / n * 0.7, gry * 0.5, 2))
    paint_lobes(c, lobes, FOLIAGE["bush"], seed, (gcx, gcy, grx, gry))
    c.outline(INK)
    sprite, (ox, oy) = c.crop_to_content()
    shadow, (sx, sy) = ground_shadow(W + 16, 26, [(W / 2 + 8, 12, W * 0.48, 7)], seed).crop_to_content(0)
    return sprite, (W / 2 - ox, H - 3 - oy), shadow, (W / 2 - sx, 6 - sy)


# ----------------------------------------------------------------------------- rocks

def rock(seed=0, width_m=1.1, height_m=0.7, moss=0.35, lumps=1, buried=0.0, grass=True):
    rng = np.random.default_rng(seed)
    W = int(_m(width_m) * (1 + 0.5 * (lumps - 1))) + 10
    H = int(_m(height_m) * COS_P + _m(width_m) * 0.5 * 0.64) + 10
    c = Canvas(W, H)
    xs, ys = c.grid()
    total = np.zeros((c.h, c.w), bool)
    base = (W / 2, H - 5)
    for li in range(lumps):
        lw = _m(width_m) * (1 if li == 0 else rng.uniform(0.45, 0.65))
        lh = _m(height_m) * COS_P * (1 if li == 0 else rng.uniform(0.45, 0.7))
        cx = W / 2 + (0 if li == 0 else (-1) ** li * rng.uniform(0.45, 0.62) * _m(width_m))
        bottom = H - 5 - (0 if li == 0 else rng.uniform(-2, 3))
        k = int(rng.integers(7, 10))
        pts = []
        for j in range(k):
            a = math.pi + j / k * math.pi * 2
            rr = rng.uniform(0.82, 1.05)
            px = cx + math.cos(a) * lw / 2 * rr
            py = bottom - lh * 0.5 + math.sin(a) * (lh * 0.55) * rr
            pts.append((px, min(py, bottom)))
        m = polygon(c, pts)
        if buried:  # sunk into the ground: flatten the bottom
            m &= ys < bottom - lh * buried * 0.5
        nf = int(rng.integers(4, 7))
        seeds = np.array(scatter_points(rng, m, nf, min_dist=lw * 0.2) or [(cx, bottom - lh / 2)])
        d = np.stack([(xs - sx) ** 2 + (ys - sy) ** 2 for sx, sy in seeds], -1)
        fid = d.argmin(-1)
        ccy = bottom - lh * 0.45
        normals = []
        for sx, sy in seeds:
            nrm = np.array([(sx - cx) / (lw / 2) * 0.9, ((sy - ccy) / (lh / 2) - 0.5) * 0.9, 0.75 + rng.uniform(-0.15, 0.15)])
            normals.append(nrm / np.linalg.norm(nrm))
        lit = lambert(np.array(normals)[fid])
        col = bands(lit, [-0.15, 0.25, 0.62], STONE[:4])
        fe = (fid != shift(fid, 1, 0, -1)) | (fid != shift(fid, 0, 1, -1))
        col[fe & m & (lit > 0.25)] = rgb(STONE[4])  # bevel light on lit facets' edges
        col[fe & m & (lit <= 0.25)] = rgb(STONE[1])
        if moss > 0:  # moss only on the top facets
            mn = fbm(W, H, 5, 3, seed + 7)
            mm = m & (lit > 0.3) & (mn > 0.6 - moss * 0.25) & (ys < bottom - lh * 0.55)
            col[mm] = rgb(MOSS[1])
            col[mm & (mn > 0.7)] = rgb(MOSS[2])
        c.fill(m & ~total, col)
        if total.any():
            c.fill(boundary(m) & ~total & dilate(total, 1), INK)
        total |= m
        if li == 0:  # 1-2 cracks only
            for _ in range(int(rng.integers(1, 3))):
                x0 = cx + rng.uniform(-lw * 0.2, lw * 0.2)
                y0 = bottom - lh * rng.uniform(0.35, 0.7)
                pts = [(x0, y0)]
                for _s in range(2):
                    pts.append((pts[-1][0] + rng.uniform(-2, 2), pts[-1][1] + rng.uniform(2, 3.5)))
                c.fill(line_mask(c, pts, 1) & m & ~boundary(m), STONE[0])
    c.outline(INK)
    if grass:  # grass blades covering the base so the rock sits in the ground
        _grass_fringe(c, rng, base[1], W)
    sprite, (ox, oy) = c.crop_to_content()
    off = _shadow_offset(height_m * 0.6)
    sw, sh = int(W + off[0] + 10), int(_m(width_m) * 0.6 + off[1] + 12)
    sax, say = sw * 0.45, sh * 0.35
    shadow, (sx, sy) = ground_shadow(sw, sh, [(sax + off[0] * 0.5, say + off[1] * 0.3, W * 0.48, _m(width_m) * 0.22 + 2)], seed).crop_to_content(0)
    return sprite, (base[0] - ox, base[1] - oy), shadow, (sax - sx, say - sy)


def _grass_fringe(c: Canvas, rng, base_y, W, density=1.0):
    solid = c.mask()
    cols = np.where(solid.any(axis=0))[0]
    if len(cols) == 0:
        return
    for _ in range(int(len(cols) * 0.5 * density)):
        x = rng.uniform(cols.min() - 2, cols.max() + 2)
        h = rng.uniform(3, 6)
        y0 = base_y + rng.uniform(0, 2)
        tone = GRASS[int(rng.integers(1, 4))]
        c.fill(line_mask(c, [(x, y0), (x + rng.uniform(-1.5, 1.5), y0 - h)], 1), tone)


# ----------------------------------------------------------------------------- small plants

def grass_tuft(seed=0, width_px=12, height_px=10, flowers=None, nflowers=0):
    rng = np.random.default_rng(seed)
    W, H = width_px + 6, height_px + 6
    c = Canvas(W, H)
    base_y = H - 2
    blades = int(rng.integers(6, 10))
    xs_, ys_ = c.grid()
    for j in range(blades):
        bx = W / 2 + rng.normal(0, width_px * 0.18)
        by = base_y - rng.uniform(0, 1.5)  # irregular base
        tip_x = bx + rng.uniform(-3.5, 3.5)
        tip_y = by - rng.uniform(0.5, 1.0) * height_px
        wdt = rng.uniform(0.9, 1.5)
        m = polygon(c, [(bx - wdt, by), (bx + wdt, by), (tip_x, tip_y)])
        depth = j / blades
        c.fill(m, GRASS[1 + int(depth * 2.99)])
        c.paint(m & (ys_ < tip_y + (by - tip_y) * 0.35), GRASS[min(4, 2 + int(depth * 2.99))])
    if flowers:
        f = FLOWER[flowers]
        for _ in range(nflowers):
            fx = W / 2 + rng.normal(0, width_px * 0.22)
            fy = base_y - rng.uniform(0.7, 1.15) * height_px
            c.fill(line_mask(c, [(fx, fy), (fx + rng.uniform(-1, 1), base_y - 2)], 1), GRASS[1])
            _rosette(c, fx, fy, f)
    sprite, (ox, oy) = c.crop_to_content()
    return sprite, (W / 2 - ox, base_y - oy), None, None


def _rosette(c: Canvas, x, y, f):
    """A 3x3 px flower: petals in a plus/round shape, 1 px center, darker lower-right petal."""
    xi, yi = int(x), int(y)
    for dx, dy in ((0, -1), (-1, 0), (1, 0), (0, 1), (-1, -1), (1, -1), (-1, 1)):
        if 0 <= xi + dx < c.w and 0 <= yi + dy < c.h:
            c.px[yi + dy, xi + dx] = [*rgb(f[1]), 1]
    if 0 <= xi + 1 < c.w and 0 <= yi + 1 < c.h:
        c.px[yi + 1, xi + 1] = [*rgb(f[0]), 1]
    if 0 <= xi < c.w and 0 <= yi < c.h:
        c.px[yi, xi] = [*rgb(f[2]), 1]


def tall_grass(seed=0, width_px=26, height_px=24, tone_shift=0):
    rng = np.random.default_rng(seed)
    W, H = width_px + 8, height_px + 6
    c = Canvas(W, H)
    base_y = H - 2
    for j in range(int(rng.integers(14, 20))):
        bx = W / 2 + rng.normal(0, width_px * 0.2)
        tip_x = bx + rng.uniform(-7, 7)
        tip_y = base_y - rng.uniform(0.6, 1.0) * height_px
        mid = ((bx + tip_x) / 2 + rng.uniform(-2, 2), (base_y + tip_y) / 2)
        m = branch_mask(c, [(bx, base_y), mid, (tip_x, tip_y)], 2.2, 0.8)
        depth = j / 18
        c.fill(m, GRASS[min(4, 1 + int(depth * 3) + tone_shift)])
        if rng.random() < 0.35:  # seed heads
            c.fill(ellipse(c, tip_x, tip_y + 1, 0.9, 1.8), "#c9b46a")
    c.fill(boundary(c.mask()) & (c.grid()[1] > base_y - 3), GRASS[0])
    sprite, (ox, oy) = c.crop_to_content()
    return sprite, (W / 2 - ox, base_y - oy), None, None


def fern(seed=0, size_px=30):
    rng = np.random.default_rng(seed)
    W, H = size_px + 10, int(size_px * 1.0) + 8
    c = Canvas(W, H)
    base = (W / 2, H - 3)
    fronds = int(rng.integers(6, 9))
    order = sorted(range(fronds), key=lambda k: abs(k - fronds / 2), reverse=True)
    for k in order:
        a = math.pi * (0.12 + 0.76 * k / (fronds - 1))
        ln = size_px * rng.uniform(0.42, 0.55)
        pts = []
        for t in np.linspace(0, 1, 7):
            droop = t * t * ln * 0.3
            pts.append((base[0] + math.cos(a) * ln * t, base[1] - math.sin(a) * ln * t * 1.15 + droop))
        tone = 2 if math.sin(a) > 0.8 else 1
        rib = branch_mask(c, pts, 1.6, 0.8)
        c.fill(rib, GRASS[tone])
        for i in range(1, len(pts) - 1):  # leaflets
            px, py = pts[i]
            s = (1 - i / len(pts)) * 3.2 + 1
            leaf = ellipse(c, px, py + 1, s, s * 0.55)
            c.fill(leaf, GRASS[tone + 1])
            c.fill(leaf & (c.grid()[1] < py + 0.6) & (c.grid()[0] < px), GRASS[tone + 2])
    c.outline(mix(INK, GRASS[0], 0.4))
    sprite, (ox, oy) = c.crop_to_content()
    return sprite, (base[0] - ox, base[1] - oy), None, None


def tall_flowers(seed=0, color="lilac"):
    """Lupine-like flower spikes (~0.7 m)."""
    rng = np.random.default_rng(seed)
    W, H = 26, 28
    c = Canvas(W, H)
    base_y = H - 2
    f = FLOWER[color]
    for k in range(int(rng.integers(3, 6))):
        x = W / 2 + rng.normal(0, 4)
        top = base_y - rng.uniform(15, 22)
        c.fill(line_mask(c, [(x, base_y), (x + rng.uniform(-1, 1), top + 4)], 1), GRASS[1])
        for i in range(5):
            y = top + i * 1.6
            r = 1.0 + i * 0.25
            c.fill(ellipse(c, x, y, r, 0.9), f[1] if i % 2 == 0 else f[0])
        c.fill(ellipse(c, x - 0.4, top + 0.5, 0.6, 0.6), f[2] if color != "lilac" else "#e8dcff")
    for _ in range(6):  # leaves at the base
        x = W / 2 + rng.normal(0, 4)
        c.fill(ellipse(c, x, base_y - 2, 2.2, 1.0), GRASS[2])
    c.outline(mix(INK, GRASS[0], 0.4))
    sprite, (ox, oy) = c.crop_to_content()
    return sprite, (W / 2 - ox, base_y - oy), None, None


def flower_decal(seed=0, colors=("white",), size_m=2.5):
    """Flat patch of flowers lying on the grass: clumps of 6-15 rosettes over dark leaves,
    dense at the center, sparse at the border."""
    rng = np.random.default_rng(seed)
    W = H = int(_m(size_m))
    c = Canvas(W, H)
    xs, ys = c.grid()
    rr = np.hypot((xs - W / 2) / (W * 0.48), (ys - H / 2) / (H * 0.48))
    n = fbm(W, H, 8, 3, seed)
    region = rr + (n - 0.5) * 0.6 < 1.0
    clumps = scatter_points(rng, region, int(W * H / 260) + 3, min_dist=7)
    for (cx, cy) in clumps:
        dens = 1.0 - min(1.0, math.hypot((cx - W / 2) / (W * 0.48), (cy - H / 2) / (H * 0.48)))
        count = int(6 + 9 * dens)
        col = colors[int(rng.integers(len(colors)))]
        f = FLOWER[col]
        for _ in range(4):  # dark leaves under the clump
            lx, ly = cx + rng.normal(0, 2.5), cy + rng.normal(0, 1.6) + 1
            c.fill(ellipse(c, lx, ly, 1.8, 1.0), GRASS[1] if rng.random() < 0.6 else GRASS[0])
        for _ in range(count):
            fx, fy = cx + rng.normal(0, 3.0), cy + rng.normal(0, 2.0)
            _rosette(c, fx, fy, f)
    sprite, (ox, oy) = c.crop_to_content(0)
    return sprite, (W / 2 - ox, H / 2 - oy), None, None


def leaves_decal(seed=0, palette=(("#b8933f", "#7a5a2a"), ("#c9a24a", "#8a6a30")), size_m=4.0):
    """Leaf litter under a tree: 2x2 / 3x2 px leaves in two tones, dense near the trunk."""
    rng = np.random.default_rng(seed)
    W = H = int(_m(size_m))
    c = Canvas(W, H)
    n = 0
    while n < 120:
        r = abs(rng.normal(0, 0.42)) * W * 0.5
        a = rng.uniform(0, 2 * math.pi)
        px, py = W / 2 + math.cos(a) * r, H / 2 + math.sin(a) * r * 0.8
        if not (1 <= px < W - 3 and 1 <= py < H - 2):
            continue
        light, dark = palette[int(rng.integers(len(palette)))]
        xi, yi = int(px), int(py)
        wide = rng.random() < 0.5
        c.px[yi, xi] = [*rgb(light), 1]
        c.px[yi, xi + 1] = [*rgb(light), 1]
        if wide:
            c.px[yi, xi + 2] = [*rgb(dark), 1]
        c.px[yi + 1, xi] = [*rgb(dark), 1]
        c.px[yi + 1, xi + 1] = [*rgb(dark if wide else light), 1]
        n += 1
    sprite, (ox, oy) = c.crop_to_content(0)
    return sprite, (W / 2 - ox, H / 2 - oy), None, None


def clover_decal(seed=0, size_m=1.8):
    rng = np.random.default_rng(seed)
    W = H = int(_m(size_m))
    c = Canvas(W, H)
    xs, ys = c.grid()
    region = np.hypot((xs - W / 2) / (W * 0.46), (ys - H / 2) / (H * 0.46)) + (fbm(W, H, 6, 3, seed) - 0.5) * 0.6 < 1.0
    for (px, py) in scatter_points(rng, region, int(region.sum() / 30), min_dist=3):
        for dx, dy in ((-1, 0), (1, 0), (0, -1)):
            c.fill(ellipse(c, px + dx * 1.2, py + dy * 1.0, 1.1, 0.9), GRASS[2])
        c.fill(ellipse(c, px - 1.4, py - 0.4, 0.5, 0.5), GRASS[3])
        if rng.random() < 0.12:
            _rosette(c, px, py - 2, FLOWER["white"])
    sprite, (ox, oy) = c.crop_to_content(0)
    return sprite, (W / 2 - ox, H / 2 - oy), None, None


def pebbles_decal(seed=0, size_m=1.4):
    rng = np.random.default_rng(seed)
    W = H = int(_m(size_m))
    c = Canvas(W, H)
    xs, ys = c.grid()
    region = np.hypot((xs - W / 2) / (W * 0.46), (ys - H / 2) / (H * 0.46)) < 1.0
    for (px, py) in scatter_points(rng, region, 12, min_dist=3):
        r = rng.uniform(0.9, 1.9)
        c.fill(ellipse(c, px + 0.7, py + 0.7, r * 1.25, r * 0.9), STONE[1])
        c.fill(ellipse(c, px, py, r * 1.25, r * 0.9), STONE[3])
        c.fill(ellipse(c, px - r * 0.4, py - r * 0.35, 0.6, 0.5), STONE[4])
    sprite, (ox, oy) = c.crop_to_content(0)
    return sprite, (W / 2 - ox, H / 2 - oy), None, None


def stump(seed=0):
    W, H = int(_m(0.9)) + 8, int(_m(0.75)) + 6
    c = Canvas(W, H)
    cx, top_y, r = W / 2, H * 0.36, _m(0.32)
    base_y = H - 3
    side = polygon(c, [(cx - r - 3, base_y), (cx - r, top_y), (cx + r, top_y), (cx + r + 3, base_y)])
    side |= ellipse(c, cx, base_y - 2, r + 4, 3)
    for sx in (-1, 1):
        side |= polygon(c, [(cx + sx * r * 0.6, base_y - 6), (cx + sx * (r + 7), base_y), (cx + sx * r * 0.4, base_y)])
    paint_wood(c, side, BARK, seed)
    top = ellipse(c, cx, top_y, r, r * 0.55)
    xs, ys = c.grid()
    d = np.hypot((xs - cx) / r, (ys - top_y) / (r * 0.55))
    c.fill(top, np.where((np.sin(d * 14) > 0.55)[..., None], rgb("#a07850"), rgb("#d2ad7a")))
    c.fill(boundary(top) & (ys > top_y), "#7a5236")
    c.outline(INK)
    _grass_fringe(c, np.random.default_rng(seed), base_y, W, 0.6)
    sprite, (ox, oy) = c.crop_to_content()
    shadow, (sx, sy) = ground_shadow(W + 14, 18, [(W / 2 + 6, 8, r + 6, 4)], seed).crop_to_content(0)
    return sprite, (cx - ox, base_y - oy), shadow, (W / 2 - sx, 6 - sy)


def log(seed=0):
    W, H = int(_m(2.2)) + 8, int(_m(0.75)) + 6
    c = Canvas(W, H)
    r = _m(0.22)
    y = H - r - 3
    body = polygon(c, [(4 + r, y - r), (W - 6, y - r - 4), (W - 6, y + r - 4), (4 + r, y + r)])
    xs, ys = c.grid()
    rel = (ys - (y - r)) / (2 * r)
    lit = 0.8 - rel * 1.6
    groove = fbm(W, H, 2, 2, seed) * np.repeat(fbm(W // 8 + 2, H, 2, 2, seed + 3), 8, axis=1)[:, :W] > 0.42
    c.fill(body, bands(lit - groove * 0.5, [-0.5, -0.05, 0.35], BARK[1:5]))
    end = ellipse(c, 4 + r, y, r * 0.55, r)
    d = np.hypot((xs - 4 - r) / (r * 0.55), (ys - y) / r)
    c.fill(end, np.where((np.sin(d * 12) > 0.5)[..., None], rgb("#a07850"), rgb("#d2ad7a")))
    c.fill(boundary(end), "#7a5236")
    c.paint(body & (rel < 0.3) & (fbm(W, H, 5, 3, seed + 9) > 0.55), MOSS[1])
    c.outline(INK)
    _grass_fringe(c, np.random.default_rng(seed), y + r + 1, W, 0.5)
    sprite, (ox, oy) = c.crop_to_content()
    shadow, (sx, sy) = ground_shadow(W + 8, 18, [(W / 2 + 6, 9, W * 0.45, 4.5)], seed).crop_to_content(0)
    return sprite, (W / 2 - ox, y + r - oy), shadow, (W / 2 - sx, 7 - sy)


def mushrooms(seed=0):
    rng = np.random.default_rng(seed)
    W, H = 16, 12
    c = Canvas(W, H)
    base_y = H - 2
    for k in range(int(rng.integers(2, 4))):
        x = 4 + k * 3.5 + rng.uniform(-1, 1)
        h = rng.uniform(3, 6)
        r = rng.uniform(1.8, 2.8)
        c.fill(line_mask(c, [(x, base_y), (x, base_y - h)], 1), "#efe6d2")
        cap = ellipse(c, x, base_y - h, r, r * 0.6) & (c.grid()[1] < base_y - h + 1)
        c.fill(cap, "#c8323a")
        c.fill(ellipse(c, x - r * 0.4, base_y - h - 0.5, 0.6, 0.5) & cap, "#fff4e6")
    c.outline(INK)
    sprite, (ox, oy) = c.crop_to_content()
    return sprite, (W / 2 - ox, base_y - oy), None, None
