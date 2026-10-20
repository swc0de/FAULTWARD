// Bakes the client assets of a map from its data file (data/maps/<key>.json):
//   geometry (GLB), vehicle/tree instances, the lighting volume, the radar image and the light list,
// then registers them in a new hashed copy of the client asset manifest.
//
//   node scripts/bake-map.mjs <map key> [--samples N]
//
// The level is built with the game's own level code (shared/src/level, taken from server/dist/worker.mjs),
// so the visuals line up exactly with the collision the server and the client build from the same file.
// "visual_pieces" in the map file are drawn into the geometry only: the game never reads them, so they
// must not be anything a player could collide with (crops, gable ends, silo caps, fixtures).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT = path.join(ROOT, "client", "dist");
const OUT_DIR = path.join(CLIENT, "assets", "g", "maps");
const args = process.argv.slice(2);
const key = args.find((a) => !a.startsWith("--"));
if (!key) {
  console.error("usage: node scripts/bake-map.mjs <map key> [--samples N]");
  process.exit(1);
}
const opt = (name, d) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : d;
};
const SKY_RAYS = opt("samples", 48);
const say = (m) => process.stderr.write(`${m}\n`);

// ----------------------------------------------------------------------------------------- level code
async function loadLevelCode() {
  const src = fs.readFileSync(path.join(ROOT, "server", "dist", "worker.mjs"), "utf8");
  const cut = src.lastIndexOf("// server/src/match/worker.ts");
  if (cut < 0) throw new Error("worker.mjs: match worker section not found");
  const tmp = path.join(ROOT, "server", "dist", `.bake-level-${process.pid}.mjs`);
  fs.writeFileSync(tmp, `${src.slice(0, cut)}\nexport { Level, LevelContext, MeshBuilder, PREFABS, FLOATS_PER_VERTEX, Random };\n`);
  try {
    return await import(pathToFileURL(tmp).href);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// -------------------------------------------------------------------------------- visual-only prefabs
function registerVisualPrefabs(L) {
  const { PREFABS, Random } = L;
  const D = Math.PI / 180;
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const norm = (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  };

  // A two-sided blade from `p` along `w` (width) and `h` (length), lit like foliage: both faces take a normal
  // tipped up toward the sky, so thin leaves never go black on their shaded side.
  const blade = (b, p, w, h, uv = 1) => {
    const wl = Math.hypot(...w), hl = Math.hypot(...h);
    const t = mul(w, 1 / wl), bn = mul(h, 1 / hl);
    const n0 = norm([t[1] * bn[2] - t[2] * bn[1], t[2] * bn[0] - t[0] * bn[2], t[0] * bn[1] - t[1] * bn[0]]);
    const c = [p, add(p, w), add(add(p, w), h), add(p, h)];
    const u = [[0, 0], [wl / uv, 0], [wl / uv, hl / uv], [0, hl / uv]];
    for (const s of [1, -1]) {
      const n = norm(add(mul(n0, s), [0, 0, 1.1]));
      if (s > 0) b.addQuad(c, n, t, bn, u);
      else b.addQuad([c[1], c[0], c[3], c[2]], n, mul(t, -1), bn, [u[1], u[0], u[3], u[2]]);
    }
  };

  // A field of crops inside a rectangle, planted in rows: corn (single plants: stalk, leaves, tassel) or wheat
  // (clumps of blades and heads; the dense mass under them is a "crop_surface" in the map file).
  PREFABS.crop_field = (ctx, e) => {
    if (!ctx.geometry) return;
    const [[x0, y0], [x1, y1]] = [e.min, e.max];
    const corn = (e.kind ?? "corn") === "corn";
    const rows = e.rows ?? "y"; // rows run along this axis
    const spacing = e.spacing ?? (corn ? 0.85 : 0.45);
    const step = e.step ?? (corn ? 0.42 : 0.4);
    const height = e.height ?? (corn ? 2.35 : 0.95);
    const leafB = ctx.builder(e.mat ?? (corn ? "fruit_green" : "sack"));
    const topB = ctx.builder(e.top_mat ?? (corn ? "sack" : "wool"));
    const rng = new Random(e.seed ?? 7);
    const gaps = e.gaps ?? []; // [[x0, y0, x1, y1]] left unplanted (tracks)
    const inGap = (x, y) => gaps.some(([a, b, c, d]) => x >= a && x <= c && y >= b && y <= d);
    const [lo, hi, a0, a1] = rows === "y" ? [x0, x1, y0, y1] : [y0, y1, x0, x1];
    for (let u = lo + spacing / 2; u < hi; u += spacing) {
      for (let v = a0 + step / 2; v < a1; v += step) {
        const uu = u + rng.uniform(-0.07, 0.07), vv = v + rng.uniform(-0.08, 0.08);
        const [cx, cy] = rows === "y" ? [uu, vv] : [vv, uu];
        if (inGap(cx, cy)) continue;
        if (corn) {
          const h = height * rng.uniform(0.85, 1.07);
          const lean = [rng.uniform(-0.05, 0.05), rng.uniform(-0.05, 0.05), 1];
          // stalk: two crossed strips
          const a = rng.uniform(0, Math.PI);
          for (const da of [0, Math.PI / 2]) {
            const w = [Math.cos(a + da) * 0.05, Math.sin(a + da) * 0.05, 0];
            blade(leafB, [cx - w[0] / 2, cy - w[1] / 2, 0], w, mul(lean, h), 0.5);
          }
          // leaves: long blades rising out from the stalk and drooping at the tips
          for (let k = 0; k < 3; k++) {
            const z = h * (0.3 + k * 0.17 + rng.uniform(-0.04, 0.04));
            const ang = a + k * 2.2 + rng.uniform(-0.4, 0.4);
            const d = [Math.cos(ang), Math.sin(ang)];
            const L1 = rng.uniform(0.35, 0.45), L2 = rng.uniform(0.3, 0.4);
            const w = [-d[1] * 0.1, d[0] * 0.1, 0];
            const p0 = [cx + lean[0] * z - w[0] / 2, cy + lean[1] * z - w[1] / 2, z];
            const s1 = [d[0] * L1, d[1] * L1, L1 * 0.55];
            blade(leafB, p0, w, s1, 0.5);
            blade(leafB, add(p0, s1), mul(w, 0.8), [d[0] * L2, d[1] * L2, -L2 * 0.45], 0.5);
          }
          // tassel
          for (const da of [0, Math.PI / 2]) {
            const tw = [Math.cos(a + da) * 0.035, Math.sin(a + da) * 0.035, 0];
            blade(topB, [cx + lean[0] * h - tw[0] / 2, cy + lean[1] * h - tw[1] / 2, h - 0.05], tw, [rng.uniform(-0.04, 0.04), rng.uniform(-0.04, 0.04), 0.32], 0.5);
          }
          // an ear on every other plant
          if (rng.random() < 0.5) {
            const ea = a + 1.0;
            const ez = h * 0.5;
            blade(leafB, [cx + Math.cos(ea) * 0.05, cy + Math.sin(ea) * 0.05, ez], [-Math.sin(ea) * 0.07, Math.cos(ea) * 0.07, 0], [Math.cos(ea) * 0.08, Math.sin(ea) * 0.08, 0.26], 0.5);
          }
        } else {
          // wheat: two thin stalks out of the mass, each with its head
          const base = height * 0.6;
          for (let k = 0; k < 2; k++) {
            const h = height * rng.uniform(0.95, 1.15);
            const ang = rng.uniform(0, Math.PI);
            const w = [Math.cos(ang) * 0.025, Math.sin(ang) * 0.025, 0];
            const lean = [rng.uniform(-0.06, 0.06), rng.uniform(-0.06, 0.06)];
            const px = cx + rng.uniform(-0.12, 0.12), py = cy + rng.uniform(-0.12, 0.12);
            const len = h - base - 0.12;
            blade(leafB, [px - w[0] / 2, py - w[1] / 2, base], w, [lean[0], lean[1], len], 0.4);
            const hw = mul(w, 2.6);
            blade(topB, [px + lean[0] - hw[0] / 2, py + lean[1] - hw[1] / 2, base + len], hw, [lean[0] * 0.5, lean[1] * 0.5, 0.14], 0.3);
          }
        }
      }
    }
  };

  // The dense mass of a standing crop seen from above and from its edges (visual only): a slab whose top is a
  // little rough, so wheat reads as a field and not a floor.
  PREFABS.crop_surface = (ctx, e) => {
    if (!ctx.geometry) return;
    const [[x0, y0], [x1, y1]] = [e.min, e.max];
    const h = e.height ?? 0.82;
    const b = ctx.builder(e.mat ?? "sack");
    const uv = ctx.uvScale(e.mat ?? "sack");
    const rng = new Random(e.seed ?? 3);
    const cell = 2.0;
    const nx = Math.max(1, Math.round((x1 - x0) / cell)), ny = Math.max(1, Math.round((y1 - y0) / cell));
    const zs = [];
    for (let i = 0; i <= nx; i++) {
      zs.push([]);
      for (let j = 0; j <= ny; j++) zs[i].push(h + (i === 0 || j === 0 || i === nx || j === ny ? -0.05 : rng.uniform(-0.07, 0.07)));
    }
    const P = (i, j) => [x0 + ((x1 - x0) * i) / nx, y0 + ((y1 - y0) * j) / ny, zs[i][j]];
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++) {
        const a = P(i, j), bb = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
        const n = norm([-(bb[2] - a[2]) / ((x1 - x0) / nx), -(d[2] - a[2]) / ((y1 - y0) / ny), 1]);
        const ou = rng.uniform(0, 1), ov = rng.uniform(0, 1);              // per-cell offset: no visible tiling grid
        b.addQuad([a, bb, c, d], n, [1, 0, 0], [0, 1, 0], [[a[0] / uv + ou, a[1] / uv + ov], [bb[0] / uv + ou, bb[1] / uv + ov], [c[0] / uv + ou, c[1] / uv + ov], [d[0] / uv + ou, d[1] / uv + ov]]);
      }
    // sides (their own material when given: the edge of a field seen from beside it; v runs down from the top)
    const sb = ctx.builder(e.side_mat ?? e.mat ?? "sack"), suv = ctx.uvScale(e.side_mat ?? e.mat ?? "sack");
    const side = (p0, p1, out) => {
      const w = [p1[0] - p0[0], p1[1] - p0[1], 0];
      const L = Math.hypot(w[0], w[1]);
      const t = [w[0] / L, w[1] / L, 0];
      const c = [[p0[0], p0[1], 0], [p1[0], p1[1], 0], [p1[0], p1[1], h - 0.05], [p0[0], p0[1], h - 0.05]];
      sb.addQuad(c, norm([out[0], out[1], 0.6]), t, [0, 0, 1], [[0, h / suv], [L / suv, h / suv], [L / suv, 0.04], [0, 0.04]]);
    };
    side([x0, y0], [x1, y0], [0, -1]);
    side([x1, y1], [x0, y1], [0, 1]);
    side([x0, y1], [x0, y0], [-1, 0]);
    side([x1, y0], [x1, y1], [1, 0]);
  };

  // A dome cap (visual only) on a round silo or bin.
  PREFABS.dome_cap = (ctx, e) => {
    if (!ctx.geometry) return;
    ctx.dome(e.base, e.radius, e.mat ?? "steel_galv", e.squash ?? 0.45, 36);
    if (e.vent) ctx.cylinder([e.base[0], e.base[1], e.base[2] + e.radius * (e.squash ?? 0.45) + 0.15], 0.35, 0.45, e.mat ?? "steel_galv", 16);
  };

  // A triangular gable end of a pitched roof: base line p0-p1 at height z, apex height h above it (visual only).
  PREFABS.gable = (ctx, e) => {
    if (!ctx.geometry) return;
    const [p0, p1] = [e.p0, e.p1];
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], len = Math.hypot(dx, dy);
    const heading = Math.atan2(dy, dx) / D;
    const t = e.thickness ?? 0.2, h = e.height, z = e.z ?? 0;
    const mat = e.mat ?? "wood_planks";
    // stacked courses, each a box shortened to the roof line: reads as lap siding up the gable
    const course = e.course ?? 0.25;
    for (let zz = 0; zz < h - 1e-3; zz += course) {
      const ch = Math.min(course, h - zz);
      const w = len * (1 - (zz + ch / 2) / h);
      if (w < 0.05) continue;
      ctx.box([p0[0] + dx / 2, p0[1] + dy / 2, z + zz + ch / 2], [w, t, ch], mat, { hpr: [heading, 0, 0], collide: false, occlude: false });
    }
  };

  // Plain boxes and cylinders that only decorate (trim, shutters, wheels, rims).
  PREFABS.visual_box = (ctx, e) => {
    if (!ctx.geometry) return;
    const size = e.size;
    const pos = e.base ? [e.base[0], e.base[1], e.base[2] + size[2] / 2] : e.pos;
    ctx.box(pos, size, e.mat ?? "wood_planks", { hpr: e.hpr ?? [e.heading ?? 0, 0, 0], collide: false, occlude: false });
  };
  PREFABS.visual_cylinder = (ctx, e) => {
    if (!ctx.geometry) return;
    ctx.cylinder(e.pos, e.radius, e.height, e.mat ?? "steel", e.segments ?? 20, e.caps ?? true, e.hpr ?? [0, 0, 0]);
  };
}

// -------------------------------------------------------------------------------------- math helpers
function hprMatrix(h, p, r = 0) {
  const DEG = Math.PI / 180;
  const ch = Math.cos(h * DEG), sh = Math.sin(h * DEG), cp = Math.cos(p * DEG), sp = Math.sin(p * DEG), cr = Math.cos(r * DEG), sr = Math.sin(r * DEG);
  return [
    [cr * ch - sr * sp * sh, cr * sh + sr * sp * ch, -sr * cp],
    [-cp * sh, cp * ch, sp],
    [sr * ch + cr * sp * sh, sr * sh - cr * sp * ch, cr * cp]
  ];
}

// Correlated colour temperature to linear RGB (Tanner Helland's fit, then sRGB -> linear), brightest channel 1.
function kelvinRGB(k) {
  const t = k / 100;
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const lin = [r, g, b].map((c) => Math.pow(Math.min(Math.max(c, 0), 255) / 255, 2.2));
  const m = Math.max(...lin);
  return lin.map((c) => c / m);
}

// ------------------------------------------------------------------------------------ voxel occupancy
class Voxels {
  constructor(min, max, res) {
    this.min = min;
    this.res = res;
    this.n = [0, 1, 2].map((i) => Math.ceil((max[i] - min[i]) / res));
    this.solid = new Uint8Array(this.n[0] * this.n[1] * this.n[2]);
  }
  idx(i, j, k) {
    return (k * this.n[1] + j) * this.n[0] + i;
  }
  addBox(c, size, hpr, pad = 0.15) {
    const R = hprMatrix(hpr[0], hpr[1], hpr[2]);
    const h = [size[0] / 2 + pad, size[1] / 2 + pad, size[2] / 2 + pad];
    const ext = [0, 1, 2].map((a) => Math.abs(R[0][a]) * h[0] + Math.abs(R[1][a]) * h[1] + Math.abs(R[2][a]) * h[2]);
    const lo = [0, 1, 2].map((a) => Math.max(0, Math.floor((c[a] - ext[a] - this.min[a]) / this.res)));
    const hi = [0, 1, 2].map((a) => Math.min(this.n[a] - 1, Math.floor((c[a] + ext[a] - this.min[a]) / this.res)));
    for (let k = lo[2]; k <= hi[2]; k++) {
      const z = this.min[2] + (k + 0.5) * this.res - c[2];
      for (let j = lo[1]; j <= hi[1]; j++) {
        const y = this.min[1] + (j + 0.5) * this.res - c[1];
        for (let i = lo[0]; i <= hi[0]; i++) {
          const x = this.min[0] + (i + 0.5) * this.res - c[0];
          // local coordinates: rows of R are the local axes in world space
          if (Math.abs(x * R[0][0] + y * R[0][1] + z * R[0][2]) > h[0]) continue;
          if (Math.abs(x * R[1][0] + y * R[1][1] + z * R[1][2]) > h[1]) continue;
          if (Math.abs(x * R[2][0] + y * R[2][1] + z * R[2][2]) > h[2]) continue;
          this.solid[this.idx(i, j, k)] = 1;
        }
      }
    }
  }
  at(p) {
    if (p[2] < 0) return 1;
    const i = Math.floor((p[0] - this.min[0]) / this.res), j = Math.floor((p[1] - this.min[1]) / this.res), k = Math.floor((p[2] - this.min[2]) / this.res);
    if (i < 0 || j < 0 || i >= this.n[0] || j >= this.n[1] || k >= this.n[2]) return -1; // outside: open
    if (k < 0) return 1;
    return this.solid[this.idx(i, j, k)];
  }
  /** March from p along unit d; returns the distance to the first solid voxel, or Infinity when it escapes. */
  march(p, d, maxDist, step = this.res * 0.8) {
    for (let s = step; s <= maxDist; s += step) {
      const v = this.at([p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s]);
      if (v === 1) return s;
      if (v === -1) return Infinity;
    }
    return Infinity;
  }
}

function sphereDirs(n) {
  // Fibonacci sphere
  const out = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const z = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - z * z);
    out.push([Math.cos(ga * i) * r, Math.sin(ga * i) * r, z]);
  }
  return out;
}

// --------------------------------------------------------------------------------------------- GLB
function writeGLB(nodesSpec) {
  // nodesSpec: [{ name, extras, prims: [{ material: {name, extras}, verts: Float32Array(17 per vertex packed), count, indices }] }]
  const json = { asset: { version: "2.0", generator: "FAULTWARD scripts/bake-map.mjs" }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [] };
  const chunks = [];
  let offset = 0;
  const matIndex = new Map();
  const view = (buf, target) => {
    const pad = (4 - (offset % 4)) % 4;
    if (pad) {
      chunks.push(Buffer.alloc(pad));
      offset += pad;
    }
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.byteLength, target });
    chunks.push(Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength));
    offset += buf.byteLength;
    return json.bufferViews.length - 1;
  };
  const accessor = (arr, type, componentType, count, target, extra = {}) => {
    json.accessors.push({ bufferView: view(arr, target), componentType, count, type, ...extra });
    return json.accessors.length - 1;
  };
  const children = [];
  for (const node of nodesSpec) {
    const prims = [];
    for (const p of node.prims) {
      const mkey = JSON.stringify(p.material);
      if (!matIndex.has(mkey)) {
        matIndex.set(mkey, json.materials.length);
        json.materials.push(p.material.extras ? { name: p.material.name, extras: p.material.extras } : { name: p.material.name });
      }
      const n = p.count;
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), tan = new Float32Array(n * 4), uv = new Float32Array(n * 2), det = new Float32Array(n * 4);
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < n; i++) {
        const o = i * 18, v = p.verts;
        for (let a = 0; a < 3; a++) {
          pos[i * 3 + a] = v[o + a];
          nor[i * 3 + a] = v[o + 3 + a];
          tan[i * 4 + a] = v[o + 6 + a];
          if (v[o + a] < min[a]) min[a] = v[o + a];
          if (v[o + a] > max[a]) max[a] = v[o + a];
        }
        // a zero normal or tangent turns into NaN in the shader (and the bloom spreads it over the screen)
        let nl = Math.hypot(nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2]);
        if (!(nl > 1e-6)) {
          nor[i * 3] = 0;
          nor[i * 3 + 1] = 0;
          nor[i * 3 + 2] = 1;
          nl = 1;
        }
        const tl = Math.hypot(tan[i * 4], tan[i * 4 + 1], tan[i * 4 + 2]);
        if (!(tl > 1e-6)) {
          const nz = Math.abs(nor[i * 3 + 2]) < 0.9;
          const tt = nz ? [-nor[i * 3 + 1], nor[i * 3], 0] : [0, -nor[i * 3 + 2], nor[i * 3 + 1]];
          const l = Math.hypot(...tt) || 1;
          for (let a = 0; a < 3; a++) tan[i * 4 + a] = tt[a] / l;
        }
        // handedness: is the stored binormal along cross(n, t)?
        const cx = v[o + 4] * v[o + 8] - v[o + 5] * v[o + 7], cy = v[o + 5] * v[o + 6] - v[o + 3] * v[o + 8], cz = v[o + 3] * v[o + 7] - v[o + 4] * v[o + 6];
        tan[i * 4 + 3] = cx * v[o + 9] + cy * v[o + 10] + cz * v[o + 11] < 0 ? -1 : 1;
        uv[i * 2] = v[o + 12];
        uv[i * 2 + 1] = v[o + 13];
        for (let a = 0; a < 4; a++) det[i * 4 + a] = v[o + 14 + a];
      }
      const big = n > 65535;
      const idx = big ? Uint32Array.from(p.indices) : Uint16Array.from(p.indices);
      prims.push({
        attributes: {
          POSITION: accessor(pos, "VEC3", 5126, n, 34962, { min, max }),
          NORMAL: accessor(nor, "VEC3", 5126, n, 34962),
          TANGENT: accessor(tan, "VEC4", 5126, n, 34962),
          TEXCOORD_0: accessor(uv, "VEC2", 5126, n, 34962),
          _DETAIL: accessor(det, "VEC4", 5126, n, 34962)
        },
        indices: accessor(idx, "SCALAR", big ? 5125 : 5123, idx.length, 34963),
        material: matIndex.get(mkey),
        mode: 4
      });
    }
    if (!prims.length) continue;
    json.meshes.push({ name: node.name, primitives: prims });
    json.nodes.push({ name: node.name, mesh: json.meshes.length - 1, ...(node.extras ? { extras: node.extras } : {}) });
    children.push(json.nodes.length - 1);
  }
  json.nodes.push({ name: "map", children, extras: { zup_root: true } });
  json.scenes[0].nodes = [json.nodes.length - 1];
  const bin = Buffer.concat(chunks);
  const binPad = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  json.buffers.push({ byteLength: binPad.length });
  let js = Buffer.from(JSON.stringify(json));
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + js.length + 8 + binPad.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(js.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(binPad.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jh, js, bh, binPad]);
}

// --------------------------------------------------------------------------------------------- PNG
function writePNG(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy ? rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3) : raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  }
  const crcTable = new Int32Array(256).map((_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c;
  });
  const crc = (buf) => {
    let c = -1;
    for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// ============================================================================================== main
const L = await loadLevelCode();
registerVisualPrefabs(L);
for (const f of fs.readdirSync(path.join(ROOT, "scripts", "bake")).filter((f) => f.endsWith(".mjs")).sort()) {
  // more visual-only prefabs (furniture, fittings): each module exports register(L)
  (await import(pathToFileURL(path.join(ROOT, "scripts", "bake", f)).href)).register(L);
}
const dataFile = path.join(ROOT, "data", "maps", `${key}.json`);
const data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
const t0 = Date.now();
const level = new L.Level(key, data, true);
const ctx = level.ctx;
const vcount = () => [...ctx.builders.values()].reduce((n, b) => n + b.vertexCount, 0);
const perType = new Map();
for (const piece of data.visual_pieces ?? []) {
  const before = process.env.BAKE_STATS ? vcount() : 0;
  ctx.buildPiece(piece);
  if (process.env.BAKE_STATS) perType.set(piece.type, (perType.get(piece.type) ?? 0) + vcount() - before);
}
if (process.env.BAKE_STATS) for (const [t, n] of [...perType].sort((x, y) => y[1] - x[1]).slice(0, 40)) say(`[bake]   ${t.padEnd(24)} ${n} vertices`);
say(`[bake] ${key}: level built in ${Date.now() - t0} ms (${ctx.colliders.length} colliders, ${ctx.panels.length} panels, ${ctx.instances.length} instances, ${ctx.lights.length} lights)`);

const [bmin, bmax] = data.bounds;
const spacing = data.skyvis_spacing ?? [1.5, 1.5, 1];
const env = data.environment ?? {};
const sunDir = (() => {
  const s = env.sun_dir ?? [0.45, -0.55, 0.7];
  const l = Math.hypot(...s);
  return s.map((v) => v / l);
})();

// ---- occupancy (static colliders, occluders and destructible panels: all of them stop light)
const vox = new Voxels([bmin[0] - 2, bmin[1] - 2, bmin[2]], [bmax[0] + 2, bmax[1] + 2, bmax[2] + 4], 0.4);
for (const b of [...ctx.colliders, ...ctx.occluders]) {
  if (b.size[0] > 200 || b.size[1] > 200) continue; // the ground slab: z < 0 is solid anyway
  vox.addBox(b.c, b.size, b.hpr);
}
for (const p of ctx.panels) vox.addBox(p.center, p.size, p.hpr);
say(`[bake] voxels ${vox.n.join("x")}`);

// ---- lights (manifest list: colour = intensity * kelvin colour)
const lights = ctx.lights.map((l) => {
  const col = kelvinRGB(l.kelvin ?? 3000).map((c) => c * (l.intensity ?? 6));
  return { pos: l.pos, color: col, range: l.range ?? 8, kind: l.kind ?? "point", dir: l.dir ?? null, outer: l.outer ?? 40, inner: l.inner ?? 25, fixture: l.fixture ?? null };
});

// ---- lighting volume
const dims = [0, 1, 2].map((i) => Math.round((bmax[i] - bmin[i]) / spacing[i]));
const nCells = dims[0] * dims[1] * dims[2];
const sky = new Float32Array(nCells), sun = new Float32Array(nCells), bounce = new Float32Array(nCells);
const lightE = new Float32Array(nCells * 3), lightD = new Float32Array(nCells * 3);
const solidCell = new Uint8Array(nCells);
const dirs = sphereDirs(SKY_RAYS * 2).filter((d) => d[2] > -0.98);
const up = dirs.filter((d) => d[2] > 0.02);
const sunJit = [[0, 0, 0], [0.04, 0, 0], [-0.04, 0, 0], [0, 0.04, 0], [0, -0.04, 0]].map((j) => {
  const d = [sunDir[0] + j[0], sunDir[1] + j[1], sunDir[2] + j[2]];
  const l = Math.hypot(...d);
  return d.map((v) => v / l);
});
const sunlit = (p) => sunJit.filter((d) => vox.march(p, d, 60) === Infinity).length / sunJit.length;
const t1 = Date.now();
for (let k = 0; k < dims[2]; k++) {
  for (let j = 0; j < dims[1]; j++) {
    for (let i = 0; i < dims[0]; i++) {
      const c = (k * dims[1] + j) * dims[0] + i;
      const p = [bmin[0] + (i + 0.5) * spacing[0], bmin[1] + (j + 0.5) * spacing[1], bmin[2] + (k + 0.5) * spacing[2]];
      if (vox.at(p) === 1) {
        solidCell[c] = 1;
        continue;
      }
      if (i === 0 || j === 0 || i === dims[0] - 1 || j === dims[1] - 1) {
        // the edge cells light what lies beyond the boundary: open fields, not the boundary wall's shade
        sky[c] = 1;
        sun[c] = 1;
        continue;
      }
      let open = 0, wsum = 0, hits = 0, lit = 0;
      for (const d of up) {
        const w = 0.25 + d[2];
        wsum += w;
        const s = vox.march(p, d, 45);
        if (s === Infinity) open += w;
        else if (s < 14 && (hits++ & 1) === 0) {
          // every other hit: is the surface it found in the sun? (bounce into enclosed spaces)
          lit += sunlit([p[0] + d[0] * (s - 0.3), p[1] + d[1] * (s - 0.3), p[2] + d[2] * (s - 0.3)]);
        }
      }
      // the floor seen below: sunlit floor patches inside doorways light the room
      for (const d of dirs) {
        if (d[2] > -0.3) continue;
        const s = vox.march(p, d, 14);
        if (s !== Infinity && (hits++ & 1) === 0) lit += sunlit([p[0] + d[0] * (s - 0.3), p[1] + d[1] * (s - 0.3), p[2] + d[2] * (s - 0.3)]);
      }
      sky[c] = open / wsum;
      sun[c] = sunlit(p);
      const enclosed = 1 - sky[c];
      bounce[c] = hits ? Math.min(1, (2 * lit) / Math.max(hits / 2, 1)) * enclosed : 0;
    }
  }
}
say(`[bake] sky/sun/bounce in ${Date.now() - t1} ms`);
const t2 = Date.now();
for (const l of lights) {
  const r = l.range;
  const lo = [0, 1, 2].map((a) => Math.max(0, Math.floor((l.pos[a] - r - bmin[a]) / spacing[a])));
  const hi = [0, 1, 2].map((a) => Math.min(dims[a] - 1, Math.floor((l.pos[a] + r - bmin[a]) / spacing[a])));
  for (let k = lo[2]; k <= hi[2]; k++) {
    for (let j = lo[1]; j <= hi[1]; j++) {
      for (let i = lo[0]; i <= hi[0]; i++) {
        const c = (k * dims[1] + j) * dims[0] + i;
        if (solidCell[c]) continue;
        const p = [bmin[0] + (i + 0.5) * spacing[0], bmin[1] + (j + 0.5) * spacing[1], bmin[2] + (k + 0.5) * spacing[2]];
        const v = [l.pos[0] - p[0], l.pos[1] - p[1], l.pos[2] - p[2]];
        const d = Math.hypot(...v);
        if (d > r) continue;
        const u = v.map((x) => x / Math.max(d, 1e-3));
        const window = Math.pow(Math.max(0, 1 - Math.pow(d / r, 4)), 2);
        let f = window / (d * d + 1);
        if (l.kind === "spot" && l.dir) {
          const dl = Math.hypot(...l.dir), cosA = -(u[0] * l.dir[0] + u[1] * l.dir[1] + u[2] * l.dir[2]) / dl;
          const co = Math.cos((l.outer * Math.PI) / 180), ci = Math.cos((l.inner * Math.PI) / 180);
          f *= Math.min(1, Math.max(0, (cosA - co) / Math.max(ci - co, 1e-3)));
        }
        if (f <= 0) continue;
        if (d > 0.6 && vox.march(p, u, d - 0.35, 0.3) !== Infinity) continue;
        for (let a = 0; a < 3; a++) {
          lightE[c * 3 + a] += l.color[a] * f;
          lightD[c * 3 + a] += u[a] * f * (l.color[0] + l.color[1] + l.color[2]);
        }
      }
    }
  }
}
say(`[bake] local lights in ${Date.now() - t2} ms`);
// cells inside walls take the average of their open neighbours (the shader samples just off each surface)
for (let pass = 0; pass < 2; pass++) {
  for (let k = 0; k < dims[2]; k++)
    for (let j = 0; j < dims[1]; j++)
      for (let i = 0; i < dims[0]; i++) {
        const c = (k * dims[1] + j) * dims[0] + i;
        if (solidCell[c] !== 1) continue;
        let n = 0;
        const acc = new Float32Array(9);
        for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          const ii = i + di, jj = j + dj, kk = k + dk;
          if (ii < 0 || jj < 0 || kk < 0 || ii >= dims[0] || jj >= dims[1] || kk >= dims[2]) continue;
          const o = (kk * dims[1] + jj) * dims[0] + ii;
          if (solidCell[o] === 1) continue;
          n++;
          acc[0] += sky[o];
          acc[1] += sun[o];
          acc[2] += bounce[o];
          for (let a = 0; a < 3; a++) {
            acc[3 + a] += lightE[o * 3 + a];
            acc[6 + a] += lightD[o * 3 + a];
          }
        }
        if (!n) continue;
        sky[c] = acc[0] / n;
        sun[c] = acc[1] / n;
        bounce[c] = acc[2] / n;
        for (let a = 0; a < 3; a++) {
          lightE[c * 3 + a] = acc[3 + a] / n;
          lightD[c * 3 + a] = acc[6 + a] / n;
        }
        solidCell[c] = 2;
      }
  for (let c = 0; c < nCells; c++) if (solidCell[c] === 2) solidCell[c] = 0;
}
const LIGHT_SCALE = 16;
const vol = Buffer.alloc(nCells * 4 * 3);
const u8 = (x) => Math.max(0, Math.min(255, Math.round(x * 255)));
for (let c = 0; c < nCells; c++) {
  vol[c * 4] = u8(sky[c]);
  vol[c * 4 + 1] = u8(sun[c]);
  vol[c * 4 + 2] = u8(Math.sqrt(bounce[c]));
  vol[c * 4 + 3] = 255;
  const o1 = nCells * 4 + c * 4, o2 = nCells * 8 + c * 4;
  const dl = Math.hypot(lightD[c * 3], lightD[c * 3 + 1], lightD[c * 3 + 2]);
  for (let a = 0; a < 3; a++) {
    vol[o1 + a] = u8(Math.sqrt(lightE[c * 3 + a] / LIGHT_SCALE));
    // the main direction the local light comes from; straight down where there is none
    const dir = dl > 1e-6 ? lightD[c * 3 + a] / dl : a === 2 ? -1 : 0;
    vol[o2 + a] = u8(dir * 0.5 + 0.5);
  }
  vol[o1 + 3] = 255;
  vol[o2 + 3] = 255;
}

// ---- geometry: one node per batch suffix, per-vertex openness from the occupancy grid
const t3 = Date.now();
const aoDirs = sphereDirs(24);
const groups = new Map();
const OUTDOOR_DUST = new Set(["farm_siding", "farm_stone", "farm_brick", "farm_deck", "farm_barn_red", "farm_galvanized", "farm_shingle", "farm_gravel", "farm_soil"]);
for (const [bkey, b] of ctx.builders) {
  // farm_invisible (and any other "collision only" material): colliders without a mesh
  if (!b.indices.length || b.name === "farm_invisible") continue;
  const suffix = bkey.includes("@") ? bkey.slice(bkey.indexOf("@") + 1) : "";
  const node = suffix ? `level:${suffix}` : "level";
  if (!groups.has(node)) groups.set(node, { name: node, extras: suffix ? { layer: suffix } : null, prims: [] });
  const v = b.verts;
  const n = v.length / 18;
  if (suffix !== "backdrop") {
    for (let i = 0; i < n; i++) {
      const o = i * 18;
      const nn = [v[o + 3], v[o + 4], v[o + 5]];
      const p = [v[o] + nn[0] * 0.12, v[o + 1] + nn[1] * 0.12, v[o + 2] + nn[2] * 0.12];
      let free = 0, tot = 0;
      for (const d of aoDirs) {
        const c = d[0] * nn[0] + d[1] * nn[1] + d[2] * nn[2];
        if (c <= 0.1) continue;
        tot += c;
        const s = vox.march(p, d, 2.4, 0.3);
        if (s === Infinity) free += c;
        else free += c * Math.min(1, s / 2.4) * 0.6;
      }
      v[o + 14] = tot ? 0.3 + 0.7 * Math.min(1, free / tot) : 1;
    }
  }
  if (b.name.startsWith("farm_") && !OUTDOOR_DUST.has(b.name)) {
    // clean interiors: no ground-dust gradient on furniture and finishes (the shader's dust follows detail.y)
    for (let i = 0; i < n; i++) v[i * 18 + 15] = -1;
  }
  const emission = { flame: [40, 13, 3], flame_hot: [70, 45, 16], lamp_lens: [16, 15, 12], farm_bulb: [12, 10.4, 7.6], farm_lampshade: [2.4, 2.0, 1.5] }[b.name];
  groups.get(node).prims.push({ material: emission ? { name: b.name, extras: { emission } } : { name: b.name }, verts: v, count: n, indices: b.indices });
}
// fixtures: a bulb and its cord for every bulb light
{
  const prims = [];
  const byEmission = new Map();
  for (const l of lights) {
    if (l.fixture !== "bulb") continue;
    const em = l.color.map((c) => Math.round(c * 1.5 * 1000) / 1000);
    const k = em.join(",");
    if (!byEmission.has(k)) byEmission.set(k, { em, b: new L.MeshBuilder() });
    const b = byEmission.get(k).b;
    b.name = "pbr_white_rough";
    b.addSphere([l.pos[0], l.pos[1], l.pos[2]], 0.055, 8, 12, 1);
  }
  for (const { em, b } of byEmission.values()) prims.push({ material: { name: "pbr_white_rough", extras: { emission: em } }, verts: b.verts, count: b.verts.length / 18, indices: b.indices });
  const cords = new L.MeshBuilder();
  for (const l of lights) if (l.fixture === "bulb") cords.addCylinder([l.pos[0], l.pos[1], l.pos[2] + 0.2], 0.008, 0.32, 6, 1, false, [0, 0, 0]);
  if (cords.indices.length) prims.push({ material: { name: "rubber" }, verts: cords.verts, count: cords.verts.length / 18, indices: cords.indices });
  if (prims.length) groups.set("fixtures", { name: "fixtures", extras: null, prims });
}
const order = (n) => (n === "level" ? 0 : n === "level:thin" ? 1 : n === "level:backdrop" ? 2 : n.startsWith("level:hi") ? 3 : n.startsWith("level:lo") ? 4 : 5);
const glb = writeGLB([...groups.values()].sort((a, b) => order(a.name) - order(b.name) || a.name.localeCompare(b.name)));
say(`[bake] geometry ${(glb.length / 1e6).toFixed(1)} MB in ${Date.now() - t3} ms`);

// ---- radar: footprints of what stands at head height on the ground floor, sites and soft walls on top
const cell = 0.25;
const x0 = bmin[0] - 1, y0 = bmin[1] - 1;
const nx = Math.round((bmax[0] - bmin[0] + 2) / cell), ny = Math.round((bmax[1] - bmin[1] + 2) / cell);
const solid2 = new Uint8Array(nx * ny), soft2 = new Uint8Array(nx * ny);
const stamp = (b, mask, zlo, zhi) => {
  const R = hprMatrix(b.hpr[0], b.hpr[1], b.hpr[2]);
  const h = b.size.map((s) => s / 2);
  const zext = Math.abs(R[0][2]) * h[0] + Math.abs(R[1][2]) * h[1] + Math.abs(R[2][2]) * h[2];
  if (b.c[2] + zext < zlo || b.c[2] - zext > zhi) return;
  const ext = [0, 1].map((a) => Math.abs(R[0][a]) * h[0] + Math.abs(R[1][a]) * h[1] + Math.abs(R[2][a]) * h[2]);
  for (let j = Math.max(0, Math.floor((b.c[1] - ext[1] - y0) / cell)); j <= Math.min(ny - 1, Math.floor((b.c[1] + ext[1] - y0) / cell)); j++)
    for (let i = Math.max(0, Math.floor((b.c[0] - ext[0] - x0) / cell)); i <= Math.min(nx - 1, Math.floor((b.c[0] + ext[0] - x0) / cell)); i++) {
      const x = x0 + (i + 0.5) * cell - b.c[0], y = y0 + (j + 0.5) * cell - b.c[1];
      const z = Math.min(Math.max(1.2 - b.c[2], -zext), zext);
      if (Math.abs(x * R[0][0] + y * R[0][1] + z * R[0][2]) > h[0] + 0.06) continue;
      if (Math.abs(x * R[1][0] + y * R[1][1] + z * R[1][2]) > h[1] + 0.06) continue;
      mask[(ny - 1 - j) * nx + i] = 1;
    }
};
for (const b of ctx.colliders) if (b.size[0] < 200) stamp(b, solid2, 0.6, 2.0);
for (const p of ctx.panels) stamp({ c: p.center, size: p.size, hpr: p.hpr }, soft2, 0.6, 2.0);
const png = Buffer.alloc(nx * ny * 3);
const inBounds = (i, j) => {
  const x = x0 + (i + 0.5) * cell, y = y0 + (ny - j - 0.5) * cell;
  return x >= bmin[0] && x <= bmax[0] && y >= bmin[1] && y <= bmax[1];
};
const sites = ctx.zones.filter((z) => z.kind === "bombsite");
for (let j = 0; j < ny; j++)
  for (let i = 0; i < nx; i++) {
    const o = j * nx + i;
    const x = x0 + (i + 0.5) * cell, y = y0 + (ny - j - 0.5) * cell;
    let c = inBounds(i, j) ? [93, 101, 96] : [113, 113, 113];
    if (sites.some((z) => x >= z.min[0] && x <= z.max[0] && y >= z.min[1] && y <= z.max[1])) c = [146, 88, 80];
    const edge = (m) => m[o] && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => {
      const ii = i + di, jj = j + dj;
      return ii < 0 || jj < 0 || ii >= nx || jj >= ny || !m[jj * nx + ii];
    });
    if (edge(solid2)) c = [222, 222, 204];
    if (soft2[o]) c = edge(soft2) ? [214, 150, 82] : [176, 128, 80];
    png[o * 3] = c[0];
    png[o * 3 + 1] = c[1];
    png[o * 3 + 2] = c[2];
  }
// the playable border
for (let j = 0; j < ny; j++)
  for (let i = 0; i < nx; i++) {
    const a = inBounds(i, j);
    if (!a) continue;
    if (!inBounds(i + 1, j) || !inBounds(i - 1, j) || !inBounds(i, j + 1) || !inBounds(i, j - 1)) png.set([222, 222, 204], (j * nx + i) * 3);
  }
const radar = writePNG(nx, ny, png);

// ---- write the files and a new manifest
const hash = (buf) => crypto.createHash("sha256").update(buf).digest("hex").slice(0, 10);
const put = (name, ext, buf) => {
  const file = `${name}-${hash(buf)}${ext}`;
  for (const old of fs.readdirSync(OUT_DIR)) if (old.startsWith(`${name}-`) && old.endsWith(ext) && old !== file) fs.rmSync(path.join(OUT_DIR, old));
  fs.writeFileSync(path.join(OUT_DIR, file), buf);
  return `/assets/g/maps/${file}`;
};
// the client builds collision and soft walls from the map data; the visual pieces are already in the geometry
const { visual_pieces: _visual, ...clientData } = data;
const dataBuf = Buffer.from(JSON.stringify(clientData));
const entry = {
  name: data.name ?? key,
  geometry: put(key, ".glb", glb),
  instances: put(`${key}.instances`, ".json", Buffer.from(JSON.stringify(ctx.instances))),
  data: put(`${key}.data`, ".json", dataBuf),
  volume: { file: put(`${key}.vol`, ".bin", vol), dims, min: bmin, spacing, layers: ["sky_sun_bounce", "light", "light_dir"], light_scale: LIGHT_SCALE },
  radar: { file: put(`${key}_radar`, ".png", radar), x0, y0, cell, nx, ny },
  dressing: null,
  sky: null,
  environment: env,
  lights: lights.map(({ fixture, ...l }) => l)
};
const gaFile = path.join(CLIENT, "game-assets.json");
const current = JSON.parse(fs.readFileSync(gaFile, "utf8")).manifest;
const currentFile = path.join(CLIENT, current.replace(/^\//, ""));
const manifest = JSON.parse(fs.readFileSync(currentFile, "utf8"));
const previousWasBaked = !!manifest.baked_maps;
manifest.maps[key] = entry;
if (data.material_pack) {
  // the map's own generated materials (scripts/textures/*.py writes the pack next to its textures)
  const pack = JSON.parse(fs.readFileSync(path.join(CLIENT, data.material_pack.replace(/^\//, "")), "utf8"));
  Object.assign(manifest.materials, pack);
}
manifest.baked_maps = [...new Set([...(manifest.baked_maps ?? []), key])].sort();
const mbuf = Buffer.from(JSON.stringify(manifest));
const mname = `manifest-${hash(mbuf)}.json`;
fs.writeFileSync(path.join(CLIENT, "assets", "g", mname), mbuf);
if (`/assets/g/${mname}` !== current) {
  fs.writeFileSync(gaFile, JSON.stringify({ manifest: `/assets/g/${mname}` }));
  // a manifest this script wrote earlier is replaced; the shipped ones stay
  if (previousWasBaked) fs.rmSync(currentFile, { force: true });
}
say(`[bake] ${key} done: ${entry.geometry}, manifest /assets/g/${mname} (${Date.now() - t0} ms)`);
