// Wikipédia -> data/polls.<corrida>.csv  (+ data/candidates.<corrida>.csv)
// Uso: node scripts/fetch.mjs [--offline] [corrida]
import fs from "node:fs";
import path from "node:path";
import { RACES } from "./races.mjs";
import { fetchRacePolls } from "./lib/wiki.mjs";
import { readCSV, writeCSV } from "./lib/csv.mjs";

const DATA = new URL("../data/", import.meta.url);
const args = process.argv.slice(2);
const offline = args.includes("--offline");
const only = args.find((a) => !a.startsWith("--"));

const META_COLS = ["id", "pollster", "start", "end", "n", "moe", "source", "section"];

function slugP(s) {
  return String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\w]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function run(raceKey) {
  const race = RACES[raceKey];
  console.log(`\n== ${raceKey} : ${race.wikiPage} ==`);
  const { polls, candidates } = await fetchRacePolls(race, { offline });
  console.log(`  ${polls.length} linhas de pesquisa, ${candidates.length} candidatos`);
  if (!polls.length) {
    if (race.optional) return; // corrida futura (ex.: 2º turno de estado sem pesquisa ainda)
    console.warn(`  ${raceKey}: sem pesquisas`);
    return;
  }

  // ordena colunas de candidato: display primeiro, resto por frequência
  const freq = new Map();
  for (const p of polls) for (const k of Object.keys(p.values)) freq.set(k, (freq.get(k) || 0) + 1);
  const displayKeys = race.display.map((d) => d.key);
  const aliasTo = new Map();
  for (const d of race.display) for (const a of d.aliases || []) aliasTo.set(a, d.key);
  // normaliza aliases nos polls
  for (const p of polls) {
    for (const [k, v] of Object.entries(p.values)) {
      if (aliasTo.has(k)) {
        p.values[aliasTo.get(k)] = v;
        delete p.values[k];
      }
    }
  }
  freq.clear();
  for (const p of polls) for (const k of Object.keys(p.values)) freq.set(k, (freq.get(k) || 0) + 1);
  const candKeys = [
    ...displayKeys.filter((k) => freq.has(k)),
    ...[...freq.keys()].filter((k) => !displayKeys.includes(k)).sort((a, b) => freq.get(b) - freq.get(a)),
  ];

  // monta linhas
  const seen = new Map();
  const rows = polls.map((p) => {
    let id = `${slugP(p.pollster)}-${p.end}`;
    if (seen.has(id)) {
      const c = seen.get(id) + 1;
      seen.set(id, c);
      id = `${id}-${c}`;
    } else seen.set(id, 1);
    const row = { id, pollster: p.pollster, start: p.start, end: p.end, n: p.n ?? "", moe: p.moe ?? "", source: p.source || "", section: p.section || "" };
    for (const k of candKeys) row[k] = k in p.values ? p.values[k] : "";
    return row;
  });

  // merge overrides
  const ovPath = new URL(`overrides.${raceKey}.csv`, DATA);
  const overrides = readCSV(ovPath);
  if (overrides.length) {
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const ov of overrides) {
      const id = ov.id?.trim();
      if (!id) continue;
      if (id.startsWith("-")) {
        byId.delete(id.slice(1));
        continue;
      }
      for (const k of Object.keys(ov)) if (k && !candKeys.includes(k) && !META_COLS.includes(k)) candKeys.push(k);
      byId.set(id, { ...(byId.get(id) || {}), ...ov });
    }
    rows.length = 0;
    rows.push(...byId.values());
    console.log(`  overrides aplicados: ${overrides.length}`);
  }

  rows.sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : a.pollster.localeCompare(b.pollster)));

  fs.mkdirSync(DATA, { recursive: true });
  const cols = [...META_COLS, ...candKeys];
  writeCSV(new URL(`polls.${raceKey}.csv`, DATA), rows, cols);

  // sidecar de nomes
  const nameByKey = new Map(candidates.map((c) => [c.key, c]));
  for (const d of race.display) nameByKey.set(d.key, { key: d.key, name: d.name, party: d.party });
  const candRows = candKeys.map((k) => {
    const c = nameByKey.get(k) || {};
    return { key: k, name: c.name || titleCase(k), party: c.party || "" };
  });
  writeCSV(new URL(`candidates.${raceKey}.csv`, DATA), candRows, ["key", "name", "party"]);

  console.log(`  -> data/polls.${raceKey}.csv (${rows.length} linhas, ${candKeys.length} candidatos)`);
}

function titleCase(k) {
  return k.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

const keys = only ? [only] : Object.keys(RACES);
for (const k of keys) {
  if (!RACES[k]) {
    console.error(`corrida desconhecida: ${k}`);
    process.exit(1);
  }
  await run(k);
}
