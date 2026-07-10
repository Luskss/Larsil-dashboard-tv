// Animações compartilhadas via JS. As de entrada são CSS puro (classes
// .anima-surgir / .anima-pop no tema.css); aqui fica só o que precisa de
// script: a contagem crescente dos números de KPI.

const DURACAO_MS = 900;

// Sobe o número do zero até o valor com ease-out (rápido no início, freia
// no fim). Com prefers-reduced-motion, escreve o valor direto.
export function animarNumero(el, valor, formatar = (v) => v.toLocaleString("pt-BR")) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    el.textContent = formatar(valor);
    return;
  }
  const inicio = performance.now();
  function quadro(agora) {
    const t = Math.min((agora - inicio) / DURACAO_MS, 1);
    const suave = 1 - Math.pow(1 - t, 3);
    el.textContent = formatar(Math.round(valor * suave));
    if (t < 1) requestAnimationFrame(quadro);
  }
  requestAnimationFrame(quadro);
}
