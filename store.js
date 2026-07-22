// Persistência simples em arquivo JSON.
//
// Guarda { servicos: [...], config: { chave: valor }, railway: [...],
// paginas: { ordem, visiveis } } em DATA_FILE. No Railway, aponte DATA_DIR
// para um volume persistente (ex.: /data), senão o arquivo é recriado a cada
// deploy. Localmente, cai em ./data.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), "data");
const DATA_FILE = join(DATA_DIR, "data.json");

const PADRAO = { servicos: [], config: {}, railway: [], paginas: {} };

async function ler() {
  try {
    return { ...PADRAO, ...JSON.parse(await readFile(DATA_FILE, "utf8")) };
  } catch {
    return { ...PADRAO };
  }
}

// Serializa as escritas: como o Express pode processar requisições
// concorrentes, encadeamos as gravações numa fila para não corromper o JSON.
let fila = Promise.resolve();
async function escrever(dados) {
  fila = fila.then(async () => {
    await mkdir(dirname(DATA_FILE), { recursive: true });
    await writeFile(DATA_FILE, JSON.stringify(dados, null, 2), "utf8");
  });
  return fila;
}

export async function listarServicos() {
  return (await ler()).servicos;
}

export async function salvarServicos(servicos) {
  const dados = await ler();
  dados.servicos = Array.isArray(servicos) ? servicos : [];
  await escrever(dados);
}

export async function getConfig(chave) {
  return (await ler()).config[chave] ?? null;
}

export async function setConfig(chave, valor) {
  const dados = await ler();
  dados.config[chave] = valor;
  await escrever(dados);
}

// ===== Tokens do Railway =====
// Cada item é { id, rotulo, token } — um serviço/projeto monitorado.
// O id serve para editar/remover uma linha específica pela UI sem depender
// do rótulo (que pode repetir ou ser renomeado).
export async function listarRailway() {
  return (await ler()).railway;
}

export async function salvarRailway(itens) {
  const dados = await ler();
  dados.railway = Array.isArray(itens) ? itens : [];
  await escrever(dados);
}

// ===== Páginas do dashboard (ordem e visibilidade da rotação) =====
// `ordem`: nomes de arquivo na sequência escolhida ([] = ordem do código).
// `visiveis`: quais aparecem na barra de bolinhas. O null é significativo e
// diferente de []: null = ninguém configurou ainda (mostra todas), []
// = configurou e desmarcou tudo. Sem essa distinção, uma instalação nova
// abriria sem página nenhuma.
export async function getPaginas() {
  const { paginas } = await ler();
  return {
    ordem: Array.isArray(paginas?.ordem) ? paginas.ordem : [],
    visiveis: Array.isArray(paginas?.visiveis) ? paginas.visiveis : null,
  };
}

export async function salvarPaginas({ ordem, visiveis }) {
  const dados = await ler();
  dados.paginas = { ordem, visiveis };
  await escrever(dados);
}
