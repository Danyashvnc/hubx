import { WebSocket } from "ws";
import { JSDOM } from "jsdom";
const dom = new JSDOM("");
globalThis.WebSocket = WebSocket;
globalThis.XMLSerializer = dom.window.XMLSerializer;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.document = dom.window.document;
const { Strophe, $pres } = await import("strophe.js");

const WS = process.env.XMPP_WS || "ws://localhost:5280/ws";
const USER = process.env.USER_JID || process.env.USER || "load1";
const PASS = process.env.PASS || "loadpass";
const TARGET = process.env.TARGET || "";
const ACCEPT = process.env.ACCEPT !== "0";
const STAY = parseInt(process.env.STAY || "60000", 10);
const conn = new Strophe.Connection(WS);

conn.connect(`${USER}@localhost/peer`, PASS, (status) => {
  if (status === Strophe.Status.CONNECTED) {
    console.log(`${USER} online`);
    conn.addHandler((p) => {
      const from = Strophe.getBareJidFromJid(p.getAttribute("from"));
      const t = p.getAttribute("type");
      if (t === "subscribe") {
        console.log(`◀ REQUEST from ${from}`);
        if (ACCEPT) { conn.send($pres({ to: from, type: "subscribed" })); conn.send($pres({ to: from, type: "subscribe" })); console.log(`▶ ACCEPTED ${from}`); }
      } else if (t === "subscribed") { console.log(`✓ ${from} approved our request`); }
      else if (t === "unsubscribed") { console.log(`✗ ${from} declined`); }
      return true;
    }, null, "presence");
    conn.send($pres());
    if (TARGET) { setTimeout(() => { conn.send($pres({ to: TARGET, type: "subscribe" })); console.log(`▶ sent REQUEST to ${TARGET}`); }, 800); }
    setTimeout(() => { conn.disconnect("done"); process.exit(0); }, STAY);
  } else if (status === Strophe.Status.AUTHFAIL || status === Strophe.Status.CONNFAIL) {
    console.error("connect failed", status); process.exit(1);
  }
});
