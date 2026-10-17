// Validação do modelo de projeção: replay minuto a minuto (passo configurável) do 1º turno de 2026, tratado como disputa
// Flávio × Lula (par Flávio/(Flávio+Lula)), com referência = 2º turno de 2022. Grava site/apuracao/dados/replay-1t-2026.json.
// Uso: node scripts/apuracao-test.mjs [passoMin=10] [S=1500]
import fs from "node:fs";
import { parse26, parse22, rodarReplay } from "../site/apuracao/replay.js";

const D = new URL("../site/apuracao/dados/", import.meta.url);
const m26 = parse26(JSON.parse(fs.readFileSync(new URL("mun-1t-2026.json", D), "utf8")));
const m22 = parse22(JSON.parse(fs.readFileSync(new URL("mun-2022.json", D), "utf8")));
const est = JSON.parse(fs.readFileSync(new URL("../../../data/estimativas.json", D), "utf8")).presidente.candidates;
// prior de pesquisa: a tendência final do agregador na véspera, no par Flávio/(Flávio+Lula) (estimativa congelada)
const prior = { share: est.flavio.est / (est.flavio.est + est.lula.est), sd: 0.03 };
const passoMin = +(process.argv[2] || 10), S = +(process.argv[3] || 1500);
const t0 = Date.now();
const { linha, metricas } = rodarReplay({ m26, m22, prior, S, passoMin, onProgress: (i, n) => i % 10 === 0 && console.log(`  ${i}/${n}`) });
const hhmm = (iso) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", hour: "2-digit", minute: "2-digit" });
console.log(`\nreplay: ${linha.length} instantes em ${((Date.now() - t0) / 1000).toFixed(1)}s | prior de pesquisa: Flávio ${(prior.share * 100).toFixed(1)}% do par`);
console.log("  hora   contado  oficial  P(Flávio)  projeção [90%]            estado");
for (const l of linha.filter((_, i) => i % 3 === 0 || i === linha.length - 1)) {
  console.log(`  ${hhmm(l.t)}  ${(l.contado * 100).toFixed(0).padStart(3)}%   ${(l.pctA * 100).toFixed(1)}%   ${(l.probA * 100).toFixed(1).padStart(5)}%    ${(l.parcelaA[1] * 100).toFixed(1)}% [${(l.parcelaA[0] * 100).toFixed(1)}–${(l.parcelaA[2] * 100).toFixed(1)}]   ${l.estado}`);
}
console.log("\nmétricas:", JSON.stringify(metricas, null, 1));
fs.writeFileSync(new URL("replay-1t-2026.json", D), JSON.stringify({ gerado: new Date().toISOString(), passoMin, S, prior, ...{ linha, metricas } }));
const bad = metricas.chamadaPrematuraGrave;
console.log(bad ? "\n✗ FALHA GRAVE: chamada errada/revertida" : "\n✓ nenhuma chamada errada ou revertida");
process.exit(bad ? 1 : 0);
