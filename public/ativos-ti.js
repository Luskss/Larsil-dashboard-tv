// Página Ativos de TI: painel gráfico (KPIs, ativos por tipo e por projeto,
// rosca de status e aquisições por mês). Dados vêm de /api/ativos-ti
// (SQL Server, inventario.ATIVOS).

import { escapar } from "./escape.js";
import { agendar, obterParte, esquecer, mudou } from "./agenda.js";

const INTERVALO_ATUALIZACAO_MS = 5 * 60 * 1000; // mesmo ritmo das outras páginas

// Palette categórica das outras telas (frotas.js) para as fatias de status.
const CORES_ROSCA = ["#5f8fd6", "#2aa17e", "#cf7193", "#b8860b", "#9d7bd4", "#0c9db6"];
const NEUTRO = "#93a7b1";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

// O banco guarda caixa alta e sem acento; a tela mostra o nome legível.
const NOMES = {
  DISPONIVEL: "Disponível",
  MANUTENCAO: "Manutenção",
  EM_USO: "Em uso",
  "SEM PROJETO": "Sem projeto",
};

function nomeLegivel(bruto) {
  if (NOMES[bruto]) return NOMES[bruto];
  const s = String(bruto).replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const fmt = (n) => Number(n).toLocaleString("pt-BR");

function mostrarAviso(mensagem) {
  const aviso = document.querySelector("#ativos-aviso");
  aviso.textContent = mensagem || "";
  aviso.classList.toggle("ativos-aviso--visivel", Boolean(mensagem));
}

function vazio() {
  return `<p style="color: var(--text-dim);">Sem dados.</p>`;
}

function desenharKpis(d) {
  const rotulo = { NOTEBOOK: "Notebooks", CELULAR: "Celulares", STARLINK: "Starlink" };
  const kpi = (titulo, valor, sub, cor) =>
    `<div class="painel kpi anima-surgir" style="--cor-kpi: ${cor}; --ordem: ${i++};">
       <div class="kpi__valor">${escapar(valor)}</div>
       <div class="kpi__rotulo">${escapar(titulo)}</div>
       <div class="ativos-kpi__sub">${escapar(sub)}</div>
     </div>`;
  let i = 0;

  document.querySelector("#ativos-kpis").innerHTML = [
    ...d.disponiveis.map((t, n) =>
      kpi(rotulo[t.nome] || nomeLegivel(t.nome), fmt(t.qtd), "disponíveis", CORES_ROSCA[n])),
    kpi("Total de ativos", fmt(d.total), "equipamentos", "var(--text)"),
    kpi("Em uso", `${d.pctEmUso.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`, "do total", "var(--success)"),
  ].join("");
}

// Barras horizontais; a maior ocupa 100% do trilho.
function desenharBarras(seletor, itens) {
  const alvo = document.querySelector(seletor);
  if (!itens.length) { alvo.innerHTML = vazio(); return; }
  const maior = Math.max(...itens.map((i) => i.qtd), 1);
  alvo.innerHTML = `<div class="ativos-hbarras">${itens.map((i, n) =>
    `<div class="ativos-hbarra">
       <div class="ativos-hbarra__nome">${escapar(nomeLegivel(i.nome))} · <b>${fmt(i.qtd)}</b></div>
       <div><div class="ativos-hbarra__fio" style="width:${(i.qtd / maior) * 100}%; --ordem: ${n};"></div></div>
     </div>`
  ).join("")}</div>`;
  rolarAutomaticamente(alvo.firstElementChild);
}

// Quando as barras não cabem no painel, desce devagar, espera no fim e volta.
const rolagens = new WeakMap();
const VELOCIDADE_PX_S = 22;
const PAUSA_MS = 3000;

function rolarAutomaticamente(el) {
  // O elemento antigo é descartado a cada atualização; a rolagem acompanha.
  let inicio = null, frame = 0;
  const passo = (agora) => {
    frame = requestAnimationFrame(passo);
    if (!el.isConnected) { cancelAnimationFrame(frame); return; }
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 1) { el.scrollTop = 0; return; }
    if (inicio === null) inicio = agora;
    const descida = (max / VELOCIDADE_PX_S) * 1000;
    const ciclo = PAUSA_MS + descida + PAUSA_MS;
    const t = (agora - inicio) % ciclo;
    el.scrollTop = t < PAUSA_MS ? 0
      : t < PAUSA_MS + descida ? ((t - PAUSA_MS) / descida) * max
      : max;
  };
  frame = requestAnimationFrame(passo);
  rolagens.set(el, frame);
}

function desenharRosca(seletor, itens) {
  const alvo = document.querySelector(seletor);
  const total = itens.reduce((s, i) => s + i.qtd, 0);
  if (!total) { alvo.innerHTML = vazio(); return; }

  const C = 100, R = 80, W = 28; // centro, raio médio, espessura
  const circ = 2 * Math.PI * R;
  let acumulado = 0;
  const cores = itens.map((_, i) => CORES_ROSCA[i] || NEUTRO);

  // Cada fatia é um círculo tracejado: sem trigonometria de arcos.
  const fatias = itens.map((it, i) => {
    const comp = (it.qtd / total) * circ;
    const svg = `<circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="${cores[i]}"
      stroke-width="${W}" stroke-dasharray="${comp} ${circ - comp}"
      stroke-dashoffset="${-acumulado}" transform="rotate(-90 ${C} ${C})"
      style="--circ: ${circ}; --ordem: ${i};">
      <title>${escapar(nomeLegivel(it.nome))}: ${fmt(it.qtd)}</title></circle>`;
    acumulado += comp;
    return svg;
  });

  alvo.innerHTML = `<div class="ativos-rosca">
    <svg viewBox="0 0 200 200" role="img" aria-label="Status dos ativos">${fatias.join("")}</svg>
    <ul>${itens.map((it, i) =>
      `<li style="--ordem: ${i};"><span class="legenda__cor" style="background:${cores[i]}"></span>
         <span class="legenda__nome">${escapar(nomeLegivel(it.nome))}</span><b>${fmt(it.qtd)}</b></li>`
    ).join("")}</ul>
  </div>`;
}

function desenharColunas(seletor, meses) {
  const alvo = document.querySelector(seletor);
  const maior = Math.max(...meses.map((m) => m.qtd), 1);
  alvo.innerHTML = `<div class="ativos-colunas">${meses.map((m, n) =>
    `<div class="ativos-coluna" style="--ordem: ${n};" title="${MESES[m.mes]}/${m.ano}: ${fmt(m.qtd)}">
       <div class="ativos-coluna__area">
         <span class="ativos-coluna__valor">${m.qtd ? fmt(m.qtd) : ""}</span>
         <div class="ativos-coluna__barra" style="height:${(m.qtd / maior) * 85}%"></div>
       </div>
       <div class="ativos-coluna__mes">${MESES[m.mes]}</div>
     </div>`
  ).join("")}</div>`;
}

async function atualizar() {
  try {
    const d = await obterParte("ativos-ti");
    mostrarAviso("");
    // Dados iguais aos da última consulta: não redesenha, senão a cascata de
    // entrada recomeçaria a cada 5 min na cara de quem está olhando.
    if (!mudou("ativos-ti", d)) return;
    desenharKpis(d);
    desenharBarras("#ativos-por-tipo", d.porTipo);
    desenharBarras("#ativos-por-projeto", d.porProjeto);
    desenharRosca("#ativos-por-status", d.porStatus);
    desenharColunas("#ativos-por-mes", d.comprasPorMes);
  } catch (erro) {
    esquecer("ativos-ti"); // a mesma resposta precisa ser desenhada na recuperação
    mostrarAviso(typeof erro === "string" ? erro : "Erro ao carregar os dados de ativos de TI.");
  }
}

agendar("ativos-ti", atualizar, { intervalo: INTERVALO_ATUALIZACAO_MS, vista: "vista-ativos" });
