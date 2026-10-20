// More visual-only furniture and the small things that make the farmhouse lived in: occasional furniture, kitchen
// appliances and counter clutter, laundry and mudroom kit, toys, desk things, radiators and ceiling fans. Same
// conventions as farm_furniture.mjs: base [x, y, z] on the floor (or the wall / ceiling for mounted things),
// heading in degrees, local frame +x right, +y back (toward the wall), +z up, the front facing -y.
import { K, D, cushion, drawer, books, picture, taperLeg, turnedLeg } from "./farm_furniture.mjs";

const COVERS = ["farm_cabinet_navy", "farm_door_red", "farm_linen", "farm_velvet_green", "farm_leather", "farm_tweed", "farm_cabinet_sage", "farm_wall_rose"];

/** A ring of points (closed polyline) for tube(). */
function ring(cx, cy, z, rx, ry, n = 20) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * 2 * Math.PI;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, z]);
  }
  return pts;
}

/** A closed book lying flat: two covers, a spine and a paper block. */
function flatBook(k, cx, cy, z, w, d, t, cover, h = 0) {
  k.rbox(cover, [cx, cy, z + t / 2], [w, d, t], 0.003, { h });
  const a = h * D, ox = -Math.sin(a) * 0.004, oy = -Math.cos(a) * 0.004;
  k.box("farm_paper", [cx + ox, cy + oy, z + t / 2], [w - 0.012, d - 0.004, t - 0.008], h);
}

export function register(L) {
  const P = L.PREFABS;
  const def = (name, fn) => {
    P[name] = (ctx, e) => {
      if (!ctx.geometry) return;
      fn(new K(L, ctx, e), e);
    };
  };
  // another prefab placed in this one's frame
  const put = (k, name, lx, ly, lz, dh = 0, extra = {}) => P[name](k.ctx, { ...extra, base: k.p(lx, ly, lz), heading: k.hd + dh });

  // ------------------------------------------------------------------------------------- living furniture
  def("farm_ottoman", (k, e) => {
    const [W, Dp, H] = e.size ?? [0.9, 0.6, 0.44], m = e.mat ?? "farm_leather";
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) turnedLeg(k, e.leg_mat ?? "farm_walnut", sx * (W / 2 - 0.06), sy * (Dp / 2 - 0.06), 0, 0.12, 0.022);
    k.rbox(m, [0, 0, 0.12 + (H - 0.12) / 2 - 0.02], [W, Dp, H - 0.16], 0.03);
    cushion(k, m, [0, 0, H - 0.06], [W - 0.01, Dp - 0.01, 0.12], 0.05);
    // buttoned top
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) k.ball(m, [-W / 3 + (i * W) / 3, -Dp / 4 + (j * Dp) / 2, H - 0.005], 0.012, 6, 8);
    if (e.tray) {
      k.rbox("farm_walnut", [0.05, 0, H + 0.01], [0.5, 0.34, 0.02], 0.006);
      for (const s of [-1, 1]) k.box("farm_walnut", [0.05, s * 0.165, H + 0.035], [0.5, 0.012, 0.04]);
      flatBook(k, -0.06, 0, H + 0.02, 0.24, 0.18, 0.03, "farm_cabinet_navy", 8);
      flatBook(k, -0.06, 0, H + 0.05, 0.21, 0.16, 0.025, "farm_linen", -4);
      put(k, "farm_mug", 0.2, 0.05, H + 0.02);
    }
  });

  def("farm_wingback", (k, e) => {
    const m = e.mat ?? "farm_velvet_green", leg = e.leg_mat ?? "farm_walnut";
    for (const sx of [-1, 1]) taperLeg(k, leg, sx * 0.3, -0.3, 0, 0.16, 0.05, 0.035);
    for (const sx of [-1, 1]) taperLeg(k, leg, sx * 0.3, 0.3, 0, 0.16, 0.05, 0.035);
    k.rbox(m, [0, 0.02, 0.27], [0.82, 0.78, 0.22], 0.04);                                // seat base
    cushion(k, m, [0, -0.06, 0.43], [0.58, 0.62, 0.12], 0.05);                            // seat cushion
    k.rbox(m, [0, 0.33, 0.78], [0.78, 0.16, 0.86], 0.06, { p: -8 });                      // tall back
    for (const sx of [-1, 1]) {
      k.rbox(m, [sx * 0.37, 0.12, 0.85], [0.1, 0.42, 0.5], 0.04, { h: sx * 12 });          // wings
      k.rbox(m, [sx * 0.35, -0.05, 0.5], [0.12, 0.7, 0.2], 0.05);                          // arms
      k.cyl(m, [sx * 0.35, -0.39, 0.58], 0.075, 0.06, 16, true, [0, 90, 0]);               // scrolled arm fronts
    }
    if (e.pillow) cushion(k, e.pillow, [0, 0.18, 0.62], [0.36, 0.12, 0.3], 0.05, -10);
  });

  def("farm_console", (k, e) => {
    const W = e.length ?? 1.3, Dp = e.depth ?? 0.36, H = 0.8, m = e.mat ?? "farm_walnut";
    k.rbox(m, [0, 0, H - 0.017], [W, Dp, 0.034], 0.008);
    k.box(m, [0, 0, H - 0.09], [W - 0.08, Dp - 0.06, 0.11]);
    for (const s of [-1, 1]) drawer(k, m, s * W / 4, -Dp / 2 + 0.03, H - 0.145, W / 2 - 0.08, 0.1);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) taperLeg(k, m, sx * (W / 2 - 0.04), sy * (Dp / 2 - 0.04), 0, H - 0.03, 0.045, 0.03);
    k.rbox(m, [0, 0, 0.2], [W - 0.08, Dp - 0.06, 0.025], 0.006);                         // low shelf
    if (e.baskets !== false) for (const s of [-1, 1]) put(k, "farm_basket", s * W / 4, 0, 0.212, 0, { size: [W / 2 - 0.14, Dp - 0.1, 0.22], contents: s < 0 ? "blanket" : "none" });
    if (e.decor !== false) {
      put(k, "farm_lamp", -W / 2 + 0.22, 0.02, H, 0, { size: 0.9 });
      flatBook(k, 0.12, 0, H, 0.26, 0.2, 0.035, "farm_cabinet_navy", 6);
      flatBook(k, 0.12, 0, H + 0.035, 0.22, 0.17, 0.03, "farm_door_red", -3);
      k.lathe("farm_ceramic", [W / 2 - 0.2, 0, H], [[0, 0], [0.05, 0], [0.11, 0.05], [0.12, 0.06], [0.1, 0.055], [0.04, 0.012], [0, 0.012]], 20);
      put(k, "farm_vase", W / 2 - 0.2, 0.02, H + 0.012, 0, { mat: "farm_ceramic" });
    }
  });

  def("farm_grandfather_clock", (k, e) => {
    const m = e.mat ?? "farm_walnut";
    k.rbox(m, [0, 0, 0.12], [0.56, 0.32, 0.24], 0.01);                                     // plinth
    k.rbox(m, [0, 0, 0.27], [0.5, 0.29, 0.06], 0.01);
    k.box(m, [0, 0.01, 0.92], [0.42, 0.25, 1.26]);                                        // waist
    k.box("farm_window_glass", [0, -0.117, 0.95], [0.26, 0.004, 0.9]);
    k.box("farm_plastic_black", [0, -0.11, 0.95], [0.27, 0.006, 0.92]);
    k.lathe("farm_brass", [0, -0.095, 0.62], [[0, 0], [0.075, 0], [0.075, 0.01], [0, 0.01]], 20, { axis: "-y" });   // pendulum bob
    k.box("farm_brass", [0, -0.1, 0.95], [0.012, 0.004, 0.62]);
    for (let i = 0; i < 3; i++) k.cyl("farm_brass", [-0.06 + i * 0.06, -0.1, 1.18], 0.018, 0.3, 10);   // weights
    for (const s of [-1, 1]) k.box(m, [s * 0.165, -0.12, 0.95], [0.06, 0.03, 1.0]);
    k.rbox(m, [0, 0, 1.6], [0.5, 0.3, 0.06], 0.01);
    k.box(m, [0, 0.01, 1.88], [0.46, 0.27, 0.5]);                                          // hood
    k.cyl("farm_ceramic", [0, -0.126, 1.87], 0.16, 0.006, 32, true, [0, 90, 0]);           // dial
    k.lathe("farm_brass", [0, -0.12, 1.87], [[0.165, 0], [0.175, 0.012], [0.165, 0.016], [0.16, 0]], 32, { axis: "-y" });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 2 * Math.PI;
      k.box("farm_plastic_black", [Math.sin(a) * 0.135, -0.131, 1.87 + Math.cos(a) * 0.135], [0.01, 0.002, 0.022], 0, 0, -(i * 30));
    }
    k.box("farm_plastic_black", [0.03, -0.134, 1.9], [0.006, 0.002, 0.1], 0, 0, -50);
    k.box("farm_plastic_black", [0, -0.134, 1.83], [0.005, 0.002, 0.08], 0, 0, 20);
    // arched pediment with finials
    k.lathe(m, [0, 0.01, 2.13], [[0.23, 0], [0.24, 0.02], [0.2, 0.05], [0, 0.05]], 20, { sy: 0.6 });
    k.cyl(m, [0, -0.005, 2.18], 0.17, 0.27, 24, true, [0, 90, 0]);
    for (const s of [-1, 0, 1]) k.lathe("farm_brass", [s * 0.18, 0, 2.18 + (s ? 0 : 0.17)], [[0.02, 0], [0.025, 0.03], [0.01, 0.06], [0.015, 0.08], [0, 0.1]], 10);
  });

  def("farm_basket", (k, e) => {
    const [W, Dp, H] = e.size ?? [0.45, 0.35, 0.3], round = e.round ?? false;
    const m = e.mat ?? "farm_wicker";
    if (round) {
      const R = W / 2;
      k.lathe(m, [0, 0, 0], [[0, 0.002], [R * 0.82, 0], [R * 0.95, H * 0.15], [R, H * 0.9], [R * 1.03, H], [R * 0.95, H], [R * 0.92, H * 0.15], [0, 0.03]], 28);
      k.tube(m, ring(0, 0, H, R * 1.0, R * 1.0, 28), 0.012, 6);
    } else {
      k.rbox(m, [0, 0, H / 2], [W, Dp, H], 0.02, { skip: ["+z"] });
      k.box(m, [0, 0, 0.03], [W - 0.02, Dp - 0.02, 0.01]);
      k.tube(m, [[-W / 2, -Dp / 2, H], [W / 2, -Dp / 2, H], [W / 2, Dp / 2, H], [-W / 2, Dp / 2, H], [-W / 2, -Dp / 2, H]], 0.012, 6);
      if (e.handles !== false) for (const s of [-1, 1]) k.tube("farm_leather", [[s * W / 2, -0.06, H - 0.04], [s * (W / 2 + 0.02), -0.05, H - 0.02], [s * (W / 2 + 0.02), 0.05, H - 0.02], [s * W / 2, 0.06, H - 0.04]], 0.008, 6);
    }
    const c = e.contents ?? "none", r = k.rng;
    if (c === "blanket") {
      for (let i = 0; i < 2; i++) k.cyl(i ? "farm_quilt" : "farm_tweed", [(i - 0.5) * W * 0.4, 0, H * 0.75 + i * 0.03], Math.min(0.08, Dp * 0.3), W * 0.8, 18, true, [i * 15, 0, 90]);
    } else if (c === "logs") {
      for (let i = 0; i < 9; i++) {
        const lx = (i % 3 - 1) * W * 0.28, lz = 0.06 + Math.floor(i / 3) * 0.085 + H * 0.2;
        k.cyl("farm_walnut", [lx, 0, lz], r.uniform(0.035, 0.05), Dp * 1.15, 10, true, [0, 90, r.uniform(-6, 6)]);
      }
    } else if (c === "toys") {
      k.ball("farm_door_red", [-W * 0.2, 0, H * 0.85], 0.09, 12, 18);
      for (let i = 0; i < 4; i++) k.rbox(COVERS[i], [W * 0.12 + (i % 2) * 0.07, -0.05 + Math.floor(i / 2) * 0.07, H * 0.8 + 0.03], [0.06, 0.06, 0.06], 0.008, { h: i * 23 });
    } else if (c === "laundry") {
      for (let i = 0; i < 4; i++) cushion(k, ["farm_bedding", "farm_towel", "farm_gingham", "farm_linen"][i], [r.uniform(-0.08, 0.08), r.uniform(-0.05, 0.05), H * 0.75 + i * 0.04], [W * 0.8, Dp * 0.75, 0.08], 0.035, r.uniform(-12, 12));
    }
    if (e.lid) {
      k.lathe(m, [0, 0, H], [[W / 2 + 0.015, 0], [W / 2 + 0.01, 0.03], [W * 0.3, 0.06], [0, 0.07]], 28);
      k.ball(m, [0, 0, H + 0.08], 0.02, 6, 10);
    }
  });

  def("farm_book_stack", (k, e) => {
    const r = k.rng, n = e.count ?? 3;
    let z = 0;
    for (let i = 0; i < n; i++) {
      const w = r.uniform(0.18, 0.28), d = w * r.uniform(0.7, 0.8), t = r.uniform(0.022, 0.045);
      flatBook(k, r.uniform(-0.01, 0.01), r.uniform(-0.01, 0.01), z, w, d, t, COVERS[Math.floor(r.uniform(0, COVERS.length))], r.uniform(-14, 14));
      z += t;
    }
  });

  def("farm_blanket_ladder", (k, e) => {
    const H = 1.7, m = e.mat ?? "farm_pine";
    const lean = 0.25;                     // the top rests against the wall (+y), the feet are out in the room
    for (const sx of [-1, 1]) k.tube(m, [[sx * 0.22, -lean, 0], [sx * 0.22, 0.02, H]], 0.022, 8);
    for (let i = 0; i < 5; i++) {
      const t = 0.15 + i * 0.19, y = -lean + (lean + 0.02) * t;
      k.tube(m, [[-0.22, y, H * t], [0.22, y, H * t]], 0.015, 8);
    }
    const throws = e.throws ?? ["farm_quilt", "farm_tweed"];
    throws.forEach((tm, i) => {
      const t = 0.72 - i * 0.38, y = -lean + (lean + 0.02) * t, z = H * t;
      k.sheet(tm, (u, v) => {
        const s = (v - 0.5) * 2;                                // -1 front fall, +1 back fall
        return [-0.17 + u * 0.34 + 0.01 * Math.sin(v * 13), y + s * 0.03 - 0.012, z + 0.02 - Math.abs(s) * 0.38 + 0.015 * Math.sin(u * 17)];
      }, 8, 10, 1, 1);
    });
  });

  def("farm_bean_bag", (k, e) => {
    const m = e.mat ?? "farm_velvet_green", s = e.size ?? 1;
    k.lathe(m, [0, 0, 0], [[0, 0], [0.32, 0], [0.42, 0.08], [0.44, 0.2], [0.38, 0.38], [0.24, 0.52], [0.1, 0.55], [0, 0.54]].map(([r, z]) => [r * s, z * s]), 28, { sy: 0.9 });
    k.lathe(m, [0, -0.06 * s, 0.45 * s], [[0, 0], [0.26, -0.02], [0.3, 0.03], [0.2, 0.07], [0, 0.06]].map(([r, z]) => [r * s, z * s]), 24);
  });

  def("farm_pouf", (k, e) => {
    const m = e.mat ?? "farm_rug_braid";
    k.lathe(m, [0, 0, 0], [[0, 0], [0.22, 0], [0.27, 0.06], [0.28, 0.2], [0.24, 0.36], [0.12, 0.4], [0, 0.4]], 28);
  });

  // ----------------------------------------------------------------------------------- study and office
  def("farm_filing_cabinet", (k, e) => {
    const m = e.mat ?? "farm_steel", n = e.drawers ?? 3, H = n * 0.33 + 0.04;
    k.rbox(m, [0, 0, H / 2], [0.46, 0.62, H], 0.01);
    for (let i = 0; i < n; i++) {
      const z = 0.03 + i * 0.33;
      k.rbox(m, [0, -0.312, z + 0.16], [0.42, 0.014, 0.3], 0.004);
      k.tube("farm_chrome", [[-0.08, -0.318, z + 0.24], [-0.08, -0.34, z + 0.24], [0.08, -0.34, z + 0.24], [0.08, -0.318, z + 0.24]], 0.007, 6);
      k.box("farm_paper", [0, -0.32, z + 0.275], [0.08, 0.004, 0.035]);
      k.box("farm_chrome", [0, -0.321, z + 0.275], [0.09, 0.002, 0.045]);
    }
    if (e.decor !== false) {
      put(k, "farm_plant", 0.05, 0, H, 0, { kind: "trailing", size: 0.6, pot: "farm_ceramic" });
      put(k, "farm_book_stack", -0.12, 0.1, H, 0, { count: 2 });
    }
  });

  def("farm_globe", (k, e) => {
    const H = e.height ?? 0.9, R = 0.2;
    // floor stand: three turned legs, a ring stretcher and a brass meridian round the globe
    for (let i = 0; i < 3; i++) {
      const a = (i * 120 + 90) * D;
      k.tube("farm_walnut", [[Math.cos(a) * 0.25, Math.sin(a) * 0.25, 0], [Math.cos(a) * 0.2, Math.sin(a) * 0.2, H * 0.4], [Math.cos(a) * 0.24, Math.sin(a) * 0.24, H - R - 0.02]], 0.018, 8);
    }
    k.tube("farm_walnut", ring(0, 0, H * 0.4, 0.2, 0.2, 18), 0.012, 6);
    k.tube("farm_walnut", ring(0, 0, H - R - 0.02, 0.26, 0.26, 24), 0.016, 6);
    k.ball("farm_wall_blue", [0, 0, H], R, 18, 28);
    // continents: a few raised sage patches on the sphere
    const r = k.rng;
    for (let i = 0; i < 7; i++) {
      const th = r.uniform(-1.0, 1.0), ph = r.uniform(0, 2 * Math.PI), s = r.uniform(0.04, 0.09);
      const c = [Math.cos(th) * Math.cos(ph) * R, Math.cos(th) * Math.sin(ph) * R, H + Math.sin(th) * R];
      k.ball("farm_cabinet_sage", [c[0] * 0.97, c[1] * 0.97, H + (c[2] - H) * 0.97], s * 0.6, 6, 10);
    }
    const mer = [];
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * 2 * Math.PI;
      mer.push([Math.sin(a) * (R + 0.015) * Math.cos(23 * D), Math.sin(a) * (R + 0.015) * Math.sin(23 * D), H + Math.cos(a) * (R + 0.015)]);
    }
    k.tube("farm_brass", mer, 0.007, 6);
  });

  def("farm_laptop", (k, e) => {
    const open = e.open ?? 105;
    k.rbox("farm_steel", [0, 0, 0.009], [0.33, 0.23, 0.018], 0.006);
    k.box("farm_plastic_black", [0, 0.02, 0.0185], [0.28, 0.1, 0.002]);
    k.box("farm_plastic_black", [0, -0.07, 0.0185], [0.1, 0.06, 0.001]);
    const a = (open - 90) * D, hy = 0.115;
    const cz = Math.cos(a) * 0.11, cy = hy + Math.sin(a) * 0.11;
    k.rbox("farm_steel", [0, cy, 0.018 + cz], [0.33, 0.012, 0.22], 0.005, { p: -(open - 90) });
    k.box("farm_screen", [0, cy - 0.0065, 0.018 + cz], [0.3, 0.002, 0.19], 0, -(open - 90));
  });

  def("farm_desk_lamp", (k, e) => {
    // a banker's lamp: brass column, green glass shade
    k.lathe("farm_brass", [0, 0, 0], [[0, 0], [0.09, 0], [0.09, 0.015], [0.03, 0.03], [0, 0.03]], 20, { sy: 0.7 });
    k.cyl("farm_brass", [0, 0.03, 0.17], 0.01, 0.28, 8);
    k.tube("farm_brass", [[0, 0.03, 0.3], [0, 0.0, 0.33]], 0.008, 6);
    k.lathe("farm_velvet_green", [0, 0, 0.33], [[0.04, 0], [0.11, 0.015], [0.115, 0.03], [0.1, 0.055], [0.04, 0.06], [0, 0.06]], 24, { sx: 1.8, sy: 0.7 });
    k.ball("farm_bulb", [0, 0, 0.33], 0.025, 6, 10);
  });

  def("farm_paper_stack", (k, e) => {
    const n = e.count ?? 2, r = k.rng;
    let z = 0;
    for (let i = 0; i < n; i++) {
      const t = r.uniform(0.008, 0.02);
      k.box("farm_paper", [r.uniform(-0.01, 0.01), r.uniform(-0.01, 0.01), z + t / 2], [0.21, 0.297, t], r.uniform(-8, 8));
      z += t;
    }
    if (e.pens !== false) {
      k.lathe("farm_ceramic", [0.18, 0.08, 0], [[0, 0], [0.035, 0], [0.035, 0.1], [0.032, 0.1], [0.032, 0.006], [0, 0.006]], 14);
      for (let i = 0; i < 4; i++) k.tube(i % 2 ? "farm_fruit" : "farm_cabinet_navy", [[0.18 + (i - 1.5) * 0.01, 0.08, 0.01], [0.18 + (i - 1.5) * 0.025, 0.08 + (i % 2 ? 0.02 : -0.02), 0.16]], 0.004, 5);
    }
  });

  def("farm_printer", (k, e) => {
    k.rbox("farm_plastic_black", [0, 0, 0.09], [0.44, 0.36, 0.18], 0.02);
    k.box("farm_screen", [0.14, -0.16, 0.17], [0.08, 0.04, 0.02], 0, 30);
    k.box("farm_paper", [0, 0.1, 0.2], [0.21, 0.04, 0.12], 0, -20);
    k.box("farm_plastic_black", [0, -0.2, 0.05], [0.3, 0.06, 0.012]);
    k.box("farm_paper", [0, -0.22, 0.058], [0.21, 0.08, 0.004]);
  });

  def("farm_chess", (k, e) => {
    const S = 0.36, c = S / 8;
    k.rbox("farm_walnut", [0, 0, 0.012], [S + 0.04, S + 0.04, 0.024], 0.004);
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) k.box((i + j) % 2 ? "farm_walnut" : "farm_pine", [-S / 2 + c * (i + 0.5), -S / 2 + c * (j + 0.5), 0.0245], [c, c, 0.002]);
    const pawn = [[0.013, 0], [0.013, 0.006], [0.007, 0.012], [0.005, 0.025], [0.009, 0.03], [0.008, 0.038], [0, 0.04]];
    const king = [[0.016, 0], [0.016, 0.008], [0.009, 0.016], [0.006, 0.045], [0.011, 0.052], [0.008, 0.06], [0.004, 0.07], [0, 0.072]];
    const r = k.rng;
    for (const side of [0, 1]) {
      const m = side ? "farm_plastic_black" : "farm_ceramic";
      for (let i = 0; i < 8; i++) {
        if (r.random() < 0.25) continue;                     // a game in progress: some pawns taken
        const y = -S / 2 + c * (side ? 6.5 : 1.5) + (i === 4 ? (side ? -c * 2 : c * 2) : 0);
        k.lathe(m, [-S / 2 + c * (i + 0.5), y, 0.025], pawn, 10);
      }
      for (const i of [0, 3, 4, 7]) k.lathe(m, [-S / 2 + c * (i + 0.5), -S / 2 + c * (side ? 7.5 : 0.5), 0.025], i === 4 ? king : king.map(([a, b]) => [a, b * 0.8]), 10);
    }
  });

  // ------------------------------------------------------------------------------------------- kitchen
  def("farm_microwave", (k, e) => {
    k.rbox("farm_steel", [0, 0, 0.15], [0.5, 0.38, 0.3], 0.015);
    k.box("farm_screen", [-0.06, -0.191, 0.15], [0.32, 0.004, 0.22]);
    k.box("farm_plastic_black", [0.17, -0.191, 0.15], [0.1, 0.004, 0.26]);
    k.box("farm_bulb", [0.17, -0.194, 0.25], [0.06, 0.002, 0.02]);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) k.box("farm_steel", [0.15 + j * 0.022, -0.194, 0.2 - i * 0.025], [0.016, 0.003, 0.016]);
    k.box("farm_chrome", [0.115, -0.2, 0.15], [0.015, 0.012, 0.2]);
    for (const s of [-1, 1]) for (const t of [-1, 1]) k.cyl("farm_plastic_black", [s * 0.21, t * 0.15, 0.004], 0.012, 0.008, 8);
  });

  def("farm_coffee_maker", (k, e) => {
    k.rbox("farm_plastic_black", [0, 0.06, 0.18], [0.2, 0.12, 0.36], 0.02);          // reservoir column
    k.rbox("farm_plastic_black", [0, -0.03, 0.34], [0.2, 0.22, 0.06], 0.02);          // head
    k.rbox("farm_plastic_black", [0, -0.03, 0.015], [0.2, 0.24, 0.03], 0.01);         // hot plate
    k.cyl("farm_iron", [0, -0.06, 0.032], 0.07, 0.006, 20);
    // glass carafe with coffee and a handle
    k.lathe("farm_window_glass", [0, -0.06, 0.035], [[0, 0], [0.07, 0], [0.075, 0.06], [0.065, 0.13], [0.05, 0.16], [0.055, 0.17], [0, 0.17]], 20);
    k.lathe("farm_walnut", [0, -0.06, 0.037], [[0, 0], [0.066, 0], [0.071, 0.05], [0, 0.05]], 18);
    k.tube("farm_plastic_black", [[0.06, -0.06, 0.15], [0.1, -0.06, 0.15], [0.1, -0.06, 0.07], [0.068, -0.06, 0.06]], 0.009, 6);
    k.box("farm_bulb", [0.07, -0.141, 0.34], [0.012, 0.002, 0.012]);
  });

  def("farm_toaster", (k, e) => {
    k.rbox("farm_chrome", [0, 0, 0.1], [0.28, 0.17, 0.2], 0.04, { segments: 4 });
    for (const s of [-1, 1]) k.box("farm_plastic_black", [0, s * 0.035, 0.2], [0.2, 0.03, 0.004]);
    k.box("farm_plastic_black", [0.145, 0, 0.14], [0.012, 0.03, 0.05]);
    k.rbox("farm_plastic_black", [0, 0, 0.006], [0.27, 0.16, 0.012], 0.004);
  });

  def("farm_kettle", (k, e) => {
    k.lathe(e.mat ?? "farm_chrome", [0, 0, 0], [[0, 0], [0.1, 0], [0.105, 0.02], [0.1, 0.12], [0.07, 0.17], [0.04, 0.18], [0, 0.185]], 24);
    k.ball("farm_plastic_black", [0, 0, 0.19], 0.018, 6, 10);
    k.tube("farm_plastic_black", [[-0.05, 0.0, 0.17], [-0.03, 0, 0.25], [0.04, 0, 0.25], [0.06, 0, 0.17]], 0.012, 6);
    k.tube(e.mat ?? "farm_chrome", [[0.08, 0, 0.06], [0.14, 0, 0.13], [0.16, 0, 0.16]], 0.016, 8);
  });

  def("farm_utensil_crock", (k, e) => {
    k.lathe("farm_ceramic", [0, 0, 0], [[0, 0], [0.07, 0], [0.075, 0.16], [0.08, 0.17], [0.07, 0.17], [0.065, 0.01], [0, 0.01]], 20);
    const r = k.rng;
    for (let i = 0; i < 6; i++) {
      const a = r.uniform(0, 2 * Math.PI), d = r.uniform(0.01, 0.04), tilt = r.uniform(0.02, 0.07);
      const top = [Math.cos(a) * (d + tilt), Math.sin(a) * (d + tilt), r.uniform(0.3, 0.36)];
      const m = i % 3 ? "farm_walnut" : "farm_steel";
      k.tube(m, [[Math.cos(a) * d, Math.sin(a) * d, 0.02], top], 0.006, 5);
      k.ball(m, top, i % 2 ? 0.025 : 0.018, 6, 8);
    }
  });

  def("farm_knife_block", (k, e) => {
    k.box("farm_walnut", [0, 0.02, 0.1], [0.12, 0.15, 0.2], 0, -18);
    for (let i = 0; i < 5; i++) k.rbox("farm_plastic_black", [-0.04 + (i % 3) * 0.04, -0.02 + Math.floor(i / 3) * 0.04, 0.23 + Math.floor(i / 3) * 0.015], [0.018, 0.025, 0.1], 0.006, { p: -18 });
  });

  def("farm_canisters", (k, e) => {
    const m = e.mat ?? "farm_ceramic";
    [[0.11, 0.24], [0.1, 0.2], [0.09, 0.16]].forEach(([R, H], i) => {
      const x = -0.12 + i * 0.13;
      k.lathe(m, [x, 0, 0], [[0, 0], [R / 2, 0], [R / 2, H], [0, H]], 20);
      k.lathe("farm_walnut", [x, 0, H], [[R / 2 + 0.005, 0], [R / 2 + 0.005, 0.02], [0.015, 0.025], [0.012, 0.045], [0, 0.05]], 20);
    });
  });

  def("farm_cutting_board", (k, e) => {
    k.rbox(e.mat ?? "farm_butcher_block", [0, 0.03, 0.18], [0.36, 0.025, 0.36], 0.01, { p: -12 });
    k.cyl("farm_butcher_block", [0, 0.07, 0.38], 0.02, 0.026, 12, true, [0, 90, 0]);
    k.rbox("farm_pine", [0.18, 0.0, 0.15], [0.3, 0.02, 0.24], 0.012, { p: -8, h: 12 });
  });

  def("farm_dish_rack", (k, e) => {
    k.rbox("farm_steel", [0, 0, 0.01], [0.44, 0.32, 0.02], 0.006);
    for (const sy of [-1, 1]) for (let i = 0; i < 9; i++) k.tube("farm_steel", [[-0.2 + i * 0.05, sy * 0.15, 0.02], [-0.2 + i * 0.05, sy * 0.15, 0.13]], 0.003, 4);
    for (const z of [0.07, 0.13]) for (const sy of [-1, 1]) k.tube("farm_steel", [[-0.21, sy * 0.15, z], [0.21, sy * 0.15, z]], 0.003, 4);
    for (let i = 0; i < 4; i++) k.lathe("farm_ceramic", [-0.15 + i * 0.05, 0, 0.13], [[0, 0], [0.09, 0], [0.13, 0.012], [0.135, 0.016], [0, 0.012]], 20, { axis: "x" });
    for (let i = 0; i < 2; i++) put(k, "farm_mug", 0.12 + i * 0.07, -0.06 + i * 0.1, 0.02, i * 70);
  });

  def("farm_trash_can", (k, e) => {
    const m = e.mat ?? "farm_steel";
    k.lathe(m, [0, 0, 0], [[0, 0.01], [0.16, 0.0], [0.17, 0.02], [0.17, 0.62], [0, 0.62]], 28, { sy: 0.8 });
    k.lathe(m, [0, 0, 0.62], [[0.175, 0], [0.175, 0.02], [0.15, 0.05], [0, 0.06]], 28, { sy: 0.8 });
    k.rbox("farm_plastic_black", [0, -0.15, 0.03], [0.12, 0.05, 0.02], 0.006);
    k.tube("farm_plastic_black", [[-0.06, 0.135, 0.62], [0.06, 0.135, 0.62]], 0.012, 6);
  });

  def("farm_pot_rack", (k, e) => {
    // hung from the ceiling (base at the ceiling), chains down to an iron frame with pots and pans on hooks
    const W = e.length ?? 1.4, Dp = 0.5, drop = e.drop ?? 0.9;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) k.tube("farm_iron", [[sx * W * 0.4, sy * 0.15, 0], [sx * (W / 2 - 0.02), sy * (Dp / 2 - 0.02), -drop]], 0.005, 4);
    k.tube("farm_iron", [[-W / 2, -Dp / 2, -drop], [W / 2, -Dp / 2, -drop], [W / 2, Dp / 2, -drop], [-W / 2, Dp / 2, -drop], [-W / 2, -Dp / 2, -drop]], 0.012, 6);
    for (const sy of [-1, 1]) k.tube("farm_iron", [[-W / 2, sy * 0.08, -drop], [W / 2, sy * 0.08, -drop]], 0.008, 6);
    const n = Math.floor(W / 0.24);
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + 0.14 + i * ((W - 0.28) / Math.max(1, n - 1)), sy = i % 2 ? 1 : -1, y = sy * (Dp / 2);
      k.tube("farm_iron", [[x, y, -drop], [x, y, -drop - 0.08]], 0.004, 4);
      const z = -drop - 0.08;
      if (i % 3 === 0) {
        // copper saucepan hanging by its handle
        k.tube("farm_brass", [[x, y, z], [x, y, z - 0.2]], 0.01, 6);
        k.lathe("farm_brass", [x, y, z - 0.42], [[0, 0], [0.09, 0], [0.095, 0.11], [0.1, 0.12], [0, 0.12]], 20, { axis: "-y" });
      } else if (i % 3 === 1) {
        // cast-iron skillet
        k.tube("farm_iron", [[x, y, z], [x, y, z - 0.18]], 0.012, 6);
        k.lathe("farm_iron", [x, y, z - 0.33], [[0, 0], [0.13, 0], [0.14, 0.045], [0, 0.045]], 24, { axis: "-y" });
      } else {
        // a ladle and a whisk
        k.tube("farm_steel", [[x, y, z], [x, y, z - 0.25]], 0.005, 5);
        k.ball("farm_steel", [x, y, z - 0.28], 0.04, 8, 10);
        k.tube("farm_steel", [[x + 0.07, y, z], [x + 0.07, y, z - 0.12]], 0.006, 5);
        k.lathe("farm_steel", [x + 0.07, y, z - 0.27], [[0, 0], [0.025, 0.04], [0.03, 0.09], [0.012, 0.15], [0, 0.15]], 8);
      }
    }
  });

  def("farm_dog_bed", (k, e) => {
    const m = e.mat ?? "farm_tweed", s = e.size ?? 1;
    k.lathe(m, [0, 0, 0], [[0, 0.02], [0.3, 0], [0.42, 0.04], [0.45, 0.13], [0.4, 0.2], [0.33, 0.18], [0.3, 0.09], [0, 0.08]].map(([r, z]) => [r * s, z * s]), 28, { sy: 0.75 });
    cushion(k, e.cushion ?? "farm_gingham", [0, 0, 0.08 * s], [0.5 * s, 0.38 * s, 0.06], 0.03);
    k.ball("farm_door_red", [0.12 * s, -0.06 * s, 0.14 * s], 0.035, 10, 14);                 // a ball
    if (e.bowls !== false) {
      k.rbox("farm_pine", [0.75 * s, -0.05, 0.008], [0.42, 0.22, 0.016], 0.005);
      for (const s2 of [-1, 1]) k.lathe("farm_steel", [0.75 * s + s2 * 0.1, -0.05, 0.016], [[0, 0], [0.07, 0], [0.09, 0.06], [0.085, 0.065], [0.055, 0.012], [0, 0.012]], 20);
    }
  });

  // ----------------------------------------------------------------------------- laundry, mudroom, bath
  def("farm_ironing_board", (k, e) => {
    const H = 0.88, W = 1.3;
    // padded board (tapered toward one end) on crossed legs, an iron resting on its heel
    const b = 0.19;
    k.sheet("farm_gingham", (u, v) => {
      const x = -W / 2 + u * W, taper = u > 0.7 ? Math.sqrt(Math.max(0, 1 - ((u - 0.7) / 0.3) ** 2)) : 1;
      return [x, (v - 0.5) * 2 * b * Math.max(0.05, taper), H];
    }, 16, 2, 2, 1, false);
    k.box("farm_steel", [-0.05, 0, H - 0.015], [W - 0.25, 0.3, 0.025]);
    for (const s of [-1, 1]) {
      k.tube("farm_steel", [[-0.35 * s, -0.17, 0], [0.25 * s, -0.04, H - 0.03]], 0.01, 6);
      k.tube("farm_steel", [[-0.35 * s, 0.17, 0], [0.25 * s, 0.04, H - 0.03]], 0.01, 6);
      k.tube("farm_plastic_black", [[-0.35 * s, -0.19, 0.01], [-0.35 * s, 0.19, 0.01]], 0.014, 6);
    }
    k.rbox("farm_plastic_black", [-0.52, 0, H + 0.016], [0.08, 0.14, 0.012], 0.004);
    k.rbox("farm_chrome", [-0.52, 0, H + 0.06], [0.09, 0.12, 0.07], 0.02, { p: 0 });
    k.tube("farm_plastic_black", [[-0.52, -0.04, H + 0.1], [-0.52, -0.04, H + 0.14], [-0.52, 0.04, H + 0.14], [-0.52, 0.04, H + 0.1]], 0.01, 6);
  });

  def("farm_drying_rack", (k, e) => {
    const m = e.mat ?? "farm_pine", W = 0.8, H = 1.1;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) k.tube(m, [[sx * W / 2, sy * 0.28, 0], [sx * W / 2, sy * 0.06, H]], 0.014, 6);
    for (let i = 0; i < 4; i++) for (const sy of [-1, 1]) {
      const t = 0.3 + i * 0.22, y = sy * (0.28 - 0.22 * t);
      k.tube(m, [[-W / 2, y, H * t], [W / 2, y, H * t]], 0.008, 6);
    }
    // a towel and two dish cloths hanging on the rails
    [["farm_towel", -0.15, 0.96, 0.4], ["farm_gingham", 0.22, 0.74, 0.22], ["farm_linen", -0.2, 0.52, 0.25]].forEach(([tm, x, t, Lh]) => {
      const y = -(0.28 - 0.22 * t), z = H * t;
      k.sheet(tm, (u, v) => [x - 0.14 + u * 0.28, y + (v - 0.5) * 0.04, z + 0.005 - Math.abs(v - 0.5) * 2 * Lh], 4, 8, 1, 1);
    });
  });

  def("farm_umbrella_stand", (k, e) => {
    k.lathe("farm_galvanized", [0, 0, 0], [[0, 0], [0.11, 0], [0.11, 0.5], [0.12, 0.52], [0.1, 0.52], [0.1, 0.02], [0, 0.02]], 20);
    const cols = ["farm_cabinet_navy", "farm_door_red", "farm_plastic_black"];
    cols.forEach((m, i) => {
      const a = i * 2.1, tx = Math.cos(a) * 0.08, ty = Math.sin(a) * 0.08;
      k.lathe(m, [Math.cos(a) * 0.03, Math.sin(a) * 0.03, 0.05], [[0, 0], [0.035, 0.12], [0.05, 0.5], [0.03, 0.72], [0, 0.75]], 10);
      k.tube("farm_walnut", [[tx, ty, 0.78], [tx, ty, 0.88], [tx + 0.05, ty, 0.92], [tx + 0.08, ty, 0.88]], 0.01, 6);
    });
    k.tube("farm_walnut", [[-0.04, 0.05, 0.02], [-0.07, 0.07, 0.86], [-0.02, 0.08, 0.92]], 0.012, 6);
  });

  def("farm_shoe_cubby", (k, e) => {
    const W = e.length ?? 1.2, Dp = 0.34, H = 0.48, m = e.mat ?? "farm_cabinet_white";
    k.rbox(m, [0, 0, H - 0.015], [W, Dp, 0.03], 0.006);
    k.box(m, [0, 0, 0.015], [W, Dp, 0.03]);
    k.box(m, [0, Dp / 2 - 0.01, H / 2], [W, 0.02, H]);
    k.box(m, [0, 0, H / 2], [W, Dp - 0.02, 0.02]);
    const n = Math.max(2, Math.round(W / 0.3));
    for (let i = 0; i <= n; i++) k.box(m, [-W / 2 + 0.01 + (i * (W - 0.02)) / n, 0, H / 2], [0.02, Dp, H]);
    const r = k.rng;
    for (let i = 0; i < n; i++) for (const row of [0, 1]) {
      if (r.random() < 0.3) continue;
      const cx = -W / 2 + (W / n) * (i + 0.5), z = 0.03 + row * (H / 2 - 0.01);
      const sm = ["farm_leather", "farm_plastic_black", "farm_cabinet_navy", "farm_door_red"][Math.floor(r.uniform(0, 4))];
      for (const s of [-1, 1]) {
        k.rbox(sm, [cx + s * 0.05, -0.02, z + 0.035], [0.08, 0.25, 0.07], 0.03, { segments: 3 });
        k.box("farm_plastic_black", [cx + s * 0.05, -0.02, z + 0.006], [0.082, 0.26, 0.012]);
      }
    }
    if (e.cushion) cushion(k, e.cushion, [0, 0, H + 0.04], [W - 0.04, Dp - 0.02, 0.07], 0.03);
  });

  def("farm_towel_stack", (k, e) => {
    const n = e.count ?? 3, m = e.mat ?? "farm_towel";
    for (let i = 0; i < n; i++) cushion(k, i % 2 ? "farm_bedding" : m, [0, 0, 0.035 + i * 0.07], [0.36, 0.26, 0.07], 0.03, 0);
  });

  def("farm_bath_set", (k, e) => {
    // soap pump, a tooth mug with brushes and a small dish
    k.lathe("farm_ceramic", [-0.08, 0, 0], [[0, 0], [0.04, 0], [0.042, 0.12], [0.02, 0.135], [0, 0.135]], 16);
    k.tube("farm_chrome", [[-0.08, 0, 0.135], [-0.08, 0, 0.17], [-0.08, -0.04, 0.17]], 0.006, 6);
    k.lathe("farm_window_glass", [0.03, 0, 0], [[0, 0], [0.035, 0], [0.038, 0.1], [0, 0.1]], 14);
    for (let i = 0; i < 2; i++) k.tube(i ? "farm_wall_blue" : "farm_fruit", [[0.03 + (i - 0.5) * 0.015, 0, 0.02], [0.03 + (i - 0.5) * 0.04, 0.01, 0.18]], 0.005, 5);
    k.lathe("farm_ceramic", [0.13, 0, 0], [[0, 0], [0.05, 0], [0.06, 0.015], [0, 0.015]], 16);
    k.rbox("farm_bedding", [0.13, 0, 0.022], [0.07, 0.045, 0.02], 0.01);
  });

  def("farm_luggage_rack", (k, e) => {
    const m = e.mat ?? "farm_walnut";
    for (const sx of [-1, 1]) for (const d of [-1, 1]) k.tube(m, [[sx * 0.3, -d * 0.2, 0], [sx * 0.3, d * 0.2, 0.5]], 0.014, 6);
    for (const sy of [-1, 1]) k.tube(m, [[-0.33, sy * 0.2, 0.5], [0.33, sy * 0.2, 0.5]], 0.016, 6);
    for (const x of [-0.15, 0, 0.15]) k.box("farm_tweed", [x, 0, 0.5], [0.05, 0.42, 0.006]);
    if (e.suitcase !== false) {
      k.rbox("farm_leather", [0, 0, 0.62], [0.66, 0.42, 0.22], 0.03);
      k.box("farm_walnut", [0, 0, 0.62], [0.67, 0.43, 0.01]);
      for (const x of [-0.2, 0.2]) k.box("farm_walnut", [x, 0, 0.62], [0.04, 0.44, 0.23]);
      k.tube("farm_leather", [[-0.07, -0.215, 0.66], [-0.07, -0.24, 0.66], [0.07, -0.24, 0.66], [0.07, -0.215, 0.66]], 0.01, 6);
      for (const x of [-0.24, 0.24]) k.box("farm_brass", [x, -0.213, 0.7], [0.03, 0.006, 0.03]);
    }
  });

  // ------------------------------------------------------------------------------------------- kids
  def("farm_teddy", (k, e) => {
    const tb = e.mat ?? "farm_tweed", s = e.size ?? 1;
    const S = (v) => v.map((x) => x * s);
    k.ball(tb, S([0, 0, 0.1]), 0.1 * s, 12, 18);
    k.ball(tb, S([0, -0.01, 0.26]), 0.075 * s, 12, 18);
    for (const sx of [-1, 1]) {
      k.ball(tb, S([sx * 0.06, 0.0, 0.32]), 0.028 * s, 8, 10);
      k.ball(tb, S([sx * 0.1, -0.03, 0.12]), 0.038 * s, 8, 10);
      k.ball(tb, S([sx * 0.06, -0.08, 0.03]), 0.042 * s, 8, 10);
      k.ball("farm_plastic_black", S([sx * 0.025, -0.075, 0.28]), 0.009 * s, 6, 8);
    }
    k.ball(e.muzzle ?? "farm_linen", S([0, -0.075, 0.245]), 0.03 * s, 8, 10);
    k.ball("farm_plastic_black", S([0, -0.1, 0.255]), 0.01 * s, 6, 8);
    if (e.bow) k.box(e.bow, S([0, -0.07, 0.19]), [0.08 * s, 0.02 * s, 0.03 * s], 0, 0, 0);
  });

  def("farm_floor_toys", (k, e) => {
    const r = k.rng;
    // wooden train: engine and two cars on a figure of track
    const train = (x0, y0, h) => {
      const a = h * D, c = Math.cos(a), s = Math.sin(a);
      const P2 = (lx, ly, lz) => [x0 + lx * c - ly * s, y0 + lx * s + ly * c, lz];
      ["farm_door_red", "farm_cabinet_navy", "farm_fruit"].forEach((m, i) => {
        const x = i * 0.13;
        k.rbox(m, P2(x, 0, 0.04), [0.11, 0.06, 0.05], 0.008, { h });
        if (!i) {
          k.rbox(m, P2(x - 0.03, 0, 0.085), [0.05, 0.06, 0.05], 0.008, { h });
          k.cyl("farm_plastic_black", P2(x + 0.035, 0, 0.09), 0.012, 0.04, 8);
        }
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) k.cyl("farm_plastic_black", P2(x + sx * 0.035, sy * 0.034, 0.018), 0.017, 0.012, 10, true, [h + 90, 0, 90]);
      });
    };
    train(-0.3, 0.1, r.uniform(0, 360));
    // stacking rings
    k.cyl("farm_walnut", [0.3, -0.1, 0.01], 0.06, 0.02, 14);
    k.cyl("farm_walnut", [0.3, -0.1, 0.14], 0.01, 0.25, 8);
    ["farm_door_red", "farm_fruit", "farm_cabinet_sage", "farm_wall_blue"].forEach((m, i) => k.lathe(m, [0.3, -0.1, 0.02 + i * 0.04], [[0.012, 0], [0.055 - i * 0.008, 0.005], [0.06 - i * 0.008, 0.02], [0.055 - i * 0.008, 0.035], [0.012, 0.04]], 16));
    // blocks, scattered and a small tower
    for (let i = 0; i < 9; i++) {
      const tower = i < 4;
      const x = tower ? -0.05 : r.uniform(-0.45, 0.45), y = tower ? -0.25 : r.uniform(-0.35, 0.35);
      k.rbox(COVERS[i % COVERS.length], [x, y, 0.03 + (tower ? i * 0.06 : 0)], [0.06, 0.06, 0.06], 0.006, { h: r.uniform(0, 90) });
    }
    k.ball("farm_cabinet_sage", [0.1, 0.3, 0.1], 0.1, 12, 18);
  });

  def("farm_dollhouse", (k, e) => {
    const W = 0.7, Dp = 0.3, H = 0.55, m = e.mat ?? "farm_cabinet_white";
    // a two-storey house open at the front, gable roof, little furniture inside
    k.box(m, [0, Dp / 2 - 0.01, H / 2], [W, 0.02, H]);
    for (const s of [-1, 1]) k.box(m, [s * (W / 2 - 0.01), 0, H / 2], [0.02, Dp, H]);
    for (const z of [0.01, H / 2]) k.box("farm_oak_floor", [0, 0, z], [W - 0.02, Dp - 0.01, 0.02]);
    k.box(m, [0, 0, H / 2], [0.015, Dp, H]);
    for (const s of [-1, 1]) k.box("farm_shingle", [s * W / 4, 0, H + 0.12], [W / 2 + 0.06, Dp + 0.04, 0.02], 0, 0, s * -32);
    k.box("farm_wallpaper_floral", [-W / 4, Dp / 2 - 0.022, H * 0.27], [W / 2 - 0.04, 0.002, H / 2 - 0.04]);
    k.box("farm_wall_blue", [W / 4, Dp / 2 - 0.022, H * 0.75], [W / 2 - 0.04, 0.002, H / 2 - 0.04]);
    k.rbox("farm_door_red", [W / 4, 0.02, 0.06], [0.12, 0.06, 0.06], 0.01);
    k.rbox("farm_bedding", [-W / 4, 0.03, H / 2 + 0.04], [0.14, 0.08, 0.04], 0.01);
    k.box("farm_walnut", [-W / 4, 0.0, 0.07], [0.1, 0.06, 0.006]);
    for (const s of [-1, 1]) k.box("farm_walnut", [-W / 4 + s * 0.04, 0.0, 0.04], [0.006, 0.006, 0.06]);
  });

  def("farm_easel", (k, e) => {
    const m = e.mat ?? "farm_pine";
    for (const s of [-1, 1]) k.tube(m, [[s * 0.28, -0.12, 0], [s * 0.05, 0.0, 1.55]], 0.016, 6);
    k.tube(m, [[0, 0.5, 0], [0, 0.02, 1.4]], 0.016, 6);
    k.box(m, [0, -0.1, 0.72], [0.62, 0.07, 0.025]);
    k.box(m, [0, -0.085, 0.75], [0.62, 0.012, 0.04]);
    // canvas with a painting in progress, paint pots on the ledge
    k.box("farm_linen", [0, -0.055, 1.08], [0.55, 0.02, 0.62], 0, -4);
    picture(k, 0, -0.07, 1.08, 0.55, 0.62, "farm_art", e.cell ?? 0, "farm_pine");
    ["farm_door_red", "farm_wall_blue", "farm_fruit"].forEach((pm, i) => {
      k.lathe("farm_plastic_black", [-0.2 + i * 0.1, -0.1, 0.733], [[0, 0], [0.025, 0], [0.025, 0.04], [0, 0.04]], 10);
      k.cyl(pm, [-0.2 + i * 0.1, -0.1, 0.772], 0.022, 0.002, 10);
    });
  });

  def("farm_crib", (k, e) => {
    const W = 1.3, Dp = 0.7, m = e.mat ?? "farm_cabinet_white";
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) k.rbox(m, [sx * (W / 2 - 0.025), sy * (Dp / 2 - 0.025), 0.5], [0.05, 0.05, 1.0], 0.01);
    for (const sy of [-1, 1]) {
      k.rbox(m, [0, sy * (Dp / 2 - 0.025), 0.93], [W, 0.045, 0.05], 0.01);
      k.box(m, [0, sy * (Dp / 2 - 0.025), 0.3], [W, 0.04, 0.05]);
      for (let i = 1; i < 14; i++) k.cyl(m, [-W / 2 + (i * W) / 14, sy * (Dp / 2 - 0.025), 0.62], 0.011, 0.6, 8);
    }
    for (const sx of [-1, 1]) {
      k.box(m, [sx * (W / 2 - 0.025), 0, 0.3], [0.04, Dp, 0.05]);
      k.rbox(m, [sx * (W / 2 - 0.025), 0, 0.72], [0.035, Dp - 0.04, 0.5], 0.01);
    }
    cushion(k, "farm_bedding", [0, 0, 0.4], [W - 0.08, Dp - 0.08, 0.1], 0.03);
    k.sheet("farm_quilt", (u, v) => [-W / 2 + 0.1 + u * 0.7, -Dp / 2 + 0.06 + v * (Dp - 0.12), 0.455 + 0.012 * Math.sin(u * 9) * Math.sin(v * 7)], 8, 6, 1, 1, false);
    put(k, "farm_teddy", 0.38, 0.05, 0.45, 160, { size: 0.7, mat: "farm_linen" });
    // a mobile over the head end
    k.tube(m, [[W / 2 - 0.03, Dp / 2 - 0.03, 0.95], [W / 2 - 0.03, Dp / 2 - 0.03, 1.4], [W / 2 - 0.3, 0, 1.45]], 0.008, 6);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * 2 * Math.PI, px = W / 2 - 0.3 + Math.cos(a) * 0.14, py = Math.sin(a) * 0.14;
      k.tube("farm_paper", [[W / 2 - 0.3, 0, 1.45], [px, py, 1.42], [px, py, 1.3]], 0.002, 3);
      k.ball(COVERS[i], [px, py, 1.27], 0.035, 8, 10);
    }
  });

  // -------------------------------------------------------------------------------- fixtures on walls
  def("farm_radiator", (k, e) => {
    // a cast-iron column radiator standing in front of the wall (base at the wall face, under a window)
    const W = e.length ?? 0.9, H = e.height ?? 0.62, m = e.mat ?? "farm_trim";
    const cols = Math.max(4, Math.round(W / 0.065)), y = -0.1;
    for (let i = 0; i < cols; i++) {
      const x = -W / 2 + (W / cols) * (i + 0.5);
      k.box(m, [x, y, 0.1 + (H - 0.1) / 2], [0.045, 0.16, H - 0.1]);
    }
    for (const z of [0.12, H - 0.04]) k.cyl(m, [0, y, z], 0.025, W, 8, true, [0, 0, 90]);
    for (const s of [-1, 1]) k.rbox(m, [s * (W / 2 - 0.04), y, 0.05], [0.06, 0.18, 0.1], 0.01);
    k.tube("farm_brass", [[-W / 2 - 0.02, y, 0.12], [-W / 2 - 0.1, y, 0.12], [-W / 2 - 0.1, y, 0]], 0.014, 8);
    k.lathe("farm_brass", [-W / 2 - 0.1, y, 0.14], [[0.02, 0], [0.025, 0.03], [0.012, 0.05], [0.03, 0.06], [0.03, 0.08], [0, 0.085]], 10);
  });

  def("farm_ceiling_fan", (k, e) => {
    const drop = e.drop ?? 0.35, m = e.mat ?? "farm_iron";
    k.lathe(m, [0, 0, -0.06], [[0.08, 0], [0.08, 0.02], [0.03, 0.06], [0, 0.06]], 20);
    k.cyl(m, [0, 0, -drop / 2], 0.012, drop, 8);
    k.lathe(m, [0, 0, -drop - 0.12], [[0, 0], [0.09, 0.0], [0.13, 0.04], [0.13, 0.08], [0.09, 0.12], [0, 0.12]], 24);
    const blades = e.blades ?? 5, R = e.radius ?? 0.65, ph = e.phase ?? 10;
    for (let i = 0; i < blades; i++) {
      const a = ((i / blades) * 360 + ph) * D, c = Math.cos(a), s = Math.sin(a);
      k.tube(m, [[c * 0.12, s * 0.12, -drop - 0.07], [c * 0.2, s * 0.2, -drop - 0.06]], 0.008, 5);
      k.rbox(e.blade_mat ?? "farm_walnut", [c * (0.2 + R / 2 - 0.05), s * (0.2 + R / 2 - 0.05), -drop - 0.055], [R - 0.1, 0.14, 0.008], 0.004, { h: i * (360 / blades) + ph, r: 0 });
    }
    k.lathe("farm_lampshade", [0, 0, -drop - 0.26], [[0, 0], [0.08, 0.02], [0.11, 0.08], [0.11, 0.14], [0, 0.14]], 20);
    k.ball("farm_bulb", [0, 0, -drop - 0.2], 0.035, 6, 10);
    k.tube("farm_brass", [[0.03, 0, -drop - 0.26], [0.03, 0, -drop - 0.36]], 0.002, 3);
  });

  def("farm_wall_shelf", (k, e) => {
    // a floating plank on iron brackets (base at the wall face, at the shelf's height)
    const W = e.length ?? 1.0, Dp = 0.22, m = e.mat ?? "farm_walnut";
    k.rbox(m, [0, -Dp / 2, 0.015], [W, Dp, 0.03], 0.006);
    for (const s of [-1, 1]) k.tube("farm_iron", [[s * (W / 2 - 0.12), -0.005, -0.18], [s * (W / 2 - 0.12), -0.005, 0], [s * (W / 2 - 0.12), -Dp + 0.03, 0]], 0.008, 5);
    const items = e.items ?? ["books", "jar", "plant", "frame"];
    let x = -W / 2 + 0.05;
    const slot = (W - 0.1) / items.length;
    for (const it of items) {
      const cx = x + slot / 2;
      if (it === "books") books(k, x, x + slot, -Dp / 2, 0.03, 0.22, false);
      else if (it === "jar") for (let j = 0; j < 2; j++) {
        k.lathe("farm_window_glass", [cx - 0.05 + j * 0.1, -Dp / 2, 0.03], [[0, 0], [0.04, 0], [0.04, 0.13 + j * 0.03], [0.03, 0.15 + j * 0.03], [0, 0.15 + j * 0.03]], 14);
        k.lathe(j ? "farm_wheat" : "farm_apple", [cx - 0.05 + j * 0.1, -Dp / 2, 0.035], [[0, 0], [0.036, 0], [0.036, 0.08 + j * 0.02], [0, 0.08 + j * 0.02]], 12);
        k.lathe("farm_brass", [cx - 0.05 + j * 0.1, -Dp / 2, 0.18 + j * 0.03], [[0.032, 0], [0.032, 0.015], [0, 0.015]], 12);
      }
      else if (it === "plant") put(k, "farm_plant", cx, -Dp / 2, 0.03, 0, { kind: "trailing", size: 0.55, pot: "farm_ceramic" });
      else if (it === "frame") picture(k, cx, -0.03, 0.2, 0.18, 0.24, "farm_photo", e.cell ?? 4, "farm_trim");
      else if (it === "mugs") for (let j = 0; j < 3; j++) put(k, "farm_mug", cx - 0.08 + j * 0.08, -Dp / 2, 0.03, j * 40, { mat: ["farm_ceramic", "farm_cabinet_navy", "farm_cabinet_sage"][j] });
      else if (it === "towels") put(k, "farm_towel_stack", cx, -Dp / 2, 0.03, 0, { count: 2 });
      else if (it === "bath") put(k, "farm_bath_set", cx, -Dp / 2, 0.03);
      else if (it === "toys") put(k, "farm_teddy", cx, -Dp / 2, 0.03, 0, { size: 0.6 });
      x += slot;
    }
  });

  def("farm_wall_mirror", (k, e) => {
    const [W, H] = e.size ?? [0.6, 0.8], m = e.frame ?? "farm_brass";
    if (e.round) {
      const R = W / 2;
      k.lathe(m, [0, -0.01, 0], [[R + 0.04, 0], [R + 0.045, 0.02], [R + 0.02, 0.035], [R, 0.03], [R, 0]], 36, { axis: "-y" });
      k.cyl("farm_mirror", [0, -0.02, 0], R, 0.006, 36, true, [0, 90, 0]);
    } else {
      for (const s of [-1, 1]) {
        k.rbox(m, [s * (W / 2 - 0.025), -0.015, 0], [0.05, 0.03, H], 0.008);
        k.rbox(m, [0, -0.015, s * (H / 2 - 0.025)], [W, 0.03, 0.05], 0.008);
      }
      k.box("farm_mirror", [0, -0.012, 0], [W - 0.08, 0.006, H - 0.08]);
    }
  });

  def("farm_fire_tools", (k, e) => {
    k.lathe("farm_iron", [0, 0, 0], [[0, 0], [0.12, 0], [0.12, 0.015], [0.02, 0.03], [0, 0.03]], 18);
    k.cyl("farm_iron", [0, 0, 0.36], 0.008, 0.66, 8);
    k.tube("farm_iron", ring(0, 0, 0.66, 0.06, 0.06, 12), 0.005, 4);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * 2 * Math.PI, x = Math.cos(a) * 0.06, y = Math.sin(a) * 0.06;
      k.tube("farm_iron", [[x, y, 0.06], [x, y, 0.7]], 0.006, 5);
      k.ball("farm_brass", [x, y, 0.72], 0.015, 6, 8);
      if (i === 0) k.box("farm_iron", [x, y, 0.08], [0.1, 0.006, 0.1]);
      if (i === 1) k.tube("farm_iron", [[x, y, 0.06], [x + 0.04, y, 0.1]], 0.005, 4);
    }
    // a basket of split logs beside the stand
    put(k, "farm_basket", 0.45, 0, 0, 0, { size: [0.5, 0.4, 0.3], contents: "logs" });
  });
}
