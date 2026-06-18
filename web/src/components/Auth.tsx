import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CONFIG } from "../config";
import type { ConnState } from "../types";
import { api } from "../api";
import { Logo } from "./Logo";

const container = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.05 } },
};
const item = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
};

export function Auth({
  state,
  detail,
  reconnecting,
  onLogin,
}: {
  state: ConnState;
  detail?: string;
  reconnecting?: boolean;
  onLogin: (u: string, p: string, server: { id: string; ws: string; domain: string }, remember: boolean) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [serverId, setServerId] = useState(CONFIG.SERVERS[0].id);
  const [busy, setBusy] = useState(false);
  const [remember, setRemember] = useState(true);
  const [notice, setNotice] = useState<string>();
  const server = CONFIG.SERVERS.find((s) => s.id === serverId) || CONFIG.SERVERS[0];

  const connecting = state === "connecting";
  const authfail = state === "authfail";
  const connError = state === "error";
  const shake = authfail || connError;

  const enteredUser = username.trim().toLowerCase();
  const LOCAL_ACCOUNTS = ["alice", "bob", "admin", "hubx-bot"];
  let wrongServerHint: string | undefined;
  if (server.id !== "local" && LOCAL_ACCOUNTS.includes(enteredUser)) {
    wrongServerHint = `Аккаунт «${enteredUser}» зарегистрирован на основном сервере — выберите "HubX · основной" в списке серверов.`;
  } else if (server.id === "local" && enteredUser === "anna") {
    wrongServerHint = `Аккаунт «anna» живёт на узле A — выберите "HubX · узел A" в списке серверов.`;
  } else if (server.id === "local" && enteredUser === "boris") {
    wrongServerHint = `Аккаунт «boris» живёт на узле B — выберите "HubX · узел B" в списке серверов.`;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setNotice(undefined);
    const u = username.trim().toLowerCase();
    if (!u || !password) return;

    if (mode === "register") {
      if (server.id !== "local") {
        setNotice("Регистрация — на основном сервере. На серверах A/B используйте готовые аккаунты (anna / boris).");
        return;
      }
      if (u.includes("@") || /[а-я]/i.test(u)) {
        setNotice("Логин — без почты и @. Только латиница, цифры, точка, дефис, подчёркивание.");
        return;
      }
      if (!/^[a-z0-9._-]{2,32}$/.test(u)) {
        setNotice("Логин: 2–32 символа, латиница/цифры и . _ -");
        return;
      }
      if (password.length < 8) {
        setNotice("Пароль — минимум 8 символов.");
        return;
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
        setNotice("Введите корректный e-mail.");
        return;
      }
      setBusy(true);
      try {
        await api.register(u, password, email.trim());
        setNotice("Аккаунт создан, подключаемся…");
        onLogin(u, password, server, remember);
      } catch (err: any) {
        setNotice(err.message || "Не удалось зарегистрировать");
      } finally {
        setBusy(false);
      }
    } else {
      onLogin(u, password, server, remember);
    }
  }

  if (reconnecting) {
    return (
      <div className="auth-screen reconnect">
        <div className="auth-grid" />
        <motion.div className="reconnect-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <Logo size={40} />
          <div className="reconnect-spinner" />
          <h2>Соединение потеряно</h2>
          <p>Сервер недоступен — автоматически переподключаемся…<br />История сообщений сохранена.</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <motion.div
        className="auth-aurora"
        animate={{ y: [0, 36, 0], scale: [1, 1.05, 1] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="auth-grid" />

      <motion.div
        className="auth-left"
        variants={container}
        initial="hidden"
        animate="visible"
      >
        <motion.div className="hero-kicker" variants={item}>
          Мессенджер, в котором <span className="shimmer">вы — сеть</span>.
        </motion.div>
        <motion.h1 className="hero-title" variants={item}>
          Сообщения, которые
          <br />
          <span className="shimmer">нельзя отключить</span>
        </motion.h1>
        <motion.p className="hero-sub" variants={item}>
<span className="shimmer">Открытый стандарт</span> XMPP, собственный сервер и переписка, которая принадлежит <span className="shimmer">только вам</span> — без облаков, без посредников, без рубильника у чужой корпорации.
        </motion.p>
        <motion.ul className="hero-points" variants={container}>
          {[
            { k: "1", w: "Децентрализация", t: ": серверы общаются как электронная почта" },
            { k: "2", w: "Совместимость", t: " с любым XMPP-клиентом" },
            { k: "3", w: "Полный контроль", t: ": разверните на своём железе" },
          ].map((it) => (
            <motion.li key={it.k} variants={item}>
              <span className="dot" /> <span className="shimmer">{it.w}</span>{it.t}
            </motion.li>
          ))}
        </motion.ul>
      </motion.div>

      <div className="auth-card-wrap">
        <motion.div
          className="auth-card"
          initial={{ opacity: 0, y: 28, scale: 0.98 }}
          animate={
            shake
              ? { opacity: 1, y: 0, scale: 1, x: [0, -9, 9, -7, 7, 0] }
              : { opacity: 1, y: 0, scale: 1 }
          }
          transition={shake ? { x: { duration: 0.4 } } : { type: "spring", stiffness: 260, damping: 26 }}
        >
          <div className="auth-card-logo"><Logo size={56} withWordmark={false} /></div>
          <div className="auth-tabs">
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                className={mode === m ? "tab active" : "tab"}
                onClick={() => { setMode(m); setNotice(undefined); }}
              >
                {mode === m && <span className="tab-pill" />}
                <span style={{ position: "relative", zIndex: 1 }}>
                  {m === "login" ? "Вход" : "Регистрация"}
                </span>
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="auth-form">
            <label className="field">
              <span>{mode === "register" ? "Придумайте логин" : "Имя пользователя"}</span>
              <div className="input-jid">
                <input
                  autoFocus
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="ivan"
                  autoComplete="username"
                />
                <span className="domain">@{server.domain}</span>
              </div>
              {mode === "register" && (
                <span className="muted" style={{ fontSize: 12 }}>
                  Только латиница, цифры и . _ - · без @ и почты. E-mail укажете ниже.
                </span>
              )}
            </label>

            <label className="field">
              <span>Сервер</span>
              <select className="server-select" value={serverId} onChange={(e) => setServerId(e.target.value)}>
                {CONFIG.SERVERS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <span className="muted" style={{ fontSize: 12 }}>
                Демо-аккаунты этого сервера: {server.demo.map(([u, p]) => `${u} / ${p}`).join(", ")}
              </span>
            </label>

            <label className="field">
              <span>Пароль</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </label>

            {mode === "register" && server.id === "local" && (
              <label className="field">
                <span>E-mail</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@mail.com" autoComplete="email" />
              </label>
            )}

            <AnimatePresence mode="wait">
              {authfail && (
                <motion.div key="authfail" className="banner err"
                  initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                  Неверное имя пользователя или пароль{wrongServerHint ? `. ${wrongServerHint}` : ""}
                </motion.div>
              )}
              {connError && (
                <motion.div key="connerr" className="banner err"
                  initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                  Нет связи с сервером{detail ? ` (${detail})` : ""}. Запущен ли ejabberd?
                </motion.div>
              )}
              {notice && (
                <motion.div key="notice" className="banner info"
                  initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                  {notice}
                </motion.div>
              )}
            </AnimatePresence>

            <label className="remember-row">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span>Запомнить меня на этом устройстве</span>
            </label>

            <motion.button
              className="btn-primary"
              disabled={busy || connecting}
              whileHover={{ scale: 1.02, y: -1 }}
              whileTap={{ scale: 0.97 }}
            >
              {connecting ? "Подключение…" : busy ? "Создание…" : mode === "login" ? "Войти" : "Создать аккаунт"}
              {!connecting && !busy && (
                <motion.span className="arrow" initial={{ x: 0 }} whileHover={{ x: 3 }}>→</motion.span>
              )}
            </motion.button>
          </form>

          <div className="auth-foot">
            <span className="muted">Демо-аккаунты:</span>
            {server.demo.map(([u, p]) => (
              <motion.button
                key={u}
                className="chip"
                type="button"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => { setUsername(u); setPassword(p); setMode("login"); }}
              >
                {u} / {p}
              </motion.button>
            ))}
            {server.id === "local" && CONFIG.IS_LOCAL && (
              <motion.button
                key="admin"
                className="chip chip-admin"
                type="button"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => {
                  const [u, p] = CONFIG.ADMIN_DEMO;
                  setUsername(u);
                  setPassword(p);
                  setMode("login");
                }}
                title="Демо-вход администратора · открывает админ-панель · доступно только локально"
              >
                {CONFIG.ADMIN_DEMO[0]} / {CONFIG.ADMIN_DEMO[1]}
              </motion.button>
            )}
          </div>
        </motion.div>
        <p className="auth-legal"><span className="shimmer">{CONFIG.BRAND}</span> • XMPP / ejabberd • открытый протокол</p>
      </div>
    </div>
  );
}
