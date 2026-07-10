---
name: dashboard-esqueleto
description: A home do app está virando um dashboard pessoal (esqueleto para widgets futuros) — relógio, clima e grade de tiles
metadata:
  type: project
---

A tela inicial (`src/index.html`) evoluiu de "monitor de serviços" para um **dashboard pessoal** ("Dashboard Pessoal - Lucas"), montado como um **esqueleto para personalização futura**, baseado num mockup que o Lucas forneceu em 2026-07-07.

Layout atual da home:
- **Header**: título + toggle de tema + botão reload (atualiza o clima) + botão configurações (ícone de engrenagem).
- **`#tiles`**: um **grid ÚNICO onde tudo é bloco** — o widget relógio+clima é só o primeiro bloco (3×2 células, classe `bloco--w3h2`); o resto são `.tile.tile--vazio` (placeholders cinzas) que fluem ao redor/por baixo dos widgets via `grid-auto-flow: dense` e preenchem a tela até o fim da janela.

**Sistema de blocos** (decisão do Lucas: um grid só, com blocos de tamanhos que ele define, alguns valendo 2 blocos):
- Células quadradas: `renderTiles()` em `main.js` mede a largura da coluna e seta `grid-auto-rows` igual, e completa a tela com placeholders (recalcula no resize).
- Classes de tamanho em `index.html`: nada = 1×1, `bloco--w2` = 2 colunas, `bloco--h2` = 2 fileiras, `bloco--w2h2` = 2×2, `bloco--w3h2` = 3×2.
- Widgets reais dentro de `#tiles` levam `data-bloco="N"` (nº de células ocupadas, ex. 3×2 → 6) para o preenchimento descontar os placeholders certinho.

**Arquitetura atual (web + backend Node, para Railway — 2026-07-07)**: o projeto foi adaptado do app Tauri para um site servido por um backend Node/Express, alvo de deploy no **Railway**.
- **Backend** na raiz: `server.js` (Express) serve `public/` e expõe a API `/api/*`; `store.js` persiste em `data/data.json` (`{ servicos, config }`) — no Railway precisa de **volume persistente** apontado por `DATA_DIR`, senão zera a cada deploy. Deploy via Nixpacks (detecta o `package.json`, roda `npm start`); só a dep `express`.
- **Front** em `public/`: `main.js`, `tema.js`, `configuracoes.js`, HTMLs. A camada de dados `public/downdetector.js` mantém a mesma interface exportada de sempre (por isso os consumidores não mudam), mas agora faz `fetch` para `/api/*` em vez de `invoke`/`localStorage`.
- **Clima**: Open-Meteo (geocoding + forecast, sem chave). O backend faz o proxy em `/api/clima?cidade=`. Cidade é texto livre nas Configurações, chave `"cidade"`.
- **Downdetector REMOVIDO da home por ora** (decisão do Lucas): a Cloudflare do site bloqueia scraping de IP de datacenter (Railway) — testado com Puppeteer + stealth, até headful, sempre "Just a moment...". O backend Rust do Tauri só funcionava em **localhost / IP residencial**. O scraper Puppeteer está guardado em `downdetector-scraper.js.txt` (fora do build). A gestão de serviços (nome/slug/logo) continua nas Configurações e persiste no backend, pronta para quando definirmos a fonte de status (provável caminho: APIs de status oficiais com JSON/CORS, não o Downdetector).
- **Paginação por bolinhas** (`public/paginacao.js`): barra fixa no rodapé com uma bolinha por página (Dashboard, Configurações); a ativa vira pílula verde com pulso. Componente injeta o próprio CSS; cada página chama `montarPaginacao()` no DOMContentLoaded. **Página nova = adicionar em `PAGINAS`** nesse arquivo. O grid de tiles desconta 76px no rodapé para não ficar embaixo da barra.
- **Ritmo de atualização**: o dashboard se atualiza a cada 5 min (`INTERVALO_ATUALIZACAO_MS` em `main.js`); widgets futuros devem usar o mesmo intervalo.
- `public/styles.css` é sobra do template Tauri, não referenciado por nenhuma página.

**Why:** o Lucas disse explicitamente que o mockup é um esqueleto para personalização futura — decisões de arquitetura devem favorecer extensibilidade (grade de tiles reutilizável, config genérica) em vez de hard-code.
**How to apply:** novo widget = HTML dentro de `#tiles` com classe de tamanho (`bloco--*`) + `data-bloco="N"`; nunca criar containers de layout separados fora do grid. Persistir preferências via `getConfig`/`setConfig` (que batem em `/api/config/:chave`). Nova fonte de dados = novo endpoint em `server.js` + função no `public/downdetector.js`.

# Memória do projeto

- [Dashboard esqueleto](dashboard-esqueleto.md) — home é um grid único de blocos (relógio 3×2, clima, placeholders); widgets futuros entram como blocos `bloco--*` + `data-bloco`
