// COLD SECTOR in the browser: the 3D client.
// Per frame: mouse look; input commands at the server's tick rate (64 Hz), each applied at once to the
// predicted own soldier (the shared PlayerMotor, the same code the server runs) and sent; snapshots reconcile
// the prediction (reset to the server's state at the acknowledged command, replay the newer ones, smooth
// small corrections); other soldiers are drawn interpolated 100 ms in the past; events become effects,
// sounds and HUD updates.

import "../styles/site.css";
import "../styles/game.css";
import * as THREE from "three";
import { CollisionWorld, GROUP_CLIP } from "@cs/shared/collision";
import { HOLD_ACTIONS, BIT, CmdInput, type InputCmd, packCmd, unpackCmd, WIRE_SIZE } from "@cs/shared/commands";
import { GRENADE_KEYS, KIND_BOMB, KIND_DRONE, KIND_GADGET, KIND_GRENADE, KIND_PICKUP, KIND_SMOKE, KIND_SOLDIER, PHASES, SELF_FLAGS, SOLDIER_FLAGS, flagSet } from "@cs/shared/codec";
import { SPECIALISTS, WEAPONS_JSON } from "@cs/shared/data";
import { Level } from "@cs/shared/level/level";
import { WeaponState, weaponDb } from "@cs/shared/weapons";
import { hprMatrix, type V3 } from "@cs/shared/math";
import { PlayerMotor, type MotorState } from "@cs/shared/motor";
import { MODEL_DEFS } from "@cs/shared/models";
import { surfaceField } from "@cs/shared/level/organic";
import { AudioSystem } from "./audio";
import { Effects, type EntityDraw } from "./effects";
import { Hud, type BuyModel, type CompassMarker, type RadarDot, type SpecialistChoice } from "./hud";
import { Input } from "./input";
import { Net } from "./net";
import { Menu, Settings } from "./settings";
import { Social } from "./social";
import { type SoldierState, Soldiers } from "./soldiers";
import { Viewmodel } from "./viewmodel";
import { LocalWeapons, describeItem } from "./weapons";
import { World } from "./world";
import { PRESET_NAMES, presetGfx } from "./graphics";
import { PerfOverlay } from "./perf";

/* eslint-disable @typescript-eslint/no-explicit-any */
const SMOOTH_LIMIT = 0.5;        // prediction errors below this are smoothed out, larger ones snap
const SMOOTH_RATE = 18;          // 1/s: a hidden prediction correction decays as exp(-dt * rate) per frame
const Z_AXIS = new THREE.Vector3(0, 0, 1);
// remote soldiers: extrapolation past the newest snapshot is linear for EXTRAP_LINEAR s, then eases out over
// about EXTRAP_EASE s (never more than their sum); jumps in the drawn path are absorbed and fade at REMOTE_SMOOTH 1/s
const EXTRAP_LINEAR = 0.05, EXTRAP_EASE = 0.025, REMOTE_SMOOTH = 10, REMOTE_SNAP = 2.0;
const RADAR_KEEP = 3.0;
const GADGET_MODELS = ["", "gadget_charge", "gadget_lance", "gadget_wire", "gadget_sensor", "gadget_shield", "gadget_jammer", "gadget_camera"];

interface Pending { cmd: InputCmd; predicted: V3 | null }

/** A remote soldier as drawn this frame: the interpolated snapshot fields (one object, reused every frame) and the
 *  smoothing state that hides jumps (a late snapshot after extrapolating, a reordered path). */
interface Remote { f: any; pos: V3; vel: V3; offset: V3; prev: V3; hasPrev: boolean; alive: boolean; seen: number }

/** Hermite basis on [0,1]: position from the two end points and their velocities (tangents scaled by the gap). */
function hermite(pa: number, va: number, pb: number, vb: number, s: number): number {
  const s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * pa + (s3 - 2 * s2 + s) * va + (-2 * s3 + 3 * s2) * pb + (s3 - s2) * vb;
}

/** The command as the server will see it (the wire quantises angles and axes). */
function quantize(c: InputCmd): InputCmd {
  const v = new DataView(new ArrayBuffer(WIRE_SIZE));
  packCmd(c, v, 0);
  return unpackCmd(v, 0);
}

class Game {
  canvas: HTMLCanvasElement;
  matchId: string;
  mode: string;
  settings!: Settings;
  world!: World;
  hud!: Hud;
  input!: Input;
  audio!: AudioSystem;
  menu!: Menu;
  net!: Net;
  social!: Social;
  collision!: CollisionWorld;
  motor!: PlayerMotor;
  soldiers!: Soldiers;
  effects!: Effects;
  vm!: Viewmodel;
  weapons!: LocalWeapons;
  overlay: HTMLElement;
  overlayText: HTMLElement;
  overlayBrief: HTMLElement | null = null;
  welcome: any = null;
  loaded = false;
  loading = false;
  closed = false;
  yaw = 0;
  pitch = 0;
  seq = 0;
  pending: Pending[] = [];
  cmdClock: number | null = null;
  tickRate = 64;
  dt = 1 / 64;
  lastFrame = performance.now();
  visualOffset = new THREE.Vector3();
  punch = new THREE.Vector3();
  roster: any[] = [];
  stats = new Map<number, any>();
  selfFlags: Record<string, boolean> = {};
  self: Record<string, any> | null = null;
  slot: number | null = null;
  team: number | null = null;
  adoptServerView = true;
  eyePos: V3 = [0, 0, 0];
  ownPos: V3 | null = null;
  camPos = new THREE.Vector3(0, 0, 8);
  mouseDelta: [number, number] = [0, 0];
  landKick = 0;
  bobPhase = 0;
  bobWeight = 0;
  scoped = false;
  buyOpen = false;
  boardOpen = false;
  spectating: number | undefined;
  spectateNext = false;
  panelsVersion = -1;
  radarSpots = new Map<number, { pos: number[]; t: number }>();
  ambT = 0;
  ambEnv = "";
  lastHealth: number | undefined;
  private buyKeyHandler: ((e: KeyboardEvent) => void) | null = null;
  fps = 0;
  private fpsAcc = 0;
  private fpsN = 0;
  stateDebug: any = { snaps: 0, cmds: 0, corrections: 0, predictionError: 0, maxError: 0, errors: [] as string[] };
  width = 1;
  height = 1;
  freeCam: { pos: V3; at: V3 } | null = null;
  obsView: { pos: V3; yaw: number; pitch: number } | null = null;
  thirdPerson = false;
  freeFly = false;
  shake = 0;
  viewYaw = 0;
  level: Level | null = null;
  roundHistory: Array<{ team: number; reason: string }> = [];
  spreadState: WeaponState | null = null;
  spreadKey = "";
  spectatePrev = false;
  mapName = "";
  private nextFrameDue = 0;
  private ownDrawn: V3 = [0, 0, 0];
  private camEuler = new THREE.Euler();
  private camQ = new THREE.Quaternion();
  private camQr = new THREE.Quaternion();
  private remotes = new Map<number, Remote>();
  private frameNo = 0;
  /** Frame timing, hitches and corrections for the debug overlay (F3 by default). */
  perf: PerfOverlay | null = null;

  constructor(public root: HTMLElement) {
    this.canvas = root.querySelector("canvas") as HTMLCanvasElement;
    this.matchId = root.dataset.match as string;
    this.mode = root.dataset.mode as string;
    this.overlay = root.querySelector(".overlay") as HTMLElement;
    this.overlayText = this.overlay.querySelector(".text") as HTMLElement;
    this.overlayBrief = this.overlay.querySelector(".brief");
    (window as any).__game = this;
  }

  async start(): Promise<void> {
    this.settings = await Settings.load();
    const q = new URLSearchParams(location.search);
    // ?preset=low tries a preset for this page without changing the saved settings
    const qp = q.get("preset");
    const gfx = qp && PRESET_NAMES.includes(qp) ? presetGfx(qp) : this.settings.get("gfx");
    this.world = new World(this.canvas, gfx, this.root.dataset.assets as string);
    this.world.setBrightness(this.settings.get("brightness"));
    this.world.weaponDefs = MODEL_DEFS as any;
    this.hud = new Hud(this.root);
    this.perf = new PerfOverlay(this.root, () => ({ calls: this.world.frameInfo.calls, triangles: this.world.frameInfo.triangles,
      clockAdjust: this.net?.clockStats.adjustSeconds ?? 0, clockResets: this.net?.clockStats.resets ?? 0, offset: this.net?.clockError() ?? 0 }));
    this.input = new Input(this.canvas, this.settings.get("binds"));
    this.input.sensitivity = this.settings.get("sensitivity");
    this.input.invertY = this.settings.get("invertY");
    this.input.rawInput = this.settings.get("rawInput");
    this.applyToggles();
    this.audio = new AudioSystem(this.world.assets);
    this.audio.setVolumes(this.settings.get("volume"));
    this.menu = new Menu(this.root, this.settings, this.input, { onResume: () => this.resume(), onLeave: () => void this.leave(), onReload: () => location.reload(),
      canStop: () => !!this.welcome?.can_stop, onStop: () => void this.stopMatch(), info: () => this.menuInfo() }, gfx);
    document.addEventListener("keydown", (e) => {
      if (!this.menu.open || (e.code !== "Escape" && e.code !== "KeyB")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.resume();
    }, true);
    this.settings.onChange((k, v) => this.applySetting(k, v));
    this.applySetting("crosshair", this.settings.get("crosshair"));
    this.applyHudLayout();
    // mute in background
    const focusMute = () => {
      const away = document.hidden || !document.hasFocus();
      const v = this.settings.get("volume");
      this.audio.setVolumes(away && this.settings.get("muteUnfocused") ? { ...v, master: 0 } : v);
    };
    window.addEventListener("blur", focusMute);
    window.addEventListener("focus", focusMute);
    document.addEventListener("visibilitychange", focusMute);
    this.overlay.addEventListener("click", () => this.resume());
    this.input.onLockChange = (locked) => {
      const ended = this.social?.ended;
      this.overlay.classList.toggle("hidden", locked || this.menu.open || this.buyOpen || !!ended);
      // once the map is loaded the overlay is only an invisible click target (with a small hint), never a pop-up
      this.overlay.classList.toggle("ready", this.loaded && !this.closed);
      if (!locked && this.loaded && !this.buyOpen && !ended && !this.social.open) this.menu.show(true);
    };
    window.addEventListener("resize", () => this.resize());
    this.resize();
    const team = q.get("team") === "0" ? 0 : q.get("team") === "1" ? 1 : null;
    this.net = new Net(this.matchId, this.mode, { team, lag: Math.max(0, Math.min(1000, Number(q.get("lag")) || 0)),
      jitter: Math.max(0, Math.min(200, Number(q.get("jitter")) || 0)) });
    this.net.on("status", (t: string) => this.hud.setStatus(t));
    this.net.on("error", (t: string) => { this.stateDebug.errors.push(t); this.hud.setStatus(t); });
    this.net.on("closed", (m: any) => { this.hud.setStatus(`match closed: ${m.reason}`); this.closed = true; this.setOverlay(`The match has ended (${m.reason}).`); });
    this.net.on("kicked", (m: any) => { this.hud.setStatus(`disconnected: ${m.reason}`); this.setOverlay(`Disconnected: ${m.reason}`); this.closed = true; });
    this.net.on("welcome", (w: any) => void this.onWelcome(w));
    this.net.on("snapshot", (s: any) => this.onSnapshot(s));
    this.net.on("shop", (r: any) => this.onShop(r));
    this.net.on("end", (r: any) => this.social.showEnd(r, this.net.userId));
    this.net.on("moved", (m: any) => { location.href = `/game/${m.match_id}?as=${this.mode}`; });
    this.net.on("vote", (v: any) => this.social.voteState(v));
    this.social = new Social(this.root, {
      input: this.input,
      send: (scope, text) => this.net.control("chat", { scope, text }),
      control: (event, data) => this.net.control(event, data),
      roster: () => this.roster,
      myTeam: () => (this.team === 0 || this.team === 1 ? this.team : null),
      onEnd: () => { this.menu.show(false); this.overlay.classList.add("hidden"); },
    });
    this.setOverlay("Loading…");
    this.net.connect();
    // commands run on their own clock, not the frame rate: a slow frame must not starve the server
    setInterval(() => this.runCommands(performance.now()), 4);
    requestAnimationFrame(() => this.frame());
  }

  /** The map briefing under "Click to play": name, region, description, both sides' tasks and the two sites. */
  showBriefing(data: any, team: number | null | undefined): void {
    const box = this.overlayBrief;
    if (!box || !data) return;
    const b = data.briefing ?? {};
    const el = (tag: string, text: string, cls = "") => {
      const n = document.createElement(tag);
      n.textContent = text;
      if (cls) n.className = cls;
      return n;
    };
    this.mapName = String(data.name ?? "");
    const parts: HTMLElement[] = [el("h2", String(data.name ?? ""))];
    if (b.region) parts.push(el("div", String(b.region), "region"));
    if (data.description) parts.push(el("p", String(data.description)));
    const dl = document.createElement("dl");
    const row = (k: string, v: unknown) => { if (v) dl.append(el("dt", k), el("dd", String(v))); };
    void team;                                 // sides swap at halftime: show both tasks
    row("Attack", b.attack);
    row("Defend", b.defend);
    row("A", b.A);
    row("B", b.B);
    if (dl.childElementCount) parts.push(dl);
    box.replaceChildren(...parts);
    // the briefing is no longer shown as a pop-up over the game; the map name shows briefly in the HUD instead
    this.hud.message(String(data.name ?? ""), 5);
  }

  /** ready: the map is loaded and only a click is needed (the browser requires one to capture the mouse), so the
   *  overlay is transparent with a small hint instead of a box. Loading and error messages still show as a box. */
  setOverlay(text: string, ready = false): void {
    this.overlayText.textContent = text;
    this.overlay.classList.toggle("ready", ready);
    this.overlay.classList.remove("hidden");
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, r.width);
    this.height = Math.max(1, r.height);
    this.world.setSize(this.width, this.height);
  }

  applySetting(key: string, value: any): void {
    if (key === "sensitivity") this.input.sensitivity = value;
    else if (key === "invertY") this.input.invertY = value;
    else if (key === "rawInput") this.input.rawInput = value;
    else if (key === "toggleAim" || key === "toggleCrouch" || key === "toggleWalk") this.applyToggles();
    else if (key === "binds") this.input.setBinds(value);
    else if (key === "volume") this.audio.setVolumes(value);
    else if (key === "viewmodelFov" && this.vm) this.vm.baseFov = value;
    else if (key === "viewBob" && this.vm) this.vm.motionScale = value;
    else if (key === "brightness") this.world.setBrightness(value);
    else if (key === "gfx") this.world.applyGraphics(value);
    else if (key === "crosshair") this.hud.applyCrosshair(value);
    else if (["hudScale", "hudOpacity", "palette", "hitmarkers", "damageFlash", "damageArcs", "killFeed"].includes(key)) this.applyHudLayout();
  }

  applyToggles(): void {
    const t = this.input.toggles;
    t.clear();
    if (this.settings.get("toggleAim")) t.add("aim");
    if (this.settings.get("toggleCrouch")) t.add("crouch");
    if (this.settings.get("toggleWalk")) t.add("walk");
    this.input.releaseAll();
  }

  applyHudLayout(): void {
    const s = this.settings;
    this.hud.applyLayout({ scale: s.get("hudScale"), opacity: s.get("hudOpacity"), palette: s.get("palette"), hitmarkers: s.get("hitmarkers"),
      damageFlash: s.get("damageFlash"), damageArcs: s.get("damageArcs"), killFeed: s.get("killFeed") });
  }

  /** The Esc menu's header: map, score and how you are in the match. */
  menuInfo(): { title: string; detail: string } {
    const m = this.net?.state.match;
    const score = m?.score ? ` · ${m.score[0]} – ${m.score[1]}` : "";
    const side = this.myTeamSide();
    const how = this.mode === "spectate" ? "Spectating" : side ? (side === "attack" ? "Attacking" : "Defending") : "";
    return { title: `${this.mapName || "Loading…"}${score}`, detail: [how, "the match keeps running"].filter(Boolean).join(" · ") };
  }

  resume(): void {
    if (this.closed) return;
    this.menu.show(false);
    this.audio.unlock();
    if (this.loaded) this.input.lock();
  }

  /** End the match for everyone (only offered to whoever started it; the server checks again). */
  async stopMatch(): Promise<void> {
    if (!window.confirm("Stop this match for everyone in it?")) return;
    const r = await this.net.control("match:stop", { match_id: this.matchId });
    if (!r.ok) { this.hud.message(r.text ?? "could not stop the match", 3); return; }
    setTimeout(() => { location.href = "/play"; }, 600);
  }

  async leave(): Promise<void> {
    if (this.welcome?.mode === "duel" && this.mode === "play" && !this.social.ended && !window.confirm("Leaving now forfeits the duel. Leave?")) return;
    setTimeout(() => { location.href = "/play"; }, 800);
    await this.net.control("match:leave", {});
    location.href = "/play";
  }

  // ---------------------------------------------------------------- welcome
  async onWelcome(w: any): Promise<void> {
    this.welcome = w;
    this.slot = w.slot;
    this.team = w.team;
    this.roster = w.roster || [];
    this.tickRate = w.tick_rate || 64;
    this.dt = 1 / this.tickRate;
    this.pending = [];
    this.adoptServerView = true;
    if (w.moved) this.hud.message(`Teams balanced: you play for team ${w.team + 1} now`, 4);
    if (this.loaded || this.loading) return;
    this.loading = true;
    try {
      const mapKey = w.map || "qalat";
      const data = await this.world.load(mapKey, (step) => this.setOverlay(`Loading ${step}…`));
      const level = new Level(mapKey, data, false);
      this.level = level;
      this.showBriefing(data, w.team);
      this.hud.sites = level.zones.filter((z) => z.kind === "bombsite")
        .map((z) => ({ name: z.name, pos: [(z.min[0] + z.max[0]) / 2, (z.min[1] + z.max[1]) / 2] as [number, number] }));
      if (w.layout) level.applyMode(w.layout);
      this.collision = new CollisionWorld(level.colliders.map((c) => ({ c: c.c, h: [c.size[0] / 2, c.size[1] / 2, c.size[2] / 2] as V3, hpr: c.hpr, surface: c.surface })));
      this.world.panels?.syncCollision(this.collision);
      this.panelsVersion = this.world.panels?.version ?? 0;
      this.setClips(level.clips);
      void this.world.props(level.props);
      this.motor = new PlayerMotor(this.collision);
      this.motor.char.onEvent = (ev) => {
        if (ev.kind === "footstep" || ev.kind === "land") this.audio.footstep(ev.surface, ev.pos, Math.max(ev.loudness, 0.25), true);
        if (ev.kind === "land") this.landKick = 0.04;
      };
      this.soldiers = new Soldiers(this.world);
      this.soldiers.ray = (a, b) => this.collision.ray(a, b);
      this.effects = new Effects(this.world);
      this.vm = new Viewmodel(this.world);
      this.vm.baseFov = this.settings.get("viewmodelFov");
      this.vm.motionScale = this.settings.get("viewBob");
      this.vm.syncEnvironment(this.world.scene, this.world.sun);
      if (this.world.vmPass) {
        this.world.vmPass.scene = this.vm.scene;
        this.world.vmPass.camera = this.vm.camera;
      }
      this.weapons = new LocalWeapons(this.vm, { fire: (d, empty, tracer) => this.ownShot(d, empty, tracer), sound: (n) => this.audio.ui2d(n, 0.6) });
      this.audio.occlusion = (a, b) => !!this.collision.ray(a as V3, b as V3);
      this.effects.placeDecal = (p, n, surface, radius) => this.placeDecal(p, n, surface, radius);
      this.effects.floorAt = (p) => {
        const hit = this.collision.ray([p[0], p[1], p[2] + 0.1], [p[0], p[1], p[2] - 6]);
        return hit ? hit.pos[2] : null;
      };
      this.audio.roofHeight = (p) => {
        const hit = this.collision.ray([p[0], p[1], p[2] + 0.2], [p[0], p[1], p[2] + 25]);
        return hit ? hit.pos[2] - p[2] : null;
      };
      this.setOverlay("Loading shaders…");
      await this.warmupShaders();
      const radar = this.world.mapEntry.radar;
      if (radar) {
        const img = new Image();
        img.src = radar.file;
        img.onload = () => this.hud.setRadar(img, radar);
      }
      this.loaded = true;
      this.setOverlay(this.mode === "spectate" ? "Click to watch" : "Click to play", true);
    } catch (err) {
      this.stateDebug.errors.push(String(err));
      this.setOverlay(`Could not load the map: ${(err as Error).message}`);
      console.error(err);
    } finally {
      this.loading = false;
    }
  }

  /** Compile every shader the match can need while the loading screen is up: the map, all weapon / gadget / grenade
   *  models (world and first-person variants), both soldier kits, effects and decals. Each is drawn once in front
   *  of the camera (a real render, so the shadow-map programs and the post chain compile too), then removed.
   *  Without this the first grenade, muzzle flash or player on screen stalls a frame while its program links. */
  async warmupShaders(): Promise<void> {
    const t0 = performance.now();
    const keys = Object.keys(this.world.assets.manifest?.weapons ?? {});
    const protos = (await Promise.all(keys.map((k) => this.world.weaponModel(k)))).filter((p): p is THREE.Group => !!p);
    const stageWorld = new THREE.Group(), stageVm = new THREE.Group();
    stageWorld.name = "warmup";
    const cam = this.world.camera;
    cam.position.set(0, 0, 50);
    cam.updateMatrixWorld();
    const ahead = new THREE.Vector3(0, 0, -2).applyMatrix4(cam.matrixWorld);
    stageWorld.position.copy(ahead);
    protos.forEach((p, i) => {
      const a = p.clone();
      a.position.set((i % 5) * 0.3 - 0.6, Math.floor(i / 5) * 0.3, 0);
      a.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
      stageWorld.add(a);
      const b = p.clone();
      b.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
      b.position.set((i % 5) * 0.2 - 0.4, 1.0, 0);
      stageVm.add(b);
    });
    for (const o of await this.soldiers.warmupObjects()) { o.position.set(0, 0, 0); stageWorld.add(o); }
    this.world.panels?.warmupMaterials();
    this.world.root.add(stageWorld);
    this.vm.scene.add(stageVm);
    this.vm.camera.position.copy(cam.position);
    this.vm.camera.quaternion.copy(cam.quaternion);
    stageVm.position.copy(ahead);
    this.effects.warmup(true, [ahead.x, ahead.y, ahead.z]);
    try {
      await this.world.renderer.compileAsync(this.world.scene, cam);
      await this.world.renderer.compileAsync(this.vm.scene, this.vm.camera);
    } catch (e) { console.warn("compileAsync", e); }
    this.world.update(this.camPos.set(0, 0, 50));
    this.world.render();
    this.world.root.remove(stageWorld);
    this.vm.scene.remove(stageVm);
    this.effects.warmup(false);
    console.info(`[gfx] shaders warmed up in ${Math.round(performance.now() - t0)} ms (${this.world.renderer.info.programs?.length ?? 0} programs)`);
  }

  /** A bullet hole on the surface it hit: found again in the collision world, kept inside that face (and off its
   *  rounded edges, so it never hangs over a corner), then moved onto the drawn surface - walls are pushed through
   *  the same organic displacement field as their geometry (shared/src/level/organic.ts), and 2 mm out. */
  placeDecal(p: number[], n: number[], surface: string, radius: number): { pos: number[]; radius: number } | null {
    const a: V3 = [p[0] + n[0] * 0.05, p[1] + n[1] * 0.05, p[2] + n[2] * 0.05], b: V3 = [p[0] - n[0] * 0.05, p[1] - n[1] * 0.05, p[2] - n[2] * 0.05];
    const hit = this.collision?.ray(a, b);
    if (!hit) return { pos: [p[0] + n[0] * 0.003, p[1] + n[1] * 0.003, p[2] + n[2] * 0.003], radius };
    const box = hit.box, R = box.R;
    let k = 0, best = -1;
    for (let i = 0; i < 3; i++) { const d = Math.abs(R[i][0] * n[0] + R[i][1] * n[1] + R[i][2] * n[2]); if (d > best) { best = d; k = i; } }
    const rel: V3 = [hit.pos[0] - box.c[0], hit.pos[1] - box.c[1], hit.pos[2] - box.c[2]];
    const local = [0, 1, 2].map((i) => rel[0] * R[i][0] + rel[1] * R[i][1] + rel[2] * R[i][2]);
    const wallLike = [0, 1, 2].filter((i) => i !== k).every((i) => box.h[i] > 0.12) && box.h[2] > 0.6;
    const edge = wallLike ? 0.09 : 0.004;
    for (let i = 0; i < 3; i++) {
      if (i === k) continue;
      const room = box.h[i] - edge;
      if (room <= 0.004) return null;                       // too narrow a face for a hole
      if (radius > room) radius = room;
      local[i] = Math.max(-room + radius, Math.min(room - radius, local[i]));
    }
    const out: V3 = [box.c[0], box.c[1], box.c[2]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out[j] += R[i][j] * local[i];
    let off = 0.002;
    const field = wallLike ? surfaceField(surface) : null;
    if (field) { const d = field(out); off += d[0] * n[0] + d[1] * n[1] + d[2] * n[2]; }
    return { pos: [out[0] + n[0] * off, out[1] + n[1] * off, out[2] + n[2] * off], radius };
  }

  setClips(clips: Array<{ center: V3; size: V3; hpr: V3 }>): void {
    clips.forEach((c, i) => this.collision.setDynamic(`clip:${i}`, GROUP_CLIP, "concrete",
      [{ c: c.center, h: [c.size[0] / 2, c.size[1] / 2, c.size[2] / 2], R: hprMatrix(c.hpr[0], c.hpr[1], c.hpr[2]) }]));
    this.world.setClips(clips);
  }

  itemKey(index: number): string { return this.welcome?.items?.[index] ?? ""; }

  weaponOf(key: string): { model: string; cls: string } | null {
    const d = describeItem(key);
    return d.model ? { model: d.model, cls: d.cls } : null;
  }

  // -------------------------------------------------------------- snapshots
  onSnapshot(snap: any): void {
    this.stateDebug.snaps++;
    if (snap.panels.length || snap.full) {
      this.world.panels?.apply(snap.panels, snap.full);
      if (this.collision && this.world.panels && this.world.panels.version !== this.panelsVersion) {
        this.world.panels.syncCollision(this.collision);
        this.panelsVersion = this.world.panels.version;
      }
    }
    if (snap.self) {
      this.self = snap.self;
      this.selfFlags = flagSet(SELF_FLAGS, snap.self.flags);
      if (this.motor) this.reconcile(snap.self, this.selfFlags, snap.ackCmd);
    }
    for (const ev of snap.events) this.onEvent(ev);
  }

  /** Where the own body is drawn right now: between the last two motor ticks by how far into the current tick we are. */
  private drawnPos(out: V3, now: number): V3 {
    const c = this.motor.char;
    const a = this.tickAlpha(now);
    for (let i = 0; i < 3; i++) out[i] = c.prevPos[i] + (c.pos[i] - c.prevPos[i]) * a;
    return out;
  }

  /** How far into the current command tick `now` is (0..1). */
  tickAlpha(now: number): number {
    if (this.cmdClock === null) return 1;
    return Math.min(1, Math.max(0, (now - this.cmdClock) / (1000 / this.tickRate)));
  }

  private drawnBefore: V3 = [0, 0, 0];
  private drawnAfter: V3 = [0, 0, 0];

  reconcile(s: any, flags: Record<string, boolean>, ack: number): void {
    const m = this.motor;
    const now = performance.now();
    const before = m.char.pos.slice() as V3;
    this.drawnPos(this.drawnBefore, now);
    const wasAlive = m.alive;
    const respawn = this.adoptServerView || (!wasAlive && flags.alive);
    if (respawn) {
      // (re)spawned: look where the server put us
      this.yaw = s.yaw;
      this.pitch = s.pitch;
      this.adoptServerView = false;
      this.pending = [];
    }
    const st: MotorState = { pos: s.pos, vel: s.vel, height: s.height, groundNormal: s.ground_normal, jumpCooldown: s.jump_cooldown, landingTimer: s.landing_timer,
      airTime: s.air_time, stride: s.stride, jumpBuffer: s.jump_buffer, lean: s.lean, speedScale: s.speed_scale, slow: s.slow, yaw: s.yaw, pitch: s.pitch,
      onGround: flags.on_ground, crouched: flags.crouched, walking: flags.walking, moveLock: flags.move_lock, leanLock: flags.lean_lock, alive: flags.alive };
    m.setState(st);
    m.yaw = s.yaw;
    m.pitch = s.pitch;
    let keep = 0;
    for (const p of this.pending) if (p.cmd.seq > ack) this.pending[keep++] = p;
    this.pending.length = keep;
    // the state from the server has no "previous tick": without replay the body is drawn where it is
    m.char.prevPos[0] = m.char.pos[0]; m.char.prevPos[1] = m.char.pos[1]; m.char.prevPos[2] = m.char.pos[2];
    m.char.prevHeight = m.char.height;
    if (flags.alive && !flags.observing) {
      // replaying sets prevPos / prevHeight / the lean's previous value to the second-to-last tick, exactly as
      // runCommands leaves them, so drawing between ticks carries on without a stall after every snapshot
      for (const p of this.pending) {
        m.fixedUpdate(this.dt, new CmdInput(p.cmd));
        p.predicted = m.char.pos.slice() as V3;
      }
    }
    const err = Math.hypot(before[0] - m.char.pos[0], before[1] - m.char.pos[1], before[2] - m.char.pos[2]);
    this.stateDebug.predictionError = err;
    this.stateDebug.maxError = Math.max(this.stateDebug.maxError, err);
    if (err > 1e-3) { this.stateDebug.corrections++; this.perf?.correction(); }
    // a small correction is hidden: the drawn position stays where it was and the difference decays per frame
    // (updateCamera); a large one (or a respawn) snaps
    this.drawnPos(this.drawnAfter, now);
    if (err < SMOOTH_LIMIT && wasAlive && flags.alive && !respawn) {
      this.visualOffset.x += this.drawnBefore[0] - this.drawnAfter[0];
      this.visualOffset.y += this.drawnBefore[1] - this.drawnAfter[1];
      this.visualOffset.z += this.drawnBefore[2] - this.drawnAfter[2];
    } else this.visualOffset.set(0, 0, 0);
  }

  // --------------------------------------------------------------- commands
  makeCommand(): InputCmd {
    const inp = this.input;
    const frozen = this.social.paused || this.social.ended || this.buyOpen;
    const [f, s] = frozen ? [0, 0] : inp.axes();
    let held = 0, pressed = 0;
    if (!frozen) {
      for (const a of HOLD_ACTIONS) if (inp.isDown(a)) held |= BIT[a];
      for (const a of inp.pressed) if (BIT[a] !== undefined) pressed |= BIT[a];
    }
    inp.pressed.clear();
    const rt = this.net.renderTick();
    return quantize({ seq: ++this.seq, yaw: this.yaw, pitch: this.pitch, moveF: f, moveS: s, held: held >>> 0, pressed: pressed >>> 0,
      viewTick: Math.max(0, Math.floor(rt)), viewFrac: rt - Math.floor(rt) });
  }

  runCommands(now: number): void {
    if (!this.loaded || this.mode !== "play" || !this.welcome || !this.net.connected) return;
    const step = 1000 / this.tickRate;
    if (this.cmdClock === null || now - this.cmdClock > 8 * step) this.cmdClock = now - step;
    const out: InputCmd[] = [];
    while (now - this.cmdClock >= step && out.length < 8) {
      this.cmdClock += step;
      const c = this.makeCommand();
      out.push(c);
      const flags = this.selfFlags;
      const alive = flags.alive !== false && !!this.self;
      const inp = new CmdInput(c);
      if (alive && !flags.observing) {
        const m = this.motor;
        m.char.prevPos = m.char.pos.slice() as V3;
        m.char.prevHeight = m.char.height;
        m.fixedUpdate(this.dt, inp);
        this.pending.push({ cmd: c, predicted: m.char.pos.slice() as V3 });
        if (this.pending.length > 128) this.pending.shift();
      }
      const view = new CmdInput(c);
      this.weapons.tick(this.dt, { seq: c.seq, down: (a) => view.down(a as never), pressed: (a) => (c.pressed & (BIT[a] ?? 0)) !== 0 }, this.self,
        this.net.selfAck, alive && !this.buyOpen);
    }
    for (let i = 0; i < out.length; i += 4) this.net.sendCommands(out.slice(i, i + 4));
    this.stateDebug.cmds += out.length;
  }

  // -------------------------------------------------------------- own shots
  ownShot(def: any, _empty: boolean, tracer: boolean): void {
    if (this.spreadState) this.spreadState.fireInacc += def.inaccuracy?.fire_add ?? 0;
    const eye = this.eyePos;
    const dir = this.viewDir();
    const end: V3 = [eye[0] + dir[0] * 200, eye[1] + dir[1] * 200, eye[2] + dir[2] * 200];
    const hit = this.collision.ray(eye, end);
    const hitPos = hit ? hit.pos : end;
    const m = this.vm.muzzleWorld(this.world.camera, 0.6);
    if (!this.scoped) this.effects.muzzleFlash(m, dir, def.muzzle_flash ?? 1);
    if (tracer) this.effects.tracer(m, [...hitPos]);
    if (def.class !== "shotgun" || def.fire_mode !== "pump") {
      const h = THREE.MathUtils.degToRad(this.yaw);
      const r = [Math.cos(h), Math.sin(h)], f = [-Math.sin(h), Math.cos(h)];
      this.effects.eject([eye[0] + r[0] * 0.12 + f[0] * 0.25, eye[1] + r[1] * 0.12 + f[1] * 0.25, eye[2] - 0.12],
        [r[0] * (1.6 + Math.random()) + f[0] * 0.3, r[1] * (1.6 + Math.random()) + f[1] * 0.3, 1.4 + Math.random() * 0.6]);
    }
    this.audio.shot(def.sound, eye, true);
    const p = (def.recoil ? def.recoil.punch : 1) * (this.vm.ads > 0.5 ? 0.45 : 1);
    this.punch.x += (Math.random() - 0.5) * p * 0.6;
    this.punch.y += p * 1.2;
  }

  viewDir(): V3 {
    const h = THREE.MathUtils.degToRad(this.yaw), p = THREE.MathUtils.degToRad(this.pitch);
    return [-Math.sin(h) * Math.cos(p), Math.cos(h) * Math.cos(p), Math.sin(p)];
  }

  // ----------------------------------------------------------------- events
  onEvent(ev: any): void {
    if (!this.loaded) { if (ev.type === "json" && ev.kind === "roster") this.roster = ev.roster; return; }
    const own = this.mode === "play" && this.selfFlags.alive;
    const eye = this.eyePos;
    const near = (p: number[], d: number) => Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]) < d;
    switch (ev.type) {
      case "tracer":
        if (own && near(ev.start, 1.2)) break;          // our own: drawn when we fired
        this.effects.tracer(ev.start, ev.end);
        break;
      case "impact":
        this.effects.impact(ev.pos, ev.normal, ev.surface);
        if (Math.random() < 0.5) this.audio.playAt(`impact_${ev.surface}`, ev.pos, 0.5);
        break;
      case "sound":
        this.audio.playAt(ev.name, ev.pos, ev.volume);
        break;
      case "footstep":
        if (own && near(ev.pos, 1.5)) break;
        this.audio.footstep(ev.surface, ev.pos, ev.loudness);
        break;
      case "shot": {
        if (ev.slot === this.slot && own) break;
        this.audio.shot(ev.profile, ev.pos);
        const s = this.soldiers.bySlot.get(ev.slot);
        if (s) {
          s.fire();
          const mz = s.muzzle();
          this.effects.muzzleFlash(mz, [0, 0, 0], 1);
          if (Math.hypot(mz[0] - this.eyePos[0], mz[1] - this.eyePos[1]) < 25) {
            const h = THREE.MathUtils.degToRad(s.yaw);
            this.effects.eject(mz, [Math.cos(h) * 1.8, Math.sin(h) * 1.8, 1.5]);
          }
        }
        break;
      }
      case "explosion":
        this.effects.explosion(ev.pos, ev.radius, ev.kind === 1);
        {
          // screen shake, stronger close by (the desktop game shook the camera too)
          const d = Math.hypot(ev.pos[0] - this.eyePos[0], ev.pos[1] - this.eyePos[1], ev.pos[2] - this.eyePos[2]);
          this.shake = Math.max(this.shake, (ev.kind === 1 ? 1.6 : 1.0) * Math.max(0, 1 - d / (ev.kind === 1 ? 60 : 25)) * this.settings.get("cameraShake"));
        }
        this.audio.playAt("explosion", ev.pos, 1);
        break;
      case "flash":
        this.effects.flashbang(ev.pos);
        this.audio.playAt("flashbang", ev.pos, 1);
        break;
      case "hit":
        this.hud.hit(!!(ev.flags & 1), !!(ev.flags & 2));
        this.audio.ui2d(ev.flags & 2 ? "hit_head" : "hit", 0.7);
        break;
      case "blind":
        this.hud.flash(ev.duration, ev.strength);
        if (ev.strength > 0.5) this.audio.ui2d("ear_ring", 0.4 * ev.strength);
        break;
      case "radar":
        this.radarSpots.set(ev.slot || -this.radarSpots.size - 1, { pos: ev.pos, t: performance.now() / 1000 });
        break;
      case "json":
        this.onJson(ev);
        break;
      default:
    }
  }

  onJson(ev: any): void {
    switch (ev.kind) {
      case "kill": {
        this.hud.killFeed(ev, this.slot);
        if (ev.killer) { const k = this.stats.get(ev.killer.slot) ?? {}; this.stats.set(ev.killer.slot, { ...k, kills: (k.kills ?? 0) + 1 }); }
        if (ev.victim) {
          const v = this.stats.get(ev.victim.slot) ?? {};
          this.stats.set(ev.victim.slot, { ...v, deaths: (v.deaths ?? 0) + 1 });
          if (ev.victim.slot === this.slot && this.mode === "play") {
            const by = ev.killer && ev.killer.slot !== this.slot ? `killed by ${ev.killer.name}${ev.weapon ? ` · ${ev.weapon}` : ""}${ev.headshot ? " · headshot" : ""}` : "";
            this.hud.banner("YOU DIED", by, 3, "died");
          }
          this.radarSpots.delete(ev.victim.slot);
        }
        if (ev.assister) { const a = this.stats.get(ev.assister.slot) ?? {}; this.stats.set(ev.assister.slot, { ...a, assists: (a.assists ?? 0) + 1 }); }
        break;
      }
      case "round_end": {
        const mine = this.myTeamSide();
        const won = mine && ev.winner_side === mine;
        const reason = String(ev.reason || "").replace(/_/g, " ");
        const mvp = typeof ev.mvp === "string" ? ev.mvp : ev.mvp?.name;
        this.hud.banner(won ? "ROUND WON" : mine ? "ROUND LOST" : `${String(ev.winner_side).toUpperCase()} WIN`, `${reason}${mvp ? `  ·  MVP: ${mvp}` : ""}`, 4, won ? "won" : mine ? "lost" : "");
        const m = this.net.state.match;
        if (m) this.roundHistory.push({ team: (ev.winner_side === "attack") === (m.team0_side === 0) ? 0 : 1, reason: String(ev.reason || "") });
        this.audio.ui2d(won ? "sting_win" : mine ? "sting_lose" : "round_win", 0.6);
        break;
      }
      case "round_start":
        this.effects.clearHoles();
        this.adoptServerView = true;
        this.world.autoExposure?.resetAdaptation();
        this.radarSpots.clear();
        this.audio.ui2d("sting_round_start", 0.5);
        break;
      case "phase": if (ev.phase === "live") this.hud.message("GO", 1.2); break;
      case "bomb_planted": this.hud.message("Charge planted", 2.5); this.audio.ui2d("sting_planted", 0.6); break;
      case "bomb_defused": this.hud.message("Charge defused", 2.5); this.audio.ui2d("bomb_defused", 0.6); break;
      case "halftime": this.hud.message("Half time · sides swap", 4); break;
      case "match_end": this.hud.message(ev.winner_team === this.team ? "Match won" : "Match over", 8); break;
      case "money": this.hud.moneyPop(ev.amount, ev.reason); break;
      case "damage": {
        const eye = this.eyePos;
        const toward = Math.atan2(-(ev.from[0] - eye[0]), ev.from[1] - eye[1]) * 180 / Math.PI;
        this.hud.damageArc(-(toward - this.yaw), ev.amount);
        this.hud.hurt();
        break;
      }
      case "message": this.hud.message(ev.text, 2.5); break;
      case "radio": this.social.line([[`${ev.who ? ev.who.name : "?"} (radio): `, `who ${ev.team === 0 ? "team0" : "team1"}`], [ev.text, "text"]], "radio"); this.audio.ui2d("radio", 0.4); break;
      case "roster": this.roster = ev.roster; break;
      case "team_money":
        for (const [slot, m] of Object.entries(ev.money as Record<string, number>)) this.stats.set(Number(slot), { ...(this.stats.get(Number(slot)) ?? {}), money: m });
        break;
      case "ui": this.audio.ui2d(ev.name, 0.6); break;
      case "sting": break;
      case "emp": this.effects.emp(ev.pos, ev.radius ?? 6); break;
      case "chat": this.social.chat(ev); break;
      case "paused": this.social.setPaused(ev); break;
      case "resumed": this.social.setPaused(null); this.hud.message("Resumed", 2); break;
      case "forfeit": this.hud.message(`${ev.who} forfeits (${ev.why})`, 5); break;
      case "overtime": this.hud.message("Overtime · sides swap every 2 rounds", 4); break;
      case "new_match":
        if (this.social.ended) { this.social.hideEnd(); if (!this.input.locked) this.setOverlay(this.mode === "spectate" ? "Click to watch" : "Click to play", true); }
        this.stats.clear();
        this.roundHistory = [];
        this.hud.message(`Match ${ev.match_no} · ${ev.map}`, 4);
        break;
      default:
    }
  }

  myTeamSide(): string | null {
    const m = this.net.state.match;
    if (!m || (this.team !== 0 && this.team !== 1)) return null;
    return (this.team === 0) === (m.team0_side === 0) ? "attack" : "defend";
  }

  // --------------------------------------------------------------- the frame
  frame(): void {
    requestAnimationFrame(() => this.frame());
    // Settings > frame rate limit, evenly paced: frames are due on a fixed grid of 1000/cap ms (not "at least
    // 1000/cap after the last one"), so a cap that does not divide the refresh rate still averages out exactly
    // instead of drifting between two intervals; a frame counts as due 1 ms early (vsync jitter)
    const cap = this.settings.get("gfx")?.fpsCap ?? 0;
    const now = performance.now();
    if (cap > 0) {
      const interval = 1000 / cap;
      if (now < this.nextFrameDue - 1) return;
      this.nextFrameDue += interval;
      if (this.nextFrameDue < now) this.nextFrameDue = now + interval;      // fell behind (a stall): restart the grid
    }
    this.step();
  }

  /** One frame of the game (frame() schedules it on every animation frame). */
  step(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    if (this.loaded && !this.loading) this.perf?.frame(now - this.lastFrame, this.net?.clockRate ?? 1);
    this.lastFrame = now;
    this.frameNo++;
    this.fpsAcc += dt;
    this.fpsN++;
    if (this.fpsAcc > 0.5) { this.fps = Math.round(this.fpsN / this.fpsAcc); this.fpsAcc = 0; this.fpsN = 0; }
    if (!this.loaded) return;
    // run the command ticks that are due before drawing (the 4 ms interval is only the fallback for slow
    // frames): the drawn own position is then never a tick stale because a timer fired late. runCommands keeps
    // its own clock, so a tick never runs twice and the commands sent are the same as before
    this.runCommands(now);
    this.handleLocalKeys();
    let [dyaw, dpitch] = this.input.look();
    const zoom = this.zoomFactor();
    if (zoom < 0.999) { const k = this.settings.get("zoomSensitivity") * zoom; dyaw *= k; dpitch *= k; }   // the desktop's zoom sensitivity
    this.yaw = ((this.yaw + dyaw) % 360 + 360) % 360;
    this.pitch = Math.max(-89, Math.min(89, this.pitch + dpitch));
    this.mouseDelta[0] = dyaw;
    this.mouseDelta[1] = dpitch;
    this.updateRemotes(dt);
    this.updateCamera(dt, now);
    this.updateWorld(dt);
    this.updateHud(dt);
    this.updateAmbience(dt);
    this.world.update(this.camPos);
    this.vm.setKit(this.team === 1 ? 1 : 0);
    this.vm.update(dt, this.world.camera, this.vmContext());
    this.world.render();
  }

  handleLocalKeys(): void {
    const following = this.mode === "spectate" || this.selfFlags.alive === false;
    // spectating (as in the desktop game): left / right mouse switch player, Space flies freely, over the
    // shoulder unless Settings > first-person spectating
    this.thirdPerson = !this.settings.get("fpSpectate");
    if (following) {
      if (this.input.pressed.has("fire")) { this.spectateNext = true; this.freeFly = false; }
      if (this.input.pressed.has("aim")) { this.spectatePrev = true; this.freeFly = false; }
      if (this.input.pressed.has("jump")) this.freeFly = !this.freeFly;
      for (const a of ["fire", "aim", "jump"]) this.input.pressed.delete(a);
    } else this.freeFly = false;
    for (const a of this.input.takeLocal()) if (a === "buy_menu" && this.mode === "play") this.toggleBuy(!this.buyOpen);
    const tab = this.input.down.has("scoreboard");
    if (tab !== this.boardOpen) {
      this.boardOpen = tab;
      this.hud.showBoard(tab, this.roster, this.stats, this.team, this.net.state.match ? this.net.state.match.score : null, this.roundHistory);
    }
  }

  updateCamera(dt: number, now: number): void {
    const cam = this.world.camera;
    const m = this.motor;
    let eye: V3, yaw = this.yaw, pitch = this.pitch, roll = 0;
    // prediction corrections fade per frame, frame-rate independent
    this.visualOffset.multiplyScalar(Math.exp(-dt * SMOOTH_RATE));
    if (this.mode === "play" && this.self && this.selfFlags.observing && this.self.view) {
      // looking through a drone or a security camera: the server moves it, so its view comes from the snapshots
      const s = this.self, k = 1 - Math.exp(-dt * 20);
      const v = this.obsView ?? { pos: [...s.view_pos] as V3, yaw: s.view_yaw, pitch: s.view_pitch };
      for (let i = 0; i < 3; i++) v.pos[i] += (s.view_pos[i] - v.pos[i]) * k;
      v.yaw += ((((s.view_yaw - v.yaw + 540) % 360) + 360) % 360 - 180) * k;
      v.pitch += (s.view_pitch - v.pitch) * k;
      this.obsView = v;
      eye = [...v.pos] as V3;
      yaw = v.yaw;
      pitch = v.pitch;
      this.ownPos = this.motor.char.pos.slice() as V3;
    } else if (this.mode === "play" && this.self && this.selfFlags.alive !== false) {
      this.obsView = null;
      // the motor steps at the tick rate; the camera is drawn between its last two ticks by how far into the
      // current tick this frame is, so it moves on every frame at any refresh rate (crouch height and lean too)
      const alpha = this.tickAlpha(now);
      const c = m.char;
      const pos = this.drawnPos(this.ownDrawn, now);
      const height = c.prevHeight + (c.height - c.prevHeight) * alpha;
      const h = THREE.MathUtils.degToRad(yaw);
      const lean = m.lean.offset(alpha);
      eye = [pos[0] + this.visualOffset.x + Math.cos(h) * lean, pos[1] + this.visualOffset.y + Math.sin(h) * lean, pos[2] + this.visualOffset.z + height - c.cfg.eye_offset];
      roll = m.lean.roll(alpha);
      this.ownPos = pos;
      const speed = Math.hypot(c.vel[0], c.vel[1]);
      if (c.onGround && speed > 0.3) this.bobPhase += dt * speed * 2.2;
      this.bobWeight += ((c.onGround ? Math.min(speed / 5.4, 1) : 0) - this.bobWeight) * (1 - Math.exp(-dt * 8));
    } else {
      // spectating: follow a living teammate (or anyone, as a spectator) from the interpolated snapshots
      const target = this.freeFly ? null : this.spectateTarget();
      if (this.freeFly) {
        // free camera: WASD flies where you look, Space again goes back to the players
        const [f, sd] = this.input.axes();
        const h = THREE.MathUtils.degToRad(yaw), p = THREE.MathUtils.degToRad(pitch);
        const v = 9 * dt * (this.input.isDown("walk") ? 0.35 : 1);
        this.camPos.x += (-Math.sin(h) * Math.cos(p) * f + Math.cos(h) * sd) * v;
        this.camPos.y += (Math.cos(h) * Math.cos(p) * f + Math.sin(h) * sd) * v;
        this.camPos.z += Math.sin(p) * f * v;
        eye = [this.camPos.x, this.camPos.y, this.camPos.z];
        this.spectating = undefined;
      } else if (target) {
        const s = target.fields;
        eye = [s.pos[0], s.pos[1], s.pos[2] + 1.0 + (s.height ?? 0.8) - 0.13];
        if (this.thirdPerson) {
          // over the shoulder: the mouse orbits the camera around the player, walls push it in
          if (this.spectating !== target.slot) { this.yaw = s.yaw; this.pitch = -12; }
          const h = THREE.MathUtils.degToRad(yaw), p = THREE.MathUtils.degToRad(pitch);
          const fwd: V3 = [-Math.sin(h) * Math.cos(p), Math.cos(h) * Math.cos(p), Math.sin(p)];
          const right: V3 = [Math.cos(h), Math.sin(h), 0];
          const pivot: V3 = [s.pos[0] + right[0] * 0.45, s.pos[1] + right[1] * 0.45, s.pos[2] + 1.0 + (s.height ?? 0.8) * 0.75];
          const want: V3 = [pivot[0] - fwd[0] * 2.6, pivot[1] - fwd[1] * 2.6, pivot[2] - fwd[2] * 2.6];
          const hit = this.collision.ray(pivot, want);
          const k = hit ? Math.max(0, hit.fraction * 2.6 - 0.25) / 2.6 : 1;
          eye = [pivot[0] + (want[0] - pivot[0]) * k, pivot[1] + (want[1] - pivot[1]) * k, pivot[2] + (want[2] - pivot[2]) * k];
        } else {
          yaw = s.yaw;
          pitch = s.pitch ?? 0;
        }
        this.spectating = target.slot;
      } else {
        eye = [this.camPos.x, this.camPos.y, this.camPos.z];
        this.spectating = undefined;
      }
      this.ownPos = null;
    }
    this.punch.multiplyScalar(Math.exp(-dt * 12));
    if (this.shake > 0.01) {
      this.shake *= Math.exp(-dt * 3.5);
      const a = this.shake * 2.2;
      this.punch.x += (Math.random() - 0.5) * a;
      this.punch.y += (Math.random() - 0.5) * a;
    }
    this.landKick = Math.max(0, this.landKick - dt * 0.3);
    eye[2] -= this.landKick;
    this.eyePos = eye;
    this.viewYaw = yaw;
    cam.position.set(eye[0], eye[1], eye[2]);
    // (no allocations in the per-frame path: reused quaternion / euler)
    this.camEuler.set(THREE.MathUtils.degToRad(pitch + this.punch.y * 0.3 + 90), 0, THREE.MathUtils.degToRad(yaw + this.punch.x * 0.3), "ZXY");
    this.camQ.setFromEuler(this.camEuler);
    this.camQr.setFromAxisAngle(Z_AXIS, THREE.MathUtils.degToRad(-roll));
    cam.quaternion.copy(this.camQ).multiply(this.camQr);
    const fov = this.settings.get("fov") * this.zoomFactor();
    if (Math.abs(cam.fov - fov) > 1e-3) { cam.fov = fov; cam.updateProjectionMatrix(); }
    if (this.freeCam) {
      // inspection camera, set from the browser console: __game.freeCam = { pos: [x, y, z], at: [x, y, z] }
      cam.position.set(...this.freeCam.pos);
      cam.up.set(0, 1, 0);
      cam.lookAt(cam.parent!.localToWorld(new THREE.Vector3(...this.freeCam.at)));
    }
    this.camPos.set(eye[0], eye[1], eye[2]);
    const h = THREE.MathUtils.degToRad(yaw), p = THREE.MathUtils.degToRad(pitch);
    this.audio.setListener(eye, [-Math.sin(h) * Math.cos(p), Math.cos(h) * Math.cos(p), Math.sin(p)], [0, 0, 1]);
  }

  /** The ambience by where the listener stands: a roof above, or a tunnel. */
  updateAmbience(dt: number): void {
    this.ambT -= dt;
    if (this.ambT > 0) return;
    this.ambT = 0.5;
    const e = this.eyePos;
    const roof = this.collision.ray(e, [e[0], e[1], e[2] + 25]);
    const env = !roof ? "outdoor" : e[2] < 0.8 ? "tunnel" : "indoor";
    const mix: Record<string, Record<string, number>> = { outdoor: { amb_wind: 0.4 }, indoor: { amb_wind: 0.1, amb_room: 0.3 }, tunnel: { amb_wind: 0.04, amb_tunnel: 0.5 } };
    if (env !== this.ambEnv) { this.ambEnv = env; void this.audio.ambience(mix[env]); }
  }

  zoomFactor(): number {
    const s = this.self;
    const d = this.weapons?.def;
    if (!s || !d || this.weapons.kind !== "gun") { this.scoped = false; return 1; }
    const blend = this.vm ? this.vm.ads : 0;
    if (d.scope && s.zoom > 0) {
      const z = d.scope.zooms[Math.min(s.zoom, d.scope.zooms.length) - 1] ?? 1;
      this.scoped = blend > 0.85;
      return this.scoped ? z : 1 + (z - 1) * blend * 0.3;
    }
    this.scoped = false;
    return 1 + ((d.ads ? d.ads.zoom : 1) - 1) * blend;
  }

  /** The crosshair gap from the weapon's real inaccuracy (shared weapon code): movement, air, crouch, ADS, firing. */
  updateSpread(dt: number, alive: boolean): void {
    const d = this.weapons?.def;
    const key = this.weapons?.key ?? "";
    if (!alive || !d || this.weapons.kind !== "gun" || this.settings.get("crosshair").dynamic === false) { this.hud.setSpread(0); return; }
    if (key !== this.spreadKey) {
      const def = weaponDb().weapons[key];
      this.spreadState = def ? new WeaponState(def) : null;
      this.spreadKey = key;
    }
    const ws = this.spreadState;
    if (!ws) return;
    const rec = ws.d.inaccuracy.fire_recovery;
    if (rec > 0) ws.fireInacc *= Math.exp(-dt / rec);
    const c = this.motor.char;
    const deg = ws.inaccuracy({ speed: Math.hypot(c.vel[0], c.vel[1]), maxSpeed: c.cfg.run_speed * ws.d.speed, onGround: c.onGround,
      crouched: c.crouched, ads: this.vm.ads, scoped: this.scoped });
    const fov = THREE.MathUtils.degToRad(this.world.camera.fov);
    this.hud.setSpread(Math.tan(THREE.MathUtils.degToRad(deg)) / Math.tan(fov / 2) * (this.height / 2));
  }

  vmContext() {
    const d = this.weapons?.def;
    const adsTime = d ? (d.scope ? d.scope.time : d.ads ? d.ads.time : 0.2) : 0.2;
    const aiming = this.input.isDown("aim") && this.weapons?.kind === "gun";
    return { ads: aiming ? 1 : 0, adsTime, mouse: this.mouseDelta, bobPhase: this.bobPhase, bobWeight: this.bobWeight,
      crouch: this.motor?.char.crouched ? 1 : 0, land: -this.landKick, aspect: this.width / this.height };
  }

  spectateCandidates(): number[] {
    const out: number[] = [];
    for (const [slot, r] of this.remotes) {
      if (r.seen !== this.frameNo || !r.alive) continue;
      if (this.mode === "play" && this.team !== null && r.f.team !== this.team) continue;
      out.push(slot);
    }
    return out.sort((a, b) => a - b);
  }

  spectateTarget(): { slot: number; fields: any } | null {
    const slots = this.spectateCandidates();
    if (!slots.length) return null;
    if (this.spectateNext || this.spectatePrev) {
      const step = this.spectateNext ? 1 : -1;
      this.spectateNext = this.spectatePrev = false;
      const i = this.spectating === undefined ? -1 : slots.indexOf(this.spectating);
      this.spectating = slots[(i + step + slots.length) % slots.length];
    }
    const slot = this.spectating !== undefined && slots.includes(this.spectating) ? this.spectating : slots[0];
    const fields = this.interpSoldier(slot);
    return fields ? { slot, fields } : null;
  }

  /** A soldier as drawn this frame (see updateRemotes), or null. */
  interpSoldier(slot: number): any {
    const r = this.remotes.get(slot);
    return r && r.seen === this.frameNo ? r.f : null;
  }

  /** Every other soldier, once per frame, at the render clock (100 ms behind the server):
   *  - position: Hermite interpolation between the two snapshots around the render tick, using their velocities
   *    as tangents (limited to what the path allows), so turns and strafes curve instead of zig-zagging;
   *  - past the newest snapshot (a late packet): linear extrapolation for 50 ms that then eases out, never a freeze;
   *  - a jump between what was drawn and the new path (e.g. the late snapshot arriving) is absorbed into an offset
   *    that fades out (exponential, frame-rate independent); respawns and teleports snap;
   *  - yaw along the shortest arc; pitch, crouch height and lean linear.
   *  The interpolated fields live in one object per soldier that is reused every frame (no garbage per frame). */
  updateRemotes(dt: number): void {
    const br = this.net.bracket(this.net.renderTick());
    if (!br) { this.remotes.clear(); return; }
    const [a, b, t] = br;
    const gap = Math.max(1, b.tick - a.tick) / this.tickRate;
    const over = this.net.overTicks / this.tickRate;
    const extra = over <= EXTRAP_LINEAR ? over : EXTRAP_LINEAR + EXTRAP_EASE * (1 - Math.exp(-(over - EXTRAP_LINEAR) / EXTRAP_EASE));
    const decay = Math.exp(-dt * REMOTE_SMOOTH);
    const frame = this.frameNo;
    for (const [slot, sb] of b.soldiers) {
      let r = this.remotes.get(slot);
      if (!r) {
        r = { f: {}, pos: [0, 0, 0], vel: [0, 0, 0], offset: [0, 0, 0], prev: [0, 0, 0], hasPrev: false, alive: false, seen: -1 };
        this.remotes.set(slot, r);
      }
      const continued = r.seen === frame - 1;
      r.seen = frame;
      const sa = a.soldiers.get(slot) ?? sb;
      const f = r.f;
      for (const k in sb) f[k] = sb[k];
      const alive = !!(sb.flags & 1);
      const flip = ((sa.flags ^ sb.flags) & 1) !== 0;
      const va: number[] = sa.vel ?? [0, 0, 0], vb: number[] = sb.vel ?? [0, 0, 0];
      if (flip || a === b) {
        for (let i = 0; i < 3; i++) { r.pos[i] = sb.pos[i]; r.vel[i] = vb[i]; }
        f.yaw = sb.yaw;
      } else if (t <= 1) {
        const chord = Math.hypot(sb.pos[0] - sa.pos[0], sb.pos[1] - sa.pos[1], sb.pos[2] - sa.pos[2]);
        const limit = 1.5 * chord + 0.02;
        const ta = Math.min(1, limit / Math.max(1e-6, Math.hypot(va[0], va[1], va[2]) * gap)) * gap;
        const tb = Math.min(1, limit / Math.max(1e-6, Math.hypot(vb[0], vb[1], vb[2]) * gap)) * gap;
        for (let i = 0; i < 3; i++) {
          r.pos[i] = hermite(sa.pos[i], va[i] * ta, sb.pos[i], vb[i] * tb, t);
          r.vel[i] = va[i] + (vb[i] - va[i]) * t;
        }
        f.yaw = sa.yaw + ((((sb.yaw - sa.yaw + 540) % 360) + 360) % 360 - 180) * t;
      } else {
        for (let i = 0; i < 3; i++) { r.pos[i] = sb.pos[i] + vb[i] * extra; r.vel[i] = over > EXTRAP_LINEAR ? 0 : vb[i]; }
        f.yaw = sb.yaw;
      }
      const tc = Math.min(t, 1);
      f.pitch = (sa.pitch ?? 0) + ((sb.pitch ?? 0) - (sa.pitch ?? 0)) * tc;
      f.height = sa.height + (sb.height - sa.height) * tc;
      f.lean = (sa.lean ?? 0) + ((sb.lean ?? 0) - (sa.lean ?? 0)) * tc;
      // hide discontinuities: compare with where the last drawn position was heading
      if (!continued || !r.hasPrev || alive !== r.alive) { r.offset[0] = r.offset[1] = r.offset[2] = 0; }
      else {
        const ex = r.pos[0] - (r.prev[0] + r.vel[0] * dt), ey = r.pos[1] - (r.prev[1] + r.vel[1] * dt), ez = r.pos[2] - (r.prev[2] + r.vel[2] * dt);
        const e = Math.hypot(ex, ey, ez);
        if (e > REMOTE_SNAP) { r.offset[0] = r.offset[1] = r.offset[2] = 0; }
        else if (e > 0.02) { r.offset[0] -= ex; r.offset[1] -= ey; r.offset[2] -= ez; }
        for (let i = 0; i < 3; i++) r.offset[i] *= decay;
      }
      for (let i = 0; i < 3; i++) r.prev[i] = r.pos[i];
      r.hasPrev = true;
      r.alive = alive;
      if (!f.drawPos) f.drawPos = [0, 0, 0];
      for (let i = 0; i < 3; i++) f.drawPos[i] = r.pos[i] + r.offset[i];
      f.pos = f.drawPos;
      f.vel = r.vel;
    }
    for (const [slot, r] of this.remotes) if (r.seen !== frame) this.remotes.delete(slot);
  }

  private soldierStates = new Map<number, SoldierState>();
  private flagCache = new Map<number, Record<string, boolean>>();

  updateWorld(dt: number): void {
    const states = this.soldierStates;
    states.clear();
    for (const [slot, r] of this.remotes) {
      if (r.seen !== this.frameNo) continue;
      const f = r.f;
      let flags = this.flagCache.get(f.flags);
      if (!flags) { flags = flagSet(SOLDIER_FLAGS, f.flags); this.flagCache.set(f.flags, flags); }
      states.set(slot, { fields: f, flags, weapon: this.weaponOf(this.itemKey(f.item)) });
      const st = this.stats.get(slot) ?? {};
      if (st.alive !== flags.alive) this.stats.set(slot, { ...st, alive: flags.alive });
    }
    // the soldier whose eyes we look through is not drawn
    const hide = this.mode === "play" && this.selfFlags.alive ? this.slot ?? -1 : this.thirdPerson ? -1 : this.spectating ?? -1;
    this.soldiers.update(states, dt, hide);
    const ents: EntityDraw[] = [];
    const st = this.net.state;
    for (const [id, e] of st.entities) {
      if (e.kind === KIND_GRENADE) ents.push({ id, key: this.weaponOf(this.itemKey(e.f.item))?.model ?? null, pos: e.f.pos });
      else if (e.kind === KIND_BOMB && e.f.state >= 2) ents.push({ id, key: "bomb_charge", pos: e.f.pos });
      else if (e.kind === KIND_PICKUP) {
        const key = this.itemKey(e.f.item);
        const model = this.weaponOf(key)?.model;
        if (model) ents.push({ id, key: model, pos: e.f.pos, yaw: e.f.yaw, roll: Math.PI / 2 });
      } else if (e.kind === KIND_GADGET && GADGET_MODELS[e.f.model]) ents.push({ id, key: GADGET_MODELS[e.f.model], pos: e.f.pos, yaw: e.f.yaw });
      else if (e.kind === KIND_DRONE) ents.push({ id, key: "gadget_drone", pos: e.f.pos, yaw: e.f.yaw });
    }
    this.effects.entities(ents);
    this.effects.smoke(st.ofKind(KIND_SMOKE), dt);
    this.effects.update(dt, this.height * this.world.renderer.getPixelRatio(), this.world.camera.fov);
    const s = this.self;
    if (s) {
      this.weapons.setItem(this.itemKey(s.item));
      this.vm.setHidden(!this.selfFlags.alive || this.scoped || this.mode !== "play" || !!this.selfFlags.observing);
    } else this.vm.setHidden(true);
    void KIND_SOLDIER;
  }

  updateHud(dt: number): void {
    const st = this.net.state;
    this.hud.match(st.match, this.team);
    const s = this.self;
    const alive = this.mode === "play" && !!this.selfFlags.alive;
    if (s) {
      const view = { ...s, ammo: this.weapons.ammo(s.ammo, this.net.selfAck) };
      const key = this.itemKey(s.item);
      const d = describeItem(key);
      this.hud.vitalsUpdate(view, d.def?.name ?? key.replace(/_/g, " "), alive);
      if (this.lastHealth !== undefined && s.health < this.lastHealth) this.hud.hurt();
      this.lastHealth = s.health;
      this.hud.hint.textContent = this.selfFlags.observing ? "Mouse: look · Q / E: switch view · 6: leave"
        : this.selfFlags.can_buy && !this.buyOpen && PHASES[st.match?.phase ?? 0] === "freeze" ? "B: buy" : "";
    } else this.hud.vitalsUpdate(null, "", false);
    // the HUD shows the spectated player's health, armour and weapon
    const watched = this.spectating !== undefined && (this.mode === "spectate" || !alive) && !this.freeFly ? this.interpSoldier(this.spectating) : null;
    if (watched) {
      const key = this.itemKey(watched.item);
      this.hud.vitalsUpdate({ health: watched.health ?? 0, armor: watched.armor ?? 0, money: s && this.mode === "play" ? s.money : undefined, ammo: 0, reserve: 0 },
        describeItem(key).def?.name ?? key.replace(/_/g, " "), true);
    }
    const where = this.ownPos ?? (watched ? watched.pos : [this.camPos.x, this.camPos.y, this.camPos.z]);
    const callout = this.level?.callouts.find((c) => where[0] >= c.min[0] && where[0] <= c.max[0] && where[1] >= c.min[1] && where[1] <= c.max[1]);
    this.hud.setLocation(callout ? callout.name : "");
    this.hud.setBadges(alive && !!this.selfFlags.charge, alive && !!this.selfFlags.kit, alive && !!this.selfFlags.helmet);
    this.hud.radarOptions = { show: this.settings.get("radar"), rotate: this.settings.get("radarRotate"), zoom: this.settings.get("radarZoom") };
    this.updateSpread(dt, alive);
    this.hud.setScope(this.scoped);
    const rtt = this.net.rtt === null ? "?" : Math.round(this.net.rtt);
    const status = this.settings.get("showFps") ? `${this.fps} fps · ${rtt} ms · ${this.net.kbps().toFixed(1)} KB/s` : "";
    if (!this.closed && this.net.connected) this.hud.setStatus(this.spectating !== undefined && !alive && this.mode === "play" ? `${status}\nspectating` : status);
    if ((this.mode === "spectate" || !alive) && !this.selfFlags.observing && (this.spectating !== undefined || this.freeFly)) {
      this.hud.hint.textContent = this.freeFly ? "WASD: fly · Space: follow players" : "Left / right mouse: switch player · Space: free camera";
    }
    this.hud.update(dt);
    // compass: the sites, team pings and the planted charge
    const markers: CompassMarker[] = this.hud.sites.map((x) => ({ pos: x.pos, label: x.name, color: "#ffd36a" }));
    for (const [, b] of st.ofKind(KIND_BOMB)) if (b.state === 3) markers.push({ pos: [b.pos[0], b.pos[1]], label: "C", color: "#ff7a2a" });
    for (const [k, spot] of this.radarSpots) if (k <= 0) markers.push({ pos: [spot.pos[0], spot.pos[1]], label: "!", color: "#ff4a3a" });
    this.hud.compassCanvasVisible(this.settings.get("compass"));
    this.hud.compass(this.viewYaw, where, markers);
    // radar: me, teammates, enemies the team spotted (for 3 s), the charge
    if (this.hud.radarImg) {
      const me = this.ownPos ?? [this.camPos.x, this.camPos.y, this.camPos.z];
      const dots: RadarDot[] = [];
      for (const [slot, sol] of this.soldiers.bySlot) {
        if (slot === this.slot || !sol.alive) continue;
        const friend = this.team === null || sol.team === this.team;
        if (!friend && this.mode === "play") continue;
        dots.push({ pos: [sol.pos[0], sol.pos[1]], color: sol.team === 0 ? "#e2a144" : "#5aa7e8", yaw: sol.yaw });
      }
      const t = performance.now() / 1000;
      for (const [k, spot] of this.radarSpots) {
        const age = t - spot.t;
        if (age > RADAR_KEEP) { this.radarSpots.delete(k); continue; }
        dots.push({ pos: [spot.pos[0], spot.pos[1]], color: "#ff4a3a", fade: 1 - age / RADAR_KEEP });
      }
      for (const [, b] of st.ofKind(KIND_BOMB)) if (b.state >= 2 && b.state <= 3) dots.push({ pos: [b.pos[0], b.pos[1]], color: "#ff9a2a", diamond: true, blink: b.state === 3 });
      this.hud.radar(me, this.viewYaw, dots);
    }
  }

  // ----------------------------------------------------------------- buying
  toggleBuy(on: boolean): void {
    this.buyOpen = on;
    if (on) {
      this.input.enabled = false;
      this.input.releaseAll();
      this.input.unlock();
      this.overlay.classList.add("hidden");
      this.hud.showBuy(true, this.buyModel());
      this.buyKeyHandler = (e: KeyboardEvent) => {
        if (e.code === "Escape" || e.code === "KeyB" || e.code === this.input.binds.buy_menu) {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.toggleBuy(false);
          return;
        }
        const key = this.hud.buyKeys.get(e.code);
        if (key?.startsWith("specialist:")) { e.preventDefault(); void this.net.control("specialist", { item: key.slice(11) }); }
        else if (key) { e.preventDefault(); this.buyItem(key); }
      };
      document.addEventListener("keydown", this.buyKeyHandler, true);
    } else {
      this.input.enabled = true;
      this.hud.showBuy(false);
      if (this.buyKeyHandler) document.removeEventListener("keydown", this.buyKeyHandler, true);
      this.resume();
    }
  }

  buyModel(): BuyModel {
    const s = this.self ?? {};
    const side = this.myTeamSide() ?? "attack";
    const items: string[] = this.welcome.items;
    const owned = new Set<string>();
    for (const idx of s.weapons ?? []) if (idx) owned.add(items[idx]);
    (s.grenades ?? []).forEach((n: number, i: number) => { if (n > 0) owned.add(GRENADE_KEYS[i]); });
    const cats = ((this.welcome.shop ?? {})[side] ?? []).map(([title, list]: [string, any[]]) => [title, list.map((it) => ({
      ...it, owned: owned.has(it.key) && it.kind !== "equipment", disabled: (s.money ?? 0) < it.price }))]);
    return { money: s.money ?? 0, categories: cats, note: this.selfFlags.can_buy ? "" : "You can only buy in your spawn during the buy time.",
      onBuy: (k) => this.buyItem(k), onSell: (k) => this.sellItem(k), specialists: this.specialistChoices(side, s.gadget ?? 0),
      onSpecialist: (k) => void this.net.control("specialist", { item: k }) };
  }

  /** The side's specialists for the buy menu; the current one is found from the gadget in the self block. */
  specialistChoices(side: string, gadgetIndex: number): SpecialistChoice[] {
    const list: any[] = [...(SPECIALISTS[side] ?? []), SPECIALISTS.recruit].filter(Boolean);
    const gadget = gadgetIndex ? (this.welcome.gadgets ?? [])[gadgetIndex - 1] : null;
    return list.map((sp) => ({ key: sp.key ?? "recruit", name: sp.name ?? "Recruit", role: sp.role ?? "", desc: sp.desc ?? "",
      color: sp.color ?? [0.6, 0.6, 0.6], current: gadget ? sp.gadget === gadget : !sp.gadget }));
  }

  buyItem(key: string): void { void this.net.control("buy", { item: key }); }
  sellItem(key: string): void { void this.net.control("sell", { item: key }); }

  onShop(r: any): void {
    if (!r.ok) this.hud.message(r.text || "can't do that", 1.5);
    else if (r.kind === "buy") this.audio.ui2d("buy", 0.6);
    setTimeout(() => { if (this.buyOpen) this.hud.showBuy(true, this.buyModel()); }, 150);
  }
}

const root = document.getElementById("game3d");
if (root) {
  const game = new Game(root);
  game.start().catch((err) => {
    console.error(err);
    const t = root.querySelector(".overlay .text");
    if (t) t.textContent = `Could not start: ${(err as Error).message}`;
  });
}
void WEAPONS_JSON;
