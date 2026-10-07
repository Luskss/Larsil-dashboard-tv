// Recarrega a página uma vez por dia, de madrugada.
//
// A TV fica com a página aberta por dias seguidos, e navegador de aparelho
// fraco (Silk no Fire Stick) vai acumulando memória: timers, nós de DOM,
// camadas de GPU. Recarregar às 4h devolve tudo ao zero sem ninguém mexer. O
// hash da URL guarda a vista em exibição (paginacao.js usa replaceState), então
// a TV volta onde estava.
//
// Não há flag em storage de propósito: a condição "página aberta há mais de 6h"
// já impede reload em laço (depois de recarregar, o tempo de vida volta a zero).

const HORA_DO_RELOAD = 4;
const VIDA_MINIMA_MS = 6 * 60 * 60 * 1000;
const CHECAGEM_MS = 60 * 1000;

setInterval(async () => {
  if (new Date().getHours() !== HORA_DO_RELOAD) return;
  if (performance.now() < VIDA_MINIMA_MS) return;
  if (navigator.onLine === false) return;

  // Só recarrega se o servidor responde: recarregar sem rede trocaria o
  // dashboard (que ao menos mostra o último dado) por uma página de erro.
  try {
    const resp = await fetch("/login.html", { method: "HEAD", cache: "no-store" });
    if (resp.ok) location.reload();
  } catch {
    /* sem servidor agora; tenta de novo no próximo minuto */
  }
}, CHECAGEM_MS);
