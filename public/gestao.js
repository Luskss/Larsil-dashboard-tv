// Lógica da tela de Gestão. Ficava inline em gestao.html, foi extraída para um
// arquivo próprio para o CSP poder usar `script-src 'self'` (sem 'unsafe-inline').

import { PAGINAS, carregarConfigPaginas, salvarConfigPaginas, ordenarPaginas } from "./paginacao.js";
import { getConfig, setConfig, listarRailwayTokens, salvarRailwayTokens } from "./downdetector.js";
import { escapar } from "./escape.js";

// Sem montarPaginacao(): esta página fica sempre fora da navegação/transição
// (paginacao.js trata gestao.html como oculta por padrão).

// ===== Cidade do clima =====
const inputCidade = document.querySelector("#input-cidade");
const statusCidade = document.querySelector("#cidade-status");

getConfig("cidade").then((cidade) => {
  inputCidade.value = cidade || "";
});

document.querySelector("#form-cidade").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  statusCidade.textContent = "Salvando...";
  try {
    await setConfig("cidade", inputCidade.value.trim());
    statusCidade.textContent = "Cidade salva.";
  } catch {
    statusCidade.textContent = "Erro ao salvar a cidade.";
  }
});

// ===== Serviços do Railway =====
// Cada linha guarda { id, rotulo, tokenMascarado, temToken }. O campo de
// token começa vazio (placeholder mostra o mascarado); só é enviado quando
// o usuário digita algo. token: null => manter o já salvo no servidor.
const listaTokens = document.querySelector("#lista-tokens");
const statusTokens = document.querySelector("#tokens-status");
let tokens = [];

function novoId() {
  return (crypto.randomUUID?.() || String(Date.now() + Math.random()));
}

function renderizarTokens() {
  // rotulo e tokenMascarado vêm do que o usuário salvou — escapa antes do HTML.
  listaTokens.innerHTML = tokens.map((t) => `
    <div class="linha-token" data-id="${escapar(t.id)}">
      <input class="token-rotulo" type="text" placeholder="Rótulo (ex.: Dashboard TI)"
             value="${escapar(t.rotulo || "")}">
      <input class="token-valor" type="password" autocomplete="off" spellcheck="false"
             placeholder="${t.temToken ? "Salvo: " + escapar(t.tokenMascarado) + " (deixe em branco p/ manter)" : "Cole o Project Token"}">
      <button type="button" class="btn-remover" title="Remover">✕</button>
    </div>
  `).join("");
}

listarRailwayTokens().then(({ tokens: salvos, usandoEnv }) => {
  tokens = (salvos || []).map((t) => ({ ...t }));
  if (tokens.length === 0) tokens.push({ id: novoId(), rotulo: "", temToken: false });
  renderizarTokens();
  if (usandoEnv) {
    statusTokens.textContent = "Tokens ainda vêm do .env — salve aqui para migrar.";
  }
}).catch(() => {
  statusTokens.textContent = "Erro ao carregar os serviços.";
});

document.querySelector("#btn-add-token").addEventListener("click", () => {
  // Persiste os valores já digitados antes de re-renderizar.
  lerLinhasParaTokens();
  tokens.push({ id: novoId(), rotulo: "", temToken: false });
  renderizarTokens();
});

listaTokens.addEventListener("click", (ev) => {
  const botao = ev.target.closest(".btn-remover");
  if (!botao) return;
  const id = botao.closest(".linha-token").dataset.id;
  lerLinhasParaTokens();
  tokens = tokens.filter((t) => t.id !== id);
  if (tokens.length === 0) tokens.push({ id: novoId(), rotulo: "", temToken: false });
  renderizarTokens();
});

// Lê o DOM de volta para o array (rótulo sempre; token só se digitado).
function lerLinhasParaTokens() {
  const linhas = listaTokens.querySelectorAll(".linha-token");
  const porId = new Map(tokens.map((t) => [t.id, t]));
  tokens = [...linhas].map((linha) => {
    const id = linha.dataset.id;
    const anterior = porId.get(id) || { id };
    const rotulo = linha.querySelector(".token-rotulo").value.trim();
    const digitado = linha.querySelector(".token-valor").value;
    return {
      ...anterior,
      id,
      rotulo,
      // "" => não mexeu; guardamos só no envio (token: null quando vazio).
      _tokenDigitado: digitado,
    };
  });
}

document.querySelector("#btn-salvar-tokens").addEventListener("click", async () => {
  lerLinhasParaTokens();
  statusTokens.textContent = "Salvando...";
  try {
    const payload = tokens.map((t) => ({
      id: t.id,
      rotulo: t.rotulo,
      token: t._tokenDigitado ? t._tokenDigitado : null,
    }));
    await salvarRailwayTokens(payload);
    // Recarrega para refletir o estado salvo (máscaras atualizadas).
    const { tokens: salvos } = await listarRailwayTokens();
    tokens = (salvos || []).map((t) => ({ ...t }));
    if (tokens.length === 0) tokens.push({ id: novoId(), rotulo: "", temToken: false });
    renderizarTokens();
    statusTokens.textContent = "Serviços salvos.";
  } catch {
    statusTokens.textContent = "Erro ao salvar os serviços.";
  }
});

// ===== Páginas da rotação =====
// Ordem e visibilidade ficam no servidor (/api/paginas), não no localStorage:
// é o que faz a TV seguir o que for configurado daqui.
const lista = document.querySelector("#lista-paginas");
const statusPaginas = document.querySelector("#paginas-status");
let visiveis = new Set();
let ordem = [];

async function salvarPaginas() {
  statusPaginas.textContent = "Salvando...";
  try {
    await salvarConfigPaginas({
      ordem: ordem.map((p) => p.arquivo),
      visiveis: [...visiveis],
    });
    statusPaginas.textContent = "Salvo — a TV acompanha em até 30s.";
  } catch {
    statusPaginas.textContent = "Erro ao salvar as páginas.";
  }
}

function renderizarLista() {
  lista.innerHTML = ordem.map((p) => `
    <label class="item-pagina" draggable="true" data-arquivo="${escapar(p.arquivo)}">
      <span class="item-pagina__alca" draggable="false" title="Arrastar para reordenar">⠿</span>
      <input type="checkbox" data-arquivo="${escapar(p.arquivo)}" ${visiveis.has(p.arquivo) ? "checked" : ""}>
      <span class="item-pagina__rotulo">${escapar(p.rotulo)}</span>
      <span class="item-pagina__arquivo ml-auto">${escapar(p.arquivo)}</span>
    </label>
  `).join("");
}

carregarConfigPaginas().then((config) => {
  ordem = ordenarPaginas(config.ordem);
  // visiveis null = nunca configurado: começa com tudo marcado.
  visiveis = new Set(config.visiveis || PAGINAS.map((p) => p.arquivo));
  renderizarLista();
}).catch(() => {
  statusPaginas.textContent = "Erro ao carregar as páginas.";
});

lista.addEventListener("change", (ev) => {
  const alvo = ev.target;
  if (alvo.dataset.arquivo && alvo.type === "checkbox") {
    if (alvo.checked) visiveis.add(alvo.dataset.arquivo);
    else visiveis.delete(alvo.dataset.arquivo);
    salvarPaginas();
  }
});

// Reordenação por drag-and-drop das linhas.
let arquivoArrastado = null;

lista.addEventListener("dragstart", (ev) => {
  const item = ev.target.closest(".item-pagina");
  if (!item) return;
  arquivoArrastado = item.dataset.arquivo;
  item.classList.add("item-pagina--arrastando");
  ev.dataTransfer.effectAllowed = "move";
});

lista.addEventListener("dragend", (ev) => {
  const item = ev.target.closest(".item-pagina");
  if (item) item.classList.remove("item-pagina--arrastando");
  lista.querySelectorAll(".item-pagina--sobre").forEach((el) => el.classList.remove("item-pagina--sobre"));
  arquivoArrastado = null;
});

lista.addEventListener("dragover", (ev) => {
  ev.preventDefault();
  const item = ev.target.closest(".item-pagina");
  lista.querySelectorAll(".item-pagina--sobre").forEach((el) => el.classList.remove("item-pagina--sobre"));
  if (item && item.dataset.arquivo !== arquivoArrastado) item.classList.add("item-pagina--sobre");
});

lista.addEventListener("drop", (ev) => {
  ev.preventDefault();
  const item = ev.target.closest(".item-pagina");
  if (!item || !arquivoArrastado || item.dataset.arquivo === arquivoArrastado) return;

  const origem = ordem.findIndex((p) => p.arquivo === arquivoArrastado);
  const destino = ordem.findIndex((p) => p.arquivo === item.dataset.arquivo);
  if (origem === -1 || destino === -1) return;

  const [pagina] = ordem.splice(origem, 1);
  ordem.splice(destino, 0, pagina);

  salvarPaginas();
  renderizarLista();
});
