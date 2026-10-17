// "TSE falso" para testes: reproduz, no formato dos JSONs do TSE, a ordem real de totalização de um dataset (1º turno de 2026).
// Usado pelo teste de integração e por `node scripts/serve.mjs --mock-tse` (testar a interface ao vivo antes de 25/10).
const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st });
export const iso2 = (t) => new Date(t).toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" }).replace(" ", "T");
const dtht = (t) => { const [d, h] = iso2(t).split("T"); return { dt: `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`, ht: h }; };
const cand = (F, L) => ({ carg: [{ agr: [{ par: [{ cand: [{ nmu: "FLAVIO BOLSONARO", vap: String(F) }, { nmu: "LULA", vap: String(L) }, { nmu: "RENAN SANTOS", vap: "0" }] }] }] }] });

export function criarTseFalso(m26) {
  const S = { agora: 0, quebrado: false };
  const fim = (m) => m.t && Date.parse(m.t) <= S.agora;
  const resultado = (ms, todos = ms) => {
    const F = ms.reduce((s, m) => s + m.F, 0), L = ms.reduce((s, m) => s + m.L, 0);
    const st = ms.reduce((s, m) => s + m.secoes, 0), ts = todos.reduce((s, m) => s + m.secoes, 0);
    return { ...cand(F, L), v: { vvc: String(F + L) }, e: { te: String(todos.reduce((s, m) => s + m.elig, 0)) }, s: { ts: String(ts), st: String(st) }, ...dtht(S.agora), and: st === ts ? "f" : "p" };
  };
  const fetchFn = async (url) => {
    if (S.quebrado) throw new Error("rede indisponível (simulado)");
    const p = url.replace(/^\/tse\/\d+\//, "").replace(/\?.*$/, "");
    let m;
    if ((m = p.match(/^dados\/br\/br-c0001-e\d+-u\.json$/))) return J(resultado(m26.filter(fim), m26));
    if ((m = p.match(/^dados\/([a-z]{2})\/\1-c0001-e\d+-u\.json$/))) return J(resultado(m26.filter((x) => x.uf === m[1] && fim(x)), m26.filter((x) => x.uf === m[1])));
    if ((m = p.match(/^dados\/([a-z]{2})\/\1-e\d+-ab\.json$/)))
      return J({ abr: m26.filter((x) => x.uf === m[1]).map((x) => ({ and: fim(x) ? "f" : "n", tpabr: "mun", cdabr: x.cd, ...dtht(fim(x) ? Date.parse(x.t) : S.agora), s: { ts: String(x.secoes), st: String(fim(x) ? x.secoes : 0) }, e: { te: String(x.elig) } })) });
    if ((m = p.match(/^dados\/([a-z]{2})\/\1(\d{5})-c0001-e\d+-u\.json$/))) {
      const x = m26.find((y) => y.uf === m[1] && y.cd === m[2]);
      return x && fim(x) ? J({ ...cand(x.F, x.L), v: { vvc: String(x.F + x.L) }, tf: "s", and: "f" }) : J({}, 404);
    }
    return J({}, 404);
  };
  return { fetchFn, estado: S };
}
