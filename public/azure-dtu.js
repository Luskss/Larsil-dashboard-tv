// Vista "Azure SQL / DTU": quanto do limite de DTU do banco está em uso e o
// histórico da última hora. Dados de /api/azure-dtu (sys.dm_db_resource_stats,
// ver server.js) — o mesmo número que o portal Azure mostra em "DTU percentage".
//
// Acima do limite (90 %) o banco começa a enfileirar consultas e as outras
// vistas ficam lentas, por isso há um alarme: faixa vermelha e bipe repetido
// enquanto durar. A atualização roda em segundo plano para o alarme valer mesmo
// quando a rotação da TV está mostrando outra página.

import { escapar } from "./escape.js";
import { agendar, obterParte, esquecer, mudou } from "./agenda.js";

const INTERVALO_ATUALIZACAO_MS = 30 * 1000;
const REPETE_BIPE_MS = 30 * 1000;   // de quanto em quanto tempo o alarme volta a tocar
const FOLGA_REARME = 5;              // só sai do alarme abaixo de limite - 5 (evita oscilar em 90)
const PLANO = "S2 · 50 DTUs";

const FORMATO_PCT = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const FORMATO_INTEIRO = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const FORMATO_HORA = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

const $ = (seletor) => document.querySelector(seletor);
const pct = (n) => (n == null ? "—" : `${FORMATO_PCT.format(n)}%`);

let ultimoDados = null;
let emAlarme = false;
let ultimoBipe = 0;

// ===== Som =====
// Ligado/desligado é escolhido na tela de Gestão e vem junto de cada resposta
// do servidor (`somLigado`), então vale para todas as telas, não só este navegador.
let somLigado = true;
let audioCtx = null;

// Navegadores só liberam áudio depois de um gesto do usuário. Criar o contexto
// no primeiro clique/tecla é o que deixa os bipes seguintes tocarem sozinhos.
function liberarAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch { /* sem Web Audio: o alarme segue só visual */ }
}

function audioPronto() {
  return Boolean(audioCtx) && audioCtx.state === "running";
}

// Três pulsos agudos alternados: diferente do sino de "novo chamado" do helpdesk
// (um tom só), para ninguém confundir os dois de longe.
function bipar() {
  if (!somLigado || !audioPronto()) return;
  try {
    const t0 = audioCtx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = audioCtx.createOscillator();
      const ganho = audioCtx.createGain();
      const inicio = t0 + i * 0.28;
      osc.type = "square";
      osc.frequency.setValueAtTime(i % 2 === 0 ? 988 : 1319, inicio);
      ganho.gain.setValueAtTime(0.001, inicio);
      ganho.gain.exponentialRampToValueAtTime(0.12, inicio + 0.02);
      ganho.gain.exponentialRampToValueAtTime(0.001, inicio + 0.22);
      osc.connect(ganho).connect(audioCtx.destination);
      osc.start(inicio);
      osc.stop(inicio + 0.24);
    }
  } catch { /* som indisponível — segue sem bipe */ }
}

// ===== Toast =====
// Mesmo aviso do "novo chamado" do helpdesk (canto inferior direito, por cima de
// qualquer tela): na rotação da TV a faixa vermelha só aparece na vista DTU, e o
// toast é o que avisa quem está olhando outra página.
const TOAST_MS = 8 * 1000;
let toastTimer = null;

function mostrarToast(dados) {
  const toast = $("#toast-dtu");
  $("#toast-dtu-texto").textContent = `Azure SQL: DTU em ${pct(dados.atual)} (limite ${dados.limite}%)`;
  toast.classList.add("toast-novos--visivel");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("toast-novos--visivel"), TOAST_MS);
}

// Qualquer clique/toque/tecla na página libera o áudio — na TV basta uma
// interação, em qualquer aba, para o alarme poder tocar depois.
function liberarNoPrimeiroGesto() {
  liberarAudio();
  if (audioPronto()) {
    for (const ev of ["pointerdown", "keydown"]) document.removeEventListener(ev, liberarNoPrimeiroGesto);
    pintarAlarme();
  }
}
for (const ev of ["pointerdown", "keydown"]) document.addEventListener(ev, liberarNoPrimeiroGesto);

// ===== Alarme =====
function pintarAlarme() {
  const faixa = $("#dtu-alarme");
  faixa.classList.toggle("dtu-alarme--visivel", emAlarme);
  if (!emAlarme || !ultimoDados) return;

  $("#dtu-alarme-texto").textContent =
    `DTU em ${pct(ultimoDados.atual)} — acima de ${ultimoDados.limite}%`;
  $("#dtu-alarme-dica").textContent = !somLigado
    ? "Som desligado na Gestão"
    : audioPronto() ? "" : "Clique na tela para liberar o som do alarme";
}

// Chamado a cada atualização, com a vista visível ou não.
function avaliarAlarme(dados) {
  const atual = dados.atual;
  if (atual == null) return;

  if (!emAlarme && atual >= dados.limite) {
    emAlarme = true;
    ultimoBipe = 0; // primeiro bipe na hora
  } else if (emAlarme && atual < dados.limite - FOLGA_REARME) {
    emAlarme = false;
  }

  if (emAlarme && Date.now() - ultimoBipe >= REPETE_BIPE_MS) {
    ultimoBipe = Date.now();
    bipar();
    mostrarToast(dados); // reaparece a cada repetição, junto do bipe
  }
  pintarAlarme();
}

// ===== Cards =====
function classeDe(valor, limite) {
  if (valor == null) return "ok";
  if (valor >= limite) return "critico";
  if (valor >= limite - 20) return "atencao";
  return "ok";
}

function card(rotulo, valor, extra = "") {
  return `
    <div class="dtu-card ${extra}">
      <div class="dtu-card__rotulo">${rotulo}</div>
      <div class="dtu-card__valor">${pct(valor)}</div>
    </div>`;
}

function desenharCards(d) {
  const c = d.componentes || {};
  $("#dtu-cards").innerHTML =
    card("DTU agora", d.atual, `dtu-card--grande dtu-card--${classeDe(d.atual, d.limite)}`) +
    card("Pico (1 h)", d.pico) +
    card("Média (1 h)", d.media) +
    card("CPU", c.cpu) +
    card("Data IO", c.dataIo) +
    card("Log IO", c.logWrite);
}

// ===== Quem / o quê mais pesa =====
// `dtu` é uma estimativa, em DTUs do plano, de quanto cada item respondeu em
// média na janela (a parte dele no recurso em que mais pesa, vezes a utilização
// desse recurso). O recurso (CPU, leitura ou escrita) vai ao lado.
const FORMATO_DTU = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dtus = (n) => (n > 0 && n < 0.05 ? "<0,1" : FORMATO_DTU.format(n));

// Barra proporcional ao maior da lista; vermelha quando o item sozinho responde
// por 10% ou mais da capacidade do plano.
function barra(i, maior, capacidade) {
  const forte = capacidade && i.dtu / capacidade >= 0.1 ? " dtu-item--forte" : "";
  const largura = maior > 0 ? Math.min(Math.max((i.dtu / maior) * 100, 3), 100) : 3;
  return { forte, html: `<div class="dtu-item__barra"><span style="width:${largura}%"></span></div>` };
}

function itemValor(i) {
  return `<span class="dtu-item__pct">${escapar(dtus(i.dtu))} DTU<small>${escapar(i.recurso)}</small></span>`;
}

function itemQuem(i, maior, capacidade) {
  const b = barra(i, maior, capacidade);
  // Máquina sem nome (um container, por exemplo) e programa genérico (node-mssql)
  // não dizem o que ela é: quando o servidor reconhece o sistema pelas tabelas
  // que ela consulta, esse nome vira o título e programa/login/máquina descem.
  const origem = [i.sistema ? i.programa : "", i.login, i.host].filter(Boolean).join(" · ");
  return `
    <div class="dtu-item${b.forte}">
      <div class="dtu-item__linha">
        <span class="dtu-item__nome">${escapar(i.sistema || i.programa || "Programa não informado")}</span>${itemValor(i)}
      </div>
      <div class="dtu-item__sub">${escapar(origem)}</div>${b.html}
    </div>`;
}

// Com sistema reconhecido (ver sistemas-sql.js) o título é o nome dele e o SQL
// vira só a pista da consulta mais pesada; sem sistema, o SQL é tudo que há.
function itemConsulta(i, maior, capacidade) {
  const b = barra(i, maior, capacidade);
  const execs = `${FORMATO_INTEIRO.format(i.execs)} execuções`;
  const detalhe = i.sistema && i.consultas > 1 ? `${FORMATO_INTEIRO.format(i.consultas)} consultas · ${execs}` : execs;
  return `
    <div class="dtu-item${b.forte}">
      <div class="dtu-item__linha">
        <span class="dtu-item__nome">${escapar(i.sistema || "Sistema não identificado")}</span>${itemValor(i)}
      </div>
      <div class="dtu-item__sub">${escapar(detalhe)}</div>${i.sistema ? "" : `<div class="dtu-item__sql">${escapar(i.texto)}</div>`}${b.html}
    </div>`;
}

function lista(itens, desenhar, capacidade) {
  const maior = Math.max(...itens.map((i) => i.dtu), 0);
  return `<div class="dtu-consumo__lista">${itens.map((i) => desenhar(i, maior, capacidade)).join("")}</div>`;
}

function desenharConsumo(d) {
  const cap = d.capacidadeDtu;
  let html = `<div class="dtu-consumo__titulo">Quem mais pesou · última hora</div>`;
  if (d.quem == null) {
    html += `<div class="dtu-consumo__vazio">Indisponível no momento.</div>`;
  } else if (d.quem.length === 0) {
    html += `<div class="dtu-consumo__vazio">Coletando… os dados aparecem em instantes.</div>`;
  } else {
    html += lista(d.quem, itemQuem, cap);
  }

  if (d.consultas && d.consultas.length > 0) {
    html += `<div class="dtu-consumo__titulo">O que mais pesou · sistemas</div>${lista(d.consultas, itemConsulta, cap)}`;
  }

  if (d.quemDesde) {
    html += `<div class="dtu-consumo__nota">DTUs: média estimada na hora (plano de ${cap || 50}). Sessões desde ${FORMATO_HORA.format(new Date(d.quemDesde))}; sistemas: hora atual e anterior.</div>`;
  }
  const painel = $("#dtu-consumo");
  painel.innerHTML = html;
  ajustarConsumo(painel);
}

// O servidor manda mais itens do que cabem numa tela de TV; aqui sobram só os que
// couberem, tirando sempre do fim da lista maior (e deixando ao menos MIN_ITENS
// em cada uma). Painel oculto não tem altura para medir: o ResizeObserver abaixo
// refaz a conta quando a vista entra.
const MIN_ITENS = 3;
function ajustarConsumo(painel) {
  if (painel.clientHeight === 0) return;
  const listas = [...painel.querySelectorAll(".dtu-consumo__lista")];
  while (painel.scrollHeight > painel.clientHeight + 1) {
    const maior = listas
      .filter((l) => l.children.length > MIN_ITENS)
      .sort((a, b) => b.children.length - a.children.length)[0];
    if (!maior) break;
    maior.lastElementChild.remove();
  }
}

// ===== Gráfico (SVG manual, como os outros gráficos do projeto) =====
const MARGEM = { esq: 42, dir: 14, topo: 12, base: 26 };

function desenharGrafico(d) {
  const caixa = $("#dtu-grafico");
  if (!d || d.serie.length < 2) {
    caixa.innerHTML = `<div class="dtu-grafico__titulo">Utilização do banco de dados (última hora)</div>
      <div class="dtu-grafico__vazio">Sem amostras suficientes ainda.</div>`;
    return;
  }

  caixa.innerHTML = `<div class="dtu-grafico__titulo">Utilização do banco de dados · ${PLANO} · última hora</div>
    <div class="dtu-grafico__area" style="flex:1;min-height:0;"></div>`;
  const area = caixa.querySelector(".dtu-grafico__area");
  // Vista oculta: sem tamanho para medir. O ResizeObserver redesenha quando ela entrar.
  const largura = area.clientWidth;
  const altura = area.clientHeight;
  if (largura < 100 || altura < 80) return;

  const x0 = MARGEM.esq, x1 = largura - MARGEM.dir;
  const y0 = altura - MARGEM.base, y1 = MARGEM.topo;
  const t = d.serie.map((p) => new Date(p.em).getTime());
  const tMin = t[0], tMax = t[t.length - 1];
  const px = (ms) => x0 + ((ms - tMin) / (tMax - tMin || 1)) * (x1 - x0);
  const py = (v) => y0 - (Math.min(Math.max(v, 0), 100) / 100) * (y0 - y1);

  let grade = "";
  for (let v = 0; v <= 100; v += 20) {
    grade += `<line class="dtu-grafico__grade" x1="${x0}" x2="${x1}" y1="${py(v)}" y2="${py(v)}"/>
      <text class="dtu-grafico__eixo" x="${x0 - 6}" y="${py(v) + 4}" text-anchor="end">${v}%</text>`;
  }
  // Horas: um marcador a cada 10 min cheios dentro da janela.
  const PASSO = 10 * 60 * 1000;
  for (let ms = Math.ceil(tMin / PASSO) * PASSO; ms <= tMax; ms += PASSO) {
    grade += `<text class="dtu-grafico__eixo" x="${px(ms)}" y="${altura - 8}" text-anchor="middle">${FORMATO_HORA.format(new Date(ms))}</text>`;
  }

  const caminho = d.serie
    .map((p, i) => `${i === 0 ? "M" : "L"}${px(t[i]).toFixed(1)},${py(p.dtu).toFixed(1)}`)
    .join(" ");
  // Só os pontos acima do limite ganham marcador: o resto é a linha.
  const criticos = d.serie
    .map((p, i) => (p.dtu >= d.limite ? `<circle class="dtu-grafico__ponto dtu-grafico__ponto--critico" cx="${px(t[i]).toFixed(1)}" cy="${py(p.dtu).toFixed(1)}" r="3"/>` : ""))
    .join("");

  area.innerHTML = `
    <svg viewBox="0 0 ${largura} ${altura}" width="${largura}" height="${altura}" role="img"
         aria-label="Gráfico de DTU na última hora">
      ${grade}
      <line class="dtu-grafico__limite" x1="${x0}" x2="${x1}" y1="${py(d.limite)}" y2="${py(d.limite)}"/>
      <path class="dtu-grafico__linha" d="${caminho}"/>
      ${criticos}
    </svg>`;
}

new ResizeObserver(() => desenharGrafico(ultimoDados)).observe($("#dtu-grafico"));
new ResizeObserver(() => { if (ultimoDados) desenharConsumo(ultimoDados); }).observe($("#dtu-consumo"));

// ===== Atualização =====
function mostrarAviso(mensagem) {
  const aviso = $("#dtu-aviso");
  aviso.textContent = mensagem || "";
  aviso.classList.toggle("dtu-aviso--visivel", Boolean(mensagem));
}

async function atualizar() {
  try {
    const dados = await obterParte("azure-dtu");
    mostrarAviso("");
    ultimoDados = dados;
    somLigado = dados.somLigado !== false;

    // O alarme avalia TODA resposta (inclusive repetida): o bipe a cada 30 s não
    // depende de o quadro ter mudado.
    avaliarAlarme(dados);

    $("#dtu-rodape").textContent = dados.consultadoEm
      ? `Consultado às ${FORMATO_HORA.format(new Date(dados.consultadoEm))}`
      : "";

    if (mudou("azure-dtu", dados, ["consultadoEm"])) {
      desenharCards(dados);
      desenharConsumo(dados);
      desenharGrafico(dados);
    }
  } catch (erro) {
    // A mesma resposta de antes precisa voltar a ser desenhada na recuperação.
    esquecer("azure-dtu");
    mostrarAviso(typeof erro === "string" ? erro : "Erro ao carregar o uso do Azure SQL.");
  }
}

agendar("azure-dtu", atualizar, {
  intervalo: INTERVALO_ATUALIZACAO_MS,
  vista: "vista-azure-dtu",
  segundoPlano: true,
});
