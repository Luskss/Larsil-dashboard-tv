// Página Ativos de TI: contagem por tipo (Notebooks, Monitores, Celulares,
// Starlinks). Dados vêm de /api/ativos-ti (SQL Server, inventario.ATIVOS).

import { animarNumero } from "./animacoes.js";
import { escapar } from "./escape.js";

const INTERVALO_ATUALIZACAO_MS = 5 * 60 * 1000; // mesmo ritmo das outras páginas

// Mesma palette categórica validada de frotas.js (CVD/contraste) —
// um slot fixo por tipo, na ordem em que os cards aparecem na tela.
const CORES_TIPOS = ["#5f8fd6", "#2aa17e", "#9d7bd4", "#cf7193"];

const ROTULOS = {
  NOTEBOOK: "Notebooks",
  MONITOR: "Monitores",
  CELULAR: "Celulares",
  STARLINK: "Starlinks",
};

function mostrarAviso(mensagem) {
  const aviso = document.querySelector("#ativos-aviso");
  aviso.textContent = mensagem || "";
  aviso.classList.toggle("ativos-aviso--visivel", Boolean(mensagem));
}

function desenharCards(tipos) {
  // #ativos-cards: id próprio no SPA (#tipos-cards é da vista Frotas).
  const alvo = document.querySelector("#ativos-cards");
  alvo.innerHTML = tipos.map((t, i) =>
    `<div class="painel kpi anima-surgir" style="--cor-kpi: ${CORES_TIPOS[i % CORES_TIPOS.length]}; --ordem: ${i};">
       <div class="kpi__valor">0</div>
       <div class="kpi__rotulo">${escapar(ROTULOS[t.nome] || t.nome)}</div>
     </div>`
  ).join("");
  alvo.querySelectorAll(".kpi__valor").forEach((el, i) => animarNumero(el, tipos[i].qtd));
}

let dadosAtuais = null;

async function atualizar() {
  try {
    const resp = await fetch("/api/ativos-ti");
    const dados = await resp.json();
    if (!resp.ok) throw dados.erro || "Erro ao carregar os dados de ativos de TI.";

    dadosAtuais = dados;
    mostrarAviso("");
    desenharCards(dados.tipos);
  } catch (erro) {
    mostrarAviso(typeof erro === "string" ? erro : "Erro ao carregar os dados de ativos de TI.");
  }
}

atualizar();
setInterval(atualizar, INTERVALO_ATUALIZACAO_MS);
