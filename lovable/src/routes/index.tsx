import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useDashboardConfig, type Channel, type Emp } from "@/lib/dashboard-store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LARSIL Florestal · Dashboard Rotativo" },
      { name: "description", content: "Dashboard rotativo da equipe LARSIL Florestal." },
    ],
  }),
  component: Dashboard,
});

const ACCENT = "#a0d063";
const ACCENT2 = "#4db55e";
const FG = "#eef3ea";

const wdShort = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const conds = ["parcial", "sol", "sol", "nublado", "chuva", "parcial", "sol"] as const;
const his = [24, 27, 28, 25, 21, 23, 26];
const los = [18, 18, 19, 17, 15, 16, 18];

function Logo() {
  return (
    <div style={{ position: "relative", width: 62, height: 62, flex: "none" }}>
      <div style={{ position: "absolute", inset: 0, border: `3px solid ${ACCENT}`, borderRadius: "50%" }} />
      <div style={{ position: "absolute", left: 14, top: 11, width: 22, height: 40, background: ACCENT2, borderRadius: "50% 0 50% 50%", transform: "rotate(8deg)" }} />
      <div style={{ position: "absolute", left: 26, top: 15, width: 20, height: 36, background: ACCENT, borderRadius: "0 50% 50% 50%", transform: "rotate(-4deg)" }} />
    </div>
  );
}

function AnalogClock({ now }: { now: Date }) {
  const sec = now.getSeconds();
  const min = now.getMinutes() + sec / 60;
  const hr = (now.getHours() % 12) + min / 60;
  const hand = (deg: number, len: number, w: number, color: string): CSSProperties => ({
    position: "absolute", left: "50%", bottom: "50%", width: w, height: len,
    background: color, borderRadius: w,
    transform: `translateX(-50%) rotate(${deg}deg)`, transformOrigin: "50% 100%",
  });
  return (
    <div style={{ position: "relative", width: 240, height: 240, borderRadius: "50%", background: "rgba(238,243,234,0.045)", border: "1px solid rgba(238,243,234,0.12)", boxShadow: "inset 0 0 30px rgba(0,0,0,0.4)" }}>
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} style={{ position: "absolute", left: "50%", top: 10, width: 2, height: i % 3 === 0 ? 16 : 9, background: i % 3 === 0 ? ACCENT : "rgba(238,243,234,0.4)", transform: `translateX(-50%) rotate(${i * 30}deg)`, transformOrigin: "50% 110px" }} />
      ))}
      <div style={hand(hr * 30, 62, 4, FG)} />
      <div style={hand(min * 6, 88, 3, FG)} />
      <div style={hand(sec * 6, 96, 2, ACCENT)} />
      <div style={{ position: "absolute", left: "50%", top: "50%", width: 12, height: 12, background: ACCENT, borderRadius: "50%", transform: "translate(-50%,-50%)" }} />
    </div>
  );
}

function StatusPill({ pct, status }: { pct: number; status: string }) {
  const high = pct >= 80;
  return (
    <span className="badge" style={{ fontSize: 10, fontWeight: 600, color: high ? ACCENT : ACCENT2, background: high ? "rgba(160,208,99,0.15)" : "rgba(77,181,94,0.15)", padding: "5px 10px", borderRadius: 20 }}>
      {status}
    </span>
  );
}

function EmpRow({ e }: { e: Emp }) {
  const high = e.pct >= 80;
  return (
    <div className="d-flex align-items-center gap-3" style={{ background: "rgba(238,243,234,0.045)", border: "1px solid rgba(238,243,234,0.10)", borderRadius: 12, padding: "12px 18px" }}>
      <div className="d-flex align-items-center justify-content-center" style={{ width: 44, height: 44, borderRadius: "50%", background: "rgba(160,208,99,0.16)", border: "1px solid rgba(160,208,99,0.35)", color: ACCENT, fontWeight: 800, fontSize: 13, flex: "none" }}>
        {e.initials}
      </div>
      <div style={{ width: 170, flex: "none" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: FG, lineHeight: 1.15 }}>{e.name}</div>
        <div style={{ fontSize: 11, color: "rgba(238,243,234,0.55)" }}>{e.role}</div>
      </div>
      <div className="flex-grow-1" style={{ minWidth: 0 }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: "rgba(238,243,234,0.4)" }}>Projeto atual</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: FG }} className="text-truncate">{e.project}</div>
      </div>
      <div style={{ width: 200, flex: "none" }}>
        <div className="d-flex align-items-center justify-content-between" style={{ marginBottom: 4 }}>
          <span style={{ fontSize: 10, color: "rgba(238,243,234,0.5)", fontWeight: 600 }}>Progresso</span>
          <span style={{ fontSize: 13, fontWeight: 800, color: ACCENT }}>{e.pct}%</span>
        </div>
        <div style={{ height: 6, background: "rgba(238,243,234,0.10)", borderRadius: 3, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${e.pct}%`, background: high ? ACCENT : ACCENT2, borderRadius: 3, transition: "width .9s" }} />
        </div>
      </div>
      <div style={{ width: 110, flex: "none", textAlign: "right" }}>
        <StatusPill pct={e.pct} status={e.status} />
      </div>
    </div>
  );
}

function ScreenProjects({ now, employees }: { now: Date | null; employees: Emp[] }) {
  return (
    <div style={screen} className="d-flex flex-column">
      <div style={{ marginBottom: 20 }}>
        <div style={kicker}>Equipe LARSIL · em andamento</div>
        <div style={h1}>Projetos Atuais</div>
      </div>
      <div className="d-flex gap-4 flex-grow-1" style={{ minHeight: 0 }}>
        <aside style={{ width: 340, background: "rgba(238,243,234,0.045)", border: "1px solid rgba(238,243,234,0.10)", borderRadius: 16, padding: 28 }} className="d-flex flex-column align-items-center">
          <div style={{ ...kicker, marginBottom: 18 }}>Horário local</div>
          {now ? <AnalogClock now={now} /> : <div style={{ width: 240, height: 240 }} />}
          <div suppressHydrationWarning style={{ marginTop: 22, fontSize: 40, fontWeight: 700, color: FG, fontVariantNumeric: "tabular-nums" }}>
            {now ? now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "--:--"}
            {now && <span style={{ fontSize: 18, color: ACCENT, marginLeft: 6 }}>{String(now.getSeconds()).padStart(2, "0")}</span>}
          </div>
          <div suppressHydrationWarning style={{ marginTop: 6, fontSize: 14, color: "rgba(238,243,234,0.6)", textTransform: "capitalize", textAlign: "center" }}>
            {now ? now.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" }) : ""}
          </div>
          <hr style={{ width: "100%", borderColor: "rgba(238,243,234,0.1)", margin: "22px 0" }} />
          <div className="w-100">
            <div style={{ fontSize: 11, color: "rgba(238,243,234,0.45)", fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 10 }}>Resumo da equipe</div>
            <div className="d-flex justify-content-between" style={{ fontSize: 13, color: FG, marginBottom: 6 }}>
              <span>Funcionários</span><span style={{ fontWeight: 700 }}>{employees.length}</span>
            </div>
            <div className="d-flex justify-content-between" style={{ fontSize: 13, color: FG, marginBottom: 6 }}>
              <span>Progresso médio</span>
              <span style={{ fontWeight: 700, color: ACCENT }}>{employees.length ? Math.round(employees.reduce((a, b) => a + b.pct, 0) / employees.length) : 0}%</span>
            </div>
            <div className="d-flex justify-content-between" style={{ fontSize: 13, color: FG }}>
              <span>Quase concluído</span>
              <span style={{ fontWeight: 700 }}>{employees.filter((e) => e.pct >= 80).length}</span>
            </div>
          </div>
        </aside>
        <div className="d-flex flex-column gap-2 flex-grow-1" style={{ minWidth: 0, overflow: "hidden" }}>
          {employees.map((e) => <EmpRow key={e.initials + e.name} e={e} />)}
        </div>
      </div>
    </div>
  );
}

function ScreenWeather({ now, city }: { now: Date | null; city: string }) {
  const base = now ?? new Date(2024, 0, 1);
  const forecast = conds.map((c, i) => {
    const dt = new Date(base);
    dt.setDate(base.getDate() + i);
    return { day: i === 0 ? "Hoje" : wdShort[dt.getDay()], hi: his[i], lo: los[i], cond: c };
  });
  const refNew = Date.UTC(2000, 0, 6, 18, 14) / 86400000;
  const syn = 29.530588853;
  let phase = ((base.getTime() / 86400000 - refNew) % syn) / syn;
  if (phase < 0) phase += 1;
  const illum = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  const waxing = phase < 0.5;
  let moonName = "Lua minguante";
  if (phase < 0.02 || phase > 0.98) moonName = "Lua nova";
  else if (phase < 0.23) moonName = "Lua crescente";
  else if (phase < 0.27) moonName = "Quarto crescente";
  else if (phase < 0.48) moonName = "Crescente gibosa";
  else if (phase < 0.52) moonName = "Lua cheia";
  else if (phase < 0.73) moonName = "Minguante gibosa";
  else if (phase < 0.77) moonName = "Quarto minguante";
  const moonOffset = Math.round((1 - illum) * 158);

  return (
    <div style={screen} className="d-flex flex-column">
      <div style={{ marginBottom: 24 }}>
        <div style={kicker}>Clima · {city}</div>
        <div style={h1}>Previsão da semana</div>
      </div>
      <div className="row g-4 flex-grow-1" style={{ minHeight: 0 }}>
        <div className="col-7">
          <div style={panel} className="h-100 d-flex flex-column justify-content-center p-4">
            <div className="d-flex align-items-end gap-4">
              <div style={{ fontSize: 140, fontWeight: 300, color: FG, lineHeight: 0.86 }}>24°</div>
              <div className="pb-3">
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "rgba(238,243,234,0.5)" }}>Agora</div>
                <div style={{ fontSize: 22, color: "rgba(238,243,234,0.75)" }}>Parcialmente nublado</div>
              </div>
            </div>
            <div className="d-flex gap-5 pt-3 mt-3" style={{ borderTop: "1px solid rgba(238,243,234,0.1)" }}>
              {[["Sensação", "23°"], ["Umidade", "62%"], ["Vento", "12 km/h"]].map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontSize: 12, color: "rgba(238,243,234,0.45)" }}>{k}</div>
                  <div style={{ fontSize: 26, fontWeight: 700, color: FG }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="col-5">
          <div style={panel} className="h-100 d-flex flex-column align-items-center justify-content-center p-4">
            <div style={{ ...kicker, marginBottom: 22 }}>Fase da lua</div>
            <div style={{ position: "relative", width: 158, height: 158 }}>
              <div style={{ position: "absolute", inset: 0, borderRadius: "50%", overflow: "hidden", background: "#0c130d", boxShadow: "0 0 50px rgba(160,208,99,0.14)" }}>
                <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "radial-gradient(circle at 38% 34%, #f4f7ea 0%, #d4dcbd 68%, #bcc7a3 100%)", transform: `translateX(${waxing ? moonOffset : -moonOffset}px)` }} />
              </div>
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: FG, marginTop: 22 }}>{moonName}</div>
            <div style={{ fontSize: 14, color: "rgba(238,243,234,0.55)" }}>{Math.round(illum * 100)}% iluminada</div>
          </div>
        </div>
      </div>
      <div className="d-flex gap-3 mt-3">
        {forecast.map((d, i) => (
          <div key={i} style={{ ...panel, flex: 1, padding: "18px 8px" }} className="d-flex flex-column align-items-center gap-2">
            <div style={{ fontSize: 14, fontWeight: 700, color: "rgba(238,243,234,0.85)" }}>{d.day}</div>
            <div style={{ fontSize: 22 }}>{d.cond === "sol" ? "☀️" : d.cond === "parcial" ? "⛅" : d.cond === "nublado" ? "☁️" : "🌧️"}</div>
            <div>
              <span style={{ fontSize: 20, fontWeight: 800, color: FG }}>{d.hi}°</span>{" "}
              <span style={{ fontSize: 14, color: "rgba(238,243,234,0.45)" }}>{d.lo}°</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScreenChannels({ channels }: { channels: Channel[] }) {
  const cmax = Math.max(1, ...channels.map((c) => c.value));
  return (
    <div style={screen} className="d-flex flex-column">
      <div style={{ marginBottom: 24 }}>
        <div style={kicker}>Tráfego por canal · participação</div>
        <div style={h1}>De onde vêm as visitas</div>
      </div>
      <div className="flex-grow-1 d-flex flex-column justify-content-center gap-4">
        {channels.map((c, i) => (
          <div key={c.label} className="d-flex align-items-center gap-3">
            <span style={{ width: 240, fontSize: 18, fontWeight: 600, color: "rgba(238,243,234,0.85)" }}>{c.label}</span>
            <div className="flex-grow-1" style={{ height: 24, background: "rgba(238,243,234,0.08)", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${(c.value / cmax) * 100}%`, background: i === 0 ? ACCENT : i === 1 ? ACCENT2 : "rgba(238,243,234,0.18)", transition: "width .9s" }} />
            </div>
            <span style={{ width: 70, textAlign: "right", fontSize: 20, fontWeight: 700, color: i === 0 ? ACCENT : "rgba(238,243,234,0.8)" }}>{c.value}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const screen: CSSProperties = { position: "absolute", inset: 0, padding: "40px 60px", transition: "opacity .9s ease" };
const panel: CSSProperties = { background: "rgba(238,243,234,0.045)", border: "1px solid rgba(238,243,234,0.10)", borderRadius: 16 };
const kicker: CSSProperties = { fontSize: 12, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", color: ACCENT, marginBottom: 8 };
const h1: CSSProperties = { fontSize: 52, fontWeight: 800, lineHeight: 1, color: FG };

function Dashboard() {
  const { cfg } = useDashboardConfig();
  const [now, setNow] = useState<Date | null>(null);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const boardRef = useRef<HTMLDivElement | null>(null);

  const activeScreens = useMemo(() => {
    const list: Array<{ key: string; title: string; kicker: string; node: React.ReactNode }> = [];
    if (cfg.screens.projects) list.push({ key: "projects", title: "Projetos Atuais", kicker: "Equipe · em andamento", node: <ScreenProjects now={now} employees={cfg.employees} /> });
    if (cfg.screens.weather) list.push({ key: "weather", title: "Clima", kicker: "Próximos 7 dias · fase da lua", node: <ScreenWeather now={now} city={cfg.weatherCity} /> });
    if (cfg.screens.channels) list.push({ key: "channels", title: "Tráfego por canal", kicker: "Participação %", node: <ScreenChannels channels={cfg.channels} /> });
    return list;
  }, [cfg, now]);

  const total = Math.max(1, activeScreens.length);
  const safeIdx = idx % total;

  useEffect(() => {
    const t = setInterval(() => {
      setNow(new Date());
      if (!paused) {
        setElapsed((e) => {
          if (e + 1 >= cfg.rotationSeconds) {
            setIdx((i) => (i + 1) % Math.max(1, total));
            return 0;
          }
          return e + 1;
        });
      }
    }, 1000);
    return () => clearInterval(t);
  }, [paused, cfg.rotationSeconds, total]);

  useEffect(() => {
    const fit = () => {
      const el = boardRef.current;
      if (!el) return;
      const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
      el.style.transform = `translate(-50%,-50%) scale(${s})`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#0a0f0b", overflow: "hidden", fontFamily: "'Montserrat',sans-serif" }}>
      <div ref={boardRef} style={{ position: "absolute", top: "50%", left: "50%", width: 1920, height: 1080, transformOrigin: "center center", background: "radial-gradient(130% 130% at 84% 0%, #1e2c20 0%, #16211a 55%, #0f1711 100%)", color: FG, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div className="d-flex align-items-center justify-content-between" style={{ height: 130, padding: "0 88px", borderBottom: "1px solid rgba(238,243,234,0.10)", flex: "none" }}>
          <div className="d-flex align-items-center gap-3">
            <Logo />
            <div>
              <div style={{ fontSize: 32, fontWeight: 900, letterSpacing: 1, color: FG }}>LARSIL</div>
              <div style={{ fontSize: 14, fontWeight: 500, letterSpacing: 7, color: ACCENT }}>FLORESTAL</div>
            </div>
          </div>
          <div className="d-flex align-items-center gap-4">
            <Link to="/admin" style={{ color: "rgba(238,243,234,0.6)", fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: 2, textDecoration: "none" }}>Gestão →</Link>
            <div className="text-end">
              <div suppressHydrationWarning style={{ fontVariantNumeric: "tabular-nums" }}>
                <span style={{ fontSize: 40, fontWeight: 700, color: FG }}>{now ? now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "--:--"}</span>
                {now && <span style={{ fontSize: 18, fontWeight: 600, color: ACCENT, marginLeft: 6 }}>{String(now.getSeconds()).padStart(2, "0")}</span>}
              </div>
              <div suppressHydrationWarning style={{ fontSize: 14, color: "rgba(238,243,234,0.55)", textTransform: "capitalize" }}>
                {now ? now.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" }).replace(".", "") : ""}
              </div>
            </div>
          </div>
        </div>

        <div style={{ position: "relative", flex: "1 1 auto" }}>
          {activeScreens.map((s, i) => (
            <div key={s.key} style={{ position: "absolute", inset: 0, opacity: safeIdx === i ? 1 : 0, transition: "opacity .9s ease", pointerEvents: safeIdx === i ? "auto" : "none" }}>
              {s.node}
            </div>
          ))}
          {activeScreens.length === 0 && (
            <div className="d-flex h-100 align-items-center justify-content-center" style={{ color: "rgba(238,243,234,0.5)", fontSize: 22 }}>
              Nenhuma tela ativa. Configure em <Link to="/admin" style={{ color: ACCENT, marginLeft: 8 }}>Gestão</Link>.
            </div>
          )}
        </div>

        <div className="d-flex align-items-center justify-content-between" style={{ height: 96, padding: "0 88px", borderTop: "1px solid rgba(238,243,234,0.10)", flex: "none" }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: FG }}>{activeScreens[safeIdx]?.title ?? "—"}</div>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: 2, textTransform: "uppercase", color: "rgba(238,243,234,0.45)" }}>{activeScreens[safeIdx]?.kicker ?? ""}</div>
          </div>
          <div className="d-flex align-items-center gap-2">
            {activeScreens.map((_, i) => (
              <div key={i} onClick={() => { setIdx(i); setElapsed(0); }} style={{ height: 9, width: i === safeIdx ? 32 : 9, borderRadius: 5, background: i === safeIdx ? ACCENT : "rgba(238,243,234,0.22)", cursor: "pointer", transition: "all .5s" }} />
            ))}
          </div>
          <div className="d-flex align-items-center gap-2">
            <button onClick={() => { setIdx((i) => (i + total - 1) % total); setElapsed(0); }} className="btn rounded-circle" style={{ width: 48, height: 48, border: "1.5px solid rgba(238,243,234,0.22)", color: "rgba(238,243,234,0.8)" }}>‹</button>
            <button onClick={() => setPaused((p) => !p)} className="btn rounded-circle d-flex align-items-center justify-content-center" style={{ width: 56, height: 56, background: ACCENT2, color: "#0f1711", fontSize: 14 }}>{paused ? "▶" : "❚❚"}</button>
            <button onClick={() => { setIdx((i) => (i + 1) % total); setElapsed(0); }} className="btn rounded-circle" style={{ width: 48, height: 48, border: "1.5px solid rgba(238,243,234,0.22)", color: "rgba(238,243,234,0.8)" }}>›</button>
          </div>
        </div>

        <div style={{ position: "absolute", left: 0, bottom: 0, height: 4, width: `${(elapsed / cfg.rotationSeconds) * 100}%`, background: ACCENT2, transition: "width 1s linear" }} />
      </div>
    </div>
  );
}
