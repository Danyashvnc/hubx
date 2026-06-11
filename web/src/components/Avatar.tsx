import { useEffect, useReducer, useRef, useState } from "react";
import { getPhoto, subscribePhotos } from "../avatarStore";

const PALETTE = [
  ["#5b8cff", "#3d5afe"],
  ["#22c1a4", "#0ea5e9"],
  ["#a855f7", "#7c5cff"],
  ["#f59e0b", "#f97316"],
  ["#ec4899", "#a855f7"],
  ["#26c281", "#10b981"],
  ["#f0556d", "#ef4444"],
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function Avatar({
  jid,
  size = 40,
  presence,
}: {
  jid: string;
  size?: number;
  presence?: "online" | "away" | "dnd" | "offline";
}) {
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => subscribePhotos(force), []);

  const prevPresence = useRef(presence);
  const [justOnline, setJustOnline] = useState(false);
  useEffect(() => {
    const was = prevPresence.current;
    prevPresence.current = presence;
    if (presence === "online" && was && was !== "online") {
      setJustOnline(true);
      const t = window.setTimeout(() => setJustOnline(false), 800);
      return () => window.clearTimeout(t);
    }
  }, [presence]);

  const photo = getPhoto(jid);
  const name = jid.split("@")[0] || "?";
  const initials = name.slice(0, 2).toUpperCase();
  const [a, b] = PALETTE[hash(jid) % PALETTE.length];
  const dot = Math.max(9, size * 0.22);

  return (
    <div className="avatar" style={{ width: size, height: size }}>
      {photo ? (
        <img className="avatar-fill avatar-img" src={photo} alt={name} />
      ) : (
        <div className="avatar-fill" style={{ background: `linear-gradient(135deg, ${a}, ${b})`, fontSize: size * 0.4 }}>
          {initials}
        </div>
      )}
      {presence && (
        <span className={`presence-dot ${presence}${justOnline ? " pulse" : ""}`} style={{ width: dot, height: dot }} />
      )}
    </div>
  );
}
