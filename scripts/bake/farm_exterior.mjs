// Visual-only details on the outside of the farmhouse: gutters and downspouts, window shutters, porch baskets,
// the AC condenser, the meter, a hose reel, roof vents, a bird bath and a woodpile. Same local frame as
// farm_furniture.mjs (base [x, y, z], heading, +x right, +y back, +z up, the front facing -y).
import { K, D } from "./farm_furniture.mjs";

export function register(L) {
  const P = L.PREFABS;
  const def = (name, fn) => {
    P[name] = (ctx, e) => {
      if (!ctx.geometry) return;
      fn(new K(L, ctx, e), e);
    };
  };

  // a K-style gutter along the eave: base at its middle, length along local x, the open side up, the house at +y
  def("farm_gutter", (k, e) => {
    const W = e.length ?? 10, m = e.mat ?? "farm_trim";
    k.box(m, [0, 0, 0], [W, 0.12, 0.012]);                               // bottom
    k.box(m, [0, 0.055, 0.06], [W, 0.012, 0.12]);                        // back (against the fascia)
    k.box(m, [0, -0.06, 0.055], [W, 0.012, 0.11], 0, -12);              // front face, leaning out
    k.tube(m, [[-W / 2, -0.072, 0.115], [W / 2, -0.072, 0.115]], 0.009, 6);  // rolled lip
    for (const s of [-1, 1]) k.box(m, [s * W / 2, 0, 0.06], [0.012, 0.13, 0.12]);
    for (let x = -W / 2 + 0.4; x < W / 2; x += 0.8) k.box(m, [x, 0, 0.11], [0.02, 0.13, 0.01]);   // hangers
  });

  // a downspout: from a gutter outlet at the top, back to the wall face, down it, and out onto a splash block.
  // base = on the ground at the wall face, the wall at +y; top = height of the gutter; reach = gutter's offset.
  def("farm_downspout", (k, e) => {
    const top = e.top ?? 6.2, reach = e.reach ?? 0.5, m = e.mat ?? "farm_trim";
    const y = -0.06, sz = [0.07, 0.09];
    k.box(m, [0, y - reach / 2, top - 0.05], [sz[0], reach, sz[1]], 0, 0, 0);
    k.box(m, [0, y - reach / 2, top - 0.25], [sz[0], sz[1], 0.4], 0, Math.atan2(reach, 0.4) / D, 0);
    k.box(m, [0, y, (top - 0.45 + 0.35) / 2], [sz[0], sz[1], top - 0.45 - 0.35]);
    for (let z = 0.9; z < top - 0.5; z += 1.6) k.box(m, [0, y + 0.03, z], [0.11, 0.02, 0.03]);   // straps
    k.box(m, [0, y - 0.12, 0.27], [sz[0], 0.26, sz[1]], 0, 40, 0);
    k.box(m, [0, y - 0.38, 0.13], [sz[0], 0.22, sz[1]], 0, 10, 0);
    k.rbox("farm_stone", [0, y - 0.55, 0.03], [0.32, 0.6, 0.06], 0.02);  // splash block
  });

  // a pair of louvered shutters either side of a window (base: window centre at sill height, on the wall face)
  def("farm_shutters", (k, e) => {
    const Wn = e.window ?? 1.1, H = e.height ?? 1.5, m = e.mat ?? "farm_shutter";
    const w = Math.min(0.55, Wn / 2 + 0.02);
    for (const s of [-1, 1]) {
      const cx = s * (Wn / 2 + 0.1 + w / 2), y = -0.035;
      // stiles and rails, two louvered panels
      for (const sx of [-1, 1]) k.box(m, [cx + sx * (w / 2 - 0.03), y, H / 2], [0.06, 0.035, H]);
      for (const z of [0.03, H / 2, H - 0.03]) k.box(m, [cx, y, z], [w - 0.02, 0.035, 0.06]);
      for (const half of [0, 1]) k.box(m, [cx, y + 0.006, 0.06 + half * (H / 2 - 0.03) + (H / 2 - 0.06) / 2], [w - 0.11, 0.022, H / 2 - 0.07]);  // louvered panels (the texture has the louvers)
      // the iron holdback
      k.tube("farm_iron", [[cx - s * (w / 2 + 0.02), -0.005, H * 0.45], [cx - s * (w / 2 + 0.07), -0.04, H * 0.45], [cx - s * (w / 2 + 0.05), -0.07, H * 0.5]], 0.008, 5);
    }
  });

  // a hanging basket of trailing plants on chains (base at the hook)
  def("farm_hanging_basket", (k, e) => {
    const drop = e.drop ?? 0.6, z = -drop;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * 2 * Math.PI;
      k.tube("farm_iron", [[0, 0, 0], [Math.cos(a) * 0.17, Math.sin(a) * 0.17, z + 0.1]], 0.003, 4);
    }
    k.lathe(e.mat ?? "farm_wicker", [0, 0, z - 0.06], [[0, 0], [0.1, 0.0], [0.17, 0.08], [0.18, 0.16], [0.17, 0.16], [0, 0.14]], 18);
    const b = k.b("farm_foliage"), uv = k.uv("farm_foliage");
    b.addBlob(k.p(0, 0, z + 0.12), 0.2, [1, 1, 0.65], Math.floor(k.o[0] * 13 + 7), 1, 0.45, uv * 0.5, false, [0, 0, 0]);
    const r = k.rng;
    for (let i = 0; i < 10; i++) {
      const a = r.uniform(0, 2 * Math.PI), L2 = r.uniform(0.25, 0.5);
      const d = [Math.cos(a), Math.sin(a)];
      k.sheet("farm_foliage", (u, v) => {
        const w = 0.06 * (1 - v * 0.6) * (u - 0.5);
        return [d[0] * (0.16 + v * 0.06) - d[1] * w, d[1] * (0.16 + v * 0.06) + d[0] * w, z + 0.1 - v * L2];
      }, 2, 5, 0.3, 0.6);
    }
    for (let i = 0; i < 9; i++) {
      const a = r.uniform(0, 2 * Math.PI), dd = r.uniform(0.05, 0.2);
      k.ball(e.flowers ?? "farm_wall_rose", [Math.cos(a) * dd, Math.sin(a) * dd, z + 0.2 + r.uniform(0, 0.06)], 0.03, 4, 6);
    }
  });

  // an AC condenser on a pad, the line set into the wall behind it (+y)
  def("farm_ac_unit", (k, e) => {
    k.rbox("farm_stone", [0, 0, 0.04], [0.95, 0.95, 0.08], 0.01);
    k.rbox("farm_steel", [0, 0, 0.45], [0.78, 0.78, 0.72], 0.02);
    for (const [x, y, h] of [[0, -0.392, 0], [0.392, 0, 90], [-0.392, 0, 90]]) k.box("farm_screen", [x, y, 0.42], [0.66, 0.006, 0.58], h);
    for (let i = 0; i < 12; i++) k.box("farm_steel", [-0.33 + i * 0.06, -0.396, 0.42], [0.008, 0.006, 0.6]);
    k.cyl("farm_plastic_black", [0, 0, 0.815], 0.3, 0.012, 24);
    for (let i = 0; i < 4; i++) k.box("farm_iron", [0, 0, 0.825], [0.6, 0.012, 0.01], i * 45);
    k.cyl("farm_iron", [0, 0, 0.83], 0.05, 0.02, 12);
    k.tube("farm_brass", [[0.3, 0.39, 0.25], [0.3, 0.55, 0.25], [0.3, 0.55, 0.9], [0.3, 0.62, 0.9]], 0.012, 6);
    k.tube("farm_plastic_black", [[0.2, 0.39, 0.3], [0.2, 0.55, 0.3], [0.2, 0.55, 0.95], [0.2, 0.62, 0.95]], 0.022, 6);
    k.box("farm_galvanized", [-0.25, 0.5, 1.0], [0.25, 0.1, 0.32]);    // disconnect box on the wall
  });

  // an electric meter with its conduit (base on the wall face at meter height)
  def("farm_meter", (k, e) => {
    k.rbox("farm_galvanized", [0, -0.07, 0], [0.3, 0.12, 0.42], 0.02);
    k.lathe("farm_window_glass", [0, -0.13, 0.04], [[0.08, 0], [0.085, 0.03], [0.08, 0.1], [0.05, 0.13], [0, 0.135]], 18, { axis: "-y" });
    k.cyl("farm_bedding", [0, -0.135, 0.04], 0.07, 0.004, 18, true, [0, 90, 0]);
    k.tube("farm_galvanized", [[0, -0.05, 0.2], [0, -0.05, e.up ?? 1.6]], 0.022, 8);
    k.tube("farm_galvanized", [[0, -0.05, -0.2], [0, -0.05, -1.2]], 0.022, 8);
  });

  // a hose reel cart with a coiled green hose, and the faucet on the wall behind it (+y)
  def("farm_hose_reel", (k, e) => {
    for (const s of [-1, 1]) {
      k.tube("farm_plastic_black", [[s * 0.22, 0.1, 0.05], [s * 0.22, 0, 0.45], [s * 0.22, -0.15, 0.75]], 0.014, 6);
      k.cyl("farm_plastic_black", [s * 0.26, 0.1, 0.1], 0.1, 0.04, 14, true, [0, 0, 90]);
    }
    k.tube("farm_plastic_black", [[-0.22, -0.15, 0.75], [0.22, -0.15, 0.75]], 0.014, 6);
    k.cyl("farm_plastic_black", [0, 0, 0.4], 0.12, 0.4, 14, true, [0, 0, 90]);
    for (let i = 0; i < 9; i++) {
      const x = -0.17 + i * 0.042;
      const ring = [];
      for (let j = 0; j <= 18; j++) {
        const a = (j / 18) * 2 * Math.PI;
        ring.push([x, Math.cos(a) * 0.17, 0.4 + Math.sin(a) * 0.17]);
      }
      k.tube("farm_cabinet_sage", ring, 0.017, 5);
    }
    k.tube("farm_cabinet_sage", [[0.2, -0.1, 0.25], [0.35, -0.3, 0.05], [0.6, -0.5, 0.03], [0.9, -0.4, 0.03]], 0.017, 5);
    k.tube("farm_brass", [[0.0, 0.42, 0.55], [0.0, 0.34, 0.55], [0.0, 0.34, 0.5]], 0.014, 6);
    k.cyl("farm_iron", [0, 0.37, 0.6], 0.03, 0.02, 10);
  });

  // a plumbing vent stack through the roof (base on the roof surface)
  def("farm_vent_stack", (k, e) => {
    k.lathe("farm_plastic_black", [0, 0, -0.05], [[0.2, 0], [0.18, 0.03], [0.07, 0.08], [0.06, 0.12], [0, 0.12]], 14, { sy: 1.2 });
    k.cyl("farm_trim", [0, 0, 0.3], 0.05, 0.6, 12);
  });

  // a stone bird bath (base on the ground)
  def("farm_bird_bath", (k, e) => {
    k.lathe("farm_stone", [0, 0, 0], [[0, 0], [0.2, 0], [0.2, 0.05], [0.1, 0.1], [0.08, 0.4], [0.06, 0.6], [0.09, 0.66], [0.3, 0.72], [0.34, 0.78], [0.31, 0.8], [0.05, 0.74], [0, 0.74]], 24);
    k.cyl("farm_window_glass", [0, 0, 0.765], 0.28, 0.006, 24);
  });

  // a covered woodpile along local x (base in the middle of its front, the hedge or wall at +y)
  def("farm_woodpile", (k, e) => {
    const W = e.length ?? 2.4, rows = 6, r = k.rng;
    for (const s of [-1, 1]) k.box("farm_pine", [s * W / 2, 0, 0.7], [0.08, 0.08, 1.4]);
    k.box("farm_pine", [0, 0, 0.04], [W, 0.5, 0.08]);
    for (let row = 0; row < rows; row++) {
      const z = 0.13 + row * 0.15;
      for (let x = -W / 2 + 0.12; x < W / 2 - 0.08; x += 0.15 + r.uniform(0, 0.02)) {
        if (row === rows - 1 && r.random() < 0.4) continue;
        k.cyl("farm_bark", [x, r.uniform(-0.03, 0.03), z], r.uniform(0.055, 0.075), 0.45, 8, true, [0, 90, r.uniform(-6, 6)]);
      }
    }
    k.box("farm_shingle", [0, 0.05, 1.45], [W + 0.3, 0.75, 0.04], 0, -12, 0);
  });

  // a worn patch of bare earth (under a swing, at a gate): a flattened irregular disc
  def("farm_worn_patch", (k, e) => {
    const [a, b] = e.size ?? [1.6, 1.2], r = k.rng;
    const prof = [];                                                      // outside in, so the surface faces up
    for (let i = 4; i >= 0; i--) prof.push([(i / 4) * 0.5, 0.012 - (i / 4) * 0.008]);
    k.lathe("farm_soil", [0, 0, 0], prof, 20, { sx: a * (0.9 + r.uniform(0, 0.2)), sy: b, phase: r.uniform(0, 6) });
  });
}
