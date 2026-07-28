// Escrita dos números de KPI. As animações de entrada são CSS puro (classes
// .anima-surgir / .anima-pop no tema.css); aqui os números só aparecem com o
// valor final.
//
// Houve uma contagem crescente (o número subia do zero até o valor, com
// ease-out) — foi removida a pedido: nas telas de TV o que interessa é ler o
// número, não vê-lo subir. De quebra some o requestAnimationFrame que
// reescrevia dezenas de textos por quadro, o mais caro que havia rodando no
// Fire Stick.

// Escreve o valor no elemento, formatado.
export function animarNumero(el, valor, formatar = (v) => v.toLocaleString("pt-BR")) {
  el.textContent = formatar(valor);
}

// Distribui uma lista de números pelos elementos de `seletor` dentro de `raiz`,
// na ordem em que aparecem no DOM, guardando cada alvo em data-valor.
//
// Por padrão só reescreve o que MUDOU de valor: as telas se atualizam a cada
// 5 min e quase nada muda entre uma consulta e outra. Passe `forcar` quando o
// HTML acabou de ser remontado e os elementos ainda estão zerados.
export function aplicarNumeros(raiz, seletor, valores, forcar = false) {
  raiz.querySelectorAll(seletor).forEach((el, i) => {
    const valor = Number(valores[i]) || 0;
    if (!forcar && Number(el.dataset.valor) === valor) return;
    el.dataset.valor = valor;
    animarNumero(el, valor);
  });
}
