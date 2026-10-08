// Dá nome de sistema às consultas que aparecem no painel "O que mais pesou" da
// aba Azure SQL / DTU: em vez do SQL cru, a TV mostra "Gestor de Tarefas",
// "Helpdesk"... O banco é um só e cada sistema da empresa tem o seu schema (ou,
// no dbo, suas tabelas), então o nome sai de quais tabelas a consulta toca.
//
// Para ajustar: edite os títulos abaixo ou acrescente linhas. A PRIMEIRA regra
// que casar vence, por isso as de schema vêm antes das de tabela do dbo (uma
// consulta do Gestor de Tarefas que cruza com dbo.COLABORADORES é do Gestor).

// "gestor." ou "[gestor].[tarefas]" — o schema colado ao nome da tabela.
const schema = (nome) => new RegExp(`(?:^|[^\\w.])\\[?${nome}\\]?\\.\\[?\\w`, "i");

const REGRAS = [
  // O próprio monitor de DTU e o Query Store: nunca são "o sistema" que pesa.
  ["Monitor de DTU (este painel)", /\bsys\.(?:dm_|query_store)/i],
  // Planilha do Excel sincronizando por um add-in (tabela temporária ##EXCEL...).
  ["Sincronização via Excel", /##EXCEL_DATA_SYNC/i],

  // ----- Um schema por sistema -----
  ["Gestor de Tarefas", schema("gestor")],
  ["Helpdesk", schema("helpdesk")],
  ["Inventário de TI", schema("inventario")],
  ["Patrimônio", schema("patrimonio")],
  ["Manutenção", schema("manutencao")],
  ["Frete", schema("FRETE")],
  ["Notas Fiscais", schema("nfs")],
  ["Gestão de Frota", schema("Ges_Frota")],
  ["Portal RH", schema("portalrh")],
  ["Estoque", schema("estoque")],
  ["Acessos (IAM)", schema("iam")],
  ["SAP", schema("sap")],
  ["Limpeza", schema("limpeza")],
  ["Controladoria", schema("controladoria")],

  // ----- Tabelas do dbo, agrupadas pelo sistema que as usa -----
  ["Helpdesk", /\bHELPDESK_/i],
  ["Apontamento", /\b(?:ORGANOGRAMA|BOLETIM_DIARIO|HISTORICO_BDO|ATIVIDADES|FOLGAS|PREMIO|PROJETOS|FAZENDAS|MOV_INSUMOS)\b/i],
  ["Ordens de Serviço", /ORDEM DE SERVI/i],
  ["Reservas de Veículos", /\bVEICULOS_(?:RESERVAS|TESTE)/i],
  ["Frota", /\b(?:FROTA|TICKET)\b/i],
  ["Colaboradores", /\bCOLABORADORES/i],
];

// Nome do sistema que a consulta usa, ou null se nenhuma regra casar.
export function identificarSistema(texto) {
  const sql = String(texto ?? "");
  for (const [titulo, regra] of REGRAS) {
    if (regra.test(sql)) return titulo;
  }
  return null;
}
