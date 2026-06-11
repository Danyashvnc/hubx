import { WebSocket } from "ws";
import { JSDOM } from "jsdom";
const dom = new JSDOM("");
globalThis.WebSocket = WebSocket;
globalThis.XMLSerializer = dom.window.XMLSerializer;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.document = dom.window.document;
const { Strophe, $msg, $pres } = await import("strophe.js");

const WS = process.env.XMPP_WS || "ws://localhost:5280/ws";
const ROOM = process.env.ROOM || "команда@conference.localhost";
const NICK = process.env.NICK || "bob";
const STAY = parseInt(process.env.STAY || "12000", 10);
const WAIT_INVITE = process.env.WAIT_INVITE === "1";
const MUC = "http://jabber.org/protocol/muc";
const MUC_USER = "http://jabber.org/protocol/muc#user";
const conn = new Strophe.Connection(WS);
function joinRoom(roomJid) {
  conn.send($pres({ to: `${roomJid}/${NICK}` }).c("x", { xmlns: MUC }));
  console.log("joined", roomJid);
}
conn.connect("bob@localhost/muc", "bob123", (status) => {
  if (status === Strophe.Status.CONNECTED) {
    conn.addHandler((p) => { console.log("PRES from", p.getAttribute("from"), "type", p.getAttribute("type")); return true; }, null, "presence", null, null, null);
    conn.addHandler((m) => {

      const xs = m.getElementsByTagName("x");
      for (let i = 0; i < xs.length; i++) {
        if (xs[i].getAttribute("xmlns") === MUC_USER && xs[i].getElementsByTagName("invite")[0]) {
          const roomJid = Strophe.getBareJidFromJid(m.getAttribute("from"));
          console.log("INVITED to", roomJid);
          setTimeout(() => joinRoom(roomJid), 300);
          setTimeout(() => conn.send($msg({ to: roomJid, type: "groupchat" }).c("body").t("Спасибо за приглашение! 👋")), 1200);
          return true;
        }
      }
      if (m.getAttribute("type") === "groupchat") {
        const b = m.getElementsByTagName("body")[0];
        console.log("GROUPCHAT from", m.getAttribute("from"), "->", b ? b.textContent : "(no body)");
      }
      return true;
    }, null, "message", null, null, null);
    conn.send($pres());
    if (!WAIT_INVITE) {
      joinRoom(ROOM);
      setTimeout(() => { conn.send($msg({ to: ROOM, type: "groupchat" }).c("body").t("Привет всем! Это Борис в группе. 👋")); console.log("sent groupchat to", ROOM); }, 1500);
    } else {
      console.log("waiting for invite…");
    }
    setTimeout(() => { conn.disconnect("done"); process.exit(0); }, STAY);
  } else if (status === Strophe.Status.AUTHFAIL || status === Strophe.Status.CONNFAIL) {
    console.error("connect failed", status); process.exit(1);
  }
});
