const onLocalhost = typeof location === "undefined" || /^(localhost|127\.|0\.0\.0\.0|\[?::1)/.test(location.hostname);
const sameOriginWs = () => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
const sameOriginApi = () => location.origin;

const WS = import.meta.env.VITE_XMPP_WS || (onLocalhost ? "ws://localhost:5280/ws" : sameOriginWs());
const API = import.meta.env.VITE_API_URL || (onLocalhost ? "http://localhost:4000" : sameOriginApi());
const XMPP_DOMAIN = import.meta.env.VITE_XMPP_DOMAIN || "localhost";

export const CONFIG = {

  DOMAIN: XMPP_DOMAIN,

  WS_URL: WS,

  API_URL: API,

  ADMIN_JID: import.meta.env.VITE_ADMIN_JID || `admin@${XMPP_DOMAIN}`,

  IS_LOCAL: onLocalhost,

  TURNSTILE_SITE_KEY: import.meta.env.VITE_TURNSTILE_SITE_KEY || "",

  ADMIN_DEMO: ["admin", import.meta.env.VITE_ADMIN_DEMO_PASS || "Adm-HubX-9F4c2A"] as const,

  BOT_USER: import.meta.env.VITE_BOT_USER || "hubx-bot",

  SERVERS: [
    {
      id: "local",
      label: "HubX · основной",
      ws: WS,
      domain: XMPP_DOMAIN,
      demo: [["alice", "alice123"], ["bob", "bob123"]] as const,
    },
    {
      id: "a",
      label: "HubX · узел A",
      ws: WS,
      domain: "hubx.local",
      demo: [["anna", "anna123"]] as const,
    },
    {
      id: "b",
      label: "HubX · узел B",
      ws: onLocalhost ? "ws://localhost:5281/ws" : sameOriginWs(),
      domain: "hubx2.local",
      demo: [["boris", "boris123"]] as const,
    },
  ],

  BRAND: "HubX",
  TAGLINE: "Сообщения, которые нельзя отключить",
};
