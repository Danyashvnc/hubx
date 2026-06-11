import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { ChatMessage, Contact, Occupant, Presence } from "../types";
import { msgPreview } from "../types";

type Reply = { id: string; author: string; text: string };
import type { XmppClient } from "../xmpp";
import { NavRail, type Section } from "./NavRail";
import { ChatList, type Conversation } from "./ChatList";
import { ChatThread } from "./ChatThread";
import { InfoPanel } from "./InfoPanel";
import { Home } from "./Home";
import { AdminPanel } from "./AdminPanel";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { CONFIG } from "../config";
import { api } from "../api";
import { useMediaQuery } from "../hooks";
import { useNotif, setNotif, setMyPresence, getPushPermission, requestPush, setMutedJids } from "../notify";
import { UserGroupIcon, Cancel01Icon, Crown03Icon, Shield01Icon } from "@hugeicons/core-free-icons";

export const WALLPAPERS = [
  { id: "aurora", label: "Аврора" },
  { id: "mesh", label: "Mesh синий" },
  { id: "graphite", label: "Графит" },
  { id: "sunset", label: "Закат" },
  { id: "forest", label: "Лес" },
  { id: "solid", label: "Сплошной" },
  { id: "none", label: "Без фона" },
];

const SAVED = "__saved__";
const savedContact: Contact = { jid: SAVED, name: "Сохранённые сообщения", presence: "online" };
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

export function Workspace(props: {
  client: XmppClient; selfJid: string; isAdmin: boolean; hydrated: boolean;
  contacts: Contact[]; messages: Record<string, ChatMessage[]>; typing: Record<string, boolean>;
  onSend: (to: string, body: string, reply?: Reply) => void; onStartChat: (username: string) => string;
  onAttach: (msg: ChatMessage) => void;
  onEdit: (to: string, id: string, body: string) => void;
  onRetract: (to: string, id: string) => void;
  onDeleteLocal: (to: string, id: string) => void;
  onReact: (chatJid: string, msgId: string, emoji: string) => void;
  onClearConversation: (jid: string) => void;
  blocked: string[];
  onBlock: (jid: string) => void;
  onUnblock: (jid: string) => void;
  occupants: Record<string, Occupant[]>;
  onJoinRoom: (name: string) => string;
  onSendGroup: (room: string, body: string, reply?: Reply) => void;
  onLeaveRoom: (jid: string) => void;
  onSetAffiliation: (room: string, jid: string, aff: "owner" | "member" | "outcast") => void;
  onInviteToRoom: (room: string, user: string) => void;
  secretState: Record<string, { established: boolean; ttl: number; fingerprint?: string }>;
  secretIds: Record<string, { idk: any; verified: boolean; changed?: boolean }>;
  onVerifySecret: (convJid: string) => void;
  onStartSecret: (user: string) => Promise<string>;
  onSendSecret: (convJid: string, body: string) => void;
  onSendSecretFile: (convJid: string, file: Blob, fileName: string, caption?: string) => void;
  onSetSecretTtl: (convJid: string, ttl: number) => void;
  onLeaveSecret: (convJid: string) => void;
  requests: string[];
  subStatus: Record<string, "active" | "out" | "in">;
  onAcceptRequest: (jid: string) => void;
  onDeclineRequest: (jid: string) => void;
  displayName: string;
  onSaveProfile: (fn: string) => void;
  onResolveVCard: (jid: string) => void;
  onLoadOlder: (jid: string) => Promise<boolean>;
  onSetPresence: (p: Presence, msg?: string) => void; onLogout: () => void;
}) {
  const { client, selfJid, isAdmin, hydrated, contacts, messages, typing, onSend, onAttach, onEdit, onRetract, onDeleteLocal, onReact, onClearConversation, blocked, onBlock, onUnblock, occupants, onJoinRoom, onSendGroup, onLeaveRoom, onSetAffiliation, onInviteToRoom, secretState, secretIds, onVerifySecret, onStartSecret, onSendSecret, onSendSecretFile, onSetSecretTtl, onLeaveSecret, requests, subStatus, onAcceptRequest, onDeclineRequest, displayName, onSaveProfile, onResolveVCard, onLoadOlder, onStartChat, onSetPresence, onLogout } = props;

  const [section, setSection] = useState<Section>("home");
  const [activeJid, setActiveJid] = useState("");
  const [tab, setTab] = useState<"all" | "unread" | "fav">("all");
  const [search, setSearch] = useState("");
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [dirResults, setDirResults] = useState<{ username: string; jid: string; online: boolean }[]>([]);
  const contactsRef = useRef<Contact[]>(contacts);
  useEffect(() => { contactsRef.current = contacts; }, [contacts]);

  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) { setDirResults([]); return; }
    const host = selfJid.split("@")[1] || "";
    let cancelled = false;
    const t = setTimeout(async () => {
      const users = await api.searchUsers(q, host || undefined);
      if (cancelled) return;
      const known = new Set(contactsRef.current.map((c) => c.jid));
      setDirResults(users.filter((u) => u.jid !== selfJid && !known.has(u.jid)));
    }, 280);
    return () => { cancelled = true; clearTimeout(t); };
  }, [search, selfJid]);

  function openFromDirectory(username: string) {
    const jid = onStartChat(username);
    setSearch(""); setDirResults([]); openChat(jid);
  }
  const [presence, setPresence] = useState<Presence>("online");
  const [statusMsg, setStatusMsg] = useState("");
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});
  const [muted, setMuted] = useState<Record<string, boolean>>({});
  const [archived, setArchived] = useState<Record<string, boolean>>({});
  const [pinned, setPinned] = useState<Record<string, string[]>>({});

  const [infoOpen, setInfoOpen] = useState(() => typeof window === "undefined" || !window.matchMedia("(max-width: 1180px)").matches);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [wallpaper, setWallpaper] = useState<string>(() => localStorage.getItem("hubx.wall") || "aurora");
  const [toast, setToast] = useState<string>();
  const [saved, setSaved] = useState<ChatMessage[]>([]);
  const [forwarding, setForwarding] = useState<ChatMessage | null>(null);
  const [forwardingMany, setForwardingMany] = useState<ChatMessage[] | null>(null);
  const [pendingForward, setPendingForward] = useState<{ targetJid: string; msgs: ChatMessage[] } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const seen = useRef<Record<string, number>>({});
  const toastTimer = useRef<number>();

  const prefsLoaded = useRef(false);
  const prefsSaveTimer = useRef<number>();
  const prefsWarned = useRef(false);
  const mobile = useMediaQuery("(max-width: 700px)");
  const narrow = useMediaQuery("(max-width: 1180px)");

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { document.documentElement.dataset.wall = wallpaper; localStorage.setItem("hubx.wall", wallpaper); }, [wallpaper]);

  useEffect(() => {
    if (!selfJid) return;
    try { setSaved(JSON.parse(localStorage.getItem(`hubx.saved.${selfJid}`) || "[]")); } catch { setSaved([]); }
  }, [selfJid]);
  useEffect(() => {
    if (selfJid) try { localStorage.setItem(`hubx.saved.${selfJid}`, JSON.stringify(saved)); } catch {  }
  }, [saved, selfJid]);

  function warnPrefsSync(e: unknown) {
    if (prefsWarned.current) return;
    prefsWarned.current = true;
    console.warn("HubX: prefs sync via XEP-0049 unavailable — falling back to localStorage only", e);
  }

  useEffect(() => {
    if (!selfJid) return;
    prefsLoaded.current = false;
    try {
      const s = JSON.parse(localStorage.getItem(`hubx.prefs.${selfJid}`) || "{}");
      setFavorites(s.favorites || {}); setMuted(s.muted || {}); setArchived(s.archived || {});

      setPinned(Object.fromEntries(Object.entries(s.pinned || {}).map(([k, v]) => [k, Array.isArray(v) ? v : [v]])));
    } catch {  }

    let cancelled = false;
    type Prefs = { favorites?: Record<string, boolean>; muted?: Record<string, boolean>; archived?: Record<string, boolean>; pinned?: Record<string, string | string[]> };
    client.loadPrivate<Prefs>("prefs")
      .then((remote) => {
        if (cancelled || !remote || typeof remote !== "object") return;
        setFavorites(remote.favorites || {});
        setMuted(remote.muted || {});
        setArchived(remote.archived || {});
        setPinned(Object.fromEntries(Object.entries(remote.pinned || {}).map(([k, v]) => [k, Array.isArray(v) ? v : [v]])));
      })
      .catch(warnPrefsSync)
      .finally(() => { if (!cancelled) prefsLoaded.current = true; });
    return () => { cancelled = true; };

  }, [selfJid]);
  useEffect(() => {
    if (!selfJid) return;
    try { localStorage.setItem(`hubx.prefs.${selfJid}`, JSON.stringify({ favorites, muted, archived, pinned })); } catch {  }

    if (!prefsLoaded.current) return;
    window.clearTimeout(prefsSaveTimer.current);
    prefsSaveTimer.current = window.setTimeout(() => {
      client.savePrivate("prefs", { favorites, muted, archived, pinned }).catch(warnPrefsSync);
    }, 1500);
    // L8: flush the pending remote save on account switch / unmount so it isn't lost.
    return () => {
      window.clearTimeout(prefsSaveTimer.current);
      if (prefsLoaded.current) client.savePrivate("prefs", { favorites, muted, archived, pinned }).catch(() => {  });
    };
  }, [favorites, muted, archived, pinned, selfJid]);

  // M4: mirror muted chats into notify so sound + desktop push respect per-chat mute.
  useEffect(() => { setMutedJids(Object.keys(muted).filter((j) => muted[j])); }, [muted]);

  useEffect(() => {
    if (!hydrated) return;
    const s: Record<string, number> = {};
    for (const j in messages) s[j] = messages[j].length;
    seen.current = s;

  }, [hydrated]);

  useEffect(() => {

    const incs: Record<string, number> = {};
    const unarchive: string[] = [];
    for (const jid in messages) {
      const arr = messages[jid];
      const n = seen.current[jid] || 0;
      if (arr.length > n) {
        const fresh = arr.slice(n);
        if (jid !== activeJid) {
          const inc = fresh.filter((m) => !m.outgoing).length;
          if (inc) incs[jid] = inc;
          if (fresh.some((m) => !m.outgoing)) unarchive.push(jid);
        }
        seen.current[jid] = arr.length;
      }
    }
    if (Object.keys(incs).length)
      setUnread((prev) => { const next = { ...prev }; for (const j in incs) next[j] = (next[j] || 0) + incs[j]; return next; });
    if (unarchive.length) setArchived((a) => {
      let changed = false; const nx = { ...a };
      for (const j of unarchive) if (a[j]) { delete nx[j]; changed = true; }
      return changed ? nx : a;
    });
  }, [messages, activeJid]);

  useEffect(() => {
    const total = Object.entries(unread).reduce((a, [j, n]) => a + (muted[j] ? 0 : n), 0);
    document.title = total > 0 ? `(${total}) ${CONFIG.BRAND}` : CONFIG.BRAND;
  }, [unread, muted]);

  const active = activeJid === SAVED ? savedContact : contacts.find((c) => c.jid === activeJid);
  const thread = activeJid === SAVED ? saved : activeJid ? messages[activeJid] || [] : [];

  function showToast(m: string) {
    setToast(m); window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(undefined), 3200);
  }

  useEffect(() => {
    const h = (e: Event) => { const jid = (e as CustomEvent).detail as string; if (jid) openChat(jid); };
    window.addEventListener("hubx:open-chat", h);
    return () => window.removeEventListener("hubx:open-chat", h);
  });

  useEffect(() => {
    const h = (e: Event) => { const m = (e as CustomEvent).detail as string; if (m) showToast(m); };
    window.addEventListener("hubx:toast", h);
    return () => window.removeEventListener("hubx:toast", h);
  });
  function openChat(jid: string) {
    setActiveJid(jid);
    setPendingForward((pf) => (pf && pf.targetJid !== jid ? null : pf));
    if (narrow) setInfoOpen(false);
    if (jid !== SAVED) { seen.current[jid] = (messages[jid] || []).length; setUnread((u) => ({ ...u, [jid]: 0 })); }

    const c = contacts.find((x) => x.jid === jid);
    if (c && !c.isRoom && !c.isSecret && jid !== SAVED) onResolveVCard(jid);
  }
  function openChatWith(jid: string) {
    if (!contacts.some((c) => c.jid === jid)) onStartChat(jid.split("@")[0]);
    openChat(jid); setSection("home");
  }
  function newChat() { setActiveJid(""); setSection("home"); setTimeout(() => searchRef.current?.focus(), 60); }

  async function ensureExists(name: string): Promise<boolean> {
    const u = name.includes("@") ? name.split("@")[0] : name;
    const host = name.includes("@") ? name.split("@")[1] : (selfJid.split("@")[1] || "");
    const ok = await api.userExists(u, host || undefined);
    if (!ok) showToast(`Пользователя «${name}» не существует`);
    return ok;
  }
  async function handleNewChatEnter() {
    const n = search.trim(); if (!n) return;
    if (!(await ensureExists(n))) return;
    const jid = onStartChat(n); setSearch(""); openChat(jid);
  }
  function handleSend(jid: string, body: string, reply?: Reply) {
    if (jid === SAVED) {
      setSaved((s) => [...s, { id: uid(), from: selfJid, to: SAVED, body, ts: Date.now(), outgoing: true, reply }]);
    } else if (jid.startsWith("secret:")) {
      onSendSecret(jid, body);
    } else if (contacts.find((c) => c.jid === jid)?.isRoom) {
      onSendGroup(jid, body, reply);
    } else if (subStatus[jid] === "out" || subStatus[jid] === "in") {
      showToast("Чат начнётся после подтверждения запроса.");
    } else onSend(jid, body, reply);
  }
  function createRoom(name: string) {
    const jid = onJoinRoom(name);
    if (jid) { setSection("home"); openChat(jid); }
  }

  async function joinByLink(link: string) {
    const m = link.match(/join=([A-Za-z0-9_.-]+)/) || link.match(/^([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/);
    if (!m) { showToast("Это не похоже на ссылку-приглашение"); return; }
    const room = await api.roomJoin(m[1], selfJid);
    if (room) { const jid = onJoinRoom(room.split("@")[0]); setSection("home"); if (jid) openChat(jid); showToast("Вы вступили в группу"); }
    else showToast("Ссылка недействительна или истекла");
  }
  async function createSecret(name: string) {
    if (!(await ensureExists(name))) return;
    const jid = await onStartSecret(name);
    if (jid) { setSection("home"); openChat(jid); showToast("Секретный чат — устанавливаем шифрование…"); }
  }
  function handleEdit(jid: string, id: string, body: string) {
    if (jid === SAVED) setSaved((s) => s.map((m) => (m.id === id ? { ...m, body, edited: true } : m)));
    else onEdit(jid, id, body);
  }
  function handleRetract(jid: string, id: string) {
    if (jid === SAVED) setSaved((s) => s.filter((m) => m.id !== id));
    else onRetract(jid, id);
  }
  function handleDeleteLocal(jid: string, id: string) {
    if (jid === SAVED) setSaved((s) => s.filter((m) => m.id !== id));
    else onDeleteLocal(jid, id);
  }

  function forwardOne(m: ChatMessage, targetJid: string) {
    const att = m.attachment?.url ? m.attachment : undefined;
    const body = att ? att.url : "↪ Переслано:\n" + m.body;
    if (targetJid === SAVED) {
      setSaved((s) => [...s, { id: uid(), from: selfJid, to: SAVED, body, ts: Date.now(), outgoing: true, ...(att ? { attachment: att } : {}) }]);
    } else if (contacts.find((c) => c.jid === targetJid)?.isRoom) {
      onSendGroup(targetJid, body);
    } else {
      onSend(targetJid, body);
    }
  }

  function handleForwardTo(targetJid: string) {
    const msgs = forwardingMany ?? (forwarding ? [forwarding] : []);
    if (!msgs.length) return;
    setForwarding(null);
    setForwardingMany(null);
    setPendingForward({ targetJid, msgs });
    openChat(targetJid);
  }

  function handleConfirmForward(text: string) {
    if (!pendingForward) return;
    const { targetJid, msgs } = pendingForward;
    for (const m of msgs) forwardOne(m, targetJid);
    const extra = text.trim();
    if (extra) handleSend(targetJid, extra);
    setPendingForward(null);
    showToast(msgs.length > 1 ? `Переслано: ${msgs.length}` : "Переслано");
  }

  function handleClearConversation(jid: string) {
    if (jid === SAVED) setSaved([]);
    else onClearConversation(jid);
    seen.current[jid] = 0;
    setUnread((u) => ({ ...u, [jid]: 0 }));
    setPinned((p) => { const n = { ...p }; delete n[jid]; return n; });
    showToast("Переписка очищена");
  }
  function changePresence(p: Presence, msg: string) {
    setPresence(p); setStatusMsg(msg); onSetPresence(p, msg);
    setMyPresence(p);
    if (p === "away" || p === "dnd") showToast("Уведомления приглушены, пока статус «" + (p === "dnd" ? "Не беспокоить" : "Отошёл") + "»");
  }
  function toggleFav(jid: string) { setFavorites((f) => ({ ...f, [jid]: !f[jid] })); showToast(favorites[jid] ? "Убрано из избранного" : "Добавлено в избранное"); }
  function selectSection(s: Section) { setSection(s); setActiveJid(""); }

  const conversations: Conversation[] = useMemo(() => {
    let list = contacts.map((c) => {
      const msgs = messages[c.jid] || [];
      return { contact: c, last: msgs[msgs.length - 1], unread: unread[c.jid] || 0, fav: !!favorites[c.jid] };
    });
    list = list.filter((c) => !archived[c.contact.jid] && !blocked.includes(c.contact.jid));
    if (tab === "unread") list = list.filter((c) => c.unread > 0);
    if (tab === "fav") list = list.filter((c) => c.fav);
    if (onlineOnly) list = list.filter((c) => c.contact.presence === "online");
    if (search) { const s = search.toLowerCase(); list = list.filter((c) => c.contact.jid.toLowerCase().includes(s) || (c.contact.name || "").toLowerCase().includes(s)); }
    return list.sort((a, b) => (b.last?.ts || 0) - (a.last?.ts || 0) || a.contact.jid.localeCompare(b.contact.jid));
  }, [contacts, messages, unread, favorites, archived, tab, search, onlineOnly]);

  const savedConv: Conversation = { contact: savedContact, last: saved[saved.length - 1], unread: 0, fav: false };

  const messageMatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const out: { id: string; jid: string; name: string; body: string; outgoing: boolean; ts: number }[] = [];
    const scan = (jid: string, arr: ChatMessage[], name: string) => {
      for (const m of arr) if (m.body.toLowerCase().includes(q)) out.push({ id: m.id, jid, name, body: msgPreview(m), outgoing: m.outgoing, ts: m.ts });
    };

    for (const jid in messages) if (!jid.startsWith("secret:")) scan(jid, messages[jid], contacts.find((c) => c.jid === jid)?.name || jid.split("@")[0]);
    scan(SAVED, saved, "Сохранённые сообщения");
    return out.sort((a, b) => b.ts - a.ts).slice(0, 60);
  }, [search, messages, contacts, saved]);

  const activity = useMemo(() => {
    const all: { id: string; icon: string; text: string; time: string; ts: number }[] = [];
    for (const jid in messages) {
      if (jid.startsWith("secret:")) continue;
      const nm = contacts.find((x) => x.jid === jid)?.name || jid.split("@")[0];
      for (const m of messages[jid].slice(-3))
        all.push({ id: m.id, ts: m.ts, icon: "💬", text: m.outgoing ? `Вы → ${nm}: ${msgPreview(m)}` : `${nm}: ${msgPreview(m)}`, time: new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) });
    }
    return all.sort((a, b) => b.ts - a.ts).slice(0, 5);
  }, [messages, contacts]);

  const bell = Object.entries(unread).reduce((a, [jid, n]) => a + (muted[jid] ? 0 : n), 0);

  function mainContent() {
    if (active) {
      const isSaved = active.jid === SAVED;
      return (
        <ChatThread key={active.jid} client={client} contact={active} thread={thread} typing={!isSaved && !active.isSecret && !!typing[active.jid]}
          infoOpen={infoOpen} fav={!!favorites[active.jid]} local={isSaved} room={!!active.isRoom} occupants={occupants[active.jid] || []}
          secret={!!active.isSecret} secretInfo={active.isSecret && active.secretPeer ? { ...secretState[active.secretPeer], verified: secretIds[active.secretPeer]?.verified, idChanged: secretIds[active.secretPeer]?.changed } : undefined}
          onSetSecretTtl={(ttl) => onSetSecretTtl(active.jid, ttl)} onLeaveSecret={() => { onLeaveSecret(active.jid); setActiveJid(""); showToast("Секретный чат удалён."); }}
          onVerifySecret={() => { onVerifySecret(active.jid); showToast("Ключ подтверждён"); }}
          onSendSecretFile={active.isSecret ? (file, fileName, caption) => onSendSecretFile(active.jid, file, fileName, caption) : undefined}
          reqStatus={!active.isRoom && !active.isSecret && !isSaved ? subStatus[active.jid] : undefined}
          onAcceptReq={() => onAcceptRequest(active.jid)} onDeclineReq={() => { onDeclineRequest(active.jid); setActiveJid(""); showToast("Запрос отклонён."); }}
          mobile={mobile} onBack={() => setActiveJid("")}
          onToggleInfo={() => setInfoOpen((o) => !o)} onToggleFav={() => toggleFav(active.jid)}
          onSend={(b, reply) => handleSend(active.jid, b, reply)} onAttach={onAttach} onSoon={showToast}
          onLoadOlder={!isSaved && !active.isRoom && !active.isSecret ? () => onLoadOlder(active.jid) : undefined}
          pinnedIds={pinned[active.jid] || []}
          onPin={(id) => { setPinned((p) => ({ ...p, [active.jid]: Array.from(new Set([...(p[active.jid] || []), id])) })); showToast("Сообщение закреплено"); }}
          onUnpin={(id) => { setPinned((p) => { const arr = (p[active.jid] || []).filter((x) => x !== id); const n = { ...p }; if (arr.length) n[active.jid] = arr; else delete n[active.jid]; return n; }); showToast("Сообщение откреплено"); }}
          onEdit={(id, b) => handleEdit(active.jid, id, b)} onRetract={(id) => handleRetract(active.jid, id)} onDeleteLocal={(id) => handleDeleteLocal(active.jid, id)}
          onReact={!isSaved && !active.isRoom && !active.isSecret ? (id, emoji) => onReact(active.jid, id, emoji) : undefined}
          onForward={(m) => setForwarding(m)}
          onForwardMany={(msgs) => setForwardingMany(msgs)}
          forwardPreview={pendingForward && pendingForward.targetJid === active.jid ? pendingForward.msgs : undefined}
          onConfirmForward={handleConfirmForward}
          onCancelForward={() => setPendingForward(null)}
          onLeaveRoom={() => { onLeaveRoom(active.jid); setActiveJid(""); showToast("Вы вышли из группы."); }}
          onCall={(k) => showToast(k === "audio" ? "Аудиозвонки появятся в след. версии (XMPP Jingle + WebRTC)." : "Видеозвонки появятся в след. версии (WebRTC).")} />
      );
    }
    switch (section) {
      case "contacts": return <ContactsView contacts={contacts} onOpen={openChatWith} />;
      case "admin": return <AdminPanel selfJid={selfJid} onOpenChat={openChatWith} />;
      case "groups": return <GroupsView rooms={contacts.filter((c) => c.isRoom)} occupants={occupants} onCreate={createRoom} onJoinLink={joinByLink} onOpen={openChat} />;
      case "notifications": return <NotificationsView activity={activity} />;
      case "settings": return <SettingsView selfJid={selfJid} isAdmin={isAdmin} theme={theme} wallpaper={wallpaper} onWallpaper={setWallpaper} onToggleTheme={() => setTheme((t) => t === "dark" ? "light" : "dark")} onLogout={onLogout} />;
      default: return <Home selfJid={selfJid} online={contacts.filter((c) => c.presence === "online").length} total={contacts.length}
        presence={presence} statusMsg={statusMsg} onChangePresence={changePresence} onSelect={selectSection} onNewChat={newChat} activity={activity} />;
    }
  }

  return (
    <div className={`ws${mobile && activeJid ? " ws--thread" : ""}${mobile && !activeJid && section !== "home" ? " ws--section" : ""}`}>
      <NavRail active={section} onSelect={selectSection} onNewChat={newChat} isAdmin={isAdmin}
        bell={bell} theme={theme} onToggleTheme={() => setTheme((t) => t === "dark" ? "light" : "dark")}
        selfJid={selfJid} presence={presence} statusMsg={statusMsg} onChangePresence={changePresence} onLogout={onLogout}
        displayName={displayName} onSaveProfile={(fn) => { onSaveProfile(fn); showToast("Имя профиля сохранено"); }} />

      <ChatList ref={searchRef} conversations={conversations} saved={savedConv} messageMatches={messageMatches}
        activeJid={activeJid} tab={tab} search={search}
        onlineOnly={onlineOnly} onTab={setTab} onSearch={setSearch} onToggleOnline={() => setOnlineOnly((o) => !o)}
        onSelect={openChat} onNewChat={handleNewChatEnter} onNewSecret={() => { const n = search.trim(); if (n) createSecret(n); }}
        requests={requests} onAcceptRequest={onAcceptRequest} onDeclineRequest={(jid) => { onDeclineRequest(jid); }}
        dirResults={dirResults} onOpenDirUser={openFromDirectory} />

      <main className="ws-main">{mainContent()}</main>

      {active && active.jid !== SAVED && infoOpen && (
        active.isRoom
          ? <RoomMembers key={active.jid} room={active} occupants={occupants[active.jid] || []} selfNick={selfJid.split("@")[0]}
              onClose={() => setInfoOpen(false)} onToast={showToast}
              onSetAffiliation={(jid, aff) => onSetAffiliation(active.jid, jid, aff)}
              onInvite={(user) => { onInviteToRoom(active.jid, user); showToast(`Приглашение отправлено: ${user}`); }}
              onInviteLink={async (ttlMs) => {
                const token = await api.roomInviteLink(active.jid, selfJid, ttlMs);
                if (!token) { showToast("Не удалось создать ссылку (нужны права админа группы)"); return; }
                const link = `${location.origin}${location.pathname}#join=${token}`;
                try { await navigator.clipboard.writeText(link); showToast("Ссылка-приглашение скопирована в буфер"); }
                catch { showToast(link); }
              }} />
          : <InfoPanel key={active.jid} contact={active} selfJid={selfJid} muted={!!muted[active.jid]}
              onClose={() => setInfoOpen(false)} onToggleMute={() => { setMuted((m) => ({ ...m, [active.jid]: !m[active.jid] })); showToast(muted[active.jid] ? "Уведомления включены" : "Уведомления чата выключены"); }}
              onClear={!active.isRoom && !active.isSecret ? () => handleClearConversation(active.jid) : undefined}
              blocked={blocked.includes(active.jid)}
              onBlock={!active.isRoom && !active.isSecret && active.jid !== SAVED ? () => { onBlock(active.jid); showToast("Пользователь заблокирован"); setActiveJid(""); } : undefined}
              onUnblock={() => { onUnblock(active.jid); showToast("Пользователь разблокирован"); }}
              onSoon={showToast} onDelete={() => { setArchived((a) => ({ ...a, [active.jid]: true })); showToast("Чат удалён из списка (вернётся при новом сообщении)."); setActiveJid(""); }} />
      )}

      {(forwarding || forwardingMany) && (
        <ForwardModal targets={[savedContact, ...contacts.filter((c) => !c.isSecret)]}
          onPick={handleForwardTo} onClose={() => { setForwarding(null); setForwardingMany(null); }} />
      )}

      <AnimatePresence>
        {toast && (
          <motion.div className="toast" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}>{toast}</motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ForwardModal({ targets, onPick, onClose }: { targets: Contact[]; onPick: (jid: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  const s = q.trim().toLowerCase();
  const list = s ? targets.filter((c) => (c.name || "").toLowerCase().includes(s) || c.jid.toLowerCase().includes(s)) : targets;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Переслать кому?</h3>
        <input className="modal-search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск…" />
        <div className="modal-list">
          {list.length === 0 && <div className="info-empty" style={{ padding: "8px 10px" }}>Никого не найдено.</div>}
          {list.map((c) => (
            <button className="modal-row" key={c.jid} onClick={() => onPick(c.jid)}>
              {c.isRoom
                ? <span className="room-ava" style={{ width: 34, height: 34, borderRadius: 11 }}><Icon icon={UserGroupIcon} size={18} /></span>
                : <Avatar jid={c.jid} size={34} presence={c.presence} />}
              <span className="modal-row-name">{c.isRoom ? `# ${c.name || c.jid.split("@")[0]}` : c.name || c.jid.split("@")[0]}</span>
            </button>
          ))}
        </div>
        <button className="mini-btn" onClick={onClose}>Отмена</button>
      </div>
    </div>
  );
}

function ContactsView({ contacts, onOpen }: { contacts: Contact[]; onOpen: (jid: string) => void }) {
  return (
    <div className="section-view">
      <h2>Контакты</h2><p className="muted">Ваши контакты и присутствие в реальном времени.</p>
      <div className="contact-grid">
        {contacts.length === 0 && <div className="info-empty">Контактов пока нет. Начните новый чат — собеседник появится здесь.</div>}
        {contacts.map((c) => (
          <div className="contact-card" key={c.jid}>
            <Avatar jid={c.jid} size={46} presence={c.presence} />
            <div className="contact-meta"><div className="contact-name">{c.name || c.jid.split("@")[0]}</div><div className="contact-jid">{c.jid}</div></div>
            <button className="mini-btn" onClick={() => onOpen(c.jid)}>Написать</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function GroupsView({ rooms, occupants, onCreate, onJoinLink, onOpen }: { rooms: Contact[]; occupants: Record<string, Occupant[]>; onCreate: (name: string) => void; onJoinLink: (link: string) => void; onOpen: (jid: string) => void }) {
  const [name, setName] = useState("");
  const [link, setLink] = useState("");
  const submit = () => { const n = name.trim(); if (n) { onCreate(n); setName(""); } };
  const submitLink = () => { const l = link.trim(); if (l) { onJoinLink(l); setLink(""); } };
  return (
    <div className="section-view">
      <h2>Групповые чаты</h2>
      <p className="muted">Группы <b>закрытые</b> (MUC, XEP-0045): попасть в чужую группу можно только по
        ссылке-приглашению или если вас добавит админ. Создайте свою — и зовите участников.</p>
      <div className="group-create">
        <span className="group-create-ic"><Icon icon={UserGroupIcon} size={20} /></span>
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} placeholder="Название новой группы, напр. команда" />
        <button className="primary-btn" onClick={submit}>Создать группу</button>
      </div>
      <div className="group-create" style={{ marginTop: 10 }}>
        <span className="group-create-ic"><Icon icon={UserGroupIcon} size={20} /></span>
        <input value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submitLink()} placeholder="Вставьте ссылку-приглашение…" />
        <button className="primary-btn" onClick={submitLink}>Войти по ссылке</button>
      </div>
      <div className="contact-grid" style={{ marginTop: 18 }}>
        {rooms.length === 0 && <div className="info-empty">Вы пока не состоите в группах. Создайте первую выше.</div>}
        {rooms.map((r) => (
          <div className="contact-card" key={r.jid}>
            <span className="room-ava"><Icon icon={UserGroupIcon} size={24} /></span>
            <div className="contact-meta"><div className="contact-name"># {r.name}</div><div className="contact-jid">{(occupants[r.jid] || []).length} участников · {r.jid}</div></div>
            <button className="mini-btn" onClick={() => onOpen(r.jid)}>Открыть</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function RoomMembers({ room, occupants, selfNick, onClose, onToast, onSetAffiliation, onInvite, onInviteLink }: {
  room: Contact; occupants: Occupant[]; selfNick: string; onClose: () => void; onToast: (m: string) => void;
  onSetAffiliation: (jid: string, aff: "owner" | "member" | "outcast") => void;
  onInvite: (user: string) => void;
  onInviteLink: (ttlMs: number) => void;
}) {
  const [invite, setInvite] = useState("");
  const [linkTtl, setLinkTtl] = useState(7 * 864e5);
  const isAdmin = (o: Occupant) => o.affiliation === "owner" || o.affiliation === "admin";
  const amAdmin = occupants.some((o) => o.nick === selfNick && isAdmin(o));
  const sorted = [...occupants].sort((a, b) => (isAdmin(b) ? 1 : 0) - (isAdmin(a) ? 1 : 0) || a.nick.localeCompare(b.nick));
  const doInvite = () => { const u = invite.trim().toLowerCase(); if (u) { onInvite(u); setInvite(""); } };
  return (
    <aside className="info-panel members">
      <div className="info-head">
        <h3># {room.name || room.jid.split("@")[0]}</h3>
        <button className="ic-btn" title="Закрыть" onClick={onClose}><Icon icon={Cancel01Icon} /></button>
      </div>
      <div className="members-count">{occupants.length} участников{amAdmin && <span className="you-admin"> · вы админ</span>}</div>
      {amAdmin && (
        <div className="group-create" style={{ margin: "0 12px 10px" }}>
          <span className="group-create-ic"><Icon icon={UserGroupIcon} size={18} /></span>
          <input value={invite} onChange={(e) => setInvite(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doInvite()} placeholder="Имя пользователя…" />
          <button className="mini-btn" onClick={doInvite}>Добавить</button>
        </div>
      )}
      {amAdmin && (
        <div className="group-create" style={{ margin: "0 12px 10px" }}>
          <select className="link-ttl" value={linkTtl} onChange={(e) => setLinkTtl(Number(e.target.value))} title="Срок действия ссылки">
            <option value={3600_000}>1 час</option>
            <option value={864e5}>1 день</option>
            <option value={7 * 864e5}>7 дней</option>
            <option value={30 * 864e5}>30 дней</option>
            <option value={10 * 365 * 864e5}>Бессрочно</option>
          </select>
          <button className="mini-btn" onClick={() => onInviteLink(linkTtl)}>🔗 Ссылка-приглашение</button>
        </div>
      )}
      {!amAdmin && <div className="info-empty" style={{ margin: "0 12px 10px" }}>Приглашать участников может только админ группы.</div>}
      <div className="members-list">
        {sorted.map((o) => (
          <div className="member-row" key={o.nick}>
            <Avatar jid={o.jid || o.nick} size={38} />
            <div className="member-meta">
              <div className="member-nick">{o.nick}{o.nick === selfNick && " (вы)"}</div>
              <span className={isAdmin(o) ? "member-badge admin" : "member-badge"}>{isAdmin(o) ? <><Icon icon={Crown03Icon} size={12} /> Админ</> : "Участник"}</span>
            </div>
            {amAdmin && o.nick !== selfNick && o.jid && (
              <div className="member-actions">
                <button className="mini-btn" onClick={() => { onSetAffiliation(o.jid!, isAdmin(o) ? "member" : "owner"); onToast(isAdmin(o) ? `${o.nick} снят с админов` : `${o.nick} — теперь админ`); }}>
                  {isAdmin(o) ? "− Админ" : "+ Админ"}
                </button>
                <button className="mini-btn danger" onClick={() => { onSetAffiliation(o.jid!, "outcast"); onToast(`${o.nick} удалён из группы`); }}>Удалить</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}

function Stub({ icon, title, text, action, onAction }: { icon: any; title: string; text: string; action?: string; onAction?: () => void }) {
  return (
    <div className="stub">
      <span className="stub-ic"><Icon icon={icon} size={52} /></span>
      <h2>{title}</h2><p>{text}</p>
      {action && <button className="primary-btn" onClick={onAction}>{action}</button>}
    </div>
  );
}

function NotifToggle({ k, label }: { k: "sound" | "push" | "preview" | "online"; label: string }) {
  const n = useNotif();
  return (
    <button className="hp-toggle toggle-btn" onClick={() => setNotif({ [k]: !n[k] })}>
      <span>{label}</span><span className={`switch ${n[k] ? "on" : ""}`}><span className="knob" /></span>
    </button>
  );
}

function PushPermissionRow() {
  useNotif();
  const p = getPushPermission();
  if (p === "granted") return <div className="info-empty" style={{ color: "var(--green)" }}>✓ Разрешение браузера на уведомления выдано</div>;
  if (p === "unsupported") return <div className="info-empty">Браузер не поддерживает уведомления.</div>;
  if (p === "denied") return <div className="info-empty">⚠ Уведомления заблокированы браузером: нажмите на замок в адресной строке → «Уведомления» → «Разрешить».</div>;
  return (
    <button className="hp-toggle toggle-btn" onClick={() => requestPush()}>
      <span>⚠ Разрешение не выдано — нажмите, чтобы запросить</span>
    </button>
  );
}

function NotificationsView({ activity }: { activity: { id: string; icon: string; text: string; time: string }[] }) {
  return (
    <div className="section-view">
      <h2>Уведомления</h2>
      <div className="hp" style={{ maxWidth: 520 }}>
        <NotifToggle k="sound" label="Звуковые уведомления" />
        <NotifToggle k="preview" label="Показывать превью сообщений" />
        <NotifToggle k="push" label="Уведомления на рабочем столе" />
        <NotifToggle k="online" label="Уведомлять, когда контакт в сети" />
        <PushPermissionRow />
      </div>
      <h3 style={{ marginTop: 24 }}>Недавнее</h3>
      {activity.length === 0 && <div className="info-empty">Событий пока нет.</div>}
      {activity.map((a) => (<div className="act-row" key={a.id}><span className="act-ic">{a.icon}</span><span className="act-text">{a.text}</span><span className="act-time">{a.time}</span></div>))}
    </div>
  );
}

function SettingsView({ selfJid, isAdmin, theme, wallpaper, onWallpaper, onToggleTheme, onLogout }: { selfJid: string; isAdmin: boolean; theme: string; wallpaper: string; onWallpaper: (w: string) => void; onToggleTheme: () => void; onLogout: () => void }) {
  return (
    <div className="section-view">
      <h2>Настройки</h2>
      <div className="hp" style={{ maxWidth: 560 }}>
        <div className="hp-title">Аккаунт</div>
        <div className="info-row"><span>Jabber ID</span><b>{selfJid}</b></div>
        <div className="info-row"><span>Сервер</span><b>{CONFIG.DOMAIN}</b></div>
        <div className="info-row"><span>Роль</span><b>{isAdmin ? "Администратор" : "Пользователь"}</b></div>
      </div>
      <div className="hp" style={{ maxWidth: 560, marginTop: 14 }}>
        <div className="hp-title">Оформление</div>
        <button className="hp-toggle toggle-btn" onClick={onToggleTheme}><span>Тёмная тема</span><span className={`switch ${theme === "dark" ? "on" : ""}`}><span className="knob" /></span></button>
      </div>
      <div className="hp" style={{ maxWidth: 560, marginTop: 14 }}>
        <div className="hp-title">Уведомления</div>
        <NotifToggle k="sound" label="Звуковые уведомления" />
        <NotifToggle k="push" label="Уведомления на рабочем столе" />
        <NotifToggle k="preview" label="Показывать превью сообщений" />
        <NotifToggle k="online" label="Уведомлять, когда контакт в сети" />
        <PushPermissionRow />
      </div>
      <div className="hp" style={{ maxWidth: 560, marginTop: 14 }}>
        <div className="hp-title">Фон чата</div>
        <div className="wall-grid">
          {WALLPAPERS.map((w) => (
            <button key={w.id} className={wallpaper === w.id ? "wall-swatch active" : "wall-swatch"} data-wall={w.id} onClick={() => onWallpaper(w.id)} title={w.label}>
              <span className="wall-prev" data-wall={w.id} />
              <span className="wall-label">{w.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="hp" style={{ maxWidth: 560, marginTop: 14 }}>
        <div className="hp-title with-ic"><Icon icon={Shield01Icon} size={15} /> Безопасность</div>
        <p className="muted" style={{ margin: "6px 0 0", lineHeight: 1.6 }}>SASL SCRAM, admin-API на HMAC-токенах, CORS-аллоулист и helmet. Для E2E планируется OMEMO (XEP-0384), транспорт — TLS.</p>
      </div>
      <button className="danger-btn" style={{ marginTop: 18 }} onClick={onLogout}>Выйти из аккаунта</button>
    </div>
  );
}
