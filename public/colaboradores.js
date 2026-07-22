// Página Colaboradores: o total do efetivo e a contagem por classe de cargo.
// Dados vêm de /api/colaboradores (SQL Server, dbo.COLABORADORES).

import { animarNumero } from "./animacoes.js";
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

// Um card por classe, da maior para a menor (a API já manda ordenado). Cada
// card traz o número e o nome escritos, por isso não há legenda nem tooltip
// (é um painel de TV: ninguém passa o mouse nele).
function desenharClasses(classes) {
  const alvo = document.querySelector("#colab-classes");

  if (!classes.length) {
    alvo.innerHTML = `<p style="color: var(--text-dim);">Nenhum colaborador encontrado.</p>`;
    return;
  }

  alvo.innerHTML = classes
    .map((classe, i) => {
      const sigla = escapar(classe.nome);
      // Sigla que não esteja no mapa aparece sem a segunda linha, em vez de
      // sumir do painel — melhor mostrar "XYZ 4" do que esconder gente.
      const nome = escapar(NOMES_CLASSE[classe.nome] || "");
      return `<div class="classe-card anima-surgir" style="--ordem: ${i};">
        <div class="classe-card__valor" data-qtd>0</div>
        <div class="classe-card__nome">${nome}</div>
        <div class="classe-card__sigla">${sigla}</div>
      </div>`;
    })
    .join("");

  alvo.querySelectorAll("[data-qtd]").forEach((el, i) => animarNumero(el, classes[i].qtd));
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
    if (!Array.isArray(dados.classes)) {
      throw "A API respondeu fora do formato esperado — reinicie o servidor.";
    }

    mostrarAviso("");
    desenharTotal(dados.total);
    desenharClasses(dados.classes);
  } catch (erro) {
    // O aviso na tela é curto (é uma TV); o motivo real vai para o console.
    console.error("Colaboradores:", erro);
    mostrarAviso(typeof erro === "string" ? erro : "Erro ao carregar os dados de colaboradores.");
  }
}

atualizar();
setInterval(atualizar, INTERVALO_ATUALIZACAO_MS);
