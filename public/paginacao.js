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
  { rotulo: "Reservas de Veículos", arquivo: "reservas-veiculos.html", vista: "vista-reservas", hash: "#reservas" },
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
  /* Os offsets somam --margem-tv (definida no index.html): é a faixa que o
     televisor corta das bordas. Sem ela, o que mora no limite da tela — a
     barra de rotação em bottom: 0, à frente de todos — simplesmente não
     aparece na TV. */
  .paginacao {
    position: fixed;
    left: 50%;
    bottom: calc(1rem + var(--margem-tv, 0px));
    display: flex;
    align-items: center;
    gap: .65rem;
    padding: .6rem .85rem;
    border-radius: 999px;
    /* Sem backdrop-filter de propósito. A barra é fixa, fica sempre na tela e
       tem a barra de rotação animando logo abaixo dela — cada quadro obrigava
       o compositor a reamostrar e reborrar a região inteira, e a cada 30s o
       cross-fade de página anima a tela toda por trás. Num Fire Stick isso
       sozinho derrubava o frame rate. Fundo mais opaco dá a mesma leitura de
       "camada sobreposta" a custo zero. */
    background: color-mix(in srgb, var(--bg) 92%, transparent);
    border: 1px solid var(--border);
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
    position: relative; /* âncora do halo ::after da bolinha ativa */
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
  }
  .paginacao__bolinha--ativa:hover { transform: none; }

  /* O pulso é um halo em ::after que cresce e some, e não mais um box-shadow
     animado: box-shadow não é compositável, então cada quadro do pulso era uma
     repintura — de novo, para sempre, enquanto a TV estivesse ligada.
     transform + opacity ficam só no compositor. */
  /* Sem z-index negativo: .paginacao é position:fixed com z-index, ou seja, um
     contexto de empilhamento — um ::after em z-index -1 sumiria atrás do fundo
     dela. O halo é da mesma cor da pílula, então pintar por cima dá no mesmo. */
  .paginacao__bolinha--ativa::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: var(--success);
    will-change: transform, opacity;
    /* Contado, não infinito. O ::after só existe enquanto a bolinha está
       ativa, então o pulso recomeça sozinho a cada troca de página: 4 voltas
       (~10s) no começo de cada rodada de 30s, em vez de compor um quadro a
       cada 16ms para sempre, enquanto a TV estiver ligada. */
    animation: paginacao-pulso 2.4s ease-out 4 both;
  }
  @keyframes paginacao-pulso {
    0%   { opacity: .5; transform: scale(1); }
    70%  { opacity: 0;  transform: scale(1.9); }
    100% { opacity: 0;  transform: scale(1.9); }
  }

  /* O padding no rodapé garante que a barra fixa não cubra o conteúdo; os
     outros três lados são a margem de segurança da TV, para o conteúdo não
     encostar em borda nenhuma. Fica aqui, e não no index.html, porque este
     CSS é injetado depois e venceria um padding-bottom declarado lá. */
  body {
    padding: var(--margem-tv, 0px);
    padding-bottom: calc(4.5rem + var(--margem-tv, 0px));
  }

  /* ===== Transição entre páginas =====
     Só a vista que ENTRA anima (pagina-entrar, aplicada em .vista--ativa no
     CSS do index.html): ela aparece deslizando sobre o fundo do site.

     A que sai simplesmente deixa de ser exibida. Já houve aqui um cross-fade
     em que ela ganhava .vista--saindo, virava position:fixed sobre a tela e
     apagava por baixo — e ele trazia dois defeitos visíveis a cada troca:

     1. Salto de alinhamento. Ao sair do fluxo, a caixa da vista deixava de ser
        a área de conteúdo do body (que desconta o rodapé de 4.5rem) e o
        conteúdo se reposicionava no primeiro quadro da animação.
     2. Bordas brancas. É a mesma armadilha que fez este projeto descartar as
        View Transitions (ver o comentário em ativar()): com o zoom do body no
        meio, criar um elemento fixed em cima da tela faz o navegador pintar
        áreas do canvas que ele ainda não rasterizou.

     Sem sobreposição os dois desaparecem — e é também o caminho mais barato:
     uma única camada animando em vez de duas do tamanho da tela, o que num
     Fire Stick é exatamente o recurso que falta (fill rate). O deslize de
     quem entra já dá sozinho a leitura de direção. */
  @keyframes pagina-entrar {
    from { opacity: 0; transform: translateX(3%); }
    to   { opacity: 1; transform: none; }
  }

  /* Barra da rotação automática: enche da esquerda para a direita e, ao
     completar, a vista troca (agendarTroca cuida do tempo).

     Enche por scaleX, não por width: width é propriedade de LAYOUT, então
     animá-la obriga o navegador a refazer layout + repintura em todo quadro,
     por 30s, em loop, o tempo inteiro em que a TV está ligada — com o
     zoom do body no meio, ainda mais caro. scaleX é transform puro: sobe
     para uma camada do compositor e não custa quadro nenhum à CPU. Era a
     animação mais cara do projeto, e a única que nunca parava. */
  .rotacao-progresso {
    position: fixed;
    left: var(--margem-tv, 0px);
    bottom: var(--margem-tv, 0px);
    height: 4px;
    /* Encolhe junto com as margens laterais, senão as pontas ficariam fora. */
    width: calc(100% - 2 * var(--margem-tv, 0px));
    transform: scaleX(0);
    transform-origin: left center;
    will-change: transform;
    background: var(--success);
    z-index: 60;
  }

  @media (prefers-reduced-motion: reduce) {
    .paginacao,
    .paginacao__bolinha,
    .paginacao__bolinha--ativa,
    .paginacao__bolinha--ativa::after,
    .vista--ativa,
    body { animation: none; transition: none; }
  }

  /* Botão de sair: canto oposto à barra de navegação. Quase invisível em
     repouso (painel de TV não deve chamar atenção para isso) — só ganha
     fundo e contraste no hover/foco, quando alguém já foi até lá de propósito. */
  .sair-btn {
    position: fixed;
    left: calc(1rem + var(--margem-tv, 0px));
    bottom: calc(1rem + var(--margem-tv, 0px));
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
    atual = pagina;

    // Só a vista nova anima (ver o bloco "Transição entre páginas" no CSS): a
    // anterior perde .vista--ativa e volta a display:none na mesma hora.
    // Nada de sobrepor a antiga em position:fixed nem de View Transitions —
    // as duas coisas, com o zoom do body no meio, fazem o navegador pintar
    // áreas brancas no lugar do que ainda não rasterizou.
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
    barra.style.transform = "scaleX(0)";
    if (!segundos || paginas.length < 2) return;

    void barra.offsetWidth; // aplica o scaleX(0) antes de animar de novo
    barra.style.transition = `transform ${segundos}s linear`;
    barra.style.transform = "scaleX(1)";

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

