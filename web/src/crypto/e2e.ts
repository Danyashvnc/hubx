const enc = new TextEncoder();
const dec = new TextDecoder();

export type Pub = JsonWebKey;

const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(ECDH, true, ["deriveKey"]);
}
export async function exportJwk(key: CryptoKey): Promise<JsonWebKey> {
  return crypto.subtle.exportKey("jwk", key);
}
export async function importPrivJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, ECDH, true, ["deriveKey"]);
}
export async function importPubJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, ECDH, true, []);
}

export async function deriveKey(myPriv: CryptoKey, theirPub: CryptoKey): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    { name: "ECDH", public: theirPub },
    myPriv,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encrypt(key: CryptoKey, plaintext: string, aad = ""): Promise<{ iv: string; ct: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const algo: AesGcmParams = { name: "AES-GCM", iv: iv as BufferSource };
  if (aad) algo.additionalData = enc.encode(aad) as BufferSource;
  const ctBuf = await crypto.subtle.encrypt(algo, key, enc.encode(plaintext) as BufferSource);
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ctBuf)) };
}
export async function decrypt(key: CryptoKey, iv: string, ct: string, aad = ""): Promise<string> {
  const algo: AesGcmParams = { name: "AES-GCM", iv: fromB64(iv) as BufferSource };
  if (aad) algo.additionalData = enc.encode(aad) as BufferSource;
  const ptBuf = await crypto.subtle.decrypt(algo, key, fromB64(ct) as BufferSource);
  return dec.decode(ptBuf);
}

export async function encryptBytes(key: CryptoKey, data: ArrayBuffer): Promise<{ iv: string; data: Blob }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ctBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, data);
  return { iv: toB64(iv), data: new Blob([ctBuf]) };
}
export async function decryptBytes(key: CryptoKey, iv: string, data: ArrayBuffer): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) as BufferSource }, key, data);
}

export async function fingerprint(a: JsonWebKey, b: JsonWebKey): Promise<string> {
  const ka = `${a.x}.${a.y}`;
  const kb = `${b.x}.${b.y}`;
  const pair = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(pair));
  const hex = Array.from(new Uint8Array(hash)).map((x) => x.toString(16).padStart(2, "0")).join("");
  return (hex.slice(0, 24).match(/.{4}/g) || []).join(" ");
}

const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;
const ECDSA_SIGN = { name: "ECDSA", hash: "SHA-256" } as const;

export async function generateIdentity(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(ECDSA, true, ["sign", "verify"]);
}
export async function importIdentityPriv(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, ECDSA, true, ["sign"]);
}
export async function importIdentityPub(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, ECDSA, true, ["verify"]);
}

export async function signPub(idPriv: CryptoKey, ephemeralPub: JsonWebKey): Promise<string> {
  const sig = await crypto.subtle.sign(ECDSA_SIGN, idPriv, enc.encode(`${ephemeralPub.x}.${ephemeralPub.y}`) as BufferSource);
  return toB64(new Uint8Array(sig));
}

export async function verifyPub(idPubJwk: JsonWebKey, ephemeralPub: JsonWebKey, sigB64: string): Promise<boolean> {
  try {
    const idPub = await importIdentityPub(idPubJwk);
    return await crypto.subtle.verify(ECDSA_SIGN, idPub, fromB64(sigB64) as BufferSource, enc.encode(`${ephemeralPub.x}.${ephemeralPub.y}`) as BufferSource);
  } catch { return false; }
}

function toB64(u: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
