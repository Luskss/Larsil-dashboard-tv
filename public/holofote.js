// Holofote dos cards de coordenador (usado na Frota por Líder e em
// Colaboradores, que compartilham .lider-card).
//
// Numa TV ninguém clica: em vez de mostrar os cards todos do mesmo tamanho,
// damos destaque a um coordenador de cada vez — ele cresce e seus números
// sobem de novo (o "pop"), enquanto os outros recuam. Ao fim do ciclo volta
// ao primeiro. O CSS (.lideres-lista--foco / .lider-card--foco / --recuado,
// em index.html) cuida do tamanho e da opacidade; aqui só alternamos as
// classes e re-disparamos a contagem do card em foco.
//
// O ciclo SÓ roda com a vista no ar: enquanto ela está oculta (display:none)
// ninguém veria a troca, e o requestAnimationFrame da contagem competiria à
// toa com a aba que o usuário está olhando (ver observarVista).
//
// Para o "pop" funcionar, cada número precisa guardar seu alvo em data-valor
// (a página faz isso ao renderizar) — assim re-animamos sem refazer a busca.

import { animarNumero } from "./animacoes.js";
import { observarVista } from "./visibilidade.js";

const HOLOFOTE_INTERVALO_MS = 4500; // tempo de cada coordenador em destaque

// Espera o card terminar de crescer para só então rolar os números. Casa com a
// transição de transform do .lider-card (0.7s no index.html), com uma folga.
//
// Não é só estética (embora a leitura em dois tempos — o card avança, depois
// os números sobem — fique melhor): enquanto o card está escalando ele é uma
// camada do compositor, e reescrever texto lá dentro obriga a repintar e
// reenviar essa textura à GPU a cada quadro. Fazendo as duas coisas ao mesmo
// tempo, a parte cara da animação acontecia justamente durante o movimento.
const ATRASO_CONTAGEM_MS = 750;

// Estado por lista (a Frota e os Colaboradores são listas diferentes): cards
// atuais, timer do ciclo, índice em foco e se a vista está visível.
const estados = new Map();

function reanimarCard(card) {
  card.querySelectorAll("[data-valor]").forEach((el) =>
    animarNumero(el, Number(el.dataset.valor) || 0)
  );
}

function aplicarFoco(estado) {
  estado.cards.forEach((card, j) => {
    const foco = j === estado.i;
    card.classList.toggle("lider-card--foco", foco);
    card.classList.toggle("lider-card--recuado", !foco);
  });

  // A contagem é agendada à parte e cancelada se o foco mudar antes da hora —
  // senão uma troca rápida (ou a vista saindo de cena) deixaria números
  // rolando num card que já não está em destaque.
  clearTimeout(estado.timerContagem);
  const emFoco = estado.cards[estado.i];
  if (emFoco) {
    estado.timerContagem = setTimeout(() => reanimarCard(emFoco), ATRASO_CONTAGEM_MS);
  }
}

function iniciarCiclo(estado) {
  clearTimeout(estado.timer);
  if (!estado.visivel || estado.cards.length < 2) return;
  const passo = () => {
    aplicarFoco(estado);
    estado.i = (estado.i + 1) % estado.cards.length;
    estado.timer = setTimeout(passo, HOLOFOTE_INTERVALO_MS);
  };
  passo();
}

function pararCiclo(estado) {
  clearTimeout(estado.timer);
  clearTimeout(estado.timerContagem);
  estado.timer = null;
}

// Liga o holofote na lista `alvo`. Chame de novo a cada render: reaproveita o
// estado (e o observador da vista) e só troca os cards, sem empilhar timers.
export function iniciarHolofote(alvo) {
  const cards = [...alvo.querySelectorAll(".lider-card")];

  let estado = estados.get(alvo);
  if (!estado) {
    estado = { cards, timer: null, timerContagem: null, i: 0, visivel: false };
    estados.set(alvo, estado);
    // Observa a vista dona desta lista uma única vez: pausa o ciclo quando ela
    // sai de cena e o retoma (do início) quando volta.
    const vista = alvo.closest(".vista");
    if (vista) {
      observarVista(vista, {
        aoEntrar() { estado.visivel = true; estado.i = 0; iniciarCiclo(estado); },
        aoSair() { estado.visivel = false; pararCiclo(estado); },
      });
    } else {
      estado.visivel = true; // fora do SPA: trata como sempre visível
    }
  }
  estado.cards = cards;
  estado.i = 0;

  // Sem graça (e sem sentido) com um card só; e respeita movimento reduzido —
  // nesses casos os cards ficam todos iguais, como antes.
  if (cards.length < 2 || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    pararCiclo(estado);
    alvo.classList.remove("lideres-lista--foco");
    return;
  }

  alvo.classList.add("lideres-lista--foco");
  iniciarCiclo(estado); // no-op se a vista estiver oculta; retoma ao aparecer
}
