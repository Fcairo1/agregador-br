// Apuração oficial do TSE (JSON público que alimenta resultados.tse.jus.br).
// Padrão (achado no front do TSE): /oficial/<ciclo>/<eleicao>/dados/<uf>/<uf>-c<cargo4>-e<eleicao6>-u.json
// Presidente = eleição federal (6257), cargo 1, uf "br". Estadual (6259): 3 gov, 5 sen, 6 dep.fed, 7 dep.est.
const BASE = "https://resultados.tse.jus.br/oficial/ele2026";
export const ELE = { federal: "6257", estadual: "6259" };
export const CARGO = { presidente: 1, governador: 3, senador: 5, federal: 6, estadual: 7 };
export const UFS = "ac al am ap ba ce df es go ma mg ms mt pa pb pe pi pr rj rn ro rr rs sc se sp to".split(" ");

const pad = (n, w) => String(n).padStart(w, "0");
const f1 = (s) => parseFloat(String(s ?? "0").replace(",", "."));

export async function fetchUnified(uf, cargo) {
  const ele = cargo === CARGO.presidente ? ELE.federal : ELE.estadual;
  const url = `${BASE}/${ele}/dados/${uf}/${uf}-c${pad(cargo, 4)}-e${pad(ele, 6)}-u.json`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (agregador-br)" } });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) {
      if (i === 2) throw e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
}

// -> { final, andamento, updated, vagas, totals, cands:[{name,urna,party,number,votes,pct,elected,status,sq}] }
export function parseUnified(j, cargo) {
  if (!j) return null;
  const c = j.carg?.[0];
  if (!c) return null;
  const cands = [];
  const parties = new Map();
  for (const a of c.agr || []) {
    for (const p of a.par || []) {
      for (const d of p.cand || []) {
        const x = {
          name: d.nm,
          urna: d.nmu,
          party: p.sg,
          number: d.n,
          sq: d.sqcand,
          votes: +d.vap || 0,
          pct: f1(d.pvap),
          elected: d.e === "s",
          status: d.st || "",
          valid: d.dvt === "Válido",
        };
        cands.push(x);
      }
      const pe = parties.get(p.sg) || { party: p.sg, votes: 0, seats: 0 };
      pe.votes += +p.tvtn || 0;
      pe.seats += (p.cand || []).filter((d) => d.e === "s").length;
      parties.set(p.sg, pe);
    }
  }
  // PROJEÇÃO enquanto o TSE não fecha: o arquivo já traz as vagas de cada partido/federação (`vag`),
  // mas ainda não marca os candidatos eleitos. Pego os mais votados de cada um. Validado contra os
  // estados já fechados (RJ, ES, PR, SC, RS: 133 de 133 idênticos ao resultado oficial).
  let projected = false;
  if (!(j.tf === "s") && (cargo === CARGO.federal || cargo === CARGO.estadual) && !cands.some((x) => x.elected)) {
    const nv = +c.nv || 0;
    const seats = (c.agr || []).reduce((n, a) => n + (+a.vag || 0), 0);
    if (nv && seats === nv) {
      const bySq = new Map(cands.map((x) => [x.sq, x]));
      for (const a of c.agr) {
        const own = a.par.flatMap((p) => p.cand.map((d) => bySq.get(d.sqcand))).filter((x) => x && x.valid).sort((x, y) => y.votes - x.votes);
        own.slice(0, +a.vag || 0).forEach((x) => { x.elected = true; x.status = "Eleito (projeção)"; });
      }
      projected = true;
    }
  }
  // presidente sem ninguém acima de 50% dos válidos: os dois mais votados vão ao 2º turno (TSE só marca ao fechar)
  if (!(j.tf === "s") && cargo === CARGO.presidente && cands.length > 2 && !cands.some((x) => x.pct > 50)) {
    [...cands].sort((a, b) => b.votes - a.votes).slice(0, 2).forEach((x) => { if (!x.status) x.status = "2º turno (projeção)"; });
  }
  const E = j.e || {}, V = j.v || {};
  const totals = {
    inscritos: { votes: +E.te || 0 },
    comparecimento: { votes: +E.c || 0, pct: f1(E.pc) },
    abstencoes: { votes: +E.a || 0, pct: f1(E.pa) },
    valid: { votes: +V.vvc || 0, pct: f1(V.pvvc) },
    brancos: { votes: +V.vb || 0, pct: f1(V.pvb) },
    nulos: { votes: +V.tvn || 0, pct: f1(V.ptvn) },
  };
  return {
    totals,
    sectionsPct: f1(j.s?.pst),
    final: j.tf === "s",
    projected,
    andamento: j.and, // f = finalizado, p = em andamento
    updated: `${j.dt || j.dg} ${j.ht || j.hg}`,
    vagas: +c.nv || 0,
    cands,
    parties: [...parties.values()].sort((a, b) => b.seats - a.seats || b.votes - a.votes),
  };
}

export async function getCargo(uf, cargo) {
  return parseUnified(await fetchUnified(uf, cargo), cargo);
}
