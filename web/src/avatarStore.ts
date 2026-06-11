const KEY = "hubx.photos";
let photos: Record<string, string> = {};
try { photos = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { photos = {}; }

const subs = new Set<() => void>();

export function getPhoto(jid: string): string | undefined {
  return photos[jid];
}
export function setPhoto(jid: string, dataUrl: string) {
  if (dataUrl.length > 300_000) return;
  photos = { ...photos, [jid]: dataUrl };
  try { localStorage.setItem(KEY, JSON.stringify(photos)); } catch {  }
  subs.forEach((f) => f());
}
export function subscribePhotos(cb: () => void): () => void {
  subs.add(cb);
  return () => { subs.delete(cb); };
}
