import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { Presence } from "../types";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { setPhoto } from "../avatarStore";
import {
  Image01Icon, Settings01Icon, Logout01Icon, PencilEdit02Icon, ArrowDown01Icon, ArrowRight01Icon, Tick01Icon,
} from "@hugeicons/core-free-icons";

const STATUSES: { v: Presence; label: string; cls: string }[] = [
  { v: "online", label: "в сети", cls: "online" },
  { v: "away", label: "отошёл", cls: "away" },
  { v: "dnd", label: "не беспокоить", cls: "dnd" },
];

async function toDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const S = 256;
  const c = document.createElement("canvas");
  c.width = S; c.height = S;
  const ctx = c.getContext("2d")!;
  const scale = Math.max(S / bitmap.width, S / bitmap.height);
  const w = bitmap.width * scale, h = bitmap.height * scale;
  ctx.drawImage(bitmap, (S - w) / 2, (S - h) / 2, w, h);
  return c.toDataURL("image/jpeg", 0.85);
}

export function ProfileMenu({
  selfJid, presence, statusMsg, displayName = "", onChangePresence, onSaveName, onOpenSettings, onLogout,
}: {
  selfJid: string;
  presence: Presence;
  statusMsg: string;
  displayName?: string;
  onChangePresence: (p: Presence, msg: string) => void;
  onSaveName?: (fn: string) => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(statusMsg);
  const [nameDraft, setNameDraft] = useState(displayName);
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const shownName = displayName || selfJid.split("@")[0];

  useEffect(() => setDraft(statusMsg), [statusMsg]);
  useEffect(() => setNameDraft(displayName), [displayName]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const dataUrl = await toDataUrl(f);
      setPhoto(selfJid, dataUrl);

      window.dispatchEvent(new CustomEvent<string>("hubx:save-photo", { detail: dataUrl }));
    } catch {  }
    e.target.value = "";
  }

  return (
    <div className="status-menu" ref={ref}>
      <button className="profile-row" onClick={() => setOpen((o) => !o)}>
        <Avatar jid={selfJid} size={36} presence={presence} />
        <div className="profile-info">
          <div className="profile-name">{shownName}</div>
          <div className="profile-jid">{selfJid}</div>
        </div>
        <span className="profile-chev"><Icon icon={ArrowDown01Icon} size={16} /></span>
      </button>

      {open && (
        <motion.div className="status-pop profile-pop"
          initial={{ opacity: 0, y: 6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}>
          <div className="pm-head">
            <button className="pm-avatar" onClick={() => fileRef.current?.click()} title="Сменить фото">
              <Avatar jid={selfJid} size={48} presence={presence} />
              <span className="pm-avatar-edit"><Icon icon={PencilEdit02Icon} size={13} /></span>
            </button>
            <div>
              <div className="pm-name">{shownName}</div>
              <div className="pm-jid">{selfJid}</div>
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />

          {onSaveName && (
            <>
              <div className="pm-section-title">Отображаемое имя</div>
              <div className="status-custom">
                <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} maxLength={48}
                  onKeyDown={(e) => e.key === "Enter" && onSaveName(nameDraft.trim())}
                  placeholder="Ваше имя для других…" />
                <button className="status-save" title="Сохранить имя" onClick={() => onSaveName(nameDraft.trim())}><Icon icon={ArrowRight01Icon} size={16} strokeWidth={2.4} /></button>
              </div>
            </>
          )}

          <div className="pm-section-title">Статус</div>
          {STATUSES.map((s) => (
            <button key={s.v} className={s.v === presence ? "status-opt active" : "status-opt"}
              onClick={() => { onChangePresence(s.v, draft); }}>
              <span className={`mini-dot ${s.cls}`} /><span>{s.label}</span>
              {s.v === presence && <span className="status-check"><Icon icon={Tick01Icon} size={13} strokeWidth={2.4} /></span>}
            </button>
          ))}
          <div className="status-custom">
            <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={80}
              onKeyDown={(e) => e.key === "Enter" && (onChangePresence(presence, draft.trim()), setOpen(false))}
              placeholder="Свой статус…" />
            <button className="status-save" onClick={() => { onChangePresence(presence, draft.trim()); setOpen(false); }}><Icon icon={ArrowRight01Icon} size={16} strokeWidth={2.4} /></button>
          </div>

          <div className="status-sep" />
          <button className="pm-item" onClick={() => { fileRef.current?.click(); }}>
            <Icon icon={Image01Icon} size={17} /> Сменить фото
          </button>
          <button className="pm-item" onClick={() => { onOpenSettings(); setOpen(false); }}>
            <Icon icon={Settings01Icon} size={17} /> Настройки
          </button>
          <button className="pm-item danger" onClick={onLogout}>
            <Icon icon={Logout01Icon} size={17} /> Выйти
          </button>
        </motion.div>
      )}
    </div>
  );
}
