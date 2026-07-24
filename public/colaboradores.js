// Página Colaboradores: o total do efetivo e, dentro de cada coordenador, a
// contagem por classe de cargo. Mesmo formato da Frota por Líder (um card por
// coordenador), com o LARSIL recolhendo quem não é de campo ou está sem
// coordenador na tabela.
// Dados vêm de /api/colaboradores (SQL Server, dbo.COLABORADORES).

import { animarNumero } from "./animacoes.js";
import { iniciarHolofote } from "./holofote.js";
import { escapar } from "./escape.js";

const INTERVALO_ATUALIZACAO_MS = 5 * 60 * 1000; // mesmo ritmo das outras páginas

// A classe vem do banco como sigla de 3 letras. A sigla fica no card (é o que
// o RH usa), mas sozinha não diz nada de longe, então vai acompanhada do nome
// por extenso. Os nomes saíram das funções que caem em cada classe — LDF, por
// exemplo, só tem "líder de equipe" e "líder florestal".
const NOMES_CLASSE = {
  TRF: "Trabalhador florestal",
  ADM: "Administrativo",
  OUT: "Outros",
  OPF: "Operador florestal",
  MCM: "Motorista de caminhão",
  LDF: "Líder de equipe",
  SPF: "Supervisor florestal",
  MCR: "Motorista de carreta",
  MEC: "Mecânico",
  COF: "Coordenador",
};

function mostrarAviso(mensagem) {
  const aviso = document.querySelector("#colaboradores-aviso");
  aviso.textContent = mensagem || "";
  aviso.classList.toggle("colaboradores-aviso--visivel", Boolean(mensagem));
}

// Um card por coordenador (a API já manda ordenado, LARSIL no meio), e
// dentro dele um tile por classe, da maior para a menor. Cada tile traz o
// número e o nome escritos, por isso não há legenda nem tooltip (é um painel
// de TV: ninguém passa o mouse nele).
function desenharCoordenadores(coordenadores) {
  const alvo = document.querySelector("#colab-classes");

  if (!coordenadores.length) {
    alvo.innerHTML = `<p style="color: var(--text-dim);">Nenhum colaborador encontrado.</p>`;
    return;
  }

  alvo.innerHTML = coordenadores
    .map((coord, i) => `
      <div class="lider-card anima-surgir" style="--ordem: ${i};">
        <div class="lider-card__nome" title="${escapar(coord.nome)}">${escapar(coord.nome)}</div>
        <div class="colab-coord__total">
          <span data-total-coord>0</span> colaboradores
        </div>
        <div class="lider-card__tipos">
          ${coord.classes.map((classe) => `
            <div class="lider-tipo">
              <div class="lider-tipo__valor colab-tipo__valor" data-qtd>0</div>
              <!-- Sigla que não esteja no mapa aparece sem o nome por extenso,
                   em vez de sumir do painel — melhor "XYZ 4" do que esconder
                   gente. -->
              <div class="lider-tipo__nome">${escapar(NOMES_CLASSE[classe.nome] || "")}</div>
              <div class="colab-tipo__sigla">${escapar(classe.nome)}</div>
            </div>`).join("")}
        </div>
      </div>`)
    .join("");

  const totais = alvo.querySelectorAll("[data-total-coord]");
  totais.forEach((el, i) => {
    el.dataset.valor = coordenadores[i].qtd; // guardado para o holofote re-animar
    animarNumero(el, coordenadores[i].qtd);
  });

  // Um querySelectorAll só na página inteira: os tiles vêm na mesma ordem em
  // que foram gerados, então a lista achatada casa com os cards em sequência.
  const qtds = [...coordenadores.flatMap((c) => c.classes)];
  alvo.querySelectorAll("[data-qtd]").forEach((el, i) => {
    el.dataset.valor = qtds[i].qtd;
    animarNumero(el, qtds[i].qtd);
  });

  iniciarHolofote(alvo);
}

function desenharTotal(total) {
  const alvo = document.querySelector("#colaboradores-total");
  alvo.innerHTML = `<strong data-total>0</strong> no quadro`;
  animarNumero(alvo.querySelector("[data-total]"), total);
}

async function atualizar() {
  try {
    const resp = await fetch("/api/colaboradores");
    const dados = await resp.json();
    if (!resp.ok) throw dados.erro || "Erro ao carregar os dados de colaboradores.";
    // Confere o formato antes de desenhar. Sem isto, uma resposta fora do
    // contrato — o caso real: servidor ainda rodando a versão da rota que
    // devolvia `funcoes` — estourava lá dentro e caía no catch como "erro ao
    // carregar os dados", mandando procurar o problema na consulta ao banco
    // quando o dado tinha chegado inteiro.
    if (!Array.isArray(dados.coordenadores)) {
      throw "A API respondeu fora do formato esperado — reinicie o servidor.";
    }

    mostrarAviso("");
    desenharTotal(dados.total);
    desenharCoordenadores(dados.coordenadores);
  } catch (erro) {
    // O aviso na tela é curto (é uma TV); o motivo real vai para o console.
    console.error("Colaboradores:", erro);
    mostrarAviso(typeof erro === "string" ? erro : "Erro ao carregar os dados de colaboradores.");
  }
}

atualizar();
setInterval(atualizar, INTERVALO_ATUALIZACAO_MS);
