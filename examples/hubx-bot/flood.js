import { WebSocket } from "ws";
import { JSDOM } from "jsdom";
const dom = new JSDOM("");
globalThis.WebSocket = WebSocket;
globalThis.XMLSerializer = dom.window.XMLSerializer;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.document = dom.window.document;
const { Strophe, $msg } = await import("strophe.js");

const WS = process.env.XMPP_WS || "ws://localhost:5280/ws";
const TO = process.env.TO || "alice@localhost";
const N = parseInt(process.env.N || "300", 10);
const GAP = parseInt(process.env.GAP || "8", 10);
const conn = new Strophe.Connection(WS);

conn.connect("bob@localhost/flood", "bob123", (s) => {
  if (s === Strophe.Status.CONNECTED) {
    console.log(`flood: bob online → blasting ${N} msgs to ${TO} (gap ${GAP}ms)`);
    let i = 0;
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (i >= N) {
        clearInterval(timer);
        console.log(`flood: sent ${N} in ${Date.now() - t0}ms`);
        setTimeout(() => { conn.disconnect("done"); process.exit(0); }, 1500);
        return;
      }
      conn.send($msg({ to: TO, type: "chat", id: `flood-${i}` }).c("body").t(`нагрузка #${i} — проверка рендера ленты сообщений`));
      i++;
    }, GAP);
  } else if (s === Strophe.Status.AUTHFAIL || s === Strophe.Status.CONNFAIL) {
    console.error("flood connect failed", s); process.exit(1);
  }
});
