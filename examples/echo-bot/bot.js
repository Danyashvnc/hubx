import { WebSocket } from "ws";
import { JSDOM } from "jsdom";

const dom = new JSDOM("");
globalThis.WebSocket = WebSocket;
globalThis.XMLSerializer = dom.window.XMLSerializer;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.document = dom.window.document;

const { Strophe, $msg, $pres } = await import("strophe.js");

const WS_URL  = process.env.XMPP_WS    || "ws://localhost:5280/ws";
const DOMAIN  = process.env.XMPP_DOMAIN|| "localhost";
const USER    = process.env.BOT_USER   || "bob";
const PASS    = process.env.BOT_PASS   || "bob123";
const GREET   = process.env.GREET_JID;

const conn = new Strophe.Connection(WS_URL);

function onMessage(msg) {
  const from = msg.getAttribute("from") || "";
  const type = msg.getAttribute("type");
  const body = msg.getElementsByTagName("body")[0]?.textContent;

  if (from && Strophe.getBareJidFromJid(from) === Strophe.getBareJidFromJid(conn.jid)) return true;

  const req = msg.getElementsByTagName("request")[0];
  const mid = msg.getAttribute("id");
  if (from && req && req.getAttribute("xmlns") === "urn:xmpp:receipts" && mid) {
    conn.send($msg({ to: from, type: "chat" }).c("received", { xmlns: "urn:xmpp:receipts", id: mid }));
  }
  const mark = msg.getElementsByTagName("markable")[0];
  if (from && mark && mark.getAttribute("xmlns") === "urn:xmpp:chat-markers:0" && mid) {
    conn.send($msg({ to: from, type: "chat" }).c("displayed", { xmlns: "urn:xmpp:chat-markers:0", id: mid }));
  }
  if (type !== "error" && body) {
    const bare = Strophe.getBareJidFromJid(from);
    console.log(`<- ${from}: ${body}`);
    const reply = `🤖 эхо: ${body}`;
    conn.send($msg({ to: bare, type: "chat" }).c("body").t(reply));
    console.log(`-> ${bare}: ${reply}`);
  }
  return true;
}

function onPresence(pres) {
  const from = pres.getAttribute("from");
  if (pres.getAttribute("type") === "subscribe" && from) {
    conn.send($pres({ to: from, type: "subscribed" }));
    conn.send($pres({ to: from, type: "subscribe" }));
  }
  return true;
}

conn.connect(`${USER}@${DOMAIN}/echobot`, PASS, (status) => {
  if (status === Strophe.Status.CONNECTING) console.log("• connecting");
  else if (status === Strophe.Status.AUTHFAIL) { console.error("‼ auth failed"); process.exit(1); }
  else if (status === Strophe.Status.CONNFAIL) { console.error("‼ connection failed"); process.exit(1); }
  else if (status === Strophe.Status.CONNECTED) {
    console.log(`✓ online as ${conn.jid}`);
    conn.addHandler(onMessage, null, "message", null, null, null);
    conn.addHandler(onPresence, null, "presence", null, null, null);
    conn.send($pres());
    if (GREET) {
      conn.send($msg({ to: GREET, type: "chat" })
        .c("body").t(`Привет! Это бот ${USER}. Напиши мне — отвечу эхом. 🤖`));
      console.log(`-> greeted ${GREET}`);
    }
  }
});

process.stdin.resume();
