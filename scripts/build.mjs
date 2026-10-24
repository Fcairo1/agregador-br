// fetch + (ratings, best-effort) + aggregate
import { spawnSync } from "node:child_process";

const pass = process.argv.slice(2);
const run = (step) =>
  spawnSync(process.execPath, [new URL(step, import.meta.url).pathname, ...pass], { stdio: "inherit" }).status;

// Última busca de pesquisas: o dia da eleição (2º turno, 25/10/2026, horário de Brasília). Depois disso o fetch da
// Wikipédia (pesquisas e ratings) é pulado e o build segue só com os CSV já versionados + resultados oficiais do TSE.
const ULTIMO_DIA_PESQUISAS = "2026-10-25";
const hojeBRT = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const congelado = hojeBRT > ULTIMO_DIA_PESQUISAS && !process.env.FORCE_FETCH;

if (congelado) {
  console.log(`pesquisas congeladas (última busca em ${ULTIMO_DIA_PESQUISAS}; hoje é ${hojeBRT}) — pulando fetch/ratings`);
} else {
  if (run("fetch.mjs") !== 0) process.exit(1);
  // ratings histórico (2018/22): não deve derrubar o build se a Wikipédia falhar
  if (run("ratings.mjs") !== 0) console.warn("ratings.mjs falhou — usando ratings.json anterior (se houver)");
}

if (run("aggregate.mjs") !== 0) process.exit(1);

// resultados oficiais + pesquisa × resultado (best-effort; sem resultado ainda = pula)
run("results.mjs");

// eleitos (TSE) + "antes" (foto única, só refaz com --refresh); best-effort
run("antes.mjs");
run("eleitos.mjs");

// trava de sanidade: barra dado claramente errado antes de commitar/publicar
if (run("check.mjs") !== 0) process.exit(1);
