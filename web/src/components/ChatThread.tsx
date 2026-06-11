import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Attachment, ChatMessage, Contact, Occupant, Presence } from "../types";
import { msgPreview } from "../types";
import type { XmppClient } from "../xmpp";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { CONFIG } from "../config";
import {
  Search01Icon, Call02Icon, MoreVerticalIcon, StarIcon,
  Add01Icon, SmileIcon, Attachment01Icon, SentIcon, Mic01Icon, Cancel01Icon, Tick01Icon, TickDouble01Icon, Bookmark01Icon, ArrowLeft01Icon,
  PlayIcon, PauseIcon, MoreHorizontalIcon, PencilEdit01Icon, Delete01Icon, UserGroupIcon, Logout01Icon, ArrowTurnBackwardIcon, QuoteDownIcon, PinIcon, PinOffIcon, SquareLock01Icon, Clock01Icon,
  Copy01Icon, Forward01Icon, CheckmarkSquare02Icon, Alert02Icon,
} from "@hugeicons/core-free-icons";

const PRESENCE_LABEL: Record<Presence, string> = {
  online: "Онлайн", away: "Отошёл", dnd: "Не беспокоить", offline: "Не в сети",
};
const EMOJIS = ["😀","😄","😉","🙂","😍","😎","🤔","😴","👍","👌","🙏","👏","🔥","✨","🎉","❤️","💙","💜","✅","❗","⏰","📌","🚀","☕","🤖","😅","😂","🥳","😢","🤝","💯","📎"];
const QUICK_REACTIONS = ["👍","❤️","😂","🔥","😮","😢"];
const COMMANDS = [
  { cmd: "/weth", desc: "погода — напр. /weth Москва" },
  { cmd: "/conv", desc: "конвертер — /conv 100 usd rub" },
  { cmd: "/remind", desc: "напоминание — /remind 18:30 текст" },
  { cmd: "/help", desc: "список команд" },
];
const fmt = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const extOf = (n: string) => { const m = n.split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i); return m ? m[1].toLowerCase() : ""; };
const fmtSize = (b?: number) => b == null ? "" : b < 1024 ? `${b} Б` : b < 1048576 ? `${(b / 1024).toFixed(0)} КБ` : `${(b / 1048576).toFixed(1)} МБ`;

const msgsWord = (n: number) => { const d10 = n % 10, d100 = n % 100; return d10 === 1 && d100 !== 11 ? "сообщение" : d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14) ? "сообщения" : "сообщений"; };

const WAVE_BARS = 38;

function pseudoPeaks(seed: string, bars: number) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  const out: number[] = [];
  for (let i = 0; i < bars; i++) { h = (Math.imul(h, 1103515245) + 12345) >>> 0; out.push(0.28 + ((h >>> 9) % 1000) / 1000 * 0.72); }
  return out;
}

function safeUrl(url?: string): string { return /^(https?:|blob:)/i.test((url || "").trim()) ? (url as string).trim() : ""; }

function BrokenAtt() {
  return <span className="att-broken"><Icon icon={Alert02Icon} size={16} /> Файл недоступен</span>;
}

const DRAFTS_KEY = "hubx.drafts";
const drafts = new Map<string, string>(Object.entries(((): Record<string, string> => {
  try { return JSON.parse(localStorage.getItem(DRAFTS_KEY) || "{}") || {}; } catch { return {}; }
})()));
let draftsTimer: number | undefined;
function rememberDraft(jid: string, text: string) {
  if (jid.startsWith("secret:")) return;
  if (text.trim()) drafts.set(jid, text); else drafts.delete(jid);
  window.clearTimeout(draftsTimer);
  draftsTimer = window.setTimeout(() => {
    try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(Object.fromEntries(drafts))); } catch {  }
  }, 300);
}
// L5: flush the debounced draft synchronously before the tab is hidden/closed.
function flushDrafts() {
  window.clearTimeout(draftsTimer);
  try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(Object.fromEntries(drafts))); } catch {  }
}
if (typeof window !== "undefined") window.addEventListener("pagehide", flushDrafts);

async function decodePeaks(url: string, bars: number): Promise<number[] | null> {
  try {
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    const Ctx = (window.AudioContext || (window as any).webkitAudioContext);
    if (!Ctx) return null;
    const ctx = new Ctx();
    try {
      const audio: AudioBuffer = await ctx.decodeAudioData(buf);
      const ch = audio.getChannelData(0);
      const block = Math.max(1, Math.floor(ch.length / bars));
      const out: number[] = [];
      for (let i = 0; i < bars; i++) { let m = 0; for (let j = 0; j < block; j++) { const v = Math.abs(ch[i * block + j] || 0); if (v > m) m = v; } out.push(m); }
      const peak = Math.max(...out, 1e-4);
      return out.map((v) => Math.max(0.12, Math.min(1, v / peak)));
    } finally { ctx.close?.(); }
  } catch { return null; }
}

function VoicePlayer({ att }: { att: Attachment }) {
  const ref = useRef<HTMLAudioElement>(null);
  const fixing = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [rate, setRate] = useState(1);
  const [peaks, setPeaks] = useState<number[]>(() => pseudoPeaks(att.url, WAVE_BARS));
  const [dead, setDead] = useState(false);

  useEffect(() => { let on = true; const u = safeUrl(att.url); if (u && att.size && att.size <= 8 * 1024 * 1024) decodePeaks(u, WAVE_BARS).then((p) => { if (on && p) setPeaks(p); }); return () => { on = false; }; }, [att.url, att.size]);

  const progress = dur ? cur / dur : 0;
  const toggle = () => { const a = ref.current; if (!a) return; if (a.paused) a.play(); else a.pause(); };
  const seek = (e: React.MouseEvent) => { const a = ref.current; if (!a || !dur) return; const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); a.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur; };
  const cycleRate = () => { const n = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1; setRate(n); if (ref.current) ref.current.playbackRate = n; };
  const onMeta = () => { const a = ref.current; if (!a) return; if (isFinite(a.duration) && a.duration > 0) setDur(a.duration); else { fixing.current = true; a.currentTime = 1e7; } };
  const onDurChange = () => { const a = ref.current; if (a && isFinite(a.duration) && a.duration > 0) setDur(a.duration); };
  const onTime = () => { const a = ref.current; if (!a) return; if (fixing.current) { fixing.current = false; a.currentTime = 0; setCur(0); return; } setCur(a.currentTime); };
  const showSecs = Math.floor((playing || cur > 0 ? cur : dur) || 0);

  if (dead) return <BrokenAtt />;
  return (
    <div className="vmsg">
      <button className="vmsg-play" onClick={toggle} title={playing ? "Пауза" : "Воспроизвести"}>
        <Icon icon={playing ? PauseIcon : PlayIcon} size={20} color="#fff" />
      </button>
      <div className="vmsg-mid">
        <div className="vmsg-wave" onClick={seek}>
          {peaks.map((p, i) => (
            <span key={i} className={(i + 0.5) / peaks.length <= progress ? "b on" : "b"} style={{ height: `${Math.round(p * 100)}%` }} />
          ))}
        </div>
        <div className="vmsg-meta">
          <span className="vmsg-dur">{mmss(showSecs)}</span>
          {att.size ? <span className="vmsg-size">{fmtSize(att.size)}</span> : null}
          <span className="vmsg-udot" />
        </div>
      </div>
      <button className="vmsg-rate" onClick={cycleRate} title="Скорость воспроизведения">{rate === 1 ? "1×" : rate === 1.5 ? "1,5×" : "2×"}</button>
      <audio ref={ref} src={safeUrl(att.url)} preload="metadata"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCur(0); }}
        onError={() => setDead(true)}
        onTimeUpdate={onTime} onLoadedMetadata={onMeta} onDurationChange={onDurChange} />
    </div>
  );
}

function AttachmentView({ att }: { att: Attachment }) {
  const url = safeUrl(att.url);
  const [dead, setDead] = useState(false);
  if (att.kind === "image")
    return dead ? <BrokenAtt /> : (
      <a className="att-img" href={url || undefined} target="_blank" rel="noreferrer" title={att.name}>
        <img src={url} alt={att.name} loading="lazy" onError={() => setDead(true)} />
      </a>
    );
  if (att.kind === "audio")
    return att.voice
      ? <VoicePlayer att={att} />
      : dead ? <BrokenAtt />
      : <div className="att-audio"><audio controls preload="metadata" src={url} onError={() => setDead(true)} /></div>;
  return (
    <a className="att-file" href={url || undefined} target="_blank" rel="noreferrer" download={att.name} title={att.name}>
      <span className="att-file-ic"><Icon icon={Attachment01Icon} size={18} /></span>
      <span className="att-file-meta">
        <span className="att-file-name">{att.name}</span>
        <span className="att-file-sub">{(extOf(att.name) || "файл").toUpperCase()}{att.size ? ` · ${fmtSize(att.size)}` : ""}</span>
      </span>
    </a>
  );
}
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();
function dayLabel(ts: number) {
  const d = new Date(ts), today = new Date(), yest = new Date(); yest.setDate(today.getDate() - 1);
  if (sameDay(ts, today.getTime())) return "Сегодня";
  if (sameDay(ts, yest.getTime())) return "Вчера";
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "long" });
}

function PinnedBar({ pinnedIds, thread, onJump, onUnpin }: {
  pinnedIds: string[]; thread: ChatMessage[]; onJump: (id: string) => void; onUnpin?: (id: string) => void;
}) {
  const [idx, setIdx] = useState(0);
  const count = pinnedIds.length;
  const cur = ((idx % count) + count) % count;
  const curId = pinnedIds[cur];
  const msg = thread.find((m) => m.id === curId);
  const att = msg?.attachment;
  const label = att ? (att.kind === "image" ? "Фотография" : att.kind === "audio" ? "Голосовое сообщение" : att.name) : (msg?.body || "Сообщение");
  function tap() { onJump(curId); if (count > 1) setIdx((i) => i + 1); }
  return (
    <div className="pinned-bar" onClick={tap} role="button" title={count > 1 ? "Перейти · следующее закреплённое" : "Перейти к закреплённому"}>
      {count > 1 && (
        <span className="pinned-rail">{pinnedIds.map((_, i) => <span key={i} className={i === cur ? "on" : ""} />)}</span>
      )}
      {att && att.kind === "image"
        ? <span className="pinned-thumb"><img src={safeUrl(att.url)} alt="" /></span>
        : <span className="pinned-thumb ic"><Icon icon={PinIcon} size={15} /></span>}
      <span className="pinned-text">
        <b>{count > 1 ? `Закреплённое ${cur + 1}/${count}` : "Закреплённое сообщение"}</b>
        <span className="pinned-snippet">{label}</span>
      </span>
      {onUnpin && <button className="pinned-unpin" title="Открепить" onClick={(e) => { e.stopPropagation(); onUnpin(curId); }}><Icon icon={PinOffIcon} size={16} /></button>}
    </div>
  );
}

function renderBody(text: string, frag?: string) {
  if (!frag) return text;
  const idx = text.indexOf(frag);
  if (idx < 0) return text;
  return <>{text.slice(0, idx)}<mark className="frag-hl">{frag}</mark>{text.slice(idx + frag.length)}</>;
}

function TypingDots() {
  return (
    <div className="bubble typing">
      {[0, 1, 2].map((i) => (
        <motion.span key={i} animate={{ opacity: [0.25, 1, 0.25], y: [0, -3, 0] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18, ease: "easeInOut" }} />
      ))}
    </div>
  );
}

export function ChatThread({
  client, contact, thread, typing, infoOpen, fav, local, room, occupants = [], mobile, onBack,
  onToggleInfo, onToggleFav, onSend, onAttach, onEdit, onRetract, onDeleteLocal, onReact, onForward, onForwardMany, onLeaveRoom, onCall, onSoon,
  forwardPreview, onConfirmForward, onCancelForward,
  pinnedIds, onPin, onUnpin,
  secret, secretInfo, onSetSecretTtl, onLeaveSecret, onVerifySecret, onSendSecretFile,
  reqStatus, onAcceptReq, onDeclineReq, onLoadOlder,
}: {
  client: XmppClient;
  contact: Contact;
  thread: ChatMessage[];
  typing: boolean;
  infoOpen: boolean;
  fav: boolean;
  local?: boolean;
  room?: boolean;
  occupants?: Occupant[];
  mobile?: boolean;
  onBack?: () => void;
  onToggleInfo: () => void;
  onToggleFav: () => void;
  onSend: (body: string, reply?: { id: string; author: string; text: string }) => void;
  onAttach: (msg: ChatMessage) => void;
  onEdit: (id: string, body: string) => void;
  onRetract: (id: string) => void;
  onDeleteLocal: (id: string) => void;
  onReact?: (id: string, emoji: string) => void;
  onForward?: (m: ChatMessage) => void;
  onForwardMany?: (msgs: ChatMessage[]) => void;
  forwardPreview?: ChatMessage[];
  onConfirmForward?: (text: string) => void;
  onCancelForward?: () => void;
  onLeaveRoom?: () => void;
  onCall: (kind: "audio" | "video") => void;
  onSoon: (msg: string) => void;
  pinnedIds?: string[];
  onPin?: (id: string) => void;
  onUnpin?: (id: string) => void;
  secret?: boolean;
  secretInfo?: { established: boolean; ttl: number; fingerprint?: string; verified?: boolean; idChanged?: boolean };
  onSetSecretTtl?: (ttl: number) => void;
  onLeaveSecret?: () => void;
  onVerifySecret?: () => void;
  onSendSecretFile?: (file: Blob, fileName: string, caption?: string) => void;
  reqStatus?: "active" | "out" | "in";
  onAcceptReq?: () => void;
  onDeclineReq?: () => void;
  onLoadOlder?: () => Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");
  const draftLive = useRef("");
  draftLive.current = draft;
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const composeTimer = useRef<number>();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const mediaRec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const recTimer = useRef<number>();
  const recCancel = useRef(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number>();
  const lastSampleRef = useRef(0);
  const [liveBars, setLiveBars] = useState<number[]>([]);

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [replying, setReplying] = useState<{ id: string; author: string; text: string; quote?: boolean } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [pending, setPending] = useState<{ file: Blob; name: string; previewUrl: string; isImage: boolean } | null>(null);
  const pendingRef = useRef(pending);                       // L6: revoke its previewUrl on chat switch / unmount
  useEffect(() => { pendingRef.current = pending; }, [pending]);
  const composingJid = useRef<string | null>(null);        // L7: jid we last sent "composing" to, so we can cancel it
  const [highlight, setHighlight] = useState<{ id: string; frag: string } | null>(null);
  const selRef = useRef<{ id: string; text: string } | null>(null);
  const hlTimer = useRef<number>();
  const [hideSecret, setHideSecret] = useState(false);
  const [ttlMenu, setTtlMenu] = useState(false);
  const [delModalOpen, setDelModalOpen] = useState(false);

  useEffect(() => {
    if (!secret) { setHideSecret(false); return; }
    const onVis = () => setHideSecret(document.hidden);
    const onBlur = () => setHideSecret(true);
    const onFocus = () => setHideSecret(false);
    const onKey = (e: KeyboardEvent) => {

      if (e.key === "PrintScreen" || (e.metaKey && e.shiftKey && ["3", "4", "5"].includes(e.key))) {
        onSoon("Это секретный чат — пожалуйста, не делайте скриншоты.");
      }
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    window.addEventListener("keyup", onKey);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("keyup", onKey);
    };
  }, [secret, onSoon]);
  useEffect(() => { setTtlMenu(false); }, [contact.jid]);
  const TTL_OPTS = [{ v: 0, l: "Выкл" }, { v: 5, l: "5 сек" }, { v: 30, l: "30 сек" }, { v: 60, l: "1 мин" }, { v: 3600, l: "1 час" }, { v: 86400, l: "1 день" }];
  const ttlLabel = (s: number) => s === 0 ? "выкл" : s < 60 ? `${s}с` : s < 3600 ? `${s / 60}м` : s < 86400 ? `${s / 3600}ч` : `${s / 86400}д`;

  const isBot = !local && contact.jid.split("@")[0] === CONFIG.BOT_USER;
  const cmdMatches = isBot && draft.startsWith("/") && !draft.includes(" ")
    ? COMMANDS.filter((c) => c.cmd.startsWith(draft.toLowerCase())) : [];

  useEffect(() => { setSearchOpen(false); setQuery(""); setEmojiOpen(false); window.clearTimeout(composeTimer.current); }, [contact.jid]);

  useEffect(() => {
    setDraft(drafts.get(contact.jid) || "");
    return () => rememberDraft(contact.jid, draftLive.current);
  }, [contact.jid]);
  useEffect(() => () => {
    window.clearTimeout(composeTimer.current);
    if (pendingRef.current?.previewUrl) URL.revokeObjectURL(pendingRef.current.previewUrl);
    if (composingJid.current) { try { client.sendComposing(composingJid.current, false); } catch {  } }
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || query) return;

    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    if (nearBottom || contact.jid) el.scrollTop = el.scrollHeight;
  }, [contact.jid]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || query || prependingRef.current) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 140) el.scrollTop = el.scrollHeight;
  }, [thread.length, typing, query]);

  const [loadingOlder, setLoadingOlder] = useState(false);
  const [histDone, setHistDone] = useState(false);
  const prependingRef = useRef(false);
  const prevHeightRef = useRef(0);

  useLayoutEffect(() => {
    if (!prependingRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    const diff = el.scrollHeight - prevHeightRef.current;
    if (diff) { el.scrollTop += diff; prevHeightRef.current = el.scrollHeight; }
  }, [thread.length, loadingOlder, histDone]);
  async function maybeLoadOlder() {
    const el = scrollRef.current;
    if (!el || !onLoadOlder || prependingRef.current || histDone || query) return;
    prependingRef.current = true;
    prevHeightRef.current = el.scrollHeight;
    setLoadingOlder(true);
    let more = false;
    try { more = await onLoadOlder(); } catch {  }
    if (!more) setHistDone(true);
    setLoadingOlder(false);

    requestAnimationFrame(() => requestAnimationFrame(() => { prependingRef.current = false; }));
  }
  function onMessagesScroll() {
    const el = scrollRef.current;
    if (el && el.scrollTop < 80) maybeLoadOlder();
  }

  const lastDisplayed = useRef("");
  function sendReadMarker() {
    if (local || room || secret || document.hidden) return;
    for (let i = thread.length - 1; i >= 0; i--) {
      if (!thread[i].outgoing) {
        const id = thread[i].id;
        if (id && id !== lastDisplayed.current) { lastDisplayed.current = id; client.sendDisplayed(contact.jid, id); }
        break;
      }
    }
  }
  useEffect(() => { sendReadMarker(); }, [thread, contact.jid, local, client]);

  useEffect(() => {
    const onVis = () => { if (!document.hidden) sendReadMarker(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  });

  const shown = useMemo(
    () => (query ? thread.filter((m) => m.body.toLowerCase().includes(query.toLowerCase())) : thread),
    [thread, query]
  );

  const livePins = (pinnedIds || []).filter((id) => thread.some((m) => m.id === id));

  function clearDraft() { setDraft(""); rememberDraft(contact.jid, ""); }
  function send() {

    if (forwardPreview && forwardPreview.length && onConfirmForward) {
      onConfirmForward(draft);
      clearDraft();
      if (!local && !room && !secret) client.sendComposing(contact.jid, false);
      return;
    }

    if (pending) {
      const cap = draft.trim();
      const p = pending;
      setPending(null); clearDraft();
      uploadAndSend(p.file, p.name, { caption: cap });
      if (p.previewUrl) setTimeout(() => URL.revokeObjectURL(p.previewUrl), 1000);
      return;
    }
    const body = draft.trim();
    if (!body) return;
    if (editing) { onEdit(editing.id, body); setEditing(null); clearDraft(); return; }
    onSend(body, replying || undefined);
    setReplying(null);
    clearDraft();
    if (!local && !room && !secret) client.sendComposing(contact.jid, false);
  }
  function startEdit(m: ChatMessage) {
    setEditing({ id: m.id, body: m.body });
    setReplying(null);
    setDraft(m.body);
    setMenuFor(null);
    setTimeout(() => taRef.current?.focus(), 30);
  }
  function cancelEdit() { setEditing(null); setDraft(""); }
  function startReply(m: ChatMessage) {
    const author = m.outgoing ? "Вы" : room ? m.from : contact.name || contact.jid.split("@")[0];

    const sel = selRef.current && selRef.current.id === m.id ? selRef.current.text : "";
    const frag = sel && m.body.includes(sel) ? sel : "";
    const text = frag || msgPreview(m);
    setReplying({ id: m.id, author, text, quote: !!frag });
    selRef.current = null;
    setEditing(null);
    setMenuFor(null);
    setTimeout(() => taRef.current?.focus(), 30);
  }
  function scrollToMsg(id: string, frag?: string) {
    const el = scrollRef.current?.querySelector(`[data-mid="${id}"]`) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("flash");
    window.setTimeout(() => el.classList.remove("flash"), 1400);
    window.clearTimeout(hlTimer.current);
    if (frag) { setHighlight({ id, frag }); hlTimer.current = window.setTimeout(() => setHighlight(null), 2600); }
    else setHighlight(null);
  }
  function retract(m: ChatMessage) { setMenuFor(null); onRetract(m.id); }
  function delLocal(m: ChatMessage) { setMenuFor(null); onDeleteLocal(m.id); if (editing?.id === m.id) cancelEdit(); }

  const selMsgs = thread.filter((m) => selected.has(m.id));

  const canRetractAll = !room && !secret && !local && selMsgs.length > 0 && selMsgs.every((m) => m.outgoing);
  function exitSelect() { setSelectMode(false); setSelected(new Set()); setDelModalOpen(false); }
  function toggleSelect(id: string) {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  function deleteSelected() {
    if (editing && selected.has(editing.id)) cancelEdit();
    selected.forEach((id) => onDeleteLocal(id));
    exitSelect();
  }
  function retractSelected() {
    if (editing && selected.has(editing.id)) cancelEdit();
    selMsgs.forEach((m) => onRetract(m.id));
    exitSelect();
  }
  function forwardSelected() {
    const msgs = thread.filter((m) => selected.has(m.id));
    if (msgs.length) onForwardMany?.(msgs);
    exitSelect();
  }

  useEffect(() => {
    if (!selectMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (delModalOpen) { setDelModalOpen(false); return; }
      setSelectMode(false); setSelected(new Set());
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectMode, delModalOpen]);

  useEffect(() => {
    if (!menuFor) return;
    const h = () => { setMenuFor(null); setMenuPos(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") h(); };
    document.addEventListener("click", h); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("click", h); document.removeEventListener("keydown", onKey); };
  }, [menuFor]);

  useEffect(() => {
    if (!ttlMenu && !emojiOpen) return;
    const close = () => { setTtlMenu(false); setEmojiOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("click", close); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("click", close); document.removeEventListener("keydown", onKey); };
  }, [ttlMenu, emojiOpen]);
  useEffect(() => {
    // L6: revoke the previous chat's pending preview; L7: cancel a stuck "typing" for the previous chat.
    if (pendingRef.current?.previewUrl) URL.revokeObjectURL(pendingRef.current.previewUrl);
    if (composingJid.current && composingJid.current !== contact.jid) { try { client.sendComposing(composingJid.current, false); } catch {  } composingJid.current = null; }
    setMenuFor(null); setMenuPos(null); setEditing(null); setReplying(null); setDragOver(false); setPending(null); setHighlight(null); setTtlMenu(false); setEmojiOpen(false); setSelectMode(false); setSelected(new Set()); setDelModalOpen(false); setHistDone(false); setLoadingOlder(false); prependingRef.current = false;
  }, [contact.jid]);
  function onDraft(v: string) {
    setDraft(v);
    if (local || room || secret) return;
    client.sendComposing(contact.jid, true);
    composingJid.current = contact.jid;
    window.clearTimeout(composeTimer.current);
    composeTimer.current = window.setTimeout(() => { client.sendComposing(contact.jid, false); composingJid.current = null; }, 2500);
  }

  async function uploadAndSend(file: Blob, name: string, opts?: { voice?: boolean; caption?: string }) {
    if (file.size > 25 * 1024 * 1024) { onSoon("Файл больше 25 МБ — выберите поменьше."); return; }
    if (secret) {
      if (onSendSecretFile) { setUploading(true); try { await onSendSecretFile(file, name, opts?.caption); } finally { setUploading(false); } }
      return;
    }
    setUploading(true);
    try {
      const msg = await client.sendFile(contact.jid, file, name, opts);
      onAttach(msg);
    } catch (err: any) {
      onSoon(err?.message || "Не удалось отправить файл");
    } finally {
      setUploading(false);
    }
  }

  function stagePending(file: Blob, name: string) {
    if (local || room) { onSoon("Вложения — в личных чатах."); return; }
    if (file.size > 25 * 1024 * 1024) { onSoon("Файл больше 25 МБ — выберите поменьше."); return; }
    const isImage = /^image\//.test((file as File).type || "");
    if (pending?.previewUrl) URL.revokeObjectURL(pending.previewUrl);
    setPending({ file, name, previewUrl: isImage ? URL.createObjectURL(file) : "", isImage });
    setTimeout(() => taRef.current?.focus(), 40);
  }
  function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) stagePending(file, file.name);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false);
    if (local || room) { onSoon("Вложения — в личных чатах."); return; }
    const f = Array.from(e.dataTransfer?.files || [])[0];
    if (f) stagePending(f, f.name);
  }
  function onDragOver(e: React.DragEvent) {
    if (local || room) return;
    if (Array.from(e.dataTransfer?.types || []).includes("Files")) { e.preventDefault(); setDragOver(true); }
  }
  function onDragLeave(e: React.DragEvent) {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDragOver(false);
  }

  function onPaste(e: React.ClipboardEvent) {
    if (local || room) return;
    for (const it of Array.from(e.clipboardData?.items || [])) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) { e.preventDefault(); const ext = (f.type.split("/")[1] || "png").replace("jpeg", "jpg"); stagePending(f, `screenshot-${Date.now()}.${ext}`); }
      }
    }
  }

  function stopWave() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    try { audioCtxRef.current?.close(); } catch {  }
    audioCtxRef.current = null;
    setLiveBars([]);
  }
  function startWave(stream: MediaStream) {
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AC(); audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser(); an.fftSize = 256; src.connect(an);
      const data = new Uint8Array(an.fftSize);
      lastSampleRef.current = 0;
      const tick = () => {
        an.getByteTimeDomainData(data);
        let sum = 0; for (let i = 0; i < data.length; i++) { const x = (data[i] - 128) / 128; sum += x * x; }
        const level = Math.min(1, Math.sqrt(sum / data.length) * 3.2);
        const now = performance.now();
        if (now - lastSampleRef.current > 60) {
          lastSampleRef.current = now;
          setLiveBars((b) => { const n = [...b, Math.max(0.08, level)]; return n.length > 46 ? n.slice(n.length - 46) : n; });
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {  }
  }

  async function startRec() {
    if (uploading) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunks.current = []; recCancel.current = false;
      mr.ondataavailable = (ev) => { if (ev.data.size) chunks.current.push(ev.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        window.clearInterval(recTimer.current);
        stopWave();
        setRecording(false); setRecSecs(0);
        const type = mr.mimeType || "audio/webm";
        const blob = new Blob(chunks.current, { type });
        if (recCancel.current || blob.size < 1024) return;
        const ext = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "m4a" : "webm";
        uploadAndSend(blob, `voice-${Date.now()}.${ext}`, { voice: true });
      };
      mediaRec.current = mr;
      mr.start();
      setRecording(true); setRecSecs(0); setLiveBars([]);
      startWave(stream);
      recTimer.current = window.setInterval(() => setRecSecs((s) => s + 1), 1000);
    } catch {
      onSoon("Нет доступа к микрофону. Разрешите доступ в браузере.");
    }
  }
  function stopRec(send: boolean) {
    recCancel.current = !send;
    try { mediaRec.current?.stop(); } catch {  }
  }
  useEffect(() => () => { window.clearInterval(recTimer.current); stopWave(); try { mediaRec.current?.stop(); } catch {  } }, []);

  return (
    <section className={secret ? "thread secret" : "thread"} onDrop={onDrop} onDragOver={onDragOver} onDragLeave={onDragLeave}>
      <AnimatePresence>
        {dragOver && (
          <motion.div className="drop-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="drop-card"><Icon icon={Attachment01Icon} size={34} /><span>Отпустите, чтобы отправить файл</span></div>
          </motion.div>
        )}
      </AnimatePresence>
      {secret && hideSecret && (
        <div className="secret-shield"><Icon icon={SquareLock01Icon} size={40} /><span>Секретный чат скрыт</span><small>защита от подглядывания · вернитесь во вкладку</small></div>
      )}
      {selectMode ? (
        <header className="thread-head select-bar">
          <button className="select-cancel" title="Выйти из режима выделения (Esc)" onClick={exitSelect}>
            <Icon icon={ArrowLeft01Icon} size={18} /> Отмена
          </button>
          <div className="select-count">{selected.size} выбрано</div>
          <div className="thread-actions">
            <button className="select-act" disabled={selected.size === 0} onClick={forwardSelected}>
              <Icon icon={Forward01Icon} size={15} /> Переслать
            </button>
            <button className="select-act danger" disabled={selected.size === 0} onClick={() => setDelModalOpen(true)}>
              <Icon icon={Delete01Icon} size={15} /> Удалить
            </button>
          </div>
        </header>
      ) : (
      <header className="thread-head">
        {mobile && <button className="ic-btn back-btn" title="Назад" onClick={onBack}><Icon icon={ArrowLeft01Icon} /></button>}
        {livePins.length > 0 ? (
          <PinnedBar pinnedIds={livePins} thread={thread} onJump={scrollToMsg} onUnpin={onUnpin} />
        ) : local ? (
          <>
            <span className="thread-saved-ic"><Icon icon={Bookmark01Icon} size={22} /></span>
            <div className="thread-head-info"><div className="thread-head-name">Сохранённые сообщения</div><div className="thread-head-sub"><span className="muted">заметки только для вас</span></div></div>
          </>
        ) : room ? (
          <>
            <span className="room-ava"><Icon icon={UserGroupIcon} size={24} /></span>
            <div className="thread-head-info">
              <div className="thread-head-name">{`# ${contact.name || contact.jid.split("@")[0]}`}</div>
              <div className="thread-head-sub"><button className="room-sub-btn" onClick={onToggleInfo}>{occupants.length} участников{occupants.length ? `: ${occupants.slice(0, 6).map((o) => o.nick).join(", ")}` : ""}</button></div>
            </div>
          </>
        ) : secret ? (
          <>
            <span className="room-ava secret-ava"><Icon icon={SquareLock01Icon} size={22} /></span>
            <div className="thread-head-info">
              <div className="thread-head-name">{contact.name || contact.jid.split("@")[0]}</div>
              <div className="thread-head-sub secret-sub"><Icon icon={SquareLock01Icon} size={12} /> {secretInfo?.established ? "сквозное шифрование" : "устанавливаем шифрование…"}</div>
            </div>
          </>
        ) : mobile ? (

          <div className="thread-head-info">
            <div className="thread-head-name">{contact.name || contact.jid.split("@")[0]}</div>
            <div className="thread-head-sub">{typing ? <span className="typing-text">печатает…</span> : <span className="muted">{contact.presence === "online" ? "в сети" : "не в сети"}</span>}</div>
          </div>
        ) : (

          <div className="thread-head-info empty">{typing ? <span className="typing-text">печатает…</span> : null}</div>
        )}
        <div className="thread-actions">
          <button className={searchOpen ? "ic-btn active" : "ic-btn"} title="Поиск по чату" onClick={() => setSearchOpen((s) => !s)}><Icon icon={Search01Icon} /></button>
          {room && <button className={infoOpen ? "ic-btn active" : "ic-btn"} title="Участники" onClick={onToggleInfo}><Icon icon={UserGroupIcon} /></button>}
          {room && <button className="ic-btn" title="Выйти из группы" onClick={onLeaveRoom}><Icon icon={Logout01Icon} /></button>}
          {secret && (
            <div className="ttl-wrap">
              <button className={ttlMenu ? "ic-btn active" : "ic-btn"} title="Самоуничтожение" onClick={() => setTtlMenu((o) => !o)}><Icon icon={Clock01Icon} /></button>
              {(secretInfo?.ttl || 0) > 0 && <span className="ttl-badge">{ttlLabel(secretInfo!.ttl)}</span>}
              {ttlMenu && (
                <div className="ttl-menu" onClick={(e) => e.stopPropagation()}>
                  <div className="ttl-menu-head">Самоуничтожение</div>
                  {TTL_OPTS.map((o) => (
                    <button key={o.v} className={(secretInfo?.ttl || 0) === o.v ? "active" : ""} onClick={() => { onSetSecretTtl?.(o.v); setTtlMenu(false); }}>{o.l}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          {secret && <button className="ic-btn" title="Удалить секретный чат" onClick={onLeaveSecret}><Icon icon={Logout01Icon} /></button>}
          {!local && !room && !secret && <>
            <button className={fav ? "ic-btn fav" : "ic-btn"} title="В избранное" onClick={onToggleFav}><Icon icon={StarIcon} /></button>
            <button className="ic-btn" title="Аудиозвонок" onClick={() => onCall("audio")}><Icon icon={Call02Icon} /></button>
            <button className={infoOpen ? "ic-btn active" : "ic-btn"} title="Информация" onClick={onToggleInfo}><Icon icon={MoreVerticalIcon} /></button>
          </>}
        </div>
      </header>
      )}

      <AnimatePresence>
        {searchOpen && (
          <motion.div className="thread-search" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            <Icon icon={Search01Icon} size={16} />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск по переписке…" />
            <span className="thread-search-count">{query ? `${shown.length} найдено` : ""}</span>
            <button className="ic-btn sm" onClick={() => { setQuery(""); setSearchOpen(false); }}><Icon icon={Cancel01Icon} size={16} /></button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className={secret ? "thread-body secret-body" : "thread-body"}
        onContextMenu={secret ? (e) => e.preventDefault() : undefined}
        onCopy={secret ? (e) => e.preventDefault() : undefined}
        onDragStart={secret ? (e) => e.preventDefault() : undefined}>
        <div className="thread-wall" />
        <div className={shown.length > 300 ? "messages huge" : "messages"} ref={scrollRef} onScroll={onMessagesScroll}>
          {loadingOlder && <div className="mam-loading">Загружаем историю…</div>}
          {histDone && !loadingOlder && !query && <div className="mam-loading">— начало переписки —</div>}
          {secret && (
            <div className={"secret-notice" + (secretInfo?.idChanged ? " warn" : secretInfo?.verified ? " ok" : "")}>
              <Icon icon={secretInfo?.idChanged ? Alert02Icon : SquareLock01Icon} size={15} />
              {secretInfo?.idChanged ? (
                <span>Ключ собеседника <b>изменился</b> — возможна подмена. Сверьте новый ключ лично{secretInfo?.fingerprint ? `: ${secretInfo.fingerprint}` : ""}.
                  {onVerifySecret && <button className="secret-verify" onClick={onVerifySecret}>Я сверил — подтвердить</button>}
                </span>
              ) : secretInfo?.verified ? (
                <span>Сквозное шифрование{(secretInfo?.ttl || 0) > 0 ? `, исчезает через ${ttlLabel(secretInfo!.ttl)}` : ""}. <Icon icon={Tick01Icon} size={13} className="txt-ic" /> Ключ подтверждён{secretInfo?.fingerprint ? ` (${secretInfo.fingerprint})` : ""}.</span>
              ) : (
                <span>Сквозное шифрование — сервер передаёт только шифртекст{(secretInfo?.ttl || 0) > 0 ? `, сообщения исчезают через ${ttlLabel(secretInfo!.ttl)}` : ""}.{secretInfo?.fingerprint ? ` Сверьте ключ лично: ${secretInfo.fingerprint}` : ""}
                  {onVerifySecret && secretInfo?.fingerprint && <button className="secret-verify" onClick={onVerifySecret}>Подтвердить</button>}
                </span>
              )}
            </div>
          )}
          {thread.length === 0 && (
            <div className="thread-empty">
              {local ? <span className="thread-saved-big"><Icon icon={Bookmark01Icon} size={44} /></span>
                : room ? <span className="room-ava big"><Icon icon={UserGroupIcon} size={44} /></span>
                : secret ? <span className="room-ava big secret-ava"><Icon icon={SquareLock01Icon} size={44} /></span>
                : <Avatar jid={contact.jid} size={72} />}
              <h3>{room ? `# ${contact.name || contact.jid.split("@")[0]}` : contact.name || contact.jid.split("@")[0]}</h3>
              <p>{local ? "Сохраняйте сюда важное — ссылки, заметки, напоминания. Видно только вам."
                : room ? "Это групповой чат на стандарте MUC (XEP-0045). Позовите участников — и общайтесь вместе."
                : secret ? (secretInfo?.established ? <><Icon icon={SquareLock01Icon} size={13} className="txt-ic" /> Секретный чат. Сообщения шифруются end-to-end (сервер видит только шифртекст), есть самоуничтожение и затемнение при сворачивании. Сверьте ключ с собеседником, чтобы исключить подмену.</> : <><Icon icon={SquareLock01Icon} size={13} className="txt-ic" /> Устанавливаем сквозное шифрование… собеседник должен быть в сети.</>)
                : "Это начало вашей переписки. Сообщения идут напрямую через ваш XMPP-сервер."}</p>
            </div>
          )}
          {query && shown.length === 0 && <div className="thread-empty"><p>Ничего не найдено по «{query}».</p></div>}
          {shown.map((m, i) => {
            const prev = shown[i - 1];
            const newDay = !query && (!prev || !sameDay(prev.ts, m.ts));
            const grouped = !query && prev && !newDay && prev.outgoing === m.outgoing && (!room || prev.from === m.from) && m.ts - prev.ts < 60000;

            const cold = shown.length > 300 && i < shown.length - 50 && menuFor !== m.id;
            return (
              <Fragment key={m.id}>
                {newDay && <div className="day-sep"><span>{dayLabel(m.ts)}</span></div>}
                <motion.div data-mid={m.id}
                  initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: "spring", stiffness: 280, damping: 32, mass: 0.9 }}
                  className={`bubble-row ${m.outgoing ? "out" : "in"} ${grouped ? "grouped" : ""}${cold ? " cold" : ""}${selectMode ? " selectable" : ""}${selectMode && selected.has(m.id) ? " selected" : ""}`}
                  onClickCapture={selectMode ? (e) => { e.preventDefault(); e.stopPropagation(); toggleSelect(m.id); } : undefined}>
                  {selectMode && (
                    <span className={selected.has(m.id) ? "sel-check on" : "sel-check"} aria-hidden>
                      {selected.has(m.id) && <Icon icon={Tick01Icon} size={12} color="#fff" />}
                    </span>
                  )}
                  {!m.outgoing && !local && (!grouped ? <Avatar jid={room ? m.from : contact.jid} size={30} /> : <span className="bubble-spacer" />)}
                  <div className="bubble"
                    onContextMenu={!query && !secret && !selectMode ? (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const s = window.getSelection?.();
                      const txt = s && !s.isCollapsed ? s.toString().trim() : "";
                      selRef.current = txt && m.body.includes(txt) ? { id: m.id, text: txt } : null;
                      setMenuPos({ x: e.clientX, y: e.clientY });
                      setMenuFor(m.id);
                    } : undefined}>
                    {!m.outgoing && !local && !grouped && <span className="bubble-name">{room ? m.from : contact.name || contact.jid.split("@")[0]}</span>}
                    {m.reply && (
                      <button className="quote" onClick={() => scrollToMsg(m.reply!.id, m.reply!.quote ? m.reply!.text : undefined)} title={m.reply.quote ? "Перейти к цитате" : "Перейти к сообщению"}>
                        <span className="quote-author">{m.reply.author}</span>
                        <span className="quote-text">{m.reply.text}</span>
                      </button>
                    )}
                    {m.attachment && <AttachmentView att={m.attachment} />}
                    {m.body && (!m.attachment || m.body !== m.attachment.url) && (
                      <span className={m.attachment ? "bubble-body caption" : "bubble-body"}>
                        {renderBody(m.body, highlight?.id === m.id ? highlight.frag : undefined)}
                      </span>
                    )}
                    <span className="bubble-meta">
                      {m.edited && <span className="edited-tag">изм.</span>}
                      <span className="bubble-time">{fmt(m.ts)}</span>
                      {m.outgoing && !local && !room && !secret && (
                        m.read
                          ? <Icon icon={TickDouble01Icon} size={14} className="ticks read" />
                          : m.delivered
                            ? <Icon icon={TickDouble01Icon} size={14} className="ticks delivered" />
                            : <Icon icon={Tick01Icon} size={14} className="ticks" />
                      )}
                    </span>
                    {m.reactions && Object.keys(m.reactions).length > 0 && (
                      <div className="react-chips">
                        {Object.entries(m.reactions).map(([emoji, users]) => (
                          <button key={emoji}
                            className={`react-chip${users.includes("me") ? " mine" : ""}`}
                            title={users.includes("me") ? "Убрать реакцию" : "Поставить реакцию"}
                            onClick={(e) => { e.stopPropagation(); onReact?.(m.id, emoji); }}>
                            {emoji}{users.length > 1 ? ` ${users.length}` : ""}
                          </button>
                        ))}
                      </div>
                    )}
                    {!query && !selectMode && (
                      <button className="msg-more" title="Действия" onClick={(e) => {
                        e.stopPropagation();
                        const s = window.getSelection?.();
                        const txt = s && !s.isCollapsed ? s.toString().trim() : "";
                        selRef.current = txt && m.body.includes(txt) ? { id: m.id, text: txt } : null;

                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setMenuPos({ x: m.outgoing ? r.right - 190 : r.left, y: r.bottom + 6 });
                        setMenuFor(menuFor === m.id ? null : m.id);
                      }}>
                        <Icon icon={MoreHorizontalIcon} size={15} />
                      </button>
                    )}
                    <AnimatePresence>
                      {menuFor === m.id && (() => {
                        const canReact = !!onReact && !secret && !room && !local;

                        let posStyle: React.CSSProperties | undefined;
                        if (menuPos) {
                          const MENU_W = 190, ITEM_H = 33, PAD = 12, REACT_ROW_H = 42;
                          const items =
                            (!local && !secret ? 1 : 0) +
                            (!room && !secret && m.outgoing && !m.attachment ? 1 : 0) +
                            (onPin && !secret ? 1 : 0) +
                            (m.body && !secret ? 1 : 0) +
                            (!secret ? 2 : 0) +
                            (!room && !secret && !local && m.outgoing ? 1 : 0) +
                            1;
                          const menuH = items * ITEM_H + PAD + (canReact ? REACT_ROW_H : 0);
                          posStyle = {
                            left: Math.max(8, Math.min(menuPos.x, window.innerWidth - MENU_W - 8)),
                            top: Math.max(8, Math.min(menuPos.y, window.innerHeight - menuH - 8)),
                          };
                        }
                        return (
                        <motion.div className={`msg-menu ${menuPos ? "at-cursor" : m.outgoing ? "right" : "left"}`} style={posStyle} onClick={(e) => e.stopPropagation()}
                          initial={{ opacity: 0, scale: 0.92, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.92 }}>
                          {canReact && (
                            <div className="react-row">
                              {QUICK_REACTIONS.map((e) => (
                                <button key={e} title="Реакция" onClick={() => { onReact!(m.id, e); setMenuFor(null); setMenuPos(null); }}>{e}</button>
                              ))}
                            </div>
                          )}
                          {!local && !secret && <button onClick={() => startReply(m)}><Icon icon={ArrowTurnBackwardIcon} size={15} /> Ответить</button>}
                          {!room && !secret && m.outgoing && !m.attachment && <button onClick={() => startEdit(m)}><Icon icon={PencilEdit01Icon} size={15} /> Изменить</button>}
                          {onPin && !secret && (pinnedIds?.includes(m.id)
                            ? <button onClick={() => { setMenuFor(null); onUnpin?.(m.id); }}><Icon icon={PinOffIcon} size={15} /> Открепить</button>
                            : <button onClick={() => { setMenuFor(null); onPin(m.id); }}><Icon icon={PinIcon} size={15} /> Закрепить</button>)}
                          {!!m.body && !secret && <button onClick={() => { navigator.clipboard?.writeText(m.body); onSoon("Скопировано"); setMenuFor(null); setMenuPos(null); }}><Icon icon={Copy01Icon} size={15} /> Копировать текст</button>}
                          {!secret && <button onClick={() => { setMenuFor(null); setMenuPos(null); onForward?.(m); }}><Icon icon={Forward01Icon} size={15} /> Переслать</button>}
                          {!room && !secret && !local && m.outgoing && <button className="danger" onClick={() => retract(m)}><Icon icon={Delete01Icon} size={15} /> Удалить у всех</button>}
                          <button className={local || room ? "danger" : ""} onClick={() => delLocal(m)}><Icon icon={Cancel01Icon} size={15} /> {local || room ? "Удалить" : "Удалить у себя"}</button>
                          {!secret && <button onClick={() => { setMenuFor(null); setMenuPos(null); setSelectMode(true); setSelected(new Set([m.id])); }}><Icon icon={CheckmarkSquare02Icon} size={15} /> Выделить</button>}
                        </motion.div>
                        );
                      })()}
                    </AnimatePresence>
                  </div>
                </motion.div>
              </Fragment>
            );
          })}
          <AnimatePresence>
            {typing && !query && (
              <motion.div className="bubble-row in" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <Avatar jid={contact.jid} size={30} />
                <TypingDots />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {(reqStatus === "out" || reqStatus === "in") && (
        <div className={reqStatus === "in" ? "req-gate incoming" : "req-gate outgoing"}>
          {reqStatus === "out" ? (
            <><Icon icon={Clock01Icon} size={17} /><span className="req-gate-txt"><b>Запрос отправлен.</b> Переписка откроется, когда собеседник подтвердит.</span></>
          ) : (
            <>
              <span className="req-gate-txt"><b>{contact.name || contact.jid.split("@")[0]}</b> хочет начать с вами чат</span>
              <span className="req-gate-actions">
                <button className="req-accept" onClick={onAcceptReq}>Принять</button>
                <button className="req-decline" onClick={onDeclineReq}>Отклонить</button>
              </span>
            </>
          )}
        </div>
      )}

      <div className="composer" hidden={reqStatus === "out" || reqStatus === "in"}>
        {editing && (
          <div className="edit-banner">
            <Icon icon={PencilEdit01Icon} size={16} />
            <div className="edit-banner-txt"><b>Редактирование</b><span>{editing.body}</span></div>
            <button className="ic-btn sm" title="Отменить" onClick={cancelEdit}><Icon icon={Cancel01Icon} size={16} /></button>
          </div>
        )}
        {replying && !editing && (
          <div className="edit-banner reply">
            <Icon icon={QuoteDownIcon} size={16} />
            <div className="edit-banner-txt"><b>{replying.quote ? "Цитата" : "Ответ"} · {replying.author}</b><span>{replying.text}</span></div>
            <button className="ic-btn sm" title="Отменить" onClick={() => setReplying(null)}><Icon icon={Cancel01Icon} size={16} /></button>
          </div>
        )}
        {forwardPreview && forwardPreview.length > 0 && (
          <div className="edit-banner forward">
            <Icon icon={Forward01Icon} size={16} />
            <div className="edit-banner-txt">
              <b>Переслать{forwardPreview.length > 1 ? `: ${forwardPreview.length} сообщ.` : ""}</b>
              <span>{msgPreview(forwardPreview[0])}{forwardPreview.length > 1 ? " …" : ""}</span>
            </div>
            <button className="ic-btn sm" title="Отменить пересылку" onClick={onCancelForward}><Icon icon={Cancel01Icon} size={16} /></button>
          </div>
        )}
        {pending && (
          <div className="attach-preview">
            {pending.isImage
              ? <img className="attach-preview-img" src={pending.previewUrl} alt="" />
              : <span className="attach-preview-ic"><Icon icon={Attachment01Icon} size={22} /></span>}
            <div className="edit-banner-txt"><b>{pending.isImage ? "Фото" : pending.name}</b><span>Добавьте подпись (необязательно) и отправьте</span></div>
            <button className="ic-btn sm" title="Убрать" onClick={() => { if (pending.previewUrl) URL.revokeObjectURL(pending.previewUrl); setPending(null); }}><Icon icon={Cancel01Icon} size={16} /></button>
          </div>
        )}
        <AnimatePresence>
          {cmdMatches.length > 0 && (
            <motion.div className="cmd-pop" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
              {cmdMatches.map((c) => (
                <button key={c.cmd} onClick={() => { setDraft(c.cmd + " "); taRef.current?.focus(); }}>
                  <b>{c.cmd}</b><span>{c.desc}</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
        <div className="composer-row">
          {recording ? (
            <div className="rec-strip">
              <button className="comp-ic danger" title="Отменить запись" onClick={() => stopRec(false)}><Icon icon={Cancel01Icon} size={18} /></button>
              <span className="rec-dot" />
              <span className="rec-time">{mmss(recSecs)}</span>
              <div className="rec-wave">
                {liveBars.map((v, i) => <span key={i} style={{ height: `${Math.round(v * 100)}%` }} />)}
              </div>
              <span className="rec-hint">→ отправить</span>
            </div>
          ) : (
            <>
              <div className="comp-emoji-wrap">
                <AnimatePresence>
                  {emojiOpen && (
                    <motion.div className="emoji-pop" initial={{ opacity: 0, y: 8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.96 }}>
                      {EMOJIS.map((e) => (
                        <button key={e} onClick={() => { setDraft((d) => d + e); }}>{e}</button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
                <button className="comp-ic plus" title={uploading ? "Загрузка…" : "Прикрепить файл"} disabled={uploading}
                  onClick={() => (local || room ? onSoon("Вложения — в личных чатах.") : fileRef.current?.click())}>
                  <Icon icon={Add01Icon} size={20} />
                </button>
              </div>
              <textarea ref={taRef} value={draft} onChange={(e) => onDraft(e.target.value)} onPaste={onPaste}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { if (forwardPreview?.length) { onCancelForward?.(); return; } if (pending) { if (pending.previewUrl) URL.revokeObjectURL(pending.previewUrl); setPending(null); return; } if (editing) { cancelEdit(); return; } if (replying) { setReplying(null); return; } }
                  if (e.key === "Enter" && !e.shiftKey) {
                    if (cmdMatches.length) { e.preventDefault(); setDraft(cmdMatches[0].cmd + " "); return; }
                    e.preventDefault(); send();
                  }
                }}
                rows={1} placeholder={uploading ? "Загрузка файла…" : forwardPreview?.length ? "Добавить сообщение (необязательно)…" : pending ? (pending.isImage ? "Подпись к фото…" : "Подпись к файлу…") : "Напишите сообщение…"} />
              <button className={emojiOpen ? "comp-ic active" : "comp-ic"} title="Эмодзи" onClick={() => setEmojiOpen((o) => !o)}><Icon icon={SmileIcon} size={18} /></button>
              <button className="comp-ic" title={uploading ? "Загрузка…" : "Прикрепить файл"} disabled={uploading}
                onClick={() => (local || room ? onSoon("Вложения — в личных чатах.") : fileRef.current?.click())}>
                <Icon icon={Attachment01Icon} size={18} />
              </button>
            </>
          )}
          <motion.button className={recording ? "comp-send recording" : "comp-send"} whileTap={{ scale: 0.9 }} whileHover={{ scale: 1.06 }}
            disabled={uploading}
            onClick={() => { if (recording) stopRec(true); else if (forwardPreview?.length || pending || draft.trim()) send(); else if (!local && !room) startRec(); else onSoon("Голосовые — в личных чатах."); }}
            title={recording ? "Отправить голосовое" : (forwardPreview?.length || pending || draft.trim()) ? "Отправить" : "Записать голосовое"}>
            <Icon icon={recording || forwardPreview?.length || pending || draft.trim() ? SentIcon : Mic01Icon} size={17} color="#fff" />
          </motion.button>
          <input ref={fileRef} type="file" hidden onChange={onFilePicked} />
        </div>
      </div>

      {delModalOpen && (
        <div className="modal-overlay" onClick={() => setDelModalOpen(false)}>
          <div className="modal del-confirm" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3>{selected.size === 1 ? "Удалить сообщение?" : `Удалить ${selected.size} ${msgsWord(selected.size)}?`}</h3>
            {!canRetractAll && (
              <p className="del-confirm-hint">«Удалить у всех» доступно только для своих сообщений в личных чатах</p>
            )}
            <div className="del-confirm-actions">
              <button onClick={deleteSelected}><Icon icon={Cancel01Icon} size={15} /> Удалить у себя</button>
              {canRetractAll && (
                <button className="danger" onClick={retractSelected}><Icon icon={Delete01Icon} size={15} /> Удалить у всех</button>
              )}
              <button className="ghost" onClick={() => setDelModalOpen(false)}>Отмена</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
