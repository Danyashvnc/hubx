import { WebSocket } from "ws";
import { JSDOM } from "jsdom";
import fs from "node:fs";
const dom = new JSDOM("");
globalThis.WebSocket = WebSocket;
globalThis.XMLSerializer = dom.window.XMLSerializer;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.document = dom.window.document;
const { Strophe, $msg, $pres } = await import("strophe.js");

const WS_URL = process.env.XMPP_WS || "ws://localhost:5280/ws";
const DOMAIN = process.env.XMPP_DOMAIN || "localhost";
const USER = process.env.BOT_USER || "hubx-bot";
const PASS = process.env.BOT_PASS || "BotHubX2025!";

const LOGIN_DEBOUNCE_MS = 60_000;
const lastLoginNotice = new Map();
const lastCmd = new Map();
const reminders = [];

const REM_FILE = process.env.REMINDERS_FILE || "./reminders.json";
function saveReminders() { try { fs.writeFileSync(REM_FILE, JSON.stringify(reminders)); } catch (e) { console.error("save reminders:", e.message); } }
try { const a = JSON.parse(fs.readFileSync(REM_FILE, "utf8")); if (Array.isArray(a)) reminders.push(...a); } catch {  }

const conn = new Strophe.Connection(WS_URL);
const bare = (j) => Strophe.getBareJidFromJid(j);
const nick = (j) => Strophe.getNodeFromJid(j) || j;
function say(to, text) {
  conn.send($msg({ to, type: "chat" }).c("body").t(text));
  console.log(`-> ${to}: ${text.replace(/\n/g, " | ")}`);
}

const HELP = [
  "🤖 Я бот HubX. Команды:",
  "• /remind 15:30 текст — напомню в указанное время (или /remind 10 текст — через N минут)",
  "• /weth [город] — текущая погода",
  "• /conv 100 usd rub — валюты и единицы (km, kg, c…)",
  "• /help — эта подсказка",
  "А ещё я присылаю уведомление при входе в систему.",
].join("\n");

const WCODE = {
  0: "☀️ Ясно", 1: "🌤 Преим. ясно", 2: "⛅ Переменная облачность", 3: "☁️ Пасмурно",
  45: "🌫 Туман", 48: "🌫 Изморозь", 51: "🌦 Морось", 53: "🌦 Морось", 55: "🌦 Сильная морось",
  61: "🌧 Дождь", 63: "🌧 Дождь", 65: "🌧 Ливень", 66: "🌧 Ледяной дождь", 67: "🌧 Ледяной дождь",
  71: "🌨 Снег", 73: "🌨 Снег", 75: "❄️ Сильный снег", 77: "🌨 Снежные зёрна",
  80: "🌦 Ливни", 81: "🌦 Ливни", 82: "⛈ Сильные ливни", 85: "🌨 Снегопад", 86: "🌨 Снегопад",
  95: "⛈ Гроза", 96: "⛈ Гроза с градом", 99: "⛈ Гроза с градом",
};
async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("http " + r.status);
  return r.json();
}
const CITY_ALIAS = {
  "спб": "Санкт-Петербург", "питер": "Санкт-Петербург", "сиб": "Санкт-Петербург",
  "мск": "Москва", "нск": "Новосибирск", "екб": "Екатеринбург", "екат": "Екатеринбург",
  "нн": "Нижний Новгород", "ннов": "Нижний Новгород", "ростов": "Ростов-на-Дону",
};
async function weather(city) {
  city = (city || "Москва").trim();
  city = CITY_ALIAS[city.toLowerCase()] || city;
  const g = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ru&format=json`);
  if (!g.results || !g.results.length) return `Не нашёл город «${city}». Попробуй иначе: /weth Берлин`;
  const { latitude, longitude, name, country } = g.results[0];
  const w = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code`);
  const c = w.current;
  return `🌍 Погода — ${name}${country ? ", " + country : ""}\n${WCODE[c.weather_code] || ""}, ${Math.round(c.temperature_2m)}°C (ощущается ${Math.round(c.apparent_temperature)}°C)\n💧 влажность ${c.relative_humidity_2m}% · 💨 ветер ${Math.round(c.wind_speed_10m)} км/ч`;
}

const GROUPS = {
  len: { km: 1000, m: 1, cm: 0.01, mm: 0.001, mi: 1609.344, ft: 0.3048, yd: 0.9144, in: 0.0254 },
  mass: { t: 1000, kg: 1, g: 0.001, mg: 1e-6, lb: 0.45359237, oz: 0.0283495 },
};
function tempConvert(n, from, to) {
  const T = ["c", "f", "k"]; if (!T.includes(from) || !T.includes(to)) return null;
  const c = from === "c" ? n : from === "f" ? (n - 32) * 5 / 9 : n - 273.15;
  return to === "c" ? c : to === "f" ? c * 9 / 5 + 32 : c + 273.15;
}
async function convert(nStr, from, to) {
  const n = parseFloat(String(nStr).replace(",", "."));
  if (!isFinite(n)) return "Формат: /conv 100 usd rub  (или km, kg, c…)";
  from = from.toLowerCase().replace("°", ""); to = to.toLowerCase().replace("°", "");
  const t = tempConvert(n, from, to);
  if (t !== null) return `🌡 ${n}°${from.toUpperCase()} = ${t.toFixed(1)}°${to.toUpperCase()}`;
  for (const g of Object.values(GROUPS)) if (Object.hasOwn(g, from) && Object.hasOwn(g, to)) return `📏 ${n} ${from} = ${(n * g[from] / g[to]).toFixed(3).replace(/\.?0+$/, "")} ${to}`;

  const FROM = from.toUpperCase(), TO = to.toUpperCase();
  const data = await fetch(`https://open.er-api.com/v6/latest/${FROM}`).then((r) => r.json()).catch(() => null);
  if (!data || data.result !== "success" || !data.rates?.[TO]) return `Не могу сконвертировать ${from} → ${to}. Поддержка: валюты (usd, rub, eur…), длина (km, mi…), масса (kg, lb…), темп. (c, f, k).`;
  return `💱 ${n} ${FROM} = ${(n * data.rates[TO]).toFixed(2)} ${TO}`;
}

function onPresence(pres) {
  const from = pres.getAttribute("from"); const type = pres.getAttribute("type");
  if (!from) return true;
  const j = bare(from);
  if (j === bare(conn.jid)) return true;
  if (type === "subscribe") {
    conn.send($pres({ to: j, type: "subscribed" }));
    conn.send($pres({ to: j, type: "subscribe" }));
    setTimeout(() => say(j, `Привет, ${nick(j)}! 👋 Я бот HubX. Напиши /help — покажу команды (погода, конвертер, напоминания).`), 600);
    return true;
  }
  if (!type) {
    const now = Date.now();
    if (now - (lastLoginNotice.get(j) || 0) > LOGIN_DEBOUNCE_MS) {
      lastLoginNotice.set(j, now);
      const t = new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
      say(j, `🔔 Вход выполнен. Добро пожаловать, ${nick(j)}! Вы в сети с ${t}.`);
    }
  }
  return true;
}

function onMessage(msg) {
  const from = msg.getAttribute("from"); const type = msg.getAttribute("type");
  const body = msg.getElementsByTagName("body")[0]?.textContent;
  if (!from || type === "error" || !body) return true;
  const j = bare(from);
  if (j === bare(conn.jid)) return true;

  const dl = msg.getElementsByTagName("delay")[0];
  const stamp = dl && dl.getAttribute("xmlns") === "urn:xmpp:delay" ? dl.getAttribute("stamp") : null;
  if (stamp) { const t = Date.parse(stamp); if (!isNaN(t) && Date.now() - t > 60_000) return true; }

  const req = msg.getElementsByTagName("request")[0];
  const mid = msg.getAttribute("id");
  if (req && req.getAttribute("xmlns") === "urn:xmpp:receipts" && mid) {
    conn.send($msg({ to: from, type: "chat" }).c("received", { xmlns: "urn:xmpp:receipts", id: mid }));
  }

  const mark = msg.getElementsByTagName("markable")[0];
  if (mark && mark.getAttribute("xmlns") === "urn:xmpp:chat-markers:0" && mid) {
    conn.send($msg({ to: from, type: "chat" }).c("displayed", { xmlns: "urn:xmpp:chat-markers:0", id: mid }));
  }
  const text = body.trim();
  console.log(`<- ${from}: ${text}`);

  const now = Date.now();
  if (now - (lastCmd.get(j) || 0) < 1500) return true;
  lastCmd.set(j, now);

  if (text === "/help" || text === "/start") { say(j, HELP); return true; }

  const rem = text.match(/^\/(?:remind|напомни)\s+(\S+)\s+([\s\S]+)/i);
  if (rem) {
    const when = rem[1]; const what = rem[2].trim();
    const hm = when.match(/^(\d{1,2}):(\d{2})$/);
    if (hm) {
      const h = +hm[1], mi = +hm[2];
      if (h > 23 || mi > 59) { say(j, "Время в формате ЧЧ:ММ, напр. /remind 18:30 позвонить"); return true; }
      const d = new Date(); d.setHours(h, mi, 0, 0);
      if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
      reminders.push({ at: d.getTime(), to: j, what }); saveReminders();
      const day = d.getDate() !== new Date().getDate() ? " (завтра)" : "";
      say(j, `⏰ Напомню в ${String(h).padStart(2, "0")}:${hm[2]}${day} — «${what}».`);
    } else if (/^\d+$/.test(when)) {
      const mins = Math.min(Math.max(parseInt(when, 10), 1), 1440);
      reminders.push({ at: Date.now() + mins * 60_000, to: j, what }); saveReminders();
      say(j, `⏰ Напомню через ${mins} мин — «${what}».`);
    } else {
      say(j, "Формат: /remind 15:30 текст  или  /remind 10 текст");
    }
    return true;
  }

  if (/^\/(?:remind|напомни)(?:\s|$)/i.test(text)) {
    say(j, "Формат: /remind 15:30 текст  или  /remind 10 текст");
    return true;
  }

  if (/^\/(?:weth|weather|погода)(?:\s|$)/i.test(text)) {
    const city = text.replace(/^\/\S+\s*/, "");
    weather(city).then((r) => say(j, r)).catch(() => say(j, "🌍 Сервис погоды сейчас недоступен."));
    return true;
  }

  if (/^\/(?:conv|convert|конвертер|конверт)(?:\s|$)/i.test(text)) {
    const parts = text.split(/\s+/).slice(1);
    if (parts.length < 3) { say(j, "Формат: /conv 100 usd rub  (валюты, km, kg, c…)"); return true; }
    convert(parts[0], parts[1], parts[2]).then((r) => say(j, r)).catch(() => say(j, "💱 Сервис конвертации недоступен."));
    return true;
  }

  if (text.startsWith("/")) { say(j, "Неизвестная команда.\n" + HELP); return true; }
  say(j, `Принято: «${text}». Подсказка: /help — список команд.`);
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (let i = reminders.length - 1; i >= 0; i--) {
    if (reminders[i].at <= now) { say(reminders[i].to, `⏰ Напоминание: ${reminders[i].what}`); reminders.splice(i, 1); saveReminders(); }
  }
}, 5000);

let reconnectAttempts = 0;
let reconnectTimer = null;
function scheduleReconnect(reason) {
  if (reconnectTimer) return;
  const delay = Math.min(30_000, 2_000 * 2 ** reconnectAttempts++);
  console.error(`• ${reason} — reconnecting in ${Math.round(delay / 1000)}s`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    conn.connect(`${USER}@${DOMAIN}/assistant`, PASS, onStatus);
  }, delay);
}
function onStatus(status) {
  if (status === Strophe.Status.CONNECTING) console.log("• connecting");
  else if (status === Strophe.Status.AUTHFAIL) {
    scheduleReconnect("auth failed (account may not be registered yet, check BOT_PASS)");
  } else if (status === Strophe.Status.CONNECTED) {
    reconnectAttempts = 0;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    console.log(`✓ hubx-bot online as ${conn.jid}`);

    conn.addHandler(onMessage, null, "message", null, null, null);
    conn.addHandler(onPresence, null, "presence", null, null, null);
    conn.send($pres());
  } else if (status === Strophe.Status.CONNFAIL || status === Strophe.Status.DISCONNECTED) {
    scheduleReconnect("disconnected");
  }
}
conn.connect(`${USER}@${DOMAIN}/assistant`, PASS, onStatus);

process.stdin.resume();
