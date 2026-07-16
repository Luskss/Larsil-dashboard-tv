// Página Serviços Railway: nome, endereço e se está online ou com erro.
// Dados vêm de /api/railway-status (API GraphQL do Railway, um Project Token
// por serviço — ver RAILWAY_SERVICOS no .env).

import { escapar } from "./escape.js";

const INTERVALO_ATUALIZACAO_MS = 5 * 60 * 1000; // mesmo ritmo das outras páginas

function mostrarAviso(mensagem) {
  const aviso = document.querySelector("#railway-aviso");
  aviso.textContent = mensagem || "";
  aviso.classList.toggle("railway-aviso--visivel", Boolean(mensagem));
}

const FORMATO_DATA = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
});

function proximaExecucaoTexto(c) {
  if (!c.proximaExecucao) return "sem agendamento";
  return `próxima ${FORMATO_DATA.format(new Date(c.proximaExecucao))}`;
}

// estado: "online" | "erro" (serviço fora do ar) | "token" (token inválido/
// não preenchido). Cada um tem cor e rótulo próprios para não confundir
// problema de configuração com serviço fora do ar.
const ROTULO_ESTADO = { online: "Online", erro: "Erro", token: "Token" };

function estadoDe(s) {
  return s.estado || (s.online ? "online" : "erro");
}

function linhaServico(s, i) {
  const estado = estadoDe(s);
  return `
    <div class="servico-linha servico-linha--${estado} anima-surgir" style="--ordem: ${i};">
      <span class="servico-linha__bolinha"></span>
      <div class="servico-linha__info">
        <div class="servico-linha__nome">${escapar(s.nome)}</div>
        <div class="servico-linha__endereco">${estado === "token" ? "Verifique o token na tela de Gestão" : escapar(s.endereco || "—")}</div>
      </div>
      <div class="servico-linha__status">${ROTULO_ESTADO[estado]}</div>
    </div>
  `;
}

// Pill de cron: nome + próxima execução, com cor pela última execução
// (verde = SUCCESS, vermelho = falhou). O ponto à esquerda repete a cor.
function pillCron(c, i) {
  const estado = estadoDe(c);
  const classe = estado === "online" ? "ok" : estado; // "ok" | "erro" | "token"
  return `
    <div class="cron-pill cron-pill--${classe} anima-surgir" style="--ordem: ${i};">
      <span class="cron-pill__bolinha"></span>
      <span class="cron-pill__nome">${escapar(c.servico)}</span>
      <span class="cron-pill__prox">${estado === "token" ? "verifique o token" : proximaExecucaoTexto(c)}</span>
    </div>
  `;
}

function desenhar(itens) {
  // Cron é qualquer serviço com agendamento; o resto vai na lista principal.
  const crons = itens.filter((s) => s.cron);
  const servicos = itens.filter((s) => !s.cron);

  document.querySelector("#railway-cards").innerHTML =
    servicos.map(linhaServico).join("") || `<div class="servico-linha"><div class="servico-linha__info"><div class="servico-linha__endereco">Nenhum serviço.</div></div></div>`;

  const secaoCrons = document.querySelector("#railway-crons");
  if (crons.length === 0) {
    secaoCrons.hidden = true;
    return;
  }
  secaoCrons.hidden = false;
  document.querySelector("#railway-crons-lista").innerHTML = crons.map(pillCron).join("");
}

async function atualizar() {
  try {
    const resp = await fetch("/api/railway-status");
    const dados = await resp.json();
    if (!resp.ok) throw dados.erro || "Erro ao carregar o status dos serviços.";

    mostrarAviso("");
    desenhar(dados.servicos);
  } catch (erro) {
    mostrarAviso(typeof erro === "string" ? erro : "Erro ao carregar o status dos serviços.");
  }
}

atualizar();
setInterval(atualizar, INTERVALO_ATUALIZACAO_MS);
