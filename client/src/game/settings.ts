// Player settings: kept in localStorage (instant) and on the account (/api/settings), so they follow the
// player to another browser. The Esc menu (Menu, below) edits them; almost everything applies at once.

import { type Gfx, PRESET_NAMES, RELOAD_KEYS, matchPreset, normalizeGfx, presetGfx } from "./graphics";
import { BIND_LABELS, DEFAULT_BINDS, type Input, keyLabel } from "./input";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const DEFAULTS: Record<string, any> = {
  // mouse and actions
  sensitivity: 2.0, zoomSensitivity: 1.0, invertY: false, rawInput: true,
  toggleAim: false, toggleCrouch: false, toggleWalk: false,
  // view
  fov: 74, viewmodelFov: 54, viewBob: 1.0, cameraShake: 1.0, brightness: 0.0,
  // graphics
  preset: "medium", gfx: presetGfx("medium"),
  // audio
  volume: { master: 0.8, effects: 1.0, ui: 0.8, ambient: 0.5 }, muteUnfocused: false,
  binds: {},
  crosshair: { color: "#7dff7d", size: 8, thickness: 2, gap: 4, dot: false, style: "classic", outline: true, opacity: 1, dynamic: true },
  // HUD
  showFps: true, hudScale: 1.0, hudOpacity: 1.0, palette: "default",
  hitmarkers: true, damageFlash: true, damageArcs: true, killFeed: true,
  radar: true, radarRotate: true, radarZoom: 1.0, compass: true, fpSpectate: false,
};

const KEY = "coldsector.settings";

function merge(base: any, over: any): any {
  const out = JSON.parse(JSON.stringify(base));
  for (const [k, v] of Object.entries(over || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && typeof out[k] === "object") out[k] = merge(out[k], v);
    else if (k in out) out[k] = v;
  }
  return out;
}

export class Settings {
  data: Record<string, any> = merge(DEFAULTS, {});
  private listeners: Array<(k: string, v: any) => void> = [];
  private timer: number | undefined;

  static async load(): Promise<Settings> {
    const s = new Settings();
    let hadGfx = false;
    try {
      const local = JSON.parse(localStorage.getItem(KEY) || "{}");
      hadGfx = !!local.gfx;
      s.data = merge(DEFAULTS, local);
    } catch { /* private mode */ }
    try {
      const r = await fetch("/api/settings", { credentials: "same-origin" });
      if (r.ok) {
        const server = await r.json();
        if (server && Object.keys(server).length) { s.data = merge(s.data, server); hadGfx = hadGfx || !!server.gfx; }
      }
    } catch { /* offline: keep local */ }
    // settings from before the individual graphics options: start from the chosen preset
    const preset = PRESET_NAMES.includes(s.data.preset) ? s.data.preset : "medium";
    s.data.gfx = hadGfx ? normalizeGfx(s.data.gfx, preset) : presetGfx(preset);
    s.data.preset = matchPreset(s.data.gfx);
    return s;
  }

  get(key: string): any { return this.data[key]; }

  set(key: string, value: any): void {
    this.data[key] = value;
    this.save();
    for (const cb of this.listeners) cb(key, value);
  }

  onChange(cb: (k: string, v: any) => void): void { this.listeners.push(cb); }

  save(): void {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignore */ }
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      const token = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]');
      fetch("/api/settings", { method: "PUT", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": token ? token.content : "" }, body: JSON.stringify(this.data) }).catch(() => {});
    }, 800);
  }
}

// ------------------------------------------------------------------------------------------------- the menu

type Impact = "none" | "low" | "medium" | "high";
interface Help { desc: string; impact?: Impact; reload?: boolean }
interface MenuCallbacks {
  onResume: () => void; onLeave: () => void; onReload: () => void;
  onStop?: () => void; canStop?: () => boolean; info?: () => { title: string; detail: string };
}

const SECTIONS: Array<{ id: string; label: string; icon: string; blurb: string; keys: string[] }> = [
  { id: "graphics", label: "Graphics", blurb: "Quality, resolution, lighting and post-processing. Most changes apply instantly.",
    icon: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>', keys: ["preset", "gfx", "brightness"] },
  { id: "display", label: "View & HUD", blurb: "Field of view, motion, and what the heads-up display shows.",
    icon: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    keys: ["fov", "viewmodelFov", "viewBob", "cameraShake", "showFps", "hudScale", "hudOpacity", "palette", "hitmarkers", "damageFlash",
      "damageArcs", "killFeed", "radar", "radarRotate", "radarZoom", "compass", "fpSpectate"] },
  { id: "crosshair", label: "Crosshair", blurb: "Shape, size and colour, with a live preview.",
    icon: '<circle cx="12" cy="12" r="8"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>', keys: ["crosshair"] },
  { id: "gameplay", label: "Mouse & Actions", blurb: "Aim feel and whether aim, crouch and walk hold or toggle.",
    icon: '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 7v4"/>',
    keys: ["sensitivity", "zoomSensitivity", "invertY", "rawInput", "toggleAim", "toggleCrouch", "toggleWalk"] },
  { id: "binds", label: "Key Bindings", blurb: "Click a key, then press the new one. A key already in use swaps over.",
    icon: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>', keys: ["binds"] },
  { id: "audio", label: "Audio", blurb: "Volume of each part of the mix.",
    icon: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>', keys: ["volume", "muteUnfocused"] },
];

const BIND_GROUPS: Array<[string, string[]]> = [
  ["Movement", ["forward", "back", "left", "right", "walk", "crouch", "jump", "lean_left", "lean_right"]],
  ["Weapons", ["fire", "aim", "reload", "slot1", "slot2", "slot3", "slot4", "slot5", "last_weapon", "wheel_up", "wheel_down", "drop", "inspect"]],
  ["Equipment", ["use", "gadget", "charge", "observe", "ping", "buy_menu"]],
  ["Communication", ["scoreboard", "chat_all", "chat_team", "vote_yes", "vote_no"]],
];

const XH_COLORS = ["#7dff7d", "#00e5ff", "#ffe14d", "#ff4df0", "#ffffff", "#ff4d4d"];
const IMPACT_LABEL: Record<Impact, string> = { none: "No performance cost", low: "Low performance cost", medium: "Medium performance cost", high: "High performance cost" };

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", parent?: HTMLElement | null, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
}

function svgIcon(paths: string): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = paths;           // static strings above
  return svg;
}

/** The Esc menu: a side rail (sections, resume, leave) and the selected section's settings. */
export class Menu {
  panel: HTMLDivElement;
  open = false;
  tab = "graphics";
  private refreshers: Array<() => void> = [];
  private infoBox!: HTMLDivElement;
  private defaultInfo = "";
  private body!: HTMLDivElement;
  private reloadBar!: HTMLDivElement;
  private bindFilter = "";
  private previewBg = "sky";

  constructor(root: HTMLElement, public settings: Settings, public input: Input, private cb: MenuCallbacks,
    /** the graphics the page started with: texture and MSAA changes wait for a reload */
    private startGfx: Gfx) {
    this.panel = document.createElement("div");
    this.panel.className = "menu hidden";
    this.panel.addEventListener("mousedown", (e) => e.stopPropagation());
    root.appendChild(this.panel);
    try { this.tab = localStorage.getItem("coldsector.menuTab") || this.tab; } catch { /* ignore */ }
    if (!SECTIONS.some((s) => s.id === this.tab)) this.tab = "graphics";
  }

  show(on: boolean): void {
    this.open = on;
    this.panel.classList.toggle("hidden", !on);
    if (on) this.render();
  }

  /** Re-read every control's value from the settings (after a preset or a reset changes many at once). */
  private refresh(): void {
    for (const r of this.refreshers) r();
    this.updateReloadBar();
  }

  private setInfo(label: string, help: Help | null): void {
    const box = this.infoBox;
    box.textContent = "";
    if (!help) { h("p", "", box, this.defaultInfo); return; }
    h("strong", "", box, label);
    h("p", "", box, help.desc);
    const tags = h("div", "tags", box);
    if (help.impact) h("span", `tag impact-${help.impact}`, tags, IMPACT_LABEL[help.impact]);
    if (help.reload) h("span", "tag reload", tags, "Applies after reload");
  }

  render(): void {
    const p = this.panel;
    p.textContent = "";
    this.refreshers = [];
    const shell = h("div", "menu-shell", p);
    // ---- side rail
    const rail = h("aside", "menu-rail", shell);
    const brand = h("div", "menu-brand", rail);
    h("div", "eyebrow", brand, "Cold Sector");
    h("h2", "", brand, "Paused");
    const info = this.cb.info?.();
    h("div", "match", brand, info ? info.title : "");
    h("div", "sub", brand, info?.detail || "The match keeps running while this menu is open.");
    const nav = h("nav", "menu-nav", rail);
    for (const sec of SECTIONS) {
      const b = h("button", sec.id === this.tab ? "on" : "", nav);
      b.type = "button";
      b.append(svgIcon(sec.icon));
      h("span", "", b, sec.label);
      b.addEventListener("click", () => {
        this.tab = sec.id;
        try { localStorage.setItem("coldsector.menuTab", sec.id); } catch { /* ignore */ }
        this.render();
      });
    }
    const actions = h("div", "menu-actions", rail);
    const resume = h("button", "primary", actions, "Resume");
    resume.type = "button";
    resume.addEventListener("click", () => this.cb.onResume());
    const leave = h("button", "ghost", actions, "Leave match");
    leave.type = "button";
    leave.addEventListener("click", () => this.cb.onLeave());
    if (this.cb.canStop?.() && this.cb.onStop) {
      // you started this match: you may end it for everyone
      const stop = h("button", "danger", actions, "Stop this match");
      stop.type = "button";
      stop.title = "Ends the match for everyone in it";
      stop.addEventListener("click", () => this.cb.onStop?.());
    }
    // ---- the section
    const sec = SECTIONS.find((s) => s.id === this.tab) ?? SECTIONS[0];
    const main = h("section", "menu-main", shell);
    const head = h("header", "menu-head", main);
    const titles = h("div", "", head);
    h("h3", "", titles, sec.label);
    h("p", "", titles, sec.blurb);
    const reset = h("button", "ghost small", head, "Reset to defaults");
    reset.type = "button";
    reset.addEventListener("click", () => {
      for (const k of sec.keys) this.settings.set(k, JSON.parse(JSON.stringify(DEFAULTS[k])));
      if (sec.id === "graphics") this.settings.set("preset", matchPreset(this.settings.get("gfx")));
      this.render();
    });
    this.reloadBar = h("div", "reload-bar hidden", main);
    h("span", "", this.reloadBar, "Texture and anti-aliasing changes apply after a reload.");
    const rl = h("button", "small", this.reloadBar, "Apply & reload");
    rl.type = "button";
    rl.addEventListener("click", () => this.cb.onReload());
    this.body = h("div", "menu-body", main);
    this.infoBox = h("div", "menu-info", main);
    this.defaultInfo = "Hover over a setting to see what it does.";
    this.setInfo("", null);
    ({ graphics: () => this.graphics(), display: () => this.display(), crosshair: () => this.crosshairSection(),
      gameplay: () => this.gameplay(), binds: () => this.bindsSection(), audio: () => this.audio() } as Record<string, () => void>)[sec.id]();
    this.updateReloadBar();
  }

  // ---------------------------------------------------------------- building blocks
  private group(title: string, parent: HTMLElement = this.body): HTMLDivElement {
    const g = h("div", "group", parent);
    h("h4", "", g, title);
    return g;
  }

  private row(parent: HTMLElement, label: string, help: Help | null): HTMLDivElement {
    const r = h("div", "row", parent);
    const name = h("div", "name", r);
    h("span", "", name, label);
    if (help?.reload) h("i", "badge", name, "reload");
    if (help) {
      r.addEventListener("mouseenter", () => this.setInfo(label, help));
      r.addEventListener("focusin", () => this.setInfo(label, help));
    }
    return r;
  }

  private slider(parent: HTMLElement, label: string, help: Help | null, o: { min: number; max: number; step: number; get: () => number;
    set: (v: number) => void; fmt?: (v: number) => string }): void {
    const r = this.row(parent, label, help);
    const fmt = o.fmt ?? ((v: number) => String(v));
    const wrap = h("div", "ctl slider", r);
    const input = h("input", "", wrap);
    input.type = "range"; input.min = String(o.min); input.max = String(o.max); input.step = String(o.step);
    const out = h("output", "", r);
    const paint = (v: number) => {
      out.textContent = fmt(v);
      input.style.setProperty("--fill", `${((v - o.min) / (o.max - o.min)) * 100}%`);
    };
    input.addEventListener("input", () => { const v = parseFloat(input.value); paint(v); o.set(v); this.refresh(); });
    // double-click the value to type one in
    out.title = "Double-click to type a value";
    out.addEventListener("dblclick", () => {
      const t = window.prompt(label, String(o.get()));
      const v = t === null ? NaN : parseFloat(t);
      if (Number.isFinite(v)) { const c = Math.max(o.min, Math.min(o.max, v)); o.set(c); this.refresh(); }
    });
    const sync = () => { const v = o.get(); input.value = String(v); paint(v); };
    sync();
    this.refreshers.push(sync);
  }

  private toggle(parent: HTMLElement, label: string, help: Help | null, get: () => boolean, set: (v: boolean) => void): void {
    const r = this.row(parent, label, help);
    const b = h("button", "switch", r);
    b.type = "button";
    b.setAttribute("role", "switch");
    h("i", "", b);
    const sync = () => { const on = !!get(); b.classList.toggle("on", on); b.setAttribute("aria-checked", String(on)); };
    b.addEventListener("click", () => { set(!get()); this.refresh(); });
    sync();
    this.refreshers.push(sync);
    h("output", "", r);
  }

  private choice<T extends string | number>(parent: HTMLElement, label: string, help: Help | null, options: Array<[T, string]>,
    get: () => T, set: (v: T) => void): void {
    const r = this.row(parent, label, help);
    const seg = h("div", "ctl seg", r);
    const btns = options.map(([v, text]) => {
      const b = h("button", "", seg, text);
      b.type = "button";
      b.addEventListener("click", () => { set(v); this.refresh(); });
      return [v, b] as const;
    });
    const sync = () => { const cur = get(); for (const [v, b] of btns) b.classList.toggle("on", v === cur); };
    sync();
    this.refreshers.push(sync);
    r.classList.add("wide");
  }

  private dropdown(parent: HTMLElement, label: string, help: Help | null, options: Array<[string, string]>, get: () => string, set: (v: string) => void): void {
    const r = this.row(parent, label, help);
    const sel = h("select", "ctl", r);
    for (const [v, text] of options) { const o = h("option", "", sel, text); o.value = v; }
    sel.addEventListener("change", () => { set(sel.value); this.refresh(); });
    const sync = () => { sel.value = String(get()); };
    sync();
    this.refreshers.push(sync);
    h("output", "", r);
  }

  // ---------------------------------------------------------------- graphics
  private gfx(): Gfx { return this.settings.get("gfx"); }

  private setGfx(patch: Partial<Gfx>): void {
    const next = { ...this.gfx(), ...patch };
    this.settings.set("gfx", next);
    this.settings.set("preset", matchPreset(next));
  }

  private updateReloadBar(): void {
    if (!this.reloadBar) return;
    const g = this.gfx(), s = this.startGfx;
    const pending = this.tab === "graphics" && (RELOAD_KEYS.some((k) => g[k] !== s[k]) || (g.aa === "msaa") !== (s.aa === "msaa"));
    this.reloadBar.classList.toggle("hidden", !pending);
  }

  private graphics(): void {
    const s = this.settings;
    const top = h("div", "presets", this.body);
    const presetBtns: Array<[string, HTMLButtonElement]> = [];
    const blurbs: Record<string, string> = { low: "Fastest. For older laptops.", medium: "Balanced default.", high: "Cascaded soft shadows, AO, light shafts, SMAA.",
      ultra: "Everything on, 4× MSAA.", custom: "Your own mix." };
    for (const name of [...PRESET_NAMES, "custom"]) {
      const b = h("button", `preset p-${name}`, top);
      b.type = "button";
      const bars = h("span", "bars", b);
      for (let i = 0; i < 4; i++) h("i", i <= PRESET_NAMES.indexOf(name) ? "lit" : "", bars);
      h("strong", "", b, name[0].toUpperCase() + name.slice(1));
      h("small", "", b, blurbs[name]);
      if (name === "custom") b.disabled = true;
      else b.addEventListener("click", () => {
        const keep = this.gfx();
        // the preset sets the quality; the frame cap and colour taste are kept
        this.settings.set("gfx", { ...presetGfx(name), fpsCap: keep.fpsCap, saturation: keep.saturation, contrast: keep.contrast, bloomStrength: keep.bloomStrength });
        s.set("preset", name);
        this.refresh();
      });
      b.addEventListener("mouseenter", () => this.setInfo(`${name[0].toUpperCase() + name.slice(1)} preset`,
        { desc: name === "custom" ? "Selected automatically when you change any option below." : `Sets every option below to the ${name} values. Frame rate cap and colour sliders are kept.` }));
      presetBtns.push([name, b]);
    }
    this.refreshers.push(() => { const cur = s.get("preset"); for (const [n, b] of presetBtns) b.classList.toggle("on", n === cur); });

    const disp = this.group("Display");
    this.slider(disp, "Render scale", { desc: "Renders the 3D view at a fraction of the window's resolution and scales it up. Lower is faster but softer; above 100% supersamples.", impact: "high" },
      { min: 0.5, max: 1.5, step: 0.05, get: () => this.gfx().renderScale, set: (v) => this.setGfx({ renderScale: v }), fmt: (v) => `${Math.round(v * 100)}%` });
    this.choice(disp, "High-DPI limit", { desc: "On high-density (Retina) screens, how many device pixels per CSS pixel to render at most. 2× is crisp but costs up to four times the pixels.", impact: "high" },
      [[1, "1×"], [1.5, "1.5×"], [2, "2×"], [3, "Native"]], () => this.gfx().pixelRatioCap, (v) => this.setGfx({ pixelRatioCap: v }));
    this.dropdown(disp, "Frame rate limit", { desc: "Caps how often the game draws a frame. Saves battery and fan noise on laptops. Input and network run on their own clock either way.", impact: "none" },
      [["0", "Unlimited (display refresh)"], ["30", "30 fps"], ["60", "60 fps"], ["90", "90 fps"], ["120", "120 fps"], ["144", "144 fps"], ["165", "165 fps"], ["240", "240 fps"]],
      () => String(this.gfx().fpsCap), (v) => this.setGfx({ fpsCap: Number(v) }));
    this.choice(disp, "Anti-aliasing", { desc: "Smooths jagged edges and shimmer. FXAA is a cheap blur-like filter; SMAA finds edges far more precisely (less shimmer on thin beams, wires and grilles); MSAA 4× samples geometry edges properly and adds SMAA on top (MSAA needs a reload).", impact: "medium" },
      [["off", "Off"], ["fxaa", "FXAA"], ["smaa", "SMAA"], ["msaa", "MSAA 4×"]], () => this.gfx().aa, (v) => this.setGfx({ aa: v }));

    const light = this.group("Lighting & shadows");
    this.toggle(light, "Sun shadows", { desc: "Shadows cast by the sun. Turning them on or off recompiles shaders once, so expect a short hitch.", impact: "high" },
      () => this.gfx().shadows, (v) => this.setGfx({ shadows: v }));
    this.choice(light, "Shadow resolution", { desc: "Sharpness of shadow edges.", impact: "medium" },
      [[1024, "1K"], [1536, "1.5K"], [2048, "2K"], [3072, "3K"], [4096, "4K"]], () => this.gfx().shadowSize, (v) => this.setGfx({ shadowSize: v }));
    this.slider(light, "Shadow distance", { desc: "How far around you shadows are drawn. Shorter keeps them sharper at the same resolution.", impact: "low" },
      { min: 30, max: 120, step: 5, get: () => this.gfx().shadowDistance, set: (v) => this.setGfx({ shadowDistance: v }), fmt: (v) => `${v} m` });
    this.choice(light, "Shadow cascades", { desc: "The shadow area is split into this many maps, sharp near you and wider further away. Each extra cascade draws the scene once more for shadows.", impact: "high" },
      [[1, "1"], [2, "2"], [3, "3"], [4, "4"]], () => this.gfx().shadowCascades, (v) => this.setGfx({ shadowCascades: v }));
    this.choice(light, "Shadow filtering", { desc: "Samples per shadow lookup. More gives smoother, less noisy shadow edges. Changing it recompiles shaders once.", impact: "medium" },
      [[4, "4"], [8, "8"], [12, "12"], [24, "24"]], () => this.gfx().shadowTaps, (v) => this.setGfx({ shadowTaps: v }));
    this.toggle(light, "Contact-hardening shadows", { desc: "Shadows are sharp where an object touches the ground and soften with distance from it, like real sunlight (PCSS).", impact: "medium" },
      () => this.gfx().shadowPcss, (v) => this.setGfx({ shadowPcss: v }));
    this.choice(light, "Local lights", { desc: "Lamps and window lights near you become real lights: highlights, and light that moves over players. Changing it recompiles shaders once.", impact: "medium" },
      [[0, "Off"], [2, "2"], [4, "4"]], () => this.gfx().localLights, (v) => this.setGfx({ localLights: v }));
    this.choice(light, "Local light shadows", { desc: "How many of the local lights cast shadows of players and props. Their shadow maps are updated a few per frame.", impact: "medium" },
      [[0, "Off"], [1, "1"], [2, "2"]], () => this.gfx().localShadows, (v) => this.setGfx({ localShadows: v }));
    this.toggle(light, "Light shafts", { desc: "Sunlight scattering in dusty air: visible beams through doorways and windows into dark rooms.", impact: "medium" },
      () => this.gfx().volumetric, (v) => this.setGfx({ volumetric: v }));
    this.toggle(light, "Dust motes", { desc: "Specks of dust drifting in the sunbeams.", impact: "low" },
      () => this.gfx().dustMotes, (v) => this.setGfx({ dustMotes: v }));
    this.choice(light, "Ambient occlusion", { desc: "Screen-space ambient occlusion on ambient light only: creases, corners and contact points darken so objects sit in the scene. (Baked corner shading is always on.)", impact: "high" },
      [["off", "Off"], ["low", "Low"], ["medium", "Medium"], ["high", "High"]], () => this.gfx().ao, (v) => this.setGfx({ ao: v }));
    this.toggle(light, "Eye adaptation", { desc: "Exposure adjusts as you move between bright courtyards and dark rooms, like your eyes would.", impact: "low" },
      () => this.gfx().autoExposure, (v) => this.setGfx({ autoExposure: v }));

    const tex = this.group("Textures");
    this.choice(tex, "Texture quality", { desc: "Largest texture size loaded. Lower uses less video memory.", impact: "medium", reload: true },
      [[512, "512 px"], [1024, "1024 px"]], () => this.gfx().textures, (v) => this.setGfx({ textures: v }));
    this.choice(tex, "Texture filtering", { desc: "Anisotropic filtering keeps floors and walls sharp at glancing angles.", impact: "low", reload: true },
      [[1, "Off"], [2, "2×"], [4, "4×"], [8, "8×"], [16, "16×"]], () => this.gfx().anisotropy, (v) => this.setGfx({ anisotropy: v }));
    this.choice(tex, "Building detail", { desc: "Near the camera buildings get rounded, worn edges and gently uneven walls, with small clutter; far away they stay simple. Low keeps them simple everywhere.", impact: "medium" },
      [["low", "Low"], ["medium", "Medium"], ["high", "High"]], () => this.gfx().buildingDetail, (v) => this.setGfx({ buildingDetail: v }));
    this.toggle(tex, "Weathering", { desc: "Dust at the foot of walls, rain streaks, soot, damp, peeling plaster and chipped paint.", impact: "low" },
      () => this.gfx().weathering, (v) => this.setGfx({ weathering: v }));
    this.toggle(tex, "Detail normals", { desc: "A finer layer of surface relief up close, so walls stay crisp at arm's length.", impact: "low" },
      () => this.gfx().detailNormals, (v) => this.setGfx({ detailNormals: v }));
    this.toggle(tex, "Specular anti-aliasing", { desc: "Stops glints from sparkling and crawling on bumpy or distant surfaces.", impact: "low" },
      () => this.gfx().specularAA, (v) => this.setGfx({ specularAA: v }));

    const post = this.group("Image & post-processing");
    this.slider(post, "Brightness", { desc: "Exposure offset in stops (EV) on top of eye adaptation. Raise it if interiors are too dark on your screen.", impact: "none" },
      { min: -1, max: 1, step: 0.05, get: () => s.get("brightness"), set: (v) => s.set("brightness", v), fmt: (v) => `${v >= 0 ? "+" : ""}${v.toFixed(2)} EV` });
    this.slider(post, "Saturation", { desc: "Colour intensity.", impact: "none" },
      { min: 0, max: 1.5, step: 0.05, get: () => this.gfx().saturation, set: (v) => this.setGfx({ saturation: v }), fmt: (v) => `${Math.round(v * 100)}%` });
    this.slider(post, "Contrast", { desc: "Difference between light and dark.", impact: "none" },
      { min: 0.75, max: 1.25, step: 0.01, get: () => this.gfx().contrast, set: (v) => this.setGfx({ contrast: v }), fmt: (v) => `${Math.round(v * 100)}%` });
    this.toggle(post, "Bloom", { desc: "Glow around very bright light: the sun, muzzle flashes, explosions.", impact: "low" },
      () => this.gfx().bloom, (v) => this.setGfx({ bloom: v }));
    this.slider(post, "Bloom intensity", { desc: "How strong the glow is.", impact: "none" },
      { min: 0, max: 2, step: 0.05, get: () => this.gfx().bloomStrength, set: (v) => this.setGfx({ bloomStrength: v }), fmt: (v) => `${Math.round(v * 100)}%` });
    this.choice(post, "Tone mapping", { desc: "How bright light is fitted to the screen. ACES is punchy and warm; AgX keeps saturated highlights more natural.", impact: "none" },
      [["aces", "ACES"], ["agx", "AgX"]], () => this.gfx().toneMapping, (v) => this.setGfx({ toneMapping: v }));
    this.toggle(post, "Colour grading", { desc: "The map's colour grade (the dusty, warm look, with warm highlights and cooler shadows).", impact: "none" },
      () => this.gfx().grading, (v) => this.setGfx({ grading: v }));
    this.toggle(post, "Vignette", { desc: "Slightly darkens the corners of the screen.", impact: "none" },
      () => this.gfx().vignette, (v) => this.setGfx({ vignette: v }));
  }

  // ---------------------------------------------------------------- view & HUD
  private display(): void {
    const s = this.settings;
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const view = this.group("View");
    this.slider(view, "Field of view", { desc: "Vertical field of view. Wider shows more but makes distant targets smaller." },
      { min: 60, max: 110, step: 1, get: () => s.get("fov"), set: (v) => s.set("fov", v), fmt: (v) => `${v}°` });
    this.slider(view, "Weapon field of view", { desc: "How large your own weapon and arms appear. Lower pushes the weapon away." },
      { min: 40, max: 75, step: 1, get: () => s.get("viewmodelFov"), set: (v) => s.set("viewmodelFov", v), fmt: (v) => `${v}°` });
    this.slider(view, "Weapon bob & sway", { desc: "How much the weapon moves with your steps and mouse. Lower it if motion bothers you." },
      { min: 0, max: 1, step: 0.05, get: () => s.get("viewBob"), set: (v) => s.set("viewBob", v), fmt: pct });
    this.slider(view, "Camera shake", { desc: "Screen shake from nearby explosions." },
      { min: 0, max: 1, step: 0.05, get: () => s.get("cameraShake"), set: (v) => s.set("cameraShake", v), fmt: pct });

    const hud = this.group("Heads-up display");
    this.slider(hud, "HUD scale", { desc: "Size of the score, health, ammo, radar and kill feed." },
      { min: 0.75, max: 1.5, step: 0.05, get: () => s.get("hudScale"), set: (v) => s.set("hudScale", v), fmt: pct });
    this.slider(hud, "HUD opacity", { desc: "Transparency of the HUD (not the crosshair)." },
      { min: 0.3, max: 1, step: 0.05, get: () => s.get("hudOpacity"), set: (v) => s.set("hudOpacity", v), fmt: pct });
    this.dropdown(hud, "Colour palette", { desc: "Team, health and money colours tuned for colour-vision deficiencies." },
      [["default", "Default"], ["deuteranopia", "Deuteranopia (red-green)"], ["protanopia", "Protanopia (red-green)"], ["tritanopia", "Tritanopia (blue-yellow)"]],
      () => s.get("palette"), (v) => s.set("palette", v));
    this.toggle(hud, "FPS and ping", { desc: "Frame rate, round-trip time and bandwidth in the top-left corner." }, () => s.get("showFps"), (v) => s.set("showFps", v));
    this.toggle(hud, "Kill feed", { desc: "Who killed whom, top right." }, () => s.get("killFeed"), (v) => s.set("killFeed", v));
    this.toggle(hud, "Hit markers", { desc: "A mark at the crosshair when your shot lands (yellow for headshots, red for kills)." }, () => s.get("hitmarkers"), (v) => s.set("hitmarkers", v));
    this.toggle(hud, "Damage flash", { desc: "Red edges on the screen when you are hurt." }, () => s.get("damageFlash"), (v) => s.set("damageFlash", v));
    this.toggle(hud, "Damage direction", { desc: "A red arc pointing toward where damage came from." }, () => s.get("damageArcs"), (v) => s.set("damageArcs", v));

    const map = this.group("Radar & compass");
    this.toggle(map, "Radar", { desc: "The minimap in the top-left corner." }, () => s.get("radar"), (v) => s.set("radar", v));
    this.toggle(map, "Radar turns with view", { desc: "On: up on the radar is where you look. Off: north is always up." }, () => s.get("radarRotate"), (v) => s.set("radarRotate", v));
    this.slider(map, "Radar zoom", { desc: "How much of the map the radar shows." },
      { min: 0.5, max: 2, step: 0.05, get: () => s.get("radarZoom"), set: (v) => s.set("radarZoom", v), fmt: (v) => `${v.toFixed(2)}×` });
    this.toggle(map, "Compass", { desc: "The bearing strip under the score, with site and ping markers." }, () => s.get("compass"), (v) => s.set("compass", v));

    const spec = this.group("Spectating");
    this.toggle(spec, "First-person spectating", { desc: "Watch teammates through their eyes instead of over the shoulder." }, () => s.get("fpSpectate"), (v) => s.set("fpSpectate", v));
  }

  // ---------------------------------------------------------------- crosshair
  private xh(): any { return this.settings.get("crosshair"); }
  private setXh(patch: any): void { this.settings.set("crosshair", { ...this.xh(), ...patch }); }

  private crosshairSection(): void {
    const layout = h("div", "xh-layout", this.body);
    // live preview
    const pv = h("div", "xh-preview", layout);
    const stage = h("div", `stage bg-${this.previewBg}`, pv);
    const xh = h("div", "crosshair", stage);
    for (const c of ["t", "b", "l", "r", "d", "c"]) h("i", c, xh);
    const bgs = h("div", "bgs", pv);
    for (const [id, label] of [["sky", "Sky"], ["wall", "Mud wall"], ["dark", "Interior"], ["bright", "Sunlit"]]) {
      const b = h("button", id === this.previewBg ? "on" : "", bgs, label);
      b.type = "button";
      b.addEventListener("click", () => {
        this.previewBg = id;
        stage.className = `stage bg-${id}`;
        for (const x of bgs.querySelectorAll("button")) x.classList.toggle("on", x === b);
      });
    }
    let spreadT = 0;
    const animate = () => {
      if (!xh.isConnected) return;
      spreadT += 0.03;
      const c = this.xh();
      const spread = c.dynamic ? Math.max(0, Math.sin(spreadT)) * 10 : 0;
      xh.style.setProperty("--gap", `${Math.round(spread)}px`);
      requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
    const paint = () => {
      const c = this.xh();
      xh.style.setProperty("--size", `${c.size}px`);
      xh.style.setProperty("--thick", `${c.thickness}px`);
      xh.style.setProperty("--color", c.color);
      xh.style.setProperty("--base-gap", `${c.gap}px`);
      xh.style.setProperty("--xh-opacity", String(c.opacity));
      xh.dataset.style = c.style;
      xh.classList.toggle("dot", !!c.dot);
      xh.classList.toggle("outline", c.outline !== false);
    };
    paint();
    this.refreshers.push(paint);
    // share codes
    const share = h("div", "xh-share", pv);
    const code = h("input", "", share);
    code.type = "text";
    code.spellcheck = false;
    code.placeholder = "Paste a crosshair code";
    const enc = () => `CSX-${btoa(JSON.stringify(this.xh()))}`;
    code.value = enc();
    this.refreshers.push(() => { if (document.activeElement !== code) code.value = enc(); });
    const copy = h("button", "small ghost", share, "Copy");
    copy.type = "button";
    copy.addEventListener("click", () => {
      code.select();
      void navigator.clipboard?.writeText(code.value).then(() => { copy.textContent = "Copied"; setTimeout(() => { copy.textContent = "Copy"; }, 1200); }).catch(() => {});
    });
    const load = h("button", "small", share, "Load");
    load.type = "button";
    load.addEventListener("click", () => {
      try {
        const raw = JSON.parse(atob(code.value.trim().replace(/^CSX-/, "")));
        const next = merge(DEFAULTS.crosshair, raw);
        next.size = Math.max(2, Math.min(24, Number(next.size) || 8));
        next.thickness = Math.max(1, Math.min(6, Number(next.thickness) || 2));
        next.gap = Math.max(-4, Math.min(16, Number(next.gap) || 0));
        next.opacity = Math.max(0.2, Math.min(1, Number(next.opacity) || 1));
        if (!/^#[0-9a-f]{6}$/i.test(next.color)) next.color = DEFAULTS.crosshair.color;
        this.settings.set("crosshair", next);
        this.refresh();
      } catch {
        code.classList.add("bad");
        setTimeout(() => code.classList.remove("bad"), 900);
      }
    });

    const ctl = h("div", "xh-controls", layout);
    const presetGroup = this.group("Presets", ctl);
    h("p", "help", presetGroup, "Choose a starting crosshair, then adjust any setting below.");
    const presetBar = h("div", "ctl seg", presetGroup);
    const presets = [
      ["classic", "Classic", { style: "classic", size: 8, gap: 4, thickness: 2, color: "#7dff7d", dot: false, outline: true, opacity: 1, dynamic: true }],
      ["compact", "Compact", { style: "classic", size: 5, gap: 2, thickness: 1, color: "#00e5ff", dot: false, outline: true, opacity: 1, dynamic: false }],
      ["t", "T-shape", { style: "t", size: 8, gap: 3, thickness: 2, color: "#ffe14d", dot: false, outline: true, opacity: 1, dynamic: false }],
      ["dot", "Dot", { style: "dot", size: 4, gap: 0, thickness: 2, color: "#ffffff", dot: false, outline: true, opacity: 1, dynamic: false }],
    ] as const;
    const presetButtons = presets.map(([id, label, values]) => {
      const b = h("button", "", presetBar, label);
      b.type = "button";
      b.addEventListener("click", () => { this.settings.set("crosshair", { ...this.xh(), ...values }); this.refresh(); });
      return [id, values, b] as const;
    });
    const syncPresets = () => {
      const current = this.xh();
      for (const [, values, button] of presetButtons) {
        const selected = Object.entries(values).every(([key, value]) => current[key] === value);
        button.classList.toggle("on", selected);
      }
    };
    this.refreshers.push(syncPresets);
    syncPresets();
    const shape = this.group("Shape", ctl);
    this.choice(shape, "Style", { desc: "Classic four lines, a T without the top line, a dot only, or a circle." },
      [["classic", "Classic"], ["t", "T-shape"], ["dot", "Dot"], ["circle", "Circle"]], () => this.xh().style, (v) => this.setXh({ style: v }));
    this.toggle(shape, "Centre dot", { desc: "A dot in the middle of the crosshair." }, () => this.xh().dot, (v) => this.setXh({ dot: v }));
    this.toggle(shape, "Dynamic", { desc: "The lines open with your weapon's real spread while moving, jumping and firing." }, () => this.xh().dynamic, (v) => this.setXh({ dynamic: v }));
    this.toggle(shape, "Outline", { desc: "A thin black outline so the crosshair stays visible on any background." }, () => this.xh().outline, (v) => this.setXh({ outline: v }));
    const size = this.group("Size", ctl);
    this.slider(size, "Length", null, { min: 2, max: 24, step: 1, get: () => this.xh().size, set: (v) => this.setXh({ size: v }), fmt: (v) => `${v}px` });
    this.slider(size, "Gap", null, { min: -4, max: 16, step: 1, get: () => this.xh().gap, set: (v) => this.setXh({ gap: v }), fmt: (v) => `${v}px` });
    this.slider(size, "Thickness", null, { min: 1, max: 6, step: 1, get: () => this.xh().thickness, set: (v) => this.setXh({ thickness: v }), fmt: (v) => `${v}px` });
    this.slider(size, "Opacity", null, { min: 0.2, max: 1, step: 0.05, get: () => this.xh().opacity, set: (v) => this.setXh({ opacity: v }), fmt: (v) => `${Math.round(v * 100)}%` });
    const col = this.group("Colour", ctl);
    const r = this.row(col, "Colour", { desc: "Pick a swatch or any colour. Cyan and yellow stand out best against the sandy maps." });
    const sw = h("div", "ctl swatches", r);
    const btns: HTMLButtonElement[] = [];
    for (const c of XH_COLORS) {
      const b = h("button", "", sw);
      b.type = "button";
      b.style.setProperty("--c", c);
      b.title = c;
      b.dataset.color = c;
      b.addEventListener("click", () => { this.setXh({ color: c }); this.refresh(); });
      btns.push(b);
    }
    const custom = h("input", "", sw);
    custom.type = "color";
    custom.title = "Custom colour";
    custom.addEventListener("input", () => { this.setXh({ color: custom.value }); for (const b of btns) b.classList.remove("on"); paint(); });
    this.refreshers.push(() => {
      const c = String(this.xh().color).toLowerCase();
      custom.value = c;
      for (const b of btns) b.classList.toggle("on", b.dataset.color === c);
    });
    r.classList.add("wide");
  }

  // ---------------------------------------------------------------- mouse & actions
  private gameplay(): void {
    const s = this.settings;
    const mouse = this.group("Mouse");
    this.slider(mouse, "Sensitivity", { desc: "Degrees turned per mouse count × 0.022, the same scale as most shooters, so you can carry your sensitivity over." },
      { min: 0.2, max: 8, step: 0.05, get: () => s.get("sensitivity"), set: (v) => s.set("sensitivity", v), fmt: (v) => v.toFixed(2) });
    const cm = h("div", "derived", mouse);
    const cmSync = () => { cm.textContent = `≈ ${(360 / (0.022 * s.get("sensitivity")) / 800 * 2.54).toFixed(1)} cm per 360° at 800 DPI`; };
    cmSync();
    this.refreshers.push(cmSync);
    this.slider(mouse, "Zoom sensitivity", { desc: "Multiplier while aiming down sights or scoped, on top of the zoom." },
      { min: 0.2, max: 2, step: 0.05, get: () => s.get("zoomSensitivity"), set: (v) => s.set("zoomSensitivity", v), fmt: (v) => `${v.toFixed(2)}×` });
    this.toggle(mouse, "Invert vertical look", { desc: "Moving the mouse forward looks down." }, () => s.get("invertY"), (v) => s.set("invertY", v));
    this.toggle(mouse, "Raw input", { desc: "Ask the browser for unaccelerated mouse movement. Applies the next time you click into the game. Turn off if your browser rejects it." },
      () => s.get("rawInput"), (v) => s.set("rawInput", v));
    const act = this.group("Hold or toggle");
    this.toggle(act, "Toggle aim", { desc: "One press aims down sights, the next press stops. Off: hold to aim." }, () => s.get("toggleAim"), (v) => s.set("toggleAim", v));
    this.toggle(act, "Toggle crouch", { desc: "One press crouches, the next stands. Off: hold to crouch." }, () => s.get("toggleCrouch"), (v) => s.set("toggleCrouch", v));
    this.toggle(act, "Toggle walk", { desc: "One press walks quietly, the next runs. Off: hold to walk." }, () => s.get("toggleWalk"), (v) => s.set("toggleWalk", v));
  }

  // ---------------------------------------------------------------- key bindings
  private bindsSection(): void {
    const s = this.settings;
    const binds = { ...DEFAULT_BINDS, ...s.get("binds") };
    const labels = new Map(BIND_LABELS);
    const search = h("input", "bind-search", this.body);
    search.type = "search";
    search.placeholder = "Search actions or keys…";
    search.value = this.bindFilter;
    const lists = h("div", "", this.body);
    const draw = () => {
      lists.textContent = "";
      const q = this.bindFilter.trim().toLowerCase();
      for (const [title, actions] of BIND_GROUPS) {
        const shown = actions.filter((a) => labels.has(a) && (!q || labels.get(a)!.toLowerCase().includes(q) || keyLabel(binds[a]).toLowerCase().includes(q)));
        if (!shown.length) continue;
        const g = this.group(title, lists);
        const grid = h("div", "binds", g);
        for (const action of shown) {
          const label = labels.get(action)!;
          h("span", "", grid, label);
          const b = h("button", binds[action] !== DEFAULT_BINDS[action] ? "key changed" : "key", grid, keyLabel(binds[action]));
          b.type = "button";
          b.title = binds[action] !== DEFAULT_BINDS[action] ? `Default: ${keyLabel(DEFAULT_BINDS[action])}` : "";
          b.addEventListener("click", () => {
            b.textContent = "Press a key…";
            b.classList.add("listening");
            this.input.capture((code) => {
              if (code === "Escape") { this.render(); return; }
              const next = { ...s.get("binds") };
              // a key used elsewhere swaps with this action's old key
              for (const [a, c] of Object.entries({ ...DEFAULT_BINDS, ...next })) if (c === code && a !== action) next[a] = binds[action];
              next[action] = code;
              s.set("binds", next);
              this.render();
            });
          });
        }
      }
      if (!lists.childElementCount) h("p", "note", lists, "No action matches.");
    };
    search.addEventListener("input", () => { this.bindFilter = search.value; draw(); });
    draw();
    h("p", "note", this.body, "Crouch is C in the browser (Ctrl+W would close the tab). Press Esc while rebinding to cancel. Bindings are saved to your account.");
  }

  // ---------------------------------------------------------------- audio
  private audio(): void {
    const s = this.settings;
    const g = this.group("Volume");
    const help: Record<string, string> = { master: "Everything.", effects: "Gunfire, footsteps, explosions and the world.",
      ui: "Buying, hit sounds and menus.", ambient: "Wind, rooms and tunnels." };
    for (const [k, label] of [["master", "Master"], ["effects", "Effects"], ["ui", "Interface"], ["ambient", "Ambience"]]) {
      this.slider(g, label, { desc: help[k] }, { min: 0, max: 1, step: 0.01, get: () => s.get("volume")[k],
        set: (v) => s.set("volume", { ...s.get("volume"), [k]: v }), fmt: (v) => `${Math.round(v * 100)}%` });
    }
    const o = this.group("Behaviour");
    this.toggle(o, "Mute in background", { desc: "Silence the game while its tab or window is not focused." }, () => s.get("muteUnfocused"), (v) => s.set("muteUnfocused", v));
  }
}
