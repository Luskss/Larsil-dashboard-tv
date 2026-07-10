// Página Mapa da Frota: um mapa-múndi gira uma volta, desacelera e dá zoom no
// Brasil, então revela a localização atual da frota agrupada por projeto.
//
// Dados: /api/frota-localizacao (dbo.TICKET x dbo.FROTA — ver server.js). Cada
// ponto é uma frente de trabalho (PROJETO) com nº de máquinas, classes mais
// comuns e a coordenada média.
//
// Mapa: world-atlas (world-110m.json, TopoJSON) decodificado aqui mesmo, sem
// biblioteca externa. Projeção equirretangular simples num viewBox 1000x500:
//   x = (lon + 180) / 360 * 1000      y = (90 - lat) / 180 * 500
// Toda a animação é um transform no <g> do mundo (rotação + zoom), então o
// layout da página nunca é tocado. Marcadores e rótulos ficam em coordenada de
// TELA, recalculados a cada quadro, para não distorcerem com o zoom.

import { consultarFrotaLocalizacao } from "./downdetector.js";

const INTERVALO_ATUALIZACAO_MS = 5 * 60 * 1000; // mesmo ritmo do restante

const LARGURA = 1000, ALTURA = 500; // viewBox equirretangular do mapa
const projX = (lon) => (lon + 180) / 360 * LARGURA;
const projY = (lat) => (90 - lat) / 180 * ALTURA;

// Enquadramento do Brasil inteiro (fallback quando não há pontos).
const BRASIL_BBOX = { oeste: -74, leste: -34, norte: 6, sul: -34 };

// Destino do zoom: calculado a partir dos pontos da frota (enquadra só a
// região onde as máquinas estão, para dar o máximo de zoom possível). Cai no
// BRASIL_BBOX enquanto não há dados.
let alvoBBox = BRASIL_BBOX;

// Recalcula o enquadramento a partir dos pontos, com uma margem geográfica
// mínima (evita zoom absurdo quando as frentes estão quase no mesmo ponto).
function calcularAlvoBBox(pontos) {
  if (!pontos.length) return BRASIL_BBOX;
  const lons = pontos.map((p) => p.lon), lats = pontos.map((p) => p.lat);
  let oeste = Math.min(...lons), leste = Math.max(...lons);
  let sul = Math.min(...lats), norte = Math.max(...lats);
  // Margem: 22% da extensão de cada eixo, com um piso em graus para não colar
  // os pinos das bordas na moldura.
  const margemLon = Math.max((leste - oeste) * 0.22, 3);
  const margemLat = Math.max((norte - sul) * 0.22, 3);
  return {
    oeste: oeste - margemLon, leste: leste + margemLon,
    norte: norte + margemLat, sul: sul - margemLat,
  };
}

// Fases da animação de abertura (ms).
const T_GIRO = 2600;   // rotação (uma volta) desacelerando
const T_ZOOM = 1600;   // zoom até enquadrar a frota
const T_REVELA = 700;  // fade dos marcadores após o zoom

// Raio dos pinos em unidades de TELA (contra-escalados pelo zoom do mapa).
const R_PONTO = 5, R_HALO = 8;

const palco = document.querySelector("#mapa-palco");

// ===== TopoJSON: decodifica arcos -> polígonos [lon,lat] =====
// Formato quantizado do world-atlas: aplica transform (scale/translate) e o
// delta-encoding dos arcos. Só precisamos das linhas dos países.
function decodificarArcos(topo) {
  const { scale, translate } = topo.transform;
  return topo.arcs.map((arco) => {
    let x = 0, y = 0;
    return arco.map(([dx, dy]) => {
      x += dx; y += dy;
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
    });
  });
}

// Resolve um índice de arco (negativos = arco invertido, ver spec TopoJSON).
function arcoPor(arcos, indice) {
  return indice < 0 ? arcos[~indice].slice().reverse() : arcos[indice];
}

// Uma geometria (Polygon/MultiPolygon) -> lista de anéis em coordenadas geo.
// Alguns países saem sem geometria (type: null, ex.: ilhas pequenas) em
// versões mais leves do world-atlas — sem anéis, sem desenho, mas sem quebrar
// o mapa inteiro.
function aneisDaGeometria(geo, arcos) {
  if (!geo.arcs) return [];
  const poligonos = geo.type === "MultiPolygon" ? geo.arcs : [geo.arcs];
  const aneis = [];
  for (const poligono of poligonos) {
    for (const anel of poligono) {
      const pontos = [];
      for (const indice of anel) {
        const seg = arcoPor(arcos, indice);
        // O último ponto de um arco repete o primeiro do próximo; corta a junta.
        for (let i = 0; i < seg.length; i++) {
          if (i === 0 && pontos.length) continue;
          pontos.push(seg[i]);
        }
      }
      aneis.push(pontos);
    }
  }
  return aneis;
}

// Quebra um anel toda vez que dois pontos consecutivos saltam mais de 180° de
// longitude — isso acontece em países que cruzam o antimeridiano (±180°), como
// a Rússia (a Chukotka fica em -180 enquanto o resto está perto de +180). Sem
// isso, a projeção plana ligaria os dois lados por uma reta que rasga o mapa na
// horizontal. Retorna sub-anéis, cada um só de um lado do ±180°.
function quebrarNoAntimeridiano(anel) {
  const partes = [];
  let atual = [];
  for (let i = 0; i < anel.length; i++) {
    if (i > 0 && Math.abs(anel[i][0] - anel[i - 1][0]) > 180) {
      partes.push(atual);
      atual = [];
    }
    atual.push(anel[i]);
  }
  if (atual.length) partes.push(atual);
  return partes;
}

// Anéis geo -> atributo "d" de <path> na projeção equirretangular.
function caminhoDoPais(aneis) {
  return aneis
    .flatMap((anel) => quebrarNoAntimeridiano(anel))
    .map((parte) =>
      parte
        .map(([lon, lat], i) => `${i ? "L" : "M"}${projX(lon).toFixed(1)} ${projY(lat).toFixed(1)}`)
        .join("") + "Z"
    )
    .join("");
}

// Brasil em alta resolução (~1650 pontos no contorno principal, extraído do
// world-atlas 50m) enquanto o resto do mundo usa o arquivo leve — o Brasil é
// o único país em foco (zoom final e localização da frota), os demais só
// aparecem desfocados durante o giro inicial.
async function carregarBrasilDetalhado() {
  const aneis = await (await fetch("./brasil-detalhado.json")).json();
  return caminhoDoPais(aneis);
}

// ===== Montagem do SVG do mundo =====
async function montarMapa() {
  const [topo, brasilDetalhado] = await Promise.all([
    fetch("./world-110m.json").then((r) => r.json()),
    carregarBrasilDetalhado().catch(() => null),
  ]);
  const arcos = decodificarArcos(topo);
  const paises = topo.objects.countries.geometries
    .filter((geo) => !(brasilDetalhado && geo.id === "076"))
    .map((geo) => ({
      brasil: geo.id === "076" || /brazil|brasil/i.test(geo.properties?.name || ""),
      d: caminhoDoPais(aneisDaGeometria(geo, arcos)),
    }));

  const paths = paises
    .map((p) => `<path class="mapa-pais${p.brasil ? " mapa-pais--brasil" : ""}" d="${p.d}"></path>`)
    .join("");

  // Costura Brasil ↔ vizinhos: o contorno detalhado do Brasil (50m) não bate com
  // o dos vizinhos (110m), deixando uma fenda escura na fronteira. Em vez de
  // engordar traço (borra a costura), desenhamos o Brasil detalhado DUAS vezes:
  //   1) uma BASE com a cor dos vizinhos e um traço largo da mesma cor, que
  //      "invade" o vão e o pinta com a cor de país (some a fenda escura);
  //   2) o Brasil verde por cima, que define a silhueta e a borda limpas.
  // A base fica logo antes do Brasil verde, então cobre o vão sem vazar por cima.
  const brasilBase = brasilDetalhado
    ? `<path class="mapa-costura" d="${brasilDetalhado}"></path>`
    : "";
  const brasilTopo = brasilDetalhado
    ? `<path class="mapa-pais mapa-pais--brasil" d="${brasilDetalhado}"></path>`
    : "";

  palco.innerHTML =
    // Duas cópias do mundo lado a lado (a 2ª deslocada +LARGURA): durante o
    // giro o grupo desliza na horizontal e a cópia extra preenche a lateral,
    // deixando a rotação contínua (sem faixa vazia). O zoom mira o Brasil na
    // 1ª cópia; a 2ª sai naturalmente de cena.
    //
    // Os pinos (#mapa-pinos) ficam DENTRO de #mapa-mundo, então herdam o mesmo
    // transform do mapa e grudam na geografia exata (nada de "bolinha voando").
    // Só o raio é contra-escalado por quadro para o pino não inflar com o zoom.
    `<svg viewBox="0 0 ${LARGURA} ${ALTURA}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
       <g id="mapa-mundo">
         <g>${paths}${brasilBase}${brasilTopo}</g>
         <g transform="translate(${LARGURA} 0)">${paths}${brasilBase}${brasilTopo}</g>
         <g id="mapa-pinos"></g>
       </g>
     </svg>
     <svg class="mapa-linhas" id="mapa-linhas" aria-hidden="true"></svg>
     <div class="mapa-rotulos" id="mapa-rotulos"></div>`;
}

// ===== Transform do <g> do mundo: {escala, tx, ty} em unidades do viewBox =====
// Enquadra um retângulo geo no palco visível (o slice do preserveAspectRatio
// pode cortar as laterais; por isso medimos a razão real do palco).
function transformParaBBox(bbox, folga = 1) {
  const x0 = projX(bbox.oeste), x1 = projX(bbox.leste);
  const y0 = projY(bbox.norte), y1 = projY(bbox.sul);
  const larguraGeo = (x1 - x0) * folga;
  const alturaGeo = (y1 - y0) * folga;

  // Razão do palco na tela decide qual dimensão limita o zoom.
  const razaoPalco = palco.clientWidth / palco.clientHeight || 2;
  const razaoViewBox = LARGURA / ALTURA;
  // Largura/altura "efetivas" do viewBox visível (o slice corta o excedente).
  const visLargura = razaoPalco >= razaoViewBox ? LARGURA : ALTURA * razaoPalco;
  const visAltura = razaoPalco >= razaoViewBox ? LARGURA / razaoPalco : ALTURA;

  const escala = Math.min(visLargura / larguraGeo, visAltura / alturaGeo);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  // Centraliza o alvo no meio do viewBox (500,250) após escalar.
  return { escala, tx: LARGURA / 2 - cx * escala, ty: ALTURA / 2 - cy * escala };
}

function aplicarTransform(t) {
  const g = palco.querySelector("#mapa-mundo");
  if (g) g.setAttribute("transform", `translate(${t.tx} ${t.ty}) scale(${t.escala})`);
  return t;
}

// Converte lat/lon -> pixel na tela, dado o transform atual do mundo e a
// geometria do palco (respeitando o slice do preserveAspectRatio).
function geoParaTela(lon, lat, t) {
  // Ponto no espaço do viewBox após o transform do mundo.
  const vx = projX(lon) * t.escala + t.tx;
  const vy = projY(lat) * t.escala + t.ty;

  // Como o viewBox mapeia para os pixels do palco (slice = cobre, centraliza).
  const razaoPalco = palco.clientWidth / palco.clientHeight || 2;
  const razaoViewBox = LARGURA / ALTURA;
  let escalaTela, offX = 0, offY = 0;
  if (razaoPalco >= razaoViewBox) {
    escalaTela = palco.clientWidth / LARGURA;      // largura preenche
    offY = (palco.clientHeight - ALTURA * escalaTela) / 2;
  } else {
    escalaTela = palco.clientHeight / ALTURA;      // altura preenche
    offX = (palco.clientWidth - LARGURA * escalaTela) / 2;
  }
  return { x: vx * escalaTela + offX, y: vy * escalaTela + offY };
}

// ===== Marcadores + rótulos =====
let pontosAtuais = [];

function desenharPinos() {
  const gPinos = palco.querySelector("#mapa-pinos");
  const gLinhas = palco.querySelector("#mapa-linhas");
  const rotulos = palco.querySelector("#mapa-rotulos");
  if (!gPinos || !rotulos || !gLinhas) return;

  // Pinos em coordenada GEO (dentro de #mapa-mundo): herdam o transform do
  // mapa. O raio (r) é reescrito a cada quadro em reposicionar().
  gPinos.innerHTML = pontosAtuais.map((p, i) =>
    `<g class="mapa-pino" data-i="${i}" opacity="0"
        transform="translate(${projX(p.lon).toFixed(2)} ${projY(p.lat).toFixed(2)})">
       <circle class="mapa-pino__halo"></circle>
       <circle class="mapa-pino__ponto"></circle>
     </g>`
  ).join("");

  // Linha-guia (leader) do pino até o rótulo, quando o rótulo é afastado no
  // declutter. Espaço de TELA (SVG overlay separado, ver reposicionar).
  gLinhas.innerHTML = pontosAtuais.map((_, i) =>
    `<polyline class="mapa-linha" data-i="${i}"></polyline>`
  ).join("");

  rotulos.innerHTML = pontosAtuais.map((p, i) => {
    const classes = p.classes.slice(0, 3).map((c) => `${tituloClasse(c.nome)} (${c.qtd})`).join(" · ");
    return `<div class="mapa-rotulo" data-i="${i}">
      <div class="mapa-rotulo__topo">
        <span class="mapa-rotulo__projeto">Projeto ${p.projeto}</span>
        <span class="mapa-rotulo__qtd">${p.maquinas} máq</span>
      </div>
      <div class="mapa-rotulo__classes">${classes}</div>
    </div>`;
  }).join("");
}

// "CAMINHAO PIPA" -> "Caminhao Pipa" (classes vêm em caixa alta do banco).
function tituloClasse(s) {
  return String(s || "").toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

// Reposiciona pinos, rótulos e linhas-guia para o transform atual do mapa.
// Chamado a cada quadro da animação e em cada resize.
//
// Pinos: vivem em coordenada GEO dentro de #mapa-mundo (herdam o transform),
// então só o RAIO precisa ser contra-escalado (r_tela / escala_total) para o
// pino não inflar com o zoom. escala_total = escala do mundo * escala do slice.
// Rótulos e linhas: espaço de TELA (px), com declutter vertical para não
// empilharem quando várias frentes caem quase no mesmo ponto.
function reposicionar(t) {
  const gPinos = palco.querySelector("#mapa-pinos");
  const gLinhas = palco.querySelector("#mapa-linhas");
  const rotulos = palco.querySelector("#mapa-rotulos");
  if (!gPinos || !rotulos || !gLinhas) return;

  const escalaSlice = escalaDoSlice();
  const escalaTotal = t.escala * escalaSlice;

  // 1) Pinos na geografia; raio contra-escalado para ~R_PONTO px na tela.
  pontosAtuais.forEach((p, i) => {
    const g = gPinos.querySelector(`[data-i="${i}"]`);
    if (!g) return;
    const ponto = g.querySelector(".mapa-pino__ponto");
    const halo = g.querySelector(".mapa-pino__halo");
    if (ponto) ponto.setAttribute("r", (R_PONTO / escalaTotal).toFixed(3));
    if (halo) halo.setAttribute("r", (R_HALO / escalaTotal).toFixed(3));
    // stroke também escala com o mundo; compensa para ~1.5px de tela.
    if (ponto) ponto.setAttribute("stroke-width", (1.5 / escalaTotal).toFixed(3));
  });

  // 2) Âncoras dos rótulos = posição de TELA de cada pino.
  const ancoras = pontosAtuais.map((p) => geoParaTela(p.lon, p.lat, t));

  // 3) Layout em DUAS COLUNAS (esquerda/direita): cada card vai para a coluna
  // do lado do seu pino e é empilhado por altura. A linha entra pela borda
  // interna do card (o lado voltado para o centro). cx/cy = centro da caixa;
  // ax/ay = âncora (pino); lado = -1 (esquerda) | +1 (direita).
  const caixas = pontosAtuais.map((p, i) => {
    const el = rotulos.querySelector(`[data-i="${i}"]`);
    const h = el ? el.offsetHeight || 40 : 40;
    const w = el ? el.offsetWidth || 150 : 150;
    return { i, w, h, ax: ancoras[i].x, ay: ancoras[i].y, cx: 0, cy: 0, lado: 0 };
  });
  espalharCaixas(caixas);

  caixas.forEach((c) => {
    const el = rotulos.querySelector(`[data-i="${c.i}"]`);
    if (el) {
      el.style.left = `${c.cx}px`;   // translateX(-50%) no CSS centraliza
      el.style.top = `${(c.cy - c.h / 2).toFixed(1)}px`;
    }
    const linha = gLinhas.querySelector(`[data-i="${c.i}"]`);
    if (linha) {
      // Linha em cotovelo: borda interna do card -> calha (gutter) na altura do
      // card -> calha na altura do pino -> pino. Como a parte vertical corre na
      // calha, logo fora da coluna, a linha nunca cruza outro card.
      const bx = c.cx - c.lado * (c.w / 2);   // borda interna do card (lado do mapa)
      const g = c.gutterX;                     // calha da coluna
      // Pontos: card -> calha(mesmo y do card) -> calha(y do pino) -> pino.
      const pts = [
        [bx, c.cy],
        [g, c.cy],
        [g, c.ay],
        [c.ax, c.ay],
      ];
      linha.setAttribute("points", pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "));
    }
  });
}

// Distribui os cards em duas colunas laterais (esquerda e direita), cada um do
// lado do seu próprio pino, empilhados por ordem vertical do pino. Como a ordem
// vertical dos cards numa coluna acompanha a dos pinos daquele lado, as linhas
// não se cruzam. O empilhamento mantém cada card o MAIS PERTO possível da
// altura real do seu pino (não joga tudo pro topo), então as linhas ficam
// quase horizontais e curtas — sem subir em diagonal cortando outros cards.
function espalharCaixas(caixas) {
  const W = palco.clientWidth || 1200, H = palco.clientHeight || 700;
  if (!caixas.length) return;

  const FOLGA_Y = 10;    // folga vertical entre cards empilhados
  const FOLGA_X = 24;    // afastamento da coluna à região dos pinos daquele lado

  // Divide os pinos entre esquerda e direita pela posição na tela; corta ao
  // meio por X para as colunas ficarem equilibradas.
  const porX = [...caixas].sort((a, b) => a.ax - b.ax);
  const meio = Math.ceil(porX.length / 2);
  const esquerda = porX.slice(0, meio);
  const direita = porX.slice(meio);

  const colocarColuna = (coluna, lado) => {
    if (!coluna.length) return;
    // Ordena por altura do pino: preserva a ordem vertical (linhas não cruzam).
    coluna.sort((a, b) => a.ay - b.ay);
    const larguraMax = coluna.reduce((m, c) => Math.max(m, c.w), 0);

    // X da coluna: encostada do lado de fora da região de pinos daquele grupo,
    // não na borda da tela — os cards ficam perto de onde a frota está.
    let cx;
    if (lado < 0) {
      const pinoMaisEsq = Math.min(...coluna.map((c) => c.ax));
      cx = Math.max(larguraMax / 2 + 8, pinoMaisEsq - FOLGA_X - larguraMax / 2);
    } else {
      const pinoMaisDir = Math.max(...coluna.map((c) => c.ax));
      cx = Math.min(W - larguraMax / 2 - 8, pinoMaisDir + FOLGA_X + larguraMax / 2);
    }
    // Calha (gutter): faixa vertical logo além da borda INTERNA dos cards (o
    // lado voltado para o mapa), por onde as linhas sobem/descem sem cruzar
    // nenhum card. A borda interna é a do card mais largo, para a calha nunca
    // entrar em cima de card algum. lado -1 (esq): borda interna à direita;
    // lado +1 (dir): borda interna à esquerda — daí o -lado.
    const bordaInterna = cx - lado * (larguraMax / 2);
    const gutterX = bordaInterna - lado * 12;
    for (const c of coluna) { c.lado = lado; c.cx = cx; c.gutterX = gutterX; }

    // Empilhamento que minimiza o deslocamento em relação ao Y ideal (o Y do
    // pino): resolve sobreposições formando "grupos" que se movem juntos até a
    // média das posições ideais, empurrando para cima OU para baixo conforme
    // necessário — sem colar tudo no topo.
    empilharCentrado(coluna, H, FOLGA_Y);

    // Desempate de calhas SOBREPOSTAS (feito após o empilhamento, quando cy já
    // está definido): quando os trechos verticais de vários cards ocupam a mesma
    // faixa Y (pinos quase no mesmo ponto), eles virariam um traço grosso único.
    // Afasta cada um por um degrau em X — preservando a ordem, então nenhuma
    // linha cruza outra.
    separarCalhas(coluna, lado);
  };

  colocarColuna(esquerda, -1);
  colocarColuna(direita, +1);
}

// Afasta em X as calhas cujos trechos verticais se sobrepõem na mesma faixa Y,
// para não virarem um traço grosso quando vários pinos caem quase no mesmo
// ponto. Aloca "faixas" (degraus de calha) como numa agenda: percorre os cards
// já ordenados por ay e dá a cada um o menor degrau livre naquela faixa Y. Como
// a ordem é preservada e o degrau só aumenta rumo ao mapa, as linhas não cruzam.
function separarCalhas(coluna, lado) {
  const PASSO = 9;   // distância entre calhas vizinhas (px)
  const FOLGA = 4;   // tolerância de sobreposição em Y para considerar conflito
  const trecho = (c) => [Math.min(c.cy, c.ay), Math.max(c.cy, c.ay)];

  // Ordena por ay (destino do vertical) para alocação estável de degraus.
  const ordem = [...coluna].sort((a, b) => a.ay - b.ay);
  const ocupacao = []; // ocupacao[d] = maior Y já usado no degrau d

  for (const c of ordem) {
    const [y1, y2] = trecho(c);
    let d = 0;
    while (d < ocupacao.length && ocupacao[d] > y1 + FOLGA) d++;
    ocupacao[d] = y2;
    c.gutterX = c.gutterX - lado * (d * PASSO); // afasta rumo ao mapa
  }
}

// Posiciona uma pilha de cards (já ordenados por ay) minimizando quanto cada um
// se afasta do seu Y ideal (ay), sem sobreposição e dentro do palco. Algoritmo
// de agrupamento: enquanto dois cards vizinhos se sobrepõem, funde-os num bloco
// rígido cujo topo é a média das posições desejadas; repete até estabilizar.
function empilharCentrado(coluna, H, folga) {
  const alturaCard = (c) => c.h + folga;
  // Cada card quer que seu TOPO fique em (ay - h/2). Guarda alvo do topo.
  const grupos = coluna.map((c) => ({
    itens: [c],
    alturaTotal: alturaCard(c),
    // soma dos alvos de topo "internos" ajustada para o topo do grupo
    alvoTopo: c.ay - c.h / 2,
  }));

  let fundiu = true;
  while (fundiu) {
    fundiu = false;
    for (let g = 0; g < grupos.length - 1; g++) {
      const A = grupos[g], B = grupos[g + 1];
      // Fim de A (se A começa em alvoTopo) vs início de B.
      if (A.alvoTopo + A.alturaTotal > B.alvoTopo) {
        // Funde: o novo alvo de topo é a média ponderada que minimiza o
        // deslocamento total (posiciona o bloco no "centro de gravidade").
        const novoAlvo =
          (A.alvoTopo * A.itens.length + (B.alvoTopo - A.alturaTotal) * B.itens.length) /
          (A.itens.length + B.itens.length);
        A.itens = A.itens.concat(B.itens);
        A.alturaTotal += B.alturaTotal;
        A.alvoTopo = novoAlvo;
        grupos.splice(g + 1, 1);
        fundiu = true;
        g = Math.max(-1, g - 2); // reavalia vizinhos afetados
      }
    }
  }

  // Escreve cy de cada card a partir do topo do seu grupo.
  for (const grp of grupos) {
    let topo = grp.alvoTopo;
    // Prende o grupo inteiro dentro do palco.
    topo = Math.max(8, Math.min(H - 8 - grp.alturaTotal, topo));
    let y = topo;
    for (const c of grp.itens) {
      c.cy = y + c.h / 2;
      y += alturaCard(c);
    }
  }
}

// Fator de escala do preserveAspectRatio="slice": quanto 1 unidade do viewBox
// vale em pixels de tela (a maior das duas razões, pois o slice cobre).
function escalaDoSlice() {
  return Math.max(palco.clientWidth / LARGURA, palco.clientHeight / ALTURA);
}

// ===== Animação de abertura: gira -> zoom -> revela =====
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

let animId = null;
// Evita reanimar quando a vista já está ativa: setado ao animar e zerado
// quando a vista sai de cena (ver o MutationObserver no fim do arquivo).
let jaAnimouNestaVisita = false;

function animarAbertura() {
  cancelAnimationFrame(animId);
  const semMovimento = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Visão global inicial (mundo inteiro enquadrado) e destino (região da frota).
  const global = transformParaBBox({ oeste: -180, leste: 180, norte: 84, sul: -56 });
  const destino = transformParaBBox(alvoBBox);

  if (semMovimento) {
    aplicarTransform(destino);
    reposicionar(destino);
    revelarPinos(true);
    return;
  }

  ocultarPinos();
  const inicio = performance.now();

  function quadro(agora) {
    const dt = agora - inicio;
    let t;

    if (dt < T_GIRO) {
      // Rotação: desliza o mundo uma volta horizontal, desacelerando. O mapa é
      // "envolvente" — deslocar por LARGURA equivale a 360°. Some meia volta e
      // termina exatamente na visão global.
      const p = easeOut(dt / T_GIRO);
      const giro = (1 - p) * LARGURA * global.escala; // volta -> 0
      t = { escala: global.escala, tx: global.tx - giro, ty: global.ty };
    } else if (dt < T_GIRO + T_ZOOM) {
      // Zoom: interpola global -> região da frota.
      const p = easeInOut((dt - T_GIRO) / T_ZOOM);
      t = {
        escala: global.escala + (destino.escala - global.escala) * p,
        tx: global.tx + (destino.tx - global.tx) * p,
        ty: global.ty + (destino.ty - global.ty) * p,
      };
    } else {
      t = destino;
    }

    aplicarTransform(t);
    reposicionar(t);

    if (dt >= T_GIRO + T_ZOOM) {
      revelarPinos(false);
      return; // fim da animação; resize/reposicionamento seguem sob demanda
    }
    animId = requestAnimationFrame(quadro);
  }
  animId = requestAnimationFrame(quadro);
}

function ocultarPinos() {
  palco.querySelectorAll(".mapa-pino").forEach((g) => (g.style.opacity = "0"));
  palco.querySelectorAll(".mapa-rotulo").forEach((el) => el.classList.remove("mapa-rotulo--visivel"));
  // Esconde as linhas-guia durante o giro/zoom: até o mapa parar no Brasil,
  // elas apontariam para pinos fora de quadro, cruzando o mundo inteiro.
  const linhas = palco.querySelector("#mapa-linhas");
  if (linhas) linhas.style.opacity = "0";
}

// Revela pinos, rótulos e linhas em cascata (ou de uma vez, se sem movimento).
function revelarPinos(imediato) {
  const pinos = [...palco.querySelectorAll(".mapa-pino")];
  const rots = [...palco.querySelectorAll(".mapa-rotulo")];
  const linhas = palco.querySelector("#mapa-linhas");
  pinos.forEach((g, i) => {
    const aplica = () => (g.style.opacity = "1");
    if (imediato) aplica();
    else setTimeout(aplica, (i / Math.max(pinos.length, 1)) * T_REVELA);
  });
  rots.forEach((el, i) => {
    const aplica = () => el.classList.add("mapa-rotulo--visivel");
    if (imediato) aplica();
    else setTimeout(aplica, 150 + (i / Math.max(rots.length, 1)) * T_REVELA);
  });
  // As linhas só fazem sentido depois que os cards aparecem: revela junto.
  if (linhas) {
    if (imediato) linhas.style.opacity = "1";
    else setTimeout(() => (linhas.style.opacity = "1"), 150);
  }
}

// ===== Carga, aviso e ciclo =====
function mostrarAviso(mensagem) {
  const aviso = document.querySelector("#mapa-aviso");
  aviso.textContent = mensagem || "";
  aviso.classList.toggle("mapa-aviso--visivel", Boolean(mensagem));
}

let mapaPronto = false;

async function garantirMapa() {
  if (mapaPronto) return;
  await montarMapa();
  mapaPronto = true;
}

async function atualizar() {
  try {
    await garantirMapa();
    const dados = await consultarFrotaLocalizacao();
    pontosAtuais = dados.pontos || [];
    mostrarAviso("");

    const total = document.querySelector("#mapa-total");
    total.innerHTML = pontosAtuais.length
      ? `<strong>${dados.total}</strong> máquinas · ${pontosAtuais.length} frentes`
      : "";
    if (!pontosAtuais.length) {
      mostrarAviso("Nenhuma máquina com localização registrada.");
      palco.querySelector("#mapa-pinos").innerHTML = "";
      palco.querySelector("#mapa-linhas").innerHTML = "";
      document.querySelector("#mapa-rotulos").innerHTML = "";
      return;
    }

    alvoBBox = calcularAlvoBBox(pontosAtuais);
    desenharPinos();
    // Só anima quando a vista está visível; oculta (SPA) só monta os pinos e a
    // animação roda quando a vista aparecer (MutationObserver abaixo). Ao abrir
    // direto em #mapa, a vista já está ativa quando os dados chegam: anima aqui
    // e marca a visita para o observer não reanimar em seguida.
    if (palco.offsetParent) {
      jaAnimouNestaVisita = true;
      animarAbertura();
    }
  } catch (erro) {
    mostrarAviso(typeof erro === "string" ? erro : "Erro ao carregar a localização da frota.");
  }
}

// Reposiciona ao redimensionar (mantém pinos/rótulos alinhados ao mapa).
window.addEventListener("resize", () => {
  if (!mapaPronto || !pontosAtuais.length || !palco.offsetParent) return;
  const t = transformParaBBox(alvoBBox);
  aplicarTransform(t);
  reposicionar(t);
});

// Observa a vista entrar/sair de cena (paginacao.js alterna .vista--ativa) e
// dispara a animação de abertura quando o Mapa aparece (e só então).
const vista = document.querySelector("#vista-mapa");
new MutationObserver(() => {
  const ativa = vista.classList.contains("vista--ativa");
  if (ativa && !jaAnimouNestaVisita && mapaPronto && pontosAtuais.length) {
    jaAnimouNestaVisita = true;
    animarAbertura();
  }
  if (!ativa) jaAnimouNestaVisita = false; // reanima na próxima visita
}).observe(vista, { attributes: true, attributeFilter: ["class"] });

atualizar();
setInterval(atualizar, INTERVALO_ATUALIZACAO_MS);
