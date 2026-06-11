import { useState } from "react";
import { CONFIG } from "../config";

export function Logo({ size = 32, withWordmark = true }: { size?: number; withWordmark?: boolean }) {
  const [imgOk, setImgOk] = useState(true);

  if (imgOk) {
    return (
      <div className="logo">
        <img
          src="/logo.png"
          alt={CONFIG.BRAND}
          onError={() => setImgOk(false)}
          style={{
            height: size,
            width: "auto",
            maxWidth: size * 1.2,
            objectFit: "contain",
            borderRadius: Math.round(size * 0.16),
            display: "block",
          }}
        />
      </div>
    );
  }

  return (
    <div className="logo" style={{ gap: size * 0.3 }}>
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" style={{ display: "block" }}>
        <defs>
          <linearGradient id="hubx" x1="6" y1="6" x2="42" y2="42">
            <stop offset="0" stopColor="#3b82f6" />
            <stop offset="0.55" stopColor="#6366f1" />
            <stop offset="1" stopColor="#a855f7" />
          </linearGradient>
        </defs>
        <rect x="1.5" y="1.5" width="45" height="45" rx="11" fill="#0a0a12" stroke="rgba(124,92,247,0.35)" strokeWidth="1" />
        <path d="M24 9c8.3 0 15 5.9 15 13.2 0 7.3-6.7 13.2-15 13.2-1.6 0-3.1-.2-4.6-.6L12 39l1.6-6.1C10.9 30.4 9 26.9 9 22.2 9 14.9 15.7 9 24 9z"
          stroke="url(#hubx)" strokeWidth="2.6" fill="none" strokeLinejoin="round" />
        <text x="24" y="27.5" textAnchor="middle" fontFamily="Bricolage Grotesque, Arial, sans-serif" fontWeight="800" fontSize="12.5" fill="#fff">Hub<tspan fill="url(#hubx)">X</tspan></text>
      </svg>
      {withWordmark && <span className="wordmark" style={{ fontSize: size * 0.55 }}>{CONFIG.BRAND}</span>}
    </div>
  );
}
