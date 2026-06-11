import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence, animate } from "framer-motion";
import { api } from "../api";
import type { AdminSession } from "../types";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { Home01Icon, Delete02Icon, RefreshIcon } from "@hugeicons/core-free-icons";

function CountUp({ value, suffix = "", className }: { value: number; suffix?: string; className?: string }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const controls = animate(display, value, { duration: 0.7, ease: "easeOut", onUpdate: (v) => setDisplay(Math.round(v)) });
    return () => controls.stop();

  }, [value]);
  return <span className={className}>{display}{suffix}</span>;
}

function flag(cc?: string | null) {
  if (!cc || cc.length !== 2) return "";
  return cc.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}
function fmtUptime(s: number) {
  if (s < 60) return `${s} с`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  return `${h} ч ${m % 60} мин`;
}
function fmtLast(ts: number | null) {
  if (!ts) return "—";
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "только что";
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} дн назад`;
  return new Date(ts).toLocaleDateString("ru-RU");
}

type Tab = "active" | "offline" | "all";

export function AdminPanel({ selfJid, onOpenChat }: { selfJid: string; onOpenChat: (jid: string) => void }) {
  const [users, setUsers] = useState<AdminSession[]>([]);
  const [total, setTotal] = useState(0);
  const [online, setOnline] = useState(0);
  const [offline, setOffline] = useState(0);
  const [err, setErr] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<Tab>("active");
  const [confirmJid, setConfirmJid] = useState<string>();
  const [actionErr, setActionErr] = useState<string>();

  const inFlight = useRef(false);
  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const data = await api.adminSessions();
      setUsers(data.users);
      setTotal(data.total);
      setOnline(data.onlineCount);
      setOffline(data.offlineCount);
      setErr(undefined);
    } catch (e: any) {
      setErr(e.message || "Не удалось загрузить");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function remove(username: string) {
    setActionErr(undefined);
    try {
      await api.deleteUser(username);
      setConfirmJid(undefined);
      load();
    } catch (e: any) {
      setActionErr(e.message || "Не удалось удалить");
    }
  }

  const byTab = users.filter((u) => (tab === "active" ? u.online : tab === "offline" ? !u.online : true));
  const filtered = byTab.filter((u) => (q ? u.username.toLowerCase().includes(q.toLowerCase()) : true));
  const activity = total ? Math.round((online / total) * 100) : 0;

  return (
    <div className="admin">
      <header className="admin-head">
        <div>
          <h2>Админ-панель</h2>
          <p className="muted">Пользователи сервера: вход по IP с городом и страной, активные и офлайн</p>
        </div>
        <motion.button className="ghost-btn with-ic" onClick={load} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}><Icon icon={RefreshIcon} size={15} /> Обновить</motion.button>
      </header>

      <motion.div className="stat-grid"
        variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.08 } } }} initial="hidden" animate="visible">
        {[
          { num: <CountUp value={total} />, label: "Всего аккаунтов" },
          { num: <CountUp value={online} className="grad-text" />, label: "Сейчас в сети" },
          { num: <CountUp value={offline} />, label: "Офлайн" },
          { num: <CountUp value={activity} suffix="%" />, label: "Активность" },
        ].map((s, i) => (
          <motion.div key={i} className="stat-card"
            variants={{ hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0 } }} whileHover={{ y: -3 }}>
            <div className="stat-num">{s.num}</div>
            <div className="stat-label">{s.label}</div>
          </motion.div>
        ))}
      </motion.div>

      <div className="admin-tabs">
        {([
          { k: "active", label: "Активные", cnt: online },
          { k: "offline", label: "Офлайн", cnt: offline },
          { k: "all", label: "Все", cnt: total },
        ] as { k: Tab; label: string; cnt: number }[]).map((t) => (
          <button key={t.k} className={`admin-tab${tab === t.k ? " active" : ""}${t.k === "active" ? " on-tab" : ""}`} onClick={() => setTab(t.k)}>
            {t.k === "active" && <span className="status-dot-mini" />}{t.label}<span className="cnt">{t.cnt}</span>
          </button>
        ))}
      </div>

      <div className="admin-search">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск пользователя…" />
      </div>

      <AnimatePresence>
        {(err || actionErr) && (
          <motion.div className="banner err" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            {err || actionErr}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="user-table">
        <div className="user-row header">
          <span>Пользователь</span>
          <span>Статус</span>
          <span>IP-адрес</span>
          <span>Местоположение</span>
          <span>Активность</span>
          <span></span>
        </div>

        {loading && users.length === 0 ? (
          [...Array(5)].map((_, i) => (
            <div className="sk-row" key={i}>
              <div style={{ display: "flex", gap: 11, alignItems: "center" }}><div className="sk av" /><div className="sk" style={{ width: 80 }} /></div>
              <div className="sk" style={{ width: 56 }} /><div className="sk" style={{ width: 100 }} />
              <div className="sk" style={{ width: 120 }} /><div className="sk" style={{ width: 70 }} /><div className="sk" style={{ width: 50 }} />
            </div>
          ))
        ) : (
          <AnimatePresence initial={false}>
            {filtered.map((u) => (
              <motion.div className="user-row" key={u.jid} layout
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <div className="user-cell">
                  <Avatar jid={u.jid} size={34} presence={u.online ? "online" : "offline"} />
                  <span className="user-name">{u.username}{u.jid === selfJid && <span className="you-tag">вы</span>}</span>
                </div>
                <span><span className={`status-badge ${u.online ? "on" : "off"}`}>{u.online ? "в сети" : "офлайн"}</span></span>
                <span className="ip-mono">{u.ip || "—"}</span>
                <span>
                  {u.location === "Локальная сеть" ? (
                    <span className="loc-local"><Icon icon={Home01Icon} size={14} /> Локальная сеть</span>
                  ) : u.city || u.country ? (
                    <span className="loc-cell"><span className="geo-flag">{flag(u.countryCode)}</span>{u.location}</span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </span>
                <span className="activity-cell">
                  {u.online
                    ? <>{u.devices > 1 && <span className="dev-pill">{u.devices} устр.</span>} в сети {fmtUptime(u.uptime)}</>
                    : `был(а) ${fmtLast(u.lastSeenTs)}`}
                </span>
                <span className="row-actions">
                  {u.jid !== selfJid && (
                    confirmJid === u.jid ? (
                      <>
                        <button className="link-btn danger" onClick={() => remove(u.username)}>удалить</button>
                        <button className="link-btn" onClick={() => setConfirmJid(undefined)}>отмена</button>
                      </>
                    ) : (
                      <>
                        <button className="link-btn" onClick={() => onOpenChat(u.jid)}>написать →</button>
                        <button className="link-btn muted-btn" title="Удалить аккаунт" onClick={() => setConfirmJid(u.jid)}><Icon icon={Delete02Icon} size={15} /></button>
                      </>
                    )
                  )}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
        )}

        {!loading && filtered.length === 0 && (
          <div className="muted" style={{ padding: 16 }}>{q ? "Ничего не найдено" : tab === "active" ? "Сейчас никого нет в сети" : "Пусто"}</div>
        )}
      </div>
    </div>
  );
}
