import { forwardRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { ChatMessage, Contact, Presence } from "../types";
import { msgPreview } from "../types";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { Search01Icon, FilterHorizontalIcon, Bookmark01Icon, PencilEdit02Icon, UserGroupIcon, SquareLock01Icon, StarIcon } from "@hugeicons/core-free-icons";
import { CONFIG } from "../config";
import { NetworkStatus } from "./NetworkStatus";

const PRESENCE_LABEL: Record<Presence, string> = {
  online: "в сети", away: "отошёл", dnd: "не беспокоить", offline: "не в сети",
};

export type Conversation = { contact: Contact; last?: ChatMessage; unread: number; fav: boolean };
export type MessageMatch = { id: string; jid: string; name: string; body: string; outgoing: boolean; ts: number };
type Tab = "all" | "unread" | "fav";
const time = (ts?: number) => (ts ? new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
const isBot = (jid: string) => jid.split("@")[0] === CONFIG.BOT_USER;

function highlight(text: string, q: string) {
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return text;
  return <>{text.slice(0, idx)}<mark className="hl">{text.slice(idx, idx + q.length)}</mark>{text.slice(idx + q.length)}</>;
}

export const ChatList = forwardRef<HTMLInputElement, {
  conversations: Conversation[];
  saved?: Conversation;
  messageMatches?: MessageMatch[];
  activeJid: string;
  tab: Tab;
  search: string;
  onlineOnly: boolean;
  onTab: (t: Tab) => void;
  onSearch: (v: string) => void;
  onToggleOnline: () => void;
  onSelect: (jid: string) => void;
  onNewChat: () => void;
  onNewSecret?: () => void;
  requests?: string[];
  onAcceptRequest?: (jid: string) => void;
  onDeclineRequest?: (jid: string) => void;
  dirResults?: { username: string; jid: string; online: boolean }[];
  onOpenDirUser?: (username: string) => void;
}>(function ChatList(
  { conversations, saved, messageMatches = [], activeJid, tab, search, onlineOnly, onTab, onSearch, onToggleOnline, onSelect, onNewChat, onNewSecret, requests = [], onAcceptRequest, onDeclineRequest, dirResults = [], onOpenDirUser }, ref
) {
  const q = search.trim();
  const tabs: { k: Tab; label: string }[] = [
    { k: "all", label: "Все" }, { k: "unread", label: "Непрочитанные" }, { k: "fav", label: "Избранные" },
  ];
  const noMatch = search && !conversations.some((c) => c.contact.jid.split("@")[0] === search.toLowerCase());
  const showSaved = saved && tab !== "unread" && (!search || "сохранённые сообщения".includes(search.toLowerCase()));

  const grouped = tab === "all" && !search;
  const pinned = conversations.filter((c) => c.fav);
  const bots = conversations.filter((c) => !c.fav && isBot(c.contact.jid));
  const rest = conversations.filter((c) => !c.fav && !isBot(c.contact.jid));

  function Row({ contact, last, unread, fav }: Conversation) {
    return (
      <motion.button key={contact.jid} layout
        initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -14 }}
        className={contact.jid === activeJid ? "cl-row active" : "cl-row"} onClick={() => onSelect(contact.jid)}>
        {contact.isSecret ? <span className="room-ava sm secret-ava"><Icon icon={SquareLock01Icon} size={22} /></span>
          : contact.isRoom ? <span className="room-ava sm"><Icon icon={UserGroupIcon} size={22} /></span>
          : <Avatar jid={contact.jid} size={46} presence={contact.presence} />}
        <div className="cl-row-text">
          <div className="cl-row-top">
            <span className="cl-row-name">{contact.name || contact.jid.split("@")[0]}{fav && <span className="cl-fav"><Icon icon={StarIcon} size={12} strokeWidth={2.2} /></span>}</span>
            <span className="cl-row-time">{time(last?.ts)}</span>
          </div>
          <div className="cl-row-bottom">
            <span className="cl-row-prev">
              {last ? <>{last.outgoing && <span className="muted">Вы: </span>}{msgPreview(last)}</> : <span className="muted">{PRESENCE_LABEL[contact.presence]}</span>}
            </span>
            {unread > 0 && <span className="cl-badge">{unread}</span>}
          </div>
        </div>
      </motion.button>
    );
  }

  return (
    <div className="chatlist">
      <NetworkStatus />
      <div className="cl-search">
        <span className="cl-search-ic"><Icon icon={Search01Icon} size={17} /></span>
        <input ref={ref} value={search} onChange={(e) => onSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onNewChat()} placeholder="Поиск по чатам и контактам" />
        <button className={onlineOnly ? "cl-filter active" : "cl-filter"} title="Только онлайн" onClick={onToggleOnline}>
          <Icon icon={FilterHorizontalIcon} size={17} />
        </button>
      </div>

      <div className="cl-tabs">
        {tabs.map((t) => (
          <button key={t.k} className={tab === t.k ? "cl-tab active" : "cl-tab"} onClick={() => onTab(t.k)}>
            {t.label}
            {tab === t.k && <motion.span className="cl-tab-underline" layoutId="clTab" transition={{ type: "spring", stiffness: 300, damping: 34 }} />}
          </button>
        ))}
      </div>

      {requests.length > 0 && (
        <div className="cl-requests">
          <div className="cl-requests-head">Запросы на чат · {requests.length}</div>
          {requests.map((jid) => (
            <div key={jid} className="cl-req">
              <Avatar jid={jid} size={38} />
              <div className="cl-req-info">
                <div className="cl-req-name">{jid.split("@")[0]}</div>
                <div className="cl-req-sub">{jid} · хочет начать чат</div>
              </div>
              <button className="cl-req-ok" onClick={() => onAcceptRequest?.(jid)}>Принять</button>
              <button className="cl-req-no" onClick={() => onDeclineRequest?.(jid)}>Отклонить</button>
            </div>
          ))}
        </div>
      )}

      {dirResults.length > 0 && (
        <div className="cl-dir">
          <div className="cl-requests-head">Найдено на сервере · {dirResults.length}</div>
          {dirResults.map((u) => (
            <button key={u.jid} className="cl-dir-row" onClick={() => onOpenDirUser?.(u.username)}>
              <Avatar jid={u.jid} size={36} presence={u.online ? "online" : "offline"} />
              <span className="cl-dir-info"><span className="cl-dir-name">{u.username}</span><span className="cl-dir-jid">{u.jid}</span></span>
              <span className="cl-dir-go">Чат →</span>
            </button>
          ))}
        </div>
      )}

      <AnimatePresence>
        {noMatch && (
          <motion.button key="newchat" className="cl-newcta" onClick={onNewChat}
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <Icon icon={PencilEdit02Icon} size={15} /> Начать чат с «{search.trim()}»
          </motion.button>
        )}
        {q && onNewSecret && (
          <motion.button key="newsecret" className="cl-newcta secret" onClick={onNewSecret}
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <Icon icon={SquareLock01Icon} size={15} /> Секретный чат с «{q}»
          </motion.button>
        )}
      </AnimatePresence>

      <div className="cl-list">
        {showSaved && (
          <button className={activeJid === "__saved__" ? "cl-row saved active" : "cl-row saved"} onClick={() => onSelect("__saved__")}>
            <span className="cl-saved-ic"><Icon icon={Bookmark01Icon} size={22} /></span>
            <div className="cl-row-text">
              <div className="cl-row-top"><span className="cl-row-name">Сохранённые сообщения</span><span className="cl-row-time">{time(saved!.last?.ts)}</span></div>
              <div className="cl-row-bottom"><span className="cl-row-prev">{saved!.last ? msgPreview(saved!.last) : <span className="muted">заметки только для вас</span>}</span></div>
            </div>
          </button>
        )}

        {conversations.length === 0 && !showSaved && !q && (
          <div className="cl-empty">
            {tab === "unread" ? "Нет непрочитанных." : tab === "fav" ? "Нет избранных чатов." : "Пока нет диалогов. Введите имя выше и нажмите Enter."}
          </div>
        )}

        {q && conversations.length > 0 && <div className="sec-head">Чаты</div>}
        {grouped ? (
          <>
            {pinned.length > 0 && <div className="sec-head">Закреплённые</div>}
            <AnimatePresence initial={false}>{pinned.map((c) => Row(c))}</AnimatePresence>
            {bots.length > 0 && <div className="sec-head">Боты и каналы</div>}
            <AnimatePresence initial={false}>{bots.map((c) => Row(c))}</AnimatePresence>
            {rest.length > 0 && <div className="sec-head">Все сообщения</div>}
            <AnimatePresence initial={false}>{rest.map((c) => Row(c))}</AnimatePresence>
          </>
        ) : (
          <AnimatePresence initial={false}>{conversations.map((c) => Row(c))}</AnimatePresence>
        )}

        {q && messageMatches.length > 0 && (
          <>
            <div className="sec-head">Сообщения</div>
            {messageMatches.map((mm) => (
              <button key={mm.id} className="cl-row" onClick={() => onSelect(mm.jid)}>
                {mm.jid === "__saved__"
                  ? <span className="cl-saved-ic"><Icon icon={Bookmark01Icon} size={22} /></span>
                  : <Avatar jid={mm.jid} size={46} />}
                <div className="cl-row-text">
                  <div className="cl-row-top"><span className="cl-row-name">{mm.name}</span><span className="cl-row-time">{time(mm.ts)}</span></div>
                  <div className="cl-row-bottom"><span className="cl-row-prev">{mm.outgoing && <span className="muted">Вы: </span>}{highlight(mm.body, q)}</span></div>
                </div>
              </button>
            ))}
          </>
        )}

        {q && conversations.length === 0 && messageMatches.length === 0 && !showSaved && (
          <div className="cl-empty">Ничего не найдено по «{q}».</div>
        )}
      </div>
    </div>
  );
});
