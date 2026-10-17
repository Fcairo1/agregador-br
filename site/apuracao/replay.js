// Montagem da "referência" (perfil eleitoral por município) e do REPLAY de uma apuração histórica.
// Isomórfico (navegador/Node). Os dados estáticos vêm de site/apuracao/dados/*.json (gerados por scripts/apuracao-*.mjs).
import { project, classificar } from "./model.js";

const logit = (p) => Math.log(p / (1 - p));
const smoothShare = (a, b) => (a + 0.5) / (a + b + 1);
export const keyOf = (uf, cd) => `${uf}${cd}`;

const cols = (d) => Object.fromEntries(d.cols.map((c, i) => [c, i]));
export function parse26(d) {
  const c = cols(d);
  return d.rows.map((r) => ({
    key: keyOf(r[c.uf], r[c.cd]), uf: r[c.uf], cd: r[c.cd], nome: r[c.nome], elig: r[c.eleitorado], comp: r[c.comparecimento], valid: r[c.validos],
    F: r[c.flavio], L: r[c.lula], outros: r[c.cury] + r[c.renan] + r[c.caiado] + r[c.zema] + r[c.outros],
    t: r[c.totalizadoEm], secoes: r[c.secoes],
  }));
}
export function parse22(d) {
  const c = cols(d), out = new Map();
  for (const r of d.rows) if (r[c.turno] === 2) out.set(keyOf(r[c.uf], r[c.cd]), { L: r[c.lula], B: r[c.bolsonaro] });
  return out;
}

/**
 * Referência por município.
 *  modo "ao-vivo": referência = 1º turno de 2026 (+ 2022 2T como 2ª covariável)         — usado no 2º turno de 2026
 *  modo "replay-1t": referência = 2º turno de 2022 (o alvo é o 1º turno de 2026 como par Flávio/(Flávio+Lula))
 */
export function makeRef(m26, m22, modo) {
  const ref = [];
  let eSum = 0, vSum = 0;
  for (const m of m26) {
    const r22 = m22.get(m.key);
    if (modo === "replay-1t") {
      if (!r22 || r22.L + r22.B < 20) continue;
      ref.push({ key: m.key, uf: m.uf, nome: m.nome, elig: m.elig, v1: r22.L + r22.B, z: logit(smoothShare(r22.B, r22.L)) });
    } else {
      if (m.F + m.L < 1 && m.valid < 1) { ref.push({ key: m.key, uf: m.uf, nome: m.nome, elig: m.elig, v1: 0, z: 0, z2: 0, e: 0 }); continue; }
      const e = m.valid > 0 ? m.outros / m.valid : 0;
      eSum += e * m.valid; vSum += m.valid;
      ref.push({ key: m.key, uf: m.uf, nome: m.nome, elig: m.elig, v1: m.F + m.L + m.outros, z: logit(smoothShare(m.F, m.L)), z2: r22 ? logit(smoothShare(r22.B, r22.L)) : 0, e });
    }
  }
  if (modo !== "replay-1t") {
    const eBar = eSum / (vSum || 1);
    for (const r of ref) r.e = r.v1 > 0 ? r.e - eBar : 0; // centrado: o intercepto continua sendo "município médio"
  }
  return ref;
}

/** Instantes de corte do replay (ISO). Passo curto no começo (ordem de chegada é o que importa), longo na cauda. */
export function instantes(m26, { passoMin = 10, ate = 0.997 } = {}) {
  const ts = m26.filter((m) => m.t).map((m) => Date.parse(m.t)).sort((a, b) => a - b);
  const total = m26.reduce((s, m) => s + m.valid, 0);
  const sorted = m26.filter((m) => m.t).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  let cum = 0, tFim = ts[ts.length - 1];
  for (const m of sorted) { cum += m.valid; if (cum / total >= ate) { tFim = Date.parse(m.t); break; } }
  const out = [];
  for (let t = Math.ceil(ts[0] / 60000 / passoMin) * passoMin * 60000; t <= tFim; t += passoMin * 60000) out.push(t);
  out.push(tFim + passoMin * 60000); // fecha com ~99,7% contado (a cauda de 10 h com poucos municípios deformaria o gráfico)
  return [...new Set(out)];
}

/** Snapshot (formato do modelo) no instante t: só municípios cuja totalização já aconteceu. */
export function snapshotEm(m26, t, modo) {
  const munis = new Map(), status = new Map();
  for (const m of m26) {
    const done = m.t && Date.parse(m.t) <= t;
    status.set(m.key, { final: !!done, st: done ? m.secoes : 0, ts: m.secoes });
    if (done) munis.set(m.key, { A: m.F, B: m.L, valid: m.F + m.L });
  }
  return { t: new Date(t).toISOString(), munis, status, ufs: new Map() };
}

/** Roda o replay inteiro e devolve linha do tempo + métricas de validação. */
export function rodarReplay({ m26, m22, prior, S = 1500, B = 100, passoMin = 10, onProgress, modelo = {} }) {
  const ref = makeRef(m26, m22, "replay-1t");
  const ts = instantes(m26, { passoMin });
  const finalA = m26.reduce((s, m) => s + m.F, 0), finalB = m26.reduce((s, m) => s + m.L, 0);
  const vencedor = finalA > finalB ? "A" : "B";
  const linha = [], hist = [];
  ts.forEach((t, i) => {
    const snap = snapshotEm(m26, t, "replay-1t");
    const pr = project(snap, { ref, features: ["z"], prior, S, B, expectedRatio0: 0.93, ...modelo });
    const cl = classificar(pr, hist);
    hist.push({ estado: cl.estado, favorito: cl.favorito, prob: cl.prob });
    linha.push({
      t: pr.t, pctA: pr.pctA, contado: pr.contado, probA: pr.probA, estado: cl.estado, favorito: cl.favorito,
      parcelaA: [pr.parcelaA.lo, pr.parcelaA.media, pr.parcelaA.hi], margem: [pr.margem.lo, pr.margem.mediana, pr.margem.hi],
      cobertura: pr.cobertura, topIncerteza: pr.incerteza.slice(0, 5), pendentes: pr.pendentes, ufs: pr.ufsObservadas, mun: pr.municipiosObservados,
      A: pr.A, B: pr.B,
    });
    onProgress?.(i + 1, ts.length);
  });
  // métricas
  const first = (estado) => linha.find((l) => l.estado === estado);
  const chamadas = linha.filter((l) => l.estado === "projetado" || l.estado === "eleito");
  const erradas = chamadas.filter((l) => l.favorito !== vencedor);
  const pri = chamadas[0] || null;
  const reversoes = chamadas.length ? linha.slice(linha.indexOf(chamadas[0])).filter((l) => l.estado === "projetado" || l.estado === "eleito").some((l) => l.favorito !== chamadas[0].favorito) : false;
  const ultimo = linha[linha.length - 1];
  const fin = finalA / (finalA + finalB);
  const naive = linha.filter((l) => l.contado > 0.1).map((l) => Math.abs(l.pctA - fin));
  const proj = linha.filter((l) => l.contado > 0.1).map((l) => Math.abs(l.parcelaA[1] - fin));
  const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
  return {
    linha,
    metricas: {
      vencedorReal: vencedor, parcelaFinalA: fin,
      primeiraProjecao: pri && { t: pri.t, contado: pri.contado, prob: Math.max(pri.probA, 1 - pri.probA), estado: pri.estado, favorito: pri.favorito },
      primeiroFavorito: first("favorito") && { t: first("favorito").t, contado: first("favorito").contado, prob: Math.max(first("favorito").probA, 1 - first("favorito").probA) },
      chamadasErradas: erradas.length, reversoes, chamadaPrematuraGrave: erradas.length > 0 || reversoes,
      erroFinal: ultimo.parcelaA[1] - fin,
      erroMedioProjecao: mean(proj), erroMedioIngenuo: mean(naive),
      cobertura90: linha.filter((l) => l.contado > 0.1).filter((l) => fin >= l.parcelaA[0] && fin <= l.parcelaA[2]).length / (linha.filter((l) => l.contado > 0.1).length || 1),
    },
  };
}
