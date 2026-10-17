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

Config de cada corrida (grupo, turno, candidatos, cores) fica em `scripts/races.mjs`.

**Seleção de tabelas por BREADCRUMB de títulos** (`pathRule(path, ctx)`), não por índice de seção.
Motivo: a Wikipédia passou a transcluir as tabelas mensais de templates → os índices viram
`T-1` e o fetch por seção puxava o ano inteiro (2022/2018 juntos). `fetchRacePolls` agora baixa
o HTML da página toda (`getPageHTML`), monta o breadcrumb h2>h3>h4 de cada `<table wikitable>`
(`tablesWithHeadings`) e filtra com `race.pathRule`.
Regras prontas: `presFirstRound` (`["Primeiro turno","2026", …]`), `govFirstRound`
(`/primeiro turno/i` + `/governador/i` + inclui "2026"), `senado`, `lulaVs(rx)`, `spRunoff`,
`govSecondRound` (1º confronto via `ctx.firstSub`). Adicionar estado = `stateRaces()`.
**Anos perdidos (set/2026):** a Wikipédia recolou o arquivo de 2022–2025 no artigo principal SEM os
títulos "2025"/"2024"…, então meses antigos viraram irmãos dos de 2026 sob o mesmo `<h3>` "2026".
`corrigeAnosPerdidos()` (wiki.mjs) detecta isso pela ordem dos meses (cada ano lista numa ordem só;
quando "volta", é o ano anterior) e reescreve o título de ano no breadcrumb. Além disso
`fetchRacePolls` descarta pesquisa com data no futuro, e `check.mjs` barra: xDomain < 2026,
pesquisas duplicadas (tabela lida 2×) e lastPoll no futuro.
⚠️ `scripts/ratings.mjs` ainda usa `getSectionHTML` por índice (seção "5" de 2018/22) — funciona
hoje, mas migrar pra `tablesWithHeadings` se aqueles artigos também virarem transclusão.

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
  (`designEffect = 1.6`; `n=1200` se faltar; **`n` limitado a `nCap=3000`** — sem teto, a Veritá de 40 mil dominava
  a tendência; com teto o backtest melhorou: MAE 2022 1.70→1.63, 2018 2.41→2.33). Várias pesquisas no mesmo dia = combinação
  precisão-ponderada. **Rating do instituto** entra dividindo `r_i` por `ratingW²`
  (casa que acerta mais pesa mais).
- **Inferência:** filtro de Kalman para frente + suavizador RTS para trás. Forma fechada,
  **determinística** (sem RNG).
- **Linha** = média suavizada `xS[t]`. **Faixa (~90%)** = `xS ± z·sqrt(PS[t] + sysHalf²)`,
  `z=1.64`, `sysHalf` por corrida (erro sistemático do setor — todo mundo erra junto; `SYS_HALF` em `races.mjs`: **presidente 1,1, estaduais 3,8** — recalibrado com o 1º turno de 2026, onde a faixa de 90% cobriu só 31%; reavaliar após o 2T), piso `floorHalf`.
- **House effects:** 1ª passada Kalman como tendência de referência; resíduo médio de cada
  `(instituto, candidato)`, encolhido por `n/(n+5)`, limitado a `±houseMaxShift` (4 p.p.);
  subtrai dos pontos e refita. Só com ≥20 pesquisas e ≥5 institutos. Vai pro JSON em `houseEffects`.
- **Bordas:** a linha some além de `maxGapDays` (45) sem pesquisa por perto; a incerteza
  cresce sozinha onde há pouco dado (é o ponto do modelo).
- Só entra no JSON o candidato ATIVO: ≥6 pesquisas, ≥5 recentes (75d), última há ≤25d, média
  recente ≥4 p.p. Isso só garante que a linha/banda/pontos existam pra quem foi pesquisado
  recentemente o bastante — não implica que o "valor atual" (rótulo de fim de linha / legenda)
  deva aparecer; essa parte é filtrada no front (abaixo).
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
- **Valor "atual" (rótulo de fim de linha + `.pct` da legenda) só aparece se a última pesquisa do
  candidato está a ≤`CURRENT_STALE_DAYS` (14d) de `data.lastPoll`** (`app.js`). Sem isso, um
  candidato que sumiu das pesquisas (ex.: Marçal, parou em 31/08 com os outros seguindo até 20/09)
  ficava com o número antigo pendurado na borda direita como se fosse de hoje. A linha, a faixa e
  o ponto no hover continuam existindo pro período real em que ele foi pesquisado — só o rótulo
  fixo é que esconde.
- Tabela de pesquisas: **vencedor de cada pesquisa** pintado com a cor do partido; linhas de
  institutos desconsiderados aparecem riscadas. "ver todas".
- Responsivo, tema claro/escuro por `prefers-color-scheme`.

- **Seções dentro do `index.html`** (`#view-pesquisas|resultados|eleitos`, nav `.views`, roteador por hash no fim do `app.js`):
  `resultados.js` e `eleitos.js` exportam `mount(root)` e são carregados sob demanda (`import()`); `#eleitos/<casa>` guarda a sub-aba.
  `resultados.html` e `eleitos.html` só redirecionam. IDs internos têm prefixo (`rs-`, `el-`) pra não colidir com o gráfico.
- **◎ Resultado no gráfico** (`drawResult` em `app.js`): `data/resultados.json` → ponto no dia da eleição (`day`) em `realRaw`, o
  resultado oficial convertido pra base das pesquisas (`real / f`, com `f` = 100/Σ das linhas finais, congelado em
  `data/estimativas.json`). O tooltip mostra os dois números (válidos e base das pesquisas) e a tendência.

- **Toggle de base dos gráficos** (`#base-toggle`, `toValid`/`setData` em `app.js`): "% das pesquisas" (padrão, inclui indecisos/
  brancos/nulos) × "votos válidos" (cada data renormalizada pra os candidatos ATIVOS somarem 100%; linha, faixa e pontos usam o mesmo
  fator). Só os gráficos — a tabela de pesquisas não muda. Preferência em `localStorage["base"]`; `state.raw` guarda o dado sem normalizar.
  No modo válidos o ◎ usa `real` (já em votos válidos) em vez de `realRaw`.

- **2º turno como continuação do gráfico do 1º** (`twinOf`/`mergeTwin`/`setData` em `app.js`): na corrida `presidente` (e `X-governador` que
  tenham `X-governador-2t`), os pontos do 2T "gêmeo" posteriores ao dia da eleição (`resultados.json → day`) são anexados aos finalistas
  (mesma chave), com `brk` na virada (o `segments()` quebra a linha) e divisória cheia "◂ 1º turno | 2º turno ▸". Os ◎ dos dois turnos
  ficam no gráfico (`resultSets`/`drawMarks`); a tabela ganha as pesquisas de 2T com etiqueta "2T"; a legenda mostra o valor do 2T
  e deixa de mostrar delta. A aba "2º turno" segue existindo (com ◎ próprio). Sem pesquisa de 2T pós-eleição, nada muda no gráfico.
  Testado com pesquisas simuladas (nenhuma pesquisa pós-04/10 existia na Wikipédia em 07/10).

- **Presidenciais passadas (menu "Eleição" no topo: 2026 atual · 2022 · 2018 · 2014 · 2010 · 2006 · 2002 · 1998 · 1994 · 1989):** corridas `presidente-<ano>` e
  `presidente-<ano>-2t` em `RACES` (`historic: <ano>`, `noRatings`, `sysHalf` de presidente). Os CSVs `data/polls.presidente-<ano>*.csv`
  são ESTÁTICOS: gerados à mão por `node scripts/historico.mjs` (fetch.mjs pula `historic`; use `--historic` pra forçar). Fontes:
  **2022**: Wikipédia PT (1T) + EN (2T); **2018**: PT (colunas por partido); **2014**: EN (cenário principal, com Campos) + PT;
  **2002/2006/2010**: arquivo de pesquisas do jornalista Fernando Rodrigues (UOL; 2002 direto, 2006/2010 via Wayback Machine — URLs fixas em
  `UOL` no `historico.mjs`, páginas em cache `.cache/uol/`), cenário principal = 1ª linha com os candidatos principais; linhas "(votos
  válidos)" ficam de fora (a base é "% das pesquisas"). Nenhuma Wikipédia tem tabela de pesquisas de 2002/2006. Até 2018 o `eraName()` troca
  Ipec→Ibope e Vox Brasil→Vox Populi. Resultados oficiais em `data/historico-resultados.json` (tabela "Resultados" do artigo PT) →
  `results.mjs` compara (entradas `historic:true`, que a aba Resultados esconde); o gráfico mostra ◎, continuação do 2T e divisória como em 2026.
  `index.json` ganha `year`/`day`; `state.indexAll`/`state.year` em `app.js`. **2014:** a coluna `marina` junta Campos (até 13/ago) e Marina;
  `race.splits = { marina: "2014-08-14" }` roda o modelo separado nas duas fases (`trendKalmanSplit`, `brk` na linha; espelhado em `agg.js`).
  **1989/1994/1998: só a série do Datafolha** (1989: Wikipédia EN, 14 rodadas de 1T + 6 de 2T, sem a boca de urna do dia 15/11; 1994 e 1998: tabelas "Evolução da intenção de voto" dos PDFs do próprio Datafolha, digitadas em `historico.mjs` — 17 e 10 rodadas; 1994/1998 não tiveram 2T). Não achei série multi-instituto dessas eleições (Wikipédia/UOL não têm; CESOP só microdados). Sem tamanho de amostra (1994–2010) o modelo assume n=1.200. Erro médio do agregador (1T → 2T): 2002 1,6→3,8 · 2006 5,4→1,0 ·
  2010 5,3→0,4 · 2014 6,5→0,1 · 2018 2,8→1,6 · 2022 1,6→1,2.

## Matemática compartilhada

`site/kalman.js` é a fonte de `trendKalman`; `scripts/lib/kalman.mjs` só reexporta. `site/agg.js`
reimplementa o núcleo de `aggregate.mjs` (pontos, house effects, grade) pro recomputo no
navegador. **Mudou o modelo ou os params no server? Reflita em `agg.js` e no `data.params`.**

## Automação

`.github/workflows/update.yml`: cron a cada 6h + `workflow_dispatch` + push que toca `scripts/`.
Roda `node scripts/build.mjs`; commita **só `data/`** se algum CSV mudou (`chore: atualiza
pesquisas (bot)`). `site/data/*.json` é derivado (gitignored) e rebuildado a cada deploy.
GitHub Pages publica `site/` via `actions/deploy-pages`.
Repo: `Fcairo1/agregador-br` · site: https://agregador-eleicoes-2026.filipecairo.workers.dev/
(Netlify builda `site/` a cada push; o GitHub Pages em fcairo1.github.io/agregador-br segue
como espelho. Renomear o site no Netlify → atualizar `og:url`/`og:image` em `site/index.html`.)

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

## Pós-eleição (resultados + eleitos)

- `scripts/lib/tse.mjs`: apuração oficial do TSE. Padrão achado no front deles:
  `https://resultados.tse.jus.br/oficial/ele2026/<eleicao>/dados/<uf>/<uf>-c<cargo4>-e<eleicao6>-u.json`
  (eleição 6257 = federal/presidente `br` cargo 1; 6259 = estadual: 3 gov, 5 sen, 6 dep.fed, 7 dep.est.).
  Campos: `tf`="s" = finalizado; candidato `e`="s" eleito, `st` ("Eleito", "2º turno", "Eleito por QP"…),
  `vap`/`pvap` votos/%; `e`/`v` do topo = abstenção/brancos/nulos. Config geral: `/oficial/comum/config/ele-c.json`.
  (A API Dados Abertos/CKAN e o CDN do TSE responderam 200 localmente em out/2026; ST_REELEICAO vem `#NE`.)
- `scripts/results.mjs` (roda após o aggregate): TSE primário (Wikipédia reserva) → `data/results.<corrida>.json`
  + `site/data/resultados.json` (tendência final+faixa × resultado, renormalizado entre os exibidos; erro por instituto
  das últimas pesquisas ≤14d). Página `site/resultados.html`.
- `scripts/antes.mjs` → `data/antes.json`: **foto única** de quem ocupava os cargos (Câmara/Senado: APIs oficiais com nome
  civil; governadores/Alesp: Wikipédia). Não refaz se existir (use `--refresh` SÓ antes da posse; depois as APIs devolvem os novos).
- `scripts/eleitos.mjs` → `data/eleitos.json` (determinístico, sem timestamp) + `site/data/eleitos.json`; página
  `site/eleitos.html`. Escopo: gov/senado todos os estados; dep. federal Sul+Sudeste (`SCOPE_FED`); dep. estadual só SP.
  "Já ocupava" = cruzamento por nome (nome civil > nome de urna > nome parlamentar ⊂ completo). Gênero/cor-raça: cadastro
  `consulta_cand_2026.zip` (leitor de zip próprio em `lib/zip.mjs`, cache em `.cache/`).

- **Estimativas congeladas** (`data/estimativas.json`): a comparação pesquisa × resultado usa o que o modelo mostrava na
  véspera (1T: 04/10; 2T: 25/10), gravado na 1ª rodada depois da eleição — recalibrar o modelo não reescreve a história.
- **Projeção de deputados** (`parseUnified` em `lib/tse.mjs`): enquanto `tf`≠"s", o TSE traz as vagas por partido (`vag`) mas não marca
  eleitos; projeto os mais votados de cada partido (reproduziu 133/133 nos estados fechados). Cede ao oficial quando o TSE fecha.
- **2º turno (25/10):** só presidente (Flávio × Lula) e governador do RJ. TSE: eleições 6258 (federal) e 6260 (estadual); os arquivos só
  existem depois da votação (404 → null). `results.mjs` e `eleitos.mjs` já tratam (testado com dados simulados). Demais governos em 2T ficam "em aberto".

## Apuração (projeção do 2º turno ao vivo) — aba `#apuracao`

Projeção **independente e não oficial** do vencedor Flávio × Lula durante a totalização (a partir das 17h BRT de 25/10/2026).
Botão laranja "● Apuração" no menu. Módulo carregado sob demanda (`app.js` → `MODULO`).

**Arquitetura** (`site/apuracao/`, sem dependências, módulos ES)
- `config.js` — único lugar com horário de início, proxy, códigos de eleição (6257 1T / 6258 2T), candidatos, UFs e caminhos. `?inicio=<ISO>` na URL sobrescreve o início (só pra teste local).
- `adapter.js` — **camada de adaptação ao TSE**: `normalizarResultado` / `normalizarAcompanhamento` transformam o JSON do TSE num formato interno; `TseClient` faz GET com timeout, backoff exponencial, pool de requisições e `snapshot()`. Se o TSE mudar o formato, só este arquivo muda.
- `model.js` — modelo e máquina de estados (puro, roda no Node e no navegador). `replay.js` — replay histórico. `motor.js` — ciclo ao vivo (`MotorAoVivo`), histórico, prior de pesquisa. `apuracao.js` — UI.
- `dados/` (versionado): `mun-1t-2026.json` (votos + ordem/horário de totalização por município no 1T), `mun-2022.json` (2º turno 2022 por município, referência), `replay-1t-2026.json`.
- `worker/proxy.js` + `worker/index.js` — proxy `/tse/<eleição>/…` (o TSE não manda CORS): allowlist, cache 30 s (6 h com `?f=1` p/ arquivos que não mudam), stale-if-error. Usado também em `scripts/serve.mjs`. `wrangler.toml`: `main` + binding `ASSETS` + `run_worker_first = ["/tse/*"]`.

**Fontes/campos do TSE** (`resultados.tse.jus.br/oficial/ele2026/<eleição>/dados/…`): `<uf>-c0001-e<eleição>-u.json` (nacional/UF/município: `cand[].vap`, `v.vvc`, `s.ts/st` seções, `e.te` eleitorado, `and` f/p/n, `dt/ht`), `<uf>-e<eleição>-ab.json` (acompanhamento por município: status, horário, seções), `mun-e<eleição>-cm.json` (config de municípios). `cache-control: max-age=27`.

**Modelo.** Razão de votos por município: `logit(p_m) = x_m·β + u_UF + δ_região + ε_m` (x = parcela de Flávio no 2T 2022 e no 1T 2026 no município; WLS + ridge; bootstrap por UF; efeito de UF encolhido; razão de válidos 2T/referência). Remanescente por UF = esperado − contado. Choque nacional de seleção `selK·(1−contado)` (calibrado no replay: sem ele o intervalo de 90% cobria 36%). Prior fraco de pesquisa com peso `exp(−contado/0,08)`. 2.400 simulações determinísticas (mulberry32, semente fixa). Cenários conservadores determinísticos. "Matematicamente eleito" = margem > teto de votos restantes (eleitores de seções não totalizadas).
Estados: Apuração inicial → Resultado em aberto (<90% contado) → Favorito (90–99%) → Projeção forte (99–99,5%) → Vencedor projetado (>99,5% + cenários conservadores + estabilidade + cobertura regional) → Matematicamente eleito.

**Limitações.** O modelo assume que o 2T de 2026 se comporta como 2T 2022 + 1T 2026 por município; mudança grande de padrão (ex.: abstenção diferencial) aparece só com a apuração em curso. A calibração (selK, ridge) vem de um único replay.

**Executar**
```
node scripts/serve.mjs                  # site + proxy /tse/ (live de verdade, só responde após 25/10 17h)
node scripts/serve.mjs 5199 --mock-tse  # TSE falso: reproduz o 1T em 60×; abra /?inicio=2026-01-01T00:00:00-03:00#apuracao e clique "Ao vivo"
node scripts/apuracao-test.mjs [passoMin] [S]   # replay 1T 2026: erro, cobertura do IC, chamadas erradas (falha grave se houver)
node scripts/apuracao-adapter-test.mjs          # adapter + proxy contra o TSE real (1T)
node scripts/apuracao-integracao-test.mjs       # ciclo ao vivo completo com TSE falso (inclui queda de rede)
node scripts/apuracao-dados.mjs / apuracao-2022.mjs <votacao_secao_2022_BR.zip>   # regenera os dados de `dados/`
```
Sem linter configurado no projeto; `npm run build` continua valendo.

**Resultado do replay (1T 2026, passo de 10 min):** 0 chamadas erradas/revertidas, cobertura do IC90 ≈ 0,93, erro médio da projeção ≈ 0,9 p.p. (ingênuo ≈ 4,7 p.p.). 2T 2022 minuto a minuto **não** é reproduzível (sem horários estruturados).

**Formato do 2T:** o TSE já publica os arquivos da eleição 6258 como *stub* zerado (conferido em 17/10: mesmos nomes e campos do 6257, 28 UFs, 5.757 municípios no `-ab`, 499.248 seções; `ELE=6258 node scripts/apuracao-adapter-test.mjs` passa). **Ainda depende de 25/10:** ver os campos de votos/horário preenchidos de fato (o stub tem `votos=0`, `dt/ht` vazios) e a ordem real de chegada; `mun-e006258-cm.json` dá 404 (o adapter não depende dele).

## TODO / fase 2

- **Backtest público**: página mostrando `data/ratings.csv` (como cada instituto se saiu).
- **2018 rotula colunas por PARTIDO** — `ratings.mjs` tem `remap` fixo; se a Wiki mudar, quebra.
- Probabilidade de 2º turno / vitória (Monte Carlo). Projeção pro dia da eleição.
- 2º turno dos estados · Senado · "o que mudou" (∆ 1 sem / 1 mês) · URL com estado.
- TSE: mirror/proxy BR pro cross-check de registro (API dá 403 via Akamai).
- Aba de rejeição — espera a Wikipédia criar a seção 2026.
- Partido não lido pra ~2 candidatos estaduais (Cleitinho/PSD, Garotinho) — cor de fallback.
