import { getConfig, consultarClima } from "./downdetector.js";
import { montarPaginacao } from "./paginacao.js";

// O dashboard inteiro se atualiza neste ritmo (hoje só o clima é dinâmico;
// widgets futuros devem se pendurar no mesmo intervalo).
const INTERVALO_ATUALIZACAO_MS = 5 * 60 * 1000; // 5 minutos

// ===== Relógio =====
function iniciarRelogio() {
  const el = document.querySelector("#relogio");

  function tick() {
    const agora = new Date();
    
    // Força o JavaScript a formatar em Brasília
    const horaBrasilia = agora.toLocaleTimeString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });

    el.textContent = horaBrasilia;
  }
  tick();
  setInterval(tick, 1000);
}

// ===== Saudação (muda ao longo do dia) =====
function saudacaoPorHora(hora) {
  if (hora < 6) return "Tenha uma Boa Madrugada!";
  if (hora < 12) return "Tenha um Bom Dia!";
  if (hora < 18) return "Tenha uma Boa Tarde!";
  return "Tenha uma Boa Noite!";
}

function iniciarSaudacao() {
  const el = document.querySelector("#saudacao");
  let ultimaFaixa = null;

  function tick() {
    const hora = new Date().getHours();
    const faixa = saudacaoPorHora(hora);
    if (faixa !== ultimaFaixa) {
      ultimaFaixa = faixa;
      el.textContent = faixa;
    }
  }
  tick();
  setInterval(tick, 60 * 1000); // só precisa checar a cada minuto
}

// ===== Tiles (grid único do dashboard) =====
// O grid contém widgets reais (relógio etc., com data-bloco = nº de células
// que ocupam) e placeholders. Aqui deixamos as células quadradas (altura da
// fileira = largura da coluna) e completamos a tela com placeholders.
function renderTiles() {
  const tilesEl = document.querySelector("#tiles");

  function preencher() {
    // Vista oculta (SPA): as medidas viriam zeradas. O resize disparado por
    // paginacao.js na troca de vista chama de novo quando ela aparecer.
    if (!tilesEl.offsetParent) return;

    // Remove só os placeholders; os widgets reais ficam.
    tilesEl.querySelectorAll(".tile--vazio").forEach((t) => t.remove());

    // Tile de medição para descobrir a largura real de uma coluna.
    const medidor = document.createElement("div");
    medidor.className = "tile tile--vazio";
    tilesEl.appendChild(medidor);

    const estilo = getComputedStyle(tilesEl);
    const colunas = estilo.gridTemplateColumns.split(" ").filter(Boolean).length || 1;
    const gap = parseFloat(estilo.rowGap) || 16;
    const larguraCelula = medidor.offsetWidth || 90;
    medidor.remove();

    // Espaço útil entre o topo da grade e o fim da janela. A reserva
    // embaixo é o padding real do body (guarda o lugar das bolinhas de
    // navegação, ver paginacao.js) + o padding do container da página.
    const topo = tilesEl.getBoundingClientRect().top;
    const reserva =
      (parseFloat(getComputedStyle(document.body).paddingBottom) || 0) +
      (parseFloat(getComputedStyle(tilesEl.parentElement).paddingBottom) || 0);
    const disponivel = window.innerHeight - topo - reserva;

    // Célula sempre quadrada: a altura da fileira é a largura da coluna.
    const alturaCelula = Math.max(40, larguraCelula);
    tilesEl.style.gridAutoRows = `${alturaCelula}px`;

    // Quantas fileiras quadradas cabem na altura disponível. O layout fixo
    // ocupa as fileiras 1-6 (relógio 1-3, clima 4-6), então garantimos no
    // mínimo 6 para não cortar o clima; acima disso preenchemos o que sobrar
    // com fileiras de placeholders.
    const cabem = Math.floor((disponivel + gap) / (alturaCelula + gap));
    const fileiras = Math.max(6, cabem);

    // Desconta as células já ocupadas pelos widgets reais (data-bloco).
    let ocupadas = 0;
    tilesEl.querySelectorAll("[data-bloco]").forEach((w) => {
      ocupadas += parseInt(w.dataset.bloco, 10) || 1;
    });

    const quantidade = Math.max(0, colunas * fileiras - ocupadas);
    // Entrada em cascata: o % 12 recicla os atrasos para a onda não demorar
    // demais quando há muitos placeholders (+2 deixa os widgets na frente).
    tilesEl.insertAdjacentHTML(
      "beforeend",
      Array.from({ length: quantidade })
        .map((_, i) => `<div class="tile tile--vazio anima-surgir" style="--ordem: ${2 + (i % 12)};"></div>`)
        .join("")
    );
  }

  preencher();

  // Reajusta ao redimensionar a janela (mantém a tela sempre preenchida).
  window.addEventListener("resize", preencher);
}

// ===== Clima (Open-Meteo, cidade configurável) =====
// Ícone simples por faixa de weather_code do Open-Meteo (sol / nuvem / chuva).
function iconeClima(codigo) {
  const sol = `<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>`;
  const nuvem = `<path d="M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.6 1.5A4 4 0 0 0 6.5 19z"/>`;
  const chuva = `<path d="M17.5 15a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.6 1.5A4 4 0 0 0 6.5 15z"/><path d="M8 19v2M12 19v2M16 19v2"/>`;
  let corpo = sol;
  if (codigo >= 51) corpo = chuva; // chuvisco/chuva/neve/tempestade
  else if (codigo >= 1) corpo = nuvem; // parcialmente nublado a nublado
  return `<svg class="clima__icone" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${corpo}</svg>`;
}

const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

// Descrição curta por faixa de weather_code do Open-Meteo.
function descricaoClima(codigo) {
  if (codigo === 0) return "Céu limpo";
  if (codigo <= 2) return "Parcialmente nublado";
  if (codigo === 3) return "Nublado";
  if (codigo <= 48) return "Neblina";
  if (codigo <= 57) return "Chuvisco";
  if (codigo <= 67) return "Chuva";
  if (codigo <= 77) return "Neve";
  if (codigo <= 82) return "Pancadas de chuva";
  if (codigo <= 86) return "Pancadas de neve";
  return "Tempestade";
}

// Zera o widget mostrando só a mensagem (sem cidade / erro de consulta).
function estadoClima(mensagem) {
  document.querySelector("#clima-temp").textContent = "--°";
  document.querySelector("#clima-cond").textContent = mensagem;
  for (const id of ["sensacao", "umidade", "vento"]) {
    document.querySelector(`#clima-${id}`).textContent = "—";
  }
  document.querySelector("#clima-semana").innerHTML = "";
}

// ===== Fase da lua (cálculo local, sem API) =====
// Fração do ciclo = dias desde uma lua nova de referência (06/01/2000 18:14
// UTC) módulo o mês sinódico (~29,53 dias). A iluminação vem do cosseno da
// fração (0 = nova, 0,5 = cheia).
const MES_SINODICO = 29.530588853;

function faseDaLua(data = new Date()) {
  const refLuaNova = Date.UTC(2000, 0, 6, 18, 14) / 86400000;
  let fase = ((data.getTime() / 86400000 - refLuaNova) % MES_SINODICO) / MES_SINODICO;
  if (fase < 0) fase += 1;
  const iluminacao = (1 - Math.cos(2 * Math.PI * fase)) / 2;
  let nome = "Lua minguante";
  if (fase < 0.02 || fase > 0.98) nome = "Lua nova";
  else if (fase < 0.23) nome = "Lua crescente";
  else if (fase < 0.27) nome = "Quarto crescente";
  else if (fase < 0.48) nome = "Crescente gibosa";
  else if (fase < 0.52) nome = "Lua cheia";
  else if (fase < 0.73) nome = "Minguante gibosa";
  else if (fase < 0.77) nome = "Quarto minguante";
  return { iluminacao, crescente: fase < 0.5, nome };
}

function atualizarLua() {
  const { iluminacao, crescente, nome } = faseDaLua();
  // O disco claro desliza para o lado, revelando o fundo escuro na fração
  // não iluminada (crescente ilumina pela direita; minguante, pela esquerda).
  const desloc = Math.round((1 - iluminacao) * 100);
  document.querySelector(".clima-lua__luz").style.transform =
    `translateX(${crescente ? desloc : -desloc}%)`;
  document.querySelector(".clima-lua__nome").textContent = nome;
  document.querySelector(".clima-lua__pct").textContent =
    `${Math.round(iluminacao * 100)}% iluminada`;
}

async function atualizarClima() {
  const cidade = await getConfig("cidade");
  if (!cidade || !cidade.trim()) return estadoClima("Configure sua cidade");

  try {
    const clima = await consultarClima(cidade);
    document.querySelector("#clima-temp").textContent = `${Math.round(clima.temperatura)}°`;
    document.querySelector("#clima-cond").textContent = descricaoClima(clima.codigo);
    document.querySelector("#clima-sensacao").textContent = `${Math.round(clima.sensacao)}°`;
    document.querySelector("#clima-umidade").textContent = `${Math.round(clima.umidade)}%`;
    document.querySelector("#clima-vento").textContent = `${Math.round(clima.vento)} km/h`;

    document.querySelector("#clima-semana").innerHTML = (clima.diario || [])
      .map((dia, i) => {
        const nome = i === 0 ? "Hoje" : DIAS_SEMANA[new Date(`${dia.data}T12:00:00`).getDay()];
        return `<div class="clima-dia anima-surgir" style="--ordem: ${i};">
          <div class="clima-dia__nome">${nome}</div>
          ${iconeClima(dia.codigo)}
          <div class="clima-dia__temps">${Math.round(dia.maxima)}° <small>${Math.round(dia.minima)}°</small></div>
        </div>`;
      })
      .join("");
  } catch (erro) {
    estadoClima(String(erro));
  }
}

window.addEventListener("DOMContentLoaded", () => {
  montarPaginacao();

  iniciarRelogio();
  iniciarSaudacao();
  renderTiles();
  atualizarClima();
  atualizarLua();
  setInterval(atualizarClima, INTERVALO_ATUALIZACAO_MS);
  setInterval(atualizarLua, INTERVALO_ATUALIZACAO_MS);

  document.querySelector("#atualizar-btn").addEventListener("click", atualizarClima);
});
