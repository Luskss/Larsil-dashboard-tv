// Animações compartilhadas via JS. As de entrada são CSS puro (classes
// .anima-surgir / .anima-pop no tema.css); aqui fica só o que precisa de
// script: a contagem crescente dos números de KPI.

const DURACAO_MS = 900;

// Preferência de movimento reduzido: consultada uma vez e mantida atualizada
// por evento, em vez de chamar matchMedia a cada número animado.
const consultaMovimento = matchMedia("(prefers-reduced-motion: reduce)");

// Todas as contagens ativas compartilham um único requestAnimationFrame.
// Cada entrada é keyed pelo elemento, então chamar animarNumero de novo no
// mesmo elemento (ex.: refresh de dados) substitui a animação anterior em vez
// de deixar dois loops brigando pelo textContent.
const ativas = new Map();
let rafId = 0;

function tick(agora) {
  ativas.forEach((anim, el) => {
    const t = Math.min((agora - anim.inicio) / DURACAO_MS, 1);
    const suave = 1 - Math.pow(1 - t, 3);
    const texto = anim.formatar(Math.round(anim.valor * suave));
    // Só toca no DOM quando o texto renderizado realmente muda.
    if (texto !== anim.ultimoTexto) {
      el.textContent = texto;
      anim.ultimoTexto = texto;
    }
    if (t >= 1) ativas.delete(el);
  });
  rafId = ativas.size ? requestAnimationFrame(tick) : 0;
}

// Sobe o número do zero até o valor com ease-out (rápido no início, freia
// no fim). Com prefers-reduced-motion, escreve o valor direto.
export function animarNumero(el, valor, formatar = (v) => v.toLocaleString("pt-BR")) {
  if (consultaMovimento.matches) {
    ativas.delete(el);
    el.textContent = formatar(valor);
    return;
  }
  ativas.set(el, { valor, formatar, inicio: performance.now(), ultimoTexto: null });
  if (!rafId) rafId = requestAnimationFrame(tick);
}
