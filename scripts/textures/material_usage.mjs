// Surface area per material in every baked map GLB (plus how many maps use it): the order to replace materials in.
// World-space area is the proxy for screen area. "play" counts only triangles inside the map bounds (+5 m): the
// distant backdrop terrain is huge in area but only ever seen far away, so rank by "play".
//
//   node scripts/textures/material_usage.mjs [--json out.json]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLIENT = path.join(ROOT, "client", "dist");
const ga = JSON.parse(fs.readFileSync(path.join(CLIENT, "game-assets.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(CLIENT, ga.manifest.replace(/^\//, "")), "utf8"));

function readGLB(file) {
  const b = fs.readFileSync(file);
  const jl = b.readUInt32LE(12);
  const json = JSON.parse(b.subarray(20, 20 + jl).toString());
  const binStart = 20 + jl + 8;
  return { json, bin: b.subarray(binStart) };
}
function accessor(g, i) {
  const a = g.json.accessors[i], v = g.json.bufferViews[a.bufferView];
  const off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type] * a.count;
  const T = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array, 5121: Uint8Array }[a.componentType];
  const buf = g.bin.buffer.slice(g.bin.byteOffset + off, g.bin.byteOffset + off + n * T.BYTES_PER_ELEMENT);
  return new T(buf);
}

const usage = {};
for (const [key, entry] of Object.entries(manifest.maps)) {
  const [bmin, bmax] = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "maps", `${key}.json`), "utf8")).bounds;
  const inPlay = (x, y) => x > bmin[0] - 5 && x < bmax[0] + 5 && y > bmin[1] - 5 && y < bmax[1] + 5;
  const g = readGLB(path.join(CLIENT, entry.geometry.replace(/^\//, "")));
  for (const mesh of g.json.meshes) {
    for (const p of mesh.primitives) {
      const name = g.json.materials[p.material]?.name ?? "?";
      const pos = accessor(g, p.attributes.POSITION), idx = accessor(g, p.indices);
      let area = 0, play = 0;
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
        const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
        const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
        const A = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
        area += A;
        if (inPlay((pos[a] + pos[b] + pos[c]) / 3, (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3)) play += A;
      }
      const u = (usage[name] ??= { area: 0, play: 0, tris: 0, maps: {} });
      u.area += area;
      u.play += play;
      u.tris += idx.length / 3;
      u.maps[key] = Math.round((u.maps[key] ?? 0) + play);
    }
  }
}
const rows = Object.entries(usage).sort((a, b) => b[1].play - a[1].play);
console.log("rank  material                      play m2  total m2     tris  maps (play m2)");
rows.forEach(([n, u], i) => console.log(`${String(i + 1).padStart(4)}  ${n.padEnd(28)} ${String(Math.round(u.play)).padStart(8)} ${String(Math.round(u.area)).padStart(9)} ${String(u.tris).padStart(8)}  ${Object.entries(u.maps).map(([k, a]) => `${k}:${a}`).join(" ")}`));
const out = process.argv.indexOf("--json");
if (out > 0) fs.writeFileSync(process.argv[out + 1], JSON.stringify(Object.fromEntries(rows), null, 1));
