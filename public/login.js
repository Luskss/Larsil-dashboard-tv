// Lógica da tela de login. Ficava inline em login.html, foi extraída para um
// arquivo próprio para o CSP poder usar `script-src 'self'` (sem 'unsafe-inline').

const form = document.querySelector("#form-login");
const erroEl = document.querySelector("#erro-login");
const botao = form.querySelector(".btn-entrar");

// Para onde ir após o login. Só aceita caminho interno (começa com "/" e
// não com "//" nem "/\") — impede open redirect via ?proximo=https://evil.com.
function destinoSeguro(valor) {
  return valor && /^\/(?![/\\])/.test(valor) ? valor : "./index.html";
}
const proximo = destinoSeguro(new URLSearchParams(location.search).get("proximo"));

form.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  erroEl.textContent = "";
  botao.disabled = true;
  try {
    const resp = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usuario: form.usuario.value.trim(),
        senha: form.senha.value,
      }),
    });
    const dados = await resp.json();
    if (!resp.ok) {
      erroEl.textContent = dados.erro || "Usuário ou senha inválidos";
      return;
    }
    location.href = proximo;
  } catch {
    erroEl.textContent = "Erro ao conectar com o servidor.";
  } finally {
    botao.disabled = false;
  }
});
