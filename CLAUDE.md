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
- **Determinístico.** Mesmo CSV de entrada -> mesmo JSON de saída (Kalman é forma fechada).

## Fluxo de dados

```
Wikipédia (API MediaWiki)  ──fetch.mjs──▶  data/polls.<corrida>.csv   (uma linha por pesquisa)
                                                    │
                                       + data/overrides.<corrida>.csv  (edição manual: adiciona/corrige)
                                                    │
                                          aggregate.mjs (Kalman + house effects)
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

## Modelo (`site/kalman.js`, usado por `aggregate.mjs` e `agg.js`)

Estado-espaço 1-D por candidato, grade **diária** (dias desde a 1ª pesquisa):

- **Estado:** `x_t = x_{t-1} + η`, `η ~ N(0, q·Δdias)`. `q` = variância de evolução/dia
  (`0.032`, ou `0.02` p/ corridas < `sparseCutoff`). Passeio aleatório: pesquisa antiga
  informa menos o "hoje" automaticamente — **não há peso de recência explícito**.
- **Observação:** `z_i = x_{t_i} + ε`, `ε ~ N(0, r_i)`, `r_i = designEffect · p(1−p)/n · 1e4`
  (`designEffect = 1.6`; `n=1200` se faltar). Várias pesquisas no mesmo dia = combinação
  precisão-ponderada. **Rating do instituto** entra dividindo `r_i` por `ratingW²`
  (casa que acerta mais pesa mais).
- **Inferência:** filtro de Kalman para frente + suavizador RTS para trás. Forma fechada,
  **determinística** (sem RNG).
- **Linha** = média suavizada `xS[t]`. **Faixa (~90%)** = `xS ± z·sqrt(PS[t] + sysHalf²)`,
  `z=1.64`, `sysHalf=1.1` (erro sistemático do setor — todo mundo erra junto), piso `floorHalf`.
- **House effects:** 1ª passada Kalman como tendência de referência; resíduo médio de cada
  `(instituto, candidato)`, encolhido por `n/(n+5)`, limitado a `±houseMaxShift` (4 p.p.);
  subtrai dos pontos e refita. Só com ≥20 pesquisas e ≥5 institutos. Vai pro JSON em `houseEffects`.
- **Bordas:** a linha some além de `maxGapDays` (45) sem pesquisa por perto; a incerteza
  cresce sozinha onde há pouco dado (é o ponto do modelo).
- Só plota candidato ATIVO: ≥6 pesquisas, ≥5 recentes (75d), última há ≤25d, média recente ≥4 p.p.
- Saída: reamostrada a cada `gridStepDays` (2) da grade diária.

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

- `index.html` + `style.css` + `app.js` (+ `agg.js`, `kalman.js`), sem framework. Abas de `data/index.json`.
- Gráfico em **SVG** desenhado à mão: `<path>` da faixa (área) + `<path>` da linha, spline
  Catmull-Rom -> Bézier pra suavizar. Transições em CSS. Séries quebram em buracos > `GAP_DAYS`.
- Abas de grupo + sub-abas 1T/2T. No 2º turno presidencial, `<select>` de cenário (Lula × cada um).
- **Filtro de institutos + período**: `agg.js` refaz o Kalman+faixa no cliente com os institutos
  desmarcados / só a janela escolhida (espelha `aggregate.mjs`; usa `data.params` e `data.polls`).
  Todos os institutos ativos e "período: tudo" por padrão.
- **Selo de partido** (`.pbadge`) ao lado do nome na legenda / tooltip / cabeçalho da tabela.
  Cor do candidato = cor do partido (`PARTY` em `races.mjs`), salvo override no `display`.
- Legenda clicável (liga/desliga candidato). Crosshair no hover. Pontos das pesquisas ao fundo.
- Tabela de pesquisas: **vencedor de cada pesquisa** pintado com a cor do partido; linhas de
  institutos desconsiderados aparecem riscadas. "ver todas".
- Responsivo, tema claro/escuro por `prefers-color-scheme`.

## Matemática compartilhada

`site/kalman.js` é a fonte de `trendKalman`; `scripts/lib/kalman.mjs` só reexporta. `site/agg.js`
reimplementa o núcleo de `aggregate.mjs` (pontos, house effects, grade) pro recomputo no
navegador. **Mudou o modelo ou os params no server? Reflita em `agg.js` e no `data.params`.**

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

- ✅ **Modelo Kalman** (estado-espaço) no lugar do LOESS+bootstrap. `site/kalman.js`.
- ✅ **Ratings de instituto** — `scripts/ratings.mjs` faz backtest das finais de 2018 e 2022
  (seção 5 dos artigos presidenciais), MAE vs. resultado oficial → `data/ratings.json` (peso
  0.88–1.12, encolhido por nº de ciclos). Entra no `r_i` do Kalman. Mostrado na tabela (`.rt`).
  `build.mjs` roda como best-effort (não derruba o build).
- ✅ Filtro de institutos + **período** (recomputo no cliente).
- ✅ Cenários múltiplos: usa o mais completo. 2º turno: presidente (4 cenários) + SP/RJ/PR.
- ✅ Mais estados: MG, RJ, PR, RS. **Senado** dos 5 estados. House effects. Selo/cor de partido.
- ✅ "O que mudou" (∆ ~30d) na legenda. Geometria responsiva no celular. Meta OG + og.svg.
- Corridas `optional: true` (2º turno de estado sem pesquisa ainda) são puladas sem quebrar o build.
  Sub-abas por `round`: `1T` / `2T` / `SEN` (ROUND_LABEL no app.js). Estados gerados por `stateRaces()`.

## TODO / fase 2

- **Backtest público**: página mostrando `data/ratings.csv` (como cada instituto se saiu).
- **2018 rotula colunas por PARTIDO** — `ratings.mjs` tem `remap` fixo; se a Wiki mudar, quebra.
- Probabilidade de 2º turno / vitória (Monte Carlo). Projeção pro dia da eleição.
- 2º turno dos estados · Senado · "o que mudou" (∆ 1 sem / 1 mês) · URL com estado.
- TSE: mirror/proxy BR pro cross-check de registro (API dá 403 via Akamai).
- Aba de rejeição — espera a Wikipédia criar a seção 2026.
- Partido não lido pra ~2 candidatos estaduais (Cleitinho/PSD, Garotinho) — cor de fallback.
