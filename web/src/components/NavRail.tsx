import { motion } from "framer-motion";
import { Logo } from "./Logo";
import { Icon } from "./Icon";
import { ProfileMenu } from "./ProfileMenu";
import type { Presence } from "../types";
import {
  Home01Icon, UserMultiple02Icon, UserGroupIcon,
  Notification03Icon, Shield01Icon, PencilEdit02Icon, Moon02Icon, Sun03Icon,
} from "@hugeicons/core-free-icons";

export type Section =
  | "home" | "contacts" | "groups" | "favorites" | "notifications" | "settings" | "admin";

const ITEMS: { key: Section; icon: any; label: string; adminOnly?: boolean }[] = [
  { key: "home", icon: Home01Icon, label: "Главная" },
  { key: "contacts", icon: UserMultiple02Icon, label: "Контакты" },
  { key: "groups", icon: UserGroupIcon, label: "Групповые чаты" },
  { key: "notifications", icon: Notification03Icon, label: "Уведомления" },
  { key: "admin", icon: Shield01Icon, label: "Админ-панель", adminOnly: true },
];

export function NavRail({
  active, onSelect, onNewChat, isAdmin, bell, theme, onToggleTheme,
  selfJid, presence, statusMsg, onChangePresence, onLogout, displayName, onSaveProfile,
}: {
  active: Section;
  onSelect: (s: Section) => void;
  onNewChat: () => void;
  isAdmin: boolean;
  bell: number;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  selfJid: string;
  presence: Presence;
  statusMsg: string;
  onChangePresence: (p: Presence, msg: string) => void;
  onLogout: () => void;
  displayName?: string;
  onSaveProfile?: (fn: string) => void;
}) {
  return (
    <nav className="rail">
      <div className="rail-top">
        <div className="rail-brand">
          <Logo size={30} withWordmark={false} />
          <button className="rail-bell" title="Уведомления" onClick={() => onSelect("notifications")}>
            <Icon icon={Notification03Icon} size={20} />
            {bell > 0 && <span className="bell-badge">{bell}</span>}
          </button>
        </div>

        <motion.button className="new-chat" onClick={onNewChat} whileHover={{ y: -1 }} whileTap={{ scale: 0.98 }} title="Новый чат">
          <Icon icon={PencilEdit02Icon} size={18} /> <span className="nc-label">Новый чат</span>
        </motion.button>

        <div className="rail-items">
          {ITEMS.filter((i) => !i.adminOnly || isAdmin).map((i) => (
            <button key={i.key} className={active === i.key ? "rail-item active" : "rail-item"} onClick={() => onSelect(i.key)} title={i.label}>
              {active === i.key && <motion.span className="rail-marker" layoutId="railMarker" transition={{ type: "spring", stiffness: 300, damping: 34 }} />}
              <span className="rail-ic"><Icon icon={i.icon} size={20} /></span>
              <span className="rail-label">{i.label}</span>
              {i.key === "notifications" && bell > 0 && <span className="bell-badge">{bell}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="rail-bottom">
        <div className="conn-row">
          <span className="conn-ic"><Icon icon={Shield01Icon} size={16} color="var(--green)" /></span>
          <div>
            <div className="conn-title">Подключено</div>
            <div className="conn-host">{selfJid.split("@")[1]}</div>
          </div>
        </div>

        <button className="theme-row" onClick={onToggleTheme}>
          <span className="theme-ic"><Icon icon={theme === "dark" ? Moon02Icon : Sun03Icon} size={17} /></span>
          <span className="theme-label">{theme === "dark" ? "Тёмная тема" : "Светлая тема"}</span>
          <span className={`switch ${theme === "dark" ? "on" : ""}`}><span className="knob" /></span>
        </button>

        <ProfileMenu selfJid={selfJid} presence={presence} statusMsg={statusMsg} displayName={displayName}
          onChangePresence={onChangePresence} onSaveName={onSaveProfile} onOpenSettings={() => onSelect("settings")} onLogout={onLogout} />
      </div>
    </nav>
  );
}
