// Página Helpdesk: chamados recentes de dbo.HELPDESK_CHAMADOS separados em
// três colunas por status. Dados vêm de /api/helpdesk-chamados, que já traz
// o nome de quem atende (ATRIBUIDO_A) e de quem resolveu (RESOLVIDO_POR).

import { animarNumero } from "./animacoes.js";

const INTERVALO_ATUALIZACAO_MS = 5 * 60 * 1000; // mesmo ritmo das outras páginas

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

// Título e nomes vêm do banco — escapa antes de virar HTML.
function escapar(texto) {
  return String(texto)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

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

function desenharCard(chamado, coluna, ordem) {
  const prioridade = String(chamado.prioridade || "").toUpperCase();
  const corPrioridade = COR_PRIORIDADE[prioridade] || "var(--text-dim)";
  return `<div class="chamado anima-surgir" style="--ordem: ${ordem};">
    <div class="chamado__topo">
      <span>#${chamado.id} · ${formatarHorario(coluna.horario(chamado))}</span>
      ${prioridade ? `<span class="chamado__prioridade" style="--cor-prioridade: ${corPrioridade};">${escapar(prioridade)}</span>` : ""}
    </div>
    <div class="chamado__titulo">${escapar(chamado.titulo || "(sem título)")}</div>
    <div class="chamado__pessoa">${coluna.pessoa(chamado)}</div>
  </div>`;
}

function desenharColunas(dados) {
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
          ? chamados.map((c, j) => desenharCard(c, coluna, j)).join("")
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

async function atualizar() {
  try {
    const resp = await fetch("/api/helpdesk-chamados");
    const dados = await resp.json();
    if (!resp.ok) throw dados.erro || "Erro ao carregar os chamados do helpdesk.";

    mostrarAviso("");
    desenharColunas(dados);
  } catch (erro) {
    mostrarAviso(typeof erro === "string" ? erro : "Erro ao carregar os chamados do helpdesk.");
  }
}

atualizar();
setInterval(atualizar, INTERVALO_ATUALIZACAO_MS);
