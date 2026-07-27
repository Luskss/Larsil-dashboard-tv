// Animações compartilhadas via JS. As de entrada são CSS puro (classes
// .anima-surgir / .anima-pop no tema.css); aqui fica só o que precisa de
// script: a contagem crescente dos números de KPI.

const DURACAO_MS = 900;

// A contagem roda a ~30fps, não a 60. Cada número reescrito é um relayout de
// texto (o mais caro que existe numa CPU fraca) e uma tela dessas atualiza
// dezenas deles ao mesmo tempo — a 60fps o Fire Stick perdia quadros das
// outras animações que rodam junto. Num número subindo, 30fps é indistinguível
// de 60; o que se vê é o valor mudando, não a taxa de quadros.
const INTERVALO_QUADRO_MS = 32;
let ultimoQuadro = 0;

// Preferência de movimento reduzido: consultada uma vez e mantida atualizada
// por evento, em vez de chamar matchMedia a cada número animado.
const consultaMovimento = matchMedia("(prefers-reduced-motion: reduce)");

// Todas as contagens ativas compartilham um único requestAnimationFrame.
// Cada entrada é keyed pelo elemento, então chamar animarNumero de novo no
// mesmo elemento (ex.: refresh de dados) substitui a animação anterior em vez
// de deixar dois loops brigando pelo textContent.
const ativas = new Map();
let rafId = 0;

// Vista oculta não mostra número subindo — mas a contagem rodava assim mesmo.
// Cada uma das páginas do SPA se atualiza no seu próprio intervalo, e cada
// atualização punha ~900ms de requestAnimationFrame no ar para reescrever
// texto dentro de um display:none. Com 7 páginas isso acontecia o tempo todo,
// às vezes bem em cima de uma troca de página — justo o momento em que o Fire
// Stick menos tem quadro sobrando. Fora do ar, escreve o valor direto: quando
// a vista aparecer o número já está certo, que é o que se via antes também.
//
// Elemento fora de qualquer .vista (gestao.html, login) anima normalmente.
function noAr(el) {
  const vista = el.closest(".vista");
  return !vista || vista.classList.contains("vista--ativa");
}

function tick(agora) {
  if (agora - ultimoQuadro < INTERVALO_QUADRO_MS) {
    rafId = requestAnimationFrame(tick);
    return;
  }
  ultimoQuadro = agora;

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
// no fim). Com prefers-reduced-motion — ou com a vista fora do ar — escreve
// o valor direto.
export function animarNumero(el, valor, formatar = (v) => v.toLocaleString("pt-BR")) {
  if (consultaMovimento.matches || !noAr(el)) {
    ativas.delete(el);
    el.textContent = formatar(valor);
    return;
  }
  ativas.set(el, { valor, formatar, inicio: performance.now(), ultimoTexto: null });
  if (!rafId) rafId = requestAnimationFrame(tick);
}

// Distribui uma lista de números pelos elementos de `seletor` dentro de `raiz`,
// na ordem em que aparecem no DOM, guardando cada alvo em data-valor (é de lá
// que o holofote relê para re-animar o card em foco).
//
// Por padrão só re-anima o que MUDOU de valor. As telas se atualizam a cada
// 5 min e quase nada muda entre uma consulta e outra; sem isto, todos os
// números da página voltavam a zero e subiam de novo a cada atualização —
// caro e, pior, parecia defeito. Passe `forcar` quando o HTML acabou de ser
// remontado e os elementos ainda estão zerados.
export function aplicarNumeros(raiz, seletor, valores, forcar = false) {
  raiz.querySelectorAll(seletor).forEach((el, i) => {
    const valor = Number(valores[i]) || 0;
    if (!forcar && Number(el.dataset.valor) === valor) return;
    el.dataset.valor = valor;
    animarNumero(el, valor);
  });
}
