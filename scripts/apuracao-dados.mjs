// Dados estáticos da projeção da apuração: 1º turno de 2026 por município (resultado + horário de totalização).
// - serve de covariável ("perfil eleitoral da localidade") pro modelo do 2º turno
// - serve de roteiro do REPLAY (ordem em que os municípios foram totalizados em 4–5/out)
// Saída: site/apuracao/dados/mun-1t-2026.json (commitado). Uso: node scripts/apuracao-dados.mjs [--refresh]
import fs from "node:fs";
import path from "node:path";

const BASE = "https://resultados.tse.jus.br/oficial/ele2026/6257";
const OUT = new URL("../site/apuracao/dados/mun-1t-2026.json", import.meta.url);
const CACHE = new URL("../.cache/apuracao/", import.meta.url);
const UA = { "User-Agent": "Mozilla/5.0 (agregador-br)" };
const refresh = process.argv.includes("--refresh");
fs.mkdirSync(CACHE, { recursive: true });

async function getJSON(rel, { cache = true } = {}) {
  const f = new URL(rel.replace(/[/]/g, "__"), CACHE);
  if (cache && !refresh && fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(`${BASE}/${rel}`, { headers: UA });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error("HTTP " + r.status);
      const t = await r.text();
      if (cache) fs.writeFileSync(f, t);
      return JSON.parse(t);
    } catch (e) {
      if (i === 4) throw e;
      await new Promise((r) => setTimeout(r, 600 * (i + 1) ** 2));
    }
  }
}
const num = (s) => +String(s ?? "0").replace(",", ".") || 0;
// "04/10/2026" + "18:21:20" (horário de Brasília) -> ISO com offset
const iso = (d, h) => (d && h ? `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}T${h}-03:00` : null);

const cm = await getJSON("config/mun-e006257-cm.json");
const munis = [];
for (const ab of cm.abr) for (const m of ab.mu) munis.push({ uf: ab.cd, cd: m.cd, ibge: m.cdi, nm: m.nm });
console.log(`${munis.length} municípios/zonas em ${cm.abr.length} abrangências`);

// horário de totalização por município (arquivo de acompanhamento de cada UF)
const when = new Map();
for (const ab of cm.abr) {
  const j = await getJSON(`dados/${ab.cd}/${ab.cd}-e006257-ab.json`);
  for (const a of j?.abr || []) if (a.tpabr === "mun") when.set(`${ab.cd}${a.cdabr}`, { t: iso(a.dt, a.ht), and: a.and, ts: num(a.s?.ts), st: num(a.s?.st) });
}
console.log(`horários de ${when.size} municípios`);

const rows = [];
let done = 0, miss = 0;
const queue = [...munis];
const worker = async () => {
  while (queue.length) {
    const m = queue.shift();
    let j = null;
    try {
      j = await getJSON(`dados/${m.uf}/${m.uf}${m.cd}-c0001-e006257-u.json`);
    } catch (e) {
      console.warn(`  falhou ${m.uf}${m.cd}: ${e.message}`);
    }
    if (!j) { miss++; continue; }
    const by = {};
    for (const a of j.carg[0].agr) for (const p of a.par) for (const d of p.cand) by[d.nmu] = +d.vap || 0;
    const pick = (rx) => Object.entries(by).filter(([k]) => rx.test(k)).reduce((s, [, v]) => s + v, 0);
    const F = pick(/FL[AÁ]VIO/i), L = pick(/^LULA$/i), cury = pick(/CURY/i), renan = pick(/RENAN/i), caiado = pick(/CAIADO/i), zema = pick(/ZEMA/i);
    const valid = num(j.v?.vvc), others = valid - F - L - cury - renan - caiado - zema;
    const w = when.get(`${m.uf}${m.cd}`) || {};
    rows.push([m.uf, m.cd, m.ibge, m.nm, num(j.e?.te), num(j.e?.c), valid, num(j.v?.vb), num(j.v?.tvn), F, L, cury, renan, caiado, zema, Math.max(0, others), w.t || iso(j.dt, j.ht), w.ts || num(j.s?.ts)]);
    if (++done % 500 === 0) console.log(`  ${done}/${munis.length}`);
  }
};
await Promise.all(Array.from({ length: 8 }, worker));
rows.sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
const out = {
  fonte: "TSE — resultados.tse.jus.br (eleição 6257, 1º turno de 2026, presidente)",
  gerado: new Date().toISOString(),
  cols: ["uf", "cd", "ibge", "nome", "eleitorado", "comparecimento", "validos", "brancos", "nulos", "flavio", "lula", "cury", "renan", "caiado", "zema", "outros", "totalizadoEm", "secoes"],
  rows,
};
fs.writeFileSync(OUT, JSON.stringify(out));
const tot = rows.reduce((s, r) => ({ F: s.F + r[9], L: s.L + r[10], V: s.V + r[6] }), { F: 0, L: 0, V: 0 });
console.log(`-> ${path.basename(OUT.pathname)}: ${rows.length} linhas (${miss} sem arquivo) · Flávio ${tot.F} (${((tot.F / tot.V) * 100).toFixed(2)}%) · Lula ${tot.L} (${((tot.L / tot.V) * 100).toFixed(2)}%)`);
