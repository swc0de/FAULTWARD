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
    kx = np.fft.fftfreq(n)[None, :] * n / sx
    ky = np.fft.fftfreq(n)[:, None] * n / sy
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
M = {}


def mat(name, **spec):
    def deco(fn):
        M[name] = (fn, spec)
        return fn
    return deco


def grain(seed, n=N, stretch=18.0):
    """Wood grain along x: stretched noise plus fine fibre lines."""
    g = spectral(n, 2.2, seed, sx=stretch, sy=1.0)
    lines = 0.5 + 0.5 * np.sin((np.mgrid[0:n, 0:n][0] / n) * 2 * np.pi * 90 + g * 18)
    fib = spectral(n, 1.0, seed + 7, sx=40.0, sy=0.6)
    return np.clip(0.55 * g + 0.25 * lines + 0.2 * fib, 0, 1)


def boards(n, rows, seed, min_len=0.25, max_len=0.75, gap=2):
    """Board layout: (board id map, row index, gap mask, position-in-board) with tileable random breaks."""
    r = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:n, 0:n]
    rh = n / rows
    row = (yy // rh).astype(int)
    bid = np.zeros((n, n), int)
    gapm = np.zeros((n, n), bool)
    pos = np.zeros((n, n))
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
        pos[sel] = (u - b0) / (b1 - b0)
        d = np.minimum(u - b0, b1 - u) * n
        gapm[sel] = d < gap
        nid += len(ends)
    ry = yy % rh
    gapm |= (ry < gap) | (ry > rh - gap)
    return bid, row, gapm, pos


def tint_per(bid, seed, spread):
    r = np.random.default_rng(seed)
    t = r.uniform(-spread, spread, bid.max() + 1)
    return t[bid]


# ---- exterior
@mat("farm_siding", surface="wood", uv_scale=1.98)
def _(n):
    rows = 11
    yy = np.mgrid[0:n, 0:n][0]
    rh = n / rows
    f = (yy % rh) / rh                          # 0 at the top of a board's exposure, 1 at its bottom edge
    height = 0.35 + 0.65 * f                     # lap: thicker at the bottom of each board
    height = np.where(f > 0.96, 0.0, height)     # the shadow line under each lap
    g = grain(11, n, 30)
    height = height + 0.04 * g
    paint = rgb("f1eee6")
    alb = lerp(paint * 0.94, paint, 0.6 + 0.4 * spectral(n, 2.5, 12))
    alb = alb * (1 - 0.05 * g[..., None])
    alb = alb * np.where(f > 0.96, 0.55, 1.0)[..., None]
    alb = alb * (0.97 + 0.03 * smooth(f, 0.0, 0.25))[..., None]
    return alb, height, 0.55 + 0.1 * g


@mat("farm_trim", surface="wood", uv_scale=1.0)
def _(n):
    h = spectral(n, 3.0, 21) * 0.15 + grain(22, n, 25) * 0.05
    return lerp(rgb("f6f4ee") * 0.97, rgb("fbfaf6"), spectral(n, 2.6, 23)), h, 0.42


@mat("farm_shutter", surface="wood", uv_scale=1.0)
def _(n):
    # louvred shutter boards: horizontal slats
    yy = np.mgrid[0:n, 0:n][0]
    f = (yy % (n / 16)) / (n / 16)
    h = 1 - np.abs(f - 0.35) * 1.2 + 0.05 * grain(31, n)
    col = rgb("5f7a6a")
    alb = lerp(col * 0.9, col, spectral(n, 2.5, 32))
    alb *= (0.8 + 0.2 * np.clip(h, 0, 1))[..., None]
    return alb, h, 0.5


@mat("farm_door_red", surface="wood", uv_scale=1.0)
def _(n):
    h = spectral(n, 3.0, 41) * 0.2 + grain(42, n, 20) * 0.08
    col = rgb("8e2a26")
    return lerp(col * 0.92, col * 1.04, spectral(n, 2.4, 43)), h, 0.35


@mat("farm_shingle", surface="metal", uv_scale=2.4)
def _(n):
    rows = 12
    yy, xx = np.mgrid[0:n, 0:n]
    rh = n / rows
    row = (yy // rh).astype(int)
    f = (yy % rh) / rh
    tabs = 6
    tw = n / tabs
    xo = (xx + (row % 2) * tw / 2) % tw
    slot = (xo < 5) & (f > 0.35)
    gran = band(n, 180, 512, 51)
    r = np.random.default_rng(52)
    tint = r.uniform(-0.06, 0.06, (rows, tabs * 2 + 2))
    tid = ((xx + (row % 2) * tw / 2) // tw).astype(int)
    tt = tint[row, tid % tint.shape[1]]
    h = 0.3 + 0.7 * f - 0.6 * slot + 0.15 * gran
    base = rgb("4b4a4c")
    alb = lerp(base * 0.85, base * 1.15, gran) * (1 + tt)[..., None]
    alb *= np.where(slot | (f > 0.97), 0.5, 1.0)[..., None]
    alb *= (0.85 + 0.15 * f)[..., None]
    return alb, h, 0.9


@mat("farm_deck", surface="wood", uv_scale=2.4)
def _(n):
    bid, row, gapm, pos = boards(n, 9, 61, 0.3, 0.9, 3)
    g = grain(62, n, 26)
    t = tint_per(bid, 63, 0.05)
    col = rgb("8a8378")
    alb = lerp(col * 0.88, col * 1.06, g) * (1 + t)[..., None]
    alb = np.where(gapm[..., None], alb * 0.35, alb)
    h = np.where(gapm, 0.0, 0.8 + 0.1 * g)
    return alb, h, 0.7 + 0.1 * g


@mat("farm_brick", surface="brick", uv_scale=1.0)
def _(n):
    rows, per = 14, 4
    yy, xx = np.mgrid[0:n, 0:n]
    rh = n / rows
    row = (yy // rh).astype(int)
    bw = n / per
    xo = (xx + (row % 2) * bw / 2) % n
    mort = ((yy % rh) < 7) | ((xo % bw) < 7)
    r = np.random.default_rng(71)
    bid = row * (per + 1) + (xo // bw).astype(int)
    tint = r.uniform(-0.1, 0.1, bid.max() + 1)[bid]
    noise = spectral(n, 2.2, 72)
    fine = band(n, 150, 500, 73)
    col = lerp(rgb("8f3b2b"), rgb("b05a40"), 0.5 + tint * 3)
    alb = col * (0.85 + 0.25 * noise[..., None]) * (0.95 + 0.1 * fine[..., None])
    alb = np.where(mort[..., None], rgb("c9c2b6") * (0.9 + 0.1 * noise[..., None]), alb)
    h = np.where(mort, 0.15 + 0.1 * fine, 0.8 + 0.1 * noise + 0.05 * fine)
    h = blur(h, 1.2)
    return alb, h, np.where(mort, 0.95, 0.8)


@mat("farm_stone", surface="brick", uv_scale=2.0)
def _(n):
    f1, edge, cid = voronoi(n, 7, 81, 0.9)
    r = np.random.default_rng(82)
    tint = r.uniform(0, 1, cid.max() + 1)[cid]
    noise = spectral(n, 2.0, 83)
    mort = edge < 0.06
    dome = np.clip(edge * 6, 0, 1) ** 0.5
    h = np.where(mort, 0.05, 0.4 + 0.5 * dome + 0.15 * noise)
    stone = lerp(rgb("8b857b"), rgb("b7aa96"), tint)
    stone = lerp(stone, rgb("6f6a63"), 0.3 * (tint > 0.75))
    alb = stone * (0.82 + 0.3 * noise[..., None])
    alb = np.where(mort[..., None], rgb("c8c1b3") * (0.85 + 0.15 * noise[..., None]), alb)
    return alb, h, 0.85


@mat("farm_window_glass", surface="glass", uv_scale=1.0, opacity=0.18, roughness_scale=1)
def _(n):
    h = spectral(n, 3.5, 91) * 0.03
    return lerp(rgb("cfd8dc"), rgb("e4eaec"), spectral(n, 2.5, 92)), h, 0.05


# ---- interior surfaces
@mat("farm_oak_floor", surface="wood", uv_scale=2.4)
def _(n):
    bid, row, gapm, pos = boards(n, 14, 101, 0.22, 0.6, 2)
    g = grain(102, n, 22)
    t = tint_per(bid, 103, 0.09)
    knots = np.clip(band(n, 6, 14, 104) - 0.82, 0, 1) * 3
    light, dark = rgb("c99b63"), rgb("9c6b3c")
    alb = lerp(dark, light, np.clip(0.55 * g + 0.45 + t * 2, 0, 1)) * (1 - 0.35 * knots)[..., None]
    alb = np.where(gapm[..., None], alb * 0.45, alb)
    h = np.where(gapm, 0.1, 0.75 + 0.08 * g)
    return alb, h, 0.38 + 0.12 * g


def plaster(color, seed):
    a = spectral(N, 2.8, seed)
    b = band(N, 60, 300, seed + 1)
    alb = lerp(rgb(color) * 0.95, rgb(color) * 1.02, a) * (0.985 + 0.03 * b[..., None])
    h = a * 0.12 + b * 0.05
    return alb, h, 0.86


@mat("farm_wall_cream", surface="plaster", uv_scale=2.5)
def _(n):
    return plaster("ece3d0", 111)


@mat("farm_wall_sage", surface="plaster", uv_scale=2.5)
def _(n):
    return plaster("b9c4aa", 112)


@mat("farm_wall_blue", surface="plaster", uv_scale=2.5)
def _(n):
    return plaster("b8c9d4", 113)


@mat("farm_wall_rose", surface="plaster", uv_scale=2.5)
def _(n):
    return plaster("e3c8bd", 114)


@mat("farm_ceiling", surface="plaster", uv_scale=3.0)
def _(n):
    return plaster("f7f5ef", 115)


@mat("farm_wallpaper_floral", surface="plaster", uv_scale=0.8)
def _(n):
    img = Image.new("RGB", (n, n), (237, 228, 206))
    d = ImageDraw.Draw(img)
    r = np.random.default_rng(121)
    # pin stripes
    for i in range(8):
        x = i * n // 8
        d.rectangle([x, 0, x + 3, n], fill=(214, 200, 172))
    # sprigs between the stripes, half-drop pattern (tileable: wrap by drawing at offsets)
    for i in range(8):
        for j in range(4):
            cx = (i + 0.5) * n / 8
            cy = (j + (0.5 if i % 2 else 0.0) + 0.25) * n / 4
            for ox in (-n, 0, n):
                for oy in (-n, 0, n):
                    x, y = cx + ox, cy + oy
                    d.line([x, y + 40, x + 4, y - 30], fill=(112, 134, 96), width=4)
                    for (lx, ly) in ((-16, 6), (18, -6), (-12, -18)):
                        d.ellipse([x + lx - 9, y + ly - 5, x + lx + 9, y + ly + 5], fill=(124, 148, 104))
                    for (fx, fy, c) in ((0, -36, (196, 104, 104)), (-14, -24, (214, 150, 140)), (14, -26, (196, 120, 120))):
                        d.ellipse([x + fx - 10, y + fy - 10, x + fx + 10, y + fy + 10], fill=c)
                        d.ellipse([x + fx - 4, y + fy - 4, x + fx + 4, y + fy + 4], fill=(236, 210, 150))
    alb = np.asarray(img.filter(ImageFilter.GaussianBlur(0.8))) / 255.0
    alb = alb * (0.97 + 0.03 * spectral(n, 2.5, 122)[..., None])
    h = 0.05 * spectral(n, 2.5, 123) + 0.03 * band(n, 200, 500, 124)
    return alb, h, 0.8


@mat("farm_wallpaper_stripe", surface="plaster", uv_scale=1.2)
def _(n):
    xx = np.mgrid[0:n, 0:n][1] / n
    s = (np.sin(xx * 2 * np.pi * 12) > 0.35).astype(float)
    t = (np.sin(xx * 2 * np.pi * 12 + 2.2) > 0.9).astype(float)
    base = rgb("e8e4d8")
    alb = lerp(base, rgb("9db3c4"), blur(s, 1.2) * 0.75)
    alb = lerp(alb, rgb("f5f2ea"), blur(t, 1.0) * 0.8)
    alb *= (0.98 + 0.03 * spectral(n, 2.5, 131))[..., None]
    return alb, 0.04 * spectral(n, 2.5, 132), 0.8


def tiles(n, cols, rows, seed, color, color2=None, grout="dcd8cf", gw=5, bevel=10, offset=False, checker=False):
    yy, xx = np.mgrid[0:n, 0:n]
    th, tw = n / rows, n / cols
    row = (yy // th).astype(int)
    xs = (xx + (row % 2) * tw / 2) % n if offset else xx
    col = (xs // tw).astype(int)
    fx = (xs % tw)
    fy = (yy % th)
    dist = np.minimum(np.minimum(fx, tw - fx), np.minimum(fy, th - fy))
    grout_m = dist < gw / 2
    h = np.clip((dist - gw / 2) / bevel, 0, 1) ** 0.6
    r = np.random.default_rng(seed)
    tint = r.uniform(-0.03, 0.03, (rows + 1, cols + 2))[row, col % (cols + 2)]
    c1 = rgb(color)
    base = c1[None, None, :] * np.ones((n, n, 1))
    if checker and color2:
        base = np.where(((row + col) % 2 == 0)[..., None], c1, rgb(color2))
    alb = base * (1 + tint)[..., None] * (0.97 + 0.04 * spectral(n, 2.5, seed + 1)[..., None])
    alb = np.where(grout_m[..., None], rgb(grout) * (0.9 + 0.1 * spectral(n, 2, seed + 2)[..., None]), alb)
    rough = np.where(grout_m, 0.9, 0.12 + 0.05 * spectral(n, 2, seed + 3))
    return alb, h + 0.02 * band(n, 100, 400, seed + 4), rough


@mat("farm_tile_subway", surface="tile", uv_scale=0.6)
def _(n):
    return tiles(n, 4, 8, 141, "f2f1ec", offset=True)


@mat("farm_tile_checker", surface="tile", uv_scale=0.6)
def _(n):
    return tiles(n, 4, 4, 151, "efede6", "2d3236", grout="bdb8ad", checker=True)


@mat("farm_tile_hex", surface="tile", uv_scale=0.5)
def _(n):
    f1, edge, cid = voronoi(n, 12, 161, 0.0)
    grout_m = edge < 0.08
    h = np.clip((edge - 0.04) * 8, 0, 1) ** 0.6
    alb = np.where(grout_m[..., None], rgb("c9c5bc"), rgb("f4f2ec") * (0.97 + 0.04 * spectral(n, 2.5, 162)[..., None]))
    return alb, h, np.where(grout_m, 0.9, 0.12)


def paint_wood(color, seed, rough=0.42):
    g = grain(seed, N, 24)
    alb = lerp(rgb(color) * 0.95, rgb(color) * 1.03, spectral(N, 2.6, seed + 1)) * (1 - 0.025 * g[..., None])
    return alb, 0.06 * g + 0.05 * spectral(N, 3, seed + 2), rough


@mat("farm_cabinet_white", surface="wood", uv_scale=1.0)
def _(n):
    return paint_wood("f3f1ea", 171)


@mat("farm_cabinet_sage", surface="wood", uv_scale=1.0)
def _(n):
    return paint_wood("8fa18a", 172)


@mat("farm_cabinet_navy", surface="wood", uv_scale=1.0)
def _(n):
    return paint_wood("2f3d52", 173)


@mat("farm_butcher_block", surface="wood", uv_scale=1.2)
def _(n):
    xx = np.mgrid[0:n, 0:n][1]
    strips = 16
    sid = (xx // (n / strips)).astype(int)
    g = grain(181, n, 0.05) if False else spectral(n, 2.2, 181, sx=1.0, sy=24.0)
    r = np.random.default_rng(182)
    t = r.uniform(-0.12, 0.12, strips)[sid]
    seam = (xx % (n / strips)) < 2
    alb = lerp(rgb("9b6a3c"), rgb("d6a66f"), np.clip(0.5 + t * 2 + 0.4 * (g - 0.5), 0, 1))
    alb = np.where(seam[..., None], alb * 0.8, alb)
    return alb, 0.08 * g, 0.5


@mat("farm_quartz", surface="tile", uv_scale=1.6)
def _(n):
    yy, xx = np.mgrid[0:n, 0:n] / n
    turb = spectral(n, 2.0, 191)
    v = np.abs(np.sin((xx * 2 + yy) * 2 * np.pi + turb * 9))
    vein = np.clip(1 - v * 14, 0, 1) * 0.5 + np.clip(1 - np.abs(np.sin((xx - yy * 2) * 2 * np.pi * 2 + spectral(n, 2.2, 192) * 12)) * 20, 0, 1) * 0.25
    alb = lerp(rgb("f4f3f0"), rgb("9ea3a6"), vein)
    alb *= (0.98 + 0.03 * spectral(n, 2.5, 193))[..., None]
    return alb, 0.01 * turb, 0.1


@mat("farm_carpet", surface="fabric", uv_scale=1.5)
def _(n):
    f = band(n, 250, 512, 201)
    g = spectral(n, 2.0, 202)
    alb = lerp(rgb("b9ad99"), rgb("cfc4b1"), 0.6 * f + 0.4 * g)
    return alb, 0.6 * f + 0.3 * g, 0.97


# ---- furniture and soft furnishings
def weave(n, color, color2, seed, warp=256, rough=0.85, contrast=0.25):
    yy, xx = np.mgrid[0:n, 0:n] / n
    a = np.sin(xx * 2 * np.pi * warp) * 0.5 + 0.5
    b = np.sin(yy * 2 * np.pi * warp) * 0.5 + 0.5
    checker = (np.sin(xx * 2 * np.pi * warp / 2) * np.sin(yy * 2 * np.pi * warp / 2)) > 0
    h = np.where(checker, a, b)
    slub = spectral(n, 1.6, seed, sx=1.0, sy=12.0) * 0.6 + spectral(n, 1.6, seed + 1, sx=12.0, sy=1.0) * 0.4
    alb = lerp(rgb(color), rgb(color2), np.clip(slub + (h - 0.5) * contrast, 0, 1))
    return alb, 0.5 * h + 0.3 * slub, rough


@mat("farm_linen", surface="fabric", uv_scale=0.6)
def _(n):
    return weave(n, "cfc6b4", "e3dccb", 211)


@mat("farm_tweed", surface="fabric", uv_scale=0.5)
def _(n):
    a, h, r = weave(n, "5d6f78", "8a9aa0", 221, warp=200, contrast=0.6)
    fleck = (band(n, 300, 512, 222) > 0.82)
    a = np.where(fleck[..., None], rgb("c9c3b5"), a)
    return a, h, 0.92


@mat("farm_velvet_green", surface="fabric", uv_scale=0.8)
def _(n):
    g = spectral(n, 1.8, 231)
    return lerp(rgb("2f4a3a"), rgb("4c6d57"), g), 0.2 * g + 0.2 * band(n, 300, 512, 232), 0.75


@mat("farm_leather", surface="fabric", uv_scale=0.6)
def _(n):
    f1, edge, cid = voronoi(n, 40, 241, 0.9)
    crease = np.clip(1 - edge * 5, 0, 1)
    g = spectral(n, 2.2, 242)
    alb = lerp(rgb("5a3420"), rgb("8a5634"), 0.6 * g + 0.4 * (1 - crease)) * (1 - 0.15 * crease)[..., None]
    return alb, 0.6 - 0.4 * crease + 0.2 * g, 0.45 + 0.2 * crease


@mat("farm_walnut", surface="wood", uv_scale=1.0)
def _(n):
    g = grain(251, n, 16)
    fig = spectral(n, 2.5, 252, sx=4.0, sy=1.0)
    alb = lerp(rgb("3f2717"), rgb("7a5130"), np.clip(0.6 * g + 0.5 * fig - 0.1, 0, 1))
    return alb, 0.08 * g, 0.35 + 0.1 * g


@mat("farm_pine", surface="wood", uv_scale=1.0)
def _(n):
    g = grain(261, n, 14)
    rings = 0.5 + 0.5 * np.sin(spectral(n, 2.4, 262, sx=6, sy=1) * 40)
    alb = lerp(rgb("c48f55"), rgb("e7c08a"), np.clip(0.5 * g + 0.5 * rings, 0, 1))
    return alb, 0.06 * g, 0.5


@mat("farm_bedding", surface="fabric", uv_scale=0.5)
def _(n):
    return weave(n, "eeece6", "fbfaf6", 271, warp=300, contrast=0.12)


@mat("farm_quilt", surface="fabric", uv_scale=1.0)
def _(n):
    k = 8
    yy, xx = np.mgrid[0:n, 0:n]
    cid = (yy // (n / k)) * k + (xx // (n / k))
    pal = np.array([rgb(c) for c in ("b5524a", "e9dcc2", "6b8aa3", "d9a95b", "7f9a72", "f2ece0", "a3655f", "c9b48f")])
    r = np.random.default_rng(281)
    col = pal[r.integers(0, len(pal), k * k)][cid.astype(int)]
    fx, fy = (xx % (n / k)) / (n / k), (yy % (n / k)) / (n / k)
    seam = (np.minimum(np.minimum(fx, 1 - fx), np.minimum(fy, 1 - fy)) < 0.02)
    stitch = (np.abs(fx - fy) < 0.008) | (np.abs(fx + fy - 1) < 0.008)
    tex = weave(n, "000000", "ffffff", 282, warp=320, contrast=0.4)[0][..., 0]
    alb = col * (0.93 + 0.1 * tex[..., None])
    alb = np.where(stitch[..., None], alb * 1.15, alb)
    h = np.where(seam, 0.1, 0.7) + 0.2 * blur((~seam).astype(float), 6)
    return np.where(seam[..., None], alb * 0.75, alb), h, 0.9


@mat("farm_curtain", surface="fabric", uv_scale=0.7)
def _(n):
    return weave(n, "e6dcc8", "f3ecdf", 291, warp=220, contrast=0.15)


@mat("farm_gingham", surface="fabric", uv_scale=0.3)
def _(n):
    yy, xx = np.mgrid[0:n, 0:n] / n
    a = (np.sin(xx * 2 * np.pi * 8) > 0).astype(float)
    b = (np.sin(yy * 2 * np.pi * 8) > 0).astype(float)
    alb = lerp(rgb("f5f2ec"), rgb("b34a43"), 0.45 * a + 0.45 * b)
    w = weave(n, "000000", "ffffff", 301, warp=256, contrast=0.4)[0][..., 0]
    return alb * (0.94 + 0.08 * w[..., None]), 0.4 * w, 0.88


@mat("farm_towel", surface="fabric", uv_scale=0.4)
def _(n):
    f = band(n, 200, 512, 311)
    return lerp(rgb("8fb2c4"), rgb("b4cfdb"), f), 0.8 * f, 0.98


@mat("farm_rug_red", surface="fabric", uv_scale=1.0)
def _(n):
    # a whole rug (fit to the rug, not tiled): border bands, field and a medallion
    yy, xx = np.mgrid[0:n, 0:n] / n
    dx, dy = np.abs(xx - 0.5) * 2, np.abs(yy - 0.5) * 2
    d = np.maximum(dx, dy)
    alb = np.ones((n, n, 3)) * rgb("8c2f2a")
    alb = np.where((d > 0.86)[..., None], rgb("2f3a52"), alb)
    alb = np.where(((d > 0.9) & (d < 0.93))[..., None], rgb("d8c39a"), alb)
    alb = np.where(((d > 0.8) & (d < 0.83))[..., None], rgb("d8c39a"), alb)
    md = np.abs(xx - 0.5) + np.abs(yy - 0.5)
    alb = np.where((md < 0.3)[..., None], rgb("2f3a52"), alb)
    alb = np.where((md < 0.22)[..., None], rgb("c9a35e"), alb)
    alb = np.where((md < 0.12)[..., None], rgb("8c2f2a"), alb)
    motif = (np.sin(xx * 2 * np.pi * 14) * np.sin(yy * 2 * np.pi * 14) > 0.6) & (d < 0.78) & (md > 0.32)
    alb = np.where(motif[..., None], rgb("b85a45"), alb)
    pile = band(n, 250, 512, 321)
    alb = alb * (0.88 + 0.2 * pile[..., None])
    return alb, 0.5 * pile, 0.98


@mat("farm_rug_braid", surface="fabric", uv_scale=1.0)
def _(n):
    yy, xx = np.mgrid[0:n, 0:n] / n
    rr = np.sqrt(((xx - 0.5) * 2) ** 2 + ((yy - 0.5) * 2) ** 2)
    ring = (rr * 22) % 1
    ang = np.arctan2(yy - 0.5, xx - 0.5)
    braid = 0.5 + 0.5 * np.sin(ang * 60 + rr * 140)
    pal = np.array([rgb(c) for c in ("6d7f8c", "c4b393", "8b4a3f", "e2d8c3", "4f5d4a")])
    cid = ((rr * 22).astype(int)) % len(pal)
    alb = pal[cid] * (0.85 + 0.2 * braid[..., None])
    h = np.sin(ring * np.pi) * 0.7 + 0.2 * braid
    return alb, h, 0.95


@mat("farm_brass", surface="metal", uv_scale=0.5)
def _(n):
    g = spectral(n, 2.4, 331)
    return lerp(rgb("b08a3e"), rgb("d8b56a"), g), 0.02 * g, 0.28 + 0.12 * g, 1.0


@mat("farm_iron", surface="metal", uv_scale=0.5)
def _(n):
    g = spectral(n, 2.4, 341)
    return lerp(rgb("1e1f21"), rgb("35373a"), g), 0.05 * g, 0.55, 0.85


@mat("farm_chrome", surface="metal", uv_scale=0.5)
def _(n):
    g = spectral(n, 2.6, 351)
    return lerp(rgb("cfd3d6"), rgb("eef0f2"), g), 0.0 * g, 0.08, 1.0


@mat("farm_steel", surface="metal", uv_scale=0.5)
def _(n):
    brushed = spectral(n, 1.5, 361, sx=40.0, sy=1.0)
    return lerp(rgb("a9adb0"), rgb("c9cdd0"), brushed), 0.02 * brushed, 0.3 + 0.1 * brushed, 1.0


@mat("farm_ceramic", surface="tile", uv_scale=0.5)
def _(n):
    g = spectral(n, 3.0, 371)
    return lerp(rgb("f1f0ec"), rgb("fbfaf7"), g), 0.01 * g, 0.08


@mat("farm_mirror", surface="glass", uv_scale=0.5)
def _(n):
    return np.ones((n, n, 3)) * rgb("dfe3e6"), np.zeros((n, n)), 0.02, 1.0


@mat("farm_plastic_black", surface="metal", uv_scale=0.5)
def _(n):
    g = spectral(n, 2.5, 381)
    return lerp(rgb("161718"), rgb("222426"), g), 0.02 * band(n, 200, 500, 382), 0.4


@mat("farm_screen", surface="glass", uv_scale=1.0)
def _(n):
    yy = np.mgrid[0:n, 0:n][0] / n
    return lerp(rgb("0d0f12"), rgb("1b2128"), yy), np.zeros((n, n)), 0.06


@mat("farm_terracotta", surface="brick", uv_scale=0.5)
def _(n):
    g = spectral(n, 2.2, 391)
    return lerp(rgb("a4532f"), rgb("c87447"), g), 0.1 * g + 0.05 * band(n, 200, 500, 392), 0.85


@mat("farm_leaf", surface="fabric", uv_scale=0.4)
def _(n):
    yy, xx = np.mgrid[0:n, 0:n] / n
    vein = np.clip(1 - np.abs(np.sin(xx * 2 * np.pi * 6)) * 30, 0, 1) + np.clip(1 - np.abs(np.sin((xx + yy * 0.8) * 2 * np.pi * 18)) * 25, 0, 1) * 0.4
    g = spectral(n, 2.4, 401)
    alb = lerp(rgb("2f5a2a"), rgb("4f8540"), g) * (1 + 0.18 * vein[..., None])
    return alb, 0.2 * vein, 0.5


@mat("farm_fruit", surface="fabric", uv_scale=0.2)
def _(n):
    f1, edge, cid = voronoi(n, 60, 411, 0.9)
    pores = np.clip(1 - f1 * 3, 0, 1)
    g = spectral(n, 2.4, 412)
    return lerp(rgb("e0731c"), rgb("f39a2c"), g) * (1 - 0.1 * pores[..., None]), 0.3 * (1 - pores), 0.4


@mat("farm_apple", surface="fabric", uv_scale=0.2)
def _(n):
    g = spectral(n, 2.0, 421, sx=1, sy=6)
    return lerp(rgb("8f1d1a"), rgb("c8402e"), g), 0.02 * g, 0.35


@mat("farm_lampshade", surface="fabric", uv_scale=0.4)
def _(n):
    return weave(n, "efe6d2", "fbf6ea", 431, warp=200, contrast=0.1)


@mat("farm_bulb", surface="glass", uv_scale=0.2)
def _(n):
    return np.ones((n, n, 3)) * rgb("fff4dc"), np.zeros((n, n)), 0.2


@mat("farm_books", surface="wood", uv_scale=1.0)
def _(n):
    # 16 book spines across the texture: a book picks one by its u offset
    img = Image.new("RGB", (n, n))
    d = ImageDraw.Draw(img)
    pal = [(122, 38, 34), (36, 58, 90), (44, 78, 52), (196, 168, 108), (92, 62, 40), (162, 92, 50), (60, 60, 64), (140, 120, 90),
           (180, 60, 50), (70, 98, 120), (210, 200, 180), (100, 40, 70), (50, 90, 80), (190, 140, 60), (30, 30, 34), (150, 150, 140)]
    w = n // 16
    r = np.random.default_rng(441)
    for i, c in enumerate(pal):
        x0 = i * w
        d.rectangle([x0, 0, x0 + w, n], fill=c)
        dark = tuple(int(v * 0.7) for v in c)
        for b in r.uniform(0.08, 0.92, 3):
            y = int(b * n)
            d.rectangle([x0 + 3, y, x0 + w - 3, y + 10], fill=(214, 186, 118))
        d.rectangle([x0 + w // 4, int(0.35 * n), x0 + 3 * w // 4, int(0.55 * n)], fill=dark)
        d.line([x0, 0, x0, n], fill=(20, 20, 20), width=2)
    alb = np.asarray(img) / 255.0 * (0.92 + 0.1 * spectral(n, 2.5, 442)[..., None])
    return alb, 0.05 * spectral(n, 2.5, 443), 0.6


@mat("farm_art", surface="wood", uv_scale=1.0)
def _(n):
    # four small paintings (2 x 2 atlas): farm landscapes, a sunset, a still life of flowers
    img = Image.new("RGB", (n, n))
    h = n // 2
    r = np.random.default_rng(451)
    yy, xx = np.mgrid[0:h, 0:h] / h
    for k in range(4):
        ox, oy = (k % 2) * h, (k // 2) * h
        if k < 3:
            sky_top = [rgb("7aa6c9"), rgb("e9a36b"), rgb("9fc3d8")][k]
            sky_bot = [rgb("e8ecd8"), rgb("f3d58f"), rgb("f4ecd2")][k]
            hz = 0.55 + 0.05 * k
            sky = lerp(sky_top, sky_bot, yy / hz)
            hill = hz + 0.06 * np.sin(xx * 2 * np.pi * (1.2 + k * 0.4) + k) + 0.03 * np.sin(xx * 17 + k)
            field = lerp(rgb(["7d9a52", "a1793f", "c7b25b"][k]), rgb(["4e6b34", "6b4a28", "8a7a3a"][k]), (yy - hz) / (1 - hz))
            rows = (np.sin(xx * 120 / (yy + 0.3)) > 0.2) & (yy > hill + 0.05)
            pic = np.where((yy > hill)[..., None], field * np.where(rows, 0.85, 1.0)[..., None], sky)
            # a barn and a silo on the horizon
            bx = 0.25 + 0.4 * k / 3
            barn = (np.abs(xx - bx) < 0.07) & (yy > hz - 0.1 + np.abs(xx - bx) * 0.6) & (yy < hz + 0.02)
            silo = (np.abs(xx - bx - 0.11) < 0.025) & (yy > hz - 0.17) & (yy < hz + 0.02)
            pic = np.where(barn[..., None], rgb("8e2f28"), pic)
            pic = np.where(silo[..., None], rgb("b9b9b0"), pic)
        else:
            pic = lerp(rgb("3c4a43"), rgb("56665c"), yy)
            for _ in range(14):
                cx, cy, rad = r.uniform(0.3, 0.7), r.uniform(0.2, 0.5), r.uniform(0.04, 0.08)
                c = [rgb("d65f5f"), rgb("f2d16b"), rgb("f3efe4"), rgb("c77fb5")][r.integers(0, 4)]
                m = (xx - cx) ** 2 + (yy - cy) ** 2 < rad ** 2
                pic = np.where(m[..., None], c, pic)
            vase = (np.abs(xx - 0.5) < 0.12 - (yy - 0.6) * 0.1) & (yy > 0.55) & (yy < 0.9)
            pic = np.where(vase[..., None], rgb("6c88a8"), pic)
        stroke = spectral(h, 1.4, 452 + k)[..., None]
        pic = np.clip(pic * (0.9 + 0.2 * stroke), 0, 1)
        img.paste(Image.fromarray((pic * 255).astype(np.uint8)), (ox, oy))
    alb = np.asarray(img) / 255.0
    return alb, 0.08 * spectral(n, 1.6, 459), 0.6


@mat("farm_photo", surface="wood", uv_scale=1.0)
def _(n):
    # 3 x 3 atlas of soft "family photos": silhouettes of people against bright backgrounds
    img = Image.new("RGB", (n, n), (240, 236, 228))
    d = ImageDraw.Draw(img)
    c = n // 3
    r = np.random.default_rng(461)
    for k in range(9):
        ox, oy = (k % 3) * c, (k // 3) * c
        bg = tuple(int(v) for v in r.uniform(140, 230, 3))
        d.rectangle([ox, oy, ox + c, oy + c], fill=bg)
        d.rectangle([ox, oy + int(c * 0.7), ox + c, oy + c], fill=tuple(int(v * 0.7) for v in bg))
        people = r.integers(1, 5)
        for p in range(people):
            px = ox + int(c * (p + 1) / (people + 1))
            hh = int(c * r.uniform(0.35, 0.55))
            top = oy + c - hh - int(c * 0.08)
            shirt = tuple(int(v) for v in r.uniform(40, 200, 3))
            d.ellipse([px - c // 16, top - c // 8, px + c // 16, top], fill=(214, 172, 140))
            d.rounded_rectangle([px - c // 10, top, px + c // 10, top + hh], radius=c // 20, fill=shirt)
    img = img.filter(ImageFilter.GaussianBlur(2.2))
    return np.asarray(img) / 255.0, np.zeros((n, n)), 0.25


# ---- yard and scenery
@mat("farm_lawn", surface="dirt", uv_scale=2.0)
def _(n):
    blades = band(n, 220, 512, 471)
    clumps = spectral(n, 2.0, 472)
    patch = spectral(n, 3.2, 473)
    alb = lerp(rgb("4c6b2c"), rgb("7d9a43"), np.clip(0.5 * blades + 0.4 * clumps + 0.2 * patch - 0.05, 0, 1))
    alb = lerp(alb, rgb("8a8a4a"), np.clip(patch - 0.75, 0, 1) * 1.5)
    return alb, 0.6 * blades + 0.3 * clumps, 0.9


@mat("farm_gravel", surface="gravel", uv_scale=1.6)
def _(n):
    f1, edge, cid = voronoi(n, 46, 481, 0.9)
    r = np.random.default_rng(482)
    t = r.uniform(0, 1, cid.max() + 1)[cid]
    stone = np.clip(edge * 4, 0, 1) ** 0.5
    alb = lerp(rgb("8d877c"), rgb("cfc8ba"), t) * (0.6 + 0.4 * stone[..., None])
    return alb, stone, 0.85


@mat("farm_flagstone", surface="brick", uv_scale=2.4)
def _(n):
    f1, edge, cid = voronoi(n, 5, 491, 0.8)
    r = np.random.default_rng(492)
    t = r.uniform(0, 1, cid.max() + 1)[cid]
    g = spectral(n, 2.2, 493)
    joint = edge < 0.05
    alb = lerp(rgb("8f8a80"), rgb("b4a993"), t) * (0.85 + 0.25 * g[..., None])
    alb = np.where(joint[..., None], rgb("5d6b38") * (0.8 + 0.3 * g[..., None]), alb)
    h = np.where(joint, 0.0, 0.7 + 0.2 * g)
    return alb, blur(h, 1.5), 0.8


@mat("farm_mulch", surface="dirt", uv_scale=1.2)
def _(n):
    chips = spectral(n, 1.2, 501, sx=3.0, sy=1.0) * 0.5 + spectral(n, 1.2, 502, sx=1.0, sy=3.0) * 0.5
    alb = lerp(rgb("3d2618"), rgb("7a4b2c"), chips)
    return alb, chips, 0.9


@mat("farm_soil", surface="dirt", uv_scale=3.0)
def _(n):
    g = spectral(n, 2.0, 511)
    clod = band(n, 80, 300, 512)
    return lerp(rgb("4e3a28"), rgb("7a5e43"), 0.6 * g + 0.4 * clod), 0.5 * clod + 0.3 * g, 0.95


@mat("farm_asphalt", surface="concrete", uv_scale=3.0)
def _(n):
    agg = band(n, 200, 512, 521)
    g = spectral(n, 2.0, 522)
    return lerp(rgb("2c2d2f"), rgb("4a4b4d"), 0.6 * agg + 0.4 * g), 0.3 * agg, 0.85


@mat("farm_hedge", surface="fabric", uv_scale=1.4)
def _(n):
    f1, edge, cid = voronoi(n, 50, 531, 0.9)
    leaf = np.clip(edge * 5, 0, 1)
    r = np.random.default_rng(532)
    t = r.uniform(0, 1, cid.max() + 1)[cid]
    g = spectral(n, 2.0, 533)
    alb = lerp(rgb("203d1c"), rgb("4d7a36"), 0.5 * t + 0.5 * g) * (0.55 + 0.45 * leaf[..., None])
    return alb, leaf * 0.8 + 0.2 * g, 0.75


@mat("farm_corn_leaf", surface="fabric", uv_scale=0.6)
def _(n):
    yy, xx = np.mgrid[0:n, 0:n] / n
    vein = np.clip(1 - np.abs(np.sin(xx * 2 * np.pi * 20)) * 12, 0, 1)
    g = spectral(n, 2.0, 541, sx=1, sy=8)
    return lerp(rgb("5c8a3a"), rgb("8cb357"), 0.7 * g + 0.3 * vein), 0.2 * vein, 0.6


@mat("farm_wheat", surface="fabric", uv_scale=0.6)
def _(n):
    g = spectral(n, 2.0, 551, sx=1, sy=10)
    stalk = band(n, 150, 400, 552)
    return lerp(rgb("b8954f"), rgb("e4c98a"), 0.6 * g + 0.4 * stalk), 0.4 * stalk, 0.8


@mat("farm_barn_red", surface="wood", uv_scale=2.0)
def _(n):
    xx = np.mgrid[0:n, 0:n][1]
    seam = (xx % (n / 8)) < 4
    g = grain(561, n, 0.05) if False else spectral(n, 2.2, 561, sx=1, sy=20)
    alb = lerp(rgb("7d241f"), rgb("a43a2f"), g)
    alb = np.where(seam[..., None], alb * 0.5, alb)
    return alb, np.where(seam, 0, 0.8) + 0.1 * g, 0.8


@mat("farm_galvanized", surface="metal", uv_scale=1.6)
def _(n):
    f1, edge, cid = voronoi(n, 24, 571, 0.9)
    r = np.random.default_rng(572)
    t = r.uniform(0, 1, cid.max() + 1)[cid]
    xx = np.mgrid[0:n, 0:n][1] / n
    corr = 0.5 + 0.5 * np.sin(xx * 2 * np.pi * 24)
    return lerp(rgb("9da2a5"), rgb("c7cbcd"), 0.6 * t + 0.4 * corr), corr, 0.4, 0.9


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
