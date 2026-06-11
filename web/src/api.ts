import { CONFIG } from "./config";
import type { DirectoryUser, AdminSession } from "./types";

let adminToken: string | null = null;
export function clearAdminToken() { adminToken = null; }

async function jsonFetch(path: string, init: RequestInit = {}) {
  const headers: Record<string, string> = { ...(init.headers as any) };
  if (adminToken) headers.Authorization = `Bearer ${adminToken}`;
  const res = await fetch(`${CONFIG.API_URL}${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false)
    throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  async register(username: string, password: string) {
    return jsonFetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
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

  async roomInviteLink(room: string, jid: string, ttlMs: number): Promise<string | null> {
    try {
      const data = await jsonFetch("/api/rooms/invite-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room, jid, ttlMs }),
      });
      return data.token || null;
    } catch { return null; }
  },

  async roomJoin(token: string, jid: string): Promise<string | null> {
    try {
      const data = await jsonFetch("/api/rooms/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, jid }),
      });
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

  async userExists(username: string, host?: string): Promise<boolean> {
    try {
      const q = `u=${encodeURIComponent(username)}${host ? `&host=${encodeURIComponent(host)}` : ""}`;
      const data = await jsonFetch(`/api/user-exists?${q}`);
      return !!data.exists;
    } catch {
      return true;
    }
  },
};
