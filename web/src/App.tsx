import { useEffect, useMemo, useRef, useState } from "react";
import { XmppClient } from "./xmpp";
import { CONFIG } from "./config";
import type { ChatMessage, ConnState, Contact, Occupant, Presence } from "./types";
import { msgPreview } from "./types";
import { Auth } from "./components/Auth";
import { Workspace } from "./components/Workspace";
import { api, clearAdminToken, clearUserToken } from "./api";
import { unlockAudio, playLogin, playMessage } from "./sounds";
import { getNotif, pushMessage, pushOnline, requestPush, enableWebPush, isMutedJid } from "./notify";
import { getPhoto, setPhoto } from "./avatarStore";
import * as e2e from "./crypto/e2e";

const replyLabel = (m: ChatMessage) => msgPreview(m);

function rebuildReactions(
  cur: Record<string, string[]> | undefined,
  who: string,
  emojis: string[]
): Record<string, string[]> | undefined {
  const next: Record<string, string[]> = {};
  for (const [emoji, users] of Object.entries(cur || {})) {
    const rest = users.filter((u) => u !== who);
    if (rest.length) next[emoji] = rest;
  }
  for (const e of emojis) next[e] = [...(next[e] || []), who];
  return Object.keys(next).length ? next : undefined;
}

export function App() {
  const clientRef = useRef<XmppClient | null>(null);
  const credsRef = useRef<{ username: string; password: string; server?: { ws: string; domain: string } } | null>(null);
  const manualLogoutRef = useRef(false);
  const reconnectTimer = useRef<number>();
  const attemptsRef = useRef(0);
  const [reconnecting, setReconnecting] = useState(false);
  const [state, setState] = useState<ConnState>("disconnected");
  const [stateDetail, setStateDetail] = useState<string>();
  const [selfJid, setSelfJid] = useState("");
  const selfJidRef = useRef("");
  const typingTimers = useRef<Record<string, number>>({});
  const secretBlobs = useRef<Map<string, string>>(new Map());

  const [contacts, setContacts] = useState<Contact[]>([]);
  const contactsRef = useRef<Contact[]>([]);
  useEffect(() => { contactsRef.current = contacts; }, [contacts]);
  const connectedAtRef = useRef(0);
  const onlineNotifAt = useRef<Map<string, number>>(new Map());
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
  const [typing, setTyping] = useState<Record<string, boolean>>({});
  const [occupants, setOccupants] = useState<Record<string, Occupant[]>>({});
  const roomsRef = useRef<string[]>([]);

  const secretKeys = useRef<Map<string, CryptoKey>>(new Map());
  const secretPriv = useRef<Map<string, CryptoKey>>(new Map());
  const secretMyPub = useRef<Map<string, JsonWebKey>>(new Map());
  const secretSeen = useRef<Set<string>>(new Set());
  // H1: a secretInit whose identity key changed is held here (not acted on)
  // until the user explicitly confirms via the verify action.
  const pendingSecretInit = useRef<Map<string, { k: JsonWebKey; idk: JsonWebKey; sig: string }>>(new Map());

  // L4: cap an unbounded Set, evicting oldest insertions first.
  const capSet = (s: Set<string>, max: number) => {
    while (s.size > max) { const first = s.values().next().value; if (first === undefined) break; s.delete(first); }
  };
  const [secretState, setSecretState] = useState<Record<string, { established: boolean; ttl: number; fingerprint?: string }>>({});

  const myIdentity = useRef<{ priv: CryptoKey; pub: JsonWebKey } | null>(null);

  const [secretIds, setSecretIds] = useState<Record<string, { idk: JsonWebKey; verified: boolean; changed?: boolean }>>({});
  const secretIdsRef = useRef(secretIds);
  useEffect(() => { secretIdsRef.current = secretIds; }, [secretIds]);
  useEffect(() => { selfJidRef.current = selfJid; }, [selfJid]);

  const [requests, setRequests] = useState<string[]>([]);
  const [subStatus, setSubStatus] = useState<Record<string, "active" | "out" | "in">>({});
  const subRef = useRef<Record<string, "active" | "out" | "in">>({});
  useEffect(() => { subRef.current = subStatus; }, [subStatus]);
  const [myProfile, setMyProfile] = useState<{ fn: string; desc: string }>({ fn: "", desc: "" });

  const photoTried = useRef<Set<string>>(new Set());
  const photoQueue = useRef<string[]>([]);
  const photoPumping = useRef(false);
  const archivedRef = useRef<Set<string>>(new Set());

  const mamCursor = useRef<Record<string, { first: string | null; complete: boolean }>>({});
  const mamLoading = useRef<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);

  const [blocked, setBlocked] = useState<string[]>([]);
  const blockedRef = useRef<string[]>([]);
  useEffect(() => { blockedRef.current = blocked; }, [blocked]);
  useEffect(() => { if (selfJid) try { setBlocked(JSON.parse(localStorage.getItem(`hubx.blocked.${selfJid}`) || "[]")); } catch {  } }, [selfJid]);
  useEffect(() => { if (selfJid) try { localStorage.setItem(`hubx.blocked.${selfJid}`, JSON.stringify(blocked)); } catch {  } }, [blocked, selfJid]);

  const secretJid = (peer: string) => `secret:${peer}`;

  const nameOf = (jid: string) => contactsRef.current.find((c) => c.jid === jid)?.name || jid.split("@")[0];

  const openChatNotif = (jid: string) => window.dispatchEvent(new CustomEvent("hubx:open-chat", { detail: jid }));
  function blockUser(jid: string) {
    const bare = jid.split("/")[0];
    setBlocked((b) => (b.includes(bare) ? b : [...b, bare]));
    try { clientRef.current?.declineSubscribe(bare); } catch {  }
    setTyping((t) => ({ ...t, [bare]: false }));
  }
  function unblockUser(jid: string) {
    const bare = jid.split("/")[0];
    setBlocked((b) => b.filter((x) => x !== bare));
  }

  function prefetchPhotos(jids: string[]) {
    for (const j of jids) {
      if (!j || j.includes("@conference.") || photoTried.current.has(j) || getPhoto(j)) continue;
      photoTried.current.add(j);
      capSet(photoTried.current, 500); // L4: keep photoTried bounded.
      photoQueue.current.push(j);
    }
    if (photoPumping.current) return;
    const pump = () => {
      const jid = photoQueue.current.shift();
      const client = clientRef.current;
      if (!jid || !client) { photoPumping.current = false; return; }
      client.getVCard(jid)
        .then((v) => { if (v.photo) setPhoto(jid, v.photo); })
        .catch(() => {  })
        .finally(() => window.setTimeout(pump, 300));
    };
    photoPumping.current = true;
    pump();
  }

  function savePhoto(dataUrl: string) {
    const jid = clientRef.current?.bareJid || selfJid;
    if (!jid) return;
    setPhoto(jid, dataUrl);

    try { clientRef.current?.setVCard(myProfile.fn || jid.split("@")[0], myProfile.desc, dataUrl); } catch {  }
  }

  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent<string>).detail; if (d) savePhoto(d); };
    window.addEventListener("hubx:save-photo", h);
    return () => window.removeEventListener("hubx:save-photo", h);
  }, [myProfile.fn, myProfile.desc, selfJid]);

  const isAdmin = selfJid === CONFIG.ADMIN_JID;

  const hydratedFor = useRef("");
  useEffect(() => {
    if (!selfJid || hydratedFor.current === selfJid) return;
    hydratedFor.current = selfJid;
    try { setMessages(JSON.parse(localStorage.getItem(`hubx.msgs.${selfJid}`) || "{}")); } catch { setMessages({}); }
    setHydrated(true);
  }, [selfJid]);
  useEffect(() => {
    if (selfJid && hydrated) {

      const persistable = Object.fromEntries(Object.entries(messages).filter(([k]) => !k.startsWith("secret:")));
      try { localStorage.setItem(`hubx.msgs.${selfJid}`, JSON.stringify(persistable)); } catch {  }
    }
  }, [messages, selfJid, hydrated]);

  function upsertContact(jid: string, patch: Partial<Contact>) {
    setContacts((prev) => {
      const i = prev.findIndex((c) => c.jid === jid);
      if (i === -1)
        return [
          ...prev,
          { jid, name: jid.split("@")[0], presence: "offline", ...patch },
        ];
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      return next;
    });
  }

  function login(username: string, password: string, server?: { ws: string; domain: string }) {
    unlockAudio();
    requestPush();
    manualLogoutRef.current = false;
    attemptsRef.current = 0;
    credsRef.current = { username, password, server };
    doConnect(username, password, server, false);
  }

  function doConnect(username: string, password: string, server: { ws: string; domain: string } | undefined, isReconnect: boolean) {
    const srv = server || { ws: CONFIG.WS_URL, domain: CONFIG.DOMAIN };
    // L9: never let ECDH/session key material outlive the account it belongs
    // to. On every fresh (non-reconnect) connect, wipe derived keys, pending
    // ephemerals, seen-ids and revoke any decrypted blob URLs.
    if (!isReconnect) {
      secretKeys.current.clear();
      secretPriv.current.clear();
      secretMyPub.current.clear();
      secretSeen.current.clear();
      secretBlobs.current.forEach((u) => { try { URL.revokeObjectURL(u); } catch {  } });
      secretBlobs.current.clear();
    }
    try { clientRef.current?.disconnect(); } catch {  }
    const client = new XmppClient(srv.ws, srv.domain);
    clientRef.current = client;

    client.on("state", (s, d) => {
      if (client !== clientRef.current) return;
      setState(s);
      setStateDetail(d);
      if (s === "connected") {
        setReconnecting(false);
        attemptsRef.current = 0;
        connectedAtRef.current = Date.now();
        setSelfJid(client.bareJid);
        api.sessionBeacon(client.bareJid);
        enableWebPush(client.bareJid);
        // Per-user session token (proves JID ownership for room invite-link / join).
        { const [u, h] = client.bareJid.split("@"); api.authToken(u, credsRef.current?.password || "", h); }
        playLogin();

        client.getVCard().then((v) => {
          setMyProfile({ fn: v.fn, desc: v.desc });
          if (v.photo) setPhoto(client.bareJid, v.photo);
        }).catch(() => {  });

        (async () => {
          const jid = client.bareJid;
          try {
            // M5: identity private key is persisted as an extractable JWK.
            // TODO(M5): migrate to a non-extractable CryptoKey in IndexedDB
            // (keep only the public JWK here). Mitigated for now by wiping
            // `hubx.id.<jid>` on logout (see logout()).
            const st = JSON.parse(localStorage.getItem(`hubx.id.${jid}`) || "null");
            if (st?.priv && st?.pub) myIdentity.current = { priv: await e2e.importIdentityPriv(st.priv), pub: st.pub };
            else {
              const kp = await e2e.generateIdentity();
              const pub = await e2e.exportJwk(kp.publicKey), priv = await e2e.exportJwk(kp.privateKey);
              myIdentity.current = { priv: kp.privateKey, pub };
              localStorage.setItem(`hubx.id.${jid}`, JSON.stringify({ priv, pub }));
            }
          } catch (e) { console.warn("identity load failed", e); }
          try { setSecretIds(JSON.parse(localStorage.getItem(`hubx.secretid.${jid}`) || "{}")); } catch {  }
        })();

        setSubStatus((m) => ({ ...m, [`${CONFIG.BOT_USER}@${CONFIG.DOMAIN}`]: "active" }));

        try {
          const saved: string[] = JSON.parse(localStorage.getItem(`hubx.rooms.${client.bareJid}`) || "[]");
          roomsRef.current = saved;
          setOccupants({});
          saved.forEach((rj) => { setTimeout(() => { try { client.joinRoom(rj); } catch {  } }, 400); upsertContact(rj, { isRoom: true, name: rj.split("@")[0], presence: "online" }); });
        } catch {  }

        if (srv.domain === CONFIG.DOMAIN) {
          if (client.bareJid !== `${CONFIG.BOT_USER}@${CONFIG.DOMAIN}`) {
            setTimeout(() => { try { client.addContact(CONFIG.BOT_USER); } catch {  } }, 500);
          }
          if (client.bareJid === CONFIG.ADMIN_JID) {
            api.adminLogin(username, password).catch((e) => console.warn("admin token exchange failed:", e.message));
          }
        }
      }
      if (s === "authfail") { setReconnecting(false); manualLogoutRef.current = true; setSelfJid(""); }

      if ((s === "disconnected" || s === "error") && !manualLogoutRef.current && credsRef.current) {
        setSelfJid("");
        setReconnecting(true);
        const delay = Math.min(1000 * 2 ** attemptsRef.current, 8000);
        attemptsRef.current += 1;
        window.clearTimeout(reconnectTimer.current);
        reconnectTimer.current = window.setTimeout(() => {
          const c = credsRef.current; if (c) doConnect(c.username, c.password, c.server, true);
        }, delay);
      }
    });
    client.on("roster", (list) => {
      setContacts((prev) => {
        const map = new Map(prev.map((c) => [c.jid, c]));
        for (const c of list)
          map.set(c.jid, { ...c, presence: map.get(c.jid)?.presence || "offline" });
        return [...map.values()];
      });

      prefetchPhotos(list.map((c) => c.jid));
    });
    client.on("presence", (jid, presence, status) => {

      const prev = contactsRef.current.find((c) => c.jid === jid)?.presence;
      if (presence === "online" && prev && prev !== "online"
          && Date.now() - connectedAtRef.current > 8_000
          && Date.now() - (onlineNotifAt.current.get(jid) || 0) > 300_000
          && !blockedRef.current.includes(jid)) {
        onlineNotifAt.current.set(jid, Date.now());
        pushOnline(nameOf(jid), getPhoto(jid), () => openChatNotif(jid));
      }
      upsertContact(jid, { presence, status });
    });
    client.on("composing", (jid, active) => {
      if (blockedRef.current.includes(jid)) return;
      setTyping((t) => ({ ...t, [jid]: active }));
      window.clearTimeout(typingTimers.current[jid]);

      if (active) typingTimers.current[jid] = window.setTimeout(() => setTyping((t) => ({ ...t, [jid]: false })), 10_000);
    });
    client.on("message", (msg) => {
      if (blockedRef.current.includes(msg.from)) return;
      upsertContact(msg.from, {});
      let added = false;
      setMessages((prev) => {
        const arr = prev[msg.from] || [];
        if (arr.some((m) => m.id === msg.id)) return prev;
        added = true;
        if (msg.reply) {
          const o = arr.find((m) => m.id === msg.reply!.id);
          const author = o ? (o.outgoing ? "Вы" : o.from.split("@")[0]) : msg.reply.author;
          if (msg.reply.quote && msg.reply.text) msg.reply = { id: msg.reply.id, author, text: msg.reply.text, quote: true };
          else if (o) msg.reply = { id: o.id, author, text: replyLabel(o) };
        }
        return { ...prev, [msg.from]: [...arr, msg] };
      });
      setTyping((t) => ({ ...t, [msg.from]: false }));

      if (added && !msg.outgoing && !msg.delayed) {
        if (getNotif().sound && !isMutedJid(msg.from)) playMessage();
        pushMessage({ title: nameOf(msg.from), body: replyLabel(msg), icon: getPhoto(msg.from), jid: msg.from, onClick: () => openChatNotif(msg.from) });
      }
    });
    client.on("receipt", (id, from) => {

      const conv = from;
      setMessages((prev) => {
        const arr = prev[conv]; if (!arr) return prev;
        const i = arr.findIndex((m) => m.id === id && m.outgoing && !m.delivered);
        if (i === -1) return prev;
        const next = [...arr]; next[i] = { ...next[i], delivered: true };
        return { ...prev, [conv]: next };
      });
    });
    client.on("read", (id, from) => {

      const conv = from;
      setMessages((prev) => {
        const arr = prev[conv]; if (!arr) return prev;
        const idx = arr.findIndex((m) => m.id === id && m.outgoing);
        if (idx === -1) return prev;
        const upTo = arr[idx].ts;
        return { ...prev, [conv]: arr.map((m) => (m.outgoing && !m.read && m.ts <= upTo ? { ...m, delivered: true, read: true } : m)) };
      });
    });
    client.on("edit", (peer, id, body) => {

      setMessages((prev) => ({ ...prev, [peer]: (prev[peer] || []).map((m) => (m.id === id ? { ...m, body, edited: true, attachment: undefined } : m)) }));
    });
    client.on("retract", (peer, id) => {

      setMessages((prev) => ({ ...prev, [peer]: (prev[peer] || []).filter((m) => m.id !== id) }));
    });
    client.on("reaction", (peer, targetId, fromBare, emojis) => {

      if (blockedRef.current.includes(fromBare)) return;
      setMessages((prev) => {
        const arr = prev[peer];
        if (!arr) return prev;
        const i = arr.findIndex((m) => m.id === targetId);
        if (i === -1) return prev;
        const next = [...arr];
        next[i] = { ...next[i], reactions: rebuildReactions(next[i].reactions, fromBare, emojis) };
        return { ...prev, [peer]: next };
      });
    });
    client.on("groupMessage", (room, msg) => {
      upsertContact(room, { isRoom: true, name: room.split("@")[0], presence: "online" });
      let added = false;
      setMessages((prev) => {
        const arr = prev[room] || [];
        if (arr.some((m) => m.id === msg.id)) return prev;
        added = true;
        if (msg.reply) {
          const o = arr.find((m) => m.id === msg.reply!.id);
          const author = o ? (o.outgoing ? "Вы" : o.from) : msg.reply.author;
          if (msg.reply.quote && msg.reply.text) msg.reply = { id: msg.reply.id, author, text: msg.reply.text, quote: true };
          else if (o) msg.reply = { id: o.id, author, text: replyLabel(o) };
        }
        return { ...prev, [room]: [...arr, msg] };
      });

      if (added && !msg.outgoing && !msg.delayed) {
        if (getNotif().sound && !isMutedJid(room)) playMessage();
        pushMessage({ title: `# ${room.split("@")[0]}`, body: `${msg.from}: ${replyLabel(msg)}`, jid: room, onClick: () => openChatNotif(room) });
      }
    });
    client.on("occupant", (room, nick, available, affiliation, role, jid) => {
      setOccupants((prev) => {
        const cur = prev[room] || [];
        if (!available) return { ...prev, [room]: cur.filter((o) => o.nick !== nick) };
        const occ: Occupant = { nick, affiliation, role, jid: jid || undefined };
        const i = cur.findIndex((o) => o.nick === nick);
        if (i === -1) return { ...prev, [room]: [...cur, occ] };
        const next = [...cur]; next[i] = { ...next[i], ...occ }; return { ...prev, [room]: next };
      });
    });
    client.on("invited", (room) => {

      if (!roomsRef.current.includes(room)) { roomsRef.current = [...roomsRef.current, room]; persistRooms(); }
      try { client.joinRoom(room); } catch {  }
      upsertContact(room, { isRoom: true, name: room.split("@")[0], presence: "online" });
      if (getNotif().sound) playMessage();
      pushMessage({ title: "Приглашение в группу", body: `# ${room.split("@")[0]}`, onClick: () => openChatNotif(room) });
    });
    client.on("joinError", (room, condition) => {

      roomsRef.current = roomsRef.current.filter((r) => r !== room);
      persistRooms();
      setContacts((prev) => prev.filter((c) => c.jid !== room));
      setOccupants((prev) => { const n = { ...prev }; delete n[room]; return n; });
      const msg = condition === "registration-required" ? "🔒 Группа закрытая — вход только по приглашению или ссылке"
        : condition === "forbidden" ? "Вы заблокированы в этой группе"
        : "Не удалось войти в группу";
      window.dispatchEvent(new CustomEvent("hubx:toast", { detail: msg }));
    });

    client.on("secretInit", async (peer, { k, idk, sig }) => {
      try {
        const id = myIdentity.current; if (!id) return;
        const me = selfJidRef.current;

        if (secretPriv.current.has(peer)) {
          if (me < peer) return;
          secretPriv.current.delete(peer); secretMyPub.current.delete(peer);
        }
        // H2: the signature is over `init|peer|me|x.y`; reject if the embedded
        // sender/recipient JIDs do not match the actual sender and self.
        if (!(await e2e.verifyPub(idk, k, sig, "init", peer, me))) { console.warn("secretInit: bad identity signature from", peer); return; }

        // H1: if we already pinned a DIFFERENT identity key for this peer, do
        // NOT derive a key or send an ack. Hold the init, flag the change for
        // the UI (red warning + "verify"), and wait for explicit confirmation.
        const pinned = secretIdsRef.current[peer];
        if (pinned && JSON.stringify(pinned.idk) !== JSON.stringify(idk)) {
          pendingSecretInit.current.set(peer, { k, idk, sig });
          setSecretIds((m) => { const n = { ...m, [peer]: { idk: pinned.idk, verified: false, changed: true } }; try { localStorage.setItem(`hubx.secretid.${me}`, JSON.stringify(n)); } catch {  } return n; });
          const fp = await e2e.fingerprint(id.pub, idk);
          setSecretState((s) => ({ ...s, [peer]: { established: false, ttl: s[peer]?.ttl || 0, fingerprint: fp } }));
          upsertContact(secretJid(peer), { isSecret: true, secretPeer: peer, name: peer.split("@")[0], presence: "online" });
          if (getNotif().sound) playMessage();
          pushMessage({ title: "🔒 Ключ изменился", body: `Ключ ${nameOf(peer)} изменился — требуется проверка`, icon: getPhoto(peer), onClick: () => openChatNotif(secretJid(peer)) });
          return;
        }

        const kp = await e2e.generateKeyPair();
        const myPub = await e2e.exportJwk(kp.publicKey);
        const key = await e2e.deriveKey(kp.privateKey, await e2e.importPubJwk(k));
        secretKeys.current.set(peer, key);
        client.sendSecretAck(peer, myPub, id.pub, await e2e.signPub(id.priv, myPub, "ack", me, peer));
        pinIdentity(peer, idk);
        const fp = await e2e.fingerprint(id.pub, idk);
        setSecretState((s) => ({ ...s, [peer]: { established: true, ttl: s[peer]?.ttl || 0, fingerprint: fp } }));
        upsertContact(secretJid(peer), { isSecret: true, secretPeer: peer, name: peer.split("@")[0], presence: "online" });
        if (getNotif().sound) playMessage();
        pushMessage({ title: "🔒 Секретный чат", body: `${nameOf(peer)} начал(а) секретный чат`, icon: getPhoto(peer), onClick: () => openChatNotif(secretJid(peer)) });
      } catch (e) { console.warn("secretInit failed", e); }
    });
    client.on("secretAck", async (peer, { k, idk, sig }) => {
      try {
        const myPriv = secretPriv.current.get(peer);
        const id = myIdentity.current;
        if (!myPriv || !id) return;
        const me = selfJidRef.current;
        // H2: the ack signature is over `ack|peer|me|x.y`.
        if (!(await e2e.verifyPub(idk, k, sig, "ack", peer, me))) { console.warn("secretAck: bad identity signature from", peer); return; }

        // H1: a changed identity key on the ack must block the session. Keep
        // the pending ephemeral so the user can resume after verifying.
        const pinned = secretIdsRef.current[peer];
        if (pinned && JSON.stringify(pinned.idk) !== JSON.stringify(idk)) {
          pendingSecretInit.current.set(peer, { k, idk, sig });
          setSecretIds((m) => { const n = { ...m, [peer]: { idk: pinned.idk, verified: false, changed: true } }; try { localStorage.setItem(`hubx.secretid.${me}`, JSON.stringify(n)); } catch {  } return n; });
          const fp = await e2e.fingerprint(id.pub, idk);
          setSecretState((s) => ({ ...s, [peer]: { established: false, ttl: s[peer]?.ttl || 0, fingerprint: fp } }));
          return;
        }

        const key = await e2e.deriveKey(myPriv, await e2e.importPubJwk(k));
        secretKeys.current.set(peer, key);
        secretPriv.current.delete(peer);
        secretMyPub.current.delete(peer);
        pinIdentity(peer, idk);
        const fp = await e2e.fingerprint(id.pub, idk);
        setSecretState((s) => ({ ...s, [peer]: { established: true, ttl: s[peer]?.ttl || 0, fingerprint: fp } }));
      } catch (e) { console.warn("secretAck failed", e); }
    });
    client.on("secretMsg", async (peer, { id, iv, ct, ttl }) => {
      const key = secretKeys.current.get(peer);
      if (!key) return;
      try {

        const plain = await e2e.decrypt(key, iv, ct);
        let body = plain; let attachment: ChatMessage["attachment"]; let realId = id; let realTtl = ttl;
        try { const o = JSON.parse(plain); if (o && typeof o === "object") { body = o.body || ""; attachment = o.att; if (o.id) realId = o.id; if (typeof o.ttl === "number") realTtl = o.ttl; } } catch {  }
        const seenKey = `${peer}:${realId}`;
        if (secretSeen.current.has(seenKey)) return;
        secretSeen.current.add(seenKey);
        capSet(secretSeen.current, 500); // L4: keep secretSeen bounded.

        if (attachment && attachment.fileIv && attachment.url) {
          // M2: never trust the self-reported `size`. Enforce a hard cap from
          // the Content-Length header and again on the actual byteLength,
          // BEFORE decrypting, so a malicious peer can't force an unbounded
          // download/allocation.
          const CAP = 25 * 1024 * 1024;
          if ((attachment.size || 0) > CAP) { attachment = undefined; }
          else try {
            const res = await fetch(attachment.url);
            const cl = parseInt(res.headers.get("content-length") || "", 10);
            if (Number.isFinite(cl) && cl > CAP) throw new Error("secret attachment too large (content-length)");
            const encBuf = await res.arrayBuffer();
            if (encBuf.byteLength > CAP) throw new Error("secret attachment too large (byteLength)");
            const plainBuf = await e2e.decryptBytes(key, attachment.fileIv, encBuf);
            const blobUrl = URL.createObjectURL(new Blob([plainBuf], { type: attachment.mime || "application/octet-stream" }));
            secretBlobs.current.set(realId, blobUrl);
            attachment = { ...attachment, url: blobUrl, fileIv: undefined };
          } catch (err) { console.warn("secret attachment decrypt failed", err); attachment = undefined; }
        }
        const cj = secretJid(peer);
        upsertContact(cj, { isSecret: true, secretPeer: peer, name: peer.split("@")[0], presence: "online" });
        setMessages((prev) => {
          const arr = prev[cj] || [];
          if (arr.some((m) => m.id === realId)) return prev;
          return { ...prev, [cj]: [...arr, { id: realId, from: peer, to: cj, body, ts: Date.now(), outgoing: false, secret: true, attachment }] };
        });
        if (getNotif().sound) playMessage();

        pushMessage({ title: `🔒 ${nameOf(peer)}`, noPreview: true, icon: getPhoto(peer), onClick: () => openChatNotif(cj) });
        if (realTtl > 0) scheduleBurn(cj, realId, realTtl);
      } catch (e) { console.warn("secret decrypt failed (tampered or wrong key)", e); }
    });
    client.on("secretTtl", (peer, ttl) => {

      setSecretState((s) => ({ ...s, [peer]: { ...(s[peer] || { established: true, ttl: 0 }), ttl } }));
    });

    client.on("roster", (items) => {
      setSubStatus((m) => {
        const n = { ...m };
        items.forEach((it) => {
          if (it.subscription === "both" || it.subscription === "to" || it.subscription === "from") n[it.jid] = "active";
          else if (it.ask === "subscribe") n[it.jid] = "out";
        });
        return n;
      });
    });
    client.on("contactRequest", (from) => {
      const st = subRef.current[from];

      const sameDomain = from.split("@")[1] === (selfJidRef.current.split("@")[1] || CONFIG.DOMAIN);
      if ((st === "active" || st === "out") && sameDomain) {
        try { client.acceptSubscribe(from); } catch {  }
        setSubStatus((m) => ({ ...m, [from]: "active" }));
      } else {

        setRequests((r) => (r.includes(from) ? r : [...r, from]));
        setSubStatus((m) => ({ ...m, [from]: "in" }));
        if (getNotif().sound) playMessage();
        pushMessage({ title: "Запрос на чат", body: `${nameOf(from)} хочет начать переписку`, icon: getPhoto(from), onClick: () => { try { window.focus(); } catch {  } } });
      }
    });
    client.on("subscribed", (from) => setSubStatus((m) => ({ ...m, [from]: "active" })));
    client.on("unsubscribed", (from) => {
      setSubStatus((m) => { const n = { ...m }; delete n[from]; return n; });
      setRequests((r) => r.filter((x) => x !== from));
    });

    client.on("archive", (conv, m) => {
      setMessages((prev) => {
        const arr = prev[conv] || [];
        if (arr.some((x) => x.id === m.id)) return prev;
        return { ...prev, [conv]: [...arr, m].sort((a, b) => a.ts - b.ts) };
      });
    });

    client.connect(username, password);
  }

  function logout() {
    manualLogoutRef.current = true;
    credsRef.current = null;
    setReconnecting(false);
    window.clearTimeout(reconnectTimer.current);
    clearAdminToken();
    clearUserToken();
    setHydrated(false);
    const jid = clientRef.current?.bareJid || selfJidRef.current;
    clientRef.current?.disconnect();
    clientRef.current = null;

    // M5: the long-term identity private key is persisted as an EXTRACTABLE
    // JWK in localStorage. At minimum, wipe it (and all secret material) on
    // logout so it does not outlive the session.
    // TODO(M5): store the identity private key as a NON-EXTRACTABLE CryptoKey
    // in IndexedDB and keep only the public JWK in localStorage for the
    // fingerprint. Until then this logout-wipe is the mitigation.
    if (jid) {
      try { localStorage.removeItem(`hubx.id.${jid}`); } catch {  }
      try { localStorage.removeItem(`hubx.secretid.${jid}`); } catch {  }
    }
    pendingSecretInit.current.clear();

    secretKeys.current.clear(); secretPriv.current.clear(); secretMyPub.current.clear(); secretSeen.current.clear();
    archivedRef.current.clear(); roomsRef.current = [];
    mamCursor.current = {}; mamLoading.current.clear();
    photoTried.current.clear(); photoQueue.current = [];
    setSecretState({}); setSecretIds({}); setRequests([]); setSubStatus({}); setOccupants({}); setMyProfile({ fn: "", desc: "" });
    myIdentity.current = null;
    hydratedFor.current = "";
    secretBlobs.current.forEach((u) => { try { URL.revokeObjectURL(u); } catch {  } }); secretBlobs.current.clear();
    Object.values(typingTimers.current).forEach((t) => window.clearTimeout(t)); typingTimers.current = {};
    setContacts([]);
    setMessages({});
    setTyping({});
    setSelfJid("");
    setState("disconnected");
  }

  function sendMessage(to: string, body: string, reply?: { id: string; author: string; text: string; quote?: boolean }) {
    const client = clientRef.current;
    if (!client) return;
    const msg = client.sendMessage(to, body, reply ? { id: reply.id, text: reply.text, quote: reply.quote } : undefined);
    if (reply) msg.reply = reply;
    setMessages((prev) => ({ ...prev, [to]: [...(prev[to] || []), msg] }));
  }

  function addOutgoing(msg: ChatMessage) {
    setMessages((prev) => ({ ...prev, [msg.to]: [...(prev[msg.to] || []), msg] }));
  }

  function editMessage(to: string, id: string, body: string) {
    clientRef.current?.editMessage(to, id, body);
    setMessages((prev) => ({ ...prev, [to]: (prev[to] || []).map((m) => (m.id === id ? { ...m, body, edited: true, attachment: undefined } : m)) }));
  }
  // M3: when a secret message is removed, release its decrypted blob URL and
  // drop its replay-protection entry so nothing lingers in memory.
  function cleanupSecretMsg(convJid: string, id: string) {
    if (!convJid.startsWith("secret:")) return;
    revokeBlob(id);
    secretSeen.current.delete(`${convJid.slice("secret:".length)}:${id}`);
  }
  function retractMessage(to: string, id: string) {
    clientRef.current?.retractMessage(to, id);
    setMessages((prev) => ({ ...prev, [to]: (prev[to] || []).filter((m) => m.id !== id) }));
    cleanupSecretMsg(to, id);
  }
  function deleteLocal(to: string, id: string) {
    setMessages((prev) => ({ ...prev, [to]: (prev[to] || []).filter((m) => m.id !== id) }));
    cleanupSecretMsg(to, id);
  }

  function reactToMessage(chatJid: string, msgId: string, emoji: string) {
    const m = (messages[chatJid] || []).find((x) => x.id === msgId);
    if (!m) return;
    const mine = Object.entries(m.reactions || {})
      .filter(([, users]) => users.includes("me"))
      .map(([e]) => e);
    const next = mine.includes(emoji) ? mine.filter((e) => e !== emoji) : [...mine, emoji];
    setMessages((prev) => {
      const arr = prev[chatJid];
      if (!arr) return prev;
      const i = arr.findIndex((x) => x.id === msgId);
      if (i === -1) return prev;
      const nx = [...arr];
      nx[i] = { ...nx[i], reactions: rebuildReactions(nx[i].reactions, "me", next) };
      return { ...prev, [chatJid]: nx };
    });
    clientRef.current?.sendReactions(chatJid, msgId, next);
  }

  function clearConversation(jid: string) {
    // M3: for secret chats, release every removed message's blob + seen-id.
    if (jid.startsWith("secret:")) {
      const peer = jid.slice("secret:".length);
      for (const m of messages[jid] || []) { revokeBlob(m.id); secretSeen.current.delete(`${peer}:${m.id}`); }
    }
    setMessages((prev) => ({ ...prev, [jid]: [] }));
  }

  useEffect(() => {
    if (!selfJid) return;
    const m = location.hash.match(/#join=([A-Za-z0-9_.-]+)/);
    if (!m) return;
    history.replaceState(null, "", location.pathname + location.search);
    api.roomJoin(m[1], selfJid).then((room) => {
      if (room) {
        joinRoom(room.split("@")[0]);
        window.dispatchEvent(new CustomEvent("hubx:toast", { detail: "Вы вступили в группу" }));
        window.dispatchEvent(new CustomEvent("hubx:open-chat", { detail: room }));
      } else {
        window.dispatchEvent(new CustomEvent("hubx:toast", { detail: "Ссылка-приглашение недействительна или истекла" }));
      }
    });
  }, [selfJid]);

  function persistRooms() {
    const jid = clientRef.current?.bareJid; if (!jid) return;
    try { localStorage.setItem(`hubx.rooms.${jid}`, JSON.stringify(roomsRef.current)); } catch {  }
  }
  function joinRoom(name: string) {
    const client = clientRef.current; if (!client) return "";
    const jid = client.joinRoom(name);
    if (!roomsRef.current.includes(jid)) { roomsRef.current = [...roomsRef.current, jid]; persistRooms(); }
    upsertContact(jid, { isRoom: true, name: name.replace(/@.*/, "").replace(/[^a-zа-я0-9._\- ]/gi, "-"), presence: "online" });
    return jid;
  }
  function sendGroup(room: string, body: string, reply?: { id: string; author: string; text: string }) { clientRef.current?.sendGroupMessage(room, body, reply?.id); }
  function setRoomAffiliation(room: string, jid: string, aff: "owner" | "member" | "outcast") { clientRef.current?.setAffiliation(room, jid, aff); }
  function inviteToRoom(room: string, user: string) { return clientRef.current?.inviteToRoom(room, user); }

  function revokeBlob(id: string) {
    const u = secretBlobs.current.get(id);
    if (u) { try { URL.revokeObjectURL(u); } catch {  } secretBlobs.current.delete(id); }
  }
  function scheduleBurn(convJid: string, id: string, ttl: number) {
    if (!ttl) return;
    window.setTimeout(() => {
      setMessages((prev) => ({ ...prev, [convJid]: (prev[convJid] || []).filter((m) => m.id !== id) }));
      revokeBlob(id);
    }, ttl * 1000);
  }

  function pinIdentity(peer: string, idk: JsonWebKey) {
    const prev = secretIdsRef.current[peer];
    if (prev && JSON.stringify(prev.idk) === JSON.stringify(idk)) return;
    const changed = !!prev;
    setSecretIds((m) => { const n = { ...m, [peer]: { idk, verified: false, changed } }; try { localStorage.setItem(`hubx.secretid.${selfJidRef.current}`, JSON.stringify(n)); } catch {  } return n; });
  }
  async function verifySecret(convJid: string) {
    const peer = convJid.slice("secret:".length);
    // H1: a held handshake (key change that we refused to act on) is only
    // completed here, after the user explicitly confirms the new key. We
    // re-pin the new identity key, derive the shared key, and (for an init)
    // send the ack — exactly the steps the handlers deliberately skipped.
    const pending = pendingSecretInit.current.get(peer);
    if (pending) {
      pendingSecretInit.current.delete(peer);
      const id = myIdentity.current; const client = clientRef.current; const me = selfJidRef.current;
      if (id && client) {
        try {
          const myPriv = secretPriv.current.get(peer);
          if (myPriv) {
            // We initiated: this was a held ack. Derive with our ephemeral.
            const key = await e2e.deriveKey(myPriv, await e2e.importPubJwk(pending.k));
            secretKeys.current.set(peer, key);
            secretPriv.current.delete(peer);
            secretMyPub.current.delete(peer);
          } else {
            // Peer initiated: this was a held init. Derive + send ack now.
            const kp = await e2e.generateKeyPair();
            const myPub = await e2e.exportJwk(kp.publicKey);
            const key = await e2e.deriveKey(kp.privateKey, await e2e.importPubJwk(pending.k));
            secretKeys.current.set(peer, key);
            client.sendSecretAck(peer, myPub, id.pub, await e2e.signPub(id.priv, myPub, "ack", me, peer));
          }
          const fp = await e2e.fingerprint(id.pub, pending.idk);
          setSecretState((s) => ({ ...s, [peer]: { established: true, ttl: s[peer]?.ttl || 0, fingerprint: fp } }));
        } catch (e) { console.warn("verifySecret: resume handshake failed", e); }
      }
      // Re-pin the new (now user-confirmed) identity key as verified.
      setSecretIds((m) => { const n = { ...m, [peer]: { idk: pending.idk, verified: true, changed: false } }; try { localStorage.setItem(`hubx.secretid.${selfJidRef.current}`, JSON.stringify(n)); } catch {  } return n; });
      return;
    }
    setSecretIds((m) => { const e = m[peer]; if (!e) return m; const n = { ...m, [peer]: { ...e, verified: true, changed: false } }; try { localStorage.setItem(`hubx.secretid.${selfJidRef.current}`, JSON.stringify(n)); } catch {  } return n; });
  }
  async function startSecretChat(userOrJid: string): Promise<string> {
    const client = clientRef.current; const id = myIdentity.current; if (!client || !id) return "";
    const dom = selfJid.split("@")[1] || CONFIG.DOMAIN;
    const peer = userOrJid.includes("@") ? userOrJid.toLowerCase() : `${userOrJid.toLowerCase()}@${dom}`;
    try {
      const kp = await e2e.generateKeyPair();
      const myPub = await e2e.exportJwk(kp.publicKey);
      secretPriv.current.set(peer, kp.privateKey);
      secretMyPub.current.set(peer, myPub);
      // H2: bind the init signature to direction + JIDs (init|me|peer|x.y).
      client.sendSecretInit(peer, myPub, id.pub, await e2e.signPub(id.priv, myPub, "init", selfJid, peer));
      setSecretState((s) => ({ ...s, [peer]: { established: false, ttl: s[peer]?.ttl || 0 } }));
      upsertContact(secretJid(peer), { isSecret: true, secretPeer: peer, name: peer.split("@")[0], presence: "online" });
    } catch (e) { console.warn("startSecretChat failed", e); }
    return secretJid(peer);
  }
  async function sendSecret(convJid: string, body: string, attachment?: ChatMessage["attachment"]) {
    const client = clientRef.current; if (!client) return;
    const peer = convJid.slice("secret:".length);
    const key = secretKeys.current.get(peer);
    if (!key) return;
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const ttl = secretState[peer]?.ttl || 0;

    const { iv, ct } = await e2e.encrypt(key, JSON.stringify({ body, att: attachment, id, ttl }));
    secretSeen.current.add(`${peer}:${id}`);
    client.sendSecretMessage(peer, id, iv, ct, ttl);
    setMessages((prev) => ({ ...prev, [convJid]: [...(prev[convJid] || []), { id, from: selfJid, to: convJid, body, ts: Date.now(), outgoing: true, secret: true, attachment }] }));
    if (ttl > 0) scheduleBurn(convJid, id, ttl);
  }
  async function sendSecretFile(convJid: string, file: Blob, fileName: string, caption?: string) {
    const client = clientRef.current; if (!client) return;
    const peer = convJid.slice("secret:".length);
    const key = secretKeys.current.get(peer);
    if (!key) return;
    try {

      const enc = await e2e.encryptBytes(key, await file.arrayBuffer());
      const url = await client.uploadBytes(enc.data, Math.random().toString(36).slice(2) + ".enc");
      const mime = file.type || "";
      const kind = (/^image\//.test(mime) || /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(fileName) ? "image"
        : /^audio\//.test(mime) || /\.(mp3|ogg|wav|webm|m4a|aac)$/i.test(fileName) ? "audio" : "file") as "image" | "audio" | "file";
      const att = { url, fileIv: enc.iv, name: fileName, mime, size: file.size, kind, voice: kind === "audio" && /(^|\/)voice-/.test(fileName) };
      const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      const ttl = secretState[peer]?.ttl || 0;
      const { iv, ct } = await e2e.encrypt(key, JSON.stringify({ body: (caption || "").trim(), att, id, ttl }));
      secretSeen.current.add(`${peer}:${id}`);
      client.sendSecretMessage(peer, id, iv, ct, ttl);

      const localUrl = URL.createObjectURL(file);
      secretBlobs.current.set(id, localUrl);
      const localAtt = { ...att, url: localUrl, fileIv: undefined };
      setMessages((prev) => ({ ...prev, [convJid]: [...(prev[convJid] || []), { id, from: selfJid, to: convJid, body: (caption || "").trim(), ts: Date.now(), outgoing: true, secret: true, attachment: localAtt }] }));
      if (ttl > 0) scheduleBurn(convJid, id, ttl);
    } catch (e) { console.warn("sendSecretFile failed", e); }
  }
  function setSecretTtl(convJid: string, ttl: number) {
    const peer = convJid.slice("secret:".length);
    setSecretState((s) => ({ ...s, [peer]: { ...(s[peer] || { established: false, ttl: 0 }), ttl } }));
    try { clientRef.current?.sendSecretTtl(peer, ttl); } catch {  }
  }
  function leaveSecret(convJid: string) {
    const peer = convJid.slice("secret:".length);
    secretKeys.current.delete(peer); secretPriv.current.delete(peer);
    setMessages((prev) => { const n = { ...prev }; delete n[convJid]; return n; });
    setContacts((prev) => prev.filter((c) => c.jid !== convJid));
    setSecretState((s) => { const n = { ...s }; delete n[peer]; return n; });
  }
  function leaveRoom(jid: string) {
    clientRef.current?.leaveRoom(jid);
    roomsRef.current = roomsRef.current.filter((r) => r !== jid); persistRooms();
    setContacts((prev) => prev.filter((c) => c.jid !== jid));
    setMessages((prev) => { const n = { ...prev }; delete n[jid]; return n; });
    setOccupants((prev) => { const n = { ...prev }; delete n[jid]; return n; });
  }

  function startChat(username: string) {
    const client = clientRef.current;
    if (!client) return "";
    const jid = client.addContact(username);
    upsertContact(jid, {});

    setSubStatus((m) => (m[jid] === "active" ? m : { ...m, [jid]: "out" }));
    return jid;
  }
  function acceptRequest(jid: string) {
    clientRef.current?.acceptSubscribe(jid);
    setSubStatus((m) => ({ ...m, [jid]: "active" }));
    setRequests((r) => r.filter((x) => x !== jid));
    upsertContact(jid, { name: jid.split("@")[0], presence: "online" });
  }
  function declineRequest(jid: string) {
    clientRef.current?.declineSubscribe(jid);
    setSubStatus((m) => { const n = { ...m }; delete n[jid]; return n; });
    setRequests((r) => r.filter((x) => x !== jid));
  }
  function saveProfile(fn: string) {

    clientRef.current?.setVCard(fn, myProfile.desc, getPhoto(selfJid));
    setMyProfile((p) => ({ ...p, fn }));
  }

  function resolveVCard(jid: string) {
    if (!jid || jid.includes(":") || jid.startsWith("#")) return;
    clientRef.current?.getVCard(jid).then((v) => {
      if (v.fn) upsertContact(jid, { name: v.fn });
      if (v.photo && v.photo !== getPhoto(jid)) setPhoto(jid, v.photo);
    }).catch(() => {  });
    if (!archivedRef.current.has(jid)) {
      archivedRef.current.add(jid);

      clientRef.current?.queryArchive(jid, { max: 50 }).then((cur) => { mamCursor.current[jid] = cur; });
    }
  }

  async function loadOlder(jid: string): Promise<boolean> {
    const cur = mamCursor.current[jid];
    if (!cur || cur.complete || !cur.first || mamLoading.current.has(jid)) return false;
    mamLoading.current.add(jid);
    try {
      const next = await clientRef.current!.queryArchive(jid, { max: 50, before: cur.first });
      // L3: if the server returns no new cursor (null) or the same `first` as
      // before, there is no more history — mark complete to stop paging and
      // avoid a stall/infinite loop.
      const terminal = next.complete || next.first == null || next.first === cur.first;
      mamCursor.current[jid] = { first: next.first ?? cur.first, complete: terminal };
      return !terminal;
    } catch {
      return false;
    } finally {
      mamLoading.current.delete(jid);
    }
  }

  useEffect(() => {
    const h = () => clientRef.current?.disconnect();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest("textarea, input, [contenteditable='true']")) return;
      const sel = window.getSelection?.();
      if (sel && !sel.isCollapsed && String(sel).trim()) return;
      e.preventDefault();
    };
    document.addEventListener("contextmenu", h);
    return () => document.removeEventListener("contextmenu", h);
  }, []);

  if (state !== "connected") {
    return (
      <Auth
        state={state}
        detail={stateDetail}
        reconnecting={reconnecting}
        onLogin={login}
      />
    );
  }

  return (
    <Workspace
      client={clientRef.current!}
      selfJid={selfJid}
      isAdmin={isAdmin}
      hydrated={hydrated}
      contacts={contacts}
      messages={messages}
      typing={typing}
      onSend={sendMessage}
      onAttach={addOutgoing}
      onEdit={editMessage}
      onRetract={retractMessage}
      onDeleteLocal={deleteLocal}
      onReact={reactToMessage}
      onClearConversation={clearConversation}
      blocked={blocked}
      onBlock={blockUser}
      onUnblock={unblockUser}
      occupants={occupants}
      onJoinRoom={joinRoom}
      onSendGroup={sendGroup}
      onLeaveRoom={leaveRoom}
      onSetAffiliation={setRoomAffiliation}
      onInviteToRoom={inviteToRoom}
      secretState={secretState}
      secretIds={secretIds}
      onVerifySecret={verifySecret}
      onStartSecret={startSecretChat}
      onSendSecret={sendSecret}
      onSendSecretFile={sendSecretFile}
      onSetSecretTtl={setSecretTtl}
      onLeaveSecret={leaveSecret}
      requests={requests}
      subStatus={subStatus}
      onAcceptRequest={acceptRequest}
      onDeclineRequest={declineRequest}
      displayName={myProfile.fn}
      onSaveProfile={saveProfile}
      onResolveVCard={resolveVCard}
      onLoadOlder={loadOlder}
      onStartChat={startChat}
      onSetPresence={(p: Presence, msg?: string) => clientRef.current?.setPresence(p, msg)}
      onLogout={logout}
    />
  );
}
