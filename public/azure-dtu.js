// Vista "Azure SQL / DTU": quanto do limite de DTU do banco está em uso e o
// histórico da última hora. Dados de /api/azure-dtu (sys.dm_db_resource_stats,
// ver server.js) — o mesmo número que o portal Azure mostra em "DTU percentage".
//
// Acima do limite (90 %) o banco começa a enfileirar consultas e as outras
// vistas ficam lentas, por isso há um alarme: faixa vermelha e bipe repetido
// enquanto durar. A atualização roda em segundo plano para o alarme valer mesmo
// quando a rotação da TV está mostrando outra página.

import { agendar, obterParte, esquecer, mudou } from "./agenda.js";

const INTERVALO_ATUALIZACAO_MS = 30 * 1000;
const REPETE_BIPE_MS = 30 * 1000;   // de quanto em quanto tempo o alarme volta a tocar
const FOLGA_REARME = 5;              // só sai do alarme abaixo de limite - 5 (evita oscilar em 90)
const PLANO = "S2 · 50 DTUs";

const FORMATO_PCT = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
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
