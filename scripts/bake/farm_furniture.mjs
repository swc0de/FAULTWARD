// Visual-only furniture, fittings and household objects for scripts/bake-map.mjs (map pieces of type "farm_*" in
// "visual_pieces"). They draw detailed meshes only: collision for anything solid is a plain box in the map's
// "pieces", hidden inside the mesh. Every piece takes base [x, y, z] and heading (degrees, 0 = facing -y, its
// front toward the viewer standing south of it), and builds in its own local frame: +x right, +y back, +z up.

const D = Math.PI / 180;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** A local frame on a piece: everything a prefab draws goes through it. */
class K {
  constructor(L, ctx, e) {
    this.L = L;
    this.ctx = ctx;
    this.o = e.base ?? [0, 0, 0];
    this.hd = e.heading ?? 0;
    this.rng = new L.Random(e.seed ?? Math.trunc(Math.abs(this.o[0] * 37 + this.o[1] * 91)) + 3);
  }
  // local point -> world point (through the level's own transform stack as well)
  p(x, y, z) {
    const a = this.hd * D, c = Math.cos(a), s = Math.sin(a);
    const w = [this.o[0] + x * c - y * s, this.o[1] + x * s + y * c, this.o[2] + z];
    return this.ctx.xf(w)[0];
  }
  d(v) {
    const a = this.hd * D, c = Math.cos(a), s = Math.sin(a);
    return this.ctx.xfDir([v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]]);
  }
  hpr(h = 0, p = 0, r = 0) {
    return [this.ctx.xf([0, 0, 0], [this.hd + h, p, r])[1][0], p, r];
  }
  b(mat) {
    return this.ctx.builder(mat);
  }
  uv(mat) {
    return this.ctx.uvScale(mat);
  }
  // ---- primitives (sizes in metres, centres in local coordinates)
  box(mat, c, size, h = 0, p = 0, r = 0) {
    this.b(mat).addBox(this.p(...c), size, this.hpr(h, p, r), this.uv(mat), [], "world");
  }
  rbox(mat, c, size, radius = 0.02, o = {}) {
    this.b(mat).addRoundedBox(this.p(...c), size, {
      hpr: this.hpr(o.h ?? 0, o.p ?? 0, o.r ?? 0),
      uvScale: this.uv(mat),
      radius,
      segments: o.segments ?? 2,
      round: o.round,
      skipFaces: o.skip,
      step: o.step ?? 0,
      displace: null
    });
  }
  cyl(mat, c, r, h, seg = 20, caps = true, hp = [0, 0, 0]) {
    this.b(mat).addCylinder(this.p(...c), r, h, seg, this.uv(mat), caps, this.hpr(hp[0], hp[1], hp[2]));
  }
  ball(mat, c, r, rings = 12, seg = 20) {
    this.b(mat).addSphere(this.p(...c), r, rings, seg, this.uv(mat));
  }
  /** Surface of revolution around the local z axis through c: profile [[radius, z], ...] bottom to top. */
  lathe(mat, c, profile, seg = 24, o = {}) {
    const b = this.b(mat), uv = o.uv ?? this.uv(mat);
    const n = profile.length;
    const sx = o.sx ?? 1, sy = o.sy ?? 1, ph = o.phase ?? 0;
    // the axis of revolution: "z" (up), "-y" (toward the front), "y" (toward the back) or "x"
    const ax = { z: (v) => v, "-y": (v) => [v[0], -v[2], v[1]], y: (v) => [v[0], v[2], -v[1]], x: (v) => [v[2], v[1], -v[0]] }[o.axis ?? "z"];
    // arc length along the profile for v
    const vs = [0];
    for (let i = 1; i < n; i++) vs.push(vs[i - 1] + Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]));
    const base = b.vertexCount;
    for (let i = 0; i < n; i++) {
      const [r, z] = profile[i];
      const pr = profile[Math.max(0, i - 1)], nx = profile[Math.min(n - 1, i + 1)];
      const dr = nx[0] - pr[0], dz = nx[1] - pr[1];
      for (let j = 0; j <= seg; j++) {
        const a = (j / seg) * 2 * Math.PI + ph, ca = Math.cos(a), sa = Math.sin(a);
        const lp = add(c, ax([r * ca * sx, r * sa * sy, z]));
        const ln = norm(ax([dz * ca / sx, dz * sa / sy, -dr]));
        const t = norm(ax([-sa * sx, ca * sy, 0]));
        const nw = norm(this.d(ln)), tw = norm(this.d(t));
        b.vertex(this.p(...lp), nw, tw, cross(nw, tw), (j / seg) * (2 * Math.PI * Math.max(r, 0.02)) / uv, vs[i] / uv);
      }
    }
    for (let i = 0; i < n - 1; i++)
      for (let j = 0; j < seg; j++) {
        const a = base + i * (seg + 1) + j, bb = a + seg + 1;
        b.indices.push(a, a + 1, bb + 1, a, bb + 1, bb);
      }
  }
  /** Round tube along a polyline of local points. */
  tube(mat, pts, r, sides = 8) {
    const b = this.b(mat), uv = this.uv(mat);
    let acc = 0;
    const base = b.vertexCount;
    for (let i = 0; i < pts.length; i++) {
      const pv = pts[Math.max(0, i - 1)], nx = pts[Math.min(pts.length - 1, i + 1)];
      const t = norm(sub(nx, pv));
      const ref = Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
      const u = norm(cross(t, ref)), v = cross(t, u);
      if (i) acc += len(sub(pts[i], pts[i - 1]));
      for (let j = 0; j <= sides; j++) {
        const a = (j / sides) * 2 * Math.PI;
        const nl = add(mul(u, Math.cos(a)), mul(v, Math.sin(a)));
        const nw = norm(this.d(nl)), tw = norm(this.d(t));
        b.vertex(this.p(...add(pts[i], mul(nl, r))), nw, tw, cross(nw, tw), (j / sides) * (2 * Math.PI * r) / uv, acc / uv);
      }
    }
    for (let i = 0; i < pts.length - 1; i++)
      for (let j = 0; j < sides; j++) {
        const a = base + i * (sides + 1) + j, bb = a + sides + 1;
        b.indices.push(a, bb, bb + 1, a, bb + 1, a + 1);
      }
  }
  /** A two-sided sheet: f(u, v) -> local point over a grid (cloth, curtains, leaves, drapes). */
  sheet(mat, f, nu, nv, uvU = 1, uvV = 1, twoSided = true) {
    const b = this.b(mat);
    for (const side of twoSided ? [1, -1] : [1]) {
      const base = b.vertexCount;
      for (let j = 0; j <= nv; j++)
        for (let i = 0; i <= nu; i++) {
          const u = i / nu, v = j / nv, e = 1e-3;
          const p = f(u, v);
          const du = sub(f(Math.min(1, u + e), v), f(Math.max(0, u - e), v));
          const dv = sub(f(u, Math.min(1, v + e)), f(u, Math.max(0, v - e)));
          let n = norm(cross(du, dv));
          if (side < 0) n = mul(n, -1);
          const nw = norm(this.d(n)), tw = norm(this.d(norm(du)));
          b.vertex(this.p(...p), nw, tw, cross(nw, tw), u * uvU, v * uvV);
        }
      for (let j = 0; j < nv; j++)
        for (let i = 0; i < nu; i++) {
          const a = base + j * (nu + 1) + i, c = a + nu + 1;
          if (side > 0) b.indices.push(a, a + 1, c + 1, a, c + 1, c);
          else b.indices.push(a, c + 1, a + 1, a, c, c + 1);
        }
    }
  }
}

// ------------------------------------------------------------------------------------------- building blocks
/** A turned leg (lathe) from z0 up to z1. */
function turnedLeg(k, mat, x, y, z0, z1, r = 0.025) {
  const h = z1 - z0;
  k.lathe(mat, [x, y, z0], [[r * 0.75, 0], [r * 0.85, h * 0.04], [r * 0.7, h * 0.08], [r * 0.8, h * 0.3], [r * 1.25, h * 0.36], [r * 0.9, h * 0.42],
    [r * 1.0, h * 0.7], [r * 1.35, h * 0.76], [r * 1.35, h * 0.95], [r * 1.2, h], [0, h]], 14);
}

/** A tapered square leg. */
function taperLeg(k, mat, x, y, z0, z1, w0 = 0.045, w1 = 0.03) {
  const n = 4;
  for (let i = 0; i < n; i++) {
    const a = z0 + ((z1 - z0) * i) / n, bz = z0 + ((z1 - z0) * (i + 1)) / n;
    const w = w1 + ((w0 - w1) * (i + 0.5)) / n;
    k.box(mat, [x, y, (a + bz) / 2], [w, w, bz - a + 0.002]);
  }
}

/** A shaker cabinet front: frame, recessed panel and a knob or pull. */
function shakerDoor(k, mat, cx, y, z0, w, h, handle = "knob", hmat = "farm_brass") {
  const fr = Math.min(0.06, w * 0.16);
  k.rbox(mat, [cx, y, z0 + h / 2], [w - 0.006, 0.02, h - 0.006], 0.004);
  k.box(mat, [cx, y - 0.006, z0 + h / 2], [w - 2 * fr, 0.014, h - 2 * fr]);
  for (const s of [-1, 1]) k.box(mat, [cx + s * (w / 2 - fr / 2), y - 0.012, z0 + h / 2], [fr - 0.004, 0.012, h - 0.01]);
  for (const s of [-1, 1]) k.box(mat, [cx, y - 0.012, z0 + h / 2 + s * (h / 2 - fr / 2)], [w - 0.01, 0.012, fr - 0.004]);
  if (handle === "knob") k.lathe(hmat, [cx + (w > 0.45 ? w / 2 - 0.06 : 0), y - 0.012, z0 + h - (h > 0.5 ? 0.09 : h / 2)], [[0.006, 0], [0.006, 0.012], [0.016, 0.022], [0.012, 0.03], [0, 0.031]], 12, { axis: "-y" });
  else if (handle === "pull") k.tube(hmat, [[cx - w * 0.22, y - 0.012, z0 + h - 0.05], [cx - w * 0.22, y - 0.035, z0 + h - 0.05], [cx + w * 0.22, y - 0.035, z0 + h - 0.05], [cx + w * 0.22, y - 0.012, z0 + h - 0.05]], 0.006, 6);
}

/** A drawer front with a cup pull. */
function drawer(k, mat, cx, y, z0, w, h, hmat = "farm_brass") {
  k.rbox(mat, [cx, y, z0 + h / 2], [w - 0.006, 0.022, h - 0.006], 0.005);
  k.box(mat, [cx, y - 0.008, z0 + h / 2], [w - 0.07, 0.012, h - 0.06]);
  k.sheet(hmat, (u, v) => [cx - 0.045 + u * 0.09, y - 0.02 - Math.sin(v * Math.PI) * 0.018, z0 + h / 2 + 0.012 - v * 0.03], 6, 4, 1, 1);
}

/** Books along a shelf: x from x0 to x1 at depth y, standing on z. */
function books(k, x0, x1, y, z, maxH = 0.28, lean = true) {
  let x = x0 + 0.01;
  const r = k.rng;
  while (x < x1 - 0.03) {
    const t = r.uniform(0.022, 0.05), h = r.uniform(0.17, maxH), d = r.uniform(0.15, 0.22);
    if (x + t > x1) break;
    const slot = Math.floor(r.uniform(0, 16));
    // each book picks one spine of the atlas through its u offset: draw its own box with custom uvs
    const b = k.b("farm_books");
    const c = k.p(x + t / 2, y, z + h / 2);
    const hp = k.hpr(0, 0, 0);
    const base = b.vertexCount;
    b.addBox(c, [t, d, h], hp, 1, [], "fit");
    // remap u of the spine (-y face) into the slot: all faces get the slot's colours
    for (let i = base; i < b.vertexCount; i++) {
      const o = i * 18;
      b.verts[o + 12] = (slot + 0.1 + 0.8 * (b.verts[o + 12] % 1)) / 16;
    }
    x += t + r.uniform(0, 0.006);
    if (lean && r.random() < 0.04) x += 0.05;
  }
}

/** A picture frame with an image from an atlas (farm_art 2 x 2 or farm_photo 3 x 3). */
function picture(k, cx, y, cz, w, h, atlas = "farm_art", cell = 0, frameMat = "farm_walnut") {
  const fw = 0.035;
  for (const s of [-1, 1]) {
    k.box(frameMat, [cx + s * (w / 2 - fw / 2), y, cz], [fw, 0.03, h]);
    k.box(frameMat, [cx, y, cz + s * (h / 2 - fw / 2)], [w - 2 * fw + 0.002, 0.03, fw]);
  }
  const grid = atlas === "farm_art" ? 2 : 3;
  const cu = cell % grid, cv = Math.floor(cell / grid);
  const b = k.b(atlas);
  const iw = w - 2 * fw, ih = h - 2 * fw;
  const n = norm(k.d([0, -1, 0])), t = norm(k.d([1, 0, 0])), up = norm(k.d([0, 0, 1]));
  const u0 = cu / grid + 0.01, u1 = (cu + 1) / grid - 0.01, v0 = 1 - (cv + 1) / grid + 0.01, v1 = 1 - cv / grid - 0.01;
  b.addQuad([k.p(cx - iw / 2, y - 0.012, cz - ih / 2), k.p(cx + iw / 2, y - 0.012, cz - ih / 2), k.p(cx + iw / 2, y - 0.012, cz + ih / 2), k.p(cx - iw / 2, y - 0.012, cz + ih / 2)],
    n, t, up, [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
}

/** A cushion: soft rounded block with a slight crown. */
function cushion(k, mat, c, size, rad = 0.05, tilt = 0) {
  k.rbox(mat, c, size, Math.min(rad, size[2] * 0.48), { segments: 3, p: tilt });
}

// ---------------------------------------------------------------------------------------------- prefabs
export function register(L) {
  const P = L.PREFABS;
  const def = (name, fn) => {
    P[name] = (ctx, e) => {
      if (!ctx.geometry) return;
      fn(new K(L, ctx, e), e);
    };
  };

  // ---- seating
  def("farm_sofa", (k, e) => {
    const W = e.length ?? 2.3, Dp = e.depth ?? 0.95, fab = e.mat ?? "farm_linen";
    const leg = e.leg_mat ?? "farm_walnut";
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) k.lathe(leg, [sx * (W / 2 - 0.08), sy * (Dp / 2 - 0.08), 0], [[0.022, 0], [0.028, 0.06], [0.03, 0.11], [0, 0.11]], 12);
    k.rbox(fab, [0, 0.02, 0.24], [W, Dp, 0.26], 0.05);                                 // base
    k.rbox(fab, [0, Dp / 2 - 0.12, 0.6], [W - 0.06, 0.22, 0.62], 0.08, { p: -6 });     // back
    for (const sx of [-1, 1]) k.rbox(fab, [sx * (W / 2 - 0.1), 0.02, 0.5], [0.2, Dp, 0.36], 0.08);   // arms
    const seats = W > 1.6 ? 3 : 1;
    const sw = (W - 0.4) / seats;
    for (let i = 0; i < seats; i++) {
      const x = -W / 2 + 0.2 + sw * (i + 0.5);
      cushion(k, fab, [x, -0.04, 0.44], [sw - 0.02, Dp - 0.28, 0.16], 0.06);
      cushion(k, fab, [x, Dp / 2 - 0.27, 0.68], [sw - 0.04, 0.16, 0.42], 0.07, -10);
    }
    const pillows = e.pillows ?? ["farm_velvet_green", "farm_gingham"];
    pillows.forEach((m, i) => {
      const x = (i === 0 ? -1 : 1) * (W / 2 - 0.42);
      cushion(k, m, [x, Dp / 2 - 0.36, 0.66], [0.42, 0.13, 0.4], 0.07, -14 + i * 6);
    });
    if (e.throw) {
      // a knitted throw over one arm
      const tx = W / 2 - 0.1;
      k.sheet(e.throw, (u, v) => [tx - 0.28 + u * 0.5 + 0.04 * Math.sin(v * 9), -0.35 + v * 0.75, 0.69 - Math.max(0, (u - 0.6) * 1.3) - 0.02 * Math.sin(u * 14)], 12, 10, 1.2, 1.2);
    }
  });
  def("farm_armchair", (k, e) => P.farm_sofa(k.ctx, { ...e, length: e.length ?? 0.95, pillows: e.pillows ?? [e.pillow ?? "farm_gingham"] }));

  def("farm_chair", (k, e) => {
    // a Windsor-style chair: saddle seat, splayed turned legs, spindle back with a bow
    const m = e.mat ?? "farm_walnut", H = 0.46;
    k.rbox(m, [0, 0, H], [0.44, 0.42, 0.04], 0.018);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) turnedLeg(k, m, sx * 0.17, sy * 0.15, 0, H - 0.02, 0.016);
    k.tube(m, [[-0.17, -0.155, 0.2], [0.17, -0.155, 0.2]], 0.01, 6);
    k.tube(m, [[-0.17, 0.155, 0.2], [0.17, 0.155, 0.2]], 0.01, 6);
    const bow = [];
    for (let i = 0; i <= 12; i++) {
      const a = Math.PI * (i / 12);
      bow.push([-Math.cos(a) * 0.2, 0.19, H + 0.05 + Math.sin(a) * 0.48]);
    }
    k.tube(m, bow, 0.014, 8);
    for (let i = 0; i < 7; i++) {
      const x = -0.15 + (0.3 * i) / 6;
      const a = Math.acos(Math.max(-1, Math.min(1, -x / 0.2)));
      k.tube(m, [[x, 0.17, H + 0.01], [x, 0.19, H + 0.05 + Math.sin(a) * 0.48]], 0.007, 6);
    }
    if (e.cushion) cushion(k, e.cushion, [0, -0.01, H + 0.035], [0.38, 0.36, 0.04], 0.02);
  });

  def("farm_stool", (k, e) => {
    const m = e.mat ?? "farm_walnut", H = e.height ?? 0.66;
    k.lathe(m, [0, 0, H - 0.04], [[0, 0], [0.17, 0], [0.18, 0.02], [0.17, 0.045], [0, 0.05]], 24);
    for (let i = 0; i < 4; i++) {
      const a = (i * 90 + 45) * D;
      k.tube(m, [[Math.cos(a) * 0.17, Math.sin(a) * 0.17, 0], [Math.cos(a) * 0.11, Math.sin(a) * 0.11, H - 0.04]], 0.016, 8);
    }
    const ring = [];
    for (let i = 0; i <= 16; i++) ring.push([Math.cos((i / 16) * 2 * Math.PI) * 0.15, Math.sin((i / 16) * 2 * Math.PI) * 0.15, H * 0.32]);
    k.tube(e.ring_mat ?? "farm_iron", ring, 0.008, 6);
  });

  def("farm_bench", (k, e) => {
    const m = e.mat ?? "farm_pine", W = e.length ?? 1.4;
    k.rbox(m, [0, 0, 0.44], [W, 0.36, 0.05], 0.012);
    for (const sx of [-1, 1]) {
      k.rbox(m, [sx * (W / 2 - 0.1), 0, 0.21], [0.05, 0.32, 0.42], 0.01);
      k.box(m, [sx * (W / 2 - 0.1), 0, 0.03], [0.07, 0.34, 0.06]);
    }
    k.box(m, [0, 0, 0.12], [W - 0.2, 0.04, 0.05]);
    if (e.cushion) cushion(k, e.cushion, [0, 0, 0.5], [W - 0.08, 0.32, 0.07], 0.03);
  });

  def("farm_office_chair", (k, e) => {
    const m = e.mat ?? "farm_leather";
    for (let i = 0; i < 5; i++) {
      const a = (i * 72) * D;
      k.tube("farm_plastic_black", [[0, 0, 0.08], [Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0.06]], 0.018, 6);
      k.ball("farm_plastic_black", [Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0.03], 0.03, 6, 10);
    }
    k.cyl("farm_chrome", [0, 0, 0.27], 0.025, 0.38, 12);
    cushion(k, m, [0, 0, 0.5], [0.5, 0.48, 0.1], 0.04);
    cushion(k, m, [0, 0.24, 0.84], [0.46, 0.08, 0.55], 0.04, -8);
    for (const s of [-1, 1]) k.tube("farm_plastic_black", [[s * 0.25, -0.1, 0.52], [s * 0.27, -0.08, 0.7], [s * 0.27, 0.15, 0.7], [s * 0.25, 0.18, 0.55]], 0.016, 6);
  });

  // ---- tables and storage
  def("farm_table", (k, e) => {
    const W = e.length ?? 1.8, Dp = e.width ?? 0.9, m = e.mat ?? "farm_walnut", top = e.top_mat ?? m, H = e.height ?? 0.76;
    k.rbox(top, [0, 0, H - 0.02], [W, Dp, 0.045], 0.012);
    k.box(m, [0, -Dp / 2 + 0.08, H - 0.09], [W - 0.18, 0.025, 0.1]);
    k.box(m, [0, Dp / 2 - 0.08, H - 0.09], [W - 0.18, 0.025, 0.1]);
    for (const s of [-1, 1]) k.box(m, [s * (W / 2 - 0.08), 0, H - 0.09], [0.025, Dp - 0.18, 0.1]);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) turnedLeg(k, m, sx * (W / 2 - 0.09), sy * (Dp / 2 - 0.09), 0, H - 0.04, 0.03);
    if (e.runner) k.box(e.runner, [0, 0, H + 0.004], [W * 0.8, 0.32, 0.004]);
  });

  def("farm_coffee_table", (k, e) => {
    const W = e.length ?? 1.2, Dp = e.width ?? 0.6, m = e.mat ?? "farm_walnut";
    k.rbox(m, [0, 0, 0.42], [W, Dp, 0.05], 0.015);
    k.rbox(m, [0, 0, 0.1], [W - 0.12, Dp - 0.12, 0.025], 0.01);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) taperLeg(k, m, sx * (W / 2 - 0.06), sy * (Dp / 2 - 0.06), 0, 0.4, 0.05, 0.035);
    if (e.books !== false) {
      for (let i = 0; i < 3; i++) k.rbox(["farm_tweed", "farm_door_red", "farm_cabinet_navy"][i], [-W * 0.25, 0.02, 0.46 + i * 0.03], [0.3 - i * 0.03, 0.22 - i * 0.02, 0.028], 0.004, { h: i * 7 });
      k.lathe("farm_ceramic", [W * 0.25, 0, 0.445], [[0, 0], [0.05, 0], [0.12, 0.05], [0.13, 0.06], [0.12, 0.062], [0.05, 0.015], [0, 0.015]], 24);
    }
  });

  def("farm_side_table", (k, e) => {
    const m = e.mat ?? "farm_walnut", S = e.size ?? 0.45;
    k.rbox(m, [0, 0, 0.6], [S, S, 0.035], 0.01);
    k.box(m, [0, 0, 0.5], [S - 0.04, S - 0.04, 0.16]);
    drawer(k, m, 0, -S / 2 + 0.012, 0.43, S - 0.06, 0.14);
    k.box(m, [0, 0, 0.12], [S - 0.08, S - 0.08, 0.02]);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) taperLeg(k, m, sx * (S / 2 - 0.03), sy * (S / 2 - 0.03), 0, 0.42, 0.04, 0.028);
    if (e.lamp) P.farm_lamp(k.ctx, { base: k.p(0, 0, 0.62), heading: k.hd });
  });

  def("farm_dresser", (k, e) => {
    const W = e.length ?? 1.2, Dp = 0.48, H = e.height ?? 0.86, m = e.mat ?? "farm_cabinet_white";
    k.rbox(e.top_mat ?? "farm_walnut", [0, 0, H - 0.015], [W + 0.03, Dp + 0.03, 0.03], 0.008);
    k.box(m, [0, 0.02, H / 2], [W, Dp - 0.04, H - 0.06]);
    const rows = Math.max(3, Math.round((H - 0.12) / 0.2));
    const dh = (H - 0.14) / rows;
    for (let r = 0; r < rows; r++) {
      if (r === rows - 1 && W > 0.9) for (const s of [-1, 1]) drawer(k, m, s * W / 4, -Dp / 2 + 0.01, 0.1 + r * dh, W / 2 - 0.02, dh);
      else drawer(k, m, 0, -Dp / 2 + 0.01, 0.1 + r * dh, W - 0.04, dh);
    }
    k.box(m, [0, -Dp / 2 + 0.03, 0.04], [W, 0.02, 0.08]);
    if (e.mirror) {
      k.rbox("farm_walnut", [0, Dp / 2 - 0.04, H + 0.45], [W * 0.7, 0.03, 0.8], 0.012);
      k.box("farm_mirror", [0, Dp / 2 - 0.058, H + 0.45], [W * 0.7 - 0.08, 0.004, 0.72]);
    }
    if (e.decor) {
      k.lathe("farm_ceramic", [W * 0.3, 0, H], [[0, 0], [0.05, 0], [0.07, 0.08], [0.04, 0.18], [0.035, 0.22], [0.045, 0.24], [0, 0.24]], 18);
      picture(k, -W * 0.25, 0.1, H + 0.14, 0.18, 0.24, "farm_photo", Math.floor(k.rng.uniform(0, 9)), "farm_brass");
    }
  });

  def("farm_wardrobe", (k, e) => {
    const W = e.length ?? 1.1, Dp = 0.58, H = 2.0, m = e.mat ?? "farm_walnut";
    k.rbox(m, [0, 0, H / 2], [W, Dp, H], 0.01);
    k.rbox(m, [0, 0, H + 0.03], [W + 0.06, Dp + 0.04, 0.06], 0.01);
    for (const s of [-1, 1]) shakerDoor(k, m, s * W / 4, -Dp / 2 - 0.004, 0.42, W / 2 - 0.02, H - 0.5, "pull");
    for (const s of [-1, 1]) drawer(k, m, s * W / 4, -Dp / 2 - 0.004, 0.08, W / 2 - 0.02, 0.3);
  });

  def("farm_bookcase", (k, e) => {
    const W = e.length ?? 1.0, Dp = 0.34, H = e.height ?? 2.0, m = e.mat ?? "farm_cabinet_white";
    for (const s of [-1, 1]) k.box(m, [s * (W / 2 - 0.01), 0, H / 2], [0.02, Dp, H]);
    k.box(m, [0, Dp / 2 - 0.006, H / 2], [W, 0.012, H]);
    k.rbox(m, [0, 0, H + 0.02], [W + 0.04, Dp + 0.02, 0.04], 0.008);
    const shelves = Math.round(H / 0.36);
    for (let i = 0; i <= shelves; i++) {
      const z = 0.06 + (i * (H - 0.08)) / shelves;
      k.box(m, [0, 0, z], [W - 0.02, Dp - 0.01, 0.022]);
      if (i < shelves && !(e.decor && i === 1)) books(k, -W / 2 + 0.02, W / 2 - 0.02, 0.0, z + 0.011, Math.min(0.3, (H - 0.08) / shelves - 0.04));
      if (e.decor && i === 1) {
        k.lathe("farm_terracotta", [-W * 0.2, 0, z + 0.011], [[0, 0], [0.05, 0], [0.065, 0.1], [0.07, 0.11], [0, 0.11]], 16);
        picture(k, W * 0.15, 0.1, z + 0.15, 0.2, 0.24, "farm_photo", 4, "farm_walnut");
      }
    }
    k.box(m, [0, -Dp / 2 + 0.01, 0.03], [W, 0.02, 0.06]);
  });

  def("farm_desk", (k, e) => {
    const W = e.length ?? 1.4, Dp = 0.7, m = e.mat ?? "farm_walnut";
    k.rbox(m, [0, 0, 0.75], [W, Dp, 0.035], 0.008);
    k.box(m, [W / 2 - 0.22, 0.02, 0.4], [0.4, Dp - 0.06, 0.66]);
    for (let i = 0; i < 3; i++) drawer(k, m, W / 2 - 0.22, -Dp / 2 + 0.01, 0.08 + i * 0.21, 0.38, 0.2);
    for (const sy of [-1, 1]) taperLeg(k, m, -W / 2 + 0.04, sy * (Dp / 2 - 0.04), 0, 0.74, 0.05, 0.035);
    k.box(m, [-0.15, Dp / 2 - 0.02, 0.6], [W - 0.5, 0.02, 0.26]);
    // a laptop, a desk lamp, papers and a mug
    k.rbox("farm_steel", [-0.15, -0.05, 0.775], [0.34, 0.24, 0.016], 0.008);
    k.rbox("farm_steel", [-0.15, 0.07, 0.885], [0.34, 0.012, 0.22], 0.006, { p: -12 });
    k.box("farm_screen", [-0.15, 0.062, 0.885], [0.31, 0.002, 0.19], 0, -12);
    k.box("farm_bedding", [0.25, -0.1, 0.77], [0.21, 0.29, 0.008], 12);
    P.farm_mug(k.ctx, { base: k.p(0.4, 0.1, 0.77), heading: k.hd + 30 });
    k.lathe("farm_iron", [-W / 2 + 0.18, 0.18, 0.768], [[0, 0], [0.07, 0], [0.07, 0.015], [0.012, 0.025], [0, 0.025]], 18);
    k.tube("farm_iron", [[-W / 2 + 0.18, 0.18, 0.79], [-W / 2 + 0.2, 0.14, 1.05], [-W / 2 + 0.3, 0.05, 1.12]], 0.008, 6);
    k.lathe("farm_iron", [-W / 2 + 0.31, 0.04, 1.02], [[0.07, 0], [0.04, 0.09], [0.012, 0.11], [0, 0.11]], 16);
  });

  // ---- beds and bedding
  def("farm_bed", (k, e) => {
    const W = e.width ?? 1.6, Lg = e.length ?? 2.05, m = e.mat ?? "farm_walnut", quilt = e.quilt ?? "farm_quilt";
    // frame: posts, rails, headboard with panels, footboard
    for (const sx of [-1, 1]) {
      turnedLeg(k, m, sx * (W / 2), Lg / 2, 0, 1.2, 0.035);
      turnedLeg(k, m, sx * (W / 2), -Lg / 2, 0, 0.7, 0.035);
      k.box(m, [sx * (W / 2), 0, 0.32], [0.04, Lg - 0.06, 0.16]);
    }
    k.rbox(m, [0, Lg / 2, 0.75], [W - 0.06, 0.04, 0.7], 0.01);
    for (let i = 0; i < 3; i++) k.box(m, [-W / 3 + (i * W) / 3, Lg / 2 - 0.022, 0.75], [W / 3 - 0.12, 0.012, 0.5]);
    k.rbox(m, [0, Lg / 2, 1.13], [W + 0.04, 0.06, 0.05], 0.015);
    k.rbox(m, [0, -Lg / 2, 0.5], [W - 0.06, 0.04, 0.35], 0.01);
    // mattress, sheet, duvet that hangs over the sides, pillows
    k.rbox("farm_bedding", [0, 0.02, 0.5], [W - 0.08, Lg - 0.08, 0.24], 0.06, { segments: 3 });
    const top = 0.63, over = 0.24, half = W / 2 - 0.02;
    k.sheet(quilt, (u, v) => {
      // u across the bed (with the drop at both sides), v from foot to 70 % up
      const x = -half - 0.02 + u * (2 * half + 0.04);
      const edge = Math.max(0, Math.abs(x) - (half - 0.06));
      const z = top - edge * over * 4.2 + 0.015 * Math.sin(u * 23 + v * 4) * (1 - edge * 6);
      const xx = Math.sign(x) * Math.min(Math.abs(x), half + 0.04);
      return [xx, -Lg / 2 + 0.06 + v * Lg * 0.66, Math.max(z, top - over)];
    }, 28, 14, 1.4, 1.6);
    // folded sheet edge
    k.rbox("farm_bedding", [0, -Lg / 2 + 0.06 + Lg * 0.66, top + 0.01], [W - 0.04, 0.16, 0.05], 0.025, { segments: 3 });
    const pills = W > 1.2 ? [-W / 4, W / 4] : [0];
    for (const x of pills) {
      cushion(k, "farm_bedding", [x, Lg / 2 - 0.3, 0.7], [Math.min(0.68, W / 2 - 0.06), 0.42, 0.15], 0.07, -8);
      if (e.accent) cushion(k, e.accent, [x * 0.6, Lg / 2 - 0.5, 0.7], [0.4, 0.12, 0.34], 0.06, -20);
    }
  });

  def("farm_crib_toys", (k, e) => {
    // a toy chest with blocks, a ball and a teddy bear on top
    k.rbox("farm_cabinet_sage", [0, 0, 0.25], [0.8, 0.45, 0.5], 0.02);
    k.rbox("farm_cabinet_sage", [0, 0, 0.52], [0.84, 0.48, 0.04], 0.012);
    for (let i = 0; i < 6; i++) {
      const m = ["farm_door_red", "farm_cabinet_navy", "farm_fruit", "farm_cabinet_sage", "farm_apple", "farm_pine"][i];
      k.rbox(m, [-0.3 + (i % 3) * 0.09, -0.45 + Math.floor(i / 3) * 0.09, 0.03 + (i === 5 ? 0.06 : 0)], [0.06, 0.06, 0.06], 0.008, { h: i * 17 });
    }
    k.ball("farm_door_red", [0.35, -0.45, 0.11], 0.11, 14, 24);
    // teddy: body, head, ears, arms, legs
    const tb = "farm_tweed";
    k.ball(tb, [0.1, 0, 0.66], 0.1, 12, 20);
    k.ball(tb, [0.1, -0.01, 0.82], 0.075, 12, 20);
    for (const s of [-1, 1]) {
      k.ball(tb, [0.1 + s * 0.06, 0.0, 0.88], 0.028, 8, 12);
      k.ball(tb, [0.1 + s * 0.1, -0.03, 0.66], 0.035, 8, 12);
      k.ball(tb, [0.1 + s * 0.06, -0.08, 0.57], 0.04, 8, 12);
    }
    k.ball("farm_plastic_black", [0.1, -0.08, 0.82], 0.012, 6, 8);
  });

  // ---- kitchen
  def("farm_kitchen_run", (k, e) => {
    // base cabinets with doors and drawers, a worktop, optional sink, range and upper cabinets
    const W = e.length ?? 3.0, m = e.mat ?? "farm_cabinet_white", top = e.top_mat ?? "farm_butcher_block";
    const Dp = 0.62, H = 0.9;
    const units = Math.max(1, Math.round(W / 0.6));
    const uw = W / units;
    k.box("farm_plastic_black", [0, 0.02, 0.05], [W, Dp - 0.08, 0.1]);
    for (let i = 0; i < units; i++) {
      const x = -W / 2 + uw * (i + 0.5);
      if (e.range !== undefined && i === e.range) continue;
      k.box(m, [x, 0.02, 0.5], [uw, Dp - 0.06, 0.8]);
      if (e.sink !== undefined && i === e.sink) {
        shakerDoor(k, m, x, -Dp / 2 + 0.03, 0.12, uw - 0.01, 0.6, "knob");
        continue;
      }
      drawer(k, m, x, -Dp / 2 + 0.03, 0.73, uw - 0.01, 0.15);
      shakerDoor(k, m, x, -Dp / 2 + 0.03, 0.12, uw - 0.01, 0.58, "knob");
    }
    // worktop, with cut-outs for the sink and the range
    const spans = [];
    let x0 = -W / 2;
    for (let i = 0; i < units; i++) {
      const a = -W / 2 + uw * i, bb = a + uw;
      if (i === e.range || i === e.sink) {
        if (a > x0) spans.push([x0, a]);
        x0 = bb;
      }
    }
    if (x0 < W / 2) spans.push([x0, W / 2]);
    for (const [a, bb] of spans) k.rbox(top, [(a + bb) / 2, 0, H + 0.02], [bb - a, Dp + 0.02, 0.04], 0.006);
    if (e.sink !== undefined) {
      const x = -W / 2 + uw * (e.sink + 0.5);
      // apron-front farmhouse sink with a bridge faucet
      k.rbox("farm_ceramic", [x, -0.02, 0.76], [uw - 0.02, Dp - 0.02, 0.3], 0.03);
      k.box("farm_steel", [x, 0.0, 0.905], [uw - 0.12, Dp - 0.14, 0.004]);
      k.tube("farm_brass", [[x, 0.22, H + 0.02], [x, 0.22, H + 0.32], [x, 0.12, H + 0.38], [x, 0.04, H + 0.3]], 0.012, 8);
      for (const s of [-1, 1]) k.lathe("farm_brass", [x + s * 0.12, 0.23, H + 0.03], [[0.02, 0], [0.02, 0.05], [0.03, 0.06], [0, 0.07]], 10);
    }
    if (e.range !== undefined) {
      const x = -W / 2 + uw * (e.range + 0.5);
      k.rbox("farm_cabinet_navy", [x, 0.0, 0.46], [uw, Dp, 0.92], 0.015);
      k.rbox("farm_iron", [x, 0.0, 0.93], [uw - 0.02, Dp - 0.04, 0.03], 0.006);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        k.lathe("farm_iron", [x + sx * uw * 0.22, sy * 0.13, 0.945], [[0.08, 0], [0.09, 0.01], [0.04, 0.02], [0, 0.02]], 16);
        for (let a = 0; a < 4; a++) k.box("farm_iron", [x + sx * uw * 0.22, sy * 0.13, 0.965], [0.18, 0.012, 0.012], a * 45);
      }
      k.rbox("farm_steel", [x, -Dp / 2 - 0.01, 0.5], [uw - 0.08, 0.02, 0.52], 0.012);
      k.box("farm_screen", [x, -Dp / 2 - 0.022, 0.52], [uw - 0.24, 0.004, 0.26]);
      k.tube("farm_brass", [[x - uw * 0.3, -Dp / 2 - 0.02, 0.8], [x - uw * 0.3, -Dp / 2 - 0.06, 0.8], [x + uw * 0.3, -Dp / 2 - 0.06, 0.8], [x + uw * 0.3, -Dp / 2 - 0.02, 0.8]], 0.009, 6);
      for (let i = 0; i < 5; i++) k.lathe("farm_brass", [x - uw * 0.3 + (i * uw * 0.6) / 4, -Dp / 2 - 0.005, 0.86], [[0.02, 0], [0.02, 0.02], [0.016, 0.03], [0, 0.03]], 10, { axis: "-y" });
      // hood
      k.lathe("farm_cabinet_white", [x, 0.08, 1.55], [[0, 0], [uw * 0.7, 0], [uw * 0.73, 0.02], [uw * 0.63, 0.06], [uw * 0.3, 0.4], [uw * 0.28, 0.9], [0, 0.9]], 4, { sx: 1, sy: 0.75, phase: Math.PI / 4 });
    }
    if (e.uppers) {
      for (let i = 0; i < units; i++) {
        const x = -W / 2 + uw * (i + 0.5);
        if (i === e.range || i === e.window) continue;
        k.box(m, [x, Dp / 2 - 0.2, 1.85], [uw, 0.34, 0.8]);
        shakerDoor(k, m, x, Dp / 2 - 0.38, 1.47, uw - 0.01, 0.76, "knob");
      }
      // open shelf with crockery over the window gap or at the ends
    }
    if (e.decor) {
      const r = k.rng;
      // a fruit bowl, a canister set, a cutting board, a kettle on the range
      P.farm_fruit_bowl(k.ctx, { base: k.p(-W / 2 + 0.35, 0.05, H + 0.04), heading: k.hd });
      for (let i = 0; i < 3; i++) k.lathe("farm_ceramic", [W / 2 - 0.3 - i * 0.14, 0.18, H + 0.04], [[0, 0], [0.055, 0], [0.055, 0.16 - i * 0.03], [0.05, 0.17 - i * 0.03], [0.02, 0.18 - i * 0.03], [0, 0.185 - i * 0.03]], 18);
      k.rbox("farm_butcher_block", [W / 2 - 0.75, 0.22, H + 0.2], [0.4, 0.025, 0.3], 0.02, { p: -14 });
      if (e.range !== undefined) {
        const x = -W / 2 + uw * (e.range + 0.5);
        k.lathe("farm_door_red", [x + uw * 0.22, 0.13, 0.955], [[0, 0], [0.09, 0], [0.1, 0.06], [0.08, 0.14], [0.03, 0.17], [0.012, 0.19], [0, 0.19]], 20);
        k.tube("farm_iron", [[x + uw * 0.22 - 0.06, 0.13, 1.1], [x + uw * 0.22, 0.13, 1.2], [x + uw * 0.22 + 0.06, 0.13, 1.1]], 0.008, 6);
      }
      void r;
    }
  });

  def("farm_island", (k, e) => {
    const W = e.length ?? 2.0, Dp = e.width ?? 1.0, m = e.mat ?? "farm_cabinet_navy";
    k.box(m, [0, 0.12, 0.47], [W - 0.04, Dp - 0.3, 0.86]);
    const units = Math.round(W / 0.5);
    for (let i = 0; i < units; i++) {
      const x = -W / 2 + 0.02 + ((W - 0.04) / units) * (i + 0.5);
      shakerDoor(k, m, x, 0.12 + (Dp - 0.3) / 2 + 0.01, 0.12, (W - 0.04) / units - 0.01, 0.7, "knob");
    }
    for (const s of [-1, 1]) k.box(m, [s * (W / 2 - 0.04), 0, 0.47], [0.06, Dp - 0.04, 0.86]);
    k.rbox(e.top_mat ?? "farm_quartz", [0, 0, 0.92], [W + 0.04, Dp + 0.04, 0.04], 0.008);
    for (const s of [-1, 1]) k.rbox(m, [s * (W / 2 - 0.12), -Dp / 2 + 0.05, 0.85], [0.08, 0.08, 0.06], 0.02);
    if (e.decor) {
      P.farm_vase(k.ctx, { base: k.p(0.2, 0.1, 0.94), heading: k.hd, flowers: true });
      for (let i = 0; i < 3; i++) k.lathe("farm_ceramic", [-0.4 + i * 0.14, -0.15, 0.94], [[0, 0], [0.11, 0], [0.12, 0.01], [0.115, 0.015], [0, 0.012]], 24);
    }
  });

  def("farm_fridge", (k, e) => {
    const W = e.width ?? 0.8, Dp = 0.72, H = 1.85, m = e.mat ?? "farm_steel";
    k.rbox(m, [0, 0, H / 2], [W, Dp, H], 0.03);
    k.box("farm_plastic_black", [0, -Dp / 2 + 0.002, 1.25], [W - 0.01, 0.006, 0.012]);
    k.box("farm_plastic_black", [0, -Dp / 2 + 0.002, 0.6], [0.006, 0.006, 1.18]);
    for (const s of [-1, 1]) k.tube("farm_chrome", [[s * 0.06, -Dp / 2, 1.0], [s * 0.06, -Dp / 2 - 0.05, 1.02], [s * 0.06, -Dp / 2 - 0.05, 1.5], [s * 0.06, -Dp / 2, 1.52]], 0.012, 8);
    k.tube("farm_chrome", [[-0.2, -Dp / 2, 1.18], [-0.2, -Dp / 2 - 0.05, 1.18], [0.2, -Dp / 2 - 0.05, 1.18], [0.2, -Dp / 2, 1.18]], 0.012, 8);
    // magnets and a child's drawing
    picture(k, -0.18, -Dp / 2 - 0.004, 1.5, 0.2, 0.26, "farm_photo", 7, "farm_ceramic");
  });

  def("farm_open_shelf", (k, e) => {
    // floating shelves with plates, mugs and jars
    const W = e.length ?? 1.0;
    for (let s = 0; s < (e.count ?? 2); s++) {
      const z = 1.45 + s * 0.38;
      k.rbox("farm_butcher_block", [0, 0, z], [W, 0.26, 0.04], 0.006);
      for (const x of [-W / 2 + 0.12, W / 2 - 0.12]) k.lathe("farm_iron", [x, 0.08, z - 0.12], [[0.008, 0], [0.008, 0.1], [0, 0.1]], 8);
      for (let i = 0; i < 5; i++) {
        const x = -W / 2 + 0.15 + (i * (W - 0.3)) / 4;
        if (s === 0) for (let p = 0; p < 4; p++) k.lathe("farm_ceramic", [x, 0.02, z + 0.02 + p * 0.022], [[0, 0], [0.07, 0], [0.12, 0.015], [0.125, 0.02], [0, 0.018]], 20);
        else P.farm_mug(k.ctx, { base: k.p(x, 0.0, z + 0.02), heading: k.hd + i * 40, mat: i % 2 ? "farm_ceramic" : "farm_cabinet_navy" });
      }
    }
  });

  def("farm_fruit_bowl", (k, e) => {
    k.lathe("farm_ceramic", [0, 0, 0], [[0, 0], [0.06, 0], [0.06, 0.01], [0.14, 0.08], [0.15, 0.09], [0.135, 0.085], [0.05, 0.02], [0, 0.02]], 24);
    const r = k.rng;
    for (let i = 0; i < 7; i++) {
      const a = r.uniform(0, 2 * Math.PI), d = i ? r.uniform(0.04, 0.08) : 0;
      k.ball(i % 2 ? "farm_apple" : "farm_fruit", [Math.cos(a) * d, Math.sin(a) * d, 0.07 + (i ? 0 : 0.05)], 0.038, 10, 16);
    }
  });

  def("farm_mug", (k, e) => {
    const m = e.mat ?? "farm_ceramic";
    k.lathe(m, [0, 0, 0], [[0, 0.002], [0.04, 0], [0.042, 0.09], [0.038, 0.095], [0.036, 0.01], [0, 0.012]], 16);
    k.tube(m, [[0.04, 0, 0.075], [0.065, 0, 0.07], [0.068, 0, 0.035], [0.04, 0, 0.025]], 0.007, 6);
  });

  def("farm_place_setting", (k, e) => {
    k.lathe("farm_ceramic", [0, 0, 0], [[0, 0], [0.09, 0], [0.13, 0.012], [0.135, 0.016], [0, 0.012]], 24);
    k.lathe("farm_ceramic", [0, 0, 0.012], [[0, 0], [0.05, 0], [0.07, 0.03], [0.072, 0.034], [0.06, 0.03], [0, 0.008]], 20);
    k.box("farm_gingham", [-0.24, 0, 0.002], [0.12, 0.2, 0.004]);
    for (const [x, w] of [[-0.18, 0.012], [0.17, 0.012], [0.2, 0.012]]) k.rbox("farm_chrome", [x, 0, 0.006], [w, 0.19, 0.006], 0.003);
    k.lathe("farm_window_glass", [0.18, 0.18, 0], [[0, 0], [0.035, 0], [0.04, 0.12], [0.037, 0.12], [0.03, 0.005], [0, 0.005]], 16);
  });

  // ---- bathroom
  def("farm_clawfoot_tub", (k, e) => {
    const Lg = e.length ?? 1.6;
    const prof = [[0, 0.12], [0.28, 0.12], [0.34, 0.2], [0.36, 0.4], [0.36, 0.6], [0.38, 0.62], [0.39, 0.64], [0.35, 0.64], [0.32, 0.62], [0.31, 0.3], [0.27, 0.2], [0, 0.2]];
    k.lathe("farm_ceramic", [0, 0, 0], prof, 32, { sx: Lg / 0.78, sy: 1 });
    k.lathe("farm_window_glass", [0, 0, 0.5], [[0, 0], [0.3, 0], [0, 0.001]], 24, { sx: Lg / 0.8 });
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const x = sx * Lg * 0.32, y = sy * 0.2;
      k.lathe("farm_brass", [x, y, 0], [[0.04, 0], [0.05, 0.02], [0.03, 0.06], [0.025, 0.12], [0, 0.13]], 10);
    }
    k.tube("farm_brass", [[-Lg * 0.46, 0, 0.6], [-Lg * 0.46, 0, 0.9], [-Lg * 0.43, 0, 0.95], [-Lg * 0.4, 0, 0.88]], 0.012, 8);
  });

  def("farm_toilet", (k, e) => {
    k.lathe("farm_ceramic", [0, -0.05, 0], [[0.12, 0], [0.13, 0.05], [0.1, 0.22], [0.17, 0.32], [0.19, 0.38], [0.16, 0.4], [0, 0.39]], 24, { sx: 1, sy: 1.25 });
    k.lathe("farm_ceramic", [0, -0.05, 0.4], [[0.18, 0], [0.19, 0.01], [0.17, 0.025], [0, 0.025]], 24, { sx: 1, sy: 1.25 });
    k.rbox("farm_ceramic", [0, 0.2, 0.62], [0.44, 0.2, 0.42], 0.03);
    k.rbox("farm_ceramic", [0, 0.2, 0.845], [0.47, 0.22, 0.03], 0.012);
    k.lathe("farm_chrome", [0.17, 0.09, 0.78], [[0.012, 0], [0.012, 0.02], [0, 0.02]], 10, { axis: "-y" });
  });

  def("farm_vanity", (k, e) => {
    const W = e.length ?? 1.0, m = e.mat ?? "farm_cabinet_sage";
    k.box(m, [0, 0.02, 0.43], [W, 0.5, 0.74]);
    for (const s of W > 0.8 ? [-1, 1] : [0]) shakerDoor(k, m, s * W / 4, -0.235, 0.1, W > 0.8 ? W / 2 - 0.02 : W - 0.04, 0.62, "knob");
    k.rbox("farm_quartz", [0, 0, 0.82], [W + 0.04, 0.55, 0.04], 0.008);
    k.lathe("farm_ceramic", [0, 0, 0.84], [[0.16, 0], [0.18, 0.02], [0.17, 0.11], [0.14, 0.12], [0.13, 0.03], [0, 0.03]], 24, { sx: 1.25, sy: 0.85 });
    k.tube("farm_chrome", [[0, 0.21, 0.84], [0, 0.21, 1.02], [0, 0.12, 1.05], [0, 0.09, 0.98]], 0.012, 8);
    k.rbox("farm_walnut", [0, 0.24, 1.55], [W * 0.75, 0.03, 0.85], 0.012);
    k.box("farm_mirror", [0, 0.222, 1.55], [W * 0.75 - 0.08, 0.004, 0.77]);
    for (const s of [-1, 1]) {
      k.lathe("farm_brass", [s * (W * 0.42), 0.22, 1.72], [[0.03, 0], [0.012, 0.05], [0.05, 0.1], [0.06, 0.18], [0, 0.18]], 14);
      k.ball("farm_bulb", [s * (W * 0.42), 0.21, 1.86], 0.03, 8, 12);
    }
    k.lathe("farm_ceramic", [W * 0.35, 0.05, 0.84], [[0, 0], [0.035, 0], [0.04, 0.12], [0.02, 0.15], [0, 0.16]], 14);
  });

  def("farm_towel_rail", (k, e) => {
    const W = e.length ?? 0.7;
    for (const s of [-1, 1]) k.lathe("farm_brass", [s * W / 2, 0.08, 1.06], [[0.025, 0], [0.025, 0.01], [0.008, 0.02], [0, 0.02]], 10, { axis: "-y" });
    k.tube("farm_brass", [[-W / 2, 0.06, 1.06], [-W / 2, -0.02, 1.06], [W / 2, -0.02, 1.06], [W / 2, 0.06, 1.06]], 0.01, 8);
    k.sheet(e.mat ?? "farm_towel", (u, v) => [-W / 2 + 0.06 + u * (W - 0.12), -0.02 + 0.04 * Math.sin(v * Math.PI) * (v < 0.5 ? 1 : -0.4) + 0.01 * Math.sin(u * 20), 1.07 - Math.abs(v - 0.5) * 1.1], 10, 8, 1, 1);
  });

  // ---- laundry, mudroom
  def("farm_washer", (k, e) => {
    const m = e.mat ?? "farm_ceramic";
    k.rbox(m, [0, 0, 0.43], [0.6, 0.62, 0.86], 0.03);
    k.lathe("farm_chrome", [0, -0.31, 0.4], [[0.22, 0], [0.23, 0.02], [0.2, 0.04], [0, 0.04]], 28, { axis: "-y" });
    k.cyl("farm_window_glass", [0, -0.335, 0.4], 0.18, 0.01, 28, true, [0, 90, 0]);
    k.box("farm_plastic_black", [0, -0.306, 0.8], [0.56, 0.01, 0.1]);
    k.lathe("farm_chrome", [0.18, -0.31, 0.8], [[0.03, 0], [0.03, 0.02], [0, 0.02]], 14, { axis: "-y" });
  });

  def("farm_coat_hooks", (k, e) => {
    const W = e.length ?? 1.6;
    k.rbox("farm_pine", [0, 0.02, 1.65], [W, 0.025, 0.14], 0.008);
    const n = Math.round(W / 0.3);
    const coats = ["farm_tweed", "farm_door_red", "farm_cabinet_navy", "farm_linen", "farm_velvet_green"];
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + 0.15 + (i * (W - 0.3)) / Math.max(1, n - 1);
      k.tube("farm_iron", [[x, 0.0, 1.65], [x, -0.07, 1.65], [x, -0.08, 1.7]], 0.008, 6);
      if (i % 2 === 0 || e.full) {
        const m = coats[i % coats.length];
        // a hanging coat: shoulders, body with folds, sleeves
        k.sheet(m, (u, v) => {
          const a = (u - 0.5) * 2;
          const w = 0.18 + v * 0.1;
          return [x + a * w, -0.06 - 0.05 * Math.cos(a * 1.5) - 0.02 * Math.sin(u * 18) * v, 1.62 - v * 0.85];
        }, 14, 10, 1, 1);
        for (const s of [-1, 1]) k.tube(m, [[x + s * 0.16, -0.07, 1.58], [x + s * 0.22, -0.08, 1.3], [x + s * 0.2, -0.09, 1.05]], 0.045, 8);
        if (i % 4 === 0) {
          k.ball("farm_wheat", [x, -0.05, 1.71], 0.11, 8, 14);
          k.lathe("farm_wheat", [x, -0.05, 1.68], [[0.2, 0], [0.19, 0.012], [0, 0.012]], 18);
        }
      }
    }
  });

  def("farm_boots", (k, e) => {
    const m = e.mat ?? "farm_leather";
    for (let i = 0; i < (e.count ?? 3); i++) {
      for (const s of [-1, 1]) {
        const x = i * 0.32 + s * 0.06;
        k.rbox(m, [x, -0.04, 0.04], [0.1, 0.27, 0.08], 0.03);
        k.rbox(m, [x, 0.04, 0.2], [0.1, 0.12, 0.32], 0.04);
        k.box("farm_plastic_black", [x, -0.04, 0.008], [0.1, 0.27, 0.016]);
      }
    }
  });

  // ---- living room fittings
  def("farm_fireplace", (k, e) => {
    const W = e.length ?? 1.8;
    k.box("farm_brick", [0, 0.05, 0.62], [W, 0.5, 1.24]);
    k.box("farm_brick", [0, 0.12, 2.0], [W * 0.62, 0.36, 1.6]);
    k.box("farm_iron", [0, -0.12, 0.42], [W * 0.5, 0.3, 0.64]);
    k.rbox("farm_walnut", [0, -0.05, 1.27], [W + 0.2, 0.32, 0.08], 0.02);
    k.box("farm_walnut", [0, -0.03, 1.2], [W + 0.06, 0.26, 0.06]);
    k.rbox("farm_stone", [0, -0.45, 0.02], [W + 0.3, 0.5, 0.04], 0.01);
    // logs and grate
    for (let i = 0; i < 3; i++) k.cyl("farm_walnut", [-0.12 + i * 0.12, -0.12, 0.18 + (i === 1 ? 0.1 : 0)], 0.06, 0.55, 10, true, [90, 90, 12 - i * 12]);
    for (let i = 0; i < 6; i++) k.box("farm_iron", [-0.25 + i * 0.1, -0.12, 0.1], [0.015, 0.3, 0.02]);
    // mantel decor: candlesticks, a clock, a picture over it
    for (const s of [-1, 1]) {
      k.lathe("farm_brass", [s * W * 0.4, -0.05, 1.31], [[0.04, 0], [0.04, 0.01], [0.012, 0.03], [0.015, 0.15], [0.03, 0.17], [0, 0.17]], 12);
      k.cyl("farm_bedding", [s * W * 0.4, -0.05, 1.56], 0.012, 0.16, 8);
    }
    k.lathe("farm_walnut", [0.25, -0.02, 1.31], [[0.09, 0], [0.09, 0.03], [0.07, 0.04], [0.07, 0.18], [0.09, 0.22], [0, 0.26]], 4, { sx: 1.2, sy: 0.6 });
    k.cyl("farm_ceramic", [0.25, -0.075, 1.48], 0.055, 0.01, 18, true, [0, 90, 0]);
    picture(k, -0.05, 0.06, 1.85, 0.9, 0.6, "farm_art", 0, "farm_brass");
  });

  def("farm_tv_unit", (k, e) => {
    const W = e.length ?? 1.8, m = e.mat ?? "farm_walnut";
    k.rbox(m, [0, 0, 0.3], [W, 0.45, 0.5], 0.012);
    for (const s of [-1, 1]) shakerDoor(k, m, s * W / 4, -0.226, 0.08, W / 2 - 0.04, 0.42, "pull");
    for (const sx of [-1, 1]) taperLeg(k, m, sx * (W / 2 - 0.05), 0, 0, 0.06, 0.05, 0.04);
    // TV on a foot
    k.rbox("farm_plastic_black", [0, 0.02, 0.56], [0.36, 0.2, 0.02], 0.008);
    k.box("farm_plastic_black", [0, 0.04, 0.62], [0.06, 0.03, 0.12]);
    k.rbox("farm_plastic_black", [0, 0.05, 0.98], [1.24, 0.04, 0.72], 0.008);
    k.box("farm_screen", [0, 0.028, 0.98], [1.2, 0.004, 0.68]);
    P.farm_vase(k.ctx, { base: k.p(-W / 2 + 0.2, 0, 0.55), heading: k.hd, flowers: false });
    P.farm_plant(k.ctx, { base: k.p(W / 2 - 0.2, 0, 0.55), heading: k.hd, size: 0.5, kind: "trailing" });
  });

  def("farm_piano", (k, e) => {
    const m = e.mat ?? "farm_walnut";
    k.rbox(m, [0, 0.1, 0.65], [1.5, 0.4, 1.3], 0.015);
    k.rbox(m, [0, -0.18, 0.72], [1.5, 0.24, 0.06], 0.01);
    for (let i = 0; i < 36; i++) k.box("farm_ceramic", [-0.7 + i * 0.04, -0.2, 0.76], [0.037, 0.15, 0.02]);
    for (let i = 0; i < 36; i++) if ([1, 2, 4, 5, 6].includes(i % 7)) k.box("farm_plastic_black", [-0.7 + i * 0.04 - 0.02, -0.17, 0.78], [0.022, 0.09, 0.02]);
    for (const s of [-1, 1]) {
      k.rbox(m, [s * 0.72, -0.2, 0.36], [0.06, 0.06, 0.72], 0.02);
      turnedLeg(k, m, s * 0.72, -0.3, 0, 0.7, 0.025);
    }
    k.rbox(m, [0, -0.04, 1.0], [1.3, 0.04, 0.3], 0.01, { p: 8 });
    P.farm_bench(k.ctx, { base: k.p(0, -0.75, 0), heading: k.hd, length: 0.85, mat: m, cushion: "farm_velvet_green" });
    picture(k, 0.3, 0.29, 1.65, 0.3, 0.38, "farm_photo", 2, "farm_brass");
    P.farm_lamp(k.ctx, { base: k.p(-0.55, 0.1, 1.3), heading: k.hd, size: 0.8 });
  });

  // ---- lighting
  def("farm_lamp", (k, e) => {
    const s = e.size ?? 1;
    k.lathe(e.mat ?? "farm_ceramic", [0, 0, 0], [[0, 0], [0.07, 0], [0.075, 0.01], [0.1, 0.12], [0.09, 0.22], [0.03, 0.3], [0.015, 0.32], [0, 0.33]].map(([r, z]) => [r * s, z * s]), 20);
    k.cyl("farm_brass", [0, 0, 0.38 * s], 0.008, 0.12 * s, 8);
    k.lathe("farm_lampshade", [0, 0, 0.36 * s], [[0.17, 0], [0.165, 0.005], [0.11, 0.22], [0.105, 0.225]].map(([r, z]) => [r * s, z * s]), 24);
    k.ball("farm_bulb", [0, 0, 0.42 * s], 0.035 * s, 8, 12);
  });

  def("farm_floor_lamp", (k, e) => {
    k.lathe("farm_iron", [0, 0, 0], [[0, 0], [0.16, 0], [0.16, 0.02], [0.03, 0.04], [0, 0.04]], 20);
    k.cyl("farm_iron", [0, 0, 0.78], 0.012, 1.5, 10);
    k.lathe("farm_lampshade", [0, 0, 1.36], [[0.22, 0], [0.215, 0.005], [0.14, 0.3], [0.135, 0.305]], 24);
    k.ball("farm_bulb", [0, 0, 1.45], 0.04, 8, 12);
  });

  def("farm_pendant", (k, e) => {
    const drop = e.drop ?? 0.8, m = e.mat ?? "farm_galvanized";
    k.cyl("farm_iron", [0, 0, -drop / 2], 0.004, drop, 6);
    k.lathe(m, [0, 0, -drop - 0.18], [[0.2, 0], [0.21, 0.005], [0.17, 0.04], [0.08, 0.14], [0.03, 0.18], [0.025, 0.2], [0, 0.2]], 24);
    k.ball("farm_bulb", [0, 0, -drop - 0.12], 0.045, 8, 12);
    k.lathe("farm_iron", [0, 0, -0.03], [[0.06, 0], [0.06, 0.03], [0, 0.03]], 16);
  });

  def("farm_chandelier", (k, e) => {
    const drop = e.drop ?? 0.7, arms = e.arms ?? 6, R = e.radius ?? 0.38;
    k.tube("farm_iron", [[0, 0, 0], [0, 0, -drop]], 0.006, 6);
    k.lathe("farm_iron", [0, 0, -drop - 0.25], [[0, 0], [0.04, 0.02], [0.05, 0.12], [0.03, 0.2], [0.02, 0.25], [0, 0.26]], 14);
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a);
      const pts = [];
      for (let j = 0; j <= 8; j++) {
        const t = j / 8;
        pts.push([c * R * t, s * R * t, -drop - 0.18 - Math.sin(t * Math.PI) * 0.08 + t * t * 0.1]);
      }
      k.tube("farm_iron", pts, 0.009, 6);
      const tip = pts[pts.length - 1];
      k.lathe("farm_iron", tip, [[0.035, 0], [0.03, 0.02], [0.015, 0.03], [0, 0.03]], 10);
      k.cyl("farm_bedding", add(tip, [0, 0, 0.08]), 0.012, 0.11, 8);
      k.ball("farm_bulb", add(tip, [0, 0, 0.16]), 0.018, 6, 10);
    }
    k.lathe("farm_iron", [0, 0, -0.03], [[0.07, 0], [0.07, 0.03], [0, 0.03]], 16);
  });

  def("farm_ceiling_light", (k, e) => {
    k.lathe("farm_brass", [0, 0, -0.03], [[0.12, 0], [0.12, 0.03], [0, 0.03]], 20);
    k.lathe("farm_lampshade", [0, 0, -0.17], [[0, 0], [0.12, 0.02], [0.17, 0.08], [0.18, 0.14], [0.17, 0.15]], 24);
    k.ball("farm_brass", [0, 0, -0.17], 0.015, 6, 8);
  });

  def("farm_sconce", (k, e) => {
    k.lathe("farm_brass", [0, 0, 0], [[0.05, 0], [0.05, 0.02], [0, 0.02]], 14, { axis: "-y" });
    k.tube("farm_brass", [[0, 0, 0], [0, -0.12, 0.05], [0, -0.18, 0.1]], 0.007, 6);
    k.lathe("farm_lampshade", [0, -0.18, 0.1], [[0.08, 0], [0.075, 0.005], [0.05, 0.13], [0.045, 0.135]], 18);
  });

  // ---- soft furnishings and decor
  def("farm_rug", (k, e) => {
    const [W, Dp] = e.size ?? [2.4, 1.7];
    const m = e.mat ?? "farm_rug_red";
    const b = k.b(m);
    const base = b.vertexCount;
    b.addRoundedBox(k.p(0, 0, 0.006), [W, Dp, 0.012], { hpr: k.hpr(), uvScale: 1, radius: e.round ? Math.min(W, Dp) / 2 - 0.01 : 0.005, round: ["+x", "-x", "+y", "-y"], segments: e.round ? 4 : 1 });
    // fit the rug design to the rug: map each vertex's local x / y to [0, 1]
    const a = -k.hd * D, c = Math.cos(a), s = Math.sin(a), o0 = k.p(0, 0, 0);
    for (let i = base; i < b.vertexCount; i++) {
      const o = i * 18;
      const dx = b.verts[o] - o0[0], dy = b.verts[o + 1] - o0[1];
      const lx = dx * c - dy * s, ly = dx * s + dy * c;
      b.verts[o + 12] = lx / W + 0.5;
      b.verts[o + 13] = ly / Dp + 0.5;
    }
    if (e.fringe) for (const sy of [-1, 1]) for (let i = 0; i < Math.round(W / 0.03); i++) k.box("farm_linen", [-W / 2 + 0.015 + i * 0.03, sy * (Dp / 2 + 0.03), 0.003], [0.01, 0.06, 0.004]);
  });

  def("farm_curtains", (k, e) => {
    // a rod with finials and two gathered panels, tied back a little; base = window centre at sill level
    const W = e.width ?? 1.0, H = e.height ?? 1.8, m = e.mat ?? "farm_curtain", top = e.top ?? H;
    k.tube("farm_iron", [[-W / 2 - 0.25, -0.09, top + 0.12], [W / 2 + 0.25, -0.09, top + 0.12]], 0.012, 8);
    for (const s of [-1, 1]) k.ball("farm_iron", [s * (W / 2 + 0.27), -0.09, top + 0.12], 0.025, 8, 12);
    const drop = top + 0.12 - (e.floor ?? -0.85);
    for (const s of [-1, 1]) {
      const x0 = s * (W / 2 + 0.22), x1 = s * (W / 2 - 0.12);
      k.sheet(m, (u, v) => {
        const tie = Math.exp(-Math.pow((v - 0.6) / 0.12, 2)) * 0.5;
        const x = x0 + (x1 - x0) * u * (1 - tie);
        return [x, -0.1 + 0.035 * Math.sin(u * 2 * Math.PI * 5) * (1 - 0.6 * tie), top + 0.1 - v * drop];
      }, 20, 10, 0.9, drop / 0.7);
    }
  });

  def("farm_plant", (k, e) => {
    const s = e.size ?? 1;
    k.lathe(e.pot ?? "farm_terracotta", [0, 0, 0], [[0, 0.01], [0.11, 0], [0.13, 0.2], [0.15, 0.22], [0.15, 0.26], [0.13, 0.26], [0.12, 0.23], [0, 0.23]].map(([r, z]) => [r * s, z * s]), 20);
    k.cyl("farm_mulch", [0, 0, 0.235 * s], 0.12 * s, 0.01, 16);
    const r = k.rng, n = e.kind === "tall" ? 9 : 16;
    for (let i = 0; i < n; i++) {
      const a = r.uniform(0, 2 * Math.PI), tilt = e.kind === "trailing" ? r.uniform(1.0, 1.9) : r.uniform(0.15, 0.8);
      const L = (e.kind === "tall" ? r.uniform(0.6, 1.1) : r.uniform(0.25, 0.45)) * s;
      const W = (e.kind === "tall" ? 0.16 : 0.07) * s;
      const d = [Math.cos(a), Math.sin(a)];
      k.sheet("farm_leaf", (u, v) => {
        const along = v * L;
        const bend = Math.sin(tilt) * along, rise = Math.cos(tilt) * along - (e.kind === "trailing" ? along * along * 1.2 : along * along * 0.4);
        const w = W * Math.max(0.12, Math.sin(Math.min(0.92, v * 1.1) * Math.PI)) * (u - 0.5);
        return [d[0] * bend - d[1] * w, d[1] * bend + d[0] * w, 0.24 * s + rise];
      }, 3, 6, 1, 1);
    }
  });

  def("farm_vase", (k, e) => {
    k.lathe(e.mat ?? "farm_cabinet_navy", [0, 0, 0], [[0, 0], [0.05, 0], [0.08, 0.08], [0.06, 0.2], [0.035, 0.24], [0.04, 0.26], [0, 0.26]], 18);
    if (e.flowers !== false) {
      const r = k.rng;
      for (let i = 0; i < 9; i++) {
        const a = r.uniform(0, 2 * Math.PI), d = r.uniform(0.04, 0.16), h = r.uniform(0.42, 0.56);
        const tip = [Math.cos(a) * d, Math.sin(a) * d, h];
        k.tube("farm_leaf", [[0, 0, 0.2], [tip[0] * 0.5, tip[1] * 0.5, h * 0.7], tip], 0.004, 4);
        const m = ["farm_door_red", "farm_bedding", "farm_fruit", "farm_wall_rose"][i % 4];
        k.ball(m, tip, 0.035, 8, 12);
        k.ball("farm_wheat", add(tip, [0, 0, 0.012]), 0.015, 6, 8);
      }
    }
  });

  def("farm_picture", (k, e) => {
    const [W, H] = e.size ?? [0.6, 0.45];
    picture(k, 0, 0, 0, W, H, e.atlas ?? "farm_art", e.cell ?? 0, e.frame ?? "farm_walnut");
  });

  def("farm_clock", (k, e) => {
    k.lathe("farm_walnut", [0, 0, 0], [[0, 0], [0.18, 0], [0.18, 0.04], [0.16, 0.05], [0, 0.05]], 28, { axis: "-y" });
    k.cyl("farm_ceramic", [0, -0.052, 0], 0.15, 0.004, 28, true, [0, 90, 0]);
    for (let i = 0; i < 12; i++) k.box("farm_plastic_black", [Math.cos((i * 30) * D) * 0.13, -0.056, Math.sin((i * 30) * D) * 0.13], [0.008, 0.002, 0.02], 0, 0, -i * 30 + 90);
    k.box("farm_plastic_black", [0.03, -0.058, 0.02], [0.008, 0.002, 0.08], 0, 0, -40);
    k.box("farm_plastic_black", [-0.04, -0.059, 0.03], [0.006, 0.002, 0.11], 0, 0, 50);
  });

  def("farm_window", (k, e) => {
    // a double-hung sash window filling a wall opening: base = centre of the opening at its sill; heading points
    // the window's outside to -y. Frame, two sashes with muntins (2 over 2), glass, inside sill and apron.
    const W = e.width ?? 1.0, H = e.height ?? 1.4, T = e.depth ?? 0.25, m = e.mat ?? "farm_trim";
    const fw = 0.05;
    for (const s of [-1, 1]) k.box(m, [s * (W / 2 - fw / 2), 0, H / 2], [fw, T * 0.5, H]);
    k.box(m, [0, 0, H - fw / 2], [W, T * 0.5, fw]);
    k.box(m, [0, T * 0.05, 0.015], [W, T * 0.6, 0.03]);
    k.rbox(m, [0, T / 2 + 0.03, -0.01], [W + 0.14, 0.09, 0.035], 0.008);          // stool (inside)
    k.box(m, [0, T / 2 + 0.01, -0.07], [W, 0.02, 0.09]);                           // apron
    for (const s of [-1, 1]) k.box(m, [s * (W / 2 + 0.04), T / 2 + 0.01, H / 2], [0.08, 0.02, H + 0.08]);   // casing (inside)
    k.box(m, [0, T / 2 + 0.01, H + 0.05], [W + 0.16, 0.02, 0.1]);
    const sh = (H - fw) / 2;
    for (const [z0, dy] of [[0.03, 0.02], [0.03 + sh, -0.02]]) {
      const sw = 0.035;
      for (const s of [-1, 1]) k.box(m, [s * (W / 2 - fw - sw / 2), dy, z0 + sh / 2], [sw, 0.04, sh]);
      k.box(m, [0, dy, z0 + sw / 2], [W - 2 * fw, 0.04, sw]);
      k.box(m, [0, dy, z0 + sh - sw / 2], [W - 2 * fw, 0.04, sw]);
      k.box(m, [0, dy, z0 + sh / 2], [0.018, 0.03, sh - 0.04]);
      k.box("farm_window_glass", [0, dy, z0 + sh / 2], [W - 2 * fw - 0.04, 0.004, sh - 0.05]);
    }
    k.box(m, [0, -T / 2 - 0.01, -0.02], [W + 0.1, 0.06, 0.04]);                    // outside sill
  });

  def("farm_door_leaf", (k, e) => {
    // a six-panel door, swung open by `open` degrees around its hinge at local x = -W/2; base = doorway centre
    const W = e.width ?? 0.9, H = e.height ?? 2.1, m = e.mat ?? "farm_cabinet_white", open = e.open ?? 80;
    const hx = -W / 2 + 0.02;
    const k2 = new K(k.L, k.ctx, { base: k.p(hx, 0, 0), heading: k.hd - open, seed: 3 });
    k2.rbox(m, [W / 2 - 0.02, 0, H / 2], [W - 0.04, 0.04, H - 0.01], 0.006);
    for (const y of [-0.022, 0.022]) {
      for (const [cx, cz, pw, ph] of [[0.25, 0.42, 0.3, 0.62], [0.65, 0.42, 0.3, 0.62], [0.25, 1.15, 0.3, 0.62], [0.65, 1.15, 0.3, 0.62], [0.25, 1.75, 0.3, 0.42], [0.65, 1.75, 0.3, 0.42]]) {
        const sx = (W - 0.04) / 0.9;
        k2.box(m, [cx * sx, y, cz * (H / 2.1)], [pw * sx, 0.006, ph * (H / 2.1)]);
      }
      k2.lathe("farm_brass", [W - 0.1, y, 1.0], [[0.02, 0], [0.01, 0.03], [0.028, 0.05], [0, 0.06]], 12, { axis: y < 0 ? "-y" : "y" });
    }
  });

  def("farm_banister", (k, e) => {
    // a handrail on turned balusters from p0 to p1 (local points with z), newel posts at both ends
    const p0 = e.p0, p1 = e.p1, h = e.height ?? 0.9, m = e.mat ?? "farm_trim", rail = e.rail_mat ?? "farm_walnut";
    const k0 = new K(k.L, k.ctx, { base: [0, 0, 0], heading: 0 });
    const L2 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const n = Math.max(2, Math.round(L2 / 0.12));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = p0[0] + (p1[0] - p0[0]) * t, y = p0[1] + (p1[1] - p0[1]) * t, z = p0[2] + (p1[2] - p0[2]) * t;
      if (i === 0 || i === n) {
        k0.rbox(m, [x, y, z + (h + 0.15) / 2], [0.1, 0.1, h + 0.15], 0.01);
        k0.lathe(m, [x, y, z + h + 0.15], [[0.06, 0], [0.04, 0.03], [0.05, 0.07], [0, 0.1]], 12);
      } else k0.lathe(m, [x, y, z], [[0.02, 0], [0.02, 0.08], [0.028, 0.14], [0.014, 0.3], [0.02, h * 0.75], [0.016, h - 0.02], [0, h]], 8);
    }
    k0.tube(rail, [[p0[0], p0[1], p0[2] + h + 0.02], [p1[0], p1[1], p1[2] + h + 0.02]], 0.03, 10);
  });
}

// shared with the other prefab modules (farm_decor.mjs)
export { K, D, add, cushion, drawer, shakerDoor, books, picture, taperLeg, turnedLeg };
