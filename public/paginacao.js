// Bolinhas de navegação entre as vistas, fixas no rodapé.
//
// O site é um SPA: todas as vistas vivem em <section> dentro do index.html
// (ver lá) e trocar de "página" é só alternar a classe .vista--ativa — sem
// navegação de verdade, para a barra do navegador da TV (Amazon Silk) não
// aparecer a cada troca. Este módulo injeta o CSS, monta as bolinhas e cuida
// da rotação automática. gestao.html fica fora do SPA (acesso só por URL).
//
// Quais vistas aparecem, e em que ordem, é configurável em gestao.html. A
// escolha vive no SERVIDOR (data.json, via /api/paginas), não no localStorage:
// a TV precisa seguir o que foi configurado de qualquer máquina, e o
// localStorage é por navegador. Cada vista é identificada pela chave
// `arquivo` — nome herdado do tempo em que cada vista era um HTML separado.
// Para adicionar uma vista nova, crie a <section> no index.html e inclua-a
// aqui em PAGINAS.

// De quanto em quanto tempo a tela releva a configuração. A TV fica ligada o
// dia inteiro; sem isto, uma mudança feita no PC só apareceria no próximo
// reload dela — que pode não acontecer nunca.
const INTERVALO_SINCRONIA_MS = 30 * 1000;

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
  { rotulo: "Frota por Líder", arquivo: "frota-lideres.html",    vista: "vista-lideres",   hash: "#lideres" },
  { rotulo: "Mapa da Frota",arquivo: "frota-mapa.html",          vista: "vista-mapa",      hash: "#mapa" },
  { rotulo: "Ativos de TI", arquivo: "ativos-ti.html",           vista: "vista-ativos",    hash: "#ativos" },
  { rotulo: "Colaboradores",arquivo: "colaboradores.html",       vista: "vista-colaboradores", hash: "#colaboradores" },
  { rotulo: "Helpdesk",     arquivo: "helpdesk-chamados.html",   vista: "vista-helpdesk",  hash: "#helpdesk" },
  { rotulo: "Serviços",     arquivo: "railway-status.html",      vista: "vista-railway",   hash: "#servicos" },
];

// Configuração vinda do servidor. `visiveis: null` significa "ninguém
// configurou ainda" — e é diferente de []: null mostra todas as páginas, []
// mostra nenhuma (ver o comentário em store.js).
const CONFIG_PADRAO = { ordem: [], visiveis: null };

export async function carregarConfigPaginas() {
  try {
    const resp = await fetch("/api/paginas");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const dados = await resp.json();
    return {
      ordem: Array.isArray(dados.ordem) ? dados.ordem : [],
      visiveis: Array.isArray(dados.visiveis) ? dados.visiveis : null,
    };
  } catch (erro) {
    // Uma TV sem rede ainda tem que mostrar as páginas: cai no padrão em vez
    // de ficar sem barra de navegação.
    console.error("Páginas:", erro);
    return CONFIG_PADRAO;
  }
}

export async function salvarConfigPaginas({ ordem, visiveis }) {
  const resp = await fetch("/api/paginas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ordem, visiveis }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

// Aplica a ordem salva sobre PAGINAS. Páginas novas, que ainda não estão na
// ordem salva, entram no fim — assim uma vista recém-criada aparece sozinha
// em vez de sumir por não constar da configuração.
export function ordenarPaginas(ordem) {
  const porArquivo = new Map(PAGINAS.map((p) => [p.arquivo, p]));
  const ordenadas = (ordem || []).map((arquivo) => porArquivo.get(arquivo)).filter(Boolean);
  for (const pagina of PAGINAS) {
    if (!ordenadas.includes(pagina)) ordenadas.push(pagina);
  }
  return ordenadas;
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

  /* O padding no rodapé garante que a barra fixa não cubra o conteúdo. */
  body { padding-bottom: 4.5rem; }

  /* ===== Transição entre páginas (cross-fade com deslize) =====
     A vista que ENTRA anima com pagina-entrar (aplicada em .vista--ativa, no
     CSS do index.html); a que SAI recebe .vista--saindo do JS, fica sobreposta
     (position fixed) e anima o inverso. As duas rodam juntas. Como cada vista
     é transparente sobre o fundo do site, não há flash branco. */
  @keyframes pagina-entrar {
    from { opacity: 0; transform: translateX(3%); }
    to   { opacity: 1; transform: none; }
  }
  @keyframes pagina-sair {
    from { opacity: 1; transform: none; }
    to   { opacity: 0; transform: translateX(-3%); }
  }
  .vista--saindo {
    display: flex;
    flex-direction: column;
    height: 100%;
    position: fixed;
    inset: 0;
    z-index: 0;             /* fica atrás da vista que entra */
    pointer-events: none;
    animation: pagina-sair .35s cubic-bezier(.4, 0, .2, 1) both;
  }
  .vista--ativa { position: relative; z-index: 1; }

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
    .vista--saindo,
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

export async function montarPaginacao() {
  const estilo = document.createElement("style");
  estilo.textContent = CSS;
  document.head.appendChild(estilo);

  // Só monta a barra no documento que tem as vistas (index.html); em páginas
  // fora do SPA que importem este módulo não há o que navegar.
  const existentes = PAGINAS.filter((p) => document.getElementById(p.vista));
  if (existentes.length === 0) return;

  const barra = document.createElement("div");
  barra.className = "rotacao-progresso";
  document.body.appendChild(barra);

  let nav = null;
  let bolinhas = [];
  let paginas = [];
  let atual = null;
  let timer = null;
  let aplicada = null; // assinatura da configuração já em uso

  function ativar(pagina) {
    const anterior = atual;
    atual = pagina;

    const reduzMovimento = matchMedia("(prefers-reduced-motion: reduce)").matches;
    // A vista anterior não some de imediato: ganha .vista--saindo (fica
    // sobreposta, animando a saída) enquanto a nova entra por cima — as duas
    // animam juntas. Como cada vista é transparente sobre o fundo do site, o
    // cross-fade nunca mostra branco. (Não usamos View Transitions porque o
    // zoom da página faz o navegador renderizar a "foto" da transição com
    // áreas brancas.)
    const anteriorEl = anterior && anterior !== pagina && !reduzMovimento
      ? document.getElementById(anterior.vista)
      : null;

    for (const p of existentes) {
      const el = document.getElementById(p.vista);
      if (p === pagina) {
        el.classList.remove("vista--saindo");
        el.classList.add("vista--ativa");
      } else if (el === anteriorEl) {
        el.classList.remove("vista--ativa");
        el.classList.add("vista--saindo");
        const limpar = () => {
          el.classList.remove("vista--saindo");
          el.removeEventListener("animationend", limpar);
          clearTimeout(reserva);
        };
        el.addEventListener("animationend", limpar);
        // Rede de segurança: se animationend não disparar, esconde mesmo assim.
        const reserva = setTimeout(limpar, 600);
      } else {
        el.classList.remove("vista--ativa", "vista--saindo");
      }
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

  // (Re)monta a barra para a configuração recebida. Roda na abertura e de novo
  // toda vez que a configuração muda no servidor.
  function aplicar(config, inicial = false) {
    aplicada = JSON.stringify(config);

    const ordenadas = ordenarPaginas(config.ordem).filter((p) => existentes.includes(p));
    const porHash = ordenadas.find((p) => p.hash === location.hash);
    // Só na abertura a vista apontada pela URL aparece mesmo se desmarcada,
    // para a barra não sumir debaixo de quem abriu aquele link. Nas sincronias
    // seguintes essa exceção não vale: a TV em rotação reescreve o hash para a
    // página do momento, então desmarcar a página que está no ar a manteria na
    // barra para sempre — a sincronia só remonta quando a configuração muda.
    const excecao = inicial ? porHash : null;
    paginas = config.visiveis
      ? ordenadas.filter((p) => config.visiveis.includes(p.arquivo) || p === excecao)
      : ordenadas;
    if (paginas.length === 0) paginas = [ordenadas[0]];

    if (nav) nav.remove();
    nav = document.createElement("nav");
    nav.className = "paginacao";
    nav.setAttribute("aria-label", "Páginas do dashboard");
    nav.innerHTML = paginas.map((pagina) =>
      `<button type="button" class="paginacao__bolinha"
        title="${pagina.rotulo}" aria-label="${pagina.rotulo}"></button>`
    ).join("");
    document.body.appendChild(nav);

    bolinhas = [...nav.querySelectorAll(".paginacao__bolinha")];
    bolinhas.forEach((bolinha, i) => bolinha.addEventListener("click", () => ativar(paginas[i])));

    // Continua onde estava, se a página atual sobreviveu à mudança — trocar a
    // ordem no PC não deve fazer a TV pular para outra vista do nada. Se a
    // página em exibição foi desmarcada, cai na primeira da lista nova.
    const manter = paginas.includes(atual)
      ? atual
      : (porHash && paginas.includes(porHash) ? porHash : paginas[0]);
    ativar(manter);
  }

  aplicar(await carregarConfigPaginas(), true);
  montarBotaoSair();

  setInterval(async () => {
    const config = await carregarConfigPaginas();
    // Só remonta se mudou de verdade: rebuild a cada 30s reiniciaria a barra
    // de rotação e a TV nunca trocaria de página sozinha.
    if (JSON.stringify(config) !== aplicada) aplicar(config);
  }, INTERVALO_SINCRONIA_MS);
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

