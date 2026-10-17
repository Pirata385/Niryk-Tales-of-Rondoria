"""Tiny procedural "painter" for Niryk's 2D art (numpy + Pillow only).

Everything works on float RGBA canvases (H, W, 4) in sRGB [0, 1]. Edges are hard (alpha 0 or 1)
so sprites stay crisp under the game's pixel filter and can be alpha-tested.

Conventions (docs/art/ART_DIRECTION.md):
  * light comes from the upper-left of the screen,
  * 3-tone flat shading with cool shadows, ink outline #1b1424,
  * 32 px per meter at the game's internal resolution.
"""
from __future__ import annotations

import math

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

INK = "#1b1424"
PX_PER_M = 32
PITCH = math.radians(40.0)
COS_P = math.cos(PITCH)
SIN_P = math.sin(PITCH)
# Light direction in sprite space: x right, y DOWN, z toward the viewer.
LIGHT = np.array([-0.62, -0.62, 0.48])
LIGHT = LIGHT / np.linalg.norm(LIGHT)
# Ground shadow displacement per meter of shadow length (screen px): sun elevation ~52.6 deg.
SHADOW_PER_M_HEIGHT = 0.765  # shadow length per meter of height
SHADOW_DIR_PX = np.array([0.51, 0.55]) * PX_PER_M  # right, down
SHADOW_COLOR = "#1f2f3f"
SHADOW_ALPHA = 0.68


# ----------------------------------------------------------------------------- colors

def rgb(c) -> np.ndarray:
    if isinstance(c, str):
        c = c.lstrip("#")
        return np.array([int(c[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])
    c = np.asarray(c, dtype=float)
    return c / 255.0 if c.max() > 1.0 else c


def mix(a, b, t):
    return rgb(a) * (1 - t) + rgb(b) * t


def shade(c, k):
    """Multiply brightness (k < 1 darker) with a slight cool shift in darks."""
    c = rgb(c)
    out = c * k
    if k < 1:
        out = out + (1 - k) * np.array([-0.01, 0.0, 0.03])
    return np.clip(out, 0, 1)


# ----------------------------------------------------------------------------- noise

def _value_grid(shape, seed):
    return np.random.default_rng(seed).random(shape)


def value_noise(w, h, cell, seed=0, tile=False):
    """Smooth value noise in [0,1]. With tile=True the result wraps (w and h multiples of cell)."""
    gw = int(math.ceil(w / cell)) + 1
    gh = int(math.ceil(h / cell)) + 1
    if tile:
        gw, gh = max(1, round(w / cell)), max(1, round(h / cell))
    g = _value_grid((gh + (0 if tile else 1), gw + (0 if tile else 1)), seed)
    ys, xs = np.mgrid[0:h, 0:w].astype(float)
    fx, fy = xs / cell, ys / cell
    x0, y0 = np.floor(fx).astype(int), np.floor(fy).astype(int)
    tx, ty = fx - x0, fy - y0
    tx = tx * tx * (3 - 2 * tx)
    ty = ty * ty * (3 - 2 * ty)
    if tile:
        x1, y1 = (x0 + 1) % gw, (y0 + 1) % gh
        x0, y0 = x0 % gw, y0 % gh
    else:
        x1, y1 = x0 + 1, y0 + 1
    a = g[y0, x0] * (1 - tx) + g[y0, x1] * tx
    b = g[y1, x0] * (1 - tx) + g[y1, x1] * tx
    return a * (1 - ty) + b * ty


def fbm(w, h, cell, octaves=4, seed=0, tile=False, gain=0.5):
    out = np.zeros((h, w))
    amp, total = 1.0, 0.0
    for o in range(octaves):
        c = cell / (2 ** o)
        if c < 1:
            break
        out += amp * value_noise(w, h, c, seed + 101 * o, tile)
        total += amp
        amp *= gain
    return out / total


# ----------------------------------------------------------------------------- canvas

class Canvas:
    def __init__(self, w, h):
        self.w, self.h = int(w), int(h)
        self.px = np.zeros((self.h, self.w, 4))

    # -- masks
    def grid(self):
        ys, xs = np.mgrid[0:self.h, 0:self.w].astype(float)
        return xs + 0.5, ys + 0.5

    @property
    def alpha(self):
        return self.px[..., 3]

    def mask(self):
        return self.px[..., 3] > 0.5

    # -- painting
    def fill(self, mask, color, alpha=1.0):
        c = rgb(color) if not isinstance(color, np.ndarray) or color.ndim == 1 else color
        m = mask.astype(float) * alpha
        if c.ndim == 1:
            c = np.broadcast_to(c, (self.h, self.w, 3))
        a0 = self.px[..., 3]
        out_a = m + a0 * (1 - m)
        safe = np.where(out_a > 0, out_a, 1)
        self.px[..., :3] = (c * m[..., None] + self.px[..., :3] * (a0 * (1 - m))[..., None]) / safe[..., None]
        self.px[..., 3] = out_a

    def paint(self, mask, color):
        """Recolor already painted pixels (keeps alpha)."""
        c = rgb(color) if not isinstance(color, np.ndarray) or color.ndim == 1 else color
        m = mask & (self.px[..., 3] > 0)
        if c.ndim == 1:
            self.px[m, :3] = c
        else:
            self.px[m, :3] = c[m]

    def paste(self, other: "Canvas", x=0, y=0):
        """Alpha-composite another canvas at (x, y)."""
        h, w = other.h, other.w
        x0, y0 = max(0, x), max(0, y)
        x1, y1 = min(self.w, x + w), min(self.h, y + h)
        if x1 <= x0 or y1 <= y0:
            return
        src = other.px[y0 - y:y1 - y, x0 - x:x1 - x]
        dst = self.px[y0:y1, x0:x1]
        sa = src[..., 3:4]
        da = dst[..., 3:4]
        oa = sa + da * (1 - sa)
        safe = np.where(oa > 0, oa, 1)
        dst[..., :3] = (src[..., :3] * sa + dst[..., :3] * da * (1 - sa)) / safe
        dst[..., 3:4] = oa

    def outline(self, color=INK, mask=None, inner=True):
        """Ink 1px line on the inner boundary of the painted area (or of `mask`)."""
        m = self.mask() if mask is None else mask
        edge = boundary(m) if inner else (dilate(m) & ~m)
        self.fill(edge, color)

    def to_image(self) -> Image.Image:
        arr = np.clip(self.px, 0, 1)
        arr[..., 3] = (arr[..., 3] > 0.5).astype(float) if self.binary_alpha else arr[..., 3]
        return Image.fromarray((arr * 255 + 0.5).astype(np.uint8), "RGBA")

    binary_alpha = True

    def crop_to_content(self, pad=1):
        m = self.px[..., 3] > 0.01
        if not m.any():
            return self, (0, 0)
        ys, xs = np.where(m)
        x0, x1 = max(0, xs.min() - pad), min(self.w, xs.max() + 1 + pad)
        y0, y1 = max(0, ys.min() - pad), min(self.h, ys.max() + 1 + pad)
        c = Canvas(x1 - x0, y1 - y0)
        c.px = self.px[y0:y1, x0:x1].copy()
        c.binary_alpha = self.binary_alpha
        return c, (x0, y0)


# ----------------------------------------------------------------------------- morphology

def shift(m, dx, dy, fill=False):
    out = np.full_like(m, fill)
    h, w = m.shape
    xs0, xs1 = max(0, dx), min(w, w + dx)
    ys0, ys1 = max(0, dy), min(h, h + dy)
    out[ys0:ys1, xs0:xs1] = m[ys0 - dy:ys1 - dy, xs0 - dx:xs1 - dx]
    return out


def dilate(m, r=1):
    out = m.copy()
    for _ in range(r):
        o = out.copy()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            o |= shift(out, dx, dy)
        out = o
    return out


def erode(m, r=1):
    return ~dilate(~m, r)


def boundary(m):
    """Pixels of m that touch a non-m 4-neighbor."""
    return m & ~erode(m, 1)


def fill_holes(m):
    """m plus every empty pixel not connected to the canvas border (gaps between clumps)."""
    empty = ~m
    reach = np.zeros_like(m)
    reach[0, :], reach[-1, :], reach[:, 0], reach[:, -1] = empty[0, :], empty[-1, :], empty[:, 0], empty[:, -1]
    while True:
        new = dilate(reach) & empty
        if (new == reach).all():
            break
        reach = new
    return m | (empty & ~reach)


def blur(arr, radius):
    """Gaussian blur of a float 2D array via Pillow (keeps float precision reasonably)."""
    lo, hi = float(arr.min()), float(arr.max())
    if hi - lo < 1e-9:
        return arr.copy()
    img = Image.fromarray(((arr - lo) / (hi - lo) * 65535).astype(np.uint16).astype(np.int32), "I")
    img = img.convert("F").filter(ImageFilter.GaussianBlur(radius))
    return np.asarray(img, dtype=float) / 65535 * (hi - lo) + lo


# ----------------------------------------------------------------------------- shapes

def ellipse(c: Canvas, cx, cy, rx, ry):
    xs, ys = c.grid()
    return ((xs - cx) / rx) ** 2 + ((ys - cy) / ry) ** 2 <= 1.0


def polygon(c: Canvas, pts):
    img = Image.new("L", (c.w, c.h), 0)
    ImageDraw.Draw(img).polygon([tuple(map(float, p)) for p in pts], fill=255)
    return np.asarray(img) > 127


def line_mask(c: Canvas, pts, width=1):
    img = Image.new("L", (c.w, c.h), 0)
    ImageDraw.Draw(img).line([tuple(map(float, p)) for p in pts], fill=255, width=int(width))
    return np.asarray(img) > 127


def scallop(c: Canvas, cx, cy, r, bumps=8, depth=0.12, phase=0.0, squash=1.0, seed=0, wobble=0.06):
    """Leafy clump outline: a circle whose radius has round bumps (and a little noise)."""
    xs, ys = c.grid()
    dx, dy = xs - cx, (ys - cy) / squash
    ang = np.arctan2(dy, dx)
    rng = np.random.default_rng(seed)
    harm = np.zeros_like(ang)
    for k, a in ((3, rng.uniform(0.3, 1)), (5, rng.uniform(0.2, 0.6))):
        harm += a * np.sin(k * ang + rng.uniform(0, 6.28))
    bump = np.abs(np.sin(bumps * 0.5 * (ang + phase)))  # round lobes
    rr = r * (1 - depth + depth * bump) * (1 + wobble * harm / 1.6)
    return np.hypot(dx, dy) <= rr


def dome_normals(c: Canvas, cx, cy, r, squash=1.0):
    """Sphere-like normals for a clump centered at (cx, cy)."""
    xs, ys = c.grid()
    nx = (xs - cx) / r
    ny = (ys - cy) / (r * squash)
    d2 = nx * nx + ny * ny
    nz = np.sqrt(np.clip(1 - np.minimum(d2, 0.98), 0, 1))
    n = np.stack([nx, ny, nz], -1)
    return n / np.linalg.norm(n, axis=-1, keepdims=True)


def lambert(n, light=LIGHT):
    return np.clip((n * light).sum(-1), -1, 1)


def bands(value, cuts, colors):
    """Hard ramp: value < cuts[0] -> colors[0], ... ; returns (H, W, 3)."""
    idx = np.digitize(value, cuts)
    pal = np.stack([rgb(c) for c in colors])
    return pal[idx]


def scatter_points(rng, mask, count, min_dist=0.0):
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return []
    pts = []
    tries = 0
    while len(pts) < count and tries < count * 30:
        tries += 1
        i = rng.integers(len(xs))
        p = (xs[i] + 0.5, ys[i] + 0.5)
        if min_dist and any((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 < min_dist ** 2 for q in pts):
            continue
        pts.append(p)
    return pts


def stamp(c: Canvas, mask_fn, color, where=None):
    m = mask_fn
    if where is not None:
        m = m & where
    c.fill(m, color)


def leaf_mark(c: Canvas, x, y, size=2.0, angle=0.0, kind="leaf"):
    """Small leaf/tick mark mask (a few pixels)."""
    xs, ys = c.grid()
    ca, sa = math.cos(angle), math.sin(angle)
    u = (xs - x) * ca + (ys - y) * sa
    v = -(xs - x) * sa + (ys - y) * ca
    if kind == "leaf":
        return (u / (size * 1.35)) ** 2 + (v / (size * 0.7)) ** 2 <= 1.0
    if kind == "tick":  # short stroke
        return (np.abs(v) <= 0.6) & (u >= -size) & (u <= size)
    return (u / size) ** 2 + (v / size) ** 2 <= 1.0


# ----------------------------------------------------------------------------- shadows

def ground_shadow(w, h, blobs, seed=0, color=SHADOW_COLOR, alpha=SHADOW_ALPHA):
    """Flat ground shadow: union of ellipses (cx, cy, rx, ry) with scalloped noise edges."""
    c = Canvas(w, h)
    c.binary_alpha = False
    xs, ys = c.grid()
    m = np.zeros((h, w), bool)
    n = fbm(w, h, 6, 3, seed)
    for (cx, cy, rx, ry) in blobs:
        d = ((xs - cx) / rx) ** 2 + ((ys - cy) / ry) ** 2
        m |= d <= 1.0 + (n - 0.5) * 0.5
    c.fill(m, color, alpha)
    return c
