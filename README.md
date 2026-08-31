# Agregador BR 2026

Agregador de pesquisas para **presidente do Brasil** e **governador de São Paulo**, com
gráfico de tendência (LOESS ponderado) e margem de incerteza como faixa ("aura").
Estilo FiveThirtyEight. Sem backend, sem build, sem dependências.

**Especificação completa em [`CLAUDE.md`](CLAUDE.md).**

## Como funciona

```
Wikipédia (API) ──▶ data/polls.<corrida>.csv ──▶ site/data/<corrida>.json ──▶ site/ (GitHub Pages)
                 fetch.mjs                 aggregate.mjs
```

Um GitHub Action roda `node scripts/build.mjs` a cada 6h, e commita se algo mudou.
As pesquisas vêm da Wikipédia (registro cronológico de todos os institutos, CC BY-SA);
`data/overrides.<corrida>.csv` permite adicionar/corrigir à mão.

## Rodar local

```bash
node scripts/build.mjs     # baixa da Wikipédia e recalcula
node scripts/serve.mjs     # http://localhost:5173
```

Flags: `node scripts/fetch.mjs --offline` usa o cache em `.cache/`;
`node scripts/build.mjs presidente` roda só uma corrida.

## No ar

- Netlify: **https://agregador-eleicoes-2026.netlify.app/** (builda `site/` a cada push)
- GitHub Pages: https://fcairo1.github.io/agregador-br/ (espelho)

## Publicar (GitHub Pages)

1. `git remote add origin git@github.com:<você>/agregador-br.git && git push -u origin main`
2. Settings → Pages → Source: **GitHub Actions**
3. O workflow `Atualiza pesquisas` publica `site/` e passa a atualizar sozinho.

## Ajustes rápidos

- Candidatos, cores, seções da Wiki: [`scripts/races.mjs`](scripts/races.mjs)
- Parâmetros do modelo (meia-vida, span, bootstrap): `AGG` em `scripts/races.mjs`
- Corrigir uma pesquisa: edite `data/overrides.<corrida>.csv` (mesmo cabeçalho; `id`
  começando com `-` remove a pesquisa)

## Limitações (v1)

- Só 1º turno. Cenários múltiplos de uma mesma pesquisa: usa o primeiro.
- Depende da Wikipédia estar atualizada (costuma ser em horas).
- Sem ajuste de viés por instituto ("house effects") ainda — ver TODO no `CLAUDE.md`.
