// Bolinhas de navegação entre as páginas, fixas no rodapé.
//
// Componente compartilhado: cada página chama montarPaginacao() e o módulo
// injeta o CSS e a barra. A bolinha da página atual vira uma "pílula" verde
// com pulso; as outras são pontos clicáveis que levam à página.
//
// Quais páginas aparecem é configurável em gestao.html (guarda a escolha no
// localStorage). Para adicionar uma página nova ao dashboard, inclua-a aqui
// em PAGINAS — ela nasce visível por padrão.

const CHAVE_VISIVEIS = "paginas-visiveis";

// Rotação automática entre as páginas (estilo painel de TV, como no projeto
// lovable): uma barra fina no rodapé enche durante o tempo abaixo e, ao
// completar, navega para a próxima bolinha. Para mudar o ritmo, salve
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
  { rotulo: "Dashboard", arquivo: "index.html" },
  { rotulo: "Frotas", arquivo: "frotas-estatisticas.html" },
  { rotulo: "Ativos de TI", arquivo: "ativos-ti.html" },
  { rotulo: "Helpdesk", arquivo: "helpdesk-chamados.html" },
];

// Páginas que existem mas não entram na lista de escolha (sempre ocultas
// da navegação, só acessíveis por URL direta).
const OCULTAS_SEMPRE = ["gestao.html"];

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

  /* Entrada suave do conteúdo ao trocar de página; o padding no rodapé
     garante que a barra fixa não cubra o fim de páginas roláveis. */
  body {
    animation: pagina-entrar .35s ease both;
    padding-bottom: 4.5rem;
  }
  @keyframes pagina-entrar {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: none; }
  }

  /* Barra da rotação automática: enche da esquerda para a direita e, ao
     completar, a página troca (iniciarRotacao cuida do tempo). */
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

  const atual = location.pathname.split("/").pop() || "index.html";
  if (OCULTAS_SEMPRE.includes(atual)) return;

  const visiveis = new Set(paginasVisiveis());
  // A página atual sempre aparece, mesmo se desmarcada, para a barra não
  // sumir debaixo de quem já está nela.
  const paginas = PAGINAS.filter((p) => visiveis.has(p.arquivo) || p.arquivo === atual);

  const nav = document.createElement("nav");
  nav.className = "paginacao";
  nav.setAttribute("aria-label", "Páginas do dashboard");
  nav.innerHTML = paginas.map((pagina) => {
    const ativa = pagina.arquivo === atual;
    return `<a href="./${pagina.arquivo}"
      class="paginacao__bolinha${ativa ? " paginacao__bolinha--ativa" : ""}"
      title="${pagina.rotulo}" aria-label="${pagina.rotulo}"
      ${ativa ? 'aria-current="page"' : ""}></a>`;
  }).join("");

  document.body.appendChild(nav);
  iniciarRotacao(paginas, atual);
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

function iniciarRotacao(paginas, atual) {
  const segundos = segundosRotacao();
  if (!segundos || paginas.length < 2) return;

  const barra = document.createElement("div");
  barra.className = "rotacao-progresso";
  document.body.appendChild(barra);

  const indice = paginas.findIndex((p) => p.arquivo === atual);
  const proxima = paginas[(indice + 1) % paginas.length];

  // Uma única transição CSS do tamanho do ciclo — sem timer por segundo.
  // (dois rAF: o primeiro garante que o width 0 foi pintado antes de animar)
  barra.style.transition = `width ${segundos}s linear`;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => { barra.style.width = "100%"; })
  );

  setTimeout(() => { location.href = `./${proxima.arquivo}`; }, segundos * 1000);
}
