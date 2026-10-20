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
  // a leafy mass (vegetables, small plants): the lat-long clump below, so leaf textures map cleanly
  const blob = (ctx, f, m, c, r, scale = [1, 1, 1], seed = 1, lump = 0.3) => clump(ctx.builder(m), f.rng, f.p(...c), r, ctx.uvScale(m) * 0.6, null, scale[2], 4, 8, lump + 0.1);

  // ---- shared foliage builders ---------------------------------------------------------------------------------
  const v3 = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    len: (a) => Math.hypot(a[0], a[1], a[2]),
    norm: (a) => {
      const l = Math.hypot(a[0], a[1], a[2]) || 1;
      return [a[0] / l, a[1] / l, a[2] / l];
    },
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  };
  /** A tapered round limb through world points pts (radius r0 at the start, r1 at the end), open ends. */
  const limb = (b, pts, r0, r1, sides, uv) => {
    const lens = [0];
    for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + v3.len(v3.sub(pts[i], pts[i - 1])));
    const total = lens[lens.length - 1] || 1;
    const base = b.vertexCount;
    let ref = [0, 0, 1];
    for (let i = 0; i < pts.length; i++) {
      const t = v3.norm(v3.sub(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]));
      if (Math.abs(t[2]) > 0.9) ref = [1, 0, 0];
      const u = v3.norm(v3.cross(t, ref)), w = v3.cross(t, u);
      const r = r0 + (r1 - r0) * (lens[i] / total);
      for (let j = 0; j <= sides; j++) {
        const a = (j / sides) * 2 * Math.PI;
        const n = v3.add(v3.mul(u, Math.cos(a)), v3.mul(w, Math.sin(a)));
        b.vertex(v3.add(pts[i], v3.mul(n, r)), n, t, v3.cross(n, t), (j / sides) * Math.max(0.3, 2 * Math.PI * r) / uv, lens[i] / uv);
      }
    }
    for (let i = 0; i < pts.length - 1; i++)
      for (let j = 0; j < sides; j++) {
        const a = base + i * (sides + 1) + j, c = a + sides + 1;
        b.indices.push(a, c, c + 1, a, c + 1, a + 1);
      }
  };
  /** Small two-sided leaf sprigs sticking out of a foliage mass at c (radius r): they break up its outline. */
  const sprigs = (b, rng, c, r, n, size) => {
    for (let i = 0; i < n; i++) {
      const th = rng.uniform(0, 2 * Math.PI), ph = rng.uniform(-0.4, 1.2);
      const dir = [Math.cos(th) * Math.cos(ph), Math.sin(th) * Math.cos(ph), Math.sin(ph)];
      const p = v3.add(c, v3.mul(dir, r * 0.82));
      const side = v3.norm(v3.cross(dir, [0, 0, 1]));
      const w = v3.mul(side, size * 0.5), h = v3.mul(v3.norm(v3.add(dir, [0, 0, 0.3])), size);
      const q = [v3.sub(p, w), v3.add(p, w), v3.add(v3.add(p, w), h), v3.add(v3.sub(p, w), h)];
      const nn = v3.norm(v3.add(v3.cross(side, h), [0, 0, size]));
      const uvs = [[0, 0], [size, 0], [size, size], [0, size]];
      b.addQuad(q, nn, side, v3.norm(h), uvs);
      b.addQuad([q[1], q[0], q[3], q[2]], v3.norm(v3.add(v3.mul(nn, -1), [0, 0, 1.2])), v3.mul(side, -1), v3.norm(h), uvs);
    }
  };

  /** A lumpy leaf clump (lat-long sphere so the leaf texture maps without stretching). Normals lean outward from
   *  `centre` (the crown's middle) so a whole crown shades as one mass instead of a pile of balls. */
  const clump = (b, rng, c, r, uv, centre = null, squash = 0.85, rings = 5, segs = 8, lump = 0.32) => {
    const bumps = [];
    for (let i = 0; i < 7; i++) bumps.push([v3.norm([rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)]), rng.uniform(-1, 1)]);
    const field = (d) => bumps.reduce((acc, [bd, a]) => acc + a * Math.max(0, d[0] * bd[0] + d[1] * bd[1] + d[2] * bd[2]) ** 3, 0);
    const base = b.vertexCount, ph = rng.uniform(0, 6.28);
    for (let i = 0; i <= rings; i++) {
      const th = (i / rings) * Math.PI;
      for (let j = 0; j <= segs; j++) {
        const fi = (j / segs) * 2 * Math.PI + ph;
        const d = [Math.sin(th) * Math.cos(fi), Math.sin(th) * Math.sin(fi), Math.cos(th)];
        const k = 1 + lump * field(d) + (j === segs ? 0 : 0);
        const p = [c[0] + d[0] * r * k, c[1] + d[1] * r * k, c[2] + d[2] * r * k * squash];
        let n = v3.norm([d[0], d[1], d[2] / squash]);
        if (centre) n = v3.norm(v3.add(v3.mul(n, 0.55), v3.mul(v3.norm(v3.sub(p, centre)), 0.45)));
        const t = v3.norm([-Math.sin(fi), Math.cos(fi), 0]);
        b.vertex(p, n, t, v3.cross(n, t), ((j / segs) * 2 * Math.PI * r) / uv, (th * r) / uv);
      }
    }
    for (let i = 0; i < rings; i++)
      for (let j = 0; j < segs; j++) {
        const a = base + i * (segs + 1) + j, cc = a + segs + 1;
        b.indices.push(a, cc, cc + 1, a, cc + 1, a + 1);
      }
  };

  // a broadleaf shade tree: a flared, leaning trunk that forks into curving limbs and branches, and a crown of
  // leaf clusters at the branch tips with a darker fill inside (detail 0: a cheap version for the far rows)
  def("farm_tree", (ctx, e, f) => {
    const rng = f.rng, H = e.height ?? 9, R = e.spread ?? 3.6, detail = e.detail ?? 1;
    const bark = ctx.builder(e.bark ?? "farm_bark"), buv = ctx.uvScale(e.bark ?? "farm_bark");
    const leafM = e.leaf ?? (rng.random() < 0.5 ? "farm_foliage" : "farm_foliage_dark");
    const leaf = ctx.builder(leafM), fill = ctx.builder("farm_foliage_dark"), luv = ctx.uvScale(leafM);
    const W = (x, y, z) => f.p(x, y, z);
    const r0 = 0.03 * H * (e.girth ?? 1);
    const trunkH = H * rng.uniform(0.3, 0.38);
    const lean = [rng.uniform(-0.04, 0.04) * H, rng.uniform(-0.04, 0.04) * H];
    const trunk = [];
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      trunk.push([lean[0] * t * t + Math.sin(t * 5 + H) * 0.04 * H * t, lean[1] * t * t, trunkH * t - 0.1]);
    }
    limb(bark, trunk.map((p) => W(...p)), r0, r0 * 0.7, detail ? 12 : 7, buv);
    // root flare
    if (detail) for (let i = 0; i < 5; i++) {
      const a = (i / 5) * 2 * Math.PI + rng.uniform(-0.3, 0.3);
      limb(bark, [[Math.cos(a) * r0 * 0.4, Math.sin(a) * r0 * 0.4, 0.5], [Math.cos(a) * r0 * 1.2, Math.sin(a) * r0 * 1.2, 0.12], [Math.cos(a) * r0 * 2.0, Math.sin(a) * r0 * 2.0, -0.05]].map((p) => W(...p)), r0 * 0.45, r0 * 0.15, 6, buv);
    }
    const tips = [];
    const top = trunk[trunk.length - 1];
    const nl = detail ? 4 + Math.floor(rng.uniform(0, 2)) : 3;
    for (let i = 0; i < nl; i++) {
      const az = (i / nl) * 2 * Math.PI + rng.uniform(-0.35, 0.35);
      const el = rng.uniform(32, 58) * D;                      // from vertical
      const Ll = H * rng.uniform(0.33, 0.42);
      const start = [top[0], top[1], top[2] - rng.uniform(0, trunkH * 0.25)];
      const d = [Math.cos(az) * Math.sin(el), Math.sin(az) * Math.sin(el), Math.cos(el)];
      const pts = [];
      for (let k = 0; k <= 4; k++) {
        const t = k / 4;
        // curve up a little toward the end, the way limbs reach for light
        pts.push([start[0] + d[0] * Ll * t, start[1] + d[1] * Ll * t, start[2] + d[2] * Ll * t + Ll * 0.18 * t * t]);
      }
      const rl = r0 * 0.55;
      limb(bark, pts.map((p) => W(...p)), rl, rl * 0.4, detail ? 8 : 5, buv);
      const end = pts[pts.length - 1];
      tips.push(end);
      const nb = detail ? 3 : 1;
      for (let j = 0; j < nb; j++) {
        const from = pts[2 + (j % 2)];
        const baz = az + rng.uniform(-0.9, 0.9), bel = el + rng.uniform(-0.25, 0.35);
        const bd = [Math.cos(baz) * Math.sin(bel), Math.sin(baz) * Math.sin(bel), Math.cos(bel)];
        const Lb = Ll * rng.uniform(0.45, 0.65);
        const bp = [from, v3.add(from, v3.mul(bd, Lb * 0.5)), v3.add(v3.add(from, v3.mul(bd, Lb)), [0, 0, Lb * 0.12])];
        if (detail) limb(bark, bp.map((p) => W(...p)), rl * 0.45, rl * 0.15, 5, buv);
        tips.push(bp[2]);
      }
    }
    // crown: an inner fill so the crown has body, then many smaller leaf clusters around every tip
    const crownZ = trunkH + (H - trunkH) * 0.55;
    const cc = W(0, 0, crownZ);
    for (let i = 0; i < (detail ? 4 : 2); i++) {
      const a = rng.uniform(0, 2 * Math.PI), d = rng.uniform(0, R * 0.3);
      clump(fill, rng, W(Math.cos(a) * d, Math.sin(a) * d, crownZ + rng.uniform(-0.6, 0.6)), R * rng.uniform(0.4, 0.52), luv, cc, 0.75, 5, 9);
    }
    for (const tp of tips) {
      const k = detail ? 7 : 2;
      for (let i = 0; i < k; i++) {
        const a = rng.uniform(0, 2 * Math.PI), d = rng.uniform(R * 0.05, R * 0.34);
        const c = [tp[0] + Math.cos(a) * d, tp[1] + Math.sin(a) * d, tp[2] + rng.uniform(-0.5, 0.6)];
        const r = R * (detail ? rng.uniform(0.13, 0.21) : rng.uniform(0.22, 0.36));
        clump(leaf, rng, W(...c), r, luv, cc, rng.uniform(0.7, 0.9), detail ? 5 : 4, detail ? 8 : 7, 0.4);
        if (detail) sprigs(leaf, rng, W(...c), r, 6, R * 0.055);
      }
    }
  });

  // a clipped hedge along p0 -> p1 (visual; the collider is a box in "pieces"): a swept profile with lumps and an
  // uneven top, so it reads as a clipped hedge and not a sofa
  def("farm_hedge", (ctx, e, f) => {
    const [x0, y0] = e.p0, [x1, y1] = e.p1, h = e.height ?? 2.6, t = e.thickness ?? 1.1;
    const L2 = Math.hypot(x1 - x0, y1 - y0);
    const d = [(x1 - x0) / L2, (y1 - y0) / L2, 0], s = [-d[1], d[0], 0];
    const b = ctx.builder("farm_hedge"), uv = ctx.uvScale("farm_hedge");
    // the profile across the hedge: [across, z, normal across, normal z]
    const prof = [];
    const rc = 0.3;
    const sideZ = [0, h * 0.25, h * 0.5, h * 0.75, h - rc];
    for (const z of sideZ) prof.push([-t / 2 - (h - z) * 0.03, z, -1, 0]);
    for (let i = 1; i <= 3; i++) {
      const a = (i / 4) * (Math.PI / 2);
      prof.push([-t / 2 + rc - Math.cos(a) * rc, h - rc + Math.sin(a) * rc, -Math.cos(a), Math.sin(a)]);
    }
    for (const u of [-0.15, 0.15]) prof.push([u * t, h, 0, 1]);
    for (let i = 3; i >= 1; i--) {
      const a = (i / 4) * (Math.PI / 2);
      prof.push([t / 2 - rc + Math.cos(a) * rc, h - rc + Math.sin(a) * rc, Math.cos(a), Math.sin(a)]);
    }
    for (const z of [...sideZ].reverse()) prof.push([t / 2 + (h - z) * 0.03, z, 1, 0]);
    const vs = [0];
    for (let k = 1; k < prof.length; k++) vs.push(vs[k - 1] + Math.hypot(prof[k][0] - prof[k - 1][0], prof[k][1] - prof[k - 1][1]));
    // lumps: a few sine octaves along the length, phase-shifted per profile point
    const rng = f.rng, oct = [];
    for (let i = 0; i < 5; i++) oct.push([rng.uniform(0.6, 1.0) / (i + 1), (2 * Math.PI) / (rng.uniform(2.5, 4.5) / (i + 1)), rng.uniform(0, 6.3), rng.uniform(0, 6.3)]);
    const disp = (sv, k) => {
      let v = 0;
      for (const [a, w, p, q] of oct) v += a * Math.sin(sv * w + p + k * 0.7 + q * Math.sin(k * 1.3));
      const topBoost = prof[k][3] > 0.3 ? 1.5 : 1;
      return v * 0.06 * topBoost;
    };
    const step = 0.35, ns = Math.max(2, Math.ceil(L2 / step));
    const base = b.vertexCount;
    for (let i = 0; i <= ns; i++) {
      const sv = (L2 * i) / ns;
      for (let k = 0; k < prof.length; k++) {
        const [ac, z, na, nz] = prof[k];
        const dd = disp(sv + x0 * 0.37 + y0 * 0.61, k) * (z < 0.05 ? 0.3 : 1);
        const p = [x0 + d[0] * sv + s[0] * (ac + na * dd), y0 + d[1] * sv + s[1] * (ac + na * dd), z + nz * dd];
        const n = v3.norm([s[0] * na, s[1] * na, nz]);
        b.vertex(ctx.xf(p)[0], n, d, v3.cross(n, d), sv / uv, vs[k] / uv);
      }
    }
    const K = prof.length;
    for (let i = 0; i < ns; i++)
      for (let k = 0; k < K - 1; k++) {
        const a = base + i * K + k, c = a + K;
        b.indices.push(a, c, c + 1, a, c + 1, a + 1);
      }
    // end caps (a fan from the middle of the profile)
    for (const [i, sgn] of [[0, -1], [ns, 1]]) {
      const sv = (L2 * i) / ns;
      const cIdx = b.vertexCount;
      b.vertex(ctx.xf([x0 + d[0] * sv, y0 + d[1] * sv, h * 0.5])[0], v3.mul(d, sgn), s, [0, 0, 1], 0, 0);
      const first = b.vertexCount;
      for (let k = 0; k < K; k++) {
        const [ac, z] = prof[k];
        b.vertex(ctx.xf([x0 + d[0] * sv + s[0] * ac, y0 + d[1] * sv + s[1] * ac, z])[0], v3.mul(d, sgn), s, [0, 0, 1], ac / uv, z / uv);
      }
      for (let k = 0; k < K - 1; k++) {
        if (sgn > 0) b.indices.push(cIdx, first + k, first + k + 1);
        else b.indices.push(cIdx, first + k + 1, first + k);
      }
    }
  });

  // a shrub: a mound of leaf clusters with sprigs, optionally in flower (hydrangea-like heads)
  def("farm_shrub", (ctx, e, f) => {
    const r = e.radius ?? 0.6, rng = f.rng;
    const m = e.mat ?? (rng.random() < 0.5 ? "farm_foliage" : "farm_foliage_dark");
    const b = ctx.builder(m), uv = ctx.uvScale(m);
    const n = 9 + Math.floor(r * 6);
    for (let i = 0; i < n; i++) {
      const a = rng.uniform(0, 2 * Math.PI), d = rng.uniform(0, r * 0.6);
      const c = f.p(Math.cos(a) * d, Math.sin(a) * d, r * 0.45 + rng.uniform(0, r * 0.45) - d * 0.3);
      const rr = r * rng.uniform(0.32, 0.46);
      clump(b, rng, c, rr, uv, f.p(0, 0, r * 0.3), 0.85, 5, 8, 0.4);
      sprigs(b, rng, c, rr, 6, r * 0.1);
    }
    if (e.flowers) for (let i = 0; i < Math.round(10 * r); i++) {
      const a = rng.uniform(0, 2 * Math.PI), d = rng.uniform(0, r * 0.75), z = r * 0.55 + Math.sqrt(Math.max(0, r * r - d * d)) * 0.6;
      const c = f.p(Math.cos(a) * d, Math.sin(a) * d, z);
      clump(ctx.builder(e.flowers), rng, c, r * 0.16, 0.12, null, 0.8, 3, 6, 0.5);
    }
  });

  // a bed of perennials on mulch with a stone edge: leafy mounds, daisy-like flowers on stems, spikes
  def("farm_flower_bed", (ctx, e, f) => {
    const [[x0, y0], [x1, y1]] = [e.min, e.max];
    const rng = f.rng;
    const cols = e.colors ?? ["farm_door_red", "farm_bedding", "farm_fruit", "farm_wall_rose", "farm_cabinet_navy"];
    ctx.builder("farm_mulch").addBox(ctx.xf([(x0 + x1) / 2, (y0 + y1) / 2, 0.02])[0], [x1 - x0, y1 - y0, 0.04], [0, 0, 0], ctx.uvScale("farm_mulch"), [], "world");
    for (const [a, bb] of [[[x0, y0], [x1, y0]], [[x0, y1], [x1, y1]], [[x0, y0], [x0, y1]], [[x1, y0], [x1, y1]]]) {
      const cx = (a[0] + bb[0]) / 2, cy = (a[1] + bb[1]) / 2, L2 = Math.hypot(bb[0] - a[0], bb[1] - a[1]);
      ctx.builder("farm_stone").addBox(ctx.xf([cx, cy, 0.06])[0], [a[1] === bb[1] ? L2 + 0.12 : 0.12, a[1] === bb[1] ? 0.12 : L2, 0.12], [0, 0, 0], ctx.uvScale("farm_stone"), [], "world");
    }
    const leafB = ctx.builder("farm_foliage"), luv = ctx.uvScale("farm_foliage");
    const darkB = ctx.builder("farm_foliage_dark");
    const sp = 0.55;
    for (let x = x0 + sp / 2; x < x1 - 0.1; x += sp)
      for (let y = y0 + sp / 2; y < y1 - 0.1; y += sp) {
        const px = x + rng.uniform(-0.12, 0.12), py = y + rng.uniform(-0.12, 0.12);
        const kind = rng.random();
        const r = rng.uniform(0.17, 0.26);
        const mc = ctx.xf([px, py, 0.04 + r * 0.4])[0];
        clump(kind < 0.3 ? darkB : leafB, rng, mc, r, luv * 0.6, ctx.xf([px, py, -0.2])[0], 0.62, 4, 8, 0.45);
        sprigs(kind < 0.3 ? darkB : leafB, rng, mc, r * 0.8, 8, 0.08);
        if (kind < 0.3) continue;                                    // a hosta-like leaf mound, no flowers
        const col = cols[Math.floor(rng.uniform(0, cols.length))];
        if (kind < 0.55) {
          // spikes (salvia, lavender): thin stems with a coloured tip
          for (let k = 0; k < 5; k++) {
            const a = rng.uniform(0, 2 * Math.PI), dd = rng.uniform(0, r * 0.6), hh = rng.uniform(0.35, 0.55);
            const bx = px + Math.cos(a) * dd, by = py + Math.sin(a) * dd;
            limb(ctx.builder(col), [ctx.xf([bx, by, 0.04 + hh - 0.16])[0], ctx.xf([bx + rng.uniform(-0.02, 0.02), by + rng.uniform(-0.02, 0.02), 0.04 + hh])[0]], 0.009, 0.003, 4, 0.1);
            ctx.builder("farm_foliage").addCylinder(ctx.xf([bx, by, 0.04 + (hh - 0.12) / 2])[0], 0.004, hh - 0.12, 4, 0.4, false, [0, 0, 0]);
          }
        } else {
          // daisies: a flat ring of petals and a dark centre on a stem
          for (let k = 0; k < 4; k++) {
            const a = rng.uniform(0, 2 * Math.PI), dd = rng.uniform(0, r * 0.7), hh = rng.uniform(0.32, 0.5);
            const bx = px + Math.cos(a) * dd, by = py + Math.sin(a) * dd, top = 0.04 + hh;
            ctx.builder("farm_foliage").addCylinder(ctx.xf([bx, by, 0.04 + hh / 2])[0], 0.004, hh, 4, 0.4, false, [0, 0, 0]);
            ctx.builder(col).addCylinder(ctx.xf([bx, by, top])[0], 0.035, 0.008, 9, 0.1, true, [rng.uniform(0, 90), rng.uniform(-20, 20), rng.uniform(-20, 20)]);
            ctx.builder(col === "farm_fruit" ? "farm_walnut" : "farm_fruit").addSphere(ctx.xf([bx, by, top + 0.006])[0], 0.012, 3, 6, 0.1);
          }
        }
      }
  });

  // grass tufts along lines (wall bases, fence and hedge feet, path edges): bunches of bent two-sided blades
  def("farm_grass_tufts", (ctx, e, f) => {
    const rng = f.rng, b = ctx.builder("farm_grass");
    const per = e.per_m ?? 2.0, off = e.offset ?? 0.08;
    for (const [p0, p1] of e.lines ?? []) {
      const L2 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      const d = [(p1[0] - p0[0]) / L2, (p1[1] - p0[1]) / L2], s = [-d[1], d[0]];
      const n = Math.round(L2 * per);
      for (let i = 0; i < n; i++) {
        const t = rng.uniform(0, L2), o = rng.uniform(-off, off);
        const cx = p0[0] + d[0] * t + s[0] * o, cy = p0[1] + d[1] * t + s[1] * o, z0 = (e.z ?? 0) + 0.01;
        const H = rng.uniform(0.18, 0.4) * (e.scale ?? 1);
        for (let k = 0; k < 6; k++) {
          const a = rng.uniform(0, 2 * Math.PI), tilt = rng.uniform(0.15, 0.55);
          const dir = [Math.cos(a), Math.sin(a)];
          const w = [-dir[1] * 0.02, dir[0] * 0.02, 0];
          const h = H * rng.uniform(0.7, 1.1);
          const a0 = [cx, cy, z0], tip = [cx + dir[0] * h * tilt, cy + dir[1] * h * tilt, z0 + h];
          const q = [v3.sub(a0, w), v3.add(a0, w), v3.add(tip, v3.mul(w, 0.25)), v3.sub(tip, v3.mul(w, 0.25))].map((p) => ctx.xf(p)[0]);
          const up = v3.norm(v3.sub(tip, a0)), t = v3.norm(w);
          const nn = v3.norm(v3.add(v3.cross(t, up), [0, 0, 0.8]));
          const uvs = [[0, 1], [1, 1], [1, 0], [0, 0]];
          b.addQuad(q, nn, t, up, uvs);
          b.addQuad([q[1], q[0], q[3], q[2]], v3.norm(v3.add(v3.mul(nn, -1), [0, 0, 1.6])), v3.mul(t, -1), up, [uvs[1], uvs[0], uvs[3], uvs[2]]);
        }
      }
    }
  });

  // a timber utility pole with a crossarm and insulators (base on the ground)
  def("farm_power_pole", (ctx, e, f) => {
    const H = e.height ?? 9.5;
    ctx.builder("farm_bark").addCylinder(f.p(0, 0, H / 2), 0.13, H, 10, ctx.uvScale("farm_bark"), true, [0, 0, 0]);
    box(ctx, f, "farm_walnut", [0, 0, H - 0.45], [2.2, 0.1, 0.1]);
    for (const s of [-1, 1]) box(ctx, f, "farm_iron", [s * 0.4, 0, H - 0.75], [0.03, 0.03, 0.62], 0, 0, s * 35);
    for (const x of [-0.95, 0, 0.95]) ctx.builder("farm_ceramic").addCylinder(f.p(x, 0, H - 0.32 + (x === 0 ? 0.0 : 0)), 0.04, 0.16, 8, 0.2, true, [0, 0, 0]);
    if (e.transformer) {
      ctx.builder("farm_galvanized").addCylinder(f.p(0, -0.35, H - 2.0), 0.25, 0.8, 14, ctx.uvScale("farm_galvanized"), true, [0, 0, 0]);
      box(ctx, f, "farm_iron", [0, -0.18, H - 1.9], [0.1, 0.25, 0.1]);
    }
  });

  // sagging wires between points [[x, y, z], ...] (each consecutive pair is a span)
  def("farm_wires", (ctx, e, f) => {
    const b = ctx.builder("farm_plastic_black"), sag = e.sag ?? 0.03;
    for (let i = 0; i < e.points.length - 1; i++) {
      const a = e.points[i], c = e.points[i + 1];
      const L2 = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const pts = [];
      for (let k = 0; k <= 12; k++) {
        const t = k / 12;
        pts.push(ctx.xf([a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t - 4 * sag * L2 * t * (1 - t)])[0]);
      }
      limb(b, pts, 0.012, 0.012, 4, 1);
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
