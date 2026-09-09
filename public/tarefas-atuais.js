// Página Tarefas Atuais: uma coluna por pessoa da equipe, mostrando em que
// cada um está trabalhando agora. Dados vêm de /api/tarefas-atuais, que lê o
// schema `gestor` (o Gestor de Tarefas) — perfis, tarefas, presença e as
// sessões de cronômetro.
//
// A leitura pretendida, de longe: a borda superior colorida e a bolinha de
// presença dizem quem está tocando alguma coisa agora; chegando perto, os
// cards em destaque dizem o quê.

import { aplicarNumeros } from "./animacoes.js";
import { escapar } from "./escape.js";

// Mesmo ritmo do Helpdesk (30s, contra 5 min das outras vistas): presença e
// cronômetro são justamente o que fica errado quando a tela atrasa.
const INTERVALO_ATUALIZACAO_MS = 30 * 1000;

const COR_SITUACAO = {
  andamento: "var(--success)",
  pendente: "var(--text-dim)",
};

const ROTULO_SITUACAO = {
  andamento: "Em andamento",
  pendente: "Pendente",
};

const COR_PRIORIDADE = {
  alta: "var(--critical)",
  media: "var(--alert)",
  baixa: "var(--text-dim)",
};

// Nomes ligados por preposição não contam como sobrenome: cortar "LOUISE DA
// SILVA SEDLAK" nas duas primeiras palavras daria "Louise Da", que fica com
// cara de erro na tela. Pulando as partículas sai "Louise Silva".
const PARTICULAS = new Set(["da", "de", "do", "das", "dos", "e"]);

// "Lucas Gabriel Barreto Pereira" -> "Lucas Gabriel" (cabe no cabeçalho da
// coluna, que é estreita).
function nomeCurto(nome) {
  if (!nome) return "";
  const partes = String(nome).trim().split(/\s+/).filter(Boolean);
  if (partes.length <= 1) return partes.join(" ");
  const sobrenome = partes.slice(1).find((p) => !PARTICULAS.has(p.toLowerCase()));
  return sobrenome ? `${partes[0]} ${sobrenome}` : partes[0];
}

// Iniciais para o círculo de quem não tem foto — as mesmas duas palavras que
// nomeCurto escolhe, para a letra bater com o nome escrito logo abaixo.
function iniciais(nome) {
  return nomeCurto(nome)
    .split(/\s+/)
    .filter(Boolean)
    .map((parte) => parte[0].toUpperCase())
    .join("");
}

// Nome como está no banco (caixa alta) vira "Lucas Gabriel": a TV fica ligada
// o dia inteiro e caixa alta em bloco cansa de ler.
function capitalizar(nome) {
  return String(nome || "")
    .toLowerCase()
    .replace(/(^|\s|')\p{L}/gu, (c) => c.toUpperCase());
}

function formatarDuracao(segundos) {
  const total = Math.max(0, Math.round(Number(segundos) || 0));
  if (total < 60) return "0min";
  const horas = Math.floor(total / 3600);
  const minutos = Math.floor((total % 3600) / 60);
  return horas ? `${horas}h${String(minutos).padStart(2, "0")}` : `${minutos}min`;
}

// Dia do calendário no fuso da empresa, no formato "AAAA-MM-DD". A TV pode
// estar em outro fuso e o navegador do Fire Stick nem sempre está no horário
// certo — comparar as datas já resolvidas em Telêmaco Borba evita o card
// marcar "atrasado" três horas antes da hora.
const FUSO = "America/Sao_Paulo";
const FORMATO_DIA = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function diaNoFuso(data) {
  return FORMATO_DIA.format(data);
}

// Como o prazo aparece no rodapé do card: "atrasado", "hoje", "amanhã" ou a
// data curta. Devolve também a classe, para o CSS colorir só o que é urgente.
function descreverPrazo(iso) {
  if (!iso) return { texto: "", classe: "" };
  const prazo = new Date(iso);
  if (Number.isNaN(prazo.getTime())) return { texto: "", classe: "" };

  const hoje = diaNoFuso(new Date());
  const dia = diaNoFuso(prazo);

  if (dia < hoje) return { texto: "Atrasada", classe: "tarefa__prazo--atrasado" };
  if (dia === hoje) return { texto: "Vence hoje", classe: "tarefa__prazo--hoje" };

  const amanha = new Date();
  amanha.setDate(amanha.getDate() + 1);
  if (dia === diaNoFuso(amanha)) return { texto: "Vence amanhã", classe: "" };

  return {
    texto: prazo.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: FUSO }),
    classe: "",
  };
}

function mostrarAviso(mensagem) {
  const aviso = document.querySelector("#tarefas-aviso");
  aviso.textContent = mensagem || "";
  aviso.classList.toggle("tarefas-aviso--visivel", Boolean(mensagem));
}

function desenharTarefa(tarefa, ordem) {
  const situacao = String(tarefa.situacao || "").toLowerCase();
  const prioridade = String(tarefa.prioridade || "").toLowerCase();
  const prazo = descreverPrazo(tarefa.prazo);
  const gasto = tarefa.segundosGastos > 0 ? formatarDuracao(tarefa.segundosGastos) : "";

  return `<div class="tarefa anima-surgir${situacao === "andamento" ? " tarefa--andamento" : ""}"
       style="--ordem: ${ordem}; --cor-situacao: ${COR_SITUACAO[situacao] || "var(--border)"};">
    <div class="tarefa__topo">
      <span class="tarefa__situacao">${escapar(ROTULO_SITUACAO[situacao] || situacao)}</span>
      ${prioridade
        ? `<span class="tarefa__prioridade" style="--cor-prioridade: ${COR_PRIORIDADE[prioridade] || "var(--text-dim)"};">${escapar(prioridade)}</span>`
        : ""}
    </div>
    <div class="tarefa__titulo">${escapar(tarefa.titulo || "(sem título)")}</div>
    <div class="tarefa__rodape">
      <span class="${prazo.classe}">${escapar(prazo.texto)}</span>
      <span>${gasto ? `⏱ ${escapar(gasto)}` : ""}</span>
    </div>
  </div>`;
}

function desenharPessoa(pessoa, ordem) {
  // A cor da coluna segue o mesmo critério da ordenação da API: verde para
  // quem está com tarefa em andamento, cinza para o resto.
  const cor = pessoa.emAndamento > 0 ? "var(--success)" : "var(--border)";
  const corPresenca = pessoa.online ? "var(--success)" : "var(--text-dim)";

  const estado = pessoa.emAndamento > 0
    ? `${pessoa.emAndamento} em andamento`
    : (pessoa.online ? "Online" : "Offline");

  const cabem = pessoa.tarefas.length;
  const restantes = Math.max(0, pessoa.abertas - cabem);

  return `<div class="painel anima-surgir" style="--ordem: ${ordem}; --cor-pessoa: ${cor};">
    <div class="pessoa__cabecalho">
      <!-- A foto vem do mesmo proxy das outras vistas (/api/foto). As iniciais
           ficam ATRÁS dela: quem não tem foto cadastrada cai nelas sozinho,
           porque o onerror remove só o <img> e descobre a camada de baixo —
           sem ícone quebrado e sem um segundo caminho de render aqui.
           Sem loading=lazy de propósito: as cinco colunas estão todas na
           tela ao mesmo tempo, e o lazy só adiaria a foto para depois do
           primeiro quadro, fazendo os rostos aparecerem em cascata. -->
      <div class="pessoa__moldura" style="--cor-pessoa: ${corPresenca};">
        <span class="pessoa__iniciais">${escapar(iniciais(pessoa.nome))}</span>
        <img class="pessoa__foto" src="/api/foto/${encodeURIComponent(pessoa.nome)}"
             alt="Foto de ${escapar(capitalizar(pessoa.nome))}"
             decoding="async" onerror="this.remove()">
      </div>
      <div class="pessoa__identidade">
        <div class="pessoa__nome" title="${escapar(capitalizar(pessoa.nome))}">${escapar(capitalizar(nomeCurto(pessoa.nome)))}</div>
        <div class="pessoa__estado">
          <span class="pessoa__bolinha${pessoa.online ? " pessoa__bolinha--online" : ""}"
                style="--cor-presenca: ${corPresenca};"></span>
          <span>${escapar(estado)}</span>
        </div>
      </div>
    </div>

    <div class="pessoa__metricas">
      <div class="pessoa__metrica">
        <div class="pessoa__metrica-valor" data-metrica>0</div>
        <div class="pessoa__metrica-rotulo">Abertas</div>
      </div>
      <div class="pessoa__metrica">
        <div class="pessoa__metrica-valor" data-metrica>0</div>
        <div class="pessoa__metrica-rotulo">Feitas hoje</div>
      </div>
      <div class="pessoa__metrica">
        <!-- Tempo não é contador que sobe: aplicarNumeros conta de 0 até o
             valor, e "1h43" não é número. Vai escrito direto. -->
        <div class="pessoa__metrica-valor">${escapar(formatarDuracao(pessoa.segundosHoje))}</div>
        <div class="pessoa__metrica-rotulo">Hoje</div>
      </div>
    </div>

    <div class="pessoa__tarefas">
      ${cabem
        ? pessoa.tarefas.map((t, i) => desenharTarefa(t, i)).join("")
        : `<div class="pessoa__vazia">Sem tarefas abertas</div>`}
      ${restantes ? `<div class="pessoa__mais">+${restantes} não ${restantes === 1 ? "exibida" : "exibidas"}</div>` : ""}
    </div>
  </div>`;
}

// Assinatura do que está DESENHADO nas colunas. Os números das métricas ficam
// de fora de propósito: eles se atualizam sozinhos por aplicarNumeros, sem
// refazer o quadro.
function assinaturaDe(equipe) {
  return equipe
    .map((p) => [
      p.pessoaId, p.online, p.emAndamento, p.abertas,
      p.segundosHoje,
      p.tarefas.map((t) => [t.id, t.situacao, t.prioridade, t.titulo, t.prazo, t.segundosGastos].join("~")).join("|"),
    ].join("·"))
    .join("§");
}

let assinaturaAtual = null;

// Largura mínima do card e do espaçamento entre colunas, em px — os mesmos
// números do CSS (.tarefas-equipe: minmax(260px,...) e gap: 1.25rem). Se um
// dia o CSS mudar esses valores, mude aqui também.
const LARGURA_MIN_CARD = 260;
const GAP_PX = 20;

// Quantas colunas cabem na largura disponível, dado o mínimo do card.
function colunasQueCabem(largura) {
  return Math.max(1, Math.floor((largura + GAP_PX) / (LARGURA_MIN_CARD + GAP_PX)));
}

// grid-template-columns fixo (em vez do auto-fit puro do CSS) para não sobrar
// uma última linha capenga: com 5 pessoas e espaço para 4 colunas, o auto-fit
// punha 4 na primeira linha e deixava 1 pessoa sozinha numa segunda linha,
// com o card dela do mesmo tamanho dos outros e o resto da linha vazio — o
// "vão" que aparecia na TV. Testamos de N colunas (o que cabe) para baixo até
// achar uma contagem que preencha a última linha por igual (ou pelo menos que
// a sobra não seja isolada demais); no pior caso cai no auto-fit mesmo.
function calcularColunas(qtdPessoas, larguraDisponivel) {
  const maximo = colunasQueCabem(larguraDisponivel);
  if (qtdPessoas <= maximo) return qtdPessoas; // todo mundo cabe em uma linha só

  for (let colunas = maximo; colunas >= 1; colunas--) {
    const linhas = Math.ceil(qtdPessoas / colunas);
    const ultimaLinha = qtdPessoas - (linhas - 1) * colunas;
    // Última linha com pelo menos metade das colunas preenchida: nem toda
    // divisão fecha exata (equipe de 7 pessoas, por exemplo), então o critério
    // é "não deixar uma linha visualmente pobre", não "só linhas completas".
    if (ultimaLinha >= colunas / 2) return colunas;
  }
  return maximo;
}

function ajustarColunas(equipe) {
  const alvo = document.querySelector("#tarefas-equipe");
  const colunas = calcularColunas(equipe.length, alvo.clientWidth);
  alvo.style.setProperty("--colunas", colunas);
}

function desenharEquipe(equipe) {
  const alvo = document.querySelector("#tarefas-equipe");

  if (!equipe.length) {
    assinaturaAtual = null;
    alvo.innerHTML = `<p style="color: var(--text-dim);">Nenhuma pessoa encontrada no setor.</p>`;
    return;
  }

  ajustarColunas(equipe);

  // Mesma proteção do Helpdesk (ver desenharColunas lá): esta vista se
  // atualiza a cada 30s e refazer o innerHTML a cada volta destruiria e
  // recriaria dezenas de cards — layout e repintura da vista inteira — além
  // de reiniciar a cascata .anima-surgir, fazendo o quadro piscar de meio em
  // meio minuto na cara de quem está olhando. Quase nada muda entre duas
  // consultas: só remonta quando muda de verdade.
  const assinatura = assinaturaDe(equipe);
  const remontar = assinatura !== assinaturaAtual;

  if (remontar) {
    assinaturaAtual = assinatura;
    alvo.innerHTML = equipe.map((p, i) => desenharPessoa(p, i)).join("");
  }

  // Duas métricas por pessoa, na mesma ordem em que foram geradas: abertas e
  // concluídas hoje. Com o HTML recém-remontado elas estão zeradas, daí o
  // `remontar` — senão o contador voltaria a zero a cada atualização.
  const metricas = equipe.flatMap((p) => [p.abertas, p.concluidasHoje]);
  aplicarNumeros(alvo, "[data-metrica]", metricas, remontar);
}

function desenharResumo(totais) {
  const alvo = document.querySelector("#tarefas-resumo");
  if (!alvo.querySelector("[data-resumo]")) {
    alvo.innerHTML = `
      <span><strong data-resumo>0</strong> em andamento</span>
      <span><strong data-resumo>0</strong> abertas</span>
      <span><strong data-resumo>0</strong> feitas hoje</span>
      <span><strong data-resumo>0</strong> online</span>`;
  }
  aplicarNumeros(alvo, "[data-resumo]", [
    totais.emAndamento, totais.abertas, totais.concluidasHoje, totais.online,
  ]);
}

// Última equipe desenhada — para o resize (troca de vista, TV redimensionada)
// recalcular as colunas sem esperar a próxima consulta ao servidor.
let equipeAtual = [];

async function atualizar() {
  try {
    const resp = await fetch("/api/tarefas-atuais");
    const dados = await resp.json();
    if (!resp.ok) throw dados.erro || "Erro ao carregar as tarefas da equipe.";
    // Confere o formato antes de desenhar — mesma trava do colaboradores.js:
    // servidor rodando uma versão antiga da rota estouraria lá dentro e o erro
    // apareceria como "erro ao carregar", mandando procurar no banco um
    // problema que é de versão.
    if (!Array.isArray(dados.equipe)) {
      throw "A API respondeu fora do formato esperado — reinicie o servidor.";
    }

    mostrarAviso("");
    desenharResumo(dados.totais || {});
    equipeAtual = dados.equipe;
    desenharEquipe(dados.equipe);
  } catch (erro) {
    // O aviso na tela é curto (é uma TV); o motivo real vai para o console.
    console.error("Tarefas atuais:", erro);
    mostrarAviso(typeof erro === "string" ? erro : "Erro ao carregar as tarefas da equipe.");
  }
}

atualizar();
setInterval(atualizar, INTERVALO_ATUALIZACAO_MS);

// A vista Tarefas Atuais só fica visível (offsetParent não-nulo) quando a
// rotação chega nela — até lá, clientWidth mede 0 e --colunas sairia errado.
// paginacao.js dispara "resize" toda vez que troca de vista (ver ativar() lá)
// bem como o navegador dispara ao redimensionar a janela — os dois casos em
// que a largura disponível muda sem uma nova consulta ao servidor.
window.addEventListener("resize", () => {
  if (equipeAtual.length) ajustarColunas(equipeAtual);
});
