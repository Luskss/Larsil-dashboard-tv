// Agenda central das atualizações do dashboard.
//
// Antes, cada vista tinha o seu setInterval(atualizar, ...), todos criados
// juntos na carga da página: a cada ciclo dispararam as 12 ao mesmo tempo
// (12 requisições, 12 parses de JSON, vários innerHTML), por cima da vista que
// estava na tela — inclusive as de vistas ocultas, que ninguém via. Aqui:
//
//   1. obterParte() junta as buscas pedidas na mesma janela de tempo numa só
//      requisição a /api/painel (o servidor responde cada parte com os mesmos
//      caches das rotas individuais);
//   2. agendar() só atualiza a vista que está no ar. A oculta fica quieta e,
//      se estiver velha, atualiza logo depois de entrar em cena;
//   3. mudou() deixa o módulo pular o render quando a resposta é idêntica à
//      anterior.

import { observarVista } from "./visibilidade.js";

// ===== Busca em lote =====
// Janela em que os pedidos se juntam. No boot os módulos executam em
// sequência (cada um chama atualizar() ao carregar), então 120ms pega quase
// todos; nas atualizações seguintes o atraso é imperceptível.
const JANELA_LOTE_MS = 120;

let lote = null; // nome da parte -> { promessa, resolve, reject }

// Devolve os dados da parte (o mesmo corpo que a rota /api/<parte> daria).
// Falha como a camada de dados sempre falhou: rejeita com a MENSAGEM em texto
// quando o servidor explicou o erro, ou com o Error original numa falha de
// rede — os catch dos módulos já tratam os dois casos.
export function obterParte(parte) {
  if (!lote) {
    lote = new Map();
    setTimeout(enviarLote, JANELA_LOTE_MS);
  }
  let pedido = lote.get(parte);
  if (!pedido) {
    pedido = {};
    pedido.promessa = new Promise((resolve, reject) => {
      pedido.resolve = resolve;
      pedido.reject = reject;
    });
    lote.set(parte, pedido);
  }
  return pedido.promessa;
}

async function enviarLote() {
  const atual = lote;
  lote = null;
  const nomes = [...atual.keys()].map(encodeURIComponent).join(",");

  try {
    const resp = await fetch(`/api/painel?partes=${nomes}`);
    const corpo = await resp.json().catch(() => ({}));
    if (!resp.ok) throw corpo.erro || "Falha na requisição";

    for (const [nome, pedido] of atual) {
      const parte = corpo[nome];
      if (parte?.ok) pedido.resolve(parte.dados);
      else pedido.reject(parte?.erro || "Falha na requisição");
    }
  } catch (erro) {
    for (const pedido of atual.values()) pedido.reject(erro);
  }
}

// ===== Pular render quando nada mudou =====
const memos = new Map(); // chave -> última resposta, em texto

// true se `dados` difere da última chamada com a mesma chave (e memoriza).
// `ignorar` lista campos que mudam sem importar para o desenho (ex. um
// relógio que vem do servidor).
//
// Chame esquecer(chave) no catch do módulo: depois de um erro a tela mostra o
// estado de falha, e a mesma resposta que já estava lá antes precisa voltar a
// ser desenhada.
export function mudou(chave, dados, ignorar = []) {
  const texto = JSON.stringify(
    dados,
    ignorar.length ? (k, v) => (ignorar.includes(k) ? undefined : v) : undefined
  );
  if (memos.get(chave) === texto) return false;
  memos.set(chave, texto);
  return true;
}

export function esquecer(chave) {
  memos.delete(chave);
}

// ===== Agendador =====
// Quanto esperar depois de a vista entrar em cena antes de atualizar: deixa a
// animação de entrada (~.35s) terminar sem concorrer com o fetch e o render.
const ATRASO_ENTRADA_MS = 700;

// Roda `atualizar` agora e depois a cada `intervalo`, mas só enquanto alguma
// das `vista`s (id ou lista de ids) estiver no ar. Sem `vista`, roda sempre.
//
// `segundoPlano: true` mantém a atualização mesmo com a vista oculta — só para
// quem precisa avisar de fora dela (o toast de chamado novo, por exemplo).
//
// A primeira execução é sempre imediata, visível ou não: a vista precisa ter
// conteúdo desde a primeira vez que aparecer.
export function agendar(nome, atualizar, { intervalo, vista, segundoPlano = false }) {
  const vistas = [].concat(vista || [])
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  const noAr = () => vistas.length === 0 || vistas.some((v) => v.classList.contains("vista--ativa"));

  let ultimo = 0; // quando a última execução COMEÇOU
  let emCurso = null;

  const rodar = () => {
    if (emCurso) return emCurso;
    ultimo = Date.now();
    emCurso = (async () => {
      try {
        await atualizar();
      } catch (erro) {
        console.error(`Atualização (${nome}):`, erro);
      } finally {
        emCurso = null;
      }
    })();
    return emCurso;
  };

  rodar();
  setInterval(() => {
    if (segundoPlano || noAr()) rodar();
  }, intervalo);

  if (segundoPlano) return;
  for (const v of vistas) {
    observarVista(v, {
      aoEntrar() {
        if (Date.now() - ultimo >= intervalo) setTimeout(rodar, ATRASO_ENTRADA_MS);
      },
    });
  }
}
