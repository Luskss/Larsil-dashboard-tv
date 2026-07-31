// Página Reservas de Veículos: quem está com cada carro agora. Um card por
// veículo de dbo.VEICULOS_TESTE, com a reserva em andamento (condutor, motivo e
// a janela de horário), e um mural com as próximas saídas da frota.
// Dados vêm de /api/veiculos-reservas — o servidor já resolve o "agora" no fuso
// de Telêmaco Borba e classifica cada carro em em-uso / reservado / livre.

import { consultarVeiculosReservas } from "./downdetector.js";
import { aplicarNumeros } from "./animacoes.js";
import { escapar } from "./escape.js";

// Ritmo mais curto que o das telas de frota (5 min): aqui o que muda é o
// relógio — um carro que sai às 08h tem que virar "em uso" logo em seguida.
const INTERVALO_ATUALIZACAO_MS = 60 * 1000;

// Rótulo e cor de cada estado. As cores são as mesmas dos outros painéis
// (tema.css), para a TV falar a mesma língua em todas as telas.
const ESTADOS = {
  "em-uso":    { rotulo: "Em uso",    cor: "var(--alert)" },
  "reservado": { rotulo: "Reservado", cor: "var(--text-dim)" },
  "livre":     { rotulo: "Livre",     cor: "var(--success)" },
};

// Contadores do cabeçalho, na ordem em que aparecem no index.html.
const KPIS = ["emUso", "reservados", "livres"];

const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

// Arte de cada carro, em public/img/carros. O card mostra a figura no lugar da
// placa e do nome do modelo: numa TV, a silhueta identifica o carro de longe,
// coisa que "HYUNDAI/HB20 1.0M COMFOR" em letra miúda não faz.
//
// A busca é por palavra-chave DENTRO do modelo, e não pelo nome inteiro, porque
// o cadastro escreve cada carro de um jeito ("FIAT PULSE AUDACE TF200",
// "VW/SAVEIRO CS TL MB") — um HB20 novo com outra versão no fim do nome
// continua achando a arte.
//
// Todas as artes são exportadas com a MESMA altura (mesma convenção dos ícones
// de img/info), então só a largura muda de um modelo para o outro e a altura
// vive numa constante só. As medidas vão no <img> apenas para o navegador saber
// a proporção antes de baixar a imagem e já reservar o espaço certo — sem isso a
// figura chega depois e empurra o texto da reserva, um solavanco no meio da
// tela. Quem manda no tamanho final é o object-fit do CSS, então uma largura
// desatualizada aqui só custa um ajuste no primeiro quadro.
//
// CARRO NOVO NA FROTA: exporte o PNG com 400px de altura, ponha em
// public/img/carros e acrescente a linha aqui com a largura que ele ficou. O
// nome do arquivo tem que bater com o do disco letra por letra — o Railway roda
// em Linux, onde maiúscula e minúscula são arquivos diferentes; por isso os
// quatro estão todos em caixa baixa. Modelo sem arte simplesmente fica sem
// figura, em vez de virar um quadrado de imagem quebrada.
const ALTURA_ARTE = 400;

const ARTES = [
  { chave: "PULSE",   arquivo: "pulse",   largura: 744 },
  { chave: "HB20",    arquivo: "hb20",    largura: 1038 },
  { chave: "SAVEIRO", arquivo: "saveiro", largura: 1025 },
  { chave: "ETIOS",   arquivo: "etios",   largura: 896 },
];

// O alt leva o modelo porque a figura é a ÚNICA identificação do carro no card
// — não sobrou texto nenhum para dizer de quem é a reserva.
function arteDoModelo(modelo) {
  const nome = String(modelo || "").toUpperCase();
  const arte = ARTES.find((a) => nome.includes(a.chave));
  if (!arte) return "";
  return `<img class="veiculo-card__foto" src="/img/carros/${arte.arquivo}.png"
               alt="${escapar(modelo)}"
               width="${arte.largura}" height="${ALTURA_ARTE}" decoding="async">`;
}

// Pular as preposições ao abreviar: "Leonardo de Souza" cortado nas duas
// primeiras palavras vira "Leonardo de", que não identifica ninguém.
const CONECTIVOS = new Set(["de", "da", "do", "das", "dos", "e", "di", "del"]);

// Primeiro nome + primeiro sobrenome de verdade, em caixa de título — os nomes
// vêm do cadastro como a pessoa digitou ("STEFAN VIANA DA CRUZ", "aline
// dlugosz"), e no painel eles ficam lado a lado.
function nomeCurto(nome) {
  if (!nome) return "";
  const partes = String(nome).trim().split(/\s+/).filter(Boolean);
  const sobrenome = partes.slice(1).find((p) => !CONECTIVOS.has(p.toLowerCase()));
  return [partes[0], sobrenome]
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
}

// "2026-08-01" -> "Sex 01/08". Datas vêm do servidor como texto puro, sem
// fuso: montar um Date com T12:00 evita o clássico "um dia a menos".
function rotuloData(data, hoje) {
  if (!data) return "";
  if (data === hoje) return "Hoje";
  const d = new Date(`${data}T12:00:00`);
  if (Number.isNaN(d.getTime())) return data;
  return `${DIAS_SEMANA[d.getDay()]} ${data.slice(8, 10)}/${data.slice(5, 7)}`;
}

// Quanto da reserva já correu, de 0 a 1 — vira a barrinha do card em uso.
function progresso(reserva, agora) {
  const minutos = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const inicio = minutos(reserva.inicio);
  const fim = minutos(reserva.fim);
  if (!(fim > inicio)) return 0;
  return Math.min(1, Math.max(0, (minutos(agora) - inicio) / (fim - inicio)));
}

function mostrarAviso(mensagem) {
  const aviso = document.querySelector("#reservas-aviso");
  aviso.textContent = mensagem || "";
  aviso.classList.toggle("reservas-aviso--visivel", Boolean(mensagem));
}

// Corpo do card: o que interessa saber olhando de longe muda conforme o estado.
function corpoDoCard(veiculo, dados) {
  const { atual, proxima } = veiculo;

  if (atual) {
    return `
      <div class="reserva-condutor">${escapar(nomeCurto(atual.usuario) || "Sem condutor")}</div>
      <div class="reserva-motivo" title="${escapar(atual.motivo)}">${escapar(atual.motivo || "Sem motivo informado")}</div>
      <div class="reserva-janela">
        <span>${escapar(atual.inicio)}</span>
        <div class="reserva-barra"><span style="width: ${(progresso(atual, dados.agora) * 100).toFixed(1)}%;"></span></div>
        <span>${escapar(atual.fim)}</span>
      </div>`;
  }

  if (proxima) {
    return `
      <div class="reserva-condutor reserva-condutor--espera">${escapar(nomeCurto(proxima.usuario) || "Sem condutor")}</div>
      <div class="reserva-motivo" title="${escapar(proxima.motivo)}">${escapar(proxima.motivo || "Sem motivo informado")}</div>
      <div class="reserva-espera">
        Sai ${escapar(rotuloData(proxima.data, dados.hoje).toLowerCase())} às <strong>${escapar(proxima.inicio)}</strong>
      </div>`;
  }

  return `<div class="reserva-livre">Sem reservas nos próximos dias</div>`;
}

// Assinatura do que está desenhado: só o que muda o HTML. Os contadores do
// cabeçalho ficam de fora — eles se atualizam sozinhos (ver aplicarNumeros).
function assinaturaDe(dados) {
  return dados.veiculos
    .map((v) => [
      v.id, v.estado, v.modelo,
      v.atual?.id, v.atual?.inicio, v.atual?.fim,
      v.proxima?.id, v.proxima?.data, v.proxima?.inicio,
    ].join(":"))
    .concat(dados.proximas.map((r) => `${r.id}:${r.data}:${r.inicio}`))
    .join("|");
}

let assinaturaAtual = null;

function desenhar(dados) {
  const alvo = document.querySelector("#reservas-veiculos");
  const mural = document.querySelector("#reservas-proximas");

  document.querySelector("#reservas-agora").innerHTML =
    `Atualizado às <strong>${escapar(dados.agora)}</strong>`;

  // Esta tela se atualiza a cada minuto e, na maior parte deles, nada muda:
  // refazer o innerHTML custaria layout + repintura da vista inteira e
  // reiniciaria a cascata .anima-surgir de todos os cards, de minuto em minuto,
  // na frente de quem está olhando. Só remonta quando alguma reserva muda.
  const assinatura = assinaturaDe(dados);
  const remontar = assinatura !== assinaturaAtual;

  if (remontar) {
    assinaturaAtual = assinatura;

    // Grade o mais quadrada possível: com auto-fit, uma frota de 4 carros
    // enfileirava três em cima e um sozinho embaixo. O teto de 4 colunas evita
    // que uma frota grande vire uma fileira de cards estreitos.
    alvo.style.setProperty(
      "--colunas",
      String(Math.min(4, Math.max(1, Math.ceil(Math.sqrt(dados.veiculos.length)))))
    );

    alvo.innerHTML = dados.veiculos.length
      ? dados.veiculos.map((v, i) => {
          const estado = ESTADOS[v.estado] || ESTADOS.livre;
          return `
            <div class="veiculo-card veiculo-card--${v.estado} anima-surgir" style="--ordem: ${i}; --cor-estado: ${estado.cor};">
              <div class="veiculo-card__topo">
                <span class="veiculo-selo"><span class="veiculo-selo__bolinha"></span>${estado.rotulo}</span>
              </div>
              ${arteDoModelo(v.modelo)}
              <div class="veiculo-card__corpo">${corpoDoCard(v, dados)}</div>
            </div>`;
        }).join("")
      : `<p style="color: var(--text-dim);">Nenhum veículo cadastrado.</p>`;

    mural.innerHTML = dados.proximas.length
      ? dados.proximas.map((r) => `
          <div class="proxima">
            <div class="proxima__quando">
              <span class="proxima__dia">${escapar(rotuloData(r.data, dados.hoje))}</span>
              <span class="proxima__hora">${escapar(r.inicio)}–${escapar(r.fim)}</span>
            </div>
            <div class="proxima__carro">${escapar(r.prefixo)}</div>
            <div class="proxima__quem">${escapar(nomeCurto(r.usuario) || "Sem condutor")}</div>
            <div class="proxima__motivo" title="${escapar(r.motivo)}">${escapar(r.motivo || "Sem motivo informado")}</div>
          </div>`).join("")
      : `<div class="proxima__vazio">Nenhuma reserva futura.</div>`;
  }

  // Os contadores seguem a ordem dos KPIs no index.html.
  aplicarNumeros(
    document.querySelector("#vista-reservas"),
    "[data-reserva-kpi]",
    KPIS.map((chave) => dados.resumo[chave] || 0),
    remontar
  );
}

async function atualizar() {
  try {
    const dados = await consultarVeiculosReservas();
    mostrarAviso("");
    desenhar(dados);
  } catch (erro) {
    mostrarAviso(typeof erro === "string" ? erro : "Erro ao carregar as reservas de veículos.");
  }
}

atualizar();
setInterval(atualizar, INTERVALO_ATUALIZACAO_MS);
