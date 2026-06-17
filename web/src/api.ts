import { CONFIG } from "./config";
import type { DirectoryUser, AdminSession } from "./types";

let adminToken: string | null = null;
let userToken: string | null = null;
let reauth: (() => Promise<boolean>) | null = null;
export function clearAdminToken() { adminToken = null; }
export function clearUserToken() { userToken = null; }
export function setReauth(fn: (() => Promise<boolean>) | null) { reauth = fn; }

async function jsonFetch(path: string, init: RequestInit = {}) {
  const headers: Record<string, string> = { ...(init.headers as any) };
  if (adminToken && !headers.Authorization) headers.Authorization = `Bearer ${adminToken}`;
  const res = await fetch(`${CONFIG.API_URL}${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false)
    throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function userJsonFetch(path: string, body: unknown) {
  const call = () => jsonFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(userToken ? { Authorization: `Bearer ${userToken}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!userToken && reauth) { try { await reauth(); } catch {  } }
  try {
    return await call();
  } catch (e) {
    if (reauth && (await reauth().catch(() => false))) return await call();
    throw e;
  }
}

export const api = {
  async register(username: string, password: string, invite?: string, email?: string) {
    return jsonFetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, invite, email }),
    });
  },

  async createInvite(maxUses?: number, ttlDays?: number): Promise<string | null> {
    try {
      const d = await jsonFetch("/api/invites", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxUses, ttlDays }),
      });
      return d.code || null;
    } catch { return null; }
  },
  async listInvites(): Promise<{ code: string; uses: number; maxUses: number; exp: number; createdAt: number }[]> {
    try { const d = await jsonFetch("/api/invites"); return Array.isArray(d.invites) ? d.invites : []; } catch { return []; }
  },
  async revokeInvite(code: string): Promise<boolean> {
    try { await jsonFetch(`/api/invites/${encodeURIComponent(code)}`, { method: "DELETE" }); return true; } catch { return false; }
  },

  async adminLogin(username: string, password: string) {
    const data = await jsonFetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    adminToken = data.token;
    return data;
  },

  async users(): Promise<{ total: number; onlineCount: number; users: DirectoryUser[] }> {
    return jsonFetch("/api/users");
  },

  async deleteUser(username: string) {
    return jsonFetch(`/api/users/${encodeURIComponent(username)}`, { method: "DELETE" });
  },

  async adminSessions(): Promise<{ total: number; onlineCount: number; offlineCount: number; users: AdminSession[] }> {
    return jsonFetch("/api/admin/sessions");
  },

  async health() {
    return jsonFetch("/api/health");
  },

  async sessionBeacon(jid: string) {
    try {
      await jsonFetch("/api/session/beacon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jid }),
      });
    } catch {  }
  },

  async pushKey(): Promise<string | null> {
    try { const d = await jsonFetch("/api/push/key"); return d.key || null; } catch { return null; }
  },

  async pushSubscribe(jid: string, sub: unknown): Promise<void> {
    try {
      await jsonFetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jid, sub }),
      });
    } catch {  }
  },

  async authToken(username: string, password: string, host: string): Promise<boolean> {
    try {
      const data = await jsonFetch("/api/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, host }),
      });
      userToken = data.token || null;
      return !!userToken;
    } catch { userToken = null; return false; }
  },

  async roomInviteLink(room: string, _jid: string, ttlMs: number): Promise<string | null> {
    try {
      const data = await userJsonFetch("/api/rooms/invite-link", { room, ttlMs });
      return data.token || null;
    } catch { return null; }
  },

  async roomJoin(token: string, _jid: string): Promise<string | null> {
    try {
      const data = await userJsonFetch("/api/rooms/join", { token });
      return data.room || null;
    } catch { return null; }
  },

  async searchUsers(q: string, host?: string): Promise<{ username: string; jid: string; online: boolean }[]> {
    try {
      const query = `q=${encodeURIComponent(q)}${host ? `&host=${encodeURIComponent(host)}` : ""}`;
      const data = await jsonFetch(`/api/users/search?${query}`);
      return Array.isArray(data.users) ? data.users : [];
    } catch {
      return [];
    }
  },

  async userExists(username: string, host?: string): Promise<boolean | "unknown"> {
    try {
      const q = `u=${encodeURIComponent(username)}${host ? `&host=${encodeURIComponent(host)}` : ""}`;
      const data = await jsonFetch(`/api/user-exists?${q}`);
      return !!data.exists;
    } catch {
      return "unknown";
    }
  },
};
