// Bolinhas de navegação entre as vistas, fixas no rodapé.
//
// O site é um SPA: todas as vistas vivem em <section> dentro do index.html
// (ver lá) e trocar de "página" é só alternar a classe .vista--ativa — sem
// navegação de verdade, para a barra do navegador da TV (Amazon Silk) não
// aparecer a cada troca. Este módulo injeta o CSS, monta as bolinhas e cuida
// da rotação automática. gestao.html fica fora do SPA (acesso só por URL).
//
// Quais vistas aparecem é configurável em gestao.html (guarda a escolha no
// localStorage, pela chave `arquivo` — nome herdado do tempo em que cada
// vista era um HTML separado). Para adicionar uma vista nova, crie a
// <section> no index.html e inclua-a aqui em PAGINAS.

const CHAVE_VISIVEIS = "paginas-visiveis";
const CHAVE_ORDEM = "paginas-ordem";

// Rotação automática entre as vistas (estilo painel de TV, como no projeto
// lovable): uma barra fina no rodapé enche durante o tempo abaixo e, ao
// completar, ativa a próxima bolinha. Para mudar o ritmo, salve
// "rotacao-segundos" no localStorage (0 desliga).
const CHAVE_ROTACAO = "rotacao-segundos";
const ROTACAO_SEGUNDOS_PADRAO = 30;

function segundosRotacao() {
  const salvo = localStorage.getItem(CHAVE_ROTACAO);
  if (salvo === null) return ROTACAO_SEGUNDOS_PADRAO;
  const segundos = Number(salvo);
  return Number.isFinite(segundos) && segundos >= 0 ? segundos : ROTACAO_SEGUNDOS_PADRAO;
}

export const PAGINAS = [
  { rotulo: "Dashboard",    arquivo: "index.html",               vista: "vista-dashboard", hash: "#dashboard" },
  { rotulo: "Frotas",       arquivo: "frotas-estatisticas.html", vista: "vista-frotas",    hash: "#frotas" },
  { rotulo: "Mapa da Frota",arquivo: "frota-mapa.html",          vista: "vista-mapa",      hash: "#mapa" },
  { rotulo: "Ativos de TI", arquivo: "ativos-ti.html",           vista: "vista-ativos",    hash: "#ativos" },
  { rotulo: "Helpdesk",     arquivo: "helpdesk-chamados.html",   vista: "vista-helpdesk",  hash: "#helpdesk" },
  { rotulo: "Serviços",     arquivo: "railway-status.html",      vista: "vista-railway",   hash: "#servicos" },
];

export function paginasVisiveis() {
  const salvo = localStorage.getItem(CHAVE_VISIVEIS);
  if (!salvo) return PAGINAS.map((p) => p.arquivo);
  try {
    const lista = JSON.parse(salvo);
    if (Array.isArray(lista)) return lista;
  } catch {}
  return PAGINAS.map((p) => p.arquivo);
}

export function salvarPaginasVisiveis(arquivos) {
  localStorage.setItem(CHAVE_VISIVEIS, JSON.stringify(arquivos));
}

// Ordem customizada das páginas (definida arrastando na gestão). Páginas
// novas que ainda não estão na ordem salva entram no fim, na ordem de PAGINAS.
export function paginasOrdenadas() {
  const salvo = localStorage.getItem(CHAVE_ORDEM);
  let ordem = [];
  if (salvo) {
    try {
      const lista = JSON.parse(salvo);
      if (Array.isArray(lista)) ordem = lista;
    } catch {}
  }
  const porArquivo = new Map(PAGINAS.map((p) => [p.arquivo, p]));
  const ordenadas = ordem.map((arquivo) => porArquivo.get(arquivo)).filter(Boolean);
  for (const pagina of PAGINAS) {
    if (!ordenadas.includes(pagina)) ordenadas.push(pagina);
  }
  return ordenadas;
}

export function salvarPaginasOrdem(arquivos) {
  localStorage.setItem(CHAVE_ORDEM, JSON.stringify(arquivos));
}

const CSS = `
  .paginacao {
    position: fixed;
    left: 50%;
    bottom: 1rem;
    display: flex;
    align-items: center;
    gap: .65rem;
    padding: .6rem .85rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--bg) 72%, transparent);
    border: 1px solid var(--border);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    z-index: 50;
    animation: paginacao-entrar .55s cubic-bezier(.22, 1.4, .36, 1) both;
  }
  @keyframes paginacao-entrar {
    from { transform: translate(-50%, 200%); opacity: 0; }
    to   { transform: translate(-50%, 0);    opacity: 1; }
  }
  /* O transform de repouso fica fora da animação para o hover não brigar. */
  .paginacao { transform: translate(-50%, 0); }

  .paginacao__bolinha {
    display: block;
    width: 10px;
    height: 10px;
    padding: 0;
    border: 0;
    cursor: pointer;
    border-radius: 999px;
    background: var(--text-dim);
    opacity: .5;
    transition:
      width .45s cubic-bezier(.68, -.55, .27, 1.55),
      transform .25s ease,
      opacity .25s ease,
      background-color .25s ease;
  }
  .paginacao__bolinha:hover {
    transform: scale(1.4);
    opacity: 1;
  }

  /* Página atual: a bolinha estica numa pílula verde e "respira". */
  .paginacao__bolinha--ativa {
    width: 30px;
    background: var(--success);
    opacity: 1;
    animation: paginacao-pulso 2.4s ease-out infinite;
  }
  .paginacao__bolinha--ativa:hover { transform: none; }
  @keyframes paginacao-pulso {
    0%   { box-shadow: 0 0 0 0 color-mix(in srgb, var(--success) 50%, transparent); }
    70%  { box-shadow: 0 0 0 9px transparent; }
    100% { box-shadow: 0 0 0 0 transparent; }
  }

  /* O padding no rodapé garante que a barra fixa não cubra o conteúdo.
     A animação de entrada de cada vista (pagina-entrar) é aplicada em
     .vista--ativa, no CSS do index.html — reexecuta a cada troca. */
  body { padding-bottom: 4.5rem; }
  @keyframes pagina-entrar {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: none; }
  }

  /* Barra da rotação automática: enche da esquerda para a direita e, ao
     completar, a vista troca (agendarTroca cuida do tempo). */
  .rotacao-progresso {
    position: fixed;
    left: 0;
    bottom: 0;
    height: 4px;
    width: 0;
    background: var(--success);
    z-index: 60;
  }

  @media (prefers-reduced-motion: reduce) {
    .paginacao,
    .paginacao__bolinha,
    .paginacao__bolinha--ativa,
    .vista--ativa,
    body { animation: none; transition: none; }
  }

  /* Botão de sair: canto oposto à barra de navegação. Quase invisível em
     repouso (painel de TV não deve chamar atenção para isso) — só ganha
     fundo e contraste no hover/foco, quando alguém já foi até lá de propósito. */
  .sair-btn {
    position: fixed;
    left: 1rem;
    bottom: 1rem;
    padding: .5rem .9rem;
    border-radius: 999px;
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-dim);
    opacity: .18;
    font-size: .75rem;
    font-weight: 600;
    cursor: pointer;
    z-index: 50;
    transition: opacity .2s ease, background-color .2s ease, border-color .2s ease;
  }
  .sair-btn:hover,
  .sair-btn:focus-visible {
    opacity: 1;
    color: var(--text);
    background: color-mix(in srgb, var(--bg) 72%, transparent);
    border-color: var(--border);
  }
`;

export function montarPaginacao() {
  const estilo = document.createElement("style");
  estilo.textContent = CSS;
  document.head.appendChild(estilo);

  // Só monta a barra no documento que tem as vistas (index.html); em páginas
  // fora do SPA que importem este módulo não há o que navegar.
  const existentes = paginasOrdenadas().filter((p) => document.getElementById(p.vista));
  if (existentes.length === 0) return;

  const visiveis = new Set(paginasVisiveis());
  const porHash = existentes.find((p) => p.hash === location.hash);
  // A vista aberta pela URL sempre aparece, mesmo se desmarcada na gestão,
  // para a barra não sumir debaixo de quem já está nela.
  const paginas = existentes.filter((p) => visiveis.has(p.arquivo) || p === porHash);
  if (paginas.length === 0) paginas.push(existentes[0]);

  const nav = document.createElement("nav");
  nav.className = "paginacao";
  nav.setAttribute("aria-label", "Páginas do dashboard");
  nav.innerHTML = paginas.map((pagina) =>
    `<button type="button" class="paginacao__bolinha"
      title="${pagina.rotulo}" aria-label="${pagina.rotulo}"></button>`
  ).join("");
  document.body.appendChild(nav);

  const bolinhas = [...nav.querySelectorAll(".paginacao__bolinha")];
  bolinhas.forEach((bolinha, i) => bolinha.addEventListener("click", () => ativar(paginas[i])));

  const barra = document.createElement("div");
  barra.className = "rotacao-progresso";
  document.body.appendChild(barra);

  let atual = null;
  let timer = null;

  function ativar(pagina) {
    atual = pagina;
    for (const p of existentes) {
      document.getElementById(p.vista).classList.toggle("vista--ativa", p === pagina);
    }
    bolinhas.forEach((bolinha, i) => {
      const ativa = paginas[i] === pagina;
      bolinha.classList.toggle("paginacao__bolinha--ativa", ativa);
      if (ativa) bolinha.setAttribute("aria-current", "page");
      else bolinha.removeAttribute("aria-current");
    });
    // replaceState não navega (a barra do Silk não aparece), mas mantém a
    // URL compartilhável e o reload voltando na mesma vista.
    history.replaceState(null, "", pagina.hash);
    // A vista recém-exibida precisa remedir (o grid do dashboard usa a janela).
    window.dispatchEvent(new Event("resize"));
    agendarTroca();
  }

  // Rotação automática: reinicia a barra e agenda a próxima vista.
  function agendarTroca() {
    clearTimeout(timer);
    const segundos = segundosRotacao();

    barra.style.transition = "none";
    barra.style.width = "0";
    if (!segundos || paginas.length < 2) return;

    void barra.offsetWidth; // pinta o width 0 antes de animar de novo
    barra.style.transition = `width ${segundos}s linear`;
    barra.style.width = "100%";

    timer = setTimeout(() => {
      const i = paginas.indexOf(atual);
      ativar(paginas[(i + 1) % paginas.length]);
    }, segundos * 1000);
  }

  ativar(porHash && paginas.includes(porHash) ? porHash : paginas[0]);
  montarBotaoSair();
}

function montarBotaoSair() {
  const botao = document.createElement("button");
  botao.type = "button";
  botao.className = "sair-btn";
  botao.textContent = "Sair";
  botao.addEventListener("click", async () => {
    await fetch("/logout", { method: "POST" }).catch(() => {});
    location.href = "/login.html";
  });
  document.body.appendChild(botao);
}

