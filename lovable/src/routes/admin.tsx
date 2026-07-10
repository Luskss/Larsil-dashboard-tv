import { createFileRoute, Link } from "@tanstack/react-router";
import { DEFAULT_CONFIG, useDashboardConfig, type Channel, type Emp } from "@/lib/dashboard-store";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Gestão · LARSIL Dashboard" }] }),
  component: Admin,
});

const ACCENT = "#a0d063";
const FG = "#eef3ea";

function Admin() {
  const { cfg, setCfg, ready } = useDashboardConfig();

  if (!ready) return <div style={{ minHeight: "100vh", background: "#0a0f0b" }} />;

  const update = (patch: Partial<typeof cfg>) => setCfg({ ...cfg, ...patch });
  const updateEmp = (i: number, patch: Partial<Emp>) => {
    const employees = cfg.employees.map((e, idx) => (idx === i ? { ...e, ...patch } : e));
    update({ employees });
  };
  const removeEmp = (i: number) => update({ employees: cfg.employees.filter((_, idx) => idx !== i) });
  const addEmp = () => update({ employees: [...cfg.employees, { initials: "NN", name: "Novo funcionário", role: "Cargo", project: "Projeto", pct: 0, status: "Iniciado" }] });

  const updateChan = (i: number, patch: Partial<Channel>) => {
    const channels = cfg.channels.map((c, idx) => (idx === i ? { ...c, ...patch } : c));
    update({ channels });
  };
  const removeChan = (i: number) => update({ channels: cfg.channels.filter((_, idx) => idx !== i) });
  const addChan = () => update({ channels: [...cfg.channels, { label: "Novo canal", value: 10 }] });

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(180deg,#0f1711 0%,#0a0f0b 100%)", color: FG, fontFamily: "'Montserrat',sans-serif", padding: "32px 24px" }}>
      <div className="container" style={{ maxWidth: 1100 }}>
        <div className="d-flex align-items-center justify-content-between mb-4">
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", color: ACCENT }}>LARSIL Florestal</div>
            <h1 style={{ fontSize: 38, fontWeight: 800, margin: 0 }}>Gestão do Dashboard</h1>
          </div>
          <div className="d-flex gap-2">
            <button className="btn" style={{ border: "1px solid rgba(238,243,234,0.2)", color: FG }} onClick={() => { if (confirm("Restaurar valores padrão?")) setCfg(DEFAULT_CONFIG); }}>Restaurar padrão</button>
            <Link to="/" className="btn" style={{ background: ACCENT, color: "#0f1711", fontWeight: 700 }}>Ver dashboard →</Link>
          </div>
        </div>

        <Section title="Telas e rotação">
          <div className="row g-3 align-items-end">
            <div className="col-md-4">
              <label className="form-label" style={lbl}>Tempo por tela (segundos)</label>
              <input type="number" min={5} max={300} className="form-control" style={inp}
                value={cfg.rotationSeconds}
                onChange={(e) => update({ rotationSeconds: Math.max(5, Number(e.target.value) || 5) })} />
            </div>
            <div className="col-md-8">
              <label className="form-label" style={lbl}>Telas ativas</label>
              <div className="d-flex flex-wrap gap-3">
                {(["projects", "weather", "channels"] as const).map((k) => (
                  <label key={k} className="d-flex align-items-center gap-2" style={{ background: "rgba(238,243,234,0.045)", border: "1px solid rgba(238,243,234,0.15)", borderRadius: 10, padding: "10px 16px", cursor: "pointer" }}>
                    <input type="checkbox" className="form-check-input m-0" checked={cfg.screens[k]} onChange={(e) => update({ screens: { ...cfg.screens, [k]: e.target.checked } })} />
                    <span style={{ textTransform: "capitalize" }}>{k === "projects" ? "Projetos" : k === "weather" ? "Clima" : "Canais"}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </Section>

        <Section title="Clima">
          <label className="form-label" style={lbl}>Cidade exibida</label>
          <input className="form-control" style={inp} value={cfg.weatherCity} onChange={(e) => update({ weatherCity: e.target.value })} />
        </Section>

        <Section title={`Funcionários (${cfg.employees.length})`} action={<button className="btn btn-sm" style={btnAccent} onClick={addEmp}>+ Adicionar</button>}>
          <div className="d-flex flex-column gap-2">
            {cfg.employees.map((e, i) => (
              <div key={i} className="row g-2 align-items-center" style={{ background: "rgba(238,243,234,0.045)", border: "1px solid rgba(238,243,234,0.10)", borderRadius: 10, padding: 10 }}>
                <div className="col-1"><input className="form-control" style={inp} value={e.initials} maxLength={3} onChange={(ev) => updateEmp(i, { initials: ev.target.value.toUpperCase() })} /></div>
                <div className="col-3"><input className="form-control" style={inp} value={e.name} onChange={(ev) => updateEmp(i, { name: ev.target.value })} /></div>
                <div className="col-2"><input className="form-control" style={inp} value={e.role} onChange={(ev) => updateEmp(i, { role: ev.target.value })} /></div>
                <div className="col-3"><input className="form-control" style={inp} value={e.project} onChange={(ev) => updateEmp(i, { project: ev.target.value })} /></div>
                <div className="col-1"><input type="number" min={0} max={100} className="form-control" style={inp} value={e.pct} onChange={(ev) => updateEmp(i, { pct: Math.max(0, Math.min(100, Number(ev.target.value) || 0)) })} /></div>
                <div className="col-1"><input className="form-control" style={inp} value={e.status} onChange={(ev) => updateEmp(i, { status: ev.target.value })} /></div>
                <div className="col-1 text-end"><button className="btn btn-sm" style={btnGhost} onClick={() => removeEmp(i)}>✕</button></div>
              </div>
            ))}
          </div>
        </Section>

        <Section title={`Canais (${cfg.channels.length})`} action={<button className="btn btn-sm" style={btnAccent} onClick={addChan}>+ Adicionar</button>}>
          <div className="d-flex flex-column gap-2">
            {cfg.channels.map((c, i) => (
              <div key={i} className="row g-2 align-items-center" style={{ background: "rgba(238,243,234,0.045)", border: "1px solid rgba(238,243,234,0.10)", borderRadius: 10, padding: 10 }}>
                <div className="col-7"><input className="form-control" style={inp} value={c.label} onChange={(ev) => updateChan(i, { label: ev.target.value })} /></div>
                <div className="col-3"><input type="number" min={0} max={100} className="form-control" style={inp} value={c.value} onChange={(ev) => updateChan(i, { value: Math.max(0, Math.min(100, Number(ev.target.value) || 0)) })} /></div>
                <div className="col-2 text-end"><button className="btn btn-sm" style={btnGhost} onClick={() => removeChan(i)}>Remover</button></div>
              </div>
            ))}
          </div>
        </Section>

        <p style={{ fontSize: 12, color: "rgba(238,243,234,0.45)", marginTop: 24 }}>
          As alterações são salvas automaticamente neste navegador e refletem no dashboard em tempo real.
        </p>
      </div>
    </div>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section style={{ background: "rgba(238,243,234,0.03)", border: "1px solid rgba(238,243,234,0.10)", borderRadius: 16, padding: 24, marginBottom: 20 }}>
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, letterSpacing: 1, textTransform: "uppercase", color: ACCENT }}>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const inp: React.CSSProperties = { background: "rgba(10,15,11,0.6)", border: "1px solid rgba(238,243,234,0.15)", color: FG };
const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "rgba(238,243,234,0.55)" };
const btnAccent: React.CSSProperties = { background: ACCENT, color: "#0f1711", fontWeight: 700 };
const btnGhost: React.CSSProperties = { border: "1px solid rgba(238,243,234,0.2)", color: FG };
