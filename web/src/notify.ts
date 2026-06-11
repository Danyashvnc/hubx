import { useSyncExternalStore } from "react";
import { setSoundEnabled, setPresenceMuted } from "./sounds";
import type { Presence } from "./types";

export type NotifSettings = { sound: boolean; push: boolean; preview: boolean; online: boolean };

const KEY = "hubx.notif";
let settings: NotifSettings = { sound: true, push: true, preview: true, online: true };
try { settings = { ...settings, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch {  }
setSoundEnabled(settings.sound);

const subs = new Set<() => void>();
const notifySubs = () => subs.forEach((f) => f());

export function getNotif(): NotifSettings { return settings; }
export function setNotif(patch: Partial<NotifSettings>) {
  settings = { ...settings, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {  }
  setSoundEnabled(settings.sound);
  if (settings.push) requestPush();
  notifySubs();
}
export function subscribeNotif(cb: () => void) { subs.add(cb); return () => { subs.delete(cb); }; }

export function useNotif(): NotifSettings {
  return useSyncExternalStore(subscribeNotif, getNotif, getNotif);
}

let myPresence: Presence = "online";
export function setMyPresence(p: Presence) {
  myPresence = p;
  setPresenceMuted(p === "away" || p === "dnd");
  notifySubs();
}
export function isQuietPresence() { return myPresence === "away" || myPresence === "dnd"; }

export function getPushPermission(): NotificationPermission | "unsupported" {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

export async function requestPush() {
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "default") {
    try { await Notification.requestPermission(); } catch {  }
    notifySubs();
  }
}

export type PushOpts = {
  title: string;
  body?: string;
  icon?: string;
  onClick?: () => void;

  noPreview?: boolean;
};

export function pushMessage(opts: PushOpts) {
  if (!settings.push) return;
  if (isQuietPresence()) return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  if (document.hasFocus()) return;
  try {
    const n = new Notification(opts.title, {
      body: opts.noPreview || !settings.preview ? "Новое сообщение" : (opts.body || ""),
      tag: "hubx-" + opts.title,
      icon: opts.icon,
      silent: true,
    });
    n.onclick = () => { try { window.focus(); } catch {  } opts.onClick?.(); n.close(); };
  } catch {  }
}

export function pushOnline(name: string, icon?: string, onClick?: () => void) {
  if (!settings.online) return;
  pushMessage({ title: `${name} в сети`, body: "", icon, onClick, noPreview: false });
}

function b64ToU8(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
export async function enableWebPush(jid: string) {
  try {
    if (!settings.push) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { api } = await import("./api");
      const key = await api.pushKey();
      if (!key) return;
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) });
    }
    const { api } = await import("./api");
    await api.pushSubscribe(jid, sub.toJSON());
  } catch {  }
}
