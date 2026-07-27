// Observa uma vista do SPA (paginacao.js liga/desliga .vista--ativa) e avisa
// quando ela entra ou sai de cena. Numa TV as 8 vistas convivem no mesmo
// documento (as ocultas ficam display:none), então cada página deve pausar
// seus timers e animações enquanto está fora do ar — senão o trabalho de fundo
// de uma trava a que o usuário está vendo.
//
// `aoEntrar` roda já na montagem se a vista nasce ativa (abrir direto no #hash
// dela). Devolve uma função para parar de observar, se algum dia precisar.
export function observarVista(vista, { aoEntrar, aoSair } = {}) {
  if (typeof vista === "string") vista = document.getElementById(vista);
  if (!vista) return () => {};

  let visivel = null; // null = ainda não avaliado (garante o 1º disparo)
  const avaliar = () => {
    const agora = vista.classList.contains("vista--ativa");
    if (agora === visivel) return;
    visivel = agora;
    (agora ? aoEntrar : aoSair)?.();
  };

  const obs = new MutationObserver(avaliar);
  obs.observe(vista, { attributes: true, attributeFilter: ["class"] });
  avaliar();
  return () => obs.disconnect();
}
