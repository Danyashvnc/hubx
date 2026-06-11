import { WebSocket } from "ws";
import { JSDOM } from "jsdom";
const dom = new JSDOM("");
globalThis.WebSocket = WebSocket;
globalThis.XMLSerializer = dom.window.XMLSerializer;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.document = dom.window.document;
const { Strophe, $msg, $pres } = await import("strophe.js");

const N = parseInt(process.env.N || "50", 10);
const MSGS = parseInt(process.env.MSGS || "5", 10);
const WS = process.env.XMPP_WS || "ws://localhost:5280/ws";
const PASS = process.env.PASS || "loadpass";
const now = () => Number(process.hrtime.bigint() / 1000000n);

const conns = [];
let connected = 0, failed = 0, recv = 0, sent = 0;
const cTimes = [];

function makeUser(i) {
  return new Promise((resolve) => {
    const c = new Strophe.Connection(WS);
    c.addHandler(() => { recv++; return true; }, null, "message", "chat");
    const t0 = now();
    let done = false;
    c.connect(`load${i}@localhost/load`, PASS, (status) => {
      if (status === Strophe.Status.CONNECTED) {
        connected++; cTimes.push(now() - t0); c.send($pres());
        conns[i] = c; if (!done) { done = true; resolve(true); }
      } else if (status === Strophe.Status.AUTHFAIL || status === Strophe.Status.CONNFAIL) {
        failed++; if (!done) { done = true; resolve(false); }
      }
    });
  });
}

const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };
const sum = (a) => a.reduce((x, y) => x + y, 0);

console.log(`▶ Подключаю ${N} сессий одновременно к ${WS} …`);
const wallStart = now();
await Promise.all(Array.from({ length: N }, (_, k) => makeUser(k + 1)));
const connectWall = now() - wallStart;

console.log(`\n── Подключение ──`);
console.log(`  успешно:   ${connected}/${N}`);
console.log(`  отказов:   ${failed}`);
console.log(`  всего за:  ${connectWall} мс (все ${N} параллельно)`);
console.log(`  задержка connect: min ${Math.min(...cTimes)} / avg ${Math.round(sum(cTimes) / (cTimes.length || 1))} / p95 ${pct(cTimes, 95)} / max ${Math.max(...cTimes)} мс`);

console.log(`\n▶ Рассылка: каждый шлёт ${MSGS} сообщений соседу …`);
const burstStart = now();
for (let i = 1; i <= N; i++) {
  const c = conns[i];
  if (!c) continue;
  const to = `load${(i % N) + 1}@localhost`;
  for (let m = 0; m < MSGS; m++) { c.send($msg({ to, type: "chat" }).c("body").t(`нагрузка #${m} от load${i}`)); sent++; }
}
await new Promise((r) => setTimeout(r, 6000));
const burstWall = now() - burstStart;

console.log(`\n── Сообщения ──`);
console.log(`  отправлено: ${sent}`);
console.log(`  доставлено: ${recv}  (${sent ? Math.round(recv / sent * 100) : 0}%)`);
console.log(`  время рассылки+доставки: ${burstWall} мс  (~${Math.round(recv / (burstWall / 1000))} сообщений/с)`);
console.log(`\n── Клиент-нагрузчик ──`);
const mem = process.memoryUsage();
console.log(`  RSS ${Math.round(mem.rss / 1048576)} МБ, heap ${Math.round(mem.heapUsed / 1048576)} МБ (это нагрузка тестового скрипта, не сервера)`);

console.log(`\n✓ Итог: ${connected}/${N} онлайн, доставка ${sent ? Math.round(recv / sent * 100) : 0}%. Сервер ${failed === 0 && connected === N ? "ВЫДЕРЖАЛ" : "с потерями — см. выше"}.`);

for (let i = 1; i <= N; i++) { try { conns[i]?.disconnect("done"); } catch {  } }
setTimeout(() => process.exit(0), 1500);
