#!/usr/bin/env python3
"""Generates the Desert Vanguard brand files: the chevron symbol, the full logo (text converted to outlines, so it
needs no fonts), the favicon, and copies the web fonts the site uses into client/dist/assets/fonts/.

    python3 scripts/brand/make_assets.py [--fonts DIR]

DIR holds the @fontsource packages (npm pack @fontsource/<name>, unpacked as DIR/x-<name>); fonts are only needed to
(re)generate the logo. Needs fontTools (pip install fonttools).
"""
import os, shutil, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "client", "dist", "assets", "brand")
FONTS_OUT = os.path.join(ROOT, "client", "dist", "assets", "fonts")
SRC = os.path.join(ROOT, "scripts", "brand", "fonts")      # the .woff files this script reads, kept in the repo
AMBER, SAND, INK = "#EDA93C", "#F5C879", "#101216"


def chev(cx, y, half, depth, h):
    return f"M{cx-half} {y}L{cx} {y+depth}L{cx+half} {y}V{y-h}L{cx} {y+depth-h}L{cx-half} {y-h}Z"


def symbol_paths(fg=AMBER, acc=SAND):
    return (f'<path d="{chev(50, 26, 44, 34, 17)}" fill="{fg}"/><path d="{chev(50, 52, 33, 26, 15)}" fill="{fg}"/>'
            f'<path d="{chev(50, 76, 22, 17, 13)}" fill="{acc}"/>')


def text_outline(woff, text, size, tracking, x, y):
    """SVG path data for text set in a font at (x, baseline y), plus its width and cap height."""
    f = TTFont(woff)
    gs, cmap, upm = f.getGlyphSet(), f.getBestCmap(), f["head"].unitsPerEm
    s = size / upm
    pen = SVGPathPen(gs, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
    cx = x
    for i, ch in enumerate(text):
        g = gs[cmap[ord(ch)]]
        g.draw(TransformPen(pen, (s, 0, 0, -s, cx, y)))
        cx += g.width * s + (tracking * size if i < len(text) - 1 else 0)
    cap = getattr(f["OS/2"], "sCapHeight", 0) * s or size * 0.7
    return pen.getCommands(), cx - x, cap


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(FONTS_OUT, exist_ok=True)
    # symbol
    with open(os.path.join(OUT, "desert-vanguard-symbol.svg"), "w") as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><title>Desert Vanguard symbol</title>{symbol_paths()}</svg>\n')
    # favicon: the symbol on a rounded dark tile
    with open(os.path.join(ROOT, "client", "dist", "favicon.svg"), "w") as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><title>Desert Vanguard</title><rect width="100" height="100" rx="22" fill="{INK}"/>'
                f'<g transform="translate(14 14) scale(.72)">{symbol_paths()}</g></svg>\n')
    # full logo: symbol, then DESERT (spaced) over VANGUARD (stencil)
    stencil = os.path.join(SRC, "big-shoulders-stencil-display-latin-800-normal.woff")
    label = os.path.join(SRC, "barlow-condensed-latin-600-normal.woff")
    v_size = 170
    d1, w_v, cap_v = text_outline(stencil, "VANGUARD", v_size, 0.03, 0, 0)
    d_size = 62
    _, w_d, cap_d = text_outline(label, "DESERT", d_size, 0.62, 0, 0)
    sym = 200                                    # symbol height
    gap, x0 = 34, sym + 34
    top = 6
    base_d = top + cap_d
    base_v = base_d + 20 + cap_v
    d1, w_v, _ = text_outline(stencil, "VANGUARD", v_size, 0.03, x0, base_v)
    d2, w_d, _ = text_outline(label, "DESERT", d_size, 0.62, x0 + 6, base_d)
    width = int(x0 + max(w_v, w_d) + 6)
    height = int(max(sym, base_v + 8))
    sy = (height - sym) / 2
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}"><title>Desert Vanguard</title>'
           f'<g transform="translate(0 {sy:.1f}) scale({sym/100})">{symbol_paths()}</g>'
           f'<path d="{d2}" fill="{SAND}"/><path d="{d1}" fill="{AMBER}"/></svg>\n')
    with open(os.path.join(OUT, "desert-vanguard-logo.svg"), "w") as f:
        f.write(svg)
    # the same on a dark tile, for pages with a white background (the README)
    pad = 44
    banner = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width + 2 * pad}" height="{height + 2 * pad}" viewBox="0 0 {width + 2 * pad} {height + 2 * pad}">'
              f'<title>Desert Vanguard</title><rect width="100%" height="100%" rx="28" fill="{INK}"/><g transform="translate({pad} {pad})">'
              + svg.split("</title>", 1)[1].rsplit("</svg>", 1)[0] + '</g></svg>\n')
    with open(os.path.join(OUT, "desert-vanguard-banner.svg"), "w") as f:
        f.write(banner)
    print("logo", width, "x", height)
    # web fonts for the site and the in-game start screen
    for name in ("big-shoulders-stencil-display-latin-800-normal", "barlow-condensed-latin-600-normal", "barlow-condensed-latin-700-normal"):
        src = os.path.join(SRC, name + ".woff2")
        if os.path.exists(src):
            dst = os.path.join(FONTS_OUT, name.replace("-latin", "").replace("-normal", "") + ".woff2")
            shutil.copyfile(src, dst)
            print("font", os.path.basename(dst))


if __name__ == "__main__":
    main()
