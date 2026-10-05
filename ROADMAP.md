# Roadmap — próximos passos

O que já está feito vive no `CLAUDE.md` (seção "Feito"). Aqui é só o que **ainda dá pra melhorar**.
Esforço é relativo a "tudo que já foi construído" = 100%. Nada aqui está em andamento.

---

## 0. PÓS-ELEIÇÃO (1º turno 04/10/2026) — ✅ feito em 05/10, falta o resto

**Feito (no ar):** `resultados.html` (pesquisa × resultado: líder certo, erro, % na faixa, maior surpresa,
erro por instituto com viés, abstenção/nulos/brancos vs. 2022) e `eleitos.html` (governadores, senado,
dep. federais Sul+Sudeste, dep. estaduais SP: antes × depois por partido, quem é novo no cargo,
renovação, mulheres, pretos e pardos, troca de partido). Fonte primária: JSON público do TSE
(`scripts/lib/tse.mjs`). "Antes" = foto única em `data/antes.json` (não refazer após a posse!).

**Feito depois (05/10):** projeção de SP/MG e Alesp; estimativas congeladas; recalibração da faixa (`SYS_HALF`);
2º turno (presidente + RJ) pronto e testado com dados simulados — roda sozinho a partir de 25/10; removido mulheres/negros.

**Falta / próximos passos**
- **Depois de 25/10:** conferir o 2T de verdade (os arquivos 6258/6260 do TSE) e reavaliar `SYS_HALF` com mais dados.
- **Ratings com a eleição real:** o erro por instituto de 2026 já aparece em `resultados.html`; falta incorporar ao `ratings.mjs`
  (hoje só 2018/22). Fazer só depois do 2T pra não misturar (as estimativas do 1T estão congeladas, então não contamina a comparação).
- Quando o TSE fechar SP/MG/Alesp, a projeção é substituída pelo oficial sozinha (conferir se bateu).
- Demais 6 governos em 2º turno (AC, AM, DF, ES, RN, TO) não são acompanhados.

## 1. Previsão (o maior salto de utilidade)

- [ ] **Probabilidade de ir ao 2º turno / de liderar / de vencer no 1º turno** — simulação de
      Monte Carlo sobre trajetórias correlacionadas dos candidatos. Vira manchete
      ("Lula 68% de ir ao 2º turno na frente"). ~15%
- [ ] **Projeção pro dia da eleição (4/out)** — não só "onde está hoje", mas o funil de
      incerteza abrindo até a data. Precisa calibrar "quanto pesquisa se move nas últimas
      semanas" com 2018/2022. ~20%
- [ ] Alternância **"se a eleição fosse hoje" × "nossa projeção pra 4/out"**. ~4%

## 2. Modelo

- [ ] **Restrição soma≈100** — hoje cada candidato é modelado sozinho; um modelo
      composicional (multivariado) é mais correto perto de eleições apertadas. ~25%
- [ ] **Checagem de calibração** — as faixas de 90% cobrem mesmo 90%? Rodar no histórico. ~8%
- [ ] `q` (velocidade da tendência) por tipo de corrida — presidencial se mexe mais que
      governo de estado parado. ~4%

## 3. Ratings / backtest

- [ ] **Mais ciclos**: 2014 e 2010 (presidencial) + eleições estaduais → pesos menos ruidosos
      (hoje são só 2 ciclos). ~15%
- [ ] **Backtest do 2º turno**, não só 1º. ~8%
- [ ] **Backtest por corrida** (ex.: como o agregador foi no governo de SP em 2022). ~10%
- [ ] Mostrar a incerteza do próprio peso (2 ciclos = muito barulho). ~3%
- [ ] Conferir o nome histórico da Datafolha/Quaest (o peso 0,90 da Datafolha parece
      alto demais — pode ser quirk de parsing de 2018/2022). ~3%

## 4. Dados

- [ ] **Cross-check TSE** ("registrada ✓ nº XXXXX") — depende de achar mirror/proxy BR
      estável (a API oficial dá 403 via Akamai). ~15%
- [ ] **Filtro por método** (telefônica / presencial / online) — só sai com o TSE ou raspando
      os PDFs dos institutos. ~10%
- [ ] **Aba de rejeição** ("não votaria de jeito nenhum") — parser e gráfico já servem;
      espera a Wikipédia criar a seção de 2026. ~8%
- [ ] Testes do parser (a parte frágil) — alguns golden files de tabelas reais. ~6%

## 5. Novas visões

- [ ] **Todos os 27 estados + DF** (governador e Senado) — só adicionar entradas em `RACES`. ~6%
- [ ] **URL com estado** (`?corrida=sp&periodo=45&excluir=…`) — compartilhar uma visão. ~4%
- [ ] **Widget embutível** (iframe) pra outros sites usarem o gráfico. ~8%
- [ ] **Feed** (JSON/RSS) das pesquisas mais recentes. ~4%
- [ ] Página de **metodologia** completa (hoje o rodapé explica em 2 linhas). ~5%

## 6. Polimento / infra

- [ ] **OG image de verdade** (PNG gerado no build, por corrida) no lugar do `og.svg` estático. ~6%
- [ ] Partido do **Garotinho** (RJ) — não consegui confirmar; hoje cai em cor cinza. ~1%
- [ ] **Acessibilidade** — navegação por teclado na legenda/filtro, ARIA, `prefers-reduced-motion`. ~6%
- [ ] **Toggle claro/escuro** manual (hoje só segue o sistema). ~3%
- [ ] Estados de **carregamento** (skeleton) e de **erro** se um JSON falhar. ~4%
- [ ] Fixar as versões das actions do GitHub (some o aviso de Node deprecado). ~2%
- [ ] Analytics leve e sem cookie (só pra saber o que as pessoas olham). ~3%

---

## Ordem sugerida se voltar a mexer

1. **Probabilidade de 2º turno / vitória** (§1) — maior impacto de manchete, custo médio.
2. **Mais ciclos de backtest** (§3) — deixa os pesos sérios de verdade.
3. **URL com estado + metodologia** (§5) — barato, ajuda a compartilhar e a confiar.
4. **Projeção pro dia da eleição** (§1) — o "modo 538" completo.
5. **Modelo composicional** (§2) — só perto da eleição, quando 1 p.p. importa.
