import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);

// server/src/main.ts
import Fastify from "fastify";

// server/src/config.ts
import { randomBytes } from "node:crypto";
import fs2 from "node:fs";
import path2 from "node:path";

// server/src/paths.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
function findRoot() {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, "data", "maps")) && fs.existsSync(path.join(dir, "package.json"))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}
var ROOT = findRoot();
var DATA_DIR = path.join(ROOT, "data");
var MAPS_DIR = path.join(DATA_DIR, "maps");
var USER_DIR = process.env.USER_DIR ? path.resolve(process.env.USER_DIR) : path.join(ROOT, "user");
var CACHE_DIR = path.join(USER_DIR, "cache");
var CLIENT_DIST = path.join(ROOT, "client", "dist");
var TEMPLATES_DIR = path.join(ROOT, "server", "templates");
var STATIC_DIR = path.join(ROOT, "server", "static");
function mapPath(name) {
  return path.join(MAPS_DIR, `${name === "border" ? "qalat" : name}.json`);
}
var MAP_ORDER = ["qalat", "bazaar", "oilcamp", "farmhouse"];
function availableMaps() {
  try {
    const keys = fs.readdirSync(MAPS_DIR).filter((f) => f.endsWith(".json") && f !== "border.json").map((f) => f.slice(0, -5));
    const rank = (k) => {
      const i = MAP_ORDER.indexOf(k);
      return i < 0 ? MAP_ORDER.length : i;
    };
    return keys.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  } catch {
    return [];
  }
}
var mapInfoCache = null;
function mapInfo() {
  if (mapInfoCache) return mapInfoCache;
  const out = {};
  for (const key of availableMaps()) {
    try {
      const d = JSON.parse(fs.readFileSync(mapPath(key), "utf8"));
      out[key] = { name: String(d.name ?? key), description: String(d.description ?? ""), briefing: d.briefing ?? {} };
    } catch {
      out[key] = { name: key, description: "", briefing: {} };
    }
  }
  return mapInfoCache = out;
}

// server/src/config.ts
function loadDotEnv(file = path2.join(ROOT, ".env")) {
  let text2;
  try {
    text2 = fs2.readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const raw2 of text2.split(/\r?\n/)) {
    const line3 = raw2.trim();
    if (!line3 || line3.startsWith("#")) continue;
    const eq2 = line3.indexOf("=");
    if (eq2 < 1) continue;
    const key = line3.slice(0, eq2).trim();
    let value2 = line3.slice(eq2 + 1).trim();
    if (value2.startsWith('"') && value2.endsWith('"') || value2.startsWith("'") && value2.endsWith("'")) value2 = value2.slice(1, -1);
    if (process.env[key] === void 0) process.env[key] = value2;
  }
}
var env = (name, def = "") => (process.env[name] ?? def).trim();
var bool = (name, def) => {
  const v = process.env[name];
  return v === void 0 || v.trim() === "" ? def : ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
};
var int = (name, def) => {
  const v = Number.parseInt(env(name), 10);
  return Number.isFinite(v) ? v : def;
};
var origin = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
};
function loadConfig() {
  loadDotEnv();
  fs2.mkdirSync(USER_DIR, { recursive: true });
  let secret = env("SECRET_KEY");
  if (!secret) {
    const keyFile = path2.join(USER_DIR, "secret_key");
    try {
      secret = fs2.readFileSync(keyFile, "utf8").trim();
    } catch {
      secret = "";
    }
    if (!secret) {
      secret = randomBytes(32).toString("hex");
      fs2.writeFileSync(keyFile, secret, { mode: 384 });
    }
  }
  const trusted = env("TRUSTED_PROXY", "none").toLowerCase();
  if (!["none", "cloudflare", "local"].includes(trusted)) throw new Error(`TRUSTED_PROXY must be none, cloudflare or local, not ${trusted}`);
  const ips = env("CLOUDFLARE_IPS").split(",").map((s) => s.trim()).filter(Boolean);
  const siteUrl = env("SITE_URL").replace(/\/+$/, "");
  const behindHttps = trusted === "cloudflare" || siteUrl.startsWith("https://");
  const allowed = env("ALLOWED_ORIGINS").split(",").map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean);
  if (siteUrl && origin(siteUrl)) allowed.push(origin(siteUrl));
  return {
    secretKey: secret,
    databaseUrl: env("DATABASE_URL"),
    host: env("HOST", "127.0.0.1") || "127.0.0.1",
    port: int("PORT", 5e3),
    siteUrl,
    trustedProxy: trusted,
    cloudflareIps: ips.length ? ips : null,
    cookieSecure: bool("SESSION_COOKIE_SECURE", behindHttps),
    allowedOrigins: allowed,
    tickRate: int("TICK_RATE", 64),
    snapshotRate: int("SNAPSHOT_RATE", 32),
    interpMs: int("INTERP_MS", 100),
    maxMatches: int("MAX_MATCHES", 4),
    loginAttempts: int("LOGIN_ATTEMPTS", 5),
    serversFile: process.env.SERVERS_FILE !== void 0 ? env("SERVERS_FILE") : path2.join(ROOT, "data", "servers.json"),
    duelSpectatorDelay: Number.parseFloat(env("DUEL_SPECTATOR_DELAY", "10")) || 10,
    devFastRounds: bool("DEV_FAST_ROUNDS", false),
    pingInterval: int("WS_PING_SECONDS", 20),
    autostartServers: bool("AUTOSTART_SERVERS", false)
  };
}

// server/src/web/db.ts
import path3 from "node:path";
import Database from "better-sqlite3";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { bigint, boolean, doublePrecision, integer as pgInt, pgTable, serial, text as pgText, uniqueIndex as pgUnique } from "drizzle-orm/pg-core";
import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
var sqlite = {
  users: sqliteTable("users", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    username: text("username").notNull(),
    usernameKey: text("username_key").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    created: integer("created").notNull(),
    lastLogin: integer("last_login"),
    isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
    bannedUntil: integer("banned_until"),
    banReason: text("ban_reason").notNull().default(""),
    settingsJson: text("settings_json").notNull().default("{}")
  }),
  matches: sqliteTable("matches", {
    id: text("id").primaryKey(),
    mode: text("mode").notNull().default("bots"),
    ranked: integer("ranked", { mode: "boolean" }).notNull().default(false),
    map: text("map").notNull(),
    title: text("title").notNull().default(""),
    createdBy: integer("created_by"),
    created: integer("created").notNull(),
    ended: integer("ended"),
    status: text("status").notNull().default("running"),
    endReason: text("end_reason").notNull().default(""),
    resultJson: text("result_json").notNull().default("{}")
  }),
  matchPlayers: sqliteTable("match_players", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    matchId: text("match_id").notNull(),
    userId: integer("user_id").notNull(),
    team: integer("team"),
    kills: integer("kills").notNull().default(0),
    deaths: integer("deaths").notNull().default(0),
    assists: integer("assists").notNull().default(0),
    damage: integer("damage").notNull().default(0),
    headshots: integer("headshots").notNull().default(0),
    rounds: integer("rounds").notNull().default(0),
    won: integer("won", { mode: "boolean" })
  }, (t) => [uniqueIndex("match_players_match_user").on(t.matchId, t.userId)]),
  ratings: sqliteTable("ratings", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull(),
    mode: text("mode").notNull().default("duel"),
    rating: real("rating").notNull().default(1500),
    rd: real("rd").notNull().default(350),
    volatility: real("volatility").notNull().default(0.06),
    games: integer("games").notNull().default(0),
    updated: integer("updated").notNull()
  }, (t) => [uniqueIndex("ratings_user_mode").on(t.userId, t.mode)]),
  ratingChanges: sqliteTable("rating_changes", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull(),
    matchId: text("match_id").notNull(),
    mode: text("mode").notNull().default("duel"),
    opponentId: integer("opponent_id"),
    before: real("before").notNull(),
    after: real("after").notNull(),
    rdAfter: real("rd_after").notNull(),
    score: real("score").notNull(),
    created: integer("created").notNull()
  })
};
var ms = (name) => bigint(name, { mode: "number" });
var pg = {
  users: pgTable("users", {
    id: serial("id").primaryKey(),
    username: pgText("username").notNull(),
    usernameKey: pgText("username_key").notNull().unique(),
    passwordHash: pgText("password_hash").notNull(),
    created: ms("created").notNull(),
    lastLogin: ms("last_login"),
    isAdmin: boolean("is_admin").notNull().default(false),
    bannedUntil: ms("banned_until"),
    banReason: pgText("ban_reason").notNull().default(""),
    settingsJson: pgText("settings_json").notNull().default("{}")
  }),
  matches: pgTable("matches", {
    id: pgText("id").primaryKey(),
    mode: pgText("mode").notNull().default("bots"),
    ranked: boolean("ranked").notNull().default(false),
    map: pgText("map").notNull(),
    title: pgText("title").notNull().default(""),
    createdBy: pgInt("created_by"),
    created: ms("created").notNull(),
    ended: ms("ended"),
    status: pgText("status").notNull().default("running"),
    endReason: pgText("end_reason").notNull().default(""),
    resultJson: pgText("result_json").notNull().default("{}")
  }),
  matchPlayers: pgTable("match_players", {
    id: serial("id").primaryKey(),
    matchId: pgText("match_id").notNull(),
    userId: pgInt("user_id").notNull(),
    team: pgInt("team"),
    kills: pgInt("kills").notNull().default(0),
    deaths: pgInt("deaths").notNull().default(0),
    assists: pgInt("assists").notNull().default(0),
    damage: pgInt("damage").notNull().default(0),
    headshots: pgInt("headshots").notNull().default(0),
    rounds: pgInt("rounds").notNull().default(0),
    won: boolean("won")
  }, (t) => [pgUnique("match_players_match_user").on(t.matchId, t.userId)]),
  ratings: pgTable("ratings", {
    id: serial("id").primaryKey(),
    userId: pgInt("user_id").notNull(),
    mode: pgText("mode").notNull().default("duel"),
    rating: doublePrecision("rating").notNull().default(1500),
    rd: doublePrecision("rd").notNull().default(350),
    volatility: doublePrecision("volatility").notNull().default(0.06),
    games: pgInt("games").notNull().default(0),
    updated: ms("updated").notNull()
  }, (t) => [pgUnique("ratings_user_mode").on(t.userId, t.mode)]),
  ratingChanges: pgTable("rating_changes", {
    id: serial("id").primaryKey(),
    userId: pgInt("user_id").notNull(),
    matchId: pgText("match_id").notNull(),
    mode: pgText("mode").notNull().default("duel"),
    opponentId: pgInt("opponent_id"),
    before: doublePrecision("before").notNull(),
    after: doublePrecision("after").notNull(),
    rdAfter: doublePrecision("rd_after").notNull(),
    score: doublePrecision("score").notNull(),
    created: ms("created").notNull()
  })
};
var DDL_SQLITE = `
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, username_key TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, created INTEGER NOT NULL, last_login INTEGER, is_admin INTEGER NOT NULL DEFAULT 0, banned_until INTEGER,
  ban_reason TEXT NOT NULL DEFAULT '', settings_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'bots', ranked INTEGER NOT NULL DEFAULT 0, map TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '', created_by INTEGER, created INTEGER NOT NULL, ended INTEGER, status TEXT NOT NULL DEFAULT 'running',
  end_reason TEXT NOT NULL DEFAULT '', result_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS match_players (id INTEGER PRIMARY KEY AUTOINCREMENT, match_id TEXT NOT NULL, user_id INTEGER NOT NULL, team INTEGER,
  kills INTEGER NOT NULL DEFAULT 0, deaths INTEGER NOT NULL DEFAULT 0, assists INTEGER NOT NULL DEFAULT 0, damage INTEGER NOT NULL DEFAULT 0,
  headshots INTEGER NOT NULL DEFAULT 0, rounds INTEGER NOT NULL DEFAULT 0, won INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS match_players_match_user ON match_players (match_id, user_id);
CREATE INDEX IF NOT EXISTS match_players_user ON match_players (user_id);
CREATE TABLE IF NOT EXISTS ratings (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, mode TEXT NOT NULL DEFAULT 'duel',
  rating REAL NOT NULL DEFAULT 1500, rd REAL NOT NULL DEFAULT 350, volatility REAL NOT NULL DEFAULT 0.06, games INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS ratings_user_mode ON ratings (user_id, mode);
CREATE TABLE IF NOT EXISTS rating_changes (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, match_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'duel', opponent_id INTEGER, before REAL NOT NULL, after REAL NOT NULL, rd_after REAL NOT NULL, score REAL NOT NULL,
  created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS rating_changes_user ON rating_changes (user_id);
`;
var DDL_PG = `
CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username TEXT NOT NULL, username_key TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  created BIGINT NOT NULL, last_login BIGINT, is_admin BOOLEAN NOT NULL DEFAULT FALSE, banned_until BIGINT, ban_reason TEXT NOT NULL DEFAULT '',
  settings_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'bots', ranked BOOLEAN NOT NULL DEFAULT FALSE, map TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '', created_by INTEGER, created BIGINT NOT NULL, ended BIGINT, status TEXT NOT NULL DEFAULT 'running',
  end_reason TEXT NOT NULL DEFAULT '', result_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS match_players (id SERIAL PRIMARY KEY, match_id TEXT NOT NULL, user_id INTEGER NOT NULL, team INTEGER,
  kills INTEGER NOT NULL DEFAULT 0, deaths INTEGER NOT NULL DEFAULT 0, assists INTEGER NOT NULL DEFAULT 0, damage INTEGER NOT NULL DEFAULT 0,
  headshots INTEGER NOT NULL DEFAULT 0, rounds INTEGER NOT NULL DEFAULT 0, won BOOLEAN);
CREATE UNIQUE INDEX IF NOT EXISTS match_players_match_user ON match_players (match_id, user_id);
CREATE INDEX IF NOT EXISTS match_players_user ON match_players (user_id);
CREATE TABLE IF NOT EXISTS ratings (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, mode TEXT NOT NULL DEFAULT 'duel',
  rating DOUBLE PRECISION NOT NULL DEFAULT 1500, rd DOUBLE PRECISION NOT NULL DEFAULT 350, volatility DOUBLE PRECISION NOT NULL DEFAULT 0.06,
  games INTEGER NOT NULL DEFAULT 0, updated BIGINT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS ratings_user_mode ON ratings (user_id, mode);
CREATE TABLE IF NOT EXISTS rating_changes (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, match_id TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'duel',
  opponent_id INTEGER, before DOUBLE PRECISION NOT NULL, after DOUBLE PRECISION NOT NULL, rd_after DOUBLE PRECISION NOT NULL,
  score DOUBLE PRECISION NOT NULL, created BIGINT NOT NULL);
CREATE INDEX IF NOT EXISTS rating_changes_user ON rating_changes (user_id);
`;
function userSettings(u) {
  try {
    const v = JSON.parse(u.settingsJson || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
var isBanned = (u, now2 = Date.now()) => u.bannedUntil !== null && u.bannedUntil > now2;
var Repo = class {
  constructor(db, t, dialect, closeFn) {
    this.db = db;
    this.t = t;
    this.dialect = dialect;
    this.closeFn = closeFn;
  }
  close() {
    return this.closeFn();
  }
  async one(q) {
    return (await q)[0] ?? null;
  }
  // ------------------------------------------------------------- users
  userById(id) {
    return this.one(this.db.select().from(this.t.users).where(eq(this.t.users.id, id)).limit(1));
  }
  userByName(name) {
    return this.one(this.db.select().from(this.t.users).where(eq(this.t.users.usernameKey, name.toLowerCase())).limit(1));
  }
  async createUser(username, passwordHash) {
    const rows = await this.db.insert(this.t.users).values({
      username,
      usernameKey: username.toLowerCase(),
      passwordHash,
      created: Date.now(),
      settingsJson: "{}",
      banReason: "",
      isAdmin: false
    }).returning();
    return rows[0];
  }
  async updateUser(id, values) {
    await this.db.update(this.t.users).set(values).where(eq(this.t.users.id, id));
  }
  // ----------------------------------------------------------- matches
  async createMatch(row) {
    await this.db.insert(this.t.matches).values({ ...row, created: Date.now(), status: "running", endReason: "", resultJson: "{}" });
  }
  matchById(id) {
    return this.one(this.db.select().from(this.t.matches).where(eq(this.t.matches.id, id)).limit(1));
  }
  async updateMatch(id, values) {
    await this.db.update(this.t.matches).set(values).where(eq(this.t.matches.id, id));
  }
  async closeMatch(id, reason) {
    const m = await this.matchById(id);
    if (!m || m.ended !== null) return;
    const error = reason.startsWith("error") || reason.startsWith("worker");
    await this.updateMatch(id, { ended: Date.now(), status: error ? "error" : "ended", endReason: reason.slice(0, 200) });
  }
  async upsertMatchPlayer(row) {
    const t = this.t.matchPlayers;
    const old = await this.one(this.db.select().from(t).where(and(eq(t.matchId, row.matchId), eq(t.userId, row.userId))).limit(1));
    if (old) await this.db.update(t).set(row).where(eq(t.id, old.id));
    else await this.db.insert(t).values(row);
  }
  // ----------------------------------------------------------- ratings
  async ratingOf(userId, mode = "duel") {
    const t = this.t.ratings;
    const r = await this.one(this.db.select().from(t).where(and(eq(t.userId, userId), eq(t.mode, mode))).limit(1));
    if (r) return r;
    const rows = await this.db.insert(t).values({ userId, mode, rating: 1500, rd: 350, volatility: 0.06, games: 0, updated: Date.now() }).returning();
    return rows[0];
  }
  findRating(userId, mode = "duel") {
    const t = this.t.ratings;
    return this.one(this.db.select().from(t).where(and(eq(t.userId, userId), eq(t.mode, mode))).limit(1));
  }
  async saveRating(r) {
    await this.db.update(this.t.ratings).set({ rating: r.rating, rd: r.rd, volatility: r.volatility, games: r.games, updated: r.updated }).where(eq(this.t.ratings.id, r.id));
  }
  async addRatingChange(row) {
    await this.db.insert(this.t.ratingChanges).values({ ...row, mode: "duel", created: Date.now() });
  }
  ratingHistory(userId) {
    const t = this.t.ratingChanges;
    return this.db.select().from(t).where(eq(t.userId, userId)).orderBy(asc(t.created), asc(t.id));
  }
  playerMatches(userId) {
    const mp = this.t.matchPlayers, m = this.t.matches;
    return this.db.select({ mp, m }).from(mp).innerJoin(m, eq(mp.matchId, m.id)).where(eq(mp.userId, userId)).orderBy(desc(m.ended));
  }
  leaderboard(limit = 50) {
    const r = this.t.ratings, u = this.t.users;
    return this.db.select({ r, u }).from(r).innerJoin(u, eq(r.userId, u.id)).where(and(eq(r.mode, "duel"), gt(r.games, 0))).orderBy(desc(r.rating)).limit(limit);
  }
};
async function openDb(url, log2 = console.log) {
  if (/^postgres(ql)?:\/\//.test(url)) {
    const { default: pgmod } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pool = new pgmod.Pool({ connectionString: url, max: 10 });
    await pool.query(DDL_PG);
    log2("[db] postgres");
    return new Repo(drizzle(pool), pg, "postgres", () => pool.end());
  }
  const file = url ? url.replace(/^sqlite:(\/\/\/?)?/, "") : path3.join(USER_DIR, "web.db");
  const conn = new Database(file);
  conn.pragma("journal_mode = WAL");
  conn.pragma("busy_timeout = 5000");
  conn.exec(DDL_SQLITE);
  log2(`[db] sqlite ${file}`);
  return new Repo(drizzleSqlite(conn), sqlite, "sqlite", async () => {
    conn.close();
  });
}

// server/src/web/gateway.ts
import { randomInt as randomInt2 } from "node:crypto";

// shared/src/commands.ts
var HOLD_ACTIONS = [
  "fire",
  "aim",
  "jump",
  "crouch",
  "walk",
  "lean_left",
  "lean_right",
  "use",
  "reload",
  "inspect",
  "gadget",
  "charge",
  "observe",
  "ping",
  "drop"
];
var PRESS_ACTIONS = ["slot1", "slot2", "slot3", "slot4", "slot5", "last_weapon", "wheel_up", "wheel_down"];
var ACTIONS = [...HOLD_ACTIONS, ...PRESS_ACTIONS];
var BIT = {};
ACTIONS.forEach((a, i) => {
  BIT[a] = 1 << i;
});
var ALL_MASK = (1 << ACTIONS.length) - 1;
var HOLD_MASK = (1 << HOLD_ACTIONS.length) - 1;
var WIRE_SIZE = 23;

// shared/src/codec.ts
var POS = 256;
var VEL = 256;
var YAW = 65536 / 360;
var PITCH = 100;
var F = (name, type, count = 1, scale = 1) => ({ name, type, count, scale });
var KIND_SOLDIER = 1;
var KIND_GRENADE = 2;
var KIND_SMOKE = 3;
var KIND_BOMB = 4;
var KIND_PICKUP = 5;
var KIND_GADGET = 6;
var KIND_DRONE = 7;
var KINDS = {
  [KIND_SOLDIER]: { name: "soldier", fields: [
    F("pos", "h", 3, POS),
    F("vel", "h", 3, VEL),
    F("yaw", "H", 1, YAW),
    F("pitch", "h", 1, PITCH),
    F("flags", "H"),
    F("height", "B", 1, 100),
    F("lean", "b", 1, 127),
    F("item", "B"),
    F("team", "B"),
    F("health", "B"),
    F("armor", "B"),
    F("event", "B")
    // animation event counter: reload / switch / throw / knife / hit (low bits kind)
  ] },
  [KIND_GRENADE]: { name: "grenade", fields: [F("pos", "h", 3, POS), F("vel", "h", 3, VEL), F("item", "B")] },
  [KIND_SMOKE]: { name: "smoke", fields: [F("pos", "h", 3, POS), F("radius", "B", 1, 10), F("age", "H", 1, 100), F("duration", "B")] },
  [KIND_BOMB]: { name: "bomb", fields: [F("state", "B"), F("pos", "h", 3, POS)] },
  [KIND_PICKUP]: { name: "pickup", fields: [F("pos", "h", 3, POS), F("yaw", "H", 1, YAW), F("item", "B")] },
  [KIND_GADGET]: { name: "gadget", fields: [F("pos", "h", 3, POS), F("yaw", "H", 1, YAW), F("model", "B"), F("team", "B"), F("state", "B")] },
  [KIND_DRONE]: { name: "drone", fields: [F("pos", "h", 3, POS), F("yaw", "H", 1, YAW), F("team", "B"), F("state", "B")] }
};
var MATCH = [
  F("phase", "B"),
  F("clock", "H", 1, 10),
  F("round", "B"),
  F("score", "B", 2),
  F("team0_side", "B"),
  F("alive", "B", 2),
  F("bomb", "B"),
  F("buy_time", "B")
];
var SELF = [
  F("slot", "H"),
  F("pos", "f", 3),
  F("vel", "f", 3),
  F("height", "f"),
  F("ground_normal", "f", 3),
  F("jump_cooldown", "f"),
  F("landing_timer", "f"),
  F("air_time", "f"),
  F("stride", "f"),
  F("jump_buffer", "f"),
  F("lean", "f"),
  F("speed_scale", "f"),
  F("slow", "f"),
  F("yaw", "f"),
  F("pitch", "f"),
  F("flags", "H"),
  F("health", "B"),
  F("armor", "B"),
  F("money", "H"),
  F("inv_slot", "B"),
  F("item", "B"),
  F("ammo", "H"),
  F("reserve", "H"),
  F("weapons", "B", 2),
  F("grenades", "B", 4),
  F("zoom", "B"),
  F("ads", "B", 1, 255),
  F("progress_kind", "B"),
  F("progress", "B", 1, 255),
  F("gadget", "B"),
  F("gadget_left", "B"),
  F("charges", "B"),
  F("drones", "B"),
  F("reinforcements", "B"),
  F("view", "H"),
  F("view_pos", "f", 3),
  F("view_yaw", "f"),
  F("view_pitch", "f")
  // the drone or camera looked through
];
var EV_TRACER = 1;
var EV_IMPACT = 2;
var EV_SOUND = 3;
var EV_FOOTSTEP = 4;
var EV_SHOT = 5;
var EV_EXPLOSION = 6;
var EV_FLASH = 7;
var EV_HIT = 8;
var EV_BLIND = 9;
var EV_RADAR = 10;
var EV_JSON = 255;
var EVENTS = {
  [EV_TRACER]: { name: "tracer", fields: [F("start", "h", 3, POS), F("end", "h", 3, POS)] },
  [EV_IMPACT]: { name: "impact", fields: [F("pos", "h", 3, POS), F("normal", "b", 3, 127), F("surface", "s")] },
  [EV_SOUND]: { name: "sound", fields: [F("pos", "h", 3, POS), F("volume", "B", 1, 100), F("name", "s")] },
  [EV_FOOTSTEP]: { name: "footstep", fields: [F("pos", "h", 3, POS), F("loudness", "B", 1, 100), F("surface", "s")] },
  [EV_SHOT]: { name: "shot", fields: [F("slot", "H"), F("pos", "h", 3, POS), F("profile", "s")] },
  [EV_EXPLOSION]: { name: "explosion", fields: [F("pos", "h", 3, POS), F("radius", "B", 1, 4), F("kind", "B")] },
  [EV_FLASH]: { name: "flash", fields: [F("pos", "h", 3, POS)] },
  [EV_HIT]: { name: "hit", fields: [F("flags", "B")] },
  [EV_BLIND]: { name: "blind", fields: [F("duration", "B", 1, 20), F("strength", "B", 1, 255)] },
  [EV_RADAR]: { name: "radar", fields: [F("slot", "H"), F("pos", "h", 3, POS)] },
  [EV_JSON]: { name: "json", fields: [F("data", "S")] }
};
var CH_SNAP = 1;
var CH_INPUT = 2;
var MAX_COMMANDS = 4;
var INPUT_HEADER = 6;
var enc = new TextEncoder();
var dec = new TextDecoder();
var MAX_INPUT_BYTES = INPUT_HEADER + MAX_COMMANDS * WIRE_SIZE;

// server/src/web/gateway.ts
import { WebSocketServer } from "ws";

// server/src/web/chat.ts
import fs3 from "node:fs";
import path4 from "node:path";
var MAX_LEN = 200;
var LEET = {
  "0": "o",
  "1": "i",
  "!": "i",
  "|": "i",
  "3": "e",
  "4": "a",
  "@": "a",
  "5": "s",
  $: "s",
  "7": "t",
  "+": "t",
  "8": "b",
  "9": "g"
};
var collapse = (s) => s.replace(/(.)\1+/g, "$1");
function normalize(word, doCollapse = false) {
  let w = word.toLowerCase().normalize("NFKD").replace(new RegExp("\\p{M}", "gu"), "");
  w = [...w].map((ch) => LEET[ch] ?? ch).join("").replace(/[^a-z]/g, "");
  return doCollapse ? collapse(w) : w;
}
function sanitize(text2) {
  return String(text2).replace(new RegExp("\\p{C}", "gu"), "").replace(/\s+/g, " ").trim().slice(0, MAX_LEN);
}
var ChatFilter = class {
  stems;
  words;
  stemsC;
  wordsC;
  constructor(file = path4.join(DATA_DIR, "chat_filter.json")) {
    const data = JSON.parse(fs3.readFileSync(file, "utf8"));
    this.stems = (data.stems ?? []).map((w) => w.toLowerCase());
    this.words = new Set((data.words ?? []).map((w) => w.toLowerCase()));
    this.stemsC = this.stems.map(collapse);
    this.wordsC = new Set([...this.words].map(collapse));
  }
  bad(word) {
    const w = normalize(word);
    if (!w) return false;
    if (this.words.has(w) || this.stems.some((s) => w.startsWith(s))) return true;
    const c = collapse(w);
    return c !== w && (this.wordsC.has(c) || this.stemsC.some((s) => c.startsWith(s)));
  }
  /** [text with bad words masked, whether anything was masked]. Letters spaced out one by one ("f u c k")
   * are read as one word too. */
  clean(input) {
    const text2 = sanitize(input);
    const spans2 = [];
    for (const m of text2.matchAll(/\S+/g)) spans2.push([m.index, m.index + m[0].length]);
    const mask = spans2.map(([a, b]) => this.bad(text2.slice(a, b)));
    let i = 0;
    while (i < spans2.length) {
      let j = i;
      while (j < spans2.length && spans2[j][1] - spans2[j][0] === 1) j++;
      if (j - i >= 3 && this.bad(spans2.slice(i, j).map(([a, b]) => text2.slice(a, b)).join(""))) for (let k = i; k < j; k++) mask[k] = true;
      i = Math.max(j, i + 1);
    }
    if (!mask.some(Boolean)) return [text2, false];
    let out = "", last = 0;
    spans2.forEach(([a, b], k) => {
      out += text2.slice(last, a) + (mask[k] ? "*".repeat(b - a) : text2.slice(a, b));
      last = b;
    });
    return [out + text2.slice(last), true];
  }
  /** No stem anywhere in the name, no listed word as one of its parts (split on _ and -, and between lower
   * and upper case). */
  usernameOk(name) {
    const flat2 = normalize(name);
    if (this.stems.some((s) => flat2.includes(s)) || this.stemsC.some((s) => collapse(flat2).includes(s))) return false;
    const parts = name.split(/[_-]+|(?<=[a-z])(?=[A-Z])/);
    return !parts.some((p) => p && this.bad(p));
  }
};
var filter = null;
function wordFilter() {
  filter ??= new ChatFilter();
  return filter;
}
var ChatLimiter = class {
  constructor(n = 5, window = 10, clock = () => performance.now() / 1e3) {
    this.n = n;
    this.window = window;
    this.clock = clock;
  }
  sent = /* @__PURE__ */ new Map();
  /** [allowed, seconds until the next message is allowed]. */
  allow(key) {
    const now2 = this.clock();
    const times = (this.sent.get(key) ?? []).filter((t) => now2 - t < this.window);
    if (times.length >= this.n) {
      this.sent.set(key, times);
      return [false, this.window - (now2 - times[0])];
    }
    times.push(now2);
    this.sent.set(key, times);
    if (this.sent.size > 5e3) {
      for (const [k, v] of this.sent) if (!v.length || now2 - v[v.length - 1] >= this.window) this.sent.delete(k);
    }
    return [true, 0];
  }
};

// server/src/web/duels.ts
import { randomBytes as randomBytes2 } from "node:crypto";
var WINDOW_START = 100;
var WINDOW_STEP = 50;
var WINDOW_EVERY = 10;
var CHALLENGE_TTL = 600;
var READY_TIME = 20;
var mono = () => performance.now() / 1e3;
var DuelQueue = class {
  constructor(clock = mono) {
    this.clock = clock;
  }
  entries = /* @__PURE__ */ new Map();
  join(userId, name, rating, rd, since = null) {
    let e2 = this.entries.get(userId);
    if (!e2) {
      e2 = { userId, name, rating, rd, since: since ?? this.clock() };
      this.entries.set(userId, e2);
    }
    return e2;
  }
  leave(userId) {
    return this.entries.delete(userId);
  }
  has(userId) {
    return this.entries.has(userId);
  }
  window(e2, now2 = this.clock()) {
    return WINDOW_START + WINDOW_STEP * Math.floor(Math.max(0, now2 - e2.since) / WINDOW_EVERY);
  }
  status(userId) {
    const e2 = this.entries.get(userId);
    if (!e2) return null;
    const now2 = this.clock();
    return { waiting: Math.round((now2 - e2.since) * 10) / 10, rating: Math.round(e2.rating), window: this.window(e2, now2), in_queue: this.entries.size };
  }
  /** Pair up who can play: the longest-waiting first, each with the closest rating in range. */
  match() {
    const now2 = this.clock();
    const pairs = [];
    const waiting = [...this.entries.values()].sort((a, b) => a.since - b.since);
    const used = /* @__PURE__ */ new Set();
    for (const a of waiting) {
      if (used.has(a.userId)) continue;
      let best = null;
      for (const b of waiting) {
        if (b.userId === a.userId || used.has(b.userId)) continue;
        const diff = Math.abs(a.rating - b.rating);
        if (diff <= Math.max(this.window(a, now2), this.window(b, now2)) && (!best || diff < best[0])) best = [diff, b];
      }
      if (best) {
        used.add(a.userId);
        used.add(best[1].userId);
        pairs.push([a, best[1]]);
      }
    }
    for (const [a, b] of pairs) {
      this.entries.delete(a.userId);
      this.entries.delete(b.userId);
    }
    return pairs;
  }
};
var Challenge = class {
  constructor(token, fromId, fromName, toId, toName, expires) {
    this.token = token;
    this.fromId = fromId;
    this.fromName = fromName;
    this.toId = toId;
    this.toName = toName;
    this.expires = expires;
  }
  used = false;
  info() {
    return { token: this.token, from: this.fromName, to: this.toName, url: `/duel/${this.token}` };
  }
};
var Challenges = class {
  constructor(clock = mono, ttl = CHALLENGE_TTL) {
    this.clock = clock;
    this.ttl = ttl;
  }
  byToken = /* @__PURE__ */ new Map();
  create(fromId, fromName, toId = null, toName = "") {
    const c = new Challenge(randomBytes2(12).toString("base64url"), fromId, fromName, toId, toName, this.clock() + this.ttl);
    this.byToken.set(c.token, c);
    return c;
  }
  get(token) {
    const c = this.byToken.get(token || "");
    if (!c || c.used || c.expires <= this.clock()) return null;
    return c;
  }
  /** Accept: a valid challenge meant for this user (or anyone with the link), used up. */
  take(token, userId) {
    const c = this.get(token);
    if (!c || c.fromId === userId || c.toId !== null && c.toId !== userId) return null;
    c.used = true;
    return c;
  }
  decline(token, userId) {
    const c = this.get(token);
    if (!c || c.toId !== null && c.toId !== userId || c.fromId === userId) return null;
    c.used = true;
    return c;
  }
  expire() {
    const now2 = this.clock();
    for (const [k, c] of this.byToken) if (c.used || c.expires <= now2) this.byToken.delete(k);
  }
};
var ReadyCheck = class {
  constructor(token, players, ranked, expires) {
    this.token = token;
    this.players = players;
    this.ranked = ranked;
    this.expires = expires;
  }
  ready = /* @__PURE__ */ new Set();
  declined = null;
  get ids() {
    return [this.players[0][0], this.players[1][0]];
  }
  state() {
    return { token: this.token, ranked: this.ranked, players: this.players.map(([, n]) => n), ready: this.players.map(([u]) => this.ready.has(u)) };
  }
};
var ReadyChecks = class {
  constructor(clock = mono, seconds = READY_TIME) {
    this.clock = clock;
    this.seconds = seconds;
  }
  checks = /* @__PURE__ */ new Map();
  create(a, b, ranked) {
    const rc = new ReadyCheck(randomBytes2(8).toString("hex"), [a, b], ranked, this.clock() + this.seconds);
    this.checks.set(rc.token, rc);
    return rc;
  }
  ofUser(userId) {
    return [...this.checks.values()].find((rc) => rc.ids.includes(userId)) ?? null;
  }
  /** "waiting" | "go" (both ready: removed) | "declined" (removed) | "unknown". */
  answer(token, userId, ready) {
    const rc = this.checks.get(token);
    if (!rc || !rc.ids.includes(userId)) return ["unknown", null];
    if (!ready) {
      rc.declined = userId;
      this.checks.delete(token);
      return ["declined", rc];
    }
    rc.ready.add(userId);
    if (rc.ready.size === 2) {
      this.checks.delete(token);
      return ["go", rc];
    }
    return ["waiting", rc];
  }
  expired() {
    const now2 = this.clock();
    const out = [...this.checks.values()].filter((rc) => rc.expires <= now2);
    for (const rc of out) this.checks.delete(rc.token);
    return out;
  }
  /** A player went away (closed the page): their check counts as declined. */
  cancelUser(userId) {
    const rc = this.ofUser(userId);
    if (!rc) return null;
    return this.answer(rc.token, userId, false)[1];
  }
};

// server/src/web/lobbies.ts
import { randomInt } from "node:crypto";
var CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
var CODE_LEN = 6;
var MAX_HUMANS = 10;
var MAX_MEMBERS = 20;
var OFFLINE_GRACE = 60;
var DIFFICULTIES = ["easy", "normal", "hard", "expert"];
var PRESETS = ["full", "short"];
var SETTINGS = {
  map: "qalat",
  difficulty: "normal",
  size_attack: 5,
  size_defend: 5,
  humans_vs_bots: false,
  friendly_fire: false,
  preset: "full"
};
var LobbyError = class extends Error {
};
var now = () => performance.now() / 1e3;
var Member = class {
  constructor(userId, name, team = "spectate") {
    this.userId = userId;
    this.name = name;
    this.team = team;
  }
  online = true;
  offlineSince = 0;
  joined = now();
};
function newCode(taken) {
  for (; ; ) {
    let code = "";
    for (let i = 0; i < CODE_LEN; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!taken.has(code)) return code;
  }
}
function checkSettings(changes, current = SETTINGS, maps = ["qalat"]) {
  const out = { ...current };
  for (const [k, v] of Object.entries(changes ?? {})) {
    if (!(k in SETTINGS)) throw new LobbyError(`unknown setting ${k}`);
    if (k === "map" && !maps.includes(v) || k === "difficulty" && !DIFFICULTIES.includes(v) || k === "preset" && !PRESETS.includes(v)) throw new LobbyError(`${k}: not allowed`);
    if ((k === "size_attack" || k === "size_defend") && (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 5)) throw new LobbyError(`${k}: 1-5`);
    if ((k === "humans_vs_bots" || k === "friendly_fire") && typeof v !== "boolean") throw new LobbyError(`${k}: true or false`);
    out[k] = v;
  }
  return out;
}
var Lobby = class {
  constructor(code, hostId, hostName, settings = {}, maps = ["qalat"]) {
    this.code = code;
    this.maps = maps;
    this.settings = checkSettings(settings, SETTINGS, maps);
    this.host = hostId;
    this.join(hostId, hostName);
  }
  settings;
  members = /* @__PURE__ */ new Map();
  host;
  status = "open";
  matchId = null;
  created = now();
  lastResult = null;
  size(team) {
    return team === 0 ? this.settings.size_attack : this.settings.size_defend;
  }
  players(team = null) {
    return [...this.members.values()].filter((m) => m.team !== "spectate" && (team === null || m.team === team));
  }
  /** How many players a team takes. */
  capacity(team) {
    if (this.settings.humans_vs_bots) return team === 0 ? this.size(0) : 0;
    return this.size(team);
  }
  /** A team with room for one more player, or "spectate". */
  openTeam(prefer = null) {
    if (this.players().length >= MAX_HUMANS) return "spectate";
    const order = prefer === 0 || prefer === 1 ? [prefer] : [];
    order.push(...[0, 1].sort((a, b) => this.players(a).length - this.players(b).length || a - b));
    for (const t of order) if (this.players(t).length < this.capacity(t)) return t;
    return "spectate";
  }
  join(userId, name) {
    const m = this.members.get(userId);
    if (m) {
      m.online = true;
      return m;
    }
    if (this.members.size >= MAX_MEMBERS) throw new LobbyError("the lobby is full");
    const nm = new Member(userId, name, this.openTeam());
    this.members.set(userId, nm);
    if (!this.members.has(this.host)) this.host = userId;
    return nm;
  }
  /** Remove a member; true when the lobby is now empty. */
  leave(userId) {
    if (!this.members.delete(userId)) return this.members.size === 0;
    if (this.host === userId && this.members.size) this.host = [...this.members.values()].reduce((a, m) => m.joined < a.joined ? m : a).userId;
    return this.members.size === 0;
  }
  setTeam(userId, team) {
    const m = this.member(userId);
    if (team === m.team) return;
    if (team === 0 || team === 1) {
      if (this.players(team).length >= this.capacity(team)) throw new LobbyError("that team is full");
      if (m.team === "spectate" && this.players().length >= MAX_HUMANS) throw new LobbyError(`at most ${MAX_HUMANS} players`);
    } else if (team !== "spectate") throw new LobbyError("team: 0, 1 or spectate");
    m.team = team;
  }
  update(userId, changes) {
    this.hostOnly(userId);
    if (this.status !== "open") throw new LobbyError("the match has started");
    this.settings = checkSettings(changes, this.settings, this.maps);
    for (const m of [...this.players()].sort((a, b) => b.joined - a.joined)) {
      if (m.team !== "spectate" && this.players(m.team).length > this.capacity(m.team)) {
        m.team = "spectate";
        m.team = this.openTeam();
      }
    }
  }
  member(userId) {
    const m = this.members.get(userId);
    if (!m) throw new LobbyError("not in this lobby");
    return m;
  }
  hostOnly(userId) {
    if (userId !== this.host) throw new LobbyError("only the host can do that");
  }
  /** The host starts the match: the options for MatchManager.create (status starting). */
  start(userId) {
    this.hostOnly(userId);
    if (this.status !== "open") throw new LobbyError("the match has already started");
    this.status = "starting";
    return this.matchOptions();
  }
  matchOptions() {
    const s = this.settings;
    const fill = [s.humans_vs_bots ? 0 : this.size(0), this.size(1)];
    const humans = [this.players(0).length, this.players(1).length];
    const roster = {};
    for (const m of this.players()) roster[String(m.userId)] = m.team;
    return {
      map: s.map,
      difficulty: s.difficulty,
      preset: s.preset,
      friendlyFire: s.friendly_fire,
      mode: "bots",
      fill,
      bots: [Math.max(0, fill[0] - humans[0]), Math.max(0, fill[1] - humans[1])],
      roster,
      startOnFirstJoin: false,
      joinTimeout: 25,
      endAction: "stop",
      title: `Lobby ${this.code}`
    };
  }
  started(matchId) {
    this.status = "live";
    this.matchId = matchId;
  }
  failed() {
    this.status = "open";
    this.matchId = null;
  }
  ended(result = null) {
    if (result) this.lastResult = result;
    if (this.status === "starting" || this.status === "live") this.status = "ended";
  }
  /** Play again: back to open with the same code and teams. */
  reopen(userId) {
    this.hostOnly(userId);
    if (this.status !== "ended") throw new LobbyError("the match is still running");
    this.status = "open";
    this.matchId = null;
  }
  teamOf(userId) {
    return this.members.get(userId)?.team ?? null;
  }
  state() {
    return {
      code: this.code,
      host: this.host,
      status: this.status,
      match_id: this.matchId,
      settings: { ...this.settings },
      maps: this.maps,
      members: [...this.members.values()].sort((a, b) => a.joined - b.joined).map((m) => ({
        user_id: m.userId,
        name: m.name,
        team: m.team,
        online: m.online,
        host: m.userId === this.host
      })),
      capacity: [this.capacity(0), this.capacity(1)],
      max_humans: MAX_HUMANS,
      last_result: this.lastResult
    };
  }
};
var LobbyManager = class {
  constructor(maps = ["qalat"]) {
    this.maps = maps;
  }
  lobbies = /* @__PURE__ */ new Map();
  userLobby = /* @__PURE__ */ new Map();
  get(code) {
    return this.lobbies.get((code || "").toUpperCase()) ?? null;
  }
  ofUser(userId) {
    const code = this.userLobby.get(userId);
    return code ? this.lobbies.get(code) ?? null : null;
  }
  byMatch(matchId) {
    return [...this.lobbies.values()].find((lb) => lb.matchId === matchId) ?? null;
  }
  /** A new lobby with this user as host: [lobby, [lobbies changed by leaving the old one]]. */
  create(userId, name, settings = {}) {
    const changed = this.leave(userId);
    const lb = new Lobby(newCode(this.lobbies), userId, name, settings, this.maps);
    this.lobbies.set(lb.code, lb);
    this.userLobby.set(userId, lb.code);
    return [lb, changed];
  }
  join(code, userId, name) {
    const lb = this.get(code);
    if (!lb) throw new LobbyError("no lobby with that code");
    let changed = [];
    if (this.userLobby.get(userId) !== lb.code) changed = this.leave(userId);
    lb.join(userId, name);
    this.userLobby.set(userId, lb.code);
    return [lb, changed];
  }
  /** The user leaves their lobby: [[lobby, closed]]. */
  leave(userId) {
    const code = this.userLobby.get(userId);
    this.userLobby.delete(userId);
    const lb = code ? this.lobbies.get(code) : void 0;
    if (!lb) return [];
    const empty = lb.leave(userId);
    if (empty) this.lobbies.delete(lb.code);
    return [[lb, empty]];
  }
  offline(userId) {
    const lb = this.ofUser(userId);
    const m = lb?.members.get(userId);
    if (m) {
      m.online = false;
      m.offlineSince = now();
    }
    return lb;
  }
  /** Members offline longer than grace and not playing the lobby's match leave: [[lobby, closed]]. */
  expire(inMatch, grace = OFFLINE_GRACE) {
    const t = now();
    const out = [];
    for (const lb of [...this.lobbies.values()]) {
      for (const m of [...lb.members.values()]) {
        if (m.online || t - m.offlineSince < grace) continue;
        if (lb.matchId !== null && inMatch(m.userId, lb.matchId)) continue;
        out.push(...this.leave(m.userId));
      }
    }
    return out;
  }
};

// server/src/web/matches.ts
import { randomBytes as randomBytes3 } from "node:crypto";
import { Worker } from "node:worker_threads";

// data/character_anims.json
var character_anims_default = {
  _comment: [
    "Procedural animation clips for the soldier bodies (shared/src/pose.ts).",
    "A clip is keyframes over normalised time t (0..1); its duration is given here or by the",
    "event (a reload lasts the weapon's reload time). Channels, each interpolated (smoothstep)",
    "between the keys that set it:",
    "  weapon_p, weapon_r, weapon_h  degrees added to the weapon bone (pitch, roll, heading)",
    "  weapon_x, weapon_y, weapon_z  metres added to the weapon bone (spine_03 space)",
    "  spine_p, neck_p               degrees added to spine_03 / neck pitch (negative bends forward / looks down)",
    "  crouch                        0..1, raises the body's crouch to at least this",
    "  hand_l, hand_r                a target for that hand: [space, x, y, z] with space 'gun'",
    "                                (the weapon's frame) or 'chest' (spine_03); null = the grip",
    "'loop': true clips hold their last key until stopped (planting, defusing).",
    "Hit flinches are not clips: their size never depends on health (no hidden-state leak)."
  ],
  reload: {
    duration: 2.2,
    keys: [
      { t: 0, weapon_p: 0, weapon_r: 0, hand_l: null },
      { t: 0.14, weapon_p: -14, weapon_r: 32, hand_l: ["gun", 0, 0.16, -0.12] },
      { t: 0.32, hand_l: ["chest", -0.12, 0.13, -0.22] },
      { t: 0.5, hand_l: ["chest", -0.12, 0.13, -0.22] },
      { t: 0.68, hand_l: ["gun", 0, 0.16, -0.12] },
      { t: 0.8, weapon_p: -14, weapon_r: 32, hand_l: ["gun", 0, 0.16, -0.08] },
      { t: 1, weapon_p: 0, weapon_r: 0, hand_l: null }
    ]
  },
  reload_pistol: {
    duration: 1.6,
    keys: [
      { t: 0, weapon_p: 0, hand_l: null },
      { t: 0.15, weapon_p: 18, weapon_z: -0.06, hand_l: ["gun", 0, -0.02, -0.1] },
      { t: 0.4, hand_l: ["chest", -0.1, 0.12, -0.24] },
      { t: 0.7, hand_l: ["gun", 0, -0.02, -0.1] },
      { t: 1, weapon_p: 0, weapon_z: 0, hand_l: null }
    ]
  },
  switch: {
    duration: 0.6,
    keys: [
      { t: 0, weapon_p: 0, weapon_z: 0, weapon_x: 0 },
      { t: 0.45, weapon_p: -55, weapon_z: -0.18, weapon_x: 0.06 },
      { t: 1, weapon_p: 0, weapon_z: 0, weapon_x: 0 }
    ]
  },
  throw: {
    duration: 0.9,
    keys: [
      { t: 0, weapon_p: 0, weapon_z: 0, hand_r: null, spine_p: 0 },
      { t: 0.35, weapon_p: -40, weapon_z: -0.2, hand_r: ["chest", 0.22, -0.12, 0.32], spine_p: 8 },
      { t: 0.55, hand_r: ["chest", 0.18, 0.45, 0.25], spine_p: -10 },
      { t: 0.75, hand_r: ["chest", 0.16, 0.38, 0], spine_p: -6 },
      { t: 1, weapon_p: 0, weapon_z: 0, hand_r: null, spine_p: 0 }
    ]
  },
  knife: {
    duration: 0.45,
    keys: [
      { t: 0, hand_r: null, spine_p: 0 },
      { t: 0.35, hand_r: ["chest", 0.12, 0.55, 0.05], spine_p: -12 },
      { t: 1, hand_r: null, spine_p: 0 }
    ]
  },
  plant: {
    duration: 0.6,
    loop: true,
    keys: [
      { t: 0, crouch: 0, spine_p: 0, neck_p: 0, weapon_p: 0, weapon_z: 0, hand_l: null, hand_r: null },
      {
        t: 1,
        crouch: 1,
        spine_p: -28,
        neck_p: -10,
        weapon_p: -70,
        weapon_z: -0.3,
        hand_l: ["chest", -0.08, 0.42, -0.62],
        hand_r: ["chest", 0.08, 0.44, -0.6]
      }
    ]
  },
  defuse: {
    duration: 0.6,
    loop: true,
    keys: [
      { t: 0, crouch: 0, spine_p: 0, neck_p: 0, weapon_p: 0, weapon_z: 0, hand_l: null, hand_r: null },
      {
        t: 1,
        crouch: 1,
        spine_p: -32,
        neck_p: -12,
        weapon_p: -70,
        weapon_z: -0.3,
        hand_l: ["chest", -0.1, 0.46, -0.6],
        hand_r: ["chest", 0.06, 0.5, -0.58]
      }
    ]
  }
};

// data/destruction.json
var destruction_default = {
  _comment: [
    "Destructible soft walls and floors (shared/src/destruction.ts).",
    "Panels are cut into chunks of about chunk_size; each chunk has hp from its surface.",
    "Damage scales per source: bullet (x bullet damage), melee (x melee damage), explosion",
    "(applied with distance falloff inside the explosion's destruction radius).",
    "Reinforcement: defenders hold [F] on a reinforceable wall; plates make it bullet-proof and",
    "immune to everything except the thermal lance."
  ],
  chunk_size: 0.25,
  surfaces: {
    plaster: {
      hp: 40,
      bullet: 0.55,
      melee: 1.6,
      explosion: 1,
      debris: [
        0.86,
        0.85,
        0.8
      ],
      effect: "dust_white"
    },
    wood: {
      hp: 55,
      bullet: 0.45,
      melee: 1.3,
      explosion: 1,
      debris: [
        0.55,
        0.42,
        0.28
      ],
      effect: "splinters"
    },
    default: {
      hp: 60,
      bullet: 0.35,
      melee: 1,
      explosion: 1,
      debris: [
        0.6,
        0.6,
        0.6
      ],
      effect: "dust_grey"
    },
    concrete: {
      hp: 170,
      bullet: 0.05,
      melee: 0.3,
      explosion: 0.55,
      debris: [
        0.58,
        0.57,
        0.55
      ],
      effect: "dust_grey"
    },
    metal: {
      hp: 70,
      bullet: 0.22,
      melee: 0.45,
      explosion: 1.2,
      debris: [
        0.45,
        0.47,
        0.5
      ],
      effect: "sparks"
    }
  },
  explosion_radius_scale: 0.16,
  reinforce: {
    time: 2.5,
    per_player: 2,
    max_damaged_fraction: 0.15,
    plate_mat: "metal_tan"
  },
  debris: {
    max_bodies: 48,
    lifetime: 8
  }
};

// data/surfaces.json
var surfaces_default = {
  _comment: [
    "Gameplay surface types (set per material in data/materials.json).",
    "pen_cost: penetration budget consumed per centimetre of material.",
    "damage_keep: extra damage multiplier per wall crossing (on top of the budget-based loss).",
    "impact: decal style + particle effect + sound for bullet hits. ricochet: chance of a spark ricochet."
  ],
  default: { pen_cost: 4, damage_keep: 0.85, decal: "concrete", effect: "dust_grey", sound: "concrete" },
  concrete: { pen_cost: 8, damage_keep: 0.8, decal: "concrete", effect: "dust_grey", sound: "concrete" },
  brick: { pen_cost: 6, damage_keep: 0.8, decal: "brick", effect: "dust_red", sound: "concrete" },
  plaster: { pen_cost: 0.6, damage_keep: 0.9, decal: "plaster", effect: "dust_white", sound: "plaster" },
  wood: { pen_cost: 1, damage_keep: 0.9, decal: "wood", effect: "splinters", sound: "wood" },
  metal: { pen_cost: 2.5, damage_keep: 0.75, decal: "metal", effect: "sparks", sound: "metal", ricochet: 0.35 },
  metal_grate: { pen_cost: 1.5, damage_keep: 0.85, decal: "metal", effect: "sparks", sound: "metal", ricochet: 0.25 },
  reinforced: { pen_cost: 400, damage_keep: 0.1, decal: "metal", effect: "sparks", sound: "metal", ricochet: 0.5 },
  tile: { pen_cost: 4, damage_keep: 0.8, decal: "concrete", effect: "dust_white", sound: "tile" },
  fabric: { pen_cost: 5, damage_keep: 0.85, decal: "fabric", effect: "dust_tan", sound: "fabric" },
  dirt: { pen_cost: 10, damage_keep: 0.7, decal: "dirt", effect: "dirt", sound: "dirt" },
  gravel: { pen_cost: 10, damage_keep: 0.7, decal: "dirt", effect: "dirt", sound: "gravel" },
  glass: { pen_cost: 0.2, damage_keep: 0.95, decal: "glass", effect: "glass", sound: "glass" },
  flesh: { pen_cost: 0, damage_keep: 1, decal: "none", effect: "blood", sound: "flesh" },
  dummy: { pen_cost: 0, damage_keep: 1, decal: "none", effect: "dummy", sound: "dummy" }
};

// shared/src/data.ts
var DESTRUCTION = destruction_default;
var SURFACES = Object.fromEntries(
  Object.entries(surfaces_default).filter(([k]) => !k.startsWith("_"))
);

// shared/src/rng.ts
var N = 624;
var M = 397;
var MATRIX_A = 2567483615;
var UPPER = 2147483648;
var LOWER = 2147483647;
var TWOPI = 2 * Math.PI;
var LOG4 = Math.log(4);
var SG_MAGICCONST = 1 + Math.log(4.5);
var Random = class {
  mt = new Uint32Array(N);
  mti = N + 1;
  gaussNext = null;
  constructor(seed) {
    this.seed(seed);
  }
  seed(seed) {
    this.gaussNext = null;
    let n;
    if (seed === void 0 || seed === null) {
      n = BigInt(Math.floor(Math.random() * 2 ** 52)) ^ BigInt(Date.now());
    } else if (typeof seed === "string") {
      n = BigInt(crc32(seed)) * 2654435761n + BigInt(seed.length);
    } else if (typeof seed === "bigint") {
      n = seed;
    } else if (Number.isInteger(seed) && Math.abs(seed) <= Number.MAX_SAFE_INTEGER) {
      n = BigInt(seed);
    } else {
      n = pyHashFloat(seed);
    }
    if (n < 0n) n = -n;
    const key = [];
    if (n === 0n) key.push(0);
    while (n > 0n) {
      key.push(Number(n & 0xffffffffn));
      n >>= 32n;
    }
    this.initByArray(key);
  }
  initGenrand(s) {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < N; i++) {
      const prev = mt[i - 1] ^ mt[i - 1] >>> 30;
      mt[i] = Math.imul(1812433253, prev) + i >>> 0;
    }
    this.mti = N;
  }
  initByArray(key) {
    this.initGenrand(19650218);
    const mt = this.mt;
    let i = 1;
    let j = 0;
    let k = Math.max(N, key.length);
    for (; k; k--) {
      const prev = mt[i - 1] ^ mt[i - 1] >>> 30;
      mt[i] = (mt[i] ^ Math.imul(prev, 1664525)) + key[j] + j >>> 0;
      i++;
      j++;
      if (i >= N) {
        mt[0] = mt[N - 1];
        i = 1;
      }
      if (j >= key.length) j = 0;
    }
    for (k = N - 1; k; k--) {
      const prev = mt[i - 1] ^ mt[i - 1] >>> 30;
      mt[i] = (mt[i] ^ Math.imul(prev, 1566083941)) - i >>> 0;
      i++;
      if (i >= N) {
        mt[0] = mt[N - 1];
        i = 1;
      }
    }
    mt[0] = 2147483648;
  }
  genrand() {
    const mt = this.mt;
    let y;
    if (this.mti >= N) {
      let kk = 0;
      for (; kk < N - M; kk++) {
        y = mt[kk] & UPPER | mt[kk + 1] & LOWER;
        mt[kk] = mt[kk + M] ^ y >>> 1 ^ (y & 1 ? MATRIX_A : 0);
      }
      for (; kk < N - 1; kk++) {
        y = mt[kk] & UPPER | mt[kk + 1] & LOWER;
        mt[kk] = mt[kk + (M - N)] ^ y >>> 1 ^ (y & 1 ? MATRIX_A : 0);
      }
      y = mt[N - 1] & UPPER | mt[0] & LOWER;
      mt[N - 1] = mt[M - 1] ^ y >>> 1 ^ (y & 1 ? MATRIX_A : 0);
      this.mti = 0;
    }
    y = mt[this.mti++];
    y ^= y >>> 11;
    y ^= y << 7 & 2636928640;
    y ^= y << 15 & 4022730752;
    y ^= y >>> 18;
    return y >>> 0;
  }
  /** [0, 1) with 53 random bits, exactly as CPython. */
  random() {
    const a = this.genrand() >>> 5;
    const b = this.genrand() >>> 6;
    return (a * 67108864 + b) * (1 / 9007199254740992);
  }
  getrandbits(k) {
    if (k <= 0) return 0;
    if (k <= 32) return this.genrand() >>> 32 - k;
    let out = 0;
    let mult = 1;
    let left = k;
    while (left > 0) {
      let r = this.genrand();
      if (left < 32) r >>>= 32 - left;
      out += r * mult;
      mult *= 4294967296;
      left -= 32;
    }
    return out;
  }
  randbelow(n) {
    if (n <= 0) return 0;
    const k = bitLength(n);
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }
  randrange(start, stop) {
    if (stop === void 0) return this.randbelow(start);
    return start + this.randbelow(stop - start);
  }
  randint(a, b) {
    return this.randrange(a, b + 1);
  }
  uniform(a, b) {
    return a + (b - a) * this.random();
  }
  choice(seq) {
    return seq[this.randbelow(seq.length)];
  }
  shuffle(x) {
    for (let i = x.length - 1; i > 0; i--) {
      const j = this.randbelow(i + 1);
      const t = x[i];
      x[i] = x[j];
      x[j] = t;
    }
  }
  /** `random.choices(population, weights)[0]` */
  choices(population, weights) {
    const cum = [];
    let total = 0;
    for (const w of weights) {
      total += w;
      cum.push(total);
    }
    const x = this.random() * total;
    let lo = 0;
    let hi = population.length - 1;
    while (lo < hi) {
      const mid = lo + hi >> 1;
      if (x < cum[mid]) hi = mid;
      else lo = mid + 1;
    }
    return population[lo];
  }
  sample(population, k) {
    const n = population.length;
    const result = new Array(k);
    let setsize = 21;
    if (k > 5) setsize += 4 ** Math.ceil(Math.log(k * 3) / Math.log(4));
    if (n <= setsize) {
      const pool = population.slice();
      for (let i = 0; i < k; i++) {
        const j = this.randbelow(n - i);
        result[i] = pool[j];
        pool[j] = pool[n - i - 1];
      }
    } else {
      const selected = /* @__PURE__ */ new Set();
      for (let i = 0; i < k; i++) {
        let j = this.randbelow(n);
        while (selected.has(j)) j = this.randbelow(n);
        selected.add(j);
        result[i] = population[j];
      }
    }
    return result;
  }
  gauss(mu = 0, sigma = 1) {
    let z = this.gaussNext;
    this.gaussNext = null;
    if (z === null) {
      const x2pi = this.random() * TWOPI;
      const g2rad = Math.sqrt(-2 * Math.log(1 - this.random()));
      z = Math.cos(x2pi) * g2rad;
      this.gaussNext = Math.sin(x2pi) * g2rad;
    }
    return mu + z * sigma;
  }
  gammavariate(alpha, beta) {
    if (alpha > 1) {
      const ainv = Math.sqrt(2 * alpha - 1);
      const bbb = alpha - LOG4;
      const ccc = alpha + ainv;
      for (; ; ) {
        const u1 = this.random();
        if (!(1e-7 < u1 && u1 < 0.9999999)) continue;
        const u2 = 1 - this.random();
        const v = Math.log(u1 / (1 - u1)) / ainv;
        const x = alpha * Math.exp(v);
        const z = u1 * u1 * u2;
        const r = bbb + ccc * v - x;
        if (r + SG_MAGICCONST - 4.5 * z >= 0 || r >= Math.log(z)) return x * beta;
      }
    }
    if (alpha === 1) return -Math.log(1 - this.random()) * beta;
    for (; ; ) {
      const u = this.random();
      const b = (Math.E + alpha) / Math.E;
      const p = b * u;
      let x;
      if (p <= 1) x = p ** (1 / alpha);
      else x = -Math.log((b - p) / alpha);
      const u1 = this.random();
      if (p > 1) {
        if (u1 <= x ** (alpha - 1)) return x * beta;
      } else if (u1 <= Math.exp(-x)) return x * beta;
    }
  }
  betavariate(alpha, beta) {
    const y = this.gammavariate(alpha, 1);
    if (y) return y / (y + this.gammavariate(beta, 1));
    return 0;
  }
};
function bitLength(n) {
  let k = 0;
  while (n >= 1) {
    n = Math.floor(n / 2);
    k++;
  }
  return k;
}
function pyHashFloat(v) {
  const BITS = 61n;
  const MOD = (1n << 61n) - 1n;
  if (!Number.isFinite(v)) return 0n;
  if (Number.isInteger(v) && Math.abs(v) < 2 ** 53) {
    let h = BigInt(v) % MOD;
    if (h === -1n) h = -2n;
    return h;
  }
  let e2 = 0;
  let m = Math.abs(v);
  const sign = v < 0 ? -1n : 1n;
  if (m !== 0) {
    e2 = Math.floor(Math.log2(m)) + 1;
    m = m / 2 ** e2;
    while (m >= 1) {
      m /= 2;
      e2++;
    }
    while (m < 0.5) {
      m *= 2;
      e2--;
    }
  }
  let x = 0n;
  while (m) {
    x = x << 28n & MOD | x >> BITS - 28n;
    m *= 268435456;
    e2 -= 28;
    const y = Math.floor(m);
    m -= y;
    x += BigInt(y);
    if (x >= MOD) x -= MOD;
  }
  const be = BigInt(e2 >= 0 ? e2 % 61 : 61 - 1 - (-1 - e2) % 61);
  x = x << be & MOD | x >> BITS - be;
  x = x * sign;
  if (x === -1n) x = -2n;
  return x;
}
var CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(s) {
  const bytes = typeof s === "string" ? new TextEncoder().encode(s) : s;
  let c = 4294967295;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ c >>> 8;
  return (c ^ 4294967295) >>> 0;
}

// shared/src/math.ts
var DEG = Math.PI / 180;
function hprMatrix(h, p, r = 0) {
  const ch = Math.cos(h * DEG), sh = Math.sin(h * DEG);
  const cp = Math.cos(p * DEG), sp = Math.sin(p * DEG);
  const cr = Math.cos(r * DEG), sr = Math.sin(r * DEG);
  return [
    [cr * ch - sr * sp * sh, cr * sh + sr * sp * ch, -sr * cp],
    [-cp * sh, cp * ch, sp],
    [sr * ch + cr * sp * sh, sr * sh - cr * sp * ch, cr * cp]
  ];
}
function pyRound(x) {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}
function m4PosHpr(pos, h, p, r, out = new Float64Array(16)) {
  const R = hprMatrix(h, p, r);
  out[0] = R[0][0];
  out[1] = R[0][1];
  out[2] = R[0][2];
  out[3] = 0;
  out[4] = R[1][0];
  out[5] = R[1][1];
  out[6] = R[1][2];
  out[7] = 0;
  out[8] = R[2][0];
  out[9] = R[2][1];
  out[10] = R[2][2];
  out[11] = 0;
  out[12] = pos[0];
  out[13] = pos[1];
  out[14] = pos[2];
  out[15] = 1;
  return out;
}
function m4Mul(a, b, out = new Float64Array(16)) {
  for (let i = 0; i < 4; i++) {
    const a0 = a[i * 4], a1 = a[i * 4 + 1], a2 = a[i * 4 + 2], a3 = a[i * 4 + 3];
    out[i * 4] = a0 * b[0] + a1 * b[4] + a2 * b[8] + a3 * b[12];
    out[i * 4 + 1] = a0 * b[1] + a1 * b[5] + a2 * b[9] + a3 * b[13];
    out[i * 4 + 2] = a0 * b[2] + a1 * b[6] + a2 * b[10] + a3 * b[14];
    out[i * 4 + 3] = a0 * b[3] + a1 * b[7] + a2 * b[11] + a3 * b[15];
  }
  return out;
}
function m4Point(m, p) {
  return [
    p[0] * m[0] + p[1] * m[4] + p[2] * m[8] + m[12],
    p[0] * m[1] + p[1] * m[5] + p[2] * m[9] + m[13],
    p[0] * m[2] + p[1] * m[6] + p[2] * m[10] + m[14]
  ];
}
function m4InvAffine(m, out = new Float64Array(16)) {
  const a = m[0], b = m[1], c = m[2], d = m[4], e2 = m[5], f = m[6], g5 = m[8], h = m[9], i = m[10];
  const A = e2 * i - f * h, B = -(d * i - f * g5), C = d * h - e2 * g5;
  const det = a * A + b * B + c * C;
  const inv = 1 / det;
  out[0] = A * inv;
  out[1] = -(b * i - c * h) * inv;
  out[2] = (b * f - c * e2) * inv;
  out[3] = 0;
  out[4] = B * inv;
  out[5] = (a * i - c * g5) * inv;
  out[6] = -(a * f - c * d) * inv;
  out[7] = 0;
  out[8] = C * inv;
  out[9] = -(a * h - b * g5) * inv;
  out[10] = (a * e2 - b * d) * inv;
  out[11] = 0;
  const tx = m[12], ty = m[13], tz = m[14];
  out[12] = -(tx * out[0] + ty * out[4] + tz * out[8]);
  out[13] = -(tx * out[1] + ty * out[5] + tz * out[9]);
  out[14] = -(tx * out[2] + ty * out[6] + tz * out[10]);
  out[15] = 1;
  return out;
}

// shared/src/collision.ts
var GROUP_WORLD = 1;
var GROUP_CLIP = 2;
var GROUP_PANEL = 4;
var MASK_MOVEMENT = GROUP_WORLD | GROUP_CLIP | GROUP_PANEL;
var MASK_SIGHT = GROUP_WORLD | GROUP_PANEL;
var MASK_BULLETS = GROUP_WORLD | GROUP_PANEL;

// data/movement.json
var movement_default = {
  _comment: "Character movement tuning (SI units: metres, seconds). Shared by the player and bots.",
  hull: "box",
  radius: 0.3,
  stand_height: 1.8,
  crouch_height: 1.2,
  eye_offset: 0.13,
  step_height: 0.42,
  max_slope_deg: 46,
  crouch_time: 0.16,
  run_speed: 5.4,
  walk_speed: 2.75,
  crouch_speed: 1.85,
  ground_accel: 5.5,
  ground_friction: 5.2,
  stop_speed: 1.6,
  air_accel: 12,
  air_wish_cap: 0.76,
  jump_speed: 6.4,
  jump_cooldown: 0.1,
  landing_slowdown: 0.65,
  landing_recover_time: 0.35,
  crouch_jump_tuck: true,
  footsteps: {
    run_stride: 1.65,
    walk_stride: 1.15,
    crouch_stride: 1,
    run_loudness: 1,
    walk_loudness: 0,
    crouch_loudness: 0,
    land_loudness: 1,
    hearing_radius: 28
  }
};

// shared/src/character.ts
var MOVEMENT = movement_default;

// data/weapon_models.json
var weapon_models_default = {
  _comment: [
    "Procedural weapon models. Gun space: +Y forward (barrel), +Z up, +X right, metres, origin near the trigger.",
    "Parts: shape box (size, bevel) | cyl (radius, length, axis x/y/z) | sphere (radius); optional hpr; 'group' puts",
    "the part on an animated node (mag, bolt, slide, pump). 'emit' makes a part glow (sight reticles).",
    "anchors: muzzle, eject, sight (eye point for ADS), grip_r / grip_l (hand positions), mag.",
    "viewmodel: hip offset in camera space, ADS eye distance, arm elbow targets.",
    "Firearms and the knife are generated by scripts/weapons/models.py (do not edit them here); grenades, the charge and gadgets are hand-made."
  ],
  rifle_r7: {
    parts: [
      { shape: "profile", pts: [[-0.095, 0.015], [-0.0944, 0.0136], [-0.093, 0.013], [0.134, 0.013], [0.1347, 0.0133], [0.135, 0.014], [0.135, 0.049], [0.1347, 0.0497], [0.134, 0.05], [-0.0926, 0.05], [-0.093, 0.0499], [-0.0933, 0.0497], [-0.0944, 0.0486], [-0.0948, 0.0479], [-0.095, 0.0472]], width: 0.026, bevel: 12e-4, plane: "yz", pos: [-2e-3, 0, 0], mat: "gun_parkerized" },
      { shape: "profile", pts: [[-0.095, 0.013], [4e-3, 0.013], [4e-3, 0.05], [-0.095, 0.05]], width: 4e-3, bevel: 6e-4, plane: "yz", pos: [0.013, 0, 0], mat: "gun_parkerized" },
      { shape: "profile", pts: [[0.054, 0.013], [0.135, 0.013], [0.135, 0.05], [0.054, 0.05]], width: 4e-3, bevel: 6e-4, plane: "yz", pos: [0.013, 0, 0], mat: "gun_parkerized" },
      { shape: "profile", pts: [[4e-3, 0.0425], [0.054, 0.0425], [0.054, 0.05], [4e-3, 0.05]], width: 4e-3, bevel: 6e-4, plane: "yz", pos: [0.013, 0, 0], mat: "gun_parkerized" },
      { shape: "profile", pts: [[4e-3, 0.013], [0.054, 0.013], [0.054, 0.0265], [4e-3, 0.0265]], width: 4e-3, bevel: 6e-4, plane: "yz", pos: [0.013, 0, 0], mat: "gun_parkerized" },
      { shape: "box", pos: [0.0112, 0.029, 0.0345], size: [4e-4, 0.05, 0.016], bevel: 0, wear: false, lod: false, mat: "shadow" },
      { shape: "box", pos: [0.0128, 0.025, 0.0345], size: [26e-4, 0.042, 0.011], bevel: 8e-4, group: "bolt", lod: false, mat: "gun_parkerized" },
      { shape: "cyl", pos: [0.0135, 0.034, 0.036], radius: 22e-4, length: 2e-3, axis: "x", segments: 10, group: "bolt", lod: false, mat: "gun_steel_bare" },
      { shape: "box", pos: [0.0157, 0.029, 0.035], size: [12e-4, 0.054, 0.02], bevel: 4e-4, group: "dust_cover", mat: "gun_parkerized" },
      { shape: "cyl", pos: [0.0157, 0.029, 0.025], radius: 16e-4, length: 0.056, axis: "y", segments: 10, group: "dust_cover", lod: false, mat: "gun_steel_bare" },
      { shape: "profile", pts: [[-8e-3, 0.035], [3e-3, 0.029], [3e-3, 0.048], [-0.012, 0.048]], width: 5e-3, bevel: 8e-4, plane: "yz", pos: [0.0172, 0, 0], mat: "gun_parkerized" },
      { shape: "cyl", pos: [0.0185, -0.045, 0.034], radius: 75e-4, length: 0.04, axis: "y", bevel: 1e-3, segments: 20, hpr: [12, 0, 0], mat: "gun_parkerized" },
      { shape: "cyl", pos: [0.0228, -0.067, 0.034], radius: 62e-4, length: 9e-3, axis: "y", segments: 18, hpr: [12, 0, 0], mat: "gun_knurl" },
      { shape: "slot", pos: [0.0151, 0.02, 0.044], length: 0.21, width: 12e-4, depth: 5e-4, plane: "yz", lod: false, mat: "shadow" },
      { shape: "slot", pos: [-0.0151, 0.02, 0.044], length: 0.21, width: 12e-4, depth: 5e-4, plane: "yz", lod: false, mat: "shadow" },
      { shape: "box", pos: [0, -0.101, 0.044], size: [0.01, 0.03, 7e-3], bevel: 1e-3, group: "charge", mat: "gun_parkerized" },
      { shape: "profile", pts: [[-0.0208, 28e-4], [-0.0206, 9e-4], [-0.019, 0], [0.019, 0], [0.0206, 9e-4], [0.0208, 28e-4], [0.0194, 61e-4], [0.0188, 68e-4], [0.018, 72e-4], [62e-4, 99e-4], [6e-3, 0.01], [58e-4, 0.01], [-58e-4, 0.01], [-6e-3, 0.01], [-62e-4, 99e-4], [-0.018, 72e-4], [-0.0188, 68e-4], [-0.0194, 61e-4]], width: 9e-3, bevel: 8e-4, plane: "xy", pos: [0, -0.114, 0.041], group: "charge", mat: "gun_parkerized" },
      { shape: "box", pos: [-0.016, -0.112, 0.0455], size: [8e-3, 6e-3, 4e-3], bevel: 8e-4, group: "charge", lod: false, mat: "gun_steel_bare" },
      { shape: "profile", pts: [[-0.092, 0.011], [-0.0914, 0.0124], [-0.09, 0.013], [0.116, 0.013], [0.1174, 0.0124], [0.118, 0.011], [0.118, 15e-4], [0.1177, 2e-4], [0.1168, -9e-4], [0.1118, -47e-4], [0.1105, -62e-4], [0.1102, -82e-4], [0.1119, -0.0295], [0.1116, -0.0307], [0.1106, -0.0315], [0.1043, -0.0339], [0.104, -0.034], [0.1036, -0.034], [0.0358, -0.034], [0.0344, -0.0335], [0.0338, -0.0322], [0.0322, -0.0198], [0.0316, -0.0185], [0.0302, -0.018], [-0.0353, -0.018], [-0.036, -0.0181], [-0.0365, -0.0184], [-0.0435, -0.0236], [-0.044, -0.0239], [-0.0447, -0.024], [-0.0711, -0.024], [-0.0719, -0.0238], [-0.0726, -0.0233], [-0.0857, -84e-4], [-0.086, -8e-3], [-0.0862, -75e-4], [-0.0918, 36e-4], [-0.0919, 4e-3], [-0.092, 45e-4]], width: 0.03, bevel: 14e-4, plane: "yz", pos: [0, 0, 0], mat: "gun_parkerized" },
      { shape: "box", pos: [0, 0.073, -0.0335], size: [0.024, 0.07, 12e-4], bevel: 0, lod: false, wear: false, mat: "shadow" },
      { shape: "box", pos: [0.0152, 0.073, -0.017], size: [8e-4, 0.058, 0.022], bevel: 4e-4, lod: false, mat: "gun_parkerized" },
      { shape: "box", pos: [-0.0152, 0.073, -0.017], size: [8e-4, 0.058, 0.022], bevel: 4e-4, lod: false, mat: "gun_parkerized" },
      { shape: "cyl", pos: [0, -0.084, 6e-3], radius: 28e-4, length: 0.0312, axis: "x", segments: 12, lod: false, mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0, 0.11, 6e-3], radius: 28e-4, length: 0.0312, axis: "x", segments: 12, lod: false, mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0, 15e-4, -25e-4], radius: 2e-3, length: 0.0312, axis: "x", segments: 12, lod: false, mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0, -0.0165, -25e-4], radius: 2e-3, length: 0.0312, axis: "x", segments: 12, lod: false, mat: "gun_steel_bare" },
      { shape: "cyl", pos: [-0.0158, -0.028, -4e-3], radius: 55e-4, length: 25e-4, axis: "x", segments: 16, mat: "gun_parkerized" },
      { shape: "profile", pts: [[-3e-3, -1e-3], [-27e-4, -17e-4], [-2e-3, -2e-3], [0.0153, -15e-4], [0.0159, -13e-4], [0.0162, -8e-4], [0.0166, 2e-4], [0.0164, 11e-4], [0.0156, 15e-4], [-2e-3, 2e-3], [-27e-4, 17e-4], [-3e-3, 1e-3]], width: 22e-4, bevel: 4e-4, plane: "yz", pos: [-0.0172, -0.028, -4e-3], mat: "gun_parkerized" },
      { shape: "cyl", pos: [0.0158, -0.028, -4e-3], radius: 3e-3, length: 25e-4, axis: "x", segments: 12, lod: false, mat: "gun_parkerized" },
      { shape: "profile", pts: [[-38e-4, -23e-4], [-34e-4, -35e-4], [-23e-4, -4e-3], [26e-4, -4e-3], [36e-4, -36e-4], [41e-4, -26e-4], [49e-4, 68e-4], [46e-4, 77e-4], [38e-4, 83e-4], [-3e-4, 95e-4], [-16e-4, 93e-4], [-22e-4, 83e-4]], width: 3e-3, bevel: 4e-4, plane: "yz", pos: [-0.0165, 0.038, 0], mat: "gun_parkerized" },
      { shape: "cyl", pos: [0.0163, 0.04, -7e-3], radius: 48e-4, length: 3e-3, axis: "x", segments: 16, mat: "gun_knurl" },
      { shape: "profile", pts: [[-0.01, -0.0145], [-96e-4, -0.0156], [-85e-4, -0.016], [0.0105, -0.016], [0.0116, -0.0156], [0.012, -0.0145], [0.012, -0.0129], [0.0118, -0.0121], [0.0112, -0.0116], [-57e-4, -22e-4], [-6e-3, -2e-3], [-64e-4, -2e-3], [-85e-4, -2e-3], [-96e-4, -24e-4], [-0.01, -35e-4]], width: 2e-3, bevel: 3e-4, plane: "yz", pos: [0.0158, 0.04, 0], mat: "gun_parkerized" },
      { shape: "box", pos: [0, 0.02, 0.052], size: [0.0153, 0.22, 4e-3], bevel: 6e-4, mat: "gun_parkerized" },
      { shape: "profile", pts: [[-0.0106, 0], [0.0106, 0], [9e-3, 3e-3], [-9e-3, 3e-3]], width: 52e-4, bevel: 4e-4, plane: "xz", pos: [0, -0.085, 0.054], wear: false, mat: "gun_parkerized", repeat: { count: 22, step: [0, 0.01, 0] } },
      { shape: "profile", pts: [[-0.0668, -0.0108], [-0.0328, -0.0226], [-0.031, -0.0237], [-0.0301, -0.0256], [-0.0303, -0.0276], [-0.0347, -0.0406], [-0.0348, -0.0408], [-0.0349, -0.041], [-0.0349, -0.0412], [-0.0358, -0.0468], [-0.036, -0.0475], [-0.0363, -0.0481], [-0.0367, -0.0487], [-0.0408, -0.0535], [-0.0413, -0.0541], [-0.0416, -0.0549], [-0.0417, -0.0557], [-0.043, -0.0674], [-0.0432, -0.0682], [-0.0435, -0.069], [-0.044, -0.0696], [-0.048, -0.0743], [-0.0484, -0.0749], [-0.0487, -0.0757], [-0.0489, -0.0765], [-0.0502, -0.0883], [-0.0503, -0.089], [-0.0507, -0.0898], [-0.0511, -0.0904], [-0.0551, -0.0951], [-0.0556, -0.0957], [-0.0559, -0.0965], [-0.0561, -0.0972], [-0.0577, -0.11], [-0.0578, -0.1108], [-0.0581, -0.1115], [-0.0586, -0.1122], [-0.0617, -0.1157], [-0.0629, -0.1167], [-0.0644, -0.1171], [-0.066, -0.1169], [-0.0947, -0.107], [-0.0961, -0.1061], [-0.0971, -0.1048], [-0.0974, -0.1031], [-0.0971, -0.091], [-0.0971, -0.0905], [-0.097, -0.0901], [-0.0969, -0.0896], [-0.0768, -0.0399], [-0.0767, -0.0394], [-0.0766, -0.0389], [-0.0766, -0.0384], [-0.0763, -0.0146], [-0.0763, -0.0141], [-0.0762, -0.0137], [-0.0761, -0.0133], [-0.0753, -0.011], [-0.0745, -97e-4], [-0.0731, -91e-4], [-0.0716, -92e-4]], width: 0.029, bevel: 3e-3, plane: "yz", pos: [0, 0, 0], smooth: 45, mat: "poly_od_grip" },
      { shape: "profile", pts: [[-0.0983, -0.1084], [-0.0982, -0.1096], [-0.0974, -0.1103], [-0.0654, -0.1213], [-0.0642, -0.1212], [-0.0635, -0.1204], [-0.0625, -0.1175], [-0.0626, -0.1164], [-0.0634, -0.1156], [-0.0954, -0.1046], [-0.0965, -0.1047], [-0.0973, -0.1056]], width: 0.03, bevel: 1e-3, plane: "yz", pos: [0, 0, 0], mat: "poly_black" },
      { shape: "profile", pts: [[0, 0], [4e-3, 0], [65e-4, -8e-3], [6e-3, -0.016], [25e-4, -0.024], [-1e-3, -0.025], [1e-3, -0.016], [15e-4, -8e-3]], width: 55e-4, bevel: 6e-4, plane: "yz", pos: [0, 0, -0.013], group: "trigger", mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0, 2e-3, -0.012], radius: 16e-4, length: 0.03, axis: "x", segments: 10, lod: false, mat: "gun_steel_bare" },
      { shape: "sweep", path: [[0, -0.032, -0.017], [0, -0.032, -0.036], [0, -0.0315, -0.0387], [0, -0.0299, -0.0409], [0, -0.0277, -0.0425], [0, -0.025, -0.043], [0, 0.028, -0.043], [0, 0.0307, -0.0425], [0, 0.0329, -0.0409], [0, 0.0345, -0.0387], [0, 0.035, -0.036], [0, 0.035, -0.017]], section: { kind: "rect", w: 0.014, h: 4e-3, c: 12e-4 }, mat: "gun_parkerized" },
      { shape: "cyl", pos: [0, -0.182, 0.029], radius: 0.0148, length: 0.18, axis: "y", bevel: 8e-4, segments: 24, mat: "gun_anodized" },
      { shape: "cyl", pos: [0, -0.098, 0.029], radius: 0.0172, length: 8e-3, axis: "y", segments: 24, mat: "gun_knurl" },
      { shape: "profile", pts: [[-0.018, -0.014], [-0.0172, -0.017], [-0.015, -0.0192], [-0.012, -0.02], [0.012, -0.02], [0.015, -0.0192], [0.0172, -0.017], [0.018, -0.014], [0.018, 0.01], [0.0172, 0.013], [0.015, 0.0152], [0.012, 0.016], [-0.012, 0.016], [-0.015, 0.0152], [-0.0172, 0.013], [-0.018, 0.01]], width: 25e-4, bevel: 4e-4, plane: "xz", pos: [0, -0.1035, 0.029], mat: "gun_parkerized" },
      { shape: "torus", pos: [0, -0.1055, 5e-3], radius: 6e-3, tube: 16e-4, axis: "y", mat: "gun_steel_bare" },
      { shape: "profile", pts: [[-0.205, 0.0459], [-0.2052, 0.0472], [-0.2058, 0.0484], [-0.2068, 0.0493], [-0.208, 0.0498], [-0.2329, 0.0564], [-0.234, 0.0567], [-0.235, 0.0569], [-0.2361, 0.057], [-0.2371, 0.0571], [-0.3195, 0.061], [-0.3198, 0.061], [-0.32, 0.061], [-0.3202, 0.0609], [-0.3205, 0.0609], [-0.3276, 0.0595], [-0.3285, 0.0591], [-0.3293, 0.0584], [-0.3298, 0.0576], [-0.33, 0.0565], [-0.33, -0.0391], [-0.3299, -0.04], [-0.3296, -0.0407], [-0.329, -0.0414], [-0.3283, -0.0418], [-0.3203, -0.0458], [-0.3192, -0.0463], [-0.318, -0.0465], [-0.3167, -0.0464], [-0.3156, -0.0461], [-0.2725, -0.03], [-0.2713, -0.0294], [-0.2701, -0.0288], [-0.2689, -0.0282], [-0.2678, -0.0274], [-0.2151, 0.0109], [-0.2151, 0.0109], [-0.215, 0.011], [-0.2149, 0.011], [-0.2148, 0.0111], [-0.2065, 0.0161], [-0.2059, 0.0166], [-0.2054, 0.0172], [-0.2051, 0.0179], [-0.205, 0.0187]], width: 0.042, bevel: 4e-3, plane: "yz", pos: [0, 0, 0], smooth: 40, mat: "poly_od" },
      { shape: "slot", pos: [0.0214, -0.28, -4e-3], length: 0.052, width: 0.018, depth: 12e-4, plane: "yz", lod: false, mat: "shadow", mirror: "x", hpr: [0, -16, 0] },
      { shape: "box", pos: [0, -0.2775, 0.061], size: [0.034, 0.09, 4e-3], bevel: 15e-4, mat: "poly_od" },
      { shape: "profile", pts: [[-0.1947, 0.011], [-0.1947, 0.013], [-0.1964, 0.014], [-0.2337, 0.014], [-0.2348, 0.0137], [-0.2355, 0.0128], [-0.2377, 8e-3], [-0.2375, 6e-3], [-0.2358, 52e-4], [-0.1981, 69e-4], [-0.1971, 72e-4], [-0.1965, 8e-3]], width: 0.012, bevel: 8e-4, plane: "yz", pos: [0, 0, 0], mat: "poly_od" },
      { shape: "cyl", pos: [0.0215, -0.225, 0.027], radius: 65e-4, length: 4e-3, axis: "x", bore: 3e-3, bevel: 6e-4, segments: 16, mat: "gun_steel_bare" },
      { shape: "slot", pos: [0, -0.3, -0.0425], length: 0.022, width: 6e-3, depth: 15e-4, plane: "xy", hpr: [90, 0, 0], lod: false, mat: "shadow" },
      { shape: "profile", pts: [[-0.33, 0.0591], [-0.3302, 0.0601], [-0.3309, 0.0608], [-0.3318, 0.0611], [-0.3377, 0.0616], [-0.3403, 0.0611], [-0.3423, 0.0592], [-0.343, 0.0567], [-0.3439, -0.0403], [-0.343, -0.0432], [-0.3406, -0.0451], [-0.3376, -0.0452], [-0.3315, -0.0434], [-0.3307, -0.043], [-0.3302, -0.0423], [-0.33, -0.0415]], width: 0.044, bevel: 3e-3, plane: "yz", pos: [0, 0, 0], mat: "gun_rubber_pad" },
      { shape: "loft", kind: "rect", sections: [{ y: 0.135, w: 0.047, h: 0.05, z: 0.029, c: 8e-3 }, { y: 0.141, w: 0.049, h: 0.052, z: 0.029, c: 8e-3 }, { y: 0.431, w: 0.049, h: 0.052, z: 0.029, c: 8e-3 }, { y: 0.435, w: 0.045, h: 0.046, z: 0.029, c: 8e-3 }], mat: "gun_parkerized" },
      { shape: "box", pos: [0, 0.4352, 0.029], size: [0.035, 6e-4, 0.036], bevel: 0, wear: false, lod: false, mat: "shadow" },
      { shape: "slot", pos: [0.0249, 0.16, 0.025], length: 0.032, width: 7e-3, depth: 16e-4, plane: "yz", lod: false, mat: "shadow", repeat: { count: 5, step: [0, 0.0625, 0] }, mirror: "x" },
      { shape: "slot", pos: [0, 0.16, 32e-4], length: 0.032, width: 7e-3, depth: 16e-4, plane: "xy", hpr: [90, 0, 0], lod: false, mat: "shadow", repeat: { count: 5, step: [0, 0.0625, 0] } },
      { shape: "cyl", pos: [0.0199, 0.165, 0.0504], radius: 34e-4, length: 16e-4, axis: "z", segments: 12, hpr: [0, 0, -45], lod: false, wear: false, mat: "shadow", repeat: { count: 8, step: [0, 0.028, 0] } },
      { shape: "cyl", pos: [-0.0199, 0.165, 0.0504], radius: 34e-4, length: 16e-4, axis: "z", segments: 12, hpr: [0, 0, 45], lod: false, wear: false, mat: "shadow", repeat: { count: 8, step: [0, 0.028, 0] } },
      { shape: "box", pos: [0, 0.285, 0.0555], size: [0.0153, 0.29, 4e-3], bevel: 6e-4, mat: "gun_parkerized" },
      { shape: "profile", pts: [[-0.0106, 0], [0.0106, 0], [9e-3, 3e-3], [-9e-3, 3e-3]], width: 52e-4, bevel: 4e-4, plane: "xz", pos: [0, 0.145, 0.0575], wear: false, mat: "gun_parkerized", repeat: { count: 29, step: [0, 0.01, 0] } },
      { shape: "cyl", pos: [0, 0.1345, 0.031], radius: 0.0175, length: 6e-3, axis: "y", segments: 24, mat: "gun_knurl" },
      { shape: "cyl", pos: [0, 0.345, 0.031], radius: 98e-4, radius2: 85e-4, length: 0.42, axis: "y", segments: 24, mat: "gun_parkerized_dark" },
      { shape: "loft", kind: "rect", sections: [{ y: 0.555, w: 0.026, h: 0.026, z: 0.031, c: 78e-4 }, { y: 0.615, w: 0.026, h: 0.026, z: 0.031, c: 78e-4 }], mat: "gun_parkerized_dark" },
      { shape: "cyl", pos: [0, 0.6153, 0.031], radius: 59e-4, length: 8e-4, axis: "y", segments: 16, lod: false, wear: false, mat: "shadow" },
      { shape: "slot", pos: [0.0134, 0.57, 0.031], length: 0.0156, width: 6e-3, depth: 15e-4, plane: "yz", hpr: [0, 90, 0], lod: false, mat: "shadow", mirror: "x" },
      { shape: "slot", pos: [0.0134, 0.585, 0.031], length: 0.0156, width: 6e-3, depth: 15e-4, plane: "yz", hpr: [0, 90, 0], lod: false, mat: "shadow", mirror: "x" },
      { shape: "slot", pos: [0.0134, 0.6, 0.031], length: 0.0156, width: 6e-3, depth: 15e-4, plane: "yz", hpr: [0, 90, 0], lod: false, mat: "shadow", mirror: "x" },
      { shape: "cyl", pos: [0, 0.552, 0.031], radius: 0.0118, length: 6e-3, axis: "y", bore: 85e-4, segments: 20, mat: "gun_parkerized_dark" },
      { shape: "cyl", pos: [0.0245, 0.165, 0.029], radius: 65e-4, length: 4e-3, axis: "x", bore: 3e-3, bevel: 6e-4, segments: 16, mat: "gun_steel_bare" },
      { shape: "torus", pos: [0, 0.405, 2e-3], radius: 75e-4, tube: 16e-4, axis: "y", mat: "gun_steel_bare" },
      { shape: "profile", pts: [[-0.014, 0], [0.014, 0], [0.012, 9e-3], [-0.012, 9e-3]], width: 0.022, bevel: 8e-4, plane: "yz", pos: [0, -0.07, 0.057], mat: "gun_parkerized" },
      { shape: "torus", pos: [0, -0.07, 0.081], radius: 58e-4, tube: 16e-4, axis: "y", mat: "gun_parkerized" },
      { shape: "profile", pts: [[15e-4, 0], [58e-4, 0], [58e-4, 0.0119], [15e-4, 0.0119]], width: 36e-4, bevel: 4e-4, plane: "xz", pos: [0, -0.07, 0.066], mat: "gun_parkerized" },
      { shape: "profile", pts: [[0.0105, 0], [0.0135, 0], [0.0135, 0.026], [0.011, 0.028]], width: 6e-3, bevel: 5e-4, plane: "xz", pos: [0, -0.07, 0.057], mat: "gun_parkerized" },
      { shape: "profile", pts: [[-15e-4, 0], [-58e-4, 0], [-58e-4, 0.0119], [-15e-4, 0.0119]], width: 36e-4, bevel: 4e-4, plane: "xz", pos: [0, -0.07, 0.066], mat: "gun_parkerized" },
      { shape: "profile", pts: [[-0.0105, 0], [-0.0135, 0], [-0.0135, 0.026], [-0.011, 0.028]], width: 6e-3, bevel: 5e-4, plane: "xz", pos: [0, -0.07, 0.057], mat: "gun_parkerized" },
      { shape: "cyl", pos: [0.014, -0.07, 0.062], radius: 45e-4, length: 4e-3, axis: "x", segments: 14, lod: false, mat: "gun_knurl" },
      { shape: "profile", pts: [[-0.011, 27e-4], [-0.011, 14e-4], [-0.0103, 4e-4], [-91e-4, 0], [91e-4, 0], [0.0103, 4e-4], [0.011, 14e-4], [0.011, 27e-4], [61e-4, 0.0155], [6e-3, 0.0156], [6e-3, 0.0157], [59e-4, 0.0158], [38e-4, 0.0203], [36e-4, 0.0207], [32e-4, 0.0208], [29e-4, 0.0209], [-29e-4, 0.0209], [-32e-4, 0.0208], [-36e-4, 0.0207], [-38e-4, 0.0203], [-59e-4, 0.0158], [-6e-3, 0.0157], [-6e-3, 0.0156], [-61e-4, 0.0155]], width: 0.014, bevel: 8e-4, plane: "yz", pos: [0, 0.413, 0.0605], mat: "gun_parkerized" },
      { shape: "box", pos: [0, 0.413, 0.0785], size: [24e-4, 24e-4, 59e-4], bevel: 4e-4, mat: "gun_parkerized" },
      { shape: "slot", pos: [0, 0.413, 0.0731], length: 0.012, width: 8e-3, depth: 0.0206, plane: "xz", lod: false, mat: "shadow" },
      { shape: "sweep", path: [[0, 0.071, -5e-3], [0, 0.0714, -0.022], [0, 0.0725, -0.039], [0, 0.0745, -0.0558], [0, 0.0772, -0.0726], [0, 0.0806, -0.0893], [0, 0.0848, -0.1057], [0, 0.0897, -0.122], [0, 0.0954, -0.138], [0, 0.1018, -0.1538], [0, 0.1089, -0.1692]], section: { kind: "rect", w: 0.0235, h: 0.064, c: 2e-3 }, scales: [[1, 1], [1, 1.012], [1, 1.024], [1, 1.036], [1, 1.048], [1, 1.06], [1, 1.072], [1, 1.084], [1, 1.096], [1, 1.108], [1, 1.12]], side: [1, 0, 0], group: "mag", mat: "poly_black" },
      { shape: "box", pos: [0, 0.1102, -0.1728], size: [0.0275, 0.0777, 8e-3], bevel: 2e-3, hpr: [0, 26, 0], group: "mag", mat: "poly_black" },
      { shape: "slot", pos: [0.0123, 0.0725, -0.039], length: 0.048, width: 35e-4, depth: 12e-4, plane: "yz", hpr: [0, 5.2, 0], group: "mag", lod: false, mat: "poly_black", mirror: "x" },
      { shape: "slot", pos: [0.0123, 0.0772, -0.0726], length: 0.048, width: 35e-4, depth: 12e-4, plane: "yz", hpr: [0, 10.4, 0], group: "mag", lod: false, mat: "poly_black", mirror: "x" },
      { shape: "slot", pos: [0.0123, 0.0848, -0.1057], length: 0.048, width: 35e-4, depth: 12e-4, plane: "yz", hpr: [0, 15.6, 0], group: "mag", lod: false, mat: "poly_black", mirror: "x" },
      { shape: "slot", pos: [0.0123, 0.0954, -0.138], length: 0.048, width: 35e-4, depth: 12e-4, plane: "yz", hpr: [0, 20.8, 0], group: "mag", lod: false, mat: "poly_black", mirror: "x" },
      { shape: "box", pos: [0, 0.071, -3e-3], size: [0.0195, 0.056, 4e-3], bevel: 8e-4, group: "mag", lod: false, mat: "poly_follower" },
      { shape: "cyl", pos: [0, 0.074, 1e-3], radius: 55e-4, length: 0.052, axis: "y", segments: 12, group: "mag", lod: false, mat: "gun_brass" }
    ],
    anchors: { muzzle: [0, 0.615, 0.031], eject: [0.0165, 0.029, 0.0345], sight: [0, -0.073, 0.081], grip_r: [0, -0.0607, -0.0605], grip_l: [0, 0.305, 1e-3], mag: [0, 0.0806, -0.0893] },
    bounds: { min: [-0.0358, -0.3439, -0.2051], max: [0.0358, 0.6157, 0.0884] },
    groups: { bolt: { pivot: [0, 0, 0] }, dust_cover: { pivot: [0.0157, 0, 0.025] }, charge: { pivot: [0, 0, 0] }, trigger: { pivot: [0, 0, -0.013] } },
    viewmodel: { offset: [0.125, 0.35, -0.15], ads_distance: 0.15, elbow_r: [0.28, -0.12, -0.38], elbow_l: [-0.22, 0.02, -0.4] },
    sight_parts: ["gun_parkerized"]
  },
  rifle_c9: {
    parts: [
      { shape: "profile", pts: [[-0.095, 0.015], [-0.0944, 0.0136], [-0.093, 0.013], [0.134, 0.013], [0.1347, 0.0133], [0.135, 0.014], [0.135, 0.049], [0.1347, 0.0497], [0.134, 0.05], [-0.0926, 0.05], [-0.093, 0.0499], [-0.0933, 0.0497], [-0.0944, 0.0486], [-0.0948, 0.0479], [-0.095, 0.0472]], width: 0.026, bevel: 12e-4, plane: "yz", pos: [-2e-3, 0, 0], mat: "gun_anodized_fde" },
      { shape: "profile", pts: [[-0.095, 0.013], [4e-3, 0.013], [4e-3, 0.05], [-0.095, 0.05]], width: 4e-3, bevel: 6e-4, plane: "yz", pos: [0.013, 0, 0], mat: "gun_anodized_fde" },
      { shape: "profile", pts: [[0.054, 0.013], [0.135, 0.013], [0.135, 0.05], [0.054, 0.05]], width: 4e-3, bevel: 6e-4, plane: "yz", pos: [0.013, 0, 0], mat: "gun_anodized_fde" },
      { shape: "profile", pts: [[4e-3, 0.0425], [0.054, 0.0425], [0.054, 0.05], [4e-3, 0.05]], width: 4e-3, bevel: 6e-4, plane: "yz", pos: [0.013, 0, 0], mat: "gun_anodized_fde" },
      { shape: "profile", pts: [[4e-3, 0.013], [0.054, 0.013], [0.054, 0.0265], [4e-3, 0.0265]], width: 4e-3, bevel: 6e-4, plane: "yz", pos: [0.013, 0, 0], mat: "gun_anodized_fde" },
      { shape: "box", pos: [0.0112, 0.029, 0.0345], size: [4e-4, 0.05, 0.016], bevel: 0, wear: false, lod: false, mat: "shadow" },
      { shape: "box", pos: [0.0128, 0.025, 0.0345], size: [26e-4, 0.042, 0.011], bevel: 8e-4, group: "bolt", lod: false, mat: "gun_parkerized" },
      { shape: "cyl", pos: [0.0135, 0.034, 0.036], radius: 22e-4, length: 2e-3, axis: "x", segments: 10, group: "bolt", lod: false, mat: "gun_steel_bare" },
      { shape: "box", pos: [0.0157, 0.029, 0.035], size: [12e-4, 0.054, 0.02], bevel: 4e-4, group: "dust_cover", mat: "gun_anodized_fde" },
      { shape: "cyl", pos: [0.0157, 0.029, 0.025], radius: 16e-4, length: 0.056, axis: "y", segments: 10, group: "dust_cover", lod: false, mat: "gun_steel_bare" },
      { shape: "profile", pts: [[-8e-3, 0.035], [3e-3, 0.029], [3e-3, 0.048], [-0.012, 0.048]], width: 5e-3, bevel: 8e-4, plane: "yz", pos: [0.0172, 0, 0], mat: "gun_anodized_fde" },
      { shape: "cyl", pos: [0.0185, -0.045, 0.034], radius: 75e-4, length: 0.04, axis: "y", bevel: 1e-3, segments: 20, hpr: [12, 0, 0], mat: "gun_anodized_fde" },
      { shape: "cyl", pos: [0.0228, -0.067, 0.034], radius: 62e-4, length: 9e-3, axis: "y", segments: 18, hpr: [12, 0, 0], mat: "gun_knurl" },
      { shape: "slot", pos: [0.0151, 0.02, 0.044], length: 0.21, width: 12e-4, depth: 5e-4, plane: "yz", lod: false, mat: "shadow" },
      { shape: "slot", pos: [-0.0151, 0.02, 0.044], length: 0.21, width: 12e-4, depth: 5e-4, plane: "yz", lod: false, mat: "shadow" },
      { shape: "box", pos: [0, -0.101, 0.044], size: [0.01, 0.03, 7e-3], bevel: 1e-3, group: "charge", mat: "gun_anodized_fde" },
      { shape: "profile", pts: [[-0.0208, 28e-4], [-0.0206, 9e-4], [-0.019, 0], [0.019, 0], [0.0206, 9e-4], [0.0208, 28e-4], [0.0194, 61e-4], [0.0188, 68e-4], [0.018, 72e-4], [62e-4, 99e-4], [6e-3, 0.01], [58e-4, 0.01], [-58e-4, 0.01], [-6e-3, 0.01], [-62e-4, 99e-4], [-0.018, 72e-4], [-0.0188, 68e-4], [-0.0194, 61e-4]], width: 9e-3, bevel: 8e-4, plane: "xy", pos: [0, -0.114, 0.041], group: "charge", mat: "gun_anodized_fde" },
      { shape: "box", pos: [-0.016, -0.112, 0.0455], size: [8e-3, 6e-3, 4e-3], bevel: 8e-4, group: "charge", lod: false, mat: "gun_steel_bare" },
      { shape: "profile", pts: [[-0.092, 0.011], [-0.0914, 0.0124], [-0.09, 0.013], [0.116, 0.013], [0.1174, 0.0124], [0.118, 0.011], [0.118, 15e-4], [0.1177, 2e-4], [0.1168, -9e-4], [0.1118, -47e-4], [0.1105, -62e-4], [0.1102, -82e-4], [0.1119, -0.0295], [0.1116, -0.0307], [0.1106, -0.0315], [0.1043, -0.0339], [0.104, -0.034], [0.1036, -0.034], [0.0358, -0.034], [0.0344, -0.0335], [0.0338, -0.0322], [0.0322, -0.0198], [0.0316, -0.0185], [0.0302, -0.018], [-0.0353, -0.018], [-0.036, -0.0181], [-0.0365, -0.0184], [-0.0435, -0.0236], [-0.044, -0.0239], [-0.0447, -0.024], [-0.0711, -0.024], [-0.0719, -0.0238], [-0.0726, -0.0233], [-0.0857, -84e-4], [-0.086, -8e-3], [-0.0862, -75e-4], [-0.0918, 36e-4], [-0.0919, 4e-3], [-0.092, 45e-4]], width: 0.03, bevel: 14e-4, plane: "yz", pos: [0, 0, 0], mat: "gun_anodized_fde" },
      { shape: "box", pos: [0, 0.073, -0.0335], size: [0.024, 0.07, 12e-4], bevel: 0, lod: false, wear: false, mat: "shadow" },
      { shape: "box", pos: [0.0152, 0.073, -0.017], size: [8e-4, 0.058, 0.022], bevel: 4e-4, lod: false, mat: "gun_anodized_fde" },
      { shape: "box", pos: [-0.0152, 0.073, -0.017], size: [8e-4, 0.058, 0.022], bevel: 4e-4, lod: false, mat: "gun_anodized_fde" },
      { shape: "cyl", pos: [0, -0.084, 6e-3], radius: 28e-4, length: 0.0312, axis: "x", segments: 12, lod: false, mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0, 0.11, 6e-3], radius: 28e-4, length: 0.0312, axis: "x", segments: 12, lod: false, mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0, 15e-4, -25e-4], radius: 2e-3, length: 0.0312, axis: "x", segments: 12, lod: false, mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0, -0.0165, -25e-4], radius: 2e-3, length: 0.0312, axis: "x", segments: 12, lod: false, mat: "gun_steel_bare" },
      { shape: "cyl", pos: [-0.0158, -0.028, -4e-3], radius: 55e-4, length: 25e-4, axis: "x", segments: 16, mat: "gun_anodized_fde" },
      { shape: "profile", pts: [[-3e-3, -1e-3], [-27e-4, -17e-4], [-2e-3, -2e-3], [0.0153, -15e-4], [0.0159, -13e-4], [0.0162, -8e-4], [0.0166, 2e-4], [0.0164, 11e-4], [0.0156, 15e-4], [-2e-3, 2e-3], [-27e-4, 17e-4], [-3e-3, 1e-3]], width: 22e-4, bevel: 4e-4, plane: "yz", pos: [-0.0172, -0.028, -4e-3], mat: "gun_anodized_fde" },
      { shape: "cyl", pos: [0.0158, -0.028, -4e-3], radius: 3e-3, length: 25e-4, axis: "x", segments: 12, lod: false, mat: "gun_anodized_fde" },
      { shape: "profile", pts: [[-38e-4, -23e-4], [-34e-4, -35e-4], [-23e-4, -4e-3], [26e-4, -4e-3], [36e-4, -36e-4], [41e-4, -26e-4], [49e-4, 68e-4], [46e-4, 77e-4], [38e-4, 83e-4], [-3e-4, 95e-4], [-16e-4, 93e-4], [-22e-4, 83e-4]], width: 3e-3, bevel: 4e-4, plane: "yz", pos: [-0.0165, 0.038, 0], mat: "gun_anodized_fde" },
      { shape: "cyl", pos: [0.0163, 0.04, -7e-3], radius: 48e-4, length: 3e-3, axis: "x", segments: 16, mat: "gun_knurl" },
      { shape: "profile", pts: [[-0.01, -0.0145], [-96e-4, -0.0156], [-85e-4, -0.016], [0.0105, -0.016], [0.0116, -0.0156], [0.012, -0.0145], [0.012, -0.0129], [0.0118, -0.0121], [0.0112, -0.0116], [-57e-4, -22e-4], [-6e-3, -2e-3], [-64e-4, -2e-3], [-85e-4, -2e-3], [-96e-4, -24e-4], [-0.01, -35e-4]], width: 2e-3, bevel: 3e-4, plane: "yz", pos: [0.0158, 0.04, 0], mat: "gun_anodized_fde" },
      { shape: "box", pos: [0, 0.02, 0.052], size: [0.0153, 0.22, 4e-3], bevel: 6e-4, mat: "gun_anodized_fde" },
      { shape: "profile", pts: [[-0.0106, 0], [0.0106, 0], [9e-3, 3e-3], [-9e-3, 3e-3]], width: 52e-4, bevel: 4e-4, plane: "xz", pos: [0, -0.085, 0.054], wear: false, mat: "gun_anodized_fde", repeat: { count: 22, step: [0, 0.01, 0] } },
      { shape: "profile", pts: [[-0.0668, -0.0108], [-0.0328, -0.0226], [-0.031, -0.0237], [-0.0301, -0.0256], [-0.0303, -0.0276], [-0.0347, -0.0406], [-0.0348, -0.0408], [-0.0349, -0.041], [-0.0349, -0.0412], [-0.0358, -0.0468], [-0.036, -0.0475], [-0.0363, -0.0481], [-0.0367, -0.0487], [-0.0408, -0.0535], [-0.0413, -0.0541], [-0.0416, -0.0549], [-0.0417, -0.0557], [-0.043, -0.0674], [-0.0432, -0.0682], [-0.0435, -0.069], [-0.044, -0.0696], [-0.048, -0.0743], [-0.0484, -0.0749], [-0.0487, -0.0757], [-0.0489, -0.0765], [-0.0502, -0.0883], [-0.0503, -0.089], [-0.0507, -0.0898], [-0.0511, -0.0904], [-0.0551, -0.0951], [-0.0556, -0.0957], [-0.0559, -0.0965], [-0.0561, -0.0972], [-0.0577, -0.11], [-0.0578, -0.1108], [-0.0581, -0.1115], [-0.0586, -0.1122], [-0.0617, -0.1157], [-0.0629, -0.1167], [-0.0644, -0.1171], [-0.066, -0.1169], [-0.0947, -0.107], [-0.0961, -0.1061], [-0.0971, -0.1048], [-0.0974, -0.1031], [-0.0971, -0.091], [-0.0971, -0.0905], [-0.097, -0.0901], [-0.0969, -0.0896], [-0.0768, -0.0399], [-0.0767, -0.0394], [-0.0766, -0.0389], [-0.0766, -0.0384], [-0.0763, -0.0146], [-0.0763, -0.0141], [-0.0762, -0.0137], [-0.0761, -0.0133], [-0.0753, -0.011], [-0.0745, -97e-4], [-0.0731, -91e-4], [-0.0716, -92e-4]], width: 0.029, bevel: 3e-3, plane: "yz", pos: [0, 0, 0], smooth: 45, mat: "poly_fde_grip" },
      { shape: "profile", pts: [[-0.0983, -0.1084], [-0.0982, -0.1096], [-0.0974, -0.1103], [-0.0654, -0.1213], [-0.0642, -0.1212], [-0.0635, -0.1204], [-0.0625, -0.1175], [-0.0626, -0.1164], [-0.0634, -0.1156], [-0.0954, -0.1046], [-0.0965, -0.1047], [-0.0973, -0.1056]], width: 0.03, bevel: 1e-3, plane: "yz", pos: [0, 0, 0], mat: "poly_black" },
      { shape: "profile", pts: [[0, 0], [4e-3, 0], [65e-4, -8e-3], [6e-3, -0.016], [25e-4, -0.024], [-1e-3, -0.025], [1e-3, -0.016], [15e-4, -8e-3]], width: 55e-4, bevel: 6e-4, plane: "yz", pos: [0, 0, -0.013], group: "trigger", mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0, 2e-3, -0.012], radius: 16e-4, length: 0.03, axis: "x", segments: 10, lod: false, mat: "gun_steel_bare" },
      { shape: "sweep", path: [[0, -0.032, -0.017], [0, -0.032, -0.036], [0, -0.0315, -0.0387], [0, -0.0299, -0.0409], [0, -0.0277, -0.0425], [0, -0.025, -0.043], [0, 0.028, -0.043], [0, 0.0307, -0.0425], [0, 0.0329, -0.0409], [0, 0.0345, -0.0387], [0, 0.035, -0.036], [0, 0.035, -0.017]], section: { kind: "rect", w: 0.014, h: 4e-3, c: 12e-4 }, mat: "gun_anodized_fde" },
      { shape: "cyl", pos: [0, -0.182, 0.029], radius: 0.0148, length: 0.18, axis: "y", bevel: 8e-4, segments: 24, mat: "gun_anodized" },
      { shape: "cyl", pos: [0, -0.098, 0.029], radius: 0.0172, length: 8e-3, axis: "y", segments: 24, mat: "gun_knurl" },
      { shape: "profile", pts: [[-0.018, -0.014], [-0.0172, -0.017], [-0.015, -0.0192], [-0.012, -0.02], [0.012, -0.02], [0.015, -0.0192], [0.0172, -0.017], [0.018, -0.014], [0.018, 0.01], [0.0172, 0.013], [0.015, 0.0152], [0.012, 0.016], [-0.012, 0.016], [-0.015, 0.0152], [-0.0172, 0.013], [-0.018, 0.01]], width: 25e-4, bevel: 4e-4, plane: "xz", pos: [0, -0.1035, 0.029], mat: "gun_parkerized" },
      { shape: "torus", pos: [0, -0.1055, 5e-3], radius: 6e-3, tube: 16e-4, axis: "y", mat: "gun_steel_bare" },
      { shape: "profile", pts: [[-0.205, 0.0459], [-0.2052, 0.0472], [-0.2058, 0.0484], [-0.2068, 0.0493], [-0.208, 0.0498], [-0.2329, 0.0564], [-0.234, 0.0567], [-0.235, 0.0569], [-0.2361, 0.057], [-0.2371, 0.0571], [-0.3195, 0.061], [-0.3198, 0.061], [-0.32, 0.061], [-0.3202, 0.0609], [-0.3205, 0.0609], [-0.3276, 0.0595], [-0.3285, 0.0591], [-0.3293, 0.0584], [-0.3298, 0.0576], [-0.33, 0.0565], [-0.33, -0.0391], [-0.3299, -0.04], [-0.3296, -0.0407], [-0.329, -0.0414], [-0.3283, -0.0418], [-0.3203, -0.0458], [-0.3192, -0.0463], [-0.318, -0.0465], [-0.3167, -0.0464], [-0.3156, -0.0461], [-0.2725, -0.03], [-0.2713, -0.0294], [-0.2701, -0.0288], [-0.2689, -0.0282], [-0.2678, -0.0274], [-0.2151, 0.0109], [-0.2151, 0.0109], [-0.215, 0.011], [-0.2149, 0.011], [-0.2148, 0.0111], [-0.2065, 0.0161], [-0.2059, 0.0166], [-0.2054, 0.0172], [-0.2051, 0.0179], [-0.205, 0.0187]], width: 0.042, bevel: 4e-3, plane: "yz", pos: [0, 0, 0], smooth: 40, mat: "poly_fde" },
      { shape: "slot", pos: [0.0214, -0.28, -4e-3], length: 0.052, width: 0.018, depth: 12e-4, plane: "yz", lod: false, mat: "shadow", mirror: "x", hpr: [0, -16, 0] },
      { shape: "box", pos: [0, -0.2775, 0.061], size: [0.034, 0.09, 4e-3], bevel: 15e-4, mat: "poly_fde" },
      { shape: "profile", pts: [[-0.1947, 0.011], [-0.1947, 0.013], [-0.1964, 0.014], [-0.2337, 0.014], [-0.2348, 0.0137], [-0.2355, 0.0128], [-0.2377, 8e-3], [-0.2375, 6e-3], [-0.2358, 52e-4], [-0.1981, 69e-4], [-0.1971, 72e-4], [-0.1965, 8e-3]], width: 0.012, bevel: 8e-4, plane: "yz", pos: [0, 0, 0], mat: "poly_fde" },
      { shape: "cyl", pos: [0.0215, -0.225, 0.027], radius: 65e-4, length: 4e-3, axis: "x", bore: 3e-3, bevel: 6e-4, segments: 16, mat: "gun_steel_bare" },
      { shape: "slot", pos: [0, -0.3, -0.0425], length: 0.022, width: 6e-3, depth: 15e-4, plane: "xy", hpr: [90, 0, 0], lod: false, mat: "shadow" },
      { shape: "profile", pts: [[-0.33, 0.0591], [-0.3302, 0.0601], [-0.3309, 0.0608], [-0.3318, 0.0611], [-0.3377, 0.0616], [-0.3403, 0.0611], [-0.3423, 0.0592], [-0.343, 0.0567], [-0.3439, -0.0403], [-0.343, -0.0432], [-0.3406, -0.0451], [-0.3376, -0.0452], [-0.3315, -0.0434], [-0.3307, -0.043], [-0.3302, -0.0423], [-0.33, -0.0415]], width: 0.044, bevel: 3e-3, plane: "yz", pos: [0, 0, 0], mat: "gun_rubber_pad" },
      { shape: "loft", kind: "rect", sections: [{ y: 0.135, w: 0.047, h: 0.05, z: 0.029, c: 8e-3 }, { y: 0.141, w: 0.049, h: 0.052, z: 0.029, c: 8e-3 }, { y: 0.391, w: 0.049, h: 0.052, z: 0.029, c: 8e-3 }, { y: 0.395, w: 0.045, h: 0.046, z: 0.029, c: 8e-3 }], mat: "gun_anodized_fde" },
      { shape: "box", pos: [0, 0.3952, 0.029], size: [0.035, 6e-4, 0.036], bevel: 0, wear: false, lod: false, mat: "shadow" },
      { shape: "slot", pos: [0.0249, 0.16, 0.025], length: 0.032, width: 7e-3, depth: 16e-4, plane: "yz", lod: false, mat: "shadow", repeat: { count: 5, step: [0, 0.0525, 0] }, mirror: "x" },
      { shape: "slot", pos: [0, 0.16, 32e-4], length: 0.032, width: 7e-3, depth: 16e-4, plane: "xy", hpr: [90, 0, 0], lod: false, mat: "shadow", repeat: { count: 5, step: [0, 0.0525, 0] } },
      { shape: "cyl", pos: [0.0199, 0.165, 0.0504], radius: 34e-4, length: 16e-4, axis: "z", segments: 12, hpr: [0, 0, -45], lod: false, wear: false, mat: "shadow", repeat: { count: 7, step: [0, 0.028, 0] } },
      { shape: "cyl", pos: [-0.0199, 0.165, 0.0504], radius: 34e-4, length: 16e-4, axis: "z", segments: 12, hpr: [0, 0, 45], lod: false, wear: false, mat: "shadow", repeat: { count: 7, step: [0, 0.028, 0] } },
      { shape: "box", pos: [0, 0.265, 0.0555], size: [0.0153, 0.25, 4e-3], bevel: 6e-4, mat: "gun_anodized_fde" },
      { shape: "profile", pts: [[-0.0106, 0], [0.0106, 0], [9e-3, 3e-3], [-9e-3, 3e-3]], width: 52e-4, bevel: 4e-4, plane: "xz", pos: [0, 0.145, 0.0575], wear: false, mat: "gun_anodized_fde", repeat: { count: 25, step: [0, 0.01, 0] } },
      { shape: "cyl", pos: [0, 0.1345, 0.031], radius: 0.0175, length: 6e-3, axis: "y", segments: 24, mat: "gun_knurl" },
      { shape: "cyl", pos: [0, 0.315, 0.031], radius: 98e-4, radius2: 85e-4, length: 0.36, axis: "y", segments: 24, mat: "gun_parkerized_dark" },
      { shape: "cyl", pos: [0, 0.524, 0.031], radius: 0.0112, length: 0.058, axis: "y", bore: 5e-3, bevel: 12e-4, segments: 24, mat: "gun_parkerized_dark" },
      { shape: "cyl", pos: [0, 0.5525, 0.031], radius: 5e-3, length: 8e-4, axis: "y", segments: 16, lod: false, wear: false, mat: "shadow" },
      { shape: "slot", pos: [-81e-4, 0.5298, 0.0391], length: 0.0319, width: 3e-3, depth: 8e-4, plane: "yz", hpr: [0, 0, -135], lod: false, mat: "shadow" },
      { shape: "slot", pos: [-81e-4, 0.5298, 0.0229], length: 0.0319, width: 3e-3, depth: 8e-4, plane: "yz", hpr: [0, 0, -225], lod: false, mat: "shadow" },
      { shape: "slot", pos: [81e-4, 0.5298, 0.0229], length: 0.0319, width: 3e-3, depth: 8e-4, plane: "yz", hpr: [0, 0, -315], lod: false, mat: "shadow" },
      { shape: "slot", pos: [81e-4, 0.5298, 0.0391], length: 0.0319, width: 3e-3, depth: 8e-4, plane: "yz", hpr: [0, 0, -405], lod: false, mat: "shadow" },
      { shape: "cyl", pos: [0, 0.492, 0.031], radius: 0.0118, length: 6e-3, axis: "y", bore: 85e-4, segments: 20, mat: "gun_parkerized_dark" },
      { shape: "cyl", pos: [0.0245, 0.165, 0.029], radius: 65e-4, length: 4e-3, axis: "x", bore: 3e-3, bevel: 6e-4, segments: 16, mat: "gun_steel_bare" },
      { shape: "torus", pos: [0, 0.365, 2e-3], radius: 75e-4, tube: 16e-4, axis: "y", mat: "gun_steel_bare" },
      { shape: "profile", pts: [[-0.03, 0], [0.03, 0], [0.026, 0.012], [-0.026, 0.012]], width: 0.022, bevel: 1e-3, plane: "yz", pos: [0, 0.02, 0.057], mat: "gun_anodized" },
      { shape: "cyl", pos: [0.0125, 0.01, 0.061], radius: 3e-3, length: 4e-3, axis: "x", segments: 10, lod: false, mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0.0125, 0.032, 0.061], radius: 3e-3, length: 4e-3, axis: "x", segments: 10, lod: false, mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0, 0.02, 0.089], radius: 0.016, length: 0.07, axis: "y", bore: 0.0135, bevel: 12e-4, segments: 28, mat: "gun_anodized" },
      { shape: "cyl", pos: [0, 0.022, 0.089], radius: 0.0136, length: 15e-4, axis: "y", segments: 24, wear: false, lod: false, mat: "gun_glass" },
      { shape: "box", pos: [0, 0.02, 0.075], size: [0.012, 0.042, 8e-3], bevel: 1e-3, mat: "gun_anodized" },
      { shape: "cyl", pos: [0, 0.024, 0.109], radius: 65e-4, length: 8e-3, axis: "z", segments: 16, mat: "gun_knurl" },
      { shape: "cyl", pos: [0.02, 0.024, 0.089], radius: 65e-4, length: 8e-3, axis: "x", segments: 16, mat: "gun_knurl" },
      { shape: "cyl", pos: [-0.02, 0.024, 0.089], radius: 75e-4, length: 8e-3, axis: "x", segments: 16, mat: "gun_anodized" },
      { shape: "torus", pos: [0, 0.054, 0.089], radius: 0.0154, tube: 11e-4, axis: "y", mat: "gun_anodized" },
      { shape: "sphere", pos: [0, 0.024, 0.089], radius: 9e-4, emit: [80, 3, 2], mat: "pbr_white_rough" },
      { shape: "profile", pts: [[-0.0134, 25e-4], [-0.013, 8e-4], [-0.0114, 0], [0.0114, 0], [0.013, 8e-4], [0.0134, 25e-4], [0.0124, 65e-4], [0.0117, 76e-4], [0.0104, 8e-3], [-0.0104, 8e-3], [-0.0117, 76e-4], [-0.0124, 65e-4]], width: 0.022, bevel: 8e-4, plane: "yz", pos: [0, -0.075, 0.057], mat: "gun_anodized_fde" },
      { shape: "profile", pts: [[-0.0106, 29e-4], [-0.0105, 9e-4], [-88e-4, 0], [88e-4, 0], [0.0105, 9e-4], [0.0106, 29e-4], [86e-4, 69e-4], [78e-4, 77e-4], [68e-4, 8e-3], [-68e-4, 8e-3], [-78e-4, 77e-4], [-86e-4, 69e-4]], width: 0.02, bevel: 8e-4, plane: "yz", pos: [0, 0.373, 0.0605], mat: "gun_anodized_fde" },
      { shape: "sweep", path: [[0, 0.071, -5e-3], [0, 0.0711, -0.021], [0, 0.0716, -0.037], [0, 0.0723, -0.053], [0, 0.0732, -0.0689], [0, 0.0745, -0.0849], [0, 0.076, -0.1008], [0, 0.0778, -0.1167], [0, 0.0799, -0.1326], [0, 0.0823, -0.1484], [0, 0.0849, -0.1642]], section: { kind: "rect", w: 0.0235, h: 0.06, c: 2e-3 }, scales: [[1, 1], [1, 1.012], [1, 1.024], [1, 1.036], [1, 1.048], [1, 1.06], [1, 1.072], [1, 1.084], [1, 1.096], [1, 1.108], [1, 1.12]], side: [1, 0, 0], group: "mag", mat: "gun_anodized" },
      { shape: "box", pos: [0, 0.0854, -0.1681], size: [0.0275, 0.0732, 8e-3], bevel: 2e-3, hpr: [0, 10, 0], group: "mag", mat: "gun_anodized" },
      { shape: "slot", pos: [0.0123, 0.0716, -0.037], length: 0.045, width: 35e-4, depth: 12e-4, plane: "yz", hpr: [0, 2, 0], group: "mag", lod: false, mat: "gun_anodized", mirror: "x" },
      { shape: "slot", pos: [0.0123, 0.0732, -0.0689], length: 0.045, width: 35e-4, depth: 12e-4, plane: "yz", hpr: [0, 4, 0], group: "mag", lod: false, mat: "gun_anodized", mirror: "x" },
      { shape: "slot", pos: [0.0123, 0.076, -0.1008], length: 0.045, width: 35e-4, depth: 12e-4, plane: "yz", hpr: [0, 6, 0], group: "mag", lod: false, mat: "gun_anodized", mirror: "x" },
      { shape: "slot", pos: [0.0123, 0.0799, -0.1326], length: 0.045, width: 35e-4, depth: 12e-4, plane: "yz", hpr: [0, 8, 0], group: "mag", lod: false, mat: "gun_anodized", mirror: "x" },
      { shape: "box", pos: [0, 0.071, -3e-3], size: [0.0195, 0.052, 4e-3], bevel: 8e-4, group: "mag", lod: false, mat: "poly_follower" },
      { shape: "cyl", pos: [0, 0.074, 1e-3], radius: 55e-4, length: 0.048, axis: "y", segments: 12, group: "mag", lod: false, mat: "gun_brass" }
    ],
    anchors: { muzzle: [0, 0.553, 0.031], eject: [0.0165, 0.029, 0.0345], sight: [0, -0.055, 0.089], grip_r: [0, -0.0607, -0.0605], grip_l: [0, 0.305, 1e-3], mag: [0, 0.0745, -0.0849] },
    bounds: { min: [-0.0336, -0.3439, -0.1978], max: [0.0336, 0.553, 0.113] },
    groups: { bolt: { pivot: [0, 0, 0] }, dust_cover: { pivot: [0.0157, 0, 0.025] }, charge: { pivot: [0, 0, 0] }, trigger: { pivot: [0, 0, -0.013] } },
    viewmodel: { offset: [0.12, 0.34, -0.155], ads_distance: 0.3, elbow_r: [0.28, -0.12, -0.38], elbow_l: [-0.22, 0.02, -0.4] }
  },
  smg_mx5: {
    parts: [
      { shape: "loft", kind: "ellipse", sections: [{ y: -0.11, w: 0.038, h: 0.038, z: 0.04 }, { y: 0.13, w: 0.038, h: 0.038, z: 0.04 }], segments: 28, mat: "gun_parkerized" },
      { shape: "cyl", pos: [0, -0.112, 0.04], radius: 0.018, length: 6e-3, axis: "y", bevel: 1e-3, segments: 24, mat: "gun_parkerized" },
      { shape: "box", pos: [0.0175, 0.01, 0.024], size: [6e-3, 0.21, 8e-3], bevel: 1e-3, mat: "gun_parkerized" },
      { shape: "box", pos: [-0.0175, 0.01, 0.024], size: [6e-3, 0.21, 8e-3], bevel: 1e-3, mat: "gun_parkerized" },
      { shape: "cyl", pos: [0, 0.21, 0.066], radius: 85e-4, length: 0.2, axis: "y", bevel: 8e-4, segments: 18, mat: "gun_parkerized" },
      { shape: "cyl", pos: [0, 0.31, 0.066], radius: 92e-4, length: 8e-3, axis: "y", bevel: 8e-4, segments: 18, mat: "gun_parkerized" },
      { shape: "slot", pos: [-85e-4, 0.2, 0.066], length: 0.09, width: 4e-3, depth: 8e-4, plane: "yz", lod: false, mat: "shadow" },
      { shape: "box", pos: [-0.014, 0.25, 0.066], size: [0.012, 8e-3, 5e-3], bevel: 12e-4, group: "charge", mat: "gun_parkerized" },
      { shape: "sphere", pos: [-0.021, 0.25, 0.066], radius: 45e-4, group: "charge", mat: "poly_black" },
      { shape: "box", pos: [0.0182, 0.035, 0.042], size: [2e-3, 0.042, 0.016], bevel: 0, lod: false, wear: false, mat: "shadow" },
      { shape: "box", pos: [0.0188, 0.03, 0.042], size: [24e-4, 0.03, 0.01], bevel: 6e-4, group: "bolt", lod: false, mat: "gun_steel_bare" },
      { shape: "box", pos: [0, -0.02, 0.059], size: [0.0153, 0.14, 4e-3], bevel: 6e-4, mat: "gun_parkerized" },
      { shape: "profile", pts: [[-0.0106, 0], [0.0106, 0], [9e-3, 3e-3], [-9e-3, 3e-3]], width: 52e-4, bevel: 4e-4, plane: "xz", pos: [0, -0.085, 0.061], wear: false, mat: "gun_parkerized", repeat: { count: 14, step: [0, 0.01, 0] } },
      { shape: "profile", pts: [[-0.0116, 23e-4], [-0.0112, 7e-4], [-96e-4, 0], [96e-4, 0], [0.0112, 7e-4], [0.0116, 23e-4], [0.0103, 0.0103], [96e-4, 0.0115], [83e-4, 0.012], [-83e-4, 0.012], [-96e-4, 0.0115], [-0.0103, 0.0103]], width: 0.018, bevel: 8e-4, plane: "yz", pos: [0, -0.075, 0.064], mat: "gun_parkerized" },
      { shape: "cyl", pos: [0, -0.075, 0.084], radius: 9e-3, length: 0.014, axis: "x", bevel: 8e-4, segments: 20, mat: "gun_parkerized" },
      { shape: "cyl", pos: [0, -0.075, 0.084], radius: 18e-4, length: 0.019, axis: "y", segments: 10, lod: false, wear: false, mat: "shadow" },
      { shape: "torus", pos: [0, -0.082, 0.084], radius: 28e-4, tube: 9e-4, axis: "y", mat: "gun_parkerized" },
      { shape: "profile", pts: [[-8e-3, 2e-3], [-74e-4, 6e-4], [-6e-3, 0], [6e-3, 0], [74e-4, 6e-4], [8e-3, 2e-3], [8e-3, 0.01], [74e-4, 0.0114], [6e-3, 0.012], [-6e-3, 0.012], [-74e-4, 0.0114], [-8e-3, 0.01]], width: 0.012, bevel: 6e-4, plane: "yz", pos: [0, 0.29, 0.072], mat: "gun_parkerized" },
      { shape: "torus", pos: [0, 0.29, 0.084], radius: 9e-3, tube: 16e-4, axis: "y", arc: 200, start: -10, mat: "gun_parkerized" },
      { shape: "box", pos: [0, 0.29, 0.0815], size: [22e-4, 3e-3, 5e-3], bevel: 4e-4, mat: "gun_parkerized" },
      { shape: "profile", pts: [[-0.07, 0.017], [-0.0691, 0.0191], [-0.067, 0.02], [0.077, 0.02], [0.0791, 0.0191], [0.08, 0.017], [0.08, 78e-4], [0.0796, 62e-4], [0.0785, 51e-4], [0.0347, -0.0196], [0.034, -0.0199], [0.0332, -0.02], [-0.0291, -0.02], [-0.03, -0.0199], [-0.0307, -0.0195], [-0.0686, 51e-4], [-0.0696, 62e-4], [-0.07, 76e-4]], width: 0.03, bevel: 2e-3, plane: "yz", pos: [0, 0, 0], mat: "poly_black" },
      { shape: "profile", pts: [[-0.0532, -0.0148], [-0.0522, -0.013], [-0.0505, -0.0119], [-0.0484, -0.0119], [-0.0193, -0.0192], [-0.0175, -0.0202], [-0.0164, -0.0219], [-0.0164, -0.024], [-0.0197, -0.0373], [-0.0197, -0.0375], [-0.0198, -0.0377], [-0.0198, -0.0379], [-0.0203, -0.0436], [-0.0204, -0.0443], [-0.0206, -0.0449], [-0.021, -0.0456], [-0.0246, -0.0507], [-0.0249, -0.0514], [-0.0252, -0.0521], [-0.0253, -0.0529], [-0.0256, -0.0648], [-0.0257, -0.0656], [-0.026, -0.0663], [-0.0263, -0.067], [-0.0299, -0.0721], [-0.0303, -0.0727], [-0.0305, -0.0735], [-0.0306, -0.0742], [-0.031, -0.0862], [-0.0311, -0.0869], [-0.0313, -0.0877], [-0.0317, -0.0883], [-0.0352, -0.0934], [-0.0356, -0.0941], [-0.0358, -0.0948], [-0.0359, -0.0955], [-0.0365, -0.1085], [-0.0366, -0.1093], [-0.0369, -0.11], [-0.0372, -0.1106], [-0.0399, -0.1144], [-0.041, -0.1155], [-0.0425, -0.1161], [-0.0441, -0.116], [-0.0718, -0.1092], [-0.0733, -0.1084], [-0.0743, -0.1071], [-0.0748, -0.1055], [-0.0754, -0.0935], [-0.0754, -0.093], [-0.0753, -0.0926], [-0.0752, -0.0921], [-0.0596, -0.0401], [-0.0595, -0.0401], [-0.0595, -0.04], [-0.0595, -0.04]], width: 0.03, bevel: 3e-3, plane: "yz", pos: [0, 0, 0], smooth: 45, mat: "poly_black_grip" },
      { shape: "profile", pts: [[-0.0752, -0.1109], [-0.0751, -0.112], [-0.0741, -0.1127], [-0.0431, -0.1204], [-0.042, -0.1202], [-0.0413, -0.1193], [-0.0406, -0.1164], [-0.0408, -0.1153], [-0.0417, -0.1146], [-0.0727, -0.1069], [-0.0738, -0.107], [-0.0745, -0.1079]], width: 0.031, bevel: 1e-3, plane: "yz", pos: [0, 0, 0], mat: "poly_black" },
      { shape: "profile", pts: [[0, 0], [4e-3, 0], [65e-4, -8e-3], [6e-3, -0.016], [25e-4, -0.024], [-1e-3, -0.025], [1e-3, -0.016], [15e-4, -8e-3]], width: 55e-4, bevel: 6e-4, plane: "yz", pos: [0, 0, -0.012], group: "trigger", mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0, 2e-3, -0.011], radius: 16e-4, length: 0.03, axis: "x", segments: 10, lod: false, mat: "gun_steel_bare" },
      { shape: "sweep", path: [[0, -0.024, -0.016], [0, -0.024, -0.035], [0, -0.0235, -0.0377], [0, -0.0219, -0.0399], [0, -0.0197, -0.0415], [0, -0.017, -0.042], [0, 0.028, -0.042], [0, 0.0307, -0.0415], [0, 0.0329, -0.0399], [0, 0.0345, -0.0377], [0, 0.035, -0.035], [0, 0.035, -0.016]], section: { kind: "rect", w: 0.014, h: 4e-3, c: 12e-4 }, mat: "poly_black" },
      { shape: "cyl", pos: [-0.0158, -0.02, 6e-3], radius: 6e-3, length: 3e-3, axis: "x", segments: 16, mat: "gun_parkerized" },
      { shape: "profile", pts: [[-2e-3, -1e-3], [-17e-4, -17e-4], [-1e-3, -2e-3], [0.0132, -2e-3], [0.0138, -18e-4], [0.0142, -12e-4], [0.0147, 8e-4], [0.0145, 16e-4], [0.0137, 2e-3], [-1e-3, 2e-3], [-17e-4, 17e-4], [-2e-3, 1e-3]], width: 2e-3, bevel: 3e-4, plane: "yz", pos: [-0.0172, -0.02, 6e-3], mat: "gun_parkerized" },
      { shape: "cyl", pos: [0, -0.06, 0.014], radius: 28e-4, length: 0.033, axis: "x", segments: 12, lod: false, mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0, 0.07, 0.014], radius: 28e-4, length: 0.033, axis: "x", segments: 12, lod: false, mat: "gun_steel_bare" },
      { shape: "profile", pts: [[0.04, 4e-3], [0.0406, 54e-4], [0.042, 6e-3], [0.096, 6e-3], [0.0974, 54e-4], [0.098, 4e-3], [0.098, -0.016], [0.0974, -0.0174], [0.096, -0.018], [0.042, -0.018], [0.0406, -0.0174], [0.04, -0.016]], width: 0.027, bevel: 12e-4, plane: "yz", pos: [0, 0, 0], mat: "gun_parkerized" },
      { shape: "cyl", pos: [0.0145, 0.1, -6e-3], radius: 45e-4, length: 3e-3, axis: "x", segments: 14, mat: "gun_knurl" },
      { shape: "sweep", path: [[0, 0.069, -0.012], [0, 0.0693, -0.028], [0, 0.07, -0.044], [0, 0.0713, -0.0599], [0, 0.073, -0.0758], [0, 0.0753, -0.0917], [0, 0.078, -0.1074], [0, 0.0813, -0.1231], [0, 0.085, -0.1387], [0, 0.0892, -0.1541], [0, 0.0939, -0.1694]], section: { kind: "rect", w: 0.022, h: 0.036, c: 2e-3 }, scales: [[1, 1], [1, 1.012], [1, 1.024], [1, 1.036], [1, 1.048], [1, 1.06], [1, 1.072], [1, 1.084], [1, 1.096], [1, 1.108], [1, 1.12]], side: [1, 0, 0], group: "mag", mat: "gun_parkerized_dark" },
      { shape: "box", pos: [0, 0.0949, -0.1732], size: [0.026, 0.0463, 8e-3], bevel: 2e-3, hpr: [0, 18, 0], group: "mag", mat: "gun_parkerized_dark" },
      { shape: "slot", pos: [0.0115, 0.07, -0.044], length: 0.027, width: 35e-4, depth: 12e-4, plane: "yz", hpr: [0, 3.6, 0], group: "mag", lod: false, mat: "gun_parkerized_dark", mirror: "x" },
      { shape: "slot", pos: [0.0115, 0.0753, -0.0917], length: 0.027, width: 35e-4, depth: 12e-4, plane: "yz", hpr: [0, 9, 0], group: "mag", lod: false, mat: "gun_parkerized_dark", mirror: "x" },
      { shape: "slot", pos: [0.0115, 0.0813, -0.1231], length: 0.027, width: 35e-4, depth: 12e-4, plane: "yz", hpr: [0, 12.6, 0], group: "mag", lod: false, mat: "gun_parkerized_dark", mirror: "x" },
      { shape: "box", pos: [0, 0.069, -0.01], size: [0.018, 0.028, 4e-3], bevel: 8e-4, group: "mag", lod: false, mat: "poly_follower" },
      { shape: "cyl", pos: [0, 0.072, -6e-3], radius: 55e-4, length: 0.024, axis: "y", segments: 12, group: "mag", lod: false, mat: "gun_brass" },
      { shape: "loft", kind: "rect", sections: [{ y: 0.13, w: 0.046, h: 0.044, z: 0.038, c: 0.014 }, { y: 0.15, w: 0.05, h: 0.05, z: 0.035, c: 0.016 }, { y: 0.27, w: 0.05, h: 0.05, z: 0.035, c: 0.016 }, { y: 0.285, w: 0.044, h: 0.044, z: 0.038, c: 0.014 }], mat: "poly_black" },
      { shape: "slot", pos: [0.0252, 0.165, 0.032], length: 0.024, width: 5e-3, depth: 14e-4, plane: "yz", hpr: [0, 90, 0], lod: false, mat: "poly_black", mirror: "x" },
      { shape: "slot", pos: [0.0252, 0.185, 0.032], length: 0.024, width: 5e-3, depth: 14e-4, plane: "yz", hpr: [0, 90, 0], lod: false, mat: "poly_black", mirror: "x" },
      { shape: "slot", pos: [0.0252, 0.205, 0.032], length: 0.024, width: 5e-3, depth: 14e-4, plane: "yz", hpr: [0, 90, 0], lod: false, mat: "poly_black", mirror: "x" },
      { shape: "slot", pos: [0.0252, 0.225, 0.032], length: 0.024, width: 5e-3, depth: 14e-4, plane: "yz", hpr: [0, 90, 0], lod: false, mat: "poly_black", mirror: "x" },
      { shape: "slot", pos: [0.0252, 0.245, 0.032], length: 0.024, width: 5e-3, depth: 14e-4, plane: "yz", hpr: [0, 90, 0], lod: false, mat: "poly_black", mirror: "x" },
      { shape: "slot", pos: [0.0252, 0.265, 0.032], length: 0.024, width: 5e-3, depth: 14e-4, plane: "yz", hpr: [0, 90, 0], lod: false, mat: "poly_black", mirror: "x" },
      { shape: "cyl", pos: [0, 0.31, 0.036], radius: 85e-4, radius2: 85e-4, length: 0.06, axis: "y", segments: 24, mat: "gun_parkerized_dark" },
      { shape: "cyl", pos: [0, 0.345, 0.036], radius: 98e-4, length: 0.018, axis: "y", bore: 45e-4, bevel: 8e-4, segments: 20, mat: "gun_knurl" },
      { shape: "cyl", pos: [0.016, -0.2, 0.032], radius: 42e-4, length: 0.2, axis: "y", segments: 12, mat: "gun_steel_bare" },
      { shape: "cyl", pos: [-0.016, -0.2, 0.032], radius: 42e-4, length: 0.2, axis: "y", segments: 12, mat: "gun_steel_bare" },
      { shape: "profile", pts: [[-0.3001, 0.0619], [-0.3006, 0.064], [-0.3021, 0.0655], [-0.3041, 0.066], [-0.3092, 0.066], [-0.3121, 0.0652], [-0.3143, 0.0631], [-0.3152, 0.0602], [-0.3178, -0.027], [-0.3169, -0.0303], [-0.3144, -0.0326], [-0.311, -0.0331], [-0.3054, -0.0324], [-0.3037, -0.0318], [-0.3024, -0.0304], [-0.3019, -0.0285]], width: 0.042, bevel: 3e-3, plane: "yz", pos: [0, 0, 0], mat: "gun_rubber_pad" },
      { shape: "box", pos: [0, -0.297, 0.032], size: [0.044, 0.012, 0.03], bevel: 2e-3, mat: "gun_parkerized" },
      { shape: "box", pos: [0, -0.112, 0.032], size: [0.04, 0.01, 0.026], bevel: 2e-3, mat: "gun_parkerized" },
      { shape: "torus", pos: [0.022, -0.105, 0.046], radius: 6e-3, tube: 16e-4, axis: "x", mat: "gun_steel_bare" },
      { shape: "torus", pos: [-0.02, 0.3, 0.066], radius: 6e-3, tube: 16e-4, axis: "x", mat: "gun_steel_bare" }
    ],
    anchors: { muzzle: [0, 0.354, 0.036], eject: [0.021, 0.035, 0.042], sight: [0, -0.084, 0.084], grip_r: [0, -0.0429, -0.0597], grip_l: [0, 0.2, 6e-3], mag: [0, 0.0753, -0.0917] },
    bounds: { min: [-0.0259, -0.3178, -0.1895], max: [0.0259, 0.354, 0.0946] },
    groups: { charge: { pivot: [0, 0, 0] }, bolt: { pivot: [0, 0, 0] }, trigger: { pivot: [0, 0, -0.012] } },
    viewmodel: { offset: [0.12, 0.32, -0.145], ads_distance: 0.22, elbow_r: [0.28, -0.12, -0.38], elbow_l: [-0.2, 0, -0.4] },
    sight_parts: ["gun_parkerized"]
  },
  pistol_p9: {
    parts: [
      { shape: "profile", pts: [[-0.045, 0.011], [-0.0447, 0.0103], [-0.044, 0.01], [0.14, 0.01], [0.1414, 0.0106], [0.142, 0.012], [0.142, 0.0364], [0.1416, 0.0378], [0.1407, 0.0389], [0.1365, 0.0417], [0.136, 0.0419], [0.1354, 0.042], [-0.0419, 0.042], [-0.0429, 0.0418], [-0.0436, 0.0411], [-0.0448, 0.0393], [-0.045, 0.039], [-0.045, 0.0387]], width: 0.025, bevel: 18e-4, plane: "yz", pos: [0, 0, 0], group: "slide", mat: "gun_parkerized_dark" },
      { shape: "box", pos: [0.011, 0.0485, 0.0408], size: [3e-3, 0.175, 24e-4], bevel: 9e-4, hpr: [0, 0, 35], group: "slide", lod: false, mat: "gun_parkerized_dark" },
      { shape: "box", pos: [-0.011, 0.0485, 0.0408], size: [3e-3, 0.175, 24e-4], bevel: 9e-4, hpr: [0, 0, -35], group: "slide", lod: false, mat: "gun_parkerized_dark" },
      { shape: "slot", pos: [0.0128, -0.039, 0.028], length: 0.024, width: 16e-4, depth: 8e-4, plane: "yz", hpr: [0, 90, 0], group: "slide", lod: false, mat: "shadow", repeat: { count: 9, step: [0, 32e-4, 0] }, mirror: "x" },
      { shape: "slot", pos: [0.0128, 0.108, 0.028], length: 0.022, width: 16e-4, depth: 8e-4, plane: "yz", hpr: [0, 90, 0], group: "slide", lod: false, mat: "shadow", repeat: { count: 6, step: [0, 32e-4, 0] }, mirror: "x" },
      { shape: "box", pos: [9e-3, 0.017, 0.036], size: [72e-4, 0.034, 0.012], bevel: 0, group: "slide", lod: false, wear: false, mat: "shadow" },
      { shape: "box", pos: [0, 0.019, 0.0408], size: [0.017, 0.028, 28e-4], bevel: 6e-4, lod: false, mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0, 0.032, 0.038], radius: 28e-4, length: 2e-3, axis: "y", segments: 10, lod: false, wear: false, mat: "shadow" },
      { shape: "box", pos: [0, -0.0453, 0.028], size: [0.015, 8e-4, 0.0176], bevel: 6e-4, group: "slide", lod: false, mat: "poly_black" },
      { shape: "box", pos: [0.0129, 4e-3, 0.035], size: [12e-4, 0.014, 3e-3], bevel: 4e-4, group: "slide", lod: false, mat: "gun_steel_bare" },
      { shape: "profile", pts: [[-75e-4, 8e-4], [-73e-4, 2e-4], [-67e-4, 0], [-8e-4, 0], [-2e-4, 2e-4], [0, 8e-4], [0, 19e-4], [-2e-4, 25e-4], [-8e-4, 27e-4], [-67e-4, 27e-4], [-73e-4, 25e-4], [-75e-4, 19e-4]], width: 0.016, bevel: 6e-4, plane: "yz", pos: [0, -0.037, 0.042], group: "slide", mat: "gun_parkerized_dark" },
      { shape: "profile", pts: [[-75e-4, 8e-4], [-73e-4, 2e-4], [-67e-4, 0], [-8e-4, 0], [-2e-4, 2e-4], [0, 8e-4], [0, 52e-4], [-2e-4, 58e-4], [-8e-4, 6e-3], [-54e-4, 6e-3], [-59e-4, 59e-4], [-62e-4, 55e-4], [-74e-4, 21e-4], [-75e-4, 2e-3], [-75e-4, 19e-4]], width: 58e-4, bevel: 5e-4, plane: "yz", pos: [49e-4, -0.037, 0.042], group: "slide", mat: "gun_parkerized_dark" },
      { shape: "profile", pts: [[-75e-4, 8e-4], [-73e-4, 2e-4], [-67e-4, 0], [-8e-4, 0], [-2e-4, 2e-4], [0, 8e-4], [0, 52e-4], [-2e-4, 58e-4], [-8e-4, 6e-3], [-54e-4, 6e-3], [-59e-4, 59e-4], [-62e-4, 55e-4], [-74e-4, 21e-4], [-75e-4, 2e-3], [-75e-4, 19e-4]], width: 58e-4, bevel: 5e-4, plane: "yz", pos: [-49e-4, -0.037, 0.042], group: "slide", mat: "gun_parkerized_dark" },
      { shape: "sphere", pos: [45e-4, -0.0429, 0.046], radius: 11e-4, emit: [3, 18, 4], group: "slide", mat: "pbr_white_rough" },
      { shape: "sphere", pos: [-45e-4, -0.0429, 0.046], radius: 11e-4, emit: [3, 18, 4], group: "slide", mat: "pbr_white_rough" },
      { shape: "profile", pts: [[0, 8e-4], [2e-4, 2e-4], [8e-4, 0], [49e-4, 0], [55e-4, 3e-4], [56e-4, 11e-4], [42e-4, 52e-4], [39e-4, 56e-4], [34e-4, 57e-4], [8e-4, 57e-4], [2e-4, 55e-4], [0, 49e-4]], width: 36e-4, bevel: 5e-4, plane: "yz", pos: [0, 0.132, 0.042], group: "slide", mat: "gun_parkerized_dark" },
      { shape: "sphere", pos: [0, 0.1318, 0.0455], radius: 12e-4, emit: [3, 18, 4], group: "slide", mat: "pbr_white_rough" },
      { shape: "profile", pts: [[0.012, 0.011], [0.0123, 0.0117], [0.013, 0.012], [0.129, 0.012], [0.1297, 0.0117], [0.13, 0.011], [0.13, 9e-4], [0.1298, 1e-4], [0.1293, -6e-4], [0.1248, -43e-4], [0.1239, -48e-4], [0.1229, -5e-3], [0.0304, -5e-3], [0.03, -5e-3], [0.0296, -49e-4], [0.0127, -2e-4], [0.0122, 2e-4], [0.012, 8e-4]], width: 0.026, bevel: 18e-4, plane: "yz", pos: [0, 0, 0], mat: "poly_black" },
      { shape: "box", pos: [0, 0.118, -55e-4], size: [0.022, 4e-3, 16e-4], bevel: 0, lod: false, wear: false, mat: "shadow" },
      { shape: "box", pos: [0, 0.106, -55e-4], size: [0.022, 4e-3, 16e-4], bevel: 0, lod: false, wear: false, mat: "shadow" },
      { shape: "box", pos: [0.0128, 0.08, -15e-4], size: [12e-4, 0.096, 3e-3], bevel: 4e-4, lod: false, mat: "poly_black" },
      { shape: "box", pos: [-0.0128, 0.08, -15e-4], size: [12e-4, 0.096, 3e-3], bevel: 4e-4, lod: false, mat: "poly_black" },
      { shape: "profile", pts: [[-0.0436, 0.0122], [-0.0432, 0.0121], [-0.0428, 0.012], [-0.0424, 0.012], [0.0125, 0.012], [0.0143, 0.0115], [0.0155, 0.0103], [0.016, 85e-4], [0.016, 27e-4], [0.0157, 12e-4], [0.0148, 0], [0.0134, -7e-4], [-39e-4, -56e-4], [-51e-4, -62e-4], [-59e-4, -71e-4], [-64e-4, -83e-4], [-99e-4, -0.0247], [-99e-4, -0.0248], [-99e-4, -0.0248], [-99e-4, -0.0249], [-0.0116, -0.0359], [-0.0117, -0.0365], [-0.012, -0.0371], [-0.0124, -0.0376], [-0.0176, -0.0436], [-0.0181, -0.0443], [-0.0183, -0.0451], [-0.0184, -0.046], [-0.0182, -0.0552], [-0.0182, -0.056], [-0.0185, -0.0568], [-0.0189, -0.0575], [-0.0246, -0.0644], [-0.0249, -0.0649], [-0.0251, -0.0654], [-0.0253, -0.0659], [-0.029, -0.085], [-0.0298, -0.0867], [-0.0315, -0.0877], [-0.0335, -0.0877], [-0.0656, -0.0772], [-0.0671, -0.0763], [-0.0679, -0.0748], [-0.0679, -0.0731], [-0.0583, -0.0345], [-0.0583, -0.0344], [-0.0582, -0.0344], [-0.0582, -0.0343], [-0.0484, -42e-4], [-0.0483, -36e-4], [-0.0483, -3e-3], [-0.0483, -24e-4], [-0.0508, 0.0107], [-0.0506, 0.0124], [-0.0493, 0.0135], [-0.0475, 0.0135]], width: 0.029, bevel: 25e-4, plane: "yz", pos: [0, 0, 0], smooth: 45, mat: "poly_black" },
      { shape: "profile", pts: [[-0.0165, -0.0163], [-0.0148, -0.0174], [-0.0138, -0.0192], [-0.0139, -0.0212], [-0.0297, -0.0755], [-0.0308, -0.0773], [-0.0327, -0.0783], [-0.0348, -0.0782], [-0.0594, -0.0702], [-0.0612, -0.0691], [-0.0621, -0.0673], [-0.062, -0.0652], [-0.0454, -0.0112], [-0.0443, -94e-4], [-0.0424, -85e-4], [-0.0403, -86e-4]], width: 0.0302, bevel: 8e-4, plane: "yz", pos: [0, 0, 0], mat: "poly_black_grip" },
      { shape: "sweep", path: [[0, -15e-4, -2e-3], [0, 6e-4, -0.0168], [0, 17e-4, -0.0195], [0, 38e-4, -0.0213], [0, 66e-4, -0.022], [0, 0.0388, -0.022], [0, 0.0415, -0.0213], [0, 0.0437, -0.0195], [0, 0.0447, -0.0168], [0, 0.0457, -99e-4], [0, 0.0458, -86e-4], [0, 0.0456, -75e-4], [0, 0.0452, -63e-4], [0, 0.042, 0]], section: { kind: "rect", w: 0.012, h: 45e-4, c: 12e-4 }, mat: "poly_black" },
      { shape: "profile", pts: [[0, 0], [4e-3, 0], [6e-3, -8e-3], [4e-3, -0.017], [0, -0.018], [2e-3, -8e-3]], width: 6e-3, bevel: 6e-4, plane: "yz", pos: [0, 0.0145, -2e-3], group: "trigger", mat: "poly_black" },
      { shape: "box", pos: [0, 0.018, -0.01], size: [18e-4, 16e-4, 9e-3], bevel: 3e-4, group: "trigger", lod: false, mat: "gun_steel_bare" },
      { shape: "profile", pts: [[-0.018, 1e-3], [-0.0177, 3e-4], [-0.017, 0], [34e-4, 0], [39e-4, 1e-4], [43e-4, 6e-4], [52e-4, 25e-4], [52e-4, 35e-4], [43e-4, 39e-4], [-0.017, 3e-3], [-0.0177, 27e-4], [-0.018, 2e-3]], width: 18e-4, bevel: 3e-4, plane: "yz", pos: [-0.0153, 8e-3, 6e-3], mat: "gun_parkerized_dark" },
      { shape: "box", pos: [0, 0.028, 6e-3], size: [0.031, 8e-3, 3e-3], bevel: 6e-4, mat: "gun_parkerized_dark" },
      { shape: "cyl", pos: [0, 0.0185, 4e-3], radius: 16e-4, length: 0.0295, axis: "x", segments: 10, lod: false, mat: "gun_steel_bare" },
      { shape: "box", pos: [-0.0148, 12e-4, -0.0163], size: [2e-3, 8e-3, 7e-3], bevel: 6e-4, mat: "poly_black" },
      { shape: "cyl", pos: [0, 0.1425, 0.024], radius: 68e-4, length: 2e-3, axis: "y", bore: 45e-4, segments: 18, group: "slide", mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0, 0.1435, 0.024], radius: 45e-4, length: 8e-4, axis: "y", segments: 14, group: "slide", lod: false, wear: false, mat: "shadow" },
      { shape: "profile", pts: [[-0.0405, 8e-4], [-0.011, -87e-4], [-0.037, -0.0886], [-0.0665, -0.0791]], width: 0.021, bevel: 1e-3, plane: "yz", pos: [0, 0, 0], group: "mag", lod: false, mat: "gun_parkerized_dark" },
      { shape: "profile", pts: [[-0.0698, -0.0764], [-0.0686, -0.0749], [-0.0666, -0.0748], [-0.0324, -0.0859], [-0.031, -0.0872], [-0.0308, -0.0891], [-0.0324, -0.0938], [-0.0336, -0.0953], [-0.0355, -0.0954], [-0.0697, -0.0843], [-0.0712, -0.0831], [-0.0713, -0.0812]], width: 0.029, bevel: 15e-4, plane: "yz", pos: [0, 0, 0], group: "mag", mat: "poly_black" },
      { shape: "cyl", pos: [0, -0.0242, -8e-4], radius: 45e-4, length: 0.019, axis: "y", segments: 12, group: "mag", lod: false, mat: "gun_brass" }
    ],
    anchors: { muzzle: [0, 0.144, 0.024], eject: [0.014, 0.017, 0.04], sight: [0, -0.073, 0.0468], grip_r: [0, -0.0378, -0.0393], grip_l: [-0.012, -0.0338, -0.0513], mag: [0, -0.0386, -0.0418] },
    bounds: { min: [-0.0162, -0.0713, -0.0954], max: [0.0155, 0.1439, 0.048] },
    groups: { slide: { pivot: [0, 0, 0] }, trigger: { pivot: [0, 0.0145, -2e-3] } },
    viewmodel: { offset: [0.11, 0.34, -0.13], ads_distance: 0.34, elbow_r: [0.24, -0.1, -0.35], elbow_l: [-0.1, -0.08, -0.38] },
    sight_parts: ["gun_parkerized_dark"]
  },
  sniper_sr90: {
    parts: [
      { shape: "cyl", pos: [0, 0.04, 0.042], radius: 0.0175, length: 0.22, axis: "y", bevel: 12e-4, segments: 28, mat: "gun_parkerized_dark" },
      { shape: "box", pos: [0, 0.15, 0.025], size: [0.024, 8e-3, 0.012], bevel: 8e-4, mat: "gun_parkerized_dark" },
      { shape: "box", pos: [0.0172, 0.065, 0.045], size: [2e-3, 0.075, 0.016], bevel: 0, lod: false, wear: false, mat: "shadow" },
      { shape: "box", pos: [0, 0.045, 0.0605], size: [0.0153, 0.21, 4e-3], bevel: 6e-4, mat: "gun_parkerized_dark" },
      { shape: "profile", pts: [[-0.0106, 0], [0.0106, 0], [9e-3, 3e-3], [-9e-3, 3e-3]], width: 52e-4, bevel: 4e-4, plane: "xz", pos: [0, -0.055, 0.0625], wear: false, mat: "gun_parkerized_dark", repeat: { count: 21, step: [0, 0.01, 0] } },
      { shape: "cyl", pos: [0, -0.068, 0.042], radius: 0.0165, length: 0.06, axis: "y", bevel: 1e-3, segments: 26, group: "bolt", mat: "gun_parkerized_dark" },
      { shape: "cyl", pos: [0, -0.1, 0.042], radius: 0.0105, length: 0.012, axis: "y", segments: 20, group: "bolt", mat: "gun_knurl" },
      { shape: "cyl", pos: [0, 0.06, 0.042], radius: 95e-4, length: 0.05, axis: "y", segments: 20, group: "bolt", lod: false, mat: "gun_steel_bare" },
      { shape: "sweep", path: [[0, -0.045, 0.042], [0.022, -0.046, 0.042], [0.04, -0.05, 0.03], [0.048, -0.055, 0.018]], section: { kind: "circle", r: 42e-4 }, group: "bolt", mat: "gun_parkerized_dark" },
      { shape: "sphere", pos: [0.05, -0.056, 0.012], radius: 0.0105, group: "bolt", mat: "poly_black_grip" },
      { shape: "loft", kind: "rect", sections: [{ y: 0.16, w: 0.052, h: 0.05, z: 0.038, c: 0.012 }, { y: 0.52, w: 0.052, h: 0.05, z: 0.038, c: 0.012 }, { y: 0.53, w: 0.046, h: 0.044, z: 0.038, c: 0.01 }], mat: "gun_anodized_fde" },
      { shape: "slot", pos: [0.0262, 0.2, 0.038], length: 0.03, width: 8e-3, depth: 16e-4, plane: "yz", lod: false, mat: "shadow", mirror: "x" },
      { shape: "slot", pos: [0.0262, 0.245, 0.038], length: 0.03, width: 8e-3, depth: 16e-4, plane: "yz", lod: false, mat: "shadow", mirror: "x" },
      { shape: "slot", pos: [0.0262, 0.29, 0.038], length: 0.03, width: 8e-3, depth: 16e-4, plane: "yz", lod: false, mat: "shadow", mirror: "x" },
      { shape: "slot", pos: [0.0262, 0.335, 0.038], length: 0.03, width: 8e-3, depth: 16e-4, plane: "yz", lod: false, mat: "shadow", mirror: "x" },
      { shape: "slot", pos: [0.0262, 0.38, 0.038], length: 0.03, width: 8e-3, depth: 16e-4, plane: "yz", lod: false, mat: "shadow", mirror: "x" },
      { shape: "slot", pos: [0.0262, 0.425, 0.038], length: 0.03, width: 8e-3, depth: 16e-4, plane: "yz", lod: false, mat: "shadow", mirror: "x" },
      { shape: "slot", pos: [0.0262, 0.47, 0.038], length: 0.03, width: 8e-3, depth: 16e-4, plane: "yz", lod: false, mat: "shadow", mirror: "x" },
      { shape: "box", pos: [0, 0.335, 0.065], size: [0.0153, 0.32, 4e-3], bevel: 6e-4, mat: "gun_anodized_fde" },
      { shape: "profile", pts: [[-0.0106, 0], [0.0106, 0], [9e-3, 3e-3], [-9e-3, 3e-3]], width: 52e-4, bevel: 4e-4, plane: "xz", pos: [0, 0.18, 0.067], wear: false, mat: "gun_anodized_fde", repeat: { count: 32, step: [0, 0.01, 0] } },
      { shape: "profile", pts: [[-0.075, 0.022], [-0.0741, 0.0241], [-0.072, 0.025], [0.157, 0.025], [0.1591, 0.0241], [0.16, 0.022], [0.16, 48e-4], [0.1592, 27e-4], [0.1572, 18e-4], [0.1003, -3e-3], [0.1, -3e-3], [0.0997, -31e-4], [0.0304, -0.0219], [0.03, -0.022], [0.0296, -0.022], [-0.0292, -0.022], [-0.03, -0.0219], [-0.0307, -0.0216], [-0.0734, 12e-4], [-0.0746, 23e-4], [-0.075, 38e-4]], width: 0.044, bevel: 2e-3, plane: "yz", pos: [0, 0, 0], mat: "gun_anodized_fde" },
      { shape: "profile", pts: [[-0.09, 0.048], [-0.0903, 0.0495], [-0.0912, 0.0508], [-0.0925, 0.0517], [-0.094, 0.052], [-0.4179, 0.052], [-0.4189, 0.0519], [-0.4199, 0.0517], [-0.4208, 0.0512], [-0.4216, 0.0507], [-0.4285, 0.0452], [-0.4291, 0.0446], [-0.4296, 0.0438], [-0.4299, 0.043], [-0.43, 0.0421], [-0.43, -0.0629], [-0.4296, -0.065], [-0.4286, -0.0668], [-0.427, -0.0681], [-0.425, -0.0688], [-0.4023, -0.0726], [-0.4012, -0.0727], [-0.4, -0.0727], [-0.3989, -0.0726], [-0.3978, -0.0723], [-0.3002, -0.0431], [-0.3001, -0.043], [-0.3, -0.043], [-0.2999, -0.043], [-0.2998, -0.0429], [-0.162, -36e-4], [-0.161, -33e-4], [-0.16, -31e-4], [-0.159, -3e-3], [-0.1579, -29e-4], [-0.0937, 17e-4], [-0.0923, 21e-4], [-0.0911, 3e-3], [-0.0903, 43e-4], [-0.09, 57e-4]], width: 0.034, bevel: 25e-4, plane: "yz", pos: [0, 0, 0], mat: "gun_anodized_fde" },
      { shape: "slot", pos: [0.0175, -0.19, 0.022], length: 0.09, width: 0.022, depth: 16e-4, plane: "yz", lod: false, mat: "shadow", mirror: "x" },
      { shape: "slot", pos: [0.0175, -0.33, 2e-3], length: 0.1, width: 0.035, depth: 16e-4, plane: "yz", lod: false, mat: "shadow", mirror: "x" },
      { shape: "profile", pts: [[-0.163, 0.0573], [-0.1625, 0.0559], [-0.1631, 0.0546], [-0.1645, 0.054], [-0.386, 0.054], [-0.388, 0.0545], [-0.3895, 0.056], [-0.39, 0.058], [-0.39, 0.068], [-0.3889, 0.072], [-0.386, 0.0749], [-0.382, 0.076], [-0.1827, 0.076], [-0.181, 0.0758], [-0.1795, 0.0751], [-0.1782, 0.074]], width: 0.036, bevel: 4e-3, plane: "yz", pos: [0, 0, 0], mat: "poly_black" },
      { shape: "cyl", pos: [0, -0.24, 0.048], radius: 35e-4, length: 0.032, axis: "z", segments: 12, mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0, -0.34, 0.048], radius: 35e-4, length: 0.032, axis: "z", segments: 12, mat: "gun_steel_bare" },
      { shape: "profile", pts: [[-0.43, 0.046], [-0.4303, 0.047], [-0.431, 0.0477], [-0.432, 0.048], [-0.44, 0.048], [-0.4425, 0.0473], [-0.4443, 0.0455], [-0.445, 0.043], [-0.445, -0.0661], [-0.444, -0.069], [-0.4415, -0.0708], [-0.4384, -0.0708], [-0.4314, -0.0685], [-0.4307, -0.068], [-0.4302, -0.0674], [-0.43, -0.0666]], width: 0.044, bevel: 3e-3, plane: "yz", pos: [0, 0, 0], mat: "gun_rubber_pad" },
      { shape: "box", pos: [0, -0.36, -0.063], size: [0.02, 0.05, 0.016], bevel: 3e-3, mat: "poly_black" },
      { shape: "cyl", pos: [0.0175, -0.1, 0.022], radius: 65e-4, length: 4e-3, axis: "x", bore: 3e-3, bevel: 6e-4, segments: 16, mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0.027, 0.47, 0.038], radius: 65e-4, length: 4e-3, axis: "x", bore: 3e-3, bevel: 6e-4, segments: 16, mat: "gun_steel_bare" },
      { shape: "profile", pts: [[-0.0615, -0.0154], [-0.0263, -0.0229], [-0.0245, -0.0239], [-0.0233, -0.0256], [-0.0232, -0.0277], [-0.0263, -0.0419], [-0.0263, -0.0421], [-0.0263, -0.0423], [-0.0263, -0.0426], [-0.0266, -0.0486], [-0.0267, -0.0493], [-0.0269, -0.05], [-0.0273, -0.0506], [-0.0309, -0.0562], [-0.0313, -0.0569], [-0.0315, -0.0576], [-0.0315, -0.0584], [-0.0315, -0.0711], [-0.0316, -0.0718], [-0.0318, -0.0726], [-0.0321, -0.0733], [-0.0357, -0.0788], [-0.0361, -0.0795], [-0.0363, -0.0802], [-0.0364, -0.081], [-0.0363, -0.0937], [-0.0364, -0.0944], [-0.0366, -0.0952], [-0.0369, -0.0959], [-0.0405, -0.1014], [-0.0409, -0.1021], [-0.0411, -0.1028], [-0.0412, -0.1036], [-0.0413, -0.1173], [-0.0414, -0.1181], [-0.0416, -0.1188], [-0.0419, -0.1195], [-0.0447, -0.1237], [-0.0458, -0.1249], [-0.0473, -0.1255], [-0.0489, -0.1255], [-0.0785, -0.1192], [-0.08, -0.1185], [-0.0812, -0.1172], [-0.0816, -0.1156], [-0.0828, -0.1028], [-0.0828, -0.1024], [-0.0827, -0.1019], [-0.0826, -0.1015], [-0.0683, -0.0469], [-0.0682, -0.0465], [-0.0681, -0.046], [-0.0681, -0.0455], [-0.0706, -0.0205], [-0.0706, -0.0201], [-0.0706, -0.0197], [-0.0705, -0.0193], [-0.07, -0.0167], [-0.0693, -0.0153], [-0.0679, -0.0145], [-0.0664, -0.0144]], width: 0.03, bevel: 3e-3, plane: "yz", pos: [0, 0, 0], smooth: 45, mat: "poly_black_grip" },
      { shape: "profile", pts: [[-0.0819, -0.121], [-0.0817, -0.1221], [-0.0808, -0.1228], [-0.0477, -0.1298], [-0.0466, -0.1296], [-0.0459, -0.1286], [-0.0453, -0.1257], [-0.0455, -0.1246], [-0.0464, -0.1239], [-0.0795, -0.1169], [-0.0806, -0.1171], [-0.0813, -0.1181]], width: 0.031, bevel: 1e-3, plane: "yz", pos: [0, 0, 0], mat: "poly_black" },
      { shape: "profile", pts: [[0, 0], [4e-3, 0], [65e-4, -8e-3], [6e-3, -0.016], [25e-4, -0.024], [-1e-3, -0.025], [1e-3, -0.016], [15e-4, -8e-3]], width: 55e-4, bevel: 6e-4, plane: "yz", pos: [0, 0, -0.016], group: "trigger", mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0, 2e-3, -0.015], radius: 16e-4, length: 0.03, axis: "x", segments: 10, lod: false, mat: "gun_steel_bare" },
      { shape: "sweep", path: [[0, -0.026, -0.02], [0, -0.026, -0.037], [0, -0.0255, -0.0397], [0, -0.0239, -0.0419], [0, -0.0217, -0.0435], [0, -0.019, -0.044], [0, 0.038, -0.044], [0, 0.0407, -0.0435], [0, 0.0429, -0.0419], [0, 0.0445, -0.0397], [0, 0.045, -0.037], [0, 0.045, -0.02]], section: { kind: "rect", w: 0.014, h: 4e-3, c: 12e-4 }, mat: "gun_anodized_fde" },
      { shape: "profile", pts: [[0.05, -5e-3], [0.0506, -36e-4], [0.052, -3e-3], [0.128, -3e-3], [0.1294, -36e-4], [0.13, -5e-3], [0.13, -0.033], [0.1294, -0.0344], [0.128, -0.035], [0.052, -0.035], [0.0506, -0.0344], [0.05, -0.033]], width: 0.034, bevel: 12e-4, plane: "yz", pos: [0, 0, 0], mat: "gun_anodized_fde" },
      { shape: "profile", pts: [[0.0525, -0.022], [0.0531, -0.0206], [0.0545, -0.02], [0.1255, -0.02], [0.1269, -0.0206], [0.1275, -0.022], [0.1275, -0.067], [0.1266, -0.0691], [0.1245, -0.07], [0.0555, -0.07], [0.0534, -0.0691], [0.0525, -0.067]], width: 0.026, bevel: 12e-4, plane: "yz", pos: [0, 0, 0], group: "mag", mat: "gun_parkerized_dark" },
      { shape: "profile", pts: [[0.0497, -0.0758], [0.0502, -0.0773], [0.0517, -0.078], [0.1293, -0.078], [0.1308, -0.0773], [0.1313, -0.0758], [0.1307, -0.0698], [0.13, -0.0685], [0.1287, -0.068], [0.0523, -0.068], [0.051, -0.0685], [0.0503, -0.0698]], width: 0.03, bevel: 15e-4, plane: "yz", pos: [0, 0, 0], group: "mag", mat: "gun_parkerized_dark" },
      { shape: "box", pos: [0, 0.09, -0.018], size: [0.022, 0.065, 4e-3], bevel: 8e-4, group: "mag", lod: false, mat: "poly_follower" },
      { shape: "cyl", pos: [0, 0.092, -0.0145], radius: 45e-4, length: 0.059, axis: "y", segments: 12, group: "mag", lod: false, mat: "gun_brass" },
      { shape: "cyl", pos: [0, 0.475, 0.042], radius: 0.0125, radius2: 0.0105, length: 0.65, axis: "y", segments: 24, mat: "gun_parkerized_dark" },
      { shape: "slot", pos: [0.0119, 0.475, 0.042], length: 0.39, width: 34e-4, depth: 9e-4, plane: "yz", hpr: [0, 0, 0], lod: false, mat: "shadow" },
      { shape: "slot", pos: [6e-3, 0.475, 0.0523], length: 0.39, width: 34e-4, depth: 9e-4, plane: "yz", hpr: [0, 0, -60], lod: false, mat: "shadow" },
      { shape: "slot", pos: [-59e-4, 0.475, 0.0523], length: 0.39, width: 34e-4, depth: 9e-4, plane: "yz", hpr: [0, 0, -120], lod: false, mat: "shadow" },
      { shape: "slot", pos: [-0.0119, 0.475, 0.042], length: 0.39, width: 34e-4, depth: 9e-4, plane: "yz", hpr: [0, 0, -180], lod: false, mat: "shadow" },
      { shape: "slot", pos: [-6e-3, 0.475, 0.0317], length: 0.39, width: 34e-4, depth: 9e-4, plane: "yz", hpr: [0, 0, -240], lod: false, mat: "shadow" },
      { shape: "slot", pos: [6e-3, 0.475, 0.0317], length: 0.39, width: 34e-4, depth: 9e-4, plane: "yz", hpr: [0, 0, -300], lod: false, mat: "shadow" },
      { shape: "loft", kind: "rect", sections: [{ y: 0.8, w: 0.031, h: 0.031, z: 0.042, c: 93e-4 }, { y: 0.87, w: 0.031, h: 0.031, z: 0.042, c: 93e-4 }], mat: "gun_parkerized_dark" },
      { shape: "cyl", pos: [0, 0.8703, 0.042], radius: 7e-3, length: 8e-4, axis: "y", segments: 16, lod: false, wear: false, mat: "shadow" },
      { shape: "slot", pos: [0.0159, 0.8175, 0.042], length: 0.0186, width: 6e-3, depth: 15e-4, plane: "yz", hpr: [0, 90, 0], lod: false, mat: "shadow", mirror: "x" },
      { shape: "slot", pos: [0.0159, 0.835, 0.042], length: 0.0186, width: 6e-3, depth: 15e-4, plane: "yz", hpr: [0, 90, 0], lod: false, mat: "shadow", mirror: "x" },
      { shape: "slot", pos: [0.0159, 0.8525, 0.042], length: 0.0186, width: 6e-3, depth: 15e-4, plane: "yz", hpr: [0, 90, 0], lod: false, mat: "shadow", mirror: "x" },
      { shape: "box", pos: [0, 0.5, 8e-3], size: [0.03, 0.03, 0.014], bevel: 2e-3, mat: "gun_parkerized_dark" },
      { shape: "cyl", pos: [9e-3, 0.4, 6e-3], radius: 55e-4, length: 0.2, axis: "y", segments: 14, mat: "gun_anodized" },
      { shape: "cyl", pos: [9e-3, 0.3, 6e-3], radius: 75e-4, length: 0.02, axis: "y", segments: 14, mat: "gun_rubber_pad" },
      { shape: "cyl", pos: [-9e-3, 0.4, 6e-3], radius: 55e-4, length: 0.2, axis: "y", segments: 14, mat: "gun_anodized" },
      { shape: "cyl", pos: [-9e-3, 0.3, 6e-3], radius: 75e-4, length: 0.02, axis: "y", segments: 14, mat: "gun_rubber_pad" },
      { shape: "loft", kind: "ellipse", sections: [{ y: -0.115, w: 0.04, h: 0.04, z: 0.0942 }, { y: -0.065, w: 0.04, h: 0.04, z: 0.0942 }, { y: -0.04, w: 0.0254, h: 0.0254, z: 0.0942 }, { y: 0.13, w: 0.0254, h: 0.0254, z: 0.0942 }, { y: 0.17, w: 0.05, h: 0.05, z: 0.0942 }, { y: 0.215, w: 0.05, h: 0.05, z: 0.0942 }], segments: 28, caps: false, mat: "gun_anodized" },
      { shape: "cyl", pos: [0, 0.05, 0.0942], radius: 0.0121, length: 0.326, axis: "y", bore: 0.0111, segments: 24, wear: false, lod: false, mat: "shadow" },
      { shape: "cyl", pos: [0, 0.2125, 0.0942], radius: 0.0242, length: 4e-3, axis: "y", bore: 0.0222, segments: 28, wear: false, mat: "gun_anodized" },
      { shape: "cyl", pos: [0, -0.1125, 0.0942], radius: 0.0192, length: 4e-3, axis: "y", bore: 0.0172, segments: 28, wear: false, mat: "gun_anodized" },
      { shape: "cyl", pos: [0, 0.2154, 0.0942], radius: 0.023, length: 1e-3, axis: "y", segments: 28, wear: false, mat: "gun_glass" },
      { shape: "cyl", pos: [0, -0.1154, 0.0942], radius: 0.018, length: 1e-3, axis: "y", segments: 28, wear: false, mat: "gun_glass" },
      { shape: "torus", pos: [0, -0.103, 0.0942], radius: 0.0203, tube: 12e-4, axis: "y", mat: "gun_rubber_pad" },
      { shape: "torus", pos: [0, 0.211, 0.0942], radius: 0.0253, tube: 1e-3, axis: "y", mat: "gun_anodized" },
      { shape: "cyl", pos: [0, 0.06, 0.1139], radius: 0.011, length: 0.014, axis: "z", segments: 20, mat: "gun_knurl" },
      { shape: "cyl", pos: [0, 0.06, 0.1074], radius: 8e-3, length: 4e-3, axis: "z", segments: 18, mat: "gun_anodized" },
      { shape: "cyl", pos: [0.0197, 0.06, 0.0942], radius: 0.011, length: 0.014, axis: "x", segments: 20, mat: "gun_knurl" },
      { shape: "cyl", pos: [-0.0187, 0.06, 0.0942], radius: 9e-3, length: 0.012, axis: "x", segments: 18, mat: "gun_anodized" },
      { shape: "cyl", pos: [0, -0.053, 0.0942], radius: 0.0157, length: 0.018, axis: "y", segments: 24, mat: "gun_knurl" },
      { shape: "box", pos: [0, 0.06, 0.0942], size: [0.0314, 0.03, 0.0203], bevel: 3e-3, mat: "gun_anodized" },
      { shape: "profile", pts: [[-0.016, 0], [0.016, 0], [0.0135, 8e-3], [0.0135, 0.0227], [0.0127, 0.0257], [0.0105, 0.0279], [75e-4, 0.0287], [-75e-4, 0.0287], [-0.0105, 0.0279], [-0.0127, 0.0257], [-0.0135, 0.0227], [-0.0135, 8e-3]], width: 0.014, bevel: 8e-4, plane: "xz", pos: [0, 5e-3, 0.0655], mat: "gun_anodized" },
      { shape: "torus", pos: [0, 5e-3, 0.0942], radius: 0.0151, tube: 26e-4, axis: "y", mat: "gun_anodized" },
      { shape: "cyl", pos: [0.0145, 5e-3, 0.0695], radius: 35e-4, length: 4e-3, axis: "x", segments: 10, lod: false, mat: "gun_steel_bare" },
      { shape: "profile", pts: [[-0.016, 0], [0.016, 0], [0.0135, 8e-3], [0.0135, 0.0227], [0.0127, 0.0257], [0.0105, 0.0279], [75e-4, 0.0287], [-75e-4, 0.0287], [-0.0105, 0.0279], [-0.0127, 0.0257], [-0.0135, 0.0227], [-0.0135, 8e-3]], width: 0.014, bevel: 8e-4, plane: "xz", pos: [0, 0.11, 0.0655], mat: "gun_anodized" },
      { shape: "torus", pos: [0, 0.11, 0.0942], radius: 0.0151, tube: 26e-4, axis: "y", mat: "gun_anodized" },
      { shape: "cyl", pos: [0.0145, 0.11, 0.0695], radius: 35e-4, length: 4e-3, axis: "x", segments: 10, lod: false, mat: "gun_steel_bare" },
      { shape: "slot", pos: [0, -0.1156, 0.0942], length: 5e-3, width: 12e-4, depth: 2e-4, plane: "xz", lod: false, mat: "shadow" }
    ],
    anchors: { muzzle: [0, 0.87, 0.042], eject: [0.019, 0.065, 0.045], sight: [0, -0.19, 0.0942], grip_r: [0, -0.0498, -0.0662], grip_l: [0, 0.33, 8e-3], mag: [0, 0.09, -0.045] },
    bounds: { min: [-0.027, -0.445, -0.1298], max: [0.0605, 0.8707, 0.1209] },
    groups: { bolt: { pivot: [0, 0, 0.042] }, trigger: { pivot: [0, 0, -0.016] } },
    viewmodel: { offset: [0.13, 0.37, -0.165], ads_distance: 0.14, elbow_r: [0.28, -0.14, -0.38], elbow_l: [-0.22, 0.04, -0.4] },
    sight_check: false
  },
  shotgun_s12: {
    parts: [
      { shape: "profile", pts: [[-0.08, 7e-3], [-0.0798, 59e-4], [-0.0791, 49e-4], [-0.0781, 42e-4], [-0.077, 4e-3], [0.127, 4e-3], [0.1281, 42e-4], [0.1291, 49e-4], [0.1298, 59e-4], [0.13, 7e-3], [0.13, 0.0605], [0.1297, 0.0624], [0.1288, 0.0641], [0.1274, 0.0654], [0.1257, 0.0663], [0.1114, 0.0706], [0.1107, 0.0708], [0.11, 0.0709], [0.1093, 0.071], [0.1085, 0.071], [-0.0581, 0.071], [-0.059, 0.071], [-0.06, 0.0708], [-0.0609, 0.0706], [-0.0618, 0.0703], [-0.0775, 0.064], [-0.0785, 0.0634], [-0.0793, 0.0625], [-0.0798, 0.0615], [-0.08, 0.0603]], width: 0.036, bevel: 18e-4, plane: "yz", pos: [0, 0, 0], smooth: 40, mat: "gun_anodized" },
      { shape: "box", pos: [0.0181, 0.045, 0.051], size: [8e-4, 0.07, 0.022], bevel: 0, lod: false, wear: false, mat: "shadow" },
      { shape: "box", pos: [0.0172, 0.04, 0.051], size: [18e-4, 0.05, 0.014], bevel: 6e-4, group: "pump", lod: false, mat: "gun_steel_bare" },
      { shape: "box", pos: [0, 0.05, 35e-4], size: [0.026, 0.09, 8e-4], bevel: 0, lod: false, wear: false, mat: "shadow" },
      { shape: "box", pos: [0, 0.05, 6e-3], size: [0.02, 0.06, 4e-3], bevel: 6e-4, lod: false, mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0, -0.04, 0.071], radius: 45e-4, length: 6e-3, axis: "z", segments: 14, mat: "poly_follower" },
      { shape: "cyl", pos: [0, -0.05, 0.015], radius: 28e-4, length: 0.0372, axis: "x", segments: 12, lod: false, mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0, 0.1, 0.015], radius: 28e-4, length: 0.0372, axis: "x", segments: 12, lod: false, mat: "gun_steel_bare" },
      { shape: "profile", pts: [[-6e-3, -1e-3], [-57e-4, -17e-4], [-5e-3, -2e-3], [0.011, -2e-3], [0.0117, -17e-4], [0.012, -1e-3], [0.012, 1e-3], [0.0117, 17e-4], [0.011, 2e-3], [-5e-3, 2e-3], [-57e-4, 17e-4], [-6e-3, 1e-3]], width: 2e-3, bevel: 3e-4, plane: "yz", pos: [-0.0185, 0, 0.01], mat: "gun_anodized" },
      { shape: "cyl", pos: [0, 0.4, 0.045], radius: 0.0118, radius2: 0.0112, length: 0.54, axis: "y", segments: 24, mat: "gun_blued" },
      { shape: "box", pos: [0, 0.4, 0.0595], size: [7e-3, 0.53, 2e-3], bevel: 5e-4, mat: "gun_blued" },
      { shape: "box", pos: [0, 0.15, 0.057], size: [4e-3, 6e-3, 4e-3], bevel: 4e-4, lod: false, mat: "gun_blued", repeat: { count: 18, step: [0, 0.03, 0] } },
      { shape: "sphere", pos: [0, 0.66, 0.063], radius: 22e-4, mat: "gun_brass" },
      { shape: "cyl", pos: [0, 0.39, 0.018], radius: 0.0122, length: 0.52, axis: "y", segments: 22, mat: "gun_blued" },
      { shape: "cyl", pos: [0, 0.66, 0.018], radius: 0.0135, length: 0.028, axis: "y", bevel: 1e-3, segments: 22, mat: "gun_knurl" },
      { shape: "cyl", pos: [0, 0.675, 0.018], radius: 8e-3, length: 8e-3, axis: "y", bevel: 8e-4, segments: 18, mat: "gun_anodized" },
      { shape: "box", pos: [0, 0.6, 0.0315], size: [0.016, 0.02, 0.05], bevel: 3e-3, mat: "gun_anodized" },
      { shape: "torus", pos: [0, 0.6, 0], radius: 75e-4, tube: 16e-4, axis: "y", mat: "gun_steel_bare" },
      { shape: "loft", kind: "rect", sections: [{ y: 0.2, w: 0.044, h: 0.042, z: 0.021, c: 0.016 }, { y: 0.215, w: 0.05, h: 0.05, z: 0.02, c: 0.018 }, { y: 0.37, w: 0.05, h: 0.05, z: 0.02, c: 0.018 }, { y: 0.385, w: 0.044, h: 0.042, z: 0.021, c: 0.016 }], group: "pump", mat: "poly_black" },
      { shape: "torus", pos: [0, 0.23, 0.02], radius: 0.024, tube: 22e-4, axis: "y", group: "pump", mat: "poly_black", repeat: { count: 8, step: [0, 0.018, 0] } },
      { shape: "box", pos: [0.0135, 0.12, 0.03], size: [3e-3, 0.18, 6e-3], bevel: 8e-4, group: "pump", lod: false, mat: "gun_steel_bare" },
      { shape: "box", pos: [-0.0135, 0.12, 0.03], size: [3e-3, 0.18, 6e-3], bevel: 8e-4, group: "pump", lod: false, mat: "gun_steel_bare" },
      { shape: "profile", pts: [[-0.078, 0.0599], [-0.0783, 0.0613], [-0.079, 0.0626], [-0.0801, 0.0634], [-0.0815, 0.0639], [-0.0829, 0.0638], [-0.1568, 0.0458], [-0.1581, 0.0455], [-0.1594, 0.0452], [-0.1607, 0.045], [-0.1619, 0.0448], [-0.1632, 0.0446], [-0.3593, 0.0231], [-0.3596, 0.023], [-0.3598, 0.023], [-0.3601, 0.0229], [-0.3604, 0.0228], [-0.3606, 0.0227], [-0.3698, 0.0181], [-0.3705, 0.0176], [-0.3711, 0.017], [-0.3716, 0.0162], [-0.3719, 0.0154], [-0.372, 0.0145], [-0.372, -0.1065], [-0.3718, -0.1076], [-0.3714, -0.1087], [-0.3706, -0.1095], [-0.3696, -0.1102], [-0.3685, -0.1105], [-0.3527, -0.1126], [-0.3516, -0.1127], [-0.3506, -0.1127], [-0.3495, -0.1126], [-0.3485, -0.1123], [-0.3475, -0.1119], [-0.2002, -0.0501], [-0.2001, -0.0501], [-0.2, -0.05], [-0.2, -0.05], [-0.1999, -0.0499], [-0.1998, -0.0499], [-0.1217, -0.0177], [-0.121, -0.0174], [-0.1204, -0.0171], [-0.1197, -0.0168], [-0.119, -0.0164], [-0.1184, -0.0161], [-0.0908, -5e-4], [-0.0905, -3e-4], [-0.0902, -1e-4], [-0.0898, 0], [-0.0894, 2e-4], [-0.0891, 3e-4], [-0.0801, 33e-4], [-0.0794, 36e-4], [-0.0788, 41e-4], [-0.0784, 47e-4], [-0.0781, 54e-4], [-0.078, 62e-4]], width: 0.04, bevel: 45e-4, plane: "yz", pos: [0, 0, 0], smooth: 45, mat: "poly_black" },
      { shape: "profile", pts: [[-0.0875, 0.0449], [-0.0876, 0.0486], [-0.0899, 0.0516], [-0.0935, 0.0527], [-0.1292, 0.0512], [-0.1321, 0.0503], [-0.1342, 0.0482], [-0.135, 0.0452], [-0.135, 69e-4], [-0.134, 37e-4], [-0.1315, 15e-4], [-0.1282, 1e-3], [-0.1037, 45e-4], [-0.1016, 52e-4], [-0.0999, 66e-4], [-0.0989, 86e-4]], width: 0.0405, bevel: 8e-4, plane: "yz", pos: [0, 0, 0], mat: "poly_black_grip" },
      { shape: "profile", pts: [[0.01, 0.014], [0.0112, 0.0112], [0.014, 0.01], [0.116, 0.01], [0.1188, 0.0112], [0.12, 0.014], [0.12, 0.057], [0.1188, 0.0598], [0.116, 0.061], [0.014, 0.061], [0.0112, 0.0598], [0.01, 0.057]], width: 4e-3, bevel: 12e-4, plane: "yz", pos: [-0.02, 0, 0], mat: "poly_black" },
      { shape: "cyl", pos: [-0.0275, 0.025, 0.03], radius: 0.0103, length: 0.05, axis: "z", segments: 14, mat: "poly_red" },
      { shape: "cyl", pos: [-0.0275, 0.025, 2e-3], radius: 0.0108, length: 0.012, axis: "z", bevel: 6e-4, segments: 14, mat: "gun_brass" },
      { shape: "cyl", pos: [-0.0275, 0.051, 0.03], radius: 0.0103, length: 0.05, axis: "z", segments: 14, mat: "poly_red" },
      { shape: "cyl", pos: [-0.0275, 0.051, 2e-3], radius: 0.0108, length: 0.012, axis: "z", bevel: 6e-4, segments: 14, mat: "gun_brass" },
      { shape: "cyl", pos: [-0.0275, 0.077, 0.03], radius: 0.0103, length: 0.05, axis: "z", segments: 14, mat: "poly_red" },
      { shape: "cyl", pos: [-0.0275, 0.077, 2e-3], radius: 0.0108, length: 0.012, axis: "z", bevel: 6e-4, segments: 14, mat: "gun_brass" },
      { shape: "cyl", pos: [-0.0275, 0.103, 0.03], radius: 0.0103, length: 0.05, axis: "z", segments: 14, mat: "poly_red" },
      { shape: "cyl", pos: [-0.0275, 0.103, 2e-3], radius: 0.0108, length: 0.012, axis: "z", bevel: 6e-4, segments: 14, mat: "gun_brass" },
      { shape: "profile", pts: [[-0.371, 0.0187], [-0.3713, 0.0198], [-0.3722, 0.0205], [-0.3733, 0.0207], [-0.3808, 0.0197], [-0.3834, 0.0187], [-0.3853, 0.0165], [-0.386, 0.0137], [-0.386, -0.1077], [-0.385, -0.111], [-0.3823, -0.1132], [-0.3788, -0.1136], [-0.3726, -0.1123], [-0.3718, -0.1119], [-0.3712, -0.1112], [-0.371, -0.1104]], width: 0.044, bevel: 3e-3, plane: "yz", pos: [0, 0, 0], mat: "gun_rubber_pad" },
      { shape: "torus", pos: [0, -0.3, -0.095], radius: 75e-4, tube: 16e-4, axis: "y", mat: "gun_steel_bare" },
      { shape: "profile", pts: [[0, 0], [4e-3, 0], [65e-4, -8e-3], [6e-3, -0.016], [25e-4, -0.024], [-1e-3, -0.025], [1e-3, -0.016], [15e-4, -8e-3]], width: 55e-4, bevel: 6e-4, plane: "yz", pos: [0, 0, 0], group: "trigger", mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0, 2e-3, 1e-3], radius: 16e-4, length: 0.03, axis: "x", segments: 10, lod: false, mat: "gun_steel_bare" },
      { shape: "sweep", path: [[0, -0.035, -4e-3], [0, -0.035, -0.023], [0, -0.0345, -0.0257], [0, -0.0329, -0.0279], [0, -0.0307, -0.0295], [0, -0.028, -0.03], [0, 0.043, -0.03], [0, 0.0457, -0.0295], [0, 0.0479, -0.0279], [0, 0.0495, -0.0257], [0, 0.05, -0.023], [0, 0.05, -4e-3]], section: { kind: "rect", w: 0.014, h: 4e-3, c: 12e-4 }, mat: "gun_anodized" }
    ],
    anchors: { muzzle: [0, 0.67, 0.045], eject: [0.02, 0.045, 0.051], sight: [0, -0.06, 0.075], grip_r: [0, -0.1, 0.015], grip_l: [0, 0.29, -8e-3], mag: [0, 0.05, 0] },
    bounds: { min: [-0.0383, -0.386, -0.1136], max: [0.0262, 0.679, 0.074] },
    groups: { pump: { pivot: [0, 0, 0] }, trigger: { pivot: [0, 0, 0] } },
    viewmodel: { offset: [0.125, 0.35, -0.155], ads_distance: 0.3, elbow_r: [0.28, -0.12, -0.38], elbow_l: [-0.22, 0.02, -0.4] },
    sight_check: false
  },
  knife_k3: {
    parts: [
      { shape: "profile", pts: [[0, -0.012], [0.1174, -0.012], [0.1184, -0.012], [0.1195, -0.0119], [0.1205, -0.0118], [0.1216, -0.0117], [0.1226, -0.0115], [0.1612, -47e-4], [0.1627, -44e-4], [0.1642, -4e-3], [0.1656, -35e-4], [0.1671, -3e-3], [0.1685, -24e-4], [0.1958, 0.0101], [0.1962, 0.0104], [0.1964, 0.0109], [0.1963, 0.0115], [0.1959, 0.0119], [0.1954, 0.012], [0.1702, 0.012], [0.1701, 0.012], [0.17, 0.012], [0.17, 0.012], [0.1699, 0.012], [0.1698, 0.012], [0.1305, 0.016], [0.1303, 0.016], [0.1301, 0.016], [0.1299, 0.016], [0.1297, 0.016], [0.1295, 0.016], [0, 0.016]], width: 5e-3, bevel: 22e-4, plane: "yz", pos: [0, 0, 0], smooth: 30, mat: "gun_cerakote_black" },
      { shape: "slot", pos: [26e-4, 0.07, 6e-3], length: 0.09, width: 5e-3, depth: 6e-4, plane: "yz", lod: false, mat: "shadow" },
      { shape: "slot", pos: [-26e-4, 0.07, 6e-3], length: 0.09, width: 5e-3, depth: 6e-4, plane: "yz", lod: false, mat: "shadow" },
      { shape: "profile", pts: [[0, 0], [6e-3, 0], [3e-3, 4e-3]], width: 46e-4, bevel: 0, plane: "yz", pos: [0, 0.02, 0.015], mat: "gun_cerakote_black", repeat: { count: 7, step: [0, 65e-4, 0] } },
      { shape: "profile", pts: [[-4e-3, -0.021], [-31e-4, -0.0231], [-1e-3, -0.024], [1e-3, -0.024], [31e-4, -0.0231], [4e-3, -0.021], [4e-3, 0.023], [31e-4, 0.0251], [1e-3, 0.026], [-1e-3, 0.026], [-31e-4, 0.0251], [-4e-3, 0.023]], width: 0.02, bevel: 15e-4, plane: "yz", pos: [0, 0, 0], mat: "gun_parkerized_dark" },
      { shape: "profile", pts: [[-4e-3, -0.0103], [-45e-4, -0.0122], [-58e-4, -0.0137], [-77e-4, -0.0143], [-0.0291, -0.0159], [-0.0297, -0.0159], [-0.0303, -0.0158], [-0.0309, -0.0157], [-0.0385, -0.0126], [-0.0395, -0.0123], [-0.0405, -0.0123], [-0.0415, -0.0126], [-0.0486, -0.0155], [-0.0495, -0.0157], [-0.0505, -0.0157], [-0.0514, -0.0155], [-0.0608, -0.0124], [-0.0616, -0.0122], [-0.0624, -0.0122], [-0.0632, -0.0124], [-0.0744, -0.0158], [-0.0748, -0.0159], [-0.0752, -0.016], [-0.0756, -0.016], [-0.1035, -0.016], [-0.1045, -0.0159], [-0.1053, -0.0156], [-0.1061, -0.015], [-0.1106, -0.0112], [-0.1114, -0.0103], [-0.1118, -93e-4], [-0.112, -82e-4], [-0.112, 0.0131], [-0.1117, 0.0147], [-0.1107, 0.0161], [-0.1093, 0.0169], [-0.1007, 0.0198], [-0.1002, 0.0199], [-0.0998, 0.02], [-0.0993, 0.02], [-79e-4, 0.0181], [-6e-3, 0.0175], [-45e-4, 0.0161], [-4e-3, 0.0141]], width: 0.024, bevel: 4e-3, plane: "yz", pos: [0, 0, 0], smooth: 50, mat: "poly_black_grip" },
      { shape: "profile", pts: [[-0.112, -85e-4], [-0.1125, -0.0101], [-0.1138, -0.0112], [-0.1155, -0.0114], [-0.1219, -0.0104], [-0.123, -99e-4], [-0.1239, -9e-3], [-0.1244, -79e-4], [-0.1259, 15e-4], [-0.126, 18e-4], [-0.126, 22e-4], [-0.1259, 25e-4], [-0.1243, 0.0122], [-0.1239, 0.0132], [-0.1232, 0.0141], [-0.1223, 0.0146], [-0.1159, 0.0167], [-0.1141, 0.0167], [-0.1126, 0.0156], [-0.112, 0.0138]], width: 0.02, bevel: 2e-3, plane: "yz", pos: [0, 0, 0], mat: "gun_parkerized_dark" },
      { shape: "torus", pos: [0, -0.119, 2e-3], radius: 45e-4, tube: 16e-4, axis: "x", mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0, -0.03, 2e-3], radius: 35e-4, length: 0.0245, axis: "x", segments: 14, mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0, -0.08, 2e-3], radius: 35e-4, length: 0.0245, axis: "x", segments: 14, mat: "gun_steel_bare" }
    ],
    anchors: { muzzle: [0, 0.2, 0], eject: [0, 0, 0], sight: [0, 0, 0.05], grip_r: [0, -0.055, 0], grip_l: [-0.2, -0.1, -0.2], mag: [0, 0, 0] },
    bounds: { min: [-0.0123, -0.126, -0.024], max: [0.0123, 0.1964, 0.026] },
    viewmodel: { offset: [0.15, 0.3, -0.16], ads_distance: 0.3, hpr: [-10, 0, -15], one_handed: true, elbow_r: [0.26, -0.1, -0.36], elbow_l: [-0.3, -0.1, -0.4] }
  },
  pistol_rv6: {
    parts: [
      { shape: "profile", pts: [[-0.045, 19e-4], [-0.0444, 5e-4], [-0.0431, -1e-4], [0.0599, -39e-4], [0.0614, -34e-4], [0.062, -19e-4], [0.062, 0.012], [-0.045, 0.012]], width: 0.026, bevel: 15e-4, plane: "yz", pos: [0, 0, 0], mat: "gun_blued" },
      { shape: "profile", pts: [[-0.045, 2e-3], [-0.0447, 1e-3], [-0.044, 3e-4], [-0.043, 0], [-0.01, 0], [-0.01, 0.05], [-0.0201, 0.05], [-0.0213, 0.0499], [-0.0225, 0.0495], [-0.0235, 0.0489], [-0.0433, 0.0352], [-0.0442, 0.0343], [-0.0448, 0.0332], [-0.045, 0.0319]], width: 0.028, bevel: 15e-4, plane: "yz", pos: [0, 0, 0], mat: "gun_blued" },
      { shape: "profile", pts: [[0.042, 0], [0.06, 0], [0.0614, 6e-4], [0.062, 2e-3], [0.062, 0.047], [0.0611, 0.0491], [0.059, 0.05], [0.042, 0.05]], width: 0.026, bevel: 15e-4, plane: "yz", pos: [0, 0, 0], mat: "gun_blued" },
      { shape: "box", pos: [0, 0.016, 0.0505], size: [0.024, 0.064, 8e-3], bevel: 15e-4, mat: "gun_blued" },
      { shape: "box", pos: [0, 0.016, 0.0548], size: [4e-3, 0.064, 14e-4], bevel: 0, lod: false, wear: false, mat: "shadow" },
      { shape: "cyl", pos: [0, 0.041, 0.03], radius: 42e-4, length: 3e-3, axis: "y", segments: 14, lod: false, mat: "gun_steel_bare" },
      { shape: "box", pos: [4e-3, -0.014, 0.0555], size: [4e-3, 6e-3, 6e-3], bevel: 6e-4, mat: "gun_blued" },
      { shape: "box", pos: [-4e-3, -0.014, 0.0555], size: [4e-3, 6e-3, 6e-3], bevel: 6e-4, mat: "gun_blued" },
      { shape: "cyl", pos: [0, 0.12, 0.034], radius: 95e-4, length: 0.12, axis: "y", bevel: 1e-3, segments: 24, mat: "gun_blued" },
      { shape: "box", pos: [0, 0.12, 0.0425], size: [0.012, 0.12, 9e-3], bevel: 2e-3, mat: "gun_blued" },
      { shape: "slot", pos: [0, 0.075, 0.0472], length: 0.012, width: 4e-3, depth: 8e-4, plane: "xy", hpr: [90, 0, 0], lod: false, mat: "shadow", repeat: { count: 5, step: [0, 0.02, 0] } },
      { shape: "box", pos: [0, 0.12, 0.018], size: [0.02, 0.12, 0.016], bevel: 3e-3, mat: "gun_blued" },
      { shape: "cyl", pos: [0, 0.1808, 0.034], radius: 42e-4, length: 8e-4, axis: "y", segments: 14, lod: false, wear: false, mat: "shadow" },
      { shape: "cyl", pos: [0, 0.1804, 0.018], radius: 35e-4, length: 8e-4, axis: "y", segments: 12, lod: false, mat: "gun_blued" },
      { shape: "profile", pts: [[0, 0], [0.012, 0], [4e-3, 0.012], [0, 0.012]], width: 32e-4, bevel: 4e-4, plane: "yz", pos: [0, 0.166, 0.047], mat: "gun_blued" },
      { shape: "box", pos: [0, 0.169, 0.053], size: [34e-4, 4e-3, 6e-3], bevel: 4e-4, mat: "poly_red" },
      { shape: "cyl", pos: [0, 0.016, 0.03], radius: 0.0185, length: 0.048, axis: "y", bevel: 18e-4, segments: 36, group: "cylinder", mat: "gun_blued" },
      { shape: "slot", pos: [0.0164, 0.02, 0.0394], length: 0.026, width: 6e-3, depth: 14e-4, plane: "yz", hpr: [0, 0, -30], group: "cylinder", lod: false, mat: "shadow" },
      { shape: "cyl", pos: [0.0108, 0.0404, 0.03], radius: 46e-4, length: 12e-4, axis: "y", segments: 12, group: "cylinder", lod: false, wear: false, mat: "shadow" },
      { shape: "cyl", pos: [0.0108, -84e-4, 0.03], radius: 58e-4, length: 12e-4, axis: "y", segments: 12, group: "cylinder", lod: false, mat: "gun_brass" },
      { shape: "slot", pos: [0, 0.02, 0.0489], length: 0.026, width: 6e-3, depth: 14e-4, plane: "yz", hpr: [0, 0, -90], group: "cylinder", lod: false, mat: "shadow" },
      { shape: "cyl", pos: [54e-4, 0.0404, 0.0394], radius: 46e-4, length: 12e-4, axis: "y", segments: 12, group: "cylinder", lod: false, wear: false, mat: "shadow" },
      { shape: "cyl", pos: [54e-4, -84e-4, 0.0394], radius: 58e-4, length: 12e-4, axis: "y", segments: 12, group: "cylinder", lod: false, mat: "gun_brass" },
      { shape: "slot", pos: [-0.0164, 0.02, 0.0394], length: 0.026, width: 6e-3, depth: 14e-4, plane: "yz", hpr: [0, 0, -150], group: "cylinder", lod: false, mat: "shadow" },
      { shape: "cyl", pos: [-54e-4, 0.0404, 0.0394], radius: 46e-4, length: 12e-4, axis: "y", segments: 12, group: "cylinder", lod: false, wear: false, mat: "shadow" },
      { shape: "cyl", pos: [-54e-4, -84e-4, 0.0394], radius: 58e-4, length: 12e-4, axis: "y", segments: 12, group: "cylinder", lod: false, mat: "gun_brass" },
      { shape: "slot", pos: [-0.0164, 0.02, 0.0205], length: 0.026, width: 6e-3, depth: 14e-4, plane: "yz", hpr: [0, 0, -210], group: "cylinder", lod: false, mat: "shadow" },
      { shape: "cyl", pos: [-0.0108, 0.0404, 0.03], radius: 46e-4, length: 12e-4, axis: "y", segments: 12, group: "cylinder", lod: false, wear: false, mat: "shadow" },
      { shape: "cyl", pos: [-0.0108, -84e-4, 0.03], radius: 58e-4, length: 12e-4, axis: "y", segments: 12, group: "cylinder", lod: false, mat: "gun_brass" },
      { shape: "slot", pos: [0, 0.02, 0.0111], length: 0.026, width: 6e-3, depth: 14e-4, plane: "yz", hpr: [0, 0, -270], group: "cylinder", lod: false, mat: "shadow" },
      { shape: "cyl", pos: [-54e-4, 0.0404, 0.0206], radius: 46e-4, length: 12e-4, axis: "y", segments: 12, group: "cylinder", lod: false, wear: false, mat: "shadow" },
      { shape: "cyl", pos: [-54e-4, -84e-4, 0.0206], radius: 58e-4, length: 12e-4, axis: "y", segments: 12, group: "cylinder", lod: false, mat: "gun_brass" },
      { shape: "slot", pos: [0.0164, 0.02, 0.0205], length: 0.026, width: 6e-3, depth: 14e-4, plane: "yz", hpr: [0, 0, -330], group: "cylinder", lod: false, mat: "shadow" },
      { shape: "cyl", pos: [54e-4, 0.0404, 0.0206], radius: 46e-4, length: 12e-4, axis: "y", segments: 12, group: "cylinder", lod: false, wear: false, mat: "shadow" },
      { shape: "cyl", pos: [54e-4, -84e-4, 0.0206], radius: 58e-4, length: 12e-4, axis: "y", segments: 12, group: "cylinder", lod: false, mat: "gun_brass" },
      { shape: "cyl", pos: [0, -9e-3, 0.03], radius: 42e-4, length: 2e-3, axis: "y", segments: 14, group: "cylinder", lod: false, mat: "gun_steel_bare" },
      { shape: "profile", pts: [[-43e-4, -48e-4], [-37e-4, -57e-4], [-28e-4, -6e-3], [25e-4, -6e-3], [36e-4, -56e-4], [4e-3, -45e-4], [4e-3, 96e-4], [39e-4, 0.01], [38e-4, 0.0103], [-37e-4, 0.0235], [-41e-4, 0.0239], [-45e-4, 0.0242], [-0.0143, 0.0274], [-0.0156, 0.0273], [-0.0163, 0.0263], [-0.0169, 0.0227], [-0.0168, 0.022], [-0.0165, 0.0215], [-83e-4, 0.0123], [-8e-3, 0.012], [-79e-4, 0.0116]], width: 75e-4, bevel: 8e-4, plane: "yz", pos: [0, -0.036, 0.034], group: "hammer", mat: "gun_blued" },
      { shape: "box", pos: [0, -0.049, 0.06], size: [8e-3, 8e-3, 3e-3], bevel: 4e-4, hpr: [0, 20, 0], group: "hammer", lod: false, mat: "gun_knurl" },
      { shape: "profile", pts: [[-8e-3, -18e-4], [-76e-4, -26e-4], [-68e-4, -3e-3], [48e-4, -3e-3], [56e-4, -26e-4], [6e-3, -18e-4], [6e-3, 18e-4], [56e-4, 26e-4], [48e-4, 3e-3], [-68e-4, 3e-3], [-76e-4, 26e-4], [-8e-3, 18e-4]], width: 3e-3, bevel: 4e-4, plane: "yz", pos: [-0.0155, -0.022, 0.034], mat: "gun_steel_bare" },
      { shape: "profile", pts: [[0, 0], [5e-3, 0], [75e-4, -9e-3], [6e-3, -0.018], [2e-3, -0.021], [2e-3, -9e-3]], width: 6e-3, bevel: 5e-4, plane: "yz", pos: [0, 0, -4e-3], group: "trigger", mat: "gun_steel_bare" },
      { shape: "sweep", path: [[0, -0.024, -4e-3], [0, -0.0226, -0.0217], [0, -0.0218, -0.0249], [0, -0.0198, -0.0276], [0, -0.0169, -0.0294], [0, -0.0137, -0.03], [0, 0.0154, -0.03], [0, 0.0182, -0.0295], [0, 0.0207, -0.0282], [0, 0.0227, -0.0262], [0, 0.024, -0.0236], [0, 0.03, -4e-3]], section: { kind: "rect", w: 0.01, h: 4e-3, c: 12e-4 }, mat: "gun_blued" },
      { shape: "profile", pts: [[-0.0179, -69e-4], [-0.0167, -81e-4], [-0.0161, -97e-4], [-0.0162, -0.0114], [-0.0221, -0.0308], [-0.0224, -0.0313], [-0.0226, -0.0319], [-0.023, -0.0323], [-0.03, -0.04], [-0.0305, -0.0407], [-0.0309, -0.0415], [-0.031, -0.0424], [-0.032, -0.0544], [-0.0321, -0.0553], [-0.0325, -0.0561], [-0.033, -0.0568], [-0.0398, -0.0642], [-0.0402, -0.0649], [-0.0406, -0.0656], [-0.0408, -0.0664], [-0.0425, -0.0785], [-0.0426, -0.0792], [-0.0429, -0.0798], [-0.0433, -0.0804], [-0.0509, -0.0901], [-0.0522, -0.0912], [-0.0539, -0.0916], [-0.0557, -0.0913], [-0.0805, -0.0802], [-0.0821, -0.079], [-0.0829, -0.0772], [-0.0827, -0.0753], [-0.0705, -0.039], [-0.0705, -0.0388], [-0.0704, -0.0386], [-0.0703, -0.0385], [-0.053, -42e-4], [-0.0525, -35e-4], [-0.0518, -29e-4], [-0.0511, -24e-4], [-0.0377, 39e-4], [-0.0364, 43e-4], [-0.035, 42e-4], [-0.0338, 37e-4]], width: 0.034, bevel: 5e-3, plane: "yz", pos: [0, 0, 0], smooth: 50, mat: "gun_wood_walnut" },
      { shape: "cyl", pos: [0.0172, -0.0422, -0.0294], radius: 28e-4, length: 12e-4, axis: "x", segments: 12, lod: false, mat: "gun_steel_bare", mirror: "x" },
      { shape: "cyl", pos: [0.0172, -0.0577, -0.0641], radius: 28e-4, length: 12e-4, axis: "x", segments: 12, lod: false, mat: "gun_steel_bare", mirror: "x" },
      { shape: "torus", pos: [0, -0.0727, -0.0901], radius: 45e-4, tube: 12e-4, axis: "x", mat: "gun_steel_bare" }
    ],
    anchors: { muzzle: [0, 0.181, 0.034], eject: [0.02, 0.016, 0.03], sight: [0, -0.044, 0.0565], grip_r: [0, -0.0483, -0.0431], grip_l: [-0.012, -0.0443, -0.0551], mag: [-0.02, 0.016, 0.03] },
    bounds: { min: [-0.0185, -0.0829, -0.0958], max: [0.0185, 0.1812, 0.0628] },
    groups: { cylinder: { pivot: [0, 0, 0.03] }, hammer: { pivot: [0, -0.036, 0.028] }, trigger: { pivot: [0, 0, -4e-3] } },
    viewmodel: { offset: [0.11, 0.34, -0.13], ads_distance: 0.34, elbow_r: [0.24, -0.1, -0.35], elbow_l: [-0.1, -0.08, -0.38], revolver: true, cylinder_step: 60, bolt_lock: false, hammer_angle: -34 },
    sight_parts: ["gun_blued", "poly_red"]
  },
  pistol_h45: {
    parts: [
      { shape: "profile", pts: [[-0.05, 0.013], [-0.0497, 0.0123], [-0.049, 0.012], [0.148, 0.012], [0.1494, 0.0126], [0.15, 0.014], [0.15, 0.0404], [0.1496, 0.0418], [0.1487, 0.0429], [0.1445, 0.0457], [0.144, 0.0459], [0.1434, 0.046], [-0.0469, 0.046], [-0.0479, 0.0458], [-0.0486, 0.0451], [-0.0498, 0.0433], [-0.05, 0.043], [-0.05, 0.0427]], width: 0.0245, bevel: 18e-4, plane: "yz", pos: [0, 0, 0], group: "slide", mat: "gun_parkerized" },
      { shape: "box", pos: [0.0108, 0.05, 0.0448], size: [3e-3, 0.188, 24e-4], bevel: 9e-4, hpr: [0, 0, 35], group: "slide", lod: false, mat: "gun_parkerized" },
      { shape: "box", pos: [-0.0108, 0.05, 0.0448], size: [3e-3, 0.188, 24e-4], bevel: 9e-4, hpr: [0, 0, -35], group: "slide", lod: false, mat: "gun_parkerized" },
      { shape: "slot", pos: [0.0126, -0.044, 0.031], length: 0.026, width: 16e-4, depth: 8e-4, plane: "yz", hpr: [0, 90, 0], group: "slide", lod: false, mat: "shadow", repeat: { count: 9, step: [0, 32e-4, 0] }, mirror: "x" },
      { shape: "box", pos: [88e-4, 0.018, 0.04], size: [72e-4, 0.036, 0.012], bevel: 0, group: "slide", lod: false, wear: false, mat: "shadow" },
      { shape: "box", pos: [0, 0.02, 0.0448], size: [0.0165, 0.03, 28e-4], bevel: 6e-4, lod: false, mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0, 0.034, 0.042], radius: 28e-4, length: 2e-3, axis: "y", segments: 10, lod: false, wear: false, mat: "shadow" },
      { shape: "box", pos: [0, -0.0503, 0.031], size: [0.0147, 8e-4, 0.0187], bevel: 6e-4, group: "slide", lod: false, mat: "gun_parkerized_dark" },
      { shape: "box", pos: [0.0126, 4e-3, 0.039], size: [12e-4, 0.014, 3e-3], bevel: 4e-4, group: "slide", lod: false, mat: "gun_steel_bare" },
      { shape: "profile", pts: [[-75e-4, 8e-4], [-73e-4, 2e-4], [-67e-4, 0], [-8e-4, 0], [-2e-4, 2e-4], [0, 8e-4], [0, 19e-4], [-2e-4, 25e-4], [-8e-4, 27e-4], [-67e-4, 27e-4], [-73e-4, 25e-4], [-75e-4, 19e-4]], width: 0.016, bevel: 6e-4, plane: "yz", pos: [0, -0.042, 0.046], group: "slide", mat: "gun_parkerized_dark" },
      { shape: "profile", pts: [[-75e-4, 8e-4], [-73e-4, 2e-4], [-67e-4, 0], [-8e-4, 0], [-2e-4, 2e-4], [0, 8e-4], [0, 52e-4], [-2e-4, 58e-4], [-8e-4, 6e-3], [-54e-4, 6e-3], [-59e-4, 59e-4], [-62e-4, 55e-4], [-74e-4, 21e-4], [-75e-4, 2e-3], [-75e-4, 19e-4]], width: 58e-4, bevel: 5e-4, plane: "yz", pos: [49e-4, -0.042, 0.046], group: "slide", mat: "gun_parkerized_dark" },
      { shape: "profile", pts: [[-75e-4, 8e-4], [-73e-4, 2e-4], [-67e-4, 0], [-8e-4, 0], [-2e-4, 2e-4], [0, 8e-4], [0, 52e-4], [-2e-4, 58e-4], [-8e-4, 6e-3], [-54e-4, 6e-3], [-59e-4, 59e-4], [-62e-4, 55e-4], [-74e-4, 21e-4], [-75e-4, 2e-3], [-75e-4, 19e-4]], width: 58e-4, bevel: 5e-4, plane: "yz", pos: [-49e-4, -0.042, 0.046], group: "slide", mat: "gun_parkerized_dark" },
      { shape: "sphere", pos: [45e-4, -0.0479, 0.05], radius: 11e-4, emit: [3, 18, 4], group: "slide", mat: "pbr_white_rough" },
      { shape: "sphere", pos: [-45e-4, -0.0479, 0.05], radius: 11e-4, emit: [3, 18, 4], group: "slide", mat: "pbr_white_rough" },
      { shape: "profile", pts: [[0, 8e-4], [2e-4, 2e-4], [8e-4, 0], [49e-4, 0], [55e-4, 3e-4], [56e-4, 11e-4], [42e-4, 52e-4], [39e-4, 56e-4], [34e-4, 57e-4], [8e-4, 57e-4], [2e-4, 55e-4], [0, 49e-4]], width: 36e-4, bevel: 5e-4, plane: "yz", pos: [0, 0.14, 0.046], group: "slide", mat: "gun_parkerized_dark" },
      { shape: "sphere", pos: [0, 0.1398, 0.0495], radius: 12e-4, emit: [3, 18, 4], group: "slide", mat: "pbr_white_rough" },
      { shape: "cyl", pos: [0, 0.1505, 0.027], radius: 72e-4, length: 2e-3, axis: "y", bore: 58e-4, segments: 18, group: "slide", mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0, 0.1512, 0.027], radius: 58e-4, length: 8e-4, axis: "y", segments: 14, group: "slide", lod: false, wear: false, mat: "shadow" },
      { shape: "profile", pts: [[-0.052, 0.0121], [-0.0517, 0.013], [-0.051, 0.0137], [-0.0501, 0.014], [0.138, 0.014], [0.139, 0.0137], [0.1397, 0.013], [0.14, 0.012], [0.14, 4e-3], [0.1397, 3e-3], [0.139, 22e-4], [0.138, 2e-3], [0.0303, 0], [0.0301, 0], [0.0299, 0], [0.0297, 0], [0.0126, 19e-4], [0.0122, 2e-3], [0.0118, 19e-4], [0.0114, 18e-4], [-85e-4, -4e-3], [-94e-4, -45e-4], [-0.0101, -51e-4], [-0.0105, -6e-3], [-0.0357, -0.0865], [-0.0368, -0.0883], [-0.0387, -0.0892], [-0.0407, -0.0891], [-0.0722, -0.0789], [-0.0739, -0.0778], [-0.0749, -0.076], [-0.0748, -0.074], [-0.0624, -0.0297], [-0.0623, -0.0296], [-0.0623, -0.0295], [-0.0623, -0.0294], [-0.0555, -27e-4], [-0.0554, -12e-4], [-0.0555, 3e-4], [-0.0561, 17e-4], [-0.0622, 0.0127], [-0.0623, 0.0144], [-0.061, 0.0155], [-0.0594, 0.0152], [-0.0536, 0.0111], [-0.0529, 0.0109], [-0.0523, 0.0113], [-0.052, 0.0119]], width: 0.027, bevel: 18e-4, plane: "yz", pos: [0, 0, 0], smooth: 45, mat: "gun_parkerized" },
      { shape: "profile", pts: [[-0.0232, -0.0128], [-0.021, -0.0142], [-0.0198, -0.0165], [-0.0199, -0.0191], [-0.0377, -0.0764], [-0.0391, -0.0786], [-0.0414, -0.0798], [-0.044, -0.0797], [-0.064, -0.0732], [-0.0661, -0.0718], [-0.0673, -0.0695], [-0.0672, -0.067], [-0.0495, -96e-4], [-0.0481, -74e-4], [-0.0458, -62e-4], [-0.0432, -63e-4]], width: 0.031, bevel: 18e-4, plane: "yz", pos: [0, 0, 0], mat: "gun_wood_red" },
      { shape: "cyl", pos: [0.0156, -0.0368, -0.0189], radius: 26e-4, length: 12e-4, axis: "x", segments: 12, lod: false, mat: "gun_steel_bare", mirror: "x" },
      { shape: "cyl", pos: [0.0156, -0.0516, -0.0646], radius: 26e-4, length: 12e-4, axis: "x", segments: 12, lod: false, mat: "gun_steel_bare", mirror: "x" },
      { shape: "slot", pos: [0, -0.0663, -0.0335], length: 15e-4, width: 0.016, depth: 4e-4, plane: "xz", lod: false, mat: "shadow" },
      { shape: "sweep", path: [[0, 0.012, 0], [0, 3e-4, -0.0114], [0, -16e-4, -0.0158], [0, 2e-4, -0.0202], [0, 46e-4, -0.022], [0, 0.0402, -0.022], [0, 0.0433, -0.0213], [0, 0.0458, -0.0192], [0, 0.047, -0.0163], [0, 0.05, 0]], section: { kind: "rect", w: 0.011, h: 45e-4, c: 12e-4 }, mat: "gun_parkerized" },
      { shape: "profile", pts: [[0, 0], [4e-3, 0], [55e-4, -0.014], [0, -0.016]], width: 8e-3, bevel: 6e-4, plane: "yz", pos: [0, 0.024, 0], group: "trigger", mat: "gun_steel_bare" },
      { shape: "profile", pts: [[-41e-4, -46e-4], [-36e-4, -56e-4], [-26e-4, -6e-3], [24e-4, -6e-3], [35e-4, -55e-4], [39e-4, -44e-4], [35e-4, 73e-4], [34e-4, 79e-4], [3e-3, 84e-4], [-57e-4, 0.0157], [-6e-3, 0.0159], [-64e-4, 0.0161], [-0.0117, 0.0167], [-0.0131, 0.0162], [-0.0134, 0.0148], [-0.0121, 0.0104], [-0.0119, 0.01], [-0.0117, 97e-4], [-55e-4, 44e-4], [-51e-4, 39e-4], [-49e-4, 34e-4]], width: 75e-4, bevel: 8e-4, plane: "yz", pos: [0, -0.05, 0.02], group: "hammer", mat: "gun_parkerized_dark" },
      { shape: "profile", pts: [[-0.014, -2e-3], [-0.0137, -27e-4], [-0.013, -3e-3], [72e-4, -2e-3], [78e-4, -18e-4], [82e-4, -12e-4], [88e-4, 18e-4], [86e-4, 26e-4], [78e-4, 3e-3], [-0.013, 3e-3], [-0.0137, 27e-4], [-0.014, 2e-3]], width: 22e-4, bevel: 3e-4, plane: "yz", pos: [-0.0148, -0.032, 0.01], mat: "gun_parkerized_dark" },
      { shape: "profile", pts: [[-0.018, 1e-3], [-0.0177, 3e-4], [-0.017, 0], [34e-4, 0], [39e-4, 1e-4], [43e-4, 6e-4], [52e-4, 25e-4], [52e-4, 35e-4], [43e-4, 39e-4], [-0.017, 3e-3], [-0.0177, 27e-4], [-0.018, 2e-3]], width: 18e-4, bevel: 3e-4, plane: "yz", pos: [-0.0148, 8e-3, 7e-3], mat: "gun_parkerized_dark" },
      { shape: "cyl", pos: [-0.0145, 0.036, -6e-3], radius: 4e-3, length: 28e-4, axis: "x", segments: 14, lod: false, mat: "gun_knurl" },
      { shape: "profile", pts: [[-0.0455, 28e-4], [-0.016, -67e-4], [-0.0432, -0.0904], [-0.0727, -0.0809]], width: 0.019, bevel: 1e-3, plane: "yz", pos: [0, 0, 0], group: "mag", lod: false, mat: "gun_parkerized_dark" },
      { shape: "profile", pts: [[-0.076, -0.0782], [-0.0748, -0.0767], [-0.0729, -0.0766], [-0.0386, -0.0877], [-0.0372, -0.089], [-0.037, -0.0909], [-0.0386, -0.0956], [-0.0398, -0.0971], [-0.0417, -0.0972], [-0.076, -0.0861], [-0.0774, -0.0849], [-0.0776, -0.083]], width: 0.027, bevel: 15e-4, plane: "yz", pos: [0, 0, 0], group: "mag", mat: "gun_parkerized_dark" },
      { shape: "cyl", pos: [0, -0.0292, 12e-4], radius: 47e-4, length: 0.019, axis: "y", segments: 12, group: "mag", lod: false, mat: "gun_brass" }
    ],
    anchors: { muzzle: [0, 0.152, 0.027], eject: [0.014, 0.018, 0.044], sight: [0, -0.078, 0.0508], grip_r: [0, -0.0433, -0.0391], grip_l: [-0.012, -0.0393, -0.0511], mag: [0, -0.0442, -0.0417] },
    bounds: { min: [-0.0162, -0.0776, -0.0972], max: [0.0162, 0.1516, 0.052] },
    groups: { slide: { pivot: [0, 0, 0] }, trigger: { pivot: [0, 0.024, 0] }, hammer: { pivot: [0, -0.05, 0.014] } },
    viewmodel: { offset: [0.11, 0.34, -0.13], ads_distance: 0.34, elbow_r: [0.24, -0.1, -0.35], elbow_l: [-0.1, -0.08, -0.38], hammer_angle: -30 },
    sight_parts: ["gun_parkerized", "gun_parkerized_dark"]
  },
  pistol_mk17: {
    parts: [
      { shape: "profile", pts: [[-0.045, 0.011], [-0.0447, 0.0103], [-0.044, 0.01], [0.118, 0.01], [0.1194, 0.0106], [0.12, 0.012], [0.12, 0.0354], [0.1196, 0.0368], [0.1187, 0.0379], [0.1145, 0.0407], [0.114, 0.0409], [0.1134, 0.041], [-0.0419, 0.041], [-0.0429, 0.0408], [-0.0436, 0.0401], [-0.0448, 0.0383], [-0.045, 0.038], [-0.045, 0.0377]], width: 0.024, bevel: 18e-4, plane: "yz", pos: [0, 0, 0], group: "slide", mat: "gun_cerakote_black" },
      { shape: "box", pos: [0.0105, 0.0375, 0.0398], size: [3e-3, 0.153, 24e-4], bevel: 9e-4, hpr: [0, 0, 35], group: "slide", lod: false, mat: "gun_cerakote_black" },
      { shape: "box", pos: [-0.0105, 0.0375, 0.0398], size: [3e-3, 0.153, 24e-4], bevel: 9e-4, hpr: [0, 0, -35], group: "slide", lod: false, mat: "gun_cerakote_black" },
      { shape: "slot", pos: [0.0123, -0.039, 0.0275], length: 0.023, width: 16e-4, depth: 8e-4, plane: "yz", hpr: [0, 90, 0], group: "slide", lod: false, mat: "shadow", repeat: { count: 9, step: [0, 32e-4, 0] }, mirror: "x" },
      { shape: "slot", pos: [0.0123, 0.086, 0.0275], length: 0.021, width: 16e-4, depth: 8e-4, plane: "yz", hpr: [0, 90, 0], group: "slide", lod: false, mat: "shadow", repeat: { count: 6, step: [0, 32e-4, 0] }, mirror: "x" },
      { shape: "box", pos: [85e-4, 0.016, 0.035], size: [72e-4, 0.032, 0.012], bevel: 0, group: "slide", lod: false, wear: false, mat: "shadow" },
      { shape: "box", pos: [0, 0.018, 0.0398], size: [0.016, 0.026, 28e-4], bevel: 6e-4, lod: false, mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0, 0.03, 0.037], radius: 28e-4, length: 2e-3, axis: "y", segments: 10, lod: false, wear: false, mat: "shadow" },
      { shape: "box", pos: [0, -0.0453, 0.0275], size: [0.0144, 8e-4, 0.0171], bevel: 6e-4, group: "slide", lod: false, mat: "gun_parkerized_dark" },
      { shape: "box", pos: [0.0124, 4e-3, 0.034], size: [12e-4, 0.014, 3e-3], bevel: 4e-4, group: "slide", lod: false, mat: "gun_steel_bare" },
      { shape: "profile", pts: [[-75e-4, 8e-4], [-73e-4, 2e-4], [-67e-4, 0], [-8e-4, 0], [-2e-4, 2e-4], [0, 8e-4], [0, 19e-4], [-2e-4, 25e-4], [-8e-4, 27e-4], [-67e-4, 27e-4], [-73e-4, 25e-4], [-75e-4, 19e-4]], width: 0.016, bevel: 6e-4, plane: "yz", pos: [0, -0.037, 0.041], group: "slide", mat: "gun_parkerized_dark" },
      { shape: "profile", pts: [[-75e-4, 8e-4], [-73e-4, 2e-4], [-67e-4, 0], [-8e-4, 0], [-2e-4, 2e-4], [0, 8e-4], [0, 52e-4], [-2e-4, 58e-4], [-8e-4, 6e-3], [-54e-4, 6e-3], [-59e-4, 59e-4], [-62e-4, 55e-4], [-74e-4, 21e-4], [-75e-4, 2e-3], [-75e-4, 19e-4]], width: 58e-4, bevel: 5e-4, plane: "yz", pos: [49e-4, -0.037, 0.041], group: "slide", mat: "gun_parkerized_dark" },
      { shape: "profile", pts: [[-75e-4, 8e-4], [-73e-4, 2e-4], [-67e-4, 0], [-8e-4, 0], [-2e-4, 2e-4], [0, 8e-4], [0, 52e-4], [-2e-4, 58e-4], [-8e-4, 6e-3], [-54e-4, 6e-3], [-59e-4, 59e-4], [-62e-4, 55e-4], [-74e-4, 21e-4], [-75e-4, 2e-3], [-75e-4, 19e-4]], width: 58e-4, bevel: 5e-4, plane: "yz", pos: [-49e-4, -0.037, 0.041], group: "slide", mat: "gun_parkerized_dark" },
      { shape: "sphere", pos: [45e-4, -0.0429, 0.045], radius: 11e-4, emit: [3, 18, 4], group: "slide", mat: "pbr_white_rough" },
      { shape: "sphere", pos: [-45e-4, -0.0429, 0.045], radius: 11e-4, emit: [3, 18, 4], group: "slide", mat: "pbr_white_rough" },
      { shape: "profile", pts: [[0, 8e-4], [2e-4, 2e-4], [8e-4, 0], [49e-4, 0], [55e-4, 3e-4], [56e-4, 11e-4], [42e-4, 52e-4], [39e-4, 56e-4], [34e-4, 57e-4], [8e-4, 57e-4], [2e-4, 55e-4], [0, 49e-4]], width: 36e-4, bevel: 5e-4, plane: "yz", pos: [0, 0.11, 0.041], group: "slide", mat: "gun_parkerized_dark" },
      { shape: "sphere", pos: [0, 0.1098, 0.0445], radius: 12e-4, emit: [3, 18, 4], group: "slide", mat: "pbr_white_rough" },
      { shape: "profile", pts: [[0.012, 0.011], [0.0123, 0.0117], [0.013, 0.012], [0.109, 0.012], [0.1097, 0.0117], [0.11, 0.011], [0.11, 9e-4], [0.1098, 1e-4], [0.1093, -6e-4], [0.1048, -43e-4], [0.1039, -48e-4], [0.1029, -5e-3], [0.0304, -5e-3], [0.03, -5e-3], [0.0296, -49e-4], [0.0127, -2e-4], [0.0122, 2e-4], [0.012, 8e-4]], width: 0.026, bevel: 18e-4, plane: "yz", pos: [0, 0, 0], mat: "poly_od" },
      { shape: "box", pos: [0, 0.098, -55e-4], size: [0.022, 4e-3, 16e-4], bevel: 0, lod: false, wear: false, mat: "shadow" },
      { shape: "box", pos: [0, 0.086, -55e-4], size: [0.022, 4e-3, 16e-4], bevel: 0, lod: false, wear: false, mat: "shadow" },
      { shape: "box", pos: [0.0128, 0.07, -15e-4], size: [12e-4, 0.076, 3e-3], bevel: 4e-4, lod: false, mat: "poly_od" },
      { shape: "box", pos: [-0.0128, 0.07, -15e-4], size: [12e-4, 0.076, 3e-3], bevel: 4e-4, lod: false, mat: "poly_od" },
      { shape: "profile", pts: [[-0.0436, 0.0122], [-0.0432, 0.0121], [-0.0428, 0.012], [-0.0424, 0.012], [0.0125, 0.012], [0.0143, 0.0115], [0.0155, 0.0103], [0.016, 85e-4], [0.016, 27e-4], [0.0157, 12e-4], [0.0148, 0], [0.0134, -7e-4], [-39e-4, -56e-4], [-51e-4, -62e-4], [-59e-4, -71e-4], [-64e-4, -83e-4], [-98e-4, -0.0243], [-98e-4, -0.0243], [-98e-4, -0.0244], [-98e-4, -0.0245], [-0.0114, -0.0351], [-0.0115, -0.0358], [-0.0118, -0.0364], [-0.0122, -0.037], [-0.0173, -0.0427], [-0.0178, -0.0434], [-0.018, -0.0442], [-0.0181, -0.0451], [-0.0178, -0.054], [-0.0179, -0.0549], [-0.0181, -0.0557], [-0.0186, -0.0564], [-0.0241, -0.063], [-0.0244, -0.0635], [-0.0247, -0.064], [-0.0248, -0.0646], [-0.0283, -0.0831], [-0.0292, -0.0848], [-0.0309, -0.0858], [-0.0329, -0.0858], [-0.065, -0.0753], [-0.0664, -0.0744], [-0.0673, -0.0729], [-0.0673, -0.0712], [-0.058, -0.0336], [-0.058, -0.0335], [-0.0579, -0.0334], [-0.0579, -0.0333], [-0.0484, -4e-3], [-0.0482, -34e-4], [-0.0482, -28e-4], [-0.0483, -22e-4], [-0.0508, 0.0107], [-0.0506, 0.0124], [-0.0492, 0.0135], [-0.0475, 0.0135]], width: 0.029, bevel: 25e-4, plane: "yz", pos: [0, 0, 0], smooth: 45, mat: "poly_od" },
      { shape: "profile", pts: [[-0.0164, -0.016], [-0.0147, -0.0171], [-0.0138, -0.0189], [-0.0138, -0.021], [-0.0291, -0.0738], [-0.0302, -0.0756], [-0.0321, -0.0766], [-0.0342, -0.0765], [-0.0589, -0.0685], [-0.0606, -0.0674], [-0.0616, -0.0655], [-0.0615, -0.0635], [-0.0453, -0.0109], [-0.0442, -92e-4], [-0.0423, -82e-4], [-0.0402, -83e-4]], width: 0.0302, bevel: 8e-4, plane: "yz", pos: [0, 0, 0], mat: "poly_od_grip" },
      { shape: "sweep", path: [[0, -15e-4, -2e-3], [0, 6e-4, -0.0168], [0, 17e-4, -0.0195], [0, 38e-4, -0.0213], [0, 66e-4, -0.022], [0, 0.0388, -0.022], [0, 0.0415, -0.0213], [0, 0.0437, -0.0195], [0, 0.0447, -0.0168], [0, 0.0457, -99e-4], [0, 0.0458, -86e-4], [0, 0.0456, -75e-4], [0, 0.0452, -63e-4], [0, 0.042, 0]], section: { kind: "rect", w: 0.012, h: 45e-4, c: 12e-4 }, mat: "poly_od" },
      { shape: "profile", pts: [[0, 0], [4e-3, 0], [6e-3, -8e-3], [4e-3, -0.017], [0, -0.018], [2e-3, -8e-3]], width: 6e-3, bevel: 6e-4, plane: "yz", pos: [0, 0.0145, -2e-3], group: "trigger", mat: "poly_black" },
      { shape: "box", pos: [0, 0.018, -0.01], size: [18e-4, 16e-4, 9e-3], bevel: 3e-4, group: "trigger", lod: false, mat: "gun_steel_bare" },
      { shape: "profile", pts: [[-0.018, 1e-3], [-0.0177, 3e-4], [-0.017, 0], [34e-4, 0], [39e-4, 1e-4], [43e-4, 6e-4], [52e-4, 25e-4], [52e-4, 35e-4], [43e-4, 39e-4], [-0.017, 3e-3], [-0.0177, 27e-4], [-0.018, 2e-3]], width: 18e-4, bevel: 3e-4, plane: "yz", pos: [-0.0153, 8e-3, 6e-3], mat: "gun_parkerized_dark" },
      { shape: "box", pos: [0, 0.028, 6e-3], size: [0.031, 8e-3, 3e-3], bevel: 6e-4, mat: "gun_parkerized_dark" },
      { shape: "cyl", pos: [0, 0.0185, 4e-3], radius: 16e-4, length: 0.0295, axis: "x", segments: 10, lod: false, mat: "gun_steel_bare" },
      { shape: "box", pos: [-0.0148, 12e-4, -0.0163], size: [2e-3, 8e-3, 7e-3], bevel: 6e-4, mat: "poly_od" },
      { shape: "box", pos: [0, 0.132, 0.0255], size: [0.022, 0.024, 0.027], bevel: 2e-3, group: "slide", mat: "gun_cerakote_black" },
      { shape: "slot", pos: [0, 0.126, 0.0392], length: 0.012, width: 4e-3, depth: 6e-4, plane: "xy", hpr: [90, 0, 0], group: "slide", lod: false, mat: "shadow", repeat: { count: 3, step: [0, 6e-3, 0] } },
      { shape: "cyl", pos: [0, 0.1446, 0.024], radius: 45e-4, length: 8e-4, axis: "y", segments: 14, group: "slide", lod: false, wear: false, mat: "shadow" },
      { shape: "box", pos: [0, -0.0465, 0.032], size: [0.016, 3e-3, 6e-3], bevel: 8e-4, group: "slide", mat: "poly_follower" },
      { shape: "profile", pts: [[-0.0117, -42e-4], [-0.0113, -21e-4], [-98e-4, -6e-4], [-78e-4, 0], [78e-4, 0], [98e-4, -6e-4], [0.0113, -21e-4], [0.0117, -42e-4], [92e-4, -0.0462], [86e-4, -0.0481], [72e-4, -0.0495], [52e-4, -0.05], [-52e-4, -0.05], [-72e-4, -0.0495], [-86e-4, -0.0481], [-92e-4, -0.0462]], width: 0.022, bevel: 3e-3, plane: "yz", pos: [0, 0.085, -7e-3], mat: "poly_black_grip" },
      { shape: "box", pos: [0, 0.085, -45e-4], size: [0.02, 0.03, 6e-3], bevel: 15e-4, mat: "poly_black" },
      { shape: "profile", pts: [[-0.0405, 8e-4], [-0.011, -87e-4], [-0.0561, -0.1476], [-0.0856, -0.138]], width: 0.021, bevel: 1e-3, plane: "yz", pos: [0, 0, 0], group: "mag", lod: false, mat: "gun_parkerized_dark" },
      { shape: "profile", pts: [[-0.089, -0.1354], [-0.0877, -0.1339], [-0.0858, -0.1338], [-0.0516, -0.1449], [-0.0501, -0.1461], [-0.05, -0.148], [-0.0515, -0.1528], [-0.0528, -0.1542], [-0.0547, -0.1544], [-0.0889, -0.1433], [-0.0904, -0.142], [-0.0905, -0.1401]], width: 0.029, bevel: 15e-4, plane: "yz", pos: [0, 0, 0], group: "mag", mat: "poly_black" },
      { shape: "cyl", pos: [0, -0.0242, -8e-4], radius: 47e-4, length: 0.019, axis: "y", segments: 12, group: "mag", lod: false, mat: "gun_brass" },
      { shape: "slot", pos: [0.0108, -0.0402, -0.1002], length: 0.02, width: 3e-3, depth: 8e-4, plane: "yz", hpr: [0, -18, 0], group: "mag", lod: false, mat: "shadow", mirror: "x" },
      { shape: "slot", pos: [0.0108, -0.0479, -0.124], length: 0.02, width: 3e-3, depth: 8e-4, plane: "yz", hpr: [0, -18, 0], group: "mag", lod: false, mat: "shadow", mirror: "x" }
    ],
    anchors: { muzzle: [0, 0.145, 0.024], eject: [0.014, 0.016, 0.039], sight: [0, -0.073, 0.0458], grip_r: [0, -0.0375, -0.0383], grip_l: [0, 0.085, -0.038], mag: [0, -0.0482, -0.0713] },
    bounds: { min: [-0.0162, -0.0905, -0.1544], max: [0.0155, 0.145, 0.047] },
    groups: { slide: { pivot: [0, 0, 0] }, trigger: { pivot: [0, 0.0145, -2e-3] } },
    viewmodel: { offset: [0.11, 0.33, -0.13], ads_distance: 0.32, elbow_r: [0.24, -0.1, -0.35], elbow_l: [-0.14, 0.02, -0.38] },
    sight_parts: ["gun_cerakote_black", "gun_parkerized_dark"]
  },
  smg_sb9: {
    parts: [
      { shape: "profile", pts: [[-0.33, 0.022], [-0.33, 0.0581], [-0.3293, 0.0619], [-0.3271, 0.0652], [-0.3239, 0.0673], [-0.3201, 0.0681], [-0.0501, 0.072], [-0.0501, 0.072], [-0.05, 0.072], [-0.0499, 0.072], [-0.0499, 0.072], [0.1285, 0.072], [0.1293, 0.072], [0.13, 0.0719], [0.1307, 0.0718], [0.1314, 0.0716], [0.1643, 0.0617], [0.1666, 0.0606], [0.1684, 0.0588], [0.1696, 0.0566], [0.17, 0.054], [0.17, 0.0277], [0.1696, 0.0255], [0.1684, 0.0236], [0.1665, 0.0222], [0.1643, 0.0217], [0.0624, 0.0161], [0.0612, 0.016], [0.0601, 0.0157], [0.059, 0.0153], [0.0579, 0.0148], [0.0264, -32e-4], [0.0257, -36e-4], [0.0249, -38e-4], [0.0242, -39e-4], [0.0234, -4e-3], [-0.0332, -4e-3], [-0.0341, -39e-4], [-0.0349, -38e-4], [-0.0357, -35e-4], [-0.0365, -31e-4], [-0.0575, 0.0104], [-0.0588, 0.0111], [-0.0601, 0.0116], [-0.0615, 0.0119], [-0.0629, 0.012], [-0.2329, 0.012], [-0.2364, 0.0118], [-0.2398, 0.0112], [-0.2431, 0.0102], [-0.2463, 88e-4], [-0.2987, -0.0174], [-0.2994, -0.0176], [-0.3, -0.0178], [-0.3007, -0.018], [-0.3014, -0.018], [-0.326, -0.018], [-0.3275, -0.0177], [-0.3288, -0.0168], [-0.3297, -0.0155], [-0.33, -0.014]], width: 0.048, bevel: 4e-3, plane: "yz", pos: [0, 0, 0], smooth: 40, mat: "poly_fde" },
      { shape: "profile", pts: [[-0.3, -11e-4], [-0.2991, -44e-4], [-0.2965, -66e-4], [-0.2932, -71e-4], [-0.1252, 0.0153], [-0.1226, 0.0163], [-0.1207, 0.0185], [-0.12, 0.0213], [-0.12, 0.054], [-0.1208, 0.057], [-0.123, 0.0592], [-0.126, 0.06], [-0.294, 0.06], [-0.297, 0.0592], [-0.2992, 0.057], [-0.3, 0.054]], width: 0.0486, bevel: 1e-3, plane: "yz", pos: [0, 0, 0], mat: "poly_fde_grip" },
      { shape: "slot", pos: [0.0243, 0.09, 0.048], length: 0.022, width: 6e-3, depth: 12e-4, plane: "yz", lod: false, mat: "shadow", repeat: { count: 3, step: [0, 0.026, 0] }, mirror: "x" },
      { shape: "profile", pts: [[0.0611, 0.0121], [0.0613, 0.0145], [0.0628, 0.0163], [0.065, 0.017], [0.0765, 0.017], [0.0784, 0.0166], [0.0798, 0.0153], [0.0805, 0.0136], [0.0843, -0.0134], [0.084, -0.0157], [0.0825, -0.0174], [0.0804, -0.018], [0.0712, -0.018], [0.0695, -0.0176], [0.0681, -0.0165], [0.0673, -0.0149]], width: 0.04, bevel: 3e-3, plane: "yz", pos: [0, 0, 0], mat: "poly_fde" },
      { shape: "profile", pts: [[-0.0302, -25e-4], [-0.0293, -6e-4], [-0.0276, 6e-4], [-0.0256, 7e-4], [2e-3, -41e-4], [39e-4, -5e-3], [51e-4, -67e-4], [53e-4, -88e-4], [3e-3, -0.0216], [3e-3, -0.0216], [3e-3, -0.0217], [3e-3, -0.0217], [-8e-3, -0.0903], [-81e-4, -0.0908], [-83e-4, -0.0913], [-86e-4, -0.0917], [-0.0109, -0.0957], [-0.012, -0.0969], [-0.0134, -0.0975], [-0.015, -0.0976], [-0.0413, -0.0929], [-0.0429, -0.0923], [-0.044, -0.0911], [-0.0446, -0.0895], [-0.0459, -0.0783], [-0.0459, -0.0779], [-0.0459, -0.0774], [-0.0459, -0.077], [-0.0345, -0.0267], [-0.0345, -0.0267], [-0.0344, -0.0266], [-0.0344, -0.0265]], width: 0.03, bevel: 3e-3, plane: "yz", pos: [0, 0, 0], smooth: 45, mat: "poly_fde_grip" },
      { shape: "profile", pts: [[-0.0447, -0.0949], [-0.0444, -0.096], [-0.0434, -0.0966], [-0.0138, -0.1019], [-0.0127, -0.1016], [-0.012, -0.1006], [-0.0115, -0.0977], [-0.0118, -0.0966], [-0.0127, -0.096], [-0.0424, -0.0907], [-0.0435, -0.091], [-0.0441, -0.0919]], width: 0.031, bevel: 1e-3, plane: "yz", pos: [0, 0, 0], mat: "poly_black" },
      { shape: "profile", pts: [[0, 0], [4e-3, 0], [65e-4, -8e-3], [6e-3, -0.016], [25e-4, -0.024], [-1e-3, -0.025], [1e-3, -0.016], [15e-4, -8e-3]], width: 55e-4, bevel: 6e-4, plane: "yz", pos: [0, 0.016, -4e-3], group: "trigger", mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0, 0.018, -3e-3], radius: 16e-4, length: 0.03, axis: "x", segments: 10, lod: false, mat: "gun_steel_bare" },
      { shape: "sweep", path: [[0, -5e-3, -8e-3], [0, -5e-3, -0.031], [0, -45e-4, -0.0337], [0, -29e-4, -0.0359], [0, -7e-4, -0.0375], [0, 2e-3, -0.038], [0, 0.051, -0.038], [0, 0.0537, -0.0375], [0, 0.0559, -0.0359], [0, 0.0575, -0.0337], [0, 0.058, -0.031], [0, 0.058, -8e-3]], section: { kind: "rect", w: 0.014, h: 4e-3, c: 12e-4 }, mat: "poly_fde" },
      { shape: "profile", pts: [[-0.1201, 0.0111], [-0.1194, 0.0124], [-0.118, 0.0129], [-0.092, 0.0111], [-0.0907, 0.0104], [-0.0902, 9e-3], [-0.0975, -0.0958], [-0.0985, -0.0978], [-0.1007, -0.0986], [-0.1246, -0.0969], [-0.1267, -0.0959], [-0.1274, -0.0937]], width: 0.021, bevel: 12e-4, plane: "yz", pos: [0, 0, 0], group: "mag", mat: "gun_parkerized_dark" },
      { shape: "profile", pts: [[-0.1308, -0.1023], [-0.1304, -0.1039], [-0.129, -0.1046], [-0.0965, -0.1069], [-0.095, -0.1063], [-0.0943, -0.1048], [-0.0945, -0.0988], [-0.0951, -0.0975], [-0.0964, -0.0969], [-0.1277, -0.0947], [-0.1291, -0.0951], [-0.1298, -0.0963]], width: 0.025, bevel: 15e-4, plane: "yz", pos: [0, 0, 0], group: "mag", mat: "gun_parkerized_dark" },
      { shape: "slot", pos: [0.0109, -0.1077, -0.0264], length: 0.021, width: 3e-3, depth: 12e-4, plane: "yz", hpr: [0, -4, 0], group: "mag", lod: false, mat: "gun_parkerized_dark", mirror: "x" },
      { shape: "slot", pos: [0.0109, -0.11, -0.0593], length: 0.021, width: 3e-3, depth: 12e-4, plane: "yz", hpr: [0, -4, 0], group: "mag", lod: false, mat: "gun_parkerized_dark", mirror: "x" },
      { shape: "box", pos: [0, -0.105, 0.014], size: [0.017, 0.02, 4e-3], bevel: 8e-4, group: "mag", lod: false, mat: "poly_follower" },
      { shape: "cyl", pos: [0, -0.103, 0.0175], radius: 45e-4, length: 0.014, axis: "y", segments: 12, group: "mag", lod: false, mat: "gun_brass" },
      { shape: "box", pos: [0, -0.068, 0.012], size: [0.05, 6e-3, 0.012], bevel: 15e-4, mat: "gun_anodized" },
      { shape: "box", pos: [0.0246, -0.17, 0.05], size: [2e-3, 0.05, 0.016], bevel: 0, lod: false, wear: false, mat: "shadow" },
      { shape: "box", pos: [0.0236, -0.175, 0.05], size: [2e-3, 0.03, 0.01], bevel: 5e-4, group: "bolt", lod: false, mat: "gun_steel_bare" },
      { shape: "slot", pos: [-0.0244, 0, 0.06], length: 0.12, width: 4e-3, depth: 8e-4, plane: "yz", lod: false, mat: "shadow" },
      { shape: "box", pos: [-0.028, 0.05, 0.06], size: [0.01, 0.012, 7e-3], bevel: 15e-4, group: "charge", mat: "gun_anodized" },
      { shape: "box", pos: [0, -0.04, 0.074], size: [0.0153, 0.32, 4e-3], bevel: 6e-4, mat: "gun_anodized" },
      { shape: "profile", pts: [[-0.0106, 0], [0.0106, 0], [9e-3, 3e-3], [-9e-3, 3e-3]], width: 52e-4, bevel: 4e-4, plane: "xz", pos: [0, -0.195, 0.076], wear: false, mat: "gun_anodized", repeat: { count: 32, step: [0, 0.01, 0] } },
      { shape: "profile", pts: [[-0.0214, 25e-4], [-0.021, 8e-4], [-0.0194, 0], [0.0194, 0], [0.021, 8e-4], [0.0214, 25e-4], [0.0204, 65e-4], [0.0197, 76e-4], [0.0184, 8e-3], [-0.0184, 8e-3], [-0.0197, 76e-4], [-0.0204, 65e-4]], width: 0.026, bevel: 1e-3, plane: "yz", pos: [0, -0.06, 0.079], mat: "gun_anodized" },
      { shape: "box", pos: [0.0145, -0.048, 0.099], size: [3e-3, 8e-3, 0.022], bevel: 8e-4, mat: "gun_anodized" },
      { shape: "box", pos: [-0.0145, -0.048, 0.099], size: [3e-3, 8e-3, 0.022], bevel: 8e-4, mat: "gun_anodized" },
      { shape: "box", pos: [0, -0.048, 0.1115], size: [0.032, 8e-3, 3e-3], bevel: 8e-4, mat: "gun_anodized" },
      { shape: "box", pos: [0, -0.048, 0.0875], size: [0.032, 8e-3, 2e-3], bevel: 6e-4, mat: "gun_anodized" },
      { shape: "box", pos: [0, -0.048, 0.099], size: [0.026, 12e-4, 0.022], bevel: 0, hpr: [0, 6, 0], wear: false, lod: false, mat: "gun_glass" },
      { shape: "box", pos: [0, -0.072, 0.0905], size: [0.012, 0.012, 7e-3], bevel: 1e-3, mat: "gun_anodized" },
      { shape: "sphere", pos: [0, -0.0475, 0.099], radius: 9e-4, emit: [80, 3, 2], mat: "pbr_white_rough" },
      { shape: "cyl", pos: [0.0162, -0.064, 0.091], radius: 5e-3, length: 4e-3, axis: "x", segments: 14, lod: false, mat: "gun_knurl" },
      { shape: "cyl", pos: [0, 0.195, 0.042], radius: 85e-4, radius2: 85e-4, length: 0.05, axis: "y", segments: 24, mat: "gun_parkerized_dark" },
      { shape: "cyl", pos: [0, 0.24, 0.042], radius: 0.0105, length: 0.04, axis: "y", bore: 47e-4, bevel: 12e-4, segments: 24, mat: "gun_parkerized_dark" },
      { shape: "cyl", pos: [0, 0.2595, 0.042], radius: 47e-4, length: 8e-4, axis: "y", segments: 16, lod: false, wear: false, mat: "shadow" },
      { shape: "slot", pos: [-76e-4, 0.244, 0.0496], length: 0.022, width: 3e-3, depth: 8e-4, plane: "yz", hpr: [0, 0, -135], lod: false, mat: "shadow" },
      { shape: "slot", pos: [-76e-4, 0.244, 0.0344], length: 0.022, width: 3e-3, depth: 8e-4, plane: "yz", hpr: [0, 0, -225], lod: false, mat: "shadow" },
      { shape: "slot", pos: [76e-4, 0.244, 0.0344], length: 0.022, width: 3e-3, depth: 8e-4, plane: "yz", hpr: [0, 0, -315], lod: false, mat: "shadow" },
      { shape: "slot", pos: [76e-4, 0.244, 0.0496], length: 0.022, width: 3e-3, depth: 8e-4, plane: "yz", hpr: [0, 0, -405], lod: false, mat: "shadow" },
      { shape: "profile", pts: [[-0.33, 0.066], [-0.3306, 0.0674], [-0.332, 0.068], [-0.338, 0.068], [-0.3408, 0.0668], [-0.342, 0.064], [-0.342, -0.014], [-0.3408, -0.0168], [-0.338, -0.018], [-0.332, -0.018], [-0.3306, -0.0174], [-0.33, -0.016]], width: 0.05, bevel: 3e-3, plane: "yz", pos: [0, 0, 0], mat: "gun_rubber_pad" },
      { shape: "cyl", pos: [0.0245, -0.3, 0.042], radius: 65e-4, length: 4e-3, axis: "x", bore: 3e-3, bevel: 6e-4, segments: 16, mat: "gun_steel_bare" },
      { shape: "torus", pos: [0, 0.15, 0.016], radius: 6e-3, tube: 16e-4, axis: "y", mat: "gun_steel_bare" }
    ],
    anchors: { muzzle: [0, 0.26, 0.042], eject: [0.026, -0.17, 0.05], sight: [0, -0.17, 0.099], grip_r: [0, -0.0174, -0.0441], grip_l: [0, 0.115, 0.012], mag: [0, -0.105, -0.043] },
    bounds: { min: [-0.033, -0.342, -0.1069], max: [0.0265, 0.26, 0.113] },
    groups: { trigger: { pivot: [0, 0.016, -4e-3] }, bolt: { pivot: [0, 0, 0] }, charge: { pivot: [0, 0, 0] } },
    viewmodel: { offset: [0.12, 0.36, -0.15], ads_distance: 0.26, elbow_r: [0.28, -0.04, -0.38], elbow_l: [-0.2, 0.06, -0.4] }
  },
  smg_qs6: {
    parts: [
      { shape: "profile", pts: [[-0.07, 0.014], [-0.0694, 0.0126], [-0.068, 0.012], [0.098, 0.012], [0.0994, 0.0126], [0.1, 0.014], [0.1, 0.048], [0.0994, 0.0494], [0.098, 0.05], [-0.0672, 0.05], [-0.0679, 0.0498], [-0.0686, 0.0494], [-0.0694, 0.0486], [-0.0698, 0.0479], [-0.07, 0.0472]], width: 0.028, bevel: 14e-4, plane: "yz", pos: [0, 0, 0], mat: "gun_cerakote_black" },
      { shape: "box", pos: [0.0142, 0.02, 0.033], size: [6e-4, 0.04, 0.014], bevel: 0, lod: false, wear: false, mat: "shadow" },
      { shape: "box", pos: [0.0137, 0.016, 0.033], size: [16e-4, 0.028, 9e-3], bevel: 5e-4, group: "bolt", lod: false, mat: "gun_steel_bare" },
      { shape: "box", pos: [0, 0.0165, 0.052], size: [0.0153, 0.16, 4e-3], bevel: 6e-4, mat: "gun_cerakote_black" },
      { shape: "profile", pts: [[-0.0106, 0], [0.0106, 0], [9e-3, 3e-3], [-9e-3, 3e-3]], width: 52e-4, bevel: 4e-4, plane: "xz", pos: [0, -0.0585, 0.054], wear: false, mat: "gun_cerakote_black", repeat: { count: 16, step: [0, 0.01, 0] } },
      { shape: "profile", pts: [[-0.07, 0.01], [-0.0694, 0.0114], [-0.068, 0.012], [0.096, 0.012], [0.0974, 0.0114], [0.098, 0.01], [0.098, -36e-4], [0.098, -4e-3], [0.0979, -43e-4], [0.0905, -0.0247], [0.0897, -0.0256], [0.0886, -0.026], [0.0317, -0.026], [0.0304, -0.0255], [0.0297, -0.0243], [0.0283, -0.0157], [0.0276, -0.0145], [0.0263, -0.014], [-0.0313, -0.014], [-0.032, -0.0141], [-0.0325, -0.0144], [-0.0395, -0.0196], [-0.04, -0.0199], [-0.0407, -0.02], [-0.0644, -0.02], [-0.0656, -0.0195], [-0.0663, -0.0184], [-0.07, -2e-4], [-0.07, 0], [-0.07, 2e-4]], width: 0.028, bevel: 14e-4, plane: "yz", pos: [0, 0, 0], mat: "gun_cerakote_black" },
      { shape: "cyl", pos: [0.0151, -0.06, 4e-3], radius: 22e-4, length: 12e-4, axis: "x", segments: 10, lod: false, mat: "gun_steel_bare", mirror: "x" },
      { shape: "cyl", pos: [0.0151, 0.09, 4e-3], radius: 22e-4, length: 12e-4, axis: "x", segments: 10, lod: false, mat: "gun_steel_bare", mirror: "x" },
      { shape: "cyl", pos: [0.0151, 0, -2e-3], radius: 22e-4, length: 12e-4, axis: "x", segments: 10, lod: false, mat: "gun_steel_bare", mirror: "x" },
      { shape: "profile", pts: [[-0.0612, -0.0137], [-0.0601, -0.012], [-0.0582, -0.011], [-0.0562, -0.0111], [-0.0275, -0.0198], [-0.0257, -0.0209], [-0.0247, -0.0228], [-0.0248, -0.0248], [-0.0287, -0.0376], [-0.0288, -0.0378], [-0.0288, -0.038], [-0.0288, -0.0382], [-0.0296, -0.0437], [-0.0297, -0.0444], [-0.03, -0.045], [-0.0304, -0.0456], [-0.0342, -0.0504], [-0.0346, -0.0511], [-0.0349, -0.0518], [-0.035, -0.0526], [-0.0359, -0.0642], [-0.0361, -0.0649], [-0.0364, -0.0657], [-0.0368, -0.0663], [-0.0405, -0.071], [-0.0409, -0.0717], [-0.0412, -0.0724], [-0.0413, -0.0732], [-0.0422, -0.0848], [-0.0424, -0.0856], [-0.0427, -0.0863], [-0.0431, -0.0869], [-0.0468, -0.0917], [-0.0472, -0.0923], [-0.0475, -0.093], [-0.0476, -0.0938], [-0.0488, -0.1064], [-0.049, -0.1071], [-0.0492, -0.1078], [-0.0496, -0.1085], [-0.0524, -0.112], [-0.0536, -0.113], [-0.0552, -0.1135], [-0.0567, -0.1134], [-0.084, -0.105], [-0.0855, -0.1042], [-0.0865, -0.1029], [-0.0868, -0.1012], [-0.0869, -0.0895], [-0.0869, -0.089], [-0.0868, -0.0886], [-0.0866, -0.0881], [-0.0686, -0.0381], [-0.0686, -0.038], [-0.0686, -0.038], [-0.0686, -0.0379]], width: 0.029, bevel: 3e-3, plane: "yz", pos: [0, 0, 0], smooth: 45, mat: "poly_black_grip" },
      { shape: "profile", pts: [[-0.0876, -0.1066], [-0.0874, -0.1077], [-0.0866, -0.1084], [-0.056, -0.1178], [-0.0549, -0.1177], [-0.0541, -0.1168], [-0.0532, -0.1139], [-0.0534, -0.1128], [-0.0542, -0.112], [-0.0848, -0.1027], [-0.0859, -0.1028], [-0.0867, -0.1037]], width: 0.03, bevel: 1e-3, plane: "yz", pos: [0, 0, 0], mat: "poly_black" },
      { shape: "profile", pts: [[0, 0], [4e-3, 0], [65e-4, -8e-3], [6e-3, -0.016], [25e-4, -0.024], [-1e-3, -0.025], [1e-3, -0.016], [15e-4, -8e-3]], width: 55e-4, bevel: 6e-4, plane: "yz", pos: [0, 0, -0.01], group: "trigger", mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0, 2e-3, -9e-3], radius: 16e-4, length: 0.03, axis: "x", segments: 10, lod: false, mat: "gun_steel_bare" },
      { shape: "sweep", path: [[0, -0.026, -0.014], [0, -0.026, -0.031], [0, -0.0255, -0.0337], [0, -0.0239, -0.0359], [0, -0.0217, -0.0375], [0, -0.019, -0.038], [0, 0.023, -0.038], [0, 0.0257, -0.0375], [0, 0.0279, -0.0359], [0, 0.0295, -0.0337], [0, 0.03, -0.031], [0, 0.03, -0.014]], section: { kind: "rect", w: 0.014, h: 4e-3, c: 12e-4 }, mat: "gun_cerakote_black" },
      { shape: "cyl", pos: [-0.0148, -0.022, -2e-3], radius: 5e-3, length: 25e-4, axis: "x", segments: 14, mat: "gun_cerakote_black" },
      { shape: "profile", pts: [[0.0449, -62e-4], [0.0456, -49e-4], [0.0471, -44e-4], [0.0769, -76e-4], [0.0783, -83e-4], [0.0787, -98e-4], [0.0635, -0.154], [0.0624, -0.156], [0.0602, -0.1566], [0.0324, -0.1537], [0.0304, -0.1526], [0.0297, -0.1504]], width: 0.02, bevel: 12e-4, plane: "yz", pos: [0, 0, 0], group: "mag", mat: "gun_parkerized_dark" },
      { shape: "profile", pts: [[0.026, -0.1589], [0.0264, -0.1605], [0.0278, -0.1613], [0.0642, -0.1651], [0.0657, -0.1646], [0.0664, -0.1631], [0.0664, -0.1571], [0.0659, -0.1557], [0.0646, -0.1551], [0.0294, -0.1514], [0.028, -0.1518], [0.0273, -0.153]], width: 0.024, bevel: 15e-4, plane: "yz", pos: [0, 0, 0], group: "mag", mat: "gun_parkerized_dark" },
      { shape: "slot", pos: [0.0104, 0.0565, -0.0582], length: 0.0238, width: 3e-3, depth: 12e-4, plane: "yz", hpr: [0, -6, 0], group: "mag", lod: false, mat: "gun_parkerized_dark", mirror: "x" },
      { shape: "slot", pos: [0.0104, 0.0518, -0.103], length: 0.0238, width: 3e-3, depth: 12e-4, plane: "yz", hpr: [0, -6, 0], group: "mag", lod: false, mat: "gun_parkerized_dark", mirror: "x" },
      { shape: "box", pos: [0, 0.062, -4e-3], size: [0.016, 0.024, 4e-3], bevel: 8e-4, group: "mag", lod: false, mat: "poly_follower" },
      { shape: "cyl", pos: [0, 0.064, -5e-4], radius: 45e-4, length: 0.018, axis: "y", segments: 12, group: "mag", lod: false, mat: "gun_brass" },
      { shape: "cyl", pos: [0, 0.24, 0.03], radius: 0.0205, length: 0.28, axis: "y", bevel: 18e-4, segments: 32, mat: "gun_cerakote_black" },
      { shape: "cyl", pos: [0, 0.382, 0.03], radius: 0.0195, length: 6e-3, axis: "y", bevel: 1e-3, segments: 32, mat: "gun_knurl" },
      { shape: "cyl", pos: [0, 0.3855, 0.03], radius: 45e-4, length: 8e-4, axis: "y", segments: 14, lod: false, wear: false, mat: "shadow" },
      { shape: "torus", pos: [0, 0.25, 0.03], radius: 0.0205, tube: 9e-4, axis: "y", lod: false, mat: "gun_cerakote_black", repeat: { count: 5, step: [0, 0.024, 0] } },
      { shape: "loft", kind: "rect", sections: [{ y: 0.1, w: 0.05, h: 0.05, z: 0.029, c: 0.012 }, { y: 0.2, w: 0.05, h: 0.05, z: 0.029, c: 0.012 }], mat: "poly_black" },
      { shape: "slot", pos: [0.0256, 0.125, 0.026], length: 0.026, width: 6e-3, depth: 12e-4, plane: "yz", lod: false, mat: "shadow", repeat: { count: 3, step: [0, 0.026, 0] } },
      { shape: "slot", pos: [-0.0256, 0.125, 0.026], length: 0.026, width: 6e-3, depth: 12e-4, plane: "yz", lod: false, mat: "shadow", repeat: { count: 3, step: [0, 0.026, 0] } },
      { shape: "box", pos: [0, 0.15, 0.056], size: [0.0153, 0.09, 4e-3], bevel: 6e-4, mat: "poly_black" },
      { shape: "profile", pts: [[-0.0106, 0], [0.0106, 0], [9e-3, 3e-3], [-9e-3, 3e-3]], width: 52e-4, bevel: 4e-4, plane: "xz", pos: [0, 0.11, 0.058], wear: false, mat: "poly_black", repeat: { count: 9, step: [0, 0.01, 0] } },
      { shape: "profile", pts: [[-0.014, 0], [0.014, 0], [0.012, 9e-3], [-0.012, 9e-3]], width: 0.022, bevel: 8e-4, plane: "yz", pos: [0, -0.05, 0.057], mat: "gun_cerakote_black" },
      { shape: "torus", pos: [0, -0.05, 0.0826], radius: 58e-4, tube: 16e-4, axis: "y", mat: "gun_cerakote_black" },
      { shape: "profile", pts: [[15e-4, 0], [58e-4, 0], [58e-4, 0.0135], [15e-4, 0.0135]], width: 36e-4, bevel: 4e-4, plane: "xz", pos: [0, -0.05, 0.066], mat: "gun_cerakote_black" },
      { shape: "profile", pts: [[0.0105, 0], [0.0135, 0], [0.0135, 0.0276], [0.011, 0.0296]], width: 6e-3, bevel: 5e-4, plane: "xz", pos: [0, -0.05, 0.057], mat: "gun_cerakote_black" },
      { shape: "profile", pts: [[-15e-4, 0], [-58e-4, 0], [-58e-4, 0.0135], [-15e-4, 0.0135]], width: 36e-4, bevel: 4e-4, plane: "xz", pos: [0, -0.05, 0.066], mat: "gun_cerakote_black" },
      { shape: "profile", pts: [[-0.0105, 0], [-0.0135, 0], [-0.0135, 0.0276], [-0.011, 0.0296]], width: 6e-3, bevel: 5e-4, plane: "xz", pos: [0, -0.05, 0.057], mat: "gun_cerakote_black" },
      { shape: "cyl", pos: [0.014, -0.05, 0.062], radius: 45e-4, length: 4e-3, axis: "x", segments: 14, lod: false, mat: "gun_knurl" },
      { shape: "profile", pts: [[-0.011, 27e-4], [-0.0111, 14e-4], [-0.0103, 4e-4], [-91e-4, 0], [91e-4, 0], [0.0103, 4e-4], [0.0111, 14e-4], [0.011, 27e-4], [61e-4, 0.0164], [6e-3, 0.0165], [6e-3, 0.0166], [59e-4, 0.0167], [38e-4, 0.0215], [35e-4, 0.0218], [32e-4, 0.022], [29e-4, 0.022], [-29e-4, 0.022], [-32e-4, 0.022], [-35e-4, 0.0218], [-38e-4, 0.0215], [-59e-4, 0.0167], [-6e-3, 0.0166], [-6e-3, 0.0165], [-61e-4, 0.0164]], width: 0.014, bevel: 8e-4, plane: "yz", pos: [0, 0.18, 0.061], mat: "gun_cerakote_black" },
      { shape: "box", pos: [0, 0.18, 0.08], size: [24e-4, 24e-4, 62e-4], bevel: 4e-4, mat: "gun_cerakote_black" },
      { shape: "slot", pos: [0, 0.18, 0.0742], length: 0.012, width: 8e-3, depth: 0.0206, plane: "xz", lod: false, mat: "shadow" },
      { shape: "box", pos: [-0.018, 0.07, 0.04], size: [0.012, 0.01, 8e-3], bevel: 15e-4, group: "charge", mat: "gun_cerakote_black" },
      { shape: "sweep", path: [[0.012, -0.07, 0.04], [0.0122, -0.1999, 0.034], [0.0123, -0.2, 0.034], [0.0125, -0.2, 0.034], [0.0126, -0.2001, 0.034], [0.0128, -0.2808, 0.0308], [0.0129, -0.2905, 0.0278], [0.0131, -0.2975, 0.0206], [0.0132, -0.3, 0.0108], [0.0134, -0.3, -0.0244], [0.0135, -0.2964, -0.0358], [0.0137, -0.2871, -0.0431], [0.0138, -0.2751, -0.0438], [0.014, -0.22, -0.03]], section: { kind: "circle", r: 42e-4 }, mat: "gun_steel_bare" },
      { shape: "sweep", path: [[-0.012, -0.07, 0.04], [-0.0122, -0.1999, 0.034], [-0.0123, -0.2, 0.034], [-0.0125, -0.2, 0.034], [-0.0126, -0.2001, 0.034], [-0.0128, -0.2808, 0.0308], [-0.0129, -0.2905, 0.0278], [-0.0131, -0.2975, 0.0206], [-0.0132, -0.3, 0.0108], [-0.0134, -0.3, -0.0244], [-0.0135, -0.2964, -0.0358], [-0.0137, -0.2871, -0.0431], [-0.0138, -0.2751, -0.0438], [-0.014, -0.22, -0.03]], section: { kind: "circle", r: 42e-4 }, mat: "gun_steel_bare" },
      { shape: "profile", pts: [[-0.3, 0.034], [-0.3006, 0.0354], [-0.302, 0.036], [-0.308, 0.036], [-0.3108, 0.0348], [-0.312, 0.032], [-0.312, -0.056], [-0.3108, -0.0588], [-0.308, -0.06], [-0.302, -0.06], [-0.3006, -0.0594], [-0.3, -0.058]], width: 0.044, bevel: 3e-3, plane: "yz", pos: [0, 0, 0], mat: "gun_rubber_pad" },
      { shape: "torus", pos: [0, -0.075, 0.03], radius: 6e-3, tube: 16e-4, axis: "y", mat: "gun_steel_bare" }
    ],
    anchors: { muzzle: [0, 0.386, 0.03], eject: [0.016, 0.02, 0.033], sight: [0, -0.053, 0.0826], grip_r: [0, -0.0529, -0.0582], grip_l: [0, 0.16, 0], mag: [0, 0.062, -0.081] },
    bounds: { min: [-0.0262, -0.312, -0.1651], max: [0.0262, 0.3859, 0.09] },
    groups: { bolt: { pivot: [0, 0, 0] }, trigger: { pivot: [0, 0, -0.01] }, charge: { pivot: [0, 0, 0] } },
    viewmodel: { offset: [0.12, 0.32, -0.145], ads_distance: 0.15, elbow_r: [0.28, -0.12, -0.38], elbow_l: [-0.2, 0, -0.4] },
    sight_parts: ["gun_cerakote_black", "poly_black"]
  },
  rifle_vr62: {
    parts: [
      { shape: "profile", pts: [[-0.11, 2e-3], [-0.1094, 6e-4], [-0.108, 0], [0.118, 0], [0.1194, 6e-4], [0.12, 2e-3], [0.12, 0.0453], [0.1199, 0.046], [0.1195, 0.0466], [0.1156, 0.0513], [0.1149, 0.0518], [0.1141, 0.052], [-0.0992, 0.052], [-0.0999, 0.0518], [-0.1006, 0.0514], [-0.1094, 0.0426], [-0.1098, 0.0419], [-0.11, 0.0412]], width: 0.03, bevel: 14e-4, plane: "yz", pos: [0, 0, 0], mat: "gun_blued" },
      { shape: "cyl", pos: [0.0151, -0.095, 6e-3], radius: 24e-4, length: 12e-4, axis: "x", segments: 10, lod: false, mat: "gun_steel_bare", mirror: "x" },
      { shape: "cyl", pos: [0.0151, -0.07, 6e-3], radius: 24e-4, length: 12e-4, axis: "x", segments: 10, lod: false, mat: "gun_steel_bare", mirror: "x" },
      { shape: "cyl", pos: [0.0151, 0.09, 6e-3], radius: 24e-4, length: 12e-4, axis: "x", segments: 10, lod: false, mat: "gun_steel_bare", mirror: "x" },
      { shape: "cyl", pos: [0.0151, 0.108, 6e-3], radius: 24e-4, length: 12e-4, axis: "x", segments: 10, lod: false, mat: "gun_steel_bare", mirror: "x" },
      { shape: "cyl", pos: [0.0151, 0.108, 0.026], radius: 24e-4, length: 12e-4, axis: "x", segments: 10, lod: false, mat: "gun_steel_bare", mirror: "x" },
      { shape: "cyl", pos: [0.0151, -0.02, 3e-3], radius: 24e-4, length: 12e-4, axis: "x", segments: 10, lod: false, mat: "gun_steel_bare", mirror: "x" },
      { shape: "slot", pos: [0.0152, 0.06, 0.018], length: 0.03, width: 9e-3, depth: 6e-4, plane: "yz", lod: false, mat: "shadow", mirror: "x" },
      { shape: "profile", pts: [[-0.1, 0.052], [0.11, 0.052], [0.11, 0.0562], [0.1097, 0.0576], [0.1089, 0.0589], [0.1076, 0.0598], [0.1062, 0.0601], [-0.0697, 0.066], [-0.0698, 0.066], [-0.07, 0.066], [-0.0702, 0.066], [-0.0703, 0.066], [-0.0984, 0.0679], [-0.0992, 0.0679], [-0.1, 0.0678], [-0.1007, 0.0676], [-0.1015, 0.0673], [-0.1065, 0.0647], [-0.108, 0.0635], [-0.1087, 0.0616], [-0.1085, 0.0597], [-0.1073, 0.0581]], width: 0.027, bevel: 16e-4, plane: "yz", pos: [0, 0, 0], smooth: 40, mat: "gun_blued" },
      { shape: "box", pos: [0, -0.04, 0.066], size: [0.026, 4e-3, 15e-4], bevel: 4e-4, lod: false, mat: "gun_blued", repeat: { count: 4, step: [0, 0.03, 0] } },
      { shape: "profile", pts: [[-0.0668, 0.0195], [-0.0673, 0.0211], [-0.066, 0.0221], [0.0391, 0.026], [0.0399, 0.0262], [0.0404, 0.0268], [0.041, 0.0281], [0.041, 0.0294], [0.0399, 0.03], [-0.0671, 0.028], [-0.0679, 0.0278], [-0.0684, 0.0272], [-0.0731, 0.0179], [-0.0731, 0.0165], [-0.0719, 0.0157], [-0.0654, 0.0148], [-0.0639, 0.0157], [-0.0643, 0.0174]], width: 22e-4, bevel: 4e-4, plane: "yz", pos: [0.0162, 0, 0], mat: "gun_blued" },
      { shape: "box", pos: [0.0152, 0.06, 0.042], size: [8e-4, 0.06, 0.016], bevel: 0, lod: false, wear: false, mat: "shadow" },
      { shape: "box", pos: [0.0143, 0.062, 0.042], size: [2e-3, 0.05, 0.012], bevel: 6e-4, group: "bolt", lod: false, mat: "gun_steel_bare" },
      { shape: "box", pos: [0.0175, 0.1, 0.042], size: [6e-3, 8e-3, 6e-3], bevel: 1e-3, group: "bolt", mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0.024, 0.1, 0.042], radius: 45e-4, length: 8e-3, axis: "x", segments: 14, group: "bolt", mat: "gun_steel_bare" },
      { shape: "box", pos: [0, 0.15, 0.048], size: [0.024, 0.06, 0.012], bevel: 2e-3, mat: "gun_blued" },
      { shape: "box", pos: [0, 0.13, 0.056], size: [0.02, 0.02, 6e-3], bevel: 12e-4, mat: "gun_blued" },
      { shape: "box", pos: [0, 0.15, 0.062], size: [0.014, 0.05, 3e-3], bevel: 6e-4, mat: "gun_blued" },
      { shape: "box", pos: [0, 0.128, 0.068], size: [0.014, 4e-3, 0.014], bevel: 6e-4, mat: "gun_blued" },
      { shape: "box", pos: [45e-4, 0.128, 0.0775], size: [5e-3, 4e-3, 5e-3], bevel: 5e-4, mat: "gun_blued" },
      { shape: "box", pos: [-45e-4, 0.128, 0.0775], size: [5e-3, 4e-3, 5e-3], bevel: 5e-4, mat: "gun_blued" },
      { shape: "box", pos: [0, 0.16, 0.066], size: [0.016, 8e-3, 5e-3], bevel: 8e-4, mat: "gun_blued" },
      { shape: "loft", kind: "round", sections: [{ y: 0.18, w: 0.044, h: 0.03, z: 0.022, c: 0.012 }, { y: 0.19, w: 0.048, h: 0.036, z: 0.022, c: 0.014 }, { y: 0.42, w: 0.046, h: 0.034, z: 0.024, c: 0.013 }, { y: 0.43, w: 0.04, h: 0.028, z: 0.024, c: 0.011 }], segments: 20, mat: "gun_wood_red" },
      { shape: "slot", pos: [0.0242, 0.305, 0.024], length: 0.14, width: 4e-3, depth: 12e-4, plane: "yz", lod: false, mat: "gun_wood_red" },
      { shape: "slot", pos: [-0.0242, 0.305, 0.024], length: 0.14, width: 4e-3, depth: 12e-4, plane: "yz", lod: false, mat: "gun_wood_red" },
      { shape: "loft", kind: "ellipse", sections: [{ y: 0.21, w: 0.026, h: 0.018, z: 0.049 }, { y: 0.35, w: 0.026, h: 0.018, z: 0.049 }], segments: 18, mat: "gun_wood_red" },
      { shape: "cyl", pos: [0, 0.39, 0.051], radius: 68e-4, length: 0.09, axis: "y", segments: 16, mat: "gun_blued" },
      { shape: "box", pos: [0, 0.46, 0.045], size: [0.022, 0.03, 0.032], bevel: 2e-3, mat: "gun_blued" },
      { shape: "cyl", pos: [0, 0.46, 0.051], radius: 72e-4, length: 0.032, axis: "y", segments: 16, mat: "gun_blued" },
      { shape: "box", pos: [0, 0.6, 0.042], size: [0.02, 0.026, 0.026], bevel: 2e-3, mat: "gun_blued" },
      { shape: "box", pos: [0, 0.6, 0.06], size: [0.012, 0.014, 0.012], bevel: 15e-4, mat: "gun_blued" },
      { shape: "torus", pos: [0, 0.6, 0.072], radius: 0.011, tube: 18e-4, axis: "y", arc: 200, start: -10, mat: "gun_blued" },
      { shape: "box", pos: [0, 0.6, 0.072], size: [25e-4, 3e-3, 0.014], bevel: 4e-4, mat: "gun_blued" },
      { shape: "cyl", pos: [0, 0.37, 0.036], radius: 98e-4, radius2: 92e-4, length: 0.5, axis: "y", segments: 24, mat: "gun_blued" },
      { shape: "cyl", pos: [0, 0.645, 0.036], radius: 0.0118, length: 0.05, axis: "y", bevel: 1e-3, segments: 24, mat: "gun_blued" },
      { shape: "box", pos: [0, 0.668, 0.045], size: [0.026, 0.01, 0.01], bevel: 2e-3, hpr: [0, 0, 0], mat: "gun_blued" },
      { shape: "cyl", pos: [0, 0.6705, 0.036], radius: 45e-4, length: 8e-4, axis: "y", segments: 14, lod: false, wear: false, mat: "shadow" },
      { shape: "cyl", pos: [0, 0.52, 0.02], radius: 28e-4, length: 0.17, axis: "y", segments: 10, mat: "gun_steel_bare" },
      { shape: "profile", pts: [[-0.11, 0.0377], [-0.1103, 0.0393], [-0.1113, 0.0406], [-0.1127, 0.0415], [-0.1143, 0.0417], [-0.1991, 0.0361], [-0.1995, 0.036], [-0.2, 0.036], [-0.2005, 0.0359], [-0.2009, 0.0359], [-0.3995, 0.0101], [-0.3997, 0.01], [-0.4, 0.01], [-0.4002, 99e-4], [-0.4005, 98e-4], [-0.4075, 7e-3], [-0.4085, 64e-4], [-0.4093, 55e-4], [-0.4098, 45e-4], [-0.41, 33e-4], [-0.41, -0.0909], [-0.4098, -0.0922], [-0.4092, -0.0933], [-0.4082, -0.0942], [-0.407, -0.0948], [-0.3923, -0.0984], [-0.3912, -0.0986], [-0.39, -0.0986], [-0.3889, -0.0985], [-0.3877, -0.0982], [-0.2504, -0.0491], [-0.2502, -0.0491], [-0.25, -0.049], [-0.2498, -0.0489], [-0.2496, -0.0489], [-0.131, -44e-4], [-0.1305, -42e-4], [-0.13, -4e-3], [-0.1295, -38e-4], [-0.1291, -35e-4], [-0.1122, 49e-4], [-0.1113, 55e-4], [-0.1106, 64e-4], [-0.1102, 74e-4], [-0.11, 85e-4]], width: 0.038, bevel: 45e-4, plane: "yz", pos: [0, 0, 0], smooth: 45, mat: "gun_wood_red" },
      { shape: "profile", pts: [[-0.41, 54e-4], [-0.4108, 7e-3], [-0.4125, 74e-4], [-0.4165, 64e-4], [-0.4176, 57e-4], [-0.418, 44e-4], [-0.418, -0.0954], [-0.4172, -0.097], [-0.4155, -0.0974], [-0.4115, -0.0964], [-0.4104, -0.0957], [-0.41, -0.0944]], width: 0.04, bevel: 12e-4, plane: "yz", pos: [0, 0, 0], mat: "gun_blued" },
      { shape: "slot", pos: [0, -0.3, -0.076], length: 0.026, width: 6e-3, depth: 14e-4, plane: "xy", hpr: [90, 0, 0], lod: false, mat: "shadow" },
      { shape: "profile", pts: [[-0.0609, 81e-4], [-0.0596, 98e-4], [-0.0577, 0.0106], [-0.0557, 0.0103], [-0.0279, -9e-4], [-0.0262, -22e-4], [-0.0254, -41e-4], [-0.0256, -61e-4], [-0.0309, -0.0191], [-0.0309, -0.0191], [-0.0309, -0.0191], [-0.0309, -0.0191], [-0.0573, -0.0874], [-0.0575, -0.0879], [-0.0578, -0.0883], [-0.0581, -0.0887], [-0.0615, -0.0924], [-0.0628, -0.0933], [-0.0644, -0.0937], [-0.0659, -0.0934], [-0.0923, -0.0827], [-0.0937, -0.0818], [-0.0946, -0.0803], [-0.0948, -0.0786], [-0.0937, -0.0667], [-0.0937, -0.0662], [-0.0936, -0.0658], [-0.0934, -0.0654], [-0.0707, -0.0161], [-0.0706, -0.016], [-0.0706, -0.016], [-0.0706, -0.0159]], width: 0.03, bevel: 3e-3, plane: "yz", pos: [0, 0, 0], smooth: 45, mat: "gun_wood_red" },
      { shape: "profile", pts: [[-0.096, -0.0839], [-0.096, -0.0851], [-0.0952, -0.0859], [-0.0656, -0.0978], [-0.0644, -0.0978], [-0.0636, -0.097], [-0.0625, -0.0942], [-0.0625, -0.0931], [-0.0633, -0.0923], [-0.0929, -0.0803], [-0.0941, -0.0803], [-0.0949, -0.0811]], width: 0.031, bevel: 1e-3, plane: "yz", pos: [0, 0, 0], mat: "poly_black" },
      { shape: "profile", pts: [[0, 0], [4e-3, 0], [65e-4, -8e-3], [6e-3, -0.016], [25e-4, -0.024], [-1e-3, -0.025], [1e-3, -0.016], [15e-4, -8e-3]], width: 55e-4, bevel: 6e-4, plane: "yz", pos: [0, 0, -4e-3], group: "trigger", mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0, 2e-3, -3e-3], radius: 16e-4, length: 0.03, axis: "x", segments: 10, lod: false, mat: "gun_steel_bare" },
      { shape: "sweep", path: [[0, -0.028, -8e-3], [0, -0.028, -0.023], [0, -0.0275, -0.0257], [0, -0.0259, -0.0279], [0, -0.0237, -0.0295], [0, -0.021, -0.03], [0, 0.033, -0.03], [0, 0.0357, -0.0295], [0, 0.0379, -0.0279], [0, 0.0395, -0.0257], [0, 0.04, -0.023], [0, 0.04, -8e-3]], section: { kind: "rect", w: 0.014, h: 4e-3, c: 12e-4 }, mat: "gun_blued" },
      { shape: "torus", pos: [0, 0.45, 6e-3], radius: 7e-3, tube: 16e-4, axis: "y", mat: "gun_steel_bare" },
      { shape: "sweep", path: [[0, 0.07, 2e-3], [0, 0.0704, -0.015], [0, 0.0718, -0.0319], [0, 0.074, -0.0488], [0, 0.0771, -0.0655], [0, 0.0811, -0.082], [0, 0.0859, -0.0983], [0, 0.0916, -0.1144], [0, 0.0981, -0.1301], [0, 0.1054, -0.1454], [0, 0.1135, -0.1603]], section: { kind: "rect", w: 0.024, h: 0.058, c: 2e-3 }, scales: [[1, 1], [1, 1.012], [1, 1.024], [1, 1.036], [1, 1.048], [1, 1.06], [1, 1.072], [1, 1.084], [1, 1.096], [1, 1.108], [1, 1.12]], side: [1, 0, 0], group: "mag", mat: "gun_parkerized_dark" },
      { shape: "box", pos: [0, 0.115, -0.1638], size: [0.028, 0.071, 8e-3], bevel: 2e-3, hpr: [0, 30, 0], group: "mag", mat: "gun_parkerized_dark" },
      { shape: "slot", pos: [0.0125, 0.0718, -0.0319], length: 0.0435, width: 35e-4, depth: 12e-4, plane: "yz", hpr: [0, 6, 0], group: "mag", lod: false, mat: "gun_parkerized_dark", mirror: "x" },
      { shape: "slot", pos: [0.0125, 0.0771, -0.0655], length: 0.0435, width: 35e-4, depth: 12e-4, plane: "yz", hpr: [0, 12, 0], group: "mag", lod: false, mat: "gun_parkerized_dark", mirror: "x" },
      { shape: "slot", pos: [0.0125, 0.0859, -0.0983], length: 0.0435, width: 35e-4, depth: 12e-4, plane: "yz", hpr: [0, 18, 0], group: "mag", lod: false, mat: "gun_parkerized_dark", mirror: "x" },
      { shape: "slot", pos: [0.0125, 0.0981, -0.1301], length: 0.0435, width: 35e-4, depth: 12e-4, plane: "yz", hpr: [0, 24, 0], group: "mag", lod: false, mat: "gun_parkerized_dark", mirror: "x" },
      { shape: "box", pos: [0, 0.07, 4e-3], size: [0.02, 0.05, 4e-3], bevel: 8e-4, group: "mag", lod: false, mat: "poly_follower" },
      { shape: "cyl", pos: [0, 0.073, 8e-3], radius: 55e-4, length: 0.046, axis: "y", segments: 12, group: "mag", lod: false, mat: "gun_brass" }
    ],
    anchors: { muzzle: [0, 0.672, 0.036], eject: [0.018, 0.06, 0.042], sight: [0, 0.125, 0.079], grip_r: [0, -0.0569, -0.0377], grip_l: [0, 0.33, 2e-3], mag: [0, 0.0811, -0.082] },
    bounds: { min: [-0.0325, -0.418, -0.1928], max: [0.0325, 0.673, 0.0848] },
    groups: { bolt: { pivot: [0, 0, 0] }, trigger: { pivot: [0, 0, -4e-3] } },
    viewmodel: { offset: [0.125, 0.35, -0.15], ads_distance: 0.2, elbow_r: [0.28, -0.12, -0.38], elbow_l: [-0.22, 0.02, -0.4] },
    sight_parts: ["gun_blued"]
  },
  rifle_bx4: {
    parts: [
      { shape: "profile", pts: [[-0.42, 0.015], [-0.42, 0.0611], [-0.4193, 0.0649], [-0.4171, 0.0682], [-0.4139, 0.0703], [-0.4101, 0.0711], [-0.1205, 0.075], [-0.1202, 0.075], [-0.12, 0.075], [-0.1198, 0.075], [-0.1195, 0.075], [0.0979, 0.071], [0.0989, 0.071], [0.1, 0.0709], [0.101, 0.0708], [0.1021, 0.0707], [0.1931, 0.0561], [0.1963, 0.0553], [0.1994, 0.054], [0.2022, 0.0521], [0.2047, 0.0498], [0.2132, 0.0404], [0.2153, 0.0371], [0.2158, 0.0332], [0.2149, 0.0294], [0.2125, 0.0263], [0.2029, 0.0176], [0.2014, 0.0165], [0.1997, 0.0157], [0.198, 0.0152], [0.1962, 0.015], [0.0648, 0.015], [0.0627, 0.0147], [0.0607, 0.0138], [0.059, 0.0125], [0.0578, 0.0107], [0.0517, -8e-4], [0.0507, -21e-4], [0.0495, -31e-4], [0.048, -38e-4], [0.0464, -4e-3], [-0.0322, -4e-3], [-0.0336, -39e-4], [-0.0349, -36e-4], [-0.0362, -32e-4], [-0.0374, -26e-4], [-0.0505, 53e-4], [-0.0553, 78e-4], [-0.0604, 95e-4], [-0.0657, 0.0106], [-0.0711, 0.011], [-0.3281, 0.011], [-0.329, 0.0109], [-0.3299, 0.0108], [-0.3309, 0.0105], [-0.3317, 0.0101], [-0.3991, -0.0246], [-0.3996, -0.0247], [-0.4, -0.0249], [-0.4005, -0.025], [-0.401, -0.025], [-0.416, -0.025], [-0.4175, -0.0247], [-0.4188, -0.0238], [-0.4197, -0.0225], [-0.42, -0.021]], width: 0.05, bevel: 45e-4, plane: "yz", pos: [0, 0, 0], smooth: 40, mat: "poly_od" },
      { shape: "profile", pts: [[-0.3704, 0.0748], [-0.3715, 0.0736], [-0.3712, 0.0719], [-0.3697, 0.0711], [-0.2038, 0.073], [-0.2019, 0.0735], [-0.2005, 0.0749], [-0.2, 0.0768], [-0.2, 0.0772], [-0.2005, 0.0791], [-0.2019, 0.0805], [-0.2038, 0.081], [-0.3589, 0.079], [-0.3596, 0.079], [-0.3603, 0.0788], [-0.361, 0.0786]], width: 0.04, bevel: 3e-3, plane: "yz", pos: [0, 0, 0], mat: "poly_od_grip" },
      { shape: "sweep", path: [[0, -0.035, -4e-3], [0, -0.0317, -0.024], [0, -0.0303, -0.0279], [0, -0.0276, -0.0312], [0, -0.024, -0.0333], [0, -0.0198, -0.034], [0, 0.0502, -0.034], [0, 0.0542, -0.0333], [0, 0.0578, -0.0313], [0, 0.0605, -0.0282], [0, 0.062, -0.0244], [0, 0.07, 0.015]], section: { kind: "rect", w: 0.016, h: 6e-3, c: 2e-3 }, mat: "poly_od" },
      { shape: "profile", pts: [[-0.0262, -32e-4], [-0.0254, -13e-4], [-0.0237, -1e-4], [-0.0216, 2e-4], [61e-4, -37e-4], [8e-3, -45e-4], [92e-4, -62e-4], [95e-4, -82e-4], [77e-4, -0.0209], [77e-4, -0.0211], [77e-4, -0.0213], [77e-4, -0.0215], [78e-4, -0.0269], [77e-4, -0.0275], [76e-4, -0.0282], [73e-4, -0.0289], [45e-4, -0.034], [42e-4, -0.0347], [4e-3, -0.0355], [4e-3, -0.0362], [48e-4, -0.0474], [48e-4, -0.0482], [46e-4, -0.049], [43e-4, -0.0497], [16e-4, -0.0547], [13e-4, -0.0554], [11e-4, -0.0562], [11e-4, -0.0569], [19e-4, -0.0681], [19e-4, -0.0689], [17e-4, -0.0697], [14e-4, -0.0704], [-14e-4, -0.0754], [-17e-4, -0.0761], [-18e-4, -0.0768], [-19e-4, -0.0776], [-11e-4, -0.0898], [-11e-4, -0.0905], [-13e-4, -0.0913], [-16e-4, -0.092], [-36e-4, -0.0957], [-47e-4, -0.0969], [-61e-4, -0.0976], [-77e-4, -0.0977], [-0.0341, -0.094], [-0.0357, -0.0934], [-0.0369, -0.0922], [-0.0375, -0.0906], [-0.0392, -0.0795], [-0.0393, -0.0791], [-0.0393, -0.0786], [-0.0392, -0.0782], [-0.0296, -0.0276], [-0.0296, -0.0275], [-0.0296, -0.0274], [-0.0296, -0.0274]], width: 0.03, bevel: 3e-3, plane: "yz", pos: [0, 0, 0], smooth: 45, mat: "poly_od_grip" },
      { shape: "profile", pts: [[-0.0374, -0.096], [-0.0371, -0.0972], [-0.0361, -0.0977], [-63e-4, -0.1019], [-52e-4, -0.1016], [-46e-4, -0.1007], [-42e-4, -0.0977], [-45e-4, -0.0966], [-55e-4, -0.096], [-0.0353, -0.0918], [-0.0364, -0.0921], [-0.037, -0.0931]], width: 0.031, bevel: 1e-3, plane: "yz", pos: [0, 0, 0], mat: "poly_black" },
      { shape: "profile", pts: [[0, 0], [4e-3, 0], [6e-3, -9e-3], [4e-3, -0.018], [0, -0.019], [2e-3, -9e-3]], width: 6e-3, bevel: 5e-4, plane: "yz", pos: [0, 0.026, -4e-3], group: "trigger", mat: "gun_steel_bare" },
      { shape: "profile", pts: [[-0.0138, -52e-4], [-0.0132, -26e-4], [-0.0113, -7e-4], [-88e-4, 0], [88e-4, 0], [0.0113, -7e-4], [0.0132, -26e-4], [0.0138, -52e-4], [0.0112, -0.0652], [0.0105, -0.0676], [86e-4, -0.0694], [62e-4, -0.07], [-62e-4, -0.07], [-86e-4, -0.0694], [-0.0105, -0.0676], [-0.0112, -0.0652]], width: 0.026, bevel: 3e-3, plane: "yz", pos: [0, 0.15, 0.015], mat: "poly_od_grip" },
      { shape: "box", pos: [0, 0.15, 0.014], size: [0.024, 0.04, 6e-3], bevel: 15e-4, mat: "gun_anodized" },
      { shape: "sweep", path: [[0, -0.12, 0.011], [0, -0.1198, -4e-3], [0, -0.1194, -0.019], [0, -0.1186, -0.034], [0, -0.1175, -0.0489], [0, -0.1161, -0.0639], [0, -0.1144, -0.0788], [0, -0.1123, -0.0936], [0, -0.11, -0.1084], [0, -0.1073, -0.1232], [0, -0.1043, -0.1379]], section: { kind: "rect", w: 0.023, h: 0.06, c: 2e-3 }, scales: [[1, 1], [1, 1.012], [1, 1.024], [1, 1.036], [1, 1.048], [1, 1.06], [1, 1.072], [1, 1.084], [1, 1.096], [1, 1.108], [1, 1.12]], side: [1, 0, 0], group: "mag", mat: "poly_black" },
      { shape: "box", pos: [0, -0.1037, -0.1418], size: [0.027, 0.0732, 8e-3], bevel: 2e-3, hpr: [0, 12, 0], group: "mag", mat: "poly_black" },
      { shape: "slot", pos: [0.012, -0.1194, -0.019], length: 0.045, width: 35e-4, depth: 12e-4, plane: "yz", hpr: [0, 2.4, 0], group: "mag", lod: false, mat: "poly_black", mirror: "x" },
      { shape: "slot", pos: [0.012, -0.1161, -0.0639], length: 0.045, width: 35e-4, depth: 12e-4, plane: "yz", hpr: [0, 6, 0], group: "mag", lod: false, mat: "poly_black", mirror: "x" },
      { shape: "slot", pos: [0.012, -0.1123, -0.0936], length: 0.045, width: 35e-4, depth: 12e-4, plane: "yz", hpr: [0, 8.4, 0], group: "mag", lod: false, mat: "poly_black", mirror: "x" },
      { shape: "box", pos: [0, -0.12, 0.013], size: [0.019, 0.052, 4e-3], bevel: 8e-4, group: "mag", lod: false, mat: "poly_follower" },
      { shape: "cyl", pos: [0, -0.117, 0.017], radius: 55e-4, length: 0.048, axis: "y", segments: 12, group: "mag", lod: false, mat: "gun_brass" },
      { shape: "box", pos: [0, -0.07, 0.011], size: [0.054, 8e-3, 0.012], bevel: 15e-4, mat: "gun_anodized" },
      { shape: "box", pos: [0.0252, -0.22, 0.055], size: [2e-3, 0.06, 0.018], bevel: 0, lod: false, wear: false, mat: "shadow" },
      { shape: "box", pos: [0.0244, -0.225, 0.055], size: [2e-3, 0.04, 0.011], bevel: 5e-4, group: "bolt", lod: false, mat: "gun_steel_bare" },
      { shape: "slot", pos: [-0.0252, -0.02, 0.065], length: 0.16, width: 4e-3, depth: 8e-4, plane: "yz", lod: false, mat: "shadow" },
      { shape: "box", pos: [-0.03, 0.05, 0.065], size: [0.01, 0.014, 8e-3], bevel: 15e-4, group: "charge", mat: "gun_anodized" },
      { shape: "profile", pts: [[-0.1012, 0.0754], [-0.1, 0.0731], [-0.0979, 0.0716], [-0.0954, 0.071], [0.0554, 0.071], [0.0579, 0.0716], [0.06, 0.0731], [0.0612, 0.0754], [0.068, 0.1004], [0.0678, 0.104], [0.0656, 0.1069], [0.0622, 0.108], [-0.1022, 0.108], [-0.1056, 0.1069], [-0.1078, 0.104], [-0.108, 0.1004]], width: 0.024, bevel: 2e-3, plane: "yz", pos: [0, 0, 0], mat: "gun_anodized" },
      { shape: "loft", kind: "ellipse", sections: [{ y: -0.12, w: 0.04, h: 0.04, z: 0.12 }, { y: -0.09, w: 0.04, h: 0.04, z: 0.12 }, { y: -0.07, w: 0.032, h: 0.032, z: 0.12 }, { y: 0.03, w: 0.032, h: 0.032, z: 0.12 }, { y: 0.06, w: 0.044, h: 0.044, z: 0.12 }, { y: 0.08, w: 0.044, h: 0.044, z: 0.12 }], segments: 28, caps: false, mat: "gun_anodized" },
      { shape: "cyl", pos: [0, -0.02, 0.12], radius: 0.0155, length: 0.196, axis: "y", bore: 0.0145, segments: 24, wear: false, lod: false, mat: "shadow" },
      { shape: "cyl", pos: [0, 0.0775, 0.12], radius: 0.0215, length: 4e-3, axis: "y", bore: 0.019, segments: 28, wear: false, mat: "gun_anodized" },
      { shape: "cyl", pos: [0, -0.1175, 0.12], radius: 0.0195, length: 4e-3, axis: "y", bore: 0.017, segments: 28, wear: false, mat: "gun_anodized" },
      { shape: "cyl", pos: [0, 0.0804, 0.12], radius: 0.02, length: 1e-3, axis: "y", segments: 28, wear: false, mat: "gun_glass" },
      { shape: "cyl", pos: [0, -0.1204, 0.12], radius: 0.018, length: 1e-3, axis: "y", segments: 28, wear: false, mat: "gun_glass" },
      { shape: "torus", pos: [0, -0.11, 0.12], radius: 0.0205, tube: 14e-4, axis: "y", mat: "gun_rubber_pad" },
      { shape: "sphere", pos: [0, 0.05, 0.12], radius: 7e-4, emit: [60, 2, 2], mat: "pbr_white_rough" },
      { shape: "box", pos: [0, 0.05, 0.116], size: [5e-4, 6e-4, 7e-3], bevel: 0, emit: [30, 1, 1], lod: false, mat: "pbr_white_rough" },
      { shape: "box", pos: [0, 0.05, 0.146], size: [6e-3, 0.02, 0.012], bevel: 15e-4, mat: "gun_anodized" },
      { shape: "box", pos: [0, -0.1, 0.144], size: [8e-3, 0.012, 8e-3], bevel: 15e-4, mat: "gun_anodized" },
      { shape: "cyl", pos: [0, 0.285, 0.045], radius: 95e-4, radius2: 9e-3, length: 0.15, axis: "y", segments: 24, mat: "gun_parkerized_dark" },
      { shape: "cyl", pos: [0, 0.385, 0.045], radius: 0.0112, length: 0.05, axis: "y", bore: 5e-3, bevel: 12e-4, segments: 24, mat: "gun_parkerized_dark" },
      { shape: "cyl", pos: [0, 0.4095, 0.045], radius: 5e-3, length: 8e-4, axis: "y", segments: 16, lod: false, wear: false, mat: "shadow" },
      { shape: "slot", pos: [-81e-4, 0.39, 0.0531], length: 0.0275, width: 3e-3, depth: 8e-4, plane: "yz", hpr: [0, 0, -135], lod: false, mat: "shadow" },
      { shape: "slot", pos: [-81e-4, 0.39, 0.0369], length: 0.0275, width: 3e-3, depth: 8e-4, plane: "yz", hpr: [0, 0, -225], lod: false, mat: "shadow" },
      { shape: "slot", pos: [81e-4, 0.39, 0.0369], length: 0.0275, width: 3e-3, depth: 8e-4, plane: "yz", hpr: [0, 0, -315], lod: false, mat: "shadow" },
      { shape: "slot", pos: [81e-4, 0.39, 0.0531], length: 0.0275, width: 3e-3, depth: 8e-4, plane: "yz", hpr: [0, 0, -405], lod: false, mat: "shadow" },
      { shape: "slot", pos: [0.0252, 0.13, 0.043], length: 0.05, width: 7e-3, depth: 12e-4, plane: "yz", lod: false, mat: "shadow" },
      { shape: "slot", pos: [-0.0252, 0.13, 0.043], length: 0.05, width: 7e-3, depth: 12e-4, plane: "yz", lod: false, mat: "shadow" },
      { shape: "profile", pts: [[-0.42, 0.069], [-0.4206, 0.0704], [-0.422, 0.071], [-0.428, 0.071], [-0.4308, 0.0698], [-0.432, 0.067], [-0.432, -0.021], [-0.4308, -0.0238], [-0.428, -0.025], [-0.422, -0.025], [-0.4206, -0.0244], [-0.42, -0.023]], width: 0.052, bevel: 3e-3, plane: "yz", pos: [0, 0, 0], mat: "gun_rubber_pad" },
      { shape: "cyl", pos: [0.0255, -0.38, 0.035], radius: 65e-4, length: 4e-3, axis: "x", bore: 3e-3, bevel: 6e-4, segments: 16, mat: "gun_steel_bare" },
      { shape: "torus", pos: [0, 0.19, 0.015], radius: 6e-3, tube: 16e-4, axis: "y", mat: "gun_steel_bare" }
    ],
    anchors: { muzzle: [0, 0.41, 0.045], eject: [0.027, -0.22, 0.055], sight: [0, -0.19, 0.12], grip_r: [0, -0.0119, -0.0443], grip_l: [0, 0.15, -0.027], mag: [0, -0.1161, -0.0639] },
    bounds: { min: [-0.035, -0.432, -0.1715], max: [0.0336, 0.41, 0.152] },
    groups: { trigger: { pivot: [0, 0.026, -4e-3] }, bolt: { pivot: [0, 0, 0] }, charge: { pivot: [0, 0, 0] } },
    viewmodel: { offset: [0.125, 0.4, -0.16], ads_distance: 0.16, elbow_r: [0.28, -0.02, -0.38], elbow_l: [-0.16, 0.06, -0.42] }
  },
  rifle_dm8: {
    parts: [
      { shape: "profile", pts: [[-0.1, 0.015], [-0.0994, 0.0136], [-0.098, 0.013], [0.159, 0.013], [0.1597, 0.0133], [0.16, 0.014], [0.16, 0.049], [0.1597, 0.0497], [0.159, 0.05], [-0.0976, 0.05], [-0.098, 0.0499], [-0.0983, 0.0497], [-0.0994, 0.0486], [-0.0998, 0.0479], [-0.1, 0.0472]], width: 0.026, bevel: 12e-4, plane: "yz", pos: [-2e-3, 0, 0], mat: "gun_cerakote_od" },
      { shape: "profile", pts: [[-0.1, 0.013], [4e-3, 0.013], [4e-3, 0.05], [-0.1, 0.05]], width: 4e-3, bevel: 6e-4, plane: "yz", pos: [0.013, 0, 0], mat: "gun_cerakote_od" },
      { shape: "profile", pts: [[0.054, 0.013], [0.16, 0.013], [0.16, 0.05], [0.054, 0.05]], width: 4e-3, bevel: 6e-4, plane: "yz", pos: [0.013, 0, 0], mat: "gun_cerakote_od" },
      { shape: "profile", pts: [[4e-3, 0.0425], [0.054, 0.0425], [0.054, 0.05], [4e-3, 0.05]], width: 4e-3, bevel: 6e-4, plane: "yz", pos: [0.013, 0, 0], mat: "gun_cerakote_od" },
      { shape: "profile", pts: [[4e-3, 0.013], [0.054, 0.013], [0.054, 0.0265], [4e-3, 0.0265]], width: 4e-3, bevel: 6e-4, plane: "yz", pos: [0.013, 0, 0], mat: "gun_cerakote_od" },
      { shape: "box", pos: [0.0112, 0.029, 0.0345], size: [4e-4, 0.05, 0.016], bevel: 0, wear: false, lod: false, mat: "shadow" },
      { shape: "box", pos: [0.0128, 0.025, 0.0345], size: [26e-4, 0.042, 0.011], bevel: 8e-4, group: "bolt", lod: false, mat: "gun_parkerized" },
      { shape: "cyl", pos: [0.0135, 0.034, 0.036], radius: 22e-4, length: 2e-3, axis: "x", segments: 10, group: "bolt", lod: false, mat: "gun_steel_bare" },
      { shape: "box", pos: [0.0157, 0.029, 0.035], size: [12e-4, 0.054, 0.02], bevel: 4e-4, group: "dust_cover", mat: "gun_cerakote_od" },
      { shape: "cyl", pos: [0.0157, 0.029, 0.025], radius: 16e-4, length: 0.056, axis: "y", segments: 10, group: "dust_cover", lod: false, mat: "gun_steel_bare" },
      { shape: "profile", pts: [[-8e-3, 0.035], [3e-3, 0.029], [3e-3, 0.048], [-0.012, 0.048]], width: 5e-3, bevel: 8e-4, plane: "yz", pos: [0.0172, 0, 0], mat: "gun_cerakote_od" },
      { shape: "cyl", pos: [0.0185, -0.045, 0.034], radius: 75e-4, length: 0.04, axis: "y", bevel: 1e-3, segments: 20, hpr: [12, 0, 0], mat: "gun_cerakote_od" },
      { shape: "cyl", pos: [0.0228, -0.067, 0.034], radius: 62e-4, length: 9e-3, axis: "y", segments: 18, hpr: [12, 0, 0], mat: "gun_knurl" },
      { shape: "slot", pos: [0.0151, 0.03, 0.044], length: 0.24, width: 12e-4, depth: 5e-4, plane: "yz", lod: false, mat: "shadow" },
      { shape: "slot", pos: [-0.0151, 0.03, 0.044], length: 0.24, width: 12e-4, depth: 5e-4, plane: "yz", lod: false, mat: "shadow" },
      { shape: "box", pos: [0, -0.106, 0.044], size: [0.01, 0.03, 7e-3], bevel: 1e-3, group: "charge", mat: "gun_cerakote_od" },
      { shape: "profile", pts: [[-0.0208, 28e-4], [-0.0206, 9e-4], [-0.019, 0], [0.019, 0], [0.0206, 9e-4], [0.0208, 28e-4], [0.0194, 61e-4], [0.0188, 68e-4], [0.018, 72e-4], [62e-4, 99e-4], [6e-3, 0.01], [58e-4, 0.01], [-58e-4, 0.01], [-6e-3, 0.01], [-62e-4, 99e-4], [-0.018, 72e-4], [-0.0188, 68e-4], [-0.0194, 61e-4]], width: 9e-3, bevel: 8e-4, plane: "xy", pos: [0, -0.119, 0.041], group: "charge", mat: "gun_cerakote_od" },
      { shape: "box", pos: [-0.016, -0.117, 0.0455], size: [8e-3, 6e-3, 4e-3], bevel: 8e-4, group: "charge", lod: false, mat: "gun_steel_bare" },
      { shape: "profile", pts: [[-0.092, 0.011], [-0.0914, 0.0124], [-0.09, 0.013], [0.116, 0.013], [0.1174, 0.0124], [0.118, 0.011], [0.118, 2e-4], [0.118, 0], [0.118, -2e-4], [0.1171, -55e-4], [0.117, -6e-3], [0.117, -65e-4], [0.1189, -0.0295], [0.1186, -0.0307], [0.1176, -0.0315], [0.1113, -0.0339], [0.111, -0.034], [0.1106, -0.034], [0.0318, -0.034], [0.0304, -0.0335], [0.0298, -0.0322], [0.0282, -0.0198], [0.0276, -0.0185], [0.0262, -0.018], [-0.0353, -0.018], [-0.036, -0.0181], [-0.0365, -0.0184], [-0.0435, -0.0236], [-0.044, -0.0239], [-0.0447, -0.024], [-0.0711, -0.024], [-0.0719, -0.0238], [-0.0726, -0.0233], [-0.0857, -84e-4], [-0.086, -8e-3], [-0.0862, -75e-4], [-0.0918, 36e-4], [-0.0919, 4e-3], [-0.092, 45e-4]], width: 0.03, bevel: 14e-4, plane: "yz", pos: [0, 0, 0], mat: "gun_cerakote_od" },
      { shape: "box", pos: [0, 0.0745, -0.0335], size: [0.024, 0.081, 12e-4], bevel: 0, lod: false, wear: false, mat: "shadow" },
      { shape: "box", pos: [0.0152, 0.0745, -0.017], size: [8e-4, 0.069, 0.022], bevel: 4e-4, lod: false, mat: "gun_cerakote_od" },
      { shape: "box", pos: [-0.0152, 0.0745, -0.017], size: [8e-4, 0.069, 0.022], bevel: 4e-4, lod: false, mat: "gun_cerakote_od" },
      { shape: "cyl", pos: [0, -0.084, 6e-3], radius: 28e-4, length: 0.0312, axis: "x", segments: 12, lod: false, mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0, 0.11, 6e-3], radius: 28e-4, length: 0.0312, axis: "x", segments: 12, lod: false, mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0, 15e-4, -25e-4], radius: 2e-3, length: 0.0312, axis: "x", segments: 12, lod: false, mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0, -0.0165, -25e-4], radius: 2e-3, length: 0.0312, axis: "x", segments: 12, lod: false, mat: "gun_steel_bare" },
      { shape: "cyl", pos: [-0.0158, -0.028, -4e-3], radius: 55e-4, length: 25e-4, axis: "x", segments: 16, mat: "gun_cerakote_od" },
      { shape: "profile", pts: [[-3e-3, -1e-3], [-27e-4, -17e-4], [-2e-3, -2e-3], [0.0153, -15e-4], [0.0159, -13e-4], [0.0162, -8e-4], [0.0166, 2e-4], [0.0164, 11e-4], [0.0156, 15e-4], [-2e-3, 2e-3], [-27e-4, 17e-4], [-3e-3, 1e-3]], width: 22e-4, bevel: 4e-4, plane: "yz", pos: [-0.0172, -0.028, -4e-3], mat: "gun_cerakote_od" },
      { shape: "cyl", pos: [0.0158, -0.028, -4e-3], radius: 3e-3, length: 25e-4, axis: "x", segments: 12, lod: false, mat: "gun_cerakote_od" },
      { shape: "profile", pts: [[-38e-4, -23e-4], [-34e-4, -35e-4], [-23e-4, -4e-3], [26e-4, -4e-3], [36e-4, -36e-4], [41e-4, -26e-4], [49e-4, 68e-4], [46e-4, 77e-4], [38e-4, 83e-4], [-3e-4, 95e-4], [-16e-4, 93e-4], [-22e-4, 83e-4]], width: 3e-3, bevel: 4e-4, plane: "yz", pos: [-0.0165, 0.034, 0], mat: "gun_cerakote_od" },
      { shape: "cyl", pos: [0.0163, 0.036, -7e-3], radius: 48e-4, length: 3e-3, axis: "x", segments: 16, mat: "gun_knurl" },
      { shape: "profile", pts: [[-0.01, -0.0145], [-96e-4, -0.0156], [-85e-4, -0.016], [0.0105, -0.016], [0.0116, -0.0156], [0.012, -0.0145], [0.012, -0.0129], [0.0118, -0.0121], [0.0112, -0.0116], [-57e-4, -22e-4], [-6e-3, -2e-3], [-64e-4, -2e-3], [-85e-4, -2e-3], [-96e-4, -24e-4], [-0.01, -35e-4]], width: 2e-3, bevel: 3e-4, plane: "yz", pos: [0.0158, 0.036, 0], mat: "gun_cerakote_od" },
      { shape: "box", pos: [0, 0.03, 0.052], size: [0.0153, 0.25, 4e-3], bevel: 6e-4, mat: "gun_cerakote_od" },
      { shape: "profile", pts: [[-0.0106, 0], [0.0106, 0], [9e-3, 3e-3], [-9e-3, 3e-3]], width: 52e-4, bevel: 4e-4, plane: "xz", pos: [0, -0.09, 0.054], wear: false, mat: "gun_cerakote_od", repeat: { count: 25, step: [0, 0.01, 0] } },
      { shape: "profile", pts: [[-0.0683, -0.012], [-0.0316, -0.0219], [-0.0298, -0.0229], [-0.0288, -0.0247], [-0.0288, -0.0268], [-0.0323, -0.0399], [-0.0324, -0.0402], [-0.0324, -0.0404], [-0.0324, -0.0406], [-0.0329, -0.0462], [-0.033, -0.0469], [-0.0333, -0.0477], [-0.0337, -0.0483], [-0.0375, -0.0532], [-0.038, -0.0539], [-0.0382, -0.0547], [-0.0383, -0.0555], [-0.0387, -0.0673], [-0.0388, -0.0681], [-0.0391, -0.0689], [-0.0395, -0.0697], [-0.0432, -0.0744], [-0.0436, -0.0752], [-0.0439, -0.0759], [-0.044, -0.0768], [-0.0444, -0.0886], [-0.0445, -0.0894], [-0.0447, -0.0902], [-0.0452, -0.0909], [-0.0489, -0.0957], [-0.0494, -0.0964], [-0.0496, -0.0972], [-0.0498, -0.098], [-0.0503, -0.1108], [-0.0504, -0.1116], [-0.0507, -0.1124], [-0.0511, -0.1131], [-0.054, -0.1168], [-0.0552, -0.1179], [-0.0567, -0.1184], [-0.0582, -0.1183], [-0.0894, -0.1099], [-0.0909, -0.1092], [-0.0919, -0.1079], [-0.0923, -0.1063], [-0.0931, -0.0941], [-0.0931, -0.0936], [-0.093, -0.0931], [-0.0929, -0.0926], [-0.0763, -0.0418], [-0.0762, -0.0412], [-0.0761, -0.0407], [-0.0761, -0.0402], [-0.0779, -0.0163], [-0.0779, -0.0159], [-0.0779, -0.0154], [-0.0778, -0.015], [-0.0772, -0.0126], [-0.0764, -0.0113], [-0.0751, -0.0106], [-0.0736, -0.0106]], width: 0.03, bevel: 3e-3, plane: "yz", pos: [0, 0, 0], smooth: 45, mat: "poly_black_grip" },
      { shape: "profile", pts: [[-0.0928, -0.1116], [-0.0927, -0.1127], [-0.0918, -0.1134], [-0.0573, -0.1226], [-0.0562, -0.1225], [-0.0555, -0.1216], [-0.0547, -0.1187], [-0.0549, -0.1175], [-0.0558, -0.1168], [-0.0902, -0.1076], [-0.0913, -0.1078], [-0.092, -0.1087]], width: 0.031, bevel: 1e-3, plane: "yz", pos: [0, 0, 0], mat: "poly_black" },
      { shape: "profile", pts: [[0, 0], [4e-3, 0], [65e-4, -8e-3], [6e-3, -0.016], [25e-4, -0.024], [-1e-3, -0.025], [1e-3, -0.016], [15e-4, -8e-3]], width: 55e-4, bevel: 6e-4, plane: "yz", pos: [0, 0, -0.013], group: "trigger", mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0, 2e-3, -0.012], radius: 16e-4, length: 0.03, axis: "x", segments: 10, lod: false, mat: "gun_steel_bare" },
      { shape: "sweep", path: [[0, -0.032, -0.017], [0, -0.032, -0.036], [0, -0.0315, -0.0387], [0, -0.0299, -0.0409], [0, -0.0277, -0.0425], [0, -0.025, -0.043], [0, 0.023, -0.043], [0, 0.0257, -0.0425], [0, 0.0279, -0.0409], [0, 0.0295, -0.0387], [0, 0.03, -0.036], [0, 0.03, -0.017]], section: { kind: "rect", w: 0.014, h: 4e-3, c: 12e-4 }, mat: "gun_cerakote_od" },
      { shape: "profile", pts: [[-0.092, 0.0435], [-0.0924, 0.0454], [-0.0936, 0.0468], [-0.0953, 0.0475], [-0.0972, 0.0474], [-0.1271, 0.0379], [-0.1285, 0.0375], [-0.13, 0.0372], [-0.1316, 0.0371], [-0.1331, 0.037], [-0.3589, 0.037], [-0.3594, 0.037], [-0.36, 0.0369], [-0.3605, 0.0367], [-0.361, 0.0364], [-0.3681, 0.0322], [-0.3689, 0.0315], [-0.3695, 0.0307], [-0.3699, 0.0298], [-0.37, 0.0287], [-0.37, -0.0706], [-0.3698, -0.072], [-0.3691, -0.0732], [-0.368, -0.0741], [-0.3667, -0.0746], [-0.3428, -0.0785], [-0.3414, -0.0787], [-0.34, -0.0786], [-0.3387, -0.0783], [-0.3373, -0.0779], [-0.2235, -0.0304], [-0.2217, -0.0298], [-0.22, -0.0291], [-0.2182, -0.0286], [-0.2164, -0.0281], [-0.1207, -42e-4], [-0.1203, -41e-4], [-0.12, -4e-3], [-0.1197, -39e-4], [-0.1193, -39e-4], [-0.0953, 4e-4], [-0.094, 9e-4], [-0.0929, 18e-4], [-0.0922, 3e-3], [-0.092, 43e-4]], width: 0.04, bevel: 4e-3, plane: "yz", pos: [0, 0, 0], smooth: 45, mat: "poly_black" },
      { shape: "slot", pos: [0.0205, -0.27, -9e-3], length: 0.07, width: 0.024, depth: 14e-4, plane: "yz", lod: false, mat: "shadow", mirror: "x" },
      { shape: "profile", pts: [[-0.1639, 0.0505], [-0.1632, 0.0491], [-0.1638, 0.0476], [-0.1652, 0.047], [-0.326, 0.047], [-0.328, 0.0475], [-0.3295, 0.049], [-0.33, 0.051], [-0.33, 0.057], [-0.3289, 0.061], [-0.326, 0.0639], [-0.322, 0.065], [-0.1823, 0.065], [-0.1809, 0.0648], [-0.1795, 0.0643], [-0.1783, 0.0635]], width: 0.036, bevel: 4e-3, plane: "yz", pos: [0, 0, 0], mat: "poly_black" },
      { shape: "cyl", pos: [0, -0.2, 0.041], radius: 35e-4, length: 0.014, axis: "z", segments: 12, mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0, -0.3, 0.041], radius: 35e-4, length: 0.014, axis: "z", segments: 12, mat: "gun_steel_bare" },
      { shape: "profile", pts: [[-0.37, 0.033], [-0.3703, 0.034], [-0.371, 0.0347], [-0.372, 0.035], [-0.379, 0.035], [-0.3815, 0.0343], [-0.3833, 0.0325], [-0.384, 0.03], [-0.384, -0.0724], [-0.3831, -0.0753], [-0.3807, -0.0771], [-0.3776, -0.0772], [-0.3715, -0.0754], [-0.3707, -0.075], [-0.3702, -0.0743], [-0.37, -0.0735]], width: 0.044, bevel: 3e-3, plane: "yz", pos: [0, 0, 0], mat: "gun_rubber_pad" },
      { shape: "cyl", pos: [0.0205, -0.12, 0.021], radius: 65e-4, length: 4e-3, axis: "x", bore: 3e-3, bevel: 6e-4, segments: 16, mat: "gun_steel_bare" },
      { shape: "loft", kind: "rect", sections: [{ y: 0.16, w: 0.048, h: 0.052, z: 0.029, c: 8e-3 }, { y: 0.166, w: 0.05, h: 0.054, z: 0.029, c: 8e-3 }, { y: 0.496, w: 0.05, h: 0.054, z: 0.029, c: 8e-3 }, { y: 0.5, w: 0.046, h: 0.048, z: 0.029, c: 8e-3 }], mat: "gun_cerakote_od" },
      { shape: "box", pos: [0, 0.5002, 0.029], size: [0.036, 6e-4, 0.038], bevel: 0, wear: false, lod: false, mat: "shadow" },
      { shape: "slot", pos: [0.0254, 0.185, 0.025], length: 0.032, width: 7e-3, depth: 16e-4, plane: "yz", lod: false, mat: "shadow", repeat: { count: 6, step: [0, 0.058, 0] }, mirror: "x" },
      { shape: "slot", pos: [0, 0.185, 22e-4], length: 0.032, width: 7e-3, depth: 16e-4, plane: "xy", hpr: [90, 0, 0], lod: false, mat: "shadow", repeat: { count: 6, step: [0, 0.058, 0] } },
      { shape: "cyl", pos: [0.0204, 0.19, 0.0514], radius: 34e-4, length: 16e-4, axis: "z", segments: 12, hpr: [0, 0, -45], lod: false, wear: false, mat: "shadow", repeat: { count: 10, step: [0, 0.028, 0] } },
      { shape: "cyl", pos: [-0.0204, 0.19, 0.0514], radius: 34e-4, length: 16e-4, axis: "z", segments: 12, hpr: [0, 0, 45], lod: false, wear: false, mat: "shadow", repeat: { count: 10, step: [0, 0.028, 0] } },
      { shape: "box", pos: [0, 0.33, 0.0565], size: [0.0153, 0.33, 4e-3], bevel: 6e-4, mat: "gun_cerakote_od" },
      { shape: "profile", pts: [[-0.0106, 0], [0.0106, 0], [9e-3, 3e-3], [-9e-3, 3e-3]], width: 52e-4, bevel: 4e-4, plane: "xz", pos: [0, 0.17, 0.0585], wear: false, mat: "gun_cerakote_od", repeat: { count: 33, step: [0, 0.01, 0] } },
      { shape: "cyl", pos: [0, 0.1595, 0.031], radius: 0.0178, length: 6e-3, axis: "y", segments: 24, mat: "gun_knurl" },
      { shape: "cyl", pos: [0, 0.4, 0.031], radius: 0.0115, radius2: 0.0105, length: 0.48, axis: "y", segments: 24, mat: "gun_parkerized_dark" },
      { shape: "slot", pos: [0.0114, 0.4, 0.031], length: 0.288, width: 34e-4, depth: 9e-4, plane: "yz", hpr: [0, 0, 0], lod: false, mat: "shadow" },
      { shape: "slot", pos: [57e-4, 0.4, 0.0409], length: 0.288, width: 34e-4, depth: 9e-4, plane: "yz", hpr: [0, 0, -60], lod: false, mat: "shadow" },
      { shape: "slot", pos: [-57e-4, 0.4, 0.0409], length: 0.288, width: 34e-4, depth: 9e-4, plane: "yz", hpr: [0, 0, -120], lod: false, mat: "shadow" },
      { shape: "slot", pos: [-0.0114, 0.4, 0.031], length: 0.288, width: 34e-4, depth: 9e-4, plane: "yz", hpr: [0, 0, -180], lod: false, mat: "shadow" },
      { shape: "slot", pos: [-57e-4, 0.4, 0.0211], length: 0.288, width: 34e-4, depth: 9e-4, plane: "yz", hpr: [0, 0, -240], lod: false, mat: "shadow" },
      { shape: "slot", pos: [57e-4, 0.4, 0.0211], length: 0.288, width: 34e-4, depth: 9e-4, plane: "yz", hpr: [0, 0, -300], lod: false, mat: "shadow" },
      { shape: "loft", kind: "rect", sections: [{ y: 0.64, w: 0.029, h: 0.029, z: 0.031, c: 87e-4 }, { y: 0.7, w: 0.029, h: 0.029, z: 0.031, c: 87e-4 }], mat: "gun_parkerized_dark" },
      { shape: "cyl", pos: [0, 0.7003, 0.031], radius: 65e-4, length: 8e-4, axis: "y", segments: 16, lod: false, wear: false, mat: "shadow" },
      { shape: "slot", pos: [0.0149, 0.655, 0.031], length: 0.0174, width: 6e-3, depth: 15e-4, plane: "yz", hpr: [0, 90, 0], lod: false, mat: "shadow", mirror: "x" },
      { shape: "slot", pos: [0.0149, 0.67, 0.031], length: 0.0174, width: 6e-3, depth: 15e-4, plane: "yz", hpr: [0, 90, 0], lod: false, mat: "shadow", mirror: "x" },
      { shape: "slot", pos: [0.0149, 0.685, 0.031], length: 0.0174, width: 6e-3, depth: 15e-4, plane: "yz", hpr: [0, 90, 0], lod: false, mat: "shadow", mirror: "x" },
      { shape: "torus", pos: [0, 0.47, 1e-3], radius: 75e-4, tube: 16e-4, axis: "y", mat: "gun_steel_bare" },
      { shape: "loft", kind: "ellipse", sections: [{ y: -0.11, w: 0.038, h: 0.038, z: 0.0857 }, { y: -0.06, w: 0.038, h: 0.038, z: 0.0857 }, { y: -0.035, w: 0.0254, h: 0.0254, z: 0.0857 }, { y: 0.085, w: 0.0254, h: 0.0254, z: 0.0857 }, { y: 0.125, w: 0.042, h: 0.042, z: 0.0857 }, { y: 0.17, w: 0.042, h: 0.042, z: 0.0857 }], segments: 28, caps: false, mat: "gun_anodized" },
      { shape: "cyl", pos: [0, 0.03, 0.0857], radius: 0.0121, length: 0.276, axis: "y", bore: 0.0111, segments: 24, wear: false, lod: false, mat: "shadow" },
      { shape: "cyl", pos: [0, 0.1675, 0.0857], radius: 0.0202, length: 4e-3, axis: "y", bore: 0.0182, segments: 28, wear: false, mat: "gun_anodized" },
      { shape: "cyl", pos: [0, -0.1075, 0.0857], radius: 0.0182, length: 4e-3, axis: "y", bore: 0.0162, segments: 28, wear: false, mat: "gun_anodized" },
      { shape: "cyl", pos: [0, 0.1704, 0.0857], radius: 0.019, length: 1e-3, axis: "y", segments: 28, wear: false, mat: "gun_glass" },
      { shape: "cyl", pos: [0, -0.1104, 0.0857], radius: 0.017, length: 1e-3, axis: "y", segments: 28, wear: false, mat: "gun_glass" },
      { shape: "torus", pos: [0, -0.098, 0.0857], radius: 0.0193, tube: 12e-4, axis: "y", mat: "gun_rubber_pad" },
      { shape: "torus", pos: [0, 0.166, 0.0857], radius: 0.0213, tube: 1e-3, axis: "y", mat: "gun_anodized" },
      { shape: "cyl", pos: [0, 0.04, 0.1054], radius: 0.011, length: 0.014, axis: "z", segments: 20, mat: "gun_knurl" },
      { shape: "cyl", pos: [0, 0.04, 0.0989], radius: 8e-3, length: 4e-3, axis: "z", segments: 18, mat: "gun_anodized" },
      { shape: "cyl", pos: [0.0197, 0.04, 0.0857], radius: 0.011, length: 0.014, axis: "x", segments: 20, mat: "gun_knurl" },
      { shape: "cyl", pos: [-0.0187, 0.04, 0.0857], radius: 9e-3, length: 0.012, axis: "x", segments: 18, mat: "gun_anodized" },
      { shape: "cyl", pos: [0, -0.048, 0.0857], radius: 0.0157, length: 0.018, axis: "y", segments: 24, mat: "gun_knurl" },
      { shape: "box", pos: [0, 0.04, 0.0857], size: [0.0314, 0.03, 0.0203], bevel: 3e-3, mat: "gun_anodized" },
      { shape: "profile", pts: [[-0.016, 0], [0.016, 0], [0.0135, 8e-3], [0.0135, 0.0227], [0.0127, 0.0257], [0.0105, 0.0279], [75e-4, 0.0287], [-75e-4, 0.0287], [-0.0105, 0.0279], [-0.0127, 0.0257], [-0.0135, 0.0227], [-0.0135, 8e-3]], width: 0.014, bevel: 8e-4, plane: "xz", pos: [0, -0.02, 0.057], mat: "gun_anodized" },
      { shape: "torus", pos: [0, -0.02, 0.0857], radius: 0.0151, tube: 26e-4, axis: "y", mat: "gun_anodized" },
      { shape: "cyl", pos: [0.0145, -0.02, 0.061], radius: 35e-4, length: 4e-3, axis: "x", segments: 10, lod: false, mat: "gun_steel_bare" },
      { shape: "profile", pts: [[-0.016, 0], [0.016, 0], [0.0135, 8e-3], [0.0135, 0.0227], [0.0127, 0.0257], [0.0105, 0.0279], [75e-4, 0.0287], [-75e-4, 0.0287], [-0.0105, 0.0279], [-0.0127, 0.0257], [-0.0135, 0.0227], [-0.0135, 8e-3]], width: 0.014, bevel: 8e-4, plane: "xz", pos: [0, 0.09, 0.057], mat: "gun_anodized" },
      { shape: "torus", pos: [0, 0.09, 0.0857], radius: 0.0151, tube: 26e-4, axis: "y", mat: "gun_anodized" },
      { shape: "cyl", pos: [0.0145, 0.09, 0.061], radius: 35e-4, length: 4e-3, axis: "x", segments: 10, lod: false, mat: "gun_steel_bare" },
      { shape: "slot", pos: [0, -0.1106, 0.0857], length: 5e-3, width: 12e-4, depth: 2e-4, plane: "xz", lod: false, mat: "shadow" },
      { shape: "profile", pts: [[0.0374, -52e-4], [0.0381, -38e-4], [0.0395, -33e-4], [0.1055, -67e-4], [0.1068, -74e-4], [0.1073, -88e-4], [0.1013, -0.1237], [0.1003, -0.1257], [0.0982, -0.1265], [0.0343, -0.1232], [0.0322, -0.1222], [0.0314, -0.12]], width: 0.025, bevel: 12e-4, plane: "yz", pos: [0, 0, 0], group: "mag", mat: "gun_parkerized_dark" },
      { shape: "profile", pts: [[0.0282, -0.1287], [0.0286, -0.1302], [0.0301, -0.131], [0.1025, -0.1348], [0.1041, -0.1342], [0.1046, -0.1327], [0.1044, -0.1266], [0.1038, -0.1253], [0.1025, -0.1247], [0.0312, -0.121], [0.0298, -0.1214], [0.0291, -0.1227]], width: 0.029, bevel: 15e-4, plane: "yz", pos: [0, 0, 0], group: "mag", mat: "gun_parkerized_dark" },
      { shape: "slot", pos: [0.0129, 0.0703, -0.0469], length: 0.049, width: 3e-3, depth: 12e-4, plane: "yz", hpr: [0, -3, 0], group: "mag", lod: false, mat: "gun_parkerized_dark", mirror: "x" },
      { shape: "slot", pos: [0.0129, 0.0684, -0.0829], length: 0.049, width: 3e-3, depth: 12e-4, plane: "yz", hpr: [0, -3, 0], group: "mag", lod: false, mat: "gun_parkerized_dark", mirror: "x" },
      { shape: "box", pos: [0, 0.0725, -3e-3], size: [0.021, 0.06, 4e-3], bevel: 8e-4, group: "mag", lod: false, mat: "poly_follower" },
      { shape: "cyl", pos: [0, 0.0745, 5e-4], radius: 45e-4, length: 0.054, axis: "y", segments: 12, group: "mag", lod: false, mat: "gun_brass" }
    ],
    anchors: { muzzle: [0, 0.7, 0.031], eject: [0.0165, 0.029, 0.0345], sight: [0, -0.185, 0.0857], grip_r: [0, -0.0576, -0.0615], grip_l: [0, 0.34, 1e-3], mag: [0, 0.0725, -0.065] },
    bounds: { min: [-0.0262, -0.384, -0.1348], max: [0.03, 0.7007, 0.1124] },
    groups: { bolt: { pivot: [0, 0, 0] }, dust_cover: { pivot: [0.0157, 0, 0.025] }, charge: { pivot: [0, 0, 0] }, trigger: { pivot: [0, 0, -0.013] } },
    viewmodel: { offset: [0.125, 0.36, -0.155], ads_distance: 0.16, elbow_r: [0.28, -0.12, -0.38], elbow_l: [-0.22, 0.04, -0.4] },
    sight_check: false
  },
  lmg_lm90: {
    parts: [
      { shape: "profile", pts: [[-0.12, -1e-3], [-0.1191, -31e-4], [-0.117, -4e-3], [0.167, -4e-3], [0.1691, -31e-4], [0.17, -1e-3], [0.17, 0.055], [0.1691, 0.0571], [0.167, 0.058], [-0.117, 0.058], [-0.1191, 0.0571], [-0.12, 0.055]], width: 0.04, bevel: 16e-4, plane: "yz", pos: [0, 0, 0], mat: "gun_parkerized" },
      { shape: "cyl", pos: [0.0201, -0.1, 0], radius: 22e-4, length: 12e-4, axis: "x", segments: 10, lod: false, mat: "gun_steel_bare", mirror: "x" },
      { shape: "cyl", pos: [0.0201, -0.1, 0.03], radius: 22e-4, length: 12e-4, axis: "x", segments: 10, lod: false, mat: "gun_steel_bare", mirror: "x" },
      { shape: "cyl", pos: [0.0201, 0.15, 0], radius: 22e-4, length: 12e-4, axis: "x", segments: 10, lod: false, mat: "gun_steel_bare", mirror: "x" },
      { shape: "cyl", pos: [0.0201, 0.15, 0.03], radius: 22e-4, length: 12e-4, axis: "x", segments: 10, lod: false, mat: "gun_steel_bare", mirror: "x" },
      { shape: "cyl", pos: [0.0201, 0.02, 0], radius: 22e-4, length: 12e-4, axis: "x", segments: 10, lod: false, mat: "gun_steel_bare", mirror: "x" },
      { shape: "profile", pts: [[-0.07, 0.061], [-0.0691, 0.0589], [-0.067, 0.058], [0.097, 0.058], [0.0991, 0.0589], [0.1, 0.061], [0.1, 0.0674], [0.0993, 0.0694], [0.0974, 0.0704], [0.0602, 0.076], [0.06, 0.076], [0.0598, 0.076], [-0.0592, 0.076], [-0.06, 0.0759], [-0.0607, 0.0756], [-0.0685, 0.0709], [-0.0696, 0.0698], [-0.07, 0.0683]], width: 0.042, bevel: 16e-4, plane: "yz", pos: [0, 0, 0], group: "cover", mat: "gun_parkerized" },
      { shape: "box", pos: [0, -0.04, 0.076], size: [0.034, 4e-3, 15e-4], bevel: 4e-4, group: "cover", lod: false, mat: "gun_parkerized", repeat: { count: 5, step: [0, 0.022, 0] } },
      { shape: "box", pos: [0, 0.015, 0.078], size: [0.0153, 0.13, 4e-3], bevel: 6e-4, group: "cover", mat: "gun_parkerized" },
      { shape: "profile", pts: [[-0.0106, 0], [0.0106, 0], [9e-3, 3e-3], [-9e-3, 3e-3]], width: 52e-4, bevel: 4e-4, plane: "xz", pos: [0, -0.045, 0.08], group: "cover", wear: false, mat: "gun_parkerized", repeat: { count: 13, step: [0, 0.01, 0] } },
      { shape: "profile", pts: [[-0.014, 0], [0.014, 0], [0.012, 9e-3], [-0.012, 9e-3]], width: 0.022, bevel: 8e-4, plane: "yz", pos: [0, -0.04, 0.083], mat: "gun_parkerized" },
      { shape: "torus", pos: [0, -0.04, 0.1054], radius: 58e-4, tube: 16e-4, axis: "y", mat: "gun_parkerized" },
      { shape: "profile", pts: [[15e-4, 0], [58e-4, 0], [58e-4, 0.0103], [15e-4, 0.0103]], width: 36e-4, bevel: 4e-4, plane: "xz", pos: [0, -0.04, 0.092], mat: "gun_parkerized" },
      { shape: "profile", pts: [[0.0105, 0], [0.0135, 0], [0.0135, 0.0244], [0.011, 0.0264]], width: 6e-3, bevel: 5e-4, plane: "xz", pos: [0, -0.04, 0.083], mat: "gun_parkerized" },
      { shape: "profile", pts: [[-15e-4, 0], [-58e-4, 0], [-58e-4, 0.0103], [-15e-4, 0.0103]], width: 36e-4, bevel: 4e-4, plane: "xz", pos: [0, -0.04, 0.092], mat: "gun_parkerized" },
      { shape: "profile", pts: [[-0.0105, 0], [-0.0135, 0], [-0.0135, 0.0244], [-0.011, 0.0264]], width: 6e-3, bevel: 5e-4, plane: "xz", pos: [0, -0.04, 0.083], mat: "gun_parkerized" },
      { shape: "cyl", pos: [0.014, -0.04, 0.088], radius: 45e-4, length: 4e-3, axis: "x", segments: 14, lod: false, mat: "gun_knurl" },
      { shape: "cyl", pos: [0, -0.068, 0.066], radius: 4e-3, length: 0.044, axis: "x", segments: 12, group: "cover", lod: false, mat: "gun_steel_bare" },
      { shape: "box", pos: [-0.0215, 0.075, 0.05], size: [2e-3, 0.03, 0.012], bevel: 0, lod: false, wear: false, mat: "shadow" },
      { shape: "box", pos: [0.0205, 0.03, 0.042], size: [12e-4, 0.07, 0.016], bevel: 0, lod: false, wear: false, mat: "shadow" },
      { shape: "box", pos: [0.0198, 0.03, 0.042], size: [16e-4, 0.05, 0.01], bevel: 5e-4, group: "bolt", lod: false, mat: "gun_steel_bare" },
      { shape: "box", pos: [0.026, 0.12, 0.038], size: [0.012, 0.01, 8e-3], bevel: 15e-4, group: "charge", mat: "gun_parkerized" },
      { shape: "cyl", pos: [0.034, 0.12, 0.038], radius: 5e-3, length: 8e-3, axis: "x", segments: 14, group: "charge", mat: "poly_black" },
      { shape: "sweep", path: [[-0.022, 0.14, 0.05], [-0.04, 0.16, 0.07], [-0.04, 0.24, 0.07], [-0.022, 0.26, 0.05]], section: { kind: "rect", w: 0.012, h: 8e-3, c: 2e-3 }, mat: "gun_parkerized" },
      { shape: "box", pos: [-0.042, 0.2, 0.07], size: [0.012, 0.06, 0.022], bevel: 4e-3, mat: "poly_black" },
      { shape: "cyl", pos: [0, 0.415, 0.04], radius: 0.0118, radius2: 0.0112, length: 0.49, axis: "y", segments: 24, mat: "gun_parkerized_dark" },
      { shape: "loft", kind: "ellipse", sections: [{ y: 0.17, w: 0.036, h: 0.034, z: 0.043 }, { y: 0.4, w: 0.036, h: 0.034, z: 0.043 }], segments: 24, caps: false, mat: "gun_parkerized" },
      { shape: "cyl", pos: [0.0175, 0.2, 0.037], radius: 34e-4, length: 2e-3, axis: "x", segments: 10, lod: false, wear: false, mat: "shadow", repeat: { count: 9, step: [0, 0.024, 0] } },
      { shape: "cyl", pos: [-0.0175, 0.2, 0.037], radius: 34e-4, length: 2e-3, axis: "x", segments: 10, lod: false, wear: false, mat: "shadow", repeat: { count: 9, step: [0, 0.024, 0] } },
      { shape: "cyl", pos: [0.0175, 0.2, 0.049], radius: 34e-4, length: 2e-3, axis: "x", segments: 10, lod: false, wear: false, mat: "shadow", repeat: { count: 9, step: [0, 0.024, 0] } },
      { shape: "cyl", pos: [-0.0175, 0.2, 0.049], radius: 34e-4, length: 2e-3, axis: "x", segments: 10, lod: false, wear: false, mat: "shadow", repeat: { count: 9, step: [0, 0.024, 0] } },
      { shape: "box", pos: [0, 0.47, 0.026], size: [0.03, 0.03, 0.036], bevel: 2e-3, mat: "gun_parkerized" },
      { shape: "cyl", pos: [0, 0.3, 0.02], radius: 75e-4, length: 0.32, axis: "y", segments: 16, mat: "gun_parkerized" },
      { shape: "cyl", pos: [0, 0.69, 0.04], radius: 0.0125, length: 0.06, axis: "y", bore: 56e-4, bevel: 12e-4, segments: 24, mat: "gun_parkerized_dark" },
      { shape: "cyl", pos: [0, 0.7195, 0.04], radius: 56e-4, length: 8e-4, axis: "y", segments: 16, lod: false, wear: false, mat: "shadow" },
      { shape: "slot", pos: [-91e-4, 0.696, 0.0491], length: 0.033, width: 3e-3, depth: 8e-4, plane: "yz", hpr: [0, 0, -135], lod: false, mat: "shadow" },
      { shape: "slot", pos: [-91e-4, 0.696, 0.0309], length: 0.033, width: 3e-3, depth: 8e-4, plane: "yz", hpr: [0, 0, -225], lod: false, mat: "shadow" },
      { shape: "slot", pos: [91e-4, 0.696, 0.0309], length: 0.033, width: 3e-3, depth: 8e-4, plane: "yz", hpr: [0, 0, -315], lod: false, mat: "shadow" },
      { shape: "slot", pos: [91e-4, 0.696, 0.0491], length: 0.033, width: 3e-3, depth: 8e-4, plane: "yz", hpr: [0, 0, -405], lod: false, mat: "shadow" },
      { shape: "profile", pts: [[-0.0117, 23e-4], [-0.0115, 12e-4], [-0.0108, 3e-4], [-97e-4, 0], [97e-4, 0], [0.0108, 3e-4], [0.0115, 12e-4], [0.0117, 23e-4], [6e-3, 0.0408], [6e-3, 0.0408], [6e-3, 0.0409], [6e-3, 0.0409], [37e-4, 0.0537], [35e-4, 0.0541], [31e-4, 0.0544], [27e-4, 0.0545], [-27e-4, 0.0545], [-31e-4, 0.0544], [-35e-4, 0.0541], [-37e-4, 0.0537], [-6e-3, 0.0409], [-6e-3, 0.0409], [-6e-3, 0.0408], [-6e-3, 0.0408]], width: 0.02, bevel: 8e-4, plane: "yz", pos: [0, 0.6, 0.052], mat: "gun_parkerized" },
      { shape: "box", pos: [0, 0.6, 0.0989], size: [24e-4, 24e-4, 0.0153], bevel: 4e-4, mat: "gun_parkerized" },
      { shape: "slot", pos: [0, 0.6, 0.0847], length: 0.012, width: 8e-3, depth: 0.0206, plane: "xz", lod: false, mat: "shadow" },
      { shape: "cyl", pos: [0.012, 0.36, 6e-3], radius: 5e-3, length: 0.22, axis: "y", segments: 12, mat: "gun_parkerized" },
      { shape: "cyl", pos: [0.012, 0.25, 6e-3], radius: 72e-4, length: 0.016, axis: "y", segments: 12, mat: "gun_rubber_pad" },
      { shape: "cyl", pos: [-0.012, 0.36, 6e-3], radius: 5e-3, length: 0.22, axis: "y", segments: 12, mat: "gun_parkerized" },
      { shape: "cyl", pos: [-0.012, 0.25, 6e-3], radius: 72e-4, length: 0.016, axis: "y", segments: 12, mat: "gun_rubber_pad" },
      { shape: "box", pos: [0, 0.47, 4e-3], size: [0.034, 0.02, 0.012], bevel: 2e-3, mat: "gun_parkerized" },
      { shape: "profile", pts: [[-47e-4, -0.0103], [-4e-3, -72e-4], [-18e-4, -49e-4], [13e-4, -4e-3], [0.1243, -4e-3], [0.1272, -48e-4], [0.1294, -68e-4], [0.1303, -97e-4], [0.1347, -0.1037], [0.134, -0.1068], [0.1318, -0.1091], [0.1287, -0.11], [57e-4, -0.11], [28e-4, -0.1092], [6e-4, -0.1072], [-3e-4, -0.1043]], width: 0.075, bevel: 3e-3, plane: "yz", pos: [-0.012, 0, 0], group: "mag", mat: "poly_od" },
      { shape: "box", pos: [-0.012, 0.065, -0.112], size: [0.07, 0.12, 4e-3], bevel: 15e-4, group: "mag", lod: false, mat: "poly_od_grip" },
      { shape: "torus", pos: [-0.012, 0.065, -0.12], radius: 0.012, tube: 2e-3, axis: "y", arc: 180, start: 180, group: "mag", lod: false, mat: "gun_steel_bare" },
      { shape: "cyl", pos: [-0.028, 0.06, 0.036], radius: 55e-4, length: 0.03, axis: "x", segments: 10, group: "mag", lod: false, mat: "gun_brass", repeat: { count: 4, step: [0, 0.011, 0] } },
      { shape: "box", pos: [-0.028, 0.06, 0.036], size: [0.034, 4e-3, 0.012], bevel: 5e-4, group: "mag", lod: false, mat: "gun_parkerized_dark", repeat: { count: 4, step: [0, 0.011, 0] } },
      { shape: "profile", pts: [[-0.0902, 24e-4], [-0.0537, -81e-4], [-0.0519, -92e-4], [-0.0509, -0.011], [-0.0509, -0.0131], [-0.0547, -0.0262], [-0.0548, -0.0264], [-0.0548, -0.0266], [-0.0548, -0.0269], [-0.0554, -0.0324], [-0.0555, -0.0332], [-0.0558, -0.0339], [-0.0563, -0.0345], [-0.0601, -0.0393], [-0.0606, -0.04], [-0.0609, -0.0408], [-0.061, -0.0417], [-0.0615, -0.0534], [-0.0616, -0.0543], [-0.0619, -0.055], [-0.0624, -0.0558], [-0.0662, -0.0605], [-0.0666, -0.0612], [-0.0669, -0.062], [-0.0671, -0.0628], [-0.0676, -0.0746], [-0.0677, -0.0754], [-0.068, -0.0762], [-0.0685, -0.0769], [-0.0723, -0.0817], [-0.0727, -0.0823], [-0.073, -0.0831], [-0.0732, -0.0839], [-0.0739, -0.0967], [-0.074, -0.0975], [-0.0743, -0.0983], [-0.0748, -0.099], [-0.0777, -0.1027], [-0.0789, -0.1037], [-0.0804, -0.1042], [-0.082, -0.104], [-0.113, -0.0951], [-0.1144, -0.0944], [-0.1155, -0.0931], [-0.1159, -0.0915], [-0.1164, -0.0793], [-0.1164, -0.0788], [-0.1163, -0.0783], [-0.1162, -0.0778], [-0.0987, -0.0272], [-0.0986, -0.0267], [-0.0985, -0.0262], [-0.0985, -0.0257], [-0.0999, -18e-4], [-0.0999, -13e-4], [-0.0998, -9e-4], [-0.0997, -4e-4], [-0.0991, 19e-4], [-0.0983, 32e-4], [-0.097, 39e-4], [-0.0955, 39e-4]], width: 0.03, bevel: 3e-3, plane: "yz", pos: [0, 0, 0], smooth: 45, mat: "poly_black_grip" },
      { shape: "profile", pts: [[-0.1164, -0.0967], [-0.1163, -0.0979], [-0.1154, -0.0986], [-0.0812, -0.1084], [-0.08, -0.1083], [-0.0793, -0.1074], [-0.0785, -0.1045], [-0.0786, -0.1034], [-0.0795, -0.1027], [-0.1138, -0.0928], [-0.1149, -0.093], [-0.1156, -0.0939]], width: 0.031, bevel: 1e-3, plane: "yz", pos: [0, 0, 0], mat: "poly_black" },
      { shape: "profile", pts: [[0, 0], [4e-3, 0], [65e-4, -8e-3], [6e-3, -0.016], [25e-4, -0.024], [-1e-3, -0.025], [1e-3, -0.016], [15e-4, -8e-3]], width: 55e-4, bevel: 6e-4, plane: "yz", pos: [0, -0.03, -6e-3], group: "trigger", mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0, -0.028, -5e-3], radius: 16e-4, length: 0.03, axis: "x", segments: 10, lod: false, mat: "gun_steel_bare" },
      { shape: "sweep", path: [[0, -0.06, -0.01], [0, -0.06, -0.029], [0, -0.0595, -0.0317], [0, -0.0579, -0.0339], [0, -0.0557, -0.0355], [0, -0.053, -0.036], [0, -9e-3, -0.036], [0, -63e-4, -0.0355], [0, -41e-4, -0.0339], [0, -25e-4, -0.0317], [0, -2e-3, -0.029], [0, -2e-3, -0.01]], section: { kind: "rect", w: 0.014, h: 4e-3, c: 12e-4 }, mat: "gun_parkerized" },
      { shape: "profile", pts: [[-0.12, 0.0519], [-0.1203, 0.0535], [-0.1212, 0.0548], [-0.1225, 0.0556], [-0.1241, 0.0559], [-0.3984, 0.05], [-0.3992, 0.05], [-0.3999, 0.0498], [-0.4007, 0.0495], [-0.4014, 0.0492], [-0.4081, 0.0452], [-0.4089, 0.0445], [-0.4095, 0.0437], [-0.4099, 0.0428], [-0.41, 0.0417], [-0.41, -0.057], [-0.4098, -0.0583], [-0.4092, -0.0594], [-0.4083, -0.0603], [-0.4071, -0.0609], [-0.3925, -0.0652], [-0.3913, -0.0655], [-0.39, -0.0656], [-0.3888, -0.0655], [-0.3875, -0.0651], [-0.2617, -0.0206], [-0.2609, -0.0203], [-0.26, -0.02], [-0.2591, -0.0198], [-0.2582, -0.0195], [-0.1606, 71e-4], [-0.1554, 8e-3], [-0.1502, 81e-4], [-0.145, 71e-4], [-0.14, 53e-4], [-0.1257, -13e-4], [-0.1237, -17e-4], [-0.1219, -11e-4], [-0.1205, 4e-4], [-0.12, 23e-4]], width: 0.042, bevel: 4e-3, plane: "yz", pos: [0, 0, 0], smooth: 45, mat: "poly_black" },
      { shape: "slot", pos: [0.0215, -0.27, 0.01], length: 0.1, width: 0.03, depth: 14e-4, plane: "yz", lod: false, mat: "shadow", mirror: "x" },
      { shape: "profile", pts: [[-0.41, 0.044], [-0.4103, 0.045], [-0.411, 0.0457], [-0.412, 0.046], [-0.419, 0.046], [-0.4215, 0.0453], [-0.4233, 0.0435], [-0.424, 0.041], [-0.424, -0.0574], [-0.4231, -0.0603], [-0.4207, -0.0621], [-0.4176, -0.0622], [-0.4115, -0.0604], [-0.4107, -0.06], [-0.4102, -0.0593], [-0.41, -0.0585]], width: 0.046, bevel: 3e-3, plane: "yz", pos: [0, 0, 0], mat: "gun_rubber_pad" },
      { shape: "torus", pos: [0, -0.36, -0.058], radius: 7e-3, tube: 16e-4, axis: "y", mat: "gun_steel_bare" },
      { shape: "torus", pos: [0, 0.44, 6e-3], radius: 7e-3, tube: 16e-4, axis: "y", mat: "gun_steel_bare" }
    ],
    anchors: { muzzle: [0, 0.72, 0.04], eject: [0.022, 0.03, 0.042], sight: [0, -0.043, 0.1054], grip_r: [0, -0.0804, -0.0473], grip_l: [0, 0.3, 0], mag: [-0.012, 0.065, -0.06] },
    bounds: { min: [-0.0495, -0.424, -0.134], max: [0.038, 0.72, 0.1128] },
    groups: { cover: { pivot: [0, -0.068, 0.066] }, bolt: { pivot: [0, 0, 0] }, charge: { pivot: [0, 0, 0] }, trigger: { pivot: [0, -0.03, -6e-3] } },
    viewmodel: { offset: [0.13, 0.36, -0.16], ads_distance: 0.17, elbow_r: [0.28, -0.12, -0.38], elbow_l: [-0.22, 0.04, -0.4], bolt_travel: 0.03 },
    sight_parts: ["gun_parkerized"]
  },
  shotgun_s7: {
    parts: [
      { shape: "profile", pts: [[-0.08, 7e-3], [-0.0796, 55e-4], [-0.0785, 44e-4], [-0.077, 4e-3], [0.147, 4e-3], [0.1485, 44e-4], [0.1496, 55e-4], [0.15, 7e-3], [0.15, 0.06], [0.1495, 0.062], [0.148, 0.0635], [0.146, 0.064], [-0.0679, 0.064], [-0.0692, 0.0638], [-0.0705, 0.0634], [-0.0716, 0.0627], [-0.0785, 0.0572], [-0.0793, 0.0563], [-0.0798, 0.0553], [-0.08, 0.0541]], width: 0.036, bevel: 18e-4, plane: "yz", pos: [0, 0, 0], mat: "gun_anodized" },
      { shape: "box", pos: [0.0181, 0.06, 0.046], size: [8e-4, 0.07, 0.02], bevel: 0, lod: false, wear: false, mat: "shadow" },
      { shape: "box", pos: [0.0172, 0.056, 0.046], size: [18e-4, 0.05, 0.012], bevel: 6e-4, group: "bolt", lod: false, mat: "gun_steel_bare" },
      { shape: "box", pos: [0.0215, 0.07, 0.046], size: [8e-3, 0.012, 6e-3], bevel: 12e-4, group: "bolt", mat: "gun_steel_bare" },
      { shape: "box", pos: [0, 0.06, 34e-4], size: [0.026, 0.1, 8e-4], bevel: 0, lod: false, wear: false, mat: "shadow" },
      { shape: "box", pos: [0, 0.04, 0.066], size: [0.0153, 0.2, 4e-3], bevel: 6e-4, mat: "gun_anodized" },
      { shape: "profile", pts: [[-0.0106, 0], [0.0106, 0], [9e-3, 3e-3], [-9e-3, 3e-3]], width: 52e-4, bevel: 4e-4, plane: "xz", pos: [0, -0.055, 0.068], wear: false, mat: "gun_anodized", repeat: { count: 20, step: [0, 0.01, 0] } },
      { shape: "profile", pts: [[-0.014, 0], [0.014, 0], [0.012, 9e-3], [-0.012, 9e-3]], width: 0.022, bevel: 8e-4, plane: "yz", pos: [0, -0.03, 0.071], mat: "gun_anodized" },
      { shape: "torus", pos: [0, -0.03, 0.095], radius: 66e-4, tube: 16e-4, axis: "y", mat: "gun_anodized" },
      { shape: "profile", pts: [[17e-4, 0], [66e-4, 0], [66e-4, 0.0112], [17e-4, 0.0112]], width: 36e-4, bevel: 4e-4, plane: "xz", pos: [0, -0.03, 0.08], mat: "gun_anodized" },
      { shape: "profile", pts: [[0.0105, 0], [0.0135, 0], [0.0135, 0.026], [0.011, 0.028]], width: 6e-3, bevel: 5e-4, plane: "xz", pos: [0, -0.03, 0.071], mat: "gun_anodized" },
      { shape: "profile", pts: [[-17e-4, 0], [-66e-4, 0], [-66e-4, 0.0112], [-17e-4, 0.0112]], width: 36e-4, bevel: 4e-4, plane: "xz", pos: [0, -0.03, 0.08], mat: "gun_anodized" },
      { shape: "profile", pts: [[-0.0105, 0], [-0.0135, 0], [-0.0135, 0.026], [-0.011, 0.028]], width: 6e-3, bevel: 5e-4, plane: "xz", pos: [0, -0.03, 0.071], mat: "gun_anodized" },
      { shape: "cyl", pos: [0.014, -0.03, 0.076], radius: 45e-4, length: 4e-3, axis: "x", segments: 14, lod: false, mat: "gun_knurl" },
      { shape: "profile", pts: [[-0.0115, 24e-4], [-0.0114, 12e-4], [-0.0107, 3e-4], [-96e-4, 0], [96e-4, 0], [0.0107, 3e-4], [0.0114, 12e-4], [0.0115, 24e-4], [6e-3, 0.0313], [6e-3, 0.0313], [6e-3, 0.0314], [6e-3, 0.0315], [37e-4, 0.0411], [35e-4, 0.0415], [31e-4, 0.0417], [27e-4, 0.0418], [-27e-4, 0.0418], [-31e-4, 0.0417], [-35e-4, 0.0415], [-37e-4, 0.0411], [-6e-3, 0.0315], [-6e-3, 0.0314], [-6e-3, 0.0313], [-6e-3, 0.0313]], width: 0.02, bevel: 8e-4, plane: "yz", pos: [0, 0.6, 0.054], mat: "gun_anodized" },
      { shape: "box", pos: [0, 0.6, 0.09], size: [24e-4, 24e-4, 0.0117], bevel: 4e-4, mat: "gun_anodized" },
      { shape: "slot", pos: [0, 0.6, 0.0791], length: 0.012, width: 8e-3, depth: 0.0206, plane: "xz", lod: false, mat: "shadow" },
      { shape: "cyl", pos: [0, -0.06, 0.014], radius: 28e-4, length: 0.0372, axis: "x", segments: 12, lod: false, mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0, 0.12, 0.014], radius: 28e-4, length: 0.0372, axis: "x", segments: 12, lod: false, mat: "gun_steel_bare" },
      { shape: "profile", pts: [[0.02, 0.012], [0.0212, 92e-4], [0.024, 8e-3], [0.136, 8e-3], [0.1388, 92e-4], [0.14, 0.012], [0.14, 0.054], [0.1388, 0.0568], [0.136, 0.058], [0.024, 0.058], [0.0212, 0.0568], [0.02, 0.054]], width: 4e-3, bevel: 12e-4, plane: "yz", pos: [-0.02, 0, 0], mat: "poly_black" },
      { shape: "cyl", pos: [-0.0275, 0.035, 0.032], radius: 0.0103, length: 0.05, axis: "z", segments: 14, mat: "poly_red" },
      { shape: "cyl", pos: [-0.0275, 0.035, 4e-3], radius: 0.0108, length: 0.012, axis: "z", bevel: 6e-4, segments: 14, mat: "gun_brass" },
      { shape: "cyl", pos: [-0.0275, 0.061, 0.032], radius: 0.0103, length: 0.05, axis: "z", segments: 14, mat: "poly_red" },
      { shape: "cyl", pos: [-0.0275, 0.061, 4e-3], radius: 0.0108, length: 0.012, axis: "z", bevel: 6e-4, segments: 14, mat: "gun_brass" },
      { shape: "cyl", pos: [-0.0275, 0.087, 0.032], radius: 0.0103, length: 0.05, axis: "z", segments: 14, mat: "poly_red" },
      { shape: "cyl", pos: [-0.0275, 0.087, 4e-3], radius: 0.0108, length: 0.012, axis: "z", bevel: 6e-4, segments: 14, mat: "gun_brass" },
      { shape: "cyl", pos: [-0.0275, 0.113, 0.032], radius: 0.0103, length: 0.05, axis: "z", segments: 14, mat: "poly_red" },
      { shape: "cyl", pos: [-0.0275, 0.113, 4e-3], radius: 0.0108, length: 0.012, axis: "z", bevel: 6e-4, segments: 14, mat: "gun_brass" },
      { shape: "cyl", pos: [0, 0.385, 0.042], radius: 0.0118, radius2: 0.0112, length: 0.47, axis: "y", segments: 24, mat: "gun_parkerized_dark" },
      { shape: "cyl", pos: [0, 0.37, 0.015], radius: 0.0122, length: 0.44, axis: "y", segments: 22, mat: "gun_parkerized_dark" },
      { shape: "cyl", pos: [0, 0.6, 0.015], radius: 0.0135, length: 0.028, axis: "y", bevel: 1e-3, segments: 22, mat: "gun_knurl" },
      { shape: "loft", kind: "rect", sections: [{ y: 0.15, w: 0.046, h: 0.05, z: 0.021, c: 0.016 }, { y: 0.16, w: 0.05, h: 0.054, z: 0.021, c: 0.018 }, { y: 0.36, w: 0.05, h: 0.054, z: 0.021, c: 0.018 }, { y: 0.37, w: 0.044, h: 0.048, z: 0.021, c: 0.015 }], mat: "poly_black" },
      { shape: "slot", pos: [0.0256, 0.18, 0.019], length: 0.03, width: 7e-3, depth: 14e-4, plane: "yz", lod: false, mat: "shadow", repeat: { count: 5, step: [0, 0.036, 0] } },
      { shape: "slot", pos: [-0.0256, 0.18, 0.019], length: 0.03, width: 7e-3, depth: 14e-4, plane: "yz", lod: false, mat: "shadow", repeat: { count: 5, step: [0, 0.036, 0] } },
      { shape: "box", pos: [0, 0.55, 0.0285], size: [0.016, 0.02, 0.05], bevel: 3e-3, mat: "gun_anodized" },
      { shape: "torus", pos: [0, 0.55, -3e-3], radius: 75e-4, tube: 16e-4, axis: "y", mat: "gun_steel_bare" },
      { shape: "profile", pts: [[-0.072, 71e-4], [-0.0358, -46e-4], [-0.0341, -57e-4], [-0.0332, -76e-4], [-0.0333, -96e-4], [-0.0375, -0.0226], [-0.0375, -0.0228], [-0.0376, -0.0231], [-0.0376, -0.0233], [-0.0384, -0.0288], [-0.0386, -0.0296], [-0.0389, -0.0303], [-0.0393, -0.0309], [-0.0434, -0.0356], [-0.0438, -0.0363], [-0.0442, -0.0371], [-0.0443, -0.0379], [-0.0452, -0.0496], [-0.0454, -0.0505], [-0.0457, -0.0512], [-0.0462, -0.0519], [-0.0502, -0.0565], [-0.0506, -0.0572], [-0.051, -0.058], [-0.0511, -0.0588], [-0.052, -0.0705], [-0.0522, -0.0714], [-0.0525, -0.0722], [-0.053, -0.0728], [-0.057, -0.0775], [-0.0575, -0.0781], [-0.0578, -0.0789], [-0.0579, -0.0797], [-0.0591, -0.0925], [-0.0593, -0.0933], [-0.0596, -0.094], [-0.0601, -0.0947], [-0.0632, -0.0983], [-0.0644, -0.0992], [-0.0659, -0.0997], [-0.0675, -0.0995], [-0.0981, -0.0895], [-0.0996, -0.0887], [-0.1005, -0.0874], [-0.1009, -0.0857], [-0.101, -0.0736], [-0.101, -0.0731], [-0.1009, -0.0726], [-0.1008, -0.0721], [-0.0815, -0.0221], [-0.0814, -0.0216], [-0.0813, -0.0211], [-0.0813, -0.0206], [-0.0818, 33e-4], [-0.0818, 38e-4], [-0.0817, 42e-4], [-0.0816, 47e-4], [-0.0808, 7e-3], [-0.08, 82e-4], [-0.0787, 89e-4], [-0.0772, 88e-4]], width: 0.03, bevel: 3e-3, plane: "yz", pos: [0, 0, 0], smooth: 45, mat: "poly_black_grip" },
      { shape: "profile", pts: [[-0.1016, -0.091], [-0.1016, -0.0921], [-0.1007, -0.0929], [-0.0668, -0.1039], [-0.0656, -0.1038], [-0.0649, -0.1029], [-0.064, -0.1001], [-0.0641, -0.0989], [-0.0649, -0.0982], [-0.0988, -0.0872], [-0.1, -0.0873], [-0.1007, -0.0881]], width: 0.031, bevel: 1e-3, plane: "yz", pos: [0, 0, 0], mat: "poly_black" },
      { shape: "profile", pts: [[0, 0], [4e-3, 0], [65e-4, -8e-3], [6e-3, -0.016], [25e-4, -0.024], [-1e-3, -0.025], [1e-3, -0.016], [15e-4, -8e-3]], width: 55e-4, bevel: 6e-4, plane: "yz", pos: [0, 0, 0], group: "trigger", mat: "gun_steel_bare" },
      { shape: "cyl", pos: [0, 2e-3, 1e-3], radius: 16e-4, length: 0.03, axis: "x", segments: 10, lod: false, mat: "gun_steel_bare" },
      { shape: "sweep", path: [[0, -0.028, -4e-3], [0, -0.028, -0.023], [0, -0.0275, -0.0257], [0, -0.0259, -0.0279], [0, -0.0237, -0.0295], [0, -0.021, -0.03], [0, 0.043, -0.03], [0, 0.0457, -0.0295], [0, 0.0479, -0.0279], [0, 0.0495, -0.0257], [0, 0.05, -0.023], [0, 0.05, -4e-3]], section: { kind: "rect", w: 0.014, h: 4e-3, c: 12e-4 }, mat: "gun_anodized" },
      { shape: "profile", pts: [[-0.08, 0.0533], [-0.0804, 0.055], [-0.0814, 0.0563], [-0.0829, 0.0571], [-0.0847, 0.0572], [-0.1381, 0.0483], [-0.139, 0.0482], [-0.14, 0.0481], [-0.141, 0.048], [-0.142, 0.0479], [-0.369, 0.04], [-0.3695, 0.04], [-0.37, 0.0399], [-0.3704, 0.0397], [-0.3709, 0.0395], [-0.3781, 0.0352], [-0.3789, 0.0345], [-0.3795, 0.0337], [-0.3799, 0.0328], [-0.38, 0.0317], [-0.38, -0.0749], [-0.3798, -0.0762], [-0.3792, -0.0773], [-0.3782, -0.0782], [-0.377, -0.0788], [-0.3629, -0.0823], [-0.3615, -0.0825], [-0.36, -0.0826], [-0.3586, -0.0824], [-0.3571, -0.082], [-0.2202, -0.0331], [-0.2201, -0.033], [-0.22, -0.033], [-0.2199, -0.033], [-0.2198, -0.0329], [-0.1241, 6e-4], [-0.122, 12e-4], [-0.1199, 17e-4], [-0.1178, 2e-3], [-0.1157, 22e-4], [-0.0829, 39e-4], [-0.0817, 41e-4], [-0.0808, 48e-4], [-0.0802, 57e-4], [-0.08, 69e-4]], width: 0.04, bevel: 45e-4, plane: "yz", pos: [0, 0, 0], smooth: 45, mat: "poly_black" },
      { shape: "profile", pts: [[-0.38, 0.0337], [-0.3803, 0.0348], [-0.3812, 0.0355], [-0.3823, 0.0357], [-0.3897, 0.0346], [-0.3919, 0.0337], [-0.3934, 0.032], [-0.394, 0.0297], [-0.394, -0.0754], [-0.3931, -0.0783], [-0.3907, -0.0801], [-0.3876, -0.0802], [-0.3815, -0.0784], [-0.3807, -0.078], [-0.3802, -0.0773], [-0.38, -0.0765]], width: 0.044, bevel: 3e-3, plane: "yz", pos: [0, 0, 0], mat: "gun_rubber_pad" },
      { shape: "cyl", pos: [0.0205, -0.12, 0.032], radius: 65e-4, length: 4e-3, axis: "x", bore: 3e-3, bevel: 6e-4, segments: 16, mat: "gun_steel_bare" }
    ],
    anchors: { muzzle: [0, 0.62, 0.042], eject: [0.02, 0.06, 0.046], sight: [0, -0.033, 0.095], grip_r: [0, -0.0639, -0.0428], grip_l: [0, 0.27, -7e-3], mag: [0, 0.06, 0] },
    bounds: { min: [-0.0383, -0.394, -0.1039], max: [0.0263, 0.62, 0.1032] },
    groups: { bolt: { pivot: [0, 0, 0] }, trigger: { pivot: [0, 0, 0] } },
    viewmodel: { offset: [0.125, 0.35, -0.155], ads_distance: 0.17, elbow_r: [0.28, -0.12, -0.38], elbow_l: [-0.22, 0.02, -0.4], bolt_kick: true, bolt_travel: 0.03 },
    sight_parts: ["gun_anodized"]
  },
  grenade_frag: {
    parts: [
      { shape: "sphere", pos: [0, 0, 0], radius: 0.033, mat: "metal_olive" },
      { shape: "cyl", pos: [0, 0, 0.038], radius: 0.01, length: 0.022, axis: "z", mat: "gun_metal" },
      { shape: "box", pos: [0, -0.012, 0.01], size: [0.012, 4e-3, 0.06], hpr: [0, 0, 0], bevel: 1e-3, mat: "gun_metal_light" },
      { shape: "cyl", pos: [0.012, 0, 0.042], radius: 9e-3, length: 2e-3, axis: "x", mat: "gun_metal_light" }
    ],
    anchors: { muzzle: [0, 0, 0], eject: [0, 0, 0], sight: [0, 0, 0.05], grip_r: [0, 0, -0.01], grip_l: [-0.2, -0.1, -0.2], mag: [0, 0, 0] },
    viewmodel: { offset: [0.14, 0.28, -0.15], ads_distance: 0.3, one_handed: true, elbow_r: [0.26, -0.1, -0.36], elbow_l: [-0.3, -0.1, -0.4] },
    radius: 0.035
  },
  grenade_smoke: {
    parts: [
      { shape: "cyl", pos: [0, 0, 0], radius: 0.03, length: 0.11, axis: "z", mat: "gun_metal_light" },
      { shape: "cyl", pos: [0, 0, 0], radius: 0.0305, length: 0.03, axis: "z", mat: "metal_tan" },
      { shape: "cyl", pos: [0, 0, 0.064], radius: 0.01, length: 0.02, axis: "z", mat: "gun_metal" },
      { shape: "box", pos: [0, -0.012, 0.03], size: [0.012, 4e-3, 0.06], bevel: 1e-3, mat: "gun_metal" }
    ],
    anchors: { muzzle: [0, 0, 0], eject: [0, 0, 0], sight: [0, 0, 0.05], grip_r: [0, 0, -0.01], grip_l: [-0.2, -0.1, -0.2], mag: [0, 0, 0] },
    viewmodel: { offset: [0.14, 0.28, -0.15], ads_distance: 0.3, one_handed: true, elbow_r: [0.26, -0.1, -0.36], elbow_l: [-0.3, -0.1, -0.4] },
    radius: 0.032
  },
  grenade_flash: {
    parts: [
      { shape: "cyl", pos: [0, 0, 0], radius: 0.027, length: 0.105, axis: "z", mat: "metal_olive" },
      { shape: "cyl", pos: [0, 0, -0.035], radius: 0.0275, length: 0.012, axis: "z", mat: "hazard" },
      { shape: "cyl", pos: [0, 0, 0.06], radius: 0.01, length: 0.02, axis: "z", mat: "gun_metal" },
      { shape: "box", pos: [0, -0.011, 0.03], size: [0.012, 4e-3, 0.06], bevel: 1e-3, mat: "gun_metal_light" }
    ],
    anchors: { muzzle: [0, 0, 0], eject: [0, 0, 0], sight: [0, 0, 0.05], grip_r: [0, 0, -0.01], grip_l: [-0.2, -0.1, -0.2], mag: [0, 0, 0] },
    viewmodel: { offset: [0.14, 0.28, -0.15], ads_distance: 0.3, one_handed: true, elbow_r: [0.26, -0.1, -0.36], elbow_l: [-0.3, -0.1, -0.4] },
    radius: 0.03
  },
  bomb_charge: {
    parts: [
      { shape: "box", pos: [0, 0, 0], size: [0.26, 0.17, 0.075], bevel: 8e-3, mat: "metal_olive" },
      { shape: "cyl", pos: [0, 0.045, -0.012], radius: 0.032, length: 0.27, axis: "x", mat: "vehicle_od" },
      { shape: "cyl", pos: [0, -0.045, -0.012], radius: 0.032, length: 0.27, axis: "x", mat: "vehicle_od" },
      { shape: "box", pos: [-0.08, 0, 0], size: [0.03, 0.18, 0.09], bevel: 4e-3, mat: "canvas" },
      { shape: "box", pos: [0.08, 0, 0], size: [0.03, 0.18, 0.09], bevel: 4e-3, mat: "canvas" },
      { shape: "box", pos: [0.04, -0.015, 0.041], size: [0.1, 0.085, 0.01], bevel: 2e-3, mat: "steel_painted" },
      { shape: "box", pos: [0.016, -0.03, 0.047], size: [0.018, 0.014, 5e-3], bevel: 1e-3, mat: "gun_metal" },
      { shape: "box", pos: [0.04, -0.03, 0.047], size: [0.018, 0.014, 5e-3], bevel: 1e-3, mat: "gun_metal" },
      { shape: "box", pos: [0.064, -0.03, 0.047], size: [0.018, 0.014, 5e-3], bevel: 1e-3, mat: "gun_metal" },
      { shape: "box", pos: [0.016, -0.05, 0.047], size: [0.018, 0.014, 5e-3], bevel: 1e-3, mat: "gun_metal" },
      { shape: "box", pos: [0.04, -0.05, 0.047], size: [0.018, 0.014, 5e-3], bevel: 1e-3, mat: "gun_metal" },
      { shape: "box", pos: [0.064, -0.05, 0.047], size: [0.018, 0.014, 5e-3], bevel: 1e-3, mat: "gun_metal" },
      { shape: "box", pos: [0.04, 0.012, 0.047], size: [0.075, 0.022, 4e-3], bevel: 1e-3, mat: "glass_dark" },
      { shape: "box", pos: [0.04, 0.012, 0.0495], size: [0.06, 0.012, 1e-3], bevel: 3e-4, mat: "pbr_white_rough", emit: [0.4, 2.5, 0.6], group: "display" },
      { shape: "sphere", pos: [-0.04, 0.05, 0.043], radius: 6e-3, mat: "pbr_white_rough", emit: [30, 1.5, 0.8], group: "led" },
      { shape: "cyl", pos: [-0.03, 0, 0.045], radius: 35e-4, length: 0.16, axis: "y", mat: "paint_red" },
      { shape: "cyl", pos: [-0.045, 0, 0.044], radius: 35e-4, length: 0.16, axis: "y", mat: "steel" }
    ],
    anchors: { muzzle: [0, 0.1, 0], eject: [0, 0, 0], sight: [0, 0, 0.06], grip_r: [0.12, -0.03, -0.02], grip_l: [-0.12, -0.03, -0.02], mag: [0, 0, 0] },
    viewmodel: { offset: [0.02, 0.4, -0.25], ads_distance: 0.4, elbow_r: [0.3, -0.18, -0.42], elbow_l: [-0.28, -0.18, -0.42] },
    radius: 0.15
  },
  gadget_drone: {
    parts: [
      { shape: "box", pos: [0, 0, 0.075], size: [0.15, 0.19, 0.06], bevel: 0.01, mat: "metal_olive" },
      { shape: "box", pos: [0, 0, 0.11], size: [0.11, 0.12, 0.02], bevel: 4e-3, mat: "gun_metal" },
      { shape: "cyl", pos: [0.1, 0, 0.065], radius: 0.065, length: 0.035, axis: "x", mat: "dummy_polymer" },
      { shape: "cyl", pos: [-0.1, 0, 0.065], radius: 0.065, length: 0.035, axis: "x", mat: "dummy_polymer" },
      { shape: "cyl", pos: [0.1, 0, 0.065], radius: 0.03, length: 0.04, axis: "x", mat: "gun_metal_light" },
      { shape: "cyl", pos: [-0.1, 0, 0.065], radius: 0.03, length: 0.04, axis: "x", mat: "gun_metal_light" },
      { shape: "sphere", pos: [0, 0.095, 0.085], radius: 0.022, mat: "glass_dark" },
      { shape: "box", pos: [-0.045, -0.085, 0.16], size: [6e-3, 6e-3, 0.12], bevel: 1e-3, mat: "steel" },
      { shape: "box", pos: [0.03, 0.097, 0.11], size: [0.012, 6e-3, 8e-3], bevel: 1e-3, mat: "pbr_red_plastic", group: "led" }
    ],
    radius: 0.07
  },
  gadget_camera: {
    parts: [
      { shape: "box", pos: [0, -0.03, 0], size: [0.09, 0.06, 0.09], bevel: 6e-3, mat: "steel_painted" },
      { shape: "box", pos: [0, 0, 0.05], size: [0.03, 0.05, 0.04], bevel: 4e-3, mat: "steel_painted" },
      { shape: "cyl", pos: [0, 0.07, 0.02], radius: 0.045, length: 0.15, axis: "y", mat: "pbr_white_rough" },
      { shape: "cyl", pos: [0, 0.15, 0.02], radius: 0.03, length: 0.02, axis: "y", mat: "gun_metal" },
      { shape: "sphere", pos: [0, 0.16, 0.02], radius: 0.024, mat: "glass_dark" },
      { shape: "box", pos: [0.03, 0.12, 0.06], size: [0.012, 0.012, 8e-3], bevel: 1e-3, mat: "pbr_red_plastic", group: "led" }
    ]
  },
  gadget_charge: {
    parts: [
      { shape: "box", pos: [0, 0.012, 0], size: [0.62, 0.024, 1], bevel: 0.01, mat: "canvas" },
      { shape: "box", pos: [0, 0.026, 0.42], size: [0.62, 0.012, 0.04], bevel: 2e-3, mat: "hazard" },
      { shape: "box", pos: [0, 0.026, -0.42], size: [0.62, 0.012, 0.04], bevel: 2e-3, mat: "hazard" },
      { shape: "box", pos: [0, 0.045, 0.18], size: [0.1, 0.05, 0.07], bevel: 6e-3, mat: "metal_olive" },
      { shape: "box", pos: [0.025, 0.072, 0.19], size: [0.014, 6e-3, 0.01], bevel: 1e-3, mat: "pbr_red_plastic", group: "led" }
    ]
  },
  gadget_lance: {
    parts: [
      { shape: "box", pos: [0, 0.015, 0], size: [0.74, 0.03, 1.3], bevel: 0.01, mat: "hazard" },
      { shape: "box", pos: [0, 0.034, 0], size: [0.6, 0.01, 1.12], bevel: 4e-3, mat: "gun_metal" },
      { shape: "cyl", pos: [-0.22, 0.09, 0], radius: 0.055, length: 0.5, axis: "z", mat: "metal_olive" },
      { shape: "cyl", pos: [0.22, 0.09, 0], radius: 0.055, length: 0.5, axis: "z", mat: "metal_olive" },
      { shape: "box", pos: [0, 0.07, 0.36], size: [0.12, 0.06, 0.08], bevel: 6e-3, mat: "steel_painted" },
      { shape: "box", pos: [0.03, 0.102, 0.37], size: [0.014, 6e-3, 0.01], bevel: 1e-3, mat: "pbr_red_plastic", group: "led" }
    ]
  },
  gadget_wire: {
    parts: [
      { shape: "box", pos: [-0.81, 0, 0.22], size: [0.012, 0.012, 0.5], bevel: 1e-3, mat: "steel", hpr: [0, 0, 55] },
      { shape: "box", pos: [-0.81, 0, 0.22], size: [0.012, 0.012, 0.5], bevel: 1e-3, mat: "steel", hpr: [0, 0, -55] },
      { shape: "box", pos: [-0.81, 0, 0.22], size: [0.012, 0.42, 0.012], bevel: 1e-3, mat: "steel", hpr: [0, 0, 0] },
      { shape: "box", pos: [-0.6300000000000001, 0, 0.22], size: [0.012, 0.012, 0.5], bevel: 1e-3, mat: "steel", hpr: [0, 0, 55] },
      { shape: "box", pos: [-0.6300000000000001, 0, 0.22], size: [0.012, 0.012, 0.5], bevel: 1e-3, mat: "steel", hpr: [0, 0, -55] },
      { shape: "box", pos: [-0.6300000000000001, 0, 0.22], size: [0.012, 0.42, 0.012], bevel: 1e-3, mat: "steel", hpr: [0, 0, 0] },
      { shape: "box", pos: [-0.45000000000000007, 0, 0.22], size: [0.012, 0.012, 0.5], bevel: 1e-3, mat: "steel", hpr: [0, 0, 55] },
      { shape: "box", pos: [-0.45000000000000007, 0, 0.22], size: [0.012, 0.012, 0.5], bevel: 1e-3, mat: "steel", hpr: [0, 0, -55] },
      { shape: "box", pos: [-0.45000000000000007, 0, 0.22], size: [0.012, 0.42, 0.012], bevel: 1e-3, mat: "steel", hpr: [0, 0, 0] },
      { shape: "box", pos: [-0.27, 0, 0.22], size: [0.012, 0.012, 0.5], bevel: 1e-3, mat: "steel", hpr: [0, 0, 55] },
      { shape: "box", pos: [-0.27, 0, 0.22], size: [0.012, 0.012, 0.5], bevel: 1e-3, mat: "steel", hpr: [0, 0, -55] },
      { shape: "box", pos: [-0.27, 0, 0.22], size: [0.012, 0.42, 0.012], bevel: 1e-3, mat: "steel", hpr: [0, 0, 0] },
      { shape: "box", pos: [-0.09000000000000008, 0, 0.22], size: [0.012, 0.012, 0.5], bevel: 1e-3, mat: "steel", hpr: [0, 0, 55] },
      { shape: "box", pos: [-0.09000000000000008, 0, 0.22], size: [0.012, 0.012, 0.5], bevel: 1e-3, mat: "steel", hpr: [0, 0, -55] },
      { shape: "box", pos: [-0.09000000000000008, 0, 0.22], size: [0.012, 0.42, 0.012], bevel: 1e-3, mat: "steel", hpr: [0, 0, 0] },
      { shape: "box", pos: [0.08999999999999986, 0, 0.22], size: [0.012, 0.012, 0.5], bevel: 1e-3, mat: "steel", hpr: [0, 0, 55] },
      { shape: "box", pos: [0.08999999999999986, 0, 0.22], size: [0.012, 0.012, 0.5], bevel: 1e-3, mat: "steel", hpr: [0, 0, -55] },
      { shape: "box", pos: [0.08999999999999986, 0, 0.22], size: [0.012, 0.42, 0.012], bevel: 1e-3, mat: "steel", hpr: [0, 0, 0] },
      { shape: "box", pos: [0.27, 0, 0.22], size: [0.012, 0.012, 0.5], bevel: 1e-3, mat: "steel", hpr: [0, 0, 55] },
      { shape: "box", pos: [0.27, 0, 0.22], size: [0.012, 0.012, 0.5], bevel: 1e-3, mat: "steel", hpr: [0, 0, -55] },
      { shape: "box", pos: [0.27, 0, 0.22], size: [0.012, 0.42, 0.012], bevel: 1e-3, mat: "steel", hpr: [0, 0, 0] },
      { shape: "box", pos: [0.44999999999999996, 0, 0.22], size: [0.012, 0.012, 0.5], bevel: 1e-3, mat: "steel", hpr: [0, 0, 55] },
      { shape: "box", pos: [0.44999999999999996, 0, 0.22], size: [0.012, 0.012, 0.5], bevel: 1e-3, mat: "steel", hpr: [0, 0, -55] },
      { shape: "box", pos: [0.44999999999999996, 0, 0.22], size: [0.012, 0.42, 0.012], bevel: 1e-3, mat: "steel", hpr: [0, 0, 0] },
      { shape: "box", pos: [0.6299999999999999, 0, 0.22], size: [0.012, 0.012, 0.5], bevel: 1e-3, mat: "steel", hpr: [0, 0, 55] },
      { shape: "box", pos: [0.6299999999999999, 0, 0.22], size: [0.012, 0.012, 0.5], bevel: 1e-3, mat: "steel", hpr: [0, 0, -55] },
      { shape: "box", pos: [0.6299999999999999, 0, 0.22], size: [0.012, 0.42, 0.012], bevel: 1e-3, mat: "steel", hpr: [0, 0, 0] },
      { shape: "box", pos: [0.8099999999999998, 0, 0.22], size: [0.012, 0.012, 0.5], bevel: 1e-3, mat: "steel", hpr: [0, 0, 55] },
      { shape: "box", pos: [0.8099999999999998, 0, 0.22], size: [0.012, 0.012, 0.5], bevel: 1e-3, mat: "steel", hpr: [0, 0, -55] },
      { shape: "box", pos: [0.8099999999999998, 0, 0.22], size: [0.012, 0.42, 0.012], bevel: 1e-3, mat: "steel", hpr: [0, 0, 0] },
      { shape: "box", pos: [0, 0.18, 0.38], size: [1.8, 8e-3, 8e-3], bevel: 1e-3, mat: "steel" },
      { shape: "box", pos: [0, -0.18, 0.38], size: [1.8, 8e-3, 8e-3], bevel: 1e-3, mat: "steel" },
      { shape: "box", pos: [0, 0.18, 0.08], size: [1.8, 8e-3, 8e-3], bevel: 1e-3, mat: "steel" },
      { shape: "box", pos: [0, -0.18, 0.08], size: [1.8, 8e-3, 8e-3], bevel: 1e-3, mat: "steel" },
      { shape: "box", pos: [0, 0, 0.43], size: [1.8, 8e-3, 8e-3], bevel: 1e-3, mat: "steel" },
      { shape: "box", pos: [-0.88, 0, 0.22], size: [0.025, 0.025, 0.46], bevel: 3e-3, mat: "metal_olive" },
      { shape: "box", pos: [0, 0, 0.22], size: [0.025, 0.025, 0.46], bevel: 3e-3, mat: "metal_olive" },
      { shape: "box", pos: [0.88, 0, 0.22], size: [0.025, 0.025, 0.46], bevel: 3e-3, mat: "metal_olive" }
    ]
  },
  gadget_sensor: {
    parts: [
      { shape: "box", pos: [0, 0.015, 0], size: [0.11, 0.03, 0.15], bevel: 6e-3, mat: "metal_olive" },
      { shape: "sphere", pos: [0, 0.03, 0.02], radius: 0.034, mat: "glass_dark" },
      { shape: "box", pos: [0, 0.035, -0.05], size: [0.05, 0.012, 0.012], bevel: 1e-3, mat: "pbr_red_plastic", group: "led" }
    ]
  },
  gadget_shield: {
    parts: [
      { shape: "box", pos: [0, 0, 0.62], size: [1.05, 0.07, 1.1], bevel: 0.01, mat: "steel_painted" },
      { shape: "box", pos: [0, 0.04, 0.62], size: [0.95, 0.01, 1], bevel: 3e-3, mat: "metal_olive" },
      { shape: "box", pos: [0, 0.01, 0.98], size: [0.3, 0.08, 0.05], bevel: 4e-3, mat: "glass_dark" },
      { shape: "box", pos: [-0.4, -0.2, 0.18], size: [0.05, 0.42, 0.05], bevel: 4e-3, mat: "steel", hpr: [0, -35, 0] },
      { shape: "box", pos: [0.4, -0.2, 0.18], size: [0.05, 0.42, 0.05], bevel: 4e-3, mat: "steel", hpr: [0, -35, 0] },
      { shape: "box", pos: [0, -0.03, 0.07], size: [1, 0.08, 0.06], bevel: 4e-3, mat: "steel" }
    ]
  },
  gadget_jammer: {
    parts: [
      { shape: "box", pos: [0, 0, 0.06], size: [0.3, 0.2, 0.12], bevel: 0.01, mat: "metal_olive" },
      { shape: "box", pos: [0, 0.101, 0.08], size: [0.2, 4e-3, 0.05], bevel: 2e-3, mat: "glass_dark" },
      { shape: "box", pos: [-0.1, -0.06, 0.24], size: [8e-3, 8e-3, 0.26], bevel: 1e-3, mat: "steel" },
      { shape: "box", pos: [0, -0.06, 0.26], size: [8e-3, 8e-3, 0.3], bevel: 1e-3, mat: "steel" },
      { shape: "box", pos: [0.1, -0.06, 0.24], size: [8e-3, 8e-3, 0.26], bevel: 1e-3, mat: "steel" },
      { shape: "box", pos: [0.08, 0.103, 0.08], size: [0.02, 6e-3, 0.012], bevel: 1e-3, mat: "pbr_red_plastic", group: "led" }
    ]
  },
  grenade_emp: {
    parts: [
      { shape: "cyl", pos: [0, 0, 0], radius: 0.029, length: 0.1, axis: "z", mat: "steel_painted" },
      { shape: "cyl", pos: [0, 0, 0], radius: 0.0295, length: 0.03, axis: "z", mat: "glass_dark" },
      { shape: "cyl", pos: [0, 0, 0.06], radius: 0.01, length: 0.02, axis: "z", mat: "gun_metal" },
      { shape: "box", pos: [0, -0.011, 0.03], size: [0.012, 4e-3, 0.06], bevel: 1e-3, mat: "gun_metal_light" }
    ],
    radius: 0.03
  }
};

// shared/src/models.ts
var MODEL_DEFS = Object.fromEntries(
  Object.entries(weapon_models_default).filter(([k]) => !k.startsWith("_"))
);

// shared/src/skeleton.ts
var UPPER_ARM = 0.3;
var LOWER_ARM = 0.25;
var PALM = 0.07;
var STAND_PELVIS = 0.9;
var A_POSE = 40;
var D = Math.PI / 180;
function segHpr(d) {
  return [Math.atan2(-d[0], d[1]) / D, Math.atan2(d[2], Math.hypot(d[0], d[1])) / D, 0];
}
function arm(side, sx) {
  const t = -sx;
  const a = A_POSE * D;
  const armHpr = segHpr([Math.sin(a) * sx, 0.05, -Math.cos(a)]);
  const bones = [
    { name: `clavicle_${side}`, parent: "spine_03", pos: [0.03 * sx, 0, 0.22], hpr: [0, 0, 0] },
    { name: `upperarm_${side}`, parent: `clavicle_${side}`, pos: [0.18 * sx, 0, 0.02], hpr: armHpr },
    { name: `upperarm_twist_${side}`, parent: `upperarm_${side}`, pos: [0, UPPER_ARM * 0.5, 0], hpr: [0, 0, 0] },
    { name: `lowerarm_${side}`, parent: `upperarm_${side}`, pos: [0, UPPER_ARM, 0], hpr: [0, 0, 0] },
    { name: `lowerarm_twist_${side}`, parent: `lowerarm_${side}`, pos: [0, LOWER_ARM * 0.5, 0], hpr: [0, 0, 0] },
    { name: `hand_${side}`, parent: `lowerarm_${side}`, pos: [0, LOWER_ARM, 0], hpr: [0, 0, 0] }
  ];
  const chains = [
    ["thumb", [0.024 * t, 0.025, -0.012], [-28 * t, 0, 0], [0.04, 0.032]],
    ["index", [0.022 * t, 0.088, 0], [0, 0, 0], [0.045, 0.026]],
    ["fingers", [-0.012 * t, 0.09, 0], [0, 0, 0], [0.046, 0.029]]
  ];
  for (const [name, root, hpr, [l1, l2]] of chains) {
    bones.push({ name: `${name}_01_${side}`, parent: `hand_${side}`, pos: root, hpr });
    bones.push({ name: `${name}_02_${side}`, parent: `${name}_01_${side}`, pos: [0, l1, 0], hpr: [0, 0, 0] });
    bones.push({ name: `${name}_03_${side}`, parent: `${name}_02_${side}`, pos: [0, l2, 0], hpr: [0, 0, 0] });
  }
  return bones;
}
function leg(side, sx) {
  return [
    { name: `thigh_${side}`, parent: "pelvis", pos: [0.105 * sx, 0, -0.06], hpr: [0, 0, 0] },
    { name: `calf_${side}`, parent: `thigh_${side}`, pos: [0, 0, -0.43], hpr: [0, 0, 0] },
    { name: `foot_${side}`, parent: `calf_${side}`, pos: [0, 0, -0.33], hpr: [0, 0, 0] },
    { name: `toe_${side}`, parent: `foot_${side}`, pos: [0, 0.14, -0.06], hpr: [0, 0, 0] }
  ];
}
var BONES = [
  { name: "root", parent: "", pos: [0, 0, 0], hpr: [0, 0, 0] },
  { name: "pelvis", parent: "root", pos: [0, 0, STAND_PELVIS], hpr: [0, 0, 0] },
  { name: "spine_01", parent: "pelvis", pos: [0, 0, 0.08], hpr: [0, 0, 0] },
  { name: "spine_02", parent: "spine_01", pos: [0, 0, 0.1], hpr: [0, 0, 0] },
  { name: "spine_03", parent: "spine_02", pos: [0, 0, 0.1], hpr: [0, 0, 0] },
  { name: "neck", parent: "spine_03", pos: [0, 0, 0.3], hpr: [0, 0, 0] },
  { name: "head", parent: "neck", pos: [0, 0.01, 0.09], hpr: [0, 0, 0] },
  ...arm("l", -1),
  ...arm("r", 1),
  ...leg("l", -1),
  ...leg("r", 1),
  { name: "weapon", parent: "spine_03", pos: [0.115, 0.17, 0.17], hpr: [0, 0, 0] },
  { name: "pack", parent: "spine_03", pos: [0, -0.17, 0.1], hpr: [0, 0, 0] }
];
var N_BONES = BONES.length;
var INDEX = Object.fromEntries(BONES.map((b, i) => [b.name, i]));
var PARENT = BONES.map((b) => b.parent ? INDEX[b.parent] : -1);
function solve(pos, hpr, out = []) {
  const local3 = new Float64Array(16);
  for (let i = 0; i < N_BONES; i++) {
    const p = pos[i], h = hpr[i];
    m4PosHpr(p, h[0], h[1], h[2], local3);
    const parent = PARENT[i];
    out[i] = parent < 0 ? Float64Array.from(local3) : m4Mul(local3, out[parent], out[i] ?? new Float64Array(16));
  }
  return out;
}
var REST_POS = BONES.map((b) => [...b.pos]);
var REST_HPR = BONES.map((b) => [...b.hpr]);
var REST_WORLD = solve(REST_POS, REST_HPR);
var INV_BIND = REST_WORLD.map((m) => m4InvAffine(m));

// shared/src/pose.ts
var FOREARM = LOWER_ARM + PALM;
var D2 = Math.PI / 180;
var CLIPS = Object.fromEntries(Object.entries(character_anims_default).filter(([k]) => !k.startsWith("_")));
var restPos = (n) => {
  const m = REST_WORLD[INDEX[n]];
  return [m[12], m[13], m[14]];
};
function capsuleDefs() {
  const raw2 = [
    ["head", "head", "head", [0, 0.011, 1.625], null, 0.112],
    ["neck", "chest", "neck", restPos("neck"), [0, 5e-3, restPos("neck")[2] + 0.085], 0.06],
    ["chest", "chest", "spine_03", [-0.045, 0, 1.33], [0.045, 0, 1.33], 0.17],
    ["stomach", "stomach", "spine_01", [-0.025, 0, 1.06], [0.025, 0, 1.06], 0.125],
    ["pelvis", "stomach", "pelvis", [-0.09, 0, 0.89], [0.09, 0, 0.89], 0.13]
  ];
  for (const s of ["l", "r"]) {
    raw2.push([`upper_arm_${s}`, "arm", `upperarm_${s}`, restPos(`upperarm_${s}`), restPos(`lowerarm_${s}`), 0.055]);
    raw2.push([`forearm_${s}`, "arm", `lowerarm_${s}`, restPos(`lowerarm_${s}`), restPos(`hand_${s}`), 0.045]);
    raw2.push([`thigh_${s}`, "leg", `thigh_${s}`, restPos(`thigh_${s}`), restPos(`calf_${s}`), 0.085]);
    raw2.push([`calf_${s}`, "leg", `calf_${s}`, restPos(`calf_${s}`), restPos(`foot_${s}`), 0.065]);
  }
  return raw2.map(([name, hitgroup, bone, a, b, radius]) => {
    const inv = INV_BIND[INDEX[bone]];
    return { name, hitgroup, bone: INDEX[bone], radius, sphere: b === null, a: m4Point(inv, a), b: m4Point(inv, b ?? a) };
  });
}
var CAPSULES = capsuleDefs();
var NEEDED = (() => {
  const keep = /* @__PURE__ */ new Set();
  for (const name of [...CAPSULES.map((c) => BONES[c.bone].name), "weapon", "pack", "head"]) {
    let i = INDEX[name];
    while (i >= 0 && !keep.has(i)) {
      keep.add(i);
      i = PARENT[i];
    }
  }
  return [...keep].sort((x, y) => x - y);
})();

// server/src/net/snapshots.ts
var SPOT_COS = Math.cos(60 * Math.PI / 180);

// shared/src/level/meshbuilder.ts
var FLOATS_PER_VERTEX = 18;
var BOX_FACES = [
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  [[-1, 0, 0], [0, -1, 0], [0, 0, 1]],
  [[0, 1, 0], [-1, 0, 0], [0, 0, 1]],
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
  [[0, 0, -1], [-1, 0, 0], [0, 1, 0]]
];
var FACE_NAMES = ["+x", "-x", "+y", "-y", "+z", "-z"];
var rot = (p, R) => [
  p[0] * R[0][0] + p[1] * R[1][0] + p[2] * R[2][0],
  p[0] * R[0][1] + p[1] * R[1][1] + p[2] * R[2][1],
  p[0] * R[0][2] + p[1] * R[1][2] + p[2] * R[2][2]
];
var dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
var cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
var norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
var MeshBuilder = class _MeshBuilder {
  verts = [];
  indices = [];
  /** The material this builder is batched under (LevelContext sets it). */
  name = "";
  /** When set, every shape and planar face is recorded (see FaceRecorder). */
  static recorder = null;
  /** Group / variant tags for the shapes recorded from now on (LevelContext sets them for organic walls and LODs). */
  static group = -1;
  static variant = "";
  /** Height the dust gradient is measured from (LevelContext sets the current piece's base). */
  static baseZ = null;
  shape = -1;
  /** Cross-section of the shape being emitted when it is a thin piece (set by addBox / addCylinder). */
  thin = 0;
  get vertexCount() {
    return this.verts.length / FLOATS_PER_VERTEX;
  }
  /** Start a recorded shape; returns a token for endShape (-1 when not recording, -2 when nested). */
  beginShape() {
    const r = _MeshBuilder.recorder;
    if (r && this.shape >= 0) return -2;
    if (!r) return this.shape = -1;
    r.shapes.push({
      builder: this,
      v0: this.vertexCount,
      v1: this.vertexCount,
      mat: this.name,
      label: r.label,
      boxes: [],
      group: _MeshBuilder.group >= 0 ? _MeshBuilder.group : r.shapes.length,
      variant: _MeshBuilder.variant
    });
    return this.shape = r.shapes.length - 1;
  }
  endShape(token = 0) {
    if (token === -2) return;
    const r = _MeshBuilder.recorder;
    if (r && this.shape >= 0) r.shapes[this.shape].v1 = this.vertexCount;
    this.shape = -1;
  }
  /** Record a planar face of the current shape: its triangles are indices[i0, current end). */
  recordFace(n, poly, i0) {
    const r = _MeshBuilder.recorder;
    if (!r || this.shape < 0) return;
    const nn = [n[0], n[1], n[2]];
    r.faces.push({ shape: this.shape, n: nn, d: dot(nn, poly[0]), poly, i0, i1: this.indices.length });
  }
  /** Record the solid volume of the current shape (a box). */
  recordBox(c, h, R) {
    const r = _MeshBuilder.recorder;
    if (r && this.shape >= 0) r.shapes[this.shape].boxes.push({ c: [c[0], c[1], c[2]], h: [h[0], h[1], h[2]], R });
  }
  /** Drop degenerate triangles (removed faces) and the vertices nothing uses any more. */
  compact() {
    const idx = this.indices;
    const keep = [];
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i], b = idx[i + 1], c = idx[i + 2];
      if (a === b || b === c || a === c) continue;
      keep.push(a, b, c);
    }
    const map = new Int32Array(this.vertexCount).fill(-1);
    const verts = [];
    let n = 0;
    for (let i = 0; i < keep.length; i++) {
      const v = keep[i];
      if (map[v] < 0) {
        map[v] = n++;
        const o = v * FLOATS_PER_VERTEX;
        for (let k = 0; k < FLOATS_PER_VERTEX; k++) verts.push(this.verts[o + k]);
      }
      keep[i] = map[v];
    }
    this.verts = verts;
    this.indices = keep;
  }
  /** One vertex: position, normal, tangent, binormal, uv (and the default detail: open, height above the base,
   *  no weathering, thin size). */
  vertex(p, n, t, b, u, v) {
    const bz = _MeshBuilder.baseZ;
    this.verts.push(
      p[0],
      p[1],
      p[2],
      n[0],
      n[1],
      n[2],
      t[0],
      t[1],
      t[2],
      b[0],
      b[1],
      b[2],
      u,
      v,
      1,
      bz === null ? -1 : Math.max(0, p[2] - bz),
      0,
      this.thin
    );
  }
  /** Append raw vertices (FLOATS_PER_VERTEX floats each) and local triangle indices. */
  add(verts, idx) {
    const base = this.vertexCount;
    for (let i = 0; i < verts.length; i++) this.verts.push(verts[i]);
    for (let i = 0; i < idx.length; i++) this.indices.push(idx[i] + base);
  }
  addQuad(corners, n, t, b, uvs) {
    const base = this.vertexCount;
    for (let i = 0; i < 4; i++) this.vertex(corners[i], n, t, b, uvs[i][0], uvs[i][1]);
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  /** Box of ``size`` (full extents) at ``center``. uv "world": world-planar UVs; "fit": each face maps to
   * [0, repeats] with repeats = face size / uvScale rounded to >= 1. */
  addBox(center, size, hpr = [0, 0, 0], uvScale = 1, skipFaces = [], uvMode = "world", uvOffset = [0, 0]) {
    const half = [size[0] / 2, size[1] / 2, size[2] / 2];
    const R = hprMatrix(hpr[0], hpr[1], hpr[2]);
    const signs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const tok = this.beginShape();
    this.recordBox(center, half, R);
    const sorted = [size[0], size[1], size[2]].sort((a, b) => a - b);
    this.thin = sorted[1] < 0.06 && sorted[2] > sorted[1] * 4 ? Math.max(sorted[0], 1e-3) : 0;
    BOX_FACES.forEach(([n, t, b], i) => {
      if (skipFaces.includes(FACE_NAMES[i])) return;
      const hn = Math.abs(dot(n, half)), ht = Math.abs(dot(t, half)), hb = Math.abs(dot(b, half));
      const nw = rot(n, R), tw = rot(t, R), bw = rot(b, R);
      const corners = [];
      const uvs = [];
      for (const [su, sv] of signs) {
        const local3 = [
          n[0] * hn + su * t[0] * ht + sv * b[0] * hb,
          n[1] * hn + su * t[1] * ht + sv * b[1] * hb,
          n[2] * hn + su * t[2] * ht + sv * b[2] * hb
        ];
        const w = rot(local3, R);
        const world = [w[0] + center[0], w[1] + center[1], w[2] + center[2]];
        corners.push(world);
        if (uvMode === "fit") {
          const ru = Math.max(Math.round(2 * ht / uvScale), 1), rv = Math.max(Math.round(2 * hb / uvScale), 1);
          uvs.push([(su * 0.5 + 0.5) * ru + uvOffset[0], (sv * 0.5 + 0.5) * rv + uvOffset[1]]);
        } else {
          uvs.push([dot(world, tw) / uvScale + uvOffset[0], dot(world, bw) / uvScale + uvOffset[1]]);
        }
      }
      this.addQuad(corners, nw, tw, bw, uvs);
      this.recordFace(nw, corners, this.indices.length - 6);
    });
    this.thin = 0;
    this.endShape(tok);
  }
  /** A box with rounded edges and an optional organic surface, for plinths, parapets, sills, footings, buttresses
   *  and slab edges. Every face is a grid; the grid's cuts are shared per axis, so the faces meet edge to edge. Grid
   *  points near a rounded edge are projected onto a quarter circle (the clamp-to-inner-box construction:
   *  p' = q + r (p - q) / |p - q|, q = p clamped to the box shrunk by r on the rounded sides), which gives smooth
   *  normals and a round corner where three rounded sides meet; flat faces follow the same profile at their border,
   *  so nothing cracks open. Then the displacement field moves every vertex (normals and tangents re-derived by
   *  finite differences). UVs come from the flat face, so textures do not stretch round the edges. The flat box is
   *  what gets recorded: the drawn surface only loses material inside it (plus the displacement), and the collider
   *  (made separately) never changes. */
  addRoundedBox(center, size, o = {}) {
    const hpr = o.hpr ?? [0, 0, 0];
    const R = hprMatrix(hpr[0], hpr[1], hpr[2]);
    const h = [size[0] / 2, size[1] / 2, size[2] / 2];
    const uvScale = o.uvScale ?? 1;
    const round = new Set(o.round ?? FACE_NAMES);
    const skip = new Set(o.skipFaces ?? []);
    const segs = Math.max(1, Math.min(4, Math.round(o.segments ?? 2)));
    let r = Math.max(0, o.radius ?? 0);
    for (let k = 0; k < 3; k++) {
      const lo2 = round.has(FACE_NAMES[k * 2 + 1]), hi2 = round.has(FACE_NAMES[k * 2]);
      if (lo2 || hi2) r = Math.min(r, h[k] * (lo2 && hi2 ? 0.9 : 1.8));
    }
    const rLo = [0, 1, 2].map((k) => r > 0 && round.has(FACE_NAMES[k * 2 + 1]) ? r : 0);
    const rHi = [0, 1, 2].map((k) => r > 0 && round.has(FACE_NAMES[k * 2]) ? r : 0);
    const band = [];
    for (let k = 0; k < segs; k++) band.push(1 - Math.tan(Math.PI / 4 * k / segs));
    const cuts = [0, 1, 2].map((k) => {
      const c = [-h[k], h[k]];
      if (rLo[k] > 0) for (const f of band) c.push(-h[k] + f * rLo[k]);
      if (rHi[k] > 0) for (const f of band) c.push(h[k] - f * rHi[k]);
      const step = o.step ?? 0;
      const inner0 = -h[k] + rLo[k], inner1 = h[k] - rHi[k];
      if (step > 0 && inner1 - inner0 > step) {
        const n = Math.ceil((inner1 - inner0) / step);
        for (let i = 1; i < n; i++) c.push(inner0 + (inner1 - inner0) * i / n);
      }
      for (const x of o.cuts?.[k] ?? []) if (x > -h[k] + 1e-4 && x < h[k] - 1e-4) c.push(x);
      c.sort((a, b) => a - b);
      const out = [];
      for (const x of c) if (!out.length || x - out[out.length - 1] > 1e-5) out.push(x);
      return out;
    });
    const tok = this.beginShape();
    this.recordBox(center, h, R);
    const lo = [0, 1, 2].map((k) => -h[k] + rLo[k]), hi = [0, 1, 2].map((k) => h[k] - rHi[k]);
    const D8 = o.displace ?? null;
    const eps = 0.02;
    const place = (p, faceN, faceT, rounded) => {
      let lp = p, ln = faceN, lt = faceT;
      if (r > 0) {
        const q = [Math.min(hi[0], Math.max(lo[0], p[0])), Math.min(hi[1], Math.max(lo[1], p[1])), Math.min(hi[2], Math.max(lo[2], p[2]))];
        const d = [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
        const len = Math.hypot(d[0], d[1], d[2]);
        if (len > 1e-9) {
          const dn = [d[0] / len, d[1] / len, d[2] / len];
          lp = [q[0] + dn[0] * r, q[1] + dn[1] * r, q[2] + dn[2] * r];
          if (rounded) {
            ln = dn;
            const td = dot(faceT, ln);
            lt = norm([faceT[0] - ln[0] * td, faceT[1] - ln[1] * td, faceT[2] - ln[2] * td]);
            if (!Number.isFinite(lt[0]) || Math.hypot(lt[0], lt[1], lt[2]) < 0.5) lt = norm(cross(ln, faceN));
          }
        }
      }
      const rw = rot(lp, R);
      let w = [rw[0] + center[0], rw[1] + center[1], rw[2] + center[2]];
      let n = rot(ln, R), t = rot(lt, R);
      if (D8) {
        const b = cross(n, t);
        const d0 = D8(w);
        const dtp = D8([w[0] + t[0] * eps, w[1] + t[1] * eps, w[2] + t[2] * eps]), dtm = D8([w[0] - t[0] * eps, w[1] - t[1] * eps, w[2] - t[2] * eps]);
        const dbp = D8([w[0] + b[0] * eps, w[1] + b[1] * eps, w[2] + b[2] * eps]), dbm = D8([w[0] - b[0] * eps, w[1] - b[1] * eps, w[2] - b[2] * eps]);
        const Pt = [t[0] + (dtp[0] - dtm[0]) / (2 * eps), t[1] + (dtp[1] - dtm[1]) / (2 * eps), t[2] + (dtp[2] - dtm[2]) / (2 * eps)];
        const Pb = [b[0] + (dbp[0] - dbm[0]) / (2 * eps), b[1] + (dbp[1] - dbm[1]) / (2 * eps), b[2] + (dbp[2] - dbm[2]) / (2 * eps)];
        let nn = norm(cross(Pt, Pb));
        if (dot(nn, n) < 0) nn = [-nn[0], -nn[1], -nn[2]];
        n = nn;
        t = norm(Pt);
        w = [w[0] + d0[0], w[1] + d0[1], w[2] + d0[2]];
      }
      return { w, n, t };
    };
    BOX_FACES.forEach(([n, t, b], fi) => {
      if (skip.has(FACE_NAMES[fi])) return;
      const an = n.findIndex((x) => x !== 0), at = t.findIndex((x) => x !== 0), ab = b.findIndex((x) => x !== 0);
      const sn = n[an], st = t[at], sb = b[ab];
      const us = cuts[at].map((x) => x * st).sort((a, c) => a - c);
      const vs = cuts[ab].map((x) => x * sb).sort((a, c) => a - c);
      const rounded = r > 0 && round.has(FACE_NAMES[fi]);
      const tw = rot(t, R), bw = rot(b, R);
      const base = this.vertexCount;
      const i0 = this.indices.length;
      const ht = h[at], hb = h[ab];
      for (const v of vs) for (const u of us) {
        const p = [0, 0, 0];
        p[an] = sn * h[an];
        p[at] = u * st;
        p[ab] = v * sb;
        const flatW = rot(p, R);
        const fw = [flatW[0] + center[0], flatW[1] + center[1], flatW[2] + center[2]];
        let uu, vv;
        if (o.uvMode === "fit") {
          const ru = Math.max(Math.round(2 * ht / uvScale), 1), rv = Math.max(Math.round(2 * hb / uvScale), 1);
          uu = (u / ht * 0.5 + 0.5) * ru;
          vv = (v / hb * 0.5 + 0.5) * rv;
        } else {
          uu = dot(fw, tw) / uvScale;
          vv = dot(fw, bw) / uvScale;
        }
        const pl = place(p, n, t, rounded);
        const bt = cross(pl.n, pl.t);
        this.vertex(pl.w, pl.n, pl.t, bt, uu, vv);
      }
      const nu = us.length;
      const V = this.verts, F2 = FLOATS_PER_VERTEX;
      const tri2 = (a, bb, c) => {
        const ax = V[bb * F2] - V[a * F2], ay = V[bb * F2 + 1] - V[a * F2 + 1], az = V[bb * F2 + 2] - V[a * F2 + 2];
        const bx = V[c * F2] - V[a * F2], by = V[c * F2 + 1] - V[a * F2 + 1], bz = V[c * F2 + 2] - V[a * F2 + 2];
        const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
        if (cx * cx + cy * cy + cz * cz > 1e-14) this.indices.push(a, bb, c);
      };
      for (let j = 0; j < vs.length - 1; j++) for (let i = 0; i < nu - 1; i++) {
        const a = base + j * nu + i, bb = a + 1, c = a + nu + 1, d = a + nu;
        tri2(a, bb, c);
        tri2(a, c, d);
      }
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([su, sv]) => {
        const p = [0, 0, 0];
        p[an] = sn * h[an];
        p[at] = su * st * ht;
        p[ab] = sv * sb * hb;
        const w = rot(p, R);
        return [w[0] + center[0], w[1] + center[1], w[2] + center[2]];
      });
      this.recordFace(rot(n, R), corners, i0);
    });
    this.endShape(tok);
  }
  /** Box with 45-degree bevelled edges and corners (26 faces). */
  addChamferBox(center, size, bevel = 0.01, hpr = [0, 0, 0], uvScale = 1, uvSpace = "local") {
    const h = [size[0] / 2, size[1] / 2, size[2] / 2];
    const b = Math.min(bevel, h[0] * 0.49, h[1] * 0.49, h[2] * 0.49);
    const R = hprMatrix(hpr[0], hpr[1], hpr[2]);
    const tok = this.beginShape();
    this.recordBox(center, h, R);
    const verts = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      const s = [sx, sy, sz];
      for (let axis = 0; axis < 3; axis++) {
        const p = [s[0] * (h[0] - b), s[1] * (h[1] - b), s[2] * (h[2] - b)];
        p[axis] = s[axis] * h[axis];
        verts.push({ s, axis, p });
      }
    }
    for (const nx of [-1, 0, 1]) for (const ny of [-1, 0, 1]) for (const nz of [-1, 0, 1]) {
      const n = [nx, ny, nz];
      if (!nx && !ny && !nz) continue;
      const nzAxes = [0, 1, 2].filter((a) => n[a] !== 0);
      const uniq = [];
      for (const v of verts) {
        if (!nzAxes.includes(v.axis)) continue;
        if (nzAxes.some((a) => v.s[a] !== n[a])) continue;
        if (!uniq.some((q) => Math.abs(q[0] - v.p[0]) < 1e-8 && Math.abs(q[1] - v.p[1]) < 1e-8 && Math.abs(q[2] - v.p[2]) < 1e-8)) uniq.push(v.p);
      }
      const nn = norm(n);
      const up = Math.abs(nn[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
      const t = norm(cross(up, nn));
      const bt = cross(nn, t);
      const cen = [0, 0, 0];
      for (const p of uniq) {
        cen[0] += p[0] / uniq.length;
        cen[1] += p[1] / uniq.length;
        cen[2] += p[2] / uniq.length;
      }
      const ordered = uniq.map((p) => ({ p, a: Math.atan2(
        dot([p[0] - cen[0], p[1] - cen[1], p[2] - cen[2]], bt),
        dot([p[0] - cen[0], p[1] - cen[1], p[2] - cen[2]], t)
      ) })).sort((x, y) => x.a - y.a).map((x) => x.p);
      const tw = rot(t, R), bw = rot(bt, R), nw = rot(nn, R);
      const base = this.vertexCount;
      const i0 = this.indices.length;
      const poly = [];
      for (const local3 of ordered) {
        const r = rot(local3, R);
        const world = [r[0] + center[0], r[1] + center[1], r[2] + center[2]];
        poly.push(world);
        const src = uvSpace === "world" ? world : local3;
        const u = dot(src, uvSpace === "world" ? tw : t) / uvScale;
        const v = dot(src, uvSpace === "world" ? bw : bt) / uvScale;
        this.vertex(world, nw, tw, bw, u, v);
      }
      for (let i = 1; i < ordered.length - 1; i++) this.indices.push(base, base + i, base + i + 1);
      this.recordFace(nw, poly, i0);
    }
    this.endShape(tok);
  }
  /** Convex planar polygon (counter-clockwise seen from the normal side), world UVs. */
  addPolygon(points, normal, tangent, binormal, uvScale = 1) {
    const tok = this.beginShape();
    const base = this.vertexCount;
    const i0 = this.indices.length;
    for (const p of points) this.vertex(p, normal, tangent, binormal, dot(p, tangent) / uvScale, dot(p, binormal) / uvScale);
    for (let i = 1; i < points.length - 1; i++) this.indices.push(base, base + i, base + i + 1);
    this.recordFace(normal, points.map((p) => [p[0], p[1], p[2]]), i0);
    this.endShape(tok);
  }
  /** Solid ramp: bottom-front-centre at base, rising height over length along local +Y. */
  addWedge(base, width, length, height, heading = 0, uvScale = 1) {
    const R = hprMatrix(heading, 0, 0);
    const tok = this.beginShape();
    const w2 = width / 2, L = length, H = height;
    const xf = (p) => {
      const r = rot(p, R);
      return [r[0] + base[0], r[1] + base[1], r[2] + base[2]];
    };
    const d = (v) => norm(rot(v, R));
    const slopeN = d([0, -H, L]);
    const slopeB = d([0, L, H]);
    this.addPolygon([xf([-w2, 0, 0]), xf([w2, 0, 0]), xf([w2, L, H]), xf([-w2, L, H])], slopeN, d([1, 0, 0]), slopeB, uvScale);
    this.addPolygon([xf([w2, L, 0]), xf([-w2, L, 0]), xf([-w2, L, H]), xf([w2, L, H])], d([0, 1, 0]), d([-1, 0, 0]), d([0, 0, 1]), uvScale);
    this.addPolygon([xf([w2, 0, 0]), xf([-w2, 0, 0]), xf([-w2, L, 0]), xf([w2, L, 0])], d([0, 0, -1]), d([-1, 0, 0]), d([0, 1, 0]), uvScale);
    this.addPolygon([xf([w2, 0, 0]), xf([w2, L, 0]), xf([w2, L, H])], d([1, 0, 0]), d([0, 1, 0]), d([0, 0, 1]), uvScale);
    this.addPolygon([xf([-w2, L, 0]), xf([-w2, 0, 0]), xf([-w2, L, H])], d([-1, 0, 0]), d([0, -1, 0]), d([0, 0, 1]), uvScale);
    this.endShape(tok);
  }
  /** Vertical cylinder; center is the middle of the axis. */
  addCylinder(center, radius, height, segments = 24, uvScale = 1, caps = true, hpr = [0, 0, 0]) {
    const R = hprMatrix(hpr[0], hpr[1], hpr[2]);
    const tok = this.beginShape();
    this.thin = radius < 0.03 && height > radius * 8 ? radius * 2 : 0;
    const xf = (p) => {
      const r = rot(p, R);
      return [r[0] + center[0], r[1] + center[1], r[2] + center[2]];
    };
    const circ = 2 * Math.PI * radius;
    const rep = Math.max(Math.round(circ / uvScale), 1);
    const base = this.vertexCount;
    for (const [z, vv] of [[-height / 2, 0], [height / 2, height / uvScale]]) {
      for (let i = 0; i <= segments; i++) {
        const a = 2 * Math.PI * i / segments;
        const c = Math.cos(a), s = Math.sin(a);
        this.vertex(
          xf([c * radius, s * radius, z]),
          rot([c, s, 0], R),
          rot([-s, c, 0], R),
          rot([0, 0, 1], R),
          a / (2 * Math.PI) * rep,
          vv
        );
      }
    }
    const sN = segments + 1;
    for (let i = 0; i < segments; i++) this.indices.push(base + i, base + i + 1, base + sN + i + 1, base + i, base + sN + i + 1, base + sN + i);
    if (caps) {
      for (const top of [false, true]) {
        const z = top ? height / 2 : -height / 2;
        const nz = top ? 1 : -1;
        const cb = this.vertexCount;
        const ci0 = this.indices.length;
        const nW = rot([0, 0, nz], R), tW = rot([nz, 0, 0], R), bW = rot([0, 1, 0], R);
        this.vertex(xf([0, 0, z]), nW, tW, bW, 0, 0);
        for (let i = 0; i < segments; i++) {
          const a = 2 * Math.PI * i / segments;
          const x = Math.cos(a) * radius, y = Math.sin(a) * radius;
          this.vertex(xf([x, y, z]), nW, tW, bW, x * nz / uvScale, y / uvScale);
        }
        for (let i = 0; i < segments; i++) {
          const j = (i + 1) % segments;
          if (top) this.indices.push(cb, cb + 1 + i, cb + 1 + j);
          else this.indices.push(cb, cb + 1 + j, cb + 1 + i);
        }
        if (_MeshBuilder.recorder) {
          const poly = [];
          for (let i = 0; i < segments; i++) {
            const a = 2 * Math.PI * i / segments;
            poly.push(xf([Math.cos(a) * radius, Math.sin(a) * radius, z]));
          }
          this.recordFace(nW, top ? poly : poly.reverse(), ci0);
        }
      }
    }
    this.thin = 0;
    this.endShape(tok);
  }
  addSphere(center, radius, rings = 24, segments = 48, uvScale = 1) {
    const tok = this.beginShape();
    const base = this.vertexCount;
    const ru = Math.max(Math.round(2 * Math.PI * radius / uvScale), 1);
    const rv = Math.max(Math.round(Math.PI * radius / uvScale), 1);
    for (let r = 0; r <= rings; r++) {
      const th = Math.PI * r / rings;
      for (let k = 0; k <= segments; k++) {
        const ph = 2 * Math.PI * k / segments;
        const n = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
        const t = [-Math.sin(ph), Math.cos(ph), 0];
        this.vertex(
          [n[0] * radius + center[0], n[1] * radius + center[1], n[2] * radius + center[2]],
          n,
          t,
          cross(n, t),
          ph / (2 * Math.PI) * ru,
          (1 - th / Math.PI) * rv
        );
      }
    }
    const s = segments + 1;
    for (let r = 0; r < rings; r++) for (let k = 0; k < segments; k++) {
      const a = base + r * s + k, b = a + 1, c = a + s + 1, d = a + s;
      this.indices.push(a, d, c, a, c, b);
    }
    this.endShape(tok);
  }
  /** An irregular clump (foliage, a rubble heap): an icosphere subdivided `detail` times whose vertices are pushed
   *  in and out by a seeded lumpy field, squashed by `scale`. Normals stay close to radial (soft, leafy shading);
   *  UVs are planar from the side. Not recorded as a planar shape (it has no flat faces to fight). */
  addBlob(center, radius, scale = [1, 1, 1], seed = 1, detail = 1, lumpiness = 0.28, uvScale = 1, faceted = false, hpr = [0, 0, 0]) {
    const t = (1 + Math.sqrt(5)) / 2;
    let verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((v) => norm(v));
    let faces = [
      [0, 11, 5],
      [0, 5, 1],
      [0, 1, 7],
      [0, 7, 10],
      [0, 10, 11],
      [1, 5, 9],
      [5, 11, 4],
      [11, 10, 2],
      [10, 7, 6],
      [7, 1, 8],
      [3, 9, 4],
      [3, 4, 2],
      [3, 2, 6],
      [3, 6, 8],
      [3, 8, 9],
      [4, 9, 5],
      [2, 4, 11],
      [6, 2, 10],
      [8, 6, 7],
      [9, 8, 1]
    ];
    for (let d = 0; d < detail; d++) {
      const mid = /* @__PURE__ */ new Map();
      const m = (a, b) => {
        const k = a < b ? `${a},${b}` : `${b},${a}`;
        let i = mid.get(k);
        if (i === void 0) {
          i = verts.length;
          verts.push(norm([(verts[a][0] + verts[b][0]) / 2, (verts[a][1] + verts[b][1]) / 2, (verts[a][2] + verts[b][2]) / 2]));
          mid.set(k, i);
        }
        return i;
      };
      const nf = [];
      for (const [a, b, c] of faces) {
        const ab = m(a, b), bc = m(b, c), ca = m(c, a);
        nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
      }
      faces = nf;
    }
    const bumps = [];
    let s = seed * 2654435761 >>> 0;
    const rnd = () => {
      s = s * 1664525 + 1013904223 >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < 9; i++) bumps.push([norm([rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1]), rnd() * 2 - 1]);
    const field2 = (v) => {
      let f = 0;
      for (const [d, a] of bumps) f += a * Math.max(0, dot(v, d)) ** 3;
      return f;
    };
    verts = verts.map((v) => {
      const k = 1 + lumpiness * field2(v) + (rnd() - 0.5) * lumpiness * 0.35;
      return [v[0] * k, v[1] * k, v[2] * k];
    });
    const R = hprMatrix(hpr[0], hpr[1], hpr[2]);
    const tok = this.beginShape();
    const world = verts.map((v) => {
      const r = rot([v[0] * radius * scale[0], v[1] * radius * scale[1], v[2] * radius * scale[2]], R);
      return [center[0] + r[0], center[1] + r[1], center[2] + r[2]];
    });
    const frame = (n) => {
      const tt = norm(Math.abs(n[2]) < 0.95 ? cross([0, 0, 1], n) : cross([1, 0, 0], n));
      return [tt, cross(n, tt)];
    };
    if (faceted) {
      for (const [a, b, c] of faces) {
        const pa = world[a], pb = world[b], pc = world[c];
        const n = norm(cross([pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]]));
        const [tt, bt] = frame(n);
        const base = this.vertexCount;
        for (const p of [pa, pb, pc]) this.vertex(p, n, tt, bt, dot(p, tt) / uvScale, dot(p, bt) / uvScale);
        this.indices.push(base, base + 1, base + 2);
      }
    } else {
      const base = this.vertexCount;
      verts.forEach((v, i) => {
        const p = world[i];
        const n = norm(rot([v[0] / scale[0], v[1] / scale[1], v[2] / scale[2]], R));
        const [tt, bt] = frame(n);
        this.vertex(p, n, tt, bt, (p[0] + p[1]) / uvScale, p[2] / uvScale);
      });
      for (const [a, b, c] of faces) this.indices.push(base + a, base + b, base + c);
    }
    this.endShape(tok);
  }
  /** Upper hemisphere (a dome) standing on its rim at ``center``; ``squash`` scales its height
   * (1 = round, < 1 a shallow vault, > 1 an onion-ish profile). Open at the bottom. */
  addDome(center, radius, squash = 1, rings = 12, segments = 32, uvScale = 1) {
    const tok = this.beginShape();
    const base = this.vertexCount;
    const ru = Math.max(Math.round(2 * Math.PI * radius / uvScale), 1);
    const rv = Math.max(Math.round(Math.PI * radius * 0.5 / uvScale), 1);
    for (let r = 0; r <= rings; r++) {
      const th = Math.PI / 2 * r / rings;
      for (let k = 0; k <= segments; k++) {
        const ph = 2 * Math.PI * k / segments;
        const p = [Math.sin(th) * Math.cos(ph) * radius, Math.sin(th) * Math.sin(ph) * radius, Math.cos(th) * radius * squash];
        const n = norm([Math.sin(th) * Math.cos(ph) * squash, Math.sin(th) * Math.sin(ph) * squash, Math.cos(th)]);
        const t = [-Math.sin(ph), Math.cos(ph), 0];
        this.vertex(
          [p[0] + center[0], p[1] + center[1], p[2] + center[2]],
          n,
          t,
          cross(n, t),
          ph / (2 * Math.PI) * ru,
          (1 - th / (Math.PI / 2)) * rv
        );
      }
    }
    const s = segments + 1;
    for (let r = 0; r < rings; r++) for (let k = 0; k < segments; k++) {
      const a = base + r * s + k, b = a + 1, c = a + s + 1, d = a + s;
      this.indices.push(a, d, c, a, c, b);
    }
    this.endShape(tok);
  }
  /** Transform every vertex by a row-vector 4x4 matrix (positions; frames re-normalised). */
  transformed(m) {
    const out = new _MeshBuilder();
    out.indices = this.indices.slice();
    const v = this.verts;
    for (let i = 0; i < v.length; i += FLOATS_PER_VERTEX) {
      const p = [
        v[i] * m[0] + v[i + 1] * m[4] + v[i + 2] * m[8] + m[12],
        v[i] * m[1] + v[i + 1] * m[5] + v[i + 2] * m[9] + m[13],
        v[i] * m[2] + v[i + 1] * m[6] + v[i + 2] * m[10] + m[14]
      ];
      out.verts.push(p[0], p[1], p[2]);
      for (const a of [3, 6, 9]) {
        const d = [
          v[i + a] * m[0] + v[i + a + 1] * m[4] + v[i + a + 2] * m[8],
          v[i + a] * m[1] + v[i + a + 1] * m[5] + v[i + a + 2] * m[9],
          v[i + a] * m[2] + v[i + a + 1] * m[6] + v[i + a + 2] * m[10]
        ];
        const n = norm(d);
        out.verts.push(n[0], n[1], n[2]);
      }
      for (let k = 12; k < FLOATS_PER_VERTEX; k++) out.verts.push(v[i + k]);
    }
    return out;
  }
  merge(other) {
    this.add(other.verts, other.indices);
  }
};

// shared/src/level/organic.ts
function hash3(x, y, z, seed) {
  let h = x * 374761393 + y * 668265263 + z * 2147483647 + seed * 144665 | 0;
  h = Math.imul(h ^ h >>> 13, 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function noise3(x, y, z, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);
  const v = (dx, dy, dz) => hash3(ix + dx, iy + dy, iz + dz, seed);
  const x00 = v(0, 0, 0) + (v(1, 0, 0) - v(0, 0, 0)) * fx, x10 = v(0, 1, 0) + (v(1, 1, 0) - v(0, 1, 0)) * fx;
  const x01 = v(0, 0, 1) + (v(1, 0, 1) - v(0, 0, 1)) * fx, x11 = v(0, 1, 1) + (v(1, 1, 1) - v(0, 1, 1)) * fx;
  const y0 = x00 + (x10 - x00) * fy, y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}

// shared/src/level/organic_wall.ts
function organicWall(s) {
  const L = s.length, t = s.thickness, ht = t / 2;
  const r = Math.max(0, Math.min(s.radius, ht * 0.9, 0.5));
  const R = hprMatrix(s.heading, 0, 0);
  const zTop = Math.max(...s.rects.map((q) => q[3]));
  const band = r > 0 ? [r, r * (1 - Math.tan(Math.PI / 8))] : [];
  const uniq = (c, lo, hi) => {
    const out = [];
    for (const x of c.filter((v) => v >= lo - 1e-9 && v <= hi + 1e-9).sort((a, b) => a - b)) if (!out.length || x - out[out.length - 1] > 2e-4) out.push(x);
    return out;
  };
  const baseU = [0, L], baseZ = [0, zTop];
  for (const [u0, u1, z0, z1] of s.rects) {
    baseU.push(u0, u1);
    baseZ.push(z0, z1);
  }
  let us = uniq(baseU, 0, L), zs = uniq(baseZ, 0, zTop);
  let nu = 0, nz = 0;
  let solid = new Uint8Array(0);
  const build = () => {
    nu = us.length - 1;
    nz = zs.length - 1;
    solid = new Uint8Array(nu * nz);
    for (let i = 0; i < nu; i++) for (let j = 0; j < nz; j++) {
      const uc = (us[i] + us[i + 1]) / 2, zc = (zs[j] + zs[j + 1]) / 2;
      solid[i * nz + j] = s.rects.some(([u0, u1, z0, z1]) => uc > u0 && uc < u1 && zc > z0 && zc < z1) ? 1 : 0;
    }
  };
  build();
  const at = (i, j) => i >= 0 && j >= 0 && i < nu && j < nz ? solid[i * nz + j] : -1;
  const exposedSide = (i, j, di, dj) => {
    const nb = at(i + di, j + dj);
    if (nb === 0) return true;
    if (nb === 1) return false;
    if (dj === -1) return false;
    if (dj === 1) return s.exposed.top;
    return di === -1 ? s.exposed.start : s.exposed.end;
  };
  const uC = [...us], zC = [...zs];
  for (let i = 0; i < nu; i++) for (let j = 0; j < nz; j++) {
    if (!at(i, j)) continue;
    for (const d of band) {
      if (exposedSide(i, j, -1, 0)) uC.push(us[i] + d);
      if (exposedSide(i, j, 1, 0)) uC.push(us[i + 1] - d);
      if (exposedSide(i, j, 0, -1)) zC.push(zs[j] + d);
      if (exposedSide(i, j, 0, 1)) zC.push(zs[j + 1] - d);
    }
  }
  const stepCuts = (lo, hi, c) => {
    const n = Math.ceil((hi - lo) / s.step);
    for (let i = 1; i < n; i++) c.push(lo + (hi - lo) * i / n);
  };
  if (s.step > 0) {
    stepCuts(0, L, uC);
    stepCuts(0, zTop, zC);
  }
  us = uniq(uC, 0, L);
  zs = uniq(zC, 0, zTop);
  build();
  const ws = uniq([-ht, ht, ...band.flatMap((d) => [-ht + d, ht - d])], -ht, ht);
  const segs = [];
  const push = (a, b, n) => {
    const last = segs[segs.length - 1];
    if (last && last.n[0] === n[0] && last.n[1] === n[1] && Math.abs(last.b[0] - a[0]) < 1e-9 && Math.abs(last.b[1] - a[1]) < 1e-9) last.b = b;
    else segs.push({ a, b, n });
  };
  for (const [di, dj] of [[-1, 0], [1, 0]]) for (let i = 0; i < nu; i++) for (let j = 0; j < nz; j++) {
    if (!at(i, j) || !exposedSide(i, j, di, dj)) continue;
    const u = di < 0 ? us[i] : us[i + 1];
    push([u, zs[j]], [u, zs[j + 1]], [-di, 0]);
  }
  for (const [di, dj] of [[0, -1], [0, 1]]) for (let j = 0; j < nz; j++) for (let i = 0; i < nu; i++) {
    if (!at(i, j) || !exposedSide(i, j, di, dj)) continue;
    const z = dj < 0 ? zs[j] : zs[j + 1];
    push([us[i], z], [us[i + 1], z], [0, -dj]);
  }
  const roundLocal = (u, w, z) => {
    if (r <= 0) return { p: [u, w, z], n: null };
    let best = Infinity, bu = 0, bz = 0, tnx = 0, tnz = 0;
    for (const sg of segs) {
      const ax = sg.a[0], az = sg.a[1], bx = sg.b[0], bzz = sg.b[1];
      const dx2 = bx - ax, dz2 = bzz - az, l2 = dx2 * dx2 + dz2 * dz2;
      const k = l2 > 0 ? Math.max(0, Math.min(1, ((u - ax) * dx2 + (z - az) * dz2) / l2)) : 0;
      const px = ax + dx2 * k, pz = az + dz2 * k;
      const d = Math.hypot(u - px, z - pz);
      if (d < best - 1e-7) {
        best = d;
        bu = px;
        bz = pz;
        tnx = sg.n[0];
        tnz = sg.n[1];
      } else if (Math.abs(d - best) <= 1e-7) {
        tnx += sg.n[0];
        tnz += sg.n[1];
      }
    }
    let qu = u, qz = z;
    if (best < r) {
      let gx, gz;
      if (best > 1e-7) {
        gx = (u - bu) / best;
        gz = (z - bz) / best;
      } else {
        const l = Math.hypot(tnx, tnz) || 1;
        gx = tnx / l;
        gz = tnz / l;
      }
      qu = u + gx * (r - best);
      qz = z + gz * (r - best);
    }
    const qw = Math.max(-ht + r, Math.min(ht - r, w));
    const dx = u - qu, dw = w - qw, dz = z - qz;
    const len = Math.hypot(dx, dw, dz);
    if (len < 1e-9) return { p: [u, w, z], n: null };
    return { p: [qu + dx / len * r, qw + dw / len * r, qz + dz / len * r], n: [dx / len, dw / len, dz / len] };
  };
  const toWorld = (l) => [
    s.origin[0] + l[0] * R[0][0] + l[1] * R[1][0] + l[2] * R[2][0],
    s.origin[1] + l[0] * R[0][1] + l[1] * R[1][1] + l[2] * R[2][1],
    s.origin[2] + l[0] * R[0][2] + l[1] * R[1][2] + l[2] * R[2][2]
  ];
  const dirW = (l) => [l[0] * R[0][0] + l[1] * R[1][0] + l[2] * R[2][0], l[0] * R[0][1] + l[1] * R[1][1] + l[2] * R[2][1], l[0] * R[0][2] + l[1] * R[1][2] + l[2] * R[2][2]];
  const wAxis = dirW([0, 1, 0]);
  const crown = s.crown ?? 0, taper = s.taper ?? 0;
  const D8 = (p) => {
    const d = s.displace ? s.displace(p) : [0, 0, 0];
    const zl = p[2] - s.origin[2];
    if (taper > 0 && zTop > 0) {
      const wl = (p[0] - s.origin[0]) * wAxis[0] + (p[1] - s.origin[1]) * wAxis[1];
      const k = -Math.sign(wl) * taper * Math.min(1, Math.max(0, zl / zTop)) * Math.min(1, Math.abs(wl) / Math.max(ht, 1e-3));
      d[0] += wAxis[0] * k;
      d[1] += wAxis[1] * k;
    }
    if (crown > 0 && s.exposed.top && zl > zTop - 0.2) {
      const f = Math.min(1, (zl - (zTop - 0.2)) / 0.2);
      d[2] -= crown * f * noise3(p[0] * 1.3, p[1] * 1.3, 5.5, 23);
    }
    return d;
  };
  const eps = 0.02;
  const rec = MeshBuilder.recorder;
  const prevGroup = MeshBuilder.group;
  if (rec) MeshBuilder.group = rec.shapes.length;
  const tok1 = s.mat.beginShape();
  const tok2 = s.mat2 === s.mat ? -2 : s.mat2.beginShape();
  for (const [u0, u1, z0, z1] of s.rects) {
    const c = toWorld([(u0 + u1) / 2, 0, (z0 + z1) / 2]);
    s.mat.recordBox(c, [(u1 - u0) / 2, ht, (z1 - z0) / 2], R);
  }
  const face = (axisN, sn, fix, axisA, aCuts, axisB, bCuts) => {
    const mb = axisN === 1 && sn < 0 ? s.mat2 : s.mat;
    const uvScale = mb === s.mat2 && mb !== s.mat ? s.uvScale2 : s.uvScale;
    const nL = [0, 0, 0];
    nL[axisN] = sn;
    const aL = [0, 0, 0];
    aL[axisA] = 1;
    const bL = [0, 0, 0];
    bL[axisB] = 1;
    const cr = [aL[1] * bL[2] - aL[2] * bL[1], aL[2] * bL[0] - aL[0] * bL[2], aL[0] * bL[1] - aL[1] * bL[0]];
    const flip = cr[0] * nL[0] + cr[1] * nL[1] + cr[2] * nL[2] < 0;
    const tw = dirW(aL), bw = dirW(bL), nw = dirW(nL);
    const base = mb.vertexCount, i0 = mb.indices.length;
    for (const bv of bCuts) for (const av of aCuts) {
      const l = [0, 0, 0];
      l[axisN] = fix;
      l[axisA] = av;
      l[axisB] = bv;
      const flatW = toWorld(l);
      const rl = roundLocal(l[0], l[1], l[2]);
      const pw = toWorld(rl.p);
      let n = rl.n ? dirW(rl.n) : nw;
      let tt = tw;
      if (rl.n) {
        const td = tt[0] * n[0] + tt[1] * n[1] + tt[2] * n[2];
        let x = [tt[0] - n[0] * td, tt[1] - n[1] * td, tt[2] - n[2] * td];
        let xl = Math.hypot(x[0], x[1], x[2]);
        if (xl < 0.3) {
          x = [bw[1] * n[2] - bw[2] * n[1], bw[2] * n[0] - bw[0] * n[2], bw[0] * n[1] - bw[1] * n[0]];
          xl = Math.hypot(x[0], x[1], x[2]) || 1;
        }
        tt = [x[0] / xl, x[1] / xl, x[2] / xl];
      }
      let b = [n[1] * tt[2] - n[2] * tt[1], n[2] * tt[0] - n[0] * tt[2], n[0] * tt[1] - n[1] * tt[0]];
      const d0 = D8(pw);
      const dtp = D8([pw[0] + tt[0] * eps, pw[1] + tt[1] * eps, pw[2] + tt[2] * eps]), dtm = D8([pw[0] - tt[0] * eps, pw[1] - tt[1] * eps, pw[2] - tt[2] * eps]);
      const dbp = D8([pw[0] + b[0] * eps, pw[1] + b[1] * eps, pw[2] + b[2] * eps]), dbm = D8([pw[0] - b[0] * eps, pw[1] - b[1] * eps, pw[2] - b[2] * eps]);
      const Pt = [tt[0] + (dtp[0] - dtm[0]) / (2 * eps), tt[1] + (dtp[1] - dtm[1]) / (2 * eps), tt[2] + (dtp[2] - dtm[2]) / (2 * eps)];
      const Pb = [b[0] + (dbp[0] - dbm[0]) / (2 * eps), b[1] + (dbp[1] - dbm[1]) / (2 * eps), b[2] + (dbp[2] - dbm[2]) / (2 * eps)];
      let nn = [Pt[1] * Pb[2] - Pt[2] * Pb[1], Pt[2] * Pb[0] - Pt[0] * Pb[2], Pt[0] * Pb[1] - Pt[1] * Pb[0]];
      const nl = Math.hypot(nn[0], nn[1], nn[2]) || 1;
      nn = [nn[0] / nl, nn[1] / nl, nn[2] / nl];
      if (nn[0] * n[0] + nn[1] * n[1] + nn[2] * n[2] < 0) nn = [-nn[0], -nn[1], -nn[2]];
      n = nn;
      const ptl = Math.hypot(Pt[0], Pt[1], Pt[2]) || 1;
      tt = [Pt[0] / ptl, Pt[1] / ptl, Pt[2] / ptl];
      b = [n[1] * tt[2] - n[2] * tt[1], n[2] * tt[0] - n[0] * tt[2], n[0] * tt[1] - n[1] * tt[0]];
      const uu = (flatW[0] * tw[0] + flatW[1] * tw[1] + flatW[2] * tw[2]) / uvScale, vv = (flatW[0] * bw[0] + flatW[1] * bw[1] + flatW[2] * bw[2]) / uvScale;
      mb.vertex([pw[0] + d0[0], pw[1] + d0[1], pw[2] + d0[2]], n, tt, b, flip ? -uu : uu, vv);
    }
    const na = aCuts.length;
    const V = mb.verts, F2 = FLOATS_PER_VERTEX;
    const tri2 = (a, bb, c) => {
      const ax = V[bb * F2] - V[a * F2], ay = V[bb * F2 + 1] - V[a * F2 + 1], az = V[bb * F2 + 2] - V[a * F2 + 2];
      const bx = V[c * F2] - V[a * F2], by = V[c * F2 + 1] - V[a * F2 + 1], bz = V[c * F2 + 2] - V[a * F2 + 2];
      const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
      if (cx * cx + cy * cy + cz * cz <= 1e-14) return;
      if (flip) mb.indices.push(a, c, bb);
      else mb.indices.push(a, bb, c);
    };
    for (let j = 0; j < bCuts.length - 1; j++) for (let i = 0; i < na - 1; i++) {
      const a = base + j * na + i, bb = a + 1, c = a + na + 1, d = a + na;
      tri2(a, bb, c);
      tri2(a, c, d);
    }
    const corner = (ia, ib) => {
      const l = [0, 0, 0];
      l[axisN] = fix;
      l[axisA] = aCuts[ia];
      l[axisB] = bCuts[ib];
      return toWorld(l);
    };
    const la = aCuts.length - 1, lb = bCuts.length - 1;
    const poly = flip ? [corner(0, 0), corner(0, lb), corner(la, lb), corner(la, 0)] : [corner(0, 0), corner(la, 0), corner(la, lb), corner(0, lb)];
    mb.recordFace(nw, poly, i0);
  };
  for (let i = 0; i < nu; i++) for (let j = 0; j < nz; j++) {
    if (!at(i, j)) continue;
    const ua = [us[i], us[i + 1]], za = [zs[j], zs[j + 1]];
    face(1, 1, ht, 0, ua, 2, za);
    face(1, -1, -ht, 0, ua, 2, za);
    if (at(i - 1, j) !== 1) face(0, -1, us[i], 1, ws, 2, za);
    if (at(i + 1, j) !== 1) face(0, 1, us[i + 1], 1, ws, 2, za);
    if (at(i, j - 1) !== 1) face(2, -1, zs[j], 0, ua, 1, ws);
    if (at(i, j + 1) !== 1) face(2, 1, zs[j + 1], 0, ua, 1, ws);
  }
  s.mat.endShape(tok1);
  if (tok2 !== -2) s.mat2.endShape(tok2);
  MeshBuilder.group = prevGroup;
}

// shared/src/level/vehicle_collision.ts
var military = {
  solid: [
    [0, 1.92, 1.55, 2.34, 2.92, 3.1],
    // closed cab
    [0, -1.83, 0.87, 1.04, 4.44, 1.1],
    // chassis below the raised bed
    [0, -1.83, 1.43, 2.43, 4.44, 0.16],
    // bed floor: walkable, open above
    [-1.19, -1.83, 1.84, 0.12, 4.44, 0.7],
    [1.19, -1.83, 1.84, 0.12, 4.44, 0.7],
    [0, -4.05, 1.82, 2.4, 0.12, 0.68],
    // tailgate
    [0, 0.34, 2.07, 2.32, 0.12, 1.1]
    // cab-side bulkhead
  ],
  shade: [
    [0, 1.92, 1.55, 2.34, 2.92, 3.1],
    [0, -1.83, 1.43, 2.43, 4.44, 0.16],
    [-1.19, -1.83, 1.84, 0.12, 4.44, 0.7],
    [1.19, -1.83, 1.84, 0.12, 4.44, 0.7],
    [0, -4.05, 1.82, 2.4, 0.12, 0.68],
    [0, 0.34, 2.07, 2.32, 0.12, 1.1]
  ]
};
var commercial = {
  solid: [
    [0, 2.05, 1.53, 2.18, 2.45, 2.74],
    // cab; stops at the actual bumper
    [0, -1.65, 0.69, 1.55, 5.5, 1.02],
    // frame
    [0, -1.65, 1.18, 2.32, 5.5, 0.16],
    // cargo floor
    [-1.15, -1.65, 2.42, 0.1, 5.5, 2.48],
    [1.15, -1.65, 2.42, 0.1, 5.5, 2.48],
    [0, -1.65, 3.65, 2.34, 5.5, 0.1],
    [0, 1.08, 2.42, 2.3, 0.1, 2.48],
    [-0.57, -4.43, 2.42, 1.14, 0.1, 2.44]
    // closed left rear door; right stays open
  ],
  shade: [
    [0, 2.05, 1.53, 2.18, 2.45, 2.74],
    [0, -1.65, 1.18, 2.32, 5.5, 0.16],
    [-1.15, -1.65, 2.42, 0.1, 5.5, 2.48],
    [1.15, -1.65, 2.42, 0.1, 5.5, 2.48],
    [0, -1.65, 3.65, 2.34, 5.5, 0.1],
    [0, 1.08, 2.42, 2.3, 0.1, 2.48],
    [-0.57, -4.43, 2.42, 1.14, 0.1, 2.44]
  ]
};
var red = {
  solid: [
    [0, 3.02, 1.64, 2.38, 2.84, 3.28],
    [0, -1.95, 0.79, 1.25, 7.2, 1.18],
    [0, -1.95, 1.4, 2.38, 7.2, 0.14],
    [-1.17, -1.95, 2.39, 0.1, 7.2, 2.1],
    [1.17, -1.95, 2.39, 0.1, 7.2, 2.1],
    [0, 1.62, 1.85, 2.31, 0.09, 0.9],
    [0, -5.55, 1.87, 2.34, 0.09, 0.94]
  ],
  shade: [
    [0, 3.02, 1.64, 2.38, 2.84, 3.28],
    [0, -1.95, 1.4, 2.38, 7.2, 0.14],
    [-1.17, -1.95, 2.39, 0.1, 7.2, 2.1],
    [1.17, -1.95, 2.39, 0.1, 7.2, 2.1],
    [0, 1.62, 1.85, 2.31, 0.09, 0.9],
    [0, -5.55, 1.87, 2.34, 0.09, 0.94]
  ]
};
var suv = {
  solid: [[0, 0, 1.1, 1.85, 4.9, 2.2]],
  shade: [[0, 0, 1.1, 1.78, 4.76, 2.2]]
};
var compact = { solid: [[0, 0, 0.51, 1.65, 4.06, 0.78], [0, -0.28, 1.14, 1.47, 2.6, 0.54]], shade: [[0, 0, 0.51, 1.65, 4.06, 0.78], [0, -0.28, 1.14, 1.47, 2.6, 0.54]] };
function integratedVehicleCollision(ctx, e2) {
  if (e2.wreck) return false;
  const kind = e2.kind ?? "truck";
  const shell = kind === "truck" ? military : kind === "lorry" && e2.visual === "red_lorry" ? red : kind === "lorry" && (e2.body ?? "box") === "box" ? commercial : kind === "boxcar" && e2.visual === "family_suv" ? suv : kind === "boxcar" && ["teal_estate", "red_hatch"].includes(e2.visual) ? compact : null;
  if (!shell) return false;
  const hd = e2.heading ?? 0, a = hd * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), base = e2.base;
  const put = (b, occlude, yaw = 0) => {
    const [x, y, z, w, l, h] = b, p = [base[0] + x * c - y * s, base[1] + x * s + y * c, base[2] + z];
    const [world, rot3] = ctx.xf(p, [hd + yaw, 0, 0]);
    if (occlude) ctx.occluder(world, [w, l, h], rot3);
    else ctx.collider(world, [w, l, h], rot3, "metal");
  };
  shell.solid.forEach((b) => put(b, false));
  shell.shade.forEach((b) => put(b, true));
  if (shell === commercial) {
    const swung = [
      1.13 - 0.55 * Math.cos(110 * Math.PI / 180),
      -4.43 - 0.55 * Math.sin(110 * Math.PI / 180),
      2.43,
      1.1,
      0.065,
      2.36
    ];
    put(swung, false, 110);
    put(swung, true, 110);
  }
  return true;
}

// shared/src/level/prefabs.ts
var PREFABS = {};
var D3 = Math.PI / 180;
function rot2d(x, y, heading) {
  const a = heading * D3;
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
}
function local(origin2, heading, lx, ly, lz) {
  const [wx, wy] = rot2d(lx, ly, heading);
  return [origin2[0] + wx, origin2[1] + wy, origin2[2] + lz];
}
var g = (e2, k, d) => e2[k] === void 0 ? d : e2[k];
PREFABS.box = (ctx, e2) => {
  const size = e2.size;
  let pos;
  if (e2.base) pos = [e2.base[0], e2.base[1], e2.base[2] + size[2] / 2];
  else pos = e2.pos;
  const hpr = e2.hpr ?? [g(e2, "heading", 0), 0, 0];
  ctx.box(pos, size, g(e2, "mat", "concrete_wall"), {
    hpr,
    uv: g(e2, "uv", "world"),
    collide: g(e2, "collide", true),
    occlude: g(e2, "occlude", true),
    skipFaces: e2.skip_faces ?? [],
    surface: e2.surface
  });
};
PREFABS.floor = (ctx, e2) => {
  const [[x0, y0], [x1, y1]] = [e2.min, e2.max];
  const t = g(e2, "thickness", 0.3);
  const z = g(e2, "z", 0);
  ctx.box(
    [(x0 + x1) / 2, (y0 + y1) / 2, z - t / 2],
    [x1 - x0, y1 - y0, t],
    g(e2, "mat", "concrete_floor"),
    { collide: g(e2, "collide", true), occlude: g(e2, "occlude", true) }
  );
};
function wallStyle(surface) {
  if (surface === "plaster" || surface === "dirt") return { radius: 0.075, crown: 0.025, taper: 8e-3 };
  if (surface === "brick") return { radius: 0.05, crown: 0.012, taper: 4e-3 };
  if (surface === "concrete") return { radius: 0.025, crown: 0, taper: 0 };
  return null;
}
function wall(ctx, e0) {
  let p0 = e0.p0, p1 = e0.p1;
  const h = g(e0, "height", 3);
  const t = g(e0, "thickness", 0.25);
  const z0 = g(e0, "z", 0);
  let dx = p1[0] - p0[0], dy = p1[1] - p0[1];
  let length = Math.hypot(dx, dy);
  const heading = Math.atan2(dy, dx) / D3;
  let shift = 0;
  if (e0.extend) {
    const ux0 = dx / length, uy0 = dy / length;
    p0 = [p0[0] - ux0 * t / 2, p0[1] - uy0 * t / 2];
    p1 = [p1[0] + ux0 * t / 2, p1[1] + uy0 * t / 2];
    dx = p1[0] - p0[0];
    dy = p1[1] - p0[1];
    length += t;
    shift = t / 2;
  }
  const openings = (e0.openings ?? []).map((op) => ({ ...op, at: op.at + shift }));
  const e2 = { ...e0, openings };
  const mat = g(e2, "mat", "concrete_wall");
  const mat2 = g(e2, "mat2", mat);
  let rects = [[0, length, 0, h]];
  for (const op of openings) {
    const c = op.at, w = op.width;
    const ob = g(op, "bottom", 0), ot = g(op, "top", Math.min(2.2, h));
    const s0 = c - w / 2, s1 = c + w / 2;
    const next = [];
    for (const [a, b, zb, zt] of rects) {
      if (s1 <= a || s0 >= b || ot <= zb || ob >= zt) {
        next.push([a, b, zb, zt]);
        continue;
      }
      if (s0 > a) next.push([a, s0, zb, zt]);
      if (s1 < b) next.push([s1, b, zb, zt]);
      const loA = Math.max(a, s0), loB = Math.min(b, s1);
      if (ob > zb) next.push([loA, loB, zb, ob]);
      if (ot < zt) next.push([loA, loB, ot, zt]);
    }
    rects = next;
  }
  const ux = dx / length, uy = dy / length;
  const plain = () => {
    for (const [a, b, zb, zt] of rects) {
      if (b - a < 1e-3 || zt - zb < 1e-3) continue;
      const mid = (a + b) / 2;
      const center = [p0[0] + ux * mid, p0[1] + uy * mid, z0 + (zb + zt) / 2];
      const size = [b - a, t, zt - zb];
      const hpr = [heading, 0, 0];
      if (e2.soft) {
        ctx.panel(center, size, mat, mat2, {
          hpr,
          reinforce: g(e2, "reinforce", false),
          breach: g(e2, "breach", false),
          name: g(e2, "name", ""),
          surface: e2.surface
        });
      } else if (mat2 !== mat) {
        ctx.box(center, size, mat, { hpr, collide: true, occlude: true, skipFaces: ["-y"] });
        ctx.box(center, size, mat2, { hpr, collide: false, occlude: false, skipFaces: ["+x", "-x", "+y", "+z", "-z"] });
      } else {
        ctx.box(center, size, mat, { hpr, collide: true, occlude: true });
      }
    }
  };
  const style = !e2.soft && ctx.geometry ? wallStyle(ctx.surface(mat2)) : null;
  if (!style) plain();
  else {
    const [o, hpr] = ctx.xf([p0[0], p0[1], z0], [heading, 0, 0]);
    const mid = ctx.xf([p0[0] + ux * length / 2, p0[1] + uy * length / 2, z0])[0];
    ctx.withVariant("lo", mid, plain);
    const solid = rects.filter(([a, b, zb, zt]) => b - a >= 1e-3 && zt - zb >= 1e-3);
    if (solid.length) ctx.withVariant("hi", mid, () => organicWall({
      origin: o,
      heading: hpr[0],
      length,
      thickness: t,
      rects: solid,
      mat: ctx.builder(mat),
      mat2: ctx.builder(mat2),
      uvScale: ctx.uvScale(mat),
      uvScale2: ctx.uvScale(mat2),
      exposed: { top: g(e0, "top_exposed", !e0.roofed), start: !!(e0.ends ?? [])[0], end: !!(e0.ends ?? [])[1] },
      radius: style.radius,
      step: 0.6,
      displace: ctx.organic(mat2),
      crown: style.crown,
      taper: style.taper
    }));
  }
  const frame = e2.frame_mat;
  if (frame) {
    for (const op of openings) {
      const c = op.at, w = op.width;
      const ob = g(op, "bottom", 0), ot = g(op, "top", Math.min(2.2, h));
      for (const side of [-1, 1]) {
        const s = c + side * (w / 2 - 0.04);
        const lean = (Math.abs(Math.floor(s * 97 + z0 * 13 + p0[0] * 7)) % 11 - 5) / 5 * 0.4;
        ctx.box(
          [p0[0] + ux * s, p0[1] + uy * s, z0 + (ob + ot) / 2],
          [0.08, t + 0.04, ot - ob],
          frame,
          { hpr: [heading, 0, lean], collide: false, occlude: false }
        );
      }
      const cx = p0[0] + ux * c, cy = p0[1] + uy * c;
      ctx.box([cx, cy, z0 + ot - 0.04], [Math.max(w - 0.16, 0.01), t + 0.04, 0.08], frame, { hpr: [heading, 0, 0], collide: false, occlude: false });
      if (ob > 0.05) {
        ctx.rbox([cx, cy, z0 + ob + 0.03], [w + 0.1, t + 0.12, 0.06], frame, {
          hpr: [heading, 0, 0],
          collide: false,
          occlude: false,
          round: ["+z", "+y", "-y", "+x", "-x"],
          radius: 0.02,
          step: 0,
          displace: false
        });
      }
    }
  }
}
PREFABS.wall = wall;
PREFABS.stairs = (ctx, e2) => {
  const base = e2.base;
  const heading = g(e2, "heading", 0);
  const steps = Math.trunc(e2.steps);
  const rise = e2.rise / steps;
  const run = g(e2, "run", 0.28);
  const width = g(e2, "width", 1.4);
  const mat = g(e2, "mat", "concrete_floor");
  const solid = g(e2, "solid", true);
  for (let i = 0; i < steps; i++) {
    const top = rise * (i + 1);
    const [hgt, zc] = solid ? [top, top / 2] : [0.12, top - 0.06];
    ctx.box(local(base, heading, 0, run * (i + 0.5), zc), [width, run, hgt], mat, { hpr: [heading, 0, 0], collide: true, occlude: true });
  }
  if (e2.rails) {
    const railMat = g(e2, "rail_mat", "steel");
    const total = run * steps;
    for (const side of [-1, 1]) {
      for (let k = 0; k <= steps; k += Math.max(Math.floor(steps / 3), 1)) {
        ctx.box(
          local(base, heading, side * (width / 2 - 0.03), run * k, rise * k + 0.5),
          [0.05, 0.05, 1],
          railMat,
          { hpr: [heading, 0, 0], collide: false, occlude: false }
        );
      }
      const ang = Math.atan2(rise * steps, total) / D3;
      ctx.box(
        local(base, heading, side * (width / 2 - 0.03), total / 2, rise * steps / 2 + 1),
        [0.06, Math.hypot(total, rise * steps), 0.06],
        railMat,
        { hpr: [heading, ang, 0], collide: false, occlude: false }
      );
    }
  }
};
PREFABS.ramp = (ctx, e2) => {
  const base = e2.base;
  const heading = g(e2, "heading", 0);
  const length = e2.length, height = e2.height, width = g(e2, "width", 2);
  const t = 0.3;
  const a = Math.atan2(height, length);
  const mat = g(e2, "mat", "concrete_floor");
  ctx.wedge(base, width, length, height, heading, mat);
  const center = local(base, heading, 0, length / 2 + Math.sin(a) * t / 2, height / 2 - Math.cos(a) * t / 2);
  ctx.collider(center, [width, Math.hypot(length, height), t], [heading, a / D3, 0], ctx.surface(mat));
  const steps = 8;
  for (let i = 1; i < steps; i++) {
    const y0 = length * i / steps;
    const hh = height * i / steps - t / Math.cos(a) - 0.02;
    if (hh <= 0.05) continue;
    ctx.collider(local(base, heading, 0, y0 + length / steps / 2, hh / 2), [width, length / steps, hh], [heading, 0, 0], ctx.surface(mat));
  }
  ctx.occluder(local(base, heading, 0, length * 0.6, height * 0.3), [width, length * 0.6, height * 0.6], [heading, 0, 0]);
};
function crate(ctx, e2) {
  const base = e2.base;
  const s = g(e2, "size", 1);
  const size = e2.dims ?? [s, s, s];
  const heading = g(e2, "heading", 0);
  const mat = g(e2, "mat", "plywood");
  const frame = g(e2, "frame_mat", "wood_planks");
  const c = [base[0], base[1], base[2] + size[2] / 2];
  ctx.box(c, size, mat, { hpr: [heading, 0, 0], uv: "fit", collide: true, occlude: true });
  if (!ctx.geometry) return;
  const b = 0.07;
  const hx = size[0] / 2, hy = size[1] / 2, hz = size[2] / 2;
  const nc = { hpr: [heading, 0, 0], collide: false, occlude: false };
  const b2 = b - 8e-3, b3 = b - 0.016;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    ctx.box(local(c, heading, sx * (hx - b / 2 + 0.01), sy * (hy - b / 2 + 0.01), 0), [b, b, size[2] + 0.02], frame, nc);
  }
  for (const sz of [-1, 1]) {
    for (const sy of [-1, 1]) ctx.box(local(c, heading, 0, sy * (hy - b / 2 + 0.01), sz * (hz - b / 2 + 0.01)), [size[0] - 4e-3, b2, b2], frame, nc);
    for (const sx of [-1, 1]) ctx.box(local(c, heading, sx * (hx - b / 2 + 0.01), 0, sz * (hz - b / 2 + 0.01)), [b3, size[1] - 8e-3, b3], frame, nc);
  }
}
PREFABS.crate = crate;
PREFABS.crate_stack = (ctx, e2) => {
  const base = e2.base;
  const s = g(e2, "size", 1);
  const rng = new Random(g(e2, "seed", 1));
  for (const [ix, iy, iz] of e2.layout ?? [[0, 0, 0], [1, 0, 0], [0, 0, 1]]) {
    const jitter = rng.uniform(-4, 4);
    crate(ctx, {
      base: [base[0] + ix * (s + 0.04), base[1] + iy * (s + 0.04), base[2] + iz * s],
      size: s,
      heading: g(e2, "heading", 0) + jitter,
      mat: g(e2, "mat", "plywood"),
      frame_mat: g(e2, "frame_mat", "wood_planks")
    });
  }
};
PREFABS.container = (ctx, e2) => {
  const base = e2.base;
  const hd = g(e2, "heading", 0);
  const L = g(e2, "length", 6.06);
  const W = 2.44, H = 2.59;
  const t = 0.08;
  const mat = g(e2, "mat", "container_red");
  const steel = g(e2, "frame_mat", "metal_olive");
  const part = (lx, ly, lz, size, m, collide = true, uv = "world") => ctx.box(local(base, hd, lx, ly, lz), size, m, { hpr: [hd, 0, 0], collide, occlude: true, uv });
  part(-W / 2 + t / 2, 0, H / 2, [t, L, H], mat);
  part(W / 2 - t / 2, 0, H / 2, [t, L, H], mat);
  part(0, 0, H - t / 2, [W, L, t], mat);
  part(0, 0, 0.1, [W, L, 0.2], g(e2, "floor_mat", "wood_planks"));
  part(0, -L / 2 + t / 2, H / 2, [W, t, H], mat);
  if (!g(e2, "open", false)) part(0, L / 2 - t / 2, H / 2, [W, t, H], mat);
  else {
    for (const side of [-1, 1]) {
      ctx.box(
        local(base, hd, side * (W / 2 + 0.06), L / 2 + W / 4, H / 2),
        [0.06, W / 2, H - 0.1],
        mat,
        { hpr: [hd, 0, 0], collide: true, occlude: true }
      );
    }
  }
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) part(sx * (W / 2 - 0.08), sy * (L / 2 - 0.08), H / 2, [0.17, 0.17, H + 0.01], steel, false);
    part(sx * (W / 2 - 0.05), 0, H - 0.08, [0.12, L, 0.16], steel, false);
    part(sx * (W / 2 - 0.05), 0, 0.08, [0.12, L, 0.16], steel, false);
  }
};
PREFABS.sandbags = (ctx, e2) => {
  const p0 = e2.p0, p1 = e2.p1;
  const layers = Math.trunc(g(e2, "layers", 5));
  const z0 = g(e2, "z", 0);
  const rng = new Random(g(e2, "seed", 3));
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
  const length = Math.hypot(dx, dy);
  const heading = Math.atan2(dy, dx) / D3;
  const bagL = 0.58, bagW = 0.34, bagH = 0.15;
  const depth = g(e2, "depth", 2);
  if (ctx.geometry) {
    for (let layer = 0; layer < layers; layer++) {
      const n = Math.max(Math.trunc(length / bagL), 1);
      const off = layer % 2 * bagL / 2;
      const dcount = layer < layers - 1 ? depth : Math.max(depth - 1, 1);
      for (let d = 0; d < dcount; d++) {
        for (let i = 0; i < n; i++) {
          const s = off + bagL * (i + 0.5);
          if (s > length - bagL * 0.25) continue;
          const lat = (d - (depth - 1) / 2) * bagW;
          const cx = p0[0] + dx / length * s - dy / length * lat;
          const cy = p0[1] + dy / length * s + dx / length * lat;
          const cz = z0 + layer * bagH * 0.92 + bagH / 2;
          const jh = heading + rng.uniform(-5, 5);
          const sz = [bagL * rng.uniform(0.94, 1.02), bagW * rng.uniform(0.92, 1), bagH * rng.uniform(0.9, 1.05)];
          ctx.box([cx, cy, cz], sz, g(e2, "mat", "sandbag"), {
            hpr: [jh, rng.uniform(-3, 3), rng.uniform(-3, 3)],
            collide: false,
            occlude: false
          });
        }
      }
    }
  }
  const totalH = layers * bagH * 0.92 + bagH * 0.08;
  const mid = [p0[0] + dx / 2, p0[1] + dy / 2, z0 + totalH / 2];
  ctx.collider(mid, [length, bagW * depth, totalH], [heading, 0, 0], "fabric");
  ctx.occluder(mid, [length, bagW * depth, totalH], [heading, 0, 0]);
};
PREFABS.barrel = (ctx, e2) => {
  const base = e2.base;
  const r = 0.29, h = 0.88;
  const mat = g(e2, "mat", "metal_olive");
  const c = [base[0], base[1], base[2] + h / 2];
  ctx.cylinder(c, r, h, mat, 20);
  for (const z of [0.28, 0.6]) ctx.cylinder([base[0], base[1], base[2] + z], r + 0.012, 0.035, mat, 20, false);
  ctx.collider(c, [r * 2, r * 2, h], [0, 0, 0], "metal");
};
PREFABS.pillar = (ctx, e2) => {
  const base = e2.base;
  const h = g(e2, "height", 3);
  if (e2.round) {
    const r = g(e2, "radius", 0.25);
    const c = [base[0], base[1], base[2] + h / 2];
    ctx.cylinder(c, r, h, g(e2, "mat", "concrete_wall"), 24);
    ctx.collider(c, [r * 2, r * 2, h], [0, 0, 0], "concrete");
    ctx.occluder(c, [r * 2, r * 2, h]);
  } else {
    const s = g(e2, "size", 0.4);
    ctx.box([base[0], base[1], base[2] + h / 2], [s, s, h], g(e2, "mat", "concrete_wall"));
  }
};
function railing(ctx, e2) {
  const p0 = e2.p0, p1 = e2.p1;
  const z = g(e2, "z", 0);
  const h = g(e2, "height", 1.05);
  const mat = g(e2, "mat", "steel");
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
  const length = Math.hypot(dx, dy);
  const heading = Math.atan2(dy, dx) / D3;
  const n = Math.max(Math.trunc(length / 1.5), 1);
  const nc = { hpr: [heading, 0, 0], collide: false, occlude: false };
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    ctx.box([p0[0] + dx * s, p0[1] + dy * s, z + h / 2], [0.05, 0.05, h], mat, nc);
  }
  for (const zz of [h, h * 0.5]) ctx.box([p0[0] + dx / 2, p0[1] + dy / 2, z + zz], [length, 0.042, 0.042], mat, nc);
  ctx.collider([p0[0] + dx / 2, p0[1] + dy / 2, z + h / 2], [length, 0.08, h], [heading, 0, 0], "metal");
}
PREFABS.railing = railing;
PREFABS.catwalk = (ctx, e2) => {
  const p0 = e2.p0, p1 = e2.p1;
  const z = e2.z;
  const w = g(e2, "width", 1.6);
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
  const length = Math.hypot(dx, dy);
  const heading = Math.atan2(dy, dx) / D3;
  const nx = -dy / length, ny = dx / length;
  ctx.box([p0[0] + dx / 2, p0[1] + dy / 2, z - 0.06], [length, w, 0.12], g(e2, "mat", "diamond_plate"), { hpr: [heading, 0, 0] });
  const legMat = g(e2, "leg_mat", "steel");
  const n = Math.max(Math.trunc(length / 3), 1);
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    for (const side of [-1, 1]) {
      const x = p0[0] + dx * s + nx * side * (w / 2 - 0.08);
      const y = p0[1] + dy * s + ny * side * (w / 2 - 0.08);
      if (g(e2, "legs", true)) ctx.box([x, y, z / 2 - 0.06], [0.12, 0.12, z - 0.12], legMat, { collide: true, occlude: false });
    }
  }
  if (g(e2, "rails", true)) {
    for (const side of g(e2, "rail_sides", [-1, 1])) {
      const q0 = [p0[0] + nx * side * (w / 2 - 0.03), p0[1] + ny * side * (w / 2 - 0.03)];
      const q1 = [p1[0] + nx * side * (w / 2 - 0.03), p1[1] + ny * side * (w / 2 - 0.03)];
      railing(ctx, { p0: q0, p1: q1, z, mat: legMat });
    }
  }
};
PREFABS.pbr_gallery = (ctx, e2) => {
  const base = e2.base;
  const heading = g(e2, "heading", 0);
  const mats = e2.mats ?? [];
  const spacing = g(e2, "spacing", 1.6);
  mats.forEach((m, i) => {
    const x = (i - (mats.length - 1) / 2) * spacing;
    const p = local(base, heading, x, 0, 0);
    ctx.box([p[0], p[1], p[2] + 0.45], [0.6, 0.6, 0.9], g(e2, "pedestal_mat", "concrete_dark"));
    ctx.sphere([p[0], p[1], p[2] + 0.9 + 0.42], 0.42, m);
    ctx.collider([p[0], p[1], p[2] + 1.32], [0.84, 0.84, 0.84]);
  });
};
PREFABS.light = (ctx, e2) => ctx.light(e2);
PREFABS.spawn = (ctx, e2) => {
  const [pos, hpr] = ctx.xf(e2.pos, [g(e2, "heading", 0), 0, 0]);
  ctx.spawns.push({ team: g(e2, "team", "attack"), pos, heading: hpr[0] });
};
PREFABS.weapon_display = (ctx, e2) => ctx.prop("weapon_model", e2);
PREFABS.dummy = (ctx, e2) => ctx.prop("dummy", e2);
PREFABS.pickup = (ctx, e2) => ctx.prop("pickup", e2);
PREFABS.sign = (ctx, e2) => ctx.prop("sign", e2);
PREFABS.group = (ctx, e2) => {
  ctx.pushTransform(g(e2, "offset", [0, 0, 0]), g(e2, "heading", 0));
  for (const child of e2.pieces ?? []) ctx.buildPiece(child);
  ctx.popTransform();
};
function line(p0, p1) {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
  return [dx, dy, Math.hypot(dx, dy), Math.atan2(dy, dx) / D3];
}
function along(p0, dx, dy, length, s, lateral = 0) {
  const ux = dx / length, uy = dy / length;
  return [p0[0] + ux * s - uy * lateral, p0[1] + uy * s + ux * lateral];
}
function slab(ctx, x0, y0, x1, y1, zTop, thickness, topMat, bottomMat, sideMat, collide = true) {
  const c = [(x0 + x1) / 2, (y0 + y1) / 2, zTop - thickness / 2];
  const size = [x1 - x0, y1 - y0, thickness];
  const bm = bottomMat || topMat;
  const sm = sideMat || topMat;
  if (topMat === bm && bm === sm) {
    ctx.rbox(c, size, topMat, { collide, occlude: true, round: ["+z", "+x", "-x", "+y", "-y"], radius: 0.025, step: 0, displace: false });
    return;
  }
  ctx.box(c, size, topMat, { skipFaces: ["-z", "+x", "-x", "+y", "-y"], collide, occlude: true });
  ctx.box(c, size, bm, { skipFaces: ["+z", "+x", "-x", "+y", "-y"], collide: false, occlude: false });
  ctx.box(c, size, sm, { skipFaces: ["+z", "-z"], collide: false, occlude: false });
}
function subtractSpans(lo, hi, gaps) {
  let spans2 = [[lo, hi]];
  for (const [g0, g1] of gaps) {
    const out = [];
    for (const [a, b] of spans2) {
      if (g1 <= a || g0 >= b) {
        out.push([a, b]);
        continue;
      }
      if (g0 > a) out.push([a, g0]);
      if (g1 < b) out.push([g1, b]);
    }
    spans2 = out;
  }
  return spans2.filter(([a, b]) => b - a > 1e-3);
}
function subtractRects(rect, holes) {
  let rects = [rect];
  for (const [hx0, hy0, hx1, hy1] of holes) {
    const out = [];
    for (const [x0, y0, x1, y1] of rects) {
      if (hx1 <= x0 || hx0 >= x1 || hy1 <= y0 || hy0 >= y1) {
        out.push([x0, y0, x1, y1]);
        continue;
      }
      if (hy0 > y0) out.push([x0, y0, x1, hy0]);
      if (hy1 < y1) out.push([x0, hy1, x1, y1]);
      const my0 = Math.max(y0, hy0), my1 = Math.min(y1, hy1);
      if (hx0 > x0) out.push([x0, my0, hx0, my1]);
      if (hx1 < x1) out.push([hx1, my0, x1, my1]);
    }
    rects = out;
  }
  return rects.filter((r) => r[2] - r[0] > 1e-3 && r[3] - r[1] > 1e-3);
}
function roofTop(e2) {
  return g(e2, "roof_thickness", 0.3);
}
PREFABS.building = (ctx, e2) => {
  const [[x0, y0], [x1, y1]] = [e2.min, e2.max];
  const z = g(e2, "z", 0);
  const h = g(e2, "height", 3.2);
  const t = g(e2, "wall", 0.3);
  const roofT = g(e2, "roof_thickness", 0.3);
  const ext = g(e2, "mat", "plaster_tan");
  const inn = g(e2, "mat_in", "plaster");
  const ops = g(e2, "openings", {});
  const frame = e2.frame_mat ?? null;
  const conv = (side, start, sign) => (ops[side] ?? []).map((op) => ({ ...op, at: (op[side === "s" || side === "n" ? "x" : "y"] - start) * sign }));
  const openSides = g(e2, "open_sides", []);
  const ys = openSides.includes("s") ? y0 : y0 + t;
  const yn = openSides.includes("n") ? y1 : y1 - t;
  const sides = [
    ["s", [x0, y0 + t / 2], [x1, y0 + t / 2], conv("s", x0, 1)],
    ["e", [x1 - t / 2, ys], [x1 - t / 2, yn], conv("e", ys, 1)],
    ["n", [x1, y1 - t / 2], [x0, y1 - t / 2], conv("n", x1, -1)],
    ["w", [x0 + t / 2, yn], [x0 + t / 2, ys], conv("w", yn, -1)]
  ];
  const soft = g(e2, "soft", {});
  for (const [side, p0, p1, openings] of sides) {
    if (openSides.includes(side)) continue;
    const w = {
      p0,
      p1,
      height: h,
      thickness: t,
      z,
      mat: inn,
      mat2: ext,
      openings,
      frame_mat: frame,
      roofed: g(e2, "roof", true),
      ends: side === "s" || side === "n" ? [true, true] : [false, false]
    };
    if (soft[side]) {
      Object.assign(w, {
        soft: true,
        reinforce: g(soft[side], "reinforce", false),
        breach: g(soft[side], "breach", false),
        name: g(soft[side], "name", side),
        surface: g(soft[side], "surface", ctx.surface(ext))
      });
    }
    wall(ctx, w);
  }
  if (g(e2, "floor_mat", "concrete_floor")) {
    ctx.box(
      [(x0 + x1) / 2, (y0 + y1) / 2, z - 0.03],
      [x1 - x0 - 2 * t + 0.02, y1 - y0 - 2 * t + 0.02, 0.1],
      g(e2, "floor_mat", "concrete_floor"),
      { collide: true, occlude: false }
    );
  }
  if (ctx.geometry && !e2.parapet && ext !== "mud_wall" && ["plaster", "concrete", "brick"].includes(ctx.surface(ext))) {
    const r = new Random(Math.trunc(Math.abs(x0 * 17 + y0 * 29)) + 5);
    const mid = ctx.xf([(x0 + x1) / 2, (y0 + y1) / 2, z])[0];
    ctx.withVariant("hi", mid, () => {
      const units = 1 + Math.floor(r.random() * 2);
      for (let k = 0; k < units; k++) {
        const side = r.choice(["s", "n", "e", "w"]);
        if (openSides.includes(side)) continue;
        const alongX = side === "s" || side === "n";
        const sign = side === "s" || side === "w" ? -1 : 1;
        const span = alongX ? [x0 + 1, x1 - 1] : [y0 + 1, y1 - 1];
        if (span[1] <= span[0]) continue;
        const a = span[0] + r.random() * (span[1] - span[0]);
        const out = 0.2;
        const c = alongX ? [a, (sign < 0 ? y0 : y1) + sign * out, z + h * 0.72] : [(sign < 0 ? x0 : x1) + sign * out, a, z + h * 0.72];
        const hd = alongX ? 0 : 90;
        ctx.box(c, alongX ? [0.8, 0.36, 0.55] : [0.36, 0.8, 0.55], "steel_painted", { collide: false, occlude: false });
        const f = alongX ? [c[0], c[1] + sign * 0.185, c[2]] : [c[0] + sign * 0.185, c[1], c[2]];
        ctx.cylinder(f, 0.2, 0.012, "steel", 16, true, alongX ? [0, 90, 0] : [0, 0, 90]);
        const cz = (c[2] + 0.28 + z + h + roofTop(e2)) / 2;
        ctx.box(
          alongX ? [a + 0.3, (sign < 0 ? y0 : y1) + sign * 0.02, cz] : [(sign < 0 ? x0 : x1) + sign * 0.02, a + 0.3, cz],
          [0.018, 0.018, z + h + roofTop(e2) - c[2] - 0.28],
          "rubber",
          { hpr: [hd, 0, 0], collide: false, occlude: false }
        );
      }
      if (g(e2, "roof", true)) {
        const tz = z + h + roofTop(e2);
        for (const [cx, cy] of [[x0 + 0.15, y0 + 0.15], [x1 - 0.15, y0 + 0.15], [x0 + 0.15, y1 - 0.15], [x1 - 0.15, y1 - 0.15]]) {
          for (let k = 0; k < 3; k++) ctx.cylinder([cx + (k - 1) * 0.06, cy + (k * 7 % 3 - 1) * 0.05, tz + 0.18], 8e-3, 0.36, "rust_metal", 6, true, [0, r.uniform(-6, 6), r.uniform(-6, 6)]);
        }
      }
    });
  }
  if (g(e2, "roof", true)) {
    const roofMat = g(e2, "roof_mat", "roof_membrane"), ceilMat = g(e2, "ceiling_mat", inn);
    const top = z + h + roofT;
    const holes = [];
    for (const hd of g(e2, "hatches", [])) {
      const [sx, sy] = g(hd, "size", [1.2, 1.2]);
      const hx0 = hd.x - sx / 2, hy0 = hd.y - sy / 2;
      holes.push([hx0, hy0, hx0 + sx, hy0 + sy]);
      ctx.panel(
        [hd.x, hd.y, top - roofT / 2],
        [sx, sy, roofT],
        g(hd, "mat", roofMat),
        ceilMat,
        {
          reinforce: g(hd, "reinforce", true),
          breach: g(hd, "breach", false),
          kind: "floor",
          name: g(hd, "name", "hatch"),
          surface: g(hd, "surface", "wood")
        }
      );
      for (const [cx, cy, rx, ry] of [
        [hd.x, hy0 - 0.04, sx + 0.16, 0.08],
        [hd.x, hy0 + sy + 0.04, sx + 0.16, 0.08],
        [hx0 - 0.04, hd.y, 0.08, sy],
        [hx0 + sx + 0.04, hd.y, 0.08, sy]
      ]) {
        ctx.box([cx, cy, top + 0.03], [rx, ry, 0.06], e2.frame_mat || "steel_painted", { collide: false, occlude: false });
      }
    }
    for (const [rx0, ry0, rx1, ry1] of subtractRects([x0, y0, x1, y1], holes)) {
      slab(ctx, rx0, ry0, rx1, ry1, top, roofT, roofMat, ceilMat, g(e2, "edge_mat", ext));
    }
    const par = g(e2, "parapet", 0);
    if (par > 0) {
      const pt = 0.2;
      const gaps = g(e2, "parapet_gaps", []);
      const defs = [
        ["s", [(x0 + x1) / 2, y0 + pt / 2, x1 - x0, pt]],
        ["n", [(x0 + x1) / 2, y1 - pt / 2, x1 - x0, pt]],
        ["w", [x0 + pt / 2, (y0 + y1) / 2, pt, y1 - y0 - 2 * pt]],
        ["e", [x1 - pt / 2, (y0 + y1) / 2, pt, y1 - y0 - 2 * pt]]
      ];
      for (const [side, [cx, cy, sx, sy]] of defs) {
        const alongX = side === "s" || side === "n";
        const lo = alongX ? cx - sx / 2 : cy - sy / 2;
        const hi = alongX ? cx + sx / 2 : cy + sy / 2;
        for (const [a, b] of subtractSpans(lo, hi, gaps.filter((gp) => gp.side === side).map((gp) => [gp.from, gp.to]))) {
          if (alongX) ctx.rbox([(a + b) / 2, cy, top + par / 2], [b - a, sy, par], ext, { collide: true, occlude: true, round: ["+z", "+y", "-y"], radius: 0.06 });
          else ctx.rbox([cx, (a + b) / 2, top + par / 2], [sx, b - a, par], ext, { collide: true, occlude: true, round: ["+z", "+x", "-x"], radius: 0.06 });
        }
      }
    }
  }
};
PREFABS.twall = (ctx, e2) => {
  const p0 = e2.p0, p1 = e2.p1;
  const z0 = g(e2, "z", 0);
  const h = g(e2, "height", 3.6);
  const mat = g(e2, "mat", "concrete_barrier");
  const [dx, dy, length, heading] = line(p0, p1);
  const seg = g(e2, "segment", 1.5);
  const n = Math.max(pyRound(length / seg), 1);
  const segLen = length / n;
  const rng = new Random(g(e2, "seed", Math.trunc(Math.abs(p0[0] * 7 + p0[1] * 13)) + 1));
  const foot = g(e2, "foot", 1);
  if (ctx.geometry) {
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) * segLen;
      const [cx, cy] = along(p0, dx, dy, length, s);
      const lean = rng.uniform(-0.4, 0.4);
      const hh = h + rng.uniform(-0.03, 0.03);
      ctx.box([cx, cy, z0 + 0.5 + (hh - 0.5) / 2], [segLen - 0.04, 0.26, hh - 0.5], mat, { hpr: [heading, 0, lean], collide: false, occlude: false });
      ctx.box([cx, cy, z0 + 0.22], [segLen - 0.04, foot, 0.44], mat, { hpr: [heading, 0, 0], collide: false, occlude: false });
      ctx.box([cx, cy, z0 + 0.5], [segLen - 0.05, 0.5, 0.16], mat, { hpr: [heading, 0, 0], collide: false, occlude: false });
    }
  }
  const mid = [p0[0] + dx / 2, p0[1] + dy / 2];
  ctx.collider([mid[0], mid[1], z0 + h / 2], [length, 0.32, h], [heading, 0, 0], "concrete");
  ctx.collider([mid[0], mid[1], z0 + 0.22], [length, foot, 0.44], [heading, 0, 0], "concrete");
  ctx.occluder([mid[0], mid[1], z0 + h / 2], [length, 0.3, h], [heading, 0, 0]);
};
PREFABS.jersey = (ctx, e2) => {
  const p0 = e2.p0, p1 = e2.p1;
  const z0 = g(e2, "z", 0);
  const mat = g(e2, "mat", "concrete_barrier");
  const [dx, dy, length, heading] = line(p0, p1);
  const n = Math.max(pyRound(length / 3), 1);
  const segLen = length / n;
  if (ctx.geometry) {
    for (let i = 0; i < n; i++) {
      const [cx, cy] = along(p0, dx, dy, length, (i + 0.5) * segLen);
      const L = segLen - 0.06;
      const nc = { hpr: [heading, 0, 0], collide: false, occlude: false };
      ctx.box([cx, cy, z0 + 0.13], [L, 0.62, 0.26], mat, nc);
      ctx.box([cx, cy, z0 + 0.38], [L, 0.44, 0.24], mat, nc);
      ctx.box([cx, cy, z0 + 0.65], [L, 0.24, 0.3], mat, nc);
    }
  }
  const mid = [p0[0] + dx / 2, p0[1] + dy / 2];
  ctx.collider([mid[0], mid[1], z0 + 0.4], [length, 0.5, 0.8], [heading, 0, 0], "concrete");
  ctx.occluder([mid[0], mid[1], z0 + 0.4], [length, 0.5, 0.8], [heading, 0, 0]);
};
PREFABS.gabion = (ctx, e2) => {
  const p0 = e2.p0, p1 = e2.p1;
  const z0 = g(e2, "z", 0);
  const layers = Math.trunc(g(e2, "layers", 1));
  const fill = g(e2, "mat", "sandbag");
  const wire = g(e2, "wire_mat", "steel");
  const [dx, dy, length, heading] = line(p0, p1);
  const n = Math.max(pyRound(length / 1.05), 1);
  const cell = length / n;
  const H = 1.25;
  if (ctx.geometry) {
    const nc = { hpr: [heading, 0, 0], collide: false, occlude: false };
    for (let layer = 0; layer < layers; layer++) {
      const zc = z0 + layer * H;
      for (let i = 0; i < n; i++) {
        const [cx, cy] = along(p0, dx, dy, length, (i + 0.5) * cell);
        ctx.box([cx, cy, zc + H / 2], [cell - 0.03, 1.02, H - 0.02], fill, nc);
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
          const [px, py] = along([cx, cy], dx, dy, length, sx * (cell / 2 - 0.02), sy * 0.52);
          ctx.box([px, py, zc + H / 2], [0.035, 0.035, H], wire, nc);
        }
        for (const sy of [-1, 1]) {
          const [px, py] = along([cx, cy], dx, dy, length, 0, sy * 0.52);
          for (const zz of [0.02, H - 0.02, H / 2]) ctx.box([px, py, zc + zz], [cell, 0.03, 0.03], wire, nc);
        }
      }
    }
  }
  const mid = [p0[0] + dx / 2, p0[1] + dy / 2];
  ctx.collider([mid[0], mid[1], z0 + layers * H / 2], [length, 1.05, layers * H], [heading, 0, 0], "dirt");
  ctx.occluder([mid[0], mid[1], z0 + layers * H / 2], [length, 1.05, layers * H], [heading, 0, 0]);
};
PREFABS.boom_gate = (ctx, e2) => {
  const base = e2.base;
  const heading = g(e2, "heading", 0);
  const length = g(e2, "length", 4);
  ctx.box(local(base, heading, 0, 0, 0.55), [0.4, 0.4, 1.1], "steel_painted", { hpr: [heading, 0, 0] });
  const nc = { hpr: [heading, 0, 0], collide: false, occlude: false };
  if (g(e2, "raised", false)) {
    ctx.box(local(base, heading, 0, 0, 1.15 + length / 2), [0.12, 0.12, length], "hazard", nc);
  } else {
    ctx.box(local(base, heading, length / 2, 0, 1), [length, 0.12, 0.12], "hazard", nc);
    ctx.box(local(base, heading, length - 0.1, 0, 0.5), [0.1, 0.1, 1], "steel_painted", nc);
  }
};
PREFABS.vehicle = (ctx, e2) => {
  const base = e2.base;
  const hd = g(e2, "heading", 0);
  const paint = g(e2, "mat", "vehicle_od");
  const kind = g(e2, "kind", "truck");
  const part = (lx, ly, lz, size, m, collide = false) => ctx.box(local(base, hd, lx, ly, lz), size, m, { hpr: [hd, 0, 0], collide, occlude: false });
  const wheel = (lx, ly, r, w) => {
    ctx.cylinder(local(base, hd, lx, ly, r), r, w, "rubber", 16, true, [hd, 0, 90]);
    ctx.cylinder(local(base, hd, lx + Math.sign(lx || 1) * (w / 2 + 5e-3), ly, r), r * 0.55, 0.02, "steel", 12, true, [hd, 0, 90]);
  };
  if (kind === "truck") {
    if (ctx.geometry) {
      part(0, 0, 0.95, [1, 7, 0.3], "steel");
      part(0, 2.55, 1.15, [2.2, 1.3, 0.75], paint);
      part(0, 1.35, 1.95, [2.4, 1.6, 1.7], paint);
      part(0, 2.16, 2.25, [2.1, 0.03, 0.62], "glass_dark");
      for (const sx of [-1, 1]) {
        part(sx * 1.205, 1.4, 2.3, [0.02, 1, 0.55], "glass_dark");
        part(sx * 1.35, 2.15, 2.25, [0.2, 0.06, 0.32], "steel");
      }
      part(0, 3.25, 0.85, [2.4, 0.18, 0.3], "steel");
      part(0, -1.7, 1.42, [2.5, 4.7, 0.16], "wood_planks");
      for (const sx of [-1, 1]) part(sx * 1.2, -1.7, 1.85, [0.08, 4.7, 0.7], paint);
      part(0, -1.7, 2.75, [2.46, 4.6, 1.5], g(e2, "cover_mat", "canvas"));
      part(0, -4, 1.85, [2.5, 0.08, 0.7], paint);
      for (const sx of [-1, 1]) part(sx * 0.95, 0.25, 1, [0.5, 1.1, 0.5], "steel");
      for (const [ly, r] of [[2.45, 0.55], [-1.15, 0.55], [-2.55, 0.55]]) for (const sx of [-1, 1]) wheel(sx * 1.05, ly, r, 0.4);
    }
    if (integratedVehicleCollision(ctx, e2)) return;
    ctx.collider(local(base, hd, 0, 1.8, 1.45), [2.4, 3, 2.9], [hd, 0, 0], "metal");
    ctx.collider(local(base, hd, 0, -1.7, 1.8), [2.5, 4.7, 3], [hd, 0, 0], "metal");
    ctx.occluder(local(base, hd, 0, 0, 1.6), [2.4, 7, 3], [hd, 0, 0]);
  } else {
    if (ctx.geometry) {
      part(0, 0, 0.95, [2.1, 4.6, 0.75], paint);
      part(0, 1.55, 1.38, [2, 1.4, 0.14], paint);
      part(0, -0.45, 1.68, [2, 2.4, 0.66], paint);
      part(0, 0.77, 1.68, [1.9, 0.04, 0.5], "glass_dark");
      for (const sx of [-1, 1]) for (const ly of [0.15, -0.95]) part(sx * 1.005, ly, 1.72, [0.02, 0.9, 0.42], "glass_dark");
      part(0, -1.66, 1.68, [1.9, 0.03, 0.42], "glass_dark");
      part(0, 2.33, 0.75, [2.15, 0.15, 0.32], "steel");
      part(0, -2.5, 1.2, [0.9, 0.3, 0.9], "rubber");
      for (const ly of [1.55, -1.45]) for (const sx of [-1, 1]) wheel(sx * 0.98, ly, 0.45, 0.35);
    }
    ctx.collider(local(base, hd, 0, 0, 1), [2.15, 4.7, 2], [hd, 0, 0], "metal");
    ctx.occluder(local(base, hd, 0, 0, 1), [2.1, 4.6, 2], [hd, 0, 0]);
  }
};
PREFABS.canopy = (ctx, e2) => {
  const [[x0, y0], [x1, y1]] = [e2.min, e2.max];
  const h = g(e2, "height", 6);
  const spacing = g(e2, "spacing", 5);
  const col = g(e2, "col_mat", "steel_painted");
  const roof = g(e2, "roof_mat", "corrugated_grey");
  const over = g(e2, "overhang", 0.6);
  const nx = Math.max(pyRound((x1 - x0) / spacing), 1);
  const ny = Math.max(pyRound((y1 - y0) / spacing), 1);
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) {
    if (i > 0 && i < nx && j > 0 && j < ny) continue;
    ctx.box([x0 + (x1 - x0) * i / nx, y0 + (y1 - y0) * j / ny, h / 2], [0.3, 0.3, h], col, { collide: true, occlude: false });
  }
  if (ctx.geometry) {
    for (let i = 0; i <= nx; i++) {
      ctx.box([x0 + (x1 - x0) * i / nx, (y0 + y1) / 2, h - 0.25], [0.25, y1 - y0 + 0.3, 0.5], col, { collide: false, occlude: false });
    }
    for (let j = 0; j <= ny * 2; j++) {
      ctx.box([(x0 + x1) / 2, y0 + (y1 - y0) * j / (ny * 2), h + 0.06], [x1 - x0, 0.12, 0.12], col, { collide: false, occlude: false });
    }
  }
  ctx.box([(x0 + x1) / 2, (y0 + y1) / 2, h + 0.17], [x1 - x0 + 2 * over, y1 - y0 + 2 * over, 0.1], roof, { collide: true, occlude: true });
  const walls = g(e2, "walls", {});
  const wm = g(e2, "wall_mat", roof);
  const defs = {
    s: [[x0, y0], [x1, y0], "x", x0, 1],
    n: [[x1, y1], [x0, y1], "x", x1, -1],
    e: [[x1, y0], [x1, y1], "y", y0, 1],
    w: [[x0, y1], [x0, y0], "y", y1, -1]
  };
  for (const [side, spec] of Object.entries(walls)) {
    const [p0, p1, key, start, sign] = defs[side];
    const ops = (spec.openings ?? []).map((op) => ({ ...op, at: (op[key] - start) * sign }));
    wall(ctx, {
      p0,
      p1,
      height: h + 0.12,
      thickness: 0.12,
      mat: wm,
      openings: ops,
      extend: true,
      soft: g(spec, "soft", false),
      reinforce: g(spec, "reinforce", false),
      breach: g(spec, "breach", false),
      name: g(spec, "name", side)
    });
  }
};
PREFABS.mast = (ctx, e2) => {
  const [bx, by, bz] = e2.base;
  const height = g(e2, "height", 18);
  const w0 = g(e2, "width", 3);
  const w1 = g(e2, "top_width", 1);
  const mat = g(e2, "mat", "steel");
  const sections = Math.trunc(g(e2, "sections", 8));
  const sh = height / sections;
  if (ctx.geometry) {
    const nc = { collide: false, occlude: false };
    for (let k = 0; k < sections; k++) {
      const za = bz + k * sh, zb = bz + (k + 1) * sh;
      const wa = w0 + (w1 - w0) * k / sections;
      const wb = w0 + (w1 - w0) * (k + 1) / sections;
      const wm = (wa + wb) / 2;
      const lean = Math.atan2((wa - wb) / 2, sh) / D3;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        ctx.box([bx + sx * wm / 2, by + sy * wm / 2, (za + zb) / 2], [0.1, 0.1, sh * 1.02], mat, { ...nc, hpr: [0, sy * lean, -sx * lean] });
      }
      const diag = Math.hypot(wm, sh);
      const ang = Math.atan2(sh, wm) / D3;
      for (const side of [-1, 1]) for (const a of [ang, -ang]) {
        ctx.box([bx, by + side * wm / 2, (za + zb) / 2], [diag, 0.05, 0.05], mat, { ...nc, hpr: [0, 0, a] });
        ctx.box([bx + side * wm / 2, by, (za + zb) / 2], [diag, 0.05, 0.05], mat, { ...nc, hpr: [90, 0, a] });
      }
      ctx.box([bx, by, zb], [wb, wb, 0.06], mat, nc);
    }
  }
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    ctx.collider([bx + sx * w0 / 2, by + sy * w0 / 2, bz + 3], [0.2, 0.2, 6], [0, 0, 0], "metal");
  }
  const top = bz + height;
  ctx.cylinder([bx, by, top + 2], 0.05, 4, mat, 8);
  ctx.cylinder([bx + 0.3, by, top + 1.2], 0.03, 2.4, mat, 6);
  ctx.cylinder([bx + w1 / 2 + 0.4, by, top - 2.5], 0.7, 0.18, "paint_white", 24, true, [90, 0, 70]);
  ctx.cylinder([bx, by - w1 / 2 - 0.3, top - 4.5], 0.5, 0.15, "paint_white", 24, true, [0, 70, 0]);
  if (g(e2, "light", true)) {
    ctx.light({ pos: [bx, by, top + 4.15], kind: "point", color: [1, 0.08, 0.04], intensity: 6, range: 6, shadows: false });
  }
};
PREFABS.furniture = (ctx, e2) => {
  const kind = g(e2, "kind", "table");
  const base = e2.base;
  const hd = g(e2, "heading", 0);
  const n = Math.trunc(g(e2, "count", 1));
  const part = (lx, ly, lz, size, m, collide = false) => {
    if (ctx.geometry || collide) ctx.box(local(base, hd, lx, ly, lz), size, m, { hpr: [hd, 0, 0], collide, occlude: false });
  };
  const coll = (lx, ly, lz, size, surface = "metal") => ctx.collider(local(base, hd, lx, ly, lz), size, [hd, 0, 0], surface);
  if (kind === "bunk") {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) part(sx * 0.42, sy * 0.95, 0.9, [0.05, 0.05, 1.8], "steel_painted");
    for (const z of [0.38, 1.38]) {
      part(0, 0, z, [0.9, 1.95, 0.06], "steel_painted");
      part(0, 0, z + 0.1, [0.82, 1.85, 0.14], "mattress");
    }
    coll(0, 0, 0.9, [0.9, 2, 1.8], "fabric");
  } else if (kind === "locker") {
    const w = 0.42;
    for (let i = 0; i < n; i++) {
      const lx = (i - (n - 1) / 2) * w;
      part(lx, 0, 0.93, [w - 0.01, 0.5, 1.86], "steel_painted");
      part(lx, -0.252, 1.5, [0.2, 0.01, 0.05], "steel");
      part(lx + w * 0.3, -0.252, 1, [0.03, 0.02, 0.15], "steel");
    }
    coll(0, 0, 0.93, [w * n, 0.5, 1.86]);
  } else if (kind === "shelf" || kind === "rack") {
    const L = g(e2, "length", 2);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) part(sx * (L / 2 - 0.03), sy * 0.27, 1, [0.05, 0.05, 2], "steel_painted");
    const rng = new Random(g(e2, "seed", 5));
    for (const z of [0.15, 0.75, 1.35, 1.95]) {
      part(0, 0, z, [L, 0.6, 0.04], "steel_painted");
      if (z < 1.9) {
        let x = -L / 2 + 0.1;
        while (x < L / 2 - 0.35) {
          const bw = rng.uniform(0.3, 0.6);
          const bh = rng.uniform(0.18, 0.42);
          const m = rng.choice(["metal_olive", "plywood", "metal_olive", "canvas"]);
          part(x + bw / 2, rng.uniform(-0.05, 0.05), z + 0.02 + bh / 2, [bw, 0.45, bh], m);
          x += bw + rng.uniform(0.04, 0.2);
        }
      }
    }
    coll(0, 0, 1, [L, 0.6, 2]);
  } else if (kind === "table" || kind === "desk" || kind === "workbench") {
    const L = g(e2, "length", 1.8), W = g(e2, "width", 0.8);
    const top = kind === "workbench" ? "steel" : kind === "table" ? "wood_planks" : "steel_painted";
    const hgt = kind === "workbench" ? 0.9 : 0.76;
    part(0, 0, hgt - 0.025, [L, W, 0.05], top);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      part(sx * (L / 2 - 0.06), sy * (W / 2 - 0.06), (hgt - 0.05) / 2, [0.05, 0.05, hgt - 0.05], "steel_painted");
    }
    if (kind === "desk") part(L / 2 - 0.25, 0, 0.4, [0.4, W - 0.06, 0.66], "steel_painted");
    if (kind === "workbench") {
      part(0, 0, 0.2, [L - 0.1, W - 0.1, 0.03], "steel_painted");
      part(-L / 2 + 0.2, -W / 2 + 0.1, hgt + 0.08, [0.2, 0.12, 0.12], "steel");
    }
    coll(0, 0, hgt / 2, [L, W, hgt]);
  } else if (kind === "generator") {
    part(0, 0, 0.55, [1, 2, 1.1], "vehicle_od");
    part(0, 0, 1.12, [0.9, 1.8, 0.05], "steel");
    part(0, 0.9, 1.3, [0.12, 0.12, 0.5], "steel");
    coll(0, 0, 0.6, [1, 2, 1.2]);
  } else if (kind === "fuel_tank") {
    const L = g(e2, "length", 6);
    const r = g(e2, "radius", 1.2);
    ctx.cylinder(local(base, hd, 0, 0, r + 0.5), r, L, g(e2, "mat", "paint_white"), 24, true, [hd, 90, 0]);
    for (const sy of [-1, 1]) part(0, sy * (L / 2 - 0.8), 0.45, [r * 1.6, 0.3, 0.9], "concrete_barrier");
    part(0, 0, 2 * r + 0.55, [0.6, 0.6, 0.12], "steel");
    coll(0, 0, r + 0.5, [2 * r, L, 2 * r + 0.2]);
  } else if (kind === "flagpole") {
    const h = g(e2, "height", 9);
    part(0, 0, 0.2, [1.2, 1.2, 0.4], "concrete_barrier", true);
    ctx.cylinder(local(base, hd, 0, 0, 0.4 + h / 2), 0.06, h, "steel", 10);
    if (ctx.geometry) ctx.box(local(base, hd, 0.65, 0, h - 0.4), [1.2, 0.02, 0.8], g(e2, "flag_mat", "paint_red"), { hpr: [hd, 0, 0], collide: false, occlude: false });
    coll(0, 0, 0.4 + h / 2, [0.15, 0.15, h]);
  } else if (kind === "ammo_boxes") {
    const rng = new Random(g(e2, "seed", 9));
    for (let i = 0; i < n; i++) {
      const lx = i % 3 * 0.62 - 0.62;
      const lz = Math.floor(i / 3) * 0.32;
      part(lx + rng.uniform(-0.03, 0.03), rng.uniform(-0.03, 0.03), lz + 0.16, [0.58, 0.32, 0.3], "metal_olive");
    }
    const rows = Math.floor((n + 2) / 3);
    coll(0, 0, rows * 0.16, [1.9, 0.35, rows * 0.32]);
  } else if (kind === "cabinet") {
    part(0, 0, 0.7, [0.9, 0.5, 1.4], "steel_painted");
    part(0, -0.252, 1.05, [0.85, 0.01, 0.02], "steel");
    coll(0, 0, 0.7, [0.9, 0.5, 1.4]);
  }
};
PREFABS.camera = (ctx, e2) => {
  const [c, r] = ctx.xf(e2.pos, [g(e2, "heading", 0), 0, 0]);
  ctx.cameras.push({ name: g(e2, "name", ""), pos: c, heading: r[0], pitch: Number(g(e2, "pitch", -15)) });
};
PREFABS.zone = (ctx, e2) => {
  ctx.zones.push({ name: e2.name, kind: g(e2, "kind", "bombsite"), team: g(e2, "team", ""), min: [e2.min[0], e2.min[1], e2.min[2]], max: [e2.max[0], e2.max[1], e2.max[2]] });
};
PREFABS.callout = (ctx, e2) => {
  ctx.callouts.push({ name: e2.name, min: [...e2.min], max: [...e2.max] });
};
PREFABS.paint_line = (ctx, e2) => {
  if (!ctx.geometry) return;
  const [dx, dy, length, heading] = line(e2.p0, e2.p1);
  const z = g(e2, "z", 0);
  ctx.box(
    [e2.p0[0] + dx / 2, e2.p0[1] + dy / 2, z + 4e-3],
    [length, g(e2, "width", 0.12), 0.01],
    g(e2, "mat", "paint_white"),
    { hpr: [heading, 0, 0], collide: false, occlude: false }
  );
};
function valueNoise(seed, cell) {
  const rng = new Random(seed * 7919 + 17);
  const lattice = new Float64Array(257 * 257);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng.random();
  return (x, y) => {
    const gx = x / cell, gy = y / cell;
    let ix = Math.floor(gx), iy = Math.floor(gy);
    let fx = gx - ix, fy = gy - iy;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    ix = (ix % 256 + 256) % 256;
    iy = (iy % 256 + 256) % 256;
    const a = lattice[ix * 257 + iy], b = lattice[(ix + 1) * 257 + iy];
    const c = lattice[ix * 257 + iy + 1], d = lattice[(ix + 1) * 257 + iy + 1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };
}
PREFABS.terrain = (ctx, e2) => {
  if (!ctx.geometry) return;
  const [[x0, y0], [x1, y1]] = e2.inner;
  const extent = g(e2, "extent", 480);
  const step = g(e2, "step", 8);
  const start = g(e2, "start", 20);
  const ramp = g(e2, "ramp", 120);
  const hmax = g(e2, "height", 26);
  const seed = g(e2, "seed", 7);
  const mat = g(e2, "mat", "sand");
  const uv = g(e2, "uv_scale", ctx.uvScale(mat) * 2.5);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const n1 = valueNoise(seed, 90), n2 = valueNoise(seed + 1, 35), n3 = valueNoise(seed + 2, 14);
  const height = (X, Y) => {
    const dx = Math.max(x0 - X, X - x1, 0), dy = Math.max(y0 - Y, Y - y1, 0);
    const dd = Math.hypot(dx, dy);
    let t = Math.min(Math.max((dd - start) / ramp, 0), 1);
    t = t * t * (3 - 2 * t);
    const nn = n1(X + 1e3, Y + 1e3) * 0.6 + n2(X + 1e3, Y + 1e3) * 0.3 + n3(X + 1e3, Y + 1e3) * 0.1;
    return t * hmax * (0.35 + 0.65 * nn) - 0.08;
  };
  const xs = [], ys = [];
  for (let x = cx - extent; x <= cx + extent + step * 0.5; x += step) xs.push(x);
  for (let y = cy - extent; y <= cy + extent + step * 0.5; y += step) ys.push(y);
  const mb = ctx.builder(`${mat}@backdrop`);
  const base = mb.vertexCount;
  for (const X of xs) for (const Y of ys) {
    const Z = height(X, Y);
    const dzdx = (height(X + 1, Y) - height(X - 1, Y)) / 2;
    const dzdy = (height(X, Y + 1) - height(X, Y - 1)) / 2;
    const tl = Math.hypot(1, dzdx), bl = Math.hypot(1, dzdy);
    const T = [1 / tl, 0, dzdx / tl], B = [0, 1 / bl, dzdy / bl];
    const N2 = [T[1] * B[2] - T[2] * B[1], T[2] * B[0] - T[0] * B[2], T[0] * B[1] - T[1] * B[0]];
    const nl = Math.hypot(N2[0], N2[1], N2[2]);
    mb.vertex([X, Y, Z], [N2[0] / nl, N2[1] / nl, N2[2] / nl], T, B, X / uv, Y / uv);
  }
  const ny = ys.length;
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ny - 1; j++) {
    if (xs[i] >= x0 && xs[i + 1] <= x1 && ys[j] >= y0 && ys[j + 1] <= y1) continue;
    const a = base + i * ny + j, b = base + (i + 1) * ny + j, c = base + (i + 1) * ny + j + 1, d = base + i * ny + j + 1;
    mb.indices.push(a, b, c, a, c, d);
  }
};

// shared/src/level/environment_geometry.ts
var D4 = Math.PI / 180;
function tri(ctx, mat, points) {
  if (!ctx.geometry) return;
  const p = points.map((v) => ctx.xf(v)[0]);
  const a = p[1].map((v, i) => v - p[0][i]), b = p[2].map((v, i) => v - p[0][i]);
  const cross2 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], len = Math.hypot(...cross2);
  if (len < 1e-9) return;
  const n = cross2.map((v) => v / len), tl = Math.hypot(...a), t = a.map((v) => v / tl), bt = [n[1] * t[2] - n[2] * t[1], n[2] * t[0] - n[0] * t[2], n[0] * t[1] - n[1] * t[0]];
  const mb = ctx.builder(mat), uv = ctx.uvScale(mat);
  for (const side of [1, -1]) {
    const first = mb.vertexCount;
    for (let i = 0; i < 3; i++) {
      const q = p[i].map((v, k) => v - p[0][k]);
      mb.vertex(p[i], n.map((v) => v * side), t, bt.map((v) => v * side), q.reduce((s, v, k) => s + v * t[k], 0) / uv, q.reduce((s, v, k) => s + v * bt[k], 0) / uv);
    }
    mb.indices.push(first, first + (side === 1 ? 1 : 2), first + (side === 1 ? 2 : 1));
  }
}
function quad(ctx, mat, p) {
  tri(ctx, mat, [p[0], p[1], p[2]]);
  tri(ctx, mat, [p[0], p[2], p[3]]);
}
function tube(ctx, a, b, r, mat, seg = 6) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], l = Math.hypot(dx, dy, dz);
  if (l < 1e-6) return;
  ctx.cylinder(a.map((v, i) => (v + b[i]) / 2), r, l, mat, seg, true, [Math.atan2(dy, dx) / D4, 0, Math.atan2(Math.hypot(dx, dy), dz) / D4]);
}
function cloth(f, w, d, zBack, zFront, mat, sag = 0.16) {
  if (!f.ctx.geometry) return;
  const nx = Math.max(8, Math.ceil(w / 0.45)), ny = Math.max(4, Math.ceil(d / 0.35));
  const point = (i, j, offset = 0) => {
    const u = i / nx, v = j / ny;
    return f.p((u - 0.5) * w, (v - 0.5) * d, zBack * (1 - v) + zFront * v - sag * Math.sin(Math.PI * u) * Math.sin(Math.PI * v) + 0.025 * Math.sin(u * 43) * Math.sin(v * Math.PI) + offset);
  };
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) quad(f.ctx, mat, [point(i, j), point(i + 1, j), point(i + 1, j + 1), point(i, j + 1)]);
  for (let i = 0; i <= nx; i += Math.max(1, Math.round(nx / 4))) for (let j = 0; j < ny; j++) tube(f.ctx, point(i, j, 6e-3), point(i, j + 1, 6e-3), 6e-3, "canvas", 4);
  for (let i = 0; i < nx; i++) {
    const a = point(i, 0), b = point(i + 1, 0);
    quad(f.ctx, mat, [a, b, [b[0], b[1], b[2] - 0.12 - 0.035 * Math.sin((i + 1) * 2)], [a[0], a[1], a[2] - 0.12 - 0.035 * Math.sin(i * 2)]]);
  }
  for (const i of [0, nx]) for (const j of [0, ny]) {
    const p = point(i, j);
    tube(f.ctx, p, [p[0], p[1], p[2] - 0.12], 7e-3, "sack", 5);
  }
}
function hangingCloth(f, x, y, z, w, h, mat) {
  const nx = 12, ny = 6, p = (i, j) => {
    const u = i / nx, v = j / ny;
    return f.p(x + (u - 0.5) * w, y + 0.035 * Math.sin(u * 8 * Math.PI) * (0.2 + 0.8 * v) + 0.025 * v * v, z - v * h - 0.025 * Math.sin(u * Math.PI));
  };
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) quad(f.ctx, mat, [p(i, j), p(i + 1, j), p(i + 1, j + 1), p(i, j + 1)]);
}

// shared/src/level/afghan.ts
var D5 = Math.PI / 180;
var g2 = (e2, k, d) => e2[k] === void 0 ? d : e2[k];
function rot2d2(x, y, heading) {
  const a = heading * D5;
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
}
function local2(origin2, heading, lx, ly, lz) {
  const [wx, wy] = rot2d2(lx, ly, heading);
  return [origin2[0] + wx, origin2[1] + wy, (origin2[2] ?? 0) + lz];
}
var Frame = class {
  constructor(ctx, base, hd) {
    this.ctx = ctx;
    this.base = base;
    this.hd = hd;
  }
  p(lx, ly, lz) {
    return local2(this.base, this.hd, lx, ly, lz);
  }
  r(r) {
    return [this.hd + (r?.[0] ?? 0), r?.[1] ?? 0, r?.[2] ?? 0];
  }
  box(lx, ly, lz, size, mat, r, uv = "world") {
    if (!this.ctx.geometry) return;
    this.ctx.box(this.p(lx, ly, lz), size, mat, { hpr: this.r(r), collide: false, occlude: false, uv });
  }
  bev(lx, ly, lz, size, mat, bevel = 0.04, r) {
    if (!this.ctx.geometry) return;
    this.ctx.chamfer(this.p(lx, ly, lz), size, mat, bevel, this.r(r));
  }
  cyl(lx, ly, lz, radius, h, mat, seg = 16, r, caps = true) {
    if (!this.ctx.geometry) return;
    this.ctx.cylinder(this.p(lx, ly, lz), radius, h, mat, seg, caps, this.r(r));
  }
  /** A corrugated sheet (both sides) of w x l in the frame's x / y, pitched by `pitch` degrees, corrugations
   *  running along y: the sine profile catches the light the way real sheet metal does. */
  wavy(lx, ly, lz, w, l, pitch, mat) {
    if (!this.ctx.geometry) return;
    const mb = this.ctx.builder(mat);
    const uv = this.ctx.uvScale(mat);
    const period = 0.076, amp = 0.012, n = Math.max(2, Math.round(w / period * 4));
    const cp = Math.cos(pitch * D5), sp = Math.sin(pitch * D5);
    const h = this.hd * D5;
    for (const side of [1, -1]) {
      const base = mb.vertexCount;
      for (const yy of [-l / 2, l / 2]) for (let i = 0; i <= n; i++) {
        const xx = -w / 2 + w * i / n;
        const ph = xx / period * Math.PI * 2;
        const zz = Math.sin(ph) * amp + side * 2e-3;
        const dz = Math.cos(ph) * amp * Math.PI * 2 / period;
        const [P] = this.ctx.xf(this.p(lx + xx, ly + yy * cp - zz * sp, lz + yy * sp + zz * cp));
        const nl = Math.hypot(dz, 1);
        const nx = -dz / nl * side, nzL = 1 / nl * side;
        const ny = -sp * nzL, nz = cp * nzL;
        const N2 = [nx * Math.cos(h) - ny * Math.sin(h), nx * Math.sin(h) + ny * Math.cos(h), nz];
        const T = [Math.cos(h), Math.sin(h), 0];
        mb.vertex(P, N2, T, [N2[1] * T[2] - N2[2] * T[1], N2[2] * T[0] - N2[0] * T[2], N2[0] * T[1] - N2[1] * T[0]], xx / uv, yy / uv);
      }
      for (let i = 0; i < n; i++) {
        const a = base + i, b = a + 1, c = base + n + 1 + i + 1, d = base + n + 1 + i;
        if (side > 0) mb.indices.push(a, b, c, a, c, d);
        else mb.indices.push(a, c, b, a, d, c);
      }
    }
  }
  /** A cylinder lying along local x (axles, beams across x). */
  cylX(lx, ly, lz, radius, len, mat, seg = 16) {
    this.cyl(lx, ly, lz, radius, len, mat, seg, [0, 0, 90]);
  }
  /** A cylinder lying along local y. */
  cylY(lx, ly, lz, radius, len, mat, seg = 16) {
    this.cyl(lx, ly, lz, radius, len, mat, seg, [0, 90, 0]);
  }
  dome(lx, ly, lz, radius, mat, squash = 1, seg = 28) {
    if (!this.ctx.geometry) return;
    this.ctx.dome(this.p(lx, ly, lz), radius, mat, squash, seg);
  }
  ball(lx, ly, lz, radius, mat, rings = 5, seg = 8) {
    if (!this.ctx.geometry) return;
    const [c] = this.ctx.xf(this.p(lx, ly, lz));
    this.ctx.builder(mat).addSphere(c, radius, rings, seg, this.ctx.uvScale(mat));
  }
  solid(lx, ly, lz, size, mat, r, occlude = true) {
    this.ctx.box(this.p(lx, ly, lz), size, mat, { hpr: this.r(r), collide: true, occlude });
  }
  /** A solid whose near version is rounded (and organic for earth / plaster): same collider as solid(). */
  rsolid(lx, ly, lz, size, mat, round, radius, r, occlude = true) {
    this.ctx.rbox(this.p(lx, ly, lz), size, mat, { hpr: this.r(r), collide: true, occlude, round, radius });
  }
  col(lx, ly, lz, size, surface = "metal", r, occlude = false) {
    this.ctx.collider(this.p(lx, ly, lz), size, this.r(r), surface);
    if (occlude) this.ctx.occluder(this.p(lx, ly, lz), size, this.r(r));
  }
  occ(lx, ly, lz, size, r) {
    this.ctx.occluder(this.p(lx, ly, lz), size, this.r(r));
  }
  /** A wheel whose axle runs along local x: tyre, sidewall bulge, rim, hub and wheel nuts. */
  wheel(lx, ly, radius, width, rim = "steel", tyre = "rubber") {
    if (!this.ctx.geometry) return;
    const side = Math.sign(lx || 1);
    this.cylX(lx, ly, radius, radius, width, tyre, 20);
    this.cylX(lx + side * 4e-3, ly, radius, radius * 0.93, width + 0.02, tyre, 20);
    this.cylX(lx + side * (width / 2 + 6e-3), ly, radius, radius * 0.6, 0.02, rim, 16);
    this.cylX(lx + side * (width / 2 + 0.018), ly, radius, radius * 0.2, 0.03, rim, 10);
    for (let k = 0; k < 5; k++) {
      const a = k / 5 * 2 * Math.PI;
      this.box(
        lx + side * (width / 2 + 0.02),
        ly + Math.cos(a) * radius * 0.36,
        radius + Math.sin(a) * radius * 0.36,
        [0.03, 0.035, 0.035],
        "steel"
      );
    }
  }
};
function subtractSpans2(lo, hi, gaps) {
  let spans2 = [[lo, hi]];
  for (const [g0, g1] of gaps) {
    const out = [];
    for (const [a, b] of spans2) {
      if (g1 <= a || g0 >= b) {
        out.push([a, b]);
        continue;
      }
      if (g0 > a) out.push([a, g0]);
      if (g1 < b) out.push([g1, b]);
    }
    spans2 = out;
  }
  return spans2.filter(([a, b]) => b - a > 0.05);
}
var DOOR_MATS = ["door_blue", "door_green", "wood_dark", "door_blue", "metal_blue"];
var SHUTTER_MATS = ["door_blue", "door_green", "wood_dark", "metal_green"];
function sidesOf(x0, y0, x1, y1) {
  return [
    { name: "s", ax: "x", start: x0, dir: 1, fixed: y0, out: [0, -1], length: x1 - x0 },
    { name: "e", ax: "y", start: y0, dir: 1, fixed: x1, out: [1, 0], length: y1 - y0 },
    { name: "n", ax: "x", start: x1, dir: -1, fixed: y1, out: [0, 1], length: x1 - x0 },
    { name: "w", ax: "y", start: y1, dir: -1, fixed: x0, out: [-1, 0], length: y1 - y0 }
  ];
}
function sidePoint(s, along2, off, z) {
  if (s.ax === "x") return [along2, s.fixed + s.out[1] * off, z];
  return [s.fixed + s.out[0] * off, along2, z];
}
function sideHeading(s) {
  return Math.atan2(-s.out[0], s.out[1]) / D5;
}
function doorLeaf(ctx, s, along2, inset, width, height, z, mat, hinge) {
  const f = new Frame(ctx, sidePoint(s, along2 + hinge * s.dir * width, -inset, z), sideHeading(s));
  f.box(0, 0, height / 2, [width * 0.96, 0.05, height - 0.04], mat);
  for (const zz of [0.25, height / 2, height - 0.3]) f.box(0, -0.03, zz, [width * 0.94, 0.012, 0.08], "steel");
  f.box(0, -0.035, height * 0.55, [0.05, 0.015, 0.12], "brass");
}
PREFABS.mud_house = (ctx, e2) => {
  const [[x0, y0], [x1, y1]] = [e2.min, e2.max];
  const z = g2(e2, "z", 0);
  const h = g2(e2, "height", 3);
  const t = g2(e2, "wall", 0.45);
  const roofT = g2(e2, "roof_thickness", 0.35);
  const ext = g2(e2, "mat", "mud_wall");
  const extMat = ext;
  const rng = new Random(g2(e2, "seed", Math.trunc(Math.abs(x0 * 13 + y0 * 7)) + 3));
  const parapet = g2(e2, "parapet", 0.55);
  const core = {
    ...e2,
    type: "building",
    height: h,
    wall: t,
    roof_thickness: roofT,
    mat: ext,
    mat_in: g2(e2, "mat_in", "mud_wall_light"),
    floor_mat: g2(e2, "floor_mat", "dirt"),
    roof_mat: g2(e2, "roof_mat", "mud_roof"),
    ceiling_mat: g2(e2, "ceiling_mat", "reed_ceiling"),
    edge_mat: g2(e2, "edge_mat", ext),
    parapet,
    frame_mat: g2(e2, "frame_mat", "wood_dark")
  };
  PREFABS.building(ctx, core);
  const top = z + h + roofT;
  const ops = g2(e2, "openings", {});
  const sides = sidesOf(x0, y0, x1, y1);
  const doorMat = g2(e2, "door_mat", rng.choice(DOOR_MATS));
  const shutterMat = g2(e2, "shutter_mat", rng.choice(SHUTTER_MATS));
  const open = new Set(g2(e2, "open_sides", []));
  for (const s of sides) {
    if (open.has(s.name)) continue;
    const list = ops[s.name] ?? [];
    const key = s.ax;
    const lo = Math.min(s.start, s.start + s.dir * s.length), hi = Math.max(s.start, s.start + s.dir * s.length);
    const hd = sideHeading(s);
    const cornerX = s.ax === "x";
    const ext2 = (out) => cornerX ? out : -0.012;
    const doors = list.filter((op) => g2(op, "bottom", 0) < 0.05).map((op) => [op[key] - op.width / 2 - 0.02, op[key] + op.width / 2 + 0.02]);
    if (g2(e2, "plinth", true)) {
      for (const [a, b] of subtractSpans2(lo - ext2(0.13), hi + ext2(0.13), doors)) {
        const c = sidePoint(s, (a + b) / 2, 0.06, z + 0.24);
        ctx.rbox(c, [b - a, 0.14, 0.48], g2(e2, "plinth_mat", "mud_plinth"), {
          hpr: [hd, 0, 0],
          collide: false,
          occlude: false,
          round: ["+z", "+y"],
          radius: 0.05,
          step: 0.6
        });
        if (ctx.geometry && b - a > 0.6) {
          const mid = ctx.xf(c)[0];
          ctx.withVariant("hi", mid, () => {
            const rc = ctx.xf(sidePoint(s, (a + b) / 2, 0.2, z - 0.015), [hd, 0, 0]);
            ctx.builder("dirt").addRoundedBox(rc[0], [b - a - 0.1, 0.32, 0.09], {
              hpr: rc[1],
              uvScale: ctx.uvScale("dirt"),
              radius: 0.04,
              round: ["+z", "+y", "-y", "+x", "-x"],
              step: 0.8,
              displace: ctx.organic("dirt")
            });
            const nr = Math.floor((b - a) / 2.5);
            for (let k = 0; k < nr; k++) {
              const u = a + 0.3 + rng.random() * (b - a - 0.6), sz = 0.05 + rng.random() * 0.07;
              ctx.chamfer(
                sidePoint(s, u, 0.25 + rng.random() * 0.25, z + sz * 0.3),
                [sz * 1.4, sz, sz * 0.8],
                g2(e2, "plinth_mat", "mud_plinth"),
                sz * 0.3,
                [hd + rng.uniform(0, 90), rng.uniform(-10, 10), 0]
              );
            }
          });
        }
      }
    }
    if (parapet > 0) {
      const gaps = g2(e2, "parapet_gaps", []).filter((gp) => gp.side === s.name).map((gp) => [gp.from, gp.to]);
      for (const [a, b] of subtractSpans2(lo - (cornerX ? 0.06 : -0.26), hi + (cornerX ? 0.06 : -0.26), gaps)) {
        ctx.chamfer(sidePoint(s, (a + b) / 2, -0.1, top + parapet + 0.04), [b - a, 0.32, 0.1], extMat, 0.04, [hd, 0, 0]);
      }
    }
    const bandLo = lo - ext2(0.09), bandHi = hi + ext2(0.09);
    const band = sidePoint(s, (bandLo + bandHi) / 2, 0.04, top - roofT / 2);
    ctx.rbox(band, [bandHi - bandLo, 0.08, roofT + 0.06], g2(e2, "band_mat", "mud_plinth"), {
      hpr: [hd, 0, 0],
      collide: false,
      occlude: false,
      round: ["+z", "-z", "+y"],
      radius: 0.025,
      step: 0.8
    });
    ctx.weatherAt(sidePoint(s, (lo + hi) / 2, 0, top + parapet), s.out, hi - lo, 1.3, 0.35);
    if (ctx.geometry) ctx.withVariant("hi", ctx.xf(band)[0], () => {
      ctx.box(sidePoint(s, (lo + hi) / 2, 0.035, top - roofT - 0.045), [hi - lo - 0.1, 0.07, 0.03], "reed_ceiling", { hpr: [hd, 0, 0], collide: false, occlude: false });
      if (parapet > 0) {
        const dc = ctx.xf(sidePoint(s, (lo + hi) / 2, -0.38, top - 0.03), [hd, 0, 0]);
        ctx.builder(g2(e2, "roof_mat", "mud_roof")).addRoundedBox(dc[0], [Math.max(0.2, hi - lo - 0.8), 0.32, 0.1], {
          hpr: dc[1],
          uvScale: ctx.uvScale("mud_roof"),
          radius: 0.05,
          round: ["+z", "-y", "+x", "-x"],
          step: 0.8,
          displace: ctx.organic("mud_roof")
        });
      }
    });
    for (const op of list) {
      const at = op[key], w = op.width;
      const ob = g2(op, "bottom", 0), ot = g2(op, "top", Math.min(2.2, h));
      const lintel = sidePoint(s, at, 0.03, z + ot + 0.09);
      ctx.chamfer(lintel, [w + 0.55, t + 0.1, 0.16], "wood_old", 0.025, [hd + rng.uniform(-0.6, 0.6), 0, rng.uniform(-0.8, 0.8)]);
      if (ob >= 0.05) ctx.weatherAt(sidePoint(s, at, 0, z + ob), s.out, w + 0.1, Math.min(1.1, ob), 0.6);
      if (rng.random() < 0.18) ctx.weatherAt(sidePoint(s, at, 0, z + ot + 1.3), s.out, w * 0.9, 1.2, -0.75);
      if (ob < 0.05) {
        if (g2(op, "door", true)) doorLeaf(ctx, s, at, t + 0.03, w, ot - 0.02, z, g2(op, "mat", doorMat), rng.random() < 0.5 ? -1 : 1);
        ctx.box(sidePoint(s, at, -t / 2, z + 0.02), [w + 0.1, t + 0.3, 0.04], "stone_wall", { hpr: [hd, 0, 0], collide: false, occlude: false });
      } else {
        const sh = g2(op, "shutters", true);
        if (sh) {
          for (const side of [-1, 1]) {
            const f = new Frame(ctx, sidePoint(s, at + side * s.dir * (w * 0.75 + 0.02), 0.04, z + (ob + ot) / 2), hd);
            f.box(0, 0, 0, [w / 2, 0.04, ot - ob - 0.04], g2(op, "mat", shutterMat));
            for (const zz of [-(ot - ob) / 4, 0, (ot - ob) / 4]) f.box(0, 0.025, zz, [w / 2 - 0.06, 0.012, 0.035], "wood_dark");
          }
        }
        if (g2(op, "grille", rng.random() < 0.6)) {
          const n = Math.max(Math.round(w / 0.16), 2);
          for (let i = 1; i < n; i++) {
            const a = at - w / 2 + w * i / n;
            ctx.box(sidePoint(s, a, -t / 2, z + (ob + ot) / 2), [0.022, 0.022, ot - ob], "steel", { hpr: [hd, 0, 0], collide: false, occlude: false });
          }
          ctx.box(sidePoint(s, at, -t / 2, z + ob + (ot - ob) * 0.5), [w, 0.032, 0.025], "steel", { hpr: [hd, 0, 0], collide: false, occlude: false });
        }
      }
    }
    if (g2(e2, "spouts", true) && (s.name === "s" || s.name === "n" || s.length < 9)) {
      const n = Math.max(Math.floor(s.length / 4.5), 1);
      for (let i = 0; i < n; i++) {
        const a = lo + (hi - lo) * (i + 0.5) / n + rng.uniform(-0.4, 0.4);
        if (list.some((op) => Math.abs(op[key] - a) < op.width / 2 + 0.5)) continue;
        const f = new Frame(ctx, sidePoint(s, a, 0, top + 0.08), hd);
        f.box(0, 0.3, 0, [0.14, 0.62, 0.1], "wood_old", [0, -8, 0]);
        ctx.weatherAt(sidePoint(s, a, 0, top + 0.05), s.out, 0.35 + rng.uniform(0, 0.15), 1.8, 1);
      }
    }
    if (g2(e2, "beam_ends", true) && s.ax === "x" === x1 - x0 >= y1 - y0) {
      const n = Math.max(Math.floor(s.length / 0.75), 2);
      for (let i = 0; i < n; i++) {
        const a = lo + (hi - lo) * (i + 0.5) / n;
        if (list.some((op) => Math.abs(op[key] - a) < op.width / 2 + 0.3 && g2(op, "top", 2.2) > h - 0.5)) continue;
        const f = new Frame(ctx, sidePoint(s, a, 0.12, top - roofT - 0.1), hd);
        f.cylY(0, 0, 0, 0.075 + rng.uniform(-0.01, 0.015), 0.28 + rng.uniform(0, 0.12), "wood_old", 7);
      }
    }
  }
  if (g2(e2, "beams", true)) {
    const alongX = x1 - x0 >= y1 - y0;
    const L = alongX ? x1 - x0 : y1 - y0;
    const span = alongX ? y1 - y0 - 2 * t : x1 - x0 - 2 * t;
    const n = Math.max(Math.floor(L / 0.75), 2);
    for (let i = 0; i < n; i++) {
      const a = (alongX ? x0 : y0) + L * (i + 0.5) / n;
      const c = alongX ? [a, (y0 + y1) / 2, z + h - 0.08] : [(x0 + x1) / 2, a, z + h - 0.08];
      ctx.cylinder(c, 0.075, span, "wood_old", 7, false, alongX ? [0, 90, 0] : [0, 0, 90]);
    }
  }
  domesOf(ctx, e2, top);
  roofClutter(ctx, e2, top, rng);
};
function domesOf(ctx, e2, top) {
  for (const d of g2(e2, "domes", [])) {
    const r = g2(d, "r", 1.6);
    const mat = g2(d, "mat", "mud_brick");
    const squash = g2(d, "squash", 0.85);
    ctx.cylinder([d.x, d.y, top + 0.15], r + 0.05, 0.3, g2(d, "drum_mat", "mud_wall"), 28, false);
    if (ctx.geometry) {
      const mb = ctx.builder(mat);
      const v0 = mb.vertexCount;
      ctx.dome([d.x, d.y, top + 0.3], r, mat, squash, 28);
      const [c0] = ctx.xf([d.x, d.y, top + 0.3]);
      const v = mb.verts;
      for (let i = v0; i < mb.vertexCount; i++) {
        const o = i * FLOATS_PER_VERTEX;
        const dx = v[o] - c0[0], dy = v[o + 1] - c0[1], dz = v[o + 2] - c0[2];
        const k = 1 + 0.018 * (noise3(v[o] * 1.1, v[o + 1] * 1.1, v[o + 2] * 1.1, 41) - 0.5) * 2 * Math.min(1, dz / 0.3);
        v[o] = c0[0] + dx * k;
        v[o + 1] = c0[1] + dy * k;
        v[o + 2] = c0[2] + dz * k;
      }
      ctx.cylinder([d.x, d.y, top + 0.36], r + 0.035, 0.12, "mud_brick", 28, false);
    } else ctx.dome([d.x, d.y, top + 0.3], r, mat, squash, 28);
    ctx.cylinder([d.x, d.y, top + 0.3 + r * squash + 0.02], 0.22, 0.12, "mud_wall", 12);
    ctx.collider([d.x, d.y, top + (0.3 + r * squash * 0.55) / 2], [r * 1.5, r * 1.5, 0.3 + r * squash * 0.55], [0, 0, 0], "plaster");
    ctx.occluder([d.x, d.y, top + (0.3 + r * squash * 0.7) / 2], [r * 1.5, r * 1.5, 0.3 + r * squash * 0.7]);
  }
}
function roofClutter(ctx, e2, top, rng) {
  const items = g2(e2, "roof_items", []);
  for (const it of items) {
    const f = new Frame(ctx, [it.x, it.y, top], g2(it, "heading", 0));
    const kind = it.kind;
    if (kind === "tank") {
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) f.box(sx * 0.4, sy * 0.4, 0.35, [0.06, 0.06, 0.7], "steel");
      f.box(0, 0, 0.72, [1, 1, 0.05], "steel");
      f.cyl(0, 0, 1.25, 0.5, 1, "tank_black", 18);
      f.cyl(0, 0, 1.78, 0.18, 0.08, "tank_black", 12);
      f.col(0, 0, 0.9, [1, 1, 1.8], "metal");
    } else if (kind === "dish") {
      f.box(0, 0, 0.6, [0.05, 0.05, 1.2], "steel");
      f.cyl(0, 0.1, 1.15, 0.45, 0.04, "paint_white", 20, [0, 60, 0]);
      f.box(0, 0.35, 1.25, [0.03, 0.5, 0.03], "steel", [0, 30, 0]);
    } else if (kind === "wood") {
      for (let i = 0; i < 9; i++) {
        f.cylX(rng.uniform(-0.1, 0.1), (i % 3 - 1) * 0.16, 0.08 + Math.floor(i / 3) * 0.14, 0.07, 1.6 + rng.uniform(-0.2, 0.2), "wood_old", 7);
      }
      f.col(0, 0, 0.25, [1.6, 0.5, 0.5], "wood");
    } else if (kind === "laundry") {
      const L = g2(it, "length", 4);
      for (const sx of [-1, 1]) f.box(sx * L / 2, 0, 0.9, [0.05, 0.05, 1.8], "wood_old");
      f.box(0, 0, 1.75, [L, 0.012, 0.012], "steel");
      const cloth2 = ["cloth_white", "carpet_red", "tarp_blue", "cloth_green", "carpet_blue"];
      let x = -L / 2 + 0.3;
      while (x < L / 2 - 0.4) {
        const w = rng.uniform(0.35, 0.8);
        f.box(x + w / 2, 0, 1.75 - 0.35, [w, 0.015, rng.uniform(0.4, 0.75)], rng.choice(cloth2));
        x += w + rng.uniform(0.05, 0.25);
      }
    } else if (kind === "antenna") {
      f.box(0, 0, 2, [0.04, 0.04, 4], "steel");
      for (const zz of [3.2, 3.6, 3.9]) f.box(0, 0, zz, [0.9, 0.02, 0.02], "steel");
    }
  }
}
PREFABS.qala_wall = (ctx, e2) => {
  const p0 = e2.p0, p1 = e2.p1;
  const h = g2(e2, "height", 4.2);
  const t = g2(e2, "thickness", 0.8);
  const z0 = g2(e2, "z", 0);
  const mat = g2(e2, "mat", "mud_wall");
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
  const L = Math.hypot(dx, dy);
  const hd = Math.atan2(dy, dx) / D5;
  const rng = new Random(g2(e2, "seed", Math.trunc(Math.abs(p0[0] * 11 + p0[1] * 5)) + 7));
  const openings = (e2.openings ?? []).map((op) => ({ ...op }));
  const notches = Math.trunc(g2(e2, "damage", 0));
  for (let i = 0; i < notches; i++) {
    const at = rng.uniform(1.2, L - 1.2);
    if (openings.some((op) => Math.abs(op.at - at) < op.width / 2 + 1.2)) continue;
    const w = rng.uniform(0.6, 1.6);
    openings.push({ at, width: w, bottom: h - rng.uniform(0.35, Math.min(1.1, h * 0.3)), top: h + 0.1, notch: true });
  }
  wall(ctx, {
    p0,
    p1,
    height: h,
    thickness: t,
    z: z0,
    mat: g2(e2, "mat_in", mat),
    mat2: mat,
    openings,
    frame_mat: null,
    top_exposed: !g2(e2, "merlons", false),
    soft: g2(e2, "soft", false),
    reinforce: g2(e2, "reinforce", false),
    breach: g2(e2, "breach", false),
    name: g2(e2, "name", "")
  });
  const doors = openings.filter((op) => g2(op, "bottom", 0) < 0.05).map((op) => [op.at - op.width / 2, op.at + op.width / 2]);
  const f = new Frame(ctx, [p0[0], p0[1], z0], hd - 90);
  const footW = t + 0.36;
  if (g2(e2, "footing", true)) {
    for (const [a, b] of subtractSpans2(-0.05, L + 0.05, doors)) {
      f.rsolid(0, (a + b) / 2, 0.45, [footW, b - a, 0.9], g2(e2, "foot_mat", "mud_plinth"), ["+x", "-x", "+z"], 0.08, void 0, false);
      f.bev(0, (a + b) / 2, 0.92, [footW - 0.08, b - a, 0.12], g2(e2, "foot_mat", "mud_plinth"), 0.05);
    }
  }
  const tops = openings.filter((op) => g2(op, "top", 2.2) >= h - 0.01).map((op) => [op.at - op.width / 2, op.at + op.width / 2]);
  for (const [a, b] of subtractSpans2(0, L, tops)) f.bev(0, (a + b) / 2, h + 0.05, [t + 0.08, b - a, 0.14], mat, 0.06);
  for (const op of openings.filter((o) => o.notch)) {
    for (let k = 0; k < 4; k++) {
      const s = op.at + rng.uniform(-op.width, op.width);
      const side = rng.random() < 0.5 ? -1 : 1;
      const sz = rng.uniform(0.2, 0.45);
      f.bev(side * (footW / 2 + rng.uniform(0.15, 0.6)), s, sz * 0.4, [sz * 1.3, sz, sz * 0.8], mat, 0.06, [rng.uniform(0, 90), rng.uniform(-10, 10), 0]);
    }
  }
  if (g2(e2, "merlons", false)) {
    const n = Math.max(Math.floor(L / 1.3), 1);
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) * L / n;
      if (tops.some(([a, b]) => s > a - 0.4 && s < b + 0.4)) continue;
      f.solid(0, s, h + 0.4, [t * 0.8, 0.7, 0.7], mat, void 0, true);
      f.bev(0, s, h + 0.76, [t * 0.8 + 0.04, 0.74, 0.06], mat, 0.025);
    }
  }
  const bs = g2(e2, "buttress", 0);
  if (bs > 0) {
    const n = Math.max(Math.floor(L / bs), 1);
    for (let i = 1; i < n; i++) {
      const s = i * L / n;
      if (openings.some((op) => Math.abs(op.at - s) < op.width / 2 + 0.9)) continue;
      for (const side of g2(e2, "buttress_sides", [-1, 1])) {
        f.rsolid(side * (t / 2 + 0.22), s, h * 0.42, [0.44, 0.8, h * 0.84], mat, [side > 0 ? "+x" : "-x", "+y", "-y", "+z"], 0.1, void 0, false);
        f.bev(side * (t / 2 + 0.16), s, h * 0.86, [0.32, 0.78, 0.2], mat, 0.08, [0, 0, side * -20]);
      }
    }
  }
  for (const op of openings.filter((o) => o.gate)) {
    const w = op.width, top = g2(op, "top", Math.min(2.2, h));
    const gm = g2(op, "mat", rng.choice(["wood_dark", "door_blue", "door_green", "metal_blue"]));
    for (const s of [op.at - w / 2 - 0.3, op.at + w / 2 + 0.3]) f.solid(0, s, h / 2 + 0.1, [t + 0.5, 0.6, h + 0.2], mat, void 0, true);
    f.bev(0, op.at, top + 0.16, [t + 0.3, w + 0.9, 0.3], "wood_old", 0.04);
    for (const zz of [0.05, 0.1]) f.box(0, op.at, top + 0.33 + zz, [t + 0.1, w + 0.5, 0.05], "wood_dark");
    for (const sgn of [-1, 1]) {
      const swing = g2(op, "swing", -1);
      const hingeS = op.at + sgn * (w / 2 - 0.04);
      const leafLen = w / 2 - 0.05;
      const cx = swing * (t / 2 + leafLen / 2 * 0.98);
      const cs = hingeS;
      f.box(cx, cs - sgn * 0.04, (top - 0.05) / 2, [leafLen, 0.08, top - 0.06], gm);
      for (const zz of [0.3, top / 2, top - 0.35]) f.box(cx, cs - sgn * 0.09, zz, [leafLen - 0.05, 0.015, 0.1], "steel");
      for (let k = 0; k < 4; k++) f.box(cx - leafLen / 2 + 0.15 + k * (leafLen - 0.3) / 3, cs - sgn * 0.09, top * 0.62, [0.04, 0.02, 0.04], "brass");
    }
  }
};
PREFABS.watchtower = (ctx, e2) => {
  const base = e2.base;
  const h = g2(e2, "height", 7);
  const s0 = g2(e2, "size", 3.2);
  const taper = g2(e2, "taper", 0.6);
  const mat = g2(e2, "mat", "mud_wall");
  const round = g2(e2, "round", true);
  const hd = g2(e2, "heading", 0);
  const f = new Frame(ctx, base, hd);
  const steps = 5;
  if (round && ctx.geometry) {
    const mb = ctx.builder(mat);
    const [cb] = ctx.xf(base);
    const seg = 28, rings = Math.max(6, Math.ceil(h / 0.5));
    const uv = ctx.uvScale(mat);
    const v0 = mb.vertexCount;
    const radius = (z, a) => (s0 - taper * (z / h)) / 2 * (1 + 0.02 * (noise3(Math.cos(a) * 1.7 + cb[0], Math.sin(a) * 1.7 + cb[1], z * 0.8, 7) - 0.5) * 2);
    for (let j = 0; j <= rings; j++) {
      const zz = h * j / rings;
      for (let k = 0; k <= seg; k++) {
        const a = k / seg * Math.PI * 2;
        const rr = radius(zz, a);
        const dr = (radius(zz + 0.05, a) - radius(Math.max(0, zz - 0.05), a)) / 0.1;
        const n2 = [Math.cos(a), Math.sin(a), -dr];
        const nl = Math.hypot(n2[0], n2[1], n2[2]);
        mb.vertex(
          [cb[0] + Math.cos(a) * rr, cb[1] + Math.sin(a) * rr, cb[2] + zz],
          [n2[0] / nl, n2[1] / nl, n2[2] / nl],
          [-Math.sin(a), Math.cos(a), 0],
          [0, 0, 1],
          a * s0 / 2 / uv,
          zz / uv
        );
      }
    }
    for (let j = 0; j < rings; j++) for (let k = 0; k < seg; k++) {
      const a = v0 + j * (seg + 1) + k, b = a + 1, c2 = a + seg + 2, d = a + seg + 1;
      mb.indices.push(a, b, c2, a, c2, d);
    }
  } else {
    for (let i = 0; i < steps; i++) {
      const za = h * i / steps, zb = h * (i + 1) / steps;
      const w = s0 - taper * ((i + 0.5) / steps);
      if (round) f.cyl(0, 0, (za + zb) / 2, w / 2, zb - za + 0.01, mat, 24, void 0, i === steps - 1);
      else f.box(0, 0, (za + zb) / 2, [w, w, zb - za + 0.01], mat);
    }
  }
  const topW = s0 - taper;
  if (round) f.cyl(0, 0, h + 0.08, topW / 2 + 0.12, 0.16, mat, 24);
  else f.bev(0, 0, h + 0.08, [topW + 0.24, topW + 0.24, 0.16], mat, 0.05);
  const n = round ? 8 : 8;
  for (let i = 0; i < n; i++) {
    const a = i / n * 2 * Math.PI;
    const r = topW / 2 + 0.02;
    const lx = round ? Math.cos(a) * r : Math.max(-1, Math.min(1, Math.cos(a) * 1.5)) * r;
    const ly = round ? Math.sin(a) * r : Math.max(-1, Math.min(1, Math.sin(a) * 1.5)) * r;
    f.bev(lx, ly, h + 0.5, [0.42, 0.42, 0.7], mat, 0.06, [a / D5, 0, 0]);
  }
  for (const zz of [h * 0.45, h * 0.78]) {
    for (let k = 0; k < 4; k++) {
      const a = (k * 90 + (zz > h * 0.6 ? 45 : 0)) * D5;
      const w = s0 - taper * (zz / h);
      const r = w / 2 + 5e-3;
      const ff = new Frame(ctx, f.p(Math.cos(a) * r, Math.sin(a) * r, zz), hd + a / D5 - 90);
      ff.box(0, 0, 0, [0.16, 0.03, 0.6], "shadow");
      ff.box(0, 0.01, 0.36, [0.36, 0.04, 0.08], "wood_old");
    }
  }
  const c = round ? 0.9 : 1;
  f.col(0, 0, h * 0.3, [s0 * c, s0 * c, h * 0.6], "plaster", void 0, true);
  f.col(0, 0, h * 0.8 + 0.25, [topW * c + 0.2, topW * c + 0.2, h * 0.4 + 0.5], "plaster", void 0, true);
};
PREFABS.rock_wall = (ctx, e2) => {
  const p0 = e2.p0, p1 = e2.p1;
  const h = g2(e2, "height", 9);
  const depth = g2(e2, "depth", 4);
  const mat = g2(e2, "mat", "rock");
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
  const L = Math.hypot(dx, dy);
  const hd = Math.atan2(dy, dx) / D5;
  const rng = new Random(g2(e2, "seed", Math.trunc(Math.abs(p0[0] * 3 + p0[1] * 17)) + 11));
  const f = new Frame(ctx, [p0[0], p0[1], g2(e2, "z", 0)], hd - 90);
  const rock = (lx, ly, lz, size, r) => {
    const [c] = ctx.xf(f.p(lx, ly, lz));
    const seed = Math.floor(rng.random() * 1e6);
    for (const v of ["hi", "lo"]) ctx.withVariant(v, c, () => ctx.builder(mat).addBlob(
      c,
      0.5,
      [size[0], size[1], size[2]],
      seed,
      v === "hi" ? 1 : 0,
      v === "hi" ? 0.32 : 0.18,
      ctx.uvScale(mat),
      true,
      f.r(r)
    ));
  };
  if (ctx.geometry) {
    let s = -1.5;
    while (s < L + 1.5) {
      const w = rng.uniform(2.2, 6);
      const hh = h * rng.uniform(0.95, 1.5);
      const dd = depth * rng.uniform(0.8, 1.3);
      const tiers = hh > h * 1.2 ? 3 : 2;
      for (let k = 0; k < tiers; k++) {
        const th = hh / tiers * 1.45;
        rock(
          rng.uniform(-0.6, 0.6) + depth * (0.15 + 0.12 * k),
          s + w / 2 + rng.uniform(-0.6, 0.6),
          hh / tiers * (k + 0.5) - 0.3,
          [dd * (1.25 - 0.12 * k), w * rng.uniform(1.35, 1.7), th],
          [rng.uniform(-22, 22), rng.uniform(-9, 9), rng.uniform(-10, 10)]
        );
      }
      if (rng.random() < 0.75) {
        const cs = rng.uniform(1.4, 3);
        rock(
          depth * 0.4 + rng.uniform(-0.3, 0.6),
          s + rng.uniform(0, w),
          hh - 0.3 + cs * 0.3,
          [cs * 1.6, cs * 1.4, cs * 1.1],
          [rng.uniform(0, 90), rng.uniform(-15, 15), rng.uniform(-15, 15)]
        );
        if (rng.random() < 0.4) rock(depth * 0.5, s + rng.uniform(0, w), hh + cs * 0.5, [cs, cs * 0.9, cs * 0.8], [rng.uniform(0, 90), 0, rng.uniform(-20, 20)]);
      }
      const nf = rng.random() < 0.85 ? 1 + Math.floor(rng.random() * 3) : 0;
      for (let k = 0; k < nf; k++) {
        const sz = rng.uniform(0.5, 1.7);
        rock(
          -depth / 2 - sz * 0.25,
          s + rng.uniform(0, w),
          sz * 0.3,
          [sz * 1.5, sz * 1.3, sz * 1.05],
          [rng.uniform(0, 90), rng.uniform(-12, 12), rng.uniform(-12, 12)]
        );
      }
      s += w * rng.uniform(0.7, 0.9);
    }
  }
  f.col(depth * 0.15, L / 2, h / 2 + 2, [depth, L + 2, h + 4], "concrete", void 0, true);
};
PREFABS.rocks = (ctx, e2) => {
  const base = e2.base;
  const n = Math.trunc(g2(e2, "count", 4));
  const s = g2(e2, "size", 1.2);
  const spread = g2(e2, "spread", 2);
  const rng = new Random(g2(e2, "seed", 5));
  const mat = g2(e2, "mat", "rock");
  for (let i = 0; i < n; i++) {
    const lx = i === 0 ? 0 : rng.uniform(-spread, spread), ly = i === 0 ? 0 : rng.uniform(-spread, spread);
    const sz = s * (i === 0 ? 1 : rng.uniform(0.35, 0.8));
    const hd = rng.uniform(0, 90);
    const dims = [sz * rng.uniform(1.1, 1.6), sz * rng.uniform(0.9, 1.3), sz * rng.uniform(0.6, 0.95)];
    const f = new Frame(ctx, [base[0] + lx, base[1] + ly, base[2] ?? 0], hd);
    const tilt = [0, rng.uniform(-6, 6), rng.uniform(-6, 6)];
    if (ctx.geometry) {
      const [c] = ctx.xf(f.p(0, 0, dims[2] / 2 - 0.12));
      const seed = Math.trunc(Math.abs(base[0] * 131 + base[1] * 71)) + i * 977;
      ctx.builder(mat).addBlob(c, 0.5, [dims[0] * 1.08, dims[1] * 1.08, dims[2] * 1.12], seed, 1, 0.22, ctx.uvScale(mat), true, f.r(tilt));
    }
    if (sz > 0.45) f.col(0, 0, dims[2] / 2 - 0.08, [dims[0] * 0.9, dims[1] * 0.9, dims[2]], "concrete", void 0, true);
  }
};
var GOODS_COLORS = ["jingle_red", "jingle_yellow", "jingle_green", "jingle_blue", "cloth_white", "carpet_red", "fruit_orange", "tarp_blue"];
function goods(f, kind, w, d, rng) {
  if (kind === "fruit") {
    f.box(0, 0, 0.45, [w, d, 0.06], "wood_old", [0, -12, 0]);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) f.box(sx * (w / 2 - 0.05), sy * (d / 2 - 0.05), 0.3, [0.06, 0.06, 0.6], "wood_old");
    const cols = Math.max(Math.floor(w / 0.55), 1);
    for (let i = 0; i < cols; i++) for (let j = 0; j < 2; j++) {
      const lx = -w / 2 + 0.3 + i * (w - 0.6) / Math.max(cols - 1, 1);
      const ly = (j - 0.5) * d * 0.5;
      const lz = 0.55 + (j === 0 ? 0.06 : -0.06);
      f.box(lx, ly, lz - 0.05, [0.48, 0.36, 0.025], "wood_old");
      for (const sy of [-1, 1]) for (let row = 0; row < 2; row++) f.box(lx, ly + sy * 0.175, lz + row * 0.065, [0.48, 0.018, 0.045], "wood_old");
      for (const sx of [-1, 1]) f.box(lx + sx * 0.23, ly, lz + 0.02, [0.025, 0.34, 0.13], "wood_old");
      const fruit = rng.choice(["fruit_orange", "fruit_green"]);
      for (let k = 0; k < 9; k++) f.ball(lx + (k % 3 - 1) * 0.13 + rng.uniform(-0.015, 0.015), ly + (Math.floor(k / 3) - 1) * 0.105 + rng.uniform(-0.012, 0.012), lz + 0.1 + rng.uniform(0, 0.035), 0.057 + rng.uniform(0, 0.01), fruit, 5, 8);
    }
  } else if (kind === "rugs") {
    for (let i = 0; i < 4; i++) f.box(0, (i - 1.5) * 0.02, 0.1 + i * 0.12, [w * 0.85, d * 0.8, 0.1], rng.choice(["carpet_red", "carpet_blue", "carpet_red"]), [rng.uniform(-4, 4), 0, 0]);
    f.box(0, 0, 1, [w * 0.9, d * 0.6, 0.06], "wood_old");
  } else if (kind === "tires") {
    for (let i = 0; i < Math.floor(w / 0.7); i++) {
      const n = 3 + Math.floor(rng.random() * 4);
      for (let k = 0; k < n; k++) f.cyl(-w / 2 + 0.35 + i * 0.7, rng.uniform(-0.1, 0.1), 0.1 + k * 0.2, 0.32, 0.19, "rubber", 16);
    }
  } else if (kind === "cans") {
    for (const zz of [0.4, 0.85, 1.3]) {
      f.box(0, 0, zz - 0.03, [w, d, 0.04], "wood_old");
      let x = -w / 2 + 0.1;
      while (x < w / 2 - 0.2) {
        const bw = rng.uniform(0.12, 0.3);
        f.box(x + bw / 2, 0, zz + 0.1, [bw, d * 0.7, rng.uniform(0.12, 0.3)], rng.choice(GOODS_COLORS));
        x += bw + 0.03;
      }
    }
  } else if (kind === "cloth") {
    for (let i = 0; i < Math.floor(w / 0.32); i++) {
      for (let k = 0; k < 3; k++) f.cylY(-w / 2 + 0.2 + i * 0.32, 0, 0.18 + k * 0.28, 0.13, d * 0.8, rng.choice(GOODS_COLORS), 10);
    }
  } else if (kind === "sacks") {
    for (let i = 0; i < 8; i++) {
      f.bev(-w / 2 + 0.4 + i % 4 * (w - 0.8) / 3, (Math.floor(i / 4) - 0.5) * 0.5, 0.25, [0.55, 0.4, 0.5], "sack", 0.12, [rng.uniform(-10, 10), 0, 0]);
    }
  }
}
PREFABS.shop = (ctx, e2) => {
  const base = e2.base;
  const hd = g2(e2, "heading", 0);
  const style = g2(e2, "style", "container");
  const W = g2(e2, "width", style === "container" ? 6.06 : 3.6);
  const Dp = g2(e2, "depth", style === "container" ? 2.44 : 3);
  const H = g2(e2, "height", style === "container" ? 2.59 : 2.8);
  const rng = new Random(g2(e2, "seed", Math.trunc(Math.abs(base[0] * 31 + base[1] * 17)) + 1));
  const kind = g2(e2, "goods", rng.choice(["fruit", "rugs", "tires", "cans", "cloth", "sacks"]));
  const f = new Frame(ctx, base, hd);
  const t = style === "container" ? 0.08 : 0.35;
  const wm = style === "container" ? g2(e2, "mat", rng.choice(["container_red", "container_green", "container_blue", "corrugated_rust"])) : g2(e2, "mat", "mud_wall");
  const inner = style === "container" ? wm : "mud_wall_light";
  f.solid(0, Dp / 2 - t / 2, H / 2, [W, t, H], wm);
  for (const sx of [-1, 1]) f.solid(sx * (W / 2 - t / 2), 0, H / 2, [t, Dp, H], wm);
  f.solid(0, 0, H - 0.05, [W, Dp, 0.1], style === "container" ? wm : "mud_roof");
  f.box(0, 0, 0.02, [W - 2 * t, Dp - t, 0.04], style === "container" ? "wood_planks" : "dirt");
  if (style === "container") {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      f.box(sx * (W / 2 - 0.08), sy * (Dp / 2 - 0.08), H / 2, [0.17, 0.17, H + 0.01], "steel_painted");
      for (const zz of [0.08, H - 0.08]) f.box(sx * (W / 2 - 0.09), sy * (Dp / 2 - 0.09), zz, [0.2, 0.2, 0.17], "steel");
    }
    for (const zz of [0.1, H - 0.1]) f.box(0, -Dp / 2 + 0.06, zz, [W, 0.12, 0.2], "steel_painted");
  } else {
    for (const sx of [-1, 1]) f.box(sx * (W / 2 - 0.1), -Dp / 2 + 0.05, H / 2, [0.18, 0.12, H], "wood_old");
    f.bev(0, -Dp / 2 + 0.05, H - 0.2, [W + 0.3, 0.2, 0.22], "wood_old", 0.03);
    f.box(0, 0, H + 0.12, [W + 0.2, Dp + 0.2, 0.25], "mud_wall");
  }
  f.cylX(0, -Dp / 2 + 0.12, H - 0.3, 0.14, W - 0.3, g2(e2, "shutter_mat", rng.choice(["metal_blue", "metal_green", "steel_painted"])), 12);
  const aw = g2(e2, "awning", 1.6);
  if (aw > 0) {
    const am = g2(e2, "awning_mat", rng.choice(["tarp_blue", "canvas", "awning_stripe", "corrugated_rust", "carpet_red"]));
    const drop = 0.35;
    const ang = Math.atan2(drop, aw) / D5;
    if (am.startsWith("corrugated")) f.wavy(0, -Dp / 2 - aw / 2, H - drop / 2 + 0.05, W + 0.2, Math.hypot(aw, drop), ang, am);
    else cloth(new Frame(ctx, f.p(0, -Dp / 2 - aw / 2, 0), hd), W + 0.2, aw, H - drop + 0.05, H + 0.05, am, 0.13);
    for (const sx of [-1, 1]) {
      f.box(sx * (W / 2 - 0.05), -Dp / 2 - aw + 0.05, (H - drop) / 2, [0.07, 0.07, H - drop], "wood_old");
      f.col(sx * (W / 2 - 0.05), -Dp / 2 - aw + 0.05, (H - drop) / 2, [0.12, 0.12, H - drop], "wood");
    }
    f.box(0, -Dp / 2 - aw + 0.05, H - drop - 0.04, [W + 0.1, 0.06, 0.08], "wood_old");
  }
  const cw = W * 0.45;
  f.solid(-W / 2 + t + cw / 2 + 0.1, -Dp / 2 + 0.45, 0.45, [cw, 0.6, 0.9], style === "container" ? "wood_planks" : "mud_plinth", void 0, false);
  f.box(-W / 2 + t + cw / 2 + 0.1, -Dp / 2 + 0.45, 0.92, [cw + 0.1, 0.7, 0.05], "wood_old");
  const gf = new Frame(ctx, f.p(W * 0.12, Dp * 0.12, 0), hd);
  goods(gf, kind, W * 0.55, Dp * 0.55, rng);
  f.col(W * 0.12, Dp * 0.12, 0.4, [W * 0.5, Dp * 0.45, 0.8], "wood");
  if (kind === "rugs" || kind === "cloth") {
    for (let i = 0; i < 3; i++) hangingCloth(f, -W / 2 + 0.6 + i * 0.9, -Dp / 2 - 0.1, H - 0.25, 0.8, 1.3, rng.choice(["carpet_red", "carpet_blue", "cloth_green"]));
  }
  if (g2(e2, "light", true)) ctx.light({ pos: f.p(0, 0.2, H - 0.25), kind: "point", fixture: "bulb", kelvin: 2700, intensity: 4, range: 6, shadows: false });
  if (e2.sign) ctx.prop("sign", { text: e2.sign, pos: f.p(0, -Dp / 2 - 0.02, H + 0.25), heading: hd, scale: g2(e2, "sign_scale", 0.3), color: g2(e2, "sign_color", [0.9, 0.85, 0.7, 1]) });
};
PREFABS.awning = (ctx, e2) => {
  const [[x0, y0], [x1, y1]] = [e2.min, e2.max];
  const h = g2(e2, "height", 3);
  const mat = g2(e2, "mat", "tarp_blue");
  const sp = g2(e2, "spacing", 3);
  const nx = Math.max(Math.round((x1 - x0) / sp), 1), ny = Math.max(Math.round((y1 - y0) / sp), 1);
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) {
    if (i > 0 && i < nx && j > 0 && j < ny) continue;
    const x = x0 + (x1 - x0) * i / nx, y = y0 + (y1 - y0) * j / ny;
    ctx.cylinder([x, y, h / 2], 0.06, h, "wood_old", 8);
    ctx.collider([x, y, h / 2], [0.12, 0.12, h], [0, 0, 0], "wood");
  }
  if (!ctx.geometry) return;
  for (let i = 0; i <= nx; i++) ctx.box([x0 + (x1 - x0) * i / nx, (y0 + y1) / 2, h], [0.1, y1 - y0, 0.1], "wood_old", { collide: false, occlude: false });
  cloth(new Frame(ctx, [(x0 + x1) / 2, (y0 + y1) / 2, 0], 0), x1 - x0 + 0.12, y1 - y0 + 0.12, h + 0.09, h + 0.06, mat, 0.2);
};
PREFABS.bunting = (ctx, e2) => {
  if (!ctx.geometry) return;
  const p0 = e2.p0, p1 = e2.p1;
  const z0 = g2(e2, "z", 4), z1 = g2(e2, "z1", z0);
  const sag = g2(e2, "sag", 0.6);
  const rng = new Random(g2(e2, "seed", 2));
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
  const L = Math.hypot(dx, dy);
  const hd = Math.atan2(dy, dx) / D5;
  const n = Math.max(Math.floor(L / 0.45), 2);
  const cols = g2(e2, "colors", ["jingle_red", "jingle_green", "jingle_yellow", "cloth_white", "jingle_blue"]);
  let prev = null;
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const z = z0 + (z1 - z0) * s - sag * 4 * s * (1 - s);
    const p = [p0[0] + dx * s, p0[1] + dy * s, z];
    if (prev) {
      const seg = Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
      const pitch = Math.atan2(p[2] - prev[2], Math.hypot(p[0] - prev[0], p[1] - prev[1])) / D5;
      ctx.box([(p[0] + prev[0]) / 2, (p[1] + prev[1]) / 2, (p[2] + prev[2]) / 2], [i % 2 ? 0.014 : 0.019, seg, i % 2 ? 0.014 : 0.019], "steel", { hpr: [hd - 90, pitch, 0], collide: false, occlude: false });
      ctx.box([(p[0] + prev[0]) / 2, (p[1] + prev[1]) / 2, (p[2] + prev[2]) / 2 - 0.13], [0.24, 6e-3, 0.24], cols[i % cols.length], { hpr: [hd, 0, 45 + rng.uniform(-5, 5)], collide: false, occlude: false });
    }
    prev = p;
  }
};
PREFABS.power_line = (ctx, e2) => {
  const pts = e2.points;
  const h = g2(e2, "height", 7);
  const sag = g2(e2, "sag", 0.7);
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    const nxt = pts[Math.min(i + 1, pts.length - 1)], prv = pts[Math.max(i - 1, 0)];
    const hd = Math.atan2(nxt[1] - prv[1], nxt[0] - prv[0]) / D5;
    ctx.cylinder([x, y, h / 2], 0.12, h, "wood_old", 10);
    ctx.collider([x, y, h / 2], [0.24, 0.24, h], [0, 0, 0], "wood");
    if (ctx.geometry) {
      const f = new Frame(ctx, [x, y, 0], hd);
      f.box(0, 0, h - 0.4, [0.1, 1.6, 0.1], "wood_old");
      for (const ly of [-0.7, 0, 0.7]) f.cyl(0, ly, h - 0.28, 0.035, 0.14, "cloth_white", 8);
      if (i === Math.floor(pts.length / 2)) f.cyl(0.3, 0, h - 1.4, 0.22, 0.6, "steel_painted", 12);
    }
  }
  if (!ctx.geometry) return;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const hd = Math.atan2(b[1] - a[1], b[0] - a[0]) / D5;
    const [ox, oy] = rot2d2(1, 0, hd + 90);
    for (const off of [-0.7, 0, 0.7]) {
      const segs = 6;
      let prev = null;
      for (let k = 0; k <= segs; k++) {
        const s = k / segs;
        const p = [a[0] + (b[0] - a[0]) * s + ox * off, a[1] + (b[1] - a[1]) * s + oy * off, h - 0.22 - sag * 4 * s * (1 - s)];
        if (prev) {
          const seg = Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
          const pitch = Math.atan2(p[2] - prev[2], Math.hypot(p[0] - prev[0], p[1] - prev[1])) / D5;
          const wt = k % 2 ? 0.02 : 0.027;
          ctx.box([(p[0] + prev[0]) / 2, (p[1] + prev[1]) / 2, (p[2] + prev[2]) / 2], [wt, seg + 0.01, wt], "rubber", { hpr: [hd - 90, pitch, 0], collide: false, occlude: false });
        }
        prev = p;
      }
    }
  }
};
PREFABS.tree = (ctx, e2) => {
  const base = e2.base;
  const kind = g2(e2, "kind", "mulberry");
  const rng = new Random(g2(e2, "seed", Math.trunc(Math.abs(base[0] * 7 + base[1] * 3)) + 1));
  const h = g2(e2, "height", kind === "poplar" ? 11 : kind === "apricot" ? 4.5 : 7);
  const leaf = g2(e2, "mat", kind === "poplar" ? "foliage" : "foliage_dark");
  const f = new Frame(ctx, base, rng.uniform(0, 360));
  const tr = kind === "poplar" ? 0.16 : kind === "apricot" ? 0.12 : 0.24;
  const trunkH = kind === "poplar" ? h * 0.9 : h * 0.5;
  f.cyl(0, 0, trunkH / 2, tr, trunkH, "bark", 10, [0, rng.uniform(-3, 3), rng.uniform(-3, 3)]);
  f.col(0, 0, Math.min(trunkH, 3) / 2, [tr * 2, tr * 2, Math.min(trunkH, 3)], "wood");
  if (!ctx.geometry) return;
  const clumps = [];
  const clump = (x, y, z, r, sc, light) => {
    clumps.push({ c: ctx.xf(f.p(x, y, z))[0], r, sc, light, seed: Math.floor(rng.random() * 1e6) });
  };
  const emitCrown = () => {
    for (const v of ["hi", "lo"]) ctx.withVariant(v, ctx.xf(base)[0], () => {
      for (const k of clumps) ctx.builder(k.light ? "foliage" : leaf).addBlob(
        k.c,
        k.r,
        [k.sc[0], k.sc[1], k.sc[2]],
        k.seed,
        v === "hi" ? 1 : 0,
        v === "hi" ? 0.38 : 0.2,
        ctx.uvScale(leaf)
      );
    });
  };
  if (kind === "poplar") {
    const n = 22;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const zz = h * 0.28 + h * 0.7 * t;
      const width = 1.05 * Math.sin(Math.PI * (t * 0.92 + 0.08)) + 0.25;
      const a = rng.uniform(0, 2 * Math.PI), rr = rng.uniform(0, width * 0.35);
      clump(Math.cos(a) * rr, Math.sin(a) * rr, zz, width * rng.uniform(0.5, 0.72), [1, 1, rng.uniform(1.05, 1.35)], t > 0.6 && rng.random() < 0.5);
    }
  } else {
    for (let k = 0; k < 5; k++) {
      const a = k * 72 + rng.uniform(-20, 20);
      const [bx, by] = rot2d2(0, 0.9, a);
      f.cyl(bx * 0.5, by * 0.5, trunkH + 0.5, tr * 0.45, 1.8, "bark", 7, [a, rng.uniform(28, 45), 0]);
    }
    const n = kind === "apricot" ? 14 : 26;
    const R = kind === "apricot" ? 1.7 : 3;
    const top = h - trunkH;
    for (let i = 0; i < n; i++) {
      const a = rng.uniform(0, 2 * Math.PI);
      const u = Math.sqrt(rng.random());
      const rr = u * R * 0.85;
      const zz = trunkH + 0.4 + top * (0.25 + 0.6 * Math.sqrt(Math.max(0, 1 - u * u)) * rng.uniform(0.7, 1.05));
      const r = rng.uniform(R * 0.28, R * 0.42);
      clump(Math.cos(a) * rr, Math.sin(a) * rr, zz, r, [1.15, 1.15, 0.8], zz > trunkH + top * 0.7 && rng.random() < 0.55);
    }
  }
  emitCrown();
};
PREFABS.prop = (ctx, e2) => {
  const base = e2.base;
  const hd = g2(e2, "heading", 0);
  const kind = g2(e2, "kind", "charpoy");
  const rng = new Random(g2(e2, "seed", Math.trunc(Math.abs(base[0] * 5 + base[1] * 9)) + 2));
  const f = new Frame(ctx, base, hd);
  if (kind === "charpoy") {
    for (const sx of [-1, 1]) f.box(sx * 0.42, 0, 0.42, [0.07, 1.95, 0.07], "wood_old");
    for (const sy of [-1, 1]) f.box(0, sy * 0.95, 0.42, [0.9, 0.062, 0.062], "wood_old");
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) f.cyl(sx * 0.42, sy * 0.95, 0.22, 0.045, 0.46, "wood_old", 8);
    f.box(0, 0, 0.44, [0.8, 1.85, 0.02], "rope");
    if (rng.random() < 0.5) f.box(0, 0.2, 0.47, [0.75, 1, 0.04], rng.choice(["carpet_red", "carpet_blue"]));
    f.col(0, 0, 0.23, [0.9, 2, 0.46], "wood");
  } else if (kind === "tandoor") {
    f.cyl(0, 0, 0.42, 0.55, 0.84, "mud_plinth", 18);
    f.cyl(0, 0, 0.85, 0.32, 0.02, "shadow", 14);
    f.cyl(0, 0, 0.88, 0.58, 0.08, "mud_wall", 18, void 0, false);
    f.col(0, 0, 0.45, [1, 1, 0.9], "plaster", void 0, true);
  } else if (kind === "well") {
    f.cyl(0, 0, 0.4, 0.9, 0.8, "stone_wall", 20, void 0, false);
    f.cyl(0, 0, 0.4, 0.72, 0.8, "stone_wall", 20, void 0, false);
    f.cyl(0, 0, 0.81, 0.82, 0.04, "shadow", 20);
    f.cyl(0, 0, 0.82, 0.91, 0.06, "stone_wall", 20, void 0, false);
    for (const sx of [-1, 1]) f.box(sx * 0.95, 0, 1.2, [0.12, 0.12, 2.4], "wood_old");
    f.cylX(0, 0, 2.2, 0.08, 2.1, "wood_old", 8);
    f.box(0, 0, 1.4, [0.01, 0.01, 1.6], "rope");
    f.cyl(0, 0, 0.62, 0.15, 0.25, "steel", 10);
    f.col(0, 0, 0.45, [1.8, 1.8, 0.9], "concrete", void 0, true);
  } else if (kind === "cart") {
    f.box(0, 0, 0.75, [1.1, 1.8, 0.05], "wood_planks");
    for (const sx of [-1, 1]) f.box(sx * 0.53, 0, 0.88, [0.04, 1.8, 0.22], "wood_old");
    for (const sx of [-1, 1]) f.box(sx * 0.4, -1.5, 0.82, [0.06, 1.4, 0.06], "wood_old", [0, -6, 0]);
    for (const sx of [-1, 1]) {
      f.cylX(sx * 0.62, 0.2, 0.42, 0.42, 0.08, "rubber", 18);
      f.cylX(sx * 0.65, 0.2, 0.42, 0.3, 0.02, "steel", 12);
    }
    f.cylX(0, 0.2, 0.42, 0.03, 1.3, "steel", 6);
    goods(new Frame(ctx, f.p(0, 0, 0.75), hd), rng.choice(["fruit", "sacks", "cans"]), 0.9, 1.4, rng);
    f.col(0, 0, 0.55, [1.3, 1.9, 1.1], "wood");
  } else if (kind === "firewood") {
    const L = g2(e2, "length", 2);
    for (let i = 0; i < 18; i++) f.cylX(rng.uniform(-0.1, 0.1), (i % 6 - 2.5) * 0.15, 0.08 + Math.floor(i / 6) * 0.14, 0.075, L + rng.uniform(-0.3, 0.3), rng.choice(["wood_old", "bark"]), 7);
    f.col(0, 0, 0.25, [L, 0.95, 0.5], "wood");
  } else if (kind === "hay") {
    f.dome(0, 0, 0, g2(e2, "radius", 1.4), "hay", g2(e2, "squash", 1.2), 16);
    const r = g2(e2, "radius", 1.4);
    f.col(0, 0, r * 0.5, [r * 1.4, r * 1.4, r], "fabric", void 0, true);
  } else if (kind === "jerrycans") {
    const n = Math.trunc(g2(e2, "count", 4));
    for (let i = 0; i < n; i++) {
      const lx = i % 4 * 0.2 - 0.3, lz = Math.floor(i / 4) * 0.46;
      f.bev(lx, 0, lz + 0.23, [0.17, 0.36, 0.46], rng.choice(["jingle_green", "jingle_yellow", "jingle_red", "vehicle_od"]), 0.03);
      f.box(lx, -0.08, lz + 0.48, [0.04, 0.12, 0.04], "steel");
    }
    f.col(0, 0, 0.25, [0.8, 0.4, 0.5], "metal");
  } else if (kind === "fuel_pump") {
    f.bev(0, 0, 0.12, [0.9, 0.6, 0.24], "concrete_barrier", 0.03);
    f.bev(0, 0, 1, [0.62, 0.42, 1.5], g2(e2, "mat", "jingle_green"), 0.04);
    f.box(0, -0.215, 1.35, [0.42, 0.01, 0.3], "glass_dark");
    f.box(0, -0.215, 1.05, [0.3, 0.01, 0.1], "headlight");
    for (const sx of [-1, 1]) {
      f.box(sx * 0.33, 0, 0.95, [0.06, 0.12, 0.2], "rubber");
      f.box(sx * 0.4, -0.1, 0.6, [0.03, 0.03, 0.7], "rubber", [0, 0, sx * 12]);
    }
    f.box(0, 0, 1.8, [0.66, 0.46, 0.08], "paint_white");
    f.col(0, 0, 0.9, [0.9, 0.6, 1.8], "metal", void 0, true);
  } else if (kind === "sacks") {
    const n = Math.trunc(g2(e2, "count", 6));
    for (let i = 0; i < n; i++) {
      const row = i % 3, layer = Math.floor(i / 3);
      f.bev((row - 1) * 0.58 + layer % 2 * 0.2, rng.uniform(-0.05, 0.05), 0.2 + layer * 0.36, [0.55, 0.85, 0.4], "sack", 0.12, [rng.uniform(-8, 8), 0, 0]);
    }
    const layers = Math.ceil(n / 3);
    f.col(0, 0, layers * 0.18 + 0.02, [1.8, 0.9, layers * 0.36 + 0.04], "fabric", void 0, true);
  } else if (kind === "water_jars") {
    for (let i = 0; i < 3; i++) {
      f.cyl((i - 1) * 0.5, 0, 0.3, 0.2, 0.5, "clay", 12);
      f.ball((i - 1) * 0.5, 0, 0.55, 0.2, "clay", 5, 10);
      f.cyl((i - 1) * 0.5, 0, 0.78, 0.08, 0.12, "clay", 10);
    }
    f.col(0, 0, 0.4, [1.5, 0.45, 0.8], "plaster");
  } else if (kind === "bench") {
    const L = g2(e2, "length", 2);
    f.box(0, 0, 0.45, [L, 0.45, 0.06], "wood_old");
    for (const sx of [-1, 1]) f.box(sx * (L / 2 - 0.1), 0, 0.22, [0.07, 0.4, 0.44], "wood_old");
    f.col(0, 0, 0.24, [L, 0.45, 0.48], "wood");
  } else if (kind === "tires") {
    const n = Math.trunc(g2(e2, "count", 6));
    for (let k = 0; k < n; k++) f.cyl(rng.uniform(-0.04, 0.04), rng.uniform(-0.04, 0.04), 0.11 + k * 0.21, 0.36, 0.2, "rubber", 18);
    f.cyl(0, 0, n * 0.21 + 0.02, 0.2, 0.02, "shadow", 12);
    f.col(0, 0, n * 0.105, [0.7, 0.7, n * 0.21], "fabric", void 0, true);
  } else if (kind === "drums") {
    const n = Math.trunc(g2(e2, "count", 4));
    const cols = ["jingle_blue", "jingle_red", "metal_olive", "rust_metal", "jingle_yellow"];
    for (let k = 0; k < n; k++) {
      const lx = k % 3 * 0.62 - 0.62, ly = Math.floor(k / 3) * 0.62;
      const m = cols[(k + Math.floor(rng.random() * 5)) % cols.length];
      f.cyl(lx, ly, 0.44, 0.29, 0.88, m, 18);
      for (const zz of [0.28, 0.6]) f.cyl(lx, ly, zz, 0.302, 0.035, m, 18, void 0, false);
      f.cyl(lx + 0.15, ly, 0.885, 0.04, 0.02, "steel", 8);
    }
    const rows = Math.ceil(n / 3);
    f.col(0, (rows - 1) * 0.31, 0.44, [1.86, rows * 0.62, 0.88], "metal", void 0, true);
  } else if (kind === "fountain") {
    const r = g2(e2, "radius", 2.2);
    f.cyl(0, 0, 0.3, r, 0.6, "stone_wall", 28, void 0, false);
    f.cyl(0, 0, 0.62, r + 0.08, 0.06, "concrete_barrier", 28, void 0, false);
    f.cyl(0, 0, 0.45, r - 0.05, 0.02, "water", 28);
    f.cyl(0, 0, 0.75, 0.25, 0.9, "concrete_barrier", 12);
    f.cyl(0, 0, 1.25, 0.7, 0.1, "concrete_barrier", 18);
    f.col(0, 0, 0.33, [r * 1.75, r * 1.75, 0.66], "concrete", void 0, true);
  } else if (kind === "samovar") {
    f.box(0, 0, 0.38, [1.2, 0.6, 0.76], "mud_plinth");
    f.cyl(-0.25, 0, 1, 0.2, 0.5, "brass", 14);
    f.dome(-0.25, 0, 1.25, 0.2, "brass", 0.7, 14);
    f.cyl(0.3, 0, 0.88, 0.14, 0.24, "steel", 12);
    for (let i = 0; i < 4; i++) f.cyl(0.1 + i * 0.1, 0.18, 0.8, 0.03, 0.07, "cloth_white", 8);
    f.col(0, 0, 0.45, [1.2, 0.6, 0.9], "plaster");
  }
};
PREFABS.minar = (ctx, e2) => {
  const base = e2.base;
  const f = new Frame(ctx, base, 0);
  const h = g2(e2, "height", 10);
  f.cyl(0, 0, 0.2, 3.2, 0.4, "concrete_barrier", 32);
  f.cyl(0, 0, 0.55, 2.4, 0.3, "stone_wall", 28);
  f.cyl(0, 0, 1.2, 1.3, 1, "stone_wall", 20);
  f.cyl(0, 0, 1.2 + h / 2, 0.75, h - 1.4, "tile_turquoise", 20);
  for (const zz of [2.2, h * 0.45, h * 0.75]) f.cyl(0, 0, zz, 0.82, 0.18, "mud_brick", 20);
  f.cyl(0, 0, h + 0.05, 1.15, 0.2, "mud_brick", 20);
  for (let k = 0; k < 12; k++) {
    const a = k / 12 * 2 * Math.PI;
    f.box(Math.cos(a) * 1.05, Math.sin(a) * 1.05, h + 0.45, [0.08, 0.08, 0.6], "mud_brick");
  }
  f.cyl(0, 0, h + 0.8, 1.1, 0.1, "mud_brick", 20);
  f.cyl(0, 0, h + 1.3, 0.55, 1, "tile_turquoise", 16);
  f.dome(0, 0, h + 1.8, 0.62, "tile_turquoise", 1.1, 16);
  f.cyl(0, 0, h + 2.6, 0.04, 0.6, "brass", 6);
  f.col(0, 0, 0.35, [5.2, 5.2, 0.7], "concrete", void 0, true);
  f.col(0, 0, 1 + h / 2, [1.6, 1.6, h + 2], "concrete", void 0, true);
};
var vehicleBase = PREFABS.vehicle;
function glass(e2) {
  return g2(e2, "wreck", false) ? "shadow" : "glass_dark";
}
function hilux(ctx, e2, technical) {
  const f = new Frame(ctx, e2.base, g2(e2, "heading", 0));
  const wreck = g2(e2, "wreck", false);
  const paint = wreck ? "burnt_metal" : g2(e2, "mat", "vehicle_white");
  const trim = wreck ? "burnt_metal" : "rubber";
  const chrome = wreck ? "burnt_metal" : "pbr_chrome";
  const gl = glass(e2);
  const rng = new Random(g2(e2, "seed", 3));
  if (ctx.geometry) {
    for (const sx of [-1, 1]) f.box(sx * 0.42, 0, 0.5, [0.1, 4.9, 0.16], "steel");
    f.cylY(0, -0.6, 0.38, 0.06, 2.6, "steel", 8);
    f.cylX(0, -1.45, 0.38, 0.07, 1.4, "steel", 8);
    f.cylX(0, 1.55, 0.38, 0.06, 1.3, "steel", 8);
    const body = [
      [1.95, 2.72, 0.55, 1.05],
      [1.1, 1.95, 0.82, 1.05],
      [-1, 1.1, 0.5, 1.05],
      [-1.9, -1, 0.82, 1.05],
      [-2.68, -1.9, 0.55, 1.05]
    ];
    for (const [ya, yb, za, zb] of body) f.bev(0, (ya + yb) / 2, (za + zb) / 2, [1.82, yb - ya + 0.02, zb - za], paint, 0.05);
    for (const ly of [1.55, -1.45]) {
      f.box(0, ly, 0.66, [1.5, 0.92, 0.3], "shadow");
      for (const sx of [-1, 1]) f.bev(sx * 0.9, ly, 0.83, [0.08, 0.98, 0.07], trim, 0.02);
    }
    f.bev(0, 1.88, 1.09, [1.78, 1.6, 0.12], paint, 0.05, [0, -3, 0]);
    f.box(0, 1.9, 1.16, [0.5, 1.1, 0.02], paint);
    f.box(0, 2.71, 0.88, [1.2, 0.04, 0.3], "shadow");
    for (let k = 0; k < 4; k++) f.box(0, 2.735, 0.77 + k * 0.075, [1.18, 0.02, 0.02], chrome);
    f.bev(0, 2.74, 0.9, [0.28, 0.03, 0.12], chrome, 0.01);
    for (const sx of [-1, 1]) {
      f.bev(sx * 0.72, 2.71, 0.93, [0.32, 0.05, 0.15], wreck ? "shadow" : "headlight", 0.02);
      f.box(sx * 0.82, 2.7, 0.8, [0.12, 0.05, 0.06], wreck ? "shadow" : "fruit_orange");
    }
    f.bev(0, 2.8, 0.6, [1.9, 0.18, 0.2], technical ? "steel" : chrome, 0.05);
    f.box(0, 2.9, 0.62, [0.5, 0.01, 0.12], "paint_white");
    if (technical || g2(e2, "bullbar", false)) {
      for (const sx of [-1, 1]) f.box(sx * 0.55, 2.95, 0.85, [0.06, 0.06, 0.6], "steel");
      f.box(0, 2.95, 1.12, [1.2, 0.06, 0.06], "steel");
      f.box(0, 2.95, 0.85, [1.2, 0.05, 0.05], "steel");
    }
    f.bev(0, 0.42, 1.8, [1.62, 1.1, 0.08], paint, 0.04);
    f.box(0, 1, 1.43, [1.55, 0.03, 0.78], gl, [0, 32, 0]);
    for (const sx of [-1, 1]) {
      f.box(sx * 0.79, 1, 1.43, [0.07, 0.07, 0.8], paint, [0, 32, 0]);
      f.box(sx * 0.8, -0.12, 1.43, [0.07, 0.14, 0.74], paint);
      f.box(sx * 0.805, 0.4, 1.43, [0.02, 0.88, 0.62], gl);
      f.box(sx * 0.805, 0.4, 1.1, [0.025, 1, 0.04], trim);
      f.box(sx * 0.915, 0.42, 0.78, [0.01, 0.02, 0.5], "shadow");
      f.box(sx * 0.915, -0.15, 0.78, [0.01, 0.02, 0.5], "shadow");
      f.box(sx * 0.92, -0.05, 0.95, [0.02, 0.14, 0.04], chrome);
      f.box(sx * 1, 0.95, 1.22, [0.2, 0.05, 0.03], trim);
      f.bev(sx * 1.08, 0.95, 1.22, [0.05, 0.12, 0.17], trim, 0.015);
      f.box(sx * 0.95, -0.05, 0.42, [0.14, 1.9, 0.04], "steel");
      f.box(sx * 0.82, -2, 0.55, [0.2, 0.02, 0.32], "rubber");
    }
    f.box(0, -0.14, 1.43, [1.5, 0.03, 0.48], gl);
    f.box(0, -1.42, 1, [1.66, 2.42, 0.04], wreck ? "burnt_metal" : "steel_painted");
    for (const sx of [-1, 1]) {
      f.bev(sx * 0.87, -1.42, 1.27, [0.07, 2.46, 0.46], paint, 0.02);
      f.box(sx * 0.87, -1.42, 1.51, [0.1, 2.46, 0.04], wreck ? "burnt_metal" : "rubber");
      f.box(sx * 0.9, -2.66, 1.2, [0.07, 0.04, 0.3], wreck ? "shadow" : "paint_red");
    }
    f.bev(0, -0.22, 1.27, [1.8, 0.07, 0.46], paint, 0.02);
    if (g2(e2, "tailgate_down", false)) f.box(0, -2.85, 0.98, [1.72, 0.42, 0.05], paint);
    else {
      f.bev(0, -2.64, 1.27, [1.8, 0.07, 0.46], paint, 0.02);
      f.box(0, -2.68, 1.4, [0.4, 0.01, 0.06], chrome);
    }
    f.bev(0, -2.75, 0.6, [1.86, 0.16, 0.16], "steel", 0.03);
    f.box(0, -2.84, 0.73, [0.45, 0.01, 0.12], "paint_white");
    const cargo = g2(e2, "cargo", technical ? "none" : rng.choice(["sacks", "cans", "none", "tire"]));
    if (cargo === "sacks") for (let i = 0; i < 5; i++) f.bev((i % 2 - 0.5) * 0.7, -0.8 - Math.floor(i / 2) * 0.7, 1.22 + (i === 4 ? 0.3 : 0), [0.6, 0.55, 0.38], "sack", 0.1, [rng.uniform(-10, 10), 0, 0]);
    if (cargo === "cans") for (let i = 0; i < 6; i++) f.bev(-0.6 + i * 0.24, -2.3, 1.25, [0.17, 0.36, 0.46], rng.choice(["jingle_green", "jingle_yellow", "jingle_red"]), 0.03);
    if (cargo === "tire" || technical) f.cyl(0.35, -1, 1.12, 0.38, 0.22, "rubber", 18);
    if (technical) {
      for (const sx of [-1, 1]) f.box(sx * 0.75, -0.42, 1.65, [0.07, 0.07, 1.25], "steel");
      f.box(0, -0.42, 2.27, [1.57, 0.07, 0.07], "steel");
      for (const sx of [-1, 1]) f.box(sx * 0.75, -0.75, 1.75, [0.05, 0.75, 0.05], "steel", [0, 40, 0]);
      f.cyl(0, -1.4, 1.5, 0.07, 1, "steel", 10);
      f.cyl(0, -1.4, 1.03, 0.25, 0.05, "steel", 12);
      const gt2 = new Frame(ctx, f.p(0, -1.4, 2.05), g2(e2, "heading", 0) + g2(e2, "gun_heading", 15));
      gt2.bev(0, 0.1, 0, [0.22, 0.75, 0.2], "gun_metal", 0.02);
      gt2.cylY(0, 1.1, 0.02, 0.035, 1.5, "gun_metal", 8);
      gt2.cylY(0, 0.75, 0.02, 0.06, 0.45, "gun_metal", 10);
      gt2.cylY(0, 1.86, 0.02, 0.05, 0.12, "gun_metal", 8);
      gt2.box(0, -0.4, -0.05, [0.06, 0.4, 0.06], "gun_metal");
      gt2.bev(0.22, 0.1, -0.05, [0.2, 0.32, 0.22], "metal_olive", 0.02);
      gt2.box(0, 0.45, 0.25, [0.7, 0.03, 0.45], "steel_painted", [0, 0, 0]);
    }
    if (!wreck) {
      for (const ly of [1.55, -1.45]) for (const sx of [-1, 1]) f.wheel(sx * 0.78, ly, 0.38, 0.26, g2(e2, "rim_mat", "steel"));
    } else {
      for (const [ly, sx] of [[1.55, 1], [-1.45, -1]]) f.wheel(sx * 0.78, ly, 0.38, 0.26, "burnt_metal", "burnt_metal");
      for (const [ly, sx] of [[1.55, -1], [-1.45, 1]]) f.cylX(sx * 0.78, ly, 0.24, 0.24, 0.12, "burnt_metal", 12);
    }
  }
  f.col(0, 0.05, 0.62, [1.86, 5.5, 0.92], "metal", void 0, true);
  f.col(0, 0.42, 1.45, [1.66, 1.25, 0.74], "metal", void 0, true);
  f.col(0, -1.42, 1.28, [1.84, 2.5, 0.52], "metal");
}
function sedan(ctx, e2) {
  const f = new Frame(ctx, e2.base, g2(e2, "heading", 0));
  const wreck = g2(e2, "wreck", false);
  const paint = wreck ? "burnt_metal" : g2(e2, "mat", "vehicle_yellow");
  const top = wreck ? "burnt_metal" : g2(e2, "mat2", "vehicle_white");
  const gl = glass(e2);
  const chrome = wreck ? "burnt_metal" : "pbr_chrome";
  if (ctx.geometry) {
    const body = [
      [1.65, 2.22, 0.36, 0.84],
      [0.9, 1.65, 0.62, 0.84],
      [-0.85, 0.9, 0.3, 0.84],
      [-1.6, -0.85, 0.62, 0.84],
      [-2.18, -1.6, 0.36, 0.84]
    ];
    for (const [ya, yb, za, zb] of body) f.bev(0, (ya + yb) / 2, (za + zb) / 2, [1.7, yb - ya + 0.02, zb - za], paint, 0.06);
    for (const ly of [1.28, -1.22]) {
      f.box(0, ly, 0.48, [1.4, 0.78, 0.28], "shadow");
      for (const sx of [-1, 1]) f.bev(sx * 0.84, ly, 0.63, [0.07, 0.8, 0.06], "rubber", 0.02);
    }
    f.bev(0, 1.55, 0.86, [1.66, 1.3, 0.06], paint, 0.03, [0, -4, 0]);
    f.bev(0, -1.75, 0.88, [1.64, 0.9, 0.06], paint, 0.03);
    f.bev(0, -0.15, 1.38, [1.4, 1.35, 0.06], top, 0.04);
    f.box(0, 0.8, 1.12, [1.42, 0.03, 0.62], gl, [0, 55, 0]);
    f.box(0, -1.07, 1.12, [1.42, 0.03, 0.6], gl, [0, -55, 0]);
    for (const sx of [-1, 1]) {
      f.box(sx * 0.73, 0.8, 1.12, [0.06, 0.06, 0.64], top, [0, 55, 0]);
      f.box(sx * 0.73, -1.07, 1.12, [0.06, 0.06, 0.62], top, [0, -55, 0]);
      f.box(sx * 0.735, -0.15, 1.12, [0.02, 1.25, 0.42], gl);
      f.box(sx * 0.74, -0.15, 1.12, [0.03, 0.08, 0.46], top);
      f.box(sx * 0.86, 0.1, 0.6, [0.01, 0.02, 0.42], "shadow");
      f.box(sx * 0.86, -0.75, 0.6, [0.01, 0.02, 0.42], "shadow");
      f.box(sx * 0.87, -0.1, 0.74, [0.02, 0.12, 0.03], chrome);
      f.box(sx * 0.87, -0.6, 0.74, [0.02, 0.12, 0.03], chrome);
      f.bev(sx * 0.92, 0.65, 0.98, [0.05, 0.1, 0.12], top, 0.015);
      f.box(sx * 0.6, 2.2, 0.68, [0.36, 0.05, 0.12], wreck ? "shadow" : "headlight");
      f.box(sx * 0.62, -2.17, 0.72, [0.34, 0.05, 0.14], wreck ? "shadow" : "paint_red");
      f.box(sx * 0.865, -0.2, 0.52, [0.01, 3.3, 0.05], "rubber");
    }
    f.box(0, 2.21, 0.58, [0.8, 0.04, 0.14], "shadow");
    f.bev(0, 2.24, 0.42, [1.72, 0.12, 0.16], paint, 0.04);
    f.bev(0, -2.21, 0.42, [1.72, 0.12, 0.16], paint, 0.04);
    f.box(0, 2.31, 0.44, [0.48, 0.01, 0.11], "paint_white");
    f.box(0, -2.28, 0.6, [0.48, 0.01, 0.11], "paint_white");
    if (g2(e2, "taxi", true) && !wreck) f.bev(0, -0.15, 1.47, [0.5, 0.18, 0.12], "jingle_yellow", 0.02);
    if (g2(e2, "roof_load", false)) {
      for (const sx of [-1, 1]) f.box(sx * 0.6, -0.15, 1.44, [0.04, 1.2, 0.04], "steel");
      f.bev(0, -0.15, 1.6, [1.2, 1, 0.3], "tarp_blue", 0.1);
    }
    if (!wreck) for (const ly of [1.28, -1.22]) for (const sx of [-1, 1]) f.wheel(sx * 0.74, ly, 0.31, 0.2, "steel");
    else for (const ly of [1.28, -1.22]) for (const sx of [-1, 1]) f.cylX(sx * 0.74, ly, 0.2, 0.2, 0.12, "burnt_metal", 12);
  }
  f.col(0, 0, 0.48, [1.74, 4.5, 0.8], "metal", void 0, true);
  f.col(0, -0.15, 1.1, [1.4, 1.8, 0.56], "metal", void 0, true);
}
function jingle(ctx, e2) {
  const hd = g2(e2, "heading", 0);
  const f = new Frame(ctx, e2.base, hd);
  const rng = new Random(g2(e2, "seed", 7));
  const pal = ["jingle_red", "jingle_yellow", "jingle_green", "jingle_blue", "cloth_white", "fruit_orange"];
  const main2 = g2(e2, "mat", rng.choice(["jingle_red", "jingle_blue", "jingle_green"]));
  const chrome = "pbr_chrome";
  if (ctx.geometry) {
    for (const sx of [-1, 1]) f.box(sx * 0.48, -0.3, 0.75, [0.14, 7.8, 0.24], "steel");
    f.bev(0, 3.05, 1.45, [1.25, 1.5, 0.95], main2, 0.12);
    f.bev(0, 3.82, 1.35, [1.1, 0.08, 0.85], chrome, 0.02);
    for (let k = 0; k < 7; k++) f.box(-0.45 + k * 0.15, 3.86, 1.35, [0.03, 0.02, 0.75], "shadow");
    for (const sx of [-1, 1]) {
      f.bev(sx * 0.98, 3.05, 1.18, [0.62, 1.55, 0.3], main2, 0.12, [0, -6, 0]);
      f.cylY(sx * 0.95, 3.82, 1.42, 0.13, 0.12, chrome, 14);
      f.cylY(sx * 0.95, 3.89, 1.42, 0.1, 0.02, "headlight", 14);
      f.box(sx * 0.98, 3.1, 0.98, [0.55, 1.3, 0.04], "shadow");
    }
    f.bev(0, 3.98, 0.72, [2.3, 0.22, 0.26], chrome, 0.05);
    f.bev(0, 1.6, 1.95, [2.3, 1.55, 1.5], main2, 0.1);
    f.box(0.52, 2.39, 2.35, [0.9, 0.03, 0.6], "glass_dark", [-6, 12, 0]);
    f.box(-0.52, 2.39, 2.35, [0.9, 0.03, 0.6], "glass_dark", [6, 12, 0]);
    for (const sx of [-1, 1]) {
      f.box(sx * 1.16, 1.75, 2.35, [0.02, 0.8, 0.5], "glass_dark");
      for (let k = 0; k < 3; k++) f.box(sx * 1.16, 1.75, 1.35 + k * 0.22, [0.02, 1 - k * 0.15, 0.14], pal[(k + (sx > 0 ? 1 : 3)) % pal.length]);
      f.box(sx * 1.4, 2.2, 2.2, [0.5, 0.04, 0.04], "steel");
      f.bev(sx * 1.62, 2.2, 2.2, [0.06, 0.2, 0.36], chrome, 0.02);
      f.box(sx * 1.05, 1, 1, [0.3, 0.4, 0.06], "steel");
    }
    f.bev(0, 2.2, 3.15, [2.5, 0.25, 0.9], "wood_planks", 0.05, [0, -14, 0]);
    for (let k = 0; k < 4; k++) f.box(0, 2.38 - k * 0, 2.9 + k * 0.18, [2.4 - k * 0.3, 0.06, 0.12], pal[(k + 2) % pal.length], [0, -14, 0]);
    for (let k = 0; k < 7; k++) f.cyl(-1.05 + k * 0.35, 2.38, 3.35, 0.07, 0.02, chrome, 10, [0, 76, 0]);
    f.bev(0, 2.1, 3.7, [0.6, 0.2, 0.3], pal[3], 0.04, [0, -14, 0]);
    const bodyY = -1.45, bodyL = 4.8, floorZ = 1.25, sideH = 2.1;
    f.box(0, bodyY, floorZ, [2.4, bodyL, 0.12], "wood_planks");
    for (const sx of [-1, 1]) {
      f.box(sx * 1.17, bodyY, floorZ + sideH / 2, [0.08, bodyL, sideH], "wood_planks");
      const cols = 6;
      for (let r = 0; r < 4; r++) for (let c = 0; c < cols; c++) {
        const m = pal[(r * 3 + c * 2 + (sx > 0 ? 1 : 0)) % pal.length];
        f.box(sx * 1.215, bodyY - bodyL / 2 + (c + 0.5) * bodyL / cols, floorZ + 0.3 + r * 0.5, [0.02, bodyL / cols - 0.1, 0.4], m);
      }
      f.box(sx * 1.225, bodyY, floorZ + sideH - 0.04, [0.03, bodyL + 0.05, 0.08], chrome);
      f.box(sx * 1.225, bodyY, floorZ + 0.04, [0.03, bodyL + 0.05, 0.08], chrome);
    }
    f.box(0, bodyY + bodyL / 2, floorZ + sideH / 2, [2.4, 0.08, sideH], "wood_planks");
    f.box(0, bodyY - bodyL / 2, floorZ + sideH / 2, [2.4, 0.08, sideH], "wood_planks");
    const ty = bodyY - bodyL / 2 - 0.045;
    f.box(0, ty, floorZ + 1.6, [2.2, 0.02, 0.7], "jingle_blue");
    f.box(0, ty - 3e-3, floorZ + 1.1, [2.2, 0.02, 0.35], "jingle_green");
    f.box(0, ty - 4e-3, floorZ + 0.6, [2.2, 0.02, 0.6], "tarp_blue");
    f.box(-0.4, ty - 6e-3, floorZ + 1.35, [0.7, 0.02, 0.3], "cloth_white", [0, 0, 18]);
    f.box(0.5, ty - 6e-3, floorZ + 1.35, [0.8, 0.02, 0.3], "cloth_white", [0, 0, -14]);
    const load = g2(e2, "load", rng.choice(["sacks", "tarp", "empty"]));
    if (load !== "empty") {
      f.bev(0, bodyY, floorZ + sideH + 0.25, [2.3, bodyL - 0.2, 0.8], load === "tarp" ? "tarp_blue" : "sack", 0.3);
      if (load === "tarp") for (let k = 0; k < 5; k++) f.box(0, bodyY - bodyL / 2 + 0.5 + k * (bodyL - 1) / 4, floorZ + sideH + 0.62, [2.35, 0.02, 0.02], "rope");
    }
    const chainRow = (lx0, lx1, ly0, ly1, zTop, n) => {
      for (let k = 0; k < n; k++) {
        const s = (k + 0.5) / n;
        const lx = lx0 + (lx1 - lx0) * s, ly = ly0 + (ly1 - ly0) * s;
        const len = 0.18 + 0.1 * (k % 3 / 2);
        f.box(lx, ly, zTop - len / 2, [0.012, 0.012, len], chrome);
        f.box(lx, ly, zTop - len - 0.02, [0.035, 0.035, 0.04], k % 2 ? chrome : "jingle_red");
      }
    };
    chainRow(-1.1, 1.1, 4.1, 4.1, 0.6, 28);
    chainRow(-1.15, 1.15, bodyY - bodyL / 2 - 0.1, bodyY - bodyL / 2 - 0.1, floorZ - 0.05, 28);
    for (const sx of [-1, 1]) chainRow(sx * 1.22, sx * 1.22, bodyY - bodyL / 2 + 0.3, bodyY + bodyL / 2 - 0.3, floorZ - 0.05, 34);
    for (const sx of [-1, 1]) {
      f.box(sx * 0.95, -3.55, 0.6, [0.5, 0.02, 0.6], pal[sx > 0 ? 0 : 2]);
      f.box(sx * 1, bodyY - bodyL / 2 - 0.1, floorZ - 0.2, [0.25, 0.04, 0.12], "paint_red");
    }
    f.box(0, bodyY - bodyL / 2 - 0.1, floorZ - 0.25, [2.2, 0.12, 0.14], "steel");
    for (const sx of [-1, 1]) {
      f.wheel(sx * 0.98, 3.05, 0.5, 0.3, "jingle_red");
      for (const ly of [-1, -2.25]) {
        f.wheel(sx * 0.92, ly, 0.5, 0.28, "jingle_red");
        f.cylX(sx * 0.62, ly, 0.5, 0.5, 0.28, "rubber", 20);
      }
    }
  }
  f.col(0, 2.4, 1.3, [2.35, 3.3, 2.6], "metal", void 0, true);
  f.col(0, -1.45, 1.75, [2.45, 4.9, 3.5], "wood", void 0, true);
}
function motorbike(ctx, e2) {
  const f = new Frame(ctx, e2.base, g2(e2, "heading", 0));
  const paint = g2(e2, "mat", "jingle_red");
  const lean = g2(e2, "lean", 8);
  const r = [0, 0, lean];
  if (ctx.geometry) {
    for (const ly of [0.65, -0.65]) {
      f.cyl(0, ly, 0.31, 0.31, 0.09, "rubber", 18, [0, 0, 90 + lean]);
      f.cyl(0, ly, 0.31, 0.2, 0.1, "steel", 12, [0, 0, 90 + lean]);
    }
    f.box(0, 0, 0.55, [0.08, 1.2, 0.08], "steel", [0, 10, lean]);
    f.bev(0, 0.25, 0.82, [0.26, 0.45, 0.2], paint, 0.06, r);
    f.bev(0, -0.25, 0.82, [0.24, 0.6, 0.08], "rubber", 0.03, r);
    f.box(0, -0.15, 0.48, [0.22, 0.4, 0.25], "steel", r);
    f.box(0, 0.62, 0.65, [0.05, 0.05, 0.65], "steel", [0, -20, lean]);
    f.box(0, 0.5, 1, [0.7, 0.04, 0.04], "steel", r);
    f.bev(0, 0.62, 0.92, [0.16, 0.08, 0.14], "headlight", 0.03, r);
    f.box(0, -0.65, 0.62, [0.18, 0.4, 0.02], paint, r);
    f.box(0.08, -0.5, 0.35, [0.06, 0.7, 0.06], "pbr_chrome", r);
  }
  f.col(0, 0, 0.5, [0.5, 1.9, 1], "metal");
}
function btr(ctx, e2) {
  const f = new Frame(ctx, e2.base, g2(e2, "heading", 0));
  const m = g2(e2, "mat", "rust_metal"), m2 = "burnt_metal";
  const rng = new Random(g2(e2, "seed", 13));
  const tilt = [0, g2(e2, "pitch", 1.5), g2(e2, "roll", 3)];
  if (ctx.geometry) {
    f.bev(0, 0, 1.1, [2.4, 5.6, 0.8], m, 0.06, tilt);
    f.bev(0, 0, 1.75, [2, 5.2, 0.55], m, 0.06, tilt);
    for (const sx of [-1, 1]) f.box(sx * 1.25, 0, 1.68, [0.06, 5.4, 0.75], m, [0, tilt[1], tilt[2] + sx * 22]);
    f.box(0, 3.15, 1.25, [2.2, 0.06, 1.2], m, [0, -55 + tilt[1], tilt[2]]);
    f.box(0, 2.85, 1.85, [1.9, 0.06, 0.7], m, [0, 68 + tilt[1], tilt[2]]);
    f.box(0, -3, 1.45, [2.2, 0.06, 1.2], m, [0, 40 + tilt[1], tilt[2]]);
    for (const sx of [-1, 1]) {
      f.box(sx * 0.4, 2.72, 2, [0.5, 0.04, 0.28], "shadow", [0, 68, 0]);
      f.bev(sx * 0.9, 3.12, 1.55, [0.18, 0.1, 0.18], m2, 0.02);
    }
    f.cyl(0, 0.9, 2.2, 0.6, 0.4, m2, 18);
    f.dome(0, 0.9, 2.4, 0.6, m2, 0.55, 18);
    f.cylY(0, 2, 2.4, 0.06, 2.2, m2, 8);
    f.cylY(0, 1.45, 2.4, 0.12, 0.6, m2, 10);
    f.cyl(-0.5, -1, 2.05, 0.35, 0.05, m2, 14);
    f.cyl(0.5, -1.6, 2.35, 0.35, 0.05, m2, 14, [0, 0, 70]);
    const ys = [2.3, 1, -0.9, -2.2];
    for (const sx of [-1, 1]) for (const ly of ys) {
      if (rng.random() < 0.25) {
        f.cylX(sx * 1.2, ly, 0.35, 0.18, 0.2, "steel", 10);
        continue;
      }
      if (rng.random() < 0.5) f.wheel(sx * 1.25, ly, 0.55, 0.36, m2, "burnt_metal");
      else f.cylX(sx * 1.25, ly, 0.4, 0.4, 0.2, m2, 14);
    }
    for (let k = 0; k < 6; k++) f.bev(rng.uniform(-2.5, 2.5), rng.uniform(-3.8, 3.8), 0.06, [rng.uniform(0.2, 0.6), rng.uniform(0.2, 0.5), 0.1], m2, 0.02, [rng.uniform(0, 90), 0, 0]);
  }
  f.col(0, 0, 1.2, [2.7, 6.3, 2], "metal", void 0, true);
  f.col(0, 0.9, 2.45, [1.2, 1.2, 0.6], "metal");
}
function t55(ctx, e2) {
  const f = new Frame(ctx, e2.base, g2(e2, "heading", 0));
  f.col(0, 0, 0.79, [3.3, 6.6, 1.58], "metal", void 0, true);
  f.col(0, -0.2, 1.89, [2.66, 3.7, 0.72], "metal", void 0, true);
  f.col(0, 3.55, 1.91, [0.24, 3.45, 0.24], "metal");
}
function tanker(ctx, e2) {
  const f = new Frame(ctx, e2.base, g2(e2, "heading", 0));
  const wreck = g2(e2, "wreck", false);
  const paint = wreck ? "burnt_metal" : g2(e2, "mat", "jingle_blue");
  const tankM = wreck ? "rust_metal" : g2(e2, "tank_mat", "tank_white");
  if (ctx.geometry) {
    for (const sx of [-1, 1]) f.box(sx * 0.5, -0.5, 0.75, [0.14, 8.4, 0.24], "steel");
    f.bev(0, 3.2, 1.75, [2.4, 1.9, 2.1], paint, 0.12);
    f.box(0, 4.16, 2.2, [2.1, 0.03, 0.8], wreck ? "shadow" : "glass_dark", [0, 8, 0]);
    for (const sx of [-1, 1]) {
      f.box(sx * 1.21, 3.3, 2.25, [0.02, 1, 0.65], wreck ? "shadow" : "glass_dark");
      f.box(sx * 1.21, 3.3, 1.35, [0.02, 1.4, 0.06], "pbr_chrome");
      f.bev(sx * 1.4, 4.1, 2.3, [0.06, 0.18, 0.38], "pbr_chrome", 0.02);
      f.cyl(sx * 0.85, 4.18, 1, 0.13, 0.08, wreck ? "shadow" : "headlight", 12, [0, 90, 0]);
    }
    f.box(0, 4.18, 1.3, [1.4, 0.03, 0.4], "shadow");
    f.bev(0, 4.25, 0.72, [2.4, 0.2, 0.25], "steel", 0.04);
    f.box(0, 4.19, 2.95, [1.8, 0.12, 0.25], "jingle_yellow");
    f.cylY(0, -1.6, 1.95, 1.1, 6.6, tankM, 24);
    for (const ly of [1.75, -4.95]) f.cylY(0, ly, 1.95, 1, 0.12, tankM, 24);
    for (const ly of [0.6, -1.6, -3.8]) f.cylY(0, ly, 1.95, 1.13, 0.1, "steel", 24);
    f.box(0, -1.6, 3.12, [0.5, 6.4, 0.04], "diamond_plate");
    for (const ly of [0, -1.6, -3.2]) f.cyl(0, ly, 3.12, 0.25, 0.14, "steel", 12);
    for (const sx of [-1, 1]) f.box(sx * 0.3, -1.6, 3.4, [0.03, 6.4, 0.03], "steel");
    f.box(0, -4.98, 1.9, [0.6, 0.02, 0.4], "hazard");
    f.box(1.12, -1.6, 0.95, [0.3, 1.2, 0.35], "steel_painted");
    f.cylY(1, -3.4, 0.95, 0.06, 1.6, "rubber", 8);
    for (const sx of [-1, 1]) f.box(sx * 0.95, -5, 0.55, [0.5, 0.02, 0.5], "rubber");
    for (const sx of [-1, 1]) {
      if (!wreck) f.wheel(sx * 1, 3, 0.52, 0.32);
      else f.cylX(sx * 1, 3, 0.38, 0.38, 0.2, "burnt_metal", 14);
      for (const ly of [-2.6, -3.9]) {
        if (!wreck) {
          f.wheel(sx * 0.95, ly, 0.52, 0.3);
          f.cylX(sx * 0.63, ly, 0.52, 0.52, 0.3, "rubber", 20);
        } else f.cylX(sx * 0.95, ly, 0.36, 0.36, 0.25, "burnt_metal", 14);
      }
    }
  }
  f.col(0, 3.2, 1.45, [2.45, 2, 2.6], "metal", void 0, true);
  f.col(0, -1.6, 1.6, [2.3, 6.8, 2.6], "metal", void 0, true);
}
PREFABS.vehicle = (ctx, e2) => {
  const kind = g2(e2, "kind", "truck");
  if (kind === "hilux") hilux(ctx, e2, false);
  else if (kind === "technical") hilux(ctx, e2, true);
  else if (kind === "sedan" || kind === "taxi") sedan(ctx, e2);
  else if (kind === "jingle") jingle(ctx, e2);
  else if (kind === "tanker") tanker(ctx, e2);
  else if (kind === "motorbike") motorbike(ctx, e2);
  else if (kind === "btr") btr(ctx, e2);
  else if (kind === "t55") t55(ctx, e2);
  else vehicleBase(ctx, e2);
};

// shared/src/level/industrial.ts
var D6 = Math.PI / 180;
var g3 = (e2, k, d) => e2[k] === void 0 ? d : e2[k];
function line2(p0, p1) {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1];
  return { dx, dy, L: Math.hypot(dx, dy), hd: Math.atan2(dy, dx) / D6 };
}
function lineFrame(ctx, p0, p1, z = 0) {
  const { L, hd } = line2(p0, p1);
  return { f: new Frame(ctx, [p0[0], p0[1], z], hd - 90), L };
}
function spans(L, gaps) {
  let out = [[0, L]];
  for (const gp of gaps) {
    const a = gp.at - gp.width / 2, b = gp.at + gp.width / 2;
    const next = [];
    for (const [s, t] of out) {
      if (b <= s || a >= t) {
        next.push([s, t]);
        continue;
      }
      if (a > s) next.push([s, a]);
      if (b < t) next.push([b, t]);
    }
    out = next;
  }
  return out.filter(([s, t]) => t - s > 0.05);
}
PREFABS.fence = (ctx, e2) => {
  const p0 = e2.p0, p1 = e2.p1;
  const h = g3(e2, "height", 2.4);
  const style = g3(e2, "style", "chainlink");
  const z = g3(e2, "z", 0);
  const { f, L } = lineFrame(ctx, p0, p1, z);
  const post = style === "palisade" ? g3(e2, "mat", "paint_green") : g3(e2, "post_mat", "steel_galv");
  for (const [s, t] of spans(L, g3(e2, "gaps", []))) {
    const len = t - s, mid = (s + t) / 2;
    if (ctx.geometry) {
      const n = Math.max(1, Math.round(len / 2.5));
      for (let i = 0; i <= n; i++) f.cyl(0, s + len * i / n, h / 2, 0.035, h, post, 8);
      if (style === "palisade") {
        f.box(0, mid, 0.35, [0.06, len, 0.05], post);
        f.box(0, mid, h - 0.35, [0.06, len, 0.05], post);
        const m = Math.max(2, Math.round(len / 0.12));
        for (let i = 0; i < m; i++) {
          const y = s + (i + 0.5) * len / m;
          f.box(0.04, y, h / 2 + 0.05, [0.012, 0.065, h + 0.1], post);
          f.box(0.04, y, h + 0.12, [0.012, 0.04, 0.08], post, [0, 0, 0]);
        }
      } else {
        f.box(0, mid, h - 0.03, [0.05, len, 0.05], post);
        f.box(0, mid, 0.12, [0.04, len, 0.04], post);
        f.box(0, mid, h / 2, [0.01, len - 0.06, h - 0.1], "chainlink");
        if (g3(e2, "barbed", true)) {
          for (let i = 0; i <= Math.max(1, Math.round(len / 2.5)); i++) f.box(0.12, s + len * i / Math.max(1, Math.round(len / 2.5)), h + 0.18, [0.03, 0.03, 0.42], post, [0, 0, -40]);
          for (const k of [0.1, 0.22, 0.34]) f.box(0.07 + k * 0.6, mid, h + k, [8e-3, len, 8e-3], "steel_galv");
        }
      }
    }
    f.col(0, mid, (h + 0.3) / 2, [0.08, len, h + 0.3], "metal_grate");
  }
};
PREFABS.tank_trap = (ctx, e2) => {
  const f = new Frame(ctx, e2.base, g3(e2, "heading", 0));
  const s = g3(e2, "size", 1.6);
  const mat = g3(e2, "mat", "steel_rusty");
  for (const r of [[0, 45, 0], [90, 45, 0], [45, 0, 55]]) f.box(0, 0, s * 0.42, [0.16, 0.16, s * 1.25], mat, r);
  f.box(0, 0, s * 0.42, [0.2, 0.2, 0.2], mat);
  f.col(0, 0, s * 0.4, [s * 0.75, s * 0.75, s * 0.8], "metal");
};
PREFABS.block = (ctx, e2) => {
  const f = new Frame(ctx, e2.base, g3(e2, "heading", 0));
  const size = g3(e2, "size", [3, 0.9, 1.1]);
  f.rsolid(0, 0, size[2] / 2, size, g3(e2, "mat", "concrete_weathered"), ["+z", "+x", "-x", "+y", "-y"], 0.05);
  if (g3(e2, "stripes", true)) {
    for (const sy of [-1, 1]) f.box(0, sy * (size[1] / 2 + 6e-3), size[2] * 0.62, [size[0] * 0.98, 0.01, size[2] * 0.22], "stripe_redwhite");
  }
};
function box2(a, b) {
  return { min: [Math.min(a[0], b[0]), Math.min(a[1], b[1])], max: [Math.max(a[0], b[0]), Math.max(a[1], b[1])] };
}
PREFABS.cabin = (ctx, e2) => {
  const [[x0, y0], [x1, y1]] = [e2.min, e2.max];
  const z = g3(e2, "z", 0);
  const h = g3(e2, "height", 2.6);
  const mat = g3(e2, "mat", "cabin_white");
  const t = 0.12;
  const ops = g3(e2, "openings", {});
  const soft = g3(e2, "soft", {});
  const conv = (side, start, sign) => (ops[side] ?? []).map((op) => ({ ...op, at: (op[side === "s" || side === "n" ? "x" : "y"] - start) * sign }));
  const lift = g3(e2, "lift", 0.2);
  const zf = z + lift;
  ctx.box([(x0 + x1) / 2, (y0 + y1) / 2, z + lift / 2], [x1 - x0, y1 - y0, lift], "steel_painted", { collide: true, occlude: false });
  const sides = [
    ["s", [x0, y0 + t / 2], [x1, y0 + t / 2], conv("s", x0, 1)],
    ["e", [x1 - t / 2, y0 + t], [x1 - t / 2, y1 - t], conv("e", y0 + t, 1)],
    ["n", [x1, y1 - t / 2], [x0, y1 - t / 2], conv("n", x1, -1)],
    ["w", [x0 + t / 2, y1 - t], [x0 + t / 2, y0 + t], conv("w", y1 - t, -1)]
  ];
  for (const [side, p0, p1, openings] of sides) {
    if (g3(e2, "open_sides", []).includes(side)) continue;
    const w = { p0, p1, height: h, thickness: t, z: zf, mat: g3(e2, "mat_in", "lino_green"), mat2: mat, openings, frame_mat: "steel_painted" };
    if (soft[side]) Object.assign(w, { soft: true, reinforce: g3(soft[side], "reinforce", false), breach: g3(soft[side], "breach", false), name: g3(soft[side], "name", side) });
    wall(ctx, w);
  }
  ctx.box([(x0 + x1) / 2, (y0 + y1) / 2, zf + 0.02], [x1 - x0 - 2 * t + 0.02, y1 - y0 - 2 * t + 0.02, 0.04], g3(e2, "floor_mat", "lino_green"), { collide: false, occlude: false });
  if (g3(e2, "roof", true)) {
    ctx.box([(x0 + x1) / 2, (y0 + y1) / 2, zf + h + 0.08], [x1 - x0 + 0.1, y1 - y0 + 0.1, 0.16], mat, { collide: true, occlude: true });
  }
  if (ctx.geometry) {
    const f = new Frame(ctx, [0, 0, 0], 0);
    for (const [cx, cy] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) f.box(cx, cy, zf + h / 2, [0.14, 0.14, h + 0.1], "steel_painted");
    for (const sy of [y0, y1]) {
      const n = Math.floor((x1 - x0) / 0.6);
      for (let i = 1; i < n; i++) {
        const x = x0 + i * (x1 - x0) / n;
        if ((ops[sy === y0 ? "s" : "n"] ?? []).some((op) => Math.abs(op.x - x) < op.width / 2 + 0.1)) continue;
        f.box(x, sy + (sy === y0 ? -0.075 : 0.075), zf + h / 2, [0.05, 0.03, h - 0.15], mat);
      }
    }
    for (const sx of [x0, x1]) {
      const n = Math.floor((y1 - y0) / 0.6);
      for (let i = 1; i < n; i++) {
        const y = y0 + i * (y1 - y0) / n;
        if ((ops[sx === x0 ? "w" : "e"] ?? []).some((op) => Math.abs(op.y - y) < op.width / 2 + 0.1)) continue;
        f.box(sx + (sx === x0 ? -0.075 : 0.075), y, zf + h / 2, [0.03, 0.05, h - 0.15], mat);
      }
    }
    for (const side of ["s", "n", "e", "w"]) {
      for (const op of ops[side] ?? []) {
        if ((op.bottom ?? 0) < 0.3) continue;
        const ob = op.bottom, ot = op.top ?? 2;
        const cz = zf + (ob + ot) / 2;
        if (side === "s" || side === "n") f.box(op.x, side === "s" ? y0 + t / 2 : y1 - t / 2, cz, [op.width, 0.02, ot - ob], "glass_dark");
        else f.box(side === "w" ? x0 + t / 2 : x1 - t / 2, op.y, cz, [0.02, op.width, ot - ob], "glass_dark");
      }
    }
    if (g3(e2, "ac", true)) f.box(x1 + 0.25, (y0 + y1) / 2, zf + h * 0.7, [0.4, 0.8, 0.55], "steel_painted");
  }
};
PREFABS.guard_tower = (ctx, e2) => {
  const f = new Frame(ctx, e2.base, g3(e2, "heading", 0));
  const H = g3(e2, "height", 7);
  const W = 3.2;
  const mat = g3(e2, "mat", "concrete_weathered");
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) f.solid(sx * (W / 2 - 0.2), sy * (W / 2 - 0.2), H / 2, [0.35, 0.35, H], mat);
  if (ctx.geometry) {
    for (const sy of [-1, 1]) for (const zz of [H * 0.33, H * 0.66]) f.box(0, sy * (W / 2 - 0.2), zz, [W - 0.4, 0.12, 0.12], "steel_rusty");
    for (const sx of [-1, 1]) for (const zz of [H * 0.33, H * 0.66]) f.box(sx * (W / 2 - 0.2), 0, zz, [0.12, W - 0.4, 0.12], "steel_rusty");
  }
  const C = (W + 0.4) / 2;
  f.solid(0, 0, H - 0.1, [W + 0.4, W + 0.4, 0.2], mat);
  f.solid(0, C - 0.08, H + 0.5, [W + 0.4, 0.16, 1], mat);
  for (const sx of [-1, 1]) f.solid(sx * (C - 0.08), 0, H + 0.5, [0.16, W + 0.4, 1], mat);
  f.solid(-1.7, -C + 0.08, H + 0.5, [0.2, 0.16, 1], mat);
  f.solid(0.7, -C + 0.08, H + 0.5, [2.2, 0.16, 1], mat);
  const ch = 2.3;
  for (const [lx, ly] of [[-C + 0.08, -C + 0.08], [C - 0.08, -C + 0.08], [-C + 0.08, C - 0.08], [C - 0.08, C - 0.08]]) f.solid(lx, ly, H + ch / 2, [0.16, 0.16, ch], mat);
  f.solid(0, 0, H + ch + 0.12, [W + 0.9, W + 0.9, 0.24], mat);
  if (ctx.geometry) {
    for (const [lx, ly, sx, sy] of [[0, C - 0.08, W + 0.2, 0.02], [C - 0.08, 0, 0.02, W + 0.2], [-C + 0.08, 0, 0.02, W + 0.2], [0.7, -C + 0.08, 2, 0.02]]) {
      f.box(lx, ly, H + 1.55, [sx, sy, 1.1], "glass_dark");
    }
    f.cyl(0.8, 0.8, H + ch + 0.35, 0.07, 0.3, "steel_painted", 8);
    f.cyl(0.8, 0.8, H + ch + 0.7, 0.32, 0.5, "steel_painted", 16, [0, 90, 0]);
    f.cyl(0.8, 1.06, H + ch + 0.7, 0.27, 0.02, "lamp_lens", 16, [0, 90, 0]);
    f.box(-0.8, 0.5, H + ch + 0.8, [0.04, 0.04, 1.2], "steel");
  }
  if (g3(e2, "light", true)) ctx.light({
    pos: f.p(0.8, 1.4, H + ch + 0.7),
    kind: "spot",
    dir: ctx.xfDir(rot2([0, 1, -0.35], g3(e2, "heading", 0))),
    outer: 14,
    inner: 8,
    kelvin: 6500,
    intensity: 40,
    range: 45,
    shadows: true
  });
  if (g3(e2, "stairs", true)) {
    const steps = Math.ceil(H / 0.2), run = 0.27;
    PREFABS.stairs(ctx, {
      base: f.p(-1, -C - steps * run, 0),
      heading: g3(e2, "heading", 0),
      steps,
      rise: H,
      run,
      width: 1.1,
      mat: "diamond_plate",
      solid: true,
      rails: true
    });
  }
};
function rot2(v, hd) {
  const a = hd * D6;
  return [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a), v[2]];
}
PREFABS.floodlight = (ctx, e2) => {
  const f = new Frame(ctx, e2.base, g3(e2, "heading", 0));
  const H = g3(e2, "height", 14);
  f.cyl(0, 0, H / 2, 0.16, H, "steel_galv", 12);
  f.col(0, 0, 1.5, [0.4, 0.4, 3], "metal");
  f.solid(0, 0, 0.25, [0.9, 0.9, 0.5], "concrete_weathered");
  if (ctx.geometry) {
    f.box(0, 0, H + 0.1, [2.4, 0.15, 0.12], "steel_galv");
    for (const lx of [-0.85, -0.3, 0.3, 0.85]) {
      f.box(lx, 0.12, H + 0.45, [0.45, 0.2, 0.35], "steel_painted", [0, -25, 0]);
      f.box(lx, 0.23, H + 0.42, [0.38, 0.02, 0.27], "lamp_lens", [0, -25, 0]);
    }
    f.box(0, -0.2, 2, [0.3, 0.2, 0.5], "steel_painted");
  }
  if (g3(e2, "light", true)) ctx.light({
    pos: f.p(0, 1.2, H - 0.4),
    kind: "spot",
    dir: ctx.xfDir(rot2([0, 1, -1.2], g3(e2, "heading", 0))),
    outer: 55,
    inner: 35,
    kelvin: g3(e2, "kelvin", 4800),
    intensity: g3(e2, "intensity", 70),
    range: g3(e2, "range", 34),
    shadows: true
  });
};
PREFABS.rails = (ctx, e2) => {
  const { f, L } = lineFrame(ctx, e2.p0, e2.p1, g3(e2, "z", 0));
  if (!ctx.geometry) return;
  f.box(0, L / 2, 0.06, [3, L, 0.12], "gravel");
  const n = Math.floor(L / 0.65);
  for (let i = 0; i < n; i++) f.box(0, (i + 0.5) * L / n, 0.15, [2.5, 0.24, 0.08], g3(e2, "sleeper_mat", "wood_old"));
  for (const sx of [-0.72, 0.72]) {
    f.box(sx, L / 2, 0.24, [0.07, L, 0.1], "rail_steel");
    f.box(sx, L / 2, 0.2, [0.14, L, 0.03], "rail_steel");
  }
};
PREFABS.wagon = (ctx, e2) => {
  const f = new Frame(ctx, e2.base, g3(e2, "heading", 0));
  const kind = g3(e2, "kind", "box");
  const L = g3(e2, "length", 14);
  const paint = g3(e2, "mat", kind === "tank" ? "tank_black" : "wagon_brown");
  const deck = 1.15;
  if (ctx.geometry) {
    f.box(0, 0, deck - 0.2, [2.4, L, 0.3], "steel_rusty");
    for (const ly of [-L / 2 + 2.2, L / 2 - 2.2]) {
      f.box(0, ly, 0.6, [2.2, 2.6, 0.35], "steel_rusty");
      for (const dy of [-0.85, 0.85]) for (const sx of [-0.72, 0.72]) f.cyl(sx, ly + dy, 0.45, 0.45, 0.14, "rail_steel", 16, [0, 0, 90]);
    }
    for (const ly of [-L / 2 - 0.25, L / 2 + 0.25]) {
      f.box(0, ly, deck - 0.2, [0.4, 0.4, 0.25], "steel");
      for (const sx of [-0.85, 0.85]) f.cyl(sx, ly + Math.sign(ly) * 0.15, deck - 0.2, 0.16, 0.06, "steel", 12, [0, 90, 0]);
    }
  }
  f.col(0, 0, (deck - 0.35) / 2 + 0.2, [2.2, L - 1, deck - 0.35], "metal");
  if (kind === "box") {
    const H = 2.7, W = 2.8, open = g3(e2, "open", true);
    const door = 2.2;
    f.solid(0, 0, deck + 0.05, [W, L, 0.1], "wood_planks", void 0, false);
    f.solid(0, 0, deck + H + 0.05, [W, L, 0.1], paint);
    for (const ly of [-L / 2 + 0.05, L / 2 - 0.05]) f.solid(0, ly, deck + H / 2, [W, 0.1, H], paint);
    for (const sx of [-W / 2 + 0.05, W / 2 - 0.05]) {
      for (const [a, b] of open ? [[-L / 2, -door / 2], [door / 2, L / 2]] : [[-L / 2, L / 2]]) f.solid(sx, (a + b) / 2, deck + H / 2, [0.1, b - a, H], paint);
      if (open && g3(e2, "steps", [-1, 1]).includes(Math.sign(sx))) {
        PREFABS.stairs(ctx, {
          base: f.p(sx + Math.sign(sx) * 1.35, 0, 0),
          heading: g3(e2, "heading", 0) + (sx > 0 ? 90 : -90),
          steps: 5,
          rise: deck + 0.1,
          run: 0.27,
          width: 1.6,
          mat: "steel_rusty",
          solid: true
        });
      }
    }
    if (ctx.geometry) {
      if (open) for (const sx of [-W / 2, W / 2]) f.box(sx + Math.sign(sx) * 0.12, door / 2 + 1.1, deck + H / 2, [0.06, door, H - 0.1], paint);
      for (const sx of [-W / 2 - 0.02, W / 2 + 0.02]) {
        const n = Math.floor(L / 0.9);
        for (let i = 1; i < n; i++) {
          const y = -L / 2 + i * L / n;
          if (open && Math.abs(y) < door / 2 + 0.15) continue;
          f.box(sx, y, deck + H / 2, [0.04, 0.08, H - 0.1], paint);
        }
      }
      f.box(0, 0, deck + H + 0.14, [W - 0.4, L - 0.3, 0.08], paint);
    }
  } else if (kind === "flat") {
    f.solid(0, 0, deck, [2.7, L, 0.2], "wood_planks");
    const load = g3(e2, "load", "pipes");
    if (load === "pipes") {
      for (let i = 0; i < 4; i++) for (let j = 0; j < (i < 3 ? 3 : 2); j++) f.cyl(-0.7 + j * 0.62 + i % 2 * 0.31, 0, deck + 0.4 + i * 0.52, 0.27, L - 2, "steel_rusty", 14, [0, 90, 0]);
      f.col(0, 0, deck + 1.1, [2.1, L - 2, 2], "metal", void 0, true);
    } else {
      for (const ly of [-L / 4, L / 4]) PREFABS.crate(ctx, { base: f.p(0, ly, deck + 0.1), size: 1.6, dims: [2, 3, 1.6], heading: g3(e2, "heading", 0), mat: "plywood" });
    }
  } else {
    f.cyl(0, 0, deck + 1.35, 1.35, L - 1.4, paint, 24, [0, 90, 0]);
    f.col(0, 0, deck + 1.35, [2.5, L - 1.4, 2.6], "metal", void 0, true);
    if (ctx.geometry) {
      for (const ly of [-(L - 1.4) / 2, (L - 1.4) / 2]) f.cyl(0, ly, deck + 1.35, 1.3, 0.1, paint, 24, [0, 90, 0]);
      f.cyl(0, 0, deck + 2.8, 0.45, 0.4, paint, 16);
      for (const lr of [-1.6, 0, 1.6]) f.cyl(0, lr * (L / 5), deck + 0.15, 0.06, 2.6, "steel", 8, [0, 0, 90]);
      f.box(1.5, 0, deck + 2.7, [0.04, L - 2, 0.04], "steel");
      f.box(0, -(L - 1.4) / 2 - 0.08, deck + 1.35, [0.8, 0.02, 0.5], "hazard");
    }
  }
};
PREFABS.pipe = (ctx, e2) => {
  const pts = e2.points;
  const r = g3(e2, "radius", 0.2);
  const z = g3(e2, "z", 0.6);
  const mat = g3(e2, "mat", "steel_painted");
  for (let i = 0; i < pts.length - 1; i++) {
    const { f, L } = lineFrame(ctx, pts[i], pts[i + 1], 0);
    f.cyl(0, L / 2, z, r, L + (i < pts.length - 2 ? r * 2 : 0), mat, 14, [0, 90, 0]);
    if (ctx.geometry) {
      const nf = Math.max(1, Math.floor(L / 6));
      for (let k = 0; k <= nf; k++) f.cyl(0, L * k / nf, z, r * 1.25, 0.08, mat, 14, [0, 90, 0]);
    }
    if (z < 1.4) f.col(0, L / 2, (z + r) / 2, [r * 2, L, z + r], "metal", void 0, true);
    if (g3(e2, "supports", true)) {
      const n = Math.max(1, Math.floor(L / 4));
      for (let k = 0; k <= n; k++) {
        if (k === n && i < pts.length - 2) continue;
        const y = L * k / n;
        f.solid(0, y, (z - r) / 2, [0.16, 0.16, Math.max(z - r, 0.05)], "steel_galv", void 0, false);
        if (ctx.geometry) f.box(0, y, z - r - 0.04, [r * 2 + 0.3, 0.12, 0.08], "steel_galv");
      }
    }
  }
};
PREFABS.pipe_rack = (ctx, e2) => {
  const { f, L } = lineFrame(ctx, e2.p0, e2.p1, g3(e2, "z", 0));
  const H = g3(e2, "height", 4.2), W = g3(e2, "width", 3);
  const n = Math.max(1, Math.round(L / 6));
  for (let k = 0; k <= n; k++) {
    for (const sx of [-1, 1]) f.solid(sx * (W / 2 - 0.12), L * k / n, H / 2, [0.24, 0.24, H], "steel_painted", void 0, false);
    f.solid(0, L * k / n, H - 0.15, [W, 0.24, 0.3], "steel_painted", void 0, false);
  }
  if (ctx.geometry) {
    for (const sx of [-1, 1]) f.box(sx * (W / 2 - 0.12), L / 2, H - 0.15, [0.2, L, 0.3], "steel_painted");
    const np = g3(e2, "pipes", 5);
    const mats = ["steel_galv", "pipe_yellow", "steel_painted", "steel_rusty", "pipe_yellow"];
    for (let i = 0; i < np; i++) {
      const pr = 0.12 + i % 3 * 0.05;
      f.cyl(-W / 2 + 0.35 + i * (W - 0.7) / Math.max(np - 1, 1), L / 2, H + pr, pr, L + 0.4, mats[i % mats.length], 12, [0, 90, 0]);
    }
  }
  if (g3(e2, "catwalk", false)) {
    const cz = H + 0.9;
    f.solid(0, L / 2, cz - 0.06, [1.2, L, 0.12], "diamond_plate");
    if (ctx.geometry) {
      for (const sx of [-0.62, 0.62]) {
        f.box(sx, L / 2, cz + 1, [0.05, L, 0.05], "pipe_yellow");
        f.box(sx, L / 2, cz + 0.5, [0.04, L, 0.04], "pipe_yellow");
        for (let k = 0; k <= Math.round(L / 1.5); k++) f.box(sx, L * k / Math.round(L / 1.5), cz + 0.5, [0.05, 0.05, 1], "pipe_yellow");
      }
      for (let k = 0; k <= n; k++) f.box(0, L * k / n, H + 0.45, [0.12, 0.12, 0.9], "steel_painted");
    }
    for (const sx of [-0.62, 0.62]) f.col(sx, L / 2, cz + 0.5, [0.08, L, 1], "metal");
  }
};
PREFABS.storage_tank = (ctx, e2) => {
  const f = new Frame(ctx, e2.base, g3(e2, "heading", 0));
  const R = g3(e2, "radius", 6), H = g3(e2, "height", 8);
  const mat = g3(e2, "mat", "tank_white");
  f.cyl(0, 0, H / 2, R, H, mat, 40);
  const s = R * 2 * Math.tan(Math.PI / 8);
  for (let k = 0; k < 4; k++) f.col(0, 0, H / 2, [R * 2 - 0.1, s, H], "metal", [k * 45, 0, 0], true);
  for (let k = 0; k < 4; k++) f.col(0, 0, H + 0.1, [R * 2 - 0.1, s, 0.2], "metal", [k * 45, 0, 0], false);
  if (ctx.geometry) {
    f.cyl(0, 0, H + 0.08, R + 0.05, 0.16, "steel_galv", 40);
    for (const zz of [H * 0.25, H * 0.5, H * 0.75]) f.cyl(0, 0, zz, R + 0.02, 0.06, "steel_galv", 40, void 0, false);
    f.cyl(0, 0, H + 0.4, 0.7, 0.6, "steel_galv", 16);
    for (let k = 0; k < 24; k++) {
      const a = k / 24 * 2 * Math.PI;
      f.box(Math.cos(a) * (R - 0.1), Math.sin(a) * (R - 0.1), H + 0.65, [0.05, 0.05, 1.1], "pipe_yellow");
    }
    f.cyl(0, 0, H + 1.15, R - 0.1, 0.05, "pipe_yellow", 40, void 0, false);
    f.box(0, -R - 0.02, H * 0.55, [1.6, 0.04, 0.9], g3(e2, "label_mat", "hazard"));
    f.cyl(0, 0, 0.15, R + 0.4, 0.3, "concrete_weathered", 40);
  }
  if (g3(e2, "stairs", true)) {
    const steps = Math.ceil(H / 0.2);
    const run = 0.27;
    const len = steps * run;
    PREFABS.stairs(ctx, {
      base: f.p(-R - 0.7, -len, 0),
      heading: g3(e2, "heading", 0),
      steps,
      rise: H,
      run,
      width: 1.1,
      mat: "diamond_plate",
      solid: true,
      rails: true
    });
    f.solid(-R - 0.35, 0.35, H - 0.05, [1.9, 1.6, 0.1], "diamond_plate", void 0, false);
    if (ctx.geometry) {
      for (let k = 1; k <= 4; k++) {
        const y = -len + len * k / 4.4, top = H * (y + len) / len - 0.35;
        for (const sx of [-0.5, 0.5]) f.box(-R - 0.7 + sx, y, top / 2, [0.1, 0.1, top], "steel_painted");
      }
      f.box(-R - 0.35, 0.95, (H - 0.1) / 2, [0.1, 0.1, H - 0.1], "steel_painted");
    }
  }
};
PREFABS.vessel = (ctx, e2) => {
  const f = new Frame(ctx, e2.base, g3(e2, "heading", 0));
  const L = g3(e2, "length", 9), R = g3(e2, "radius", 1.3);
  const mat = g3(e2, "mat", "tank_white");
  const cz = 0.6 + R;
  f.solid(0, 0, 0.15, [R * 2 + 1, L + 1.2, 0.3], "steel_painted", void 0, false);
  f.col(0, 0, cz, [R * 2, L, R * 2], "metal", void 0, true);
  if (ctx.geometry) {
    f.cyl(0, 0, cz, R, L - R, mat, 24, [0, 90, 0]);
    for (const sy of [-1, 1]) {
      f.ball(0, sy * (L - R) / 2, cz, R, mat, 8, 24);
      f.box(0, sy * L * 0.3, 0.3 + R * 0.4, [R * 1.6, 0.3, R * 0.8], "steel_painted");
    }
    for (const ly of [-L * 0.3, 0, L * 0.25]) {
      f.cyl(0, ly, cz + R + 0.25, 0.18, 0.5, "steel_galv", 12);
      f.cyl(0, ly, cz + R + 0.52, 0.28, 0.06, "steel_galv", 12);
    }
    f.cyl(R + 0.15, L * 0.1, cz - 0.3, 0.12, 0.5, "steel_galv", 10, [0, 0, 90]);
    f.box(0, -L / 2 - 0.02, cz, [0.6, 0.02, 0.3], "hazard");
    f.box(0, 0, cz - R * 0.2, [R * 2.04, L * 0.4, 0.06], "pipe_yellow");
  }
};
PREFABS.wellhead = (ctx, e2) => {
  const f = new Frame(ctx, e2.base, g3(e2, "heading", 0));
  f.solid(0, 0, 0.1, [2.6, 2.6, 0.2], "concrete_weathered", void 0, false);
  f.col(0, 0, 1, [1, 1, 2], "metal", void 0, true);
  if (!ctx.geometry) return;
  f.cyl(0, 0, 0.35, 0.36, 0.5, "steel_painted", 16);
  f.cyl(0, 0, 0.62, 0.48, 0.08, "steel_painted", 16);
  f.cyl(0, 0, 1.15, 0.2, 1, "valve_red", 14);
  for (const zz of [0.85, 1.35]) {
    f.box(0, 0, zz, [0.5, 0.5, 0.26], "valve_red");
    f.cyl(0.38, 0, zz, 0.18, 0.04, "steel", 12, [0, 0, 90]);
    f.box(0.38, 0, zz, [0.04, 0.34, 0.03], "steel");
  }
  for (const sy of [-1, 1]) {
    f.cyl(0, sy * 0.5, 1.6, 0.12, 0.6, "valve_red", 12, [0, 90, 0]);
    f.cyl(0, sy * 0.8, 1.6, 0.2, 0.06, "valve_red", 12, [0, 90, 0]);
  }
  f.box(0, 0, 1.7, [0.38, 0.38, 0.22], "valve_red");
  f.cyl(0, 0, 1.92, 0.08, 0.3, "steel", 10);
  f.cyl(0, 0.08, 2.12, 0.08, 0.04, "paint_white", 12, [0, 90, 0]);
  f.cyl(0.8, 0, 0.3, 0.1, 1.6, "steel_galv", 10, [0, 0, 90]);
};
PREFABS.rig = (ctx, e2) => {
  const f = new Frame(ctx, e2.base, g3(e2, "heading", 0));
  const fz = g3(e2, "floor", 3.2);
  const H = g3(e2, "height", 24);
  const W = 6;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) f.solid(sx * (W / 2 - 0.3), sy * (W / 2 - 0.3), fz / 2, [0.4, 0.4, fz], "steel_painted", void 0, false);
  for (const [lx, ly, sx, sy] of [
    [0, (W / 2 + 0.6) / 2 + 0.45, W, W / 2 - 0.3],
    [0, -(W / 2 + 0.6) / 2 - 0.45, W, W / 2 - 0.3],
    [(W / 2 + 0.6) / 2 + 0.45, 0, W / 2 - 0.3, 1.5],
    [-(W / 2 + 0.6) / 2 - 0.45, 0, W / 2 - 0.3, 1.5]
  ]) f.solid(lx, ly, fz - 0.1, [sx, sy, 0.2], "diamond_plate");
  for (const [lx, ly, sx, sy] of [[0, W / 2 - 0.05, W, 0.08], [W / 2 - 0.05, 0, 0.08, W], [-W / 2 + 0.05, 0, 0.08, W], [1.1, -W / 2 + 0.05, W - 2.2, 0.08]]) {
    f.col(lx, ly, fz + 0.5, [sx, sy, 1], "metal");
    if (ctx.geometry) f.box(lx, ly, fz + 1, [Math.max(sx, 0.05), Math.max(sy, 0.05), 0.05], "pipe_yellow");
  }
  PREFABS.stairs(ctx, {
    base: f.p(-W / 2 + 0.7, -W / 2 - Math.ceil(fz / 0.2) * 0.27, 0),
    heading: g3(e2, "heading", 0),
    steps: Math.ceil(fz / 0.2),
    rise: fz,
    run: 0.27,
    width: 1.2,
    mat: "diamond_plate",
    solid: true,
    rails: true
  });
  PREFABS.cabin(ctx, {
    ...box2(f.p(W / 2 - 2.3, W / 2 - 2.6, 0), f.p(W / 2 - 0.2, W / 2 - 0.2, 0)),
    z: (e2.base[2] ?? 0) + fz,
    height: 2.4,
    mat: "cabin_orange",
    openings: { w: [{ y: f.p(0, W / 2 - 1.4, 0)[1], width: 1, bottom: 0, top: 2 }] },
    ac: false,
    lift: 0.05
  });
  if (ctx.geometry) {
    const legs = [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]];
    const top = 0.6;
    const n = 8;
    for (let k = 0; k < n; k++) {
      const za = fz + (H - fz) * k / n, zb = fz + (H - fz) * (k + 1) / n;
      const sa = 1.4 - (1.4 - top) * k / n, sb = 1.4 - (1.4 - top) * (k + 1) / n;
      const sm = (sa + sb) / 2;
      const lean = Math.atan2(sa - sb, zb - za) / D6;
      for (const [lx, ly] of legs) f.box(Math.sign(lx) * sm, Math.sign(ly) * sm, (za + zb) / 2, [0.16, 0.16, (zb - za) * 1.02], "rig_red", [0, Math.sign(ly) * lean, -Math.sign(lx) * lean]);
      const diag = Math.hypot(sm * 2, zb - za), ang = Math.atan2(zb - za, sm * 2) / D6;
      for (const side of [-1, 1]) {
        f.box(0, side * sm, (za + zb) / 2, [diag, 0.06, 0.06], "rig_red", [0, 0, k % 2 ? ang : -ang]);
        f.box(side * sm, 0, (za + zb) / 2, [diag, 0.06, 0.06], "rig_red", [90, 0, k % 2 ? ang : -ang]);
      }
      f.box(0, 0, zb, [sb * 2, 0.08, 0.08], "rig_red");
      f.box(0, 0, zb, [0.08, sb * 2, 0.08], "rig_red");
    }
    f.box(0, 0, H + 0.4, [1.8, 1.8, 0.8], "steel_painted");
    f.cyl(0, 0, H * 0.62, 0.02, H - 4, "steel", 6);
    f.box(0, 0, H * 0.55, [0.6, 0.4, 1.4], "pipe_yellow");
    f.cyl(0, 0, fz + 0.4, 0.4, 0.6, "steel_painted", 16);
    for (let i = 0; i < 6; i++) f.cyl(-1 + i * 0.12, 0.9, fz + 6.5, 0.05, 13, "steel_rusty", 8);
  }
};
PREFABS.flare_stack = (ctx, e2) => {
  const f = new Frame(ctx, e2.base, 0);
  const H = g3(e2, "height", 26);
  f.cyl(0, 0, H / 2, 0.35, H, "steel_rusty", 14);
  f.col(0, 0, 2, [1.2, 1.2, 4], "metal", void 0, true);
  f.solid(0, 0, 0.3, [2.4, 2.4, 0.6], "concrete_weathered");
  if (ctx.geometry) {
    for (let k = 0; k < 3; k++) {
      const a = k * 120 * D6;
      const dx = Math.cos(a) * 9, dy = Math.sin(a) * 9;
      const len = Math.hypot(9, H * 0.7);
      f.box(dx / 2, dy / 2, H * 0.35, [0.02, 0.02, len], "steel", [k * 120 + 90, 0, Math.atan2(9, H * 0.7) / D6]);
      f.box(dx, dy, 0.2, [0.6, 0.6, 0.4], "concrete_weathered");
    }
    f.cyl(0, 0, H + 0.3, 0.5, 0.6, "soot", 14);
    for (const [s, zz, r] of [[1, 1.2, 0.9], [0.75, 2.4, 0.7], [0.5, 3.4, 0.45], [0.3, 4.2, 0.25]]) {
      f.ball(0.2 * zz, 0, H + 0.4 + zz, r, s > 0.6 ? "flame" : "flame_hot", 6, 10);
    }
  }
  ctx.light({ pos: f.p(0.4, 0, H + 2.5), kind: "point", color: [1, 0.55, 0.18], intensity: 60, range: 40, shadows: false, flicker: 1 });
};
PREFABS.water_tower = (ctx, e2) => {
  const f = new Frame(ctx, e2.base, g3(e2, "heading", 0));
  const H = g3(e2, "height", 10), R = g3(e2, "radius", 2.4);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) f.solid(sx * 1.8, sy * 1.8, H / 2, [0.3, 0.3, H], "steel_painted", void 0, false);
  f.col(0, 0, H + 1.6, [R * 2, R * 2, 3.2], "metal", void 0, true);
  if (ctx.geometry) {
    for (const zz of [H * 0.3, H * 0.65]) {
      for (const sy of [-1, 1]) f.box(0, sy * 1.8, zz, [3.6, 0.1, 0.1], "steel_painted");
      for (const sx of [-1, 1]) f.box(sx * 1.8, 0, zz, [0.1, 3.6, 0.1], "steel_painted");
    }
    f.cyl(0, 0, H + 1.6, R, 3.2, "tank_silver", 28);
    f.dome(0, 0, H + 3.2, R, "tank_silver", 0.25, 28);
    f.box(1.8, -1.95, H / 2, [0.4, 0.04, H], "steel");
  }
};
PREFABS.pump_jack = (ctx, e2) => {
  const f = new Frame(ctx, e2.base, g3(e2, "heading", 0));
  f.solid(0, 0, 0.2, [2.2, 7, 0.4], "concrete_weathered");
  f.col(0, 0.3, 2.1, [1.2, 0.5, 3.4], "metal", void 0, false);
  f.col(0, -2.4, 0.9, [1.6, 1.8, 1.4], "metal", void 0, true);
  f.col(0, 3.4, 0.6, [0.8, 0.8, 1.2], "metal");
  if (ctx.geometry) {
    for (const sx of [-1, 1]) f.box(sx * 0.6, 0.3, 2, [0.18, 0.18, 3.6], "pump_green", [0, 0, -sx * 8]);
    f.box(0, -2.6, 0.9, [1.2, 1.4, 1], "steel_painted");
    f.cyl(0, -1.6, 1, 0.3, 0.6, "steel", 12, [0, 0, 90]);
    f.cyl(0, 3.4, 0.6, 0.15, 1.2, "steel_painted", 10);
    f.cyl(0, 3.4, 1.3, 0.06, 0.3, "steel_galv", 8);
  }
  ctx.prop("pump_jack", { base: e2.base, heading: g3(e2, "heading", 0), phase: g3(e2, "phase", 0), speed: g3(e2, "speed", 0.22) });
};
PREFABS.berm = (ctx, e2) => {
  const { f, L } = lineFrame(ctx, e2.p0, e2.p1, g3(e2, "z", 0));
  const h = g3(e2, "height", 3.5), d = g3(e2, "depth", 8);
  const mat = g3(e2, "mat", "sand");
  const rng = new Random(g3(e2, "seed", 3));
  if (ctx.geometry) {
    let s = -2;
    while (s < L + 2) {
      const w = rng.uniform(6, 12), hh = h * rng.uniform(0.85, 1.35);
      const c = ctx.xf(f.p(d * 0.35 + rng.uniform(-0.5, 0.5), s + w / 2, hh / 2 - 0.5))[0];
      ctx.builder(mat).addRoundedBox(c, [d * rng.uniform(0.9, 1.2), w * 1.3, hh + 1], {
        hpr: [g3(e2, "heading_offset", 0) + line2(e2.p0, e2.p1).hd - 90 + rng.uniform(-6, 6), 0, 0],
        uvScale: ctx.uvScale(mat),
        radius: Math.min(hh * 0.45, 2.2),
        step: 1.2,
        displace: ctx.organic(mat)
      });
      s += w * 0.75;
    }
  }
  f.col(d * 0.5 - 1, L / 2, h / 2 + 1.5, [d, L + 2, h + 3], "dirt", void 0, true);
};
PREFABS.bare_tree = (ctx, e2) => {
  const rng = new Random(g3(e2, "seed", Math.trunc(Math.abs(e2.base[0] * 7 + e2.base[1] * 3)) + 1));
  const f = new Frame(ctx, e2.base, rng.uniform(0, 360));
  const h = g3(e2, "height", 9);
  f.cyl(0, 0, h * 0.25, 0.22, h * 0.5, "bark", 10);
  f.col(0, 0, 1.5, [0.44, 0.44, 3], "wood");
  if (!ctx.geometry) return;
  const branch = (x, y, z, len, a, tilt, r, depth) => {
    const dx = Math.sin(tilt * D6) * Math.cos(a * D6), dy = Math.sin(tilt * D6) * Math.sin(a * D6), dz = Math.cos(tilt * D6);
    f.cyl(x + dx * len / 2, y + dy * len / 2, z + dz * len / 2, r, len, "bark", depth > 1 ? 7 : 5, [a - 90, 0, tilt]);
    if (depth <= 0) return;
    for (let k = 0; k < (depth > 1 ? 3 : 2); k++) {
      branch(x + dx * len, y + dy * len, z + dz * len, len * rng.uniform(0.5, 0.7), a + rng.uniform(-60, 60), Math.min(80, tilt + rng.uniform(5, 25)), r * 0.6, depth - 1);
    }
  };
  for (let k = 0; k < 4; k++) branch(0, 0, h * 0.45, h * 0.3, k * 90 + rng.uniform(-25, 25), rng.uniform(20, 40), 0.12, 2);
};
function lorry(ctx, e2) {
  const f = new Frame(ctx, e2.base, g3(e2, "heading", 0));
  const paint = g3(e2, "mat", "vehicle_blue");
  const box = g3(e2, "box_mat", "cabin_white");
  const curtain = g3(e2, "body", "box") === "curtain";
  if (ctx.geometry) {
    for (const sx of [-1, 1]) f.box(sx * 0.5, -0.5, 0.75, [0.16, 9, 0.26], "steel");
    f.bev(0, 3.4, 1.9, [2.45, 1.9, 2.3], paint, 0.1);
    f.box(0, 4.36, 2.35, [2.2, 0.03, 0.95], "glass_dark", [0, 6, 0]);
    for (const sx of [-1, 1]) {
      f.box(sx * 1.23, 3.6, 2.4, [0.02, 1, 0.75], "glass_dark");
      f.box(sx * 1.23, 3.1, 1.6, [0.02, 0.02, 0.9], "shadow");
      f.bev(sx * 1.45, 4.3, 2.5, [0.06, 0.2, 0.42], "steel", 0.02);
      f.box(sx * 1.24, 3.2, 0.95, [0.04, 0.6, 0.3], "steel");
      f.bev(sx * 0.9, 4.37, 1.1, [0.32, 0.04, 0.16], "headlight", 0.02);
    }
    f.box(0, 4.37, 1.45, [1.5, 0.03, 0.5], "shadow");
    for (let k = 0; k < 5; k++) f.box(0, 4.39, 1.25 + k * 0.1, [1.48, 0.02, 0.03], "steel");
    f.bev(0, 4.45, 0.8, [2.5, 0.22, 0.3], "steel", 0.04);
    f.box(0, 4.47, 0.82, [0.52, 0.01, 0.12], "paint_white");
    f.bev(0, 2.6, 3.2, [2.3, 1, 0.35], paint, 0.08);
    if (curtain) {
      f.box(0, -2.2, 2.55, [2.5, 7.2, 2.6], g3(e2, "curtain_mat", "tarp_blue"));
      for (let k = 0; k <= 6; k++) for (const sx of [-1, 1]) f.box(sx * 1.26, -5.8 + k * 1.2, 2.55, [0.04, 0.06, 2.6], "steel");
    } else {
      f.box(0, -2.2, 2.55, [2.5, 7.2, 2.6], box);
      for (const sx of [-1, 1]) for (let k = 0; k <= 9; k++) f.box(sx * 1.265, -5.8 + k * 0.8, 2.55, [0.02, 0.05, 2.5], box);
      f.box(0, -5.82, 2.55, [2.4, 0.03, 2.5], "steel_painted");
      for (const sx of [-0.6, 0.6]) f.box(sx, -5.86, 2.3, [0.04, 0.03, 2], "steel");
    }
    f.box(0, -2.2, 1.2, [2.5, 7.2, 0.12], "steel");
    f.box(0, -5.9, 0.9, [2.4, 0.12, 0.2], "hazard");
    for (const sx of [-1, 1]) f.box(sx * 0.95, -5.92, 1.1, [0.3, 0.02, 0.1], "paint_red");
    f.box(1, 0.8, 0.8, [0.5, 1.4, 0.55], "steel_painted");
    for (const [ly, r] of [[3.1, 0.52], [-3.4, 0.52], [-4.6, 0.52]]) for (const sx of [-1, 1]) f.wheel(sx * 1.05, ly, r, 0.36);
  }
  if (integratedVehicleCollision(ctx, e2)) return;
  f.col(0, 3.4, 1.55, [2.45, 2, 3.1], "metal", void 0, true);
  f.col(0, -2.2, 1.95, [2.5, 7.3, 3.9], "metal", void 0, true);
}
function artic(ctx, e2) {
  const f = new Frame(ctx, e2.base, g3(e2, "heading", 0));
  const paint = g3(e2, "mat", "vehicle_red");
  const trailer = g3(e2, "trailer", "box");
  if (ctx.geometry) {
    for (const sx of [-1, 1]) f.box(sx * 0.5, 5.2, 0.8, [0.16, 5.6, 0.26], "steel");
    f.bev(0, 6.6, 2, [2.45, 2.2, 2.5], paint, 0.1);
    f.box(0, 7.72, 2.45, [2.2, 0.03, 1], "glass_dark", [0, 6, 0]);
    for (const sx of [-1, 1]) {
      f.box(sx * 1.23, 6.9, 2.5, [0.02, 1.1, 0.8], "glass_dark");
      f.bev(sx * 1.48, 7.6, 2.55, [0.06, 0.2, 0.45], "steel", 0.02);
      f.bev(sx * 0.9, 7.74, 1.15, [0.32, 0.04, 0.16], "headlight", 0.02);
      f.cyl(sx * 1.05, 5.4, 2.3, 0.08, 2.2, "pbr_chrome", 10);
    }
    f.box(0, 7.74, 1.55, [1.5, 0.03, 0.55], "shadow");
    f.bev(0, 7.82, 0.85, [2.5, 0.22, 0.32], "steel", 0.04);
    f.bev(0, 5.75, 3.4, [2.3, 1.1, 0.5], paint, 0.1);
    f.box(0, 4.6, 1.1, [1.6, 1.2, 0.12], "steel");
    for (const [ly, r] of [[6.4, 0.52], [3.9, 0.52], [4.9, 0.52]]) for (const sx of [-1, 1]) f.wheel(sx * 1.05, ly, r, 0.36);
    f.box(0, -2.4, 1.35, [2.5, 13, 0.25], "steel");
    if (trailer !== "flat") {
      f.box(0, -2.4, 2.95, [2.55, 13, 2.9], trailer === "curtain" ? g3(e2, "curtain_mat", "tarp_blue") : "cabin_white");
      for (const sx of [-1, 1]) f.box(sx * 1.28, -2.4, 4.35, [0.04, 13, 0.1], "steel_painted");
      f.box(0, -8.92, 2.95, [2.45, 0.03, 2.8], "steel_painted");
    }
    for (const sx of [-1, 1]) f.box(sx * 1, 2.8, 0.6, [0.12, 0.12, 0.8], "steel");
    for (const ly of [-6.6, -7.7, -8.8]) for (const sx of [-1, 1]) f.wheel(sx * 1.05, ly, 0.5, 0.34);
  }
  if (trailer === "flat") PREFABS.container(ctx, { base: f.p(0, -2.4, 1.48), heading: g3(e2, "heading", 0), length: 12, mat: g3(e2, "container_mat", "container_blue") });
  f.col(0, 6.6, 1.65, [2.45, 2.3, 3.3], "metal", void 0, true);
  f.col(0, -2.4, trailer === "flat" ? 2.1 : 2.25, [2.55, 13, trailer === "flat" ? 4.2 : 4.5], "metal", void 0, true);
}
function coach(ctx, e2) {
  const f = new Frame(ctx, e2.base, g3(e2, "heading", 0));
  const paint = g3(e2, "mat", "coach_cream");
  const L = 12;
  if (ctx.geometry) {
    f.bev(0, 0, 1, [2.5, L, 1.4], paint, 0.1);
    f.bev(0, 0, 2.5, [2.5, L, 1.6], paint, 0.12);
    f.bev(0, 0, 3.4, [2.42, L - 0.2, 0.2], paint, 0.1);
    for (const sx of [-1, 1]) {
      f.box(sx * 1.255, -0.3, 2.45, [0.02, L - 2.2, 1], "glass_dark");
      f.box(sx * 1.26, 0, 1.1, [0.02, L - 0.4, 0.12], g3(e2, "stripe_mat", "jingle_red"));
      for (let k = 0; k < 4; k++) f.box(sx * 1.258, -4.2 + k * 2.2, 0.75, [0.02, 1.9, 0.75], "shadow");
      for (let k = 0; k < 6; k++) f.box(sx * 1.262, -5.3 + k * 1.8, 2.45, [0.03, 0.08, 1], paint);
    }
    f.box(1.255, 5, 1.6, [0.02, 1, 2.2], "glass_dark");
    f.box(0, L / 2 + 0.01, 2.3, [2.3, 0.03, 1.4], "glass_dark", [0, 4, 0]);
    f.box(0, -L / 2 - 0.01, 2.6, [2, 0.03, 0.9], "glass_dark");
    for (const sx of [-1, 1]) {
      f.bev(sx * 0.95, L / 2 + 0.02, 0.85, [0.3, 0.04, 0.15], "headlight", 0.02);
      f.bev(sx * 1.4, L / 2 - 0.2, 2.6, [0.06, 0.15, 0.5], "steel", 0.02);
    }
    f.bev(0, L / 2 + 0.06, 0.55, [2.5, 0.12, 0.3], "steel", 0.04);
    for (const [ly, r] of [[4.2, 0.5], [-3.2, 0.5], [-4.4, 0.5]]) for (const sx of [-1, 1]) f.wheel(sx * 1.05, ly, r, 0.34);
  }
  f.col(0, 0, 1.75, [2.5, L, 3.2], "metal", void 0, true);
}
function boxcar(ctx, e2) {
  const f = new Frame(ctx, e2.base, g3(e2, "heading", 0));
  const paint = g3(e2, "mat", "vehicle_white");
  if (ctx.geometry) {
    f.bev(0, 0, 0.62, [1.62, 4.05, 0.62], paint, 0.05);
    f.bev(0, -0.25, 1.18, [1.5, 2.1, 0.55], paint, 0.05);
    f.box(0, 0.86, 1.15, [1.4, 0.03, 0.48], "glass_dark", [0, 30, 0]);
    f.box(0, -1.34, 1.15, [1.4, 0.03, 0.44], "glass_dark", [0, -22, 0]);
    for (const sx of [-1, 1]) {
      f.box(sx * 0.755, -0.25, 1.2, [0.02, 1.9, 0.4], "glass_dark");
      f.box(sx * 0.815, 0.2, 0.62, [0.01, 0.02, 0.5], "shadow");
      f.box(sx * 0.6, 2.03, 0.72, [0.3, 0.03, 0.16], "headlight");
      f.box(sx * 0.6, -2.03, 0.75, [0.28, 0.03, 0.12], "paint_red");
      f.box(sx * 0.82, 0.75, 0.95, [0.05, 0.1, 0.06], "rubber");
    }
    f.box(0, 2.03, 0.72, [0.6, 0.02, 0.14], "steel");
    for (const sy of [-1, 1]) f.box(0, sy * 2.06, 0.45, [1.62, 0.1, 0.14], "pbr_chrome");
    if (g3(e2, "roof_rack", false)) f.box(0, -0.25, 1.5, [1.3, 1.6, 0.08], "steel");
    for (const ly of [1.25, -1.25]) for (const sx of [-1, 1]) f.wheel(sx * 0.7, ly, 0.3, 0.17);
  }
  if (integratedVehicleCollision(ctx, e2)) return;
  f.col(0, 0, 0.75, [1.62, 4.1, 1.5], "metal", void 0, true);
}
function jeep(ctx, e2) {
  const f = new Frame(ctx, e2.base, g3(e2, "heading", 0));
  const paint = g3(e2, "mat", "vehicle_od");
  if (ctx.geometry) {
    f.bev(0, 0, 0.85, [1.75, 4, 0.8], paint, 0.04);
    f.bev(0, 1.45, 1.32, [1.6, 1.1, 0.14], paint, 0.03);
    f.box(0, 0.9, 1.6, [1.56, 0.04, 0.55], "glass_dark", [0, 10, 0]);
    f.box(0, -0.6, 1.62, [1.74, 2.6, 0.6], g3(e2, "top_mat", "canvas"));
    for (const sx of [-1, 1]) {
      f.box(sx * 0.875, 0.1, 1.62, [0.02, 0.9, 0.4], "glass_dark");
      f.box(sx * 0.6, 2.01, 1, [0.22, 0.04, 0.22], "headlight");
      f.box(sx * 0.95, 0.4, 0.5, [0.12, 1.4, 0.05], "steel");
    }
    for (let k = 0; k < 6; k++) f.box(0, 2.02, 0.75 + k * 0.07, [0.8, 0.02, 0.03], "steel");
    f.bev(0, 2.08, 0.55, [1.8, 0.14, 0.18], "steel", 0.03);
    f.cyl(0, -2.15, 1.05, 0.38, 0.22, "rubber", 18, [0, 90, 0]);
    f.box(0, -0.2, 1.97, [1.2, 0.25, 0.12], g3(e2, "light_mat", "metal_blue"));
    f.box(0.6, 1, 1.9, [0.03, 0.03, 1.3], "steel", [0, 0, 8]);
    for (const ly of [1.3, -1.3]) for (const sx of [-1, 1]) f.wheel(sx * 0.78, ly, 0.38, 0.24);
  }
  f.col(0, 0, 0.95, [1.75, 4.2, 1.9], "metal", void 0, true);
}
function crane(ctx, e2) {
  const f = new Frame(ctx, e2.base, g3(e2, "heading", 0));
  const paint = g3(e2, "mat", "crane_yellow");
  if (ctx.geometry) {
    f.box(0, -0.5, 1, [2.5, 9.5, 0.5], paint);
    f.bev(0, 3.7, 1.8, [2.4, 1.6, 1.7], paint, 0.08);
    f.box(0, 4.51, 2, [2.1, 0.03, 0.8], "glass_dark");
    f.bev(-0.5, 0.2, 1.9, [1.4, 1.8, 1.4], paint, 0.06);
    f.box(-0.5, 1.11, 2.1, [1.2, 0.03, 0.7], "glass_dark");
    f.bev(0.5, -2, 2.2, [1.2, 3, 1.6], paint, 0.06);
    f.box(0, -0.8, 3.1, [0.8, 9, 0.7], paint, [0, -4, 0]);
    f.box(0, 3.8, 3, [0.25, 0.25, 0.6], "steel");
    f.cyl(0, 3.8, 2.6, 0.12, 0.2, "steel", 10);
    for (const sx of [-1, 1]) for (const ly of [2.5, -3.5]) f.box(sx * 1.6, ly, 0.6, [0.8, 0.3, 0.3], "hazard");
    for (const ly of [3.5, 1.8, -2.2, -3.4]) for (const sx of [-1, 1]) f.wheel(sx * 1.1, ly, 0.55, 0.42);
  }
  f.col(0, 0, 1.75, [2.5, 9.6, 3.5], "metal", void 0, true);
}
function dozer(ctx, e2) {
  const f = new Frame(ctx, e2.base, g3(e2, "heading", 0));
  const paint = g3(e2, "mat", "crane_yellow");
  if (ctx.geometry) {
    for (const sx of [-1, 1]) {
      f.bev(sx * 1.3, 0, 0.55, [0.65, 4, 1.1], "rubber", 0.25);
      for (let k = 0; k < 14; k++) f.box(sx * 1.3, -1.9 + k * 0.29, 1.12, [0.66, 0.12, 0.05], "steel");
    }
    f.bev(0, 0.4, 1.5, [2, 2.4, 1.3], paint, 0.08);
    f.bev(0, -1, 2.6, [1.7, 1.6, 1.5], paint, 0.05);
    for (const sx of [-1, 1]) f.box(sx * 0.86, -1, 2.65, [0.02, 1.3, 1.1], "glass_dark");
    f.box(0, -0.19, 2.65, [1.4, 0.02, 1], "glass_dark");
    f.cyl(0.6, 1.2, 2.6, 0.08, 1, "soot", 8);
    f.box(0, 2.9, 0.85, [3.6, 0.3, 1.4], paint, [0, 8, 0]);
    for (const sx of [-1, 1]) f.box(sx * 1, 2.2, 1, [0.2, 1.4, 0.2], "steel", [0, -20, 0]);
    f.box(0, -2.3, 0.8, [0.3, 0.6, 0.6], "steel");
  }
  f.col(0, 0.3, 1.25, [3.6, 5.6, 2.5], "metal", void 0, true);
}
function trailerCabin(ctx, e2) {
  const f = new Frame(ctx, e2.base, g3(e2, "heading", 0));
  if (ctx.geometry) {
    f.box(0, 0, 0.75, [2.2, 6.6, 0.2], "steel");
    f.box(0, 4, 0.6, [0.2, 1.6, 0.15], "steel");
    for (const ly of [-1, -2.1]) for (const sx of [-1, 1]) f.wheel(sx * 1, ly, 0.4, 0.26);
  }
  f.col(0, 0, 0.45, [2.2, 6.6, 0.9], "metal");
  PREFABS.cabin(ctx, {
    ...box2(f.p(-1.2, -3, 0), f.p(1.2, 3, 0)),
    z: (e2.base[2] ?? 0) + 0.85,
    height: 2.5,
    mat: g3(e2, "mat", "cabin_blue"),
    openings: {},
    lift: 0.05,
    ac: true
  });
}
var VEHICLES = { lorry, artic, coach, boxcar, jeep, crane, dozer, trailer_cabin: trailerCabin };
var previous = PREFABS.vehicle;
PREFABS.vehicle = (ctx, e2) => {
  const fn = VEHICLES[g3(e2, "kind", "truck")];
  if (fn) fn(ctx, e2);
  else previous(ctx, e2);
};
PREFABS.kit = (ctx, e2) => {
  const f = new Frame(ctx, e2.base, g3(e2, "heading", 0));
  const kind = g3(e2, "kind", "pallet");
  const rng = new Random(g3(e2, "seed", Math.trunc(Math.abs(e2.base[0] * 13 + e2.base[1] * 7)) + 3));
  if (kind === "kennel") {
    f.solid(0, 0, 0.45, [1, 1.3, 0.9], "wood_old");
    if (ctx.geometry) {
      f.box(0, 0, 1.05, [1.15, 1.45, 0.08], "corrugated_rust", [0, 0, 0]);
      f.box(0, -0.66, 0.4, [0.45, 0.02, 0.55], "shadow");
    }
  } else if (kind === "drum_rack") {
    for (let i = 0; i < g3(e2, "count", 6); i++) {
      const lx = i % 3 * 0.62 - 0.62, lz = Math.floor(i / 3) * 0.9;
      f.cyl(lx, 0, lz + 0.44, 0.29, 0.88, rng.choice(["metal_blue", "paint_red", "metal_olive", "steel_rusty"]), 16);
    }
    f.col(0, 0, 0.5 * Math.ceil(g3(e2, "count", 6) / 3) * 0.9, [1.9, 0.62, Math.ceil(g3(e2, "count", 6) / 3) * 0.9], "metal", void 0, true);
  } else if (kind === "cable_reel") {
    f.cyl(0, 0, 0.9, 0.9, 1, "wood_planks", 20, [0, 0, 90]);
    f.cyl(0, 0, 0.9, 0.55, 1.02, "rubber", 16, [0, 0, 90]);
    f.col(0, 0, 0.9, [1, 1.6, 1.8], "wood", void 0, true);
  } else if (kind === "pallet") {
    const n = g3(e2, "count", 2);
    for (let i = 0; i < n; i++) f.box(0, 0, 0.07 + i * 0.15, [1.2, 1, 0.13], "wood_planks");
    f.box(0, 0, n * 0.15 + 0.45, [1.1, 0.9, 0.8], rng.choice(["sack", "cabin_white", "tarp_blue"]));
    f.col(0, 0, (n * 0.15 + 0.85) / 2, [1.2, 1, n * 0.15 + 0.85], "wood", void 0, true);
  } else if (kind === "sign_board") {
    const w = g3(e2, "width", 3), h = g3(e2, "height", 2.4);
    for (const sx of [-1, 1]) f.cyl(sx * (w / 2 - 0.1), 0, h / 2, 0.05, h, "steel_galv", 8);
    f.box(0, 0, h - 0.5, [w, 0.05, 1], g3(e2, "mat", "metal_blue"));
    f.col(0, 0, h / 2, [w, 0.12, h], "metal");
    ctx.prop("sign", {
      text: g3(e2, "text", ""),
      pos: f.p(0, -0.04, h - 0.5),
      heading: g3(e2, "heading", 0) + 180,
      scale: g3(e2, "scale", 0.3),
      color: g3(e2, "color", [0.95, 0.95, 0.95, 1])
    });
  } else if (kind === "cones") {
    for (let i = 0; i < g3(e2, "count", 4); i++) {
      f.cyl(i * 0.9, 0, 0.36, 0.05, 0.7, "fruit_orange", 10);
      f.box(i * 0.9, 0, 0.02, [0.4, 0.4, 0.04], "rubber");
    }
  } else if (kind === "gas_bottles") {
    for (let i = 0; i < 5; i++) f.cyl(i % 3 * 0.3 - 0.3, Math.floor(i / 3) * 0.3, 0.75, 0.13, 1.5, rng.choice(["paint_red", "metal_green", "steel_galv"]), 12);
    f.col(0, 0.15, 0.75, [0.9, 0.6, 1.5], "metal");
  } else if (kind === "transformer") {
    f.solid(0, 0, 1, [1.6, 1.2, 2], "metal_green");
    if (ctx.geometry) for (let k = 0; k < 6; k++) f.box(0.85, -0.5 + k * 0.2, 1, [0.1, 0.04, 1.6], "metal_green");
    f.box(0, -0.61, 1.4, [0.4, 0.02, 0.3], "hazard");
  } else if (kind === "pipe_stack") {
    const L = g3(e2, "length", 9);
    const rows = g3(e2, "rows", 3);
    for (let r = 0; r < rows; r++) for (let i = 0; i < 6 - r; i++) f.cyl(-1.4 + i * 0.5 + r * 0.25, 0, 0.42 + r * 0.43, 0.22, L, "steel_rusty", 12, [0, 90, 0]);
    for (const ly of [-L / 3, L / 3]) f.box(0, ly, 0.1, [3.2, 0.25, 0.2], "wood_old");
    f.col(0, 0, 0.2 + rows * 0.22, [3, L, 0.4 + rows * 0.43], "metal", void 0, true);
  } else if (kind === "mud_pit") {
    const L = g3(e2, "length", 8), W = g3(e2, "width", 3.2);
    for (const sy of [-1, 1]) f.solid(0, sy * (L / 2 - 0.08), 0.75, [W, 0.16, 1.5], "steel_rusty");
    for (const sx of [-1, 1]) f.solid(sx * (W / 2 - 0.08), 0, 0.75, [0.16, L, 1.5], "steel_rusty");
    f.solid(0, 0, 0.6, [W - 0.3, L - 0.3, 1.2], "steel_rusty", void 0, false);
    if (ctx.geometry) {
      f.box(0, 0, 1.21, [W - 0.32, L - 0.32, 0.02], "oil_stain");
      for (let k = 0; k < 3; k++) f.cyl(0, -L / 3 + k * L / 3, 1.7, 0.15, 0.6, "steel_painted", 10);
    }
  }
};

// shared/src/level/environment.ts
var D7 = Math.PI / 180;
PREFABS.bunting = (ctx, e2) => {
  if (!ctx.geometry) return;
  const a = e2.p0, b = e2.p1, z = e2.z ?? 4, z1 = e2.z1 ?? z, L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(2, Math.ceil(L / 0.48)), rng = new Random(e2.seed ?? 2);
  const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, sag = e2.sag ?? 0.6;
  const p = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, z + (z1 - z) * t - 4 * sag * t * (1 - t)];
  for (let i = 0; i < n; i++) tube(ctx, p(i / n), p((i + 1) / n), 8e-3, "sack", 5);
  const colors = e2.colors ?? ["cloth_green", "carpet_red", "canvas", "carpet_blue", "cloth_white"];
  for (let i = 1; i < n; i++) {
    const t = i / n, wa = 0.12, pa = p(t - wa / L), pb = p(t + wa / L), pc = p(t), depth = 0.3 + rng.random() * 0.1, flutter = rng.uniform(-0.12, 0.12);
    const tip = [pc[0] - uy * flutter, pc[1] + ux * flutter, pc[2] - depth];
    const mid = [pc[0] - uy * flutter * 0.5, pc[1] + ux * flutter * 0.5, pc[2] - depth * 0.45];
    const m = colors[i % colors.length];
    tri(ctx, m, [pa, pb, mid]);
    tri(ctx, m, [pa, mid, tip]);
    tri(ctx, m, [mid, pb, tip]);
  }
  for (const p0 of [p(0), p(1)]) ctx.cylinder(p0, 0.025, 0.04, "steel", 8, true, [0, 90, 0]);
};
PREFABS.power_line = (ctx, e2) => {
  const pts = e2.points, h = e2.height ?? 7, sag = e2.sag ?? 0.7, ends = [];
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i], nxt = pts[Math.min(i + 1, pts.length - 1)], prev = pts[Math.max(0, i - 1)], hd = Math.atan2(nxt[1] - prev[1], nxt[0] - prev[0]) / D7;
    const f = new Frame(ctx, [x, y, 0], hd);
    ctx.cylinder([x, y, h / 2], 0.12, h, "wood_old", 12);
    ctx.collider([x, y, h / 2], [0.24, 0.24, h], [0, 0, 0], "wood");
    f.cyl(0, 0, 0.16, 0.19, 0.32, "concrete_weathered", 12);
    f.box(0, 0, h - 0.43, [0.13, 1.75, 0.14], "wood_old");
    for (const sy of [-1, 1]) tube(ctx, f.p(0, sy * 0.65, h - 0.48), f.p(0, 0, h - 1.05), 0.017, "steel", 6);
    const ins = [];
    for (const off of [-0.7, 0, 0.7]) {
      f.cyl(0, off, h - 0.23, 0.035, 0.28, "steel", 8);
      for (let k = 0; k < 4; k++) f.cyl(0, off, h - 0.28 + k * 0.045, 0.065, 0.023, "cloth_white", 10);
      ins.push(f.p(0, off, h - 0.075));
    }
    ends.push(ins);
    for (const zz of [h - 0.45, h - 0.95]) {
      f.cyl(0, 0, zz, 0.127, 0.045, "steel", 10);
      f.box(0.14, 0, zz, [0.03, 0.12, 0.12], "steel");
    }
    if (i === Math.floor(pts.length / 2)) {
      f.box(0.19, 0, h - 1.55, [0.16, 0.55, 0.1], "steel");
      f.cyl(0.33, 0, h - 1.35, 0.22, 0.7, "steel_painted", 16);
      for (let k = 0; k < 6; k++) f.box(0.33, 0.22, h - 1.65 + k * 0.1, [0.28, 0.035, 0.025], "steel");
      tube(ctx, f.p(0.33, 0, h - 0.98), f.p(0, 0, h - 0.08), 0.012, "rubber", 6);
    }
  }
  if (!ctx.geometry) return;
  for (let i = 0; i < ends.length - 1; i++) for (let w = 0; w < 3; w++) {
    const a = ends[i][w], b = ends[i + 1][w], steps = 20;
    const p = (t) => a.map((v, k) => v + (b[k] - v) * t - (k === 2 ? 4 * sag * t * (1 - t) : 0));
    for (let k = 0; k < steps; k++) tube(ctx, p(k / steps), p((k + 1) / steps), 9e-3, "rubber", 5);
  }
};
var originalHouse = PREFABS.mud_house;
PREFABS.mud_house = (ctx, e2) => {
  const [x0, y0] = e2.min, [x1, y1] = e2.max, z = e2.z ?? 0, h = e2.height ?? 3, roof = z + h + (e2.roof_thickness ?? 0.35), rng = new Random((e2.seed ?? 17) * 41);
  const wings = x1 - x0 > 12 && !e2.domes?.length && !e2.parapet_gaps?.length && e2.environment_detail !== false;
  if (wings) {
    const northSouth = [...e2.openings?.n ?? [], ...e2.openings?.s ?? []];
    const candidates = [0.38, 0.58, 0.45, 0.68].map((t) => x0 + (x1 - x0) * t);
    const split = candidates.find((x) => northSouth.every((o) => Math.abs(o.x - x) > o.width / 2 + 0.28)) ?? null;
    if (split !== null) {
      const high = !(e2.seed % 2), extra = 0.85 + e2.seed % 4 * 0.22;
      const part = (left) => {
        const min = left ? [x0, y0] : [split, y0], max = left ? [split, y1] : [x1, y1], open = { ...e2.openings };
        for (const side of ["n", "s"]) open[side] = (open[side] ?? []).filter((o) => o.x > min[0] && o.x < max[0]);
        delete open[left ? "e" : "w"];
        return { ...e2, min, max, openings: open, open_sides: [...e2.open_sides ?? [], left ? "e" : "w"], height: h + (left === high ? extra : 0), roof_items: (e2.roof_items ?? []).filter((o) => o.x > min[0] && o.x < max[0]), seed: (e2.seed ?? 0) + (left ? 0 : 311) };
      };
      originalHouse(ctx, part(true));
      originalHouse(ctx, part(false));
      ctx.rbox([split, (y0 + y1) / 2, roof + extra / 2], [e2.wall ?? 0.45, y1 - y0, extra], e2.mat ?? "mud_wall", { radius: 0.07 });
    } else originalHouse(ctx, e2);
  } else originalHouse(ctx, e2);
  if (e2.environment_detail === false) return;
  if (!wings && !e2.domes?.length && (e2.seed ?? 0) % 3 !== 0) {
    const w = Math.min(4.3, (x1 - x0) * 0.42), d = Math.min(3.6, (y1 - y0) * 0.36), hh = 1.3 + rng.random() * 0.8;
    const x = x0 + 0.8 + w / 2 + rng.random() * Math.max(0, x1 - x0 - w - 1.6), y = y1 - 0.8 - d / 2;
    const f = new Frame(ctx, [x, y, roof], 0);
    f.rsolid(0, 0, hh / 2, [w, d, hh], e2.mat ?? "mud_wall", ["+x", "-x", "+y", "-y", "+z"], 0.11);
    f.bev(0, 0, hh + 0.09, [w + 0.18, d + 0.16, 0.18], "mud_roof", 0.05);
    f.box(0, -d / 2 - 0.012, hh * 0.57, [0.7, 0.035, 0.58], "wood_dark");
    for (const sx of [-1, 1]) f.box(sx * 0.39, -d / 2 - 0.032, hh * 0.57, [0.06, 0.07, 0.69], "wood_old");
  }
  const sides = [{ x: x0, y: y0, dx: x1 - x0, dy: 0, nx: 0, ny: -1, key: "s", axis: "x" }, { x: x0, y: y1, dx: x1 - x0, dy: 0, nx: 0, ny: 1, key: "n", axis: "x" }, { x: x0, y: y0, dx: 0, dy: y1 - y0, nx: -1, ny: 0, key: "w", axis: "y" }, { x: x1, y: y0, dx: 0, dy: y1 - y0, nx: 1, ny: 0, key: "e", axis: "y" }];
  for (const s of sides) {
    const len = Math.hypot(s.dx, s.dy), ux = s.dx / len, uy = s.dy / len, ops = e2.openings?.[s.key] ?? [];
    const door = ops.find((o) => (o.bottom ?? 0) < 0.05);
    if (door && (e2.seed ?? 0) % 2 === 0) {
      const at = door[s.axis], u = at - (s.axis === "x" ? s.x : s.y), cx = s.x + ux * u + s.nx * 0.43, cy = s.y + uy * u + s.ny * 0.43, hd = Math.atan2(uy, ux) / D7;
      const f = new Frame(ctx, [cx, cy, z], hd), height = (door.top ?? 2.15) + 0.25;
      cloth(f, door.width + 0.85, 0.85, height - 0.12, height, "canvas", 0.07);
      for (const sign of [-1, 1]) {
        const p = [s.x + ux * (u + sign * (door.width / 2 + 0.3)) + s.nx * 0.76, s.y + uy * (u + sign * (door.width / 2 + 0.3)) + s.ny * 0.76, z];
        tube(ctx, p, [p[0], p[1], z + height - 0.12], 0.045, "wood_old", 8);
        ctx.collider([p[0], p[1], z + (height - 0.12) / 2], [0.09, 0.09, height - 0.12], [0, 0, 0], "wood");
      }
    }
    for (let k = 0; k < Math.floor(len / 3); k++) {
      const u = 0.6 + rng.random() * (len - 1.2), zz = 0.45 + rng.random() * Math.min(1.4, h - 0.8), pw = 0.45 + rng.random() * 0.7, ph = 0.24 + rng.random() * 0.38;
      const at = (s.axis === "x" ? s.x : s.y) + u;
      if (ops.some((o) => Math.abs(o[s.axis] - at) < o.width / 2 + pw / 2 + 0.2)) continue;
      const p = (du, dz) => [s.x + ux * (u + du) + s.nx * 0.022, s.y + uy * (u + du) + s.ny * 0.022, z + zz + dz];
      const centre = p(0, 0);
      const poly = [p(-pw / 2, -ph * 0.32), p(-pw * 0.3, -ph / 2), p(pw * 0.35, -ph * 0.42), p(pw / 2, ph * 0.1), p(pw * 0.2, ph / 2), p(-pw * 0.4, ph * 0.38)];
      for (let j = 0; j < poly.length; j++) tri(ctx, "mud_brick", [centre, poly[j], poly[(j + 1) % poly.length]]);
      for (let row = 0; row < 2; row++) for (let b = 0; b < 3; b++) {
        const c = p((b - 1) * pw * 0.23 + (row ? 0.045 : 0), (row - 0.5) * ph * 0.34);
        ctx.chamfer(c, [s.dx ? pw * 0.2 : 0.045, s.dx ? 0.045 : pw * 0.2, ph * 0.26], "mud_brick", 0.012);
      }
    }
  }
};
var originalShop = PREFABS.shop;
PREFABS.shop = (ctx, e2) => {
  originalShop(ctx, e2);
  if (!ctx.geometry) return;
  const w = e2.width ?? (e2.style === "container" ? 6.06 : 3.6), d = e2.depth ?? (e2.style === "container" ? 2.44 : 3), h = e2.height ?? (e2.style === "container" ? 2.59 : 2.8), f = new Frame(ctx, e2.base, e2.heading ?? 0);
  for (const zz of [0.65, 1.25, 1.85]) {
    f.box(0, d / 2 - 0.28, zz, [w - 0.4, 0.35, 0.045], "wood_old");
    for (const sx of [-1, 1]) f.box(sx * (w / 2 - 0.3), d / 2 - 0.3, zz - 0.12, [0.035, 0.3, 0.24], "steel");
  }
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 - 0.16);
    tube(ctx, f.p(x, -d / 2, h - 0.1), f.p(x, -d / 2 - 0.4, h + 0.18), 0.018, "steel", 6);
  }
  for (let k = 0; k < 4; k++) {
    const x = -w * 0.3 + k * w * 0.19, y = d / 2 - 0.3;
    f.cyl(x, y, 1.4, 0.075, 0.25, k % 2 ? "steel_painted" : "steel_rusty", 12);
    f.cyl(x, y, 1.54, 0.028, 0.025, "steel", 8);
  }
  const cx = -w * 0.2, cy = -d * 0.15;
  for (const sy of [-1, 1]) for (let k = 0; k < 3; k++) f.box(cx, cy + sy * 0.23, 0.2 + k * 0.12, [0.7, 0.025, 0.08], "wood_old");
  for (const sx of [-1, 1]) f.box(cx + sx * 0.34, cy, 0.32, [0.035, 0.47, 0.42], "wood_old");
};
var originalPump = PREFABS.pump_jack;
PREFABS.pump_jack = (ctx, e2) => {
  originalPump(ctx, e2);
  const f = new Frame(ctx, e2.base, e2.heading ?? 0);
  if (!ctx.geometry) return;
  for (const sx of [-1, 1]) {
    tube(ctx, f.p(sx * 0.9, -0.7, 0.42), f.p(sx * 0.24, 0.3, 3.85), 0.085, "pump_green", 8);
    tube(ctx, f.p(sx * 0.9, 1.15, 0.42), f.p(sx * 0.24, 0.3, 3.85), 0.085, "pump_green", 8);
    f.box(sx * 0.86, 0.15, 0.44, [0.42, 2.3, 0.1], "steel");
    for (const sy of [-0.7, 1.05]) f.cyl(sx * 0.86, sy, 0.53, 0.045, 0.1, "steel", 6);
  }
  for (const zz of [1.25, 2.25, 3.3]) f.box(0, 0.3, zz, [1.25, 0.15, 0.13], "pump_green");
  f.cylX(0, 0.3, 3.85, 0.16, 1.05, "steel", 16);
  f.bev(0, -1.6, 1, [0.7, 0.7, 0.7], "pump_green", 0.08);
  for (let k = 0; k < 8; k++) f.box(0, -2.6, 0.55 + k * 0.1, [1.23, 1.1, 0.025], "steel");
  f.cylX(0, -2.6, 1, 0.38, 1.35, "steel_painted", 18);
  tube(ctx, f.p(0.7, -1.6, 1), f.p(0.7, -2.6, 1), 0.04, "rubber", 8);
};
var originalPipe = PREFABS.pipe;
PREFABS.pipe = (ctx, e2) => {
  originalPipe(ctx, e2);
  if (!ctx.geometry) return;
  const pts = e2.points, r = e2.radius ?? 0.2, z = e2.z ?? 0.6;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), hd = Math.atan2(b[1] - a[1], b[0] - a[0]) / D7;
    const f = new Frame(ctx, [a[0], a[1], 0], hd - 90), n = Math.max(1, Math.floor(L / 6));
    for (let k = 0; k <= n; k++) {
      const y = L * k / n;
      for (const off of [-0.065, 0.065]) f.cylY(0, y + off, z, r * 1.38, 0.045, "steel", 18);
      for (let j = 0; j < 8; j++) {
        const ang = j * Math.PI / 4;
        f.cylY(Math.cos(ang) * r * 1.18, y, z + Math.sin(ang) * r * 1.18, 0.025, 0.2, "steel_galv", 6);
      }
    }
    if (i === 0 && L > 3) {
      const y = L * 0.4;
      f.cyl(0, y, z + r + 0.17, 0.065, 0.34, "steel", 12);
      f.cyl(0, y, z + r + 0.35, 0.17, 0.04, "paint_red", 16, void 0, false);
      for (let k = 0; k < 3; k++) {
        const a2 = k * 2 * Math.PI / 3;
        tube(ctx, f.p(0, y, z + r + 0.37), f.p(0.15 * Math.cos(a2), y + 0.15 * Math.sin(a2), z + r + 0.37), 0.012, "paint_red", 6);
      }
    }
  }
};
var originalCabin = PREFABS.cabin;
PREFABS.cabin = (ctx, e2) => {
  originalCabin(ctx, e2);
  if (!ctx.geometry) return;
  const [x0, y0] = e2.min, [x1, y1] = e2.max, z = e2.z ?? 0, h = e2.height ?? 2.6, lift = e2.lift ?? 0.2;
  const f = new Frame(ctx, [(x0 + x1) / 2, (y0 + y1) / 2, z + lift], 0), w = x1 - x0, d = y1 - y0;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    f.box(sx * (w / 2 - 0.035), sy * (d / 2 - 0.035), h / 2, [0.09, 0.09, h], "steel_galv");
    for (const zz of [0.16, h - 0.16]) f.cylY(sx * (w / 2 - 0.035), sy * (d / 2 + 0.012), zz, 0.025, 0.035, "steel", 6);
  }
  f.box(0, -d / 2 - 0.05, h + 0.02, [w + 0.18, 0.12, 0.1], "steel_galv");
  f.cyl(w / 2 - 0.2, -d / 2 - 0.12, h / 2, 0.035, h, "steel_galv", 8);
  f.cyl(0, 0, h + 0.16, 0.12, 0.3, "steel_galv", 14);
  f.cyl(0, 0, h + 0.33, 0.2, 0.045, "steel", 14);
  for (let i = 1; i < Math.ceil(w / 0.8); i++) f.box(-w / 2 + i * 0.8, d / 2 + 8e-3, h / 2, [0.014, 0.015, h - 0.15], "steel_painted");
};
var originalTank = PREFABS.storage_tank;
PREFABS.storage_tank = (ctx, e2) => {
  originalTank(ctx, e2);
  if (!ctx.geometry) return;
  const f = new Frame(ctx, e2.base, e2.heading ?? 0), r = e2.radius ?? 6, h = e2.height ?? 8;
  f.cylY(0, -r - 0.07, 1, 0.45, 0.14, "steel", 24);
  f.cylY(0, -r - 0.16, 1, 0.37, 0.055, "steel_painted", 24);
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    f.cylY(0.4 * Math.cos(a), -r - 0.19, 1 + 0.4 * Math.sin(a), 0.03, 0.08, "steel_galv", 6);
  }
  for (let i = 0; i < 10; i++) {
    const a = i * Math.PI / 5, x = (r + 0.012) * Math.cos(a), y = (r + 0.012) * Math.sin(a);
    f.box(x, y, h * 0.48, [0.035, 0.035, h * 0.9], "steel_painted");
  }
  f.cyl(r * 0.4, 0, h + 0.4, 0.085, 0.7, "steel", 12);
  f.cyl(r * 0.4, 0, h + 0.76, 0.19, 0.05, "steel_galv", 16);
};

// server/src/ai/navmesh.ts
var NAV_CONFIG = {
  cell: 0.25,
  radius: MOVEMENT.radius,
  standHeight: MOVEMENT.stand_height,
  crouchHeight: MOVEMENT.crouch_height,
  step: MOVEMENT.step_height,
  maxSlopeDeg: MOVEMENT.max_slope_deg,
  maxRect: 16
};

// shared/src/destruction.ts
var CHUNK = Number(DESTRUCTION.chunk_size ?? 0.25);

// server/src/match/server.ts
function matchConfig(c) {
  if (c.map === "border") c = { ...c, map: "qalat" };
  if (c.rotation?.includes("border")) {
    const rotation = c.rotation.filter((m) => m !== "border");
    c = { ...c, rotation: rotation.length ? rotation : ["qalat"], rotationIndex: 0 };
  }
  return {
    map: "qalat",
    seed: null,
    difficulty: null,
    bots: [0, 0],
    tickRate: 64,
    snapshotRate: 32,
    shortTimers: false,
    fastRounds: false,
    startOnFirstJoin: true,
    reconnectGrace: 60,
    restartDelay: 15,
    title: "",
    mode: "bots",
    preset: "full",
    friendlyFire: null,
    fill: null,
    roster: {},
    joinTimeout: 60,
    ranked: false,
    pauseBudget: 60,
    spectatorDelay: 0,
    endAction: "restart",
    rotation: [],
    rotationIndex: 0,
    balance: false,
    pauseWhenEmpty: false,
    serverId: "",
    ...c
  };
}

// server/src/web/matches.ts
var MatchLimit = class extends Error {
};
var MatchHandle = class {
  constructor(config, worker) {
    this.config = config;
    this.worker = worker;
  }
  created = Date.now();
  status = "starting";
  users = /* @__PURE__ */ new Map();
  stats = {};
  roster = {};
  reason = "";
  closedWaiters = [];
  /** The user who started it (a quick match or a lobby's host); null for public servers. */
  owner = null;
  /** Bot matches and lobby matches can be stopped by whoever started them; duels and public servers can't. */
  stoppableBy(userId) {
    return this.status !== "closed" && this.owner === userId && this.config.mode === "bots" && !this.config.serverId;
  }
  get id() {
    return this.config.matchId;
  }
  post(m, transfer = []) {
    if (this.status === "closed") return;
    try {
      this.worker.postMessage(m, transfer);
    } catch {
    }
  }
  summary() {
    const s = this.stats;
    const users = [...this.users.values()];
    return {
      id: this.id,
      title: this.config.title || this.id,
      map: s.map ?? this.config.map,
      status: this.status,
      mode: this.config.mode,
      server_id: this.config.serverId,
      open: this.config.mode === "bots" && !Object.keys(this.config.roster).length,
      teams: s.teams ?? null,
      match_no: s.match_no ?? 1,
      idle: s.idle ?? false,
      paused: s.paused ?? false,
      players: users.filter((u) => u.mode === "play").length,
      spectators: users.filter((u) => u.mode === "spectate").length,
      bots: s.bots ?? this.config.bots[0] + this.config.bots[1],
      phase: s.phase ?? "",
      round: s.round ?? 0,
      score: s.score ?? [0, 0],
      tick_ms: Math.round((s.tick_ms_mean ?? 0) * 100) / 100,
      cpu: Math.round((s.cpu ?? 0) * 1e3) / 1e3
    };
  }
};
function workerFile() {
  if (import.meta.url.endsWith(".ts")) return { url: new URL("../match/worker-dev.mjs", import.meta.url), execArgv: [] };
  return { url: new URL("./worker.mjs", import.meta.url), execArgv: [] };
}
var MatchManager = class {
  constructor(deliver, maxMatches = 4, tickRate = 64, snapshotRate = 32, log2 = console.log) {
    this.deliver = deliver;
    this.maxMatches = maxMatches;
    this.tickRate = tickRate;
    this.snapshotRate = snapshotRate;
    this.log = log2;
  }
  matches = /* @__PURE__ */ new Map();
  live() {
    return [...this.matches.values()].filter((m) => m.status !== "closed");
  }
  create(options) {
    if (this.live().length >= this.maxMatches) throw new MatchLimit(`this host runs at most ${this.maxMatches} matches`);
    const id = options.matchId ?? randomBytes3(4).toString("hex");
    const cfg = matchConfig({ ...options, matchId: id, tickRate: this.tickRate, snapshotRate: this.snapshotRate });
    const wf = workerFile();
    const worker = new Worker(wf.url, { workerData: { config: cfg }, execArgv: wf.execArgv, name: `match-${id}` });
    const h = new MatchHandle(cfg, worker);
    this.matches.set(id, h);
    worker.on("message", (m) => this.onMessage(h, m));
    worker.on("error", (e2) => {
      this.log(`[matches] ${id} crashed: ${e2.stack ?? e2}`);
      this.close(h, `error: ${e2.message}`);
    });
    worker.on("exit", (code) => this.close(h, `worker exited (code ${code})`));
    this.log(`[matches] started ${id} (${cfg.mode}, ${cfg.map})`);
    return h;
  }
  get(id) {
    const h = this.matches.get(id);
    return h && h.status !== "closed" ? h : null;
  }
  list() {
    return this.live().map((m) => m.summary());
  }
  join(id, uid, name, mode = "play", team = null) {
    const h = this.get(id);
    if (!h) return false;
    h.users.set(uid, { name, mode });
    h.post({ t: "join", uid, name, mode, team });
    return true;
  }
  input(id, uid, data) {
    const h = this.matches.get(id);
    if (h && h.status === "running" && h.users.has(uid)) {
      const copy = data.slice();
      h.post({ t: "input", uid, data: copy }, [copy.buffer]);
    }
  }
  command(id, uid, kind, item) {
    const h = this.matches.get(id);
    if (h && h.status === "running" && h.users.has(uid)) h.post({ t: "cmd", uid, kind, item });
  }
  chat(id, uid, scope, text2) {
    const h = this.matches.get(id);
    if (h && h.status === "running" && h.users.has(uid)) h.post({ t: "chat", uid, scope, text: text2 });
  }
  /** User id -> roster entry of everyone playing (not spectating) in a match. */
  players(id) {
    const h = this.get(id);
    return Object.fromEntries(Object.entries(h ? h.roster : {}).filter(([, r]) => r.mode === "play"));
  }
  disconnect(id, uid) {
    const h = this.get(id);
    if (h && h.users.has(uid)) h.post({ t: "disconnect", uid });
  }
  leave(id, uid) {
    const h = this.get(id);
    if (h && h.users.delete(uid)) h.post({ t: "leave", uid });
  }
  async stop(id, timeoutMs = 5e3, reason) {
    const h = this.matches.get(id);
    if (!h || h.status === "closed") return;
    const closed = new Promise((resolve) => h.closedWaiters.push(resolve));
    h.post({ t: "stop", reason });
    const timer = setTimeout(() => {
      void h.worker.terminate();
    }, timeoutMs);
    await closed;
    clearTimeout(timer);
  }
  async stopAll(timeoutMs = 5e3) {
    await Promise.all(this.live().map((h) => this.stop(h.id, timeoutMs)));
  }
  close(h, reason) {
    if (h.status === "closed") return;
    h.status = "closed";
    h.reason = reason;
    this.log(`[matches] ${h.id} closed: ${reason}`);
    this.deliver(h.id, "closed", reason);
    for (const w of h.closedWaiters.splice(0)) w();
    setTimeout(() => {
      if (this.matches.get(h.id) === h) this.matches.delete(h.id);
    }, 6e4).unref();
    void h.worker.terminate();
  }
  onMessage(h, m) {
    switch (m.t) {
      case "snaps":
        this.deliver(h.id, "snaps", m.snaps);
        break;
      case "welcome":
        this.deliver(h.id, "welcome", { uid: m.uid, data: m.data });
        break;
      case "stats":
        h.stats = m.data;
        break;
      case "ready":
        h.status = "running";
        this.deliver(h.id, "ready", m.info);
        break;
      case "shop":
        this.deliver(h.id, "shop", { uid: m.uid, data: m.data });
        break;
      case "roster":
        h.roster = m.roster;
        break;
      case "result":
        this.deliver(h.id, "result", m.data);
        break;
      case "rotate":
        this.deliver(h.id, "rotate", { map: m.map, rotation_index: m.rotationIndex });
        break;
      case "log":
        this.log(m.text);
        break;
      case "closed":
        this.close(h, m.reason);
        break;
    }
  }
};

// server/src/web/protocol.ts
var MATCH_ID_RE = /^[0-9a-f]{8}$/;
var ITEM_RE = /^[a-z0-9_]{1,32}$/;
var LOBBY_CODE_RE = /^[A-Za-z0-9]{6}$/;
var TOKEN_RE = /^[A-Za-z0-9_-]{8,32}$/;
var READY_RE = /^[0-9a-f]{16}$/;
var SERVER_ID_RE = /^[a-z0-9-]{1,32}$/;
var USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;
var MAX_INPUT_BYTES2 = MAX_INPUT_BYTES;
var SchemaError = class extends Error {
};
var S = (type, extra = {}) => ({ type, required: true, ...extra });
var EVENTS2 = {
  "match:list": {},
  "match:join": {
    match_id: S("string", { pattern: MATCH_ID_RE }),
    as: S("string", { required: false, choices: ["play", "spectate"] }),
    team: S("integer", { required: false, choices: [0, 1], nullable: true })
  },
  "match:leave": {},
  "match:stop": { match_id: S("string", { pattern: MATCH_ID_RE }) },
  ping: { t: S("number", { min: 0, max: 2 ** 53 }) },
  buy: { item: S("string", { maxLen: 32, pattern: ITEM_RE }) },
  sell: { item: S("string", { maxLen: 32, pattern: ITEM_RE }) },
  specialist: { item: S("string", { maxLen: 32, pattern: ITEM_RE }) },
  "lobby:create": { settings: S("object", { required: false, maxLen: 10 }) },
  "lobby:join": { code: S("string", { pattern: LOBBY_CODE_RE }) },
  "lobby:leave": {},
  "lobby:update": { settings: S("object", { maxLen: 10 }) },
  "lobby:team": { team: S(["integer", "string"], { choices: [0, 1, "spectate"] }) },
  "lobby:start": {},
  "lobby:reopen": {},
  "queue:join": { mode: S("string", { choices: ["duel_ranked"] }) },
  "queue:leave": { mode: S("string", { required: false, choices: ["duel_ranked"] }) },
  "challenge:send": { username: S("string", { required: false, pattern: USERNAME_RE }) },
  "challenge:respond": { token: S("string", { pattern: TOKEN_RE }), accept: S("boolean") },
  ready: { match_token: S("string", { pattern: READY_RE }), ready: S("boolean") },
  "browser:watch": {},
  "browser:unwatch": {},
  "server:join": { server_id: S("string", { pattern: SERVER_ID_RE }), as: S("string", { required: false, choices: ["play", "spectate"] }) },
  "vote:kick": { target: S("integer", { min: 1, max: 65535 }) },
  "vote:cast": { yes: S("boolean") },
  chat: { scope: S("string", { choices: ["all", "team", "lobby"] }), text: S("string", { maxLen: 400 }) }
};
function typeOk(kind, v) {
  switch (kind) {
    case "string":
      return typeof v === "string";
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "integer":
      return typeof v === "number" && Number.isInteger(v);
    case "boolean":
      return typeof v === "boolean";
    case "object":
      return typeof v === "object" && v !== null && !Array.isArray(v);
  }
}
function check(name, spec, value2) {
  if (value2 === null) {
    if (spec.nullable) return null;
    throw new SchemaError(`${name}: required`);
  }
  const kinds = Array.isArray(spec.type) ? spec.type : [spec.type];
  if (!kinds.some((k) => typeOk(k, value2))) throw new SchemaError(`${name}: wrong type`);
  if (typeof value2 === "number") {
    if (spec.min !== void 0 && value2 < spec.min) throw new SchemaError(`${name}: below ${spec.min}`);
    if (spec.max !== void 0 && value2 > spec.max) throw new SchemaError(`${name}: above ${spec.max}`);
  }
  if (spec.maxLen !== void 0) {
    const len = typeof value2 === "string" ? value2.length : typeof value2 === "object" ? Object.keys(value2).length : 0;
    if (len > spec.maxLen) throw new SchemaError(`${name}: longer than ${spec.maxLen}`);
  }
  if (spec.choices && !spec.choices.includes(value2)) throw new SchemaError(`${name}: not one of ${spec.choices.join(", ")}`);
  if (spec.pattern && !spec.pattern.test(value2)) throw new SchemaError(`${name}: bad format`);
  return value2;
}
function validate(event, data) {
  const schema = Object.prototype.hasOwnProperty.call(EVENTS2, event) ? EVENTS2[event] : void 0;
  if (!schema) throw new SchemaError(`unknown event ${JSON.stringify(event).slice(0, 40)}`);
  const d = data === void 0 || data === null ? {} : data;
  if (typeof d !== "object" || Array.isArray(d)) throw new SchemaError("expected an object");
  const obj = d;
  for (const k of Object.keys(obj)) if (!(k in schema)) throw new SchemaError(`unknown field ${JSON.stringify(k)}`);
  const out = {};
  for (const [name, spec] of Object.entries(schema)) {
    if (!(name in obj)) {
      if (spec.required) throw new SchemaError(`${name}: required`);
      continue;
    }
    out[name] = check(name, spec, obj[name]);
  }
  return out;
}

// server/src/web/ranking.ts
var SCALE = 173.7178;
var TAU = 0.5;
var MIN_RD = 30;
var MAX_RD = 350;
var EPS = 1e-6;
var g4 = (phi) => 1 / Math.sqrt(1 + 3 * phi * phi / (Math.PI * Math.PI));
var e = (mu, muJ, phiJ) => 1 / (1 + Math.exp(-g4(phiJ) * (mu - muJ)));
function volatility(phi, sigma, delta, v, tau) {
  const a = Math.log(sigma * sigma);
  const f = (x) => {
    const ex = Math.exp(x);
    return ex * (delta * delta - phi * phi - v - ex) / (2 * (phi * phi + v + ex) ** 2) - (x - a) / (tau * tau);
  };
  let A = a, B;
  if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v);
  else {
    let k = 1;
    while (f(a - k * tau) < 0) k++;
    B = a - k * tau;
  }
  let fa = f(A), fb = f(B);
  for (let i = 0; i < 100; i++) {
    if (Math.abs(B - A) <= EPS) break;
    const C = A + (A - B) * fa / (fb - fa);
    const fc = f(C);
    if (fc * fb <= 0) {
      A = B;
      fa = fb;
    } else fa /= 2;
    B = C;
    fb = fc;
  }
  return Math.exp(A / 2);
}
function decay([r, rd, sigma]) {
  const phi = rd / SCALE;
  return [r, Math.min(Math.sqrt(phi * phi + sigma * sigma) * SCALE, MAX_RD), sigma];
}
function update(player, results, tau = TAU) {
  const [r, rd, sigma] = player;
  if (!results.length) return decay(player);
  const mu = (r - 1500) / SCALE, phi = rd / SCALE;
  let vInv = 0, deltaSum = 0;
  for (const [rJ, rdJ, s] of results) {
    const muJ = (rJ - 1500) / SCALE, phiJ = rdJ / SCALE;
    const gg = g4(phiJ), ee = e(mu, muJ, phiJ);
    vInv += gg * gg * ee * (1 - ee);
    deltaSum += gg * (s - ee);
  }
  const v = 1 / vInv;
  const delta = v * deltaSum;
  const sigma2 = volatility(phi, sigma, delta, v, tau);
  const phiStar = Math.sqrt(phi * phi + sigma2 * sigma2);
  const phi2 = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const mu2 = mu + phi2 * phi2 * deltaSum;
  return [1500 + mu2 * SCALE, Math.min(Math.max(phi2 * SCALE, MIN_RD), MAX_RD), sigma2];
}
function duel(a, b, scoreA) {
  return [update(a, [[b[0], b[1], scoreA]]), update(b, [[a[0], a[1], 1 - scoreA]])];
}

// server/src/web/results.ts
async function record(repo, matchId, result) {
  const n = Number(result.match_no ?? 1);
  let row = await repo.matchById(matchId);
  if (n > 1 || !row || row.resultJson !== "" && row.resultJson !== "{}" && row.ended !== null) {
    const rid = `${matchId}.${n}`.slice(0, 16);
    const base = row;
    row = await repo.matchById(rid);
    if (!row) {
      await repo.createMatch({
        id: rid,
        mode: result.mode ?? base?.mode ?? "bots",
        map: result.map ?? "qalat",
        title: base?.title ?? "",
        ranked: !!result.ranked,
        createdBy: base?.createdBy ?? null
      });
      row = await repo.matchById(rid);
    }
  }
  await repo.updateMatch(row.id, {
    mode: result.mode ?? row.mode,
    ranked: !!result.ranked,
    map: result.map ?? row.map,
    resultJson: JSON.stringify(result),
    status: "ended",
    ended: Date.now(),
    endReason: result.forfeit !== null && result.forfeit !== void 0 ? "forfeit" : "finished"
  });
  const winner = result.winner_team;
  for (const p of result.players ?? []) {
    if (typeof p.user_id !== "number") continue;
    const team = p.team ?? null;
    await repo.upsertMatchPlayer({
      matchId: row.id,
      userId: p.user_id,
      team,
      kills: p.kills | 0,
      deaths: p.deaths | 0,
      assists: p.assists | 0,
      headshots: p.headshots | 0,
      damage: p.damage | 0,
      rounds: p.rounds | 0,
      won: winner === null || winner === void 0 || team === null ? null : team === winner
    });
  }
  if (result.mode === "duel" && result.ranked) return rateDuel(repo, row.id, result);
  return {};
}
async function rateDuel(repo, matchId, result) {
  const players = (result.players ?? []).filter((p) => typeof p.user_id === "number" && (p.team === 0 || p.team === 1));
  if (players.length !== 2 || players[0].team === players[1].team) return {};
  const [a, b] = [...players].sort((x, y) => x.team - y.team);
  const winner = result.winner_team;
  const scoreA = winner === null || winner === void 0 ? 0.5 : winner === a.team ? 1 : 0;
  const ra = await repo.ratingOf(a.user_id), rb = await repo.ratingOf(b.user_id);
  const [newA, newB] = duel([ra.rating, ra.rd, ra.volatility], [rb.rating, rb.rd, rb.volatility], scoreA);
  const out = {};
  const rows = [[a, ra, newA, scoreA, b], [b, rb, newB, 1 - scoreA, a]];
  for (const [p, r, nw, score, opp] of rows) {
    const old = r.rating;
    [r.rating, r.rd, r.volatility] = nw;
    r.games += 1;
    r.updated = Date.now();
    await repo.saveRating(r);
    await repo.addRatingChange({ userId: p.user_id, matchId, opponentId: opp.user_id, before: old, after: r.rating, rdAfter: r.rd, score });
    out[p.user_id] = { before: Math.round(old), after: Math.round(r.rating), delta: Math.round(r.rating - old), rd: Math.round(r.rd) };
  }
  return out;
}
async function profile(repo, userId) {
  const rows = await repo.playerMatches(userId);
  let kills = 0, deaths = 0, damage = 0, rounds = 0, hs = 0, wins = 0, losses = 0;
  for (const { mp } of rows) {
    kills += mp.kills;
    deaths += mp.deaths;
    damage += mp.damage;
    rounds += mp.rounds;
    hs += mp.headshots;
    if (mp.won === true) wins++;
    if (mp.won === false) losses++;
  }
  const rating = await repo.findRating(userId);
  const history = await repo.ratingHistory(userId);
  const recent = rows.slice(0, 20).map(({ mp, m }) => {
    let res = {};
    try {
      res = JSON.parse(m.resultJson || "{}");
    } catch {
      res = {};
    }
    return {
      id: m.id,
      mode: m.mode,
      ranked: m.ranked,
      map: m.map,
      ended: m.ended,
      score: res.score ?? null,
      team: mp.team,
      won: mp.won,
      kills: mp.kills,
      deaths: mp.deaths,
      damage: mp.damage,
      rounds: mp.rounds,
      forfeit: res.forfeit !== null && res.forfeit !== void 0
    };
  });
  return {
    matches: rows.length,
    kills,
    deaths,
    kd: kills / Math.max(deaths, 1),
    adr: damage / Math.max(rounds, 1),
    hs: 100 * hs / Math.max(kills, 1),
    wins,
    losses,
    rating,
    history: history.map((h) => ({
      after: Math.round(h.after),
      before: Math.round(h.before),
      score: h.score,
      created: h.created,
      match_id: h.matchId
    })),
    recent
  };
}
async function leaderboard(repo, limit = 50) {
  const rows = await repo.leaderboard(limit);
  return rows.map(({ r, u }) => ({ name: u.username, rating: Math.round(r.rating), rd: Math.round(r.rd), games: r.games }));
}

// server/src/web/servers.ts
import fs4 from "node:fs";
var BACKOFF = [5, 30, 120];
var STABLE_AFTER = 600;
var KICK_BAN = 1800;
var VOTE_TIME = 30;
var VOTE_COOLDOWN = 60;
var PRESETS2 = ["full", "short"];
var DIFFICULTIES2 = ["easy", "normal", "hard", "expert"];
function serverOptions(s, rotationIndex = 0, fastRounds = false) {
  const idx = rotationIndex % s.rotation.length;
  return {
    map: s.rotation[idx],
    mode: "server",
    preset: s.preset,
    difficulty: s.difficulty,
    friendlyFire: s.friendlyFire,
    fill: [...s.fill],
    bots: [...s.fill],
    startOnFirstJoin: false,
    endAction: "rotate",
    rotation: [...s.rotation],
    rotationIndex: idx,
    balance: true,
    pauseWhenEmpty: s.pauseWhenEmpty,
    serverId: s.id,
    title: s.name,
    fastRounds,
    restartDelay: fastRounds ? 4 : 15
  };
}
function loadSpecs(file, maps) {
  const data = JSON.parse(fs4.readFileSync(file, "utf8"));
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const raw2 of data.servers ?? []) {
    const s = {
      id: String(raw2.id),
      name: String(raw2.name ?? raw2.id).slice(0, 60),
      region: String(raw2.region ?? "").slice(0, 12),
      rotation: (raw2.rotation?.length ? raw2.rotation : ["qalat"]).map(String).filter((m) => m !== "border"),
      maxPlayers: Number(raw2.max_players ?? 10),
      preset: raw2.preset ?? "short",
      fill: (raw2.fill ?? [5, 5]).map(Number),
      difficulty: raw2.difficulty ?? "normal",
      friendlyFire: !!raw2.friendly_fire,
      pauseWhenEmpty: !!raw2.pause_when_empty
    };
    if (!s.rotation.length) s.rotation = ["qalat"];
    if (seen.has(s.id)) throw new Error(`servers: duplicate id ${s.id}`);
    if (!/^[a-z0-9-]{1,32}$/.test(s.id)) throw new Error(`servers: ${s.id}: id must be 1-32 of a-z, 0-9 and -`);
    if (!PRESETS2.includes(s.preset) || !DIFFICULTIES2.includes(s.difficulty)) throw new Error(`servers: ${s.id}: bad preset or difficulty`);
    if (!(s.maxPlayers >= 1 && s.maxPlayers <= 10 && s.fill.length === 2 && s.fill.every((v) => v >= 0 && v <= 5))) {
      throw new Error(`servers: ${s.id}: max_players 1-10, fill two sizes 0-5`);
    }
    const missing = s.rotation.filter((m) => !maps.includes(m));
    if (missing.length) throw new Error(`servers: ${s.id}: unknown map ${missing[0]}`);
    seen.add(s.id);
    out.push(s);
  }
  return out;
}
var VoteKick = class {
  constructor(target, targetName, by, electorate, expires) {
    this.target = target;
    this.targetName = targetName;
    this.by = by;
    this.electorate = electorate;
    this.expires = expires;
  }
  yes = /* @__PURE__ */ new Set();
  no = /* @__PURE__ */ new Set();
  needed() {
    return Math.floor(this.electorate.size / 2) + 1;
  }
  cast(userId, yes) {
    if (!this.electorate.has(userId)) return;
    (yes ? this.yes : this.no).add(userId);
    (yes ? this.no : this.yes).delete(userId);
  }
  /** "passed", "failed" or null (still open). */
  outcome(now2) {
    if (this.yes.size >= this.needed()) return "passed";
    if (this.electorate.size - this.no.size < this.needed() || now2 >= this.expires) return "failed";
    return null;
  }
  state(now2) {
    return { target: this.targetName, yes: this.yes.size, no: this.no.size, needed: this.needed(), left: Math.max(0, Math.round(this.expires - now2)) };
  }
};
var ServerState = class {
  constructor(spec) {
    this.spec = spec;
  }
  matchId = null;
  status = "stopped";
  failures = 0;
  retryAt = null;
  startedAt = 0;
  rotationIndex = 0;
  reason = "";
  kicks = /* @__PURE__ */ new Map();
  vote = null;
  voteCooldown = /* @__PURE__ */ new Map();
};
var PublicServers = class {
  constructor(specs, startFn, clock = () => performance.now() / 1e3, log2 = console.log) {
    this.startFn = startFn;
    this.clock = clock;
    this.log = log2;
    for (const s of specs) this.states.set(s.id, new ServerState(s));
  }
  states = /* @__PURE__ */ new Map();
  get(id) {
    return this.states.get(id) ?? null;
  }
  byMatch(matchId) {
    return [...this.states.values()].find((s) => s.matchId === matchId) ?? null;
  }
  start(id) {
    const st = this.states.get(id);
    if (!st) return false;
    try {
      st.matchId = this.startFn(st);
    } catch (e2) {
      st.reason = e2.message;
      this.retry(st);
      return false;
    }
    st.status = "starting";
    st.startedAt = this.clock();
    st.retryAt = null;
    return true;
  }
  startAll() {
    for (const id of this.states.keys()) this.start(id);
  }
  ready(matchId) {
    const st = this.byMatch(matchId);
    if (st) st.status = "running";
  }
  retry(st) {
    const delay = BACKOFF[Math.min(st.failures, BACKOFF.length - 1)];
    st.failures++;
    st.status = "restarting";
    st.retryAt = this.clock() + delay;
    this.log(`[servers] ${st.spec.id}: restarting in ${delay} s (${st.reason})`);
  }
  /** The worker says the next map is a different one: the next start uses it. */
  rotated(matchId, rotationIndex) {
    const st = this.byMatch(matchId);
    if (st) st.rotationIndex = rotationIndex;
  }
  /** A server's worker ended: start it again (now after a rotation, else with backoff). */
  closed(matchId, reason) {
    const st = this.byMatch(matchId);
    if (!st || st.status === "stopped") return null;
    st.matchId = null;
    st.vote = null;
    st.reason = reason;
    if (reason === "rotate") {
      st.failures = 0;
      st.status = "restarting";
      st.retryAt = this.clock();
    } else {
      if (this.clock() - st.startedAt > STABLE_AFTER) st.failures = 0;
      this.retry(st);
    }
    return st;
  }
  /** Stop every server for good (shutdown). */
  stopAll() {
    for (const st of this.states.values()) {
      st.status = "stopped";
      st.retryAt = null;
    }
  }
  due() {
    const now2 = this.clock();
    return [...this.states].filter(([, st]) => st.status === "restarting" && st.retryAt !== null && st.retryAt <= now2).map(([id]) => id);
  }
  bannedFor(id, userId) {
    const st = this.states.get(id);
    if (!st) return 0;
    return Math.max(0, (st.kicks.get(userId) ?? 0) - this.clock());
  }
  startVote(id, by, target, targetName, players) {
    const now2 = this.clock();
    const st = this.states.get(id);
    if (!st) return [false, "no such server"];
    if (st.vote) return [false, "a vote is already running"];
    if (target === by) return [false, "you can't kick yourself"];
    if (!players.has(target) || !players.has(by)) return [false, "both must be playing on this server"];
    if ((st.voteCooldown.get(by) ?? 0) > now2) return [false, "wait before starting another vote"];
    const electorate = new Set([...players].filter((u) => u !== target));
    st.vote = new VoteKick(target, targetName, by, electorate, now2 + VOTE_TIME);
    st.vote.cast(by, true);
    st.voteCooldown.set(by, now2 + VOTE_COOLDOWN);
    return [true, ""];
  }
  cast(id, userId, yes) {
    const st = this.states.get(id);
    if (!st || !st.vote) return null;
    st.vote.cast(userId, yes);
    return st.vote;
  }
  /** Votes that ended: [[server, vote, "passed" | "failed"]]; a passed vote bans its target. */
  resolveVotes() {
    const now2 = this.clock();
    const out = [];
    for (const st of this.states.values()) {
      const v = st.vote;
      if (!v) continue;
      const res = v.outcome(now2);
      if (!res) continue;
      st.vote = null;
      if (res === "passed") st.kicks.set(v.target, now2 + KICK_BAN);
      out.push([st, v, res]);
    }
    return out;
  }
  /** One row per server for the browser. summaryOf(matchId) -> the match's stats or null. */
  rows(summaryOf) {
    return [...this.states.values()].map((st) => {
      const s = (st.matchId ? summaryOf(st.matchId) : null) ?? {};
      const teams = s.teams ?? [{}, {}];
      const humans = teams.reduce((n, t) => n + (t.humans ?? 0), 0);
      const bots = teams.reduce((n, t) => n + (t.bots ?? 0), 0);
      return {
        id: st.spec.id,
        name: st.spec.name,
        region: st.spec.region,
        map: s.map ?? st.spec.rotation[st.rotationIndex % st.spec.rotation.length],
        players: humans,
        bots,
        max: st.spec.maxPlayers,
        round: s.round ?? 0,
        score: s.score ?? [0, 0],
        phase: s.phase ?? "",
        status: s.idle ? "idle" : st.status,
        match_no: s.match_no ?? 0,
        preset: st.spec.preset,
        difficulty: st.spec.difficulty
      };
    });
  }
};

// server/src/web/sessions.ts
import { createHmac, randomBytes as randomBytes4, timingSafeEqual } from "node:crypto";
var COOKIE = "cs_session";
var SESSION_DAYS = 7;
var REMEMBER_DAYS = 30;
var SessionCodec = class {
  constructor(secret, secure) {
    this.secret = secret;
    this.secure = secure;
  }
  sign(data) {
    return createHmac("sha256", this.secret).update(data).digest("base64url");
  }
  fresh() {
    return { n: randomBytes4(16).toString("base64url"), t: Math.floor(Date.now() / 1e3) };
  }
  encode(s) {
    const body = Buffer.from(JSON.stringify(s)).toString("base64url");
    return `${body}.${this.sign(body)}`;
  }
  decode(value2) {
    if (!value2) return null;
    const dot2 = value2.lastIndexOf(".");
    if (dot2 < 1) return null;
    const body = value2.slice(0, dot2);
    const sig = Buffer.from(value2.slice(dot2 + 1));
    const want = Buffer.from(this.sign(body));
    if (sig.length !== want.length || !timingSafeEqual(sig, want)) return null;
    try {
      const s = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
      if (typeof s.n !== "string" || typeof s.t !== "number") return null;
      const maxAge = (s.r ? REMEMBER_DAYS : SESSION_DAYS) * 86400;
      if (s.u !== void 0 && Date.now() / 1e3 - s.t > maxAge) return { n: s.n, t: s.t };
      return s;
    } catch {
      return null;
    }
  }
  /** The Set-Cookie options for a session. */
  cookieOptions(s) {
    return { httpOnly: true, sameSite: "lax", secure: this.secure, path: "/", ...s.r ? { maxAge: REMEMBER_DAYS * 86400 } : {} };
  }
  csrf(s) {
    return createHmac("sha256", this.secret).update(`csrf:${s.n}`).digest("base64url").slice(0, 32);
  }
  checkCsrf(s, token) {
    if (typeof token !== "string") return false;
    const a = Buffer.from(token), b = Buffer.from(this.csrf(s));
    return a.length === b.length && timingSafeEqual(a, b);
  }
};
function cookieValue(header, name) {
  if (!header) return void 0;
  for (const part of header.split(";")) {
    const eq2 = part.indexOf("=");
    if (eq2 < 0) continue;
    if (part.slice(0, eq2).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq2 + 1).trim());
      } catch {
        return void 0;
      }
    }
  }
  return void 0;
}

// server/src/web/security.ts
import { hash, verify } from "@node-rs/argon2";
var USERNAME_RE2 = /^[A-Za-z0-9_-]{3,20}$/;
var RESERVED = /* @__PURE__ */ new Set([
  "admin",
  "administrator",
  "bot",
  "bots",
  "server",
  "system",
  "moderator",
  "spectator",
  "cold_sector",
  "coldsector",
  "null",
  "none",
  "root"
]);
var PASSWORD_MIN = 8;
var PASSWORD_MAX = 128;
var OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
async function hashPassword(password) {
  return hash(password, OPTS);
}
async function checkPassword(stored, password) {
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}
function needsRehash(stored) {
  const m = /^\$argon2id\$v=\d+\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(stored);
  if (!m) return true;
  return Number(m[1]) < OPTS.memoryCost || Number(m[2]) < OPTS.timeCost;
}
function usernameProblem(name) {
  if (!USERNAME_RE2.test(name || "")) return "3-20 characters: letters, digits, _ and -";
  const low = name.toLowerCase();
  if (RESERVED.has(low) || low.startsWith("bot_")) return "that name is reserved";
  if (!wordFilter().usernameOk(name)) return "please choose another name";
  return null;
}
var dummy = null;
function dummyHash() {
  dummy ??= hashPassword("not a real password, only spends the same time");
  return dummy;
}
var LoginLimiter = class {
  // key -> (until, lockouts so far)
  constructor(limit = 5, window = 60, lockout = 60, maxLockout = 3600, clock = () => performance.now() / 1e3) {
    this.limit = limit;
    this.window = window;
    this.lockout = lockout;
    this.maxLockout = maxLockout;
    this.clock = clock;
  }
  fails = /* @__PURE__ */ new Map();
  locked = /* @__PURE__ */ new Map();
  /** Seconds until these keys may try again (0: now). */
  retryAfter(...keys) {
    const now2 = this.clock();
    return Math.max(0, ...keys.map((k) => (this.locked.get(k)?.[0] ?? 0) - now2));
  }
  failed(...keys) {
    const now2 = this.clock();
    for (const k of keys) {
      let hits = [...(this.fails.get(k) ?? []).filter((t) => now2 - t < this.window), now2];
      if (hits.length >= this.limit) {
        const n = this.locked.get(k)?.[1] ?? 0;
        this.locked.set(k, [now2 + Math.min(this.maxLockout, this.lockout * 2 ** n), n + 1]);
        hits = [];
      }
      this.fails.set(k, hits);
    }
    if (this.fails.size > 1e4) {
      for (const [k, v] of this.fails) if (!v.length || now2 - v[v.length - 1] >= this.window) this.fails.delete(k);
      for (const [k, v] of this.locked) if (v[0] <= now2 - this.maxLockout) this.locked.delete(k);
    }
  }
  succeeded(...keys) {
    for (const k of keys) {
      this.fails.delete(k);
      this.locked.delete(k);
    }
  }
};
var TokenBucket = class {
  constructor(rate, burst, clock = () => performance.now() / 1e3) {
    this.rate = rate;
    this.burst = burst;
    this.clock = clock;
    this.tokens = burst;
    this.t = clock();
  }
  tokens;
  t;
  take(n = 1) {
    const now2 = this.clock();
    this.tokens = Math.min(this.burst, this.tokens + (now2 - this.t) * this.rate);
    this.t = now2;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
};

// server/src/web/gateway.ts
var CONTROL_RATE = 5;
var CONTROL_BURST = 20;
var INPUT_RATE = 160;
var INPUT_BURST = 64;
var HOUSEKEEPING_MS = 500;
var BROWSER_EVERY = 2;
var MAX_TEXT = 8 * 1024;
var nextSid = 1;
var Connection = class {
  constructor(ws, userId, name, ip) {
    this.ws = ws;
    this.userId = userId;
    this.name = name;
    this.ip = ip;
  }
  sid = nextSid++;
  matchId = null;
  mode = "play";
  control = new TokenBucket(CONTROL_RATE, CONTROL_BURST);
  inputs = new TokenBucket(INPUT_RATE, INPUT_BURST);
  refused = 0;
  alive = true;
  connected = Date.now();
  rooms = /* @__PURE__ */ new Set();
  send(event, data = {}) {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify({ e: event, d: data }));
  }
};
var Gateway = class {
  constructor(cfg, repo, sessions, proxy, log2 = console.log) {
    this.cfg = cfg;
    this.repo = repo;
    this.sessions = sessions;
    this.proxy = proxy;
    this.log = log2;
    this.matches = new MatchManager((mid, kind, payload) => this.deliver(mid, kind, payload), cfg.maxMatches, cfg.tickRate, cfg.snapshotRate, log2);
    this.lobbies = new LobbyManager(this.maps.length ? this.maps : ["qalat"]);
    const specs = cfg.serversFile ? (() => {
      try {
        return loadSpecs(cfg.serversFile, this.maps);
      } catch (e2) {
        log2(`[servers] ${e2.message}`);
        return [];
      }
    })() : [];
    this.servers = new PublicServers(specs, (st) => this.startServer(st), void 0, log2);
  }
  bySid = /* @__PURE__ */ new Map();
  byUser = /* @__PURE__ */ new Map();
  userMatch = /* @__PURE__ */ new Map();
  // survives reconnects
  matches;
  lobbies;
  queue = new DuelQueue();
  challenges = new Challenges();
  readies = new ReadyChecks();
  chatLimit = new ChatLimiter();
  servers;
  maps = availableMaps();
  wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
  rooms = /* @__PURE__ */ new Map();
  timer = null;
  pinger = null;
  browserT = 0;
  stopping = false;
  start() {
    this.timer = setInterval(() => {
      try {
        this.housekeeping();
      } catch (e2) {
        this.log(`[gateway] housekeeping: ${e2.stack}`);
      }
    }, HOUSEKEEPING_MS);
    this.pinger = setInterval(() => this.pingAll(), this.cfg.pingInterval * 1e3);
    if (this.cfg.autostartServers) this.servers.startAll();
  }
  /** Stop accepting, tell everyone, stop every match (results of finished matches are already stored). */
  async stop() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    if (this.pinger) clearInterval(this.pinger);
    this.servers.stopAll();
    for (const c of this.bySid.values()) {
      c.send("server:shutdown", { text: "The server is restarting. Reconnect in a moment." });
      c.ws.close(1012, "server restarting");
    }
    await this.matches.stopAll(4e3);
    this.wss.close();
  }
  // ------------------------------------------------------------ helpers
  toUser(userId, event, data) {
    const c = this.byUser.get(userId);
    if (!c) return false;
    c.send(event, data);
    return true;
  }
  toMatch(matchId, event, data, users = null) {
    const h = this.matches.matches.get(matchId);
    for (const uid of users ?? (h ? h.users.keys() : [])) {
      const c = this.byUser.get(uid);
      if (c && c.matchId === matchId) c.send(event, data);
    }
  }
  join_room(c, room) {
    let s = this.rooms.get(room);
    if (!s) this.rooms.set(room, s = /* @__PURE__ */ new Set());
    s.add(c);
    c.rooms.add(room);
  }
  leaveRoom(c, room) {
    this.rooms.get(room)?.delete(c);
    c.rooms.delete(room);
  }
  toRoom(room, event, data) {
    for (const c of this.rooms.get(room) ?? []) c.send(event, data);
  }
  lobbyChanged(lb, closed = false) {
    if (closed) {
      if (lb.matchId) void this.matches.stop(lb.matchId);
      return;
    }
    this.toRoom(`lobby:${lb.code}`, "lobby:state", lb.state());
  }
  // ------------------------------------------------------------ matches
  async createMatch(user, options, mode) {
    const h = this.matches.create({ ...options, mode });
    if (mode === "bots" && user) h.owner = user.id;
    await this.repo.createMatch({ id: h.id, mode, map: h.config.map, title: h.config.title || "", ranked: !!options.ranked, createdBy: user ? user.id : null });
    return h;
  }
  /** Stop a match its creator started (quick matches, lobby matches). Everyone in it is told who stopped it. */
  stopMatch(userId, name, matchId) {
    const h = this.matches.get(matchId);
    if (!h) return [false, "that match is not running"];
    if (!h.stoppableBy(userId)) return [false, "only whoever started a bot or lobby match can stop it"];
    this.log(`[matches] ${matchId} stopped by ${name}`);
    void this.matches.stop(matchId, 5e3, `stopped by ${name}`);
    return [true, ""];
  }
  startServer(st) {
    const h = this.matches.create(serverOptions(st.spec, st.rotationIndex, this.cfg.devFastRounds));
    void this.repo.createMatch({ id: h.id, mode: "server", map: h.config.map, title: h.config.title, ranked: false, createdBy: null }).catch((e2) => this.log(`[db] ${e2}`));
    return h.id;
  }
  deliver(matchId, kind, payload) {
    if (kind === "snaps") {
      for (const [uid, parts] of payload) {
        const c = this.byUser.get(uid);
        if (!c || c.matchId !== matchId || c.ws.readyState !== c.ws.OPEN) continue;
        for (const part of parts) {
          const frame = Buffer.allocUnsafe(part.length + 1);
          frame[0] = CH_SNAP;
          frame.set(part, 1);
          c.ws.send(frame, { binary: true });
        }
      }
    } else if (kind === "welcome") {
      const c = this.byUser.get(payload.uid);
      if (c && c.matchId === matchId) {
        const lb = this.lobbies.byMatch(matchId);
        const h = this.matches.get(matchId);
        c.send("match:welcome", {
          ...payload.data,
          match_id: matchId,
          interp_ms: this.cfg.interpMs,
          snapshot_rate: this.cfg.snapshotRate,
          you: c.name,
          can_stop: !!h && h.stoppableBy(c.userId),
          ...lb ? { lobby: lb.code } : {}
        });
      }
    } else if (kind === "shop") {
      const c = this.byUser.get(payload.uid);
      if (c && c.matchId === matchId) c.send("shop", payload.data);
    } else if (kind === "ready") this.servers.ready(matchId);
    else if (kind === "result") void this.result(matchId, payload);
    else if (kind === "rotate") this.servers.rotated(matchId, Number(payload.rotation_index ?? 0));
    else if (kind === "closed") void this.closed(matchId, String(payload));
  }
  async result(matchId, result) {
    let changes = {};
    try {
      changes = await record(this.repo, matchId, result);
    } catch (e2) {
      this.log(`[results] could not record ${matchId}: ${e2.stack}`);
    }
    const lb = this.lobbies.byMatch(matchId);
    const pick = (p) => Object.fromEntries(["name", "team", "kills", "deaths", "assists", "damage", "headshots", "rounds", "score"].map((k) => [k, p[k]]));
    const end = {
      match_id: matchId,
      mode: result.mode,
      ranked: result.ranked,
      winner_team: result.winner_team,
      score: result.score,
      rounds: result.rounds,
      overtime: result.overtime,
      forfeit: result.forfeit,
      mvp: result.mvp,
      match_no: result.match_no,
      players: (result.players ?? []).map(pick),
      bots: result.bots ?? [],
      lobby: lb ? lb.code : null,
      ratings: Object.fromEntries(Object.entries(changes).map(([u, ch]) => [String(u), ch])),
      names: Object.fromEntries((result.players ?? []).map((p) => [String(p.user_id), p.name]))
    };
    const h = this.matches.matches.get(matchId);
    if (h && h.config.endAction === "rotate") end.next_in = h.config.restartDelay;
    this.toMatch(matchId, "match:end", end);
    if (lb) {
      lb.ended(end);
      this.lobbyChanged(lb);
    }
  }
  async closed(matchId, reason) {
    let movedTo = null;
    const st = this.servers.byMatch(matchId);
    if (st) {
      this.servers.closed(matchId, reason);
      if (reason === "rotate" && !this.stopping && this.servers.start(st.spec.id)) movedTo = st.matchId;
    }
    for (const [u, [m]] of [...this.userMatch]) {
      if (m !== matchId) continue;
      this.userMatch.delete(u);
      const c = this.byUser.get(u);
      if (!c) continue;
      c.matchId = null;
      if (movedTo && st) c.send("match:moved", { match_id: movedTo, server_id: st.spec.id });
      else c.send("match:closed", { match_id: matchId, reason });
    }
    const lb = this.lobbies.byMatch(matchId);
    if (lb) {
      lb.ended();
      this.lobbyChanged(lb);
    }
    try {
      await this.repo.closeMatch(matchId, reason);
    } catch (e2) {
      this.log(`[db] ${e2}`);
    }
  }
  // --------------------------------------------------------- connections
  /** The HTTP upgrade on /ws: origin, session, account, then the WebSocket. */
  async upgrade(req, socket, head) {
    const refuse = (code, text2) => {
      socket.write(`HTTP/1.1 ${code} ${text2}\r
Connection: close\r
Content-Length: 0\r
\r
`);
      socket.destroy();
    };
    if (this.stopping) return refuse(503, "Service Unavailable");
    const { ip, proto } = this.proxy.resolve(req.socket.remoteAddress, req.headers, req.socket.encrypted === true);
    const origin2 = req.headers.origin;
    if (origin2 && !this.originAllowed(origin2, proto, req.headers.host)) {
      this.log(`[ws] refused origin ${origin2} from ${ip}`);
      return refuse(403, "Forbidden");
    }
    const s = this.sessions.decode(cookieValue(req.headers.cookie, COOKIE));
    if (!s || s.u === void 0) return refuse(401, "Unauthorized");
    let user = null;
    try {
      user = await this.repo.userById(s.u);
    } catch {
      return refuse(500, "Internal Server Error");
    }
    if (!user || isBanned(user)) return refuse(403, "Forbidden");
    const u = user;
    this.wss.handleUpgrade(req, socket, head, (ws) => this.connect(ws, u, ip));
  }
  originAllowed(origin2, proto, host) {
    if (this.cfg.allowedOrigins.includes(origin2)) return true;
    return !!host && origin2 === `${proto}://${host}`;
  }
  connect(ws, user, ip) {
    const c = new Connection(ws, user.id, user.username, ip);
    const old = this.byUser.get(user.id);
    this.bySid.set(c.sid, c);
    this.byUser.set(user.id, c);
    if (old && old.sid !== c.sid) {
      this.bySid.delete(old.sid);
      old.send("kicked", { reason: "connected from another tab" });
      old.ws.close(4e3, "replaced");
      for (const r of [...old.rooms]) this.leaveRoom(old, r);
    }
    const prev = this.userMatch.get(user.id);
    if (prev) [c.matchId, c.mode] = prev;
    const lb = this.lobbies.ofUser(user.id);
    const m = lb?.members.get(user.id);
    if (m) m.online = true;
    ws.on("pong", () => {
      c.alive = true;
    });
    ws.on("message", (data, isBinary) => {
      try {
        if (isBinary) this.onBinary(c, data);
        else void this.onText(c, data.toString());
      } catch (e2) {
        this.log(`[ws] ${c.name}: ${e2.stack}`);
      }
    });
    ws.on("close", () => this.disconnect(c));
    ws.on("error", () => ws.terminate());
    c.send("hello", { user: user.username, user_id: user.id, server_time: Date.now() / 1e3 });
  }
  pingAll() {
    for (const c of this.bySid.values()) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      try {
        c.ws.ping();
      } catch {
        c.ws.terminate();
      }
    }
  }
  disconnect(c) {
    for (const r of [...c.rooms]) this.leaveRoom(c, r);
    if (!this.bySid.delete(c.sid)) return;
    if (this.byUser.get(c.userId) !== c) return;
    this.byUser.delete(c.userId);
    if (c.matchId) this.matches.disconnect(c.matchId, c.userId);
    this.queue.leave(c.userId);
    const rc = this.readies.cancelUser(c.userId);
    if (rc) this.readyFailed(rc, c.userId);
    const lb = this.lobbies.offline(c.userId);
    if (lb) this.lobbyChanged(lb);
  }
  onBinary(c, data) {
    if (data.length < 1 || data[0] !== CH_INPUT) return void c.refused++;
    if (!c.matchId || c.mode !== "play") return;
    const n = data.length - 1;
    if (n < INPUT_HEADER || n > MAX_INPUT_BYTES2) return void c.refused++;
    if (!c.inputs.take()) return void c.refused++;
    this.matches.input(c.matchId, c.userId, new Uint8Array(data.buffer, data.byteOffset + 1, n));
  }
  async onText(c, text2) {
    if (text2.length > MAX_TEXT) return void c.refused++;
    let msg;
    try {
      msg = JSON.parse(text2);
    } catch {
      return void c.refused++;
    }
    if (!msg || typeof msg !== "object" || typeof msg.e !== "string") return void c.refused++;
    const id = Number.isInteger(msg.id) ? msg.id : null;
    const reply = (d) => {
      if (id !== null && c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify({ e: "ack", id, d }));
    };
    if (!c.control.take()) return reply(this.refuse(c, "rate", "too many requests"));
    let args;
    try {
      args = validate(msg.e, msg.d);
    } catch (e2) {
      return reply(this.refuse(c, "schema", e2.message));
    }
    try {
      reply(await this.handle(c, msg.e, args));
    } catch (e2) {
      if (e2 instanceof LobbyError) reply({ ok: false, error: "lobby", text: e2.message });
      else {
        this.log(`[ws] ${msg.e} from ${c.name}: ${e2.stack}`);
        reply({ ok: false, error: "server", text: "something went wrong" });
      }
    }
  }
  refuse(c, code, text2) {
    c.refused++;
    this.log(`[ws] refused ${code} from ${c.name}: ${text2}`);
    return { ok: false, error: code, text: text2 };
  }
  // ------------------------------------------------------------- events
  async handle(c, event, a) {
    const fail = (code, text2) => ({ ok: false, error: code, text: text2 });
    switch (event) {
      case "ping":
        c.send("pong", { t: a.t, server_time: Date.now() / 1e3 });
        return { ok: true };
      case "match:list":
        return { ok: true, matches: this.matches.list() };
      case "match:join": {
        const [ok, why] = this.join(c, a.match_id, a.as ?? "play", a.team ?? null);
        return ok ? { ok } : { ok, error: "join", text: why };
      }
      case "match:stop": {
        const [ok, why] = this.stopMatch(c.userId, c.name, a.match_id);
        return ok ? { ok: true } : fail("stop", why);
      }
      case "match:leave":
        this.leave(c);
        return { ok: true };
      case "buy":
      case "sell":
      case "specialist":
        if (!c.matchId || c.mode !== "play") return fail("state", "not playing");
        this.matches.command(c.matchId, c.userId, event, a.item);
        return { ok: true, queued: true };
      case "lobby:create": {
        const [lb, changed] = this.lobbies.create(c.userId, c.name, a.settings ?? {});
        for (const [old, closed] of changed) {
          this.leaveRoom(c, `lobby:${old.code}`);
          this.lobbyChanged(old, closed);
        }
        this.join_room(c, `lobby:${lb.code}`);
        this.lobbyChanged(lb);
        return { ok: true, code: lb.code, state: lb.state() };
      }
      case "lobby:join": {
        const [lb, changed] = this.lobbies.join(String(a.code).toUpperCase(), c.userId, c.name);
        for (const [old, closed] of changed) {
          this.leaveRoom(c, `lobby:${old.code}`);
          this.lobbyChanged(old, closed);
        }
        this.join_room(c, `lobby:${lb.code}`);
        this.lobbyChanged(lb);
        return { ok: true, code: lb.code, state: lb.state(), you: c.userId };
      }
      case "lobby:leave":
        for (const [lb, closed] of this.lobbies.leave(c.userId)) {
          this.leaveRoom(c, `lobby:${lb.code}`);
          this.lobbyChanged(lb, closed);
        }
        return { ok: true };
      case "lobby:update": {
        const lb = this.myLobby(c);
        lb.update(c.userId, a.settings);
        this.lobbyChanged(lb);
        return { ok: true };
      }
      case "lobby:team": {
        const lb = this.myLobby(c);
        lb.setTeam(c.userId, a.team);
        this.lobbyChanged(lb);
        return { ok: true };
      }
      case "lobby:start": {
        const lb = this.myLobby(c);
        const opts = lb.start(c.userId);
        opts.fastRounds = this.cfg.devFastRounds;
        try {
          const h = await this.createMatch({ id: c.userId }, opts, "bots");
          lb.started(h.id);
          this.lobbyChanged(lb);
          return { ok: true, match_id: h.id };
        } catch (e2) {
          lb.failed();
          this.lobbyChanged(lb);
          if (e2 instanceof MatchLimit) return fail("full", e2.message);
          throw e2;
        }
      }
      case "lobby:reopen": {
        const lb = this.myLobby(c);
        lb.reopen(c.userId);
        this.lobbyChanged(lb);
        return { ok: true };
      }
      case "queue:join": {
        const busy = this.busy(c);
        if (busy) return fail("busy", busy);
        const r = await this.repo.ratingOf(c.userId);
        this.queue.join(c.userId, c.name, r.rating, r.rd);
        const st = this.queue.status(c.userId);
        c.send("queue:status", st);
        return { ok: true, status: st };
      }
      case "queue:leave":
        this.queue.leave(c.userId);
        return { ok: true };
      case "challenge:send": {
        const name = a.username;
        let target = null;
        if (name) {
          target = await this.repo.userByName(name);
          if (!target) return fail("challenge", "no player with that name");
          if (target.id === c.userId) return fail("challenge", "you can't challenge yourself");
        }
        const ch = this.challenges.create(c.userId, c.name, target ? target.id : null, target ? target.username : "");
        const delivered = target ? this.toUser(target.id, "challenge:incoming", ch.info()) : false;
        return { ok: true, ...ch.info(), delivered };
      }
      case "challenge:respond": {
        const token = a.token;
        if (!a.accept) {
          const ch2 = this.challenges.decline(token, c.userId);
          if (ch2) this.toUser(ch2.fromId, "challenge:declined", { token, by: c.name });
          return { ok: true };
        }
        const busy = this.busy(c);
        if (busy) return fail("busy", busy);
        const ch = this.challenges.take(token, c.userId);
        if (!ch) return fail("challenge", "this challenge has expired or was already answered");
        if (!this.byUser.has(ch.fromId)) return fail("challenge", `${ch.fromName} is not online right now`);
        this.queue.leave(c.userId);
        this.queue.leave(ch.fromId);
        const rc = this.readies.create([ch.fromId, ch.fromName], [c.userId, c.name], false);
        await this.readyFound(rc);
        return { ok: true, match_token: rc.token };
      }
      case "ready": {
        const [status, rc] = this.readies.answer(a.match_token, c.userId, a.ready);
        if (!rc) return fail("ready", "this ready-check is over");
        if (status === "declined") await this.readyFailed(rc, c.userId);
        else if (status === "go") {
          for (const [uid] of rc.players) this.toUser(uid, "ready:state", { ...rc.state(), status: "go" });
          await this.startDuel(rc);
        } else for (const [uid] of rc.players) this.toUser(uid, "ready:state", { ...rc.state(), status: "waiting" });
        return { ok: true, status };
      }
      case "browser:watch":
        this.join_room(c, "browser");
        return { ok: true, servers: this.browserRows() };
      case "browser:unwatch":
        this.leaveRoom(c, "browser");
        return { ok: true };
      case "server:join": {
        const st = this.servers.get(a.server_id);
        if (st && st.status === "stopped" && !st.matchId && !this.stopping) this.servers.start(st.spec.id);
        if (!st || !st.matchId || !this.matches.get(st.matchId)) return fail("server", "that server is not running right now");
        const wait = this.servers.bannedFor(st.spec.id, c.userId);
        if (wait > 0) return fail("kicked", `you were kicked from this server (${Math.floor(wait / 60) + 1} min left)`);
        const mode = a.as ?? "play";
        if (mode === "play" && Object.keys(this.matches.players(st.matchId)).length >= st.spec.maxPlayers) return fail("full", "the server is full (you can spectate)");
        return { ok: true, match_id: st.matchId, url: `/game/${st.matchId}?as=${mode}` };
      }
      case "vote:kick": {
        const h = c.matchId ? this.matches.get(c.matchId) : null;
        if (!h || !h.config.serverId) return fail("vote", "vote kicks are for public servers");
        const players = this.matches.players(h.id);
        const entry2 = Object.entries(players).find(([, r]) => r.slot === a.target);
        if (!entry2) return fail("vote", "that is not a player");
        const target = Number(entry2[0]);
        const [ok, why] = this.servers.startVote(h.config.serverId, c.userId, target, entry2[1].name, new Set(Object.keys(players).map(Number)));
        if (!ok) return fail("vote", why);
        const st = this.servers.get(h.config.serverId);
        this.toMatch(h.id, "vote:state", { ...st.vote.state(this.servers.clock()), by: c.name });
        return { ok: true };
      }
      case "vote:cast": {
        const h = c.matchId ? this.matches.get(c.matchId) : null;
        if (!h || !h.config.serverId) return fail("vote", "no vote here");
        const v = this.servers.cast(h.config.serverId, c.userId, a.yes);
        if (!v) return fail("vote", "no vote is running");
        this.toMatch(h.id, "vote:state", v.state(this.servers.clock()));
        for (const [st, vote, res] of this.servers.resolveVotes()) this.voteDone(st, vote, res);
        return { ok: true };
      }
      case "chat": {
        const [ok, wait] = this.chatLimit.allow(c.userId);
        if (!ok) return fail("rate", `slow down (${Math.round(wait)} s)`);
        const [text2, masked] = wordFilter().clean(a.text);
        if (!text2) return fail("chat", "empty message");
        if (a.scope === "lobby") {
          const lb = this.lobbies.ofUser(c.userId);
          if (!lb) return fail("chat", "you are not in a lobby");
          this.toRoom(`lobby:${lb.code}`, "chat:msg", { from: c.name, text: text2, scope: "lobby" });
        } else {
          if (!c.matchId) return fail("chat", "you are not in a match");
          this.matches.chat(c.matchId, c.userId, a.scope, text2);
        }
        return { ok: true, text: text2, masked };
      }
    }
    return fail("unknown", "unknown event");
  }
  myLobby(c) {
    const lb = this.lobbies.ofUser(c.userId);
    if (!lb) throw new LobbyError("you are not in a lobby");
    return lb;
  }
  join(c, matchId, mode, team) {
    const h = this.matches.get(matchId);
    if (!h) return [false, "no such match"];
    const sid = h.config.serverId;
    if (sid) {
      const wait = this.servers.bannedFor(sid, c.userId);
      if (wait > 0) return [false, `you were kicked from this server (${Math.floor(wait / 60) + 1} min left)`];
    }
    const lb = this.lobbies.byMatch(matchId);
    if (lb && mode === "play") {
      const t = lb.teamOf(c.userId);
      if (t === 0 || t === 1) team = t;
      else mode = "spectate";
    }
    if (h.config.mode === "duel" && !(String(c.userId) in h.config.roster)) mode = "spectate";
    if (c.matchId && c.matchId !== matchId) {
      this.matches.leave(c.matchId, c.userId);
      this.userMatch.delete(c.userId);
    }
    const prev = h.users.get(c.userId);
    if (prev) mode = prev.mode;
    else if (sid && mode === "play") {
      const st = this.servers.get(sid);
      if (st && Object.keys(this.matches.players(matchId)).length >= st.spec.maxPlayers) return [false, "the server is full (you can spectate)"];
    }
    c.matchId = matchId;
    c.mode = mode;
    this.userMatch.set(c.userId, [matchId, mode]);
    this.matches.join(matchId, c.userId, c.name, mode, team);
    return [true, ""];
  }
  leave(c) {
    if (c.matchId) this.matches.leave(c.matchId, c.userId);
    this.userMatch.delete(c.userId);
    c.matchId = null;
  }
  inMatch(userId, matchId) {
    return this.userMatch.get(userId)?.[0] === matchId;
  }
  // --------------------------------------------------------------- duels
  busy(c) {
    const h = c.matchId ? this.matches.get(c.matchId) : null;
    if (h && c.mode === "play" && h.config.mode === "duel") return "you are in a duel";
    if (this.readies.ofUser(c.userId)) return "a duel is waiting for your answer";
    return null;
  }
  async readyFound(rc) {
    const [[a, an], [b, bn]] = rc.players;
    for (const [uid, other, otherName] of [[a, b, bn], [b, a, an]]) {
      const r = rc.ranked ? await this.repo.ratingOf(other) : null;
      this.toUser(uid, "queue:found", {
        match_token: rc.token,
        ranked: rc.ranked,
        opponent: otherName,
        opponent_rating: r ? Math.round(r.rating) : null,
        seconds: this.readies.seconds
      });
    }
  }
  /** A ready-check was declined or timed out: tell both; in ranked, who accepted queues again. */
  async readyFailed(rc, declinedBy = null) {
    for (const [uid, name] of rc.players) {
      const back = rc.ranked && uid !== declinedBy && (declinedBy !== null || rc.ready.has(uid)) && this.byUser.has(uid);
      if (back) {
        const r = await this.repo.ratingOf(uid);
        this.queue.join(uid, name, r.rating, r.rd);
      }
      this.toUser(uid, "ready:state", { match_token: rc.token, status: "cancelled", requeued: back, reason: declinedBy !== null ? "declined" : "timeout" });
    }
  }
  async startDuel(rc) {
    let [[a, an], [b, bn]] = rc.players;
    if (randomInt2(2) === 1) [[a, an], [b, bn]] = [[b, bn], [a, an]];
    const fast = this.cfg.devFastRounds;
    const opts = {
      preset: "duel",
      ranked: rc.ranked,
      roster: { [String(a)]: 0, [String(b)]: 1 },
      bots: [0, 0],
      startOnFirstJoin: false,
      joinTimeout: 60,
      endAction: "stop",
      spectatorDelay: this.cfg.duelSpectatorDelay,
      title: `${an} vs ${bn}`,
      fastRounds: fast,
      restartDelay: fast ? 4 : 10
    };
    try {
      const h = await this.createMatch(null, opts, "duel");
      for (const uid of [a, b]) this.toUser(uid, "match:start", { match_id: h.id, url: `/game/${h.id}`, mode: "duel" });
    } catch (e2) {
      for (const [uid] of rc.players) this.toUser(uid, "ready:state", { match_token: rc.token, status: "cancelled", reason: e2.message });
    }
  }
  // -------------------------------------------------------- housekeeping
  housekeeping() {
    for (const [a, b] of this.queue.match()) {
      const rc = this.readies.create([a.userId, a.name], [b.userId, b.name], true);
      void this.readyFound(rc);
    }
    for (const rc of this.readies.expired()) void this.readyFailed(rc);
    this.challenges.expire();
    for (const [lb, closed] of this.lobbies.expire((u, m) => this.inMatch(u, m))) this.lobbyChanged(lb, closed);
    if (!this.stopping) for (const sid of this.servers.due()) this.servers.start(sid);
    for (const [st, vote, res] of this.servers.resolveVotes()) this.voteDone(st, vote, res);
    const now2 = performance.now() / 1e3;
    if (now2 - this.browserT >= BROWSER_EVERY) {
      this.browserT = now2;
      if (this.rooms.get("browser")?.size) this.toRoom("browser", "browser:update", { servers: this.browserRows() });
      for (const uid of this.queue.entries.keys()) {
        const st = this.queue.status(uid);
        if (st) this.toUser(uid, "queue:status", st);
      }
      for (const st of this.servers.states.values()) {
        if (st.vote && st.matchId) this.toMatch(st.matchId, "vote:state", st.vote.state(this.servers.clock()));
      }
    }
  }
  browserRows() {
    return this.servers.rows((mid) => this.matches.get(mid)?.summary() ?? null);
  }
  voteDone(st, vote, res) {
    const mid = st.matchId;
    if (mid) this.toMatch(mid, "vote:state", { target: vote.targetName, result: res, yes: vote.yes.size, needed: vote.needed() });
    if (res !== "passed" || !mid) return;
    const c = this.byUser.get(vote.target);
    this.matches.leave(mid, vote.target);
    this.userMatch.delete(vote.target);
    if (c && c.matchId === mid) {
      c.matchId = null;
      c.send("kicked", { reason: "kicked by vote (30 minutes)" });
    }
  }
};

// server/src/web/proxy.ts
import { BlockList, isIP } from "node:net";
var CLOUDFLARE_RANGES = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32"
];
var LOCAL_RANGES = ["127.0.0.0/8", "::1/128"];
function blockList(ranges) {
  const bl = new BlockList();
  for (const r of ranges) {
    const [addr, bits2] = r.trim().split("/");
    const fam = isIP(addr) === 6 ? "ipv6" : "ipv4";
    if (!isIP(addr)) continue;
    bl.addSubnet(addr, Number(bits2 ?? (fam === "ipv6" ? 128 : 32)), fam);
  }
  return bl;
}
function normIp(ip) {
  if (!ip) return null;
  let s = ip.trim();
  if (s.startsWith("::ffff:") && isIP(s.slice(7)) === 4) s = s.slice(7);
  return isIP(s) ? s : null;
}
function inList(bl, ip) {
  if (!ip) return false;
  return bl.check(ip, isIP(ip) === 6 ? "ipv6" : "ipv4");
}
var ProxyTrust = class {
  constructor(mode, cloudflareRanges = null) {
    this.mode = mode;
    this.cloudflare = blockList(cloudflareRanges ?? CLOUDFLARE_RANGES);
  }
  local = blockList(LOCAL_RANGES);
  cloudflare;
  /** [client ip, scheme] for a request from `peer` with these headers. */
  resolve(peer, headers, encrypted = false) {
    const p = normIp(peer);
    let client = null;
    let proto;
    const h = (name) => {
      const v = headers[name];
      return Array.isArray(v) ? v[0] : v;
    };
    if (this.mode === "cloudflare" && (inList(this.cloudflare, p) || inList(this.local, p))) {
      client = normIp(h("cf-connecting-ip"));
      proto = h("x-forwarded-proto");
      if (!proto && (h("cf-visitor") ?? "").includes("https")) proto = "https";
    } else if (this.mode === "local" && inList(this.local, p)) {
      const fwd = (h("x-forwarded-for") ?? "").split(",");
      client = normIp(fwd[fwd.length - 1]);
      proto = h("x-forwarded-proto");
    }
    let scheme = encrypted ? "https" : "http";
    if (proto) {
      const v = proto.split(",")[0].trim().toLowerCase();
      if (v === "http" || v === "https") scheme = v;
    }
    return { ip: client ?? p ?? "?", proto: scheme };
  }
};

// server/src/web/views.ts
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import fs6 from "node:fs";
import path6 from "node:path";

// server/src/web/assets.ts
import fs5 from "node:fs";
import path5 from "node:path";
var IMMUTABLE = "public, max-age=31536000, immutable";
var TYPES = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".glb": "model/gltf-binary",
  ".bin": "application/octet-stream",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ktx2": "image/ktx2",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".hdr": "image/vnd.radiance"
};
var ASSETS_DIR = path5.join(CLIENT_DIST, "assets");
async function serveAsset(req, reply, name) {
  const root = path5.resolve(ASSETS_DIR);
  const file = path5.resolve(root, name);
  if (!file.startsWith(root + path5.sep) || file.endsWith(".gz") || file.endsWith(".br")) return reply.code(404).send("not found");
  let st;
  try {
    st = await fs5.promises.stat(file);
  } catch {
    return reply.code(404).header("cache-control", "no-store").send("not found");
  }
  if (!st.isFile()) return reply.code(404).send("not found");
  const accept = String(req.headers["accept-encoding"] ?? "");
  let send = file, enc2 = null;
  for (const [ext, name2] of [[".br", "br"], [".gz", "gzip"]]) {
    if (accept.includes(name2) && fs5.existsSync(file + ext)) {
      send = file + ext;
      enc2 = name2;
      break;
    }
  }
  reply.header("content-type", TYPES[path5.extname(file).toLowerCase()] ?? "application/octet-stream");
  reply.header("cache-control", IMMUTABLE);
  reply.header("vary", "Accept-Encoding");
  reply.header("access-control-allow-origin", "*");
  reply.header("x-content-type-options", "nosniff");
  if (enc2) reply.header("content-encoding", enc2);
  reply.header("content-length", String((await fs5.promises.stat(send)).size));
  return reply.send(fs5.createReadStream(send));
}
var cache = null;
var gameCache = null;
function viteManifest() {
  const file = path5.join(CLIENT_DIST, ".vite", "manifest.json");
  try {
    const mtime = fs5.statSync(file).mtimeMs;
    if (!cache || cache.mtime !== mtime) cache = { mtime, manifest: JSON.parse(fs5.readFileSync(file, "utf8")) };
    return cache.manifest;
  } catch {
    return null;
  }
}
function entry(name) {
  const m = viteManifest();
  const key = `src/${name}/main.ts`;
  const e2 = m?.[key];
  if (!m || !e2) return { js: "", css: [] };
  const css = /* @__PURE__ */ new Set();
  const walk = (k) => {
    const it = m[k];
    if (!it) return;
    for (const c of it.css ?? []) css.add(`/${c}`);
    for (const i of it.imports ?? []) walk(i);
  };
  walk(key);
  return { js: `/${e2.file}`, css: [...css] };
}
function gameAssetManifest() {
  const file = path5.join(CLIENT_DIST, "game-assets.json");
  try {
    const mtime = fs5.statSync(file).mtimeMs;
    if (!gameCache || gameCache.mtime !== mtime) gameCache = { mtime, url: JSON.parse(fs5.readFileSync(file, "utf8")).manifest ?? "" };
    return gameCache.url;
  } catch {
    return "";
  }
}
var radarCache = null;
function mapRadars() {
  const url = gameAssetManifest();
  if (!url) return {};
  if (radarCache?.url === url) return radarCache.radars;
  const radars = {};
  try {
    const m = JSON.parse(fs5.readFileSync(path5.join(CLIENT_DIST, url.replace(/^\//, "")), "utf8"));
    for (const [k, v] of Object.entries(m.maps ?? {})) if (v?.radar?.file) radars[k] = v.radar.file;
  } catch {
  }
  radarCache = { url, radars };
  return radars;
}
function clientBuilt() {
  return viteManifest() !== null;
}

// server/src/web/pages.ts
function mapOptions(maps) {
  const info = mapInfo();
  return raw(maps.map((m) => `<option value="${esc(m)}">${esc(info[m]?.name ?? m)}</option>`).join(""));
}
function mapCards(maps) {
  const info = mapInfo();
  const radars = mapRadars();
  return raw(maps.map((m) => {
    const i = info[m] ?? { name: m, description: "", briefing: {} };
    const b = i.briefing ?? {};
    const sites = ["A", "B"].filter((s) => b[s]).map((s) => `<li><strong>${s}</strong> ${esc(b[s])}</li>`).join("");
    const radar = radars[m] ? `<img class="map-radar" src="${esc(radars[m])}" alt="" loading="lazy" width="512" height="512">` : "";
    return `<article class="card map-card" data-map="${esc(m)}">${radar}<h3>${esc(i.name)}</h3>${b.region ? `<p class="muted">${esc(b.region)}</p>` : ""}<p>${esc(i.description)}</p>${sites ? `<ul class="map-sites">${sites}</ul>` : ""}</article>`;
  }).join(""));
}
var Raw = class {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
};
var raw = (s) => new Raw(s);
function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function value(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(value).join("");
  if (v === null || v === void 0 || v === false) return "";
  return esc(v);
}
function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => {
    out += value(v) + strings[i + 1];
  });
  return new Raw(out);
}
function scripts(e2) {
  return html`<script type="module" src="${e2.js}" data-cfasync="false"></script>`;
}
function styles(e2) {
  return html`${e2.css.map((c) => html`<link rel="stylesheet" href="${c}">`)}`;
}
function layout(ctx, p) {
  const e2 = ctx.entry(p.entry ?? "site");
  const u = ctx.user;
  const nav = u ? html`
        <a href="/play">Play</a>
        <a href="/servers">Servers</a>
        <a href="/leaderboard">Leaderboard</a>
        <a class="who" href="/profile/${encodeURIComponent(u.username)}">${u.username}</a>
        <form method="post" action="/logout" class="inline">
          <input type="hidden" name="csrf_token" value="${ctx.csrf}">
          <button type="submit" class="link">Log out</button>
        </form>` : html`
        <a href="/login">Log in</a>
        <a href="/signup" class="button small">Sign up</a>`;
  return `<!doctype html>${html`
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#11171c">
  <meta name="csrf-token" content="${ctx.csrf}">
  <meta name="description" content="FAULTWARD. Hold your angle. A tactical shooter with bot matches, ranked duels and public servers.">
  <title>${p.title ?? "FAULTWARD"}</title>
  ${styles(e2)}
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  ${p.head ?? ""}
</head>
<body class="${p.bodyClass ?? ""}">
  <header class="top">
    <a class="brand" href="/"><img src="/assets/brand/faultward-symbol.svg" alt="" width="32" height="32"><span>FAULTWARD<small>HOLD YOUR ANGLE.</small></span></a>
    <nav>${nav}
    </nav>
  </header>
  ${ctx.flashes.length ? html`<div class="flashes">${ctx.flashes.map(([cat, msg]) => html`<p class="flash ${cat}">${msg}</p>`)}</div>` : ""}
  <main>${p.main}</main>
  ${p.entry === null ? "" : scripts(e2)}
</body>
</html>`}`;
}
var readyDialog = html`
<dialog id="ready-check" class="ready">
  <h2>Duel found</h2>
  <p id="ready-text"></p>
  <p class="muted"><span id="ready-left">20</span> s to accept · <span id="ready-who"></span></p>
  <p class="row">
    <button type="button" class="button" id="ready-yes">Accept</button>
    <button type="button" class="button ghost" id="ready-no">Decline</button>
  </p>
</dialog>`;
function homePage(ctx) {
  const cta = ctx.user ? html`<a class="button" href="/play">Play</a>` : html`
    <p><a class="button" href="/signup">Create an account</a>
       <a class="button ghost" href="/login">Log in</a></p>
    <p class="muted">An account is needed to play or watch.</p>`;
  return layout(ctx, { entry: null, main: html`
<section class="hero">
  <img class="hero-symbol" src="/assets/brand/faultward-symbol.svg" alt="" width="90" height="90">
  <p class="eyebrow">HOLD YOUR ANGLE.</p>
  <h1>FAULTWARD</h1>
  <h2>Every angle matters.</h2>
  <p class="lede">A tactical shooter: one life per round, a charge to plant or stop, walls that come apart.
    Play against bots, duel another player, or drop into a public server.</p>
  ${cta}
</section>` });
}
function field(f) {
  return html`
  <label>
    <span>${f.label}</span>
    <input id="${f.name}" name="${f.name}" type="${f.type}" value="${f.value ?? ""}" autocomplete="${f.autocomplete}" required${raw(f.maxlength ? ` maxlength="${f.maxlength}"` : "")}>
    ${(f.errors ?? []).map((e2) => html`<em class="error">${e2}</em>`)}
  </label>`;
}
function loginPage(ctx, form) {
  return layout(ctx, { title: "Log in \xB7 FAULTWARD", entry: null, main: html`
<section class="card narrow">
  <h1>Log in</h1>
  <form method="post" novalidate${raw(form.next ? ` action="/login?next=${encodeURIComponent(form.next)}"` : "")}>
    <input type="hidden" name="csrf_token" value="${ctx.csrf}">
    ${field({ name: "username", label: "Username", type: "text", value: form.username, autocomplete: "username", errors: form.errors?.username, maxlength: 20 })}
    ${field({ name: "password", label: "Password", type: "password", autocomplete: "current-password", errors: form.errors?.password, maxlength: 128 })}
    <label class="check"><input id="remember" name="remember" type="checkbox" value="y"> <span>Keep me logged in</span></label>
    <button type="submit" class="button">Log in</button>
  </form>
  <p class="muted">No account? <a href="/signup">Sign up</a>.</p>
</section>` });
}
function signupPage(ctx, form) {
  return layout(ctx, { title: "Sign up \xB7 FAULTWARD", entry: null, main: html`
<section class="card narrow">
  <h1>Sign up</h1>
  <form method="post" novalidate>
    <input type="hidden" name="csrf_token" value="${ctx.csrf}">
    ${field({ name: "username", label: "Username", type: "text", value: form.username, autocomplete: "username", errors: form.errors?.username, maxlength: 20 })}
    ${field({ name: "password", label: "Password", type: "password", autocomplete: "new-password", errors: form.errors?.password, maxlength: 128 })}
    ${field({ name: "confirm", label: "Repeat password", type: "password", autocomplete: "new-password", errors: form.errors?.confirm, maxlength: 128 })}
    <p class="muted">3-20 characters (letters, digits, _ and -); a password of at least 8.</p>
    <button type="submit" class="button">Create account</button>
  </form>
</section>` });
}
var HUB_ICONS = {
  play: '<path d="M6 4l14 8-14 8V4z"/>',
  duel: '<path d="M14.5 3.5 20.5 3.5 20.5 9.5 9 21 3 15z"/><path d="M3 21l4-4"/>',
  servers: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  matches: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  maps: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/>'
};
function hubIcon(id) {
  return raw(`<svg viewBox="0 0 24 24" aria-hidden="true">${HUB_ICONS[id] ?? ""}</svg>`);
}
function playPage(ctx, d) {
  const r = d.rating;
  const u = ctx.user;
  const players = d.servers.reduce((n, s) => n + (Number(s.players) || 0), 0);
  const tab = (id, label, badge = "") => html`
      <button type="button" data-tab-btn="${id}">${hubIcon(id)}<span>${label}</span>${badge ? html`<em>${badge}</em>` : ""}</button>`;
  const head = (title, blurb) => html`
      <header class="hub-head"><h3>${title}</h3><p>${blurb}</p></header>`;
  return layout(ctx, { title: "Play \xB7 FAULTWARD", bodyClass: "hub-page", main: html`
<div id="site" class="hub" data-page="play" data-csrf="${ctx.csrf}">
  <aside class="hub-rail">
    <div class="hub-brand">
      <div class="eyebrow">OPERATIONS / 01</div>
      <h2>Main menu</h2>
      <div class="who">${u ? u.username : ""}</div>
      <div class="sub">Duel rating <strong>${Math.round(r ? r.rating : 1500)}</strong>
        ${r && r.games ? html`· ${r.games} ranked` : html`· unranked`}</div>
    </div>
    <nav class="hub-nav" aria-label="Play menu">
      ${tab("play", "Play")}
      ${tab("duel", "Duel")}
      ${tab("servers", "Public servers", players ? String(players) : "")}
      ${tab("matches", "Running matches", d.matches.length ? String(d.matches.length) : "")}
      ${tab("maps", "Maps")}
    </nav>
    <div class="hub-links">
      <button type="button" class="button ghost" id="open-settings" aria-haspopup="dialog">Settings</button>
      ${u ? html`<a class="button ghost" href="/profile/${encodeURIComponent(u.username)}">Profile</a>` : ""}
      <a class="button ghost" href="/leaderboard">Leaderboard</a>
    </div>
  </aside>

  <section class="hub-main">
    <div class="hub-panel" data-tab="play">
      <div class="faultward-intro">
        <div class="intro-copy"><p class="eyebrow">READY WHEN YOU ARE</p><h3>Every angle<br> matters.</h3>
          <p>Build your team. Read the ground.<br>Commit together.</p><span class="micro-label">BOT MATCHES / RANKED DUELS / PUBLIC SERVERS</span></div>
        <figure class="feature-map"><img id="featured-map-image" src="/assets/brand/qalat.webp" alt="Qalat Village map preview" width="1000" height="625">
          <figcaption><span>SELECTED MAP</span><strong id="featured-map-name">Qalat Village</strong><small>TWO SITES / ONE LIFE PER ROUND</small></figcaption></figure>
      </div>
      <div class="hub-body hub-split">
        <article class="hub-card">
          <h4>Quick match</h4>
          <p class="muted">A bot match without a lobby: anyone can join it from the list.</p>
          <form method="post" action="/matches" class="grid" id="quick-match">
            <input type="hidden" name="csrf_token" value="${ctx.csrf}">
            <div class="two">
              <label><span>Map</span><select name="map">${mapOptions(d.maps)}</select></label>
              <label><span>Difficulty</span>
                <select name="difficulty"><option>easy</option><option selected>normal</option><option>hard</option><option>expert</option></select></label>
              <label><span>Bots, attackers</span><input name="bots_team0" type="number" min="0" max="5" value="0"></label>
              <label><span>Bots, defenders</span><input name="bots_team1" type="number" min="0" max="5" value="2"></label>
            </div>
            <details class="match-details"><summary>Match title (optional)</summary><label><span>Title</span><input name="title" maxlength="40" placeholder="Name your match"></label></details>
            <label class="check"><input type="checkbox" name="short_timers" value="1" checked>
              <span>Short timers (2 s freeze, no preparation)</span></label>
            <label class="check"><input type="checkbox" name="watch" value="1">
              <span>Just watch: bots on both sides (5 v 5 when both counts are 0), you spectate</span></label>
            <button type="submit" class="button primary">Start a match</button>
          </form>
        </article>
        <article class="hub-card">
          <h4>Bring your squad</h4><div class="squad-slots" aria-hidden="true"><i>+</i><i>+</i><i>+</i><i>+</i><i>+</i></div>
          <p class="muted">A lobby with a code to share: up to 10 players, bots fill the empty places.</p>
          <p><button type="button" class="button" id="lobby-create">Create a lobby</button></p>
          <form id="lobby-join" class="row">
            <input name="code" maxlength="6" placeholder="Lobby code" autocomplete="off" aria-label="Lobby code">
            <button type="submit" class="button ghost">Join</button>
          </form>
          ${d.lobby ? html`<p class="muted">You are in lobby <a href="/lobby/${d.lobby}">${d.lobby}</a>.</p>` : ""}
        </article>
      </div>
    </div>

    <div class="hub-panel" data-tab="duel">
      ${head("Duel", "1v1 on site A, first to 9. Ranked duels use a Glicko-2 rating and a 20 s ready check.")}
      <div class="hub-body">
        <article class="hub-card">
          <h4>Ranked</h4>
          <div class="rating-big"><strong>${Math.round(r ? r.rating : 1500)}</strong>
            <span class="muted">${r && r.games ? `${r.games} ranked duels` : "unranked yet"}</span></div>
          <p class="row">
            <button type="button" class="button" id="queue-join">Find a ranked duel</button>
            <button type="button" class="button ghost hidden" id="queue-leave">Leave the queue</button>
          </p>
          <p class="muted" id="queue-status"></p>
        </article>
        <article class="hub-card">
          <h4>Challenge a player</h4>
          <form id="challenge" class="row">
            <input name="username" maxlength="20" placeholder="Player name (or leave empty for a link)" autocomplete="off" aria-label="Player to challenge">
            <button type="submit" class="button ghost">Challenge</button>
          </form>
          <p class="muted" id="challenge-status"></p>
          <ul class="incoming" id="incoming"></ul>
        </article>
      </div>
    </div>

    <div class="hub-panel" data-tab="servers">
      ${head("Public servers", "Always running: drop in and out, bots keep the teams full.")}
      <div class="hub-body">
        <ul class="servers-mini">
          ${d.servers.length ? d.servers.map((s) => html`<li><strong>${s.name}</strong> <span class="muted">${s.players}/${s.max} players · ${s.status}</span></li>`) : html`<li class="muted">None on this host.</li>`}
        </ul>
        <p><a class="button" href="/servers">Open the server browser</a></p>
      </div>
    </div>

    <div class="hub-panel" data-tab="matches">
      ${head(`Running matches (${d.matches.length} / ${d.maxMatches})`, "Join an open match, or watch any of them.")}
      <div class="hub-body">
        ${d.matches.length ? html`
        <table class="list">
          <thead><tr><th>Match</th><th>Mode</th><th>Status</th><th>Players</th><th>Bots</th><th>Round</th><th>Score</th><th></th></tr></thead>
          <tbody>
          ${d.matches.map((m) => html`
            <tr>
              <td>${m.title}</td><td>${m.mode}</td><td>${m.status} ${m.phase}</td><td>${m.players}</td>
              <td>${m.bots}</td><td>${m.round}</td><td>${m.score[0]} : ${m.score[1]}</td>
              <td class="actions">
                ${m.open ? html`<a class="button small" href="/game/${m.id}">Join</a>` : ""}
                <a class="button small ghost" href="/game/${m.id}?as=spectate">Watch</a>
                ${m.mine ? html`<form method="post" action="/matches/${m.id}/stop" class="inline" data-confirm="Stop this match? Everyone in it is sent back to the Play page.">
                  <input type="hidden" name="csrf_token" value="${ctx.csrf}">
                  <button type="submit" class="button small danger" title="You started this match">Stop</button>
                </form>` : ""}
              </td>
            </tr>`)}
          </tbody>
        </table>` : html`<p class="muted">None yet. Start one from the Play tab.</p>`}
      </div>
    </div>

    <div class="hub-panel" data-tab="maps">
      ${head("Maps", `${d.maps.length} maps, each with two charge sites.`)}
      <div class="hub-body"><div class="map-grid">${mapCards(d.maps)}</div></div>
    </div>
  </section>
  <footer class="hub-footer"><span>HOLD YOUR ANGLE.</span><span>FAULTWARD / TACTICAL MULTIPLAYER</span><a href="/leaderboard">Leaderboard ↗</a></footer>
</div>
${readyDialog}` });
}
function lobbyPage(ctx, d) {
  const presetName = { full: "Full (first to 13, 24 rounds)", short: "Short (first to 7, 12 rounds)" };
  return layout(ctx, { title: `Lobby ${d.code} \xB7 FAULTWARD`, main: html`
<div id="site" data-page="lobby" data-code="${d.code}" data-user="${ctx.user?.id ?? ""}">
<section class="lobby-head card">
  <div>
    <h1>Lobby <span class="code" id="lobby-code">${d.code}</span></h1>
    <p class="muted">Share the code or the link: <input class="share" readonly id="lobby-link" value="${ctx.siteUrl}/lobby/${d.code}" aria-label="Lobby link"></p>
  </div>
  <div class="lobby-status">
    <p id="lobby-status" class="status">Connecting…</p>
    <p class="row">
      <button type="button" class="button" id="lobby-start" disabled>Start the match</button>
      <a class="button hidden" id="lobby-go" href="#">Go to the match</a>
      <button type="button" class="button ghost hidden" id="lobby-again">Play again</button>
      <button type="button" class="button ghost" id="lobby-leave">Leave</button>
    </p>
  </div>
</section>
<section class="lobby-grid">
  <article class="card team t0">
    <h2>Team 1 · attack first <span class="muted" id="cap0"></span></h2>
    <ul id="team0" class="members"></ul>
    <button type="button" class="button small ghost" data-team="0">Join this team</button>
  </article>
  <article class="card team t1">
    <h2>Team 2 · defend first <span class="muted" id="cap1"></span></h2>
    <ul id="team1" class="members"></ul>
    <button type="button" class="button small ghost" data-team="1">Join this team</button>
  </article>
  <article class="card team spec">
    <h2>Spectators</h2>
    <ul id="teamspectate" class="members"></ul>
    <button type="button" class="button small ghost" data-team="spectate">Spectate</button>
  </article>
  <article class="card settings">
    <h2>Match settings <span class="muted" id="host-note"></span></h2>
    <form id="lobby-settings">
      <label><span>Map</span><select name="map">${mapOptions(d.maps)}</select></label>
      <label><span>Rules</span><select name="preset">${d.presets.map((p) => html`<option value="${p}">${presetName[p] ?? p}</option>`)}</select></label>
      <label><span>Bot difficulty</span><select name="difficulty">${d.difficulties.map((x) => html`<option>${x}</option>`)}</select></label>
      <label><span>Team 1 size</span><input type="number" name="size_attack" min="1" max="5"></label>
      <label><span>Team 2 size</span><input type="number" name="size_defend" min="1" max="5"></label>
      <label class="check"><input type="checkbox" name="humans_vs_bots"><span>Humans vs bots (every player on team 1, no bot teammates)</span></label>
      <label class="check"><input type="checkbox" name="friendly_fire"><span>Friendly fire</span></label>
    </form>
  </article>
  <article class="card chat-card">
    <h2>Chat</h2>
    <ul id="chat-log" class="chat-log"></ul>
    <form id="chat-form" class="row">
      <input name="text" maxlength="200" autocomplete="off" placeholder="Say something" aria-label="Message">
      <button type="submit" class="button small">Send</button>
    </form>
  </article>
  <article class="card result hidden" id="last-result">
    <h2>Last match</h2>
    <div id="result-body"></div>
  </article>
</section>
</div>` });
}
function serversPage(ctx, servers) {
  return layout(ctx, { title: "Servers \xB7 FAULTWARD", main: html`
<div id="site" data-page="servers">
<article class="card wide">
  <h2>Public servers <span class="muted" id="browser-note">live</span></h2>
  <table class="list" id="browser">
    <thead><tr><th>Server</th><th>Map</th><th>Players</th><th>Round</th><th>Score</th><th>Ping</th><th></th></tr></thead>
    <tbody>
    ${servers.length ? servers.map((s) => html`<tr data-id="${s.id}"><td>${s.name} <span class="muted">${s.region}</span></td><td>${s.map}</td>
        <td>${s.players}/${s.max} <span class="muted">+${s.bots} bots</span></td><td>${s.round}</td>
        <td>${s.score[0]} : ${s.score[1]}</td><td class="ping">–</td><td class="actions"></td></tr>`) : html`<tr><td colspan="7" class="muted">No public servers on this host.</td></tr>`}
    </tbody>
  </table>
  <p class="muted" id="browser-error"></p>
</article>
</div>` });
}
function duelPage(ctx, ch, mine) {
  return layout(ctx, { title: "Duel \xB7 FAULTWARD", main: html`
<div id="site" data-page="duel" data-token="${ch.token}" data-mine="${mine ? 1 : 0}">
<article class="card narrow">
  ${mine ? html`
    <h2>Your challenge</h2>
    <p>Send this link to the player you want to duel${ch.toName ? ` (${ch.toName})` : ""}. It works once, for 10 minutes.</p>
    <input class="share" readonly value="${ctx.siteUrl}/duel/${ch.token}" aria-label="Challenge link">
    <p class="muted" id="duel-status">Keep this page open: the duel starts when they accept.</p>` : html`
    <h2>${ch.fromName} challenges you to a duel</h2>
    <p class="muted">1v1, first to 9 rounds, unranked.</p>
    <p class="row">
      <button type="button" class="button" id="duel-accept">Accept</button>
      <button type="button" class="button ghost" id="duel-decline">Decline</button>
    </p>
    <p class="muted" id="duel-status"></p>`}
</article>
</div>
${readyDialog}` });
}
var fmtDate = (ms2) => ms2 ? new Date(ms2).toISOString().slice(0, 16).replace("T", " ") : "";
function profilePage(ctx, user, s) {
  const r = s.rating;
  let spark = "";
  if (s.history.length) {
    const vals = s.history.map((h) => h.after);
    const lo = Math.min(...vals) - 20, hi = Math.max(...vals) + 20, n = vals.length;
    const pts = vals.map((v, i) => `${(400 * i / Math.max(n - 1, 1)).toFixed(1)},${(80 - 80 * (v - lo) / Math.max(hi - lo, 1)).toFixed(1)}`).join(" ");
    spark = html`
  <h2>Rating history</h2>
  <svg class="spark" viewBox="0 0 400 80" preserveAspectRatio="none" role="img" aria-label="Rating history">
    <polyline fill="none" stroke="currentColor" stroke-width="2" points="${pts}"/>
  </svg>
  <p class="muted">${s.history[0].before} → ${s.history[n - 1].after} over ${n} ranked duels</p>`;
  }
  return layout(ctx, { title: `${user.username} \xB7 FAULTWARD`, entry: null, main: html`
<section class="card wide">
  <h1>${user.username}</h1>
  <div class="stats">
    <div><span>Duel rating</span><strong>${Math.round(r ? r.rating : 1500)}</strong>
      <em class="muted">${r && r.games ? `\xC2\xB1 ${Math.round(2 * r.rd)} \xB7 ${r.games} ranked` : "no ranked duels yet"}</em></div>
    <div><span>Matches</span><strong>${s.matches}</strong><em class="muted">${s.wins} won · ${s.losses} lost</em></div>
    <div><span>K/D</span><strong>${s.kd.toFixed(2)}</strong><em class="muted">${s.kills} / ${s.deaths}</em></div>
    <div><span>ADR</span><strong>${Math.round(s.adr)}</strong><em class="muted">damage per round</em></div>
    <div><span>Headshots</span><strong>${Math.round(s.hs)}%</strong><em class="muted">of kills</em></div>
  </div>
  ${spark}
  <h2>Recent matches</h2>
  ${s.recent.length ? html`
  <table class="list">
    <thead><tr><th>When</th><th>Mode</th><th>Result</th><th>Score</th><th>K</th><th>D</th><th>ADR</th></tr></thead>
    <tbody>
    ${s.recent.map((m) => {
    const t = m.team ?? 0;
    return html`<tr><td>${fmtDate(m.ended)}</td><td>${m.mode}${m.ranked ? " (ranked)" : ""}</td>
        <td>${m.won === true ? "won" : m.won === false ? "lost" : "draw"}${m.forfeit ? " (forfeit)" : ""}</td>
        <td>${m.score ? `${m.score[t]} : ${m.score[1 - t]}` : ""}</td>
        <td>${m.kills}</td><td>${m.deaths}</td><td>${Math.round(m.damage / Math.max(m.rounds, 1))}</td></tr>`;
  })}
    </tbody>
  </table>` : html`<p class="muted">No finished matches yet.</p>`}
</section>` });
}
function leaderboardPage(ctx, rows) {
  return layout(ctx, { title: "Leaderboard \xB7 FAULTWARD", entry: null, main: html`
<section class="card wide">
  <h1>Ranked duels</h1>
  <p class="muted">Glicko-2 rating; Â± is twice the rating deviation (how sure the rating is).</p>
  ${rows.length ? html`
  <table class="list">
    <thead><tr><th>#</th><th>Player</th><th>Rating</th><th>Â±</th><th>Duels</th></tr></thead>
    <tbody>
    ${rows.map((r, i) => html`<tr><td>${i + 1}</td><td><a href="/profile/${encodeURIComponent(r.name)}">${r.name}</a></td>
        <td>${r.rating}</td><td>${2 * r.rd}</td><td>${r.games}</td></tr>`)}
    </tbody>
  </table>` : html`<p class="muted">Nobody has played a ranked duel yet.</p>`}
</section>` });
}
function gamePage(ctx, match, mode, assetManifest) {
  return layout(ctx, {
    title: `${match.title} \xB7 FAULTWARD`,
    bodyClass: "game",
    entry: "game",
    head: html`<meta name="csrf-token" content="${ctx.csrf}">`,
    main: html`
<div id="game3d" data-match="${match.id}" data-mode="${mode}" data-assets="${assetManifest}">
  <canvas tabindex="0"></canvas>
  <div class="overlay">
    <div class="box">
      <div class="text">Loading…</div>
      <div class="brief hidden"></div>
      <p class="keys">WASD move · mouse aim · left fire · right aim · R reload · Space jump · C crouch ·
        Shift walk · Q/E lean · F use/defuse · 1-5 weapons · B buy · Tab scores · Enter chat · U team chat · Esc menu</p>
    </div>
  </div>
</div>`
  });
}
function errorPage(ctx, code, text2) {
  return layout(ctx, { title: `${code} \xB7 FAULTWARD`, entry: null, main: html`
<section class="card narrow">
  <h1>${code}</h1>
  <p>${text2}</p>
  <p><a class="button ghost" href="/">Home</a></p>
</section>` });
}

// server/src/web/views.ts
var SETTINGS_MAX_BYTES = 16 * 1024;
async function registerViews(app, d) {
  const { cfg, repo, sessions, gateway } = d;
  const limiter = new LoginLimiter(cfg.loginAttempts);
  await app.register(cookie);
  await app.register(formbody, { bodyLimit: 32 * 1024 });
  app.addContentTypeParser("text/plain", { parseAs: "string", bodyLimit: SETTINGS_MAX_BYTES + 1024 }, (_req, body, done) => done(null, body));
  app.decorateRequest("session", null);
  app.decorateRequest("sessionDirty", false);
  app.decorateRequest("user", null);
  app.decorateRequest("clientIp", "");
  app.decorateRequest("clientProto", "http");
  app.addHook("onRequest", async (req) => {
    const r = d.proxy.resolve(req.raw.socket.remoteAddress, req.headers, req.raw.socket.encrypted === true);
    req.clientIp = r.ip;
    req.clientProto = r.proto;
    if (req.url.startsWith("/assets/") || req.url === "/healthz") return;
    const s = sessions.decode(req.cookies[COOKIE]);
    req.session = s ?? sessions.fresh();
    req.sessionDirty = !s;
    if (req.session.u !== void 0) {
      const u = await repo.userById(req.session.u);
      if (u && !isBanned(u)) req.user = u;
      else {
        req.session = sessions.fresh();
        req.sessionDirty = true;
      }
    }
  });
  app.addHook("onSend", async (req, reply, payload) => {
    if (req.url.startsWith("/assets/")) return payload;
    if (req.session && req.sessionDirty) {
      reply.setCookie(COOKIE, sessions.encode(req.session), sessions.cookieOptions(req.session));
    }
    if (!reply.hasHeader("cache-control")) reply.header("cache-control", "no-store");
    const host = req.headers.host ?? "";
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "same-origin");
    reply.header("content-security-policy", `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self' wss://${host} ws://${host}; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`);
    return payload;
  });
  const flash = (req, text2, cat = "error") => {
    req.session.f = [...req.session.f ?? [], [cat, text2]];
    req.sessionDirty = true;
  };
  const ctx = (req) => {
    const flashes = req.session.f ?? [];
    if (flashes.length) {
      delete req.session.f;
      req.sessionDirty = true;
    }
    const origin2 = cfg.siteUrl || `${req.clientProto}://${req.headers.host ?? "localhost"}`;
    return { user: req.user, csrf: sessions.csrf(req.session), flashes, entry, siteUrl: origin2 };
  };
  const page = (reply, body, code = 200) => reply.code(code).type("text/html; charset=utf-8").send(body);
  const csrfOk = (req) => {
    const body = req.body;
    const token = req.headers["x-csrf-token"] ?? (body && typeof body === "object" ? body.csrf_token : void 0);
    return sessions.checkCsrf(req.session, token);
  };
  const needUser = (req, reply) => {
    if (req.user) return req.user;
    if (req.url.startsWith("/api/")) void reply.code(401).send({ error: "login required" });
    else {
      flash(req, "Log in to play.", "info");
      void reply.redirect(`/login?next=${encodeURIComponent(req.url)}`, 303);
    }
    return null;
  };
  const safeNext = (target) => {
    if (typeof target !== "string" || !target.startsWith("/") || target.startsWith("//") || target.startsWith("/\\")) return "/play";
    return target;
  };
  const startSession = async (req, user, remember) => {
    const fresh = sessions.fresh();
    req.session = { ...fresh, u: user.id, ...remember ? { r: 1 } : {}, ...req.session.f ? { f: req.session.f } : {} };
    req.sessionDirty = true;
    await repo.updateUser(user.id, { lastLogin: Date.now() });
  };
  const str = (v, max = 200) => typeof v === "string" ? v.slice(0, max) : "";
  app.get("/healthz", async (_req, reply) => reply.header("cache-control", "no-store").send({
    ok: true,
    matches: gateway.matches.live().length,
    connections: gateway.bySid.size,
    client: clientBuilt(),
    release: "faultward-fullscreen-r10"
  }));
  app.get("/favicon.ico", async (_req, reply) => reply.redirect("/favicon.svg", 301));
  app.get("/favicon.svg", async (_req, reply) => {
    const file = path6.join(CLIENT_DIST, "favicon.svg");
    if (!fs6.existsSync(file)) return reply.code(404).send("not found");
    return reply.header("cache-control", "public, max-age=86400").type("image/svg+xml").send(fs6.createReadStream(file));
  });
  app.get("/assets/*", async (req, reply) => serveAsset(req, reply, req.params["*"]));
  app.get("/", async (req, reply) => page(reply, homePage(ctx(req))));
  app.get("/signup", async (req, reply) => req.user ? reply.redirect("/play", 303) : page(reply, signupPage(ctx(req), {})));
  app.post("/signup", async (req, reply) => {
    if (req.user) return reply.redirect("/play", 303);
    if (!csrfOk(req)) return page(reply, errorPage(ctx(req), 400, "The form expired. Go back and try again."), 400);
    const b = req.body ?? {};
    const name = str(b.username, 40).trim(), pw = str(b.password, 400), confirm = str(b.confirm, 400);
    const errors = {};
    if (pw.length < PASSWORD_MIN || pw.length > PASSWORD_MAX) errors.password = [`${PASSWORD_MIN}-${PASSWORD_MAX} characters`];
    if (pw !== confirm) errors.confirm = ["passwords differ"];
    let problem = usernameProblem(name);
    if (!problem && await repo.userByName(name)) problem = "that name is taken";
    if (problem) errors.username = [problem];
    if (Object.keys(errors).length) return page(reply, signupPage(ctx(req), { username: name, errors }), 400);
    let user;
    try {
      user = await repo.createUser(name, await hashPassword(pw));
    } catch {
      return page(reply, signupPage(ctx(req), { username: name, errors: { username: ["that name is taken"] } }), 400);
    }
    await startSession(req, user, false);
    return reply.redirect("/play", 303);
  });
  app.get("/login", async (req, reply) => {
    if (req.user) return reply.redirect("/play", 303);
    return page(reply, loginPage(ctx(req), { next: str(req.query.next, 400) || void 0 }));
  });
  app.post("/login", async (req, reply) => {
    if (req.user) return reply.redirect("/play", 303);
    const next = str(req.query.next, 400) || void 0;
    if (!csrfOk(req)) return page(reply, errorPage(ctx(req), 400, "The form expired. Go back and try again."), 400);
    const b = req.body ?? {};
    const name = str(b.username, 40).trim(), pw = str(b.password, PASSWORD_MAX + 1);
    if (!name || !pw) return page(reply, loginPage(ctx(req), { username: name, next, errors: { username: name ? [] : ["required"], password: pw ? [] : ["required"] } }), 400);
    const keys = [`ip:${req.clientIp}`, `user:${name.toLowerCase()}`];
    const wait = limiter.retryAfter(...keys);
    if (wait > 0) {
      flash(req, `Too many failed attempts. Try again in ${Math.trunc(wait) + 1} s.`);
      return page(reply, loginPage(ctx(req), { username: name, next }), 429);
    }
    const user = await repo.userByName(name);
    const ok = await checkPassword(user ? user.passwordHash : await dummyHash(), pw);
    if (!ok || !user) {
      limiter.failed(...keys);
      flash(req, "Wrong username or password.");
      return page(reply, loginPage(ctx(req), { username: name, next }), 401);
    }
    if (isBanned(user)) {
      flash(req, `This account is banned until ${new Date(user.bannedUntil).toISOString().slice(0, 16).replace("T", " ")} UTC. ${user.banReason}`);
      return page(reply, loginPage(ctx(req), { username: name, next }), 403);
    }
    limiter.succeeded(...keys);
    if (needsRehash(user.passwordHash)) await repo.updateUser(user.id, { passwordHash: await hashPassword(pw) });
    await startSession(req, user, b.remember === "y" || b.remember === "on");
    return reply.redirect(safeNext(next), 303);
  });
  app.post("/logout", async (req, reply) => {
    if (req.user && csrfOk(req)) {
      req.session = sessions.fresh();
      req.sessionDirty = true;
    }
    return reply.redirect("/", 303);
  });
  app.get("/play", async (req, reply) => {
    const u = needUser(req, reply);
    if (!u) return reply;
    const rating = await repo.findRating(u.id);
    const lobby = gateway.lobbies.ofUser(u.id);
    const matches = gateway.matches.list().map((m) => ({ ...m, mine: !!gateway.matches.get(String(m.id))?.stoppableBy(u.id) }));
    return page(reply, playPage(ctx(req), {
      matches,
      maxMatches: gateway.matches.maxMatches,
      rating,
      lobby: lobby ? lobby.code : null,
      servers: gateway.browserRows(),
      maps: gateway.lobbies.maps
    }));
  });
  app.post("/matches/:id/stop", async (req, reply) => {
    const u = needUser(req, reply);
    if (!u) return reply;
    if (!csrfOk(req)) return page(reply, errorPage(ctx(req), 400, "The form expired. Go back and try again."), 400);
    const id = String(req.params.id);
    const [ok, why] = gateway.stopMatch(u.id, u.username, id);
    flash(req, ok ? `Match ${id} stopped.` : `Could not stop the match: ${why}`, ok ? "ok" : "error");
    return reply.redirect("/play", 303);
  });
  app.get("/lobby/:code", async (req, reply) => {
    const u = needUser(req, reply);
    if (!u) return reply;
    const code = req.params.code;
    if (!LOBBY_CODE_RE.test(code)) return page(reply, errorPage(ctx(req), 404, "No such page."), 404);
    if (code !== code.toUpperCase()) return reply.redirect(`/lobby/${code.toUpperCase()}`, 303);
    if (!gateway.lobbies.get(code)) {
      flash(req, `There is no lobby ${code} (it closes when everyone has left).`);
      return reply.redirect("/play", 303);
    }
    return page(reply, lobbyPage(ctx(req), { code, maps: gateway.lobbies.maps, difficulties: DIFFICULTIES, presets: PRESETS }));
  });
  app.get("/servers", async (req, reply) => {
    if (!needUser(req, reply)) return reply;
    return page(reply, serversPage(ctx(req), gateway.browserRows()));
  });
  app.get("/duel/:token", async (req, reply) => {
    const u = needUser(req, reply);
    if (!u) return reply;
    const token = req.params.token;
    if (!TOKEN_RE.test(token)) return page(reply, errorPage(ctx(req), 404, "No such page."), 404);
    const ch = gateway.challenges.get(token);
    if (!ch) {
      flash(req, "That challenge has expired or was already answered.");
      return reply.redirect("/play", 303);
    }
    const mine = ch.fromId === u.id;
    if (!mine && ch.toId !== null && ch.toId !== u.id) {
      flash(req, "That challenge is for another player.");
      return reply.redirect("/play", 303);
    }
    return page(reply, duelPage(ctx(req), ch, mine));
  });
  app.get("/profile", async (req, reply) => {
    const u = needUser(req, reply);
    if (!u) return reply;
    return reply.redirect(`/profile/${encodeURIComponent(u.username)}`, 303);
  });
  app.get("/profile/:name", async (req, reply) => {
    if (!needUser(req, reply)) return reply;
    const user = await repo.userByName(req.params.name);
    if (!user) return page(reply, errorPage(ctx(req), 404, "No such player."), 404);
    return page(reply, profilePage(ctx(req), user, await profile(repo, user.id)));
  });
  app.get("/leaderboard", async (req, reply) => {
    if (!needUser(req, reply)) return reply;
    return page(reply, leaderboardPage(ctx(req), await leaderboard(repo)));
  });
  app.post("/matches", async (req, reply) => {
    const u = needUser(req, reply);
    if (!u) return reply;
    if (!csrfOk(req)) return page(reply, errorPage(ctx(req), 400, "The form expired. Go back and try again."), 400);
    const b = req.body ?? {};
    const num = (k, lo, hi, def) => {
      const v = b[k] === void 0 || b[k] === "" ? def : Number(b[k]);
      if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(`${k}: ${lo}-${hi}`);
      return v;
    };
    let opts;
    try {
      const difficulty = str(b.difficulty) || "normal";
      if (!DIFFICULTIES.includes(difficulty)) throw new Error("difficulty: unknown");
      const map = str(b.map) || "qalat";
      if (!gateway.lobbies.maps.includes(map)) throw new Error("map: unknown");
      const watch = ["1", "on", "true"].includes(str(b.watch));
      let bots = [num("bots_team0", 0, 5, 0), num("bots_team1", 0, 5, 2)];
      if (watch && bots[0] === 0) bots = [5, bots[1] || 5];
      opts = {
        map,
        difficulty,
        bots,
        watch,
        shortTimers: ["1", "on", "true"].includes(str(b.short_timers)),
        title: str(b.title, 40).trim(),
        endAction: "restart",
        fastRounds: cfg.devFastRounds
      };
    } catch (e2) {
      flash(req, `Could not start a match: ${e2.message}`);
      return reply.redirect("/play", 303);
    }
    try {
      const h = await gateway.createMatch(u, opts, "bots");
      return reply.redirect(`/game/${h.id}${opts.watch ? "?as=spectate" : ""}`, 303);
    } catch (e2) {
      flash(req, `Could not start a match: ${e2 instanceof MatchLimit ? e2.message : "server error"}`);
      return reply.redirect("/play", 303);
    }
  });
  app.get("/game/:id", async (req, reply) => {
    if (!needUser(req, reply)) return reply;
    const id = req.params.id;
    if (!MATCH_ID_RE.test(id)) return page(reply, errorPage(ctx(req), 404, "No such page."), 404);
    const mode = str(req.query.as) || "play";
    if (mode !== "play" && mode !== "spectate") return page(reply, errorPage(ctx(req), 400, "Bad request."), 400);
    const h = gateway.matches.get(id);
    if (!h) {
      flash(req, "That match has ended.");
      return reply.redirect("/play", 303);
    }
    const manifest = gameAssetManifest();
    if (!manifest || !clientBuilt()) {
      flash(req, "The game client has not been built on this server (npm run build).");
      return reply.redirect("/play", 303);
    }
    return page(reply, gamePage(ctx(req), h.summary(), mode, manifest));
  });
  app.get("/api/matches", async (req, reply) => needUser(req, reply) ? reply.send(gateway.matches.list()) : reply);
  app.get("/api/servers", async (req, reply) => needUser(req, reply) ? reply.send(gateway.browserRows()) : reply);
  app.get("/api/settings", async (req, reply) => {
    const u = needUser(req, reply);
    return u ? reply.send(userSettings(u)) : reply;
  });
  app.put("/api/settings", { bodyLimit: SETTINGS_MAX_BYTES + 1024 }, async (req, reply) => {
    const u = needUser(req, reply);
    if (!u) return reply;
    if (!csrfOk(req)) return reply.code(403).send({ error: "csrf" });
    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? null);
    if (rawBody.length > SETTINGS_MAX_BYTES) return reply.code(413).send({ error: "too large" });
    let data;
    try {
      data = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    } catch {
      return reply.code(400).send({ error: "not JSON" });
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) return reply.code(400).send({ error: "expected an object" });
    await repo.updateUser(u.id, { settingsJson: JSON.stringify(data) });
    return reply.send({ ok: true });
  });
  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith("/api/") || req.url.startsWith("/assets/") || !req.session) return reply.code(404).send({ error: "not found" });
    return page(reply, errorPage(ctx(req), 404, "No such page."), 404);
  });
  app.setErrorHandler(async (e2, req, reply) => {
    const err = e2;
    d.log(`[http] ${req.method} ${req.url}: ${err.stack ?? err}`);
    const code = err.statusCode ?? 500;
    if (req.url.startsWith("/api/") || !req.session) return reply.code(code).send({ error: code >= 500 ? "server error" : err.message });
    return page(reply, errorPage(ctx(req), code, code >= 500 ? "Something went wrong." : err.message), code);
  });
}

// server/src/main.ts
var log = (m) => console.log(m);
async function main() {
  const cfg = loadConfig();
  const repo = await openDb(cfg.databaseUrl, log);
  const sessions = new SessionCodec(cfg.secretKey, cfg.cookieSecure);
  const proxy = new ProxyTrust(cfg.trustedProxy, cfg.cloudflareIps);
  const gateway = new Gateway(cfg, repo, sessions, proxy, log);
  const app = Fastify({ logger: false, trustProxy: false, bodyLimit: 64 * 1024, connectionTimeout: 3e4, requestTimeout: 3e4 });
  await registerViews(app, { cfg, repo, sessions, proxy, gateway, log });
  app.server.on("upgrade", (req, socket, head) => {
    const url = (req.url ?? "").split("?")[0];
    if (url !== "/ws") {
      socket.destroy();
      return;
    }
    gateway.upgrade(req, socket, head).catch((e2) => {
      log(`[ws] upgrade: ${e2}`);
      socket.destroy();
    });
  });
  await app.listen({ host: cfg.host, port: cfg.port });
  gateway.start();
  const shown = cfg.host === "0.0.0.0" || cfg.host === "::" ? "127.0.0.1" : cfg.host;
  log(`FAULTWARD is running: http://${shown.includes(":") ? `[${shown}]` : shown}:${cfg.port}/`);
  if (cfg.siteUrl) log(`public address: ${cfg.siteUrl} (TRUSTED_PROXY=${cfg.trustedProxy})`);
  let stopping = false;
  const shutdown = async (sig) => {
    if (stopping) return;
    stopping = true;
    log(`[server] ${sig}: shutting down`);
    const force = setTimeout(() => process.exit(1), 1e4);
    force.unref();
    try {
      await gateway.stop();
      await app.close();
      await repo.close();
    } catch (e2) {
      log(`[server] shutdown: ${e2}`);
    }
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
main().catch((e2) => {
  console.error(e2);
  process.exit(1);
});

