// Vista "Status Externo": as ferramentas de fora que a TI depende (Claude,
// ChatGPT, Railway, Azure) estão no ar? Dados de /api/status-externo, que lê a
// página de status oficial de cada fornecedor (ver server.js).
//
// É a resposta rápida para "caiu para mim ou para todo mundo?" — por isso cada
// card mostra o estado em cor e, quando há incidente, a frase que o próprio
// fornecedor publicou.

import { escapar } from "./escape.js";
import { agendar, obterParte, esquecer, mudou } from "./agenda.js";

const INTERVALO_ATUALIZACAO_MS = 5 * 60 * 1000; // mesmo ritmo das outras páginas

// Mesma escala de cor da vista Serviços: verde ok, amarelo parcial, vermelho
// fora. "indefinido" é cinza — não sabemos, e fingir "online" seria pior.
const ROTULO_ESTADO = {
  online: "Operacional",
  degradado: "Instável",
  erro: "Fora do ar",
  indefinido: "Sem dados",
};

const FORMATO_HORA = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit", minute: "2-digit",
});

function mostrarAviso(mensagem) {
  const aviso = document.querySelector("#status-externo-aviso");
  aviso.textContent = mensagem || "";
  aviso.classList.toggle("status-externo-aviso--visivel", Boolean(mensagem));
}

// Iniciais para quando o serviço não tem logo configurada na Gestão ("Claude
// Code" -> "CC"): mantém o card com o mesmo peso visual dos outros, em vez de
// abrir um buraco onde deveria estar a marca.
function iniciais(nome) {
  const palavras = String(nome || "").trim().split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return "?";
  return palavras.slice(0, 2).map((p) => p[0].toUpperCase()).join("");
}

// O que aconteceu, em uma frase — só faz sentido quando há algo errado.
function detalheDe(s) {
  if (s.afetados?.length) return s.afetados.join(" · ");
  // Sem incidente nomeado mas fora do normal (ex.: manutenção programada, ou o
  // Instatus que não lista componentes): a frase do fornecedor é o que há.
  return s.descricao || "";
}

function cardServico(s, i) {
  const estado = ROTULO_ESTADO[s.estado] ? s.estado : "indefinido";

  // Card limpo quando está tudo bem: logo, nome e status bastam para a leitura
  // de longe. O texto só entra quando há o que explicar — assim um card com
  // escrita embaixo já é, por si só, o sinal de que algo saiu do lugar.
  const detalhe = estado === "online" ? "" : detalheDe(s);
  const contador = estado !== "online" && s.fora > 0 && s.total > 0
    ? `${s.fora} de ${s.total} componentes afetados`
    : "";
  const rodape = [detalhe, contador].filter(Boolean)
    .map((t) => `<div class="status-card__detalhe">${escapar(t)}</div>`)
    .join("");

  // A logo vem da Gestão como data URI. O servidor já recusa SVG (que carrega
  // script) e qualquer coisa fora de png/jpeg/gif/webp; aqui ela só entra num
  // <img>, nunca como HTML.
  const marca = s.logo
    ? `<img class="status-card__logo" src="${escapar(s.logo)}" alt="">`
    : `<span class="status-card__iniciais">${escapar(iniciais(s.nome))}</span>`;

  return `
    <div class="status-card status-card--${estado} anima-surgir" style="--ordem: ${i};">
      <div class="status-card__marca">${marca}</div>
      <div class="status-card__nome">${escapar(s.nome)}</div>
      <div class="status-card__estado">${ROTULO_ESTADO[estado]}</div>
      ${rodape}
    </div>
  `;
}

function desenhar(dados) {
  // Como na vista Serviços: sem número subindo, ou o quadro mudou ou não há o
  // que redesenhar. Sem isto a cascata .anima-surgir recomeçaria a cada 5 min
  // na cara de quem está olhando, para mostrar exatamente o mesmo status.
  // `consultadoEm` muda sempre e não conta como mudança de quadro.
  if (!mudou("status-externo", dados, ["consultadoEm"])) return;

  document.querySelector("#status-externo-cards").innerHTML =
    dados.servicos.map(cardServico).join("");

  const rodape = document.querySelector("#status-externo-rodape");
  rodape.textContent = dados.consultadoEm
    ? `Consultado às ${FORMATO_HORA.format(new Date(dados.consultadoEm))}`
    : "";
}

async function atualizar() {
  try {
    const dados = await obterParte("status-externo");
    mostrarAviso("");
    desenhar(dados);
  } catch (erro) {
    // Depois de um erro a tela mostra o aviso; a MESMA resposta de antes
    // precisa voltar a ser desenhada quando a consulta se recuperar.
    esquecer("status-externo");
    mostrarAviso(typeof erro === "string" ? erro : "Erro ao carregar o status dos serviços externos.");
  }
}

agendar("status-externo", atualizar, {
  intervalo: INTERVALO_ATUALIZACAO_MS,
  vista: "vista-status-externo",
});
