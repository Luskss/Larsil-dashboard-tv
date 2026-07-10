// Login simples (usuário/senha único, compartilhado pela equipe) com sessão
// via cookie assinado — sem tabela de usuários, sem dependências novas.
//
// Variáveis de ambiente (Railway ou .env):
//   DASHBOARD_USER       -> usuário exigido no login
//   DASHBOARD_PASS_HASH  -> hash da senha, gerado com `node auth.js minha-senha`
//   SESSION_SECRET       -> string aleatória longa, só para assinar o cookie
//
// O cookie guarda só "usuario:expiraEm:assinatura" — nada de sessão em banco.

import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";
import { pathToFileURL } from "node:url";

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

function senhaConfere(senha, hash) {
  const [sal, derivadoHex] = String(hash || "").split(":");
  if (!sal || !derivadoHex) return false;
  const derivado = scryptSync(senha, sal, 64);
  const esperado = Buffer.from(derivadoHex, "hex");
  return derivado.length === esperado.length && timingSafeEqual(derivado, esperado);
}

// ===== Cookie de sessão (HMAC — sem estado no servidor) =====
function assinar(texto) {
  return createHmac("sha256", segredo()).update(texto).digest("hex");
}

function criarCookie(usuario) {
  const expiraEm = Date.now() + DURACAO_MS;
  const carga = `${usuario}:${expiraEm}`;
  return `${carga}:${assinar(carga)}`;
}

function lerCookie(valor) {
  if (!valor) return null;
  const partes = String(valor).split(":");
  if (partes.length !== 3) return null;
  const [usuario, expiraEmStr, assinatura] = partes;
  const carga = `${usuario}:${expiraEmStr}`;
  const esperada = Buffer.from(assinar(carga));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return null;
  if (Date.now() > Number(expiraEmStr)) return null;
  return { usuario };
}

export function validarLogin(usuario, senha) {
  const usuarioEsperado = process.env.DASHBOARD_USER || "";
  const hashEsperado = process.env.DASHBOARD_PASS_HASH || "";
  if (!usuarioEsperado || !hashEsperado) return false;
  // Compara usuário em tempo constante também (evita enumeração por timing).
  const usuarioOk =
    Buffer.from(usuario || "").length === Buffer.from(usuarioEsperado).length &&
    timingSafeEqual(Buffer.from(usuario || ""), Buffer.from(usuarioEsperado));
  return usuarioOk && senhaConfere(senha, hashEsperado);
}

export function iniciarSessao(res, usuario) {
  res.cookie(COOKIE, criarCookie(usuario), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: DURACAO_MS,
  });
}

export function encerrarSessao(res) {
  res.clearCookie(COOKIE);
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
// usa (tema.css); o resto — páginas e /api/* — exige sessão válida.
const LIVRES = new Set(["/login", "/logout", "/login.html", "/tema.css"]);

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
