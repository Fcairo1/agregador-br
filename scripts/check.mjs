// Sanity gate: roda depois do aggregate. Se algum JSON de corrida estiver claramente
// errado (ex.: contaminação com anos anteriores), sai com código != 0 — o que faz o
// build.mjs falhar, o workflow não commitar e o site não publicar dado ruim.
import fs from "node:fs";

const OUT = new URL("../site/data/", import.meta.url);
const idx = JSON.parse(fs.readFileSync(new URL("index.json", OUT), "utf8"));
const today = new Date();
const errs = [];

for (const { key } of idx) {
  let d;
  try {
    d = JSON.parse(fs.readFileSync(new URL(`${key}.json`, OUT), "utf8"));
  } catch (e) {
    errs.push(`${key}: JSON ilegível (${e.message})`);
    continue;
  }
  const [x0, x1] = d.xDomain || [];
  const y0 = +(x0 || "").slice(0, 4);
  const lastT = Date.parse((d.lastPoll || "") + "T00:00:00Z");

  if (d.nPolls > 600) errs.push(`${key}: ${d.nPolls} pesquisas (esperado < 600 — contaminação de anos anteriores?)`);
  if (d.nPolls < 3) errs.push(`${key}: só ${d.nPolls} pesquisas`);
  if (!(y0 >= 2025)) errs.push(`${key}: xDomain começa em ${x0} (esperado >= 2025)`);
  if (Number.isFinite(lastT) && lastT > today.getTime() + 8 * 86400000)
    errs.push(`${key}: lastPoll ${d.lastPoll} está no futuro`);
  if (!d.candidates?.length) errs.push(`${key}: sem candidatos`);
  for (const c of d.candidates || []) {
    const last = c.line?.at(-1);
    if (last && (last.y < 0 || last.y > 90)) errs.push(`${key}/${c.key}: valor final ${last.y}% fora de faixa`);
    if (last && x1 && last.t > x1) errs.push(`${key}/${c.key}: linha passa de xDomain`);
  }
}

if (errs.length) {
  console.error("\n✗ sanity check falhou:");
  for (const e of errs) console.error("  - " + e);
  process.exit(1);
}
console.log(`✓ sanity check ok (${idx.length} corridas)`);
