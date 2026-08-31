// data/polls.<corrida>.csv -> site/data/<corrida>.json  (tendência LOESS + faixa)
// Uso: node scripts/aggregate.mjs [corrida]
import fs from "node:fs";
import {
  RACES,
  AGG,
  FALLBACK_COLORS,
  PLOT_MIN_POLLS,
  PLOT_MIN_RECENT,
  PLOT_MIN_SUPPORT,
  PLOT_MAX_LINES,
} from "./races.mjs";
import { readCSV } from "./lib/csv.mjs";
import { moeFromN } from "./lib/wiki.mjs";
import { mulberry32, loess, loessWithBand } from "./lib/loess.mjs";

const DATA = new URL("../data/", import.meta.url);
const OUT = new URL("../site/data/", import.meta.url);
const META_COLS = new Set(["id", "pollster", "start", "end", "n", "moe", "source", "section"]);

const DAY = 86400000;
const toDate = (iso) => new Date(iso + "T00:00:00Z");
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function colorFor(race, key, i) {
  const d = race.display.find((x) => x.key === key || (x.aliases || []).includes(key));
  return d?.color || FALLBACK_COLORS[i % FALLBACK_COLORS.length];
}
function nameFor(nameMap, race, key) {
  const d = race.display.find((x) => x.key === key || (x.aliases || []).includes(key));
  return d?.name || nameMap.get(key)?.name || key.replace(/-/g, " ");
}

function aggregateRace(raceKey) {
  const race = RACES[raceKey];
  const polls = readCSV(new URL(`polls.${raceKey}.csv`, DATA));
  if (!polls.length) {
    console.warn(`  ${raceKey}: sem dados, pulando`);
    return null;
  }
  const nameMap = new Map(readCSV(new URL(`candidates.${raceKey}.csv`, DATA)).map((c) => [c.key, c]));

  const candKeys = Object.keys(polls[0]).filter((k) => !META_COLS.has(k));
  const ends = polls.map((p) => toDate(p.end).getTime());
  const minEnd = Math.min(...ends);
  const maxEnd = Math.max(...ends);
  const latest = maxEnd;
  const xOf = (t) => Math.round((t - minEnd) / DAY);

  // pontos por candidato
  const series = {};
  for (const k of candKeys) series[k] = [];
  for (const p of polls) {
    const t = toDate(p.end).getTime();
    const x = xOf(t);
    const n = p.n ? parseInt(p.n, 10) : null;
    const ageDays = (latest - t) / DAY;
    const wRec = Math.pow(0.5, ageDays / AGG.halflifeDays);
    const wN = n ? clamp(Math.sqrt(n / 1000), 0.5, 2) : 1;
    const base = wRec * wN;
    const moe = p.moe ? parseFloat(p.moe) : moeFromN(n) || 2.0;
    for (const k of candKeys) {
      const raw = p[k];
      if (raw === "" || raw == null) continue;
      const y = parseFloat(String(raw).replace(",", "."));
      if (!Number.isFinite(y)) continue;
      series[k].push({ x, y, base, moeHalf: moe, t, pollster: p.pollster, n });
    }
  }

  // grade
  const maxX = xOf(maxEnd);
  const grid = [];
  for (let x = 0; x <= maxX; x += AGG.gridStepDays) grid.push(x);
  if (grid[grid.length - 1] !== maxX) grid.push(maxX);
  const gridDates = grid.map((x) => iso(minEnd + x * DAY));

  // quais candidatos plotar: precisa estar ATIVO (pesquisas recentes), não só ter histórico
  const RECENT_WIN = 75; // dias
  const STALE = 25; // sem pesquisa há mais que isto -> fora da corrida
  const plotable = candKeys
    .map((k) => ({ k, pts: series[k], recent: series[k].filter((p) => p.x >= maxX - RECENT_WIN) }))
    .filter(
      ({ pts, recent }) =>
        pts.length >= PLOT_MIN_POLLS &&
        recent.length >= PLOT_MIN_RECENT &&
        Math.max(...pts.map((p) => p.x)) >= maxX - STALE
    )
    .map(({ k, pts, recent }) => {
      const last = [...recent].sort((a, b) => b.x - a.x).slice(0, 5);
      const recentAvg = last.reduce((s, p) => s + p.y, 0) / last.length;
      return { k, pts, recentAvg };
    })
    .filter(({ recentAvg }) => recentAvg >= PLOT_MIN_SUPPORT) // média recente, não pico
    .sort((a, b) => b.recentAvg - a.recentAvg)
    .slice(0, PLOT_MAX_LINES);

  // corridas com poucas pesquisas: janela mais larga e suave (menos pico espúrio)
  const sparse = polls.length < 25;
  const loessOpts = {
    span: sparse ? 0.6 : AGG.span,
    minPts: AGG.minPts,
    minBandwidthX: sparse ? 26 : 14,
    maxGapX: sparse ? 40 : 30,
  };
  const uniqPollsters = (arr) => new Set(arr.map((p) => p.pollster)).size;
  const rawSeries = {};
  for (const { k } of plotable) rawSeries[k] = series[k].slice();

  // ---- house effects: viés sistemático de cada instituto vs. a tendência ----
  // 1ª passada de tendência (sem bootstrap), resíduos por (instituto, candidato),
  // encolhidos por contagem e limitados a ±houseMaxShift. Corrige os pontos e refita.
  const house = {}; // pollster -> { cand -> shift p.p. }
  const applyHouse = polls.length >= 20 && uniqPollsters(polls) >= 5;
  if (applyHouse) {
    const trend0 = {};
    for (const { k } of plotable) trend0[k] = loess(series[k], grid, loessOpts);
    const at = (arr, x) => {
      const g = x / AGG.gridStepDays;
      const lo = Math.floor(g), hi = Math.ceil(g);
      if (lo < 0 || hi >= arr.length) return null;
      const a = arr[lo], b = arr[hi];
      if (a == null || b == null) return a ?? b;
      return a + (b - a) * (g - lo);
    };
    const raw = {};
    for (const { k } of plotable)
      for (const p of series[k]) {
        const tv = at(trend0[k], p.x);
        if (tv == null) continue;
        ((raw[p.pollster] ??= {})[k] ??= []).push(p.y - tv);
      }
    for (const [pst, byK] of Object.entries(raw)) {
      house[pst] = {};
      for (const [k, rs] of Object.entries(byK)) {
        const m = rs.reduce((s, v) => s + v, 0) / rs.length;
        const shrunk = m * (rs.length / (rs.length + 5));
        house[pst][k] = r2(clamp(shrunk, -AGG.houseMaxShift, AGG.houseMaxShift));
      }
    }
    for (const { k } of plotable)
      series[k] = series[k].map((p) => ({ ...p, y: p.y - (house[p.pollster]?.[k] || 0) }));
  }

  const rng = mulberry32(AGG.seed);
  const candidates = plotable.map(({ k, pts }, i) => {
    pts = series[k]; // pode ter sido ajustado por house effect
    const { line, band } = loessWithBand(pts, grid, {
      ...loessOpts,
      bootstrap: AGG.bootstrap,
      bandLo: AGG.bandLo,
      bandHi: AGG.bandHi,
      rng,
    });
    return {
      key: k,
      name: nameFor(nameMap, race, k),
      party: nameMap.get(k)?.party || "",
      color: colorFor(race, k, i),
      line: gridDates.map((t, gi) => (line[gi] == null ? null : { t, y: r2(line[gi]) })).filter(Boolean),
      band: gridDates
        .map((t, gi) => (band[gi] == null ? null : { t, lo: r2(band[gi].lo), hi: r2(band[gi].hi) }))
        .filter(Boolean),
      polls: rawSeries[k]
        .slice()
        .sort((a, b) => a.t - b.t)
        .map((p) => ({ t: iso(p.t), y: r2(p.y), pollster: p.pollster, n: p.n || null })),
    };
  });

  const pollsters = [...new Set(polls.map((p) => p.pollster))].sort();
  const shownKeys = candidates.map((c) => c.key);
  const nameByShown = new Map(candidates.map((c) => [c.key, c.name]));

  // tabela crua de pesquisas (mais recentes primeiro) — inclui só os candidatos exibidos
  const pollTable = polls
    .map((p) => {
      const vals = {};
      for (const k of shownKeys) {
        const raw = p[k];
        if (raw === "" || raw == null) continue;
        const y = parseFloat(String(raw).replace(",", "."));
        if (Number.isFinite(y)) vals[k] = y;
      }
      return {
        pollster: p.pollster,
        start: p.start,
        end: p.end,
        n: p.n ? parseInt(p.n, 10) : null,
        moe: p.moe ? parseFloat(p.moe) : null,
        source: p.source || "",
        values: vals,
      };
    })
    .filter((p) => Object.keys(p.values).length)
    .sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : 0));

  return {
    race: raceKey,
    label: race.label,
    updated: new Date().toISOString(),
    source: "Wikipédia (CC BY-SA) + curadoria",
    nPolls: polls.length,
    nWithSource: polls.filter((p) => p.source).length,
    lastPoll: iso(maxEnd),
    pollsters,
    xDomain: [iso(minEnd), iso(maxEnd)],
    shown: candidates.map((c) => ({ key: c.key, name: c.name, color: c.color })),
    candidates,
    houseEffects: applyHouse
      ? Object.fromEntries(
          Object.entries(house)
            .map(([pst, byK]) => [
              pst,
              Object.fromEntries(candidates.map((c) => [c.key, byK[c.key] ?? 0]).filter(([, v]) => v)),
            ])
            .filter(([, o]) => Object.keys(o).length)
        )
      : {},
    polls: pollTable,
  };
}

const only = process.argv.slice(2).find((a) => !a.startsWith("--"));
const keys = only ? [only] : Object.keys(RACES);
fs.mkdirSync(OUT, { recursive: true });
const index = [];
for (const k of keys) {
  let out;
  try {
    out = aggregateRace(k);
  } catch (e) {
    console.warn(`  ${k}: erro (${e.message}) — pulando`);
    continue;
  }
  if (!out) continue;
  fs.writeFileSync(new URL(`${k}.json`, OUT), JSON.stringify(out, null, 2));
  const r = RACES[k];
  index.push({ key: k, group: r.group, round: r.round, label: r.label, wiki: r.wikiUrl, nPolls: out.nPolls });
  const names = out.candidates.map((c) => `${c.name} ${c.line.at(-1)?.y ?? "?"}%`).join(", ");
  console.log(`  ${k}: ${out.nPolls} pesquisas, ${out.candidates.length} linhas -> ${names}`);
}
// índice só com o que foi gerado (na ordem de RACES), pro front montar as abas
if (!only) fs.writeFileSync(new URL("index.json", OUT), JSON.stringify(index, null, 2));
