// Escape de HTML para interpolação segura em templates de innerHTML.
// Todo texto vindo do banco (SQL Server) ou de APIs externas (Railway) passa
// por aqui antes de virar HTML — evita XSS armazenado/refletido nos painéis.
export function escapar(texto) {
  return String(texto)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
