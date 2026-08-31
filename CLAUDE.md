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
- Corridas (`<corrida>`): `presidente`, `sp-governador`.

### Fontes

| Fonte | Papel | Como |
|---|---|---|
| Wikipédia PT | espinha dorsal (todas as pesquisas, tabelas cronológicas) | API MediaWiki `action=parse`, por seção |
| `data/overrides.*.csv` | curadoria manual — pesquisa nova antes de entrar na Wiki, ou correção | editar à mão, commitar |
| TSE Dados Abertos | validação futura ("essa pesquisa está registrada?") | dataset "Pesquisas Eleitorais 2026", CKAN API (TODO fase 2) |

Wikipédia é CC BY-SA: o site credita a fonte no rodapé.

### Artigos da Wikipédia (títulos exatos)

- presidente: `Pesquisas de opinião para a eleição presidencial no Brasil em 2026`
- sp-governador: `Pesquisas eleitorais para a eleição estadual de 2026 em São Paulo`

Config de cada corrida (seções-alvo, candidatos exibidos, cores) fica em `scripts/races.mjs`.

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
2. **Faixa (aura):** bootstrap por reamostragem das pesquisas (com reposição, pesos mantidos),
   `B` réplicas (default 200), seed fixa (`mulberry32`). Faixa = percentis 10 e 90 das réplicas
   em cada ponto da grade. Some em quadratura o erro amostral médio local para não subestimar.
3. Saída: grade diária (ou a cada 2 dias) do 1º ao último `end`.

### `site/data/<corrida>.json`

```jsonc
{
  "race": "presidente",
  "updated": "2026-08-31T12:00:00Z",
  "source": "Wikipédia (CC BY-SA) + curadoria",
  "xDomain": ["2026-01-15", "2026-08-30"],
  "candidates": [
    { "key": "lula", "name": "Lula", "party": "PT", "color": "#c4122f",
      "line":  [{ "t": "2026-01-15", "y": 41.2 }, ...],
      "band":  [{ "t": "2026-01-15", "lo": 38.1, "hi": 44.0 }, ...],
      "polls": [{ "t": "2026-08-30", "y": 43.4, "pollster": "AtlasIntel", "n": 5014 }, ...] }
  ]
}
```

## Site (`site/`)

- `index.html` + `style.css` + `app.js`, sem framework.
- Gráfico em **SVG** desenhado à mão: `<path>` da faixa (área) + `<path>` da linha, spline
  Catmull-Rom -> Bézier pra suavizar. Transições em CSS.
- Toggle Presidente / Governador SP. Legenda clicável (isola candidato). Crosshair no hover
  com os valores do dia. Pontos das pesquisas ao fundo, esmaecidos.
- Responsivo, tema claro/escuro por `prefers-color-scheme`.

## Automação

`.github/workflows/update.yml`: cron a cada 6h + `workflow_dispatch`. Roda `npm run build`,
e se `git status` mudou, commita (`chore: atualiza pesquisas (bot)`). GitHub Pages publica `site/`.

## Rodar local

```
npm run build      # fetch + aggregate  (usa .cache/ se existir e --offline)
npm run serve      # http://localhost:5173  (servidor estático, Node puro)
```

`node scripts/fetch.mjs --offline` usa os HTML já baixados em `.cache/` (dev sem rede).

## TODO / fase 2

- Linhas de continuação da Wiki (cenários múltiplos): hoje só o 1º. Decidir política.
- 2º turno (head-to-head) como visão separada.
- Cross-check com TSE Dados Abertos (pesquisa registrada? nº de registro).
- Ajuste de "house effect" por instituto.
- Ratings de instituto (histórico de acerto) ponderando o agregado.
