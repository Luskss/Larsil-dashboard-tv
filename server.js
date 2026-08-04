// Servidor do dashboard: serve os arquivos estáticos de public/ e expõe a API.
//
// Rotas:
//   GET  /api/servicos          -> lista de serviços
//   POST /api/servicos          -> salva a lista (body: { servicos: [...] })
//   GET  /api/config/:chave     -> valor de uma config (ex.: cidade)
//   POST /api/config/:chave     -> salva config (body: { valor })
//   GET  /api/paginas           -> ordem e visibilidade das páginas da rotação
//   POST /api/paginas           -> salva ambas (body: { ordem, visiveis })
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
//   GET  /api/frota-lideres      -> qtd de veículos por coordenador (dbo.FROTA x dbo.TICKET)
//   GET  /api/apontamento        -> última produção apontada por equipe (dbo.ORGANOGRAMA x dbo.BOLETIM_DIARIO x dbo.FOLGAS)
//   GET  /api/ativos-ti          -> contagem de ativos de TI (SQL Server, inventario.ATIVOS)
//   GET  /api/colaboradores      -> quadro por coordenador, com as classes (SQL Server, dbo.COLABORADORES)
//   GET  /api/helpdesk-chamados  -> chamados recentes por status (SQL Server, dbo.HELPDESK_CHAMADOS)
//   GET  /api/veiculos-reservas  -> reservas dos carros (dbo.VEICULOS_RESERVAS_TESTE x dbo.VEICULOS_TESTE)
//   GET  /api/railway-status     -> status dos serviços configurados no Railway (API GraphQL)

import express from "express";
import compression from "compression";
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

// Não anuncia "Express" em toda resposta — versão de framework só ajuda quem
// está procurando um alvo com CVE conhecida.
app.disable("x-powered-by");

// ===== Compressão =====
// O boot do dashboard baixa ~305 KB de HTML/CSS/JS/GeoJSON — tudo texto, que
// comprime para ~85 KB. Numa TV (Fire Stick por Wi-Fi) essa é a maior diferença
// isolada no tempo até a primeira tela. Vem antes de todo o resto para pegar
// também as respostas de API.
app.use(compression());

// ===== Cabeçalhos de segurança (em toda resposta) =====
// CSP: scripts só do próprio site (os scripts das páginas são arquivos .js —
// nenhum <script> inline). style-src precisa de 'unsafe-inline' porque as
// páginas trazem um <style> no head, paginacao.js injeta o CSS dele em runtime
// e há style="..." inline. img-src data: cobre os logos em base64.
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
  // Resposta de API é dado de sessão: não pode ficar em cache de navegador nem
  // de proxy no caminho.
  if (_req.path.startsWith("/api/") || _req.path === "/login") {
    res.setHeader("Cache-Control", "no-store");
  }
  next();
});

// ===== Conferência de origem (defesa extra contra CSRF) =====
// O cookie já é SameSite=strict e o corpo é JSON (formulário de outro site não
// consegue mandar application/json), então o CSRF já estava barrado por dois
// lados. Este é o terceiro: se o navegador declarou uma origem, ela tem que ser
// a nossa. Sem Origin (curl, healthcheck) segue o baile — quem não é navegador
// não carrega o cookie da vítima.
app.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();

  const origem = req.headers.origin;
  if (!origem) return next();

  let host;
  try {
    host = new URL(origem).host;
  } catch {
    return res.status(403).json({ erro: "Origem inválida" });
  }
  if (host !== req.headers.host) {
    console.warn(`Requisição bloqueada: origem ${origem} != host ${req.headers.host}`);
    return res.status(403).json({ erro: "Origem não permitida" });
  }
  next();
});

// ===== Corpo JSON =====
// O parser roda antes do exigirSessao, então o limite geral é curto: sem isso,
// qualquer um sem login faria o servidor bufferizar 8 MB por requisição. Só a
// rota das logos (base64, pesado) aceita mais, e lá o parser é montado depois
// da checagem de sessão.
const ROTA_LOGOS = "/api/servicos";
app.use((req, res, next) =>
  req.path === ROTA_LOGOS ? next() : express.json({ limit: "64kb" })(req, res, next)
);

// ===== Login (usuário/senha único, ver auth.js) =====
// A senha é uma só e vale por tudo (frota, helpdesk, tokens do Railway), então
// tentativa ilimitada é o elo mais fraco do sistema. Duas travas, em memória
// mesmo — o processo é único e reiniciar limpar o contador não atrapalha:
//   1. por IP: JANELA_MS de castigo depois de MAX_FALHAS erradas;
//   2. teto de logins simultâneos: cada tentativa custa um scrypt, e uma rajada
//      de derivações em paralelo come a CPU inteira mesmo sendo assíncrona.
const MAX_FALHAS = 10;
const JANELA_MS = 15 * 60 * 1000;
const MAX_LOGINS_SIMULTANEOS = 5;

const falhasPorIp = new Map(); // ip -> { qtd, ate }
let loginsEmVoo = 0;

// Sem limpeza a Map cresce sem parar; um passe a cada janela basta.
setInterval(() => {
  const agora = Date.now();
  for (const [ip, reg] of falhasPorIp) if (agora > reg.ate) falhasPorIp.delete(ip);
}, JANELA_MS).unref();

function bloqueado(ip) {
  const reg = falhasPorIp.get(ip);
  if (!reg) return 0;
  if (Date.now() > reg.ate) {
    falhasPorIp.delete(ip);
    return 0;
  }
  return reg.qtd >= MAX_FALHAS ? Math.ceil((reg.ate - Date.now()) / 1000) : 0;
}

function registrarFalha(ip) {
  const reg = falhasPorIp.get(ip) || { qtd: 0, ate: 0 };
  reg.qtd += 1;
  reg.ate = Date.now() + JANELA_MS;
  falhasPorIp.set(ip, reg);
}

app.post("/login", async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || "desconhecido";

  const espera = bloqueado(ip);
  if (espera > 0) {
    res.setHeader("Retry-After", String(espera));
    return res.status(429).json({ erro: "Tentativas demais. Aguarde alguns minutos." });
  }

  if (loginsEmVoo >= MAX_LOGINS_SIMULTANEOS) {
    res.setHeader("Retry-After", "5");
    return res.status(429).json({ erro: "Servidor ocupado, tente de novo em instantes" });
  }

  const { usuario, senha } = req.body || {};
  loginsEmVoo += 1;
  let ok;
  try {
    ok = await validarLogin(usuario, senha);
  } finally {
    loginsEmVoo -= 1;
  }

  if (!ok) {
    registrarFalha(ip);
    console.warn(`Login negado (ip ${ip})`);
    return res.status(401).json({ erro: "Usuário ou senha inválidos" });
  }

  falhasPorIp.delete(ip);
  iniciarSessao(req, res, usuario);
  res.json({ ok: true });
});

app.post("/logout", (req, res) => {
  encerrarSessao(req, res);
  res.json({ ok: true });
});

// A partir daqui, tudo exige sessão válida (libera só /login e /login.html).
app.use(exigirSessao);

// Logos em base64: limite maior, mas só depois da sessão conferida.
app.use(ROTA_LOGOS, express.json({ limit: "8mb" }));

// ===== Serviços =====
app.get("/api/servicos", async (_req, res) => {
  res.json(await store.listarServicos());
});

// A logo chega como data URI vinda do navegador. Aceita só imagem de bitmap:
// SVG é XML e carrega <script>/onload, então viraria XSS armazenado no dia em
// que alguma tela renderizar a logo fora de um <img>.
const LOGO_PERMITIDA = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const LOGO_MAX = 1_400_000; // ~1 MB de arquivo vira ~1,37 MB em base64
const MAX_SERVICOS = 50;
const TEXTO_MAX = 200;

function limparServico(bruto) {
  const nome = String(bruto?.nome ?? "").trim().slice(0, TEXTO_MAX);
  const slug = String(bruto?.slug ?? "").trim().slice(0, TEXTO_MAX);
  if (!nome || !slug) return null;

  const logo = typeof bruto?.logo === "string" ? bruto.logo : null;
  const logoOk = logo && logo.length <= LOGO_MAX && LOGO_PERMITIDA.test(logo);
  // Campo a campo, em vez de repassar o objeto: assim nada além de
  // nome/slug/logo entra no data.json, por mais que o cliente mande.
  return { nome, slug, logo: logoOk ? logo : null };
}

app.post("/api/servicos", async (req, res) => {
  const recebidos = Array.isArray(req.body?.servicos) ? req.body.servicos : [];
  if (recebidos.length > MAX_SERVICOS) {
    return res.status(400).json({ erro: `Máximo de ${MAX_SERVICOS} serviços` });
  }
  await store.salvarServicos(recebidos.map(limparServico).filter(Boolean));
  res.json({ ok: true });
});

// ===== Config chave-valor =====
// Lista branca: a chave vira nome de propriedade no data.json, e chave livre
// deixaria qualquer um encher o arquivo (ou escrever "__proto__"). Hoje só a
// cidade do clima passa por aqui; o resto das preferências é localStorage.
const CONFIGS_PERMITIDAS = new Set(["cidade"]);
const CONFIG_VALOR_MAX = 200;

app.get("/api/config/:chave", async (req, res) => {
  if (!CONFIGS_PERMITIDAS.has(req.params.chave)) {
    return res.status(404).json({ erro: "Configuração desconhecida" });
  }
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
  if (!CONFIGS_PERMITIDAS.has(req.params.chave)) {
    return res.status(404).json({ erro: "Configuração desconhecida" });
  }
  // Só string: o valor volta para o front e é gravado no JSON — objeto aninhado
  // aqui não tem uso e só abriria espaço para lixo no arquivo.
  const valor = String(req.body?.valor ?? "").slice(0, CONFIG_VALOR_MAX);
  await store.setConfig(req.params.chave, valor);
  res.json({ ok: true });
});

// ===== Páginas do dashboard (ordem e visibilidade da rotação) =====
// Isto morava no localStorage, ou seja, preso ao navegador de quem configurou:
// reordenar as páginas no PC não mexia na TV, que tem o localStorage dela.
// Agora mora no data.json — a configuração é uma só, e a TV a busca de tempo
// em tempo (ver INTERVALO_SINCRONIA_MS em paginacao.js).
const PAGINAS_MAX = 50;
const PAGINA_NOME_MAX = 100;

// Só lista de strings curtas. Quais nomes são válidos, quem sabe é o PAGINAS
// do front — o servidor não conhece as vistas, então valida formato e tamanho
// para o data.json não virar depósito de lixo, e não o conteúdo.
function listaDePaginas(valor) {
  if (!Array.isArray(valor)) return null;
  return valor
    .filter((item) => typeof item === "string" && item.length > 0)
    .slice(0, PAGINAS_MAX)
    .map((item) => item.slice(0, PAGINA_NOME_MAX));
}

app.get("/api/paginas", async (_req, res) => {
  res.json(await store.getPaginas());
});

app.post("/api/paginas", async (req, res) => {
  const ordem = listaDePaginas(req.body?.ordem);
  const visiveis = listaDePaginas(req.body?.visiveis);
  if (!ordem || !visiveis) {
    return res.status(400).json({ erro: "Envie 'ordem' e 'visiveis' como listas de nomes de página" });
  }
  await store.salvarPaginas({ ordem, visiveis });
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

  // O detalhe fica só no log: a mensagem da falha carrega URL, host e às vezes
  // erro de DNS/TLS da infra — diagnóstico é no log do Railway, não na resposta.
  console.error("Erro ao consultar o dólar:", falhas.join(" | "));
  res.status(502).json({ erro: "Erro ao consultar a cotação do dólar" });
});

// ===== Commodities (indicadores CEPEA/ESALQ) =====
// O CEPEA não tem API pública, mas publica um widget oficial para embutir em
// sites — é dele que saem as cotações (uma tabelinha HTML que a gente lê aqui).
// Cada produto é um id de indicador, trocável pelo .env:
//   soja  -> 12 "Soja - PR" (mercado interno; 92 = "Soja Paranaguá", porto)
//   café  -> 23 "Café Arábica" (24 = "Café Robusta")
//   milho -> 77 "Milho" (indicador ESALQ/BM&FBovespa, Campinas)
// Os indicadores são diários (só dias úteis), por isso o cache longo.
//
// O widget só responde de rede residencial: a Cloudflare do CEPEA barra IP de
// datacenter, então no Railway a chamada volta 403 na hora (medido: mesma URL,
// mesmo minuto, 200 de casa e 403 da nuvem — não é cabeçalho nem User-Agent).
// Por isso cada produto tem um espelho no Notícias Agrícolas, que republica o
// mesmo indicador do CEPEA e é alcançável de qualquer lugar. O CEPEA continua
// sendo a primeira tentativa: quando dá certo, é a fonte oficial; quando não,
// o 403 chega em milissegundos e o espelho assume sem atrasar a tela.
const CEPEA_URL = "https://www.cepea.org.br/br/widgetproduto.js.php?id_indicador[]=";
const CEPEA_CACHE_MS = 30 * 60 * 1000;
// Sem User-Agent de navegador a Cloudflare do CEPEA devolve 403.
const UA_NAVEGADOR =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Linha da tabela do widget: data | produto + unidade | R$ valor.
const LINHA_CEPEA =
  /<td>(\d{2}\/\d{2}\/\d{4})<\/td>\s*<td>\s*<span[^>]*>([^<]+)<\/span>.*?<span class="unidade">([^<]+)<\/span>.*?<td>\s*R\$\s*<span[^>]*>([\d.,]+)<\/span>/s;

// Página do espelho: a primeira tabela é a do indicador, e a primeira linha
// dela é o pregão mais recente (data | valor | variação).
const ESPELHO_URL = "https://www.noticiasagricolas.com.br/cotacoes/";
const LINHA_ESPELHO =
  /<table class="cot-fisicas">.*?<tbody>\s*<tr>\s*<td>\s*(\d{2}\/\d{2}\/\d{4})\s*<\/td>\s*<td>\s*([\d.,]+)\s*<\/td>/s;

// Cada produto: id do indicador no CEPEA (trocável pelo .env), caminho do
// espelho e o rótulo do card. O nome vem daqui, e não do título da página do
// espelho ("Indicador da Soja Cepea/Esalq - Paraná"), que não cabe no bloco.
const PRODUTOS = {
  soja: {
    variavelEnv: "SOJA_INDICADOR",
    indicador: "12",
    espelho: "soja/indicador-cepea-esalq-soja-parana",
    produto: "Soja - PR",
  },
  cafe: {
    variavelEnv: "CAFE_INDICADOR",
    indicador: "23",
    espelho: "cafe/indicador-cepea-esalq-cafe-arabica",
    produto: "Café Arábica",
  },
  milho: {
    variavelEnv: "MILHO_INDICADOR",
    indicador: "77",
    espelho: "milho/indicador-cepea-esalq-milho",
    produto: "Milho",
  },
};
// Os três indicadores são cotados em saca de 60kg; o front encurta para "/sc".
const UNIDADE_SACA = "sc de 60kg";

const cepeaCache = new Map(); // indicador -> { dados, em }
const cepeaEmVoo = new Map(); // indicador -> busca em andamento

// A Cloudflare do CEPEA corta rajada: medindo daqui, ~6 chamadas seguidas já
// voltam 403 (e o bloqueio passa em poucos segundos). A tela pede soja, café e
// milho de uma vez, cada uma com retry, e cada aba/reload repete o trio — junto
// dá rajada. Por isso as chamadas saem uma de cada vez, com um respiro entre
// elas: são três por meia hora, atrasar não custa nada.
const CEPEA_INTERVALO_MS = 700;
let filaCepea = Promise.resolve();
let ultimaChamadaCepea = 0;

function naFilaCepea(tarefa) {
  const proxima = filaCepea.then(async () => {
    const espera = CEPEA_INTERVALO_MS - (Date.now() - ultimaChamadaCepea);
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    ultimaChamadaCepea = Date.now();
    return tarefa();
  });
  // A fila só serve para espaçar: uma cotação que falha não pode travar as
  // outras, então o elo seguinte ignora o erro (quem chamou é que trata).
  filaCepea = proxima.catch(() => {});
  return proxima;
}

// Uma busca por indicador de cada vez: com várias telas abertas o mesmo produto
// seria pedido em paralelo, e cada pedido contaria para o limite da Cloudflare.
function buscaUnicaCepea(cfg, indicador) {
  const emVoo = cepeaEmVoo.get(indicador);
  if (emVoo) return emVoo;

  const busca = naFilaCepea(() => buscarCotacao(cfg, indicador));
  cepeaEmVoo.set(indicador, busca);
  busca.catch(() => {}).then(() => cepeaEmVoo.delete(indicador));
  return busca;
}

async function cotacaoCepea(cfg, indicador) {
  const salvo = cepeaCache.get(indicador);
  if (salvo && Date.now() - salvo.em < CEPEA_CACHE_MS) return salvo.dados;

  try {
    return await buscaUnicaCepea(cfg, indicador);
  } catch (erro) {
    // Se as duas fontes falharem, o indicador é diário: o último valor bom
    // continua valendo, melhor mostrá-lo do que zerar o card. A tela não
    // mente — a data do pregão vai junto com o valor.
    if (salvo) {
      console.warn(
        `Cotação ${indicador} falhou (${erro.message}); mantendo a de ${salvo.dados.data}`
      );
      return salvo.dados;
    }
    throw erro;
  }
}

// Fonte oficial primeiro, espelho como plano B.
async function buscarCotacao(cfg, indicador) {
  let dados;
  try {
    dados = await buscarCotacaoCepea(indicador);
  } catch (erro) {
    // Só faz sentido espelhar o indicador padrão: se o .env aponta para outra
    // série (ex.: soja 92, do porto de Paranaguá), a página do espelho é de um
    // indicador diferente — melhor falhar do que mostrar o número errado.
    if (indicador !== cfg.indicador) throw erro;
    console.warn(`CEPEA ${indicador} falhou (${erro.message}); usando o espelho`);
    dados = await buscarCotacaoEspelho(cfg);
  }

  cepeaCache.set(indicador, { dados, em: Date.now() });
  return dados;
}

// "1.234,56" (pt-BR) -> 1234.56
function valorBR(texto) {
  const valor = Number(texto.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(valor)) throw new Error(`Valor ilegível: ${texto}`);
  return valor;
}

async function buscarCotacaoCepea(indicador) {
  // Uma tentativa só: com espelho e valor antigo guardados, insistir aqui só
  // atrasaria a tela (e, no datacenter, o 403 não muda tentando de novo).
  const html = await buscarTexto(CEPEA_URL + indicador, {
    headers: { "User-Agent": UA_NAVEGADOR },
    tentativas: 1,
    timeoutMs: 6000,
  });

  const achado = html.match(LINHA_CEPEA);
  if (!achado) throw new Error("Widget do CEPEA veio sem a linha da cotação");
  const [, data, produto, unidade, valor] = achado;

  return {
    // Nomes curtos: o card do dashboard é pequeno (bloco 3x1).
    produto: produto.trim().slice(0, 40),
    unidade: unidade.trim().slice(0, 20),
    valor: valorBR(valor),
    data, // dd/mm/aaaa do pregão — o indicador não sai fim de semana
  };
}

async function buscarCotacaoEspelho(cfg) {
  const html = await buscarTexto(ESPELHO_URL + cfg.espelho, {
    headers: { "User-Agent": UA_NAVEGADOR },
    tentativas: 2,
    timeoutMs: 8000,
  });

  const achado = html.match(LINHA_ESPELHO);
  if (!achado) throw new Error("Espelho veio sem a tabela do indicador");
  const [, data, valor] = achado;

  return { produto: cfg.produto, unidade: UNIDADE_SACA, valor: valorBR(valor), data };
}

// Monta a rota de um produto: id do .env (só dígitos) ou o padrão.
function rotaCepea(chave, nome) {
  const cfg = PRODUTOS[chave];
  return async (_req, res) => {
    try {
      const indicador =
        String(process.env[cfg.variavelEnv] || cfg.indicador).replace(/\D/g, "") || cfg.indicador;
      res.json(await cotacaoCepea(cfg, indicador));
    } catch (erro) {
      // Detalhe só no log (ver /api/dolar).
      console.error(`Erro ao consultar ${nome}:`, erro.message);
      res.status(502).json({ erro: `Erro ao consultar a cotação (${nome})` });
    }
  };
}

app.get("/api/soja", rotaCepea("soja", "soja"));
app.get("/api/cafe", rotaCepea("cafe", "café"));
app.get("/api/milho", rotaCepea("milho", "milho"));

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
    res.status(502).json({ erro: "Erro ao consultar a Selic" });
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
    res.status(502).json({ erro: "Erro ao consultar o IGP-M" });
  }
});

// ===== SQL Server (compartilhado entre Frota e Ativos de TI) =====
// Mesmo banco, duas rotas. O pool de conexões é criado na primeira chamada
// e reaproveitado (se a conexão cair, tenta de novo depois).
let poolSql = null;

// Uma queda do banco (restart do SQL Server, blip de rede) deixava `poolSql`
// como uma promise já resolvida apontando para um pool morto: daí em diante
// TODAS as rotas devolviam 502 até alguém reiniciar o processo. Zerar aqui faz
// a próxima requisição reconstruir o pool sozinha.
function derrubarPoolSql() {
  const morto = poolSql;
  poolSql = null;
  Promise.resolve(morto).then((p) => p?.close?.()).catch(() => {});
}

// Erro de conexão (vs. erro de SQL na consulta): só o primeiro justifica jogar
// o pool fora — um GROUP BY com coluna errada não tem nada a ver com a conexão.
function ehErroDeConexao(erro) {
  return ["ETIMEOUT", "ESOCKET", "ECONNCLOSED", "ECONNRESET", "ENOTOPEN", "ELOGIN"]
    .includes(erro?.code);
}

function conectarSql() {
  if (!poolSql) {
    poolSql = sql.connect({
      server: process.env.DB_SERVER,
      port: Number(process.env.DB_PORT || 1433),
      database: process.env.DB_DATABASE,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      options: {
        // Padrões fechados: sem as variáveis definidas, a conexão vai
        // criptografada e exigindo certificado válido. Antes era o contrário
        // (encrypt caía para false, trustServerCertificate para true), então um
        // deploy que esquecesse o .env mandava usuário, senha e os dados da
        // frota em texto claro — e aceitava qualquer certificado no caminho.
        // Para um SQL Server com certificado self-signed, DB_TRUST_CERT=true.
        encrypt: process.env.DB_ENCRYPT !== "false",
        trustServerCertificate: process.env.DB_TRUST_CERT === "true",
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

// ===== Cache das consultas ao banco =====
// As telas se atualizam a cada 5 min e todas disparam juntas — no boot e depois
// em rajada alinhada. Sem cache, cada TV ligada custa ~7 consultas a cada 5 min,
// e as duas mais caras (/api/frota-localizacao e /api/frota-lideres) ordenam o
// dbo.TICKET inteiro com ROW_NUMBER(). São agregações que mudam devagar: dois
// minutos de atraso ninguém percebe num painel, e o banco para de levar rajada.
const SQL_CACHE_MS = 2 * 60 * 1000;
const cacheSql = new Map(); // chave -> { dados, em }
const emVooSql = new Map(); // chave -> Promise da consulta em andamento

async function comCacheSql(chave, produzir, ttlMs = SQL_CACHE_MS) {
  const salvo = cacheSql.get(chave);
  if (salvo && Date.now() - salvo.em < ttlMs) return salvo.dados;

  // Coalescência: as vistas abrem todas no mesmo instante (e podem ser várias
  // TVs). Sem isto, cada uma abriria a sua cópia da mesma consulta no banco.
  const emVoo = emVooSql.get(chave);
  if (emVoo) return emVoo;

  const tarefa = (async () => {
    try {
      const dados = await produzir();
      cacheSql.set(chave, { dados, em: Date.now() });
      return dados;
    } catch (erro) {
      if (ehErroDeConexao(erro)) derrubarPoolSql();
      // Painel de TV: número de dois minutos atrás é melhor que erro na tela.
      if (salvo) {
        const quando = new Date(salvo.em).toLocaleTimeString("pt-BR");
        console.warn(`${chave} falhou (${erro.message}); servindo o cache de ${quando}`);
        return salvo.dados;
      }
      throw erro;
    } finally {
      emVooSql.delete(chave);
    }
  })();

  emVooSql.set(chave, tarefa);
  return tarefa;
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
    const dados = await comCacheSql("frota", async () => {
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

      return {
        total,
        status,
        donut: [...donutMap]
          .map(([nome, qtd]) => ({ nome, qtd }))
          .sort((a, b) => b.qtd - a.qtd),
        tipos: consultaTipos.recordset
          .map((l) => ({ nome: String(l.tipo ?? "").trim() || "Sem tipo", qtd: l.qtd }))
          .sort((a, b) => b.qtd - a.qtd),
      };
    });
    res.json(dados);
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
    const dados = await comCacheSql("frota-localizacao", async () => {
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

      return {
        total: pontos.reduce((s, p) => s + p.maquinas, 0),
        pontos,
      };
    });
    res.json(dados);
  } catch (erro) {
    console.error("Erro ao consultar a localização da frota:", erro.message);
    res.status(502).json({ erro: "Erro ao consultar a localização da frota" });
  }
});

// ===== Frota por líder/coordenador (SQL Server: dbo.FROTA x dbo.TICKET) =====
// Parte da frota (só bens ATIVOS, como a página Frotas) e busca o coordenador
// no ticket mais recente do PREFIXO — mesmo critério de "atual" usado em
// /api/frota-localizacao. Bem sem ticket (ou com ticket sem coordenador) cai
// no balde LARSIL, que fica no meio da fileira.
// Com isso o total desta página bate com o total da página Frotas.

// Nome do balde do "resto", compartilhado com a página Colaboradores para as
// duas telas usarem o mesmo rótulo.
const SEM_COORDENADOR = "LARSIL";

// Os coordenadores vão do maior para o menor, e o LARSIL fica no meio da
// fileira em vez de disputar posição por tamanho: ele é o balde do "resto",
// então ladeado pelos coordenadores de verdade em vez de na ponta.
function ordenarComLarsilNoCentro(grupos) {
  const outros = grupos
    .filter((g) => g.nome !== SEM_COORDENADOR)
    .sort((a, b) => b.qtd - a.qtd);
  const larsil = grupos.filter((g) => g.nome === SEM_COORDENADOR);
  if (!larsil.length) return outros;

  // Com 2 coordenadores dá o meio exato; com um número ímpar deles, o LARSIL
  // cai um passo à direita do centro.
  const meio = Math.ceil(outros.length / 2);
  return [...outros.slice(0, meio), ...larsil, ...outros.slice(meio)];
}

app.get("/api/frota-lideres", async (_req, res) => {
  if (!process.env.DB_SERVER || !process.env.DB_USER) {
    return res.status(503).json({ erro: "Banco de dados não configurado — preencha o .env" });
  }

  try {
    const dados = await comCacheSql("frota-lideres", async () => {
      const tabela = identificadorSql(process.env.FROTA_TABELA, "dbo.FROTA");
      const colTipo = identificadorSql(process.env.FROTA_COL_TIPO, "CLASSE_ESPECIE");
      const colStatus = identificadorSql(process.env.FROTA_COL_STATUS, "STATUS");
      const pool = await conectarSql();
      const { recordset } = await pool.request().query(
        `SELECT COALESCE(NULLIF(LTRIM(RTRIM(t.COORDENADOR)), ''), '${SEM_COORDENADOR}') AS coordenador,
                COALESCE(NULLIF(LTRIM(RTRIM(f.[${colTipo}])), ''), 'Sem tipo') AS tipo,
                f.[${colStatus}] AS status,
                COUNT(*) AS qtd
           FROM ${tabela} f
           LEFT JOIN (
             SELECT PREFIXO, COORDENADOR,
                    ROW_NUMBER() OVER (
                      PARTITION BY PREFIXO ORDER BY DATA DESC, ID DESC
                    ) AS rn
               FROM dbo.TICKET
              WHERE LTRIM(RTRIM(ISNULL(PREFIXO, ''))) <> ''
           ) t ON t.PREFIXO = f.PREFIXO AND t.rn = 1
          WHERE UPPER(LTRIM(RTRIM(f.[STATUS_BEM]))) = 'ATIVO'
          GROUP BY COALESCE(NULLIF(LTRIM(RTRIM(t.COORDENADOR)), ''), '${SEM_COORDENADOR}'),
                   COALESCE(NULLIF(LTRIM(RTRIM(f.[${colTipo}])), ''), 'Sem tipo'),
                   f.[${colStatus}]`
      );

      const grupos = new Map();
      for (const l of recordset) {
        const nome = String(l.coordenador ?? "").trim() || SEM_COORDENADOR;
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
        g.qtd += l.qtd;
        g.tipos.set(l.tipo, (g.tipos.get(l.tipo) || 0) + l.qtd);
        // Status fora do STATUS_TILES (ROUBADO, PERDA TOTAL, sem status) entra
        // no total do coordenador, mas não vira contador — igual à página Frotas.
        const chave = STATUS_TILES[String(l.status ?? "").trim().toUpperCase()];
        if (chave) g.status[chave] += l.qtd;
      }

      const lideres = ordenarComLarsilNoCentro(
        [...grupos.values()].map((g) => ({
          nome: g.nome,
          qtd: g.qtd,
          status: g.status,
          tipos: [...g.tipos]
            .map(([nome, qtd]) => ({ nome, qtd }))
            .sort((a, b) => b.qtd - a.qtd),
        }))
      );

      return {
        total: lideres.reduce((s, l) => s + l.qtd, 0),
        lideres,
      };
    });
    res.json(dados);
  } catch (erro) {
    console.error("Erro ao consultar a frota por líder:", erro.message);
    res.status(502).json({ erro: "Erro ao consultar a frota por líder" });
  }
});

// ===== Apontamento das equipes (dbo.ORGANOGRAMA x dbo.BOLETIM_DIARIO x dbo.FOLGAS) =====
// Radar de equipe parada: quando cada equipe apontou produção pela última vez.
// Toda a regra fica aqui — a tela só pinta o que vem pronto.
//
// Armadilhas desta base (confirmadas no banco antes de escrever isto):
//
//  1. BOLETIM_DIARIO.[LÍDER] é o CÓDIGO DA EQUIPE, não a pessoa; a pessoa está
//     em NOME_DO_LIDER. FOLGAS.LIDER segue a mesma convenção. O casamento por
//     equipe leva um OR pelo nome porque a base tem código de equipe lançado
//     que não existe no ORGANOGRAMA (ex.: 700AC, 138 boletins em 15 dias, do
//     líder cuja equipe cadastrada é 542AB) — sem o OR ele apareceria parado
//     há 40 dias tendo apontado ontem.
//  2. Colunas acentuadas exigem colchetes: [DATA_EXECUÇÃO], [PRODUÇÃO], [LÍDER].
//  3. A base tem padding: todo join e todo filtro passa por LTRIM(RTRIM(...)).
//  4. Quem deve apontar é quem tem ORGANOGRAMA.APONTA = 'DIARIO' (47 das 78
//     linhas). COBRANCA_PAUSADA está zerado para todo mundo e não filtra nada;
//     APONTA = 'NAO' é que separa brigada de incêndio e administrativo, que
//     nunca apontaram e só entrariam na tela como ruído permanente.
//
// A matriz é MENSAL, igual à tela original: as colunas vão do dia 1º ao último
// dia do mês, e os dias que ainda não chegaram entram como caixa vazia. O mês
// inteiro sempre na tela deixa a largura das colunas estável do começo ao fim
// e dá, de bater o olho, a noção de quanto do mês já passou.
//
// A CONTAGEM de dias parados, essa sim, não pode depender do recorte exibido:
// no dia 1º ela enxergaria um dia só e uma equipe parada há três semanas
// apareceria zerada — verde na tela. Roda sempre sobre a janela abaixo,
// atravessando a virada do mês, independente do que está sendo desenhado.
const APONTAMENTO_LOOKBACK_DIAS = 45;

// Sábado ainda é dia cobrado; domingo não. Índice de Date.getDay().
const DOMINGO = 0;

// Dias ÚTEIS parados -> cor do semáforo (regra do doc de apontamento).
function estadoApontamento(diasUteis, nunca) {
  if (nunca) return "nunca";
  if (diasUteis <= 1) return "ok";
  if (diasUteis <= 3) return "atencao";
  return "critico";
}

const iso = (data) => data.toISOString().slice(0, 10);

app.get("/api/apontamento", async (_req, res) => {
  if (!process.env.DB_SERVER || !process.env.DB_USER) {
    return res.status(503).json({ erro: "Banco de dados não configurado — preencha o .env" });
  }

  try {
    const dados = await comCacheSql("apontamento", async () => {
      // A data de referência é calculada AQUI, não com GETDATE(): o servidor
      // roda em UTC no Railway e viraria o dia três horas antes de Brasília.
      // E é ONTEM, não hoje — o boletim do dia ainda está sendo lançado, então
      // cobrar hoje pintaria a tela de vermelho toda manhã.
      const agora = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
      const ate = new Date(Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate() - 1));

      // O que a tela mostra: o mês inteiro da data de referência. Dia 0 do mês
      // seguinte é o último dia deste — resolve fevereiro e ano bissexto sem
      // tabela de dias por mês.
      const inicioMes = new Date(Date.UTC(ate.getUTCFullYear(), ate.getUTCMonth(), 1));
      const fimMes = new Date(Date.UTC(ate.getUTCFullYear(), ate.getUTCMonth() + 1, 0));

      // O que a conta enxerga: sempre os últimos 45 dias, atravessando a
      // virada do mês. As consultas puxam do mais antigo dos dois inícios.
      const inicioCalculo = new Date(ate);
      inicioCalculo.setUTCDate(inicioCalculo.getUTCDate() - (APONTAMENTO_LOOKBACK_DIAS - 1));
      const de = inicioCalculo < inicioMes ? inicioCalculo : inicioMes;

      const pool = await conectarSql();
      const req1 = pool.request();
      req1.input("ate", sql.Date, iso(ate));

      // Sai do ORGANOGRAMA com OUTER APPLY (não do boletim com GROUP BY): a
      // equipe que parou de apontar não tem linha no fato, e é justamente a
      // que precisa aparecer.
      const { recordset: linhas } = await req1.query(
        `WITH equipes AS (
           SELECT LTRIM(RTRIM(o.EQUIPE)) AS EQUIPE,
                  MAX(LTRIM(RTRIM(o.LIDER)))                    AS LIDER,
                  MAX(LTRIM(RTRIM(ISNULL(o.COORDENADOR, ''))))  AS COORDENADOR,
                  MAX(LTRIM(RTRIM(ISNULL(o.SUPERVISOR, ''))))   AS SUPERVISOR,
                  MAX(LTRIM(RTRIM(ISNULL(o.ATIVIDADE, ''))))    AS ATIVIDADE,
                  MAX(LTRIM(RTRIM(ISNULL(o.PROJETO, ''))))      AS PROJETO
             FROM dbo.ORGANOGRAMA o
            WHERE LTRIM(RTRIM(ISNULL(o.EQUIPE, ''))) <> ''
              AND LTRIM(RTRIM(ISNULL(o.LIDER, ''))) <> ''
              AND LTRIM(RTRIM(ISNULL(o.PROJETO, ''))) <> '400'
              AND ISNULL(o.COBRANCA_PAUSADA, 0) = 0
              AND UPPER(LTRIM(RTRIM(ISNULL(o.APONTA, '')))) = 'DIARIO'
            GROUP BY LTRIM(RTRIM(o.EQUIPE))
         )
         SELECT e.EQUIPE, e.LIDER, e.COORDENADOR, e.SUPERVISOR, e.ATIVIDADE, e.PROJETO,
                -- Sai como texto, não como date: o driver devolveria um Date do
                -- JS à meia-noite, e num servidor a leste de Greenwich o
                -- toISOString() dele cairia no dia anterior.
                CONVERT(char(10), u.DATA_EXECUCAO, 23) AS ULTIMO,
                u.EQUIPE_BOLETIM, u.SERVICO, u.FAZENDA, u.TALHAO,
                u.PRODUCAO, u.STATUS,
                DATEDIFF(day, u.DATA_EXECUCAO, @ate) AS DIAS_PARADO
           FROM equipes e
          OUTER APPLY (
            SELECT TOP 1
                   CONVERT(date, b.[DATA_EXECUÇÃO])          AS DATA_EXECUCAO,
                   LTRIM(RTRIM(ISNULL(b.[LÍDER], '')))       AS EQUIPE_BOLETIM,
                   LTRIM(RTRIM(ISNULL(b.[SERVIÇO], '')))     AS SERVICO,
                   LTRIM(RTRIM(ISNULL(b.FAZENDA, '')))       AS FAZENDA,
                   LTRIM(RTRIM(ISNULL(b.TALHAO, '')))        AS TALHAO,
                   b.[PRODUÇÃO]                              AS PRODUCAO,
                   LTRIM(RTRIM(ISNULL(b.STATUS, '')))        AS STATUS
              FROM dbo.BOLETIM_DIARIO b
             WHERE (LTRIM(RTRIM(ISNULL(b.[LÍDER], ''))) = e.EQUIPE
                 OR LTRIM(RTRIM(ISNULL(b.NOME_DO_LIDER, ''))) = e.LIDER)
               AND b.[DATA_EXECUÇÃO] < DATEADD(day, 1, @ate)
             ORDER BY b.[DATA_EXECUÇÃO] DESC, b.ID DESC
          ) u`
      );

      // Boletins da janela, para o mini-heatmap. Vem por equipe E por nome
      // porque o casamento acima também aceita os dois (armadilha 1).
      const req2 = pool.request();
      req2.input("de", sql.Date, iso(de));
      req2.input("ate", sql.Date, iso(ate));
      const { recordset: celulas } = await req2.query(
        `SELECT LTRIM(RTRIM(ISNULL(b.[LÍDER], '')))        AS EQUIPE,
                LTRIM(RTRIM(ISNULL(b.NOME_DO_LIDER, '')))  AS LIDER,
                CONVERT(char(10), b.[DATA_EXECUÇÃO], 23)   AS DIA,
                COUNT(*)                                   AS QTD
           FROM dbo.BOLETIM_DIARIO b
          WHERE b.[DATA_EXECUÇÃO] >= @de
            AND b.[DATA_EXECUÇÃO] <  DATEADD(day, 1, @ate)
          GROUP BY LTRIM(RTRIM(ISNULL(b.[LÍDER], ''))),
                   LTRIM(RTRIM(ISNULL(b.NOME_DO_LIDER, ''))),
                   CONVERT(char(10), b.[DATA_EXECUÇÃO], 23)`
      );

      // Folgas da janela: sem elas, férias e atestado viram "equipe parada".
      const req3 = pool.request();
      req3.input("de", sql.Date, iso(de));
      req3.input("ate", sql.Date, iso(ate));
      const { recordset: folgas } = await req3.query(
        `SELECT LTRIM(RTRIM(ISNULL(f.LIDER, '')))          AS EQUIPE,
                LTRIM(RTRIM(ISNULL(f.NOME_DO_LIDER, '')))  AS LIDER,
                CONVERT(char(10), f.DATA, 23)              AS DIA,
                LTRIM(RTRIM(ISNULL(f.EVENTO, '')))         AS EVENTO,
                LTRIM(RTRIM(ISNULL(f.MOTIVO, '')))         AS MOTIVO
           FROM dbo.FOLGAS f
          WHERE f.DATA >= @de AND f.DATA <= @ate`
      );

      // Duas listas de datas, de propósito (ver o comentário do lookback):
      // `dias` é o que a tela desenha, `diasCalculo` é o que a conta enxerga.
      const listarDias = (inicio, fim) => {
        const lista = [];
        for (const d = new Date(inicio); d <= fim; d.setUTCDate(d.getUTCDate() + 1)) {
          lista.push({ iso: iso(d), dia: d.getUTCDate(), semana: d.getUTCDay() });
        }
        return lista;
      };
      const isoAte = iso(ate);
      const dias = listarDias(inicioMes, fimMes)
        .map((d) => ({ ...d, futuro: d.iso > isoAte }));
      const diasCalculo = listarDias(inicioCalculo, ate);

      // Índices por código de equipe E por nome de líder — as duas chaves que
      // o casamento aceita.
      const porChave = (registros, montar) => {
        const mapa = new Map();
        for (const r of registros) {
          for (const chave of [r.EQUIPE, r.LIDER]) {
            if (!chave) continue;
            if (!mapa.has(chave)) mapa.set(chave, new Map());
            mapa.get(chave).set(r.DIA, montar(r, mapa.get(chave).get(r.DIA)));
          }
        }
        return mapa;
      };
      const boletins = porChave(celulas, (r, atual) => (atual || 0) + r.QTD);
      const eventos = porChave(folgas, (r) => ({ evento: r.EVENTO || "FOLGA", motivo: r.MOTIVO }));

      const equipes = linhas.map((l) => {
        const doBoletim = boletins.get(l.EQUIPE) || boletins.get(l.LIDER) || new Map();
        const daFolga = eventos.get(l.EQUIPE) || eventos.get(l.LIDER) || new Map();
        const ultimo = l.ULTIMO || null;

        // Uma célula por dia do mês: dia que ainda não chegou, apontou, evento
        // registrado, não apontou, ou domingo (que não é cobrado).
        const grade = dias.map((d) => {
          if (d.futuro) return { dia: d.iso, estado: "futuro" };
          const qtd = doBoletim.get(d.iso) || 0;
          const evento = daFolga.get(d.iso);
          if (qtd > 0) return { dia: d.iso, estado: "b", qtd };
          if (evento) return { dia: d.iso, estado: "f", evento: evento.evento, motivo: evento.motivo };
          if (d.semana === DOMINGO) return { dia: d.iso, estado: "x" };
          return { dia: d.iso, estado: "n" };
        });

        // Quebra dos dias desde o último apontamento, do dia seguinte a ele
        // até a data de referência. São três baldes, e a separação é o ponto:
        // o que decide a cor é só o primeiro — senão toda equipe de férias
        // entraria na tela como crítica. Os outros dois são a JUSTIFICATIVA
        // que a tela de pendências mostra, para o número não ser um oráculo.
        //
        // Roda sobre diasCalculo, NÃO sobre a grade: a grade é o mês, e no
        // início dele ela não alcança quem parou no mês passado.
        let diasUteis = 0;      // sem boletim e sem evento -> é o que se cobra
        let justificados = 0;   // tem evento registrado (folga, férias, SA...)
        let domingos = 0;       // não é dia cobrado
        let ultimoEvento = null;
        for (const d of diasCalculo) {
          if (ultimo && d.iso <= ultimo) continue;
          const evento = daFolga.get(d.iso);
          if (evento) {
            justificados++;
            ultimoEvento = { dia: d.iso, evento: evento.evento, motivo: evento.motivo };
            continue;
          }
          if (d.semana === DOMINGO) { domingos++; continue; }
          diasUteis++;
        }
        // Sem nenhum boletim na janela o laço acima só enxerga o lookback; o
        // corrido (que pode ser bem maior) é quem manda nesse caso.
        if (!ultimo) diasUteis = Math.max(diasUteis, APONTAMENTO_LOOKBACK_DIAS);

        const eventoHoje = daFolga.get(iso(ate)) || null;

        return {
          equipe: l.EQUIPE,
          lider: l.LIDER,
          coordenador: l.COORDENADOR,
          supervisor: l.SUPERVISOR,
          atividade: l.ATIVIDADE,
          projeto: l.PROJETO,
          ultimo,
          // Quando o boletim veio lançado sob outro código de equipe, a tela
          // mostra qual — é o sintoma da armadilha 1 aparecendo na base.
          viaEquipe: l.EQUIPE_BOLETIM && l.EQUIPE_BOLETIM !== l.EQUIPE ? l.EQUIPE_BOLETIM : null,
          diasParado: l.DIAS_PARADO ?? null,
          diasUteisParado: diasUteis,
          // A conta aberta, para a tela de pendências poder explicar o número
          // em vez de só exibi-lo.
          desdeUltimo: { uteisSemApontar: diasUteis, justificados, domingos },
          ultimoEvento,
          estado: estadoApontamento(diasUteis, !ultimo),
          evento: eventoHoje ? eventoHoje.evento : null,
          motivo: eventoHoje ? eventoHoje.motivo : null,
          servico: l.SERVICO || null,
          fazenda: l.FAZENDA || null,
          talhao: l.TALHAO || null,
          producao: l.PRODUCAO == null ? null : Number(l.PRODUCAO),
          status: l.STATUS || null,
          grade,
        };
      });

      // Urgência primeiro: nunca apontou, depois quem está parado há mais
      // dias úteis, e o corrido como critério de desempate.
      const peso = { nunca: 0, critico: 1, atencao: 2, ok: 3 };
      equipes.sort((a, b) =>
        peso[a.estado] - peso[b.estado] ||
        b.diasUteisParado - a.diasUteisParado ||
        (b.diasParado ?? 0) - (a.diasParado ?? 0) ||
        a.equipe.localeCompare(b.equipe)
      );

      const resumo = { total: equipes.length, ok: 0, atencao: 0, critico: 0, nunca: 0 };
      for (const e of equipes) resumo[e.estado]++;
      resumo.aderencia = resumo.total ? Math.round((resumo.ok / resumo.total) * 100) : 0;

      return {
        dataRef: iso(ate),
        mes: iso(inicioMes).slice(0, 7), // "YYYY-MM" — a tela escreve o nome
        lookbackDias: APONTAMENTO_LOOKBACK_DIAS,
        dias,
        resumo,
        equipes,
      };
    });
    res.json(dados);
  } catch (erro) {
    console.error("Erro ao consultar o apontamento:", erro.message);
    res.status(502).json({ erro: "Erro ao consultar o banco de apontamento" });
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
    const dados = await comCacheSql("ativos-ti", async () => {
      const pool = await conectarSql();
      const { recordset } = await pool.request().query(
        `SELECT [TIPO] AS tipo, COUNT(*) AS qtd
           FROM inventario.ATIVOS
          GROUP BY [TIPO]`
      );

      const contagem = new Map(
        recordset.map((l) => [String(l.tipo ?? "").trim().toUpperCase(), l.qtd])
      );

      return {
        tipos: TIPOS_ATIVOS_TI.map((tipo) => ({ nome: tipo, qtd: contagem.get(tipo) || 0 })),
      };
    });
    res.json(dados);
  } catch (erro) {
    console.error("Erro ao consultar ativos de TI:", erro.message);
    res.status(502).json({ erro: "Erro ao consultar o banco de ativos de TI" });
  }
});

// ===== Colaboradores (SQL Server) =====
// Efetivo de dbo.COLABORADORES: o total do quadro e a contagem por CLASSE (a
// sigla do cargo: TRF, ADM, OPF...). A tabela guarda só quem está no quadro
// hoje — quem sai vai para COLABORADORES_HISTORICO — então COUNT(*) já é o
// efetivo atual, sem filtro de situação.
//
// O quadro sai agrupado por COORDENADOR, como na Frota por Líder: um card por
// coordenador de campo, com as classes dentro. Quem responde a outro
// coordenador (sócios/administrativo) ou está sem coordenador cai no LARSIL.

// Sem espaço nas pontas e em caixa alta, para "ADM " e "adm" não virarem duas
// linhas na contagem. Vai no SELECT e no GROUP BY, por isso o helper em vez
// do texto repetido.
const CLASSE_NORMALIZADA = `UPPER(LTRIM(RTRIM(ISNULL([CLASSE], ''))))`;

// ===== Remendo: gente que já trabalha aqui mas ainda não está na tabela =====
// A equipe tem dois coordenadores; dbo.COLABORADORES só tem um cadastrado, e
// o painel mostrava COF 1. Enquanto o cadastro não sai, a contagem entra aqui.
//
// APAGUE a entrada assim que a pessoa for cadastrada — a partir daí o banco já
// a conta, e esta linha passa a contar a mesma pessoa duas vezes.
const AJUSTE_MANUAL_CLASSE = { COF: 1 };

// O ajuste vale para o card da classe e para o total: se entrasse só na classe,
// a soma dos cards ficaria um a mais que o "no quadro" e o painel se
// contradiria na mesma tela.
function aplicarAjusteManual(classes) {
  const ajustadas = classes.map((c) => ({
    ...c,
    qtd: c.qtd + (AJUSTE_MANUAL_CLASSE[c.nome] || 0),
  }));

  // Classe ajustada que não veio do banco vira card novo. Acontece se o único
  // coordenador cadastrado sair: sem isto o card sumiria da TV, mesmo com o
  // coordenador do remendo ainda na equipe.
  for (const [nome, qtd] of Object.entries(AJUSTE_MANUAL_CLASSE)) {
    if (!ajustadas.some((c) => c.nome === nome)) ajustadas.push({ nome, qtd });
  }

  // O front desenha na ordem em que recebe, e o SQL ordenava por quantidade —
  // reordena para o ajuste não deixar um card grande depois de um pequeno.
  return ajustadas.sort((a, b) => b.qtd - a.qtd);
}

const TOTAL_AJUSTE_MANUAL = Object.values(AJUSTE_MANUAL_CLASSE).reduce((s, n) => s + n, 0);

// Coordenadores de campo, os que ganham card próprio na tela. dbo.COLABORADORES
// tem outros nomes na coluna COORDENADOR (sócios, que respondem pelo
// administrativo); esses e quem está sem coordenador entram no LARSIL, do mesmo
// jeito que na Frota por Líder.
//
// Os nomes vão como estão no banco, em caixa alta — a comparação é feita sobre
// o valor já normalizado. Coordenador novo em campo: acrescente aqui.
const COORDENADORES_CAMPO = ["TONIEL RODRIGUES", "FABIO BRUM CAMPELO"];

app.get("/api/colaboradores", async (_req, res) => {
  if (!process.env.DB_SERVER || !process.env.DB_USER) {
    return res.status(503).json({ erro: "Banco de dados não configurado — preencha o .env" });
  }

  try {
    const dados = await comCacheSql("colaboradores", async () => {
      const pool = await conectarSql();
      const consultaClasses = await pool.request().query(
        `SELECT UPPER(LTRIM(RTRIM(ISNULL([COORDENADOR], '')))) AS coordenador,
                ${CLASSE_NORMALIZADA} AS classe,
                COUNT(*) AS qtd
           FROM dbo.COLABORADORES
          GROUP BY UPPER(LTRIM(RTRIM(ISNULL([COORDENADOR], '')))), ${CLASSE_NORMALIZADA}`
      );

      const grupos = new Map();
      for (const l of consultaClasses.recordset) {
        const bruto = String(l.coordenador ?? "").trim();
        const nome = COORDENADORES_CAMPO.includes(bruto) ? bruto : SEM_COORDENADOR;
        let g = grupos.get(nome);
        if (!g) grupos.set(nome, (g = { nome, qtd: 0, classes: new Map() }));
        g.qtd += l.qtd;
        const classe = l.classe || "Sem classe";
        g.classes.set(classe, (g.classes.get(classe) || 0) + l.qtd);
      }

      // O coordenador que falta cadastrar não tem linha na tabela, então não tem
      // coordenador próprio para cair — entra no LARSIL, junto com o resto de
      // quem está fora dos dois cards de campo.
      const larsil = grupos.get(SEM_COORDENADOR)
        || { nome: SEM_COORDENADOR, qtd: 0, classes: new Map() };
      grupos.set(SEM_COORDENADOR, larsil);
      larsil.qtd += TOTAL_AJUSTE_MANUAL;

      const coordenadores = ordenarComLarsilNoCentro(
        [...grupos.values()].map((g) => {
          const classes = [...g.classes].map(([nome, qtd]) => ({ nome, qtd }));
          return {
            nome: g.nome,
            qtd: g.qtd,
            // O remendo do coordenador não cadastrado só se aplica ao LARSIL;
            // os outros cards só precisam da ordenação por tamanho.
            classes: g.nome === SEM_COORDENADOR
              ? aplicarAjusteManual(classes)
              : classes.sort((a, b) => b.qtd - a.qtd),
          };
        })
      );

      return {
        total: coordenadores.reduce((s, c) => s + c.qtd, 0),
        coordenadores,
      };
    });
    res.json(dados);
  } catch (erro) {
    console.error("Erro ao consultar colaboradores:", erro.message);
    res.status(502).json({ erro: "Erro ao consultar o banco de colaboradores" });
  }
});

// ===== Helpdesk (SQL Server) =====
// Chamados recentes de dbo.HELPDESK_CHAMADOS, separados em três colunas por
// status. ID_SOLICITANTE, ATRIBUIDO_A e RESOLVIDO_POR são IDs de
// dbo.HELPDESK_USUARIOS, por isso os JOINs para trazer o nome de quem abriu,
// de quem atende e de quem resolveu.
//
// As colunas do painel NÃO são os status do helpdesk: o de-para está em
// COLUNA_POR_STATUS, logo abaixo, e é onde um status novo entra.
// As colunas do quadro, na ordem em que a tela as mostra.
const COLUNAS_HELPDESK = ["ABERTO", "EM_ATENDIMENTO", "RESOLVIDO"];

// De-para do STATUS cru da tabela para a coluna do quadro. Um status novo no
// helpdesk que não esteja aqui simplesmente não aparece no painel — é a trava
// que impede uma coluna fantasma surgir sozinha na TV.
//
// AGUARDANDO_APROVACAO nasceu depois no helpdesk e cai em "Em atendimento"
// (decisão do Lucas): para quem olha o painel, chamado esperando aprovação é
// chamado em curso, não um quarto estado. FECHADO fica de fora de propósito —
// são 282 e nenhum deles é notícia.
const COLUNA_POR_STATUS = {
  ABERTO: "ABERTO",
  EM_ATENDIMENTO: "EM_ATENDIMENTO",
  AGUARDANDO_APROVACAO: "EM_ATENDIMENTO",
  RESOLVIDO: "RESOLVIDO",
};

// O de-para vira um CASE no SQL para o banco já agrupar e numerar pela COLUNA.
// Fazer a soma no JS seria mais simples e estaria errado: o ROW_NUMBER daria
// os 5 mais recentes DE CADA status cru, e "Em atendimento" viria com 10 —
// cinco em atendimento e cinco aguardando aprovação — em vez dos 5 mais
// recentes da coluna. `alias` é o prefixo da tabela ("c." ou "").
const colunaHelpdeskSql = (alias = "") =>
  `CASE UPPER(LTRIM(RTRIM(${alias}STATUS)))
     ${Object.entries(COLUNA_POR_STATUS)
       .map(([bruto, coluna]) => `WHEN '${bruto}' THEN '${coluna}'`)
       .join("\n     ")}
   END`;

const CHAMADOS_POR_COLUNA = 5;

app.get("/api/helpdesk-chamados", async (_req, res) => {
  if (!process.env.DB_SERVER || !process.env.DB_USER) {
    return res.status(503).json({ erro: "Banco de dados não configurado — preencha o .env" });
  }

  try {
    // Cache mais curto que o resto: aqui a tela destaca chamado novo (ver
    // .chamado--novo / o toast no index.html), então atraso se nota.
    const dados = await comCacheSql("helpdesk-chamados", async () => {
      const pool = await conectarSql();
      const statusIn = Object.keys(COLUNA_POR_STATUS).map((s) => `'${s}'`).join(", ");

      // ROW_NUMBER pela coluna: cada uma recebe seus N chamados mais recentes
      // (resolvidos ordenam por RESOLVIDO_EM; os demais, por CRIADO_EM).
      const { recordset } = await pool.request().query(
        `SELECT id, titulo, prioridade, status, criadoEm, resolvidoEm, solicitante, atribuidoA, resolvidoPor
           FROM (
             SELECT c.ID AS id, c.TITULO AS titulo, c.PRIORIDADE AS prioridade,
                    ${colunaHelpdeskSql("c.")} AS status,
                    c.CRIADO_EM AS criadoEm, c.RESOLVIDO_EM AS resolvidoEm,
                    usol.NOME AS solicitante, ua.NOME AS atribuidoA, ur.NOME AS resolvidoPor,
                    ROW_NUMBER() OVER (
                      PARTITION BY ${colunaHelpdeskSql("c.")}
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

      // Total por coluna (as colunas mostram só os recentes; o contador, tudo).
      const totais = await pool.request().query(
        `SELECT ${colunaHelpdeskSql()} AS status, COUNT(*) AS qtd
           FROM dbo.HELPDESK_CHAMADOS
          WHERE UPPER(LTRIM(RTRIM(STATUS))) IN (${statusIn})
          GROUP BY ${colunaHelpdeskSql()}`
      );

      const colunas = Object.fromEntries(COLUNAS_HELPDESK.map((s) => [s, []]));
      for (const linha of recordset) colunas[linha.status]?.push(linha);

      const contagem = Object.fromEntries(COLUNAS_HELPDESK.map((s) => [s, 0]));
      for (const linha of totais.recordset) {
        if (linha.status in contagem) contagem[linha.status] = linha.qtd;
      }

      return { colunas, contagem };
    }, 30 * 1000);
    res.json(dados);
  } catch (erro) {
    console.error("Erro ao consultar os chamados do helpdesk:", erro.message);
    res.status(502).json({ erro: "Erro ao consultar o banco do helpdesk" });
  }
});

// ===== Reservas de veículos (SQL Server) =====
// Quem está com cada carro agora. Os veículos vêm de dbo.VEICULOS_TESTE (só os
// ativos — carro desativado saiu da frota e não deve ocupar espaço na TV) e as
// reservas de dbo.VEICULOS_RESERVAS_TESTE, com o nome de quem reservou vindo de
// dbo.USUARIOS_RESERVA_TESTE pelo id_usuario.
//
// Na tabela, `data` é DATE e `inicio`/`fim` são TIME — três campos separados,
// sem fuso nenhum: são a data e as horas do relógio de quem reserva. O driver
// devolveria os três como Date em UTC (o TIME vira 1970-01-01T07:00:00Z), e aí
// qualquer comparação com "agora" erraria pelo deslocamento do fuso. Por isso o
// SQL já converte para texto ('2026-08-01', '07:00') e a comparação é feita
// entre strings — que, nesses formatos, ordenam igual ao relógio.
const FUSO_RESERVAS = "America/Sao_Paulo";

// Uma reserva de daqui a três semanas não interessa ao painel; a janela evita
// arrastar a tabela inteira só para mostrar as próximas do mural.
const DIAS_AGENDA_RESERVAS = 14;

// Quantas reservas futuras o mural lateral mostra. O mural rola, mas numa TV
// ninguém rola: o que passar disso não seria visto por ninguém.
const PROXIMAS_RESERVAS = 5;

// Data e hora do relógio de Telêmaco Borba, no mesmo formato que sai do SQL.
// A TV pode estar em qualquer fuso, e o Railway roda em UTC — usar o relógio do
// processo faria o painel trocar de turno na hora errada.
function agoraNoFuso() {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO_RESERVAS,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const p = Object.fromEntries(partes.map((x) => [x.type, x.value]));
  return { data: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
}

// Soma dias a uma data "YYYY-MM-DD" (UTC de propósito: é só aritmética de
// calendário sobre a data já resolvida no fuso certo, sem horário no meio).
function somarDias(data, dias) {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

app.get("/api/veiculos-reservas", async (_req, res) => {
  if (!process.env.DB_SERVER || !process.env.DB_USER) {
    return res.status(503).json({ erro: "Banco de dados não configurado — preencha o .env" });
  }

  try {
    const { data: hoje, hora: agora } = agoraNoFuso();

    // O cache guarda só o que veio do banco — a janela consultada vira o dia
    // seguinte sozinha, no máximo um minuto depois da virada. A classificação
    // (em uso / livre) depende do relógio e fica fora dele: com ela dentro, um
    // carro que soltasse às 10h continuaria "em uso" até o cache vencer.
    const { veiculos, reservas } = await comCacheSql("veiculos-reservas", async () => {
      const pool = await conectarSql();

      // A placa não sobe: o card identifica o carro pelo prefixo e pela arte do
      // modelo (ver ARTES em reservas-veiculos.js), e o modelo vai junto porque
      // é ele que escolhe a figura.
      const consultaVeiculos = await pool.request().query(
        `SELECT id, LTRIM(RTRIM(prefixo)) AS prefixo, LTRIM(RTRIM(modelo)) AS modelo
           FROM dbo.VEICULOS_TESTE
          WHERE ativo = 1
          ORDER BY prefixo`
      );

      const consultaReservas = await pool.request()
        .input("de", sql.Date, hoje)
        .input("ate", sql.Date, somarDias(hoje, DIAS_AGENDA_RESERVAS))
        .query(
          `SELECT r.id, r.id_veiculo AS idVeiculo,
                  CONVERT(varchar(10), r.data, 23) AS data,
                  CONVERT(varchar(5), r.inicio, 108) AS inicio,
                  CONVERT(varchar(5), r.fim, 108) AS fim,
                  LTRIM(RTRIM(ISNULL(r.motivo, ''))) AS motivo,
                  LTRIM(RTRIM(ISNULL(u.nome, ''))) AS usuario
             FROM dbo.VEICULOS_RESERVAS_TESTE r
             LEFT JOIN dbo.USUARIOS_RESERVA_TESTE u ON u.id = r.id_usuario
            WHERE LOWER(LTRIM(RTRIM(r.status))) = 'active'
              AND r.data >= @de AND r.data <= @ate
            ORDER BY r.data, r.inicio`
        );

      return { veiculos: consultaVeiculos.recordset, reservas: consultaReservas.recordset };
    }, 60 * 1000);

    // Reservas por veículo, já na ordem cronológica que veio do SQL.
    const porVeiculo = new Map();
    for (const r of reservas) {
      if (!porVeiculo.has(r.idVeiculo)) porVeiculo.set(r.idVeiculo, []);
      porVeiculo.get(r.idVeiculo).push(r);
    }

    // Terminou = já passou do fim (só faz sentido para as de hoje; as de amanhã
    // em diante são todas futuras).
    const emAndamento = (r) => r.data === hoje && r.inicio <= agora && agora < r.fim;
    const futura = (r) => r.data > hoje || (r.data === hoje && r.inicio > agora);

    const lista = veiculos.map((v) => {
      const doVeiculo = porVeiculo.get(v.id) || [];
      const atual = doVeiculo.find(emAndamento) || null;
      const proxima = doVeiculo.find(futura) || null;
      return {
        id: v.id,
        prefixo: v.prefixo,
        modelo: v.modelo,
        // "reservado" = livre agora, mas com saída marcada ainda para hoje.
        estado: atual ? "em-uso" : (proxima?.data === hoje ? "reservado" : "livre"),
        atual,
        proxima,
        // Quantas reservas o carro tem hoje (inclui a que está rodando).
        hoje: doVeiculo.filter((r) => r.data === hoje).length,
      };
    });

    // Mural lateral: as próximas saídas da frota inteira, com o carro junto.
    const nomeVeiculo = new Map(veiculos.map((v) => [v.id, v]));
    const proximas = reservas
      .filter((r) => futura(r) && nomeVeiculo.has(r.idVeiculo))
      .slice(0, PROXIMAS_RESERVAS)
      .map((r) => ({ ...r, prefixo: nomeVeiculo.get(r.idVeiculo).prefixo }));

    res.json({
      hoje,
      agora,
      resumo: {
        total: lista.length,
        emUso: lista.filter((v) => v.estado === "em-uso").length,
        reservados: lista.filter((v) => v.estado === "reservado").length,
        livres: lista.filter((v) => v.estado === "livre").length,
      },
      veiculos: lista,
      proximas,
    });
  } catch (erro) {
    console.error("Erro ao consultar as reservas de veículos:", erro.message);
    res.status(502).json({ erro: "Erro ao consultar o banco de reservas de veículos" });
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

// ===== Tratador de erros (último middleware) =====
// Sem ele o Express usa o handler padrão, que devolve o stack trace no corpo
// da resposta quando NODE_ENV não é "production" — caminho absoluto do projeto,
// versão de cada pacote em node_modules, e sem exigir login. O detalhe fica no
// log; para quem chamou vai só o código e uma frase.
// eslint-disable-next-line no-unused-vars -- o Express só reconhece o handler de erro com 4 argumentos
app.use((erro, req, res, _next) => {
  const status = erro.status || erro.statusCode || 500;
  console.error(`Erro em ${req.method} ${req.path}:`, erro.message);

  if (res.headersSent) return;
  if (status === 413) return res.status(413).json({ erro: "Conteúdo grande demais" });
  if (status === 400 && erro.type === "entity.parse.failed") {
    return res.status(400).json({ erro: "JSON inválido" });
  }
  res.status(status >= 400 && status < 500 ? status : 500).json({ erro: "Erro interno" });
});

const PORTA = process.env.PORT || 3000;
app.listen(PORTA, () => {
  console.log(`Dashboard rodando em http://localhost:${PORTA}`);
});
