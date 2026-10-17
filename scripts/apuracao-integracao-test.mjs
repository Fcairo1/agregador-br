// Teste de integração do MODO AO VIVO sem depender do 2º turno: um "TSE falso" reproduz a ordem real de totalização do 1º turno
// de 2026 (arquivos no formato do TSE: -ab, -u de UF, nacional e município) e o motor (adapter -> modelo -> chamada) roda ciclo a ciclo.
// Também simula indisponibilidade da fonte no meio do caminho.
import fs from "node:fs";
import { MotorAoVivo } from "../site/apuracao/motor.js";
import { TseClient } from "../site/apuracao/adapter.js";
import { parse26, parse22, makeRef } from "../site/apuracao/replay.js";
import { criarTseFalso } from "./lib/tse-mock.mjs";

const D = new URL("../site/apuracao/dados/", import.meta.url);
const m26 = parse26(JSON.parse(fs.readFileSync(new URL("mun-1t-2026.json", D), "utf8")));
const m22 = parse22(JSON.parse(fs.readFileSync(new URL("mun-2022.json", D), "utf8")));
const ref = makeRef(m26, m22, "replay-1t");
const est = JSON.parse(fs.readFileSync(new URL("../../../data/estimativas.json", D), "utf8")).presidente.candidates;
const prior = { share: est.flavio.est / (est.flavio.est + est.lula.est), sd: 0.03 };

const { fetchFn, estado: F } = criarTseFalso(m26);
const iso2 = (t) => new Date(t).toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).replace(" ", "T");

const client = new TseClient({ ele: "6257", base: "/tse", fetchFn, maxParalelo: 12, log: () => {} });
const store = new Map();
const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
const out = [];
const motor = new MotorAoVivo({ ref, prior, client, S: 700, storage, features: ["z"], ratio0: 0.93, onUpdate: (u) => out.push(u), onErro: (e) => out.push({ erro: e.message }) });

const t0 = Date.parse(m26.filter((m) => m.t).map((m) => m.t).sort()[0]);
const passos = ["2026-10-04T18:20:00-03:00", "2026-10-04T19:30:00-03:00", "FALHA", "2026-10-04T20:30:00-03:00", "2026-10-04T21:30:00-03:00", "2026-10-04T22:30:00-03:00", "2026-10-05T09:30:00-03:00"];
let bad = false;
for (const p of passos) {
  F.quebrado = p === "FALHA";
  if (!F.quebrado) F.agora = Date.parse(p);
  await motor.ciclo();
  const u = out.at(-1);
  if (u.erro) { console.log(`  [${p}] fonte indisponível (${u.erro}) -> último estado mantido: ${motor.ultimoOk ? motor.ultimoOk.cl.estado : "nenhum"}`); if (!motor.ultimoOk) bad = true; continue; }
  const r = u.resumo;
  console.log(`  ${iso2(F.agora).slice(11, 16)}  contado ${(r.contado * 100).toFixed(0).padStart(3)}%  oficial ${(r.A / (r.A + r.B) * 100).toFixed(1)}%  P(Flávio) ${(r.probA * 100).toFixed(1).padStart(5)}%  projeção ${(r.parcelaA[1] * 100).toFixed(1)}%  ${u.chamada.estado}  (municípios no modelo: ${r.mun}, requisições: ${client.requisicoes})`);
}
const hist = motor.historico;
console.log(`histórico guardado: ${hist.length} atualizações · persistido: ${JSON.parse(store.get("apuracao:2026-2t:snapshots")).length}`);
const final = hist.at(-1);
const ok = !bad && hist.length >= 5 && final.favorito === "A" && final.prob > 0.99;
console.log(ok ? "✓ integração ok" : "✗ integração falhou");
process.exit(ok ? 0 : 1);
