// Resultados oficiais (Wikipédia) -> data/results.<corrida>.json
// + comparação com a tendência final do agregador -> site/data/resultados.json
// Uso: node scripts/results.mjs [--offline]
// Roda DEPOIS do aggregate (lê site/data/<corrida>.json). Nunca derruba o build: sem resultado ainda = pula.
import fs from "node:fs";
import { RACES } from "./races.mjs";
import { getPageHTML, tablesWithHeadings, cellText } from "./lib/wiki.mjs";
import { getCargo, CARGO } from "./lib/tse.mjs";

const DATA = new URL("../data/", import.meta.url);
const OUT = new URL("../site/data/", import.meta.url);
const offline = process.argv.includes("--offline");
const ELECTION_DAY = "2026-10-04";
const ELECTION_DAY_2T = "2026-10-25";
const dayOf = (round) => (round === "2T" ? ELECTION_DAY_2T : ELECTION_DAY);

// ---------- onde está o resultado de cada corrida ----------
const PRES_RES = "Eleição presidencial no Brasil em 2026";
const stateRes = (race) => {
  const suffix = race.wikiPage.split("2026 ")[1]; // "em São Paulo" | "no Paraná"…
  return `Eleições estaduais ${suffix} em 2026`;
};
function sources() {
  const out = [];
  for (const [key, race] of Object.entries(RACES)) {
    if (race.round === "2T") {
      // só o 2º turno que vai acontecer: Flávio × Lula (os outros "cenários" são hipóteses) e governador do RJ
      if (key === "presidente-2t-flavio") out.push({ key, kind: "presidente", round: "2T", page: PRES_RES, head: /^resultado/i });
      else if (key === "rj-governador-2t") out.push({ key, kind: "governador", round: "2T", page: stateRes(race), head: /governador/i });
      continue;
    }
    if (key === "presidente") out.push({ key, kind: "presidente", page: PRES_RES, head: /^resultado/i });
    else if (key.endsWith("-governador")) out.push({ key, kind: "governador", page: stateRes(race), head: /governador/i });
    else if (key.endsWith("-senado")) out.push({ key, kind: "senado", page: stateRes(race), head: /senador/i });
  }
  return out;
}

// ---------- parsing ----------
const num = (s) => {
  const d = String(s).replace(/[^\d]/g, "");
  return d ? parseInt(d, 10) : 0;
};
const pct = (s) => {
  const m = String(s).match(/(\d+(?:[.,]\d+)?)\s*%/);
  return m ? parseFloat(m[1].replace(",", ".")) : 0;
};
const strip = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

function parseResultTable(html) {
  const rows = [...html.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((m) =>
    [...m[0].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => cellText(c[1]))
  );
  const cands = [];
  const tot = {};
  for (const raw of rows) {
    const first = raw.findIndex((c) => c); // 1ª célula é um quadradinho de cor (vazia) nas linhas de candidato
    if (first < 0) continue;
    const cells = raw.slice(first);
    const label = strip(cells[0]);
    if (/^total de inscritos/.test(label)) {
      tot.inscritos = { votes: num(cells[cells.length - 1]) };
      continue;
    }
    if (cells.length < 3) continue;
    const votes = num(cells[cells.length - 2]);
    const p = pct(cells[cells.length - 1]);
    if (/^total de votos validos/.test(label)) tot.valid = { votes, pct: p };
    else if (/^votos nulos/.test(label)) tot.nulos = { votes, pct: p };
    else if (/^votos em branco/.test(label)) tot.brancos = { votes, pct: p };
    else if (/^abstencoes/.test(label)) tot.abstencoes = { votes, pct: p };
    else if (/^total$/.test(label)) tot.comparecimento = { votes, pct: p };
    else if (/\(.+\)/.test(cells[0]) && /%/.test(cells[cells.length - 1])) {
      const m = cells[0].match(/^(.*?)\s*\(([^)]+)\)\s*$/);
      cands.push({ name: (m ? m[1] : cells[0]).trim(), party: m ? m[2].trim() : "", votes, pct: p });
    }
  }
  return { cands, tot };
}

// fonte primária: apuração oficial do TSE (completa e em tempo real); Wikipédia só como reserva
async function fetchTSE(src) {
  const uf = src.kind === "presidente" ? "br" : src.key.split("-")[0];
  const cargo = src.kind === "presidente" ? CARGO.presidente : src.kind === "governador" ? CARGO.governador : CARGO.senador;
  const r = await getCargo(uf, cargo, src.round === "2T" ? 2 : 1);
  if (!r || !r.cands.length) return null;
  return {
    cands: r.cands.filter((c) => c.valid !== false).map((c) => ({ name: c.name, urna: c.urna, party: c.party, votes: c.votes, pct: c.pct, elected: c.elected, status: c.status })),
    tot: r.totals,
    final: r.final,
    sectionsPct: r.sectionsPct,
    updated: r.updated,
    vagas: r.vagas,
    source: "TSE",
  };
}

async function fetchResult(src) {
  try {
    const t = await fetchTSE(src);
    if (t && t.cands.some((c) => c.votes > 0)) return t;
  } catch (e) {
    console.warn(`  ${src.key}: TSE falhou (${e.message}) — tentando Wikipédia`);
  }
  if (src.round === "2T") return null; // sem reserva pela Wikipédia no 2º turno
  const html = await getPageHTML(src.page, { offline });
  const { tables } = tablesWithHeadings(html);
  const hit = tables.filter(
    (t) => t.path.some((h, i) => i === 0 && /^resultado/i.test(h)) && (src.kind === "presidente" || t.path.some((h) => src.head.test(h))) && /Vota[çc][ãa]o/i.test(t.html)
  );
  let best = null;
  for (const t of hit) {
    const r = parseResultTable(t.html);
    if (r.cands.length >= 2 && (!best || r.cands.length > best.cands.length)) best = r;
  }
  return best;
}

// ---------- comparação ----------
const tokens = (s) => strip(s).split(" ").filter(Boolean);
function matchKey(resultName, keys, aliasOf) {
  const rt = new Set(tokens(resultName));
  let best = null;
  for (const k of keys) {
    const kt = [k, ...(aliasOf[k] || [])].flatMap((a) => [tokens(a.replace(/-/g, " "))]);
    for (const toks of kt) if (toks.length && toks.every((t) => rt.has(t)) && (!best || toks.length > best.n)) best = { k, n: toks.length };
  }
  return best?.k || null;
}

// Estimativas CONGELADAS do 1º turno: a comparação pesquisa × resultado tem que usar o que o modelo
// mostrava na véspera, não o que ele calcularia hoje (senão recalibrar o modelo reescreve a história).
const SNAP = new URL("estimativas.json", DATA);
const snapshot = fs.existsSync(SNAP) ? JSON.parse(fs.readFileSync(SNAP, "utf8")) : {};
let snapDirty = false;

function compare(key, res, agg, race) {
  const aliasOf = Object.fromEntries((race.display || []).map((d) => [d.key, d.aliases || []]));
  const keys = agg.candidates.map((c) => c.key);
  const rows = [];
  for (const c of res.cands) {
    const k = matchKey(`${c.name} ${c.urna || ""}`, keys, aliasOf);
    if (k) rows.push({ key: k, cand: agg.candidates.find((x) => x.key === k), res: c });
  }
  // dois candidatos do resultado não podem cair na mesma chave (nome só com primeiro nome é ambíguo): fica o mais votado
  const bestByKey = new Map();
  for (const r of rows) if (!bestByKey.has(r.key) || r.res.votes > bestByKey.get(r.key).res.votes) bestByKey.set(r.key, r);
  rows.length = 0;
  rows.push(...bestByKey.values());
  if (rows.length < 2) return null;
  // base comum: só os candidatos exibidos (renormaliza estimativa e resultado entre eles)
  const frozen = snapshot[key];
  if (frozen) {
    const keep = rows.filter((r) => frozen.candidates[r.key]);
    rows.length = 0;
    rows.push(...keep);
    if (rows.length < 2) return null;
  }
  const estSum = rows.reduce((s, r) => s + r.cand.line.at(-1).y, 0);
  const resSum = rows.reduce((s, r) => s + r.res.pct, 0);
  // f converte "base das pesquisas" (inclui indecisos/brancos/nulos) <-> "votos válidos entre os exibidos".
  // Congelado junto com as estimativas, pra o ponto do resultado no gráfico não se mexer se o modelo mudar.
  let f = frozen?.f ?? 100 / estSum;
  if (frozen && frozen.f == null) {
    frozen.f = +f.toFixed(5);
    snapDirty = true;
  }
  const out = rows.map((r) => {
    const l = r.cand.line.at(-1);
    const b = r.cand.band.at(-1) || { lo: l.y, hi: l.y };
    let est = l.y * f, lo = b.lo * f, hi = b.hi * f;
    const fz = frozen?.candidates[r.key];
    if (fz) ({ est, lo, hi } = fz);
    const real = (r.res.pct / resSum) * 100;
    return {
      key: r.key, name: r.cand.name, party: r.cand.party, color: r.cand.color,
      est: +est.toFixed(2), lo: +lo.toFixed(2), hi: +hi.toFixed(2),
      real: +real.toFixed(2), votes: r.res.votes, status: r.res.status || "", elected: !!r.res.elected,
      err: +(real - est).toFixed(2), inBand: real >= lo && real <= hi,
      // mesma base das linhas do gráfico (pra plotar o resultado junto da tendência)
      rawEst: +(est / f).toFixed(2), realRaw: +(real / f).toFixed(2),
    };
  });
  const day = dayOf(race.round);
  if (!frozen && Date.now() > Date.parse(day + "T23:59:59-03:00") && agg.lastPoll <= day) {
    snapshot[key] = { lastPoll: agg.lastPoll, f: +f.toFixed(5), candidates: Object.fromEntries(out.map((c) => [c.key, { est: c.est, lo: c.lo, hi: c.hi }])) };
    snapDirty = true;
  }
  const byEst = [...out].sort((a, b) => b.est - a.est)[0];
  const byReal = [...out].sort((a, b) => b.real - a.real)[0];
  return {
    race: key, label: agg.label, lastPoll: agg.lastPoll, nPolls: agg.nPolls, day,
    candidates: out.sort((a, b) => b.real - a.real),
    runoff: out.filter((c) => /2º turno/i.test(c.status)).map((c) => c.name),
    electedNames: out.filter((c) => c.elected).map((c) => c.name),
    winnerHit: byEst.key === byReal.key, predictedWinner: byEst.name, actualWinner: byReal.name,
    mae: +(out.reduce((s, c) => s + Math.abs(c.err), 0) / out.length).toFixed(2),
    inBandPct: +((out.filter((c) => c.inBand).length / out.length) * 100).toFixed(0),
  };
}

// erro das ÚLTIMAS pesquisas de cada instituto (≤14d antes da eleição), mesma base (candidatos exibidos)
function pollsterErrors(key, cmp, agg, day = ELECTION_DAY) {
  const real = Object.fromEntries(cmp.candidates.map((c) => [c.key, c.real]));
  const lim = Date.parse(day + "T00:00:00Z") - 14 * 864e5;
  const last = new Map();
  for (const p of agg.polls || []) {
    const t = Date.parse(p.end + "T00:00:00Z");
    if (t > Date.parse(day + "T00:00:00Z") || t < lim) continue;
    if (!last.has(p.pollster) || t > last.get(p.pollster).t) last.set(p.pollster, { t, p });
  }
  const res = [];
  for (const [pollster, { p }] of last) {
    const vals = Object.entries(p.values).filter(([k]) => k in real);
    const s = vals.reduce((a, [, v]) => a + v, 0);
    if (vals.length < 2 || s <= 0) continue;
    const mae = vals.reduce((a, [k, v]) => a + Math.abs((v / s) * 100 - real[k]), 0) / vals.length;
    const topP = vals.sort((a, b) => b[1] - a[1])[0][0];
    const topR = Object.entries(real).sort((a, b) => b[1] - a[1])[0][0];
    const lead = vals.find(([k]) => k === topR);
    const bias = lead ? +(((lead[1] / s) * 100) - real[topR]).toFixed(2) : null; // erro assinado no vencedor real
    res.push({ pollster, race: key, mae: +mae.toFixed(2), end: p.end, winnerHit: topP === topR, bias, winnerKey: topR });
  }
  return res;
}

// ---------- main ----------
async function main() {
  const summary = { updated: new Date().toISOString(), electionDay: ELECTION_DAY, races: [], pollsters: [], notes: [] };
  const turnout = {};
  for (const src of sources()) {
    let res;
    try {
      res = await fetchResult(src);
    } catch (e) {
      console.warn(`  ${src.key}: falha ao ler resultado (${e.message})`);
      continue;
    }
    const validVotes = res?.tot?.valid?.votes || 0;
    const sumVotes = res ? res.cands.reduce((s, c) => s + c.votes, 0) : 0;
    if (!res || !sumVotes) {
      console.log(`  ${src.key}: resultado ainda não publicado`);
      continue;
    }
    const complete = res.source === "TSE" ? !!res.final : validVotes > 0 && sumVotes / validVotes > 0.98;
    fs.writeFileSync(
      new URL(`results.${src.key}.json`, DATA),
      JSON.stringify({ race: src.key, kind: src.kind, source: res.source === "TSE" ? "TSE (resultados.tse.jus.br)" : src.page, complete, updated: res.updated || null, sectionsPct: res.sectionsPct ?? null, totals: res.tot, candidates: res.cands }, null, 2) + "\n"
    );
    if (src.kind === "presidente") turnout.presidente = res.tot;
    let agg;
    try {
      agg = JSON.parse(fs.readFileSync(new URL(`${src.key}.json`, OUT), "utf8"));
    } catch {
      console.log(`  ${src.key}: resultado ok, mas sem JSON do agregador`);
      continue;
    }
    const cmp = compare(src.key, res, agg, RACES[src.key]);
    if (!cmp) {
      console.log(`  ${src.key}: não casei candidatos com o agregador`);
      continue;
    }
    cmp.kind = src.kind;
    cmp.round = src.round || "1T";
    cmp.complete = complete;
    cmp.source = res.source || "Wikipédia";
    cmp.sectionsPct = res.sectionsPct ?? null;
    cmp.group = RACES[src.key].group;
    summary.races.push(cmp);
    summary.pollsters.push(...pollsterErrors(src.key, cmp, agg, dayOf(src.round)).map((p) => ({ ...p, round: src.round || "1T" })));
    console.log(`  ${src.key}: ${cmp.complete ? "completo" : "PARCIAL"} · vencedor ${cmp.actualWinner} (previsto ${cmp.predictedWinner}) · MAE ${cmp.mae} · ${cmp.inBandPct}% na faixa`);
  }
  if (snapDirty) {
    const sorted = Object.fromEntries(Object.entries(snapshot).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(SNAP, JSON.stringify(sorted, null, 1) + "\n");
    console.log("  -> data/estimativas.json (estimativas do 1º turno congeladas)");
  }
  summary.turnout = turnout;
  // 2022 (1º turno presidencial) pra comparar abstenção/brancos/nulos
  try {
    const { tables } = tablesWithHeadings(await getPageHTML("Eleição presidencial no Brasil em 2022", { offline }));
    for (const t of tables) {
      if (!/Absten/i.test(t.html) || !/Vota[çc][ãa]o/i.test(t.html)) continue;
      const r = parseResultTable(t.html);
      if (r.tot.abstencoes && r.cands.length >= 5) { summary.turnout22 = r.tot; break; }
    }
  } catch (e) {
    console.warn("  aviso: 2022 indisponível (" + e.message + ")");
  }
  fs.writeFileSync(new URL("resultados.json", OUT), JSON.stringify(summary, null, 2) + "\n");
  console.log(`  -> site/data/resultados.json (${summary.races.length} corridas comparadas)`);
}
main().catch((e) => {
  console.warn("results.mjs falhou:", e.message);
  process.exit(0); // best-effort
});
