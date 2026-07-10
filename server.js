// Servidor do dashboard: serve os arquivos estáticos de public/ e expõe a API.
//
// Rotas:
//   GET  /api/servicos          -> lista de serviços
//   POST /api/servicos          -> salva a lista (body: { servicos: [...] })
//   GET  /api/config/:chave     -> valor de uma config (ex.: cidade)
//   POST /api/config/:chave     -> salva config (body: { valor })
//   GET  /api/clima?cidade=...   -> clima atual via Open-Meteo
//   GET  /api/status/:slug       -> status do Downdetector via Puppeteer
//   GET  /api/frota              -> resumo da frota (SQL Server, dbo.FROTA)
//   GET  /api/ativos-ti          -> contagem de ativos de TI (SQL Server, inventario.ATIVOS)
//   GET  /api/helpdesk-chamados  -> chamados recentes por status (SQL Server, dbo.HELPDESK_CHAMADOS)

import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sql from "mssql";
import * as store from "./store.js";
import { validarLogin, iniciarSessao, encerrarSessao, exigirSessao } from "./auth.js";

// Variáveis locais vêm do .env; no Railway vêm do painel (sem arquivo).
try { process.loadEnvFile(); } catch { /* sem .env, segue com o ambiente */ }

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();

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

// ===== Clima (Open-Meteo: geocoding + forecast) =====
app.get("/api/clima", async (req, res) => {
  const cidade = String(req.query.cidade || "").trim();
  if (!cidade) return res.status(400).json({ erro: "Informe a cidade" });

  try {
    const geoUrl =
      "https://geocoding-api.open-meteo.com/v1/search?count=1&language=pt&name=" +
      encodeURIComponent(cidade);
    const lugar = (await (await fetch(geoUrl)).json()).results?.[0];
    if (!lugar) return res.status(404).json({ erro: "Cidade não encontrada" });

    const climaUrl =
      "https://api.open-meteo.com/v1/forecast" +
      `?latitude=${lugar.latitude}&longitude=${lugar.longitude}` +
      "&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min" +
      "&timezone=auto&forecast_days=7";
    const dados = await (await fetch(climaUrl)).json();
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
  } catch {
    res.status(502).json({ erro: "Erro ao consultar o clima" });
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
// status. ATRIBUIDO_A e RESOLVIDO_POR são IDs de dbo.HELPDESK_USUARIOS, por
// isso o JOIN para trazer o nome de quem atende / resolveu.
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
      `SELECT id, titulo, prioridade, status, criadoEm, resolvidoEm, atribuidoA, resolvidoPor
         FROM (
           SELECT c.ID AS id, c.TITULO AS titulo, c.PRIORIDADE AS prioridade,
                  UPPER(LTRIM(RTRIM(c.STATUS))) AS status,
                  c.CRIADO_EM AS criadoEm, c.RESOLVIDO_EM AS resolvidoEm,
                  ua.NOME AS atribuidoA, ur.NOME AS resolvidoPor,
                  ROW_NUMBER() OVER (
                    PARTITION BY UPPER(LTRIM(RTRIM(c.STATUS)))
                    ORDER BY COALESCE(c.RESOLVIDO_EM, c.CRIADO_EM) DESC
                  ) AS rn
             FROM dbo.HELPDESK_CHAMADOS c
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
