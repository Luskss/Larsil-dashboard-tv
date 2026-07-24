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
// Para o "pop" funcionar, cada número precisa guardar seu alvo em data-valor
// (a página faz isso ao renderizar) — assim re-animamos sem refazer a busca.

import { animarNumero } from "./animacoes.js";

const HOLOFOTE_INTERVALO_MS = 4500; // tempo de cada coordenador em destaque

// Um timer por container (a Frota e os Colaboradores são listas diferentes),
// para um não cancelar o holofote do outro.
const timers = new Map();

function reanimarCard(card) {
  card.querySelectorAll("[data-valor]").forEach((el) =>
    animarNumero(el, Number(el.dataset.valor) || 0)
  );
}

// Liga o holofote na lista `alvo`. Chame de novo a cada render: cancela o
// ciclo anterior antes de começar, então não sobram timers de cards já
// destruídos pelo innerHTML.
export function iniciarHolofote(alvo) {
  clearTimeout(timers.get(alvo));

  const cards = [...alvo.querySelectorAll(".lider-card")];
  // Sem graça (e sem sentido) com um card só; e respeita movimento reduzido —
  // nesses casos os cards ficam todos iguais, como antes.
  if (cards.length < 2 || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    alvo.classList.remove("lideres-lista--foco");
    return;
  }

  alvo.classList.add("lideres-lista--foco");
  let i = 0;
  const passo = () => {
    cards.forEach((card, j) => {
      const foco = j === i;
      card.classList.toggle("lider-card--foco", foco);
      card.classList.toggle("lider-card--recuado", !foco);
      if (foco) reanimarCard(card);
    });
    i = (i + 1) % cards.length;
    timers.set(alvo, setTimeout(passo, HOLOFOTE_INTERVALO_MS));
  };
  passo();
}
