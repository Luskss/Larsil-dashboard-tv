// Cotações do dashboard (blocos 3x1 empilhados à direita do relógio):
//   Dólar -> /api/dolar (AwesomeAPI, USD-BRL, com a variação do dia)
//   Soja  -> /api/soja  (indicador CEPEA/ESALQ, R$ por saca)
//   Café  -> /api/cafe  (indicador CEPEA/ESALQ, R$ por saca)
//   Milho -> /api/milho (indicador CEPEA/ESALQ, R$ por saca)
// Os fetches são no servidor porque o CSP da página só permite
// connect-src 'self'.

const INTERVALO_ATUALIZACAO_MS = 5 * 60 * 1000; // mesmo ritmo do clima

const FORMATO_REAL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

async function buscar(rota) {
  const resp = await fetch(rota);
  const dados = await resp.json();
  if (!resp.ok) {
    // "detalhe" é o motivo cru vindo da API externa — vale no console para
    // diagnosticar sem precisar do log do servidor.
    throw new Error([dados.erro || `Falha em ${rota}`, dados.detalhe].filter(Boolean).join(" — "));
  }
  return dados;
}

async function atualizarDolar() {
  const elValor = document.querySelector("#dolar-valor");
  const elVariacao = document.querySelector("#dolar-variacao");

  try {
    const dados = await buscar("/api/dolar");
    elValor.textContent = FORMATO_REAL.format(dados.valor);

    // Seta + sinal deixam a variação legível de longe sem depender da cor.
    const alta = dados.variacao >= 0;
    elVariacao.textContent =
      `${alta ? "▲" : "▼"} ${Math.abs(dados.variacao).toFixed(2).replace(".", ",")}%`;
    elVariacao.classList.toggle("cotacao__extra--alta", alta);
    elVariacao.classList.toggle("cotacao__extra--baixa", !alta);
  } catch (erro) {
    console.error("Dólar:", erro.message);
    elValor.textContent = "R$ --,--";
    elVariacao.textContent = "—";
    elVariacao.classList.remove("cotacao__extra--alta", "cotacao__extra--baixa");
  }
}

// "sc de 60kg" -> "/sc": ao lado do valor só cabe a unidade, e no mercado a saca
// de soja é sempre a de 60kg. Serve para qualquer indicador do CEPEA ("@",
// "kg"...), sempre pegando o pedaço antes do "de".
function unidadeCurta(unidade) {
  const primeira = String(unidade || "").split(/\s+de\s+/i)[0].trim();
  return primeira ? `/${primeira}` : "";
}

// Card de commodity do CEPEA (soja, café): mesma cara, muda só o produto.
// `prefixo` casa com os ids do bloco no index.html (#soja-valor, #cafe-valor...).
async function atualizarCepea(prefixo, rota, rotuloPadrao) {
  const elValor = document.querySelector(`#${prefixo}-valor`);
  const elNome = document.querySelector(`#${prefixo}-nome`);
  const elData = document.querySelector(`#${prefixo}-data`);
  const elUnidade = document.querySelector(`#${prefixo}-unidade`);

  try {
    const dados = await buscar(rota);
    elValor.textContent = FORMATO_REAL.format(dados.valor);
    elNome.textContent = dados.produto || rotuloPadrao;
    elUnidade.textContent = unidadeCurta(dados.unidade);
    // Só dia/mês: o indicador é diário e o ano não cabe (nem ajuda na TV).
    elData.textContent = (dados.data || "").slice(0, 5) || "—";
  } catch (erro) {
    console.error(`${rotuloPadrao}:`, erro.message);
    elValor.textContent = "R$ --,--";
    elUnidade.textContent = "";
    elData.textContent = "—";
  }
}

function atualizar() {
  atualizarDolar();
  atualizarCepea("soja", "/api/soja", "Soja");
  atualizarCepea("cafe", "/api/cafe", "Café");
  atualizarCepea("milho", "/api/milho", "Milho");
}

atualizar();
setInterval(atualizar, INTERVALO_ATUALIZACAO_MS);
