// Cotações do dashboard (blocos 3x1 empilhados à direita do relógio):
//   Dólar -> /api/dolar (AwesomeAPI, USD-BRL, com a variação do dia)
//   Soja  -> /api/soja  (indicador CEPEA/ESALQ, R$ por saca)
//   Café  -> /api/cafe  (indicador CEPEA/ESALQ, R$ por saca)
//   Milho -> /api/milho (indicador CEPEA/ESALQ, R$ por saca)
//   Selic -> /api/selic (meta do Copom, % ao ano, série 432 do SGS/BCB)
//   IGP-M -> /api/igpm  (FGV, % acumulado em 12 meses, série 189 do SGS/BCB)
// Os fetches são no servidor porque o CSP da página só permite
// connect-src 'self'.

import { agendar, obterParte, mudou, esquecer } from "./agenda.js";

const INTERVALO_ATUALIZACAO_MS = 5 * 60 * 1000; // mesmo ritmo do clima

const FORMATO_REAL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

// Selic sempre com duas casas ("14,25%"), mesmo quando a meta é redonda.
const FORMATO_PERCENTUAL = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// As seis cotações saem numa só requisição (obterParte junta os pedidos). A
// rota "/api/dolar" é a parte "dolar" do painel agregado.
async function buscar(rota) {
  try {
    return await obterParte(rota.replace("/api/", ""));
  } catch (erro) {
    // obterParte rejeita com o texto do servidor (ou o Error de rede).
    throw erro instanceof Error ? erro : new Error(erro || `Falha em ${rota}`);
  }
}

async function atualizarDolar() {
  const elValor = document.querySelector("#dolar-valor");
  const elVariacao = document.querySelector("#dolar-variacao");

  try {
    const dados = await buscar("/api/dolar");
    if (!mudou("dolar", dados)) return;
    elValor.textContent = FORMATO_REAL.format(dados.valor);

    // Seta + sinal deixam a variação legível de longe sem depender da cor.
    const alta = dados.variacao >= 0;
    elVariacao.textContent =
      `${alta ? "▲" : "▼"} ${Math.abs(dados.variacao).toFixed(2).replace(".", ",")}%`;
    elVariacao.classList.toggle("cotacao__extra--alta", alta);
    elVariacao.classList.toggle("cotacao__extra--baixa", !alta);
  } catch (erro) {
    esquecer("dolar");
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
    if (!mudou(`cepea-${prefixo}`, dados)) return;
    elValor.textContent = FORMATO_REAL.format(dados.valor);
    elNome.textContent = dados.produto || rotuloPadrao;
    elUnidade.textContent = unidadeCurta(dados.unidade);
    // Só dia/mês: o indicador é diário e o ano não cabe (nem ajuda na TV).
    elData.textContent = (dados.data || "").slice(0, 5) || "—";
  } catch (erro) {
    esquecer(`cepea-${prefixo}`);
    console.error(`${rotuloPadrao}:`, erro.message);
    elValor.textContent = "R$ --,--";
    elUnidade.textContent = "";
    elData.textContent = "—";
  }
}

// Selic: só o número, com "a.a." fixo no HTML (a meta do Copom vale até a
// próxima reunião, então não há data de pregão para mostrar aqui).
async function atualizarSelic() {
  const elValor = document.querySelector("#selic-valor");

  try {
    const dados = await buscar("/api/selic");
    if (!mudou("selic", dados)) return;
    elValor.textContent = `${FORMATO_PERCENTUAL.format(dados.valor)}%`;
  } catch (erro) {
    esquecer("selic");
    console.error("Selic:", erro.message);
    elValor.textContent = "--,--%";
  }
}

// "01/06/2026" -> "jun/26": no canto do card só cabe o mês de referência.
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function mesCurto(data) {
  const [, mes, ano] = String(data || "").split("/");
  const nome = MESES[Number(mes) - 1];
  return nome ? `${nome}/${ano.slice(-2)}` : "—";
}

// IGP-M: o valor é o acumulado em 12 meses (calculado no servidor) e o canto
// mostra o mês de referência, que é o último fechado pela FGV.
async function atualizarIgpm() {
  const elValor = document.querySelector("#igpm-valor");
  const elData = document.querySelector("#igpm-data");

  try {
    const dados = await buscar("/api/igpm");
    if (!mudou("igpm", dados)) return;
    elValor.textContent = `${FORMATO_PERCENTUAL.format(dados.valor)}%`;
    elData.textContent = mesCurto(dados.data);
  } catch (erro) {
    esquecer("igpm");
    console.error("IGP-M:", erro.message);
    elValor.textContent = "--,--%";
    elData.textContent = "—";
  }
}

function atualizar() {
  atualizarDolar();
  atualizarCepea("soja", "/api/soja", "Soja");
  atualizarCepea("cafe", "/api/cafe", "Café");
  atualizarCepea("milho", "/api/milho", "Milho");
  atualizarSelic();
  atualizarIgpm();
}

agendar("cotacoes", atualizar, { intervalo: INTERVALO_ATUALIZACAO_MS, vista: "vista-dashboard" });
