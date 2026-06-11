export type ConnState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "authfail"
  | "error";

export type Presence = "online" | "away" | "dnd" | "offline";

export interface Contact {
  jid: string;
  name: string;
  presence: Presence;
  status?: string;
  isRoom?: boolean;
  isSecret?: boolean;
  secretPeer?: string;
  subscription?: string;
  ask?: string;
}

export type AttachmentKind = "image" | "audio" | "file";

export interface Attachment {
  url: string;
  name: string;
  mime: string;
  size?: number;
  kind: AttachmentKind;
  voice?: boolean;
  fileIv?: string;
}

export interface ChatMessage {
  id: string;
  from: string;
  to: string;
  body: string;
  ts: number;
  outgoing: boolean;
  pending?: boolean;
  delivered?: boolean;
  read?: boolean;
  attachment?: Attachment;
  edited?: boolean;
  reply?: { id: string; author: string; text: string; quote?: boolean };
  secret?: boolean;
  delayed?: boolean;
  reactions?: Record<string, string[]>;
}

export interface AdminSession {
  username: string;
  jid: string;
  online: boolean;
  ip: string | null;
  location: string | null;
  city: string | null;
  country: string | null;
  countryCode: string | null;
  connection: string;
  devices: number;
  uptime: number;
  lastSeenTs: number | null;
}

export function msgPreview(m?: { body: string; attachment?: Attachment } | null): string {
  if (!m) return "";
  const a = m.attachment;
  if (a && (!m.body || m.body === a.url))
    return a.kind === "image" ? "📷 Фото" : a.voice ? "🎤 Голосовое" : a.kind === "audio" ? "🎵 Аудио" : `📎 ${a.name}`;
  return m.body;
}

export interface DirectoryUser {
  username: string;
  jid: string;
  online: boolean;
}

export interface Occupant {
  nick: string;
  affiliation: string;
  role: string;
  jid?: string;
}
