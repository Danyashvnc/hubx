import { motion } from "framer-motion";
import { CONFIG } from "../config";
import type { Presence } from "../types";
import { StatusMenu } from "./StatusMenu";
import { Icon } from "./Icon";
import { useNotif, setNotif } from "../notify";
import type { Section } from "./NavRail";
import { PencilEdit02Icon, UserMultiple02Icon, UserGroupIcon, Shield01Icon, WavingHand01Icon, GlobeIcon } from "@hugeicons/core-free-icons";

const container = { hidden: {}, visible: { transition: { staggerChildren: 0.03 } } };
const item = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { duration: 0.18 } } };

type Activity = { id: string; icon: string; text: string; time: string };

export function Home({
  selfJid, online, total, presence, statusMsg, onChangePresence, onSelect, onNewChat, activity,
}: {
  selfJid: string;
  online: number;
  total: number;
  presence: Presence;
  statusMsg: string;
  onChangePresence: (p: Presence, msg: string) => void;
  onSelect: (s: Section) => void;
  onNewChat: () => void;
  activity: Activity[];
}) {
  const name = selfJid.split("@")[0];
  const notif = useNotif();
  const cards = [
    { ic: PencilEdit02Icon, tint: "blue", title: "Новый чат", sub: "Начните переписку со своими контактами", btn: "Создать чат", on: onNewChat },
    { ic: UserMultiple02Icon, tint: "green", title: "Контакты", sub: "Просмотрите свой список контактов и коллег", btn: "Открыть контакты", on: () => onSelect("contacts") },
    { ic: UserGroupIcon, tint: "purple", title: "Групповые чаты", sub: "Создавайте группы и общайтесь с командой", btn: "Создать группу", on: () => onSelect("groups") },
    { ic: Shield01Icon, tint: "amber", title: "Безопасность", sub: "Ваши сообщения защищены современными протоколами", btn: "Подробнее", on: () => onSelect("settings") },
  ];

  return (
    <motion.div className="home" variants={container} initial="hidden" animate="visible">
      <motion.div className="home-greet" variants={item}>
        <h1>Добро пожаловать, {name}! <span className="greet-wave"><Icon icon={WavingHand01Icon} size={24} strokeWidth={2} /></span></h1>
        <p>Вы успешно вошли в {CONFIG.BRAND} — ваш независимый мессенджер.</p>
      </motion.div>

      <motion.div className="home-cards" variants={container}>
        {cards.map((c) => (
          <motion.div key={c.title} className="feat-card" variants={item} whileHover={{ y: -4 }}>
            <div className={`feat-ic ${c.tint}`}><Icon icon={c.ic} size={24} /></div>
            <div className="feat-title">{c.title}</div>
            <div className="feat-sub">{c.sub}</div>
            <button className={`feat-btn ${c.tint}`} onClick={c.on}>{c.btn}</button>
          </motion.div>
        ))}
      </motion.div>

      <motion.div className="home-panels" variants={container}>
        <motion.div className="hp" variants={item}>
          <div className="hp-title">Ваш статус</div>
          <StatusMenu presence={presence} statusMsg={statusMsg} onChange={onChangePresence} />
          <div className="hp-meta">В сети с {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
          <div className="hp-host with-ic"><Icon icon={GlobeIcon} size={13} /> {CONFIG.DOMAIN}</div>
        </motion.div>

        <motion.div className="hp" variants={item}>
          <div className="hp-title">Контакты</div>
          <div className="hp-big">{online}<span className="hp-of"> / {total}</span></div>
          <div className="hp-meta">в сети сейчас</div>
        </motion.div>

        <motion.div className="hp" variants={item}>
          <div className="hp-title">Уведомления</div>
          <button className="hp-toggle toggle-btn" onClick={() => setNotif({ sound: !notif.sound })}><span>Звуковые уведомления</span><span className={`switch ${notif.sound ? "on" : ""}`}><span className="knob" /></span></button>
          <button className="hp-toggle toggle-btn" onClick={() => setNotif({ preview: !notif.preview })}><span>Показывать превью</span><span className={`switch ${notif.preview ? "on" : ""}`}><span className="knob" /></span></button>
        </motion.div>
      </motion.div>

      <motion.div className="home-bottom" variants={container}>
        <motion.div className="activity" variants={item}>
          <div className="hp-title">Недавняя активность</div>
          {activity.length === 0 && <div className="info-empty">Пока тихо. Начните переписку — события появятся здесь.</div>}
          {activity.map((a) => (
            <div className="act-row" key={a.id}>
              <span className="act-ic">{a.icon}</span>
              <span className="act-text">{a.text}</span>
              <span className="act-time">{a.time}</span>
            </div>
          ))}
        </motion.div>

        <motion.div className="sec-card" variants={item}>
          <div className="sec-ic"><Icon icon={Shield01Icon} size={22} /></div>
          <div className="sec-title">{CONFIG.BRAND} — связь без границ</div>
          <p>Ваши сообщения передаются напрямую между пользователями через ваш сервер. Никто не может отключить вашу связь приказом.</p>
          <button className="sec-link" onClick={() => onSelect("settings")}>Подробнее о безопасности →</button>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
