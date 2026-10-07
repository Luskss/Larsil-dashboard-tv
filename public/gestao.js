// Lógica da tela de Gestão. Ficava inline em gestao.html, foi extraída para um
// arquivo próprio para o CSP poder usar `script-src 'self'` (sem 'unsafe-inline').

import {
  PAGINAS,
  carregarConfigPaginas,
  salvarConfigPaginas,
  ordenarPaginas,
  carregarManutencao,
  salvarManutencao,
} from "./paginacao.js";
import {
  getConfig,
  setConfig,
  listarRailwayTokens,
  salvarRailwayTokens,
  listarStatusExterno,
  salvarStatusExterno,
} from "./downdetector.js";
import { escapar } from "./escape.js";

// Sem montarPaginacao(): esta página fica sempre fora da navegação/transição
// (paginacao.js trata gestao.html como oculta por padrão).

// ===== Manutenção =====
// Diferente do resto da tela, aqui NÃO salvamos a cada clique: tirar o
// dashboard do ar é destrutivo demais para acontecer no meio de uma marcação
// (marcar três telas salvaria três estados intermediários, cada um visível na
// TV por até 30s). O botão Salvar aplica tudo de uma vez.
const cardManutencao = document.querySelector("#card-manutencao");
const corpoManutencao = document.querySelector("#manutencao-corpo");
const btnMinimizarManutencao = document.querySelector("#btn-minimizar-manutencao");
const chaveGlobal = document.querySelector("#manutencao-global");
const campoMensagem = document.querySelector("#manutencao-mensagem");
const campoRetorno = document.querySelector("#manutencao-retorno");
const listaManutencao = document.querySelector("#lista-manutencao");
const statusManutencao = document.querySelector("#manutencao-status");
let paginasEmManutencao = new Set();

function renderizarManutencao() {
  cardManutencao.classList.toggle("card-cfg--ativo", chaveGlobal.checked);
  // Aqui a ordem é a do código (PAGINAS), e não a da rotação: esta lista é
  // para achar uma tela pelo nome, não para configurar sequência.
  listaManutencao.innerHTML = PAGINAS.map((p) => {
    const fora = paginasEmManutencao.has(p.arquivo);
    return `
      <label class="item-pagina ${fora ? "item-pagina--fora" : ""}" data-arquivo="${escapar(p.arquivo)}">
        <input type="checkbox" data-arquivo="${escapar(p.arquivo)}" ${fora ? "checked" : ""}>
        <span class="item-pagina__rotulo">${escapar(p.rotulo)}</span>
        <span class="item-pagina__arquivo ml-auto">${fora ? "fora do ar" : ""}</span>
      </label>
    `;
  }).join("");
}

// Minimizado é só conveniência de exibição para quem já configurou e quer a
// tela mais curta — guardado por navegador, não pelo servidor, e por isso não
// afeta a TV nem quem abre a página em outro PC.
const CHAVE_MINIMIZADO = "gestao.manutencao.minimizado";

function aplicarMinimizado(minimizado) {
  cardManutencao.classList.toggle("card-cfg--minimizado", minimizado);
  corpoManutencao.hidden = minimizado;
  btnMinimizarManutencao.setAttribute("aria-expanded", String(!minimizado));
  btnMinimizarManutencao.title = minimizado ? "Expandir" : "Minimizar";
}

try {
  aplicarMinimizado(localStorage.getItem(CHAVE_MINIMIZADO) === "1");
} catch {
  // Sem localStorage (janela privada, etc.): fica expandido, que é o padrão seguro.
}

btnMinimizarManutencao.addEventListener("click", () => {
  const minimizado = !cardManutencao.classList.contains("card-cfg--minimizado");
  aplicarMinimizado(minimizado);
  try {
    localStorage.setItem(CHAVE_MINIMIZADO, minimizado ? "1" : "0");
  } catch {
    // Preferência não persiste, mas o toggle desta sessão continua funcionando.
  }
});

const btnSalvarManutencao = document.querySelector("#btn-salvar-manutencao");

carregarManutencao().then((manutencao) => {
  // Igual à lista de páginas: null é falha de carregamento, não "nada
  // configurado". Mostrar tudo desligado aqui faria quem clicasse em Salvar
  // religar o dashboard sem saber que ele estava em manutenção.
  if (!manutencao) throw new Error("Não foi possível carregar a manutenção");
  chaveGlobal.checked = manutencao.global;
  campoMensagem.value = manutencao.mensagem;
  campoRetorno.value = manutencao.retorno;
  paginasEmManutencao = new Set(manutencao.paginas);
  renderizarManutencao();
}).catch(() => {
  // Trava o Salvar: sem saber o estado atual, o formulário está mostrando
  // tudo desligado — e salvar isso religaria um dashboard que talvez esteja
  // em manutenção de propósito. Quem quiser mexer, recarrega a página.
  btnSalvarManutencao.disabled = true;
  chaveGlobal.disabled = true;
  statusManutencao.textContent = "Erro ao carregar a manutenção — recarregue a página.";
});

chaveGlobal.addEventListener("change", () => {
  cardManutencao.classList.toggle("card-cfg--ativo", chaveGlobal.checked);
  statusManutencao.textContent = "Alterações não salvas.";
});

for (const campo of [campoMensagem, campoRetorno]) {
  campo.addEventListener("input", () => {
    statusManutencao.textContent = "Alterações não salvas.";
  });
}

listaManutencao.addEventListener("change", (ev) => {
  const alvo = ev.target;
  if (!alvo.dataset.arquivo || alvo.type !== "checkbox") return;
  if (alvo.checked) paginasEmManutencao.add(alvo.dataset.arquivo);
  else paginasEmManutencao.delete(alvo.dataset.arquivo);
  // Só a linha clicada muda de aparência, em vez de re-renderizar a lista:
  // refazer o innerHTML aqui trocaria o checkbox que acabou de receber o
  // clique por um novo, e quem estivesse navegando pelo teclado perderia o
  // foco a cada marcação.
  const linha = alvo.closest(".item-pagina");
  linha.classList.toggle("item-pagina--fora", alvo.checked);
  linha.querySelector(".item-pagina__arquivo").textContent = alvo.checked ? "fora do ar" : "";
  statusManutencao.textContent = "Alterações não salvas.";
});

btnSalvarManutencao.addEventListener("click", async () => {
  statusManutencao.textContent = "Salvando...";
  try {
    await salvarManutencao({
      global: chaveGlobal.checked,
      mensagem: campoMensagem.value.trim(),
      retorno: campoRetorno.value.trim(),
      paginas: [...paginasEmManutencao],
    });
    statusManutencao.textContent = chaveGlobal.checked
      ? "Dashboard fora do ar — a TV acompanha em até 30s."
      : paginasEmManutencao.size > 0
        ? `${paginasEmManutencao.size} tela(s) fora do ar — a TV acompanha em até 30s.`
        : "Dashboard no ar.";
  } catch {
    statusManutencao.textContent = "Erro ao salvar a manutenção.";
  }
});

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

// ===== Serviços da tela "Status Externo" =====
// Lista inteira editável: { id, nome, tipo, url, site, componentes[], logo }.
// Como não há segredo aqui (ao contrário dos tokens), tudo vai e volta junto.
const listaStatus = document.querySelector("#lista-status");
const statusStatusExterno = document.querySelector("#status-externo-status");
let servicosStatus = [];

const TIPOS_STATUS = [
  ["statuspage", "Statuspage (summary.json)"],
  ["instatus", "Instatus (página)"],
  ["rss", "RSS (feed)"],
];

// A logo é lida no navegador e vai junto no JSON como data URI — mesmo formato
// das logos de /api/servicos. 1 MB é o teto do servidor (LOGO_MAX lá).
const LOGO_MAX_ARQUIVO = 1_000_000;

function servicoVazio() {
  return { id: novoId(), nome: "", tipo: "statuspage", url: "", site: "", componentes: [], logo: null };
}

// Iniciais para o quadrado da logo enquanto não há imagem (ex.: "Claude Code"
// vira "CC"), só para a linha não ficar com um buraco cinza.
function iniciais(nome) {
  const palavras = String(nome || "").trim().split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return "logo";
  return palavras.slice(0, 2).map((p) => p[0].toUpperCase()).join("");
}

function renderizarStatusExterno() {
  // Tudo que aparece aqui foi digitado por alguém — escapa antes do HTML.
  listaStatus.innerHTML = servicosStatus.map((s) => `
    <div class="linha-status" data-id="${escapar(s.id)}">
      <label class="status-logo" title="Escolher logo">
        ${s.logo
          ? `<img src="${escapar(s.logo)}" alt="">
             <button type="button" class="status-logo__limpar" title="Remover logo">✕</button>`
          : `<span class="status-logo__vazio">${escapar(iniciais(s.nome))}</span>`}
        <input type="file" class="status-logo-input" accept="image/png,image/jpeg,image/gif,image/webp">
      </label>
      <input class="status-nome" type="text" placeholder="Nome (ex.: Claude Code)"
             value="${escapar(s.nome || "")}">
      <select class="status-tipo">
        ${TIPOS_STATUS.map(([valor, rotulo]) =>
          `<option value="${valor}" ${s.tipo === valor ? "selected" : ""}>${escapar(rotulo)}</option>`
        ).join("")}
      </select>
      <button type="button" class="btn-remover" title="Remover">✕</button>
      <input class="status-url" type="url" placeholder="https://status.exemplo.com/api/v2/summary.json"
             value="${escapar(s.url || "")}">
      <input class="status-componentes" type="text"
             placeholder="Componentes, separados por vírgula (em branco = status geral)"
             value="${escapar((s.componentes || []).join(", "))}">
    </div>
  `).join("");
}

// Lê o DOM de volta para o array. A logo não está no DOM como valor editável
// (vive só no array), então é preservada pelo id.
function lerLinhasParaStatus() {
  const porId = new Map(servicosStatus.map((s) => [s.id, s]));
  servicosStatus = [...listaStatus.querySelectorAll(".linha-status")].map((linha) => {
    const id = linha.dataset.id;
    const anterior = porId.get(id) || {};
    return {
      ...anterior,
      id,
      nome: linha.querySelector(".status-nome").value.trim(),
      tipo: linha.querySelector(".status-tipo").value,
      url: linha.querySelector(".status-url").value.trim(),
      componentes: linha.querySelector(".status-componentes").value
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
    };
  });
}

function carregarStatusExterno() {
  return listarStatusExterno().then(({ servicos, usandoPadrao }) => {
    servicosStatus = (servicos || []).map((s) => ({ ...s, componentes: s.componentes || [] }));
    if (servicosStatus.length === 0) servicosStatus.push(servicoVazio());
    renderizarStatusExterno();
    if (usandoPadrao) {
      statusStatusExterno.textContent = "Mostrando a lista padrão — salve para personalizar.";
    }
  }).catch(() => {
    statusStatusExterno.textContent = "Erro ao carregar os serviços.";
  });
}

carregarStatusExterno();

document.querySelector("#btn-add-status").addEventListener("click", () => {
  lerLinhasParaStatus();
  servicosStatus.push(servicoVazio());
  renderizarStatusExterno();
  statusStatusExterno.textContent = "Alterações não salvas.";
});

listaStatus.addEventListener("click", (ev) => {
  const linha = ev.target.closest(".linha-status");
  if (!linha) return;

  if (ev.target.closest(".status-logo__limpar")) {
    // Dentro de um <label>: sem isto o clique abriria o seletor de arquivo que
    // acabamos de esvaziar.
    ev.preventDefault();
    lerLinhasParaStatus();
    const servico = servicosStatus.find((s) => s.id === linha.dataset.id);
    if (servico) servico.logo = null;
    renderizarStatusExterno();
    statusStatusExterno.textContent = "Alterações não salvas.";
    return;
  }

  if (ev.target.closest(".btn-remover")) {
    lerLinhasParaStatus();
    servicosStatus = servicosStatus.filter((s) => s.id !== linha.dataset.id);
    if (servicosStatus.length === 0) servicosStatus.push(servicoVazio());
    renderizarStatusExterno();
    statusStatusExterno.textContent = "Alterações não salvas.";
  }
});

listaStatus.addEventListener("input", () => {
  statusStatusExterno.textContent = "Alterações não salvas.";
});

listaStatus.addEventListener("change", (ev) => {
  const input = ev.target.closest(".status-logo-input");
  if (!input) return;
  const arquivo = input.files?.[0];
  if (!arquivo) return;

  if (arquivo.size > LOGO_MAX_ARQUIVO) {
    statusStatusExterno.textContent = "Logo grande demais (máx. 1 MB).";
    input.value = "";
    return;
  }

  const id = input.closest(".linha-status").dataset.id;
  const leitor = new FileReader();
  leitor.onload = () => {
    // Preserva o que está digitado nas outras linhas antes de re-renderizar.
    lerLinhasParaStatus();
    const servico = servicosStatus.find((s) => s.id === id);
    if (servico) servico.logo = String(leitor.result);
    renderizarStatusExterno();
    statusStatusExterno.textContent = "Alterações não salvas.";
  };
  leitor.onerror = () => {
    statusStatusExterno.textContent = "Erro ao ler a imagem.";
  };
  leitor.readAsDataURL(arquivo);
});

document.querySelector("#btn-salvar-status").addEventListener("click", async () => {
  lerLinhasParaStatus();
  // O servidor descarta linha sem nome ou sem url; avisar aqui evita a surpresa
  // de salvar e ver a linha sumir sem explicação.
  const incompletas = servicosStatus.filter((s) => !s.nome || !s.url).length;
  statusStatusExterno.textContent = "Salvando...";
  try {
    await salvarStatusExterno(servicosStatus);
    await carregarStatusExterno();
    statusStatusExterno.textContent = incompletas > 0
      ? `Salvo — ${incompletas} linha(s) sem nome ou endereço foram descartadas.`
      : "Serviços salvos — a tela atualiza em até 5 min.";
  } catch {
    statusStatusExterno.textContent = "Erro ao salvar os serviços.";
  }
});

// Salvar uma lista vazia faz o servidor voltar a usar STATUS_EXTERNO_PADRAO.
document.querySelector("#btn-restaurar-status").addEventListener("click", async () => {
  if (!confirm("Restaurar a lista padrão? Os serviços e logos configurados aqui serão perdidos.")) return;
  statusStatusExterno.textContent = "Restaurando...";
  try {
    await salvarStatusExterno([]);
    await carregarStatusExterno();
    statusStatusExterno.textContent = "Lista padrão restaurada.";
  } catch {
    statusStatusExterno.textContent = "Erro ao restaurar a lista.";
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
  // Aqui o null (falha ao carregar) precisa virar erro na tela: a lista é o
  // que será SALVO de volta, e mostrar os padrões como se fossem a
  // configuração atual faria quem clicasse em Salvar sobrescrever o que está
  // no servidor sem saber.
  if (!config) throw new Error("Não foi possível carregar as páginas");
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
