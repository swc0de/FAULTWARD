#!/usr/bin/env python3
"""Markdown table of a phase's metrics (and the change against an earlier phase), for docs/graphics-progress.md.

    python3 scripts/shots/metrics_table.py <phase> [--vs <earlier phase>]
"""
import json, os, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
KINDS = ["wide", "street", "interior", "wall", "vehicle", "char3", "char10", "site"]


def load(phase):
    return json.load(open(os.path.join(ROOT, "shots", phase, "metrics.json")))


def main():
    phase = sys.argv[1]
    vs = sys.argv[sys.argv.index("--vs") + 1] if "--vs" in sys.argv else None
    m, b = load(phase), load(vs) if vs else None
    print(f"Renderer: {m.get('renderer')}, viewport {m.get('viewport')}, timing window {m.get('seconds')} s.\n")
    print("| Map | Shot | Draw calls | Triangles | Frame ms | Texture MB (est.) |" + (" Δ calls | Δ tris |" if b else ""))
    print("| --- | --- | ---: | ---: | ---: | ---: |" + (" ---: | ---: |" if b else ""))
    for key, mp in m["maps"].items():
        for k in KINDS:
            s = mp["shots"].get(k)
            if not s:
                print(f"| {key} | {k} | missing | | | |" + (" | |" if b else ""))
                continue
            row = f"| {key} | {k} | {s['draw_calls']} | {s['triangles'] / 1e6:.2f}M | {s['avg_ms']:.0f} | {s['texture_mb_est']} |"
            if b:
                o = b["maps"].get(key, {}).get("shots", {}).get(k)
                row += f" {s['draw_calls'] - o['draw_calls']:+d} | {(s['triangles'] - o['triangles']) / 1e6:+.2f}M |" if o else " | |"
            print(row)
    print()
    print("| Map | Load (ms) | Console errors |")
    print("| --- | ---: | --- |")
    for key, mp in m["maps"].items():
        errs = mp.get("console_errors") or []
        print(f"| {key} | {mp.get('load_ms', '')} | {len(errs)}{': ' + '; '.join(e[:80] for e in errs[:2]) if errs else ''} |")


if __name__ == "__main__":
    main()
