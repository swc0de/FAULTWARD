#!/usr/bin/env python3
"""Applies the Desert Vanguard branding to the compiled server and client. Safe to run again.

    python3 scripts/brand/make_assets.py     # once: logo, symbol, favicon, fonts
    python3 scripts/brand/apply.py           # names and markup, theme.css, menu.js, then re-hashes the changed files

What it changes:
  server/dist/main.mjs   page titles, the header brand, the home page, the play-menu banner, the footer, the log line
  the site script        the featured-map images, and menu.js appended (map picker, difficulty buttons, bot steppers)
  the site stylesheet    theme.css appended
  the pause-menu script  brand symbol and name
The new files get new content-hashed names (scripts/rehash_client.py), so browsers load them straight away.
"""
import json, os, re, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DIST = os.path.join(ROOT, "client", "dist")
sys.path.insert(0, os.path.join(ROOT, "scripts"))
from rehash_client import rehash  # noqa: E402

HERE = os.path.dirname(__file__)
read = lambda p: open(p, encoding="utf8").read()


def write(p, s):
    open(p, "w", encoding="utf8").write(s)


def rep(s, old, new, what):
    if old in s:
        return s.replace(old, new)
    if new in s:
        return s                      # already applied
    raise SystemExit(f"apply: could not find {what}")


def block(s, start, end, body):
    """Replace (or add at the end) the marked block."""
    s = re.sub(re.escape(start) + r".*?" + re.escape(end), "", s, flags=re.S).rstrip("\n")
    return s + "\n" + start + "\n" + body.strip("\n") + "\n" + end + "\n"


# ---- the server pages
path = os.path.join(ROOT, "server", "dist", "main.mjs")
s = read(path)
s = rep(s, '<meta name="theme-color" content="#11171c">', '<meta name="theme-color" content="#101216">', "theme colour")
s = rep(s, 'content="FAULTWARD. Hold your angle. A tactical shooter with bot matches, ranked duels and public servers."',
        'content="Desert Vanguard. First in, last out. A tactical shooter with bot matches, ranked duels and public servers."', "meta description")
s = rep(s, '${p.title ?? "FAULTWARD"}', '${p.title ?? "Desert Vanguard"}', "default title")
s = s.replace("\\xB7 FAULTWARD", "\\xB7 Desert Vanguard")
s = rep(s, '<a class="brand" href="/"><img src="/assets/brand/faultward-symbol.svg" alt="" width="32" height="32"><span>FAULTWARD<small>HOLD YOUR ANGLE.</small></span></a>',
        '<a class="brand" href="/" aria-label="Desert Vanguard"><img src="/assets/brand/desert-vanguard-symbol.svg" alt="" width="36" height="36"><span class="wm"><span class="w1">DESERT</span><span class="w2">VANGUARD</span></span></a>', "header brand")
s = rep(s, '<img class="hero-symbol" src="/assets/brand/faultward-symbol.svg" alt="" width="90" height="90">',
        '<img class="hero-symbol" src="/assets/brand/desert-vanguard-symbol.svg" alt="" width="96" height="96">', "home symbol")
s = rep(s, '<p class="eyebrow">HOLD YOUR ANGLE.</p>\n  <h1>FAULTWARD</h1>',
        '<p class="eyebrow">FIRST IN. LAST OUT.</p>\n  <h1 aria-label="Desert Vanguard"><span class="w1">DESERT</span><span class="w2">VANGUARD</span></h1>', "home title")
s = rep(s, '<span>HOLD YOUR ANGLE.</span><span>FAULTWARD / TACTICAL MULTIPLAYER</span>',
        '<span>FIRST IN. LAST OUT.</span><span>DESERT VANGUARD / TACTICAL MULTIPLAYER</span>', "hub footer")
s = rep(s, "log(`FAULTWARD is running:", "log(`Desert Vanguard is running:", "log line")
banner = '''      <div class="dv-hero">
        <figure class="feature-map"><img id="featured-map-image" src="/assets/brand/hero-qalat.webp" alt="Qalat Village map preview" width="1600" height="1000">
          <figcaption><span>SELECTED MAP</span><strong id="featured-map-name">Qalat Village</strong><small id="featured-map-desc"></small></figcaption></figure>
        <div class="dv-tags"><b>Two sites</b><b>One life per round</b><b>Attack / defend</b></div>
      </div>
'''
if 'class="dv-hero"' not in s:
    s, n = re.subn(r'      <div class="faultward-intro">.*?\n      </div>\n(?=      <div class="hub-body hub-split">)', lambda m: banner, s, flags=re.S)
    if n != 1:
        raise SystemExit("apply: could not find the play-menu banner")
write(path, s)

# ---- the client files named in the build manifest
man = json.load(open(os.path.join(DIST, ".vite", "manifest.json")))
site_js = man["src/site/main.ts"]["file"]
css_file = next(v["file"] for k, v in man.items() if k.startswith("_socket") and v["file"].endswith(".css"))
settings_js = next(v["file"] for k, v in man.items() if k.startswith("_settings") and v["file"].endswith(".js"))

p = os.path.join(DIST, site_js)
s = read(p)
s = s.replace('E={qalat:"/assets/brand/qalat.webp",bazaar:"/assets/brand/bazaar.webp",oilcamp:"/assets/brand/oilcamp.webp",farmhouse:"/assets/brand/farmhouse.webp"}',
              'E={qalat:"/assets/brand/hero-qalat.webp",bazaar:"/assets/brand/hero-bazaar.webp",oilcamp:"/assets/brand/hero-oilcamp.webp",farmhouse:"/assets/brand/hero-farmhouse.webp"}')
s = s.replace('||"/assets/brand/qalat.webp",$.alt', '||"/assets/brand/hero-qalat.webp",$.alt')
s = block(s, "/*dv-menu*/", "/*end-dv-menu*/", read(os.path.join(HERE, "menu.js")))
write(p, s)

p = os.path.join(DIST, css_file)
s = block(read(p), "/*dv-theme*/", "/*end-dv-theme*/", read(os.path.join(HERE, "theme.css")))
write(p, s)

p = os.path.join(DIST, settings_js)
s = read(p)
s = s.replace('l.src="/assets/brand/faultward-symbol.svg"', 'l.src="/assets/brand/desert-vanguard-symbol.svg"')
s = s.replace('c("div","eyebro"+"w",r,"FAULTWARD")', 'c("div","eyebrow",r,"DESERT VANGUARD")')
s = s.replace('c("div","eyebrow",r,"FAULTWARD")', 'c("div","eyebrow",r,"DESERT VANGUARD")')
write(p, s)

print(json.dumps(rehash([f"assets/{os.path.basename(f)}" for f in (site_js, css_file, settings_js)]), indent=1))

# ---- the old brand files are no longer used
for old in ("faultward-logo.svg", "faultward-symbol.svg"):
    f = os.path.join(DIST, "assets", "brand", old)
    if os.path.exists(f):
        os.remove(f)
