// Página Ativos de TI: contagem por tipo (Notebooks, Monitores, Celulares,
// Starlinks). Dados vêm de /api/ativos-ti (SQL Server, inventario.ATIVOS).

import { aplicarNumeros } from "./animacoes.js";
import { iniciarHolofote } from "./holofote.js";
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

// Ilustração de cada tipo, em public/img/info. São PNGs de arte branca sobre
// fundo transparente, que é o que faz elas caírem bem no painel escuro sem
// precisar de tratamento nenhum.
//
// A largura vai junto só para o navegador saber a proporção ANTES de baixar a
// imagem e já reservar o espaço certo: sem isso o ícone chega depois e empurra
// o número para baixo, um solavanco no meio da tela. Todas têm 400px de
// altura. Se um dia alguém trocar um PNG por outro de proporção diferente, o
// número aqui só causa um ajuste no primeiro quadro — quem manda de verdade é
// o object-fit no CSS.
const ICONES = {
  NOTEBOOK: { arquivo: "laptop", largura: 640 },
  MONITOR: { arquivo: "monitor", largura: 453 },
  CELULAR: { arquivo: "celular", largura: 199 },
  STARLINK: { arquivo: "starlink", largura: 993 },
};

// alt vazio: o rótulo logo abaixo já diz o que é, então a imagem é decorativa.
// Tipo sem ícone mapeado simplesmente não ganha imagem, em vez de virar um
// quadrado de imagem quebrada.
function iconeDe(nome) {
  const icone = ICONES[nome];
  if (!icone) return "";
  return `<img class="kpi__icone" src="/img/info/${icone.arquivo}.png" alt=""
               width="${icone.largura}" height="400" decoding="async">`;
}

function mostrarAviso(mensagem) {
  const aviso = document.querySelector("#ativos-aviso");
  aviso.textContent = mensagem || "";
  aviso.classList.toggle("ativos-aviso--visivel", Boolean(mensagem));
}

let assinaturaAtual = null;

function desenharCards(tipos) {
  // #ativos-cards: id próprio no SPA (#tipos-cards é da vista Frotas).
  const alvo = document.querySelector("#ativos-cards");

  // Os cards em si só mudam quando um TIPO de ativo entra ou sai do
  // inventário — o que praticamente nunca acontece. Refazer o innerHTML a
  // cada 5 min só servia para reiniciar a cascata de entrada e obrigar uma
  // repintura da vista para trocar quatro números.
  const assinatura = tipos.map((t) => t.nome).join("|");
  const remontar = assinatura !== assinaturaAtual;

  if (remontar) {
    assinaturaAtual = assinatura;
    alvo.innerHTML = tipos.map((t, i) =>
      `<div class="painel kpi anima-surgir" style="--cor-kpi: ${CORES_TIPOS[i % CORES_TIPOS.length]}; --ordem: ${i};">
         <div class="kpi__valor">0</div>
         <div class="kpi__rotulo">${escapar(ROTULOS[t.nome] || t.nome)}</div>
         ${iconeDe(t.nome)}
       </div>`
    ).join("");
  }

  aplicarNumeros(alvo, ".kpi__valor", tipos.map((t) => t.qtd), remontar);

  // Rodízio de destaque entre os quatro painéis. Só com cards novos, senão o
  // destaque saltaria de volta ao primeiro a cada atualização de 5 min.
  if (remontar) {
    iniciarHolofote(alvo, { item: ".kpi", classeLista: "ativos-grid--foco" });
  }
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
