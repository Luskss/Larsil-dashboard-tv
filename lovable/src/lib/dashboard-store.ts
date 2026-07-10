import { useEffect, useState } from "react";

export type Emp = {
  initials: string;
  name: string;
  role: string;
  project: string;
  pct: number;
  status: string;
};

export type Channel = { label: string; value: number };

export type DashboardConfig = {
  rotationSeconds: number;
  screens: { projects: boolean; weather: boolean; channels: boolean };
  weatherCity: string;
  employees: Emp[];
  channels: Channel[];
};

export const DEFAULT_CONFIG: DashboardConfig = {
  rotationSeconds: 25,
  screens: { projects: true, weather: true, channels: true },
  weatherCity: "São Paulo, SP",
  employees: [
    { initials: "AS", name: "Ana Sousa", role: "Eng. Florestal", project: "Inventário do Talhão 14", pct: 72, status: "Em dia" },
    { initials: "BL", name: "Bruno Lima", role: "Técnico de Campo", project: "Plantio do Setor Norte", pct: 45, status: "Em andamento" },
    { initials: "CM", name: "Carla Mendes", role: "Analista SIG", project: "Mapeamento por drone", pct: 88, status: "Quase lá" },
    { initials: "DR", name: "Diego Rocha", role: "Operador", project: "Manutenção do viveiro", pct: 30, status: "Iniciado" },
    { initials: "ED", name: "Elena Dias", role: "Coord. Ambiental", project: "Licenciamento ambiental", pct: 61, status: "Em andamento" },
  ],
  channels: [
    { label: "Busca orgânica", value: 82 },
    { label: "Acesso direto", value: 64 },
    { label: "Redes sociais", value: 51 },
    { label: "E-mail", value: 38 },
    { label: "Indicação", value: 23 },
  ],
};

const KEY = "larsil.dashboard.config.v1";

export function loadConfig(): DashboardConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed, screens: { ...DEFAULT_CONFIG.screens, ...(parsed.screens || {}) } };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(cfg: DashboardConfig) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(cfg));
  window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
}

export function useDashboardConfig() {
  const [cfg, setCfg] = useState<DashboardConfig>(DEFAULT_CONFIG);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setCfg(loadConfig());
    setReady(true);
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === KEY) setCfg(loadConfig());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return { cfg, ready, setCfg: (c: DashboardConfig) => { setCfg(c); saveConfig(c); } };
}
