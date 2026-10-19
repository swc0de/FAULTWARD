import { exec } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const say = (m) => process.stderr.write(`${m}\n`);
const arg = process.argv[2];

function env() {
  const out = { ...process.env };
  try {
    for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && !(m[1] in process.env)) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* no .env: defaults */ }
  return out;
}

function free(host, port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(port, host, () => s.close(() => resolve(true)));
  });
}

async function port() {
  const e = env();
  const host = e.HOST || "127.0.0.1", want = Number(e.PORT || 5000);
  if (await free(host, want)) { process.stdout.write(`${want}\n`); return 0; }
  for (let p = want + 1; p < want + 100; p++) {
    if (await free(host, p)) {
      say(`[!!] port ${want} is in use by another program; using ${p} this time (set PORT in .env to choose).`);
      process.stdout.write(`${p}\n`);
      return 0;
    }
  }
  say(`[!!] no free port near ${want}`);
  return 1;
}

async function open(p) {
  if (process.env.COLD_SECTOR_NO_BROWSER === "1") return 0;
  const url = `http://127.0.0.1:${p}/`;
  const until = Date.now() + 10 * 60 * 1000;
  while (Date.now() < until) {
    try {
      const r = await fetch(`${url}healthz`);
      if (r.ok) {
        const health=await r.json();
        if(health.release==='faultward-fullscreen-r10')break;
        say('The selected port is running a different game build. Restart this launcher to select a free port.');
        return 1;
      }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd);
  return 0;
}

const code = arg === "--port" ? await port() : arg === "--open" ? await open(process.argv[3] || "5000") : 1;
process.exit(code);
