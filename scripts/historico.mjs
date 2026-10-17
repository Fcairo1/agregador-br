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

// nomes da época: até 2018 o Ibope ainda era Ibope (o Ipec só nasce depois) e "Vox Populi" não é o "Vox Brasil" de 2026
const eraName = (name, year) => (year <= 2018 ? name.replace(/^Ipec$/, "Ibope").replace(/^Vox Brasil$/, "Vox Populi") : name);
function save(key, polls, names) {
  const yr = +key.match(/presidente-(\d{4})/)[1];
  polls = polls.map((p) => ({ ...p, pollster: eraName(p.pollster, yr) }));
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

// ---------- 2002, 2006 e 2010: arquivo de pesquisas do jornalista Fernando Rodrigues (UOL) ----------
// Página que reunia TODAS as pesquisas registradas, por instituto (hoje só no Wayback Machine, exceto 2002). Uma linha por pesquisa
// no cenário principal (a 1ª linha de cada instituto+data que tenha todos os candidatos principais; as demais são cenários).
const CACHE = new URL("../.cache/uol/", import.meta.url);
const WB = "http://web.archive.org/web";
const UOL = {
  2002: { f: "http://www1.uol.com.br/fernandorodrigues/arquivos/pesquisas/eleicoes2002/pres.shl", s: "http://www1.uol.com.br/fernandorodrigues/arquivos/pesquisas/eleicoes2002/2o_turno/pres.shl" },
  2006: { f: `${WB}/20111227101027id_/http://noticias.uol.com.br/fernandorodrigues/arquivos/pesquisas/pais/2006/1turno/pe_presidente-2006.jhtm`, s: `${WB}/20101015224040id_/http://noticias.uol.com.br/fernandorodrigues/arquivos/pesquisas/pais/2006/2turno/presidente.jhtm` },
  2010: { f: `${WB}/20210126105518id_/https://noticias.uol.com.br/fernandorodrigues/pesquisas/2010/1turno/presidente.jhtm%20%20`, s: `${WB}/20210506233947id_/https://noticias.uol.com.br/fernandorodrigues/pesquisas/2010/2turno/presidente.jhtm` },
};
async function uolPage(year, turn) {
  const file = new URL(`${year}-${turn}.html`, CACHE);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  const r = await fetch(UOL[year][turn], { headers: { "User-Agent": "Mozilla/5.0 (agregador-br)" } });
  if (!r.ok) throw new Error(`UOL ${year}/${turn}: HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, buf);
  await new Promise((res) => setTimeout(res, 1500)); // educado com o Wayback
  return buf;
}
const decodeHtml = (buf) => { const t = buf.toString("utf8"); return t.includes("\uFFFD") ? buf.toString("latin1") : t; };
const ENT = { "&nbsp;": " ", "&amp;": "&", "&ccedil;": "ç", "&atilde;": "ã", "&eacute;": "é", "&iacute;": "í", "&oacute;": "ó", "&uacute;": "ú", "&aacute;": "á", "&ecirc;": "ê", "&ocirc;": "ô", "&deg;": "°", "&otilde;": "õ", "&Eacute;": "É", "&Aacute;": "Á" };
const plain = (h) => h.replace(/<[^>]+>/g, " ").replace(/&[a-zA-Z]+;|&#\d+;/g, (m) => ENT[m] ?? (m.startsWith("&#") ? String.fromCodePoint(+m.slice(2, -1)) : " ")).replace(/\s+/g, " ").trim();
const htmlTables = (html) => (html.match(/<table[\s\S]*?<\/table>/gi) || []).map((tb) => (tb.match(/<tr[\s\S]*?<\/tr>/gi) || []).map((tr) => (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []).map(plain)));
const PTMON = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
// "4-5/out/02" | "04/out/02" | "29-30.set.06" | "20-22.set" | "1°-2.out.2010*"
function uolDate(raw, defYear) {
  const t = raw.toLowerCase().replace(/[°º*]/g, "").replace(/\s+/g, "");
  const m = t.match(/^(\d{1,2})(?:-(\d{1,2}))?[./]([a-zç]{3})[a-z]*(?:[./](\d{2,4}))?/);
  if (!m) return null;
  const mon = PTMON[m[3]], yr = m[4] ? (m[4].length === 2 ? 2000 + +m[4] : +m[4]) : defYear;
  if (!mon) return null;
  const pad = (n) => String(n).padStart(2, "0");
  return { start: `${yr}-${pad(mon)}-${pad(+m[1])}`, end: `${yr}-${pad(mon)}-${pad(+(m[2] || m[1]))}` };
}
// Extrai de uma tabela (header-driven): cols = { chave: regex do cabeçalho }
function uolPolls(rows, { cols, need, year, from, to, section }) {
  const hi = rows.findIndex((r) => r.some((c) => /^instituto$/i.test(c)) && r.some((c) => /^data/i.test(c)));
  if (hi < 0) return [];
  const head = rows[hi].map((c) => c.toLowerCase());
  const iP = head.findIndex((c) => c === "instituto"), iD = head.findIndex((c) => c.startsWith("data"));
  const idx = Object.fromEntries(Object.entries(cols).map(([k, rx]) => [k, head.findIndex((c) => rx.test(c))]));
  const out = [], seen = new Set();
  for (const r of rows.slice(hi + 1)) {
    if (r.length < head.length - 6) continue;
    const name = r[iP];
    if (!name || /v[oó]tos v[aá]lidos/i.test(name)) continue; // versão renormalizada (só válidos): fica fora, a base é "% das pesquisas"
    const dr = uolDate(r[iD] || "", year);
    if (!dr || dr.end < from || dr.end > to) continue;
    const values = {};
    for (const [k, i] of Object.entries(idx)) { const v = i >= 0 ? pctv(r[i]) : null; if (v != null) values[k] = v; }
    if (!need.every((k) => k in values)) continue;
    const pollster = normPollster(name.replace(/\s*\(votos totais\)/i, ""));
    const key = pollster + "|" + dr.end;
    if (seen.has(key)) continue; // demais linhas do mesmo instituto+data são cenários alternativos
    seen.add(key);
    out.push({ pollster, ...dr, n: null, moe: "", source: "", section, values });
  }
  return out;
}
{
  const C = {
    2002: { cols: { lula: /^lula/, serra: /serra/, garotinho: /garotinho/, ciro: /ciro gomes/ }, need: ["lula", "serra", "garotinho", "ciro"], t: ["lula", "serra"], f: ["2002-04-01", "2002-10-05"], s: ["2002-10-07", "2002-10-26"], names: { lula: ["Lula", "PT"], serra: ["Serra", "PSDB"], garotinho: ["Garotinho", "PSB"], ciro: ["Ciro", "PPS"] } },
    2006: { cols: { lula: /^lula/, alckmin: /alckmin/, heloisa: /helo[ií]sa/, cristovam: /cristovam/ }, need: ["lula", "alckmin"], t: ["lula", "alckmin"], f: ["2006-03-01", "2006-09-30"], s: ["2006-10-02", "2006-10-28"], names: { lula: ["Lula", "PT"], alckmin: ["Alckmin", "PSDB"], heloisa: ["Heloísa Helena", "PSOL"], cristovam: ["Cristovam", "PDT"] } },
    2010: { cols: { dilma: /dilma/, serra: /serra/, marina: /marina/ }, need: ["dilma", "serra"], t: ["dilma", "serra"], f: ["2010-01-01", "2010-10-02"], s: ["2010-10-04", "2010-10-30"], names: { dilma: ["Dilma", "PT"], serra: ["Serra", "PSDB"], marina: ["Marina", "PV"] } },
  };
  for (const [year, c] of Object.entries(C)) {
    const nm = Object.fromEntries(Object.entries(c.names).map(([k, [name, party]]) => [k, { name, party }]));
    const T1 = htmlTables(decodeHtml(await uolPage(year, "f")));
    // 1º turno: 2002 tabela estimulada (a 1ª com cabeçalho "Instituto"); 2006 a 1ª; 2010 as que trazem coluna de brancos/indecisos (base total) + a da Vox Populi
    const pick1 = T1.filter((rows) => rows.some((r) => r.some((x) => /^instituto$/i.test(x)) && r.some((x) => /^data/i.test(x))));
    let p1 = [];
    if (year === "2010") {
      for (const rows of pick1) {
        const head = (rows.find((r) => r.some((x) => /^instituto$/i.test(x))) || []).join("|").toLowerCase();
        if (/brancos|indecisos/.test(head) && /dilma/.test(head) && /serra/.test(head) && head.indexOf("dilma") < head.indexOf("serra") && !/outros|candidato do lula|rejeita/.test(head) && rows.length > 25) p1.push(...uolPolls(rows, { ...c, year: +year, from: c.f[0], to: c.f[1], section: "uol" }));
      }
    } else p1 = uolPolls(pick1[0], { ...c, year: +year, from: c.f[0], to: c.f[1], section: "uol" });
    // dedupe entre tabelas
    const seen1 = new Set(); p1 = p1.filter((p) => { const k = p.pollster + "|" + p.end; if (seen1.has(k)) return false; seen1.add(k); return true; });
    save(`presidente-${year}`, p1, nm);
    const T2 = htmlTables(decodeHtml(await uolPage(year, "s")));
    const pick2 = T2.filter((rows) => rows.some((r) => r.some((x) => /^instituto$/i.test(x)) && r.some((x) => /^data/i.test(x))));
    const need2 = c.t;
    const cols2 = Object.fromEntries(need2.map((k) => [k, c.cols[k]]));
    const p2 = uolPolls(pick2[0], { cols: cols2, need: need2, year: +year, from: c.s[0], to: c.s[1], section: "uol" });
    save(`presidente-${year}-2t`, p2, nm);
  }
}

// ---------- 1989, 1994, 1998: só há a série do Datafolha (única fonte pública consolidada que achei) ----------
// 1989: Wikipédia EN (Datafolha, 15 rodadas de 1º turno + 7 de 2º). 1994 e 1998: tabelas "Evolução da intenção de voto para presidente"
// (resposta estimulada, total de votos) dos PDFs do próprio Datafolha — digitadas das tabelas dos PDFs:
//   1994 https://media.folha.uol.com.br/datafolha/2022/09/01/intencao_de_voto_e_rejeicao_para_presidente_94.pdf
//   1998 https://media.folha.uol.com.br/datafolha/2022/12/28/brasil-1998-1t.pdf
{
  const nm89 = { collor: { name: "Collor", party: "PRN" }, lula: { name: "Lula", party: "PT" }, brizola: { name: "Brizola", party: "PDT" }, covas: { name: "Covas", party: "PSDB" }, maluf: { name: "Maluf", party: "PDS" }, afif: { name: "Afif", party: "PL" }, guimaraes: { name: "Ulysses", party: "PMDB" } };
  const en = await (await fetch("https://en.wikipedia.org/w/api.php?action=parse&prop=text&redirects=1&format=json&formatversion=2&page=" + encodeURIComponent("1989 Brazilian presidential election"), { headers: UA })).json();
  const tabs = en.parse.text.match(/<table[\s\S]*?<\/table>/g);
  const rowsE = (tb) => [...tb.matchAll(/<tr[\s\S]*?<\/tr>/g)].map((m) => [...m[0].matchAll(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/g)].map((c) => clean(c[2])));
  const t1 = tabs.find((t) => /Collor/.test(t) && /Brizola/.test(t) && /Maluf/.test(t) && /Pollster/.test(t)), t2 = tabs.find((t) => /Pollster/.test(t) && /Collor/.test(t) && !/Brizola/.test(t));
  const keys1 = ["collor", "lula", "brizola", "covas", "maluf", "afif", "guimaraes"];
  const mk = (rows, keys, from, to) => rows.filter((r) => r.length === 3 + keys.length + 3 || r.length === 3 + keys.length + 2).map((r) => {
    if (/election/i.test(r[0])) return null;
    const dr = parseRange(r[1].replace(/[–−]/g, " a "), 1989);
    const vals = Object.fromEntries(keys.map((k, i) => [k, pctv(r[3 + i])]).filter(([, v]) => v != null));
    const abst = pctv(r[3 + keys.length + (keys.length > 2 && r.length === 3 + keys.length + 3 ? 1 : 0)]);
    if (!dr || dr.end < from || dr.end > to || !keys.slice(0, 2).every((k) => k in vals)) return null;
    return { pollster: "Datafolha", ...dr, n: +r[2].replace(/,/g, "") || null, moe: "", source: "", section: "en", values: vals, abst };
  }).filter(Boolean);
  const p1 = mk(rowsE(t1), keys1, "1989-01-01", "1989-11-14"); // 15/11 (dia da eleição) é boca de urna: fora
  const p2 = mk(rowsE(t2), ["collor", "lula"], "1989-11-16", "1989-12-16").filter((p) => p.abst != null); // linha sem indecisos = versão "só válidos"
  save("presidente-1989", p1.map(({ abst, ...p }) => p), nm89);
  save("presidente-1989-2t", p2.map(({ abst, ...p }) => p), nm89);

  const D94 = {
    d: ["04-05", "05-03", "05-24", "06-13", "07-05", "07-13", "07-26", "08-09", "08-18", "08-22", "08-30", "09-05", "09-09", "09-15", "09-22", "09-28", "10-01"],
    fhc: [21, 16, 17, 19, 21, 25, 29, 36, 41, 43, 45, 44, 44, 45, 47, 47, 48],
    lula: [37, 42, 40, 41, 38, 34, 32, 29, 24, 23, 23, 23, 23, 21, 22, 23, 22],
    quercia: [8, 7, 8, 6, 7, 7, 7, 6, 5, 4, 5, 5, 5, 6, 6, 5, 5],
    brizola: [10, 8, 7, 7, 7, 7, 7, 6, 5, 5, 5, 4, 4, 4, 4, 3, 4],
  };
  const polls94 = D94.d.map((d, i) => ({ pollster: "Datafolha", start: `1994-${d}`, end: `1994-${d}`, n: null, moe: "", source: "https://media.folha.uol.com.br/datafolha/2022/09/01/intencao_de_voto_e_rejeicao_para_presidente_94.pdf", section: "datafolha-pdf", values: { fhc: D94.fhc[i], lula: D94.lula[i], quercia: D94.quercia[i], brizola: D94.brizola[i] } }));
  save("presidente-1994", polls94, { fhc: { name: "FHC", party: "PSDB" }, lula: { name: "Lula", party: "PT" }, quercia: { name: "Quércia", party: "PMDB" }, brizola: { name: "Brizola", party: "PDT" } });

  const D98 = {
    d: ["03-11", "04-30", "05-28", "06-08", "07-09", "08-14", "09-02", "09-18", "09-25", "10-02"],
    fhc: [41, 41, 34, 33, 40, 42, 48, 48, 46, 49],
    lula: [25, 24, 30, 30, 28, 26, 26, 25, 25, 26],
    ciro: [10, 8, 9, 8, 7, 7, 7, 8, 9, 10],
    eneas: [7, 6, 5, 5, 4, 4, 3, 3, 3, 2],
  };
  const polls98 = D98.d.map((d, i) => ({ pollster: "Datafolha", start: `1998-${d}`, end: `1998-${d}`, n: null, moe: "", source: "https://media.folha.uol.com.br/datafolha/2022/12/28/brasil-1998-1t.pdf", section: "datafolha-pdf", values: { fhc: D98.fhc[i], lula: D98.lula[i], ciro: D98.ciro[i], eneas: D98.eneas[i] } }));
  save("presidente-1998", polls98, { fhc: { name: "FHC", party: "PSDB" }, lula: { name: "Lula", party: "PT" }, ciro: { name: "Ciro", party: "PPS" }, eneas: { name: "Enéas", party: "PRONA" } });
}

// ---------- resultados oficiais (tabela "Resultados" do artigo da eleição, PT) -> data/historico-resultados.json ----------
{
  const DAYS = { 1989: ["1989-11-15", "1989-12-17"], 1994: ["1994-10-03", null], 1998: ["1998-10-04", null], 2002: ["2002-10-06", "2002-10-27"], 2006: ["2006-10-01", "2006-10-29"], 2010: ["2010-10-03", "2010-10-31"], 2014: ["2014-10-05", "2014-10-26"], 2018: ["2018-10-07", "2018-10-28"], 2022: ["2022-10-02", "2022-10-30"] };
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
