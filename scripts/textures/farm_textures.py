#!/usr/bin/env python3
"""Procedural PBR textures for the Hollister Farm map (every material is named farm_*).

    python3 scripts/textures/farm_textures.py [--only name1,name2]

Writes, for every material, tileable albedo / normal / ORM (R occlusion, G roughness, B metal) JPEGs at 1024 and
512 px into client/dist/assets/g/textures/<name>/ (content-hashed names, like the shipped textures), and the
material list client/dist/assets/g/textures/farm_materials.json that scripts/bake-map.mjs merges into the asset
manifest. Everything is made here from noise and simple shapes: no outside images.
"""
import hashlib, io, json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TEX = os.path.join(ROOT, "client", "dist", "assets", "g", "textures")
N = 1024
rng_global = np.random.default_rng(1)


# ------------------------------------------------------------------------------------------------- noise
def spectral(n=N, beta=2.0, seed=0, sx=1.0, sy=1.0, lo=1.0):
    """Tileable fractal noise in [0, 1] (spectral synthesis: periodic by construction). sx/sy stretch it."""
    r = np.random.default_rng(seed)
    kx = np.fft.fftfreq(n)[None, :] * n * sx      # sx > 1 stretches features along x
    ky = np.fft.fftfreq(n)[:, None] * n * sy
    k = np.sqrt(kx * kx + ky * ky)
    k[0, 0] = 1
    amp = 1.0 / np.maximum(k, lo) ** (beta / 2)
    amp[0, 0] = 0
    ph = r.uniform(0, 2 * np.pi, (n, n))
    f = np.real(np.fft.ifft2(amp * np.exp(1j * ph)))
    f -= f.min()
    return f / max(f.max(), 1e-9)


def band(n, lo_k, hi_k, seed):
    """Tileable band-limited noise: features between lo_k and hi_k cycles per tile."""
    r = np.random.default_rng(seed)
    kx = np.fft.fftfreq(n)[None, :] * n
    ky = np.fft.fftfreq(n)[:, None] * n
    k = np.sqrt(kx * kx + ky * ky)
    amp = ((k >= lo_k) & (k <= hi_k)).astype(float)
    f = np.real(np.fft.ifft2(amp * np.exp(1j * r.uniform(0, 2 * np.pi, (n, n)))))
    f -= f.min()
    return f / max(f.max(), 1e-9)


def voronoi(n, cells, seed, jitter=0.85):
    """Tileable Voronoi: returns (F1 distance, F2 - F1, cell id) on an n x n grid with cells x cells sites."""
    r = np.random.default_rng(seed)
    pts = (np.stack(np.meshgrid(np.arange(cells), np.arange(cells), indexing="ij"), -1).reshape(-1, 2) + 0.5
           + r.uniform(-jitter / 2, jitter / 2, (cells * cells, 2))) / cells
    yy, xx = np.mgrid[0:n, 0:n] / n
    f1 = np.full((n, n), 9.0)
    f2 = np.full((n, n), 9.0)
    cid = np.zeros((n, n), int)
    for i, (px, py) in enumerate(pts):
        dx = np.abs(xx - px)
        dx = np.minimum(dx, 1 - dx)
        dy = np.abs(yy - py)
        dy = np.minimum(dy, 1 - dy)
        d = np.sqrt(dx * dx + dy * dy)
        closer = d < f1
        f2 = np.where(closer, f1, np.minimum(f2, d))
        cid = np.where(closer, i, cid)
        f1 = np.where(closer, d, f1)
    return f1 * cells, (f2 - f1) * cells, cid


def lerp(a, b, t):
    a = np.asarray(a, float)
    b = np.asarray(b, float)
    t = np.asarray(t, float)
    if t.ndim == 2:
        t = t[..., None]
    return a + (b - a) * t


def rgb(hexs):
    hexs = hexs.lstrip("#")
    return np.array([int(hexs[i:i + 2], 16) / 255 for i in (0, 2, 4)])


def smooth(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def blur(a, r):
    """Tileable blur of a 2-D array (wraps)."""
    n0, n1 = a.shape
    ky = np.fft.fftfreq(n0)[:, None]
    kx = np.fft.fftfreq(n1)[None, :]
    g = np.exp(-2 * (np.pi * r) ** 2 * (kx * kx + ky * ky))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g))


# ------------------------------------------------------------------------------------------------ output
def normal_from_height(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * strength * h.shape[0] / 1024
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * strength * h.shape[0] / 1024
    nx, ny, nz = -dx, dy, np.ones_like(h)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    return np.stack([nx / l, ny / l, nz / l], -1) * 0.5 + 0.5


def ao_from_height(h, r=6, k=1.6):
    return np.clip(1 - (blur(h, r) - h) * k, 0.35, 1.0)


def save(name, albedo, height, rough, metal=0.0, nstrength=6.0, ao=None, spec=None):
    out = os.path.join(TEX, name)
    os.makedirs(out, exist_ok=True)
    for old in os.listdir(out):
        os.remove(os.path.join(out, old))
    if np.isscalar(rough):
        rough = np.full(height.shape, rough)
    if np.isscalar(metal):
        metal = np.full(height.shape, metal)
    if ao is None:
        ao = ao_from_height(height)
    nrm = normal_from_height(height, nstrength)
    orm = np.stack([ao, np.clip(rough, 0.02, 1), np.clip(metal, 0, 1)], -1)
    maps = {}
    for size in (1024, 512):
        entry = {}
        for kind, arr in (("albedo", albedo), ("normal", nrm), ("orm", orm)):
            im = Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8), "RGB")
            if size != arr.shape[0]:
                im = im.resize((size, size), Image.LANCZOS)
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=92 if kind == "normal" else 90, optimize=True)
            data = buf.getvalue()
            fn = f"{kind}_{size}-{hashlib.sha256(data).hexdigest()[:10]}.jpg"
            with open(os.path.join(out, fn), "wb") as f:
                f.write(data)
            entry[kind] = f"/assets/g/textures/{name}/{fn}"
        maps[str(size)] = entry
    s = dict(spec or {})
    return {"surface": s.get("surface", "default"), "uv_scale": s.get("uv_scale", 2), "normal_strength": s.get("normal_strength", 1),
            "roughness_scale": s.get("roughness_scale", 1), "metallic_scale": s.get("metallic_scale", 1),
            **({"opacity": s["opacity"]} if "opacity" in s else {}), "maps": maps}


# --------------------------------------------------------------------------------------------- recipes
# Every recipe returns (albedo HxWx3, height HxW, roughness, [metal]) at n x n, tileable. They aim for the look of
# the real material at arm's length: wood with growth rings and pores, woven fabrics at thread scale, stones and
# grass drawn one by one, paint and plaster with only the faint texture they really have. Colours are muted.
M = {}


def mat(name, **spec):
    def deco(fn):
        M[name] = (fn, spec)
        return fn
    return deco


def macro(n, seed, amp=0.06):
    """Large, soft tonal variation that hides the tiling (multiply into the albedo)."""
    return 1.0 + (spectral(n, 3.2, seed) - 0.5) * 2 * amp


def desat(a, k):
    g = a.mean(-1, keepdims=True)
    return g + (a - g) * k


def wrap_draw(n, margin, x, y, fn):
    """Call fn(dx, dy) for the shape at (x, y) and for its wrapped copies near the edges (tileable drawing)."""
    for dx in (0, -n, n):
        for dy in (0, -n, n):
            if (dx == 0 or (dx < 0 and x > n - margin) or (dx > 0 and x < margin)) and (dy == 0 or (dy < 0 and y > n - margin) or (dy > 0 and y < margin)):
                fn(dx, dy)


def luminance(a):
    return a[..., 0] * 0.3 + a[..., 1] * 0.59 + a[..., 2] * 0.11


# ---- wood -------------------------------------------------------------------------------------------------
def boards(n, rows, seed, min_len=0.25, max_len=0.75, gap=2):
    """Board layout: board id, row, gap mask, position along the board (0..1) and across it (0..1)."""
    r = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:n, 0:n]
    rh = n / rows
    row = (yy // rh).astype(int)
    bid = np.zeros((n, n), int)
    gapm = np.zeros((n, n), bool)
    along = np.zeros((n, n))
    nid = 0
    for ri in range(rows):
        ends = [0.0]
        while ends[-1] < 1.0 - min_len:
            ends.append(ends[-1] + r.uniform(min_len, max_len))
        ends[-1] = 1.0
        shift = r.uniform(0, 1)
        sel = row == ri
        u = ((xx[sel] / n) + shift) % 1.0
        idx = np.searchsorted(ends, u, side="right") - 1
        bid[sel] = nid + idx
        b0 = np.array(ends)[idx]
        b1 = np.array(ends)[idx + 1]
        along[sel] = (u - b0) / (b1 - b0)
        d = np.minimum(u - b0, b1 - u) * n
        gapm[sel] = d < gap
        nid += len(ends)
    across = (yy % rh) / rh
    gapm |= (yy % rh < gap) | (yy % rh > rh - gap)
    return bid, row, gapm, along, across


def wood_figure(n, bid, along, across, seed, rings=9.0, early="c8a57a", late="8c6743", pores=0.35, rays=0.0, spread=0.08):
    """Plank-by-plank wood: flat-sawn cathedral rings or straight rift grain, pores along the grain, colour per board."""
    r = np.random.default_rng(seed)
    nb = bid.max() + 1
    kind = r.random(nb) < 0.55                    # True: flat sawn (arches), False: rift (straight lines)
    centre = r.uniform(0.2, 0.8, nb)
    apex = r.uniform(0.15, 0.85, nb)
    phase = r.uniform(0, 1, nb)
    freq = r.uniform(0.7, 1.3, nb) * rings
    tint = r.uniform(-spread, spread, nb)
    hue = r.uniform(-0.03, 0.03, nb)
    wob = spectral(n, 3.2, seed + 1, sx=18.0, sy=2.0)     # slow wander of the rings along the board
    fine = blur(spectral(n, 1.4, seed + 2, sx=30.0, sy=0.8), n / 900)
    dv = across - centre[bid]
    du = along - apex[bid]
    t_flat = np.sqrt(dv * dv * 4.0 + (du * 0.9) ** 2 * 0.35)
    t_rift = across * 1.4 + du * 0.05
    t = np.where(kind[bid], t_flat, t_rift) * freq[bid] + phase[bid] + (wob - 0.5) * 1.6
    ring = t - np.floor(t)
    late_band = smooth(ring, 0.55, 0.78) * (1 - smooth(ring, 0.86, 0.99))   # thin dark latewood in each ring
    e, l = rgb(early), rgb(late)
    streak = spectral(n, 2.0, seed + 6, sx=40.0, sy=1.0)      # colour streaks running with the grain
    alb = lerp(e, l, np.clip(late_band * 0.85 + (fine - 0.5) * 0.35 + (streak - 0.5) * 0.5, 0, 1))
    if pores:
        p = band(n, 260, 512, seed + 3)
        streak = spectral(n, 1.0, seed + 4, sx=24.0, sy=0.6)
        pm = (p * streak > np.quantile(p * streak, 0.9)).astype(float)
        alb = alb * (1 - pores * 0.35 * blur(pm, 0.6))[..., None]
    if rays:
        fl = band(n, 120, 300, seed + 5)
        rm = (fl > 0.82) & ~kind[bid]
        alb = np.where(rm[..., None], alb * (1 + rays), alb)
    alb = alb * (1 + tint[bid])[..., None]
    alb[..., 0] *= 1 + hue[bid]
    alb[..., 2] *= 1 - hue[bid]
    return alb, late_band, kind


def plank_floor(n, rows, seed, early, late, gap_dark=0.55, spread=0.09, rough=0.38):
    bid, row, gapm, along, across = boards(n, rows, seed, 0.22, 0.62, 2)
    alb, late_band, kind = wood_figure(n, bid, along, across, seed + 10, early=early, late=late, spread=spread)
    edge = np.minimum(across, 1 - across) * (n / rows)
    bevel = np.clip(edge / 3.0, 0, 1)
    alb = alb * (0.86 + 0.14 * bevel)[..., None]
    alb = np.where(gapm[..., None], alb * gap_dark, alb)
    alb = alb * macro(n, seed + 20, 0.05)[..., None]
    scratches = (band(n, 300, 512, seed + 21) * spectral(n, 1.0, seed + 22, sx=1.0, sy=1.0) > 0.62).astype(float)
    h = np.where(gapm, 0.0, 0.85 * bevel + 0.04 * late_band)
    rough_map = rough + 0.12 * blur(scratches, 0.8) + 0.06 * (spectral(n, 2.4, seed + 23) - 0.5)
    return alb, h, rough_map


@mat("farm_oak_floor", surface="wood", uv_scale=2.6)
def _(n):
    return plank_floor(n, 16, 101, "c4a174", "8a6440")


@mat("farm_deck", surface="wood", uv_scale=2.4)
def _(n):
    alb, h, r = plank_floor(n, 9, 61, "9a9389", "7c766d", gap_dark=0.3, spread=0.05, rough=0.75)
    weather = spectral(n, 2.0, 62)
    alb = desat(alb, 0.55) * (0.9 + 0.12 * weather)[..., None]
    return alb, h, np.clip(r + 0.1, 0, 1)


@mat("farm_walnut", surface="wood", uv_scale=1.2)
def _(n):
    bid = np.zeros((n, n), int)
    yy, xx = np.mgrid[0:n, 0:n] / n
    alb, late_band, _ = wood_figure(n, (yy * 3).astype(int), xx, (yy * 3) % 1, 251, rings=13.0, early="6e4c32", late="4f3423", pores=0.5, spread=0.06)
    alb = alb * macro(n, 252, 0.06)[..., None]
    return alb, 0.05 * late_band + 0.02 * band(n, 200, 500, 253), 0.32 + 0.08 * spectral(n, 2.2, 254)


@mat("farm_pine", surface="wood", uv_scale=1.2)
def _(n):
    yy, xx = np.mgrid[0:n, 0:n] / n
    alb, late_band, _ = wood_figure(n, (yy * 2).astype(int), xx, (yy * 2) % 1, 261, rings=9.0, early="dcbd8c", late="b07e48", pores=0.1, spread=0.06)
    knots = np.zeros((n, n))
    r = np.random.default_rng(262)
    for _ in range(3):
        cx, cy, rad = r.uniform(0, n), r.uniform(0, n), r.uniform(8, 18)
        d = np.sqrt(np.minimum(np.abs(xx * n - cx), n - np.abs(xx * n - cx)) ** 2 * 0.4 + np.minimum(np.abs(yy * n - cy), n - np.abs(yy * n - cy)) ** 2)
        knots = np.maximum(knots, np.clip(1 - d / rad, 0, 1))
    alb = alb * (1 - 0.5 * knots)[..., None] * macro(n, 263, 0.05)[..., None]
    return alb, 0.05 * late_band, 0.45


@mat("farm_butcher_block", surface="wood", uv_scale=1.2)
def _(n):
    yy, xx = np.mgrid[0:n, 0:n]
    strips = 14
    sid = (yy // (n / strips)).astype(int)      # glued strips, grain along x
    alb, late_band, _ = wood_figure(n, sid, xx / n, (yy % (n / strips)) / (n / strips), 181, rings=5.0, early="c9a06c", late="94693c", pores=0.3, spread=0.12)
    seam = (yy % (n / strips)) < 1.5
    alb = np.where(seam[..., None], alb * 0.75, alb) * macro(n, 182, 0.05)[..., None]
    return alb, 0.04 * late_band, 0.42


# ---- painted wood, siding, trim ----------------------------------------------------------------------------
def painted(color, seed, grain_amt=0.04, rough=0.42, along_x=True):
    n = N
    g = spectral(n, 2.2, seed, sx=(20.0 if along_x else 1.0), sy=(1.0 if along_x else 20.0))
    brush = spectral(n, 1.2, seed + 1, sx=(60.0 if along_x else 1.0), sy=(1.0 if along_x else 60.0))
    base = rgb(color)
    alb = base * (1 + (g - 0.5)[..., None] * 0.03 + (brush - 0.5)[..., None] * 0.015) * macro(n, seed + 2, 0.025)[..., None]
    h = grain_amt * g + 0.01 * brush + 0.02 * band(n, 220, 512, seed + 3)
    return alb, h, rough + 0.06 * (brush - 0.5)


@mat("farm_siding", surface="wood", uv_scale=1.98)
def _(n):
    rows = 11
    yy, xx = np.mgrid[0:n, 0:n]
    rh = n / rows
    f = (yy % rh) / rh
    alb, h, rough = painted("e9e6dd", 201, 0.05)
    lap = 0.25 + 0.75 * f
    shadow = f > 0.955
    h = np.where(shadow, 0.0, lap + h)
    # a soft shadow under each lap and a little dirt that collects on the board's top edge
    under = np.clip((f - 0.0) / 0.12, 0, 1)
    alb = alb * (0.9 + 0.1 * under)[..., None]
    alb = np.where(shadow[..., None], alb * 0.5, alb)
    dirt = spectral(n, 1.8, 202) * (1 - under)
    alb = alb * (1 - 0.05 * dirt)[..., None]
    # nail heads every 40 cm
    r = np.random.default_rng(203)
    for ri in range(rows):
        for k in range(5):
            x = (k + 0.5) * n / 5 + r.uniform(-6, 6)
            y = (ri + 0.82) * rh
            d = np.sqrt((xx - x) ** 2 + (yy - y) ** 2)
            alb = np.where((d < 2.2)[..., None], alb * 0.82, alb)
    return alb, h, rough


@mat("farm_trim", surface="wood", uv_scale=1.0)
def _(n):
    return painted("f3f1ea", 211, 0.03, 0.38)


@mat("farm_cabinet_white", surface="wood", uv_scale=1.0)
def _(n):
    return painted("eeebe2", 171, 0.025, 0.35)


@mat("farm_cabinet_sage", surface="wood", uv_scale=1.0)
def _(n):
    return painted("8c9a86", 172, 0.025, 0.4)


@mat("farm_cabinet_navy", surface="wood", uv_scale=1.0)
def _(n):
    return painted("323d4e", 173, 0.025, 0.38)


@mat("farm_door_red", surface="wood", uv_scale=1.0)
def _(n):
    return painted("7f2a25", 241, 0.03, 0.3)


@mat("farm_shutter", surface="wood", uv_scale=1.0)
def _(n):
    yy = np.mgrid[0:n, 0:n][0]
    f = (yy % (n / 16)) / (n / 16)
    alb, h, rough = painted("56695d", 231, 0.03, 0.45)
    louvre = 1 - np.abs(f - 0.3) * 1.3
    alb = alb * (0.72 + 0.28 * np.clip(louvre, 0, 1))[..., None]
    return alb, louvre + h, rough


@mat("farm_barn_red", surface="wood", uv_scale=2.0)
def _(n):
    xx = np.mgrid[0:n, 0:n][1]
    seam = (xx % (n / 8)) < 4
    alb, h, rough = painted("7a2b24", 561, 0.08, 0.8, along_x=False)
    weather = spectral(n, 2.0, 562)
    alb = desat(alb, 0.8) * (0.85 + 0.25 * weather)[..., None]
    alb = np.where(seam[..., None], alb * 0.45, alb)
    return alb, np.where(seam, 0, 0.8) + h, rough


# ---- roofing, masonry, stone ---------------------------------------------------------------------------------
@mat("farm_shingle", surface="wood", uv_scale=2.6)
def _(n):
    rows = 12
    yy, xx = np.mgrid[0:n, 0:n]
    rh = n / rows
    row = (yy // rh).astype(int)
    f = (yy % rh) / rh
    r = np.random.default_rng(51)
    # architectural (laminated) shingles: tabs of random width per row, a darker shadow band on the lower layer
    tab_id = np.zeros((n, n), int)
    for ri in range(rows):
        edges = np.cumsum(r.uniform(0.05, 0.12, 30))
        edges = edges[edges < 1.0]
        shift = r.uniform(0, 1)
        sel = row == ri
        u = (xx[sel] / n + shift) % 1.0
        tab_id[sel] = ri * 40 + np.searchsorted(edges, u)
    tone = r.uniform(-0.12, 0.12, rows * 40 + 40)[tab_id]
    drop = r.uniform(0.62, 0.9, rows * 40 + 40)[tab_id]
    lower = f > drop
    gran = r.random((n, n))
    palette = np.array([rgb("3a3a3c"), rgb("4a4846"), rgb("2c2d30"), rgb("5a5550"), rgb("46403a")])
    gidx = np.clip((gran * 5).astype(int), 0, 4)
    alb = palette[gidx] * (1 + tone)[..., None]
    alb = blur_rgb(alb, 0.55)
    alb = np.where(lower[..., None], alb * 0.62, alb)
    alb = alb * (0.82 + 0.18 * f)[..., None] * macro(n, 52, 0.08)[..., None]
    h = 0.4 + 0.5 * f - 0.35 * lower + 0.12 * band(n, 300, 512, 53)
    return alb, h, 0.88


def blur_rgb(a, r):
    return np.stack([blur(a[..., i], r) for i in range(3)], -1)


@mat("farm_brick", surface="brick", uv_scale=1.1)
def _(n):
    rows, per = 14, 4
    yy, xx = np.mgrid[0:n, 0:n]
    rh = n / rows
    row = (yy // rh).astype(int)
    bw = n / per
    xo = (xx + (row % 2) * bw / 2) % n
    bid = row * (per + 1) + (xo // bw).astype(int)
    fx, fy = xo % bw, yy % rh
    erode = (spectral(n, 1.4, 70) - 0.5) * 6
    edge = np.minimum(np.minimum(fx, bw - fx), np.minimum(fy, rh - fy)) + erode
    mort = edge < 5.5
    r = np.random.default_rng(71)
    tint = r.uniform(0, 1, bid.max() + 1)[bid]
    pal = lerp(rgb("7d3a2c"), rgb("a85a3e"), tint)
    pal = lerp(pal, rgb("5e3029"), (r.random(bid.max() + 1)[bid] > 0.85) * 0.6)
    noise = spectral(n, 2.0, 72)
    speck = (band(n, 350, 512, 73) > 0.8) * 0.25
    alb = pal * (0.85 + 0.25 * noise[..., None]) * (1 - speck[..., None])
    sand = band(n, 300, 512, 74)
    mortar = rgb("bdb5a8") * (0.82 + 0.25 * sand[..., None])
    alb = np.where(mort[..., None], mortar, alb) * macro(n, 75, 0.05)[..., None]
    h = np.where(mort, 0.1 + 0.1 * sand, 0.75 + 0.15 * np.clip(edge / 12, 0, 1) + 0.06 * noise)
    return alb, blur(h, 0.8), np.where(mort, 0.95, 0.82)


@mat("farm_stone", surface="brick", uv_scale=2.2)
def _(n):
    f1, edge, cid = voronoi(n, 8, 81, 0.95)
    r = np.random.default_rng(82)
    k = cid.max() + 1
    pal = np.array([rgb(c) for c in ("8c877e", "a39784", "6f6b66", "b3a68f", "8f7f6c", "7b7f80")])
    col = pal[r.integers(0, len(pal), k)][cid]
    noise = spectral(n, 2.0, 83)
    grain_ = band(n, 250, 512, 84)
    lichen = (spectral(n, 2.4, 85) > 0.78) & (edge > 0.1)
    mort = edge < 0.07
    dome = np.clip(edge * 5, 0, 1) ** 0.6
    alb = col * (0.78 + 0.3 * noise[..., None]) * (0.92 + 0.12 * grain_[..., None])
    alb = np.where(lichen[..., None], lerp(alb, rgb("9a9c74"), 0.35), alb)
    alb = np.where(mort[..., None], rgb("aaa294") * (0.8 + 0.2 * grain_[..., None]), alb)
    alb = alb * (0.75 + 0.25 * dome)[..., None]
    h = np.where(mort, 0.05, 0.35 + 0.55 * dome + 0.1 * noise)
    return alb, h, 0.86


@mat("farm_flagstone", surface="brick", uv_scale=2.6)
def _(n):
    f1, edge, cid = voronoi(n, 5, 491, 0.85)
    r = np.random.default_rng(492)
    k = cid.max() + 1
    pal = np.array([rgb(c) for c in ("9c8f7c", "b0a289", "8a8478", "a59682", "c0b39b")])
    col = pal[r.integers(0, len(pal), k)][cid]
    yy = np.mgrid[0:n, 0:n][0] / n
    layers = 0.5 + 0.5 * np.sin((yy * 18 + spectral(n, 2.2, 493) * 6 + r.uniform(0, 6, k)[cid]) * np.pi)
    joint = edge < 0.045
    soil = rgb("4a3d2e") * (0.8 + 0.4 * spectral(n, 2.0, 494)[..., None])
    moss = (band(n, 200, 500, 495) > 0.55)
    joint_col = np.where(moss[..., None], rgb("56602f"), soil)
    alb = col * (0.88 + 0.1 * layers[..., None]) * (0.9 + 0.15 * band(n, 280, 512, 496)[..., None])
    alb = np.where(joint[..., None], joint_col, alb) * macro(n, 497, 0.06)[..., None]
    h = np.where(joint, 0.0, 0.6 + 0.15 * layers + 0.1 * spectral(n, 2.0, 498))
    return alb, blur(h, 1.0), np.where(joint, 0.95, 0.8)


@mat("farm_gravel", surface="gravel", uv_scale=1.4)
def _(n):
    f1, edge, cid = voronoi(n, 52, 481, 0.95)
    r = np.random.default_rng(482)
    k = cid.max() + 1
    pal = np.array([rgb(c) for c in ("8d877e", "a9a196", "6e6a64", "b8ad98", "8a7562", "cfc8bb", "5d5a57")])
    col = pal[r.integers(0, len(pal), k)][cid] * r.uniform(0.85, 1.12, k)[cid][..., None]
    dome = np.clip(edge * 3.2, 0, 1) ** 0.7
    sand = rgb("7f7464") * (0.7 + 0.3 * band(n, 300, 512, 483)[..., None])
    gap = edge < 0.06
    alb = np.where(gap[..., None], sand, col * (0.55 + 0.45 * dome)[..., None])
    alb = alb * (0.92 + 0.12 * band(n, 300, 512, 484)[..., None])
    return alb, np.where(gap, 0.0, dome), 0.85


@mat("farm_asphalt", surface="concrete", uv_scale=3.0)
def _(n):
    agg = band(n, 260, 512, 521)
    stones = (agg > 0.78).astype(float)
    g = spectral(n, 2.0, 522)
    alb = lerp(rgb("2a2b2d"), rgb("444547"), 0.5 * g + 0.2 * agg) + stones[..., None] * 0.08
    return alb * macro(n, 523, 0.08)[..., None], 0.3 * agg + 0.2 * stones, 0.88


# ---- plaster, paper, tile, stone tops -----------------------------------------------------------------------
def wall_paint(color, seed):
    n = N
    peel = band(n, 180, 420, seed)          # the roller's orange-peel stipple
    alb = rgb(color) * macro(n, seed + 1, 0.025)[..., None] * (0.99 + 0.02 * peel[..., None])
    return alb, 0.08 * peel + 0.04 * spectral(n, 2.8, seed + 2), 0.82


@mat("farm_wall_cream", surface="plaster", uv_scale=2.0)
def _(n):
    return wall_paint("e6ddca", 111)


@mat("farm_wall_sage", surface="plaster", uv_scale=2.0)
def _(n):
    return wall_paint("b3bba3", 112)


@mat("farm_wall_blue", surface="plaster", uv_scale=2.0)
def _(n):
    return wall_paint("b6c3cb", 113)


@mat("farm_wall_rose", surface="plaster", uv_scale=2.0)
def _(n):
    return wall_paint("dcc7bc", 114)


@mat("farm_ceiling", surface="plaster", uv_scale=2.5)
def _(n):
    return wall_paint("f1eee8", 115)


@mat("farm_wallpaper_floral", surface="plaster", uv_scale=0.64)
def _(n):
    # a small sprig print on a warm ground with a printed paper texture
    img = Image.new("RGB", (n, n), (231, 222, 201))
    d = ImageDraw.Draw(img)
    r = np.random.default_rng(121)
    step = n // 8
    for i in range(8):
        for j in range(8):
            cx = i * step + step / 2 + ((j % 2) * step / 2)
            cy = j * step + step / 2
            def sprig(dx, dy, cx=cx, cy=cy):
                x, y = cx + dx, cy + dy
                d.line([x, y + 26, x + 3, y - 12], fill=(128, 136, 104), width=2)
                for (lx, ly, a) in ((-9, 8, 30), (10, 2, -30), (-7, -6, 25)):
                    d.ellipse([x + lx - 7, y + ly - 3, x + lx + 7, y + ly + 3], fill=(140, 150, 114))
                for (fx, fy, c) in ((2, -18, (176, 112, 104)), (-8, -10, (196, 150, 136)), (10, -12, (184, 124, 112))):
                    d.ellipse([x + fx - 6, y + fy - 6, x + fx + 6, y + fy + 6], fill=c)
                    d.ellipse([x + fx - 2, y + fy - 2, x + fx + 2, y + fy + 2], fill=(222, 200, 150))
            wrap_draw(n, 40, cx % n, cy % n, sprig)
    alb = np.asarray(img.filter(ImageFilter.GaussianBlur(0.7))) / 255.0
    paper = band(n, 300, 512, 122)
    alb = alb * (0.97 + 0.04 * paper[..., None]) * macro(n, 123, 0.02)[..., None]
    return alb, 0.03 * paper, 0.8


@mat("farm_wallpaper_stripe", surface="plaster", uv_scale=1.0)
def _(n):
    xx = np.mgrid[0:n, 0:n][1] / n
    s = smooth(np.sin(xx * 2 * np.pi * 10), 0.2, 0.35)
    t = smooth(np.sin(xx * 2 * np.pi * 10 + 2.4), 0.92, 0.97)
    base = rgb("e4e0d4")
    alb = lerp(base, rgb("a7b4bd"), s * 0.75)
    alb = lerp(alb, rgb("f2efe7"), t * 0.8)
    paper = band(n, 300, 512, 131)
    alb = alb * (0.97 + 0.04 * paper[..., None]) * macro(n, 132, 0.02)[..., None]
    return alb, 0.03 * paper, 0.8


def glazed_tiles(n, cols, rows, seed, color, color2=None, grout="c9c3b8", gw=4.0, offset=False, checker=False, wave=0.08):
    yy, xx = np.mgrid[0:n, 0:n]
    th, tw = n / rows, n / cols
    row = (yy // th).astype(int)
    xs = (xx + (row % 2) * tw / 2) % n if offset else xx
    col = (xs // tw).astype(int)
    fx, fy = xs % tw, yy % th
    dist = np.minimum(np.minimum(fx, tw - fx), np.minimum(fy, th - fy))
    grout_m = dist < gw / 2
    r = np.random.default_rng(seed)
    tid = row * (cols + 2) + col
    tint = r.uniform(-0.035, 0.035, tid.max() + 1)[tid]
    base = np.ones((n, n, 1)) * rgb(color)
    if checker and color2:
        base = np.where(((row + col) % 2 == 0)[..., None], rgb(color), rgb(color2))
    glaze = spectral(n, 2.2, seed + 1)
    alb = base * (1 + tint)[..., None] * (0.97 + 0.05 * glaze[..., None])
    gnoise = band(n, 250, 512, seed + 2)
    dirt = spectral(n, 2.0, seed + 3)
    alb = np.where(grout_m[..., None], rgb(grout) * (0.82 + 0.15 * gnoise[..., None]) * (0.92 + 0.1 * dirt[..., None]), alb)
    bev = np.clip((dist - gw / 2) / 6, 0, 1) ** 0.5
    # each tile is slightly pillowed and not perfectly flat
    pillow = np.sin(np.clip(fx / tw, 0, 1) * np.pi) * np.sin(np.clip(fy / th, 0, 1) * np.pi)
    h = bev * (0.8 + wave * pillow) + wave * 0.3 * spectral(n, 3.0, seed + 4)
    rough = np.where(grout_m, 0.92, 0.1 + 0.05 * glaze)
    return alb, h, rough


@mat("farm_tile_subway", surface="tile", uv_scale=0.6)
def _(n):
    return glazed_tiles(n, 4, 8, 141, "efeee9", offset=True)


@mat("farm_tile_checker", surface="tile", uv_scale=0.6)
def _(n):
    a, h, r = glazed_tiles(n, 4, 4, 151, "e9e6de", "33373b", grout="b7b1a5", wave=0.04)
    vein = np.clip(1 - np.abs(np.sin((np.mgrid[0:n, 0:n][1] / n * 3 + spectral(n, 2.0, 152) * 3) * np.pi * 2)) * 18, 0, 1)
    a = a * (1 - 0.06 * vein[..., None])
    return a, h, r


@mat("farm_tile_hex", surface="tile", uv_scale=0.45)
def _(n):
    # hexagonal mosaic: nearest centre on a hex lattice (7 x 8 per repeat, within 1% of regular, tileable)
    yy, xx = np.mgrid[0:n, 0:n].astype(float)
    cols, rows = 7, 8
    w, rowh = n / cols, n / rows
    best = np.full((n, n), 1e12)
    second = np.full((n, n), 1e12)
    tid = np.zeros((n, n), int)
    for j in range(-1, rows + 1):
        for i in range(-1, cols + 1):
            cx, cy = (i + 0.5 * (j % 2)) * w, j * rowh
            d = (xx - cx) ** 2 + (yy - cy) ** 2
            closer = d < best
            second = np.where(closer, best, np.minimum(second, d))
            tid = np.where(closer, (j % rows) * cols + (i % cols), tid)
            best = np.where(closer, d, best)
    edge = (second - best) / (2 * w)              # distance to the nearest tile edge, in pixels
    grout_m = edge < n / 700
    r = np.random.default_rng(161)
    tone = r.uniform(-0.025, 0.025, rows * cols)[tid]
    glaze = spectral(n, 2.4, 162)
    tile = rgb("f0eee8") * (0.97 + 0.04 * glaze[..., None] + tone[..., None])
    grout = rgb("b9b2a6") * (0.92 + 0.12 * band(n, 200, 512, 163))[..., None]
    alb = np.where(grout_m[..., None], grout, tile * (0.93 + 0.07 * np.clip(edge / (n / 140), 0, 1))[..., None])
    h = np.clip((edge - n / 700) / (n / 200), 0, 1) ** 0.5 * 0.6 + 0.01 * glaze
    return alb, h, np.where(grout_m, 0.9, 0.1 + 0.05 * glaze)


@mat("farm_quartz", surface="tile", uv_scale=1.6)
def _(n):
    yy, xx = np.mgrid[0:n, 0:n] / n
    t1 = spectral(n, 2.0, 191)
    t2 = spectral(n, 2.3, 192)
    v1 = np.abs(np.sin((xx * 2 + yy + t1 * 2.6) * 2 * np.pi))
    v2 = np.abs(np.sin((xx - yy * 2 + t2 * 3.4) * 2 * np.pi * 2))
    vein = np.clip(1 - v1 * 22, 0, 1) * 0.55 + np.clip(1 - v2 * 40, 0, 1) * 0.3 + blur(np.clip(1 - v1 * 6, 0, 1), 3) * 0.12
    alb = lerp(rgb("f1f0ec"), rgb("8f9497"), np.clip(vein, 0, 1)) * (0.985 + 0.02 * band(n, 300, 512, 193)[..., None])
    return alb, 0.005 * t1, 0.08


@mat("farm_ceramic", surface="tile", uv_scale=0.5)
def _(n):
    g = spectral(n, 3.0, 371)
    return lerp(rgb("efeee9"), rgb("f9f8f4"), g), 0.006 * g, 0.06


@mat("farm_terracotta", surface="brick", uv_scale=0.5)
def _(n):
    g = spectral(n, 2.2, 391)
    speck = (band(n, 350, 512, 392) > 0.8).astype(float)
    bloom = smooth(spectral(n, 2.6, 393), 0.6, 0.9)
    alb = lerp(rgb("9b5233"), rgb("b86c47"), g) * (1 - 0.15 * speck[..., None])
    alb = lerp(alb, rgb("cfc3b0"), bloom * 0.25)
    return alb, 0.08 * g + 0.05 * band(n, 200, 500, 394), 0.85


# ---- textiles ---------------------------------------------------------------------------------------------------
def woven(n, threads, warp_cols, weft_cols, seed, twill=False, herring=0, slub=0.4, relief=1.0):
    """Thread-level weave: per-thread colours (lists, repeated across the tile), plain or twill, optional herringbone."""
    yy, xx = np.mgrid[0:n, 0:n]
    s = n / threads
    ti, tj = (xx / s).astype(int) % threads, (yy / s).astype(int) % threads
    fx, fy = (xx % s) / s, (yy % s) / s
    if twill:
        k = (ti + tj) if not herring else np.where((ti // herring) % 2 == 0, ti + tj, tj - ti)
        over = (k % 4) < 2
    else:
        over = (ti + tj) % 2 == 0
    r = np.random.default_rng(seed)
    wc = np.array([rgb(c) for c in warp_cols])[ti % len(warp_cols)]
    fc = np.array([rgb(c) for c in weft_cols])[tj % len(weft_cols)]
    jw = r.uniform(-0.05, 0.05, threads)[ti]
    jf = r.uniform(-0.05, 0.05, threads)[tj]
    sl_w = spectral(n, 1.6, seed + 1, sx=1.0, sy=10.0)
    sl_f = spectral(n, 1.6, seed + 2, sx=10.0, sy=1.0)
    col = np.where(over[..., None], wc * (1 + jw + (sl_w - 0.5) * slub)[..., None], fc * (1 + jf + (sl_f - 0.5) * slub)[..., None])
    # each float is a rounded thread: lighter on its crown, darker where it dives under its neighbour
    crown = np.where(over, np.sin(fx * np.pi), np.sin(fy * np.pi))
    col = col * (0.78 + 0.22 * crown)[..., None]
    return col, relief * crown * 0.6 + 0.2 * np.where(over, 1, 0)


@mat("farm_linen", surface="fabric", uv_scale=0.35)
def _(n):
    a, h = woven(n, 128, ["cbc2ae", "c4bba6", "d1c8b5"], ["d0c7b4", "c7bea9"], 211, slub=0.5)
    return a * macro(n, 212, 0.03)[..., None], h, 0.92


@mat("farm_tweed", surface="fabric", uv_scale=0.25)
def _(n):
    a, h = woven(n, 96, ["4f5f68", "6d7c80", "3d4a52"], ["8a8f86", "5c6a6f", "a29c8c"], 221, twill=True, herring=6, slub=0.35)
    fleck = band(n, 380, 512, 222) > 0.86
    a = np.where(fleck[..., None], rgb("b49a6a"), a)
    return a, h, 0.95


@mat("farm_velvet_green", surface="fabric", uv_scale=0.6)
def _(n):
    pile = band(n, 350, 512, 231)
    crush = spectral(n, 1.8, 232)
    alb = lerp(rgb("26402f"), rgb("456650"), 0.45 * crush + 0.25 * pile)
    return alb, 0.15 * pile + 0.2 * crush, 0.6 + 0.2 * crush


@mat("farm_leather", surface="fabric", uv_scale=0.4)
def _(n):
    f1, edge, cid = voronoi(n, 70, 241, 0.95)
    pebble = np.clip(edge * 4, 0, 1) ** 0.5
    wear = spectral(n, 2.4, 242)
    crease = np.clip(1 - np.abs(spectral(n, 1.6, 243) - 0.5) * 30, 0, 1)
    alb = lerp(rgb("4e2c1a"), rgb("7d4d2e"), 0.55 * wear + 0.25 * pebble) * (1 - 0.25 * crease)[..., None]
    return alb, 0.5 * pebble - 0.3 * crease, 0.42 + 0.15 * (1 - pebble) + 0.15 * crease


@mat("farm_gingham", surface="fabric", uv_scale=0.18)
def _(n):
    w = ["a8423b"] * 4 + ["f1ede4"] * 4
    a, h = woven(n, 128, w, w, 301, slub=0.2)
    return a, h, 0.9


@mat("farm_bedding", surface="fabric", uv_scale=0.25)
def _(n):
    a, h = woven(n, 160, ["efede6", "eae8e0"], ["f2f0ea"], 271, slub=0.15, relief=0.5)
    wrinkle = spectral(n, 2.6, 272)
    return a * (0.97 + 0.04 * wrinkle[..., None]), h * 0.4 + 0.6 * wrinkle, 0.88


@mat("farm_curtain", surface="fabric", uv_scale=0.4)
def _(n):
    a, h = woven(n, 110, ["e2d8c4", "dcd1bb"], ["e7dfcc"], 291, slub=0.45, relief=0.7)
    return a, h, 0.9


@mat("farm_lampshade", surface="fabric", uv_scale=0.3)
def _(n):
    a, h = woven(n, 140, ["ece3cf"], ["f3ecdc"], 431, slub=0.3, relief=0.5)
    return a, h, 0.9


@mat("farm_towel", surface="fabric", uv_scale=0.3)
def _(n):
    loops = band(n, 300, 512, 311)
    clumps = spectral(n, 1.5, 312)
    alb = lerp(rgb("7da0b2"), rgb("a9c2cf"), 0.6 * loops + 0.3 * clumps)
    return alb, 0.9 * loops, 0.98


@mat("farm_carpet", surface="fabric", uv_scale=1.0)
def _(n):
    # berber: rows of loops in two flecked tones
    yy, xx = np.mgrid[0:n, 0:n]
    rows = 96
    f = (yy % (n / rows)) / (n / rows)
    loopv = np.sin(f * np.pi) * (0.6 + 0.4 * band(n, 200, 512, 201))
    fleck = band(n, 380, 512, 202) > 0.75
    alb = lerp(rgb("b3a690"), rgb("c8bca6"), spectral(n, 1.6, 203)) * (0.86 + 0.18 * loopv[..., None])
    alb = np.where(fleck[..., None], alb * 0.82, alb) * macro(n, 204, 0.04)[..., None]
    return alb, loopv, 0.97


@mat("farm_quilt", surface="fabric", uv_scale=0.9)
def _(n):
    k = 10
    yy, xx = np.mgrid[0:n, 0:n]
    cell = n / k
    cid = (yy // cell).astype(int) * k + (xx // cell).astype(int)
    r = np.random.default_rng(281)
    grounds = [rgb(c) for c in ("a2463e", "e6dcc6", "5f7d97", "cf9d52", "6f8a63", "efe7d8", "8f514c", "bba57f", "3e5266")]
    pal = np.array(grounds)
    gi = r.integers(0, len(pal), k * k)
    col = pal[gi][cid]
    # each patch is a small calico print: dots and tiny florals in a lighter or darker ink
    img = Image.new("L", (n, n), 0)
    d = ImageDraw.Draw(img)
    for _ in range(9000):
        x, y, s = r.uniform(0, n), r.uniform(0, n), r.uniform(1.0, 2.6)
        d.ellipse([x - s, y - s, x + s, y + s], fill=255)
    prints = np.asarray(img) / 255.0
    ink = np.where(col.mean(-1, keepdims=True) > 0.6, col * 0.7, col * 1.35 + 0.05)
    col = lerp(col, np.clip(ink, 0, 1), prints * 0.8)
    fx, fy = (xx % cell) / cell, (yy % cell) / cell
    seam = np.minimum(np.minimum(fx, 1 - fx), np.minimum(fy, 1 - fy)) < 0.015
    stitch = ((np.abs(fx - 0.5) < 0.006) | (np.abs(fy - 0.5) < 0.006)) & ((xx + yy) % 10 < 6)
    weave_ = woven(n, 256, ["ffffff"], ["eeeeee"], 282, relief=0.4)[0][..., 0]
    col = col * (0.9 + 0.12 * weave_[..., None])
    col = np.where(stitch[..., None], col * 1.15, col)
    puff = np.sin(np.clip(fx * 2 % 1, 0, 1) * np.pi) * np.sin(np.clip(fy * 2 % 1, 0, 1) * np.pi)
    col = col * (0.9 + 0.1 * puff[..., None])
    col = np.where(seam[..., None], col * 0.7, col)
    return np.clip(col, 0, 1), 0.5 * puff + 0.2 * weave_, 0.92


@mat("farm_rug_red", surface="fabric", uv_scale=1.0)
def _(n):
    # a whole hand-knotted rug, fitted to the rug: borders, a field of small motifs, a central medallion, wear
    yy, xx = np.mgrid[0:n, 0:n] / n
    dx, dy = np.abs(xx - 0.5) * 2, np.abs(yy - 0.5) * 2
    d = np.maximum(dx, dy)
    red, navy, ivory, gold, rust = rgb("7a2a26"), rgb("27324a"), rgb("d8ccb0"), rgb("b38b4f"), rgb("9a4a33")
    alb = np.ones((n, n, 3)) * red
    alb = np.where((d > 0.82)[..., None], navy, alb)
    border_motif = (np.sin(np.where(dx > dy, yy, xx) * 2 * np.pi * 26) > 0.3) & (d > 0.85) & (d < 0.95)
    alb = np.where(border_motif[..., None], rust, alb)
    for a, b in ((0.8, 0.82), (0.95, 0.965)):
        alb = np.where(((d > a) & (d < b))[..., None], ivory, alb)
    md = np.abs(xx - 0.5) * 1.2 + np.abs(yy - 0.5)
    alb = np.where((md < 0.34)[..., None], navy, alb)
    alb = np.where((md < 0.3)[..., None], ivory, alb)
    alb = np.where((md < 0.26)[..., None], red, alb)
    petals = (np.abs(np.sin(np.arctan2(yy - 0.5, xx - 0.5) * 8)) * 0.08 + 0.1) > md
    alb = np.where(petals[..., None], gold, alb)
    alb = np.where((md < 0.05)[..., None], navy, alb)
    field = (d < 0.78) & (md > 0.36)
    mx = (np.sin(xx * 2 * np.pi * 18) * np.sin(yy * 2 * np.pi * 18))
    alb = np.where((field & (mx > 0.55))[..., None], navy, alb)
    alb = np.where((field & (mx < -0.75))[..., None], gold * 0.9, alb)
    knots = band(n, 330, 512, 321)
    wear = smooth(spectral(n, 2.2, 322), 0.62, 0.9) * (d < 0.8)
    alb = lerp(alb, alb * 0.6 + rgb("c9bda2") * 0.4, wear * 0.6)
    alb = blur_rgb(alb, 0.8) * (0.88 + 0.16 * knots[..., None])
    return alb, 0.4 * knots, 0.97


@mat("farm_rug_braid", surface="fabric", uv_scale=1.0)
def _(n):
    yy, xx = np.mgrid[0:n, 0:n] / n
    rr = np.sqrt(((xx - 0.5) * 2) ** 2 + ((yy - 0.5) * 2) ** 2)
    ring = (rr * 20) % 1
    ang = np.arctan2(yy - 0.5, xx - 0.5)
    braid = 0.5 + 0.5 * np.sin(ang * 70 + rr * 160 + (rr * 20).astype(int) * 1.3)
    pal = np.array([rgb(c) for c in ("6b7b86", "c0b192", "84483d", "ddd2bd", "56634f", "9a8460")])
    cid = ((rr * 20).astype(int) * 7 + (braid > 0.5)) % len(pal)
    alb = pal[cid] * (0.78 + 0.25 * braid[..., None]) * (0.92 + 0.1 * band(n, 300, 512, 331)[..., None])
    h = np.sin(ring * np.pi) * 0.7 + 0.25 * braid
    return alb, h, 0.96


@mat("farm_wicker", surface="wood", uv_scale=0.3)
def _(n):
    a, h = woven(n, 24, ["b48d5c", "a47d4d", "c09a68"], ["9d7446", "ad8556"], 601, slub=0.25, relief=1.4)
    return a, h, 0.7


@mat("farm_paper", surface="fabric", uv_scale=0.3)
def _(n):
    fibre = band(n, 300, 512, 611)
    return rgb("f2efe6") * (0.97 + 0.04 * fibre[..., None]), 0.02 * fibre, 0.9


# ---- metals, glass, plastics ---------------------------------------------------------------------------------
@mat("farm_brass", surface="metal", uv_scale=0.4)
def _(n):
    brushed = spectral(n, 1.4, 331, sx=30.0, sy=1.0)
    tarnish = smooth(spectral(n, 2.4, 332), 0.55, 0.85)
    smudge = spectral(n, 2.8, 333)
    alb = lerp(rgb("b48d47"), rgb("d0ad66"), brushed) * (1 - 0.2 * tarnish[..., None])
    return alb, 0.01 * brushed, 0.22 + 0.15 * smudge + 0.1 * tarnish, 1.0


@mat("farm_iron", surface="metal", uv_scale=0.4)
def _(n):
    g = spectral(n, 2.4, 341)
    speck = band(n, 350, 512, 342)
    return lerp(rgb("1d1e20"), rgb("2e3033"), 0.6 * g + 0.4 * speck), 0.04 * speck, 0.5 + 0.1 * g, 0.75


@mat("farm_chrome", surface="metal", uv_scale=0.4)
def _(n):
    smudge = spectral(n, 2.8, 351)
    return lerp(rgb("d6d9dc"), rgb("eceef0"), smudge), 0.0 * smudge, 0.05 + 0.08 * smudge, 1.0


@mat("farm_steel", surface="metal", uv_scale=0.4)
def _(n):
    brushed = spectral(n, 1.2, 361, sx=50.0, sy=1.0)
    smudge = spectral(n, 2.8, 362)
    return lerp(rgb("a8acae"), rgb("c6cacc"), brushed), 0.015 * brushed, 0.25 + 0.1 * brushed + 0.1 * smudge, 1.0


@mat("farm_galvanized", surface="metal", uv_scale=1.6)
def _(n):
    f1, edge, cid = voronoi(n, 30, 571, 0.95)
    r = np.random.default_rng(572)
    t = r.uniform(0, 1, cid.max() + 1)[cid]
    xx = np.mgrid[0:n, 0:n][1] / n
    corr = 0.5 + 0.5 * np.sin(xx * 2 * np.pi * 24)
    return lerp(rgb("979c9f"), rgb("c1c5c7"), 0.6 * t + 0.4 * corr), corr, 0.4 + 0.15 * t, 0.9


@mat("farm_mirror", surface="glass", uv_scale=0.5)
def _(n):
    return np.ones((n, n, 3)) * rgb("dfe2e4"), np.zeros((n, n)), 0.02, 1.0


@mat("farm_window_glass", surface="glass", uv_scale=1.0, opacity=0.16)
def _(n):
    wave = spectral(n, 3.5, 91)
    return lerp(rgb("cdd6d9"), rgb("e3e9ea"), wave), 0.02 * wave, 0.04


@mat("farm_plastic_black", surface="metal", uv_scale=0.4)
def _(n):
    g = spectral(n, 2.5, 381)
    return lerp(rgb("17181a"), rgb("232528"), g), 0.02 * band(n, 300, 512, 382), 0.38 + 0.08 * g


@mat("farm_screen", surface="glass", uv_scale=1.0)
def _(n):
    yy = np.mgrid[0:n, 0:n][0] / n
    return lerp(rgb("0c0e11"), rgb("161b21"), yy), np.zeros((n, n)), 0.05


@mat("farm_bulb", surface="glass", uv_scale=0.2)
def _(n):
    return np.ones((n, n, 3)) * rgb("fff4dc"), np.zeros((n, n)), 0.2


# ---- plants, food, garden ------------------------------------------------------------------------------------
@mat("farm_lawn", surface="dirt", uv_scale=1.6)
def _(n):
    # thousands of grass blades over a darker thatch, with some dry and some clover
    r = np.random.default_rng(471)
    base = lerp(rgb("3a4a24"), rgb("4b5a2c"), spectral(n, 2.0, 472))
    img = Image.fromarray((base * 255).astype(np.uint8))
    d = ImageDraw.Draw(img)
    pal = [(78, 99, 46), (92, 112, 52), (104, 122, 58), (66, 86, 40), (118, 130, 66), (140, 138, 82), (84, 106, 48)]
    for _ in range(42000):
        x, y = r.uniform(0, n), r.uniform(0, n)
        L, a = r.uniform(5, 16), r.uniform(0, 2 * np.pi)
        c = pal[r.integers(0, len(pal))]
        if r.random() < 0.04:
            c = (150, 140, 92)
        def blade(dx, dy, x=x, y=y, L=L, a=a, c=c):
            d.line([x + dx, y + dy, x + dx + math.cos(a) * L, y + dy + math.sin(a) * L], fill=c, width=1 if r.random() < 0.6 else 2)
        wrap_draw(n, 18, x, y, blade)
    for _ in range(260):
        x, y = r.uniform(0, n), r.uniform(0, n)
        def clover(dx, dy, x=x, y=y):
            for k in range(3):
                a = k * 2.1
                d.ellipse([x + dx + math.cos(a) * 3 - 3, y + dy + math.sin(a) * 3 - 3, x + dx + math.cos(a) * 3 + 3, y + dy + math.sin(a) * 3 + 3], fill=(70, 98, 50))
        wrap_draw(n, 8, x, y, clover)
    alb = np.asarray(img.filter(ImageFilter.GaussianBlur(0.45))) / 255.0
    alb = alb * macro(n, 473, 0.1)[..., None]
    patch = smooth(spectral(n, 3.0, 474), 0.7, 0.92)
    alb = lerp(alb, desat(alb, 0.4) * 1.15, patch * 0.5)
    h = luminance(alb)
    return alb, (h - h.min()) / (h.max() - h.min() + 1e-9), 0.92


@mat("farm_hedge", surface="fabric", uv_scale=1.2)
def _(n):
    r = np.random.default_rng(531)
    img = Image.new("RGB", (n, n), (18, 30, 16))
    d = ImageDraw.Draw(img)
    for layer in range(4):
        shade = 0.55 + layer * 0.15
        for _ in range(5200):
            x, y = r.uniform(0, n), r.uniform(0, n)
            a = r.uniform(0, 180)
            g = r.uniform(0.8, 1.15)
            c = tuple(int(v * shade * g) for v in (58, 92, 44))
            def leaf(dx, dy, x=x, y=y, a=a, c=c):
                w, hh = 10, 5
                pts = [(x + dx + math.cos(math.radians(a + t)) * (w if t % 180 == 0 else hh), y + dy + math.sin(math.radians(a + t)) * (w if t % 180 == 0 else hh)) for t in (0, 90, 180, 270)]
                d.polygon(pts, fill=c)
            wrap_draw(n, 14, x, y, leaf)
    alb = np.asarray(img.filter(ImageFilter.GaussianBlur(0.6))) / 255.0
    h = luminance(alb)
    h = (h - h.min()) / (h.max() - h.min() + 1e-9)
    return alb * macro(n, 532, 0.08)[..., None], h, 0.7


@mat("farm_leaf", surface="fabric", uv_scale=0.35)
def _(n):
    yy, xx = np.mgrid[0:n, 0:n] / n
    midrib = np.clip(1 - np.abs(np.sin(xx * 2 * np.pi * 4)) * 25, 0, 1)
    veins = np.clip(1 - np.abs(np.sin((xx * 3 + yy * 1.6) * 2 * np.pi * 7)) * 18, 0, 1) * 0.5
    g = spectral(n, 2.2, 401)
    alb = lerp(rgb("2c4a24"), rgb("4c7238"), 0.6 * g + 0.2) * (1 + 0.25 * midrib[..., None] + 0.12 * veins[..., None])
    return alb, 0.25 * midrib + 0.1 * veins, 0.45


@mat("farm_corn_leaf", surface="fabric", uv_scale=0.6)
def _(n):
    yy, xx = np.mgrid[0:n, 0:n] / n
    vein = np.clip(1 - np.abs(np.sin(xx * 2 * np.pi * 26)) * 10, 0, 1)
    g = spectral(n, 2.0, 541, sx=1, sy=8)
    dry = smooth(spectral(n, 2.6, 542), 0.65, 0.9)
    alb = lerp(rgb("4f6f34"), rgb("75914a"), 0.6 * g + 0.3 * vein)
    alb = lerp(alb, rgb("a79a62"), dry * 0.5)
    return alb, 0.2 * vein, 0.65


@mat("farm_wheat", surface="fabric", uv_scale=0.6)
def _(n):
    g = spectral(n, 2.0, 551, sx=1, sy=10)
    stalk = band(n, 160, 420, 552)
    return lerp(rgb("a88a52"), rgb("d2b77c"), 0.6 * g + 0.4 * stalk), 0.4 * stalk, 0.82


@mat("farm_mulch", surface="dirt", uv_scale=1.0)
def _(n):
    r = np.random.default_rng(501)
    img = Image.new("RGB", (n, n), (44, 30, 20))
    d = ImageDraw.Draw(img)
    for _ in range(9000):
        x, y = r.uniform(0, n), r.uniform(0, n)
        a, L, w = r.uniform(0, np.pi), r.uniform(6, 22), r.uniform(2, 5)
        c = tuple(int(v * r.uniform(0.6, 1.2)) for v in (98, 66, 42))
        def chip(dx, dy, x=x, y=y, a=a, L=L, w=w, c=c):
            ca, sa = math.cos(a), math.sin(a)
            pts = [(x + dx + ca * L / 2 - sa * w / 2, y + dy + sa * L / 2 + ca * w / 2), (x + dx + ca * L / 2 + sa * w / 2, y + dy + sa * L / 2 - ca * w / 2),
                   (x + dx - ca * L / 2 + sa * w / 2, y + dy - sa * L / 2 - ca * w / 2), (x + dx - ca * L / 2 - sa * w / 2, y + dy - sa * L / 2 + ca * w / 2)]
            d.polygon(pts, fill=c)
        wrap_draw(n, 14, x, y, chip)
    alb = np.asarray(img.filter(ImageFilter.GaussianBlur(0.5))) / 255.0
    h = luminance(alb)
    return alb, (h - h.min()) / (h.max() - h.min() + 1e-9), 0.9


@mat("farm_soil", surface="dirt", uv_scale=2.5)
def _(n):
    g = spectral(n, 2.0, 511)
    clod = band(n, 70, 260, 512)
    f1, edge, cid = voronoi(n, 40, 513, 0.9)
    pebbles = (edge > 0.35) & (band(n, 40, 120, 514) > 0.7)
    alb = lerp(rgb("3f2f22"), rgb("6c5540"), 0.55 * g + 0.45 * clod)
    alb = np.where(pebbles[..., None], rgb("8a8073"), alb)
    return alb * macro(n, 515, 0.08)[..., None], 0.5 * clod + 0.3 * g + 0.3 * pebbles, 0.95


@mat("farm_fruit", surface="fabric", uv_scale=0.15)
def _(n):
    f1, edge, cid = voronoi(n, 70, 411, 0.9)
    pores = np.clip(1 - f1 * 3, 0, 1)
    g = spectral(n, 2.4, 412)
    return lerp(rgb("d8701f"), rgb("ee9330"), g) * (1 - 0.08 * pores[..., None]), 0.3 * (1 - pores), 0.38


@mat("farm_apple", surface="fabric", uv_scale=0.15)
def _(n):
    streak = spectral(n, 1.8, 421, sx=1, sy=6)
    blush = spectral(n, 2.8, 422)
    alb = lerp(rgb("8c2a1f"), rgb("c54632"), streak)
    alb = lerp(alb, rgb("b8a03c"), smooth(blush, 0.7, 0.95) * 0.5)
    return alb, 0.02 * streak, 0.3


# ---- printed things -----------------------------------------------------------------------------------------
@mat("farm_books", surface="wood", uv_scale=1.0)
def _(n):
    # 16 cloth- and leather-bound spines across the texture (a book picks one with its u offset)
    img = Image.new("RGB", (n, n))
    d = ImageDraw.Draw(img)
    pal = [(98, 38, 34), (40, 56, 82), (48, 72, 54), (176, 152, 104), (86, 60, 42), (140, 84, 52), (58, 58, 62), (128, 112, 86),
           (150, 64, 52), (66, 90, 108), (196, 186, 164), (88, 44, 64), (52, 82, 76), (164, 124, 66), (30, 30, 34), (138, 134, 122)]
    w = n // 16
    r = np.random.default_rng(441)
    for i, c in enumerate(pal):
        x0 = i * w
        d.rectangle([x0, 0, x0 + w, n], fill=c)
        gold = (196, 166, 102) if sum(c) < 400 else (60, 50, 40)
        for b in sorted(r.uniform(0.06, 0.94, 2)):
            y = int(b * n)
            d.rectangle([x0 + 4, y, x0 + w - 4, y + 4], fill=gold)
        # the title, as rows of tiny strokes
        ty = int(r.uniform(0.3, 0.45) * n)
        for k in range(int(r.uniform(5, 12))):
            yy = ty + k * 9
            d.rectangle([x0 + w // 2 - 6, yy, x0 + w // 2 + 6, yy + 5], fill=gold)
        d.line([x0, 0, x0, n], fill=(18, 18, 18), width=2)
    cloth = woven(n, 256, ["ffffff"], ["e8e8e8"], 442, relief=0.5)[0][..., 0]
    alb = np.asarray(img) / 255.0 * (0.85 + 0.15 * cloth[..., None]) * macro(n, 443, 0.05)[..., None]
    return alb, 0.1 * cloth, 0.7


@mat("farm_art", surface="wood", uv_scale=1.0)
def _(n):
    # four oil paintings (2 x 2 atlas): landscapes and a still life, with brush strokes and canvas
    img = Image.new("RGB", (n, n))
    h = n // 2
    r = np.random.default_rng(451)
    yy, xx = np.mgrid[0:h, 0:h] / h
    for k in range(4):
        ox, oy = (k % 2) * h, (k // 2) * h
        if k < 3:
            sky_top = [rgb("7d9db8"), rgb("c98a5c"), rgb("9bb4c4")][k]
            sky_bot = [rgb("dfe0cf"), rgb("eccb8c"), rgb("ebe4cb")][k]
            hz = 0.55 + 0.05 * k
            sky = lerp(sky_top, sky_bot, np.clip(yy / hz, 0, 1))
            hill = hz + 0.06 * np.sin(xx * 2 * np.pi * (1.2 + k * 0.4) + k) + 0.03 * np.sin(xx * 17 + k)
            field = lerp(rgb(["6f8a4a", "8f6e3d", "b39e55"][k]), rgb(["455f30", "5f4226", "7a6a35"][k]), np.clip((yy - hz) / (1 - hz), 0, 1))
            rows = (np.sin(xx * 120 / (yy + 0.3)) > 0.2) & (yy > hill + 0.05)
            pic = np.where((yy > hill)[..., None], field * np.where(rows, 0.88, 1.0)[..., None], sky)
            bx = 0.25 + 0.4 * k / 3
            barn = (np.abs(xx - bx) < 0.07) & (yy > hz - 0.1 + np.abs(xx - bx) * 0.6) & (yy < hz + 0.02)
            silo = (np.abs(xx - bx - 0.11) < 0.025) & (yy > hz - 0.17) & (yy < hz + 0.02)
            pic = np.where(barn[..., None], rgb("7e2d26"), pic)
            pic = np.where(silo[..., None], rgb("a9a9a1"), pic)
        else:
            pic = lerp(rgb("343f39"), rgb("4c5a51"), yy)
            for _ in range(16):
                cx, cy, rad = r.uniform(0.3, 0.7), r.uniform(0.2, 0.5), r.uniform(0.04, 0.08)
                c = [rgb("c45a55"), rgb("e2c46a"), rgb("ede6d6"), rgb("b57fa9")][r.integers(0, 4)]
                m = (xx - cx) ** 2 + (yy - cy) ** 2 < rad ** 2
                pic = np.where(m[..., None], c, pic)
            vase = (np.abs(xx - 0.5) < 0.12 - (yy - 0.6) * 0.1) & (yy > 0.55) & (yy < 0.9)
            pic = np.where(vase[..., None], rgb("647f9c"), pic)
        stroke = spectral(h, 1.2, 452 + k, sx=4.0, sy=1.0)[..., None]
        pic = np.clip(pic * (0.9 + 0.2 * stroke), 0, 1)
        img.paste(Image.fromarray((pic * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2)), (ox, oy))
    canvas = woven(n, 300, ["ffffff"], ["eeeeee"], 459, relief=0.5)[0][..., 0]
    alb = np.asarray(img) / 255.0 * (0.9 + 0.1 * canvas[..., None])
    return alb, 0.1 * canvas + 0.1 * spectral(n, 1.2, 460, sx=4.0, sy=1.0), 0.55


@mat("farm_photo", surface="wood", uv_scale=1.0)
def _(n):
    # 3 x 3 atlas of soft family photos: people against bright, out-of-focus backgrounds
    img = Image.new("RGB", (n, n), (236, 232, 224))
    d = ImageDraw.Draw(img)
    c = n // 3
    r = np.random.default_rng(461)
    for k in range(9):
        ox, oy = (k % 3) * c, (k // 3) * c
        top = tuple(int(v) for v in r.uniform(150, 215, 3))
        d.rectangle([ox, oy, ox + c, oy + c], fill=top)
        d.rectangle([ox, oy + int(c * 0.68), ox + c, oy + c], fill=tuple(int(v * r.uniform(0.55, 0.75)) for v in top))
        people = r.integers(1, 5)
        for p in range(people):
            px = ox + int(c * (p + 1) / (people + 1))
            hh = int(c * r.uniform(0.38, 0.55))
            tp = oy + c - hh - int(c * 0.08)
            shirt = tuple(int(v) for v in r.uniform(50, 190, 3))
            skin = [(224, 186, 156), (196, 150, 118), (150, 104, 76), (236, 204, 178)][r.integers(0, 4)]
            hair = [(60, 40, 28), (140, 100, 60), (30, 24, 20), (200, 170, 110)][r.integers(0, 4)]
            d.rounded_rectangle([px - c // 9, tp + c // 20, px + c // 9, tp + hh], radius=c // 18, fill=shirt)
            d.ellipse([px - c // 15, tp - c // 7, px + c // 15, tp], fill=skin)
            d.chord([px - c // 14, tp - c // 6.5, px + c // 14, tp - c // 30], 180, 360, fill=hair)
    img = img.filter(ImageFilter.GaussianBlur(1.6))
    grain_ = band(n, 300, 512, 462)
    return np.asarray(img) / 255.0 * (0.96 + 0.06 * grain_[..., None]), np.zeros((n, n)), 0.18


# ------------------------------------------------------------------------------------------------ main
def main():
    only = None
    if "--only" in sys.argv:
        only = set(sys.argv[sys.argv.index("--only") + 1].split(","))
    os.makedirs(TEX, exist_ok=True)
    out_file = os.path.join(TEX, "farm_materials.json")
    pack = {}
    if os.path.exists(out_file):
        pack = json.load(open(out_file))
    for name, (fn, spec) in M.items():
        if only and name not in only:
            continue
        res = fn(N)
        alb, h, rough = res[0], res[1], res[2]
        metal = res[3] if len(res) > 3 else 0.0
        if alb.ndim == 3 and alb.shape[2] == 3 and alb.dtype != float:
            alb = alb.astype(float)
        pack[name] = save(name, alb, np.asarray(h, float), rough, metal, spec.get("height_strength", 6.0), spec=spec)
        print(f"{name:24s} done", flush=True)
    pack = {k: pack[k] for k in sorted(pack)}
    with open(out_file, "w") as f:
        json.dump(pack, f, indent=1)
    print(f"{len(pack)} materials -> {os.path.relpath(out_file, ROOT)}")


if __name__ == "__main__":
    main()
