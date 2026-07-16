// Página Helpdesk: chamados recentes de dbo.HELPDESK_CHAMADOS separados em
// três colunas por status. Dados vêm de /api/helpdesk-chamados, que já traz
// o nome de quem atende (ATRIBUIDO_A) e de quem resolveu (RESOLVIDO_POR).

import { animarNumero } from "./animacoes.js";
import { escapar } from "./escape.js";

const INTERVALO_ATUALIZACAO_MS = 30 * 1000; // painel de TV: atualiza quase em tempo real

// As três colunas do quadro, com a cor de destaque do tema.css e como cada
// uma mostra a pessoa e o horário do chamado.
const COLUNAS = [
  {
    chave: "ABERTO",
    rotulo: "Abertos",
    cor: "var(--critical)",
    pessoa: () => "Aguardando atendimento",
    horario: (c) => c.criadoEm,
  },
  {
    chave: "EM_ATENDIMENTO",
    rotulo: "Em atendimento",
    cor: "var(--alert)",
    pessoa: (c) => (c.atribuidoA ? `Atendendo: <strong>${escapar(nomeCurto(c.atribuidoA))}</strong>` : "Sem técnico atribuído"),
    horario: (c) => c.criadoEm,
  },
  {
    chave: "RESOLVIDO",
    rotulo: "Resolvidos",
    cor: "var(--success)",
    pessoa: (c) => (c.resolvidoPor ? `Resolvido por: <strong>${escapar(nomeCurto(c.resolvidoPor))}</strong>` : "Resolvido"),
    horario: (c) => c.resolvidoEm || c.criadoEm,
  },
];

const COR_PRIORIDADE = {
  CRITICA: "var(--critical)",
  ALTA: "var(--critical)",
  MEDIA: "var(--alert)",
  BAIXA: "var(--text-dim)",
};

// Título e nomes vêm do banco — escapa antes de virar HTML (ver escape.js).

// "Lucas Gabriel Barreto Pereira" -> "Lucas Gabriel" (cabe no card).
function nomeCurto(nome) {
  return String(nome).trim().split(/\s+/).slice(0, 2).join(" ");
}

function formatarHorario(iso) {
  if (!iso) return "";
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "";
  return data.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function mostrarAviso(mensagem) {
  const aviso = document.querySelector("#chamados-aviso");
  aviso.textContent = mensagem || "";
  aviso.classList.toggle("chamados-aviso--visivel", Boolean(mensagem));
}

function desenharCard(chamado, coluna, ordem, ehNovo) {
  const prioridade = String(chamado.prioridade || "").toUpperCase();
  const corPrioridade = COR_PRIORIDADE[prioridade] || "var(--text-dim)";
  return `<div class="chamado anima-surgir${ehNovo ? " chamado--novo" : ""}" style="--ordem: ${ordem};">
    <div class="chamado__topo">
      <span>#${chamado.id} · ${formatarHorario(coluna.horario(chamado))}${ehNovo ? '<span class="chamado__novo-selo">NOVO</span>' : ""}</span>
      ${prioridade ? `<span class="chamado__prioridade" style="--cor-prioridade: ${corPrioridade};">${escapar(prioridade)}</span>` : ""}
    </div>
    <div class="chamado__titulo">${escapar(chamado.titulo || "(sem título)")}</div>
    <div class="chamado__pessoa">${coluna.pessoa(chamado)}</div>
  </div>`;
}

function desenharColunas(dados, idsNovos) {
  const alvo = document.querySelector("#colunas");
  alvo.innerHTML = COLUNAS.map((coluna, i) => {
    const chamados = dados.colunas?.[coluna.chave] || [];
    return `<div class="painel anima-surgir" style="--ordem: ${i};">
      <div class="coluna__titulo" style="--cor-status: ${coluna.cor};">
        <span class="coluna__bolinha"></span>
        <span>${coluna.rotulo}</span>
        <span class="coluna__qtd">0</span>
      </div>
      <div class="coluna__cards">
        ${chamados.length
          ? chamados.map((c, j) => desenharCard(c, coluna, j, idsNovos.has(c.id))).join("")
          : `<div class="coluna__vazia">Nenhum chamado</div>`}
      </div>
    </div>`;
  }).join("");

  // Contadores sobem contando até o total real de cada status.
  const qtds = alvo.querySelectorAll(".coluna__qtd");
  COLUNAS.forEach((coluna, i) => {
    const chamados = dados.colunas?.[coluna.chave] || [];
    animarNumero(qtds[i], dados.contagem?.[coluna.chave] ?? chamados.length);
  });
}

// IDs de chamados já vistos na coluna "Abertos". Na primeira carga a página
// só registra o que já existe (sem notificar); depois, todo ID que aparecer e
// não estava aqui conta como chamado novo.
let idsVistos = null;

// Aponta os IDs "Abertos" da resposta que ainda não tínhamos visto.
function detectarNovos(dados) {
  const abertos = (dados.colunas?.ABERTO || []).map((c) => c.id);
  const novos = new Set();
  if (idsVistos === null) {
    // Primeira carga: memoriza sem alardear.
    idsVistos = new Set(abertos);
    return novos;
  }
  for (const id of abertos) {
    if (!idsVistos.has(id)) novos.add(id);
  }
  idsVistos = new Set(abertos);
  return novos;
}

let toastTimer = null;
function mostrarToast(qtd) {
  const toast = document.querySelector("#toast-novos");
  const texto = document.querySelector("#toast-novos-texto");
  texto.textContent = qtd === 1 ? "1 novo chamado aberto" : `${qtd} novos chamados abertos`;
  toast.classList.add("toast-novos--visivel");
  tocarSino();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("toast-novos--visivel"), 6000);
}

// Bipe curto via Web Audio — sem depender de arquivo de áudio. Alguns
// navegadores só liberam som após uma interação; nesse caso falha em silêncio.
let audioCtx = null;
function tocarSino() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const ganho = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.frequency.setValueAtTime(1175, audioCtx.currentTime + 0.12);
    ganho.gain.setValueAtTime(0.001, audioCtx.currentTime);
    ganho.gain.exponentialRampToValueAtTime(0.15, audioCtx.currentTime + 0.02);
    ganho.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
    osc.connect(ganho).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.4);
  } catch {
    /* som indisponível — segue sem bipe */
  }
}

async function atualizar() {
  try {
    const resp = await fetch("/api/helpdesk-chamados");
    const dados = await resp.json();
    if (!resp.ok) throw dados.erro || "Erro ao carregar os chamados do helpdesk.";

    const idsNovos = detectarNovos(dados);
    mostrarAviso("");
    desenharColunas(dados, idsNovos);
    if (idsNovos.size > 0) mostrarToast(idsNovos.size);
  } catch (erro) {
    mostrarAviso(typeof erro === "string" ? erro : "Erro ao carregar os chamados do helpdesk.");
  }
}

atualizar();
setInterval(atualizar, INTERVALO_ATUALIZACAO_MS);
