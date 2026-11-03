#!/usr/bin/env python3
"""Contact sheets for reviewing a phase's shots, and side-by-side sheets for comparing two phases.

    python3 scripts/shots/contact_sheet.py <phase>                 -> shots/<phase>/sheet-<map>.jpg
    python3 scripts/shots/contact_sheet.py <phase> --vs <earlier>  -> shots/<phase>/vs-<earlier>-<map>.jpg

Each sheet is one map: a 4 x 2 grid of its 8 shots (or, with --vs, one row per shot: earlier | this phase),
labelled with the shot kind and its draw calls / triangles from metrics.json.
"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
KINDS = ["wide", "street", "interior", "wall", "vehicle", "char3", "char10", "site"]
TILE = (800, 450)


def font(size):
    for f in ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "C:/Windows/Fonts/arialbd.ttf"]:
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def tile(phase, key, kind, metrics):
    for ext in (".jpg", ".png"):
        p = os.path.join(ROOT, "shots", phase, key, kind + ext)
        if os.path.exists(p):
            im = Image.open(p).convert("RGB").resize(TILE, Image.LANCZOS)
            break
    else:
        im = Image.new("RGB", TILE, (40, 40, 40))
    m = metrics.get("maps", {}).get(key, {}).get("shots", {}).get(kind)
    label = f"{phase} · {kind}"
    if m:
        label += f" · {m['draw_calls']} calls · {m['triangles'] / 1e6:.2f}M tris · {m['avg_ms']:.0f} ms"
    d = ImageDraw.Draw(im)
    f = font(17)
    w = d.textlength(label, font=f)
    d.rectangle([0, 0, w + 16, 28], fill=(0, 0, 0))
    d.text((8, 4), label, fill=(255, 255, 255), font=f)
    return im


def load_metrics(phase):
    p = os.path.join(ROOT, "shots", phase, "metrics.json")
    return json.load(open(p)) if os.path.exists(p) else {}


def main():
    phase = sys.argv[1]
    vs = sys.argv[sys.argv.index("--vs") + 1] if "--vs" in sys.argv else None
    mt, mv = load_metrics(phase), load_metrics(vs) if vs else {}
    keys = sorted(d for d in os.listdir(os.path.join(ROOT, "shots", phase)) if os.path.isdir(os.path.join(ROOT, "shots", phase, d)))
    for key in keys:
        if vs:
            sheet = Image.new("RGB", (TILE[0] * 2, TILE[1] * len(KINDS)))
            for r, k in enumerate(KINDS):
                sheet.paste(tile(vs, key, k, mv), (0, r * TILE[1]))
                sheet.paste(tile(phase, key, k, mt), (TILE[0], r * TILE[1]))
            out = os.path.join(ROOT, "shots", phase, f"vs-{vs}-{key}.jpg")
        else:
            sheet = Image.new("RGB", (TILE[0] * 4, TILE[1] * 2))
            for i, k in enumerate(KINDS):
                sheet.paste(tile(phase, key, k, mt), ((i % 4) * TILE[0], (i // 4) * TILE[1]))
            out = os.path.join(ROOT, "shots", phase, f"sheet-{key}.jpg")
        sheet.save(out, quality=85)
        print(out)


if __name__ == "__main__":
    main()
