// Servidor do dashboard: serve os arquivos estáticos de public/ e expõe a API.
//
// Rotas:
//   GET  /api/servicos          -> lista de serviços
//   POST /api/servicos          -> salva a lista (body: { servicos: [...] })
//   GET  /api/config/:chave     -> valor de uma config (ex.: cidade)
//   POST /api/config/:chave     -> salva config (body: { valor })
//   GET  /api/clima?cidade=...   -> clima atual via Open-Meteo
//   GET  /api/dolar              -> dólar (USD-BRL): AwesomeAPI, com PTAX do BC de reserva
//   GET  /api/soja               -> indicador da soja (R$/saca) via CEPEA/ESALQ
//   GET  /api/cafe               -> indicador do café (R$/saca) via CEPEA/ESALQ
//   GET  /api/milho              -> indicador do milho (R$/saca) via CEPEA/ESALQ
//   GET  /api/selic              -> meta Selic do Copom (% a.a.) via SGS/BCB
//   GET  /api/igpm               -> IGP-M acumulado em 12 meses (%) via SGS/BCB
//   GET  /api/status/:slug       -> status do Downdetector via Puppeteer
//   GET  /api/frota              -> resumo da frota (SQL Server, dbo.FROTA)
//   GET  /api/frota-localizacao  -> posição atual da frota por projeto (dbo.TICKET x dbo.FROTA)
//   GET  /api/frota-lideres      -> qtd de veículos por coordenador (dbo.TICKET)
//   GET  /api/ativos-ti          -> contagem de ativos de TI (SQL Server, inventario.ATIVOS)
//   GET  /api/helpdesk-chamados  -> chamados recentes por status (SQL Server, dbo.HELPDESK_CHAMADOS)
//   GET  /api/railway-status     -> status dos serviços configurados no Railway (API GraphQL)

import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import sql from "mssql";
import * as store from "./store.js";
import { validarLogin, iniciarSessao, encerrarSessao, exigirSessao } from "./auth.js";

// Variáveis locais vêm do .env; no Railway vêm do painel (sem arquivo).
try { process.loadEnvFile(); } catch { /* sem .env, segue com o ambiente */ }

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

// ===== Cabeçalhos de segurança (em toda resposta) =====
// CSP: scripts só do próprio site (Tailwind é self-hosted em /vendor, e os
// scripts das páginas são arquivos .js — nenhum <script> inline). style-src
// precisa de 'unsafe-inline' porque o Tailwind Browser injeta <style> em runtime
// e as páginas usam style="..." inline. img-src data: cobre os logos em base64.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

app.use((_req, res, next) => {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // HSTS só faz sentido sob HTTPS (Railway serve por HTTPS em produção).
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

app.use(express.json({ limit: "8mb" })); // logos em base64 podem pesar

// ===== Login (usuário/senha único, ver auth.js) =====
app.post("/login", (req, res) => {
  const { usuario, senha } = req.body || {};
  if (!validarLogin(usuario, senha)) {
    return res.status(401).json({ erro: "Usuário ou senha inválidos" });
  }
  iniciarSessao(res, usuario);
  res.json({ ok: true });
});

app.post("/logout", (_req, res) => {
  encerrarSessao(res);
  res.json({ ok: true });
});

// A partir daqui, tudo exige sessão válida (libera só /login e /login.html).
app.use(exigirSessao);

// ===== Serviços =====
app.get("/api/servicos", async (_req, res) => {
  res.json(await store.listarServicos());
});

app.post("/api/servicos", async (req, res) => {
  await store.salvarServicos(req.body?.servicos ?? []);
  res.json({ ok: true });
});

// ===== Config chave-valor =====
app.get("/api/config/:chave", async (req, res) => {
  let valor = await store.getConfig(req.params.chave);
  // Cidade do clima: se ninguém salvou pela tela de Gestão, vale a do
  // ambiente (CIDADE_CLIMA) — útil no Railway, onde o data.json se perde
  // a cada deploy sem um volume persistente.
  if (!valor && req.params.chave === "cidade") {
    valor = process.env.CIDADE_CLIMA || null;
  }
  res.json({ valor });
});

app.post("/api/config/:chave", async (req, res) => {
  await store.setConfig(req.params.chave, req.body?.valor ?? "");
  res.json({ ok: true });
});

// ===== Consulta a APIs externas (clima, dólar, soja) =====
// Busca com timeout e retry: no Railway o egress para APIs externas às vezes
// falha de forma intermitente (rede/DNS do datacenter). Abortamos por padrão
// em 8s para não pendurar a resposta e tentamos de novo antes de desistir.
// Quem tem plano B (o dólar) usa menos tentativas e timeout menor, para cair
// rápido na outra fonte em vez de deixar a tela esperando.
async function buscarComRetry(url, { tentativas = 3, timeoutMs = 8000, ...opcoes } = {}) {
  let ultimoErro;
  for (let i = 0; i < tentativas; i++) {
    try {
      const resp = await fetch(url, { ...opcoes, signal: AbortSignal.timeout(timeoutMs) });
      if (!resp.ok) throw new Error(`A API respondeu ${resp.status}`);
      return resp;
    } catch (erro) {
      ultimoErro = erro;
      if (i < tentativas - 1) await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw ultimoErro;
}

async function buscarJson(url, opcoes) {
  return (await buscarComRetry(url, opcoes)).json();
}

async function buscarTexto(url, opcoes) {
  return (await buscarComRetry(url, opcoes)).text();
}

// ===== Clima (Open-Meteo: geocoding + forecast) =====
app.get("/api/clima", async (req, res) => {
  const cidade = String(req.query.cidade || "").trim();
  if (!cidade) return res.status(400).json({ erro: "Informe a cidade" });

  try {
    const geoUrl =
      "https://geocoding-api.open-meteo.com/v1/search?count=1&language=pt&name=" +
      encodeURIComponent(cidade);
    const lugar = (await buscarJson(geoUrl)).results?.[0];
    if (!lugar) return res.status(404).json({ erro: "Cidade não encontrada" });

    const climaUrl =
      "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${lugar.latitude}&longitude=${lugar.longitude}` +
      "&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min" +
      "&timezone=auto&forecast_days=7";
    const dados = await buscarJson(climaUrl);
    const atual = dados.current;
    res.json({
      temperatura: atual.temperature_2m,
      sensacao: atual.apparent_temperature,
      umidade: atual.relative_humidity_2m,
      vento: atual.wind_speed_10m,
      codigo: atual.weather_code,
      diario: (dados.daily?.time || []).map((data, i) => ({
        data,
        codigo: dados.daily.weather_code?.[i],
        maxima: dados.daily.temperature_2m_max?.[i],
        minima: dados.daily.temperature_2m_min?.[i],
      })),
    });
  } catch (erro) {
    console.error("Erro ao consultar o clima:", erro.message);
    res.status(502).json({ erro: "Erro ao consultar o clima" });
  }
});

// ===== Dólar (USD -> BRL, duas fontes) =====
// 1ª opção, AwesomeAPI: cotação de mercado do momento, já com a variação do
//    dia. Fica atrás da Cloudflare, que barra IP de datacenter — pode falhar
//    no Railway mesmo funcionando na máquina local (foi o que derrubou o
//    Downdetector, ver o comentário lá embaixo).
// 2ª opção, PTAX do Banco Central: oficial, sem Cloudflare, publicada por
//    volta das 13h de cada dia útil. A variação sai da diferença para o dia
//    útil anterior.
// O widget do dashboard atualiza a cada 5 min, mas várias telas/recarregamentos
// bateriam aqui ao mesmo tempo — o cache curto segura isso sem envelhecer a
// cotação (o mercado de câmbio se move em segundos, não em minutos).
const DOLAR_URL = "https://economia.awesomeapi.com.br/json/last/USD-BRL";
const PTAX_URL =
  "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/" +
  "CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)";
const DOLAR_CACHE_MS = 60 * 1000;
let dolarCache = null; // { dados, em }

async function dolarAwesome() {
  // Uma tentativa só: se a Cloudflare barrar, é melhor cair logo no plano B.
  const cotacao = (await buscarJson(DOLAR_URL, { tentativas: 1, timeoutMs: 5000 })).USDBRL;
  if (!cotacao?.bid) throw new Error("Resposta sem cotação");
  return {
    valor: Number(cotacao.bid),
    // pctChange = variação percentual do dia (negativa quando o dólar cai).
    variacao: Number(cotacao.pctChange),
    maxima: Number(cotacao.high),
    minima: Number(cotacao.low),
    atualizadoEm: cotacao.create_date || null,
    fonte: "AwesomeAPI",
  };
}

// A API do BC espera as datas em MM-DD-AAAA (formato americano).
function dataPtax(data) {
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${mes}-${dia}-${data.getFullYear()}`;
}

async function dolarPtax() {
  // 12 dias para trás garantem dois pregões mesmo com feriado prolongado.
  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - 12 * 24 * 60 * 60 * 1000);
  const url =
    `${PTAX_URL}?@dataInicial='${dataPtax(inicio)}'&@dataFinalCotacao='${dataPtax(hoje)}'` +
    "&$format=json&$select=cotacaoVenda,dataHoraCotacao";

  const linhas = (await buscarJson(url, { tentativas: 2, timeoutMs: 5000 })).value || [];
  if (linhas.length === 0) throw new Error("PTAX sem cotações no período");

  // A lista vem em ordem cronológica: a última é a cotação mais recente.
  const ultima = linhas.at(-1);
  const anterior = linhas.at(-2);
  const valor = Number(ultima.cotacaoVenda);
  if (!Number.isFinite(valor)) throw new Error("PTAX com valor ilegível");

  const base = Number(anterior?.cotacaoVenda);
  return {
    valor,
    variacao: Number.isFinite(base) && base > 0 ? ((valor - base) / base) * 100 : 0,
    maxima: null,
    minima: null,
    atualizadoEm: ultima.dataHoraCotacao || null,
    fonte: "PTAX/BCB",
  };
}

app.get("/api/dolar", async (_req, res) => {
  if (dolarCache && Date.now() - dolarCache.em < DOLAR_CACHE_MS) {
    return res.json(dolarCache.dados);
  }

  const falhas = [];
  for (const fonte of [dolarAwesome, dolarPtax]) {
    try {
      const dados = await fonte();
      dolarCache = { dados, em: Date.now() };
      return res.json(dados);
    } catch (erro) {
      falhas.push(`${fonte.name}: ${erro.message}`);
    }
  }

  // "detalhe" viaja junto para dar para diagnosticar abrindo /api/dolar no
  // navegador, sem precisar do log do Railway (é a mensagem da API externa,
  // não tem nada de sensível).
  const detalhe = falhas.join(" | ");
  console.error("Erro ao consultar o dólar:", detalhe);
  res.status(502).json({ erro: "Erro ao consultar a cotação do dólar", detalhe });
});

// ===== Commodities (indicadores CEPEA/ESALQ) =====
// O CEPEA não tem API pública, mas publica um widget oficial para embutir em
// sites — é dele que saem as cotações (uma tabelinha HTML que a gente lê aqui).
// Cada produto é um id de indicador, trocável pelo .env:
//   soja  -> 12 "Soja - PR" (mercado interno; 92 = "Soja Paranaguá", porto)
//   café  -> 23 "Café Arábica" (24 = "Café Robusta")
//   milho -> 77 "Milho" (indicador ESALQ/BM&FBovespa, Campinas)
// Os indicadores são diários (só dias úteis), por isso o cache longo.
const CEPEA_URL = "https://www.cepea.org.br/br/widgetproduto.js.php?id_indicador[]=";
const CEPEA_CACHE_MS = 30 * 60 * 1000;
// Sem User-Agent de navegador a Cloudflare do CEPEA devolve 403.
const UA_NAVEGADOR =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Linha da tabela do widget: data | produto + unidade | R$ valor.
const LINHA_CEPEA =
  /<td>(\d{2}\/\d{2}\/\d{4})<\/td>\s*<td>\s*<span[^>]*>([^<]+)<\/span>.*?<span class="unidade">([^<]+)<\/span>.*?<td>\s*R\$\s*<span[^>]*>([\d.,]+)<\/span>/s;

const cepeaCache = new Map(); // indicador -> { dados, em }

async function cotacaoCepea(indicador) {
  const salvo = cepeaCache.get(indicador);
  if (salvo && Date.now() - salvo.em < CEPEA_CACHE_MS) return salvo.dados;

  try {
    return await buscarCotacaoCepea(indicador);
  } catch (erro) {
    // A Cloudflare do CEPEA devolve 403 de vez em quando (visto na prática,
    // com a chamada seguinte voltando ao normal). Como o indicador é diário, o
    // último valor bom continua valendo — melhor mostrá-lo do que zerar o
    // card. A tela não mente: a data do pregão vai junto com o valor.
    if (salvo) {
      console.warn(
        `CEPEA ${indicador} falhou (${erro.message}); mantendo a cotação de ${salvo.dados.data}`
      );
      return salvo.dados;
    }
    throw erro;
  }
}

async function buscarCotacaoCepea(indicador) {
  // Duas tentativas: com o valor antigo guardado, não vale a pena insistir
  // muito e deixar a tela esperando.
  const html = await buscarTexto(CEPEA_URL + indicador, {
    headers: { "User-Agent": UA_NAVEGADOR },
    tentativas: 2,
    timeoutMs: 6000,
  });

  const achado = html.match(LINHA_CEPEA);
  if (!achado) throw new Error("Widget do CEPEA veio sem a linha da cotação");
  const [, data, produto, unidade, valor] = achado;

  const dados = {
    // Nomes curtos: o card do dashboard é pequeno (bloco 2x1).
    produto: produto.trim().slice(0, 40),
    unidade: unidade.trim().slice(0, 20),
    // "1.234,56" (pt-BR) -> 1234.56
    valor: Number(valor.replace(/\./g, "").replace(",", ".")),
    data, // dd/mm/aaaa do pregão — o indicador não sai fim de semana
  };
  if (!Number.isFinite(dados.valor)) throw new Error(`Valor ilegível: ${valor}`);

  cepeaCache.set(indicador, { dados, em: Date.now() });
  return dados;
}

// Monta a rota de um produto: id do .env (só dígitos) ou o padrão.
function rotaCepea(variavelEnv, padrao, nome) {
  return async (_req, res) => {
    try {
      const indicador = String(process.env[variavelEnv] || padrao).replace(/\D/g, "") || padrao;
      res.json(await cotacaoCepea(indicador));
    } catch (erro) {
      console.error(`Erro ao consultar ${nome}:`, erro.message);
      // "detalhe" ajuda a diagnosticar abrindo a rota no navegador (mesma
      // ideia do /api/dolar) — é a mensagem da API externa, nada sensível.
      res.status(502).json({
        erro: `Erro ao consultar a cotação (${nome})`,
        detalhe: erro.message,
      });
    }
  };
}

app.get("/api/soja", rotaCepea("SOJA_INDICADOR", "12", "soja"));
app.get("/api/cafe", rotaCepea("CAFE_INDICADOR", "23", "café"));
app.get("/api/milho", rotaCepea("MILHO_INDICADOR", "77", "milho"));

// ===== Selic (meta do Copom — série 432 do SGS/Banco Central) =====
// A meta só muda nas reuniões do Copom (a cada ~45 dias), por isso o cache
// longo. Detalhe da série: ela é diária e o BC já a publica preenchida até a
// véspera da próxima reunião, então os últimos registros têm data FUTURA —
// todos com a meta vigente hoje. Por isso o card mostra "a.a." no canto, e
// não a data como os indicadores do CEPEA.
const SELIC_URL = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json";
const SELIC_CACHE_MS = 6 * 60 * 60 * 1000;
let selicCache = null; // { dados, em }

async function buscarSelic() {
  const linhas = await buscarJson(SELIC_URL, { tentativas: 2, timeoutMs: 6000 });
  if (!Array.isArray(linhas) || linhas.length === 0) throw new Error("SGS não devolveu registros");

  // "14.25" (o SGS usa ponto decimal, mesmo com data em pt-BR) -> 14.25
  const valor = Number(linhas.at(-1).valor);
  if (!Number.isFinite(valor)) throw new Error(`Valor ilegível: ${linhas.at(-1).valor}`);
  return { valor, data: linhas.at(-1).data };
}

app.get("/api/selic", async (_req, res) => {
  if (selicCache && Date.now() - selicCache.em < SELIC_CACHE_MS) {
    return res.json(selicCache.dados);
  }

  try {
    const dados = await buscarSelic();
    selicCache = { dados, em: Date.now() };
    res.json(dados);
  } catch (erro) {
    // Mesma ideia do CEPEA: a meta vigente continua valendo por semanas, então
    // um fora do ar do BC não deve zerar o card.
    if (selicCache) {
      console.warn(`Selic falhou (${erro.message}); mantendo a meta de ${selicCache.dados.data}`);
      return res.json(selicCache.dados);
    }
    console.error("Erro ao consultar a Selic:", erro.message);
    res.status(502).json({ erro: "Erro ao consultar a Selic", detalhe: erro.message });
  }
});

// ===== IGP-M (FGV — série 189 do SGS/Banco Central) =====
// O SGS só publica a variação MENSAL; o número que se cita ("o IGP-M está em
// X%", o dos reajustes de contrato) é o acumulado em 12 meses, que sai daqui
// compondo os 12 últimos meses: (1+i1)(1+i2)...(1+i12) - 1. Somar os 12 daria
// um valor errado (juros sobre juros), a diferença passa de 0,1 p.p. em anos
// de inflação alta.
// A FGV divulga uma vez por mês (fim do mês de referência), daí o cache longo.
const IGPM_URL = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.189/dados/ultimos/12?formato=json";
const IGPM_CACHE_MS = 6 * 60 * 60 * 1000;
let igpmCache = null; // { dados, em }

// "01/06/2026" -> Date. O SGS manda a data em pt-BR e o mês vem sempre no dia 1º.
function dataSgs(texto) {
  const [dia, mes, ano] = String(texto || "").split("/").map(Number);
  return new Date(ano, mes - 1, dia);
}

async function buscarIgpm() {
  const linhas = await buscarJson(IGPM_URL, { tentativas: 2, timeoutMs: 6000 });
  if (!Array.isArray(linhas) || linhas.length < 12) {
    throw new Error(`SGS devolveu ${linhas?.length ?? 0} meses (esperado 12)`);
  }

  let fator = 1;
  for (const linha of linhas) {
    const mensal = Number(linha.valor);
    if (!Number.isFinite(mensal)) throw new Error(`Valor ilegível: ${linha.valor}`);
    fator *= 1 + mensal / 100;
  }

  // O mês de referência é o mais recente do lote. Vou pelo maior em vez do
  // último porque a ordem do SGS varia de série para série (a 432 vem
  // crescente; a 1178, decrescente) — no produto acima a ordem não importa,
  // aqui importaria.
  const recente = linhas.reduce((a, b) => (dataSgs(b.data) > dataSgs(a.data) ? b : a));

  return {
    valor: (fator - 1) * 100, // acumulado em 12 meses, em %
    mensal: Number(recente.valor),
    data: recente.data,
  };
}

app.get("/api/igpm", async (_req, res) => {
  if (igpmCache && Date.now() - igpmCache.em < IGPM_CACHE_MS) {
    return res.json(igpmCache.dados);
  }

  try {
    const dados = await buscarIgpm();
    igpmCache = { dados, em: Date.now() };
    res.json(dados);
  } catch (erro) {
    if (igpmCache) {
      console.warn(`IGP-M falhou (${erro.message}); mantendo o índice de ${igpmCache.dados.data}`);
      return res.json(igpmCache.dados);
    }
    console.error("Erro ao consultar o IGP-M:", erro.message);
    res.status(502).json({ erro: "Erro ao consultar o IGP-M", detalhe: erro.message });
  }
});

// ===== SQL Server (compartilhado entre Frota e Ativos de TI) =====
// Mesmo banco, duas rotas. O pool de conexões é criado na primeira chamada
// e reaproveitado (se a conexão cair, tenta de novo depois).
let poolSql = null;

function conectarSql() {
  if (!poolSql) {
    poolSql = sql.connect({
      server: process.env.DB_SERVER,
      port: Number(process.env.DB_PORT || 1433),
      database: process.env.DB_DATABASE,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      options: {
        encrypt: process.env.DB_ENCRYPT === "true",
        trustServerCertificate: process.env.DB_TRUST_CERT !== "false",
      },
    });
    poolSql.catch(() => { poolSql = null; });
  }
  return poolSql;
}

// Nome de tabela/coluna vem do .env — só aceita identificadores simples.
function identificadorSql(valor, padrao) {
  const nome = (valor || padrao).trim();
  if (!/^[\w.]+$/.test(nome)) throw new Error(`Identificador inválido: ${nome}`);
  return nome;
}

// Só os status "ativos" viram contador na página (decisão do Lucas):
// os demais (SUCATA, ROUBADO, PERDA TOTAL, sem status) aparecem só no donut.
const STATUS_TILES = {
  "TRABALHANDO": "trabalhando",
  "OFICINA": "oficina",
  "ESTRAGADO": "estragado",
  "SUCATA": "estragado", // sucata soma no cartão Estragado (pedido do Lucas)
  "SEM ATIVIDADE": "semAtividade",
};

app.get("/api/frota", async (_req, res) => {
  if (!process.env.DB_SERVER || !process.env.DB_USER) {
    return res.status(503).json({ erro: "Banco de dados não configurado — preencha o .env" });
  }

  try {
    const tabela = identificadorSql(process.env.FROTA_TABELA, "dbo.FROTA");
    const colStatus = identificadorSql(process.env.FROTA_COL_STATUS, "STATUS");
    const colTipo = identificadorSql(process.env.FROTA_COL_TIPO, "CLASSE_ESPECIE");

    const pool = await conectarSql();
    // Só bens ativos: DEVOLVIDO, VENDIDO etc. ficam fora do dashboard.
    const ativos = "UPPER(LTRIM(RTRIM([STATUS_BEM]))) = 'ATIVO'";
    const { recordset } = await pool.request().query(
      `SELECT [${colStatus}] AS status, COUNT(*) AS qtd
         FROM ${tabela}
        WHERE ${ativos}
        GROUP BY [${colStatus}]`
    );
    const consultaTipos = await pool.request().query(
      `SELECT [${colTipo}] AS tipo, COUNT(*) AS qtd
         FROM ${tabela}
        WHERE ${ativos}
        GROUP BY [${colTipo}]`
    );

    const status = { trabalhando: 0, oficina: 0, estragado: 0, semAtividade: 0 };
    const donutMap = new Map();
    let total = 0;
    for (const linha of recordset) {
      const bruto = String(linha.status ?? "").trim();
      const chave = STATUS_TILES[bruto.toUpperCase()];
      if (chave) status[chave] += linha.qtd;
      // No donut, sucata também soma na fatia Estragado (como no cartão).
      const nome = bruto.toUpperCase() === "SUCATA" ? "ESTRAGADO" : bruto || "Sem status";
      donutMap.set(nome, (donutMap.get(nome) || 0) + linha.qtd);
      total += linha.qtd;
    }

    res.json({
      total,
      status,
      donut: [...donutMap]
        .map(([nome, qtd]) => ({ nome, qtd }))
        .sort((a, b) => b.qtd - a.qtd),
      tipos: consultaTipos.recordset
        .map((l) => ({ nome: String(l.tipo ?? "").trim() || "Sem tipo", qtd: l.qtd }))
        .sort((a, b) => b.qtd - a.qtd),
    });
  } catch (erro) {
    console.error("Erro ao consultar a frota:", erro.message);
    res.status(502).json({ erro: "Erro ao consultar o banco da frota" });
  }
});

// ===== Localização da frota (SQL Server: dbo.TICKET x dbo.FROTA) =====
// A posição "atual" de cada máquina é o ticket mais recente que tem
// coordenada (LAT/LON), casado com dbo.FROTA pelo PREFIXO para trazer a
// classe/espécie. Os pontos são agrupados por PROJETO (frente de trabalho),
// já que várias máquinas compartilham a mesma frente/coordenada — isso deixa
// o mapa legível numa TV. Cada grupo traz a contagem, as classes mais comuns
// e a data da última posição.
app.get("/api/frota-localizacao", async (_req, res) => {
  if (!process.env.DB_SERVER || !process.env.DB_USER) {
    return res.status(503).json({ erro: "Banco de dados não configurado — preencha o .env" });
  }

  try {
    const pool = await conectarSql();
    // rn = 1 pega o ticket mais recente por prefixo (mais recente primeiro por
    // DATA e, no empate do dia, por ID). Descarta prefixo vazio e coords nulas.
    const { recordset } = await pool.request().query(
      `SELECT t.PREFIXO AS prefixo, t.PROJETO AS projeto, t.DATA AS data,
              t.LAT AS lat, t.LON AS lon,
              COALESCE(NULLIF(LTRIM(RTRIM(f.CLASSE_ESPECIE)), ''),
                       NULLIF(LTRIM(RTRIM(t.CLASSE)), ''), 'Sem classe') AS classe
         FROM (
           SELECT PREFIXO, PROJETO, DATA, LAT, LON, CLASSE,
                  ROW_NUMBER() OVER (
                    PARTITION BY PREFIXO ORDER BY DATA DESC, ID DESC
                  ) AS rn
             FROM dbo.TICKET
            WHERE LAT IS NOT NULL AND LON IS NOT NULL
              AND LTRIM(RTRIM(ISNULL(PREFIXO, ''))) <> ''
         ) t
         LEFT JOIN dbo.FROTA f ON f.PREFIXO = t.PREFIXO
        WHERE t.rn = 1`
    );

    // Agrupa por projeto: soma máquinas, guarda o centro (média das coords das
    // frentes daquele projeto) e conta as classes para o rótulo.
    const grupos = new Map();
    for (const l of recordset) {
      const projeto = String(l.projeto ?? "").trim() || "Sem projeto";
      let g = grupos.get(projeto);
      if (!g) {
        g = { projeto, maquinas: 0, somaLat: 0, somaLon: 0, classes: new Map(), ultima: null };
        grupos.set(projeto, g);
      }
      g.maquinas += 1;
      g.somaLat += l.lat;
      g.somaLon += l.lon;
      g.classes.set(l.classe, (g.classes.get(l.classe) || 0) + 1);
      if (!g.ultima || new Date(l.data) > new Date(g.ultima)) g.ultima = l.data;
    }

    const pontos = [...grupos.values()]
      .map((g) => ({
        projeto: g.projeto,
        maquinas: g.maquinas,
        lat: g.somaLat / g.maquinas,
        lon: g.somaLon / g.maquinas,
        ultima: g.ultima,
        classes: [...g.classes]
          .map(([nome, qtd]) => ({ nome, qtd }))
          .sort((a, b) => b.qtd - a.qtd),
      }))
      .sort((a, b) => b.maquinas - a.maquinas);

    res.json({
      total: pontos.reduce((s, p) => s + p.maquinas, 0),
      pontos,
    });
  } catch (erro) {
    console.error("Erro ao consultar a localização da frota:", erro.message);
    res.status(502).json({ erro: "Erro ao consultar a localização da frota" });
  }
});

// ===== Frota por líder/coordenador (SQL Server: dbo.TICKET x dbo.FROTA) =====
// Cada veículo (PREFIXO) é contado uma vez, sob o coordenador do seu
// ticket mais recente — mesmo critério de "atual" usado em /api/frota-localizacao.
// O tipo/classe e o status do veículo vêm de dbo.FROTA, casados pelo PREFIXO.
// O status usa exatamente a regra da página Frotas (STATUS_TILES + só bens
// ATIVOS), para os contadores de cada coordenador baterem com aquela tela.
app.get("/api/frota-lideres", async (_req, res) => {
  if (!process.env.DB_SERVER || !process.env.DB_USER) {
    return res.status(503).json({ erro: "Banco de dados não configurado — preencha o .env" });
  }

  try {
    const colTipo = identificadorSql(process.env.FROTA_COL_TIPO, "CLASSE_ESPECIE");
    const colStatus = identificadorSql(process.env.FROTA_COL_STATUS, "STATUS");
    const pool = await conectarSql();
    const { recordset } = await pool.request().query(
      `SELECT COALESCE(NULLIF(LTRIM(RTRIM(t.COORDENADOR)), ''), 'Sem coordenador') AS coordenador,
              t.PREFIXO AS prefixo,
              COALESCE(NULLIF(LTRIM(RTRIM(f.[${colTipo}])), ''), 'Sem tipo') AS tipo,
              CASE WHEN UPPER(LTRIM(RTRIM(f.[STATUS_BEM]))) = 'ATIVO'
                   THEN f.[${colStatus}] END AS status
         FROM (
           SELECT PREFIXO, COORDENADOR,
                  ROW_NUMBER() OVER (
                    PARTITION BY PREFIXO ORDER BY DATA DESC, ID DESC
                  ) AS rn
             FROM dbo.TICKET
            WHERE LTRIM(RTRIM(ISNULL(PREFIXO, ''))) <> ''
         ) t
         LEFT JOIN dbo.FROTA f ON f.PREFIXO = t.PREFIXO
        WHERE t.rn = 1`
    );

    const grupos = new Map();
    for (const l of recordset) {
      const nome = String(l.coordenador ?? "").trim() || "Sem coordenador";
      let g = grupos.get(nome);
      if (!g) {
        g = {
          nome,
          qtd: 0,
          status: { trabalhando: 0, oficina: 0, estragado: 0, semAtividade: 0 },
          tipos: new Map(),
        };
        grupos.set(nome, g);
      }
      g.qtd += 1;
      g.tipos.set(l.tipo, (g.tipos.get(l.tipo) || 0) + 1);
      // Sem correspondência em dbo.FROTA (ou bem não-ativo) fica fora dos
      // contadores de status — igual à página Frotas, que só olha bens ATIVOS.
      const chave = STATUS_TILES[String(l.status ?? "").trim().toUpperCase()];
      if (chave) g.status[chave] += 1;
    }

    const lideres = [...grupos.values()]
      .map((g) => ({
        nome: g.nome,
        qtd: g.qtd,
        status: g.status,
        tipos: [...g.tipos]
          .map(([nome, qtd]) => ({ nome, qtd }))
          .sort((a, b) => b.qtd - a.qtd),
      }))
      .sort((a, b) => b.qtd - a.qtd);

    res.json({
      total: lideres.reduce((s, l) => s + l.qtd, 0),
      lideres,
    });
  } catch (erro) {
    console.error("Erro ao consultar a frota por líder:", erro.message);
    res.status(502).json({ erro: "Erro ao consultar a frota por líder" });
  }
});

// ===== Ativos de TI (SQL Server) =====
// Contagem por tipo em inventario.ATIVOS. A tela lista só os tipos abaixo
// (pedido do Lucas); outros tipos que existam na tabela ficam fora por ora.
const TIPOS_ATIVOS_TI = ["NOTEBOOK", "MONITOR", "CELULAR", "STARLINK"];

app.get("/api/ativos-ti", async (_req, res) => {
  if (!process.env.DB_SERVER || !process.env.DB_USER) {
    return res.status(503).json({ erro: "Banco de dados não configurado — preencha o .env" });
  }

  try {
    const pool = await conectarSql();
    const { recordset } = await pool.request().query(
      `SELECT [TIPO] AS tipo, COUNT(*) AS qtd
         FROM inventario.ATIVOS
        GROUP BY [TIPO]`
    );

    const contagem = new Map(
      recordset.map((l) => [String(l.tipo ?? "").trim().toUpperCase(), l.qtd])
    );

    res.json({
      tipos: TIPOS_ATIVOS_TI.map((tipo) => ({ nome: tipo, qtd: contagem.get(tipo) || 0 })),
    });
  } catch (erro) {
    console.error("Erro ao consultar ativos de TI:", erro.message);
    res.status(502).json({ erro: "Erro ao consultar o banco de ativos de TI" });
  }
});

// ===== Helpdesk (SQL Server) =====
// Chamados recentes de dbo.HELPDESK_CHAMADOS, separados em três colunas por
// status. ID_SOLICITANTE, ATRIBUIDO_A e RESOLVIDO_POR são IDs de
// dbo.HELPDESK_USUARIOS, por isso os JOINs para trazer o nome de quem abriu,
// de quem atende e de quem resolveu.
const STATUS_HELPDESK = ["ABERTO", "EM_ATENDIMENTO", "RESOLVIDO"];
const CHAMADOS_POR_COLUNA = 5;

app.get("/api/helpdesk-chamados", async (_req, res) => {
  if (!process.env.DB_SERVER || !process.env.DB_USER) {
    return res.status(503).json({ erro: "Banco de dados não configurado — preencha o .env" });
  }

  try {
    const pool = await conectarSql();
    const statusIn = STATUS_HELPDESK.map((s) => `'${s}'`).join(", ");

    // ROW_NUMBER por status: cada coluna recebe seus N chamados mais recentes
    // (resolvidos ordenam por RESOLVIDO_EM; os demais, por CRIADO_EM).
    const { recordset } = await pool.request().query(
      `SELECT id, titulo, prioridade, status, criadoEm, resolvidoEm, solicitante, atribuidoA, resolvidoPor
         FROM (
           SELECT c.ID AS id, c.TITULO AS titulo, c.PRIORIDADE AS prioridade,
                  UPPER(LTRIM(RTRIM(c.STATUS))) AS status,
                  c.CRIADO_EM AS criadoEm, c.RESOLVIDO_EM AS resolvidoEm,
                  usol.NOME AS solicitante, ua.NOME AS atribuidoA, ur.NOME AS resolvidoPor,
                  ROW_NUMBER() OVER (
                    PARTITION BY UPPER(LTRIM(RTRIM(c.STATUS)))
                    ORDER BY COALESCE(c.RESOLVIDO_EM, c.CRIADO_EM) DESC
                  ) AS rn
             FROM dbo.HELPDESK_CHAMADOS c
             LEFT JOIN dbo.HELPDESK_USUARIOS usol ON usol.ID = c.ID_SOLICITANTE
             LEFT JOIN dbo.HELPDESK_USUARIOS ua ON ua.ID = c.ATRIBUIDO_A
             LEFT JOIN dbo.HELPDESK_USUARIOS ur ON ur.ID = c.RESOLVIDO_POR
            WHERE UPPER(LTRIM(RTRIM(c.STATUS))) IN (${statusIn})
         ) t
        WHERE t.rn <= ${CHAMADOS_POR_COLUNA}
        ORDER BY COALESCE(resolvidoEm, criadoEm) DESC`
    );

    // Total por status (as colunas mostram só os recentes; o contador, tudo).
    const totais = await pool.request().query(
      `SELECT UPPER(LTRIM(RTRIM(STATUS))) AS status, COUNT(*) AS qtd
         FROM dbo.HELPDESK_CHAMADOS
        WHERE UPPER(LTRIM(RTRIM(STATUS))) IN (${statusIn})
        GROUP BY UPPER(LTRIM(RTRIM(STATUS)))`
    );

    const colunas = Object.fromEntries(STATUS_HELPDESK.map((s) => [s, []]));
    for (const linha of recordset) colunas[linha.status]?.push(linha);

    const contagem = Object.fromEntries(STATUS_HELPDESK.map((s) => [s, 0]));
    for (const linha of totais.recordset) {
      if (linha.status in contagem) contagem[linha.status] = linha.qtd;
    }

    res.json({ colunas, contagem });
  } catch (erro) {
    console.error("Erro ao consultar os chamados do helpdesk:", erro.message);
    res.status(502).json({ erro: "Erro ao consultar o banco do helpdesk" });
  }
});

// ===== Status dos serviços do Railway =====
// Cada projeto monitorado é um Project Token do Railway (Project Settings ->
// Tokens). A variável RAILWAY_SERVICOS lista pares "Rótulo=TOKEN" separados
// por vírgula, ex.: RAILWAY_SERVICOS=Dashboard TI=abc123,Site=def456 (.env).
// Um Project Token é escopado a um projeto+ambiente (não a um serviço só),
// então cada token pode render vários cards — um por serviço do projeto,
// nomeado "Rótulo · Serviço" quando há mais de um.
// A API exige o header Project-Access-Token (não Authorization: Bearer).
const RAILWAY_API_URL = "https://backboard.railway.app/graphql/v2";

// Fonte principal dos tokens: o data.json (gerenciado pela tela de Gestão).
// O .env RAILWAY_SERVICOS ("Rótulo=TOKEN,..." em uma linha) fica como fallback
// para não quebrar instalações que ainda o usam — só vale se nada foi salvo.
function tokensDoEnv() {
  const bruto = process.env.RAILWAY_SERVICOS || "";
  return bruto
    .split(",")
    .map((par) => par.trim())
    .filter(Boolean)
    .map((par) => {
      const i = par.indexOf("=");
      if (i < 0) return null;
      return { rotulo: par.slice(0, i).trim(), token: par.slice(i + 1).trim() };
    })
    .filter(Boolean);
}

async function listaTokensRailway() {
  const salvos = await store.listarRailway();
  if (salvos.length > 0) {
    return salvos
      .map((s) => ({ rotulo: (s.rotulo || "").trim(), token: (s.token || "").trim() }))
      .filter((s) => s.token);
  }
  return tokensDoEnv();
}

// Marca no erro se a causa é o token (inválido/sem permissão), para a UI
// distinguir "problema de preenchimento" de "serviço fora do ar".
function erroToken(mensagem) {
  const erro = new Error(mensagem);
  erro.tipoToken = true;
  return erro;
}

async function consultaRailway(token, query, variables) {
  if (!token) throw erroToken("Token não preenchido");

  const resp = await fetch(RAILWAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Project-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const dados = await resp.json();
  if (!resp.ok || dados.errors) {
    const mensagem = dados.errors?.[0]?.message || "Erro na API do Railway";
    // 401/403 ou mensagens de auth do Railway = token errado, não serviço fora.
    // Obs.: token inválido volta como HTTP 200 + "Project Token not found"
    // (testado contra a API real), por isso "token not found" entra aqui.
    const ehAuth =
      resp.status === 401 || resp.status === 403 ||
      /not authorized|unauthorized|forbidden|invalid.*token|token.*(invalid|not found)/i.test(mensagem);
    throw ehAuth ? erroToken(mensagem) : new Error(mensagem);
  }
  return dados.data;
}

const QUERY_PROJECT_TOKEN = `query { projectToken { projectId environmentId } }`;

// Uma única consulta traz todos os serviços do projeto (no ambiente do token),
// já com nome, domínio, status do último deploy e — para crons — o agendamento
// e a próxima execução. cronSchedule/nextCronRunAt vêm null em serviços que não
// são cron job (Settings -> Cron Schedule no Railway).
const QUERY_SERVICOS = `
  query($environmentId: String!) {
    environment(id: $environmentId) {
      serviceInstances {
        edges {
          node {
            serviceName
            cronSchedule
            nextCronRunAt
            latestDeployment { status }
            domains {
              serviceDomains { domain }
              customDomains { domain }
            }
          }
        }
      }
    }
  }
`;

async function servicosDoToken({ rotulo, token }) {
  const { environmentId } = (await consultaRailway(token, QUERY_PROJECT_TOKEN)).projectToken;
  const { environment } = await consultaRailway(token, QUERY_SERVICOS, { environmentId });

  const nos = environment?.serviceInstances?.edges || [];
  const varios = nos.length > 1;

  return nos.map(({ node }) => {
    const dominio =
      node.domains?.customDomains?.[0]?.domain ||
      node.domains?.serviceDomains?.[0]?.domain ||
      "";
    const online = node.latestDeployment?.status === "SUCCESS";
    return {
      // "nome" identifica na lista; "servico" é o nome puro, usado na pill de cron.
      nome: varios ? node.serviceName : rotulo,
      servico: node.serviceName,
      endereco: dominio ? `https://${dominio}` : "",
      online,
      // estado: "online" (ok), "erro" (deploy falhou/fora do ar) ou "token"
      // (problema de autenticação — tratado no catch da rota).
      estado: online ? "online" : "erro",
      cron: node.cronSchedule || null,
      proximaExecucao: node.nextCronRunAt || null,
    };
  });
}

app.get("/api/railway-status", async (_req, res) => {
  const tokens = await listaTokensRailway();
  if (tokens.length === 0) {
    return res.status(503).json({ erro: "Nenhum serviço configurado — adicione tokens na tela de Gestão" });
  }
  const resultado = await Promise.all(
    tokens.map((t) =>
      servicosDoToken(t).catch((erro) => {
        console.error(`Erro ao consultar Railway (${t.rotulo}):`, erro.message);
        // erro.tipoToken => token inválido/não preenchido (problema de config,
        // não do serviço); a UI mostra esse estado com cor/rótulo próprios.
        const estado = erro.tipoToken ? "token" : "erro";
        return [{ nome: t.rotulo, endereco: "", online: false, estado }];
      })
    )
  );
  res.json({ servicos: resultado.flat() });
});

// ===== Gerenciamento dos tokens do Railway (tela de Gestão) =====
// GET devolve os tokens MASCARADOS (só os 4 últimos dígitos): a UI nunca
// recebe o segredo completo. Cada item traz "temToken" para a tela saber
// se já existe um valor salvo. O POST recebe a lista inteira; quando o
// usuário não digita um token novo numa linha, manda "token: null" e o
// servidor preserva o valor que já estava salvo naquele id.
function mascarar(token) {
  if (!token) return "";
  const fim = token.slice(-4);
  return `••••${fim}`;
}

app.get("/api/railway-tokens", async (_req, res) => {
  const itens = await store.listarRailway();
  res.json({
    tokens: itens.map((i) => ({
      id: i.id,
      rotulo: i.rotulo,
      tokenMascarado: mascarar(i.token),
      temToken: Boolean(i.token),
    })),
    // Sinaliza para a UI se ainda há tokens só no .env (migração pendente).
    usandoEnv: itens.length === 0 && tokensDoEnv().length > 0,
  });
});

app.post("/api/railway-tokens", async (req, res) => {
  const recebidos = Array.isArray(req.body?.tokens) ? req.body.tokens : [];
  const atuais = new Map((await store.listarRailway()).map((i) => [i.id, i]));

  const itens = [];
  for (const bruto of recebidos) {
    const rotulo = String(bruto?.rotulo ?? "").trim();
    const id = String(bruto?.id ?? "").trim() || randomUUID();
    // token === null/undefined => manter o já salvo; string => substituir.
    const tokenNovo = bruto?.token == null ? null : String(bruto.token).trim();
    const token = tokenNovo !== null ? tokenNovo : (atuais.get(id)?.token ?? "");
    // Descarta linhas sem rótulo e sem token (linha vazia deixada pela UI).
    if (!rotulo && !token) continue;
    itens.push({ id, rotulo, token });
  }

  await store.salvarRailway(itens);
  res.json({ ok: true });
});

// ===== Downdetector =====
// Removido por ora: o site fica atrás da Cloudflare, que bloqueia consultas
// vindas de IP de datacenter (Railway). O scraper com Puppeteer está guardado
// em downdetector-scraper.js.txt para reaproveitar quando definirmos a fonte.

// ===== Estáticos (front-end) =====
app.use(express.static(join(__dirname, "public")));

const PORTA = process.env.PORT || 3000;
app.listen(PORTA, () => {
  console.log(`Dashboard rodando em http://localhost:${PORTA}`);
});
