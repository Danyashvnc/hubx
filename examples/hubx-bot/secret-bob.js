import { WebSocket } from "ws";
import { JSDOM } from "jsdom";
const dom = new JSDOM("");
globalThis.WebSocket = WebSocket;
globalThis.XMLSerializer = dom.window.XMLSerializer;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.document = dom.window.document;
const { Strophe, $msg } = await import("strophe.js");

const subtle = globalThis.crypto.subtle;
const ECDH = { name: "ECDH", namedCurve: "P-256" };
const ECDSA = { name: "ECDSA", namedCurve: "P-256" };
const SIGN = { name: "ECDSA", hash: "SHA-256" };
const NS = "hubx:secret:0";
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (u) => Buffer.from(u).toString("base64");
const ub64 = (s) => new Uint8Array(Buffer.from(s, "base64"));
async function fp(a, b) {
  const ka = `${a.x}.${a.y}`, kb = `${b.x}.${b.y}`;
  const pair = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  const h = new Uint8Array(await subtle.digest("SHA-256", enc.encode(pair)));
  return (Array.from(h).map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 24).match(/.{4}/g) || []).join(" ");
}
const sigData = (pub) => enc.encode(`${pub.x}.${pub.y}`);
async function signPub(idPriv, pub) { return b64(new Uint8Array(await subtle.sign(SIGN, idPriv, sigData(pub)))); }
async function verifyPub(idkJwk, pub, sigB64) {
  try { const k = await subtle.importKey("jwk", idkJwk, ECDSA, true, ["verify"]); return await subtle.verify(SIGN, k, ub64(sigB64), sigData(pub)); }
  catch { return false; }
}

const WS = process.env.XMPP_WS || "ws://localhost:5280/ws";
const STAY = parseInt(process.env.STAY || "40000", 10);
const conn = new Strophe.Connection(WS);
const keys = new Map();
let identity, idPubJwk;
let replied = false;

async function onMsg(m) {
  const sec = m.getElementsByTagName("secret")[0];
  if (!sec || sec.getAttribute("xmlns") !== NS) return true;
  const from = Strophe.getBareJidFromJid(m.getAttribute("from"));
  const t = sec.getAttribute("t");
  try {
    if (t === "init") {
      const theirPub = JSON.parse(sec.getElementsByTagName("k")[0].textContent);
      const theirIdk = JSON.parse(sec.getElementsByTagName("idk")[0].textContent);
      const theirSig = sec.getElementsByTagName("sig")[0].textContent;
      if (!(await verifyPub(theirIdk, theirPub, theirSig))) { console.error("✗ BAD SIGNATURE from", from, "— rejecting (MITM?)"); return true; }
      console.log("✓ signature OK — identity authenticated:", from);
      const kp = await subtle.generateKey(ECDH, true, ["deriveKey"]);
      const tp = await subtle.importKey("jwk", theirPub, ECDH, true, []);
      const key = await subtle.deriveKey({ name: "ECDH", public: tp }, kp.privateKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      keys.set(from, key);
      const myPub = await subtle.exportKey("jwk", kp.publicKey);
      const mySig = await signPub(identity.privateKey, myPub);
      conn.send($msg({ to: from, type: "chat" }).c("secret", { xmlns: NS, t: "ack" })
        .c("k").t(JSON.stringify(myPub)).up().c("idk").t(JSON.stringify(idPubJwk)).up().c("sig").t(mySig));
      console.log("HANDSHAKE: derived shared key with", from, "→ sent SIGNED ack");
      console.log("FINGERPRINT (identity keys, bob side):", await fp(idPubJwk, theirIdk));
    } else if (t === "msg") {
      const key = keys.get(from);
      if (!key) { console.log("msg before key"); return true; }
      const iv = ub64(sec.getElementsByTagName("iv")[0].textContent);
      const ct = ub64(sec.getElementsByTagName("c")[0].textContent);
      const pt = dec.decode(await subtle.decrypt({ name: "AES-GCM", iv }, key, ct));
      let body = pt, att; try { const o = JSON.parse(pt); body = o.body; att = o.att; } catch {}
      console.log("DECRYPTED from", from, "→", JSON.stringify(body));
      console.log("CIPHERTEXT on wire (server sees only this):", sec.getElementsByTagName("c")[0].textContent.slice(0, 40), "…");
      if (att && att.fileIv && att.url) {

        const raw = new Uint8Array(await (await fetch(att.url)).arrayBuffer());
        const plain = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: ub64(att.fileIv) }, key, raw));
        console.log(`DECRYPTED FILE "${att.name}" (${att.kind}): server blob ${raw.length}B ciphertext → ${plain.length}B plaintext ✓`);
      }
      if (!replied) {
        replied = true;
        const rid = Math.random().toString(36).slice(2);
        const reply = JSON.stringify({ body: "Принято! Это зашифрованный ответ от Бориса 🔐", id: rid, ttl: 0 });
        const riv = crypto.getRandomValues(new Uint8Array(12));
        const rct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: riv }, key, enc.encode(reply)));
        conn.send($msg({ to: from, type: "chat", id: rid }).c("secret", { xmlns: NS, t: "msg", id: rid, ttl: "0" }).c("iv").t(b64(riv)).up().c("c").t(b64(rct)));
        console.log("→ sent encrypted reply");
      }
    }
  } catch (e) { console.error("crypto error", e.message); }
  return true;
}

conn.connect("bob@localhost/secret", "bob123", async (status) => {
  if (status === Strophe.Status.CONNECTED) {
    identity = await subtle.generateKey(ECDSA, true, ["sign", "verify"]);
    idPubJwk = await subtle.exportKey("jwk", identity.publicKey);
    console.log("secret-bob online (with identity key)");
    conn.addHandler((m) => { onMsg(m); return true; }, null, "message", null, null, null);
    conn.send(new Strophe.Builder("presence"));
    setTimeout(() => { conn.disconnect("done"); process.exit(0); }, STAY);
  } else if (status === Strophe.Status.AUTHFAIL || status === Strophe.Status.CONNFAIL) {
    console.error("connect failed", status); process.exit(1);
  }
});
