// Telemetria leve da TV: mede o que o navegador do Fire Stick sente e manda
// um resumo para o log do servidor (POST /api/telemetria), para decidir onde
// otimizar com número na mão. Nada aqui altera a tela.
//
//   lt      travadas longas (>50ms) desde o último envio: quantidade, soma, maior
//   troca   quadros perdidos nos 2s seguintes a cada troca de vista
//           (quadro > 50ms = perdido): quantidade, maior, e em qual vista
//   painel  tempo das requisições a /api/painel: quantidade, média, maior
//   mem     heap JS em MB (só Chromium; Silk tem)
//   vivo    minutos desde que a página abriu
//
// Não roda requestAnimationFrame o tempo todo (isso mesmo custaria bateria e
// quadros): a sonda de quadros só liga por 2s a cada troca de vista.

const ENVIO_MS = 10 * 60 * 1000;
const LIMITE_QUADRO_MS = 50;
const SONDA_MS = 2000;

const zerar = () => ({
  lt: { n: 0, ms: 0, max: 0 },
  troca: { perdidos: 0, max: 0, vista: "" },
  painel: { n: 0, soma: 0, max: 0 },
});
let acc = zerar();

// ===== Travadas longas =====
try {
  new PerformanceObserver((lista) => {
    for (const e of lista.getEntries()) {
      acc.lt.n++;
      acc.lt.ms += e.duration;
      acc.lt.max = Math.max(acc.lt.max, e.duration);
    }
  }).observe({ entryTypes: ["longtask"] });
} catch {
  /* navegador sem Long Tasks API: segue sem esse número */
}

// ===== Tempo do /api/painel =====
try {
  new PerformanceObserver((lista) => {
    for (const e of lista.getEntries()) {
      if (!e.name.includes("/api/painel")) continue;
      acc.painel.n++;
      acc.painel.soma += e.duration;
      acc.painel.max = Math.max(acc.painel.max, e.duration);
    }
  }).observe({ type: "resource", buffered: false });
} catch {
  /* sem Resource Timing observável */
}

// ===== Quadros perdidos na troca de vista =====
let sondando = false;

function sondarQuadros(vista) {
  if (sondando) return;
  sondando = true;
  const inicio = performance.now();
  let anterior = inicio;
  let perdidos = 0;
  let maior = 0;

  const quadro = (agora) => {
    const dt = agora - anterior;
    anterior = agora;
    if (dt > LIMITE_QUADRO_MS) {
      perdidos++;
      maior = Math.max(maior, dt);
    }
    if (agora - inicio < SONDA_MS) {
      requestAnimationFrame(quadro);
      return;
    }
    sondando = false;
    acc.troca.perdidos += perdidos;
    if (maior > acc.troca.max) {
      acc.troca.max = maior;
      acc.troca.vista = vista;
    }
  };
  requestAnimationFrame(quadro);
}

function vistaAtual() {
  return document.querySelector(".vista--ativa")?.id || "";
}

let ultimaVista = vistaAtual();
for (const vista of document.querySelectorAll(".vista")) {
  new MutationObserver(() => {
    const atual = vistaAtual();
    if (atual && atual !== ultimaVista) {
      ultimaVista = atual;
      sondarQuadros(atual);
    }
  }).observe(vista, { attributes: true, attributeFilter: ["class"] });
}

// ===== Envio =====
const arredondar = (n) => Math.round(n);

function enviar() {
  const { lt, troca, painel } = acc;
  acc = zerar();

  const corpo = {
    vivo: arredondar(performance.now() / 60000),
    vista: vistaAtual(),
    lt: { n: lt.n, ms: arredondar(lt.ms), max: arredondar(lt.max) },
    troca: { perdidos: troca.perdidos, max: arredondar(troca.max), vista: troca.vista },
    painel: {
      n: painel.n,
      media: painel.n ? arredondar(painel.soma / painel.n) : 0,
      max: arredondar(painel.max),
    },
  };
  const heap = performance.memory?.usedJSHeapSize;
  if (heap) corpo.mem = arredondar(heap / 1048576);

  fetch("/api/telemetria", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
    keepalive: true,
  }).catch(() => {});
}

setInterval(enviar, ENVIO_MS);
