// Holofote: destaca um item de cada vez, em rodízio (Frota por Coordenador,
// Colaboradores e Ativos de TI).
//
// Numa TV ninguém clica: em vez de mostrar tudo do mesmo tamanho, damos
// destaque a um item de cada vez — ele fica em pé, enquanto os outros recuam.
// Ao fim do ciclo volta ao primeiro. O CSS (.holofote--foco / --recuado nos
// itens, mais uma classe no container, em index.html) cuida do tamanho e da
// opacidade; aqui só alternamos as classes.
//
// O ciclo SÓ roda com a vista no ar: enquanto ela está oculta (display:none)
// ninguém veria a troca (ver observarVista).

import { observarVista } from "./visibilidade.js";

const HOLOFOTE_INTERVALO_MS = 4500; // tempo de cada coordenador em destaque

// Estado por lista (a Frota e os Colaboradores são listas diferentes): cards
// atuais, timer do ciclo, índice em foco e se a vista está visível.
const estados = new Map();

function aplicarFoco(estado) {
  estado.cards.forEach((card, j) => {
    const foco = j === estado.i;
    card.classList.toggle("holofote--foco", foco);
    card.classList.toggle("holofote--recuado", !foco);
  });

  // Só isto: as duas classes acima já trocam o coordenador da vez, porque no
  // modo carrossel os cards ficam empilhados na mesma caixa e é a opacidade
  // que decide quem aparece (ver .lideres-lista--carrossel no index.html).
  // Daqui não sai posição nenhuma para o CSS calcular — quando saía, uma conta
  // recusada pelo navegador fazia o destaque andar sem a tela mudar.
}

function iniciarCiclo(estado) {
  clearTimeout(estado.timer);
  if (!estado.visivel || estado.cards.length < 2) return;
  const passo = () => {
    aplicarFoco(estado);
    estado.i = (estado.i + 1) % estado.cards.length;
    estado.timer = setTimeout(passo, HOLOFOTE_INTERVALO_MS);
  };
  passo();
}

function pararCiclo(estado) {
  clearTimeout(estado.timer);
  estado.timer = null;
}

// Liga o holofote na lista `alvo`. Chame de novo a cada render: reaproveita o
// estado (e o observador da vista) e só troca os itens, sem empilhar timers.
//
// `carrossel: true` troca o destaque no lugar (todos os itens na tela, o do
// momento em pé e os outros recuados) por um de cada vez: os itens ficam
// empilhados na mesma caixa, ocupando a tela inteira, e só o da vez aparece.
// É o modo da Frota por Coordenador e do Colaboradores — vale quando o
// conteúdo do card merece a tela inteira.
//
// `item` e `classeLista` existem porque o holofote não é mais só dos cards de
// coordenador: os Ativos de TI são painéis de KPI dentro de uma grade, com
// layout próprio. O mecanismo é o mesmo (alternar duas classes); o que muda de
// tela para tela é em QUEM alternar e qual classe liga o CSS do container.
export function iniciarHolofote(alvo, {
  carrossel = false,
  item = ".lider-card",
  classeLista = "lideres-lista--foco",
} = {}) {
  const cards = [...alvo.querySelectorAll(item)];

  let estado = estados.get(alvo);
  if (!estado) {
    estado = { alvo, cards, timer: null, i: 0, visivel: false };
    estados.set(alvo, estado);
    // Observa a vista dona desta lista uma única vez: pausa o ciclo quando ela
    // sai de cena e o retoma (do início) quando volta.
    const vista = alvo.closest(".vista");
    if (vista) {
      observarVista(vista, {
        // Retoma de onde parou, em vez de voltar ao primeiro. No carrossel
        // cada coordenador ocupa a tela inteira, e a vista fica no ar ~30s
        // (rotação) a 4.5s cada: dá para mostrar uns seis por passagem. Se o
        // ciclo recomeçasse do zero a cada entrada, do sétimo em diante
        // ninguém apareceria nunca — e a volta ao início ainda faria a
        // fileira desfilar de trás para frente na frente de quem está olhando.
        aoEntrar() { estado.visivel = true; iniciarCiclo(estado); },
        aoSair() { estado.visivel = false; pararCiclo(estado); },
      });
    } else {
      estado.visivel = true; // fora do SPA: trata como sempre visível
    }
  }
  // Só os cards mudam entre chamadas; o modo e as classes vêm dos argumentos e
  // são usados aqui mesmo, então não viram estado.
  estado.cards = cards;
  estado.i = 0;

  // Sem graça (e sem sentido) com um item só; e respeita movimento reduzido —
  // nesses casos os itens ficam todos iguais, como antes.
  if (cards.length < 2 || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    pararCiclo(estado);
    alvo.classList.remove(classeLista, "lideres-lista--carrossel");
    // Tirar as classes do container já desliga tudo (as regras de opacidade e
    // escala são escopadas a ele), mas itens marcados como --recuado no DOM
    // são estado morto esperando para reaparecer no dia em que alguém
    // escrever uma regra sem esse escopo. Limpa.
    cards.forEach((c) => c.classList.remove("holofote--foco", "holofote--recuado"));
    return;
  }

  alvo.classList.add(classeLista);
  alvo.classList.toggle("lideres-lista--carrossel", carrossel);
  iniciarCiclo(estado); // no-op se a vista estiver oculta; retoma ao aparecer
}
