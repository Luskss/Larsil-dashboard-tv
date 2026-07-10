// Página Mapa da Frota: um mapa-múndi gira uma volta, desacelera e dá zoom no
// Brasil, então revela a localização atual da frota agrupada por projeto.
//
// Dados: /api/frota-localizacao (dbo.TICKET x dbo.FROTA — ver server.js). Cada
// ponto é uma frente de trabalho (PROJETO) com nº de máquinas, classes mais
// comuns e a coordenada média.
//
// Mapa: world-atlas (world-110m.json, TopoJSON) decodificado aqui mesmo, sem
// biblioteca externa. Projeção equirretangular simples num plano 1000x500:
//   x = (lon + 180) / 360 * 1000      y = (90 - lat) / 180 * 500
//
// Renderização: os países são RASTERIZADOS uma única vez num <canvas>, e toda
// a animação (rotação + zoom) é um transform CSS no próprio elemento — o
// compositor da GPU move a imagem pronta sem repintar um pixel. A versão
// anterior (SVG com transform de atributo no <g>) re-rasterizava o vetor
// inteiro a cada quadro e travava em navegadores fracos (Amazon Silk /
// Fire TV). Ao fim da animação o canvas é redesenhado UMA vez, nítido, no
// enquadramento final — durante o zoom a imagem global é só ampliada (fica
// levemente borrada por ~1,6s, imperceptível em movimento). Pinos e rótulos
// são HTML em coordenada de TELA, posicionados quando o mapa para.

import { consultarFrotaLocalizacao } from "./downdetector.js";

const INTERVALO_ATUALIZACAO_MS = 5 * 60 * 1000; // mesmo ritmo do restante

const LARGURA = 1000, ALTURA = 500; // plano equirretangular do mapa
const projX = (lon) => (lon + 180) / 360 * LARGURA;
const projY = (lat) => (90 - lat) / 180 * ALTURA;

// Enquadramento do Brasil inteiro (fallback quando não há pontos).
const BRASIL_BBOX = { oeste: -74, leste: -34, norte: 6, sul: -34 };

// Visão global usada na abertura (mundo inteiro, sem os polos vazios).
const GLOBAL_BBOX = { oeste: -180, leste: 180, norte: 84, sul: -56 };

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

// Resolução máxima do raster (multiplicador do devicePixelRatio): acima de
// 1.5x o ganho visual é pequeno e a memória/tempo de pintura dobram — ruim
// justamente nos aparelhos fracos que motivaram o canvas.
const DPR_MAX = 1.5;

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

// Anéis geo -> path SVG ("d") na projeção equirretangular. O mesmo texto vale
// para o canvas: new Path2D(d) aceita path data de SVG.
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

// ===== Montagem: geometria em Path2D + canvas e overlays =====
// render.paises = países comuns; render.brasil = contorno em destaque (50m se
// disponível, senão o 110m); render.costura = base sob o Brasil detalhado que
// fecha a fenda 50m x 110m contra os vizinhos (ver comentários no CSS).
let render = null;

async function montarMapa() {
  const [topo, brasilDetalhado] = await Promise.all([
    fetch("./world-110m.json").then((r) => r.json()),
    carregarBrasilDetalhado().catch(() => null),
  ]);
  const arcos = decodificarArcos(topo);

  const paises = [];
  let brasil110m = null;
  for (const geo of topo.objects.countries.geometries) {
    const ehBrasil = geo.id === "076" || /brazil|brasil/i.test(geo.properties?.name || "");
    if (brasilDetalhado && geo.id === "076") continue; // substituído pelo 50m
    const d = caminhoDoPais(aneisDaGeometria(geo, arcos));
    if (ehBrasil) brasil110m = new Path2D(d);
    else paises.push(new Path2D(d));
  }

  render = {
    paises,
    brasil: brasilDetalhado ? new Path2D(brasilDetalhado) : brasil110m,
    costura: brasilDetalhado ? new Path2D(brasilDetalhado) : null,
  };

  // Canvas do mundo + overlays de TELA (pinos, linhas-guia e rótulos em HTML,
  // por cima do canvas — nunca distorcem com o zoom).
  palco.innerHTML =
    `<canvas class="mapa-canvas" id="mapa-canvas" aria-hidden="true"></canvas>
     <div class="mapa-pinos" id="mapa-pinos" aria-hidden="true"></div>
     <svg class="mapa-linhas" id="mapa-linhas" aria-hidden="true"></svg>
     <div class="mapa-rotulos" id="mapa-rotulos"></div>`;

  // Mostra o mundo já na visão global enquanto os dados da frota não chegam.
  if (palco.clientWidth) rasterizar(transformParaBBox(GLOBAL_BBOX));
}

// Resolve as cores do tema a partir das MESMAS classes CSS da época do SVG
// (.mapa-pais etc., mantidas no index.html): um elemento-sonda entra no DOM só
// para o getComputedStyle devolver fill/stroke já resolvidos (var(),
// color-mix()...). Assim o canvas acompanha o tema sem duplicar cor aqui.
function coresDoTema() {
  const sonda = (classe) => {
    const el = document.createElement("i");
    el.className = classe;
    el.style.cssText = "position:absolute;visibility:hidden";
    palco.appendChild(el);
    const s = getComputedStyle(el);
    const cores = { fill: s.fill, stroke: s.stroke };
    el.remove();
    return cores;
  };
  return {
    pais: sonda("mapa-pais"),
    costura: sonda("mapa-costura"),
    brasil: sonda("mapa-pais--brasil"),
  };
}

// ===== Transforms: {escala, tx, ty} em unidades do plano 1000x500 =====
// Enquadra um retângulo geo no palco visível (comportamento de "cover": o
// excedente é cortado; por isso medimos a razão real do palco).
function transformParaBBox(bbox, folga = 1) {
  const x0 = projX(bbox.oeste), x1 = projX(bbox.leste);
  const y0 = projY(bbox.norte), y1 = projY(bbox.sul);
  const larguraGeo = (x1 - x0) * folga;
  const alturaGeo = (y1 - y0) * folga;

  // Razão do palco na tela decide qual dimensão limita o zoom.
  const razaoPalco = palco.clientWidth / palco.clientHeight || 2;
  const razaoPlano = LARGURA / ALTURA;
  // Largura/altura "efetivas" do plano visível (o cover corta o excedente).
  const visLargura = razaoPalco >= razaoPlano ? LARGURA : ALTURA * razaoPalco;
  const visAltura = razaoPalco >= razaoPlano ? LARGURA / razaoPalco : ALTURA;

  const escala = Math.min(visLargura / larguraGeo, visAltura / alturaGeo);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  // Centraliza o alvo no meio do plano (500,250) após escalar.
  return { escala, tx: LARGURA / 2 - cx * escala, ty: ALTURA / 2 - cy * escala };
}

// Como o plano 1000x500 mapeia para os pixels do palco (cover, centralizado):
// escalaTela = px por unidade do plano; offX/offY centralizam o corte.
function geometriaTela() {
  const razaoPalco = palco.clientWidth / palco.clientHeight || 2;
  const razaoPlano = LARGURA / ALTURA;
  let escalaTela, offX = 0, offY = 0;
  if (razaoPalco >= razaoPlano) {
    escalaTela = palco.clientWidth / LARGURA;      // largura preenche
    offY = (palco.clientHeight - ALTURA * escalaTela) / 2;
  } else {
    escalaTela = palco.clientHeight / ALTURA;      // altura preenche
    offX = (palco.clientWidth - LARGURA * escalaTela) / 2;
  }
  return { escalaTela, offX, offY };
}

// Converte lat/lon -> pixel na tela, dado um transform do mundo.
function geoParaTela(lon, lat, t) {
  const { escalaTela, offX, offY } = geometriaTela();
  const vx = projX(lon) * t.escala + t.tx;
  const vy = projY(lat) * t.escala + t.ty;
  return { x: vx * escalaTela + offX, y: vy * escalaTela + offY };
}

// ===== Raster do mundo =====
// Desenha o mundo no canvas com o transform `t`. Acontece POUCAS vezes (início
// da animação, fim dela e resize) — nunca por quadro. `comCopia` estende o
// canvas uma volta inteira à direita com uma 2ª cópia do mundo: deslizar o
// elemento para a esquerda durante o giro expõe a cópia e a rotação fica
// contínua, sem faixa vazia.
let transformRaster = null; // com que transform o canvas foi pintado

function rasterizar(t, comCopia = false) {
  const canvas = palco.querySelector("#mapa-canvas");
  if (!canvas || !render || !palco.clientWidth) return;
  const { escalaTela, offX, offY } = geometriaTela();

  const larguraMundoPx = LARGURA * t.escala * escalaTela;
  const cssL = Math.ceil(palco.clientWidth + (comCopia ? larguraMundoPx : 0));
  const cssA = palco.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, DPR_MAX);
  canvas.width = Math.round(cssL * dpr);
  canvas.height = Math.round(cssA * dpr);
  canvas.style.width = `${cssL}px`;
  canvas.style.height = `${cssA}px`;
  canvas.style.transform = "";

  const ctx = canvas.getContext("2d");
  const cores = coresDoTema();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssL, cssA);
  ctx.translate(offX, offY);
  ctx.scale(escalaTela, escalaTela);
  ctx.translate(t.tx, t.ty);
  ctx.scale(t.escala, t.escala);
  ctx.lineJoin = "round";

  const desenharMundo = () => {
    // Países comuns: traço da COR DO PREENCHIMENTO engorda cada país meio
    // traço para fora e fecha a costura com o Brasil detalhado (ver CSS).
    ctx.fillStyle = cores.pais.fill;
    ctx.strokeStyle = cores.pais.stroke;
    ctx.lineWidth = 0.6;
    for (const p of render.paises) { ctx.fill(p); ctx.stroke(p); }

    // Base de costura sob o Brasil: silhueta 50m na cor dos vizinhos, invade a
    // fenda 50m x 110m e a pinta de cor-de-país antes do Brasil verde por cima.
    if (render.costura) {
      ctx.fillStyle = cores.costura.fill;
      ctx.strokeStyle = cores.costura.stroke;
      ctx.lineWidth = 0.6;
      ctx.fill(render.costura);
      ctx.stroke(render.costura);
    }

    // Brasil em destaque, traço com espessura constante DE TELA (~1.5px, o
    // equivalente do non-scaling-stroke da versão SVG).
    if (render.brasil) {
      ctx.fillStyle = cores.brasil.fill;
      ctx.strokeStyle = cores.brasil.stroke;
      ctx.lineWidth = 1.5 / (escalaTela * t.escala);
      ctx.fill(render.brasil);
      ctx.stroke(render.brasil);
    }
  };

  desenharMundo();
  if (comCopia) {
    ctx.translate(LARGURA, 0);
    desenharMundo();
  }
  transformRaster = t;
}

// Simula o transform `t` movendo o canvas por CSS em relação ao raster feito
// em `transformRaster` — só o compositor trabalha, nada é repintado.
// Derivação: tela(v) = (v·escala + tx)·escalaTela + off para ambos os
// transforms; igualando o raster movido ao alvo:
//   k = escala_t / escala_raster
//   c = escalaTela·(t.t − k·raster.t) + off·(1 − k)
function aplicarTransformCss(t) {
  const canvas = palco.querySelector("#mapa-canvas");
  if (!canvas || !transformRaster) return;
  const { escalaTela, offX, offY } = geometriaTela();
  const r = transformRaster;
  const k = t.escala / r.escala;
  const cx = escalaTela * (t.tx - k * r.tx) + offX * (1 - k);
  const cy = escalaTela * (t.ty - k * r.ty) + offY * (1 - k);
  canvas.style.transform =
    `translate(${cx.toFixed(2)}px, ${cy.toFixed(2)}px) scale(${k.toFixed(4)})`;
}

// ===== Marcadores + rótulos =====
let pontosAtuais = [];

// Cache de elementos e medidas dos pinos/rótulos/linhas, reconstruído a cada
// desenharPinos(). reposicionar() roda em resize e no fim da animação; pagar
// querySelector + offsetWidth por pino a cada chamada força reflow síncrono e
// derruba o frame rate em aparelhos fracos (Fire TV/Silk).
let refs = null;

function desenharPinos() {
  const gPinos = palco.querySelector("#mapa-pinos");
  const gLinhas = palco.querySelector("#mapa-linhas");
  const rotulos = palco.querySelector("#mapa-rotulos");
  if (!gPinos || !rotulos || !gLinhas) return;

  // Pinos em coordenada de TELA (divs posicionados por reposicionar): tamanho
  // fixo em px, sem contra-escala — o mapa embaixo é quem dá zoom.
  gPinos.innerHTML = pontosAtuais.map((p, i) =>
    `<div class="mapa-pino" data-i="${i}">
       <div class="mapa-pino__halo"></div>
       <div class="mapa-pino__ponto"></div>
     </div>`
  ).join("");

  // Linha-guia (leader) do pino até o rótulo, quando o rótulo é afastado no
  // declutter. Espaço de TELA (SVG overlay, ver reposicionar).
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

  refs = {
    pinos: [...gPinos.querySelectorAll(".mapa-pino")],
    linhas: [...gLinhas.querySelectorAll(".mapa-linha")],
    cards: [...rotulos.querySelectorAll(".mapa-rotulo")],
    medidas: pontosAtuais.map(() => null), // {w,h} de cada card, medido 1x
  };
}

// "CAMINHAO PIPA" -> "Caminhao Pipa" (classes vêm em caixa alta do banco).
function tituloClasse(s) {
  return String(s || "").toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

// Posiciona pinos, rótulos e linhas-guia para o transform `t` do mapa.
// Roda no FIM da animação e em cada resize — nunca por quadro (durante o
// giro/zoom tudo isto está oculto).
function reposicionar(t) {
  if (!refs) return;

  // 1) Âncoras = posição de TELA de cada pino.
  const ancoras = pontosAtuais.map((p) => geoParaTela(p.lon, p.lat, t));
  refs.pinos.forEach((el, i) => {
    el.style.left = `${ancoras[i].x.toFixed(1)}px`;
    el.style.top = `${ancoras[i].y.toFixed(1)}px`;
  });

  // 2) Layout em DUAS COLUNAS (esquerda/direita): cada card vai para a coluna
  // do lado do seu pino e é empilhado por altura. A linha entra pela borda
  // interna do card (o lado voltado para o centro). cx/cy = centro da caixa;
  // ax/ay = âncora (pino); lado = -1 (esquerda) | +1 (direita).
  const caixas = pontosAtuais.map((p, i) => {
    // Medida do card memorizada: offsetWidth/Height forçam reflow síncrono, e
    // só mudam quando desenharPinos() refaz o HTML. Se a vista estava oculta
    // (mede 0), usa fallback sem memorizar e tenta de novo na próxima.
    let m = refs.medidas[i];
    if (!m) {
      const el = refs.cards[i];
      const w = el ? el.offsetWidth : 0;
      const h = el ? el.offsetHeight : 0;
      m = { w: w || 150, h: h || 40 };
      if (w) refs.medidas[i] = m;
    }
    return { i, w: m.w, h: m.h, ax: ancoras[i].x, ay: ancoras[i].y, cx: 0, cy: 0, lado: 0 };
  });
  espalharCaixas(caixas);

  caixas.forEach((c) => {
    const el = refs.cards[c.i];
    if (el) {
      el.style.left = `${c.cx}px`;   // translateX(-50%) no CSS centraliza
      el.style.top = `${(c.cy - c.h / 2).toFixed(1)}px`;
    }
    const linha = refs.linhas[c.i];
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
  const global = transformParaBBox(GLOBAL_BBOX);
  const destino = transformParaBBox(alvoBBox);

  // Fim de animação (ou modo sem movimento): re-rasteriza UMA vez, nítido, no
  // enquadramento final (o zoom só ampliou o raster global) e posiciona
  // pinos/rótulos — que ficaram ocultos durante o giro/zoom.
  const finalizar = () => {
    rasterizar(destino);
    reposicionar(destino);
  };

  if (semMovimento) {
    finalizar();
    revelarPinos(true);
    return;
  }

  rasterizar(global, true); // com a 2ª cópia à direita para o giro contínuo
  // Já posiciona o canvas no quadro inicial do giro (uma volta atrás), senão o
  // raster recém-pintado aparece por um instante na posição final.
  aplicarTransformCss({ escala: global.escala, tx: global.tx - LARGURA * global.escala, ty: global.ty });
  ocultarPinos();
  const inicio = performance.now();

  function quadro(agora) {
    const dt = agora - inicio;

    if (dt >= T_GIRO + T_ZOOM) {
      finalizar();
      revelarPinos(false);
      return; // fim da animação; resize/reposicionamento seguem sob demanda
    }

    let t;
    if (dt < T_GIRO) {
      // Rotação: desliza o mundo uma volta horizontal, desacelerando. O mapa é
      // "envolvente" — deslocar por LARGURA equivale a 360°. Some meia volta e
      // termina exatamente na visão global.
      const p = easeOut(dt / T_GIRO);
      const giro = (1 - p) * LARGURA * global.escala; // volta -> 0
      t = { escala: global.escala, tx: global.tx - giro, ty: global.ty };
    } else {
      // Zoom: interpola global -> região da frota.
      const p = easeInOut((dt - T_GIRO) / T_ZOOM);
      t = {
        escala: global.escala + (destino.escala - global.escala) * p,
        tx: global.tx + (destino.tx - global.tx) * p,
        ty: global.ty + (destino.ty - global.ty) * p,
      };
    }

    // Por quadro só muda o transform CSS do canvas — trabalho de compositor,
    // zero repintura mesmo em GPU fraca.
    aplicarTransformCss(t);
    animId = requestAnimationFrame(quadro);
  }
  animId = requestAnimationFrame(quadro);
}

function ocultarPinos() {
  palco.querySelectorAll(".mapa-pino").forEach((el) => (el.style.opacity = "0"));
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
  pinos.forEach((el, i) => {
    const aplica = () => (el.style.opacity = "1");
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
      refs = null; // cache apontaria para nós soltos do DOM
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

// Reenquadra ao redimensionar (re-rasteriza no novo tamanho e realinha tudo).
window.addEventListener("resize", () => {
  if (!mapaPronto || !pontosAtuais.length || !palco.offsetParent) return;
  const t = transformParaBBox(alvoBBox);
  rasterizar(t);
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
