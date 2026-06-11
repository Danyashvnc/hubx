import { Fragment, useEffect, useState } from "react";
import { CONFIG } from "../config";

type Node = { id: string; label: string; origin: string };
const wsToOrigin = (ws: string) => ws.replace(/^ws/, "http").replace(/\/ws$/, "");
const NODES: Node[] = [
  { id: "a", label: "Сервер A", origin: wsToOrigin(CONFIG.SERVERS[0].ws) },
  { id: "b", label: "Сервер B", origin: wsToOrigin(CONFIG.SERVERS[2]?.ws || CONFIG.SERVERS[0].ws) },
];

async function ping(origin: string, timeout = 2200): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    await fetch(origin + "/", { mode: "no-cors", cache: "no-store", signal: ctrl.signal });
    clearTimeout(t);
    return true;
  } catch {
    return false;
  }
}

export function NetworkStatus() {
  const [up, setUp] = useState<Record<string, boolean | undefined>>({});

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const res = await Promise.all(NODES.map((n) => ping(n.origin)));
      if (!alive) return;
      const m: Record<string, boolean> = {};
      NODES.forEach((n, i) => (m[n.id] = res[i]));
      setUp(m);
    };
    poll();
    const iv = setInterval(poll, 3000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  const known = NODES.every((n) => up[n.id] !== undefined);
  const bothUp = NODES.every((n) => up[n.id]);
  const anyDown = known && !bothUp;

  return (
    <div className={`netstat${anyDown ? " degraded" : ""}`} title="Состояние сети: переписка продолжается, пока жив хотя бы один сервер">
      <span className="netstat-cap">Сеть</span>
      <div className="netstat-nodes">
        {NODES.map((n, i) => (
          <Fragment key={n.id}>
            <span className={`net-node ${up[n.id] === undefined ? "wait" : up[n.id] ? "on" : "off"}`}>
              <span className="net-dot" />{n.label}
            </span>
            {i < NODES.length - 1 && <span className={`net-link ${bothUp ? "on" : "off"}`} />}
          </Fragment>
        ))}
      </div>
      <span className="netstat-label">{!known ? "проверка…" : bothUp ? "сеть активна" : "узел недоступен — сеть жива"}</span>
    </div>
  );
}
