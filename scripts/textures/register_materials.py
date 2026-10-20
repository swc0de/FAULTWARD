#!/usr/bin/env python3
"""Adds the generated farm_* materials (client/dist/assets/g/textures/farm_materials.json) to the material tables
compiled into the game: the match worker (server/dist/worker.mjs: surface and uv scale for collision sounds and
penetration) and the client's settings chunk (soft-wall panels and client-side collision). Idempotent: an earlier
block is replaced. The changed client chunk and every chunk that imports it get new content-hashed names, and
client/dist/.vite/manifest.json is updated, so browsers holding the old (immutable-cached) files load the new ones.

    python3 scripts/textures/register_materials.py
"""
import base64, hashlib, json, os, re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DIST = os.path.join(ROOT, "client", "dist")
PACK = os.path.join(DIST, "assets", "g", "textures", "farm_materials.json")
START, END = "/*farm-materials*/", "/*end-farm-materials*/"


def entries(js_keys):
    pack = json.load(open(PACK))
    if js_keys:
        return ",".join(f'{k}:{{surface:"{v["surface"]}",uv_scale:{v["uv_scale"]}}}' for k, v in pack.items())
    return "".join(f'\n  {k}: {{ surface: "{v["surface"]}", uv_scale: {v["uv_scale"]} }},' for k, v in pack.items())


def strip(s):
    return re.sub(re.escape(START) + r".*?" + re.escape(END), "", s, flags=re.S)


# ---- server worker
wp = os.path.join(ROOT, "server", "dist", "worker.mjs")
s = strip(open(wp).read())
anchor = "var materials_default = {"
assert s.count(anchor) == 1
s = s.replace(anchor, anchor + START + entries(False) + "\n  " + END)
open(wp, "w").write(s)

# ---- client settings chunk, then re-hash it and its importers
man_path = os.path.join(DIST, ".vite", "manifest.json")
man = json.load(open(man_path))
chunk_key = next(k for k, v in man.items() if v["file"].startswith("assets/settings-") and v["file"].endswith(".js") and "src" not in v)
old_file = man[chunk_key]["file"]
s = strip(open(os.path.join(DIST, old_file)).read())
anchor = re.search(r",(\w+)=\{_comment:\w+,concrete_wall:", s)
assert anchor, "client material table not found"
i = anchor.end() - len("concrete_wall:")
s = s[:i] + START + entries(True) + "," + END + s[i:]


def new_name(path, content):
    stem = os.path.basename(path).split("-")[0]
    h = base64.urlsafe_b64encode(hashlib.sha256(content.encode()).digest())[:8].decode().replace("-", "x").replace("_", "y")
    return f"assets/{stem}-{h}.js"


# current name -> content of every client chunk; rename the settings chunk, then every chunk that names a renamed one
files = {f"assets/{n}": open(os.path.join(DIST, "assets", n)).read() for n in os.listdir(os.path.join(DIST, "assets")) if n.endswith(".js")}
files[old_file] = s
final = {f: f for f in files}          # original name -> current name
pending = [old_file]
while pending:
    cur = pending.pop()
    if cur not in files:
        continue
    new = new_name(cur, files[cur])
    if new == cur:
        continue
    files[new] = files.pop(cur)
    for orig, now in final.items():
        if now == cur:
            final[orig] = new
    for other, content in list(files.items()):
        if other != new and os.path.basename(cur) in content:
            files[other] = content.replace(os.path.basename(cur), os.path.basename(new))
            pending.append(other)
for orig, now in final.items():
    if orig != now:
        os.remove(os.path.join(DIST, orig))
for name, content in files.items():
    path = os.path.join(DIST, name)
    if not os.path.exists(path) or open(path).read() != content:
        open(path, "w").write(content)
for v in man.values():
    v["file"] = final.get(v["file"], v["file"])
open(man_path, "w").write(json.dumps(man, indent=2) + "\n")
print(json.dumps({k: v for k, v in final.items() if k != v}, indent=1))
