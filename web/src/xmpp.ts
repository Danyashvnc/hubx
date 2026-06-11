import { Strophe, $pres, $msg, $iq } from "strophe.js";
import type { Attachment, AttachmentKind, ChatMessage, ConnState, Contact, Presence } from "./types";
import { CONFIG } from "./config";

type Events = {
  state: (s: ConnState, detail?: string) => void;
  roster: (contacts: Contact[]) => void;
  presence: (jid: string, presence: Presence, status?: string) => void;
  message: (msg: ChatMessage) => void;
  composing: (jid: string, active: boolean) => void;
  receipt: (id: string, from: string) => void;
  read: (id: string, from: string) => void;
  edit: (peer: string, id: string, body: string) => void;
  retract: (peer: string, id: string) => void;
  reaction: (peer: string, targetId: string, fromBare: string, emojis: string[]) => void;
  groupMessage: (room: string, msg: ChatMessage) => void;
  occupant: (room: string, nick: string, available: boolean, affiliation: string, role: string, jid: string) => void;
  invited: (room: string, from: string) => void;
  secretInit: (peer: string, p: { k: any; idk: any; sig: string }) => void;
  secretAck: (peer: string, p: { k: any; idk: any; sig: string }) => void;
  secretMsg: (peer: string, payload: { id: string; iv: string; ct: string; ttl: number }) => void;
  secretTtl: (peer: string, ttl: number) => void;
  joinError: (room: string, condition: string) => void;
  contactRequest: (from: string) => void;
  subscribed: (from: string) => void;
  unsubscribed: (from: string) => void;
  archive: (conv: string, msg: ChatMessage) => void;
};

const RECEIPTS_NS = "urn:xmpp:receipts";
const MARKERS_NS = "urn:xmpp:chat-markers:0";
const CORRECT_NS = "urn:xmpp:message-correct:0";
const RETRACT_NS = "urn:xmpp:message-retract:0";
const REACTIONS_NS = "urn:xmpp:reactions:0";
const HINTS_NS = "urn:xmpp:hints";
const MUC_NS = "http://jabber.org/protocol/muc";
const MUC_USER_NS = "http://jabber.org/protocol/muc#user";
const MUC_ADMIN_NS = "http://jabber.org/protocol/muc#admin";
const SECRET_NS = "hubx:secret:0";
const MAM_NS = "urn:xmpp:mam:2";
const FORWARD_NS = "urn:xmpp:forward:0";
const DELAY_NS = "urn:xmpp:delay";
const REPLY_NS = "urn:xmpp:reply:0";
const UPLOAD_NS = "urn:xmpp:http:upload:0";
const OOB_NS = "jabber:x:oob";

const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"];
const AUDIO_EXT = ["mp3", "ogg", "oga", "wav", "webm", "m4a", "opus", "aac", "flac"];
const MIME_BY_EXT: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  mp3: "audio/mpeg", ogg: "audio/ogg", oga: "audio/ogg", wav: "audio/wav", webm: "audio/webm", m4a: "audio/mp4",
  pdf: "application/pdf", zip: "application/zip", txt: "text/plain", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
function extOf(name: string) {
  const m = name.split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "";
}
function kindOf(mime: string, name: string): AttachmentKind {
  const e = extOf(name);
  if ((mime || "").startsWith("image/") || IMAGE_EXT.includes(e)) return "image";
  if ((mime || "").startsWith("audio/") || AUDIO_EXT.includes(e)) return "audio";
  return "file";
}
function fileNameFromUrl(url: string) {
  try { return decodeURIComponent(url.split(/[?#]/)[0].split("/").pop() || "файл"); } catch { return "файл"; }
}

function httpUrl(url: string): string { return /^https?:\/\//i.test((url || "").trim()) ? url.trim() : ""; }

function child(el: Element, tag: string, ns: string): Element | null {
  const kids = el.childNodes;
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i] as Element;
    if (c.nodeType === 1 && (c.localName === tag || c.nodeName === tag) && c.getAttribute && c.getAttribute("xmlns") === ns) return c;
  }
  return null;
}

function attachmentFromUrl(url: string): Attachment {
  const name = fileNameFromUrl(url);
  const mime = MIME_BY_EXT[extOf(name)] || "";
  const kind = kindOf(mime, name);
  return { url, name, mime, kind, voice: kind === "audio" && /(^|\/)voice-/.test(name) };
}

function bare(jid: string) {
  return Strophe.getBareJidFromJid(jid) || jid;
}
function local(jid: string) {
  return Strophe.getNodeFromJid(jid) || jid;
}
function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function stableId(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return "s" + (h >>> 0).toString(36);
}

export class XmppClient {
  private conn: any;
  private listeners: { [K in keyof Events]: Set<Events[K]> } = {
    state: new Set(),
    roster: new Set(),
    presence: new Set(),
    message: new Set(),
    composing: new Set(),
    receipt: new Set(),
    read: new Set(),
    edit: new Set(),
    retract: new Set(),
    reaction: new Set(),
    groupMessage: new Set(),
    occupant: new Set(),
    invited: new Set(),
    secretInit: new Set(),
    secretAck: new Set(),
    secretMsg: new Set(),
    secretTtl: new Set(),
    joinError: new Set(),
    contactRequest: new Set(),
    subscribed: new Set(),
    unsubscribed: new Set(),
    archive: new Set(),
  };
  jid = "";
  bareJid = "";
  domain: string;
  private roomNick = new Map<string, string>();

  constructor(wsUrl: string = CONFIG.WS_URL, domain: string = CONFIG.DOMAIN) {
    this.domain = domain;
    this.conn = new Strophe.Connection(wsUrl, { keepalive: true });
  }

  on<K extends keyof Events>(ev: K, cb: Events[K]) {
    this.listeners[ev].add(cb);
    return () => this.listeners[ev].delete(cb);
  }
  private emit<K extends keyof Events>(ev: K, ...args: Parameters<Events[K]>) {
    this.listeners[ev].forEach((cb) => (cb as any)(...args));
  }

  connect(username: string, password: string) {
    const fullJid = `${username}@${this.domain}/hubx-web-${uid().slice(0, 6)}`;
    this.emit("state", "connecting");
    this.conn.connect(fullJid, password, (status: number, cond?: string) => {
      switch (status) {
        case Strophe.Status.CONNECTING:
          this.emit("state", "connecting");
          break;
        case Strophe.Status.AUTHFAIL:
          this.emit("state", "authfail", cond);
          break;
        case Strophe.Status.CONNFAIL:
          this.emit("state", "error", cond);
          break;
        case Strophe.Status.DISCONNECTED:
          this.emit("state", "disconnected", cond);
          break;
        case Strophe.Status.CONNECTED:
          this.jid = this.conn.jid;
          this.bareJid = bare(this.conn.jid);
          this.onConnected();
          this.emit("state", "connected");
          break;
      }
    });
  }

  disconnect() {
    try {
      this.conn.send($pres({ type: "unavailable" }));
      this.conn.flush();
      this.conn.disconnect("bye");
    } catch {

    }
  }

  private onConnected() {

    this.conn.addHandler(this.onMessage, null, "message", null, null, null);
    this.conn.addHandler(this.onPresence, null, "presence", null, null, null);
    this.conn.addHandler(
      this.onRosterPush,
      "jabber:iq:roster",
      "iq",
      "set",
      null,
      null
    );

    this.conn.send($pres().c("priority").t("1").up());

    this.fetchRoster();
  }

  fetchRoster() {
    const iq = $iq({ type: "get" }).c("query", { xmlns: "jabber:iq:roster" });
    this.conn.sendIQ(iq, (res: Element) => {
      const contacts: Contact[] = [];
      const items = res.getElementsByTagName("item");
      for (let i = 0; i < items.length; i++) {
        const j = items[i].getAttribute("jid") || "";
        if (!j) continue;
        contacts.push({
          jid: bare(j),
          name: items[i].getAttribute("name") || local(j),
          presence: "offline",
          subscription: items[i].getAttribute("subscription") || "none",
          ask: items[i].getAttribute("ask") || "",
        });
      }
      this.emit("roster", contacts);
    });
  }

  private onRosterPush = (iq: Element) => {
    const items = iq.getElementsByTagName("item");
    const contacts: Contact[] = [];
    for (let i = 0; i < items.length; i++) {
      const j = items[i].getAttribute("jid") || "";
      if (!j) continue;
      contacts.push({
        jid: bare(j),
        name: items[i].getAttribute("name") || local(j),
        presence: "offline",
        subscription: items[i].getAttribute("subscription") || "none",
        ask: items[i].getAttribute("ask") || "",
      });
    }
    if (contacts.length) this.emit("roster", contacts);
    return true;
  };

  addContact(username: string) {
    const jid = username.includes("@") ? bare(username) : `${username}@${this.domain}`;
    const iq = $iq({ type: "set" })
      .c("query", { xmlns: "jabber:iq:roster" })
      .c("item", { jid, name: local(jid) });
    this.conn.sendIQ(iq, () => {
      this.conn.send($pres({ to: jid, type: "subscribe" }));
    });
    return jid;
  }

  private onPresence = (pres: Element) => {
    const from = pres.getAttribute("from") || "";
    const type = pres.getAttribute("type");
    const fromBare = bare(from);

    if (type === "error" && fromBare.includes("@conference.")) {
      const err = pres.getElementsByTagName("error")[0];
      const condition = err?.firstElementChild?.tagName?.toLowerCase() || "unknown";
      this.emit("joinError", fromBare, condition);
      return true;
    }

    const xs = pres.getElementsByTagName("x");
    for (let i = 0; i < xs.length; i++) {
      if (xs[i].getAttribute("xmlns") === MUC_USER_NS) {
        const nick = Strophe.getResourceFromJid(from) || "";
        const item = xs[i].getElementsByTagName("item")[0];
        const affiliation = item?.getAttribute("affiliation") || "none";
        const role = item?.getAttribute("role") || "none";
        const realJid = item?.getAttribute("jid") ? bare(item.getAttribute("jid")!) : "";

        const statuses = xs[i].getElementsByTagName("status");
        for (let s = 0; s < statuses.length; s++) if (statuses[s].getAttribute("code") === "110" && nick) this.roomNick.set(fromBare, nick);
        if (nick) this.emit("occupant", fromBare, nick, type !== "unavailable", affiliation, role, realJid);
        return true;
      }
    }

    if (type === "subscribe") {

      this.emit("contactRequest", fromBare);
      return true;
    }
    if (type === "subscribed") { this.emit("subscribed", fromBare); return true; }
    if (type === "unsubscribed") { this.emit("unsubscribed", fromBare); return true; }
    if (type === "unsubscribe") return true;

    let presence: Presence = "online";
    if (type === "unavailable") presence = "offline";
    else {
      const show = pres.getElementsByTagName("show")[0]?.textContent;
      if (show === "away" || show === "xa") presence = "away";
      else if (show === "dnd") presence = "dnd";
    }
    const status = pres.getElementsByTagName("status")[0]?.textContent || undefined;
    this.emit("presence", fromBare, presence, status);
    return true;
  };

  setPresence(p: Presence, statusText?: string) {
    if (p === "offline") {
      this.conn.send($pres({ type: "unavailable" }));
      return;
    }
    const pres = $pres();
    if (p !== "online") pres.c("show").t(p === "away" ? "away" : "dnd").up();
    if (statusText && statusText.trim()) pres.c("status").t(statusText.trim()).up();
    this.conn.send(pres);
  }

  requestSubscribe(jid: string) {
    const to = jid.includes("@") ? bare(jid) : `${jid}@${this.domain}`;
    this.conn.send($pres({ to, type: "subscribe" }));
    return to;
  }

  acceptSubscribe(jid: string) {
    const to = bare(jid);
    this.conn.send($pres({ to, type: "subscribed" }));
    this.conn.send($pres({ to, type: "subscribe" }));
  }

  declineSubscribe(jid: string) {
    this.conn.send($pres({ to: bare(jid), type: "unsubscribed" }));
  }

  setVCard(fn: string, desc?: string, photoDataUrl?: string) {
    const v = $iq({ type: "set" }).c("vCard", { xmlns: "vcard-temp" });
    if (fn) v.c("FN").t(fn).up();
    if (desc) v.c("DESC").t(desc).up();
    if (photoDataUrl) {

      const m = photoDataUrl.match(/^data:([^;,]+);base64,(.+)$/);
      if (m) v.c("PHOTO").c("TYPE").t(m[1]).up().c("BINVAL").t(m[2]).up().up();
    }
    this.conn.sendIQ(v);
  }

  getVCard(jid?: string): Promise<{ fn: string; desc: string; photo?: string }> {
    return new Promise((resolve) => {
      const iq = $iq(jid ? { type: "get", to: bare(jid) } : { type: "get" }).c("vCard", { xmlns: "vcard-temp" });
      this.conn.sendIQ(iq, (res: Element) => {
        const v = res.getElementsByTagName("vCard")[0];

        const photoEl = v?.getElementsByTagName("PHOTO")[0];
        const type = photoEl?.getElementsByTagName("TYPE")[0]?.textContent?.trim() || "image/png";
        const binval = (photoEl?.getElementsByTagName("BINVAL")[0]?.textContent || "").replace(/\s+/g, "");
        resolve({
          fn: v?.getElementsByTagName("FN")[0]?.textContent || "",
          desc: v?.getElementsByTagName("DESC")[0]?.textContent || "",
          ...(binval ? { photo: `data:${type};base64,${binval}` } : {}),
        });
      }, () => resolve({ fn: "", desc: "" }));
    });
  }

  async savePrivate(key: string, data: unknown): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const iq = $iq({ type: "set" })
        .c("query", { xmlns: "jabber:iq:private" })
        .c("hubxdata", { xmlns: `hubx:${key}` })
        .t(JSON.stringify(data));
      this.conn.sendIQ(iq, () => resolve(), () => reject(new Error("private XML storage unavailable (mod_private?)")));
    });
  }

  async loadPrivate<T>(key: string): Promise<T | null> {
    return new Promise<T | null>((resolve, reject) => {
      const iq = $iq({ type: "get" })
        .c("query", { xmlns: "jabber:iq:private" })
        .c("hubxdata", { xmlns: `hubx:${key}` });
      this.conn.sendIQ(iq, (res: Element) => {
        try {
          const text = res.getElementsByTagName("hubxdata")[0]?.textContent || "";
          resolve(text ? (JSON.parse(text) as T) : null);
        } catch { resolve(null); }
      }, () => reject(new Error("private XML storage unavailable (mod_private?)")));
    });
  }

  queryArchive(withJid: string, opts: { max?: number; before?: string } = {}): Promise<{ first: string | null; complete: boolean }> {
    return new Promise((resolve) => {
      const iq = $iq({ type: "set" })
        .c("query", { xmlns: MAM_NS })
        .c("x", { xmlns: "jabber:x:data", type: "submit" })
        .c("field", { var: "FORM_TYPE", type: "hidden" }).c("value").t(MAM_NS).up().up()
        .c("field", { var: "with" }).c("value").t(bare(withJid)).up().up()
        .up()
        .c("set", { xmlns: "http://jabber.org/protocol/rsm" })
        .c("max").t(String(opts.max ?? 50)).up()
        .c("before").t(opts.before ?? "");
      this.conn.sendIQ(iq, (res: Element) => {

        const fin = res.getElementsByTagName("fin")[0];
        resolve({
          first: fin?.getElementsByTagName("first")[0]?.textContent || null,
          complete: fin ? fin.getAttribute("complete") === "true" : true,
        });
      }, () => resolve({ first: null, complete: true }));
    });
  }

  private onMessage = (msg: Element) => {
    const from = msg.getAttribute("from") || "";
    const to = msg.getAttribute("to") || "";

    if (msg.getAttribute("type") === "error") return true;

    const secret = child(msg, "secret", SECRET_NS);
    if (secret) {
      const peer = bare(from);
      const t = secret.getAttribute("t");
      if (t === "init" || t === "ack") {
        try {
          const k = JSON.parse(secret.getElementsByTagName("k")[0]?.textContent || "null");
          const idk = JSON.parse(secret.getElementsByTagName("idk")[0]?.textContent || "null");
          const sig = secret.getElementsByTagName("sig")[0]?.textContent || "";
          if (k && idk && sig) this.emit(t === "init" ? "secretInit" : "secretAck", peer, { k, idk, sig });
        } catch {  }
      } else if (t === "msg") {
        const id = secret.getAttribute("id") || uid();
        const ttl = parseInt(secret.getAttribute("ttl") || "0", 10) || 0;
        const iv = secret.getElementsByTagName("iv")[0]?.textContent || "";
        const ct = secret.getElementsByTagName("c")[0]?.textContent || "";
        if (iv && ct) this.emit("secretMsg", peer, { id, iv, ct, ttl });
      } else if (t === "ttl") {

        this.emit("secretTtl", peer, parseInt(secret.getAttribute("ttl") || "0", 10) || 0);
      }
      return true;
    }

    const mamResult = child(msg, "result", MAM_NS);
    if (mamResult && (!from || bare(from) === this.bareJid)) {
      const fwd = mamResult.getElementsByTagName("forwarded")[0];
      const inner = fwd && fwd.getAttribute("xmlns") === FORWARD_NS ? fwd.getElementsByTagName("message")[0] : undefined;
      const ibody = inner?.getElementsByTagName("body")[0]?.textContent || "";
      if (inner && ibody) {
        const ifrom = inner.getAttribute("from") || "";
        const ito = inner.getAttribute("to") || "";
        let ts = Date.now();
        const delay = fwd!.getElementsByTagName("delay")[0];
        const stamp = delay?.getAttribute("stamp");
        if (stamp) { const t = Date.parse(stamp); if (!isNaN(t)) ts = t; }

        const id = inner.getAttribute("id") || mamResult.getAttribute("id") || stableId(`${ifrom}|${ibody}|${ts}`);
        const outgoing = !!this.bareJid && bare(ifrom) === this.bareJid;
        const conv = outgoing ? bare(ito) : bare(ifrom);
        let oobUrl = "";
        const ixs = inner.getElementsByTagName("x");
        for (let i = 0; i < ixs.length; i++) if (ixs[i].getAttribute("xmlns") === OOB_NS) oobUrl = ixs[i].getElementsByTagName("url")[0]?.textContent || "";
        const trimmed = ibody.trim();
        const bareUrl = /^https?:\/\/\S+$/.test(trimmed) && (IMAGE_EXT.includes(extOf(trimmed)) || AUDIO_EXT.includes(extOf(trimmed)) || MIME_BY_EXT[extOf(trimmed)]) ? trimmed : "";
        const url = httpUrl(oobUrl) || bareUrl;
        const replyEl = inner.getElementsByTagName("reply")[0];
        const isReply = replyEl && replyEl.getAttribute("xmlns") === REPLY_NS;
        const replyId = isReply ? replyEl.getAttribute("id") : null;
        const replyQuote = isReply && replyEl.getAttribute("quote") === "1";
        this.emit("archive", conv, {
          id, from: bare(ifrom), to: bare(ito), body: ibody, ts, outgoing,
          attachment: url ? attachmentFromUrl(url) : undefined,
          reply: replyId ? { id: replyId, author: "", text: replyQuote ? (replyEl!.textContent || "") : "", quote: replyQuote } : undefined,
        });
      }
      return true;
    }

    const xInv = msg.getElementsByTagName("x");
    for (let i = 0; i < xInv.length; i++) {
      if (xInv[i].getAttribute("xmlns") === MUC_USER_NS) {
        const invite = xInv[i].getElementsByTagName("invite")[0];
        if (invite) { this.emit("invited", bare(from), invite.getAttribute("from") || ""); return true; }
      }
    }

    if (msg.getAttribute("type") === "groupchat") {
      const room = bare(from);
      const nick = Strophe.getResourceFromJid(from) || "";
      const bodyEl = msg.getElementsByTagName("body")[0];
      if (bodyEl && bodyEl.textContent && nick) {

        let ts = Date.now();
        const delay = msg.getElementsByTagName("delay")[0];
        const stamp = delay && delay.getAttribute("xmlns") === DELAY_NS ? delay.getAttribute("stamp") : null;
        if (stamp) { const t = Date.parse(stamp); if (!isNaN(t)) ts = t; }
        const mid = msg.getAttribute("id") || stableId(`${from}|${bodyEl.textContent}|${ts}`);
        const grpReply = msg.getElementsByTagName("reply")[0];
        const grpReplyId = grpReply && grpReply.getAttribute("xmlns") === REPLY_NS ? grpReply.getAttribute("id") : null;
        this.emit("groupMessage", room, {
          id: mid, from: nick, to: room, body: bodyEl.textContent, ts,
          outgoing: nick === (this.roomNick.get(room) || this.myNick()),
          delayed: !!stamp,
          reply: grpReplyId ? { id: grpReplyId, author: "", text: "" } : undefined,
        });
      }
      return true;
    }

    const received = child(msg, "received", RECEIPTS_NS);
    if (received) {
      const rid = received.getAttribute("id");
      if (rid) this.emit("receipt", rid, bare(from));
      return true;
    }

    const displayed = child(msg, "displayed", MARKERS_NS);
    if (displayed) {
      const did = displayed.getAttribute("id");
      if (did) this.emit("read", did, bare(from));
      return true;
    }

    if (this.bareJid && bare(from) === this.bareJid) return true;

    const reactionsEl = child(msg, "reactions", REACTIONS_NS);
    if (reactionsEl) {
      const targetId = reactionsEl.getAttribute("id");
      if (targetId) {
        const emojis: string[] = [];
        const kids = reactionsEl.childNodes;
        for (let i = 0; i < kids.length; i++) {
          const c = kids[i] as Element;
          if (c.nodeType === 1 && (c.localName === "reaction" || c.nodeName === "reaction")) {
            const t = (c.textContent || "").trim();
            if (t && !emojis.includes(t)) emojis.push(t);
          }
        }
        const fromBare = bare(from);
        this.emit("reaction", fromBare, targetId, fromBare, emojis);
      }
      return true;
    }

    const retractEl = child(msg, "retract", RETRACT_NS);
    if (retractEl) {
      const rid = retractEl.getAttribute("id");
      if (rid) this.emit("retract", bare(from), rid);
      return true;
    }

    const replaceEl = child(msg, "replace", CORRECT_NS);
    if (replaceEl) {
      const oid = replaceEl.getAttribute("id");
      const newBody = msg.getElementsByTagName("body")[0]?.textContent || "";
      if (oid) this.emit("edit", bare(from), oid, newBody);
      return true;
    }

    const bodyEl = msg.getElementsByTagName("body")[0];

    if (msg.getElementsByTagName("composing")[0])
      this.emit("composing", bare(from), true);
    if (
      msg.getElementsByTagName("paused")[0] ||
      msg.getElementsByTagName("active")[0]
    )
      this.emit("composing", bare(from), false);

    if (bodyEl && bodyEl.textContent) {
      const text = bodyEl.textContent;

      const dl = msg.getElementsByTagName("delay")[0];
      const dStamp = dl && dl.getAttribute("xmlns") === DELAY_NS ? dl.getAttribute("stamp") : null;
      const dTs = dStamp ? Date.parse(dStamp) : NaN;
      const delayed = !!dStamp && !isNaN(dTs);
      const mid = msg.getAttribute("id") || stableId(`${bare(from)}|${text}|${delayed ? dTs : ""}`);

      let oobUrl = "";
      const xs = msg.getElementsByTagName("x");
      for (let i = 0; i < xs.length; i++) {
        if (xs[i].getAttribute("xmlns") === OOB_NS) oobUrl = xs[i].getElementsByTagName("url")[0]?.textContent || "";
      }
      const bare1 = text.trim();
      const bareUrl = /^https?:\/\/\S+$/.test(bare1) && (IMAGE_EXT.includes(extOf(bare1)) || AUDIO_EXT.includes(extOf(bare1)) || MIME_BY_EXT[extOf(bare1)]) ? bare1 : "";
      const url = httpUrl(oobUrl) || bareUrl;
      const attachment = url ? attachmentFromUrl(url) : undefined;
      const replyEl = msg.getElementsByTagName("reply")[0];
      const isReply = replyEl && replyEl.getAttribute("xmlns") === REPLY_NS;
      const replyId = isReply ? replyEl.getAttribute("id") : null;
      const replyQuote = isReply && replyEl.getAttribute("quote") === "1";
      this.emit("composing", bare(from), false);
      this.emit("message", {
        id: mid,
        from: bare(from),
        to: bare(to),
        body: text,
        ts: delayed ? dTs : Date.now(),
        outgoing: false,
        delayed,
        attachment,
        reply: replyId ? { id: replyId, author: "", text: replyQuote ? (replyEl!.textContent || "") : "", quote: replyQuote } : undefined,
      });

      const req = msg.getElementsByTagName("request")[0];
      if (req && req.getAttribute("xmlns") === RECEIPTS_NS && from) {
        this.conn.send($msg({ to: from, type: "chat" }).c("received", { xmlns: RECEIPTS_NS, id: mid }));
      }
    }
    return true;
  };

  sendMessage(toBare: string, body: string, reply?: { id: string; text?: string; quote?: boolean }): ChatMessage {
    const id = uid();
    const stanza = $msg({ to: toBare, type: "chat", id })
      .c("body")
      .t(body)
      .up();
    if (reply?.id) {

      const r = stanza.c("reply", { xmlns: REPLY_NS, id: reply.id, to: toBare, ...(reply.quote ? { quote: "1" } : {}) });
      if (reply.quote && reply.text) r.t(reply.text);
      r.up();
    }
    stanza
      .c("request", { xmlns: RECEIPTS_NS })
      .up()
      .c("markable", { xmlns: MARKERS_NS })
      .up()
      .c("active", { xmlns: "http://jabber.org/protocol/chatstates" });
    this.conn.send(stanza);
    return {
      id,
      from: this.bareJid,
      to: toBare,
      body,
      ts: Date.now(),
      outgoing: true,
      delivered: false,
      read: false,
    };
  }

  sendDisplayed(toBare: string, msgId: string) {
    this.conn.send($msg({ to: toBare, type: "chat" }).c("displayed", { xmlns: MARKERS_NS, id: msgId }));
  }

  editMessage(toBare: string, originalId: string, body: string) {
    this.conn.send(
      $msg({ to: toBare, type: "chat", id: uid() })
        .c("body").t(body).up()
        .c("replace", { xmlns: CORRECT_NS, id: originalId }).up()
        .c("active", { xmlns: "http://jabber.org/protocol/chatstates" })
    );
  }

  retractMessage(toBare: string, originalId: string) {
    this.conn.send($msg({ to: toBare, type: "chat", id: uid() }).c("retract", { xmlns: RETRACT_NS, id: originalId }));
  }

  sendReactions(toBare: string, targetId: string, emojis: string[]) {
    const stanza = $msg({ to: toBare, type: "chat", id: uid() })
      .c("reactions", { xmlns: REACTIONS_NS, id: targetId });
    for (const e of emojis) stanza.c("reaction").t(e).up();
    stanza.up().c("store", { xmlns: HINTS_NS });
    this.conn.send(stanza);
  }

  mucService() { return `conference.${this.domain}`; }
  myNick() { return local(this.bareJid) || "user"; }
  roomJid(room: string) {
    if (room.includes("@")) return bare(room);

    const node = room.trim().toLowerCase().replace(/[\s"&'/:<>@]+/g, "-").replace(/^-+|-+$/g, "") || "room";
    return `${node}@${this.mucService()}`;
  }

  joinRoom(room: string, nick?: string) {
    const jid = this.roomJid(room);
    const n = nick || this.myNick();
    this.roomNick.set(jid, n);
    this.conn.send($pres({ to: `${jid}/${n}` }).c("x", { xmlns: MUC_NS }).c("history", { maxstanzas: "40" }));
    return jid;
  }
  leaveRoom(room: string, nick?: string) {
    const jid = this.roomJid(room);
    this.conn.send($pres({ to: `${jid}/${nick || this.myNick()}`, type: "unavailable" }));
  }
  sendGroupMessage(room: string, body: string, replyId?: string) {
    const jid = this.roomJid(room);
    const stanza = $msg({ to: jid, type: "groupchat", id: uid() }).c("body").t(body).up();
    if (replyId) stanza.c("reply", { xmlns: REPLY_NS, id: replyId, to: jid });
    this.conn.send(stanza);
  }

  setAffiliation(room: string, jid: string, affiliation: "owner" | "admin" | "member" | "none" | "outcast") {
    const iq = $iq({ type: "set", to: this.roomJid(room) })
      .c("query", { xmlns: MUC_ADMIN_NS })
      .c("item", { affiliation, jid });
    this.conn.sendIQ(iq, () => {}, () => {});
  }

  kickOccupant(room: string, nick: string) {
    const iq = $iq({ type: "set", to: this.roomJid(room) })
      .c("query", { xmlns: MUC_ADMIN_NS })
      .c("item", { role: "none", nick });
    this.conn.sendIQ(iq, () => {}, () => {});
  }

  inviteToRoom(room: string, user: string, reason = "Приглашение в группу") {
    const to = user.includes("@") ? bare(user) : `${user}@${this.domain}`;
    this.conn.send(
      $msg({ to: this.roomJid(room) })
        .c("x", { xmlns: MUC_USER_NS })
        .c("invite", { to })
        .c("reason").t(reason)
    );
    return to;
  }

  sendSecretInit(toBare: string, k: any, idk: any, sig: string) {
    this.conn.send($msg({ to: toBare, type: "chat" }).c("secret", { xmlns: SECRET_NS, t: "init" })
      .c("k").t(JSON.stringify(k)).up().c("idk").t(JSON.stringify(idk)).up().c("sig").t(sig));
  }
  sendSecretAck(toBare: string, k: any, idk: any, sig: string) {
    this.conn.send($msg({ to: toBare, type: "chat" }).c("secret", { xmlns: SECRET_NS, t: "ack" })
      .c("k").t(JSON.stringify(k)).up().c("idk").t(JSON.stringify(idk)).up().c("sig").t(sig));
  }
  sendSecretMessage(toBare: string, id: string, iv: string, ct: string, ttl: number) {
    this.conn.send(
      $msg({ to: toBare, type: "chat", id })
        .c("secret", { xmlns: SECRET_NS, t: "msg", id, ttl: String(ttl) })
        .c("iv").t(iv).up()
        .c("c").t(ct)
    );
  }

  sendSecretTtl(toBare: string, ttl: number) {
    this.conn.send($msg({ to: toBare, type: "chat" }).c("secret", { xmlns: SECRET_NS, t: "ttl", ttl: String(ttl) }));
  }

  private uploadService() {
    return `upload.${this.domain}`;
  }

  requestSlot(filename: string, size: number, contentType: string): Promise<{ put: string; get: string; headers: Record<string, string> }> {
    return new Promise((resolve, reject) => {
      const iq = $iq({ type: "get", to: this.uploadService() }).c("request", {
        xmlns: UPLOAD_NS, filename, size: String(size), "content-type": contentType || "application/octet-stream",
      });
      this.conn.sendIQ(
        iq,
        (res: Element) => {
          const slot = res.getElementsByTagName("slot")[0];
          const put = slot?.getElementsByTagName("put")[0];
          const get = slot?.getElementsByTagName("get")[0];
          if (!put || !get) { reject(new Error("Сервер не выдал слот для загрузки")); return; }
          const headers: Record<string, string> = {};
          const hs = put.getElementsByTagName("header");
          for (let i = 0; i < hs.length; i++) {
            const n = hs[i].getAttribute("name");
            if (n) headers[n] = hs[i].textContent || "";
          }
          resolve({ put: put.getAttribute("url") || "", get: get.getAttribute("url") || "", headers });
        },
        (err: Element | null) => {
          const text = err?.getElementsByTagName("text")[0]?.textContent;
          reject(new Error(text || "Загрузка файлов недоступна на этом сервере"));
        },
        20000
      );
    });
  }

  async uploadBytes(blob: Blob, fileName: string, mime = "application/octet-stream"): Promise<string> {
    const slot = await this.requestSlot(fileName, blob.size, mime);
    const res = await fetch(slot.put, { method: "PUT", body: blob, headers: { "Content-Type": mime, ...slot.headers } });
    if (!res.ok) throw new Error(`Не удалось загрузить файл (HTTP ${res.status})`);
    return slot.get;
  }
  async sendFile(toBare: string, file: Blob, fileName: string, opts?: { voice?: boolean; caption?: string }): Promise<ChatMessage> {
    const mime = file.type || MIME_BY_EXT[extOf(fileName)] || "application/octet-stream";
    const slot = await this.requestSlot(fileName, file.size, mime);
    const res = await fetch(slot.put, { method: "PUT", body: file, headers: { "Content-Type": mime, ...slot.headers } });
    if (!res.ok) throw new Error(`Не удалось загрузить файл (HTTP ${res.status})`);
    const url = slot.get;
    const id = uid();

    const caption = (opts?.caption || "").trim();
    const bodyText = caption || url;
    this.conn.send(
      $msg({ to: toBare, type: "chat", id })
        .c("body").t(bodyText).up()
        .c("x", { xmlns: OOB_NS }).c("url").t(url).up().up()
        .c("request", { xmlns: RECEIPTS_NS }).up()
        .c("markable", { xmlns: MARKERS_NS }).up()
        .c("active", { xmlns: "http://jabber.org/protocol/chatstates" })
    );
    return {
      id, from: this.bareJid, to: toBare, body: bodyText, ts: Date.now(),
      outgoing: true, delivered: false, read: false,
      attachment: { url, name: fileName, mime, size: file.size, kind: kindOf(mime, fileName), voice: !!opts?.voice },
    };
  }

  sendComposing(toBare: string, composing: boolean) {
    const stanza = $msg({ to: toBare, type: "chat" }).c(
      composing ? "composing" : "active",
      { xmlns: "http://jabber.org/protocol/chatstates" }
    );
    this.conn.send(stanza);
  }
}
