// Camada de dados do front-end: fala com a API do próprio servidor (server.js).
//
// Mantém a mesma interface exportada da versão Tauri/estática, então
// main.js e configuracoes.js não precisam mudar. Só o transporte mudou:
// antes era invoke()/localStorage; agora é fetch para /api/*.

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

export async function consultarStatus(slug) {
  const { status } = await pedir(`/api/status/${encodeURIComponent(slug)}`);
  return status;
}

export async function consultarFrota() {
  return pedir("/api/frota");
}

export async function consultarFrotaLocalizacao() {
  return pedir("/api/frota-localizacao");
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
