// Página Tarefas Atuais: um card por pessoa da equipe, em carrossel (uma por
// vez, na tela inteira, igual à Frota por Coordenador), mostrando a lista
// completa do que cada um está fazendo agora. Dados vêm de /api/tarefas-atuais,
// que lê o schema `gestor` (o Gestor de Tarefas) — perfis, tarefas, presença e
// as sessões de cronômetro.
//
// Antes eram colunas lado a lado, e numa TV cada uma era estreita demais: os
// títulos das tarefas cortavam e só cabiam uma ou duas por pessoa. Com o card
// ocupando a tela, a cara da pessoa identifica quem é de longe e a lista à
// direita cabe inteira; o holofote (holofote.js) passa de uma para a outra.

import { aplicarNumeros } from "./animacoes.js";
import { iniciarHolofote } from "./holofote.js";
import { escapar } from "./escape.js";
import { agendar, obterParte } from "./agenda.js";

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

function desenharTarefa(tarefa) {
  const situacao = String(tarefa.situacao || "").toLowerCase();
  const prioridade = String(tarefa.prioridade || "").toLowerCase();
  const prazo = descreverPrazo(tarefa.prazo);
  const gasto = tarefa.segundosGastos > 0 ? formatarDuracao(tarefa.segundosGastos) : "";
  const estimado = tarefa.minutosEstimados > 0 ? formatarDuracao(tarefa.minutosEstimados * 60) : "";

  // Sem .anima-surgir: no carrossel os cards ficam empilhados e a cascata de
  // entrada seguraria opacity:1 em todas as pessoas ao mesmo tempo (ver o
  // mesmo motivo em holofote.js). A entrada de cada pessoa é a do card dela.
  return `<div class="tarefa${situacao === "andamento" ? " tarefa--andamento" : ""}"
       style="--cor-situacao: ${COR_SITUACAO[situacao] || "var(--border)"};">
    <div class="tarefa__topo">
      <span class="tarefa__situacao">${escapar(ROTULO_SITUACAO[situacao] || situacao)}</span>
      ${tarefa.projeto ? `<span class="tarefa__projeto">${escapar(tarefa.projeto)}</span>` : ""}
      ${prioridade
        ? `<span class="tarefa__prioridade" style="--cor-prioridade: ${COR_PRIORIDADE[prioridade] || "var(--text-dim)"};">${escapar(prioridade)}</span>`
        : ""}
    </div>
    <div class="tarefa__titulo">${escapar(tarefa.titulo || "(sem título)")}</div>
    <div class="tarefa__rodape">
      <span class="${prazo.classe}">${escapar(prazo.texto)}</span>
      <span>${gasto ? `⏱ ${escapar(gasto)}${estimado ? ` / ${escapar(estimado)}` : ""}` : ""}</span>
    </div>
  </div>`;
}

// Um card por pessoa, ocupando a tela inteira — o holofote (iniciarHolofote,
// modo carrossel) passa de uma para a outra a cada poucos segundos, como na
// Frota por Coordenador. A tela cheia é o que permite a LISTA COMPLETA de
// tarefas: na grade antiga cabiam uma ou duas antes de cortar.
function desenharPessoa(pessoa) {
  // Verde para quem está com tarefa em andamento, cinza para o resto — mesmo
  // critério da ordenação da API.
  const cor = pessoa.emAndamento > 0 ? "var(--success)" : "var(--border)";
  const corPresenca = pessoa.online ? "var(--success)" : "var(--text-dim)";

  const estado = pessoa.emAndamento > 0
    ? `${pessoa.emAndamento} em andamento`
    : (pessoa.online ? "Online" : "Offline");

  const cabem = pessoa.tarefas.length;
  const restantes = Math.max(0, pessoa.abertas - cabem);

  return `<div class="pessoa-card" style="--cor-pessoa: ${cor};">
    <div class="pessoa-card__perfil">
      <!-- A foto vem do mesmo proxy das outras vistas (/api/foto). As iniciais
           ficam ATRÁS dela: quem não tem foto cadastrada cai nelas sozinho,
           porque o onerror remove só o <img> e descobre a camada de baixo. -->
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
          <!-- Tempo vai escrito direto: "1h43" não é número para aplicarNumeros. -->
          <div class="pessoa__metrica-valor">${escapar(formatarDuracao(pessoa.segundosHoje))}</div>
          <div class="pessoa__metrica-rotulo">Hoje</div>
        </div>
      </div>
    </div>

    <div class="pessoa-card__lista">
      <div class="pessoa-card__lista-titulo">No que está trabalhando</div>
      <div class="pessoa__tarefas">
        ${cabem
          ? pessoa.tarefas.map((t) => desenharTarefa(t)).join("")
          : `<div class="pessoa__vazia">Sem tarefas abertas</div>`}
        ${restantes ? `<div class="pessoa__mais">+${restantes} não ${restantes === 1 ? "exibida" : "exibidas"}</div>` : ""}
      </div>
    </div>
  </div>`;
}

// Assinatura do que está DESENHADO nos cards. Os números das métricas ficam
// de fora de propósito: eles se atualizam sozinhos por aplicarNumeros, sem
// refazer o quadro (e sem reiniciar o carrossel do holofote).
function assinaturaDe(equipe) {
  return equipe
    .map((p) => [
      p.pessoaId, p.online, p.emAndamento, p.abertas,
      p.segundosHoje,
      p.tarefas.map((t) => [t.id, t.situacao, t.prioridade, t.titulo, t.prazo, t.projeto, t.segundosGastos, t.minutosEstimados].join("~")).join("|"),
    ].join("·"))
    .join("§");
}

let assinaturaAtual = null;

function desenharEquipe(equipe) {
  const alvo = document.querySelector("#tarefas-equipe");

  if (!equipe.length) {
    assinaturaAtual = null;
    alvo.innerHTML = `<p style="color: var(--text-dim);">Nenhuma pessoa encontrada no setor.</p>`;
    return;
  }

  // Mesma proteção do Helpdesk e da Frota por Coordenador: esta vista se
  // atualiza a cada 30s e refazer o innerHTML a cada volta recriaria todos os
  // cards — layout e repintura da vista inteira — e jogaria o holofote de
  // volta para a primeira pessoa. Quase nada muda entre duas consultas: só
  // remonta quando a estrutura muda de verdade.
  const assinatura = assinaturaDe(equipe);
  const remontar = assinatura !== assinaturaAtual;

  if (remontar) {
    assinaturaAtual = assinatura;
    alvo.innerHTML = equipe.map((p) => desenharPessoa(p)).join("");
  }

  // Duas métricas por pessoa, na mesma ordem em que foram geradas: abertas e
  // concluídas hoje. Com o HTML recém-remontado elas estão zeradas, daí o
  // `remontar` — senão o contador voltaria a zero a cada atualização.
  const metricas = equipe.flatMap((p) => [p.abertas, p.concluidasHoje]);
  aplicarNumeros(alvo, "[data-metrica]", metricas, remontar);

  // Uma pessoa por vez, na tela inteira (modo carrossel do holofote — o mesmo
  // da Frota por Coordenador e do Colaboradores). Só reinicia com cards novos:
  // reiniciar com os mesmos faria o destaque saltar de volta para a primeira
  // pessoa a cada atualização.
  if (remontar) iniciarHolofote(alvo, { carrossel: true, item: ".pessoa-card" });
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

async function atualizar() {
  try {
    const dados = await obterParte("tarefas-atuais");
    // Confere o formato antes de desenhar — mesma trava do colaboradores.js:
    // servidor rodando uma versão antiga da rota estouraria lá dentro e o erro
    // apareceria como "erro ao carregar", mandando procurar no banco um
    // problema que é de versão.
    if (!Array.isArray(dados.equipe)) {
      throw "A API respondeu fora do formato esperado — reinicie o servidor.";
    }

    mostrarAviso("");
    desenharResumo(dados.totais || {});
    desenharEquipe(dados.equipe);
  } catch (erro) {
    // O aviso na tela é curto (é uma TV); o motivo real vai para o console.
    console.error("Tarefas atuais:", erro);
    mostrarAviso(typeof erro === "string" ? erro : "Erro ao carregar as tarefas da equipe.");
  }
}

agendar("tarefas-atuais", atualizar, { intervalo: INTERVALO_ATUALIZACAO_MS, vista: "vista-tarefas" });

// O carrossel (holofote.js) cuida sozinho de pausar quando a vista sai de cena
// e retomar quando volta — não há mais cálculo de colunas dependente da
// largura, então esta vista não precisa reagir a "resize".
