// Pesquisas das presidenciais passadas (2010, 2014, 2018, 2022) -> data/polls.presidente-<ano>[-2t].csv
// Extração ÚNICA (os CSVs são commitados e o build só agrega; não roda no cron). Rodar à mão: node scripts/historico.mjs
// 2002 e 2006 ficaram de fora: as Wikipédias (pt/en/es/fr) não têm tabela de pesquisas dessas eleições.
import fs from "node:fs";
import { fetchRacePolls, getPageHTML, tablesWithHeadings, cellText, normPollster } from "./lib/wiki.mjs";
import { writeCSV } from "./lib/csv.mjs";

const DATA = new URL("../data/", import.meta.url);
const META = ["id", "pollster", "start", "end", "n", "moe", "source", "section"];
const UA = { "User-Agent": "agregador-br (github.com/Fcairo1/agregador-br)" };
const PAGE = (y) => `Pesquisas de opinião para a eleição presidencial no Brasil em ${y}`;
const slugP = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "");

function save(key, polls, names) {
  const freq = new Map();
  for (const p of polls) for (const k of Object.keys(p.values)) freq.set(k, (freq.get(k) || 0) + 1);
  const keys = [...freq.keys()].sort((a, b) => freq.get(b) - freq.get(a));
  const seen = new Map();
  const rows = polls
    .sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : a.pollster.localeCompare(b.pollster)))
    .map((p) => {
      let id = `${slugP(p.pollster)}-${p.end}`;
      const c = (seen.get(id) || 0) + 1;
      seen.set(id, c);
      if (c > 1) id += `-${c}`;
      const row = { id, pollster: p.pollster, start: p.start, end: p.end, n: p.n ?? "", moe: p.moe ?? "", source: p.source || "", section: p.section || "" };
      for (const k of keys) row[k] = p.values[k] ?? "";
      return row;
    });
  writeCSV(new URL(`polls.${key}.csv`, DATA), rows, [...META, ...keys]);
  writeCSV(new URL(`candidates.${key}.csv`, DATA), keys.map((k) => ({ key: k, name: names[k]?.name || k, party: names[k]?.party || "" })), ["key", "name", "party"]);
  const ends = rows.map((r) => r.end);
  console.log(`  ${key}: ${rows.length} pesquisas (${ends[0]} → ${ends.at(-1)}) · ${keys.length} candidatos`);
}
const remap = (polls, map) => polls.map((p) => ({ ...p, values: Object.fromEntries(Object.entries(p.values).map(([k, v]) => [map[k] || k, v])) }));
const within = (polls, a, b) => polls.filter((p) => p.end >= a && p.end <= b);

// ---------- 2022 e 2018: tabelas da Wikipédia PT (parser geral) ----------
async function viaParser(page, year, rule) {
  const { polls } = await fetchRacePolls({ wikiPage: page, year, pathRule: rule, optional: true }, {});
  return polls.map((p) => ({ pollster: normPollster(p.pollster), start: p.start, end: p.end, n: p.n, moe: p.moe, source: p.source, section: p.section, values: p.values }));
}

const clean = (s) => s.replace(/<sup[\s\S]*?<\/sup>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, "").replace(/&#160;|&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/\s+/g, " ").trim();
const pctv = (s) => { s = (s || "").trim(); if (!s || /^[–—-]+$/.test(s)) return null; if (s.startsWith("<")) return 0.5; const m = s.replace(",", ".").match(/[\d.]+/); return m ? +m[0] : null; };
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12, fev: 2, abr: 4, mai: 5, ago: 8, set: 9, out: 10, dez: 12 };
function parseRange(t, year) {
  t = t.toLowerCase().replace(/\s+/g, " ").replace(/ de /g, " ").replace(/ e /g, " a ");
  const toks = [...t.matchAll(/(\d{1,2})\s*([a-zç]{3,})?/g)].map((m) => ({ d: +m[1], m: m[2] ? MON[m[2].slice(0, 3)] : null }));
  if (!toks.length) return null;
  const last = toks.at(-1);
  if (!last.m) last.m = toks.find((x) => x.m)?.m;
  if (!last.m) return null;
  const first = toks[0];
  if (!first.m) first.m = last.m;
  const iso = (m, d) => `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return { start: iso(first.m, first.d), end: iso(last.m, last.d) };
}
// EN: tabela de 2º turno (Pollster | Period | Sample | A | B | Blank | Lead)
async function enSecondRound(page, heading, year, keys, from, to) {
  const j = await (await fetch("https://en.wikipedia.org/w/api.php?action=parse&prop=text&redirects=1&format=json&formatversion=2&page=" + encodeURIComponent(page), { headers: UA })).json();
  const part = j.parse.text.split(/(?=<h[234][^>]*>)/).find((x) => clean((x.match(/<h[234][^>]*>([\s\S]*?)<\/h[234]>/) || [])[1] || "") === heading);
  const t = part.match(/<table[\s\S]*?<\/table>/)[0];
  const out = [];
  for (const r of [...t.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => [...m[0].matchAll(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/g)].map((c) => clean(c[2])))) {
    if (r.length < 6 || /results?|aggregat/i.test(r[0])) continue;
    const dr = parseRange(r[1].replace(/[–−]/g, " a ").replace(/\b20\d\d\b/, ""), year);
    const a = pctv(r[3]), b = pctv(r[4]);
    if (!dr || a == null || b == null || dr.end < from || dr.end > to) continue;
    out.push({ pollster: normPollster(r[0]), ...dr, n: +r[2].replace(/,/g, "") || null, moe: "", source: "", section: "2t", values: { [keys[0]]: a, [keys[1]]: b } });
  }
  return out;
}
// 2022
{
  const p1 = within(await viaParser(PAGE(2022), 2022, (p) => /^primeiro turno$/i.test(p[0] || "") && p[1] === "2022"), "2022-01-01", "2022-10-02");
  const p2 = await enSecondRound("Opinion polling for the 2022 Brazilian presidential election", "After 2 October 2022", 2022, ["bolsonaro", "lula"], "2022-10-03", "2022-10-29");
  const m = { gomes: "ciro" };
  const names = { lula: { name: "Lula", party: "PT" }, bolsonaro: { name: "Bolsonaro", party: "PL" }, ciro: { name: "Ciro", party: "PDT" }, tebet: { name: "Tebet", party: "MDB" }, thronicke: { name: "Soraya", party: "UNIÃO" }, "d-avila": { name: "D'Ávila", party: "NOVO" } };
  save("presidente-2022", remap(p1, m), names);
  save("presidente-2022-2t", remap(p2, m), names);
}
// 2018 (colunas rotuladas pelo PARTIDO; 2T: nomes + partidos)
{
  const party = { psl: "bolsonaro", pt: "haddad", pdt: "ciro", psdb: "alckmin", novo: "amoedo", rede: "marina", mdb: "meirelles", pode: "alvaro-dias", psb: "marina" };
  const names = { bolsonaro: { name: "Bolsonaro", party: "PSL" }, haddad: { name: "Haddad", party: "PT" }, ciro: { name: "Ciro", party: "PDT" }, alckmin: { name: "Alckmin", party: "PSDB" }, amoedo: { name: "Amoêdo", party: "NOVO" }, marina: { name: "Marina", party: "REDE" }, meirelles: { name: "Meirelles", party: "MDB" }, "alvaro-dias": { name: "Álvaro Dias", party: "PODE" } };
  const p1 = within(await viaParser(PAGE(2018), 2018, (p) => /^primeiro turno$/i.test(p[0] || "") && p[1] === "Pesquisas"), "2018-01-01", "2018-10-07");
  const p2 = within(await viaParser(PAGE(2018), 2018, (p) => /^segundo turno$/i.test(p[0] || "") && p[1] === "Pesquisas"), "2018-10-08", "2018-10-27");
  const only = (polls, keys) => polls.map((p) => ({ ...p, values: Object.fromEntries(Object.entries(p.values).filter(([k]) => keys.includes(k))) })).filter((p) => keys.every((k) => k in p.values));
  save("presidente-2018", remap(p1, party), names);
  // 2T: o parser traz "haddad/bolsonaro" e/ou "pt/psl" — normaliza pros dois nomes
  const p2n = only(remap(p2, { pt: "haddad", psl: "bolsonaro" }), ["haddad", "bolsonaro"]);
  save("presidente-2018-2t", p2n, names);
}

// ---------- 2014: Wikipédia EN (cenário principal, com Campos) + PT (pesquisas pós-14/ago e 2º turno) ----------
{
  const out = [];
  const html = (await (await fetch("https://en.wikipedia.org/w/api.php?action=parse&prop=text&format=json&formatversion=2&page=" + encodeURIComponent("2014 Brazilian general election"), { headers: UA })).json()).parse.text;
  const seg = html.slice(html.indexOf('id="First_round"'), html.indexOf('id="Second_round"'));
  const t = seg.match(/<table[\s\S]*?<\/table>/g)[1];
  for (const r of [...t.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => [...m[0].matchAll(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/g)].map((c) => clean(c[2])))) {
    if (r.length !== 17) continue;
    const name = r[0].replace(/\s*Archived.*$/, "");
    if (/election|exit/i.test(name)) continue;
    const dr = parseRange(r[1], 2014);
    const d = pctv(r[3]), a = pctv(r[5]), silva = pctv(r[7]), campos = pctv(r[8]);
    if (!dr || d == null || a == null) continue;
    out.push({ pollster: normPollster(name.replace(/^CNI\/Ibope$/, "Ibope")), ...dr, n: +r[2].replace(/,/g, "") || null, moe: "", source: "", section: "en", values: { dilma: d, aecio: a, marina: silva ?? campos, ...(silva == null ? { campos: undefined } : {}) } });
  }
  // marca a fase do PSB: antes de 14/ago = Campos (a coluna "marina" é o candidato do PSB, os dois mesclados)
  for (const p of out) { delete p.values.campos; p.section = p.end < "2014-08-14" ? "campos" : "marina"; }
  const pt = tablesWithHeadings(await getPageHTML(PAGE(2014))).tables;
  const t1 = pt.find((x) => x.path[0] === "Primeiro turno");
  const rowsOf = (tb) => [...tb.html.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((m) => [...m[0].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => cellText(c[1])));
  for (const r of rowsOf(t1).slice(2)) {
    if (r.length < 16) continue;
    const dr = parseRange(r[1], 2014);
    if (!dr || dr.end < "2014-08-15") continue;
    const moe = pctv(r[3].replace("±", ""));
    const v = r.slice(4, 15).map(pctv);
    if (v[0] == null || v[2] == null) continue;
    out.push({ pollster: normPollster(r[2]), ...dr, n: moe ? Math.round((98 / moe) ** 2) : null, moe: moe || "", source: "", section: "marina", values: { dilma: v[0], aecio: v[2], marina: v[1] ?? 0 } });
  }
  const uniq = [];
  const day = (s) => Date.parse(s + "T00:00:00Z") / 864e5;
  for (const p of out) if (!uniq.some((q) => q.pollster === p.pollster && Math.abs(day(q.end) - day(p.end)) <= 2 && q.values.dilma === p.values.dilma && q.values.aecio === p.values.aecio && q.values.marina === p.values.marina)) uniq.push(p);
  const names = { dilma: { name: "Dilma", party: "PT" }, aecio: { name: "Aécio", party: "PSDB" }, marina: { name: "Marina", party: "PSB" } };
  save("presidente-2014", uniq, names);
  // 2º turno (PT): Dilma × Aécio
  const t2 = pt.find((x) => x.path[0] === "Segundo turno");
  const p2 = [];
  for (const r of rowsOf(t2).slice(2)) {
    if (r.length < 7) continue;
    const dr = parseRange(r[1], 2014);
    if (!dr) continue;
    const moe = pctv(r[3].replace("±", ""));
    const d = pctv(r[4]), a = pctv(r[5]);
    if (d == null || a == null) continue;
    p2.push({ pollster: normPollster(r[2]), ...dr, n: moe ? Math.round((98 / moe) ** 2) : null, moe: moe || "", source: "", section: "2t", values: { dilma: d, aecio: a } });
  }
  save("presidente-2014-2t", within(p2, "2014-10-05", "2014-10-25"), names);
}

// ---------- 2010: tabela "Pesquisas" da Wikipédia PT (uma data por linha; sem amostra) ----------
{
  const tb = tablesWithHeadings(await getPageHTML(PAGE(2010))).tables.find((x) => x.path[0] === "Pesquisas");
  const rows = [...tb.html.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((m) => [...m[0].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => cellText(c[1])));
  console.log("  2010: cabeçalho", JSON.stringify(rows[0]), "| 1ª linha", JSON.stringify(rows[1]));
  const head = rows[0].map((h) => h.toLowerCase());
  const col = (rx) => head.findIndex((h) => rx.test(h));
  const ci = { dilma: col(/dilma/), serra: col(/serra/), marina: col(/marina/), ciro: col(/ciro/), hh: col(/helo/), outros: col(/outros/) };
  const p1 = [];
  for (const r of rows.slice(1)) {
    const m = (r[0] || "").match(/(\d{1,2}) de ([a-zç]+) de (\d{4})/i);
    if (!m) continue;
    const mon = { janeiro: 1, fevereiro: 2, "março": 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 }[m[2].toLowerCase()];
    const end = `${m[3]}-${String(mon).padStart(2, "0")}-${String(+m[1]).padStart(2, "0")}`;
    if (end < "2010-01-01" || end > "2010-10-03") continue;
    const v = { dilma: pctv(r[ci.dilma]), serra: pctv(r[ci.serra]), marina: pctv(r[ci.marina]) };
    if (v.dilma == null || v.serra == null) continue;
    if (v.marina == null) v.marina = 0;
    p1.push({ pollster: normPollster(r[1]), start: end, end, n: null, moe: "", source: "", section: "pesquisas", values: v });
  }
  save("presidente-2010", p1, { dilma: { name: "Dilma", party: "PT" }, serra: { name: "Serra", party: "PSDB" }, marina: { name: "Marina", party: "PV" } });
}

// ---------- resultados oficiais (tabela "Resultados" do artigo da eleição, PT) -> data/historico-resultados.json ----------
{
  const DAYS = { 2010: ["2010-10-03", "2010-10-31"], 2014: ["2014-10-05", "2014-10-26"], 2018: ["2018-10-07", "2018-10-28"], 2022: ["2022-10-02", "2022-10-30"] };
  const out = {};
  for (const y of Object.keys(DAYS)) {
    const { tables } = tablesWithHeadings(await getPageHTML(`Eleição presidencial no Brasil em ${y}`));
    const t = tables.find((x) => /^resultado/i.test(x.path[0] || "") && /Candidato/i.test(x.html) && [...x.html.matchAll(/<tr\b/gi)].length >= 10);
    const rows = [...t.html.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((m) => [...m[0].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => cellText(c[1])));
    const first = [], second = [];
    for (const r of rows) {
      const m = (r[0] || "").match(/^(.*?)\s*\(([^)]+)\)\s*$/);
      if (!m) continue;
      const num = (s) => (s && /%/.test(s) ? parseFloat(s.replace("%", "").replace(",", ".")) : null);
      const p1 = num(r[3]), p2 = num(r[5]);
      if (p1 != null) first.push({ name: m[1].trim(), party: m[2].trim(), pct: p1, votes: +String(r[2]).replace(/\D/g, "") });
      if (p2 != null) second.push({ name: m[1].trim(), party: m[2].trim(), pct: p2, votes: +String(r[4]).replace(/\D/g, "") });
    }
    out[y] = { day1: DAYS[y][0], day2: DAYS[y][1], first, second };
    console.log(`  resultado ${y}: 1T ${first.slice(0, 3).map((c) => c.name + " " + c.pct).join(", ")} | 2T ${second.map((c) => c.name + " " + c.pct).join(", ")}`);
  }
  fs.writeFileSync(new URL("historico-resultados.json", DATA), JSON.stringify(out, null, 1) + "\n");
}
