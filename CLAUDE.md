# Agregador BR — fonte de verdade

Agregador de pesquisas eleitorais para **presidente do Brasil** e **governador de São Paulo**,
eleições de 2026. Objetivo principal: um **gráfico de tendência fluido e bonito**, estilo
FiveThirtyEight, com a **margem de erro como uma "aura"** (faixa) em volta de cada linha.

## Princípios

- **Zero dependências de runtime, zero build.** Só Node (>=20, `fetch` nativo) e HTML/CSS/JS puro.
  Se algo "precisar" de uma lib, primeiro tente resolver com ~50 linhas próprias.
- **Dados versionados no repo.** O pipeline faz commit dos CSVs e do JSON calculado. O histórico
  do git é o histórico do agregador.
- **O site só lê JSON estático.** Nada de backend. Deploy = GitHub Pages servindo `site/`.
- **Determinístico.** Mesmo CSV de entrada -> mesmo JSON de saída (seed fixa no bootstrap).

## Fluxo de dados

```
Wikipédia (API MediaWiki)  ──fetch.mjs──▶  data/polls.<corrida>.csv   (uma linha por pesquisa)
                                                    │
                                       + data/overrides.<corrida>.csv  (edição manual: adiciona/corrige)
                                                    │
                                          aggregate.mjs (LOESS + bootstrap)
                                                    ▼
                                         site/data/<corrida>.json      (tendência + pontos)
```

- `build.mjs` = `fetch.mjs` && `aggregate.mjs`.
- Corridas (`<corrida>` = chave em `RACES`): `presidente`, `presidente-2t`, `sp-governador`,
  `sp-governador-2t`, `mg-governador`, `rj-governador`, `pr-governador`, `rs-governador`.
  `aggregate.mjs` também gera `site/data/index.json` (lista `{key,group,round,label,wiki,nPolls}`
  na ordem de `RACES`) — o front monta as abas a partir dele. Abas = `group`; sub-abas = `round`
  (1T/2T) quando o grupo tem mais de uma corrida.

### Fontes

| Fonte | Papel | Como |
|---|---|---|
| Wikipédia PT | espinha dorsal (todas as pesquisas, tabelas cronológicas) | API MediaWiki `action=parse`, por seção |
| citações da Wikipédia | link de fonte por pesquisa (`source`) | `buildRefMap` sobre o wikitext da página; casa `<ref name>` |
| `data/overrides.*.csv` | curadoria manual — pesquisa nova antes de entrar na Wiki, ou correção | editar à mão, commitar |
| TSE Dados Abertos | ~~cross-check de registro~~ | **bloqueado** (Akamai 403 na API e no CDN, inclusive do CI). Reavaliar com mirror/proxy BR |

Wikipédia é CC BY-SA: o site credita a fonte no rodapé + link por pesquisa na tabela.

### Artigos da Wikipédia

Um por corrida, em `scripts/races.mjs` (`wikiPage`). Estaduais seguem o padrão
`Pesquisas eleitorais para a eleição estadual de 2026 em/no <Estado>`; presidencial é
`Pesquisas de opinião para a eleição presidencial no Brasil em 2026`.

Config de cada corrida (grupo, turno, seções-alvo, candidatos, cores) fica em `scripts/races.mjs`.
Regras de seção reutilizáveis: `presFirstRound` (`^1\.1\.\d+$`), `govFirstRound` (`^2\.1\.\d+$`),
`exact("2.1.1")` p/ 2º turno. Adicionar estado = uma entrada em `RACES` com `govFirstRound`.

## Formato do CSV (`data/polls.<corrida>.csv`)

Colunas fixas + uma coluna por candidato (chave curta, minúscula). Vazio = não perguntado.

```
id,pollster,start,end,n,moe,source,scenario,<cand1>,<cand2>,...
atlasintel-2026-08-30,AtlasIntel,2026-08-25,2026-08-30,5014,2.0,https://...,estimulado 1T,43.4,33.7,...
```

- `id`: `slug(pollster)-<end ISO>` (+ sufixo se colidir). Chave de dedupe.
- `start`/`end`: ISO `YYYY-MM-DD`. `end` é o que o gráfico usa no eixo x.
- `n`: tamanho da amostra (int). `moe`: margem de erro em pontos (float) — se ausente, deriva de `n`.
- `scenario`: quando uma pesquisa tem vários cenários, pegamos **o primeiro** (1º turno estimulado
  principal). Linhas de continuação da Wiki são ignoradas na v1 (ver TODO).
- Percentuais: número, sem `%`. Ponto decimal.

`overrides.<corrida>.csv` tem o mesmo cabeçalho. Merge por `id`: override vence. `id` começando
com `-` (ex.: `-atlasintel-2026-08-30`) **remove** aquela pesquisa.

## Modelo (aggregate.mjs)

Por candidato, sobre `end` (dias desde a 1ª pesquisa):

1. **LOESS** ponderado local (grau 1, tricubo). Peso de cada ponto =
   `w_kernel * w_recencia * w_amostra`:
   - `w_recencia = 0.5 ^ (idade_em_dias / HALFLIFE)` (HALFLIFE em `races.mjs`, ~28d)
   - `w_amostra = sqrt(n / 1000)`, saturado em [0.5, 2]
   - `bandwidth`: fração dos pontos (`span`, ~0.35) — ajustada p/ ter no mínimo `minPts`.
2. **House effects:** 1ª passada de tendência (sem bootstrap); resíduo médio de cada
   `(instituto, candidato)` vs. a tendência, encolhido por `n/(n+5)` e limitado a
   `±AGG.houseMaxShift` (4 p.p.); subtrai dos pontos e refita. Só quando ≥20 pesquisas e
   ≥5 institutos. Vai pro JSON em `houseEffects`.
3. **Faixa (aura):** bootstrap por reamostragem das pesquisas (com reposição, pesos mantidos),
   `B` réplicas (default 200), seed fixa (`mulberry32`). Meio-intervalo = (p10..p90 das réplicas)
   ⊕ erro amostral local, simétrico em torno da linha, teto de 8 p.p.
4. Corridas com <25 pesquisas: `span` e bandwidth maiores (menos pico espúrio).
5. Só plota candidato ATIVO: ≥6 pesquisas, ≥5 recentes (75d), última há ≤25d, média recente ≥4 p.p.
6. Saída: grade a cada `gridStepDays` (2) do 1º ao último `end`.

### `site/data/<corrida>.json`

```jsonc
{
  "race": "presidente", "label": "...", "updated": "...Z",
  "nPolls": 102, "nWithSource": 92, "lastPoll": "2026-08-30",
  "pollsters": ["AtlasIntel", ...],
  "xDomain": ["2026-01-15", "2026-08-30"],
  "shown": [{ "key": "lula", "name": "Lula", "color": "#..." }, ...],
  "candidates": [
    { "key": "lula", "name": "Lula", "party": "PT", "color": "#...",
      "line": [{ "t": "2026-01-15", "y": 41.2 }, ...],
      "band": [{ "t": "2026-01-15", "lo": 38.1, "hi": 44.0 }, ...],
      "polls": [{ "t": "2026-08-30", "y": 43.4, "pollster": "AtlasIntel", "n": 5014 }, ...] }  // pontos CRUS
  ],
  "houseEffects": { "AtlasIntel": { "lula": 1.8, "flavio": -0.4 }, ... },  // {} se não aplicado
  "polls": [ { "pollster","start","end","n","moe","source","values": {"lula":43.4,...} }, ... ]  // tabela, recentes 1º
}
```

## Site (`site/`)

- `index.html` + `style.css` + `app.js` (+ `agg.js`, `loess.js`), sem framework. Abas de `data/index.json`.
- Gráfico em **SVG** desenhado à mão: `<path>` da faixa (área) + `<path>` da linha, spline
  Catmull-Rom -> Bézier pra suavizar. Transições em CSS. Séries quebram em buracos > `GAP_DAYS`.
- Abas de grupo + sub-abas 1T/2T. No 2º turno presidencial, `<select>` de cenário (Lula × cada um).
- **Filtro de institutos**: `agg.js` refaz o LOESS+faixa no cliente com os institutos desmarcados
  (espelha `aggregate.mjs`; usa `data.params` e `data.polls`). Todos ativos por padrão.
- **Selo de partido** (`.pbadge`) ao lado do nome na legenda / tooltip / cabeçalho da tabela.
  Cor do candidato = cor do partido (`PARTY` em `races.mjs`), salvo override no `display`.
- Legenda clicável (liga/desliga candidato). Crosshair no hover. Pontos das pesquisas ao fundo.
- Tabela de pesquisas: **vencedor de cada pesquisa** pintado com a cor do partido; linhas de
  institutos desconsiderados aparecem riscadas. "ver todas".
- Responsivo, tema claro/escuro por `prefers-color-scheme`.

## Matemática compartilhada

`site/loess.js` é a fonte de `loess` / `loessWithBand` / `mulberry32`; `scripts/lib/loess.mjs`
só reexporta. `site/agg.js` reimplementa o núcleo de `aggregate.mjs` (pesos, house effects, grade)
pro recomputo no navegador. **Mudou o modelo no server? Reflita em `agg.js`.**

## Automação

`.github/workflows/update.yml`: cron a cada 6h + `workflow_dispatch` + push que toca `scripts/`.
Roda `node scripts/build.mjs`; commita **só `data/`** se algum CSV mudou (`chore: atualiza
pesquisas (bot)`). `site/data/*.json` é derivado (gitignored) e rebuildado a cada deploy.
GitHub Pages publica `site/` via `actions/deploy-pages`.
Repo: `Fcairo1/agregador-br` · site: https://fcairo1.github.io/agregador-br/

## Rodar local

```
npm run build      # fetch + aggregate  (usa .cache/ se existir e --offline)
npm run serve      # http://localhost:5173  (servidor estático, Node puro)
```

`node scripts/fetch.mjs --offline` usa os HTML já baixados em `.cache/` (dev sem rede).

## Feito

- ✅ 2º turno: SP (Tarcísio×Haddad) + presidencial com 4 cenários (Lula × Flávio/Zema/Caiado/Renan).
- ✅ Mais estados: MG, RJ, PR, RS (1º turno). Adicionar outro = 1 entrada em `RACES`.
- ✅ House effects por instituto.
- ✅ Link de fonte por pesquisa + tabela no site + limpeza de institutos/linhas-fantasma.
- ✅ Filtro de institutos (recomputo no cliente) · selo + cor de partido · vencedor pintado na tabela.

## TODO / fase 2

- Linhas de continuação da Wiki (cenários múltiplos): hoje só o 1º. Decidir política.
- TSE: achar mirror/proxy BR pro cross-check de registro (API oficial dá 403 via Akamai).
- Ratings de instituto (histórico de acerto) ponderando o agregado.
- 2º turno dos estados (matchups variam; hoje só presidente e SP).
- "O que mudou": variação vs. 1 semana / 1 mês. Probabilidade de 2º turno / vitória.
- Senado (as páginas estaduais têm a seção).
- Partido não é lido pra ~2 candidatos estaduais (ex.: Cleitinho/PSD, Garotinho) — cor de fallback.
  Corrigir no parser (`candFromHeader`) ou via `display` em `races.mjs`.
