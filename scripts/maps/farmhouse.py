#!/usr/bin/env python3
"""Generates data/maps/farmhouse.json: Hollister Farm, one big two-storey family farmhouse in a 70 x 70 m yard.

    python3 scripts/maps/farmhouse.py && node scripts/bake-map.mjs farmhouse

x east, y north, z up, metres. The house is 34 x 23 m (x -17..17, y -8..15). Attackers spawn at the south end of
the yard (the driveway gate and the garden gate), defenders upstairs. Site A = dining room + kitchen (east half of
the ground floor), site B = living room + family room (west half). Three staircases: the main stair in the foyer,
the back stair in the mudroom and an outside stair to a deck and the guest room.

"pieces" is what the game builds (collision, sites, spawns...). "visual_pieces" (furniture, trim, windows, yard,
scenery) is drawn into the map geometry by scripts/bake-map.mjs with the prefabs in scripts/bake/. Collision-only
boxes use the material farm_invisible, which the baker does not draw.
"""
import json, math, os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "data", "maps", "farmhouse.json")
P, V = [], []
R = lambda v: round(v, 3)
r3 = lambda p: [R(c) for c in p]
INV = "farm_invisible"


# ----------------------------------------------------------------------------------------------- helpers
def box(base, size, mat, heading=0.0, collide=True, occlude=True, surface=None, hpr=None):
    e = {"type": "box", "base": r3(base), "size": r3(size), "mat": mat}
    if hpr is not None:
        e["hpr"] = r3(hpr)
    elif heading:
        e["heading"] = R(heading)
    if not collide:
        e["collide"] = False
    if not occlude:
        e["occlude"] = False
    if surface:
        e["surface"] = surface
    P.append(e)


def cbox(center, size, mat, hpr=(0, 0, 0), collide=True, occlude=True, surface=None):
    e = {"type": "box", "pos": r3(center), "size": r3(size), "mat": mat, "hpr": r3(hpr)}
    if not collide:
        e["collide"] = False
    if not occlude:
        e["occlude"] = False
    if surface:
        e["surface"] = surface
    P.append(e)


def solid(base, size, heading=0.0, surface="wood", occlude=False):
    """An invisible collider (drawn by nothing): furniture, railings, hedges."""
    box(base, size, INV, heading, occlude=occlude, surface=surface)


def vbox(base, size, mat, heading=0.0, hpr=None):
    e = {"type": "visual_box", "base": r3(base), "size": r3(size), "mat": mat}
    if hpr is not None:
        e["hpr"] = r3(hpr)
    elif heading:
        e["heading"] = R(heading)
    V.append(e)


def vcbox(center, size, mat, hpr=(0, 0, 0)):
    V.append({"type": "visual_box", "pos": r3(center), "size": r3(size), "mat": mat, "hpr": r3(hpr)})


def vcyl(pos, radius, height, mat, hpr=(0, 0, 0), segments=20, caps=True):
    V.append({"type": "visual_cylinder", "pos": r3(pos), "radius": R(radius), "height": R(height), "mat": mat, "hpr": r3(hpr), "segments": segments, "caps": caps})


def floor(x0, y0, x1, y1, z, t, mat, collide=True, occlude=True):
    e = {"type": "floor", "min": [R(x0), R(y0)], "max": [R(x1), R(y1)], "z": R(z), "thickness": R(t), "mat": mat}
    if not collide:
        e["collide"] = False
    if not occlude:
        e["occlude"] = False
    P.append(e)


def vfloor(x0, y0, x1, y1, z, mat, t=0.012):
    """A visual floor or ceiling finish (top at z)."""
    vbox([(x0 + x1) / 2, (y0 + y1) / 2, z - t], [x1 - x0, y1 - y0, t], mat)


def piece(t, base, heading=0.0, **kw):
    V.append({"type": t, "base": r3(base), "heading": R(heading), **kw})


def rot(lx, ly, hd):
    a = math.radians(hd)
    return lx * math.cos(a) - ly * math.sin(a), lx * math.sin(a) + ly * math.cos(a)


def light(pos, kelvin=2800, intensity=6, rng=8):
    # interiors are lit warm and generously: a lived-in home in the evening light
    P.append({"type": "light", "pos": r3(pos), "kind": "point", "fixture": "none", "kelvin": kelvin, "intensity": R(intensity * 1.5), "range": R(rng * 1.15), "shadows": False})


def callout(name, x0, y0, x1, y1):
    P.append({"type": "callout", "name": name, "min": [R(x0), R(y0)], "max": [R(x1), R(y1)]})


def subtract_spans(lo, hi, gaps):
    spans = [(lo, hi)]
    for g0, g1 in gaps:
        out = []
        for a, b in spans:
            if g1 <= a or g0 >= b:
                out.append((a, b))
                continue
            if g0 > a:
                out.append((a, g0))
            if g1 < b:
                out.append((g1, b))
        spans = out
    return [s for s in spans if s[1] - s[0] > 1e-3]


def subtract_rects(rect, holes):
    rects = [rect]
    for hx0, hy0, hx1, hy1 in holes:
        out = []
        for x0, y0, x1, y1 in rects:
            if hx1 <= x0 or hx0 >= x1 or hy1 <= y0 or hy0 >= y1:
                out.append((x0, y0, x1, y1))
                continue
            if hy0 > y0:
                out.append((x0, y0, x1, hy0))
            if hy1 < y1:
                out.append((x0, hy1, x1, y1))
            my0, my1 = max(y0, hy0), min(y1, hy1)
            if hx0 > x0:
                out.append((x0, my0, hx0, my1))
            if hx1 < x1:
                out.append((hx1, my0, x1, my1))
        rects = out
    return [r for r in rects if r[2] - r[0] > 1e-3 and r[3] - r[1] > 1e-3]


# ========================================================================================== the house
X0, X1, Y0, Y1 = -17.0, 17.0, -8.0, 15.0
GF, UF = 0.5, 3.75                 # ground floor and upper floor levels
SLAB = 0.25                         # upper floor slab (the ground floor ceiling is at UF - SLAB)
TOP = 6.55                          # upper ceiling
EXT_T, INT_T = 0.25, 0.15
STOREY = {"G": (GF, UF - GF), "U": (UF, TOP - UF + 0.15)}

# rooms: (storey, key, name, rect, floor material, wall material)
ROOMS = [
    ("G", "living", "Living Room", (-17, -8, -6, 3.5), "farm_oak_floor", "farm_wall_sage"),
    ("G", "foyer", "Foyer", (-6, -8, 0, 3.5), "farm_oak_floor", "farm_wall_cream"),
    ("G", "study", "Study", (0, -8, 6, -2), "farm_oak_floor", "farm_wall_blue"),
    ("G", "hall", "Hall", (0, -2, 6, 3.5), "farm_oak_floor", "farm_wall_cream"),
    ("G", "dining", "Dining Room", (6, -8, 17, 3.5), "farm_oak_floor", "farm_wallpaper_floral"),
    ("G", "family", "Family Room", (-17, 3.5, -6, 15), "farm_oak_floor", "farm_wall_cream"),
    ("G", "backhall", "Back Hall", (-6, 3.5, -2, 9), "farm_oak_floor", "farm_wall_cream"),
    ("G", "laundry", "Laundry", (-6, 9, -2, 15), "farm_tile_checker", "farm_wall_blue"),
    ("G", "powder", "Powder Room", (-2, 3.5, 2, 7.5), "farm_tile_hex", "farm_wallpaper_stripe"),
    ("G", "pantry", "Pantry", (2, 3.5, 6, 7.5), "farm_tile_checker", "farm_wall_cream"),
    ("G", "mudroom", "Mudroom", (-2, 7.5, 6, 15), "farm_tile_checker", "farm_wall_sage"),
    ("G", "kitchen", "Kitchen", (6, 3.5, 17, 15), "farm_oak_floor", "farm_wall_cream"),
    ("U", "bed2", "Twins' Room", (-17, -8, -6, -2), "farm_carpet", "farm_wall_blue"),
    ("U", "bed3", "Girl's Room", (-17, -2, -6, 3.5), "farm_carpet", "farm_wall_rose"),
    ("U", "landing", "Landing", (-6, -8, 0, 3.5), "farm_oak_floor", "farm_wall_cream"),
    ("U", "kid1", "Nursery", (0, -8, 8.5, -2), "farm_carpet", "farm_wall_sage"),
    ("U", "office", "Office", (0, -2, 8.5, 3.5), "farm_oak_floor", "farm_wall_blue"),
    ("U", "guest", "Guest Room", (8.5, -8, 17, 3.5), "farm_oak_floor", "farm_wallpaper_floral"),
    ("U", "corridor", "Upstairs Hall", (-17, 3.5, 17, 5.5), "farm_oak_floor", "farm_wall_cream"),
    ("U", "main", "Main Bedroom", (-17, 5.5, -7, 15), "farm_carpet", "farm_wall_sage"),
    ("U", "closet", "Walk-in Closet", (-7, 5.5, -2, 9), "farm_oak_floor", "farm_wall_cream"),
    ("U", "ensuite", "Main Bath", (-7, 9, -2, 15), "farm_tile_hex", "farm_tile_subway"),
    ("U", "strip", "Back Landing", (-2, 5.5, 0, 15), "farm_oak_floor", "farm_wall_cream"),
    ("U", "bath", "Family Bath", (0, 5.5, 5, 10), "farm_tile_checker", "farm_tile_subway"),
    ("U", "play", "Playroom", (0, 10, 5, 15), "farm_carpet", "farm_wall_rose"),
    ("U", "kid2", "Boy's Room", (5, 5.5, 11, 15), "farm_carpet", "farm_wallpaper_stripe"),
    ("U", "bed4", "Bedroom Four", (11, 5.5, 17, 15), "farm_oak_floor", "farm_wall_cream"),
]


def room_at(st, x, y):
    for s, key, name, (a, b, c, d), fm, wm in ROOMS:
        if s == st and a <= x <= c and b <= y <= d:
            return key, wm
    return None, None


# openings registry: (storey, axis, line coordinate, from, to, bottom, top) for skins and skirting
OPEN = []


def reg_open(st, axis, coord, a, b, bottom, top):
    OPEN.append((st, axis, coord, min(a, b), max(a, b), bottom, top))


# ---- stairwells
MAIN_HOLE = (-1.58, -5.25, -0.02, -0.7)
BACK_HOLE = (-1.78, 10.12, -0.22, 14.875)
DECK = (17.2, -2.45, 19.6, 0.6)

# ---- exterior openings (relative bottom/top within the storey)
def ow(at, w=1.1, bottom=0.85, top=2.35):
    return {"at": at, "width": w, "bottom": bottom, "top": top}


EXT = {
    "G": {
        "s": [ow(-14), ow(-9.5), ow(-3, 1.2, 0.0, 2.4), ow(3), ow(9.5), ow(14)],
        "n": [ow(-15.5), ow(-11.5, 1.8, 0.0, 2.4), ow(-7.5), ow(-4, 0.9, 1.2, 2.3), ow(3, 1.0, 0.0, 2.3), ow(5, 0.8, 1.1, 2.3), ow(12.9, 1.3, 1.05, 2.35)],
        "w": [ow(-6), ow(1.5), ow(6.5), ow(12)],
        "e": [ow(-5.5), ow(-1), ow(6), ow(9.5, 1.0, 0.0, 2.3), ow(13)],
    },
    "U": {
        "s": [ow(-14, 1.0, 0.75, 2.15), ow(-9.5, 1.0, 0.75, 2.15), ow(-3, 1.3, 0.55, 2.15), ow(2.5, 1.0, 0.75, 2.15), ow(6, 1.0, 0.75, 2.15), ow(11, 1.0, 0.75, 2.15), ow(14.5, 1.0, 0.75, 2.15)],
        "n": [ow(-14.5, 1.0, 0.75, 2.15), ow(-10, 1.0, 0.75, 2.15), ow(-4.5, 0.7, 1.3, 2.1), ow(2.5, 0.9, 0.75, 2.15), ow(8, 1.0, 0.75, 2.15), ow(14, 1.0, 0.75, 2.15)],
        "w": [ow(-5, 1.0, 0.75, 2.15), ow(0.75, 1.0, 0.75, 2.15), ow(8, 1.0, 0.75, 2.15), ow(12.5, 1.0, 0.75, 2.15)],
        "e": [ow(-4.5, 1.0, 0.75, 2.15), ow(-0.9, 0.95, 0.0, 2.15), ow(8, 1.0, 0.75, 2.15), ow(12.5, 1.0, 0.75, 2.15)],
    },
}


def side_ops(ops):
    return {side: [{("x" if side in "sn" else "y") if k == "at" else k: R(v) for k, v in o.items()} for o in lst] for side, lst in ops.items()}


# foundation and the exterior walls of both storeys
box([0, (Y0 + Y1) / 2, 0], [X1 - X0, Y1 - Y0, GF], "farm_stone", surface="concrete")
for st, (z, h) in STOREY.items():
    P.append({"type": "building", "min": [X0, Y0], "max": [X1, Y1], "z": z, "height": R(h), "wall": EXT_T, "mat": "farm_siding", "mat_in": "farm_wall_cream",
              "floor_mat": None, "roof": False, "frame_mat": "farm_trim", "openings": side_ops(EXT[st])})
    for side, lst in EXT[st].items():
        for o in lst:
            axis = "y" if side in "sn" else "x"   # the line is y = const for s/n walls
            coord = {"s": Y0, "n": Y1, "w": X0, "e": X1}[side]
            reg_open(st, axis, coord, o["at"] - o["width"] / 2, o["at"] + o["width"] / 2, o["bottom"], o["top"])
            # the window or door joinery
            heading = {"s": 0, "n": 180, "w": -90, "e": 90}[side]
            inset = {"s": (0, EXT_T / 2), "n": (0, -EXT_T / 2), "w": (EXT_T / 2, 0), "e": (-EXT_T / 2, 0)}[side]
            cx = o["at"] if side in "sn" else coord + inset[0]
            cy = coord + inset[1] if side in "sn" else o["at"]
            if o["bottom"] > 0.3:
                piece("farm_window", [cx, cy, z + o["bottom"]], heading, width=o["width"], height=o["top"] - o["bottom"], depth=EXT_T)
                # curtains inside, except bathrooms and the kitchen sink window
                ix = cx + (inset[0] if side in "we" else 0)
                iy = cy + (inset[1] if side in "sn" else 0)
                rk, _ = room_at(st, ix + inset[0] * 4, iy + inset[1] * 4)
                if rk not in ("ensuite", "bath", "powder", "laundry", "pantry", "mudroom", "kitchen") and o["width"] <= 1.4:
                    cm = {"bed2": "farm_gingham", "bed3": "farm_gingham", "kid1": "farm_gingham", "play": "farm_gingham", "kid2": "farm_curtain"}.get(rk, "farm_curtain")
                    piece("farm_curtains", [ix, iy, z + o["bottom"]], heading + 180, width=o["width"], top=o["top"] - o["bottom"], floor=-o["bottom"] + 0.03, mat=cm)
            else:
                # exterior doors: glazed french doors (family room), the front door, side and back doors
                dmat = "farm_door_red" if (st, side) == ("G", "s") else "farm_trim"
                if o["width"] > 1.5:
                    # french doors: two leaves hinged at the jambs, both swung into the room
                    for sgn in (-1, 1):
                        hx, hy = rot(sgn * o["width"] / 4, 0, heading)
                        piece("farm_door_leaf", [cx + hx, cy + hy, z], heading + (180 if sgn < 0 else 0), width=o["width"] / 2 - 0.02, height=o["top"] - 0.05,
                              open=-95 if sgn < 0 else 95, mat=dmat)
                else:
                    piece("farm_door_leaf", [cx, cy, z], heading + 180, width=o["width"] - 0.04, height=o["top"] - 0.05, open=95, mat=dmat)

# the upper floor slab (stairwells cut out), its finishes and the ground floor ceiling under it
for (x0, y0, x1, y1) in subtract_rects((X0 + 0.02, Y0 + 0.02, X1 - 0.02, Y1 - 0.02), [MAIN_HOLE, BACK_HOLE]):
    floor(x0, y0, x1, y1, UF, SLAB, "farm_oak_floor", occlude=True)
floor(X0, Y0, X1, Y1, TOP + 0.15, 0.15, "farm_ceiling")
for st, key, name, (a, b, c, d), fm, wm in ROOMS:
    z = GF if st == "G" else UF
    for (x0, y0, x1, y1) in subtract_rects((a, b, c, d), [MAIN_HOLE, BACK_HOLE] if st == "U" else []):
        vfloor(x0, y0, x1, y1, z + 0.012, fm)
    # ceilings
    zc = (UF - SLAB) if st == "G" else TOP
    for (x0, y0, x1, y1) in subtract_rects((a, b, c, d), [MAIN_HOLE, BACK_HOLE] if st == "G" else []):
        vbox([(x0 + x1) / 2, (y0 + y1) / 2, zc - 0.006], [x1 - x0, y1 - y0, 0.006], "farm_ceiling")

# ---- interior walls: (storey, p0, p1, doors [(abs centre, width, top)], soft, reinforce)
IW = [
    ("G", (-6, -8), (-6, 3.5), [(-2.5, 1.8, 2.4)], True, True),
    ("G", (-17, 3.5), (-6, 3.5), [(-11.5, 2.6, 2.4)], True, False),
    ("G", (0, -8), (0, -2), [(-6.5, 0.9, 2.2)], True, False),
    ("G", (0, -2), (0, 3.5), [(1.2, 1.2, 2.3)], True, False),
    ("G", (0, -2), (6, -2), [], True, False),
    ("G", (6, -8), (6, -2), [], True, True),
    ("G", (6, -2), (6, 3.5), [(0.6, 1.4, 2.3)], True, True),
    ("G", (6, 3.5), (17, 3.5), [(11.5, 1.8, 2.4)], True, False),
    ("G", (0, 3.5), (2, 3.5), [], True, False),
    ("G", (2, 3.5), (6, 3.5), [], True, False),
    ("G", (-6, 3.5), (-2, 3.5), [(-4, 1.2, 2.3)], True, False),
    ("G", (-2, 3.5), (0, 3.5), [], True, False),
    ("G", (-6, 3.5), (-6, 9), [(6.5, 1.0, 2.2)], True, True),
    ("G", (-6, 9), (-6, 15), [], True, True),
    ("G", (-6, 9), (-2, 9), [(-4, 0.9, 2.2)], True, False),
    ("G", (-2, 3.5), (-2, 7.5), [(5.5, 0.8, 2.1)], True, False),
    ("G", (-2, 7.5), (-2, 9), [(8.25, 0.9, 2.2)], True, False),
    ("G", (-2, 9), (-2, 15), [], True, False),
    ("G", (-2, 7.5), (2, 7.5), [], True, False),
    ("G", (2, 7.5), (6, 7.5), [], True, False),
    ("G", (2, 3.5), (2, 7.5), [], True, False),
    ("G", (6, 3.5), (6, 7.5), [(5.5, 0.9, 2.2)], True, True),
    ("G", (6, 7.5), (6, 15), [(11.5, 1.0, 2.2)], True, True),
    ("U", (-6, -8), (-6, -2), [(-5, 0.9, 2.1)], True, False),
    ("U", (-6, -2), (-6, 3.5), [], True, False),
    ("U", (-17, -2), (-6, -2), [], True, False),
    ("U", (-17, 3.5), (-6, 3.5), [(-11.5, 0.9, 2.1)], True, False),
    ("U", (0, -8), (0, -2), [(-6.5, 0.9, 2.1)], True, False),
    ("U", (0, -2), (0, 3.5), [(2.3, 0.9, 2.1)], True, False),
    ("U", (0, -2), (8.5, -2), [], True, False),
    ("U", (8.5, -8), (8.5, -2), [], True, False),
    ("U", (8.5, -2), (8.5, 3.5), [], True, False),
    ("U", (0, 3.5), (8.5, 3.5), [], True, False),
    ("U", (8.5, 3.5), (17, 3.5), [(12.5, 0.9, 2.1)], True, False),
    ("U", (-17, 5.5), (-7, 5.5), [(-12, 0.9, 2.1)], True, False),
    ("U", (-7, 5.5), (-2, 5.5), [], True, False),
    ("U", (-7, 5.5), (-7, 9), [(7.2, 0.8, 2.1)], True, False),
    ("U", (-7, 9), (-7, 15), [(12, 0.8, 2.1)], True, False),
    ("U", (-7, 9), (-2, 9), [], True, False),
    ("U", (-2, 5.5), (-2, 9), [], True, False),
    ("U", (-2, 9), (-2, 15), [], True, False),
    ("U", (0, 5.5), (0, 10), [], True, False),
    ("U", (0, 10), (0, 15), [], True, False),
    ("U", (0, 5.5), (5, 5.5), [(2.5, 0.8, 2.1)], True, False),
    ("U", (5, 5.5), (11, 5.5), [(8, 0.9, 2.1)], True, False),
    ("U", (11, 5.5), (17, 5.5), [(14, 0.9, 2.1)], True, False),
    ("U", (0, 10), (5, 10), [], True, False),
    ("U", (5, 5.5), (5, 10), [], True, False),
    ("U", (5, 10), (5, 15), [(12.5, 0.8, 2.1)], True, False),
    ("U", (11, 5.5), (11, 15), [], True, False),
]
for st, p0, p1, doors, soft, reinf in IW:
    z, h = STOREY[st]
    h = (UF - SLAB - GF) if st == "G" else (TOP - UF)
    vertical = p0[0] == p1[0]
    # trim the wall ends to the exterior walls' inner faces and the crossing walls
    a0 = list(p0)
    a1 = list(p1)
    if vertical:
        a0[1] = max(a0[1], Y0 + EXT_T)
        a1[1] = min(a1[1], Y1 - EXT_T)
    else:
        a0[0] = max(a0[0], X0 + EXT_T)
        a1[0] = min(a1[0], X1 - EXT_T)
    # which room is on each side: mat = the left of p0 -> p1, mat2 = the right
    mx, my = (a0[0] + a1[0]) / 2, (a0[1] + a1[1]) / 2
    if vertical:
        left, right = room_at(st, mx - 0.3, my), room_at(st, mx + 0.3, my)
    else:
        left, right = room_at(st, mx, my + 0.3), room_at(st, mx, my - 0.3)
    mat = left[1] or "farm_wall_cream"
    mat2 = right[1] or mat
    ops = []
    for (c, w, top) in doors:
        at = (c - a0[1]) if vertical else (c - a0[0])
        ops.append({"at": R(at), "width": w, "bottom": 0.0, "top": top})
        reg_open(st, "x" if vertical else "y", p0[0] if vertical else p0[1], c - w / 2, c + w / 2, 0.0, top)
        # an interior door leaf in every doorway narrower than 1.15 m (wider ones are cased openings)
        if w <= 1.15:
            dx, dy = (p0[0], c) if vertical else (c, p0[1])
            piece("farm_door_leaf", [dx, dy, z], 90 if vertical else 0, width=w - 0.04, height=top - 0.04, open=88, mat="farm_cabinet_white")
    e = {"type": "wall", "p0": r3(a0), "p1": r3(a1), "z": R(z), "height": R(h), "thickness": INT_T, "mat": mat, "mat2": mat2,
         "openings": ops, "frame_mat": "farm_trim"}
    if soft:
        name = f"{left[0] or 'x'}_{right[0] or 'x'}"
        e.update({"soft": True, "reinforce": reinf, "breach": False, "name": name, "surface": "plaster"})
    P.append(e)


# open edges between rooms (no wall): no skirting across them
reg_open("U", "y", 3.5, -6, 0, 0.0, 3.0)
reg_open("U", "y", 5.5, -2, 0, 0.0, 3.0)


# ---- per-room paint on the exterior walls' inner faces, skirting boards and cornices
def wall_spans(st, axis, coord, lo, hi, z_lo=0.0):
    gaps = [(a, b) for (s, ax, c, a, b, bot, top) in OPEN if s == st and ax == axis and abs(c - coord) < 0.01 and bot <= z_lo + 0.01]
    return subtract_spans(lo, hi, gaps)


for st, key, name, (a, b, c, d), fm, wm in ROOMS:
    z, _ = STOREY[st]
    h = (UF - SLAB - GF) if st == "G" else (TOP - UF)
    sides = [("y", b, a, c, +1), ("y", d, a, c, -1), ("x", a, b, d, +1), ("x", c, b, d, -1)]
    for axis, coord, lo, hi, inward in sides:
        exterior = coord in (X0, X1, Y0, Y1)
        face = coord + inward * ((EXT_T if exterior else INT_T / 2) + 0.004)
        lo2, hi2 = lo + (EXT_T if lo in (X0, Y0) else INT_T / 2), hi - (EXT_T if hi in (X1, Y1) else INT_T / 2)
        if exterior and wm != "farm_wall_cream":
            # paint / paper on the exterior wall's inside face, around its windows and doors
            ops = [(o[3], o[4], o[5], o[6]) for o in OPEN if o[0] == st and o[1] == axis and abs(o[2] - coord) < 0.01]
            cuts = [(o0, o1) for (o0, o1, ob, ot) in ops]
            for (s0, s1) in subtract_spans(lo2, hi2, cuts):
                cs = ((s0 + s1) / 2, face) if axis == "y" else (face, (s0 + s1) / 2)
                sz = (s1 - s0, 0.006) if axis == "y" else (0.006, s1 - s0)
                vbox([cs[0], cs[1], z], [sz[0], sz[1], h], wm)
            for (o0, o1, ob, ot) in ops:
                if not (hi2 > o0 and lo2 < o1):
                    continue
                o0c, o1c = max(o0, lo2), min(o1, hi2)
                cs = ((o0c + o1c) / 2, face) if axis == "y" else (face, (o0c + o1c) / 2)
                sz = (o1c - o0c, 0.006) if axis == "y" else (0.006, o1c - o0c)
                if ob > 0.01:
                    vbox([cs[0], cs[1], z], [sz[0], sz[1], ob], wm)
                if ot < h - 0.01:
                    vbox([cs[0], cs[1], z + ot], [sz[0], sz[1], h - ot], wm)
        if wm in ("farm_tile_subway",):
            continue
        # skirting (and a cornice in the formal rooms)
        for (s0, s1) in wall_spans(st, axis, coord, lo2, hi2):
            cs = ((s0 + s1) / 2, face + inward * 0.008) if axis == "y" else (face + inward * 0.008, (s0 + s1) / 2)
            sz = (s1 - s0, 0.018) if axis == "y" else (0.018, s1 - s0)
            vbox([cs[0], cs[1], z], [sz[0], sz[1], 0.13], "farm_trim")
        if key in ("living", "dining", "foyer", "family", "main", "guest"):
            cs = ((lo2 + hi2) / 2, face + inward * 0.03) if axis == "y" else (face + inward * 0.03, (lo2 + hi2) / 2)
            sz = (hi2 - lo2, 0.06) if axis == "y" else (0.06, hi2 - lo2)
            vbox([cs[0], cs[1], z + h - 0.09], [sz[0], sz[1], 0.09], "farm_trim")
    callout(name, a, b, c, d)

# ---- staircases
# 1. main stair in the foyer, up to the north along the foyer's east wall
P.append({"type": "stairs", "base": [-0.8, -5.1, GF], "heading": 0, "steps": 15, "rise": R(UF - GF), "run": 0.29, "width": 1.4, "mat": "farm_oak_floor", "rails": False})
piece("farm_banister", [0, 0, 0], 0, p0=[-1.55, -5.05, GF], p1=[-1.55, -0.75, UF], height=0.95)
piece("farm_banister", [0, 0, 0], 0, p0=[-1.6, -0.7, UF], p1=[-1.6, -5.27, UF], height=0.95)
piece("farm_banister", [0, 0, 0], 0, p0=[-1.6, -5.27, UF], p1=[-0.08, -5.27, UF], height=0.95)
solid([-1.6, -2.98, UF], [0.08, 4.6, 1.0])
solid([-0.84, -5.27, UF], [1.56, 0.08, 1.0])
solid([-1.6, -2.9, GF], [0.06, 4.3, 0.9])          # the stair's open side, low
vbox([-0.8, -2.9, GF], [1.4, 4.4, 0.02], "farm_oak_floor")
# 2. back stair in the mudroom along the laundry wall, up to the south
P.append({"type": "stairs", "base": [-1.0, 14.6, GF], "heading": 180, "steps": 15, "rise": R(UF - GF), "run": 0.29, "width": 1.4, "mat": "farm_oak_floor", "rails": False})
piece("farm_banister", [0, 0, 0], 0, p0=[-0.25, 14.55, GF], p1=[-0.25, 10.25, UF], height=0.95, rail_mat="farm_walnut")
solid([-0.25, 12.4, GF + 0.8], [0.06, 4.3, 2.0])
# 3. outside stair on the east wall to the deck and the guest room
P.append({"type": "stairs", "base": [17.95, -7.2, 0.0], "heading": 0, "steps": 17, "rise": UF, "run": 0.28, "width": 1.2, "mat": "farm_deck", "rails": False, "solid": False})
floor(DECK[0], DECK[1], DECK[2], DECK[3], UF, 0.15, "farm_deck", occlude=False)
piece("farm_banister", [0, 0, 0], 0, p0=[18.6, -7.15, 0.0], p1=[18.6, -2.5, UF], height=0.95, rail_mat="farm_trim")
piece("farm_banister", [0, 0, 0], 0, p0=[19.55, -2.45, UF], p1=[19.55, 0.55, UF], height=0.95, rail_mat="farm_trim")
piece("farm_banister", [0, 0, 0], 0, p0=[17.25, 0.55, UF], p1=[19.55, 0.55, UF], height=0.95, rail_mat="farm_trim")
piece("farm_banister", [0, 0, 0], 0, p0=[18.65, -2.45, UF], p1=[19.55, -2.45, UF], height=0.95, rail_mat="farm_trim")
solid([18.62, -4.8, 0.0], [0.06, 4.8, UF + 1.0])
solid([19.55, -0.93, UF], [0.08, 3.05, 1.0])
solid([18.4, 0.55, UF], [2.3, 0.08, 1.0])
solid([19.1, -2.45, UF], [0.9, 0.08, 1.0])
for (px, py) in [(19.5, -2.4), (19.5, 0.5), (17.35, 0.5)]:
    box([px, py, 0], [0.16, 0.16, UF - 0.15], "farm_trim", occlude=False, surface="wood")

# ---- front porch (south), back patio, steps
floor(-14.0, -11.0, 14.0, -8.0, GF, GF, "farm_deck", occlude=False)
vbox([0, -11.0, 0], [28.0, 0.04, GF], "farm_trim")
P.append({"type": "stairs", "base": [-3.0, -11.6, 0.0], "heading": 0, "steps": 2, "rise": GF, "run": 0.3, "width": 2.6, "mat": "farm_deck", "rails": False})
for px in (-13.85, -9.0, -5.0, -1.0, 4.0, 9.0, 13.85):
    vcyl([px, -10.85, GF + 1.45], 0.1, 2.9, "farm_trim", segments=16)
    vbox([px, -10.85, GF], [0.3, 0.3, 0.2], "farm_trim")
    vbox([px, -10.85, GF + 2.82], [0.28, 0.28, 0.12], "farm_trim")
    solid([px, -10.85, GF], [0.22, 0.22, 2.9])
for (x0, x1) in [(-13.85, -9.0), (-9.0, -5.0), (-5.0, -4.3), (-1.7, -1.0), (-1.0, 4.0), (4.0, 9.0), (9.0, 13.85)]:
    if x1 - x0 < 0.2:
        continue
    piece("farm_banister", [0, 0, 0], 0, p0=[x0, -10.85, GF], p1=[x1, -10.85, GF], height=0.85, rail_mat="farm_trim", mat="farm_trim")
    solid([(x0 + x1) / 2, -10.85, GF], [x1 - x0, 0.08, 0.95])
for side_x in (-14.0, 14.0):
    piece("farm_banister", [0, 0, 0], 0, p0=[side_x, -10.85, GF], p1=[side_x, -8.1, GF], height=0.85, rail_mat="farm_trim", mat="farm_trim")
    solid([side_x, -9.45, GF], [0.08, 2.8, 0.95])
cbox([0, -9.55, GF + 3.15], [28.8, 3.6, 0.14], "farm_shingle", hpr=(0, 12, 0), surface="wood")
vbox([0, -9.6, GF + 2.92], [28.4, 3.2, 0.03], "farm_ceiling")
vbox([0, -11.08, GF + 2.9], [28.6, 0.08, 0.26], "farm_trim")
piece("farm_porch_swing", [-11.0, -9.2, GF], 0, length=1.7, hang=2.3)
piece("farm_rocking_chair", [6.0, -9.6, GF], 10)
piece("farm_rocking_chair", [8.2, -9.7, GF], -15)
piece("farm_side_table", [7.1, -9.4, GF], 0, size=0.4, mat="farm_trim")
for px in (-5.6, -0.4):
    piece("farm_plant", [px, -10.4, GF], 0, size=1.3, kind="bushy")
vbox([-3, -8.9, GF], [1.4, 0.8, 0.012], "farm_rug_braid")
light([-3, -9.5, GF + 2.7], 2700, 5, 8)
light([8, -9.5, GF + 2.7], 2700, 4, 8)
for lx in (-3.9, -2.1):
    piece("farm_sconce", [lx, -8.0, GF + 2.0], 0)
# back patio (flagstone) off the family room's french doors, and the steps at the other doors
floor(-15.5, 15.0, -7.5, 20.5, 0.03, 0.06, "farm_flagstone", occlude=False)
P.append({"type": "stairs", "base": [-11.5, 15.0 + 0.6, 0.0], "heading": 180, "steps": 2, "rise": GF, "run": 0.3, "width": 2.4, "mat": "farm_flagstone", "rails": False})
P.append({"type": "stairs", "base": [3.0, 15.0 + 0.6, 0.0], "heading": 180, "steps": 2, "rise": GF, "run": 0.3, "width": 1.4, "mat": "farm_flagstone", "rails": False})
P.append({"type": "stairs", "base": [17.0 + 0.6, 9.5, 0.0], "heading": 90, "steps": 2, "rise": GF, "run": 0.3, "width": 1.4, "mat": "farm_flagstone", "rails": False})
piece("farm_table", [-11.5, 18.2, 0.03], 0, length=1.8, width=0.95, mat="farm_pine")
cbox([-11.5, 18.2, 0.77], [1.8, 0.95, 0.06], INV, surface="wood", occlude=False)
for (cx, cy, hd) in [(-12.2, 17.3, 0), (-10.8, 17.3, 0), (-12.2, 19.1, 180), (-10.8, 19.1, 180)]:
    piece("farm_chair", [cx, cy, 0.03], hd, mat="farm_trim", cushion="farm_gingham")
piece("farm_grill", [-8.4, 19.5, 0.03], 0)
light([-11.5, 15.5, 3.0], 2700, 4, 7)

# ---- roof: gable along x, eaves and rakes, chimney, three dormers on the front slope
PITCH = 30.0
t = math.tan(math.radians(PITCH))
OVER = 0.55
half = (Y1 - Y0) / 2
ymid = (Y0 + Y1) / 2
eave_z = TOP + 0.15
ridge_z = eave_z + half * t
for sgn in (-1, 1):
    ye, ze = ymid + sgn * (half + OVER), eave_z - OVER * t
    L2 = math.hypot(half + OVER, ridge_z - ze)
    cy, cz = (ye + ymid) / 2, (ze + ridge_z) / 2 + 0.12 / math.cos(math.radians(PITCH))
    cbox([0, cy, cz], [X1 - X0 + 1.2, L2 + 0.02, 0.22], "farm_shingle", hpr=(0, -sgn * PITCH, 0), surface="wood")
    vcbox([0, ye, ze - 0.06], [X1 - X0 + 1.2, 0.06, 0.3], "farm_trim")
vcbox([0, ymid, ridge_z + 0.2], [X1 - X0 + 1.2, 0.36, 0.12], "farm_shingle")
for gx in (X0 + 0.12, X1 - 0.12):
    V.append({"type": "gable", "p0": [gx, Y0], "p1": [gx, Y1], "z": eave_z, "height": R(half * t), "thickness": 0.24, "mat": "farm_siding"})
    for sgn in (-1, 1):
        ye, ze = ymid + sgn * (half + OVER), eave_z - OVER * t
        L2 = math.hypot(half + OVER, ridge_z - ze)
        vcbox([gx + (0.16 if gx > 0 else -0.16), (ye + ymid) / 2, (ze + ridge_z) / 2 + 0.06], [0.05, L2, 0.24], "farm_trim", hpr=(0, -sgn * PITCH, 0))
    vbox([gx + (0.14 if gx > 0 else -0.14), ymid, eave_z + 2.2], [0.05, 1.0, 1.2], "farm_shutter")
# dormers (visual) on the front slope
for dx in (-9.0, 0.0, 9.0):
    yd, zb = Y0 + 2.2, eave_z + 2.2 * t
    vbox([dx, yd + 0.9, zb - 0.4], [2.0, 1.8, 1.9], "farm_siding")
    piece("farm_window", [dx, yd - 0.02, zb + 0.05], 0, width=0.9, height=1.05, depth=0.12)
    for s in (-1, 1):
        vcbox([dx + s * 0.62, yd + 0.9, zb + 1.72], [1.42, 2.2, 0.1], "farm_shingle", hpr=(0, 0, s * 38))
    V.append({"type": "gable", "p0": [dx - 1.0, yd], "p1": [dx + 1.0, yd], "z": R(zb + 1.45), "height": 0.75, "thickness": 0.1, "mat": "farm_siding"})
# chimney on the west gable, the living room fireplace against it
box([X0 - 0.55, -2.25, 0.0], [1.1, 1.8, ridge_z + 1.4], "farm_brick", surface="brick")
vbox([X0 - 0.55, -2.25, ridge_z + 1.4], [1.25, 1.95, 0.12], "farm_stone")
for cxo in (-0.25, 0.25):
    vcyl([X0 - 0.55 + cxo, -2.25, ridge_z + 1.7], 0.11, 0.5, "farm_terracotta", segments=12)

# ================================================================================ furniture and decor
def furnish(t, base, heading, colliders=(), surface="wood", **kw):
    """A furniture piece: the detailed mesh (visual) plus invisible colliders in its own frame."""
    piece(t, base, heading, **kw)
    for (lx, ly, lz, sx, sy, sz) in colliders:
        wx, wy = rot(lx, ly, heading)
        solid([base[0] + wx, base[1] + wy, base[2] + lz], [sx, sy, sz], heading, surface)


WALL_X = (-17, -7, -6, -2, 0, 2, 5, 6, 8.5, 11, 17)
WALL_Y = (-8, -2, 3.5, 5.5, 7.5, 9, 10, 15)


def wall_picture(x, y, z, heading, size=(0.6, 0.45), atlas="farm_art", cell=0, frame="farm_walnut"):
    # the heading only says which way the wall runs (0/180: an east-west wall, +-90: north-south); the picture
    # always faces away from the nearest wall line, into the room it hangs in
    if abs(heading) % 180 < 45:
        wy = min(WALL_Y, key=lambda w: abs(w - y))
        heading = 0 if wy > y else 180
    else:
        wx = min(WALL_X, key=lambda w: abs(w - x))
        heading = -90 if wx > x else 90
    piece("farm_picture", [x, y, z], heading, size=list(size), atlas=atlas, cell=cell, frame=frame)


G, U = GF, UF
# --- living room (B): fireplace on the west wall, sofa facing it, armchairs, piano, bookcases
furnish("farm_fireplace", [-16.45, -2.25, G], 90, [(0, 0.05, 0, 1.9, 0.6, 1.25)], "brick", length=1.8)
vfloor(-16.4, -3.2, -14.9, -1.3, G + 0.03, "farm_stone")
furnish("farm_rug", [-12.6, -2.25, G], 90, size=[3.6, 2.6], mat="farm_rug_red", fringe=True)
furnish("farm_sofa", [-10.6, -2.25, G], -90, [(0, 0.02, 0, 2.4, 0.95, 0.8)], "fabric", length=2.4, pillows=["farm_velvet_green", "farm_quilt"], throw="farm_quilt")
furnish("farm_armchair", [-13.6, -5.3, G], 20, [(0, 0, 0, 0.95, 0.95, 0.8)], "fabric", mat="farm_tweed", pillow="farm_gingham")
furnish("farm_armchair", [-13.6, 0.8, G], 160, [(0, 0, 0, 0.95, 0.95, 0.8)], "fabric", mat="farm_tweed", pillow="farm_gingham")
furnish("farm_coffee_table", [-12.9, -2.25, G], 90, [(0, 0, 0, 1.2, 0.6, 0.45)], length=1.2, width=0.6)
furnish("farm_side_table", [-10.6, -3.75, G], -90, [(0, 0, 0, 0.45, 0.45, 0.62)], lamp=True)
furnish("farm_piano", [-9.1, 2.9, G], 0, [(0, 0.1, 0, 1.5, 0.55, 1.3)], mat="farm_walnut")
furnish("farm_bookcase", [-6.33, -6.5, G], -90, [(0, 0, 0, 1.0, 0.34, 2.0)], length=1.0, decor=True)
furnish("farm_bookcase", [-6.33, 1.6, G], -90, [(0, 0, 0, 1.0, 0.34, 2.0)], length=1.0, mat="farm_walnut")
piece("farm_floor_lamp", [-15.8, -6.9, G])
piece("farm_plant", [-16.3, 2.9, G], 0, kind="tall", size=1.2)
wall_picture(-7.5, -7.74, G + 1.7, 0, (0.9, 0.6), "farm_art", 2)
wall_picture(-12.6, 3.42, G + 1.8, 180, (0.5, 0.4), "farm_photo", 3)
piece("farm_ceiling_fan", [-11.5, -2.25, UF - SLAB], 0, drop=0.35)
light([-11.5, -2.25, UF - 0.5], 2700, 7, 9)
light([-15.0, -2.25, G + 1.1], 2400, 3, 4)
# --- foyer: console, mirror, coat tree, runner
furnish("farm_rug", [-3.0, -6.4, G], 0, size=[1.4, 2.2], mat="farm_rug_braid", round=False)
furnish("farm_side_table", [-5.6, -6.6, G], 90, [(0, 0, 0, 0.45, 0.45, 0.62)], lamp=True)
piece("farm_coat_hooks", [-5.88, -4.0, G], 90, length=1.2)
piece("farm_boots", [-5.55, -5.0, G], 90, count=2)
wall_picture(-5.9, 0.5, G + 1.6, 90, (0.7, 0.5), "farm_photo", 0, "farm_brass")
wall_picture(-3.0, 3.42, G + 1.6, 180, (0.5, 0.65), "farm_art", 1)
piece("farm_chandelier", [-3.0, -3.5, UF - SLAB], 0, drop=0.9, arms=5, radius=0.32)
light([-3.0, -3.5, UF - 1.2], 2700, 6, 9)
piece("farm_clock", [-5.92, -1.5, G + 1.9], 90)
# --- study: desk at the window, bookcases, armchair
furnish("farm_desk", [3.0, -6.9, G], 180, [(0, 0, 0.72, 1.5, 0.7, 0.06), (0.53, 0.02, 0, 0.42, 0.68, 0.74)], length=1.5)
piece("farm_office_chair", [3.0, -6.1, G], -20)
furnish("farm_bookcase", [5.7, -5.0, G], -90, [(0, 0, 0, 1.6, 0.34, 2.1)], length=1.6, height=2.1, mat="farm_walnut")
furnish("farm_bookcase", [0.33, -4.4, G], 90, [(0, 0, 0, 1.2, 0.34, 2.1)], length=1.2, height=2.1, mat="farm_walnut")
furnish("farm_armchair", [4.6, -2.9, G], 210, [(0, 0, 0, 0.95, 0.95, 0.8)], "fabric", mat="farm_leather", pillow="farm_tweed")
furnish("farm_rug", [3.0, -4.6, G], 0, size=[2.4, 1.8], mat="farm_rug_braid", round=True)
piece("farm_floor_lamp", [5.5, -2.5, G])
wall_picture(3.0, -2.08, G + 1.6, 0, (0.8, 0.55), "farm_art", 0)
light([3.0, -5.0, UF - 0.5], 3000, 5, 7)
piece("farm_ceiling_light", [3.0, -5.0, UF - SLAB], 0)
# --- hall: bench, plant, family photos
furnish("farm_bench", [3.0, 3.15, G], 0, [(0, 0, 0, 1.4, 0.36, 0.47)], length=1.4, cushion="farm_gingham")
piece("farm_plant", [5.55, 3.05, G], 0, size=1.0)
for i in range(3):
    wall_picture(1.9 + i * 1.1, 3.42, G + 1.6 + (i % 2) * 0.25, 180, (0.35, 0.45), "farm_photo", 5 + i, "farm_walnut")
light([3.0, 0.8, UF - 0.5], 2700, 4, 6)
piece("farm_ceiling_light", [3.0, 0.8, UF - SLAB], 0)
# --- dining room (A): long table set for eight, chandelier, sideboard, china hutch
furnish("farm_rug", [11.5, -2.25, G], 0, size=[4.2, 3.0], mat="farm_rug_red")
furnish("farm_table", [11.5, -2.25, G], 0, [(0, 0, 0.71, 2.8, 1.1, 0.07)], length=2.8, width=1.1, runner="farm_linen")
for i, cx in enumerate((10.6, 11.5, 12.4)):
    for sy, hd in ((-1, 0), (1, 180)):
        piece("farm_chair", [cx, -2.25 + sy * 0.78, G], hd, cushion="farm_gingham")
        piece("farm_place_setting", [cx, -2.25 + sy * 0.35, G + 0.785], hd)
for sx, hd in ((-1, -90), (1, 90)):
    piece("farm_chair", [11.5 + sx * 1.65, -2.25, G], hd, cushion="farm_gingham")
    piece("farm_place_setting", [11.5 + sx * 1.18, -2.25, G + 0.785], hd)
piece("farm_vase", [11.5, -2.25, G + 0.785], 0)
for cx in (10.4, 12.6):
    piece("farm_lamp", [cx, -2.25, G + 0.785], 0, size=0.55, mat="farm_brass")
furnish("farm_dresser", [16.48, -3.25, G], -90, [(0, 0, 0, 1.6, 0.5, 0.9)], length=1.6, height=0.9, mat="farm_walnut", decor=True)
furnish("farm_bookcase", [6.33, -5.6, G], 90, [(0, 0, 0, 1.4, 0.34, 2.1)], length=1.4, height=2.1, books=False, decor=True)
piece("farm_chandelier", [11.5, -2.25, UF - SLAB], 0, drop=0.85, arms=8, radius=0.45)
light([11.5, -2.25, UF - 1.1], 2700, 8, 10)
wall_picture(16.72, -3.25, G + 1.9, -90, (1.0, 0.65), "farm_art", 1, "farm_brass")
# --- kitchen (A): the north run with range and farmhouse sink, island with stools, fridge, breakfast table
furnish("farm_kitchen_run", [11.7, 14.44, G], 0, [(0, 0, 0, 7.2, 0.62, 0.92)], length=7.2, sink=7, range=2, uppers=True, window=7, decor=True)
vbox([11.7, 14.73, G + 0.92], [7.2, 0.01, 0.55], "farm_tile_subway")
furnish("farm_island", [11.6, 8.6, G], 0, [(0, 0, 0, 3.0, 1.1, 0.94)], length=3.0, width=1.1, decor=True)
for sx in (10.6, 11.6, 12.6):
    piece("farm_stool", [sx, 7.75, G], 0)
furnish("farm_fridge", [6.47, 13.6, G], 90, [(0, 0, 0, 0.8, 0.72, 1.85)], width=0.8)
furnish("farm_open_shelf", [16.61, 12.0, G], -90, length=1.2, count=2)
furnish("farm_table", [14.9, 5.6, G], 0, [(0, 0, 0.71, 1.4, 0.9, 0.07)], length=1.4, width=0.9, mat="farm_pine")
for (cx, cy, hd) in [(14.4, 4.9, 0), (15.4, 4.9, 0), (14.4, 6.3, 180), (15.4, 6.3, 180)]:
    piece("farm_chair", [cx, cy, G], hd, mat="farm_trim")
piece("farm_fruit_bowl", [14.9, 5.6, G + 0.785], 0)
for px in (10.4, 12.8):
    piece("farm_pendant", [px, 8.6, UF - SLAB], 0, drop=0.95)
piece("farm_pot_rack", [11.6, 8.6, UF - SLAB], 0, length=1.3, drop=0.75)
light([11.6, 8.6, UF - 1.3], 2900, 8, 10)
light([11.7, 12.5, UF - 0.5], 3000, 6, 8)
light([14.9, 5.6, UF - 0.5], 2900, 4, 7)
piece("farm_ceiling_light", [14.9, 5.6, UF - SLAB], 0)
piece("farm_clock", [6.1, 9.0, G + 2.1], 90)
furnish("farm_rug", [14.9, 5.6, G], 0, size=[2.2, 1.6], mat="farm_rug_braid", round=True)
# --- family room (B): sectional, TV, toys, round rug
furnish("farm_rug", [-12.0, 9.25, G], 0, size=[3.4, 3.4], mat="farm_rug_braid", round=True)
furnish("farm_tv_unit", [-16.5, 9.25, G], 90, [(0, 0, 0, 1.8, 0.45, 0.55)], length=1.8)
furnish("farm_sofa", [-10.0, 9.25, G], -90, [(0, 0.02, 0, 2.6, 0.95, 0.8)], "fabric", length=2.6, mat="farm_tweed", pillows=["farm_gingham", "farm_linen"], throw="farm_gingham")
furnish("farm_sofa", [-12.6, 12.9, G], 180, [(0, 0.02, 0, 2.2, 0.95, 0.8)], "fabric", length=2.2, mat="farm_tweed", pillows=["farm_velvet_green", "farm_quilt"])
furnish("farm_coffee_table", [-12.6, 9.25, G], 0, [(0, 0, 0, 1.2, 0.7, 0.45)], length=1.2, width=0.7, mat="farm_pine")
furnish("farm_crib_toys", [-7.0, 14.3, G], 0, [(0, 0, 0, 0.84, 0.48, 0.55)])
furnish("farm_bookcase", [-6.33, 12.5, G], -90, [(0, 0, 0, 1.2, 0.34, 2.0)], length=1.2)
furnish("farm_armchair", [-14.8, 5.0, G], 200, [(0, 0, 0, 0.95, 0.95, 0.8)], "fabric", mat="farm_velvet_green", pillow="farm_quilt")
piece("farm_floor_lamp", [-16.3, 4.3, G])
piece("farm_plant", [-16.2, 14.2, G], 0, kind="tall", size=1.3)
for i in range(4):
    wall_picture(-15.8 + i * 1.0, 3.58, G + 1.55 + (i % 2) * 0.3, 0, (0.4, 0.5), "farm_photo", i, "farm_trim")
piece("farm_ceiling_fan", [-11.5, 9.25, UF - SLAB], 0, drop=0.35, phase=30)
light([-11.5, 9.25, UF - 0.5], 2800, 7, 9)
# --- back hall, laundry, powder room, pantry, mudroom
furnish("farm_bench", [-5.62, 4.75, G], 90, [(0, 0, 0, 1.2, 0.36, 0.47)], length=1.2, cushion="farm_linen")
wall_picture(-5.9, 5.5, G + 1.6, 90, (0.5, 0.4), "farm_art", 2)
light([-4.0, 6.2, UF - 0.5], 2800, 4, 6)
piece("farm_ceiling_light", [-4.0, 6.2, UF - SLAB], 0)
furnish("farm_washer", [-5.4, 14.4, G], 180, [(0, 0, 0, 0.6, 0.62, 0.86)])
furnish("farm_washer", [-4.7, 14.4, G], 180, [(0, 0, 0, 0.6, 0.62, 0.86)], mat="farm_ceramic")
furnish("farm_kitchen_run", [-3.0, 14.44, G], 0, [(0, 0, 0, 1.2, 0.62, 0.92)], length=1.2, mat="farm_cabinet_sage", top_mat="farm_quartz")
piece("farm_open_shelf", [-4.4, 14.61, G + 0.2], 0, length=1.6, count=1)
furnish("farm_table", [-5.5, 11.2, G], 90, [(0, 0, 0.71, 1.2, 0.7, 0.07)], length=1.2, width=0.7, mat="farm_pine")
piece("farm_ceiling_light", [-4.0, 12.0, UF - SLAB], 0)
light([-4.0, 12.0, UF - 0.5], 3200, 5, 6)
furnish("farm_toilet", [-1.6, 6.9, G], 0, [(0, 0, 0, 0.45, 0.7, 0.55)], "tile")
furnish("farm_vanity", [1.62, 5.5, G], -90, [(0, 0, 0, 0.8, 0.55, 0.84)], "tile", length=0.8)
piece("farm_towel_rail", [-1.85, 4.6, G], 90, length=0.6)
light([0.0, 5.5, UF - 0.5], 3000, 3, 5)
piece("farm_ceiling_light", [0.0, 5.5, UF - SLAB], 0)
for (sx, sy, hd) in [(2.15, 5.5, 90), (4.0, 7.35, 0), (5.85, 5.5, -90)]:
    piece("farm_open_shelf", [sx, sy, G - 1.1], hd, length=1.6, count=3)
P.append({"type": "prop", "kind": "sacks", "base": [4.0, 4.0, G], "heading": 0, "count": 3})
light([4.0, 5.5, UF - 0.5], 3200, 3, 5)
piece("farm_coat_hooks", [4.6, 14.74, G], 0, length=2.4, full=True)
furnish("farm_bench", [4.6, 14.4, G], 180, [(0, 0, 0, 1.6, 0.36, 0.47)], length=1.6, cushion="farm_gingham")
piece("farm_boots", [3.8, 13.9, G], 180, count=3)
furnish("farm_rug", [3.0, 11.0, G], 90, size=[2.6, 1.0], mat="farm_rug_braid")
light([2.0, 11.0, UF - 0.5], 3000, 5, 7)
piece("farm_ceiling_light", [2.0, 11.0, UF - SLAB], 0)

# --- upstairs: landing, bedrooms, bathrooms
furnish("farm_bench", [-3.0, -7.5, U], 0, [(0, 0, 0, 1.6, 0.36, 0.5)], length=1.6, cushion="farm_quilt")
furnish("farm_bookcase", [-5.67, -2.5, U], 90, [(0, 0, 0, 1.2, 0.34, 2.0)], length=1.2)
piece("farm_plant", [-5.5, 2.9, U], 0, size=1.0)
furnish("farm_rug", [-3.5, 1.4, U], 0, size=[1.6, 2.4], mat="farm_rug_braid")
piece("farm_ceiling_light", [-3.5, -2.0, TOP], 0)
light([-3.5, -2.0, TOP - 0.4], 2800, 6, 9)
for i in range(4):
    wall_picture(-15.0 + i * 3.4, 3.58, U + 1.55, 0, (0.45, 0.55), "farm_photo", (i + 2) % 9, "farm_walnut")
    wall_picture(2.0 + i * 3.6, 5.42, U + 1.55, 180, (0.45, 0.55), "farm_photo", (i + 5) % 9, "farm_walnut")
for lx in (-12.0, -4.0, 4.0, 12.0):
    piece("farm_ceiling_light", [lx, 4.5, TOP], 0)
    light([lx, 4.5, TOP - 0.4], 2800, 4, 7)
furnish("farm_rug", [6.0, 4.5, U], 90, size=[1.3, 6.0], mat="farm_rug_red")
furnish("farm_rug", [-11.0, 4.5, U], 90, size=[1.3, 6.0], mat="farm_rug_red")
# twins' room
for bx in (-11.75, -7.6):
    furnish("farm_bed", [bx, -6.7, U], 180, [(0, 0, 0, 1.06, 2.1, 0.6)], "fabric", width=1.0, length=2.0, quilt="farm_quilt", accent="farm_gingham")
furnish("farm_side_table", [-9.65, -7.4, U], 180, [(0, 0, 0, 0.45, 0.45, 0.62)], lamp=True)
furnish("farm_dresser", [-15.5, -2.38, U], 0, [(0, 0, 0, 1.2, 0.5, 0.9)], length=1.2, decor=True)
furnish("farm_crib_toys", [-16.4, -5.5, U], 90, [(0, 0, 0, 0.84, 0.48, 0.55)])
furnish("farm_rug", [-11.0, -4.4, U], 0, size=[3.0, 1.8], mat="farm_rug_braid", round=True)
piece("farm_ceiling_light", [-11.5, -5.0, TOP], 0)
light([-11.5, -5.0, TOP - 0.4], 2800, 5, 8)
# girl's room
furnish("farm_bed", [-15.72, 0.75, U], 90, [(0, 0, 0, 1.26, 2.1, 0.6)], "fabric", width=1.2, length=2.0, quilt="farm_quilt", accent="farm_wall_rose")
furnish("farm_desk", [-8.5, 3.0, U], 0, [(0, 0, 0.72, 1.2, 0.7, 0.06), (0.38, 0.02, 0, 0.42, 0.68, 0.74)], length=1.2, mat="farm_cabinet_white")
piece("farm_chair", [-8.6, 2.3, U], 180, mat="farm_cabinet_white", cushion="farm_wall_rose")
furnish("farm_wardrobe", [-6.6, -0.8, U], -90, [(0, 0, 0, 1.0, 0.58, 2.05)], length=1.0, mat="farm_cabinet_white")
furnish("farm_rug", [-12.0, 0.8, U], 0, size=[2.2, 2.2], mat="farm_rug_braid", round=True)
piece("farm_ceiling_light", [-11.5, 0.75, TOP], 0)
light([-11.5, 0.75, TOP - 0.4], 2800, 5, 8)
# nursery
furnish("farm_bed", [5.0, -3.1, U], 0, [(0, 0, 0, 1.06, 2.1, 0.6)], "fabric", width=1.0, length=2.0, mat="farm_cabinet_white", quilt="farm_quilt")
furnish("farm_crib_toys", [7.9, -6.4, U], -90, [(0, 0, 0, 0.84, 0.48, 0.55)])
piece("farm_rocking_chair", [1.6, -6.7, U], 30, mat="farm_cabinet_white")
furnish("farm_dresser", [1.0, -2.38, U], 0, [(0, 0, 0, 1.0, 0.5, 0.9)], length=1.0, mat="farm_cabinet_sage")
furnish("farm_rug", [4.2, -5.2, U], 0, size=[2.6, 1.8], mat="farm_rug_red")
piece("farm_ceiling_light", [4.25, -5.0, TOP], 0)
light([4.25, -5.0, TOP - 0.4], 2800, 4, 7)
# office
furnish("farm_desk", [4.2, 3.1, U], 0, [(0, 0, 0.72, 1.6, 0.7, 0.06), (0.58, 0.02, 0, 0.42, 0.68, 0.74)], length=1.6)
piece("farm_office_chair", [4.2, 2.3, U], 180)
furnish("farm_bookcase", [8.17, 0.75, U], -90, [(0, 0, 0, 1.6, 0.34, 2.0)], length=1.6, mat="farm_walnut")
furnish("farm_sofa", [1.2, 0.6, U], 90, [(0, 0.02, 0, 1.8, 0.95, 0.8)], "fabric", length=1.8, mat="farm_linen", pillows=["farm_tweed"])
piece("farm_ceiling_light", [4.25, 0.75, TOP], 0)
light([4.25, 0.75, TOP - 0.4], 3000, 5, 7)
# guest room (deck door on the east wall)
furnish("farm_bed", [9.6, -2.25, U], 90, [(0, 0, 0, 1.66, 2.1, 0.6)], "fabric", width=1.6, length=2.0, accent="farm_velvet_green")
for ny in (-3.6, -0.9):
    furnish("farm_side_table", [8.85, ny, U], 90, [(0, 0, 0, 0.45, 0.45, 0.62)], lamp=True)
furnish("farm_dresser", [12.75, -7.48, U], 180, [(0, 0, 0, 1.4, 0.5, 0.9)], length=1.4, mat="farm_cabinet_white", mirror=True, decor=True)
furnish("farm_armchair", [9.6, -6.6, U], 30, [(0, 0, 0, 0.95, 0.95, 0.8)], "fabric", mat="farm_linen", pillow="farm_gingham")
furnish("farm_rug", [11.3, -2.25, U], 90, size=[3.0, 2.2], mat="farm_rug_red")
piece("farm_ceiling_fan", [12.75, -2.25, TOP], 0, drop=0.2, phase=20)
light([12.75, -2.25, TOP - 0.4], 2800, 5, 8)
# main bedroom: king bed on the west wall, bench, dresser, reading chair
furnish("farm_bed", [-15.7, 10.25, U], 90, [(0, 0, 0, 1.86, 2.1, 0.6)], "fabric", width=1.8, length=2.05, accent="farm_velvet_green")
for ny in (8.85, 11.65):
    furnish("farm_side_table", [-16.5, ny, U], 90, [(0, 0, 0, 0.45, 0.45, 0.62)], lamp=True)
furnish("farm_bench", [-13.9, 10.25, U], 90, [(0, 0, 0, 1.4, 0.36, 0.5)], length=1.4, cushion="farm_velvet_green")
furnish("farm_dresser", [-12.25, 14.52, U], 0, [(0, 0, 0, 1.6, 0.5, 0.95)], length=1.6, height=0.95, mirror=True, decor=True)
furnish("farm_armchair", [-8.3, 13.8, U], 225, [(0, 0, 0, 0.95, 0.95, 0.8)], "fabric", mat="farm_linen", pillow="farm_quilt")
piece("farm_floor_lamp", [-7.6, 14.5, U])
furnish("farm_wardrobe", [-16.4, 6.5, U], 90, [(0, 0, 0, 1.2, 0.58, 2.05)], length=1.2, mat="farm_cabinet_white")
piece("farm_plant", [-7.6, 6.1, U], 0, kind="tall", size=1.2)
furnish("farm_side_table", [-9.2, 14.4, U], 0, [(0, 0, 0, 0.45, 0.45, 0.62)], lamp=True)
wall_picture(-12.25, 14.72, U + 1.9, 180, (0.5, 0.65), "farm_photo", 1, "farm_brass")
furnish("farm_rug", [-12.6, 10.25, U], 90, size=[3.4, 2.6], mat="farm_rug_red", fringe=True)
wall_picture(-16.72, 10.25, U + 1.85, 90, (0.9, 0.6), "farm_art", 3, "farm_brass")
piece("farm_ceiling_fan", [-12.0, 10.25, TOP], 0, drop=0.2, blade_mat="farm_cabinet_white")
light([-12.0, 10.25, TOP - 0.4], 2700, 6, 9)
# walk-in closet
furnish("farm_wardrobe", [-4.5, 8.67, U], 0, [(0, 0, 0, 1.2, 0.58, 2.05)], length=1.2)
piece("farm_coat_hooks", [-2.15, 7.25, U - 0.2], -90, length=2.4, full=True)
furnish("farm_dresser", [-6.0, 8.67, U], 0, [(0, 0, 0, 1.0, 0.5, 0.9)], length=1.0)
light([-4.5, 7.25, TOP - 0.4], 3000, 3, 5)
piece("farm_ceiling_light", [-4.5, 7.25, TOP], 0)
# main bath
furnish("farm_clawfoot_tub", [-4.5, 14.2, U], 0, [(0, 0, 0, 1.7, 0.8, 0.3)], "tile", length=1.6)
furnish("farm_vanity", [-6.6, 11.0, U], 90, [(0, 0, 0, 1.2, 0.55, 0.84)], "tile", length=1.2)
furnish("farm_toilet", [-2.5, 10.0, U], -90, [(0, 0, 0, 0.45, 0.7, 0.55)], "tile")
piece("farm_towel_rail", [-2.15, 12.4, U], -90, length=0.7)
piece("farm_plant", [-2.4, 14.4, U], 0, size=0.8)
light([-4.5, 12.0, TOP - 0.4], 3200, 4, 6)
piece("farm_ceiling_light", [-4.5, 12.0, TOP], 0)
# family bath
furnish("farm_clawfoot_tub", [2.5, 9.45, U], 180, [(0, 0, 0, 1.7, 0.8, 0.3)], "tile", length=1.6)
furnish("farm_vanity", [4.62, 7.4, U], -90, [(0, 0, 0, 1.0, 0.55, 0.84)], "tile", length=1.0)
furnish("farm_toilet", [0.45, 7.2, U], 90, [(0, 0, 0, 0.45, 0.7, 0.55)], "tile")
piece("farm_towel_rail", [0.15, 8.6, U], 90, length=0.6)
light([2.5, 7.75, TOP - 0.4], 3200, 4, 6)
piece("farm_ceiling_light", [2.5, 7.75, TOP], 0)
# playroom
furnish("farm_crib_toys", [2.5, 14.4, U], 0, [(0, 0, 0, 0.84, 0.48, 0.55)])
furnish("farm_table", [2.5, 12.2, U], 0, [(0, 0, 0.48, 1.0, 0.7, 0.06)], length=1.0, width=0.7, height=0.52, mat="farm_cabinet_sage")
furnish("farm_bookcase", [0.33, 12.5, U], 90, [(0, 0, 0, 1.2, 0.34, 1.4)], length=1.2, height=1.4)
furnish("farm_rug", [2.5, 12.2, U], 0, size=[2.4, 2.4], mat="farm_rug_braid", round=True)
light([2.5, 12.5, TOP - 0.4], 2800, 4, 6)
piece("farm_ceiling_light", [2.5, 12.5, TOP], 0)
# boy's room
furnish("farm_bed", [9.88, 12.3, U], -90, [(0, 0, 0, 1.06, 2.1, 0.6)], "fabric", width=1.0, length=2.0, quilt="farm_quilt", accent="farm_cabinet_navy")
furnish("farm_desk", [6.0, 14.4, U], 0, [(0, 0, 0.72, 1.2, 0.7, 0.06), (0.38, 0.02, 0, 0.42, 0.68, 0.74)], length=1.2, mat="farm_pine")
piece("farm_chair", [6.0, 13.6, U], 180, mat="farm_pine")
furnish("farm_dresser", [10.5, 7.0, U], -90, [(0, 0, 0, 1.0, 0.5, 0.9)], length=1.0, mat="farm_cabinet_navy", decor=True)
furnish("farm_rug", [8.0, 10.3, U], 0, size=[3.2, 2.4], mat="farm_rug_red")
light([8.0, 10.25, TOP - 0.4], 2800, 4, 7)
piece("farm_ceiling_light", [8.0, 10.25, TOP], 0)
# bedroom four
furnish("farm_bed", [15.7, 10.25, U], -90, [(0, 0, 0, 1.46, 2.1, 0.6)], "fabric", width=1.4, length=2.0, quilt="farm_quilt", mat="farm_pine")
furnish("farm_dresser", [12.0, 14.52, U], 0, [(0, 0, 0, 1.2, 0.5, 0.9)], length=1.2, mat="farm_pine", mirror=True)
furnish("farm_wardrobe", [11.6, 7.3, U], 90, [(0, 0, 0, 1.0, 0.58, 2.05)], length=1.0, mat="farm_pine")
light([14.0, 10.25, TOP - 0.4], 2800, 4, 7)
piece("farm_ceiling_light", [14.0, 10.25, TOP], 0)

# ======================================================================== lived-in: the second furnishing pass
def on(base, hd, lx, ly, lz=0.0):
    """A point in a placed piece's own frame (for things set on top of furniture)."""
    wx, wy = rot(lx, ly, hd)
    return [base[0] + wx, base[1] + wy, base[2] + lz]


def teddy_on_bed(base, hd, lg=2.0, **kw):
    piece("farm_teddy", on(base, hd, 0.25, lg / 2 - 0.45, 0.62), hd + 180, **kw)


SEAT = [(0, 0, 0, 0.95, 0.95, 0.8)]
TABLE45 = [(0, 0, 0, 0.45, 0.45, 0.62)]
# --- living room: a second seating group by the south windows, bookcases flanking the fireplace, a clock
for (bx, by) in ((-9.4, -6.8), (-7.4, -6.8)):
    furnish("farm_wingback", [bx, by, G], 160 if bx < -8 else 200, [(0, 0, 0, 0.84, 0.82, 0.8), (0, 0.33, 0, 0.78, 0.2, 1.22)], "fabric",
            mat="farm_velvet_green" if bx < -8 else "farm_tweed", pillow="farm_gingham")
furnish("farm_side_table", [-8.4, -7.35, G], 180, TABLE45, lamp=True)
furnish("farm_ottoman", [-8.4, -5.7, G], 0, [(0, 0, 0, 0.8, 0.55, 0.44)], "fabric", size=[0.8, 0.55, 0.44], tray=True)
furnish("farm_rug", [-8.4, -6.3, G], 0, size=[2.8, 2.0], mat="farm_rug_braid")
for by in (-4.6, 0.1):
    furnish("farm_bookcase", [-16.58, by, G], 90, [(0, 0, 0, 1.2, 0.34, 2.0)], length=1.2, height=2.0, mat="farm_walnut", decor=by > 0)
piece("farm_fire_tools", [-16.1, -3.5, G], -90)
furnish("farm_grandfather_clock", [-14.5, 3.22, G], 0, [(0, 0, 0, 0.56, 0.32, 2.3)])
furnish("farm_console", [-9.75, -2.25, G], 90, [(0, 0, 0, 1.6, 0.36, 0.8)], length=1.6)
furnish("farm_basket", [-10.5, -0.45, G], 0, [(0, 0, 0, 0.44, 0.44, 0.4)], "fabric", size=[0.44, 0.44, 0.4], round=True, contents="blanket")
piece("farm_book_stack", [-12.75, -2.0, G + 0.45], 20, count=3)
piece("farm_vase", [-13.05, -2.55, G + 0.45], 0, mat="farm_ceramic")
piece("farm_plant", [-6.5, -7.45, G], 0, kind="bushy", size=1.1)
piece("farm_floor_lamp", [-14.6, -7.3, G])
wall_picture(-11.75, -7.74, G + 1.75, 0, (1.0, 0.7), "farm_art", 0, "farm_brass")
# --- foyer: shoe cubby under the hooks, umbrellas by the door, console and mirror at the stair's end
furnish("farm_shoe_cubby", [-5.72, -4.05, G], 90, [(0, 0, 0, 0.9, 0.34, 0.55)], length=0.9, cushion="farm_tweed")
piece("farm_umbrella_stand", [-4.2, -7.45, G], 0)
furnish("farm_console", [-1.2, 3.22, G], 0, [(0, 0, 0, 1.2, 0.36, 0.8)], length=1.2)
piece("farm_wall_mirror", [-1.2, 3.42, G + 1.6], 0, size=[0.75, 0.75], round=True)
piece("farm_plant", [-5.55, 3.0, G], 0, kind="tall", size=1.1)
# --- study: filing cabinet, globe, the desk set, a footstool and a side table by the armchair
furnish("farm_filing_cabinet", [5.66, -7.4, G], -90, [(0, 0, 0, 0.46, 0.62, 1.03)])
furnish("farm_globe", [1.1, -7.45, G], 30, [(0, 0, 0, 0.5, 0.5, 1.1)])
piece("farm_laptop", [3.05, -6.75, G + 0.78], 180)
piece("farm_desk_lamp", [2.45, -7.1, G + 0.78], 200)
piece("farm_paper_stack", [3.55, -6.95, G + 0.78], 170, count=3)
furnish("farm_ottoman", [3.8, -3.9, G], 20, [(0, 0, 0, 0.5, 0.42, 0.42)], "fabric", size=[0.5, 0.42, 0.42], mat="farm_tweed")
furnish("farm_side_table", [3.65, -2.45, G], 180, TABLE45)
piece("farm_book_stack", [3.65, -2.45, G + 0.62], 0, count=2)
piece("farm_mug", [3.75, -2.35, G + 0.62 + 0.06], 0)
furnish("farm_basket", [0.45, -2.6, G], 0, [(0, 0, 0, 0.44, 0.44, 0.4)], round=True, size=[0.44, 0.44, 0.4], contents="logs")
# --- hall: a console and mirror on the study wall, a runner
furnish("farm_console", [3.0, -1.75, G], 180, [(0, 0, 0, 1.4, 0.36, 0.8)], length=1.4)
piece("farm_wall_mirror", [3.0, -1.93, G + 1.6], 180, size=[0.9, 0.7])
furnish("farm_rug", [3.0, 0.65, G], 0, size=[4.6, 1.0], mat="farm_rug_red", fringe=True)
# --- dining: a sideboard between the south windows, plants, art
furnish("farm_console", [11.75, -7.55, G], 180, [(0, 0, 0, 1.8, 0.4, 0.8)], length=1.8, depth=0.4, baskets=False)
wall_picture(11.75, -7.74, G + 1.8, 0, (1.1, 0.7), "farm_art", 3, "farm_walnut")
piece("farm_plant", [16.35, 2.95, G], 0, kind="tall", size=1.3)
piece("farm_plant", [6.6, -7.35, G], 0, kind="bushy", size=1.0)
piece("farm_plant", [6.6, 2.95, G], 0, kind="tall", size=1.1)
# --- kitchen: appliances and counter clutter on the north run, a dog bed, a bin, a rug at the sink
KZ = G + 0.92
piece("farm_microwave", [8.65, 14.38, KZ], 0)
piece("farm_utensil_crock", [9.05 + 1.2, 14.45, KZ], 0)
piece("farm_kettle", [9.75, 14.3, KZ + 0.02], 20)
piece("farm_coffee_maker", [10.75, 14.42, KZ], 0)
piece("farm_toaster", [11.3, 14.4, KZ], 0)
piece("farm_dish_rack", [11.85, 14.4, KZ], 0)
piece("farm_cutting_board", [13.65, 14.5, KZ], 0)
piece("farm_knife_block", [14.1, 14.5, KZ], 0)
piece("farm_canisters", [14.75, 14.45, KZ], 0)
piece("farm_fruit_bowl", [12.2, 8.75, G + 0.94], 0)
piece("farm_book_stack", [10.9, 8.5, G + 0.94], 10, count=2)
furnish("farm_dog_bed", [16.25, 7.4, G], -90, [(0, 0, 0, 0.9, 0.68, 0.2)], "fabric")
furnish("farm_trash_can", [6.42, 10.3, G], 90, [(0, 0, 0, 0.36, 0.3, 0.66)], "metal")
furnish("farm_rug", [12.6, 13.55, G], 0, size=[1.7, 0.75], mat="farm_rug_braid")
piece("farm_wall_shelf", [6.08, 7.2, G + 1.55], 90, length=1.2, items=["jar", "mugs", "plant"])
# --- family room: a game table, bean bags at the TV, toys, a blanket ladder, a side table by the sofa
furnish("farm_table", [-8.6, 5.0, G], 0, [(0, 0, 0.71, 0.9, 0.9, 0.07)], length=0.9, width=0.9, mat="farm_walnut")
for (cy, hd) in ((4.25, 180), (5.75, 0)):
    piece("farm_chair", [-8.6, cy, G], hd, cushion="farm_tweed")
piece("farm_chess", [-8.6, 5.0, G + 0.785], 10)
for (bx, by, m) in ((-15.0, 7.7, "farm_velvet_green"), (-15.0, 10.8, "farm_tweed")):
    furnish("farm_bean_bag", [bx, by, G], 90, [(0, 0, 0, 0.8, 0.7, 0.5)], "fabric", mat=m)
piece("farm_floor_toys", [-9.0, 12.0, G], 15)
piece("farm_blanket_ladder", [-8.9, 14.55, G], 0)
furnish("farm_basket", [-8.1, 14.4, G], 0, [(0, 0, 0, 0.5, 0.5, 0.35)], round=True, size=[0.5, 0.5, 0.35], contents="toys")
furnish("farm_side_table", [-10.0, 10.95, G], -90, TABLE45, lamp=True)
piece("farm_book_stack", [-12.4, 9.45, G + 0.45], 40, count=2)
piece("farm_mug", [-12.85, 9.0, G + 0.45], 0)
furnish("farm_pouf", [-13.2, 6.9, G], 0, [(0, 0, 0, 0.56, 0.56, 0.4)], "fabric")
# --- back hall, laundry, mudroom
piece("farm_plant", [-2.4, 3.9, G], 0, kind="bushy", size=0.9)
furnish("farm_ironing_board", [-3.4, 11.4, G], 0, [(0, 0, 0, 1.3, 0.4, 0.9)], "metal")
furnish("farm_drying_rack", [-2.55, 12.9, G], 90, [(0, 0, 0, 0.84, 0.6, 1.1)])
furnish("farm_basket", [-4.1, 13.5, G], 0, [(0, 0, 0, 0.55, 0.4, 0.34)], "fabric", size=[0.55, 0.4, 0.32], contents="laundry")
furnish("farm_basket", [-5.5, 11.6, G + 0.785], 90, size=[0.5, 0.36, 0.28], contents="laundry")
piece("farm_wall_shelf", [-5.92, 13.0, G + 1.5], 90, length=1.0, items=["towels", "jar"])
furnish("farm_shoe_cubby", [0.6, 7.75, G], 180, [(0, 0, 0, 1.2, 0.34, 0.55)], length=1.2, cushion="farm_gingham")
piece("farm_umbrella_stand", [5.65, 14.45, G], 0)
furnish("farm_basket", [1.8, 14.4, G], 0, [(0, 0, 0, 0.5, 0.4, 0.4)], size=[0.5, 0.4, 0.3], contents="logs")

# --- upstairs landing and the long hall: a reading chair, consoles, plants
furnish("farm_armchair", [-5.0, 0.2, U], 120, SEAT, "fabric", mat="farm_linen", pillow="farm_quilt")
piece("farm_floor_lamp", [-5.55, 1.1, U])
piece("farm_plant", [-0.55, -7.4, U], 0, kind="tall", size=1.0)
for (cx, ln) in ((-15.0, 1.2), (4.0, 1.4), (15.6, 1.2)):
    furnish("farm_console", [cx, 3.78, U], 180, [(0, 0, 0, ln, 0.36, 0.8)], length=ln, baskets=cx < 0)
for px in (-16.55, 16.55):
    piece("farm_plant", [px, 5.1, U], 0, kind="bushy", size=0.9)
# --- twins' room: a shared desk, bean bag, toys, teddies on the beds
furnish("farm_desk", [-11.0, -2.42, U], 0, [(0, 0, 0.72, 1.4, 0.7, 0.06), (0.48, 0.02, 0, 0.42, 0.68, 0.74)], length=1.4, mat="farm_cabinet_white")
piece("farm_chair", [-11.0, -3.15, U], 180, mat="farm_cabinet_white", cushion="farm_gingham")
piece("farm_desk_lamp", [-11.45, -2.3, U + 0.78], 0)
piece("farm_book_stack", [-10.6, -2.35, U + 0.78], 0, count=3)
furnish("farm_bean_bag", [-13.7, -3.5, U], 30, [(0, 0, 0, 0.8, 0.7, 0.5)], "fabric", mat="farm_wall_blue")
piece("farm_floor_toys", [-9.6, -4.5, U], 70)
furnish("farm_basket", [-6.55, -7.45, U], 0, [(0, 0, 0, 0.44, 0.44, 0.4)], round=True, size=[0.44, 0.44, 0.38], contents="toys")
for bx in (-11.75, -7.6):
    teddy_on_bed([bx, -6.7, U], 180, mat="farm_tweed" if bx < -9 else "farm_linen")
# --- girl's room: dollhouse, side table, bean bag, low bookcase, a toy shelf over the desk
piece("farm_dollhouse", [-13.0, -1.75, U], 180)
furnish("farm_side_table", [-16.5, 2.2, U], 90, TABLE45, lamp=True)
furnish("farm_bean_bag", [-9.8, -0.9, U], 200, [(0, 0, 0, 0.8, 0.7, 0.5)], "fabric", mat="farm_gingham")
furnish("farm_bookcase", [-6.33, 1.4, U], -90, [(0, 0, 0, 1.0, 0.34, 1.4)], length=1.0, height=1.4, mat="farm_cabinet_white")
piece("farm_wall_shelf", [-8.5, 3.42, U + 1.45], 0, length=1.1, items=["toys", "books", "frame"], cell=6)
teddy_on_bed([-15.72, 0.75, U], 90, mat="farm_wall_rose", bow="farm_cabinet_navy")
furnish("farm_pouf", [-12.0, 0.8, U], 0, [(0, 0, 0, 0.56, 0.56, 0.4)], "fabric", mat="farm_quilt")
# --- nursery: a crib, toys on the rug, a basket
furnish("farm_crib", [6.0, -7.35, U], 0, [(0, 0, 0, 1.32, 0.72, 1.0)])
piece("farm_floor_toys", [3.6, -5.1, U], 200)
furnish("farm_basket", [7.95, -2.6, U], 0, [(0, 0, 0, 0.44, 0.44, 0.4)], round=True, size=[0.44, 0.44, 0.38], contents="toys")
teddy_on_bed([5.0, -3.1, U], 0)
piece("farm_lamp", [1.3, -2.4, U + 0.9], 0, size=0.8)
# --- office: laptop and lamp on the desk, filing cabinet and printer, an ottoman at the sofa, a globe
piece("farm_laptop", [4.1, 3.0, U + 0.78], 0)
piece("farm_desk_lamp", [4.75, 3.25, U + 0.78], -20)
piece("farm_paper_stack", [3.5, 3.2, U + 0.78], 0, count=2)
furnish("farm_filing_cabinet", [7.95, -1.5, U], -90, [(0, 0, 0, 0.46, 0.62, 1.03)], decor=False)
piece("farm_printer", [7.95, -1.5, U + 1.03], -90)
furnish("farm_ottoman", [2.45, 0.6, U], 90, [(0, 0, 0, 0.9, 0.55, 0.44)], "fabric", size=[0.9, 0.55, 0.44], tray=True, mat="farm_tweed")
furnish("farm_globe", [2.0, -1.4, U], 0, [(0, 0, 0, 0.5, 0.5, 1.1)])
piece("farm_floor_lamp", [0.5, -1.55, U])
piece("farm_plant", [7.9, 3.0, U], 0, kind="tall", size=1.1)
wall_picture(4.2, 3.42, U + 1.65, 180, (0.9, 0.6), "farm_art", 1, "farm_walnut")
# --- guest room: luggage rack, plant, a blanket ladder
furnish("farm_luggage_rack", [15.8, 2.95, U], 0, [(0, 0, 0, 0.7, 0.45, 0.75)])
piece("farm_plant", [16.4, 2.9, U], 0, kind="tall", size=1.1)
piece("farm_blanket_ladder", [16.68, -2.75, U], -90, throws=["farm_quilt"])
wall_picture(8.58, -2.25, U + 1.75, 90, (0.9, 0.6), "farm_art", 2, "farm_walnut")
# --- main bedroom: a writing desk, ottoman by the reading chair, hamper
furnish("farm_desk", [-14.4, 5.95, U], 180, [(0, 0, 0.72, 1.2, 0.7, 0.06), (0.38, 0.02, 0, 0.42, 0.68, 0.74)], length=1.2, mat="farm_walnut")
piece("farm_chair", [-14.4, 6.7, U], 0, cushion="farm_velvet_green")
piece("farm_desk_lamp", [-14.85, 5.85, U + 0.78], 180)
piece("farm_paper_stack", [-14.1, 5.9, U + 0.78], 180, count=1)
furnish("farm_ottoman", [-9.2, 12.8, U], 225, [(0, 0, 0, 0.55, 0.45, 0.42)], "fabric", size=[0.55, 0.45, 0.42], mat="farm_linen")
furnish("farm_basket", [-8.4, 6.0, U], 0, [(0, 0, 0, 0.48, 0.48, 0.6)], "fabric", round=True, size=[0.48, 0.48, 0.55], lid=True)
# --- walk-in closet, main bath, family bath
furnish("farm_shoe_cubby", [-4.5, 5.85, U], 180, [(0, 0, 0, 1.4, 0.34, 0.55)], length=1.4)
furnish("farm_basket", [-3.2, 8.55, U], 0, [(0, 0, 0, 0.46, 0.46, 0.6)], "fabric", round=True, size=[0.46, 0.46, 0.55], lid=True)
furnish("farm_luggage_rack", [-6.55, 5.95, U], 90, [(0, 0, 0, 0.7, 0.45, 0.75)])
furnish("farm_rug", [-4.5, 13.4, U], 0, size=[0.9, 0.55], mat="farm_towel")
furnish("farm_stool", [-5.95, 14.35, U], 0, [(0, 0, 0, 0.36, 0.36, 0.5)], height=0.5, mat="farm_trim")
piece("farm_towel_stack", [-5.95, 14.35, U + 0.5], 10, count=3)
piece("farm_wall_shelf", [-2.08, 10.0, U + 1.4], -90, length=0.9, items=["towels", "bath", "plant"])
furnish("farm_basket", [-6.5, 9.5, U], 0, [(0, 0, 0, 0.44, 0.44, 0.6)], "fabric", round=True, size=[0.44, 0.44, 0.55], lid=True)
furnish("farm_rug", [2.5, 8.6, U], 0, size=[0.9, 0.55], mat="farm_towel")
furnish("farm_stool", [4.5, 9.55, U], 0, [(0, 0, 0, 0.36, 0.36, 0.5)], height=0.5, mat="farm_trim")
piece("farm_towel_stack", [4.5, 9.55, U + 0.5], -10, count=2, mat="farm_bedding")
piece("farm_wall_shelf", [0.08, 7.2, U + 1.4], 90, length=0.9, items=["bath", "towels"])
furnish("farm_basket", [0.45, 5.95, U], 0, [(0, 0, 0, 0.44, 0.44, 0.6)], "fabric", round=True, size=[0.44, 0.44, 0.55], lid=True)
# --- playroom: easel, bean bag, pouf, toys, small stools at the kids' table
piece("farm_easel", [1.3, 10.62, U], 180, cell=2)
furnish("farm_bean_bag", [4.3, 14.15, U], 200, [(0, 0, 0, 0.8, 0.7, 0.5)], "fabric", mat="farm_door_red")
furnish("farm_pouf", [4.2, 11.0, U], 0, [(0, 0, 0, 0.56, 0.56, 0.4)], "fabric")
piece("farm_floor_toys", [1.4, 13.7, U], 120)
for cy in (11.6, 12.8):
    piece("farm_stool", [2.5, cy, U], 0, height=0.32, mat="farm_cabinet_sage")
furnish("farm_basket", [0.45, 14.5, U], 0, [(0, 0, 0, 0.44, 0.44, 0.4)], round=True, size=[0.44, 0.44, 0.38], contents="toys")
piece("farm_wall_shelf", [2.5, 10.08, U + 1.5], 180, length=1.2, items=["toys", "jar", "books"])
# --- boy's room: bean bag, toys, a low bookcase, desk things, a teddy
furnish("farm_bean_bag", [6.0, 8.8, U], 150, [(0, 0, 0, 0.8, 0.7, 0.5)], "fabric", mat="farm_cabinet_navy")
piece("farm_floor_toys", [7.7, 10.1, U], 300)
furnish("farm_bookcase", [5.33, 7.0, U], 90, [(0, 0, 0, 1.0, 0.34, 1.4)], length=1.0, height=1.4, mat="farm_pine")
furnish("farm_basket", [10.55, 8.1, U], 0, [(0, 0, 0, 0.44, 0.44, 0.4)], round=True, size=[0.44, 0.44, 0.38], contents="toys")
piece("farm_desk_lamp", [5.6, 14.5, U + 0.78], 0)
piece("farm_book_stack", [6.4, 14.45, U + 0.78], 0, count=3)
teddy_on_bed([9.88, 12.3, U], -90)
# --- bedroom four: bedside tables, a reading chair and lamp, a bench at the foot, rug, blanket ladder
for ny in (8.95, 11.55):
    furnish("farm_side_table", [16.45, ny, U], -90, TABLE45, lamp=True)
furnish("farm_wingback", [12.2, 12.7, U], 120, [(0, 0, 0, 0.84, 0.82, 0.8), (0, 0.33, 0, 0.78, 0.2, 1.22)], "fabric", mat="farm_linen", pillow="farm_quilt")
piece("farm_floor_lamp", [11.5, 13.6, U])
furnish("farm_bench", [14.25, 10.25, U], 90, [(0, 0, 0, 1.2, 0.36, 0.5)], length=1.2, cushion="farm_tweed")
furnish("farm_rug", [14.0, 10.25, U], 90, size=[2.6, 2.0], mat="farm_rug_braid")
piece("farm_blanket_ladder", [16.3, 14.55, U], 0)

# --- third pass: the big rooms still had open floor
# dining: china hutches either side of the kitchen opening, a sideboard on the west wall, a reading nook
for hx in (8.5, 14.5):
    furnish("farm_bookcase", [hx, 3.2, G], 0, [(0, 0, 0, 1.4, 0.34, 2.1)], length=1.4, height=2.1, books=False, decor=True, mat="farm_cabinet_white")
furnish("farm_console", [6.25, -2.6, G], 90, [(0, 0, 0, 1.6, 0.36, 0.8)], length=1.6, baskets=False)
furnish("farm_wingback", [15.2, -6.7, G], 210, [(0, 0, 0, 0.84, 0.82, 0.8), (0, 0.33, 0, 0.78, 0.2, 1.22)], "fabric", mat="farm_tweed", pillow="farm_gingham")
furnish("farm_side_table", [16.4, -7.4, G], 180, TABLE45, lamp=True)
piece("farm_floor_lamp", [14.2, -7.45, G])
# kitchen: a painted hutch and a dresser on the dining wall, a rocking chair by the back door
furnish("farm_bookcase", [8.3, 3.75, G], 180, [(0, 0, 0, 1.4, 0.34, 2.1)], length=1.4, height=2.1, books=False, decor=True, mat="farm_cabinet_sage")
furnish("farm_dresser", [16.2, 3.82, G], 180, [(0, 0, 0, 1.0, 0.5, 0.9)], length=1.0, mat="farm_cabinet_sage", decor=True)
piece("farm_rocking_chair", [15.6, 11.0, G], -110, mat="farm_walnut")
# mudroom: a tall cupboard and a mat at the back door
furnish("farm_wardrobe", [5.67, 9.0, G], -90, [(0, 0, 0, 1.0, 0.58, 2.05)], length=1.0, mat="farm_cabinet_sage")
furnish("farm_rug", [3.0, 14.1, G], 0, size=[1.4, 0.9], mat="farm_rug_braid")
# powder room: a shelf over the toilet and a basket of towels
piece("farm_wall_shelf", [-1.6, 7.42, G + 1.5], 0, length=0.8, items=["towels", "plant"])
furnish("farm_basket", [-1.6, 4.0, G], 0, [(0, 0, 0, 0.42, 0.32, 0.3)], size=[0.42, 0.32, 0.3], contents="laundry")
# guest room: a bench at the bed's foot, a loveseat and ottoman, a writing desk
furnish("farm_bench", [10.95, -2.25, U], 90, [(0, 0, 0, 1.2, 0.36, 0.5)], length=1.2, cushion="farm_velvet_green")
furnish("farm_sofa", [13.85, -2.25, U], -90, [(0, 0.02, 0, 1.8, 0.95, 0.8)], "fabric", length=1.8, mat="farm_linen", pillows=["farm_gingham"])
furnish("farm_ottoman", [12.75, -2.25, U], 90, [(0, 0, 0, 0.8, 0.5, 0.42)], "fabric", size=[0.8, 0.5, 0.42], tray=True)
furnish("farm_desk", [16.42, -6.6, U], -90, [(0, 0, 0.72, 1.2, 0.7, 0.06), (0.38, 0.02, 0, 0.42, 0.68, 0.74)], length=1.2, mat="farm_cabinet_white")
piece("farm_chair", [15.65, -6.6, U], 90, mat="farm_cabinet_white", cushion="farm_linen")
piece("farm_desk_lamp", [16.5, -7.0, U + 0.78], -90)
# main bedroom: a second dresser on the south wall, a loveseat at the foot of the room facing the bed
furnish("farm_dresser", [-9.6, 5.82, U], 180, [(0, 0, 0, 1.4, 0.5, 0.9)], length=1.4, mat="farm_walnut", decor=True)
furnish("farm_sofa", [-9.6, 10.25, U], -90, [(0, 0.02, 0, 1.7, 0.95, 0.8)], "fabric", length=1.7, mat="farm_velvet_green", pillows=["farm_linen"])
# boy's room: a wardrobe, a toy chest, art over the bed
furnish("farm_wardrobe", [10.67, 14.3, U], -90, [(0, 0, 0, 1.0, 0.58, 2.05)], length=1.0, mat="farm_pine")
furnish("farm_crib_toys", [9.0, 14.5, U], 0, [(0, 0, 0, 0.84, 0.48, 0.55)])
wall_picture(10.92, 12.3, U + 1.6, -90, (0.7, 0.5), "farm_art", 0, "farm_pine")
piece("farm_floor_lamp", [5.5, 9.9, U])
furnish("farm_table", [7.0, 12.3, U], 0, [(0, 0, 0.48, 1.0, 0.7, 0.06)], length=1.0, width=0.7, height=0.52, mat="farm_pine")
for cy in (11.7, 12.9):
    piece("farm_stool", [7.0, cy, U], 0, height=0.32, mat="farm_cabinet_navy")
piece("farm_chess", [7.0, 12.3, U + 0.545], 30)
# bedroom four: a desk on the west wall, a plant
furnish("farm_desk", [11.35, 10.2, U], 90, [(0, 0, 0.72, 1.2, 0.7, 0.06), (0.38, 0.02, 0, 0.42, 0.68, 0.74)], length=1.2, mat="farm_pine")
piece("farm_chair", [12.1, 10.2, U], -90, mat="farm_pine", cushion="farm_gingham")
piece("farm_desk_lamp", [11.3, 10.65, U + 0.78], 90)
piece("farm_plant", [13.0, 14.45, U], 0, kind="tall", size=1.1)
# nursery: a low bookcase and a pouf
furnish("farm_bookcase", [0.33, -4.2, U], 90, [(0, 0, 0, 1.0, 0.34, 1.4)], length=1.0, height=1.4, mat="farm_cabinet_white")
furnish("farm_pouf", [3.0, -3.6, U], 0, [(0, 0, 0, 0.56, 0.56, 0.4)], "fabric", mat="farm_quilt")

# --- cast-iron radiators under the windows, where nothing already stands
SOLIDS = [e for e in P if e.get("mat") == INV and e["type"] == "box" and "base" in e]


def blocked(x0, y0, x1, y1, z0, z1):
    for e in SOLIDS:
        (bx, by, bz), (sx, sy, sz) = e["base"], e["size"]
        h = math.radians(e.get("heading", 0))
        hx = abs(math.cos(h)) * sx / 2 + abs(math.sin(h)) * sy / 2
        hy = abs(math.sin(h)) * sx / 2 + abs(math.cos(h)) * sy / 2
        if bx + hx > x0 and bx - hx < x1 and by + hy > y0 and by - hy < y1 and bz + sz > z0 and bz < z1:
            return True
    return False


for st, (z, _h) in STOREY.items():
    for side, lst in EXT[st].items():
        for o in lst:
            if o["bottom"] < 0.7 or (st, side) == ("G", "n") and 8 < o["at"] < 15.3:
                continue
            ln = o["width"] - 0.15
            face = {"s": Y0 + EXT_T, "n": Y1 - EXT_T, "w": X0 + EXT_T, "e": X1 - EXT_T}[side]
            hd = {"s": 180, "n": 0, "w": 90, "e": -90}[side]
            if side in "sn":
                x0, x1 = o["at"] - ln / 2, o["at"] + ln / 2
                y0, y1 = sorted((face, face + (0.24 if side == "s" else -0.24)))
                base = [o["at"], face, z]
            else:
                y0, y1 = o["at"] - ln / 2, o["at"] + ln / 2
                x0, x1 = sorted((face, face + (0.24 if side == "w" else -0.24)))
                base = [face, o["at"], z]
            if blocked(x0 - 0.12, y0 - 0.05, x1 + 0.05, y1 + 0.05, z, z + 0.7):
                continue
            furnish("farm_radiator", base, hd, [(0, -0.1, 0, ln, 0.2, 0.64)], "metal", length=ln)


# ============================================================================================== the yard
BX = BY = 35.0
P.append({"type": "floor", "min": [-BX, -BY], "max": [BX, BY], "z": 0.0, "thickness": 0.5, "mat": "farm_lawn"})
P.append({"type": "terrain", "inner": [[-BX, -BY], [BX, BY]], "extent": 640, "step": 12, "start": 80, "ramp": 260, "height": 8, "seed": 81, "mat": "farm_soil"})
# boundary: a clipped hedge all round, two gates in the south hedge (closed)
HEDGE_T, HEDGE_H = 1.1, 2.6
SOUTH = -33.8
south_gaps = [(-25.6, -22.4), (21.6, 26.4)]
for (a, b) in subtract_spans(-34.4, 34.4, south_gaps):
    piece("farm_hedge", [0, 0, 0], 0, p0=[a, SOUTH], p1=[b, SOUTH], height=HEDGE_H, thickness=HEDGE_T)
    solid([(a + b) / 2, SOUTH, 0], [b - a, HEDGE_T, 3.2], surface="fabric", occlude=True)
for (p0, p1) in [((-34.4, 33.8), (34.4, 33.8)), ((-33.8, -34.4), (-33.8, 34.4)), ((33.8, -34.4), (33.8, 34.4))]:
    piece("farm_hedge", [0, 0, 0], 0, p0=list(p0), p1=list(p1), height=HEDGE_H, thickness=HEDGE_T)
    cx, cy = (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2
    solid([cx, cy, 0], [abs(p1[0] - p0[0]) or HEDGE_T, abs(p1[1] - p0[1]) or HEDGE_T, 3.2], surface="fabric", occlude=True)
piece("farm_gate", [24.0, SOUTH, 0], 0, width=4.2, height=2.0)
solid([24.0, SOUTH, 0], [5.4, 0.6, 3.2], surface="wood", occlude=True)
piece("farm_gate", [-24.0, SOUTH, 0], 0, width=2.4, height=1.8)
solid([-24.0, SOUTH, 0], [3.6, 0.6, 3.2], surface="wood", occlude=True)
P.append({"type": "sign", "text": "HOLLISTER FARM", "pos": [24.0, SOUTH - 0.08, 3.0], "heading": 0, "scale": 0.42, "color": [0.96, 0.93, 0.85, 1]})
# driveway, parking pad, garden path
floor(21.8, -34.6, 26.2, -17.5, 0.03, 0.06, "farm_gravel", occlude=False)
floor(17.5, -18.5, 28.5, -9.0, 0.03, 0.06, "farm_gravel", occlude=False)
floor(-25.0, -33.8, -23.0, -19.0, 0.025, 0.05, "farm_flagstone", occlude=False)
floor(-25.0, -21.0, -2.0, -19.0, 0.025, 0.05, "farm_flagstone", occlude=False)
floor(-4.0, -19.0, -2.0, -11.6, 0.025, 0.05, "farm_flagstone", occlude=False)
floor(14.0, -11.0, 18.0, -9.0, 0.025, 0.05, "farm_flagstone", occlude=False)
floor(17.0, 8.0, 21.0, 11.0, 0.025, 0.05, "farm_flagstone", occlude=False)
floor(1.5, 15.0, 4.5, 24.0, 0.025, 0.05, "farm_flagstone", occlude=False)
# flower beds along the porch and the house, shrubs at the corners
for (x0, y0, x1, y1) in [(-14.0, -12.6, -4.4, -11.2), (-1.6, -12.6, 14.0, -11.2), (-17.0 - 1.4, -8.0, -17.0, -4.0), (-18.4, 3.0, -17.0, 15.0), (17.0, 1.2, 18.4, 7.8), (6.0, 15.0, 16.0, 16.4)]:
    piece("farm_flower_bed", [0, 0, 0], 0, min=[x0, y0], max=[x1, y1])
for (sx, sy, r) in [(-18.3, -9.4, 0.8), (18.6, -9.2, 0.8), (-18.3, 16.2, 0.9), (17.9, 16.3, 0.9), (-14.8, -12.0, 0.6), (14.8, -12.0, 0.6)]:
    piece("farm_shrub", [sx, sy, 0], 0, radius=r, flowers="farm_wall_rose" if r < 0.7 else None)
    solid([sx, sy, 0], [r * 1.4, r * 1.4, r * 1.6], surface="fabric", occlude=True)
# shade trees, a tire swing
for (tx, ty, h, sp) in [(-26.0, -8.0, 10.0, 4.2), (-14.0, -24.0, 8.5, 3.6), (-27.0, 26.0, 11.0, 4.5), (27.0, 22.0, 9.5, 4.0), (10.0, 27.0, 8.0, 3.4), (28.0, -2.0, 9.0, 3.8)]:
    piece("farm_tree", [tx, ty, 0], 0, height=h, spread=sp)
    solid([tx, ty, 0], [0.6, 0.6, h * 0.45], surface="wood", occlude=True)
piece("farm_tire_swing", [-24.3, -8.0, 0], 0, height=0.55, rope=3.0)
solid([-24.3, -8.0, 0.2], [0.8, 0.8, 0.75], surface="fabric")
# vegetable garden in the west yard, with a picket fence and a gate gap
for i, (gx, gy, kind) in enumerate([(-28.0, 10.0, "lettuce"), (-28.0, 13.5, "tomato"), (-28.0, 17.0, "lettuce"), (-23.0, 10.0, "tomato"), (-23.0, 13.5, "lettuce"), (-23.0, 17.0, "tomato")]):
    piece("farm_raised_bed", [gx, gy, 0], 0, length=3.0, width=1.2, kind=kind)
    solid([gx, gy, 0], [3.0, 1.2, 0.42], surface="wood", occlude=False)
for (p0, p1) in [((-31.0, 7.5), (-31.0, 19.5)), ((-31.0, 19.5), (-20.0, 19.5)), ((-20.0, 19.5), (-20.0, 7.5)), ((-31.0, 7.5), (-27.0, 7.5)), ((-24.0, 7.5), (-20.0, 7.5))]:
    piece("farm_picket_fence", [0, 0, 0], 0, p0=list(p0), p1=list(p1))
    cx, cy = (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2
    solid([cx, cy, 0], [abs(p1[0] - p0[0]) or 0.1, abs(p1[1] - p0[1]) or 0.1, 1.15], surface="wood")
# clothesline with sheets, the mailbox, lamp posts, a swing bench under the back tree
for px in (22.0, 30.0):
    vbox([px, 28.0, 0], [0.1, 0.1, 2.2], "farm_trim")
    vbox([px, 28.0, 2.1], [0.1, 1.2, 0.08], "farm_trim")
    solid([px, 28.0, 0], [0.15, 0.15, 2.2])
for dy in (-0.5, 0.0, 0.5):
    vcbox([26.0, 28.0 + dy, 2.12], [8.0, 0.01, 0.01], "farm_linen")
for i, (sx, mat) in enumerate([(23.2, "farm_bedding"), (24.9, "farm_quilt"), (27.0, "farm_gingham"), (28.7, "farm_towel")]):
    vbox([sx, 28.0 - 0.5 + (i % 3) * 0.5, 1.15], [1.4, 0.02, 0.95], mat)
piece("farm_mailbox", [27.4, -32.6, 0], 0)
for (lx, ly) in [(-24.0, -26.0), (-12.0, -20.0), (-3.0, -15.0), (24.0, -20.0)]:
    piece("farm_lamp_post", [lx, ly, 0], 0)
    solid([lx, ly, 0], [0.2, 0.2, 2.6], surface="metal")
    light([lx, ly, 2.5], 2700, 3, 6)
piece("farm_bench", [-25.5, 23.0, 0], 30, length=1.6, cushion="farm_gingham")
solid([-25.5, 23.0, 0], [1.6, 0.4, 0.5], 30)
# cars: the family's by the house, the attackers' at the gate end of the driveway
P.append({"type": "vehicle", "kind": "sedan", "base": [19.6, -13.0, 0.0], "heading": 2, "visual": "family_suv"})
P.append({"type": "vehicle", "kind": "sedan", "base": [23.6, -13.4, 0.0], "heading": -6, "visual": "teal_estate"})
P.append({"type": "vehicle", "kind": "sedan", "base": [21.3, -27.0, 0.0], "heading": 176, "visual": "red_hatch"})
P.append({"type": "vehicle", "kind": "lorry", "base": [-17.0, -29.5, 0.0], "heading": 92})

# ---- scenery beyond the hedge: the county road, fields, the barn and silos far off (no collision)
vbox([0, -42.0, -0.03], [400, 8.0, 0.06], "farm_asphalt")
for x in range(-120, 121, 8):
    vbox([x, -42.0, 0.004], [3.5, 0.15, 0.01], "farm_trim")
vbox([0, -37.0, -0.02], [400, 2.2, 0.05], "farm_gravel")
V.append({"type": "crop_surface", "min": [-140, -110], "max": [140, -46.5], "height": 0.85, "mat": "farm_wheat", "seed": 3})
V.append({"type": "crop_surface", "min": [-140, -35.5], "max": [-37.5, 120], "height": 2.3, "mat": "farm_corn_leaf", "seed": 5})
V.append({"type": "crop_surface", "min": [37.5, -35.5], "max": [140, 120], "height": 0.85, "mat": "farm_wheat", "seed": 7})
V.append({"type": "crop_surface", "min": [-37.5, 37.5], "max": [37.5, 120], "height": 2.3, "mat": "farm_corn_leaf", "seed": 9})
# rows of real plants along the near edge of each field, so it reads as a crop over the hedge
V.append({"type": "crop_field", "kind": "corn", "rows": "y", "min": [-39.2, -34.0], "max": [-37.6, 36.0], "mat": "farm_corn_leaf", "top_mat": "farm_wheat", "step": 0.55, "seed": 11})
V.append({"type": "crop_field", "kind": "corn", "rows": "x", "min": [-36.0, 37.6], "max": [36.0, 39.2], "mat": "farm_corn_leaf", "top_mat": "farm_wheat", "step": 0.55, "seed": 13})
piece("farm_barn_scenery", [-62.0, 78.0, 2.25], 15, width=16, length=24, height=7)
piece("farm_silo_scenery", [-44.0, 82.0, 2.25], 0, radius=3.6, height=13)
piece("farm_silo_scenery", [-36.0, 84.0, 2.25], 0, radius=3.2, height=11.5)
piece("farm_silo_scenery", [-40.0, 92.0, 2.25], 0, radius=4.0, height=15)
for (tx, ty) in [(-80, 40), (-70, 50), (60, 70), (75, 55), (50, -70), (-60, -80)]:
    piece("farm_tree", [tx, ty, 0], 0, height=12, spread=5.0)

# ======================================================================================== gameplay data
for (x, y) in [(22.2, -31.6), (24.0, -31.2), (25.8, -31.6), (-24.8, -31.4), (-23.2, -31.0)]:
    P.append({"type": "spawn", "team": "attack", "pos": [x, y, 0.1], "heading": 0})
for (x, y, hd) in [(-3.6, -6.2, 0), (-3.6, 1.6, 180), (3.0, 4.5, 90), (11.0, 4.5, 90), (-11.0, 4.5, -90)]:
    P.append({"type": "spawn", "team": "defend", "pos": [x, y, UF + 0.05], "heading": hd})
P.append({"type": "zone", "name": "Attack buy zone", "kind": "buyzone", "team": "attack", "min": [-33, -33.4, -1], "max": [33, -26, 5]})
P.append({"type": "zone", "name": "Defend buy zone", "kind": "buyzone", "team": "defend", "min": [X0, Y0, UF - 0.1], "max": [X1, Y1, TOP]})
P.append({"type": "zone", "name": "A", "kind": "bombsite", "min": [6.1, -7.9, 0.3], "max": [16.9, 14.9, 3.4]})
P.append({"type": "zone", "name": "B", "kind": "bombsite", "min": [-16.9, -7.9, 0.3], "max": [-6.1, 14.9, 3.4]})
for (name, pos, hd, pitch) in [("Front porch", [-6.0, -10.7, GF + 2.7], 200, -14), ("Driveway", [17.3, -9.2, 3.2], 210, -12),
                               ("Back patio", [-11.5, 15.3, 3.0], 0, -12), ("East yard", [17.3, 15.3, 3.0], 120, -12),
                               ("West yard", [-17.3, -8.3, 3.2], 210, -12)]:
    P.append({"type": "camera", "name": name, "pos": pos, "heading": hd, "pitch": pitch})
for args in [("South Lawn", -33, -33.8, 33, -11), ("Driveway", 17.5, -34, 28.5, -9), ("Garden Gate", -27, -34, -21, -28), ("Front Porch", -14, -11.6, 14, -8),
             ("West Yard", -33.8, -11, -17, 33.8), ("Vegetable Garden", -31, 7.5, -20, 19.5), ("Back Yard", -17, 15, 17, 33.8), ("Patio", -15.5, 15, -7.5, 20.5),
             ("East Yard", 17, -9, 33.8, 33.8), ("Clothesline", 20, 25, 32, 31), ("Deck", 17.2, -2.5, 19.6, 0.6), ("Outside Stairs", 17.3, -7.3, 18.6, -2.4),
             ("Main Stairs", -1.6, -5.2, 0, -0.7), ("Back Stairs", -1.8, 10.1, -0.2, 14.9)]:
    callout(*args)

environment = {
    "hdri": "kloofendal_48d_partly_cloudy_puresky", "hdri_candidates": ["syferfontein_1d_clear_puresky", "kloppenheim_06_puresky"],
    "sun_clamp": 1.6, "sky_target": 0.85, "ibl_specular": 0.9, "ambient_floor": [0.006, 0.0055, 0.005],
    "post": {"bloom": {"intensity": 0.2, "threshold": 1.5, "knee": 0.6, "scatter": 0.7}, "vignette": {"strength": 0.24, "start": 0.48},
             "auto_exposure": {"strength": 0.6, "min_ev": -1.0, "max_ev": 1.6, "reference": -1.5, "speed_up": 3.0, "speed_down": 1.1},
             "sharpen": 1.0, "grain": 0.02,
             "grading": {"saturation": 1.0, "vibrance": 0.75, "contrast": 1.06, "toe": 0.12, "lift": [0.004, 0.004, 0.005], "gain": [1.05, 1.0, 0.94],
                         "split_tone": 0.6, "shadow_tint": [0.95, 0.98, 1.06], "highlight_tint": [1.06, 1.0, 0.92]}},
    "sun_dir": [-0.55, -0.6, 0.58], "sun_intensity": 4.4, "sun_color": [1.0, 0.86, 0.68],
    "sky": {"turbidity": 3.5, "rayleigh": 1.8, "mie": 0.005, "mie_g": 0.85}, "sky_exposure": 0.5,
    "clouds": {"coverage": 0.3, "softness": 0.24, "scale": 1.0, "color": [1.0, 0.96, 0.9], "shade": [0.62, 0.62, 0.66], "streak": 0.4, "brightness": 1.1},
    "fog": {"density": 0.0026, "height_falloff": 0.05, "base_height": 0.0, "max_opacity": 0.42, "sun_scatter": 0.5, "color": [0.82, 0.78, 0.7]},
    "ground": [0.27, 0.25, 0.2], "bounce_ground": 0.55, "bounce_sun": 0.85, "bounce": 0.16, "ibl_diffuse": 1.0, "exposure": 0.95,
    "light_gain": 1.6, "dust_color": [0.5, 0.48, 0.4], "macro_variation": 0.6,
}

data = {
    "name": "Hollister Farm",
    "description": "A big two-storey family farmhouse among corn and wheat: the dining room and kitchen (A), the living and family rooms (B), three staircases and a garden yard.",
    "environment": environment,
    "bounds": [[-BX, -BY, -1.0], [BX, BY, 16]],
    "skyvis_spacing": [1.0, 1.0, 1.0],
    "material_pack": "/assets/g/textures/farm_materials.json",
    "briefing": {
        "region": "Corn country, Nebraska (fictional county), late summer",
        "attack": "Come in through the driveway gate or the garden gate and take the house: the porch, the patio, the side doors or the outside stair.",
        "defend": "Hold the house from upstairs; rotate through the foyer, the back hall and the upstairs hall.",
        "A": "The dining room and the kitchen on the east side: a long dining table, the island, the back stair from the mudroom.",
        "B": "The living room and the family room on the west side: the fireplace, the piano, the sofas and the french doors to the patio.",
    },
    "pieces": P,
    "visual_pieces": V,
    "camera_shots": [
        {"name": "overview", "pos": [30, -40, 28], "hpr": [36, -30, 0]},
        {"name": "front", "pos": [6, -27, 1.75], "hpr": [12, 6, 0]},
        {"name": "foyer", "pos": [-4.6, -7.2, G + 1.65], "hpr": [-25, 4, 0]},
        {"name": "living", "pos": [-6.7, -6.8, G + 1.65], "hpr": [55, -6, 0]},
        {"name": "family", "pos": [-6.8, 5.0, G + 1.65], "hpr": [60, -6, 0]},
        {"name": "dining", "pos": [6.8, -7.2, G + 1.65], "hpr": [-40, -6, 0]},
        {"name": "kitchen", "pos": [7.0, 4.2, G + 1.65], "hpr": [-40, -4, 0]},
        {"name": "study", "pos": [0.8, -2.6, G + 1.65], "hpr": [-145, -8, 0]},
        {"name": "mudroom", "pos": [5.5, 8.2, G + 1.65], "hpr": [50, -2, 0]},
        {"name": "main_bedroom", "pos": [-7.8, 6.2, U + 1.65], "hpr": [62, -8, 0]},
        {"name": "main_bath", "pos": [-2.6, 9.6, U + 1.65], "hpr": [40, -10, 0]},
        {"name": "guest", "pos": [15.9, -7.3, U + 1.65], "hpr": [38, -8, 0]},
        {"name": "twins", "pos": [-6.6, -2.6, U + 1.65], "hpr": [130, -10, 0]},
        {"name": "landing", "pos": [-5.4, 3.0, U + 1.65], "hpr": [-160, -12, 0]},
        {"name": "back_yard", "pos": [-2, 31, 2.0], "hpr": [180, 6, 0]},
    ],
    "test_routes": [
        {"name": "B via porch", "start": [-24, -31, 0.1, 0], "waypoints": [[-24, -20], [-3, -20], [-3, -12], [-3, -9.5, GF], [-3, -6, GF], [-6, -2.5, GF], [-11, -2.5, GF]]},
        {"name": "B via patio", "start": [-24, -31, 0.1, 0], "waypoints": [[-28, -12], [-22, 18], [-11.5, 17], [-11.5, 14.5, GF], [-11.5, 9, GF]]},
        {"name": "A via side door", "start": [24, -31, 0.1, 0], "waypoints": [[24, -20], [26, 0], [19, 9.5], [16.5, 9.5, GF], [12, 6, GF]]},
        {"name": "A via front door", "start": [24, -31, 0.1, 0], "waypoints": [[20, -20], [-3, -13], [-3, -9.5, GF], [-3, -6, GF], [3, 1.2, GF], [10, 0.6, GF]]},
        {"name": "Upstairs via outside stairs", "start": [24, -31, 0.1, 0], "waypoints": [[22, -16], [18, -8], [17.95, -7.4], [17.95, -2.3, UF], [16, -0.9, UF], [12, -1, UF]]},
    ],
    "practice_positions": {
        "defend": [[11.5, 0.5, GF, 180, 0], [14.5, 11, GF, 200, 1], [8, 13, GF, 160, 0], [-11, -5, GF, 180, 0], [-14, 12, GF, 160, 1], [-8, 1, GF, 210, 0],
                   [-3.5, -6, UF, 180, 0], [12, -6, UF, 180, 1], [-12, -6, UF, 200, 0], [3, 4.5, UF, 180, 0]],
        "attack": [[-24, -25, 0.02, 0, 0], [24, -24, 0.02, 0, 0], [-28, 0, 0.02, 30, 0], [28, 0, 0.02, -30, 1], [0, -18, 0.02, 0, 0]],
    },
    "modes": {"duel": {
        "_comment": "1v1 duels: site A only (dining room and kitchen); a player-clip wall along x = -6.6 closes the west half (living, family, west yard).",
        "sites": ["A"],
        "spawns": [{"team": "attack", "pos": [24.0, -31.2, 0.1], "heading": 0}, {"team": "defend", "pos": [11.0, 4.5, UF + 0.05], "heading": 180}],
        "clips": [{"center": [-6.6, 0.0, 8.0], "size": [0.3, 70.0, 20.0]}],
    }},
    "bot_waypoints": [
        {"name": "Garden Gate", "pos": [-24.0, -27.0, 0.02]}, {"name": "Driveway", "pos": [24.0, -24.0, 0.02]}, {"name": "West Yard", "pos": [-26.0, 2.0, 0.02]},
        {"name": "East Yard", "pos": [26.0, 6.0, 0.02]}, {"name": "Patio", "pos": [-11.5, 18.5, 0.03]}, {"name": "Front Porch", "pos": [-3.0, -9.5, GF]},
    ],
    "environment_rework": "environment-r6",
}

with open(OUT, "w") as f:
    json.dump(data, f, separators=(", ", ": "))
    f.write("\n")
print(f"wrote {os.path.relpath(OUT, ROOT)}: {len(P)} pieces, {len(V)} visual pieces")
