import React, { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fmtNum, fmtMoney } from "@/lib/api";
import { useCoordenador, useSupervisor } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp, MousePointerClick } from "lucide-react";
import { QuickDayFilter } from "@/components/quick-date-filter";

export const Route = createFileRoute("/boletins/acompanhar")({
  head: () => ({
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Manrope:wght@400;500;600;700;800&display=swap",
      },
    ],
  }),
  component: AcompanharPage,
});

const BASE_URL = "";

type DayState = "a" | "ap" | "n" | "nb" | "f" | "sa" | "nt" | "x";
type FolgaInfo = { evento: string; motivo: string };
type Linha = {
  lider: string; nomeLider: string; supervisor: string;
  coordenador?: string; // coordenador da linha (p/ filtro + score por coordenador)
  projeto: string; // projeto único desta linha (pode ser vazio para líderes de 1 projeto)
  apontador?: string; // quem realmente lança o boletim (se diferente do líder, ex: PCP)
  dias: Record<number, DayState>;
  folgaInfo: Record<number, FolgaInfo>;
  projetoPorDia: Record<number, string>;
  pontosFeitos: number; pontosEsperados: number;
  diasSemApontar: number; aderencia: number;
};
type EstruturaSup = {
  dias: Record<number, DayState>;
  feitos: number; esperados: number; diasSemEstrutura: number; aderencia: number;
};
type MatrizResponse = {
  coords: string[]; supervisores: string[]; diasNoMes: number; diaCorte: number; matriz: Linha[];
  estruturaSup?: Record<string, EstruturaSup>;
};
type BoletimDia = { ID: number; PROJETO?: string; FAZENDA?: string; TALHAO?: string; STATUS?: string; SERVICO?: string; PRODUCAO?: number; DISTRIBUIDO_PREMIO?: string | null };
type PremioDia = { ID: number; COLABORADOR?: string; CPF?: string; ATIVIDADE_EXECUTADA?: string; META?: number; PRODUCAO_DO_DIA?: number; VALOR_A_RECEBER?: number; RECEBE_PREMIO?: string; APROVADO?: string | null };
type DiaDetalhe = { boletins: BoletimDia[]; premios: PremioDia[] };

const DIAS_LETRA = ["D", "S", "T", "Q", "Q", "S", "S"];
const MESES_PT = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtDiaBR(iso: string) {
  const [a, m, d] = (iso || "").split("-");
  return d && m && a ? `${d}/${m}/${a}` : iso;
}
function primeiroEUltimo(nome?: string) {
  if (!nome) return "—";
  const p = nome.trim().split(/\s+/).filter(Boolean);
  if (p.length <= 1) return p[0] ?? "—";
  return `${p[0]} ${p[p.length - 1]}`;
}
function scoreCls(pct: number): "ok" | "warn" | "err" {
  if (pct >= 100) return "ok";
  if (pct >= 80) return "warn";
  return "err";
}
const isTerc = (l: Linha) => l.lider.toUpperCase().startsWith("T_");

function abrevEvento(evento: string): string {
  if (!evento) return "F";
  const u = evento.trim().toUpperCase();
  if (u === "FOLGA")                   return "F";
  if (u === "NÃO APLICA")              return "NA";
  if (u === "SEM ATIVIDADE")           return "SA";
  if (u.includes("ANTECIP"))           return "AN";
  if (u.includes("ATESTAD"))           return "AT";
  if (u.includes("FÉRIAS") || u.includes("FERIAS")) return "FÉ";
  if (u.includes("VIAGEM"))            return "VI";
  if (u.includes("LICEN"))             return "LI";
  const words = u.split(/\s+/).filter(Boolean);
  if (words.length === 1) return u.slice(0, 2);
  return words.map((w) => w[0]).join("").slice(0, 2);
}

function eventoColor(evento: string): string {
  const u = (evento || "").trim().toUpperCase();
  if (u === "FOLGA" || !u) return "bg-[#2e7d32]";          // verde
  if (u === "SEM ATIVIDADE")  return "bg-[#ef6c00]";         // laranja
  if (u === "NÃO APLICA")     return "bg-[#78909c]";         // cinza
  if (u.includes("ANTECIP"))  return "bg-[#0277bd]";         // azul
  if (u.includes("ATESTAD"))  return "bg-[#1565c0]";         // azul escuro
  if (u.includes("FÉRIAS") || u.includes("FERIAS")) return "bg-[#2e7d32]"; // verde
  if (u.includes("VIAGEM"))   return "bg-[#6a1b9a]";         // roxo
  if (u.includes("LICEN"))    return "bg-[#00838f]";         // teal
  return "bg-[#f57c00]";                                     // fallback laranja escuro
}

function cellColor(s: DayState, evento?: string): string {
  switch (s) {
    case "a":  return "bg-[#2e7d32]";
    case "ap": return "bg-[#c62828]";
    case "n":  return "bg-[#c62828]";
    case "nb": return "bg-[#c62828]";
    case "f":  return eventoColor(evento || "FOLGA");
    default:   return "bg-[#f0ece4] border border-[#e0dbd0]";
  }
}
function CellSymbol({ s, evento, projeto }: { s: DayState; evento?: string; projeto?: string }) {
  if ((s === "a" || s === "ap") && projeto) {
    return <span className="font-black leading-none tracking-tight">{projeto}</span>;
  }
  if (s === "a")  return <span className="leading-none">✓</span>;
  if (s === "ap") return <span className="font-black leading-none">P</span>;
  if (s === "nb") return <span className="font-black leading-none">B</span>;
  if (s === "n")  return <span className="flex flex-col items-center font-black leading-[1] text-[8px]"><span>B</span><span>P</span></span>;
  if (s === "f")  return <span className="font-black leading-none">{abrevEvento(evento || "FOLGA")}</span>;
  return null;
}

function AcompanharPage() {
  const [dataRef, setDataRef] = useState<string>(() => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const supLogado = useSupervisor();               // escopo: supervisor do login (vazio se não for supervisor)
  const [coord, setCoord] = useState<string>("all");
  const [supF, setSupF] = useState<string>(supLogado || "all");
  // Supervisor logado fica travado no próprio escopo (não pode ver outros supervisores)
  React.useEffect(() => { if (supLogado) setSupF(supLogado); }, [supLogado]);
  const [openLider, setOpenLider] = useState<Linha | null>(null);
  const [openDia, setOpenDia] = useState<number | null>(null);
  const [cardsExpanded, setCardsExpanded] = useState(true);

  const [anoStr, mesStr, diaStr] = dataRef.split("-");
  const ano = Number(anoStr), mes = Number(mesStr), diaFoco = Number(diaStr);
  const mesPrefix = `${anoStr}-${mesStr}`;

  const coordsQ = useQuery({
    queryKey: ["acomp-coords"],
    queryFn: async () => {
      const r = await fetch(`${BASE_URL}/api/acompanhamento/matriz?mes=${mesPrefix}`);
      if (!r.ok) throw new Error(`API ${r.status}`);
      return ((await r.json()) as MatrizResponse).coords;
    },
    staleTime: 5 * 60_000,
  });
  const coordScope = useCoordenador();             // "all" (PCP/gerência vê tudo) ou nome do coord travado
  const coordLocked = coordScope !== "all" ? coordScope : ""; // só trava quando é um coordenador específico
  const coords = coordsQ.data ?? [];
  // coordenador efetivo: travado pelo login, senão o selecionado nos chips ("all" = todos os coordenadores)
  const coordSel = coordLocked || coord;

  const matrizQ = useQuery({
    queryKey: ["acomp-matriz", mesPrefix, coordSel, supF],
    queryFn: async (): Promise<MatrizResponse> => {
      const usp = new URLSearchParams({ mes: mesPrefix });
      if (coordSel !== "all") usp.set("coord", coordSel); // "all" → omite → backend agrega todos
      if (supF !== "all") usp.set("sup", supF);
      const r = await fetch(`${BASE_URL}/api/acompanhamento/matriz?${usp}`);
      if (!r.ok) throw new Error(`API ${r.status}: ${await r.text()}`);
      return r.json();
    },
    staleTime: 60_000,
  });

  const matriz = matrizQ.data?.matriz ?? [];
  const supervisores = matrizQ.data?.supervisores ?? [];
  const estruturaSup: Record<string, EstruturaSup> = matrizQ.data?.estruturaSup ?? {};
  const diasNoMes = matrizQ.data?.diasNoMes ?? new Date(ano, mes, 0).getDate();

  const scoresMensal = useMemo(() => {
    const pf = matriz.reduce((s, l) => s + l.pontosFeitos, 0);
    const pe = matriz.reduce((s, l) => s + l.pontosEsperados, 0);
    return { pf, pe, pct: pe > 0 ? (pf / pe) * 100 : 0 };
  }, [matriz]);

  const scoresDia = useMemo(() => {
    let pf = 0, pe = 0;
    let apontaram = 0, naoAp = 0, semPremio = 0, folga = 0;
    for (const l of matriz) {
      const s = l.dias[diaFoco];
      if (s === "a")  { pf += 2; pe += 2; apontaram++; }
      if (s === "ap") { pf += 1; pe += 2; apontaram++; semPremio++; }
      if (s === "n")  { pe += 2; naoAp++; }
      if (s === "nb") { pe += 1; naoAp++; }
      if (s === "f")  { folga++; }
    }
    return { apontaram, naoAp, semPremio, folga, totalLid: matriz.length, pf, pe, pct: pe > 0 ? (pf / pe) * 100 : 0 };
  }, [matriz, diaFoco]);

  const grupos = useMemo(() => {
    const g: Record<string, Linha[]> = {};
    for (const l of matriz) (g[l.supervisor] ||= []).push(l);
    return g;
  }, [matriz]);
  const supsOrdenados = useMemo(() => Object.keys(grupos).sort((a, b) => a.localeCompare(b, "pt-BR")), [grupos]);

  // Score do DIA por coordenador (mesma conta dos chips de supervisor) — só popula
  // coordenadores presentes na matriz (em "Todos" mostra todos; ajuda a ver quem está pior)
  const coordScores = useMemo(() => {
    const acc: Record<string, { sa: number; sap: number; sn: number; snb: number }> = {};
    for (const l of matriz) {
      const c = l.coordenador || "";
      if (!c) continue;
      const x = (acc[c] ||= { sa: 0, sap: 0, sn: 0, snb: 0 });
      const s = l.dias[diaFoco];
      if (s === "a") x.sa++; else if (s === "ap") x.sap++; else if (s === "n") x.sn++; else if (s === "nb") x.snb++;
    }
    const out: Record<string, number | null> = {};
    for (const [c, x] of Object.entries(acc)) {
      const pe = (x.sa + x.sap + x.sn) * 2 + x.snb;
      out[c] = pe > 0 ? Math.round(((x.sa * 2 + x.sap) / pe) * 100) : null;
    }
    return out;
  }, [matriz, diaFoco]);

  // Separação principais × terceiros
  const matrizFiltrada = supF === "all" ? matriz : (grupos[supF] ?? []);
  const principais = matrizFiltrada.filter((l) => !isTerc(l));
  const terceiros  = supF === "all"
    ? supsOrdenados.flatMap((s) => (grupos[s] ?? []).filter(isTerc))
    : (grupos[supF] ?? []).filter(isTerc);
  const [tercExpanded, setTercExpanded] = useState(false);

  const popupData = openDia ? `${mesPrefix}-${String(openDia).padStart(2, "0")}` : dataRef;

  const boletinsDoDiaQ = useQuery({
    queryKey: ["acomp-boletins-dia", openLider?.nomeLider, popupData],
    queryFn: async (): Promise<DiaDetalhe> => {
      if (!openLider) return { boletins: [], premios: [] };
      const r = await fetch(`${BASE_URL}/api/acompanhamento/boletins-dia?lider=${encodeURIComponent(openLider.nomeLider)}&data=${popupData}`);
      if (!r.ok) throw new Error(`API ${r.status}`);
      const j = await r.json();
      return { boletins: j.rows ?? [], premios: j.premios ?? [] };
    },
    enabled: !!openLider,
  });
  const boletinsDoDiaLider = boletinsDoDiaQ.data?.boletins ?? [];
  const premiosDoDia = boletinsDoDiaQ.data?.premios ?? [];
  const isLoading = matrizQ.isLoading || coordsQ.isLoading;

  const toneMensal = scoresMensal.pe > 0 ? scoreCls(scoresMensal.pct) : "err";
  const toneDia    = scoresDia.pe > 0 ? scoreCls(scoresDia.pct) : "err";

  const scoreColorM = toneMensal === "ok" ? "text-[#0d7a5f]" : toneMensal === "warn" ? "text-[#c9a84c]" : "text-red-600";
  const scoreColorD = toneDia === "ok" ? "text-[#0d7a5f]" : toneDia === "warn" ? "text-[#c9a84c]" : "text-red-600";

  return (
    <div className="bg-[#fcfbf7] font-[Manrope,system-ui,sans-serif]">
      {/* ── HEADER FIXO NO TOPO ── */}
      <div className="sticky top-0 z-30 bg-white border-b border-[#e5e0d0] shadow-sm">
        {/* Linha 1: dia + coordenador + scores */}
        <div className="px-4 pt-2 pb-1 flex flex-wrap items-center gap-x-4 gap-y-1">
          {/* Dia foco */}
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-bold uppercase tracking-widest text-[#064e3b]/50">Dia</span>
            <QuickDayFilter value={dataRef} onChange={setDataRef} />
            <Input type="date" value={dataRef} max={todayISO()} onChange={(e) => setDataRef(e.target.value)}
              className="bg-[#f5f0e0] border-0 rounded-lg h-7 w-32 text-[11px] font-semibold text-[#064e3b]" />
          </div>

          {/* Separador */}
          <div className="h-6 w-px bg-[#e5e0d0]" />

          {/* Coordenadores como botões — escondidos só quando o login trava num coordenador específico */}
          {!coordLocked && (
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
              <span className="text-[9px] font-bold uppercase tracking-widest text-[#064e3b]/50 mr-1 shrink-0">Coord.</span>
              <ChipButton active={coord === "all"} onClick={() => { setCoord("all"); setSupF("all"); }}>Todos</ChipButton>
              {coords.map((c) => {
                const pct = coordScores[c];
                return (
                  <ChipButton key={c} active={coord === c} onClick={() => { setCoord(c); setSupF("all"); }}>
                    <span className="truncate max-w-[120px]">{c.split(" ")[0]}</span>
                    {pct != null && (
                      <span className={cn("ml-1 font-black text-[9px] shrink-0", coord === c ? "text-white/80" : pct >= 100 ? "text-emerald-600" : pct >= 80 ? "text-amber-600" : "text-red-500")}>
                        {pct}%
                      </span>
                    )}
                  </ChipButton>
                );
              })}
            </div>
          )}

          <div className="flex-1" />

          {/* Scores */}
          <div className="flex items-center gap-3">
            <div className="text-right">
              <p className="text-[9px] font-bold text-[#064e3b]/50 uppercase tracking-widest">Mensal</p>
              <p className={cn("font-[Sora,sans-serif] text-base font-bold leading-none", scoreColorM)}>
                {scoresMensal.pe > 0 ? `${scoresMensal.pct.toFixed(0)}%` : "—"}
              </p>
            </div>
            <div className="h-6 w-px bg-[#e5e0d0]" />
            <div className="text-right">
              <p className="text-[9px] font-bold text-[#064e3b]/50 uppercase tracking-widest">{fmtDiaBR(dataRef)}</p>
              <p className={cn("font-[Sora,sans-serif] text-base font-bold leading-none", scoreColorD)}>
                {scoresDia.pe > 0 ? `${scoresDia.pct.toFixed(0)}%` : "—"}
              </p>
            </div>
          </div>
        </div>

        {/* Linha 2: supervisores como chips scrolláveis — escondidos p/ supervisor logado (escopo travado) */}
        {!supLogado && supervisores.length > 0 && (
          <div className="px-4 pb-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <span className="text-[9px] font-bold uppercase tracking-widest text-[#064e3b]/50 shrink-0">Sup.</span>
            <ChipButton active={supF === "all"} onClick={() => setSupF("all")} variant="sup">Todos</ChipButton>
            {supervisores.map((s) => {
              const arr = grupos[s] ?? [];
              const sa = arr.filter((l) => l.dias[diaFoco] === "a").length;
              const sap = arr.filter((l) => l.dias[diaFoco] === "ap").length;
              const sn = arr.filter((l) => l.dias[diaFoco] === "n").length;
              const snb = arr.filter((l) => l.dias[diaFoco] === "nb").length;
              // "nb" (sem boletim, não treinado) também deve o boletim → conta 1 ponto
              const pe = (sa + sap + sn) * 2 + snb;
              const pct = pe > 0 ? Math.round(((sa * 2 + sap) / pe) * 100) : 0;
              const pctColor = pct >= 100 ? "text-emerald-600" : pct >= 80 ? "text-amber-600" : "text-red-500";
              return (
                <ChipButton key={s} active={supF === s} onClick={() => setSupF(s)} variant="sup">
                  <span className="truncate max-w-[120px]">{s.split(" ")[0]}</span>
                  {pe > 0 && (
                    <span className={cn("ml-1 font-black text-[9px] shrink-0", supF === s ? "text-white/80" : pctColor)}>
                      {pct}%
                    </span>
                  )}
                </ChipButton>
              );
            })}
          </div>
        )}
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
          <KpiCard label="Líderes Ativos"  value={scoresDia.totalLid}  accent="neutral" />
          <KpiCard label="Apontaram"        value={scoresDia.apontaram} accent="ok" />
          <KpiCard label="Não Apontaram"    value={scoresDia.naoAp}     accent="err" />
          <KpiCard label="Sem Prêmio"       value={scoresDia.semPremio} accent="warn" />
          <KpiCard label="Folga / Ausente"  value={scoresDia.folga}     accent="muted" />
        </div>

        {/* Cards supervisores (expansível) */}
        <div>
          <button type="button" onClick={() => setCardsExpanded((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-[#064e3b]/70 hover:text-[#064e3b] transition-colors mb-2">
            {cardsExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Por Supervisor · {fmtDiaBR(dataRef)}
          </button>
          {cardsExpanded && !isLoading && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2">
              {supsOrdenados.map((sup) => (
                <SupCard key={sup} sup={sup} arr={grupos[sup] ?? []} diaFoco={diaFoco} est={estruturaSup[sup]}
                  onOpenLider={(l) => { setOpenLider(l); setOpenDia(diaFoco); }} />
              ))}
            </div>
          )}
        </div>

        {/* ── TERCEIROS (tabela separada, expansível) ── */}
        {terceiros.length > 0 && (
          <div className="bg-white rounded-xl border border-[#e5e0d0] shadow-sm overflow-hidden">
            <button type="button" onClick={() => setTercExpanded((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-2 hover:bg-[#f5f0e0]/60 transition-colors">
              <div className="flex items-center gap-2">
                {tercExpanded ? <ChevronUp className="w-3.5 h-3.5 text-[#064e3b]/60" /> : <ChevronDown className="w-3.5 h-3.5 text-[#064e3b]/60" />}
                <span className="font-[Sora,sans-serif] font-bold text-[#064e3b] text-sm">Terceiros</span>
                <span className="text-[10px] text-[#064e3b]/50 font-medium">— só boletim cobrado, prêmio não aplicável</span>
              </div>
              <span className="text-[10px] font-bold text-[#064e3b]/60">{terceiros.length} terceiros</span>
            </button>
            {tercExpanded && (
              <div className="overflow-x-auto border-t border-[#e5e0d0]">
                <table className="w-full border-collapse" style={{ tableLayout: "fixed" }}>
                  <colgroup>
                    <col style={{ width: "140px", minWidth: "100px" }} />
                    <col style={{ width: "130px", minWidth: "100px" }} />
                    {Array.from({ length: diasNoMes }, (_, i) => <col key={i} />)}
                    <col style={{ width: "44px" }} />
                    <col style={{ width: "52px" }} />
                  </colgroup>
                  <thead>
                    <tr className="bg-[#f0ece4]">
                      <th className="px-2 py-1 text-left text-[9px] font-bold text-[#064e3b]/70 uppercase border-r border-[#e5e0d0]">Supervisor</th>
                      <th className="px-2 py-1 text-left text-[9px] font-bold text-[#064e3b]/70 uppercase border-r border-[#e5e0d0]">Terceiro</th>
                      {Array.from({ length: diasNoMes }, (_, i) => i + 1).map((d) => {
                        const dow = new Date(ano, mes - 1, d).getDay();
                        const foco = d === diaFoco;
                        return (
                          <th key={d} className={cn("py-1 text-center font-bold",
                            foco ? "bg-[#c9a84c]/25 ring-1 ring-inset ring-[#c9a84c]/60" : "")}>
                            <div className="text-[9px] text-[#064e3b]/80">{d}</div>
                            <div className="text-[7px] opacity-50">{DIAS_LETRA[dow]}</div>
                          </th>
                        );
                      })}
                      <th className="py-1 text-center text-[8px] font-bold text-[#064e3b]/60 uppercase">S/A</th>
                      <th className="py-1 text-center text-[8px] font-bold text-[#064e3b]/60 uppercase">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {terceiros.map((l) => (
                      <HeatRow key={l.lider} l={l} diasNoMes={diasNoMes} diaFoco={diaFoco} ano={ano} mes={mes}
                        showSupervisor
                        onOpen={(d) => { setOpenLider(l); setOpenDia(d); }} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── HEATMAP: tabela livre, sem altura fixa ── */}
        <div className="bg-white rounded-xl border border-[#e5e0d0] shadow-sm overflow-hidden">
          {/* Cabeçalho da tabela */}
          <div className="px-3 py-2 border-b border-[#e5e0d0] flex items-center justify-between">
            <h3 className="font-[Sora,sans-serif] font-bold text-[#064e3b] text-sm">
              Aderência — {MESES_PT[mes - 1]}/{ano}
              {supF !== "all" && <span className="text-[#0d7a5f] ml-2">· {supF}</span>}
            </h3>
            <div className="flex flex-wrap gap-3">
              <LegendDot cls="bg-[#2e7d32]" sym="✓" txt="Boletim + Prêmio" />
              <LegendDot cls="bg-[#c62828]" sym="P" txt="Só boletim" />
              <LegendDot cls="bg-[#c62828]" sym="B/P" txt="Não apontou" />
              <LegendDot cls="bg-[#2e7d32]" sym="F" txt="Folga" />
              <LegendDot cls="bg-[#ef6c00]" sym="SA" txt="Sem Atividade" />
              <LegendDot cls="bg-[#2e7d32]" sym="NT" txt="Estrutura — Sup. Não Treinado" />
            </div>
          </div>

          {isLoading ? (
            <div className="p-10 text-center text-sm text-[#064e3b]/60">Carregando...</div>
          ) : matrizFiltrada.length === 0 ? (
            <div className="p-10 text-center text-sm text-[#064e3b]/60">Nenhum líder encontrado.</div>
          ) : (
            <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 210px)" }}>
              <table className="w-full border-collapse" style={{ tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: "160px", minWidth: "120px" }} />
                  {Array.from({ length: diasNoMes }, (_, i) => <col key={i} />)}
                  <col style={{ width: "44px" }} />
                  <col style={{ width: "52px" }} />
                </colgroup>
                <thead className="sticky top-0 z-20 shadow-sm">
                  <tr className="bg-[#f0ece4]">
                    <th className="px-2 py-1 text-left text-[9px] font-bold text-[#064e3b]/70 uppercase border-r border-[#e5e0d0]">Líder</th>
                    {Array.from({ length: diasNoMes }, (_, i) => i + 1).map((d) => {
                      const dow = new Date(ano, mes - 1, d).getDay();
                      const foco = d === diaFoco;
                      return (
                        <th key={d} className={cn("py-1 text-center font-bold",
                          foco ? "bg-[#c9a84c]/25 ring-1 ring-inset ring-[#c9a84c]/60" : "")}>
                          <div className="text-[9px] text-[#064e3b]/80">{d}</div>
                          <div className="text-[7px] opacity-50">{DIAS_LETRA[dow]}</div>
                        </th>
                      );
                    })}
                    <th className="py-1 text-center text-[8px] font-bold text-[#064e3b]/60 uppercase">S/A</th>
                    <th className="py-1 text-center text-[8px] font-bold text-[#064e3b]/60 uppercase">%</th>
                  </tr>
                </thead>
                <tbody>
                  {supsOrdenados
                    .filter((sup) => supF === "all" || sup === supF)
                    .map((sup) => {
                      const arr = (grupos[sup] ?? []).filter((l) => !isTerc(l));
                      if (arr.length === 0) return null;
                      return (
                        <React.Fragment key={sup}>
                          <SupEstruturaRow sup={sup} est={estruturaSup[sup]} diasNoMes={diasNoMes} diaFoco={diaFoco} />
                          {arr.map((l) => <HeatRow key={l.lider} l={l} diasNoMes={diasNoMes} diaFoco={diaFoco} ano={ano} mes={mes} onOpen={(d) => { setOpenLider(l); setOpenDia(d); }} />)}
                        </React.Fragment>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}

          <div className="bg-[#064e3b] px-4 py-1.5 flex items-center justify-between">
            <p className="text-white/60 text-[10px] italic flex items-center gap-1">
              <MousePointerClick className="w-3 h-3 opacity-60" /> Clique em uma linha para ver o detalhamento
            </p>
            <p className="text-white/40 text-[9px] font-bold uppercase tracking-widest">{principais.length} líderes</p>
          </div>
        </div>
      </div>

      {/* POPUP DETALHE */}
      <Dialog open={!!openLider} onOpenChange={(o) => { if (!o) { setOpenLider(null); setOpenDia(null); } }}>
        <DialogContent className="max-w-4xl max-h-[88vh] overflow-y-auto">
          {openLider && (
            <>
              <DialogHeader>
                <DialogTitle>{openLider.nomeLider}</DialogTitle>
                <DialogDescription>
                  {openLider.supervisor}{openLider.projeto ? ` · ${openLider.projeto}` : ""} · {fmtDiaBR(popupData)}
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <MiniStat label="Score Mensal" value={`${openLider.aderencia.toFixed(0)}%`} tone={scoreCls(openLider.aderencia)} />
                <MiniStat label="Dias s/ apontamento" value={String(openLider.diasSemApontar)} tone={openLider.diasSemApontar === 0 ? "ok" : openLider.diasSemApontar <= 2 ? "warn" : "err"} />
                <MiniStat label="Boletins no dia" value={String(boletinsDoDiaLider.length)} tone={boletinsDoDiaLider.length > 0 ? "ok" : "err"} />
                <MiniStat label="Prêmios no dia" value={String(premiosDoDia.length)} tone={premiosDoDia.length > 0 ? "ok" : "err"} />
              </div>
              <div className="mt-1">
                <div className="text-[11px] font-bold uppercase tracking-wide text-[#064e3b]/80 mb-1">Boletim (produção)</div>
                <div className="border rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left p-2">Projeto</th>
                        <th className="text-left p-2">Serviço</th>
                        <th className="text-left p-2">Fazenda / Talhão</th>
                        <th className="text-right p-2">Produção</th>
                        <th className="text-left p-2">Status</th>
                        <th className="text-left p-2">Prêmio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {boletinsDoDiaQ.isLoading ? (
                        <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">Carregando...</td></tr>
                      ) : boletinsDoDiaLider.length === 0 ? (
                        <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">Nenhum boletim apontado neste dia.</td></tr>
                      ) : boletinsDoDiaLider.map((b) => {
                        const dp = (b.DISTRIBUIDO_PREMIO || "").toUpperCase().trim();
                        const finalizado = (b.STATUS || "").toUpperCase().startsWith("FINALIZADO");
                        const pendente = finalizado && dp !== "SIM" && dp !== "NÃO" && dp !== "NAO";
                        return (
                          <tr key={String(b.ID)} className={cn("border-t", pendente && "bg-amber-50")}>
                            <td className="p-2">{b.PROJETO ?? "—"}</td>
                            <td className="p-2 max-w-[260px] truncate" title={b.SERVICO ?? ""}>{b.SERVICO ?? "—"}</td>
                            <td className="p-2">{(b.FAZENDA ?? "—")}{b.TALHAO ? ` / ${b.TALHAO}` : ""}</td>
                            <td className="p-2 text-right tabular-nums">{fmtNum(Number(b.PRODUCAO ?? 0))}</td>
                            <td className="p-2">{b.STATUS ?? "—"}</td>
                            <td className="p-2">
                              {dp === "SIM" ? <span className="text-emerald-600 font-bold">✓ Dist.</span>
                                : dp === "NÃO" || dp === "NAO" ? <span className="text-gray-400 text-[10px]">N/A</span>
                                : finalizado ? <span className="text-amber-600 font-black text-[10px] uppercase">⚠ Pendente</span>
                                : <span className="text-gray-400 text-[10px]">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="mt-3">
                <div className="text-[11px] font-bold uppercase tracking-wide text-[#064e3b]/80 mb-1">
                  Distribuição de prêmio{premiosDoDia.length > 0 ? ` (${premiosDoDia.length})` : ""}
                </div>
                <div className="border rounded-md overflow-auto max-h-[38vh]">
                  <table className="w-full text-xs">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        <th className="text-left p-2">Colaborador</th>
                        <th className="text-left p-2">Atividade</th>
                        <th className="text-right p-2">Meta</th>
                        <th className="text-right p-2">Prod.</th>
                        <th className="text-right p-2">A receber</th>
                        <th className="text-left p-2">Aprov.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {boletinsDoDiaQ.isLoading ? (
                        <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">Carregando...</td></tr>
                      ) : premiosDoDia.length === 0 ? (
                        <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">Nenhum prêmio distribuído neste dia.</td></tr>
                      ) : premiosDoDia.map((p) => (
                        <tr key={String(p.ID)} className="border-t">
                          <td className="p-2">{p.COLABORADOR ?? "—"}</td>
                          <td className="p-2 max-w-[220px] truncate" title={p.ATIVIDADE_EXECUTADA ?? ""}>{p.ATIVIDADE_EXECUTADA ?? "—"}</td>
                          <td className="p-2 text-right tabular-nums">{fmtNum(p.META)}</td>
                          <td className="p-2 text-right tabular-nums">{fmtNum(p.PRODUCAO_DO_DIA)}</td>
                          <td className="p-2 text-right tabular-nums font-medium">{fmtMoney(p.VALOR_A_RECEBER)}</td>
                          <td className="p-2">{p.APROVADO || (p.RECEBE_PREMIO === "SIM" ? "—" : "NÃO REC.")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Linha do SUPERVISOR na matriz: quadradinhos diários cobrando o ENVIO DA ESTRUTURA (TICKET ALOCACAO)
function SupEstruturaRow({ sup, est, diasNoMes, diaFoco }: {
  sup: string; est?: EstruturaSup; diasNoMes: number; diaFoco: number;
}) {
  const dias = est?.dias ?? {};
  const ad = est?.aderencia ?? 0;
  const adCls = ad >= 100 ? "text-[#0d7a5f]" : ad >= 80 ? "text-[#c9a84c]" : "text-red-500";
  return (
    <>
      {/* Linha título — azul escuro */}
      <tr className="bg-[#064e3b] border-b border-[#064e3b]/30">
        <td colSpan={diasNoMes + 3} className="px-3 py-1.5">
          <span className="font-black uppercase text-[12px] tracking-[0.12em] text-white">{sup}</span>
        </td>
      </tr>
      {/* Linha estrutura — azul claro */}
      <tr className="bg-[#e3f2fd] border-b-2 border-[#90caf9]/60">
        <td className="px-3 py-0.5 border-r border-[#90caf9]/40 overflow-hidden">
          <span className="font-bold text-[10px] text-[#1565c0] uppercase tracking-wide truncate block">{sup}</span>
        </td>
        {Array.from({ length: diasNoMes }, (_, i) => i + 1).map((d) => {
          const s = dias[d];
          const foco = d === diaFoco;
          const bg = s === "a" ? "bg-[#2e7d32]" : s === "nt" ? "bg-[#2e7d32]" : s === "n" ? "bg-[#c62828]" : s === "f" ? "bg-[#2e7d32]" : s === "sa" ? "bg-[#ef6c00]" : "";
          const sym = s === "a" ? "✓" : s === "nt" ? "NT" : s === "n" ? "E" : s === "f" ? "F" : s === "sa" ? "SA" : "";
          const sz = s === "sa" || s === "nt" ? "text-[7px]" : "text-[8px]";
          return (
            <td key={d} className={cn("py-0.5 px-0 text-center", foco && "bg-[#c9a84c]/8")}>
              {s && s !== "x" ? (
                <div className={cn(
                  "mx-auto rounded flex items-center justify-center text-white font-black leading-none",
                  sz, "w-[calc(100%-2px)] aspect-square max-w-[28px] max-h-[28px]",
                  bg, foco && "ring-1 ring-[#064e3b]",
                )}>{sym}</div>
              ) : null}
            </td>
          );
        })}
        <td className="py-0.5 text-center font-[Sora,sans-serif] font-bold text-[10px] text-[#1565c0]/70">{est?.diasSemEstrutura ?? 0}</td>
        <td className={cn("py-0.5 text-center font-[Sora,sans-serif] font-bold text-[10px]", adCls)}>{est ? `${ad.toFixed(0)}%` : "—"}</td>
      </tr>
    </>
  );
}

function HeatRow({ l, diasNoMes, diaFoco, ano, mes, onOpen, showSupervisor = false }: {
  l: Linha; diasNoMes: number; diaFoco: number; ano: number; mes: number;
  onOpen: (dia: number) => void;
  showSupervisor?: boolean;
}) {
  const dsaCls = l.diasSemApontar === 0 ? "text-[#0d7a5f]" : l.diasSemApontar <= 2 ? "text-[#c9a84c]" : "text-red-500";
  // Usa aderência já calculada pelo backend (já considera TREINADO/terceiros)
  const ad = l.aderencia;
  const adCls = ad >= 100 ? "text-[#0d7a5f]" : ad >= 80 ? "text-[#c9a84c]" : "text-red-500";

  return (
    <tr className="group hover:bg-[#f5f0e0]/50 cursor-pointer border-b border-[#f0ece4] transition-colors"
      onClick={() => onOpen(diaFoco)}>
      {showSupervisor && (
        <td className="px-2 py-0.5 border-r border-[#e5e0d0] overflow-hidden">
          <span className="text-[9px] text-[#064e3b]/60 font-medium truncate block">{l.supervisor}</span>
        </td>
      )}
      <td className="px-2 py-0.5 border-r border-[#e5e0d0] overflow-hidden">
        <div className="flex flex-col min-w-0">
          <span className="text-[11px] font-bold text-[#064e3b] truncate flex items-center gap-0.5" title={l.nomeLider}>
            {primeiroEUltimo(l.nomeLider)}
            <MousePointerClick className="w-2.5 h-2.5 opacity-0 group-hover:opacity-30 shrink-0" />
          </span>
          {l.projeto && <span className="text-[9px] font-bold text-[#0d7a5f] truncate">{l.projeto}</span>}
          {l.apontador && l.apontador.toUpperCase() !== l.nomeLider.toUpperCase() && (
            <span className="text-[10px] font-bold text-[#1a1a2e] truncate">apontado por: {primeiroEUltimo(l.apontador)}</span>
          )}
        </div>
      </td>
      {Array.from({ length: diasNoMes }, (_, i) => i + 1).map((d) => {
        const s = l.dias[d];
        const foco = d === diaFoco;
        const fi = l.folgaInfo?.[d];
        const evento = fi?.evento || "";
        const motivo = fi?.motivo || "";

        const projeto = l.projetoPorDia?.[d] || "";
        const cellDiv = (
          <div className={cn(
            "mx-auto rounded flex items-center justify-center text-white cursor-pointer",
            "font-black leading-none",
            projeto && (s === "a" || s === "ap") ? "text-[7px]" : "text-[8px]",
            "w-[calc(100%-2px)] aspect-square max-w-[28px] max-h-[28px]",
            cellColor(s, evento),
            foco && "ring-1 ring-[#064e3b]",
          )}>
            <CellSymbol s={s} evento={evento} projeto={projeto} />
          </div>
        );

        return (
          <td key={d} className={cn("py-0.5 px-0 text-center", foco && "bg-[#c9a84c]/8")}>
            {s === "f" && motivo ? (
              <Popover>
                <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
                  {cellDiv}
                </PopoverTrigger>
                <PopoverContent className="w-56 p-2.5 text-xs" side="top">
                  <div className="font-bold text-[#064e3b] mb-1">{evento || "FOLGA"}</div>
                  <div className="text-muted-foreground">{motivo}</div>
                </PopoverContent>
              </Popover>
            ) : (
              <div onClick={(e) => { e.stopPropagation(); onOpen(d); }}>
                {cellDiv}
              </div>
            )}
          </td>
        );
      })}
      <td className={cn("py-0.5 text-center font-[Sora,sans-serif] font-bold text-[10px]", dsaCls)}>{l.diasSemApontar}</td>
      <td className={cn("py-0.5 text-center font-[Sora,sans-serif] font-bold text-[10px]", adCls)}>{ad.toFixed(0)}%</td>
    </tr>
  );
}

function SupCard({ sup, arr, diaFoco, est, onOpenLider }: {
  sup: string; arr: Linha[]; diaFoco: number; est?: EstruturaSup; onOpenLider: (l: Linha) => void;
}) {
  const sa  = arr.filter((l) => l.dias[diaFoco] === "a").length;
  const sap = arr.filter((l) => l.dias[diaFoco] === "ap").length;
  const sn  = arr.filter((l) => l.dias[diaFoco] === "n").length;
  const snb = arr.filter((l) => l.dias[diaFoco] === "nb").length;
  // Estrutura do supervisor no dia (TICKET ALOCACAO): exigida em dia útil, conta 1 ponto
  const estDia = est?.dias?.[diaFoco];
  const estPe = (estDia === "a" || estDia === "nt" || estDia === "n") ? 1 : 0;
  const estPf = (estDia === "a" || estDia === "nt") ? 1 : 0;
  // "nb" (sem boletim, não treinado) também deve o boletim → conta 1 ponto
  const pf  = sa * 2 + sap + estPf, pe = (sa + sap + sn) * 2 + snb + estPe;
  const pct = pe > 0 ? (pf / pe) * 100 : 0;
  const tone = pe > 0 ? scoreCls(pct) : "err";
  const scoreBg = tone === "ok" ? "bg-[#2e7d32]" : tone === "warn" ? "bg-[#ef6c00]" : "bg-[#c62828]";
  // Header com a cor do status: folga = verde (sem cobrança); estrutura NÃO enviada = vermelho; senão score
  const headerBg = (estDia === "f" || estDia === "nt" || pe === 0) ? "bg-[#2e7d32]"
    : estDia === "n" ? "bg-[#c62828]"
    : scoreBg;

  return (
    <div className="bg-white border-2 border-[#e5e0d0] rounded-xl overflow-hidden shadow-sm">
      <div className={cn("px-3 py-2 flex items-center justify-between gap-2", headerBg)}>
        <span className="text-white font-bold text-[11px] uppercase tracking-wide truncate">{sup}</span>
        <div className={cn("text-white text-[10px] font-black px-2 py-0.5 rounded-md shrink-0", pe > 0 ? "bg-black/25" : "bg-[#ef6c00]")}>
          {pe > 0 ? `${pct.toFixed(0)}%` : "—"}
        </div>
      </div>
      {/* Estrutura do próprio supervisor (envio da alocação no dia) */}
      {estDia && estDia !== "x" && (
        <div className="w-full flex items-center border-b-2 border-[#e5e0d0] bg-[#fbf6e9]">
          <div className="flex-1 px-2 py-1 text-[10px] font-bold text-[#064e3b] uppercase tracking-wide truncate">Estrutura</div>
          <div className="w-24 flex justify-center py-1">
            <span className={cn("w-12 h-6 rounded flex items-center justify-center text-white text-[11px] font-black",
              (estDia === "f" || estDia === "a" || estDia === "nt") ? "bg-[#2e7d32]" : "bg-[#c62828]")}>
              {estDia === "f" ? "F" : estDia === "nt" ? "NT" : estDia === "a" ? "✓" : "✗"}
            </span>
          </div>
        </div>
      )}
      <div className="flex bg-[#1a1a2e]/5 border-b border-[#e5e0d0] text-[8px] font-bold uppercase text-[#064e3b]/60">
        <div className="flex-1 px-2 py-1">Líder</div>
        <div className="w-12 text-center py-1">Boletim</div>
        <div className="w-12 text-center py-1">Prêmio</div>
      </div>
      {arr.map((l) => {
        const s = l.dias[diaFoco];
        const aptou = s === "a" || s === "ap";
        const temPremio = s === "a";
        const isF = s === "f";
        const isSA = s === "sa";
        return (
          <button key={l.lider} type="button" onClick={() => onOpenLider(l)}
            className="w-full flex items-center text-left border-b border-[#f0ece6] last:border-0 hover:bg-[#f5f0e0]/60 transition-colors group">
            <div className="flex-1 px-2 py-1 text-[10px] font-semibold text-[#064e3b] truncate group-hover:text-[#0d7a5f]">
              {primeiroEUltimo(l.nomeLider)}
            </div>
            <div className="w-12 flex justify-center py-1">
              <span className={cn("w-6 h-6 rounded flex items-center justify-center text-white text-[10px] font-black",
                isF ? "bg-[#2e7d32]" : isSA ? "bg-[#ef6c00]" : aptou ? "bg-[#2e7d32]" : "bg-[#c62828]")}>
                {isF ? "F" : isSA ? "SA" : aptou ? "✓" : "✗"}
              </span>
            </div>
            <div className="w-12 flex justify-center py-1">
              <span className={cn("w-6 h-6 rounded flex items-center justify-center text-white text-[10px] font-black",
                (isF || isSA) ? "bg-[#e5e0d0] text-[#064e3b]/30" : temPremio ? "bg-[#2e7d32]" : aptou ? "bg-[#c62828]" : "bg-[#c62828]")}>
                {(isF || isSA) ? "—" : temPremio ? "✓" : "✗"}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function KpiCard({ label, value, accent }: { label: string; value: number; accent: "ok" | "warn" | "err" | "neutral" | "muted" }) {
  const m = {
    ok:      { bar: "bg-[#0d7a5f]", border: "border-[#0d7a5f]/20", label: "text-[#0d7a5f]", value: "text-[#0d7a5f]" },
    warn:    { bar: "bg-[#c9a84c]", border: "border-[#c9a84c]/30", label: "text-[#c9a84c]", value: "text-[#c9a84c]" },
    err:     { bar: "bg-red-500",   border: "border-red-200",      label: "text-red-600",   value: "text-red-600" },
    neutral: { bar: "",             border: "border-[#e5e0d0]",    label: "text-[#064e3b]/70", value: "text-[#064e3b]" },
    muted:   { bar: "",             border: "border-[#e5e0d0]",    label: "text-[#064e3b]/60", value: "text-[#064e3b]/50" },
  } as const;
  const a = m[accent];
  return (
    <div className={cn("bg-white pl-3 pr-3 py-1.5 rounded-xl border shadow-sm relative overflow-hidden flex items-center justify-between gap-2", a.border)}>
      {a.bar && <div className={cn("absolute top-0 left-0 w-1 h-full", a.bar)} />}
      <p className={cn("text-[9px] font-bold uppercase tracking-wider leading-tight", a.label)}>{label}</p>
      <p className={cn("text-base font-bold font-[Sora,sans-serif] leading-none", a.value)}>{value}</p>
    </div>
  );
}

function LegendDot({ cls, txt, sym }: { cls: string; txt: string; sym?: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className={cn("w-3.5 h-3.5 rounded flex items-center justify-center text-white font-black text-[7px] leading-none", cls)}>{sym}</span>
      <span className="text-[9px] font-bold text-[#064e3b]/70 uppercase tracking-wider">{txt}</span>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone: "ok" | "warn" | "err" | "info" }) {
  const cls = tone === "ok" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : tone === "err" ? "text-rose-600" : "text-blue-600";
  return (
    <div className="border rounded-md p-2 text-center bg-muted/30">
      <div className="text-[10px] uppercase font-bold text-muted-foreground">{label}</div>
      <div className={cn("text-lg font-black", cls)}>{value}</div>
    </div>
  );
}

function ChipButton({
  children, active, onClick, variant = "coord",
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  variant?: "coord" | "sup";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center shrink-0 gap-0.5 rounded-full font-semibold transition-all border",
        variant === "coord"
          ? "h-7 px-3 text-[11px]"
          : "h-6 px-2.5 text-[10px]",
        active
          ? "bg-[#064e3b] text-white border-[#064e3b] shadow-sm"
          : "bg-[#f5f0e0] text-[#064e3b] border-[#e0dbd0] hover:bg-[#e8e4d8] hover:border-[#c9c4b8]",
      )}
    >
      {children}
    </button>
  );
}
