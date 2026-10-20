#!/usr/bin/env python3
"""Re-hash client chunks after editing them in place.

    python3 scripts/rehash_client.py assets/game-XXXXXXXX.js [more chunks...]

Each named chunk (and every chunk that imports a renamed one) gets a new content-hashed file name, the old files
are removed and client/dist/.vite/manifest.json is updated, so browsers holding the old immutable-cached files
load the new ones. Same naming as the build: <stem>-<8 url-safe sha256 chars>.js.
"""
import base64, hashlib, json, os, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DIST = os.path.join(ROOT, "client", "dist")


def new_name(path, content):
    stem = os.path.basename(path).split("-")[0]
    h = base64.urlsafe_b64encode(hashlib.sha256(content.encode()).digest())[:8].decode().replace("-", "x").replace("_", "y")
    return f"assets/{stem}-{h}.js"


def rehash(edited):
    man_path = os.path.join(DIST, ".vite", "manifest.json")
    man = json.load(open(man_path))
    files = {f"assets/{n}": open(os.path.join(DIST, "assets", n)).read() for n in os.listdir(os.path.join(DIST, "assets")) if n.endswith(".js")}
    final = {f: f for f in files}          # original name -> current name
    pending = list(edited)
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
    return {k: v for k, v in final.items() if k != v}


if __name__ == "__main__":
    print(json.dumps(rehash([a if a.startswith("assets/") else f"assets/{os.path.basename(a)}" for a in sys.argv[1:]]), indent=1))
