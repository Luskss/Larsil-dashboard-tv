// Página Frota por Líder: um card por coordenador, com os contadores de
// status (mesma regra da página Frotas) e uma grade de mini-KPIs mostrando a
// quantidade de veículos de cada tipo sob ele.
// Dados vêm de /api/frota-lideres via consultarFrotaLideres() — bens sem
// coordenador vêm agrupados no card LARSIL, no meio da fileira.

import { consultarFrotaLideres } from "./downdetector.js";
import { animarNumero } from "./animacoes.js";
import { escapar } from "./escape.js";

const INTERVALO_ATUALIZACAO_MS = 5 * 60 * 1000; // mesmo ritmo das outras vistas

// Mesma palette categórica dos tipos usada em frotas.js — cor fixa por
// nome de tipo (não por posição), para o mesmo tipo aparecer sempre igual
// em todos os cards, independente da ordem dentro de cada líder.
const CORES_TIPOS = ["#5f8fd6", "#2aa17e", "#9d7bd4", "#cf7193", "#b8860b", "#0c9db6"];
const NEUTROS = ["#93a7b1", "#75878f", "#5a6b73", "#8ba1ac", "#67757c"];
const corPorTipo = new Map();
let proximoNeutro = 0;

function corDoTipo(nome) {
  if (!corPorTipo.has(nome)) {
    const i = corPorTipo.size;
    corPorTipo.set(
      nome,
      i < CORES_TIPOS.length ? CORES_TIPOS[i] : NEUTROS[proximoNeutro++ % NEUTROS.length]
    );
  }
  return corPorTipo.get(nome);
}

// Contadores de status, na mesma ordem, com os mesmos rótulos e cores dos
// KPIs da página Frotas (index.html: .kpi--trabalhando etc.).
const STATUS = [
  { chave: "trabalhando", rotulo: "Trabalhando" },
  { chave: "oficina", rotulo: "Na oficina" },
  { chave: "estragado", rotulo: "Estragado" },
  { chave: "semAtividade", rotulo: "Sem atividade" },
];

function mostrarAviso(mensagem) {
  const aviso = document.querySelector("#lideres-aviso");
  aviso.textContent = mensagem || "";
  aviso.classList.toggle("lideres-aviso--visivel", Boolean(mensagem));
}

const titulo = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

function desenharLideres(lideres, total) {
  const alvo = document.querySelector("#lideres-lista");
  document.querySelector("#lideres-total").textContent =
    total ? `${total.toLocaleString("pt-BR")} veículos` : "";

  if (!lideres.length) {
    alvo.innerHTML = `<p style="color: var(--text-dim);">Nenhum veículo encontrado.</p>`;
    return;
  }

  alvo.innerHTML = lideres.map((l, i) => `
    <div class="lider-card anima-surgir" style="--ordem: ${i};">
      <div class="lider-card__nome" title="${escapar(l.nome)}">${escapar(l.nome)}</div>
      <div class="lider-card__status">
        ${STATUS.map((s) => `
          <div class="lider-status lider-status--${s.chave}">
            <div class="lider-status__valor" data-status>0</div>
            <div class="lider-status__nome">${s.rotulo}</div>
          </div>
        `).join("")}
      </div>
      <div class="lider-card__tipos">
        ${(l.tipos || []).map((t) => `
          <div class="lider-tipo" style="--cor-tipo: ${corDoTipo(t.nome)};">
            <div class="lider-tipo__valor" data-qtd>0</div>
            <div class="lider-tipo__nome">${escapar(titulo(t.nome))}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `).join("");

  const todosTipos = lideres.flatMap((l) => l.tipos || []);
  alvo.querySelectorAll("[data-qtd]").forEach((el, i) => animarNumero(el, todosTipos[i].qtd));

  // Mesma ordem do HTML acima: 4 contadores por líder, um bloco após o outro.
  const todosStatus = lideres.flatMap((l) => STATUS.map((s) => (l.status || {})[s.chave] || 0));
  alvo.querySelectorAll("[data-status]").forEach((el, i) => animarNumero(el, todosStatus[i]));
}

async function atualizar() {
  try {
    const dados = await consultarFrotaLideres();
    mostrarAviso("");
    desenharLideres(dados.lideres, dados.total);
  } catch (erro) {
    mostrarAviso(typeof erro === "string" ? erro : "Erro ao carregar a frota por líder.");
  }
}

atualizar();
setInterval(atualizar, INTERVALO_ATUALIZACAO_MS);
