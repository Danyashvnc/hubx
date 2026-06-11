import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { Presence } from "../types";
import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { ArrowDown01Icon, ArrowRight01Icon, Tick01Icon } from "@hugeicons/core-free-icons";

const STATUSES: { v: Presence; label: string; cls: string }[] = [
  { v: "online", label: "в сети", cls: "online" },
  { v: "away", label: "отошёл", cls: "away" },
  { v: "dnd", label: "не беспокоить", cls: "dnd" },
];

export function StatusMenu({
  presence,
  statusMsg,
  onChange,
  placement = "down",
  triggerContent,
  triggerClassName,
}: {
  presence: Presence;
  statusMsg: string;
  onChange: (p: Presence, msg: string) => void;
  placement?: "down" | "up";
  triggerContent?: ReactNode;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(statusMsg);
  const ref = useRef<HTMLDivElement>(null);

  const current = STATUSES.find((s) => s.v === presence) || STATUSES[0];

  useEffect(() => setDraft(statusMsg), [statusMsg]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  function pick(p: Presence) { onChange(p, draft); setOpen(false); }
  function saveMsg() { onChange(presence, draft.trim()); setOpen(false); }

  return (
    <div className="status-menu" ref={ref}>
      <button className={triggerClassName || "status-trigger"} onClick={() => setOpen((o) => !o)}>
        {triggerContent || (
          <>
            <span className={`mini-dot ${current.cls}`} />
            <span className="status-cur">{statusMsg || current.label}</span>
            <motion.span className="status-chev" animate={{ rotate: open ? 180 : 0 }}><Icon icon={ArrowDown01Icon} size={15} /></motion.span>
          </>
        )}
      </button>

      {open && (
        <motion.div
          className={`status-pop ${placement}`}
          initial={{ opacity: 0, y: placement === "up" ? 6 : -6, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        >
          {STATUSES.map((s) => (
            <button key={s.v} className={s.v === presence ? "status-opt active" : "status-opt"} onClick={() => pick(s.v)}>
              <span className={`mini-dot ${s.cls}`} />
              <span>{s.label}</span>
              {s.v === presence && <span className="status-check"><Icon icon={Tick01Icon} size={13} strokeWidth={2.4} /></span>}
            </button>
          ))}
          <div className="status-sep" />
          <div className="status-custom">
            <input value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveMsg()} maxLength={80} placeholder="Свой статус…" />
            <button className="status-save" onClick={saveMsg} title="Сохранить"><Icon icon={ArrowRight01Icon} size={16} strokeWidth={2.4} /></button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
