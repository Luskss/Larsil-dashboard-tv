// Login simples (usuário/senha único, compartilhado pela equipe) com sessão
// via cookie assinado — sem tabela de usuários, sem dependências novas.
//
// Variáveis de ambiente (Railway ou .env):
//   DASHBOARD_USER       -> usuário exigido no login
//   DASHBOARD_PASS_HASH  -> hash da senha, gerado com `node auth.js minha-senha`
//   SESSION_SECRET       -> string aleatória longa, só para assinar o cookie
//
// O cookie guarda só "usuario:versao:expiraEm:assinatura" — nada de sessão em
// banco. A "versao" é um resumo do DASHBOARD_PASS_HASH: trocar a senha muda a
// versão e derruba todas as sessões abertas (ver versaoSenha).

import { randomBytes, scrypt, scryptSync, timingSafeEqual, createHmac } from "node:crypto";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const scryptAsync = promisify(scrypt);

const COOKIE = "dashboard_sessao";
const DURACAO_MS = 12 * 60 * 60 * 1000; // 12 horas

function segredo() {
  const valor = process.env.SESSION_SECRET;
  if (!valor) throw new Error("SESSION_SECRET não configurado (.env ou painel do Railway)");
  return valor;
}

// ===== Hash de senha (scrypt, nativo do Node — sem instalar bcrypt) =====
export function gerarHash(senha) {
  const sal = randomBytes(16).toString("hex");
  const derivado = scryptSync(senha, sal, 64).toString("hex");
  return `${sal}:${derivado}`;
}

// Assíncrono de propósito: scryptSync trava o event loop por ~80ms, e o /login
// é aberto a quem não está logado — em rajada, isso sozinho derruba o
// dashboard. A versão async joga a derivação na thread pool.
async function senhaConfere(senha, hash) {
  const [sal, derivadoHex] = String(hash || "").split(":");
  if (!sal || !derivadoHex) return false;
  const derivado = await scryptAsync(senha, sal, 64);
  const esperado = Buffer.from(derivadoHex, "hex");
  return derivado.length === esperado.length && timingSafeEqual(derivado, esperado);
}

function comparaConstante(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

// ===== Cookie de sessão (HMAC — sem estado no servidor) =====
function assinar(texto) {
  return createHmac("sha256", segredo()).update(texto).digest("hex");
}

// Resumo curto da senha vigente, embutido no cookie. Como o servidor não
// guarda sessões, é o que permite revogá-las: ao trocar DASHBOARD_PASS_HASH a
// versão muda e todo cookie emitido antes deixa de validar.
function versaoSenha() {
  return assinar(`versao:${process.env.DASHBOARD_PASS_HASH || ""}`).slice(0, 16);
}

// O usuário vai em base64url para não colidir com o ":" que separa os campos
// (DASHBOARD_USER pode conter qualquer coisa).
function criarCookie(usuario) {
  const expiraEm = Date.now() + DURACAO_MS;
  const carga = `${Buffer.from(String(usuario)).toString("base64url")}:${versaoSenha()}:${expiraEm}`;
  return `${carga}:${assinar(carga)}`;
}

function lerCookie(valor) {
  if (!valor) return null;
  const partes = String(valor).split(":");
  if (partes.length !== 4) return null;
  const [usuarioB64, versao, expiraEmStr, assinatura] = partes;

  const carga = `${usuarioB64}:${versao}:${expiraEmStr}`;
  const esperada = Buffer.from(assinar(carga));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return null;

  // Senha trocada depois que o cookie foi emitido => sessão morta.
  if (!comparaConstante(versao, versaoSenha())) return null;
  if (Date.now() > Number(expiraEmStr)) return null;

  return { usuario: Buffer.from(usuarioB64, "base64url").toString() };
}

// Deriva a senha SEMPRE, mesmo com usuário errado: um `usuarioOk && ...` faria
// o scrypt rodar só quando o usuário existe, e a diferença de ~80ms na resposta
// entregaria o DASHBOARD_USER para quem estivesse medindo.
export async function validarLogin(usuario, senha) {
  const usuarioEsperado = process.env.DASHBOARD_USER || "";
  const hashEsperado = process.env.DASHBOARD_PASS_HASH || "";
  if (!usuarioEsperado || !hashEsperado) return false;

  const usuarioOk = comparaConstante(usuario || "", usuarioEsperado);
  const senhaOk = await senhaConfere(String(senha ?? ""), hashEsperado);
  return usuarioOk && senhaOk;
}

// Secure sempre que a conexão for HTTPS (no Railway, sempre). Não amarramos ao
// NODE_ENV: se ele vier vazio no deploy, o cookie de sessão sairia sem Secure e
// viajaria em claro. Em desenvolvimento local (http://localhost) ele fica sem a
// flag, senão o navegador recusaria o cookie.
function ehHttps(req) {
  return (
    process.env.NODE_ENV === "production" ||
    req.secure ||
    req.headers["x-forwarded-proto"] === "https"
  );
}

export function iniciarSessao(req, res, usuario) {
  res.cookie(COOKIE, criarCookie(usuario), {
    httpOnly: true,
    sameSite: "strict",
    secure: ehHttps(req),
    maxAge: DURACAO_MS,
  });
}

export function encerrarSessao(req, res) {
  // As opções precisam bater com as do set, senão o navegador ignora a limpeza.
  res.clearCookie(COOKIE, {
    httpOnly: true,
    sameSite: "strict",
    secure: ehHttps(req),
  });
}

// Sem dependência de cookie-parser: o cabeçalho Cookie é só "chave=valor; ..."
// separado por "; ", então um split resolve sem precisar de um pacote.
function lerCookieRequisicao(req, nome) {
  const cabecalho = req.headers.cookie;
  if (!cabecalho) return null;
  for (const parte of cabecalho.split(";")) {
    const igual = parte.indexOf("=");
    if (igual === -1) continue;
    const chave = parte.slice(0, igual).trim();
    if (chave === nome) return decodeURIComponent(parte.slice(igual + 1).trim());
  }
  return null;
}

// Middleware: libera /login, /logout, a página de login e os assets que ela
// usa (tema.css e o Tailwind self-hosted); o resto — páginas e /api/* — exige
// sessão válida.
const LIVRES = new Set([
  "/login",
  "/logout",
  "/login.html",
  "/login.js",
  "/tema.css",
  "/vendor/tailwind-browser.js",
]);

export function exigirSessao(req, res, next) {
  if (LIVRES.has(req.path)) return next();

  const sessao = lerCookie(lerCookieRequisicao(req, COOKIE));
  if (!sessao) {
    if (req.path.startsWith("/api/")) return res.status(401).json({ erro: "Sessão expirada, faça login novamente" });
    const proximo = encodeURIComponent(req.originalUrl);
    return res.redirect(`/login.html?proximo=${proximo}`);
  }
  req.usuario = sessao.usuario;
  next();
}

// `node auth.js <senha>` imprime o hash pronto para colar em DASHBOARD_PASS_HASH.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const senha = process.argv[2];
  if (!senha) {
    console.error("Uso: node auth.js <senha>");
    process.exit(1);
  }
  console.log(gerarHash(senha));
}
