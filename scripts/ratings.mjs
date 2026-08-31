// Ratings de instituto: erro da pesquisa final de cada casa vs. o resultado real
// nas presidenciais de 2018 e 2022 (1º turno). Gera data/ratings.json.
//
// Abordagem deliberadamente CONSERVADORA e robusta:
//  - só avalia institutos de uma allow-list (os que interessam hoje), casados por regex
//    contra a grafia histórica — não tenta auto-parsear nomes bagunçados;
//  - erro = MAE da última pesquisa (janela final) contra o % de votos válidos;
//  - peso encolhido por nº de ciclos e limitado a ±12% — um rating só empurra, não domina.
//
// Uso: node scripts/ratings.mjs [--offline]
import fs from "node:fs";
import { getSectionHTML, parsePollTable, moeFromN } from "./lib/wiki.mjs";
import { trendKalman } from "./lib/kalman.mjs";
import { writeCSV } from "./lib/csv.mjs";

const DATA = new URL("../data/", import.meta.url);
const offline = process.argv.includes("--offline");
const DAY = 86400000;
const WINDOW_DAYS = 20; // "pesquisa final"

const CYCLES = [
  {
    year: 2022,
    page: "Pesquisas de opinião para a eleição presidencial no Brasil em 2022",
    section: "5",
    voteDay: "2022-10-02",
    result: { lula: 48.43, bolsonaro: 43.2, tebet: 4.16, ciro: 3.04, soraya: 0.51 },
  },
  {
    year: 2018,
    page: "Pesquisas de opinião para a eleição presidencial no Brasil em 2018",
    section: "5",
    voteDay: "2018-10-07",
    result: { bolsonaro: 46.03, haddad: 29.28, ciro: 12.47, alckmin: 4.76, amoedo: 2.5, marina: 1.0, meirelles: 1.2 },
    // a tabela de 2018 rotula as colunas pelo PARTIDO, não pelo nome
    remap: { psl: "bolsonaro", pt: "haddad", pdt: "ciro", psdb: "alckmin", novo: "amoedo", rede: "marina", mdb: "meirelles" },
  },
];

// institutos avaliados (nome canônico + regex p/ casar grafia de qualquer ano)
const RATED = [
  ["Datafolha", /datafolha/i],
  ["Genial/Quaest", /quaest/i],
  ["AtlasIntel", /atlas/i],
  ["PoderData", /poderdata/i],
  ["Paraná Pesquisas", /paran[aá]\s*pesquisas/i],
  ["Ipec", /\bipec\b|\bibope\b/i],
  ["Real Time Big Data", /real\s*time/i],
  ["CNT/MDA", /\bmda\b/i],
  ["Nexus/BTG Pactual", /\bnexus\b|\bbtg\b/i],
  ["Instituto FSB", /\bfsb\b/i],
  ["Ipespe", /ipespe/i],
  ["Modalmais/Futura", /modalmais|instituto\s*futura/i],
  ["Vox Populi", /vox\s*populi/i],
  ["Quaest", /\bquaest\b/i],
];
// converte % da pesquisa pra base "votos válidos" (candidatos-only), como o resultado oficial.
// vsum inclui TODOS os candidatos da linha; devolve só os que estão no mapa de resultado.
function toValidVotes(rawValues, remap, result) {
  const remapped = {};
  for (const [k, v] of Object.entries(rawValues)) {
    if (!Number.isFinite(v)) continue;
    remapped[remap?.[k] || alias(k)] = v;
  }
  const vsum = Object.values(remapped).reduce((a, b) => a + b, 0);
  if (vsum < 40) return {}; // linha estranha
  const out = {};
  for (const [k, v] of Object.entries(remapped)) if (k in result) out[k] = (v / vsum) * 100;
  return out;
}

const alias = (k) =>
  ({
    "jair-bolsonaro": "bolsonaro",
    "fernando-haddad": "haddad",
    "ciro-gomes": "ciro",
    "geraldo-alckmin": "alckmin",
    "simone-tebet": "tebet",
    "soraya-thronicke": "soraya",
    "joao-amoedo": "amoedo",
    "amoêdo": "amoedo",
    "cabo-daciolo": "daciolo",
    "marina-silva": "marina",
    "luiz-inacio-lula-da-silva": "lula",
  })[k] || k;

async function cycleErrors(cy) {
  const html = await getSectionHTML(cy.page, cy.section, { offline });
  const tables = html.match(/<table\b[^>]*wikitable[^>]*>[\s\S]*?<\/table>/gi) || [];
  const voteT = Date.parse(cy.voteDay + "T00:00:00Z");
  const cutoff = voteT - WINDOW_DAYS * DAY;

  const finalByRated = new Map(); // canon -> { endT, values }
  for (const tbl of tables) {
    const parsed = parsePollTable(tbl, { year: cy.year, warn: () => {} });
    if (!parsed) continue;
    for (const p of parsed.polls) {
      const endT = Date.parse(p.end + "T00:00:00Z");
      if (!(endT >= cutoff && endT <= voteT)) continue;
      const hit = RATED.find(([, re]) => re.test(p.pollster));
      if (!hit) continue;
      const values = toValidVotes(p.values, cy.remap, cy.result); // base votos válidos
      if (Object.keys(values).length < 3) continue; // garante 1º turno
      const prev = finalByRated.get(hit[0]);
      if (!prev || endT > prev.endT) finalByRated.set(hit[0], { endT, values });
    }
  }

  const errs = new Map();
  for (const [canon, { values }] of finalByRated) {
    let sum = 0;
    let k = 0;
    for (const [key, v] of Object.entries(values)) {
      if (!(key in cy.result)) continue;
      sum += Math.abs(v - cy.result[key]);
      k++;
    }
    if (k >= 3) errs.set(canon, sum / k);
  }
  return errs;
}

// ---- backtest do AGREGADOR: roda o modelo no ciclo inteiro e compara com o resultado ----
async function cycleBacktest(cy) {
  const html = await getSectionHTML(cy.page, cy.section, { offline });
  const tables = html.match(/<table\b[^>]*wikitable[^>]*>[\s\S]*?<\/table>/gi) || [];
  const voteT = Date.parse(cy.voteDay + "T00:00:00Z");
  const DAY_ = 86400000;

  const all = []; // { endT, values:{cand:%}, n }
  for (const tbl of tables) {
    const parsed = parsePollTable(tbl, { year: cy.year, warn: () => {} });
    if (!parsed) continue;
    for (const p of parsed.polls) {
      const endT = Date.parse(p.end + "T00:00:00Z");
      if (!(endT <= voteT && endT >= voteT - 320 * DAY_)) continue;
      const values = toValidVotes(p.values, cy.remap, cy.result); // base votos válidos
      if (Object.keys(values).length < 3) continue;
      all.push({ endT, values, n: p.n || null });
    }
  }
  if (all.length < 10) return null;

  const minT = Math.min(...all.map((p) => p.endT));
  const maxT = Math.max(...all.map((p) => p.endT));
  const xOf = (t) => Math.round((t - minT) / DAY_);
  const maxX = xOf(maxT);
  const grid = [];
  for (let x = 0; x <= maxX; x++) grid.push(x);
  const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);

  const cands = Object.keys(cy.result);
  const est = {};
  const series = {};
  let aggSum = 0;
  let aggN = 0;
  for (const c of cands) {
    const pts = all
      .filter((p) => p.values[c] != null)
      .map((p) => ({ x: xOf(p.endT), y: p.values[c], n: p.n, moeHalf: moeFromN(p.n) || 2 }));
    if (pts.length < 5) continue;
    const { line } = trendKalman(pts, grid, { q: 0.032, designEffect: 1.6, z: 1.64 });
    let last = null;
    for (let i = line.length - 1; i >= 0; i--) if (line[i] != null) { last = line[i]; break; }
    if (last == null) continue;
    const err = Math.round((last - cy.result[c]) * 10) / 10;
    est[c] = { est: Math.round(last * 10) / 10, err, result: cy.result[c] };
    aggSum += Math.abs(err);
    aggN++;
    // série reamostrada (a cada 4 dias) pro mini-gráfico
    series[c] = [];
    for (let i = 0; i < line.length; i += 4) if (line[i] != null) series[c].push({ t: isoOf(minT + i * DAY_), y: Math.round(line[i] * 10) / 10 });
  }

  // baseline: MAE médio das pesquisas individuais na reta final (~20 dias)
  const finals = all.filter((p) => p.endT >= voteT - 20 * DAY_);
  let pollSum = 0;
  let pollN = 0;
  for (const p of finals) {
    let s = 0;
    let k = 0;
    for (const [c, v] of Object.entries(p.values)) {
      if (!(c in cy.result)) continue;
      s += Math.abs(v - cy.result[c]);
      k++;
    }
    if (k >= 3) {
      pollSum += s / k;
      pollN++;
    }
  }

  return {
    year: cy.year,
    voteDay: cy.voteDay,
    xDomain: [isoOf(minT), cy.voteDay],
    result: cy.result,
    est,
    aggregatorMAE: aggN ? Math.round((aggSum / aggN) * 100) / 100 : null,
    pollsFinalMAE: pollN ? Math.round((pollSum / pollN) * 100) / 100 : null,
    nPolls: all.length,
    nFinalPolls: pollN,
    series,
  };
}

const perCycle = [];
const backtests = [];
for (const cy of CYCLES) {
  try {
    const e = await cycleErrors(cy);
    console.log(`  ${cy.year}: ${e.size} institutos — ${[...e.entries()].map(([n, m]) => `${n} ${m.toFixed(1)}`).join(", ")}`);
    perCycle.push(e);
  } catch (err) {
    console.warn(`  ${cy.year}: falhou (${err.message})`);
    perCycle.push(new Map());
  }
  try {
    const bt = await cycleBacktest(cy);
    if (bt) {
      backtests.push(bt);
      console.log(`  ${cy.year} backtest: agregador MAE ${bt.aggregatorMAE} vs pesquisas finais ${bt.pollsFinalMAE} (${bt.nPolls} pesquisas)`);
    }
  } catch (err) {
    console.warn(`  ${cy.year} backtest: falhou (${err.message})`);
  }
}

const agg = new Map(); // canon -> [mae por ciclo]
for (const e of perCycle) for (const [n, m] of e) (agg.get(n) || agg.set(n, []).get(n)).push(m);

if (!agg.size) {
  console.warn("  nenhum rating — mantendo ratings.json anterior");
  process.exit(0);
}

const means = [...agg.values()].map((a) => a.reduce((x, y) => x + y, 0) / a.length).sort((a, b) => a - b);
const medMae = means[Math.floor(means.length / 2)] || 2.5;

const byPollster = {};
const rows = [];
for (const [canon, maes] of agg) {
  const mae = maes.reduce((a, b) => a + b, 0) / maes.length;
  let w = Math.sqrt(medMae / mae); // melhor -> >1
  if (maes.length < 2) w = 1 + (w - 1) * 0.5; // 1 ciclo só: metade do efeito
  w = Math.max(0.88, Math.min(1.12, w)); // teto ±12%
  const entry = { canon, cycles: maes.length, maeFinal: Math.round(mae * 100) / 100, weight: Math.round(w * 1000) / 1000 };
  byPollster[canon] = entry;
  rows.push(entry);
}

fs.writeFileSync(
  new URL("ratings.json", DATA),
  JSON.stringify({ updated: new Date().toISOString(), basis: "finais de 2018 e 2022 (1º turno presidencial)", medMae: Math.round(medMae * 100) / 100, byPollster }, null, 2)
);
writeCSV(new URL("ratings.csv", DATA), rows.sort((a, b) => a.maeFinal - b.maeFinal), ["canon", "cycles", "maeFinal", "weight"]);
console.log(`  -> data/ratings.json (${rows.length} institutos; mediana MAE final ${medMae.toFixed(2)})`);

if (backtests.length) {
  const btJSON = JSON.stringify(
    { updated: new Date().toISOString(), cycles: backtests, pollsters: rows.sort((a, b) => a.maeFinal - b.maeFinal) },
    null,
    2
  );
  fs.writeFileSync(new URL("backtest.json", DATA), btJSON); // cópia versionável em data/
  const siteData = new URL("../site/data/", import.meta.url);
  fs.mkdirSync(siteData, { recursive: true });
  fs.writeFileSync(new URL("backtest.json", siteData), btJSON); // servida pelo site
  console.log(`  -> data/backtest.json + site/data/ (${backtests.map((b) => b.year).join(", ")})`);
}
