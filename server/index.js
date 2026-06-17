import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import webpush from "web-push";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT       = process.env.PORT         || 4000;
const XMPP_HOST  = process.env.XMPP_HOST    || "localhost";
const API_BASE   = process.env.EJABBERD_API || "http://localhost:5280/api";
const ADMIN_JID  = process.env.ADMIN_JID    || "admin@localhost";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ||
  "http://localhost:5173,http://127.0.0.1:5173").split(",").map((s) => s.trim());

const ALLOWED_HOSTS = (process.env.XMPP_HOSTS || `${XMPP_HOST},hubx.local`).split(",").map((s) => s.trim().toLowerCase());
const safeHost = (h) => { const v = String(h || "").toLowerCase().trim(); return ALLOWED_HOSTS.includes(v) ? v : XMPP_HOST; };

const ADMIN_USERS = (process.env.ADMIN_USERS || ADMIN_JID.split("@")[0])
  .split(",").map((s) => s.trim().toLowerCase());
const TOKEN_TTL_MS = 30 * 60 * 1000;

const ALLOW_INSECURE = process.env.ALLOW_INSECURE === "1";

const DEFAULT_ADMIN_PASS = "AdminHubX2025!";
const adminPassFromEnv = process.env.ADMIN_PASS;
const adminPassMissingOrDefault = !adminPassFromEnv || adminPassFromEnv === DEFAULT_ADMIN_PASS;
const apiSecretMissing = !process.env.ADMIN_API_SECRET;

if ((adminPassMissingOrDefault || apiSecretMissing) && !ALLOW_INSECURE) {
  console.error(
    "[FATAL] Refusing to start: ADMIN_PASS is missing/default or ADMIN_API_SECRET is unset. " +
    "Set both (ADMIN_PASS to a non-default value, ADMIN_API_SECRET to a strong secret), " +
    "or set ALLOW_INSECURE=1 for local development."
  );
  process.exit(1);
}

const ADMIN_PASS = adminPassFromEnv && (ALLOW_INSECURE || adminPassFromEnv !== DEFAULT_ADMIN_PASS)
  ? adminPassFromEnv
  : crypto.randomBytes(24).toString("base64url");

const API_SECRET = process.env.ADMIN_API_SECRET || crypto.randomBytes(32).toString("hex");

const USING_DEFAULTS = adminPassMissingOrDefault || apiSecretMissing;

const AUTH = "Basic " + Buffer.from(`${ADMIN_JID}:${ADMIN_PASS}`).toString("base64");

let tokenEpoch = 1;

async function ejabberd(command, args = {}) {
  const res = await fetch(`${API_BASE}/${command}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: AUTH },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err = new Error(typeof data === "string" ? data : JSON.stringify(data));
    err.status = res.status;
    throw err;
  }
  return data;
}

const _cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.val;
  const val = await fn();
  _cache.set(key, { at: Date.now(), val });
  return val;
}

const GEO_API = process.env.GEO_API || "http://ip-api.com/json";
const SESSIONS_FILE = process.env.SESSIONS_FILE ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), "data", "sessions.json");
const geoCache = new Map();
const loginStore = new Map();
let storeDirty = false;

const DATA_DIR = path.dirname(SESSIONS_FILE);
const VAPID_FILE = path.join(DATA_DIR, "vapid.json");
const PUSH_FILE = path.join(DATA_DIR, "push.json");
let vapid = null;
try { vapid = JSON.parse(fs.readFileSync(VAPID_FILE, "utf8")); } catch {  }
if (!vapid?.publicKey || !vapid?.privateKey) {
  vapid = webpush.generateVAPIDKeys();
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(VAPID_FILE, JSON.stringify(vapid), { mode: 0o600 }); } catch {  }
}
webpush.setVapidDetails("mailto:admin@hubx.local", vapid.publicKey, vapid.privateKey);

const MAX_SUBS_PER_JID = 5;
const pushStore = new Map();
try {
  const j = JSON.parse(fs.readFileSync(PUSH_FILE, "utf8"));
  for (const [k, v] of Object.entries(j)) {
    const subs = Array.isArray(v) ? v : (v ? [v] : []);
    if (subs.length) pushStore.set(k, { subs: subs.slice(-MAX_SUBS_PER_JID), last: 0 });
  }
} catch {  }
function persistPush() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PUSH_FILE, JSON.stringify(Object.fromEntries([...pushStore].map(([k, v]) => [k, v.subs]))), { mode: 0o600 });
  } catch {  }
}

const INVITES_FILE = path.join(DATA_DIR, "invites.json");
const MAX_INVITES = 5000;
const inviteStore = new Map();
try {
  const j = JSON.parse(fs.readFileSync(INVITES_FILE, "utf8"));
  for (const [code, inv] of Object.entries(j || {})) {
    if (inv && typeof inv.code === "string") inviteStore.set(code, inv);
  }
} catch {  }
function persistInvites() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(INVITES_FILE, JSON.stringify(Object.fromEntries(inviteStore)), { mode: 0o600 });
  } catch (e) { console.error("[invites persist]", e.message); }
}

const DEMO_INVITE = process.env.DEMO_INVITE || (ALLOW_INSECURE ? "HUBX-DEMO" : null);
if (DEMO_INVITE) {
  inviteStore.set(DEMO_INVITE, {
    code: DEMO_INVITE,
    createdBy: "system",
    createdAt: Date.now(),
    exp: Date.now() + 365 * 864e5,
    maxUses: 100000,
    uses: 0,
  });
}

function pruneInvites() {
  const now = Date.now();
  let changed = false;
  for (const [code, inv] of inviteStore) {
    if (!inv || inv.exp < now || inv.uses >= inv.maxUses) { inviteStore.delete(code); changed = true; }
  }
  return changed;
}

function normIp(ip) {
  const s = String(ip || "").trim();
  const m = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return m ? m[1] : s;
}
const RETENTION_MS = Number(process.env.IP_RETENTION_MS) || 30 * 24 * 3600 * 1000;
const GEO_CAP_PER_TICK = 10;

const TRUSTED_PROXY_CIDRS = (process.env.TRUSTED_PROXY_IPS || "")
  .split(",").map((s) => s.trim()).filter(Boolean)
  .map((cidr) => {
    const [addr, bitsStr] = cidr.split("/");
    const a = normIp(addr);
    const fam = net.isIP(a);
    if (!fam) return null;
    const bits = bitsStr === undefined ? (fam === 6 ? 128 : 32) : Number(bitsStr);
    if (!Number.isInteger(bits) || bits < 0 || bits > (fam === 6 ? 128 : 32)) return null;
    return { fam, bytes: ipToBytes(a, fam), bits };
  })
  .filter(Boolean);

function ipToBytes(ip, fam) {
  if (fam === 4) return ip.split(".").map(Number);

  let s = ip;
  const dual = s.match(/^(.*:)((\d+\.){3}\d+)$/);
  if (dual) {
    const v4 = dual[2].split(".").map(Number);
    s = dual[1] + ((v4[0] << 8) | v4[1]).toString(16) + ":" + ((v4[2] << 8) | v4[3]).toString(16);
  }
  const halves = s.split("::");
  const head = halves[0] ? halves[0].split(":").filter(Boolean) : [];
  const tail = halves.length > 1 && halves[1] ? halves[1].split(":").filter(Boolean) : [];
  const fill = 8 - head.length - tail.length;
  const groups = [...head, ...Array(Math.max(0, fill)).fill("0"), ...tail];
  const bytes = [];
  for (const g of groups) {
    const n = parseInt(g || "0", 16);
    bytes.push((n >> 8) & 0xff, n & 0xff);
  }
  while (bytes.length < 16) bytes.push(0);
  return bytes.slice(0, 16);
}

function ipInCidr(ip, cidr) {
  const fam = net.isIP(ip);
  if (!fam || fam !== cidr.fam) return false;
  const bytes = ipToBytes(ip, fam);
  let bits = cidr.bits;
  for (let i = 0; bits > 0; i++) {
    const take = Math.min(8, bits);
    const mask = take === 0 ? 0 : (0xff << (8 - take)) & 0xff;
    if ((bytes[i] & mask) !== (cidr.bytes[i] & mask)) return false;
    bits -= take;
  }
  return true;
}

function isTrustedProxy(ip) {
  const a = normIp(ip);
  if (!a || !net.isIP(a)) return false;
  return TRUSTED_PROXY_CIDRS.some((c) => ipInCidr(a, c));
}

function clientIp(req) {
  const peer = req.socket?.remoteAddress;
  if (isTrustedProxy(peer)) {
    const cf = req.headers["cf-connecting-ip"];
    const v = normIp((Array.isArray(cf) ? cf[0] : cf) || "");
    if (v && net.isIP(v)) return v;
  }
  return normIp(req.ip || "");
}

function isPrivateIp(ip) {
  const a = normIp(ip);
  if (!a) return true;
  if (net.isIP(a) === 6) return /^(::1$|::$|f[cd]|fe[89ab]|ff)/i.test(a);
  const p = a.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [x, y, z] = p;
  return x === 127 || x === 10 || x === 0 || x >= 240 ||
    (x === 169 && y === 254) || (x === 192 && y === 168) ||
    (x === 172 && y >= 16 && y <= 31) || (x === 100 && y >= 64 && y <= 127) ||
    (x === 192 && y === 0 && (z === 0 || z === 2)) ||
    (x === 198 && (y === 18 || y === 19)) ||
    (x === 198 && y === 51 && z === 100) || (x === 203 && y === 0 && z === 113);
}

function geoCached(ip) {
  const a = normIp(ip);
  if (!a || net.isIP(a) === 0) return null;
  if (isPrivateIp(a)) return { private: true };
  const hit = geoCache.get(a);
  return hit && Date.now() - hit.at < 24 * 3600 * 1000 ? hit : null;
}

async function geoLookup(ip) {
  const a = normIp(ip);
  if (!a || net.isIP(a) === 0) return null;
  if (isPrivateIp(a)) return { private: true };
  const hit = geoCache.get(a);
  if (hit && Date.now() - hit.at < 24 * 3600 * 1000) return hit;
  let geo;
  try {
    const r = await fetch(`${GEO_API}/${encodeURIComponent(a)}?fields=status,country,countryCode,city`,
      { signal: AbortSignal.timeout(4000) });
    const d = await r.json();
    geo = d.status === "success"
      ? { city: d.city || "", country: d.country || "", countryCode: d.countryCode || "", at: Date.now() }
      : { unknown: true, at: Date.now() };
  } catch { geo = { unknown: true, at: Date.now() }; }
  if (geoCache.size > 2000) geoCache.delete(geoCache.keys().next().value);
  geoCache.set(a, geo);
  return geo;
}

function fmtGeo(geo) {
  if (!geo) return null;
  if (geo.private) return "Локальная сеть";
  if (geo.unknown) return "—";
  const parts = [geo.city, geo.country].filter(Boolean);
  return parts.length ? parts.join(", ") : "—";
}
function loadStore() {
  try {
    const j = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf8"));
    for (const k in j) loginStore.set(k, j[k]);
  } catch {  }
}
let lastPersist = 0;
function persistStore(force = false) {
  if (!storeDirty || (!force && Date.now() - lastPersist < 5000)) return;
  try {
    fs.mkdirSync(path.dirname(SESSIONS_FILE), { recursive: true });
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(loginStore)), { mode: 0o600 });
    storeDirty = false; lastPersist = Date.now();
  } catch (e) { console.error("[sessions persist]", e.message); }
}

function recordLogin(bareJid, ip, source, extra = {}) {
  const prev = loginStore.get(bareJid);

  const keepBeacon = prev?.source === "beacon" && source !== "beacon";
  loginStore.set(bareJid, {
    ip: keepBeacon ? prev.ip : (ip || prev?.ip || null),
    geo: keepBeacon ? prev.geo : (geoCached(ip) || prev?.geo || null),
    lastSeenTs: Date.now(),
    connection: extra.connection || prev?.connection || "",
    source: keepBeacon ? "beacon" : source,
  });
  storeDirty = true;
}

async function pollSessions() {
  let rows;
  try { rows = await ejabberd("connected_users_info", {}); } catch { return; }
  if (!Array.isArray(rows)) return;
  let budget = GEO_CAP_PER_TICK;
  for (const s of rows) {
    const bare = String(s.jid || "").split("/")[0];
    if (!bare) continue;
    const ip = normIp(s.ip);
    if (budget > 0 && !geoCached(ip) && !isPrivateIp(ip) && net.isIP(ip)) { budget--; await geoLookup(ip); }
    recordLogin(bare, ip, "ejabberd", { connection: s.connection || "" });
  }

  for (const [jid, rec] of loginStore) if (rec.lastSeenTs && Date.now() - rec.lastSeenTs > RETENTION_MS) { loginStore.delete(jid); storeDirty = true; }
  persistStore();
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");
function signToken(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", API_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}
function verifyToken(token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", API_SECRET).update(body).digest("base64url");

  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

function requireLocal(req, res, next) {
  if (ALLOW_INSECURE && !isPrivateIp(clientIp(req)))
    return res.status(403).json({ ok: false, error: "Админ-доступ разрешён только из локальной сети" });
  next();
}

function requireAdmin(req, res, next) {
  if (ALLOW_INSECURE && !isPrivateIp(clientIp(req)))
    return res.status(403).json({ ok: false, error: "Админ-доступ разрешён только из локальной сети" });
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const payload = verifyToken(token);

  if (!payload || payload.t === "user" || (payload.epoch || 0) < tokenEpoch)
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  req.admin = payload;
  next();
}

function requireUser(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  const payload = verifyToken(token);
  if (!payload || payload.t !== "user" || !payload.jid)
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  req.userJid = String(payload.jid).toLowerCase();
  next();
}

const app = express();
app.disable("x-powered-by");

app.set("trust proxy",
  process.env.TRUST_PROXY
    ? process.env.TRUST_PROXY.split(",").map((s) => s.trim()).filter(Boolean)
    : Number(process.env.TRUST_PROXY_HOPS || 1));
app.use(helmet());
app.use(
  cors({
    origin(origin, cb) {

      if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);

      cb(null, false);
    },
  })
);
app.use(express.json({ limit: "16kb" }));

const registerLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });
const loginLimiter    = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

const joinLimiter     = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

app.get("/api/health", async (_req, res) => {
  try {

    await cached("health:status", 5000, () => ejabberd("status"));
    res.json({ ok: true, xmppHost: XMPP_HOST });
  } catch {
    res.status(503).json({ ok: false, error: "XMPP server unavailable" });
  }
});

app.post("/api/register", registerLimiter, async (req, res) => {
  const { username, password, invite } = req.body || {};
  if (!username || typeof password !== "string" || !password)
    return res.status(400).json({ ok: false, error: "username and password are required" });
  if (!/^[a-z0-9._-]{2,32}$/i.test(username))
    return res.status(400).json({ ok: false, error: "username: 2-32 chars, letters/digits/._- only" });
  if (String(password).length < 8)
    return res.status(400).json({ ok: false, error: "password must be at least 8 characters" });

  const inv = inviteStore.get(String(invite || ""));
  if (!inv || inv.exp < Date.now() || inv.uses >= inv.maxUses)
    return res.status(403).json({ ok: false, error: "нужен код-приглашение" });

  try {
    await ejabberd("register", { user: username.toLowerCase(), host: XMPP_HOST, password });

    if (inv) {
      inv.uses += 1;
      if (inv.uses >= inv.maxUses) inviteStore.delete(inv.code);
      persistInvites();
    }
    res.json({ ok: true, jid: `${username.toLowerCase()}@${XMPP_HOST}` });
  } catch (e) {
    if (/conflict|already|exist/i.test(String(e.message)))
      return res.status(409).json({ ok: false, error: "User already exists" });
    console.error("[register]", e.message);
    res.status(500).json({ ok: false, error: "Registration failed" });
  }
});

app.post("/api/invites", requireAdmin, (req, res) => {
  if (inviteStore.size >= MAX_INVITES) {
    pruneInvites();
    if (inviteStore.size >= MAX_INVITES)
      return res.status(429).json({ ok: false, error: "too many invites" });
  }
  const maxUses = Math.min(Math.max(Number(req.body?.maxUses) || 1, 1), 1000);
  const ttlDays = Math.min(Math.max(Number(req.body?.ttlDays) || 7, 1), 365);
  const code = crypto.randomBytes(9).toString("base64url");
  const createdBy = (req.adminUser || String(req.admin?.jid || "").split("@")[0]) || "admin";
  inviteStore.set(code, {
    code,
    createdBy,
    createdAt: Date.now(),
    exp: Date.now() + ttlDays * 864e5,
    maxUses,
    uses: 0,
  });
  persistInvites();
  res.json({ ok: true, code });
});

app.get("/api/invites", requireAdmin, (_req, res) => {
  if (pruneInvites()) persistInvites();
  const invites = [...inviteStore.values()]
    .map(({ code, uses, maxUses, exp, createdAt }) => ({ code, uses, maxUses, exp, createdAt }))
    .sort((a, b) => b.createdAt - a.createdAt);
  res.json({ ok: true, invites });
});

app.delete("/api/invites/:code", requireAdmin, (req, res) => {
  inviteStore.delete(req.params.code);
  persistInvites();
  res.json({ ok: true });
});

const lookupLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
app.get("/api/user-exists", lookupLimiter, async (req, res) => {
  const user = String(req.query.u || "").toLowerCase().trim();
  const rawHost = String(req.query.host || "").toLowerCase().trim();
  const host = safeHost(req.query.host);
  if (!user || !/^[a-z0-9._-]{1,64}$/i.test(user))
    return res.json({ ok: true, exists: false });
  if (rawHost && !ALLOWED_HOSTS.includes(rawHost))
    return res.json({ ok: true, exists: true, remote: true });
  try {

    const r = await ejabberd("check_account", { user, host });
    const exists = r === 0 || r === "0" || r?.res === 0;
    res.json({ ok: true, exists });
  } catch (e) {

    res.json({ ok: true, exists: true, unverified: true });
  }
});

app.post("/api/admin/login", requireLocal, loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  const user = String(username || "").toLowerCase();
  if (!user || typeof password !== "string" || !password)
    return res.status(400).json({ ok: false, error: "credentials required" });
  if (!ADMIN_USERS.includes(user))
    return res.status(403).json({ ok: false, error: "Not an administrator" });

  try {

    const result = await ejabberd("check_password", { user, host: XMPP_HOST, password });
    const ok = result === 0 || result === "0" || result?.res === 0;
    if (!ok) return res.status(401).json({ ok: false, error: "Invalid credentials" });

    const exp = Date.now() + TOKEN_TTL_MS;
    res.json({ ok: true, token: signToken({ jid: `${user}@${XMPP_HOST}`, exp, epoch: tokenEpoch }), exp });
  } catch (e) {
    console.error("[admin/login]", e.message);
    res.status(500).json({ ok: false, error: "Login failed" });
  }
});

app.post("/api/auth/token", loginLimiter, async (req, res) => {
  const { username, password, host } = req.body || {};
  const user = String(username || "").toLowerCase().trim();
  const safeH = safeHost(host);
  if (!user || !/^[a-z0-9._-]{1,64}$/i.test(user) || typeof password !== "string" || !password)
    return res.status(400).json({ ok: false, error: "credentials required" });
  try {
    const result = await ejabberd("check_password", { user, host: safeH, password });
    const ok = result === 0 || result === "0" || result?.res === 0;
    if (!ok) return res.status(401).json({ ok: false, error: "Invalid credentials" });
    const exp = Date.now() + 12 * 3600 * 1000;
    res.json({ ok: true, token: signToken({ t: "user", jid: `${user}@${safeH}`, exp }), exp });
  } catch (e) {
    console.error("[auth/token]", e.message);

    res.status(401).json({ ok: false, error: "Invalid credentials" });
  }
});

app.get("/api/users", requireAdmin, async (_req, res) => {
  try {
    const [users, online] = await Promise.all([
      ejabberd("registered_users", { host: XMPP_HOST }),
      ejabberd("connected_users", {}).catch(() => []),
    ]);
    const onlineBare = new Set(
      (Array.isArray(online) ? online : []).map((s) => String(s).split("/")[0])
    );
    const list = (Array.isArray(users) ? users : []).map((u) => {
      const name = typeof u === "string" ? u : u.username || u.user;
      const jid = `${name}@${XMPP_HOST}`;
      return { username: name, jid, online: onlineBare.has(jid) };
    });
    res.json({
      ok: true,
      host: XMPP_HOST,
      total: list.length,
      onlineCount: list.filter((u) => u.online).length,
      users: list.sort((a, b) => Number(b.online) - Number(a.online) || a.username.localeCompare(b.username)),
    });
  } catch (e) {
    console.error("[users]", e.message);
    res.status(503).json({ ok: false, error: "Directory unavailable" });
  }
});

app.get("/api/users/search", lookupLimiter, async (req, res) => {
  const q = String(req.query.q || "").toLowerCase().trim();
  const host = safeHost(req.query.host);
  if (q.length < 2) return res.json({ ok: true, users: [] });
  try {

    const [users, online] = await Promise.all([
      cached(`reg:${host}`, 5000, () => ejabberd("registered_users", { host })),
      cached("conn", 5000, () => ejabberd("connected_users", {})).catch(() => []),
    ]);
    const onlineBare = new Set((Array.isArray(online) ? online : []).map((s) => String(s).split("/")[0]));
    const hidden = /^(load\d+|hubx-bot)$/i;
    const list = (Array.isArray(users) ? users : [])
      .map((u) => (typeof u === "string" ? u : u.username || u.user))
      .filter((name) => name && !hidden.test(name) && name.toLowerCase().includes(q))
      .slice(0, 20)
      .map((name) => ({ username: name, jid: `${name}@${host}`, online: onlineBare.has(`${name}@${host}`) }));
    res.json({ ok: true, users: list });
  } catch {
    res.json({ ok: true, users: [] });
  }
});

app.delete("/api/users/:username", requireAdmin, async (req, res) => {
  const target = req.params.username.toLowerCase();
  if (`${target}@${XMPP_HOST}` === req.admin.jid)
    return res.status(400).json({ ok: false, error: "You cannot delete your own account" });
  try {
    await ejabberd("unregister", { user: target, host: XMPP_HOST });
    loginStore.delete(`${target}@${XMPP_HOST}`); storeDirty = true; lastPersist = 0; persistStore();

    if (ADMIN_USERS.includes(target)) tokenEpoch++;
    res.json({ ok: true });
  } catch (e) {
    console.error("[unregister]", e.message);
    res.status(500).json({ ok: false, error: "Delete failed" });
  }
});

app.post("/api/session/beacon", lookupLimiter, async (req, res) => {
  const bare = String(req.body?.jid || "").toLowerCase().trim().split("/")[0];
  const [user, host] = bare.split("@");
  if (user && /^[a-z0-9._-]{1,64}$/.test(user) && host && safeHost(host) === host) {
    try {

      const conn = await ejabberd("connected_users", {});
      const onlineBare = new Set((Array.isArray(conn) ? conn : []).map((s) => String(s).split("/")[0]));
      if (onlineBare.has(bare)) {
        const ip = clientIp(req);
        await geoLookup(ip);
        recordLogin(bare, ip, "beacon");
        persistStore();
      }
    } catch {  }
  }
  res.json({ ok: true });
});

app.post("/api/rooms/invite-link", lookupLimiter, requireUser, async (req, res) => {
  const room = String(req.body?.room || "").toLowerCase().trim();

  const jid = req.userJid;
  if (!/^[^@\s]+@conference\.[^@\s]+$/.test(room))
    return res.status(400).json({ ok: false, error: "bad room" });
  try {
    const [name, service] = room.split("@");

    const affs = await ejabberd("get_room_affiliations", { room: name, service });
    const mine = (Array.isArray(affs) ? affs : []).find((a) => String(a.jid || "").toLowerCase() === jid);
    if (!mine || !["owner", "admin"].includes(mine.affiliation))
      return res.status(403).json({ ok: false, error: "ссылку может создать только админ группы" });

    const ttl = Math.min(Math.max(Number(req.body?.ttlMs) || 7 * 864e5, 60_000), 30 * 864e5);
    const token = signToken({ t: "muc-invite", room, exp: Date.now() + ttl });
    res.json({ ok: true, token });
  } catch { res.status(502).json({ ok: false, error: "ejabberd error" }); }
});
app.post("/api/rooms/join", joinLimiter, requireUser, async (req, res) => {
  const p = verifyToken(String(req.body?.token || ""));

  const jid = req.userJid;
  if (!p || p.t !== "muc-invite") return res.status(403).json({ ok: false, error: "ссылка недействительна или истекла" });
  const [user, host] = jid.split("@");
  if (!user || !/^[a-z0-9._-]{1,64}$/i.test(user) || safeHost(host) !== host)
    return res.status(400).json({ ok: false, error: "bad jid" });
  try {
    const [name, service] = p.room.split("@");

    const affs = await ejabberd("get_room_affiliations", { room: name, service });
    const existing = (Array.isArray(affs) ? affs : []).find((a) => String(a.jid || "").toLowerCase() === jid);
    if (existing && existing.affiliation === "outcast")
      return res.status(403).json({ ok: false, error: "доступ к группе запрещён" });

    await ejabberd("set_room_affiliation", { room: name, service, user, host, affiliation: "member" });
    res.json({ ok: true, room: p.room });
  } catch { res.status(502).json({ ok: false, error: "ejabberd error" }); }
});

app.get("/api/push/key", (_req, res) => res.json({ ok: true, key: vapid.publicKey }));
app.post("/api/push/subscribe", lookupLimiter, (req, res) => {
  const bare = String(req.body?.jid || "").toLowerCase().trim().split("/")[0];
  const sub = req.body?.sub;
  const [user, host] = bare.split("@");
  if (!user || !/^[a-z0-9._-]{1,64}$/.test(user) || safeHost(host) !== host)
    return res.status(400).json({ ok: false, error: "bad jid" });

  if (!sub || typeof sub.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint) ||
      typeof sub.keys?.p256dh !== "string" || typeof sub.keys?.auth !== "string")
    return res.status(400).json({ ok: false, error: "bad subscription" });
  const entry = pushStore.get(bare) || { subs: [], last: 0 };

  entry.subs = [...entry.subs.filter((s) => s.endpoint !== sub.endpoint), sub].slice(-MAX_SUBS_PER_JID);
  pushStore.set(bare, entry);
  persistPush();
  res.json({ ok: true });
});
app.post("/api/push/unsubscribe", lookupLimiter, (req, res) => {
  const bare = String(req.body?.jid || "").toLowerCase().trim().split("/")[0];
  if (pushStore.delete(bare)) persistPush();
  res.json({ ok: true });
});

async function pushTick() {
  if (pushStore.size === 0) return;
  let onlineBare;
  try {
    const conn = await ejabberd("connected_users", {});
    onlineBare = new Set((Array.isArray(conn) ? conn : []).map((s) => String(s).split("/")[0]));
  } catch { return; }
  for (const [bare, entry] of pushStore) {
    if (onlineBare.has(bare)) { entry.last = 0; continue; }
    const [user, host] = bare.split("@");
    try {
      const count = Number(await ejabberd("get_offline_count", { user, host })) || 0;
      if (count > entry.last) {
        entry.last = count;
        const payload = JSON.stringify({
          title: "HubX",
          body: count === 1 ? "У вас новое сообщение" : `У вас новых сообщений: ${count}`,
        });
        const dead = [];
        for (const s of entry.subs) {
          try { await webpush.sendNotification(s, payload); }
          catch (e) { if (e?.statusCode === 404 || e?.statusCode === 410) dead.push(s.endpoint); }
        }
        if (dead.length) {
          entry.subs = entry.subs.filter((s) => !dead.includes(s.endpoint));
          if (entry.subs.length === 0) pushStore.delete(bare);
          persistPush();
        }
      } else if (count === 0) entry.last = 0;
    } catch (e) {

      void e;
    }
  }
}
setInterval(pushTick, 30_000);

app.get("/api/admin/sessions", requireAdmin, async (_req, res) => {
  try {
    const [registered, sessionRows] = await Promise.all([
      ejabberd("registered_users", { host: XMPP_HOST }),
      ejabberd("connected_users_info", {}).catch(() => []),
    ]);

    const liveByJid = new Map();
    for (const s of (Array.isArray(sessionRows) ? sessionRows : [])) {
      const bare = String(s.jid || "").split("/")[0];
      if (!bare) continue;
      const arr = liveByJid.get(bare) || [];
      arr.push(s);
      liveByJid.set(bare, arr);
    }
    const out = [];
    for (const u of (Array.isArray(registered) ? registered : [])) {
      const name = typeof u === "string" ? u : u.username || u.user;
      if (!name) continue;
      const jid = `${name}@${XMPP_HOST}`;
      const live = liveByJid.get(jid);
      const online = !!(live && live.length);
      if (online) recordLogin(jid, normIp(live[0].ip), "ejabberd", { connection: live[0].connection || "" });
      const rec = loginStore.get(jid);

      const geo = rec?.geo || (rec?.ip ? geoCached(rec.ip) : null) || null;
      out.push({
        username: name, jid, online, ip: rec?.ip || null,
        location: fmtGeo(geo), city: geo?.city || null, country: geo?.country || null, countryCode: geo?.countryCode || null,
        connection: online ? (live[0].connection || "") : (rec?.connection || ""),
        devices: online ? live.length : 0,
        uptime: online ? Math.max(0, ...live.map((s) => s.uptime || 0)) : 0,
        lastSeenTs: rec?.lastSeenTs || (online ? Date.now() : null),
      });
    }
    persistStore();
    out.sort((a, b) => Number(b.online) - Number(a.online) || (b.lastSeenTs || 0) - (a.lastSeenTs || 0) || a.username.localeCompare(b.username));
    res.json({
      ok: true, host: XMPP_HOST, total: out.length,
      onlineCount: out.filter((u) => u.online).length,
      offlineCount: out.filter((u) => !u.online).length,
      users: out,
    });
  } catch (e) {
    console.error("[admin/sessions]", e.message);
    res.status(503).json({ ok: false, error: "Sessions unavailable" });
  }
});

loadStore();
pollSessions();
setInterval(pollSessions, 20_000);

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { persistStore(true); process.exit(0); });

app.listen(PORT, () => {
  console.log(`[hubx-admin] listening on http://localhost:${PORT}`);
  console.log(`[hubx-admin] ejabberd API: ${API_BASE}  host=${XMPP_HOST}`);
  console.log(`[hubx-admin] CORS allowlist: ${ALLOWED_ORIGINS.join(", ")}`);
  if (USING_DEFAULTS)
    console.warn(
      "[hubx-admin] ⚠  Using built-in demo secrets. Set ADMIN_PASS and ADMIN_API_SECRET in production."
    );
});
