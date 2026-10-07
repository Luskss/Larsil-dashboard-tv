// Camada de dados do front-end: fala com a API do próprio servidor (server.js).
//
// Mantém a mesma interface exportada da versão Tauri/estática, então
// main.js e configuracoes.js não precisam mudar. Só o transporte mudou:
// antes era invoke()/localStorage; agora é fetch para /api/*.

import { obterParte } from "./agenda.js";

async function pedir(url, opcoes) {
  const resposta = await fetch(url, opcoes);
  if (!resposta.ok) {
    const corpo = await resposta.json().catch(() => ({}));
    throw corpo.erro || "Falha na requisição";
  }
  return resposta.json();
}

export async function listarServicos() {
  return pedir("/api/servicos");
}

export async function salvarServicos(servicos) {
  return pedir("/api/servicos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ servicos }),
  });
}

export async function getConfig(chave) {
  const { valor } = await pedir(`/api/config/${encodeURIComponent(chave)}`);
  return valor;
}

export async function setConfig(chave, valor) {
  return pedir(`/api/config/${encodeURIComponent(chave)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ valor }),
  });
}

export async function listarRailwayTokens() {
  return pedir("/api/railway-tokens");
}

export async function salvarRailwayTokens(tokens) {
  return pedir("/api/railway-tokens", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tokens }),
  });
}

// ===== Serviços da vista "Status Externo" (tela de Gestão) =====
// Sem segredo envolvido (ao contrário dos tokens do Railway): a lista vai e
// volta inteira, logos em data URI incluídas.
export async function listarStatusExterno() {
  return pedir("/api/status-externo-config");
}

export async function salvarStatusExterno(servicos) {
  return pedir("/api/status-externo-config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ servicos }),
  });
}

export async function consultarStatus(slug) {
  const { status } = await pedir(`/api/status/${encodeURIComponent(slug)}`);
  return status;
}

export async function consultarFrota() {
  return obterParte("frota");
}

export async function consultarFrotaLocalizacao() {
  return obterParte("frota-localizacao");
}

export async function consultarFrotaLideres() {
  return obterParte("frota-lideres");
}

export async function consultarApontamento() {
  return obterParte("apontamento");
}

export async function consultarVeiculosReservas() {
  return obterParte("veiculos-reservas");
}

export async function consultarClima(cidade) {
  return pedir(`/api/clima?cidade=${encodeURIComponent(cidade)}`);
}

export function extrairSlug(valor) {
  const texto = valor.trim();
  const match = texto.match(/fora-do-ar\/([^/?#]+)/i);
  if (match) return match[1];
  return texto.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}
