// Teste do adaptador + proxy contra os arquivos REAIS do TSE (1º turno, já finalizado): confere se a normalização bate
// com o total oficial e com o dataset estático. Não depende do formato do 2º turno (que só existe a partir de 25/10).
import { tseProxy } from "../worker/proxy.js";
import { TseClient } from "../site/apuracao/adapter.js";
import { CONFIG } from "../site/apuracao/config.js";

const fetchFn = async (url) => tseProxy(new Request("http://localhost" + url), { cache: null });
const cli = new TseClient({ ele: "6257", base: "/tse", fetchFn, maxParalelo: 8, log: (n, m) => console.log(`  [${n}] ${m}`) });
const t0 = Date.now();
const snap = await cli.snapshot({ maxMunicipios: 400 });
console.log(`snapshot em ${((Date.now() - t0) / 1000).toFixed(1)}s · ${cli.requisicoes} requisições`);
console.log(`  nacional: ${CONFIG.A.curto} ${snap.nacional.A} × ${CONFIG.B.curto} ${snap.nacional.B} | válidos ${snap.nacional.valid} | seções ${snap.nacional.secoesTotalizadas}/${snap.nacional.secoes} | horário ${snap.nacional.t}`);
console.log(`  UFs: ${snap.ufs.size} · status de municípios: ${snap.status.size} (${[...snap.status.values()].filter((s) => s.final).length} finalizados) · votos de municípios em cache: ${snap.munis.size} · faltam buscar: ${snap.pendentesDeBusca}`);
const somaUF = [...snap.ufs.values()].reduce((s, u) => ({ A: s.A + u.A, B: s.B + u.B }), { A: 0, B: 0 });
const ok = somaUF.A === snap.nacional.A && somaUF.B === snap.nacional.B;
console.log(`  soma das UFs == nacional? ${ok ? "sim ✓" : `NÃO (${somaUF.A}/${somaUF.B})`}`);
// segunda chamada: deve vir do cache do proxy (requisições ao TSE ~0)
const t1 = Date.now();
await cli.snapshot({ maxMunicipios: 0 });
console.log(`  2º ciclo (cache do proxy): ${((Date.now() - t1) / 1000).toFixed(1)}s`);
process.exit(ok ? 0 : 1);
