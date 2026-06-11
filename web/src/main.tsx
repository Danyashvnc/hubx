import React from "react";
import ReactDOM from "react-dom/client";
import { MotionConfig } from "framer-motion";
import { App } from "./App";
import "./styles.css";

try {
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith("veche.")) {
      const nk = "hubx." + k.slice("veche.".length);
      const v = localStorage.getItem(k);
      if (v !== null && localStorage.getItem(nk) === null) localStorage.setItem(nk, v);
      localStorage.removeItem(k);
    }
  }
} catch {  }

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {  });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MotionConfig reducedMotion="user" transition={{ type: "spring", stiffness: 230, damping: 30, mass: 0.9 }}>
      <App />
    </MotionConfig>
  </React.StrictMode>
);
