const onLocalhost = typeof location === "undefined" || /^(localhost|127\.|0\.0\.0\.0|\[?::1)/.test(location.hostname);
const sameOriginWs = () => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
const sameOriginApi = () => `${location.origin}/api`;

const WS = import.meta.env.VITE_XMPP_WS || (onLocalhost ? "ws://localhost:5280/ws" : sameOriginWs());
const API = import.meta.env.VITE_API_URL || (onLocalhost ? "http://localhost:4000" : sameOriginApi());

export const CONFIG = {

  DOMAIN: import.meta.env.VITE_XMPP_DOMAIN || "localhost",

  WS_URL: WS,

  API_URL: API,

  ADMIN_JID: import.meta.env.VITE_ADMIN_JID || "admin@localhost",

  BOT_USER: import.meta.env.VITE_BOT_USER || "hubx-bot",

  SERVERS: [
    {
      id: "local",
      label: "HubX · основной",
      ws: WS,
      domain: "localhost",
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
