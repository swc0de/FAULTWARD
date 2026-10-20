// Visual-only yard pieces and the scenery beyond the boundary for the Hollister Farm map (types "farm_*" in
// "visual_pieces"). Solid parts get plain colliders in the map's "pieces"; these only draw.
const D = Math.PI / 180;

function frame(L, ctx, e) {
  const o = e.base ?? [0, 0, 0], hd = (e.heading ?? 0) * D;
  const c = Math.cos(hd), s = Math.sin(hd);
  const p = (x, y, z) => ctx.xf([o[0] + x * c - y * s, o[1] + x * s + y * c, o[2] + z])[0];
  const hpr = (h = 0, pp = 0, r = 0) => [(e.heading ?? 0) + h, pp, r];
  const rng = new L.Random(e.seed ?? Math.trunc(Math.abs(o[0] * 31 + o[1] * 17)) + 5);
  return { o, p, hpr, rng, b: (m) => ctx.builder(m), uv: (m) => ctx.uvScale(m) };
}

export function register(L) {
  const P = L.PREFABS;
  const def = (name, fn) => {
    P[name] = (ctx, e) => {
      if (!ctx.geometry) return;
      fn(ctx, e, frame(L, ctx, e));
    };
  };
  const box = (ctx, f, m, c, size, h = 0, pp = 0, r = 0) => ctx.builder(m).addBox(f.p(...c), size, f.hpr(h, pp, r), ctx.uvScale(m), [], "world");
  const rbox = (ctx, f, m, c, size, radius, o = {}) =>
    ctx.builder(m).addRoundedBox(f.p(...c), size, { hpr: f.hpr(o.h ?? 0, o.p ?? 0, o.r ?? 0), uvScale: ctx.uvScale(m), radius, segments: o.segments ?? 3, displace: null, step: o.step ?? 0 });
  const blob = (ctx, f, m, c, r, scale = [1, 1, 1], seed = 1, lump = 0.3) => ctx.builder(m).addBlob(f.p(...c), r, scale, seed, 2, lump, ctx.uvScale(m), false, f.hpr());

  // a broadleaf shade tree: a tapered trunk that forks into limbs, a crown of leafy clumps
  def("farm_tree", (ctx, e, f) => {
    const H = e.height ?? 9, R = e.spread ?? 3.6, bark = e.bark ?? "farm_walnut", leaf = e.leaf ?? "farm_hedge";
    const trunkH = H * 0.38;
    ctx.builder(bark).addCylinder(f.p(0, 0, trunkH / 2), 0.28 * (H / 9), trunkH, 14, ctx.uvScale(bark), false, [0, 0, 0]);
    ctx.builder(bark).addCylinder(f.p(0, 0, 0.15), 0.4 * (H / 9), 0.3, 14, ctx.uvScale(bark), false, [0, 0, 0]);
    const limbs = 4;
    for (let i = 0; i < limbs; i++) {
      const a = (i / limbs) * 360 + f.rng.uniform(-20, 20);
      const tilt = f.rng.uniform(28, 42);
      const l = H * 0.32;
      const c = [Math.cos(a * D) * Math.sin(tilt * D) * l / 2, Math.sin(a * D) * Math.sin(tilt * D) * l / 2, trunkH + Math.cos(tilt * D) * l / 2];
      ctx.builder(bark).addCylinder(f.p(...c), 0.13 * (H / 9), l, 10, ctx.uvScale(bark), false, [a - 90, 0, tilt]);
    }
    const n = e.clumps ?? 14;
    for (let i = 0; i < n; i++) {
      const a = f.rng.uniform(0, 2 * Math.PI), d = f.rng.uniform(0, R * 0.75), z = H * f.rng.uniform(0.55, 0.9) - d * 0.25;
      blob(ctx, f, leaf, [Math.cos(a) * d, Math.sin(a) * d, z], f.rng.uniform(R * 0.35, R * 0.55), [1, 1, 0.8], i + 3, 0.35);
    }
  });

  // a clipped hedge along p0 -> p1 (visual; the collider is a box in "pieces")
  def("farm_hedge", (ctx, e, f) => {
    const [x0, y0] = e.p0, [x1, y1] = e.p1, h = e.height ?? 2.6, t = e.thickness ?? 1.1;
    const L2 = Math.hypot(x1 - x0, y1 - y0), hd = Math.atan2(y1 - y0, x1 - x0) / D;
    const seg = 3.0, n = Math.max(1, Math.round(L2 / seg));
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) / n;
      const c = [x0 + (x1 - x0) * s, y0 + (y1 - y0) * s, h / 2];
      ctx.builder("farm_hedge").addRoundedBox(ctx.xf(c)[0], [L2 / n + 0.25, t + f.rng.uniform(-0.05, 0.1), h + f.rng.uniform(-0.1, 0.1)], {
        hpr: [hd, 0, 0], uvScale: ctx.uvScale("farm_hedge"), radius: 0.35, segments: 3, displace: null, step: 0.8
      });
    }
  });

  def("farm_shrub", (ctx, e, f) => {
    const r = e.radius ?? 0.6;
    for (let i = 0; i < 4; i++) blob(ctx, f, e.mat ?? "farm_hedge", [f.rng.uniform(-r * 0.4, r * 0.4), f.rng.uniform(-r * 0.4, r * 0.4), r * 0.7 + f.rng.uniform(0, r * 0.3)], r * f.rng.uniform(0.55, 0.75), [1, 1, 0.85], i + 11, 0.4);
    if (e.flowers) for (let i = 0; i < 18; i++) {
      const a = f.rng.uniform(0, 2 * Math.PI), d = f.rng.uniform(0, r), z = r * 0.7 + Math.sqrt(Math.max(0, r * r - d * d)) * 0.7;
      ctx.builder(e.flowers).addSphere(f.p(Math.cos(a) * d, Math.sin(a) * d, z), 0.05, 6, 8, 0.2);
    }
  });

  // a bed of flowers on mulch along a rectangle
  def("farm_flower_bed", (ctx, e, f) => {
    const [[x0, y0], [x1, y1]] = [e.min, e.max];
    const cols = e.colors ?? ["farm_door_red", "farm_bedding", "farm_fruit", "farm_wall_rose", "farm_cabinet_navy"];
    ctx.builder("farm_mulch").addBox(ctx.xf([(x0 + x1) / 2, (y0 + y1) / 2, 0.02])[0], [x1 - x0, y1 - y0, 0.04], [0, 0, 0], ctx.uvScale("farm_mulch"), [], "world");
    for (const [a, bb] of [[[x0, y0], [x1, y0]], [[x0, y1], [x1, y1]], [[x0, y0], [x0, y1]], [[x1, y0], [x1, y1]]]) {
      const cx = (a[0] + bb[0]) / 2, cy = (a[1] + bb[1]) / 2, L2 = Math.hypot(bb[0] - a[0], bb[1] - a[1]);
      ctx.builder("farm_stone").addBox(ctx.xf([cx, cy, 0.06])[0], [a[1] === bb[1] ? L2 + 0.12 : 0.12, a[1] === bb[1] ? 0.12 : L2, 0.12], [0, 0, 0], ctx.uvScale("farm_stone"), [], "world");
    }
    const area = (x1 - x0) * (y1 - y0);
    for (let i = 0; i < area * 3; i++) {
      const x = f.rng.uniform(x0 + 0.15, x1 - 0.15), y = f.rng.uniform(y0 + 0.15, y1 - 0.15);
      const h = f.rng.uniform(0.25, 0.55), col = cols[Math.floor(f.rng.uniform(0, cols.length))];
      const stem = [x, y, 0.04];
      ctx.builder("farm_leaf").addCylinder(ctx.xf([x, y, 0.04 + h / 2])[0], 0.006, h, 4, 0.4, false, [0, 0, 0]);
      for (let k = 0; k < 3; k++) {
        const a = f.rng.uniform(0, 2 * Math.PI);
        ctx.builder("farm_leaf").addBox(ctx.xf([x + Math.cos(a) * 0.05, y + Math.sin(a) * 0.05, 0.04 + h * 0.4])[0], [0.1, 0.03, 0.006], [a / D, 0, 25], 0.4, [], "world");
      }
      ctx.builder(col).addSphere(ctx.xf([x, y, 0.04 + h])[0], f.rng.uniform(0.035, 0.06), 5, 8, 0.2);
      void stem;
    }
  });

  // a raised vegetable bed with plants in rows
  def("farm_raised_bed", (ctx, e, f) => {
    const W = e.length ?? 3.0, Dp = e.width ?? 1.2, H = 0.4;
    for (const sy of [-1, 1]) rbox(ctx, f, "farm_pine", [0, sy * (Dp / 2 - 0.03), H / 2], [W, 0.06, H], 0.01);
    for (const sx of [-1, 1]) rbox(ctx, f, "farm_pine", [sx * (W / 2 - 0.03), 0, H / 2], [0.06, Dp - 0.12, H], 0.01);
    box(ctx, f, "farm_soil", [0, 0, H - 0.04], [W - 0.12, Dp - 0.12, 0.02]);
    const kind = e.kind ?? "lettuce";
    for (let i = 0; i < Math.floor(W / 0.35); i++)
      for (let j = 0; j < 2; j++) {
        const x = -W / 2 + 0.25 + i * 0.35, y = (j - 0.5) * (Dp * 0.45);
        if (kind === "lettuce") for (let k = 0; k < 2; k++) blob(ctx, f, "farm_corn_leaf", [x, y, H + 0.05 + k * 0.01], 0.11 - k * 0.015, [1, 1, 0.6], i * 7 + j * 3 + k, 0.5);
        else {
          ctx.builder("farm_pine").addCylinder(f.p(x, y, H + 0.6), 0.01, 1.2, 4, 0.4, false, [0, 0, 0]);
          for (let k = 0; k < 3; k++) blob(ctx, f, "farm_leaf", [x + f.rng.uniform(-0.12, 0.12), y + f.rng.uniform(-0.12, 0.12), H + 0.3 + k * 0.28], 0.12, [1, 1, 1], i * 5 + k, 0.5);
          for (let k = 0; k < 3; k++) ctx.builder("farm_apple").addSphere(f.p(x + f.rng.uniform(-0.1, 0.1), y + f.rng.uniform(-0.1, 0.1), H + 0.35 + k * 0.2), 0.04, 6, 10, 0.2);
        }
      }
  });

  // a painted picket fence p0 -> p1 (visual; give it a collider in "pieces" where it must stop players)
  def("farm_picket_fence", (ctx, e, f) => {
    const [x0, y0] = e.p0, [x1, y1] = e.p1, h = e.height ?? 1.05, m = e.mat ?? "farm_trim";
    const L2 = Math.hypot(x1 - x0, y1 - y0), hd = Math.atan2(y1 - y0, x1 - x0) / D;
    const ux = (x1 - x0) / L2, uy = (y1 - y0) / L2;
    const at = (s, z) => ctx.xf([x0 + ux * s, y0 + uy * s, z])[0];
    const posts = Math.max(1, Math.round(L2 / 2.4));
    for (let i = 0; i <= posts; i++) {
      const s = (i / posts) * L2;
      ctx.builder(m).addRoundedBox(at(s, (h + 0.1) / 2), [0.09, 0.09, h + 0.1], { hpr: [hd, 0, 0], uvScale: 1, radius: 0.01, segments: 2 });
      ctx.builder(m).addBox(at(s, h + 0.13), [0.12, 0.12, 0.04], [hd + 45, 0, 0], 1, [], "world");
    }
    for (const z of [0.25, h - 0.2]) ctx.builder(m).addBox(at(L2 / 2, z), [L2, 0.04, 0.08], [hd, 0, 0], 1, [], "world");
    const n = Math.round(L2 / 0.13);
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) * (L2 / n);
      ctx.builder(m).addBox(at(s, h / 2 + 0.02), [0.075, 0.018, h - 0.08], [hd, 0, 0], 1, [], "world");
      ctx.builder(m).addBox(at(s, h - 0.03), [0.053, 0.018, 0.053], [hd, 0, 45], 1, [], "world");
    }
  });

  // a pair of tall plank gates between brick piers, with the farm's name on a board above
  def("farm_gate", (ctx, e, f) => {
    const W = e.width ?? 4.0, H = e.height ?? 2.0;
    for (const s of [-1, 1]) {
      rbox(ctx, f, "farm_brick", [s * (W / 2 + 0.3), 0, 1.25], [0.55, 0.55, 2.5], 0.01);
      rbox(ctx, f, "farm_stone", [s * (W / 2 + 0.3), 0, 2.55], [0.65, 0.65, 0.1], 0.02);
      ctx.builder("farm_iron").addSphere(f.p(s * (W / 2 + 0.3), 0, 2.7), 0.12, 8, 12, 0.5);
      // a leaf: frame, diagonal brace and vertical boards
      const cx = s * W / 4;
      for (let i = 0; i < 9; i++) box(ctx, f, "farm_trim", [cx - W / 4 + 0.12 + i * ((W / 2 - 0.24) / 8), 0, H / 2 + 0.05], [0.11, 0.04, H - 0.1 - (i % 2) * 0.06]);
      for (const z of [0.3, H - 0.3]) box(ctx, f, "farm_trim", [cx, 0.03, z], [W / 2 - 0.1, 0.04, 0.12]);
      const diag = Math.hypot(W / 2 - 0.3, H - 0.6);
      box(ctx, f, "farm_trim", [cx, 0.03, H / 2], [diag, 0.04, 0.1], 0, 0, s * Math.atan2(H - 0.6, W / 2 - 0.3) / D);
      ctx.builder("farm_iron").addBox(f.p(s * 0.08, -0.04, H * 0.55), [0.04, 0.03, 0.2], f.hpr(), 1, [], "world");
    }
    rbox(ctx, f, "farm_walnut", [0, 0, 3.0], [W + 1.2, 0.12, 0.42], 0.02);
    for (const s of [-1, 1]) box(ctx, f, "farm_iron", [s * (W / 2 + 0.3), 0, 2.85], [0.03, 0.03, 0.3]);
  });

  def("farm_rocking_chair", (ctx, e, f) => {
    const m = e.mat ?? "farm_trim";
    for (const s of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 10; i++) {
        const t = (i / 10) * 2 - 1;
        pts.push(f.p(s * 0.24, t * 0.45, 0.04 + t * t * 0.08));
      }
      const b = ctx.builder(m);
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], c = pts[i + 1];
        const mid = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2];
        const l = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
        b.addBox(mid, [0.04, l + 0.01, 0.04], [(e.heading ?? 0), Math.atan2(c[2] - a[2], Math.hypot(c[0] - a[0], c[1] - a[1])) / D * (i < 5 ? -1 : 1) * -1, 0], 1, [], "world");
      }
      box(ctx, f, m, [s * 0.24, -0.15, 0.27], [0.04, 0.04, 0.42]);
      box(ctx, f, m, [s * 0.24, 0.2, 0.62], [0.04, 0.04, 1.1], 0, -12);
      box(ctx, f, m, [s * 0.24, -0.02, 0.66], [0.05, 0.42, 0.04]);
    }
    rbox(ctx, f, m, [0, 0, 0.47], [0.52, 0.48, 0.04], 0.01);
    for (let i = 0; i < 6; i++) box(ctx, f, m, [-0.2 + i * 0.08, 0.26, 0.85], [0.05, 0.02, 0.6], 0, -12);
    box(ctx, f, m, [0, 0.33, 1.15], [0.52, 0.04, 0.08], 0, -12);
    rbox(ctx, f, "farm_gingham", [0, -0.02, 0.51], [0.44, 0.42, 0.05], 0.02);
  });

  def("farm_porch_swing", (ctx, e, f) => {
    const m = e.mat ?? "farm_trim", W = e.length ?? 1.6, hang = e.hang ?? 2.4;
    rbox(ctx, f, m, [0, 0, 0.45], [W, 0.55, 0.05], 0.01);
    for (let i = 0; i < 9; i++) box(ctx, f, m, [-W / 2 + 0.1 + i * ((W - 0.2) / 8), 0.27, 0.75], [0.07, 0.025, 0.55], 0, -10);
    box(ctx, f, m, [0, 0.3, 1.04], [W, 0.04, 0.08], 0, -10);
    for (const s of [-1, 1]) {
      box(ctx, f, m, [s * W / 2, 0, 0.6], [0.05, 0.55, 0.05]);
      ctx.builder("farm_iron").addCylinder(f.p(s * W / 2, 0, 0.45 + hang / 2), 0.006, hang, 4, 1, false, [0, 0, 0]);
    }
    rbox(ctx, f, "farm_linen", [0, -0.02, 0.5], [W - 0.1, 0.48, 0.06], 0.025);
    rbox(ctx, f, "farm_gingham", [-W / 2 + 0.3, 0.18, 0.66], [0.38, 0.12, 0.34], 0.06, { p: -15 });
  });

  def("farm_grill", (ctx, e, f) => {
    const b = ctx.builder("farm_iron");
    for (let i = 0; i < 3; i++) {
      const a = (i * 120 + 30) * D;
      b.addCylinder(f.p(Math.cos(a) * 0.22, Math.sin(a) * 0.22, 0.35), 0.015, 0.75, 6, 1, false, [i * 120 + 30 - 90, 0, -14]);
    }
    b.addDome(f.p(0, 0, 0.72), 0.3, 0.75, 8, 24, 0.5);
    const lid = ctx.builder("farm_iron");
    lid.addDome(f.p(0, 0, 0.73), 0.3, 0.6, 8, 24, 0.5);
    ctx.builder("farm_chrome").addSphere(f.p(0, 0, 0.92), 0.025, 6, 8, 0.3);
  });

  def("farm_tire_swing", (ctx, e, f) => {
    const z = e.height ?? 0.55;
    ctx.builder("farm_plastic_black").addCylinder(f.p(0, 0, z), 0.38, 0.2, 24, 0.5, true, f.hpr(0, 90, 0));
    ctx.builder("farm_ceramic").addCylinder(f.p(0, 0, z), 0.2, 0.22, 16, 0.5, true, f.hpr(0, 90, 0));
    ctx.builder("farm_linen").addCylinder(f.p(0, 0, z + 0.38 + (e.rope ?? 3.5) / 2), 0.015, e.rope ?? 3.5, 6, 0.3, false, [0, 0, 0]);
  });

  def("farm_mailbox", (ctx, e, f) => {
    box(ctx, f, "farm_trim", [0, 0, 0.55], [0.1, 0.1, 1.1]);
    rbox(ctx, f, "farm_trim", [0, 0, 1.1], [0.3, 0.6, 0.06], 0.01);
    ctx.builder("farm_iron").addCylinder(f.p(0, 0, 1.24), 0.12, 0.5, 18, 0.5, true, f.hpr(0, 90, 0));
    box(ctx, f, "farm_iron", [0, 0, 1.13], [0.24, 0.5, 0.06]);
    box(ctx, f, "farm_door_red", [0.13, 0.12, 1.3], [0.02, 0.04, 0.22]);
  });

  def("farm_lamp_post", (ctx, e, f) => {
    ctx.builder("farm_iron").addCylinder(f.p(0, 0, 1.2), 0.04, 2.4, 10, 0.5, false, [0, 0, 0]);
    ctx.builder("farm_iron").addCylinder(f.p(0, 0, 0.1), 0.12, 0.2, 14, 0.5, true, [0, 0, 0]);
    ctx.builder("farm_iron").addDome(f.p(0, 0, 2.6), 0.2, 0.6, 6, 16, 0.5);
    ctx.builder("farm_window_glass").addCylinder(f.p(0, 0, 2.5), 0.14, 0.22, 12, 0.5, false, [0, 0, 0]);
    ctx.builder("farm_bulb").addSphere(f.p(0, 0, 2.5), 0.05, 6, 10, 0.2);
  });

  // ---- scenery beyond the boundary (no collision, nothing reachable)
  def("farm_barn_scenery", (ctx, e, f) => {
    const W = e.width ?? 14, Lg = e.length ?? 20, H = e.height ?? 6;
    box(ctx, f, "farm_barn_red", [0, 0, H / 2], [W, Lg, H]);
    // gambrel roof: two pitches each side
    const lower = 60 * D, upper = 25 * D, l1 = W * 0.28, l2 = W * 0.3;
    for (const s of [-1, 1]) {
      const x1 = s * (W / 2 - Math.cos(lower) * l1 / 2), z1 = H + Math.sin(lower) * l1 / 2;
      box(ctx, f, "farm_shingle", [x1, 0, z1], [l1, Lg + 0.6, 0.15], 0, 0, s * lower / D);
      const xe = s * (W / 2 - Math.cos(lower) * l1), ze = H + Math.sin(lower) * l1;
      box(ctx, f, "farm_shingle", [xe - s * Math.cos(upper) * l2 / 2, 0, ze + Math.sin(upper) * l2 / 2], [l2 + 0.2, Lg + 0.6, 0.15], 0, 0, s * upper / D);
    }
    const ridge = H + Math.sin(lower) * l1 + Math.sin(upper) * l2;
    for (const sy of [-1, 1]) {
      // gable ends filled with stacked courses
      for (let z = H; z < ridge; z += 0.3) {
        const t = (z - H) / (ridge - H);
        const w = t < (Math.sin(lower) * l1) / (ridge - H) ? W - 2 * Math.cos(lower) * l1 * (z - H) / (Math.sin(lower) * l1) : (W - 2 * Math.cos(lower) * l1) * (1 - (z - H - Math.sin(lower) * l1) / (Math.sin(upper) * l2));
        if (w > 0.1) box(ctx, f, "farm_barn_red", [0, sy * (Lg / 2 - 0.1), z + 0.15], [w, 0.2, 0.3]);
      }
      box(ctx, f, "farm_trim", [0, sy * (Lg / 2 + 0.02), 2.0], [4.2, 0.08, 4.0]);
      box(ctx, f, "farm_barn_red", [0, sy * (Lg / 2 + 0.05), 2.0], [3.8, 0.08, 3.6]);
      for (const d of [-1, 1]) box(ctx, f, "farm_trim", [0, sy * (Lg / 2 + 0.07), 2.0], [5.3, 0.06, 0.12], 0, d * 43, 0);
    }
  });

  def("farm_silo_scenery", (ctx, e, f) => {
    const r = e.radius ?? 3.2, h = e.height ?? 12;
    ctx.builder(e.mat ?? "farm_galvanized").addCylinder(f.p(0, 0, h / 2), r, h, 32, ctx.uvScale("farm_galvanized"), false, [0, 0, 0]);
    ctx.builder(e.mat ?? "farm_galvanized").addDome(f.p(0, 0, h), r + 0.1, 0.4, 8, 32, ctx.uvScale("farm_galvanized"));
    for (let i = 1; i < h; i += 1.2) ctx.builder("farm_steel").addCylinder(f.p(0, 0, i), r + 0.03, 0.05, 32, 1, false, [0, 0, 0]);
  });
}
