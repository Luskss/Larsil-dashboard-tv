// Página Apontamento: radar de equipe parada — quando cada equipe apontou
// produção pela última vez, com os últimos 15 dias em quadradinhos.
//
// O desenho é o da tela "Status Apontamento" do TimberTrack
// (public/docs/boletins.acompanhar.tsx), adaptado ao tema escuro do painel:
// matriz equipe x dia, coluna do dia de referência em dourado e o placar em
// números grandes no topo.
//
// A tela mostra UM COORDENADOR DE CADA VEZ e alterna entre eles, como o donut
// da Frotas alterna status e tipo. Os 47 grupos não cabem juntos numa TV; com
// a divisão, cada coordenador aparece inteiro — sem "+29 fora da lista".
//
// Nenhuma regra de negócio mora aqui. O estado de cada célula, os dias úteis
// parados e o semáforo vêm prontos de /api/apontamento (server.js) — igual ao
// original, em que o endpoint devolve a matriz montada e o front só pinta.

import { consultarApontamento } from "./downdetector.js";
import { aplicarNumeros } from "./animacoes.js";
import { observarVista } from "./visibilidade.js";
import { segundosRotacao } from "./paginacao.js";
import { escapar } from "./escape.js";

const INTERVALO_ATUALIZACAO_MS = 5 * 60 * 1000; // mesmo ritmo das outras vistas

const DURACAO_FADE_MS = 250; // casa com a transition do .ap-matriz no CSS

// Cada coordenador fica no ar por uma fatia do tempo de rotação da vista, e a
// rolagem automática cabe dentro dessa fatia. Vem de segundosRotacao() em vez
// de um número fixo aqui: com os dois em ritmos independentes, mexer no tempo
// de rotação faria a página trocar no meio de uma rolagem.
const SLOT_MINIMO_MS = 8 * 1000;

// A rolagem não começa no instante em que o coordenador entra nem termina
// colada na troca: as linhas do topo são as urgentes (a lista vem ordenada por
// urgência) e precisam de um tempo parado para serem lidas, e o fim da lista
// idem. Frações da fatia, não segundos fixos, para acompanharem a rotação.
const FRACAO_PAUSA_TOPO = 0.22;
const FRACAO_ROLAGEM = 0.5;

// Teto de linhas por coordenador. Alto de propósito: com a rolagem automática
// não há motivo para esconder equipe (hoje o maior coordenador tem 24). Existe
// só para o dia em que o cadastro crescer a ponto de a rolagem ficar rápida
// demais para ler — aí o rodapé avisa quantas ficaram de fora.
const MAX_LINHAS = 40;

// A partir de quantos dias CORRIDOS a data do último apontamento fica
// destacada. É a contrapartida do desconto de folga: uma equipe com evento
// registrado todo dia fica com 0 dia útil parado e cai no verde — correto pela
// regra de cobrança, mas "último: 11/07" precisa saltar aos olhos mesmo assim.
const DIAS_ULTIMO_ANTIGO = 7;

const DIAS_LETRA = ["D", "S", "T", "Q", "Q", "S", "S"];
const MESES_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

// "2026-08" -> "agosto de 2026". Sem new Date(): "2026-08" vira UTC e, em
// Brasília, voltaria julho.
function mesPorExtenso(mes) {
  const [ano, numero] = String(mes || "").split("-");
  return MESES_PT[Number(numero) - 1] ? `${MESES_PT[Number(numero) - 1]} de ${ano}` : "";
}

// As duas vistas deste módulo compartilham a consulta, então compartilham
// também o aviso de falha — se o fetch quebrou, nenhuma das duas tem dado.
function mostrarAviso(mensagem) {
  for (const id of ["#apontamento-aviso", "#pendencias-aviso"]) {
    const aviso = document.querySelector(id);
    aviso.textContent = mensagem || "";
    aviso.classList.toggle("apontamento-aviso--visivel", Boolean(mensagem));
  }
}

// "JOSE VANDERLEI BARBOSA" -> "JOSE BARBOSA". Nome do meio não ajuda a
// identificar ninguém no campo e é o que estoura a coluna.
function primeiroEUltimo(nome) {
  const partes = String(nome || "").trim().split(/\s+/).filter(Boolean);
  if (partes.length <= 1) return partes[0] || "—";
  return `${partes[0]} ${partes[partes.length - 1]}`;
}

const dataBR = (iso) => {
  const [, mes, dia] = String(iso || "").split("-");
  return dia && mes ? `${dia}/${mes}` : "—";
};

// Sigla do evento dentro do quadradinho, como no original: o dia tem 26px, só
// cabem duas letras.
function siglaEvento(evento) {
  const e = String(evento || "").trim().toUpperCase();
  if (e === "FOLGA" || !e) return "F";
  if (e === "SEM ATIVIDADE") return "SA";
  if (e === "NÃO APLICA") return "NA";
  if (e.includes("ANTECIP")) return "AN";
  if (e.includes("ATESTAD")) return "AT";
  if (e.includes("FÉRIAS") || e.includes("FERIAS")) return "FÉ";
  if (e.includes("VIAGEM")) return "VI";
  if (e.includes("LICEN")) return "LI";
  const palavras = e.split(/\s+/).filter(Boolean);
  return palavras.length === 1 ? e.slice(0, 2) : palavras.map((p) => p[0]).join("").slice(0, 2);
}

// SEM ATIVIDADE ganha o laranja do original: é evento registrado, mas de
// máquina/frente parada — não é a mesma notícia que uma folga.
function classeCelula(celula) {
  // Futuro e domingo compartilham a caixa vazia, como no original. O que
  // separa os dois é a coluna inteira do futuro estar apagada.
  if (celula.estado === "futuro") return "ap-celula--x";
  if (celula.estado !== "f") return `ap-celula--${celula.estado}`;
  return String(celula.evento || "").trim().toUpperCase() === "SEM ATIVIDADE"
    ? "ap-celula--sa"
    : "ap-celula--f";
}

function simboloCelula(celula) {
  if (celula.estado === "b") return "✓";
  if (celula.estado === "n") return "B";
  if (celula.estado === "f") return siglaEvento(celula.evento);
  return "";
}

function textoCelula(celula) {
  if (celula.estado === "b") return `${dataBR(celula.dia)} · ${celula.qtd} boletim(ns)`;
  if (celula.estado === "n") return `${dataBR(celula.dia)} · não apontou`;
  if (celula.estado === "f") {
    const motivo = celula.motivo ? ` — ${celula.motivo}` : "";
    return `${dataBR(celula.dia)} · ${celula.evento}${motivo}`;
  }
  if (celula.estado === "futuro") return `${dataBR(celula.dia)} · ainda não chegou`;
  return `${dataBR(celula.dia)} · domingo`;
}

function desenharCabecalho(dias, dataRef) {
  const colunas = dias.map((d) => {
    const foco = d.iso === dataRef ? " ap-col-foco" : "";
    // Dia que ainda não chegou entra apagado: a caixa vazia continua ali (é o
    // que dá a noção de quanto do mês falta), mas não disputa atenção com o
    // que já aconteceu.
    const futuro = d.futuro ? " ap-col-futuro" : "";
    return `<th class="ap-col-num${foco}${futuro}">
        <div class="ap-th-dia__numero">${String(d.dia).padStart(2, "0")}</div>
        <div class="ap-th-dia__letra">${DIAS_LETRA[d.semana]}</div>
      </th>`;
  }).join("");

  // table-layout é fixed: sem o colgroup as colunas do mês dividem a largura
  // em partes iguais e a primeira — a única com texto — fica espremida a ponto
  // de engolir o nome do líder.
  const larguras = `<colgroup>
      <col style="width: 20rem;">
      ${dias.map(() => "<col>").join("")}
      <col style="width: 5rem;">
      <col style="width: 4.5rem;">
    </colgroup>`;

  // Sem coluna de coordenador: a tela inteira já é de um coordenador só, e o
  // nome dele está no topo. A largura que sobrou foi para o nome do líder.
  return `${larguras}
    <thead>
      <tr>
        <th class="ap-col-equipe">Equipe / Líder</th>
        ${colunas}
        <th class="ap-col-num">S/ apontar</th>
        <th class="ap-col-num">Último</th>
      </tr>
    </thead>`;
}

function desenharLinha(equipe, dias, dataRef) {
  const celulas = dias.map((d, i) => {
    const celula = equipe.grade[i] || { estado: "x", dia: d.iso };
    const foco = d.iso === dataRef ? " ap-col-foco" : "";
    const futuro = d.futuro ? " ap-col-futuro" : "";
    return `<td class="${(foco + futuro).trim()}">
        <div class="ap-celula ${classeCelula(celula)}" title="${escapar(textoCelula(celula))}">${simboloCelula(celula)}</div>
      </td>`;
  }).join("");

  // "via 820AZ": o líder apontou, mas sob outro código de equipe. É o sintoma
  // de [LÍDER] vs NOME_DO_LIDER aparecendo na tela em vez de virar um falso
  // "parado há 40 dias".
  const via = equipe.viaEquipe
    ? `<span class="ap-equipe__via" title="Boletim lançado sob o código ${escapar(equipe.viaEquipe)}">via ${escapar(equipe.viaEquipe)}</span>`
    : "";

  const parada = equipe.estado === "nunca" ? "—" : equipe.diasUteisParado;
  const ultimo = equipe.ultimo ? dataBR(equipe.ultimo) : "nunca";

  return `<tr class="ap-linha">
      <td class="ap-linha__equipe">
        <div class="ap-equipe">
          <span class="ap-equipe__codigo">${escapar(equipe.equipe)}</span>
          <span class="ap-equipe__lider" title="${escapar(equipe.lider)}">${escapar(primeiroEUltimo(equipe.lider))}</span>
          ${via}
        </div>
      </td>
      ${celulas}
      <td class="ap-num ap-num--${equipe.estado}">${parada}</td>
      <td class="ap-ultimo${(equipe.diasParado ?? 999) >= DIAS_ULTIMO_ANTIGO ? " ap-ultimo--antigo" : ""}">${ultimo}</td>
    </tr>`;
}

// Assinatura da ESTRUTURA da matriz: quais equipes, em que ordem, com que
// grade. Os números do placar ficam de fora — é justamente o que muda entre
// uma consulta e outra. Mesmo motivo do frota-lideres.js: remontar a tabela a
// cada 5 min reinicia a animação de entrada e engasga a vista à toa.
function assinaturaDe(equipes, dias) {
  return `${dias.map((d) => d.iso).join(",")}|` + equipes
    .map((e) => `${e.equipe}:${e.estado}:${e.ultimo || "-"}:${e.grade.map((c) => c.estado).join("")}`)
    .join("|");
}

let assinaturaAtual = null;
let dadosAtuais = null;
let grupos = [];      // um por coordenador, já na ordem de exibição
let grupoAtual = 0;
let pdGrupoAtual = 0; // a vista Pendências alterna no ritmo dela, independente

// Quebra as equipes por coordenador, preservando a ordem de urgência que veio
// do servidor dentro de cada grupo.
//
// A ordem dos GRUPOS é alfabética, e não a do banco, para a tela não trocar de
// primeiro coordenador quando o cadastro mudar. Hoje ela dá "FABIO BRUM
// CAMPELO" antes de "TONIEL RODRIGUES", que é a ordem pedida — e continua
// determinística se um terceiro coordenador entrar.
function montarGrupos(equipes) {
  const porCoordenador = new Map();
  for (const equipe of equipes) {
    const nome = equipe.coordenador || "Sem coordenador";
    if (!porCoordenador.has(nome)) porCoordenador.set(nome, []);
    porCoordenador.get(nome).push(equipe);
  }

  return [...porCoordenador]
    .sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))
    .map(([coordenador, doGrupo]) => {
      // O placar passa a ser o do coordenador na tela: o número global não
      // ajuda quem está olhando a lista de um deles.
      const resumo = { total: doGrupo.length, ok: 0, atencao: 0, critico: 0, nunca: 0 };
      for (const e of doGrupo) resumo[e.estado]++;
      resumo.aderencia = resumo.total ? Math.round((resumo.ok / resumo.total) * 100) : 0;
      return { coordenador, equipes: doGrupo, resumo };
    });
}

// Bolinhas indicando qual coordenador está no ar — sem elas, quem olha a TV de
// passagem não sabe que existe outro vindo.
function desenharIndicador() {
  const alvo = document.querySelector("#ap-indicador");
  alvo.innerHTML = grupos.length < 2 ? "" : grupos
    .map((_, i) => `<span class="ap-ponto${i === grupoAtual ? " ap-ponto--ativo" : ""}"></span>`)
    .join("");
}

function desenharGrupo() {
  if (!dadosAtuais || !grupos.length) return;
  const { dias, dataRef, mes } = dadosAtuais;
  const grupo = grupos[grupoAtual];
  const { resumo } = grupo;

  document.querySelector("#ap-coordenador").textContent = grupo.coordenador;
  desenharIndicador();

  const aderencia = document.querySelector("#ap-aderencia");
  aderencia.textContent = `${resumo.aderencia}%`;
  aderencia.style.setProperty(
    "--cor-placar",
    resumo.aderencia >= 90 ? "var(--ap-ok)" : resumo.aderencia >= 70 ? "var(--ap-atencao)" : "var(--ap-critico)"
  );
  document.querySelector("#ap-data-ref").textContent = dataBR(dataRef);
  document.querySelector("#ap-subtitulo").textContent =
    `${resumo.total} equipes que apontam diariamente · ${mesPorExtenso(mes)}`;

  const visiveis = grupo.equipes.slice(0, MAX_LINHAS);
  const restantes = grupo.equipes.length - visiveis.length;
  document.querySelector("#ap-restantes").textContent =
    restantes > 0 ? `+${restantes} equipes em dia fora da lista` : "";

  const alvo = document.querySelector("#ap-matriz");

  if (!visiveis.length) {
    assinaturaAtual = null;
    alvo.innerHTML = `<p class="ap-vazio">Nenhuma equipe com apontamento diário cadastrada.</p>`;
    return;
  }

  // A assinatura leva o coordenador junto: sem ele, trocar de grupo com a
  // mesma quantidade de equipes poderia bater a comparação e a tabela não
  // seria remontada.
  const assinatura = `${grupo.coordenador}|${assinaturaDe(visiveis, dias)}`;
  if (assinatura === assinaturaAtual) return;
  assinaturaAtual = assinatura;

  const corpo = visiveis.map((equipe) => desenharLinha(equipe, dias, dataRef)).join("");

  alvo.innerHTML = `<table class="ap-tabela">
      ${desenharCabecalho(dias, dataRef)}
      <tbody>${corpo}</tbody>
    </table>`;
}

// ===== Vista Pendências =====
// Segunda tela do mesmo endpoint: o semáforo em números e, para cada equipe
// fora do prazo, POR QUE ela está fora. Vive neste módulo de propósito — duas
// telas do mesmo dado, uma consulta só; dois módulos com dois timers de 5 min
// mostrariam números de instantes diferentes lado a lado na rotação.

const SELO = { atencao: "Atenção", critico: "Crítico", nunca: "Sem apontar" };

// O motivo define a COR DO CARD inteiro, não só a da faixa: equipe com folga
// registrada sai do vermelho e vai para o azul (decisão do Lucas). As cores
// são as mesmas da matriz — azul folga, laranja sem atividade, cinza não
// aplica —, então quem viu um F azul lá reconhece o card aqui.
//
// Com motivo registrado, o selo passa a ser o MOTIVO (FOLGA, FÉRIAS...) no
// lugar de CRÍTICO/ATENÇÃO: no card azul o alarme contradizia a cor, e ler
// "CRÍTICO" numa equipe de folga registrada mandava cobrar quem não devia.
// A cobrança não sumiu — ela é o número grande, que continua sendo os dias
// úteis cobrados (o 700AK segue com 12 apesar da folga). CRÍTICO/ATENÇÃO
// continuam no selo de quem não tem justificativa nenhuma, que é o alarme
// de verdade.
function faixaDeMotivo(equipe) {
  const evento = equipe.evento || equipe.ultimoEvento?.evento || "";
  const e = evento.trim().toUpperCase();

  // Sem evento: o card fica na cor do estado (vermelho/âmbar), que é o alarme.
  if (!evento) {
    return { classe: "pd-motivo--sem", cardClasse: "", texto: "Sem justificativa", extra: "nenhum evento registrado" };
  }

  // Férias escritas no MOTIVO mandam mais que o evento lançado. O 820AD vinha
  // como "SEM ATIVIDADE · ferias" e lia como equipe parada sem explicação —
  // mas férias é justificativa, então a faixa passa a dizer FÉRIAS, em azul,
  // como qualquer outra folga registrada. O número grande de dias cobrados
  // continua o mesmo: a folga explica, não zera a cobrança.
  const motivo = equipe.evento ? equipe.motivo : equipe.ultimoEvento?.motivo;
  const ferias = /F[ÉE]RIAS/.test(`${e} ${String(motivo || "").toUpperCase()}`);
  if (ferias) {
    const comum = { classe: "pd-motivo--folga", cardClasse: "pd-card--folga", selo: "Férias" };
    return equipe.evento
      ? { ...comum, texto: "Férias", extra: "na data de referência" }
      : { ...comum, texto: `Férias até ${dataBR(equipe.ultimoEvento.dia)}`, extra: "" };
  }

  const tom = e === "SEM ATIVIDADE" ? "parada" : e === "NÃO APLICA" ? "neutro" : "folga";
  // Selo do card ganha a palavra do evento (Folga, Atestado, Viagem...) só nos
  // tons de folga: no card azul, o "CRÍTICO" sozinho contradizia a cor. Nos
  // tons parada/neutro a faixa laranja/cinza já diz o que é, e repetir "SEM
  // ATIVIDADE" no selo estouraria a linha do topo.
  const selo = tom === "folga" ? e.split(/\s+/)[0] : "";
  const comum = { classe: `pd-motivo--${tom}`, cardClasse: `pd-card--${tom}`, selo };

  // Evento na própria data de referência: está acontecendo agora, então o
  // motivo dele é o que interessa. Evento mais antigo vira "até <dia>".
  if (equipe.evento) {
    return { ...comum, texto: evento, extra: equipe.motivo || "na data de referência" };
  }
  return { ...comum, texto: `${evento} até ${dataBR(equipe.ultimoEvento.dia)}`, extra: "" };
}

// A justificativa em três pares rótulo/valor, não em frases.
//
// Antes eram cinco linhas de prosa e ficou pesado demais para uma TV: numa
// tela que passa em segundos, ninguém lê "Desde então: 2 dia(s) útil(eis) sem
// boletim e sem evento · 14 com evento registrado". Rotulado, o olho pula
// direto para o valor. Saiu também a linha "Última atividade": era a mais
// longa (nomes de serviço com 60 caracteres) e a que menos ajuda a decidir se
// alguém precisa cobrar aquela equipe.
function justificativaDe(equipe) {
  const { uteisSemApontar, justificados, domingos } = equipe.desdeUltimo || {};
  const linhas = [];

  // Último boletim: quando foi e há quanto tempo.
  const via = equipe.viaEquipe
    ? ` <span class="pd-alerta">via ${escapar(equipe.viaEquipe)}</span>`
    : "";
  linhas.push(["Último", equipe.ultimo
    ? `<b>${dataBR(equipe.ultimo)}</b> · há ${equipe.diasParado} dia${equipe.diasParado === 1 ? "" : "s"}${via}`
    : "<b>nunca apontou</b>"]);

  // O motivo saiu daqui: virou a faixa colorida acima (ver faixaDeMotivo).

  // A conta fechando: os dias corridos abertos nos três baldes.
  if (equipe.ultimo) {
    const partes = [`<b>${uteisSemApontar}</b> cobrados`];
    if (justificados) partes.push(`${justificados} com evento`);
    if (domingos) partes.push(`${domingos} domingo${domingos === 1 ? "" : "s"}`);
    linhas.push([`${equipe.diasParado} dias`, partes.join(" · ")]);
  }

  return linhas;
}

// Bolinhas do coordenador no ar, iguais às da matriz (ver desenharIndicador).
function desenharIndicadorPendencias() {
  const alvo = document.querySelector("#pd-indicador");
  alvo.innerHTML = grupos.length < 2 ? "" : grupos
    .map((_, i) => `<span class="ap-ponto${i === pdGrupoAtual ? " ap-ponto--ativo" : ""}"></span>`)
    .join("");
}

function desenharPendencias() {
  if (!dadosAtuais || !grupos.length) return;
  const { dataRef, mes } = dadosAtuais;

  // Um coordenador de cada vez, como a matriz: o placar, o semáforo e os cards
  // são todos do grupo no ar. Ver montarGrupos() para a ordem.
  const grupo = grupos[pdGrupoAtual];
  const { resumo, equipes } = grupo;

  document.querySelector("#pd-coordenador").textContent = grupo.coordenador;
  desenharIndicadorPendencias();

  const aderencia = document.querySelector("#pd-aderencia");
  aderencia.textContent = `${resumo.aderencia}%`;
  aderencia.style.setProperty(
    "--cor-placar",
    resumo.aderencia >= 90 ? "var(--ap-ok)" : resumo.aderencia >= 70 ? "var(--ap-atencao)" : "var(--ap-critico)"
  );
  document.querySelector("#pd-data-ref").textContent = dataBR(dataRef);
  document.querySelector("#pd-subtitulo").textContent =
    `${resumo.total} equipes que apontam diariamente · ${mesPorExtenso(mes)}`;

  const kpis = document.querySelector("#vista-pendencias .ap-kpis");
  aplicarNumeros(kpis, "[data-pd-kpi]", [resumo.ok, resumo.atencao, resumo.critico, resumo.nunca]);

  // Já vem ordenada por urgência do servidor; aqui só tira quem está em dia.
  const pendentes = equipes.filter((e) => e.estado !== "ok");
  const alvo = document.querySelector("#pd-cards");
  document.querySelector("#pd-nota").textContent =
    pendentes.length ? `${pendentes.length} de ${resumo.total} equipes fora do prazo` : "";

  if (!pendentes.length) {
    alvo.innerHTML = `<div class="pd-tudo-certo">
        <div class="pd-tudo-certo__icone">✓</div>
        <div class="pd-tudo-certo__texto">Todas as equipes em dia</div>
        <div class="pd-tudo-certo__nota">Nenhuma pendência de apontamento em ${dataBR(dataRef)}.</div>
      </div>`;
    return;
  }

  alvo.innerHTML = pendentes.map((equipe, i) => {
    const motivo = faixaDeMotivo(equipe);
    return `
    <div class="painel pd-card pd-card--${equipe.estado} ${motivo.cardClasse} anima-surgir" style="--ordem: ${i};">
      <div>
        <div class="pd-card__topo">
          <span class="pd-card__codigo">${escapar(equipe.equipe)}</span>
          <span class="pd-card__lider" title="${escapar(equipe.lider)}">${escapar(primeiroEUltimo(equipe.lider))}</span>
          <span class="pd-card__selo">${escapar(
            motivo.selo || SELO[equipe.estado] || equipe.estado
          )}</span>
        </div>
        <div class="pd-card__sub">
          ${escapar(primeiroEUltimo(equipe.coordenador) || "sem coordenador")}
          ${equipe.atividade ? ` · ${escapar(equipe.atividade.toLowerCase())}` : ""}
        </div>
      </div>

      <div class="pd-card__conta">
        <span class="pd-card__numero">${equipe.diasUteisParado}</span>
        <span class="pd-card__unidade">dias úteis<br>sem apontar</span>
      </div>

      <div class="pd-motivo ${motivo.classe}">
        <span class="pd-motivo__texto">${escapar(motivo.texto)}</span>
        ${motivo.extra ? `<span class="pd-motivo__extra">${escapar(motivo.extra.toLowerCase())}</span>` : ""}
      </div>

      <div class="pd-card__linhas">
        ${justificativaDe(equipe).map(([rotulo, valor]) =>
          `<span class="pd-rotulo">${rotulo}</span><span class="pd-valor">${valor}</span>`).join("")}
      </div>
    </div>`;
  }).join("");
}

// ===== Rolagem automática =====
// Numa TV ninguém rola a lista. Quando as equipes do coordenador não cabem na
// altura da tela, a matriz desce sozinha até o fim durante a fatia dele.
let rolagemRaf = null;
let rolagemTimer = null;
let trocaTimer = null;
let pdTrocaTimer = null;
let vistaVisivel = false;
let pendenciasVisivel = false;
let temDados = false;

function pararRolagem() {
  cancelAnimationFrame(rolagemRaf);
  clearTimeout(rolagemTimer);
  rolagemRaf = null;
  rolagemTimer = null;
}

// Anima o scrollTop na mão em vez de scrollTo({ behavior: "smooth" }): o
// navegador escolhe a duração do scroll suave (algumas centenas de ms), o que
// daria um tranco em vez do deslocamento lento e legível que a tela precisa.
// É uma escrita de propriedade por quadro — o mesmo que uma rolagem comum faz.
function animarRolagem(alvo, destino, duracaoMs) {
  const inicio = alvo.scrollTop;
  const distancia = destino - inicio;
  const t0 = performance.now();
  const passo = (agora) => {
    const fracao = Math.min(1, (agora - t0) / duracaoMs);
    alvo.scrollTop = inicio + distancia * fracao; // linear: pan constante lê melhor que ease
    if (fracao < 1) rolagemRaf = requestAnimationFrame(passo);
  };
  rolagemRaf = requestAnimationFrame(passo);
}

// Recebe o alvo porque as duas vistas usam a mesma rolagem: a matriz de uma e
// a grade de cards da outra.
function iniciarRolagem(alvo, fatiaMs) {
  pararRolagem();
  alvo.scrollTop = 0;

  // Coube inteiro: não há o que rolar. É o caso da TV em 1080p hoje — a
  // rolagem só entra em tela mais baixa, ou quando o cadastro crescer.
  const excesso = alvo.scrollHeight - alvo.clientHeight;
  if (excesso <= 2) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  rolagemTimer = setTimeout(
    () => animarRolagem(alvo, excesso, fatiaMs * FRACAO_ROLAGEM),
    fatiaMs * FRACAO_PAUSA_TOPO
  );
}

// Quanto tempo cada coordenador fica no ar: a rotação da vista dividida entre
// eles. Com a rotação desligada (0) a vista fica indefinidamente no ar, então
// vale o mínimo em vez de dividir zero.
function fatiaDoGrupo() {
  const rotacaoMs = segundosRotacao() * 1000;
  const quantos = Math.max(1, grupos.length);
  return Math.max(SLOT_MINIMO_MS, rotacaoMs > 0 ? rotacaoMs / quantos : SLOT_MINIMO_MS);
}

// Troca o coordenador com um fade, como a alternância do donut na Frotas.
function alternarGrupo(aoTerminar) {
  if (grupos.length < 2) return aoTerminar?.();
  const alvo = document.querySelector("#ap-matriz");
  alvo.classList.add("ap-matriz--trocando");
  setTimeout(() => {
    grupoAtual = (grupoAtual + 1) % grupos.length;
    desenharGrupo();
    alvo.classList.remove("ap-matriz--trocando");
    aoTerminar?.();
  }, DURACAO_FADE_MS);
}

// Um ciclo por coordenador: rola a lista dele e, no fim da fatia, passa para o
// próximo e recomeça. Com um coordenador só, a lista volta ao topo e rola de
// novo em vez de ficar parada no fim.
function cicloDoGrupo() {
  clearTimeout(trocaTimer);
  const fatia = fatiaDoGrupo();
  iniciarRolagem(document.querySelector("#ap-matriz"), fatia);
  trocaTimer = setTimeout(() => alternarGrupo(cicloDoGrupo), fatia);
}

// Pendências também alterna coordenador: a fatia é a mesma da matriz, e a
// rolagem dos cards cabe dentro dela.
function rolarPendencias(fatiaMs) {
  const alvo = document.querySelector("#pd-cards");

  // Centraliza na vertical só quando tudo cabe. Mede sem a classe, senão a
  // medida sairia influenciada pelo centramento da passagem anterior.
  // (Em CSS isto seria `align-content: safe center`, que o Chromium da TV
  // ignora — ver o comentário em .pd-cards--centrado no index.html.)
  alvo.classList.remove("pd-cards--centrado");
  alvo.classList.toggle("pd-cards--centrado", alvo.scrollHeight - alvo.clientHeight <= 2);

  iniciarRolagem(alvo, fatiaMs);
}

// Troca o coordenador da vista Pendências com o mesmo fade da matriz.
function alternarGrupoPendencias(aoTerminar) {
  if (grupos.length < 2) return aoTerminar?.();
  const alvo = document.querySelector("#pd-cards");
  alvo.classList.add("pd-cards--trocando");
  setTimeout(() => {
    pdGrupoAtual = (pdGrupoAtual + 1) % grupos.length;
    desenharPendencias();
    alvo.classList.remove("pd-cards--trocando");
    aoTerminar?.();
  }, DURACAO_FADE_MS);
}

function cicloPendencias() {
  clearTimeout(pdTrocaTimer);
  const fatia = fatiaDoGrupo();
  rolarPendencias(fatia);
  pdTrocaTimer = setTimeout(() => alternarGrupoPendencias(cicloPendencias), fatia);
}

async function atualizar() {
  try {
    const dados = await consultarApontamento();
    mostrarAviso("");
    dadosAtuais = dados;
    grupos = montarGrupos(dados.equipes);
    // Uma atualização de dados não pode empurrar quem está na tela para outro
    // coordenador: só corrige o índice se o grupo tiver sumido do cadastro.
    if (grupoAtual >= grupos.length) grupoAtual = 0;
    if (pdGrupoAtual >= grupos.length) pdGrupoAtual = 0;
    desenharGrupo();
    desenharPendencias();

    // Abrir direto no #apontamento faz a vista nascer ativa, e o aoEntrar roda
    // ANTES desta primeira resposta chegar — com a matriz ainda vazia, a
    // medida de transbordo dava zero e a rolagem nunca era agendada. Reinicia
    // o ciclo no primeiro desenho com dados; nas atualizações seguintes, não,
    // para não cortar uma rolagem em andamento a cada 5 min.
    const primeiroDesenho = !temDados;
    temDados = true;
    if (primeiroDesenho && vistaVisivel) cicloDoGrupo();
    if (primeiroDesenho && pendenciasVisivel) cicloPendencias();
  } catch (erro) {
    mostrarAviso(typeof erro === "string" ? erro : "Erro ao carregar o apontamento das equipes.");
  }
}

atualizar();
setInterval(atualizar, INTERVALO_ATUALIZACAO_MS);

// A alternância e a rolagem só rodam com a vista no ar: escondida, ninguém
// veria a troca e elas só roubariam quadros da vista que está sendo exibida. O
// fetch continua, para os dados não estarem velhos na volta.
//
// Ao entrar, volta ao PRIMEIRO coordenador (diferente do holofote, que retoma
// de onde parou): são só dois, cabem os dois numa passagem de 30s, e quem
// chega na tela deve ver sempre a mesma ordem.
observarVista("vista-apontamento", {
  aoEntrar() {
    vistaVisivel = true;
    grupoAtual = 0;
    desenharGrupo();
    cicloDoGrupo();
  },
  aoSair() {
    vistaVisivel = false;
    clearTimeout(trocaTimer);
    trocaTimer = null;
    pararRolagem();
  },
});

// Pendências alterna coordenador igual à Apontamento: a fatia da rotação
// dividida entre eles, e volta ao primeiro a cada entrada — quem chega na tela
// vê sempre a mesma ordem.
observarVista("vista-pendencias", {
  aoEntrar() {
    pendenciasVisivel = true;
    pdGrupoAtual = 0;
    desenharPendencias();
    cicloPendencias();
  },
  aoSair() {
    pendenciasVisivel = false;
    clearTimeout(pdTrocaTimer);
    pdTrocaTimer = null;
    pararRolagem();
  },
});
