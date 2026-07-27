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

// Serializa o ciclo INTEIRO de ler-modificar-gravar, não só a gravação: como o
// Express atende requisições concorrentes, dois POSTs simultâneos liam o mesmo
// estado antigo e o segundo sobrescrevia a alteração do primeiro (salvar a
// cidade e a ordem das páginas junto perdia uma das duas). Com a fila em volta
// do ciclo todo, o segundo só lê depois que o primeiro já gravou.
//
// `mudar` recebe o objeto lido e o altera no lugar.
let fila = Promise.resolve();
async function atualizar(mudar) {
  // O segundo argumento faz a fila seguir mesmo se a tarefa anterior falhar —
  // senão um erro de disco travaria todas as gravações seguintes.
  fila = fila.then(tarefa, tarefa);
  return fila;

  async function tarefa() {
    const dados = await ler();
    mudar(dados);
    await mkdir(dirname(DATA_FILE), { recursive: true });
    await writeFile(DATA_FILE, JSON.stringify(dados, null, 2), "utf8");
  }
}

export async function listarServicos() {
  return (await ler()).servicos;
}

export async function salvarServicos(servicos) {
  await atualizar((dados) => {
    dados.servicos = Array.isArray(servicos) ? servicos : [];
  });
}

export async function getConfig(chave) {
  return (await ler()).config[chave] ?? null;
}

export async function setConfig(chave, valor) {
  await atualizar((dados) => {
    dados.config[chave] = valor;
  });
}

// ===== Tokens do Railway =====
// Cada item é { id, rotulo, token } — um serviço/projeto monitorado.
// O id serve para editar/remover uma linha específica pela UI sem depender
// do rótulo (que pode repetir ou ser renomeado).
export async function listarRailway() {
  return (await ler()).railway;
}

export async function salvarRailway(itens) {
  await atualizar((dados) => {
    dados.railway = Array.isArray(itens) ? itens : [];
  });
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
  await atualizar((dados) => {
    dados.paginas = { ordem, visiveis };
  });
}
