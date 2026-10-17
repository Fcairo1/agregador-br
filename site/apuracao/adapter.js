// Camada própria de adaptação dos dados do TSE: o modelo e a interface só enxergam o formato normalizado abaixo,
// nunca o JSON bruto. Se o TSE mudar o esquema, só este arquivo muda.
//
// Endpoints oficiais usados (portal resultados.tse.jus.br; mesmo JSON que o site deles consome):
//   <base>/<eleição>/dados/br/br-c0001-e00<eleição>-u.json            nacional  (candidatos, votos, urnas, eleitorado)
//   <base>/<eleição>/dados/<uf>/<uf>-c0001-e00<eleição>-u.json        por UF (+ "zz" = exterior)
//   <base>/<eleição>/dados/<uf>/<uf>-e00<eleição>-ab.json             acompanhamento: situação/horário/seções de cada município
//   <base>/<eleição>/dados/<uf>/<uf><cod>-c0001-e00<eleição>-u.json   município (candidatos e votos)
// Campos: carg[0].agr[].par[].cand[]{nmu,vap} · v{vvc,vb,tvn} · e{te,c,a} · s{ts,st} · and ("f" finalizado / "p" parcial) · dt/ht (horário, Brasília)
import { CONFIG } from "./config.js";

const num = (s) => +String(s ?? "0").replace(",", ".") || 0;
export const keyOf = (uf, cd) => `${uf}${cd}`;
const iso = (d, h) => (d && h ? `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}T${h}-03:00` : null);

/** votos dos candidatos A e B + totais a partir de qualquer arquivo "-u.json" (nacional, UF ou município). */
export function normalizarResultado(j, cfg = CONFIG) {
  if (!j || !j.carg || !j.carg[0]) return null;
  let A = 0, B = 0, outros = 0;
  for (const a of j.carg[0].agr || []) for (const p of a.par || []) for (const d of p.cand || []) {
    const v = num(d.vap);
    if (cfg.A.re.test(d.nmu || "")) A += v;
    else if (cfg.B.re.test(d.nmu || "")) B += v;
    else outros += v;
  }
  return {
    A, B, outros, valid: num(j.v?.vvc) || A + B + outros, brancos: num(j.v?.vb), nulos: num(j.v?.tvn),
    elig: num(j.e?.te), comparecimento: num(j.e?.c), abstencoes: num(j.e?.a),
    secoes: num(j.s?.ts), secoesTotalizadas: num(j.s?.st),
    final: j.tf === "s" || j.and === "f", andamento: j.and || null, t: iso(j.dt, j.ht), geradoEm: iso(j.dg, j.hg),
  };
}

/** situação por município a partir do "-ab.json" de uma UF. */
export function normalizarAcompanhamento(j, uf) {
  const out = [];
  for (const a of j?.abr || []) {
    if (a.tpabr !== "mun") continue;
    out.push({ key: keyOf(uf, a.cdabr), cd: a.cdabr, uf, final: a.and === "f", ts: num(a.s?.ts), st: num(a.s?.st), t: iso(a.dt, a.ht), elig: num(a.e?.te) });
  }
  return out;
}

export class TseClient {
  constructor({ ele = CONFIG.ele[2], base = CONFIG.proxy, fetchFn = (...a) => fetch(...a), log = () => {}, maxParalelo = CONFIG.maxParalelo, cfg = CONFIG } = {}) {
    Object.assign(this, { ele, base, fetchFn, log, maxParalelo, cfg });
    this.munCache = new Map(); // município finalizado => resultado (imutável: não rebaixa)
    this.ultimo = null; // último snapshot válido
    this.falhas = 0;
    this.requisicoes = 0;
  }
  url(rel, longo = false) { return `${this.base}/${this.ele}/${rel}${longo ? "?f=1" : ""}`; }
  async get(rel, { longo = false, tentativas = 3 } = {}) {
    for (let i = 0; i < tentativas; i++) {
      try {
        this.requisicoes++;
        const r = await this.fetchFn(this.url(rel, longo), { cache: "no-store" });
        if (r.status === 404) return null;
        if (!r.ok) throw new Error("HTTP " + r.status);
        return await r.json();
      } catch (e) {
        if (i === tentativas - 1) throw e;
        const espera = 800 * 2 ** i + Math.random() * 400; // backoff exponencial com jitter
        this.log("warn", `TSE ${rel}: ${e.message} — nova tentativa em ${Math.round(espera)} ms`);
        await new Promise((res) => setTimeout(res, espera));
      }
    }
  }
  async pool(tarefas, n = this.maxParalelo) {
    const out = new Array(tarefas.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, tarefas.length) }, async () => {
      while (i < tarefas.length) { const k = i++; try { out[k] = await tarefas[k](); } catch (e) { out[k] = { erro: e.message }; } }
    }));
    return out;
  }

  /** Um ciclo de atualização: nacional + 28 UFs (resultado e acompanhamento) + municípios recém-finalizados (limitado por ciclo). */
  async snapshot({ maxMunicipios = 1500 } = {}) {
    const c = this.cfg.cargo, e = this.ele;
    const nacional = normalizarResultado(await this.get(`dados/br/br-${c}-e00${e}-u.json`), this.cfg);
    if (!nacional) throw new Error("arquivo nacional ainda não publicado");
    const ufs = new Map(), status = new Map(), faltaFinal = [];
    const tarefas = this.cfg.ufs.flatMap((uf) => [
      async () => ({ uf, r: normalizarResultado(await this.get(`dados/${uf}/${uf}-${c}-e00${e}-u.json`), this.cfg) }),
      async () => ({ uf, ab: normalizarAcompanhamento(await this.get(`dados/${uf}/${uf}-e00${e}-ab.json`), uf) }),
    ]);
    for (const x of await this.pool(tarefas)) {
      if (!x || x.erro) continue;
      if (x.r) ufs.set(x.uf, { A: x.r.A, B: x.r.B, valid: x.r.A + x.r.B, secoes: x.r.secoes, secoesTotalizadas: x.r.secoesTotalizadas });
      for (const m of x.ab || []) {
        status.set(m.key, { final: m.final, st: m.st, ts: m.ts, t: m.t, elig: m.elig });
        if (m.final && !this.munCache.has(m.key)) faltaFinal.push(m);
      }
    }
    // municípios finalizados que ainda não temos (imutáveis => cache longo no proxy)
    const lote = faltaFinal.slice(0, maxMunicipios);
    await this.pool(lote.map((m) => async () => {
      const r = normalizarResultado(await this.get(`dados/${m.uf}/${m.uf}${m.cd}-${c}-e00${e}-u.json`, { longo: true }), this.cfg);
      if (r && r.final) this.munCache.set(m.key, { A: r.A, B: r.B, valid: r.A + r.B });
    }));
    const munis = new Map();
    for (const [k, v] of this.munCache) if (status.get(k)?.final !== false) munis.set(k, v);
    const snap = { t: nacional.t || nacional.geradoEm || new Date().toISOString(), buscadoEm: new Date().toISOString(), munis, ufs, status, nacional, pendentesDeBusca: faltaFinal.length - lote.length };
    this.ultimo = snap;
    this.falhas = 0;
    return snap;
  }
}
