import { useState } from "react";
import type { Contact, Presence } from "../types";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { CONFIG } from "../config";
import {
  UserCircleIcon, Search01Icon, Notification03Icon, NotificationOff01Icon,
  Image01Icon, Attachment01Icon, Delete02Icon, Cancel01Icon, ArrowRight01Icon, Eraser01Icon, UserBlock01Icon,
} from "@hugeicons/core-free-icons";

const PRESENCE_LABEL: Record<Presence, string> = {
  online: "Онлайн", away: "Отошёл", dnd: "Не беспокоить", offline: "Не в сети",
};

export function InfoPanel({
  contact, selfJid, muted, onClose, onDelete, onToggleMute, onSoon, onClear, blocked, onBlock, onUnblock,
}: {
  contact: Contact;
  selfJid: string;
  muted: boolean;
  onClose: () => void;
  onDelete: () => void;
  onToggleMute: () => void;
  onSoon: (msg: string) => void;
  onClear?: () => void;
  blocked?: boolean;
  onBlock?: () => void;
  onUnblock?: () => void;
}) {
  const name = contact.name || contact.jid.split("@")[0];
  const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);

  return (
    <aside className="info-panel">
      <button className="info-close" onClick={onClose} title="Скрыть"><Icon icon={Cancel01Icon} size={18} /></button>

      <div className="info-hero">
        <Avatar jid={contact.jid} size={84} presence={contact.presence} />
        <div className="info-name">{name}</div>
        <div className="info-sub"><span className={`mini-dot ${contact.presence}`} />{PRESENCE_LABEL[contact.presence]}</div>
      </div>

      <div className="info-actions">
        <button className="info-act" onClick={() => onSoon("Расширенный профиль контакта появится позже.")}><Icon icon={UserCircleIcon} size={19} />Профиль</button>
        <button className="info-act" onClick={() => onSoon("Поиск по чату — значок ⌕ в шапке диалога.")}><Icon icon={Search01Icon} size={19} />Поиск</button>
        <button className={muted ? "info-act active" : "info-act"} onClick={onToggleMute}><Icon icon={muted ? NotificationOff01Icon : Notification03Icon} size={19} />{muted ? "Включить" : "Выкл. звук"}</button>
      </div>

      <div className="info-block">
        <div className="info-block-title">Общая информация</div>
        <div className="info-row"><span>Jabber ID</span><b>{contact.jid}</b></div>
        <div className="info-row"><span>Сервер</span><b>{CONFIG.DOMAIN}</b></div>
        <div className="info-row"><span>Статус</span><b style={{ fontFamily: "inherit" }}>{PRESENCE_LABEL[contact.presence]}</b></div>
        <div className="info-row"><span>Локальное время</span><b>{now}</b></div>
      </div>

      <div className="info-block">
        <button className="info-block-title row btn" onClick={() => onSoon("Прокрутите чат — изображения отображаются прямо в переписке.")}>
          <span><Icon icon={Image01Icon} size={15} /> Общие медиа</span><Icon icon={ArrowRight01Icon} size={16} className="chev" />
        </button>
        <div className="info-empty">Изображения из этого чата отображаются прямо в ленте сообщений.</div>
      </div>

      <div className="info-block">
        <button className="info-block-title row btn" onClick={() => onSoon("Файлы доступны прямо в переписке — нажмите на вложение, чтобы открыть.")}>
          <span><Icon icon={Attachment01Icon} size={15} /> Общие файлы</span><Icon icon={ArrowRight01Icon} size={16} className="chev" />
        </button>
        <div className="info-empty">Файлы из этого чата доступны прямо в ленте сообщений.</div>
      </div>

      <div className="info-block">
        <div className="info-block-title row"><span>Участники чата</span><span className="muted">2 участника</span></div>
        <div className="info-members">
          <Avatar jid={selfJid} size={34} />
          <Avatar jid={contact.jid} size={34} presence={contact.presence} />
        </div>
      </div>

      {onClear && (
        confirmClear ? (
          <div className="info-block" style={{ marginTop: 14 }}>
            <div className="info-block-title">Очистить переписку? Сообщения удалятся только у вас.</div>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="link-btn danger" onClick={() => { setConfirmClear(false); onClear(); }}>Да, очистить</button>
              <button className="link-btn" onClick={() => setConfirmClear(false)}>Отмена</button>
            </div>
          </div>
        ) : (
          <button className="info-delete" onClick={() => setConfirmClear(true)}><Icon icon={Eraser01Icon} size={17} /> Очистить переписку</button>
        )
      )}
      {blocked
        ? <button className="info-delete" onClick={() => onUnblock?.()}><Icon icon={UserBlock01Icon} size={17} /> Разблокировать</button>
        : onBlock && (confirmBlock
            ? (
              <div className="info-block" style={{ marginTop: 0 }}>
                <div className="info-block-title">Заблокировать {name}? Сообщения и присутствие от него перестанут приходить.</div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button className="link-btn danger" onClick={() => { setConfirmBlock(false); onBlock(); }}>Да, заблокировать</button>
                  <button className="link-btn" onClick={() => setConfirmBlock(false)}>Отмена</button>
                </div>
              </div>
            )
            : <button className="info-delete" onClick={() => setConfirmBlock(true)}><Icon icon={UserBlock01Icon} size={17} /> Заблокировать</button>)}
      <button className="info-delete" onClick={onDelete}><Icon icon={Delete02Icon} size={17} /> Удалить чат</button>
    </aside>
  );
}
