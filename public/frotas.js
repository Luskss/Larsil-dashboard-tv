// Página Frotas: donut de veículos por setor + contadores por status.
// Dados vêm de /api/frota (SQL Server, dbo.FROTA) via consultarFrota().

import { consultarFrota } from "./downdetector.js";
import { montarPaginacao } from "./paginacao.js";
import { animarNumero } from "./animacoes.js";

const INTERVALO_ATUALIZACAO_MS = 5 * 60 * 1000; // mesmo ritmo do dashboard
const INTERVALO_TROCA_MS = 30 * 1000; // alterna o donut entre status e tipo
const DURACAO_FADE_MS = 250; // casa com a transition do .donut-area no CSS

// Cores por status, derivadas dos acentos do tema (tema.css):
// trabalhando = verde (--success), oficina = amarelo (--alert),
// estragado = vermelho (--critical).
// Os demais status (sem atividade, sucata...) são neutros — a identidade
// deles vem da legenda e dos rótulos, nunca da cor sozinha.
const CORES_STATUS = { trabalhando: "#5db747", oficina: "#f3bb37", estragado: "#c05555" };
const NEUTROS = ["#93a7b1", "#75878f", "#5a6b73", "#8ba1ac", "#67757c"];

// Palette categórica dos tipos — 6 slots em ordem fixa, validados
// (validate_palette.js: banda L, croma, CVD adjacente, contraste >= 3:1
// contra --surface). Não reaproveita as cores de status, que têm semântica
// própria; se surgirem mais tipos que slots, entram neutros.
const CORES_TIPOS = ["#5f8fd6", "#2aa17e", "#9d7bd4", "#cf7193", "#b8860b", "#0c9db6"];

// Mesma atribuição de cor nos dois lugares que mostram tipos (donut e cards):
// slot fixo pelo índice; além da palette, neutros.
function corDoTipo(i, proximoNeutro) {
  return i < CORES_TIPOS.length
    ? CORES_TIPOS[i]
    : NEUTROS[proximoNeutro() % NEUTROS.length];
}

function corDoStatus(nome, proximoNeutro) {
  const s = nome.toLowerCase();
  if (s.includes("trabalh")) return CORES_STATUS.trabalhando;
  if (s.includes("oficina")) return CORES_STATUS.oficina;
  if (s.includes("estrag")) return CORES_STATUS.estragado;
  return NEUTROS[proximoNeutro() % NEUTROS.length];
}

// As duas visões que o painel do donut alterna a cada 30 segundos.
const VISOES = {
  status: {
    itens: (dados) => dados.donut,
    cor: (nome, i, proximoNeutro) => corDoStatus(nome, proximoNeutro),
  },
  tipos: {
    itens: (dados) => dados.tipos || [],
    cor: (_nome, i, proximoNeutro) => corDoTipo(i, proximoNeutro),
  },
};
let visaoAtual = "status";

// "TRABALHANDO" -> "Trabalhando" (os status vêm em caixa alta do banco).
const titulo = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

let dadosAtuais = null;

const formatarPct = (v) =>
  v.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%";

// ===== Donut (SVG) =====

function pontoPolar(cx, cy, r, angulo) {
  return [cx + r * Math.cos(angulo), cy + r * Math.sin(angulo)];
}

// Setor anular entre os ângulos a0 e a1 (sentido horário, rad).
function caminhoFatia(cx, cy, rInterno, rExterno, a0, a1) {
  const grande = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = pontoPolar(cx, cy, rExterno, a0);
  const [x1, y1] = pontoPolar(cx, cy, rExterno, a1);
  const [x2, y2] = pontoPolar(cx, cy, rInterno, a1);
  const [x3, y3] = pontoPolar(cx, cy, rInterno, a0);
  return `M${x0} ${y0} A${rExterno} ${rExterno} 0 ${grande} 1 ${x1} ${y1} ` +
         `L${x2} ${y2} A${rInterno} ${rInterno} 0 ${grande} 0 ${x3} ${y3} Z`;
}

// Redesenha o painel do donut na visão atual (status ou tipos).
function desenharVisao() {
  if (!dadosAtuais) return;
  const visao = VISOES[visaoAtual];
  document.querySelector("#painel-donut-titulo").textContent = visao.titulo;
  document.querySelector("#painel-donut-subtitulo").textContent = visao.subtitulo;
  desenharDonut(visao.itens(dadosAtuais), dadosAtuais.total, visao);
}

function desenharDonut(itens, total, visao) {
  const alvo = document.querySelector("#donut");
  const legenda = document.querySelector("#donut-legenda");
  if (!total) {
    alvo.innerHTML = `<p style="color: var(--text-dim);">Nenhum veículo encontrado.</p>`;
    legenda.innerHTML = "";
    return;
  }

  let neutrosUsados = 0;
  const proximoNeutro = () => neutrosUsados++;
  const CX = 190, CY = 175, R_EXT = 112, R_INT = 50, R_ROTULO = 146;

  let angulo = -Math.PI / 2; // começa no topo, sentido horário
  const fatias = [];
  const rotulos = [];
  const itensLegenda = [];

  itens.forEach((item, i) => {
    const fracao = item.qtd / total;
    // Fatia única (100%) não pode fechar o círculo exato, senão o arco some.
    const fim = angulo + Math.min(fracao * 2 * Math.PI, 2 * Math.PI - 0.0001);
    const cor = visao.cor(item.nome, i, proximoNeutro);
    const nome = titulo(item.nome);
    const pct = formatarPct(fracao * 100);

    fatias.push(
      `<path class="donut-fatia" d="${caminhoFatia(CX, CY, R_INT, R_EXT, angulo, fim)}"
        fill="${cor}" stroke="var(--surface)" stroke-width="2"
        data-tooltip="${nome} — ${item.qtd.toLocaleString("pt-BR")} veículos (${pct})"></path>`
    );

    // Rótulo direto só nas fatias grandes; as pequenas ficam na legenda.
    if (fracao >= 0.05) {
      const meio = (angulo + fim) / 2;
      const [lx, ly] = pontoPolar(CX, CY, R_ROTULO, meio);
      const cos = Math.cos(meio);
      const ancora = cos > 0.15 ? "start" : cos < -0.15 ? "end" : "middle";
      rotulos.push({ x: lx, y: ly, ancora, nome, pct });
    }

    itensLegenda.push({ cor, nome, qtd: item.qtd, pct });
    angulo = fim;
  });

  // Rótulos de fatias vizinhas colidem: afasta na vertical, por lado.
  for (const lado of [rotulos.filter(r => r.x >= CX), rotulos.filter(r => r.x < CX)]) {
    lado.sort((a, b) => a.y - b.y);
    for (let i = 1; i < lado.length; i++) {
      if (lado[i].y - lado[i - 1].y < 30) lado[i].y = lado[i - 1].y + 30;
    }
  }

  const textos = rotulos.map((r) =>
    `<text class="donut-rotulo" x="${r.x}" y="${r.y}" text-anchor="${r.ancora}">
       <tspan x="${r.x}">${r.nome}</tspan>
       <tspan class="pct" x="${r.x}" dy="15">${r.pct}</tspan>
     </text>`
  );

  const descricao = itensLegenda.map((s) => `${s.nome} ${s.pct}`).join(", ");
  alvo.setAttribute("aria-label", `${visao.titulo}: ${descricao}`);
  alvo.innerHTML =
    `<svg class="anima-pop" viewBox="0 0 380 350" aria-hidden="true">${fatias.join("")}${textos.join("")}</svg>`;

  legenda.innerHTML = itensLegenda.map((s) =>
    `<li>
       <span class="legenda__cor" style="background: ${s.cor};"></span>
       <span class="legenda__nome">${s.nome}</span>
       <span class="legenda__qtd">${s.qtd.toLocaleString("pt-BR")} · ${s.pct}</span>
     </li>`
  ).join("");

  conectarTooltip(alvo);
}

function conectarTooltip(alvo) {
  const tooltip = document.querySelector("#donut-tooltip");
  alvo.querySelectorAll(".donut-fatia").forEach((fatia) => {
    fatia.addEventListener("mousemove", (ev) => {
      tooltip.textContent = fatia.dataset.tooltip;
      tooltip.style.left = `${ev.clientX + 14}px`;
      tooltip.style.top = `${ev.clientY + 14}px`;
      tooltip.style.opacity = "1";
    });
    fatia.addEventListener("mouseleave", () => { tooltip.style.opacity = "0"; });
  });
}

// ===== Cards por tipo de frota =====
// Fileira abaixo da grade: um card por tipo, com o número na mesma cor da
// fatia do donut de tipos (mesmo índice, mesma palette) — o rótulo continua
// carregando a identidade, a cor só faz a ponte visual com o gráfico.
function desenharCardsTipos(tipos) {
  const alvo = document.querySelector("#tipos-cards");
  let neutrosUsados = 0;
  const proximoNeutro = () => neutrosUsados++;
  alvo.innerHTML = (tipos || []).map((t, i) =>
    `<div class="painel kpi anima-surgir" style="--cor-kpi: ${corDoTipo(i, proximoNeutro)}; --ordem: ${i};">
       <div class="kpi__valor">0</div>
       <div class="kpi__rotulo">${titulo(t.nome)}</div>
     </div>`
  ).join("");
  alvo.querySelectorAll(".kpi__valor").forEach((el, i) => animarNumero(el, tipos[i].qtd));
}

// ===== Carga e atualização =====

function mostrarAviso(mensagem) {
  const aviso = document.querySelector("#frota-aviso");
  aviso.textContent = mensagem || "";
  aviso.classList.toggle("frota-aviso--visivel", Boolean(mensagem));
}

async function atualizar() {
  try {
    const dados = await consultarFrota();
    dadosAtuais = dados;
    mostrarAviso("");

    for (const [chave, valor] of Object.entries(dados.status)) {
      const alvo = document.querySelector(`[data-kpi="${chave}"]`);
      if (alvo) animarNumero(alvo, valor);
    }

    desenharVisao();
    desenharCardsTipos(dados.tipos);

    const hora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  } catch (erro) {
    document.querySelector("#frota-atualizado").textContent = "Falha ao carregar";
    mostrarAviso(typeof erro === "string" ? erro : "Erro ao carregar os dados da frota.");
  }
}

montarPaginacao();

// ===== Alternância status <-> tipos a cada 30s, com fade =====
// Pausa enquanto o mouse está no painel, para não trocar durante uma leitura.
let trocaPausada = false;
const painelDonut = document.querySelector(".frota-grid__donut");
painelDonut.addEventListener("mouseenter", () => { trocaPausada = true; });
painelDonut.addEventListener("mouseleave", () => { trocaPausada = false; });

function alternarVisao() {
  if (trocaPausada || !dadosAtuais || !(dadosAtuais.tipos || []).length) return;
  const area = document.querySelector(".donut-area");
  area.classList.add("donut-area--trocando");
  setTimeout(() => {
    visaoAtual = visaoAtual === "status" ? "tipos" : "status";
    desenharVisao();
    area.classList.remove("donut-area--trocando");
  }, DURACAO_FADE_MS);
}

atualizar();
setInterval(atualizar, INTERVALO_ATUALIZACAO_MS);
setInterval(alternarVisao, INTERVALO_TROCA_MS);
