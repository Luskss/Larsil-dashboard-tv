import { listarServicos, salvarServicos, extrairSlug, getConfig, setConfig } from "./downdetector.js";
import { montarPaginacao } from "./paginacao.js";

const lista = document.querySelector("#lista-servicos");
const template = document.querySelector("#template-servico");

// Limite de segurança para o tamanho da logo (base64 fica ~33% maior que o arquivo).
const TAMANHO_MAX_LOGO = 1024 * 1024; // 1 MB

function lerArquivoComoDataURI(arquivo) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(arquivo);
  });
}

function adicionarLinha(servico = { nome: "", slug: "", logo: null }) {
  const item = template.content.firstElementChild.cloneNode(true);
  const nomeInput = item.querySelector('[data-campo="nome"]');
  const slugInput = item.querySelector('[data-campo="slug"]');
  const fileInput = item.querySelector('[data-campo="logo"]');
  const preview = item.querySelector("[data-preview]");
  const removerLogoBtn = item.querySelector("[data-remover-logo]");

  nomeInput.value = servico.nome;
  slugInput.value = servico.slug;

  // A logo (data URI) é guardada no próprio item via dataset para leitura no salvar.
  function definirLogo(dataUri) {
    if (dataUri) {
      item.dataset.logo = dataUri;
      preview.src = dataUri;
      preview.classList.remove("hidden");
      removerLogoBtn.classList.remove("hidden");
    } else {
      delete item.dataset.logo;
      preview.src = "";
      preview.classList.add("hidden");
      removerLogoBtn.classList.add("hidden");
    }
  }

  definirLogo(servico.logo || null);

  fileInput.addEventListener("change", async () => {
    const arquivo = fileInput.files[0];
    if (!arquivo) return;
    if (arquivo.size > TAMANHO_MAX_LOGO) {
      alert("Imagem muito grande. Use uma logo de até 1 MB.");
      fileInput.value = "";
      return;
    }
    definirLogo(await lerArquivoComoDataURI(arquivo));
  });

  removerLogoBtn.addEventListener("click", () => {
    fileInput.value = "";
    definirLogo(null);
  });

  item.querySelector("[data-remover]").addEventListener("click", () => item.remove());
  lista.appendChild(item);
}

function lerFormulario() {
  const servicos = [];
  lista.querySelectorAll(".servico-item").forEach((item) => {
    const nome = item.querySelector('[data-campo="nome"]').value.trim();
    const slugBruto = item.querySelector('[data-campo="slug"]').value.trim();
    if (!nome || !slugBruto) return;
    servicos.push({
      nome,
      slug: extrairSlug(slugBruto),
      logo: item.dataset.logo || null,
    });
  });
  return servicos;
}

window.addEventListener("DOMContentLoaded", async () => {
  montarPaginacao();

  const cidadeInput = document.querySelector("#cidade-input");
  const cidadeSalva = await getConfig("cidade");
  if (cidadeSalva) cidadeInput.value = cidadeSalva;

  const servicos = await listarServicos();
  if (servicos.length === 0) {
    adicionarLinha();
  } else {
    servicos.forEach((servico) => adicionarLinha(servico));
  }

  document.querySelector("#adicionar-btn").addEventListener("click", () => adicionarLinha());

  document.querySelector("#form-servicos").addEventListener("submit", async (e) => {
    e.preventDefault();
    await setConfig("cidade", cidadeInput.value.trim());
    await salvarServicos(lerFormulario());
    const msg = document.querySelector("#salvo-msg");
    msg.classList.remove("hidden");
    setTimeout(() => msg.classList.add("hidden"), 2000);
  });
});
