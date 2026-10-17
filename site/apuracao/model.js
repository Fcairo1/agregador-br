// Projeção do vencedor durante a apuração de um 2º turno (A × B). Isomórfico: roda no navegador e no Node (replay/testes).
//
// Ideia central: a ordem em que as urnas chegam NÃO é aleatória (estados e cidades transmitem em velocidades diferentes),
// então a % nacional parcial não serve de projeção. O modelo trabalha por MUNICÍPIO:
//
//   logit(p_m) = x_m·β + u_UF(m) + δ_região(m) + ε_m          p_m = parcela de A no par A/(A+B) do município m
//
//   x_m  = perfil eleitoral da localidade (covariáveis de uma eleição de referência: logit do par A/(A+B), peso dos
//          candidatos eliminados, …)
//   β    = ajustada (mínimos quadrados ponderados + ridge) nos municípios JÁ totalizados; o bootstrap por UF dá a incerteza
//   u_UF = efeito do estado, encolhido pro padrão nacional (regularização hierárquica; UF sem dado → N(0, τ²))
//   δ    = choque regional (correlação entre estados vizinhos); ε = ruído municipal
//
// Votos que faltam por UF = (válidos esperados) − (válidos já contados). O que falta entra na simulação (milhares de sorteios
// com incerteza de β, UF, região, município, comparecimento). A pesquisa só entra como PRIOR FRACO (peso decai com a apuração).
// Nada aqui é resultado oficial: é projeção estatística.

export const REGIAO = {
  ac: "N", am: "N", ap: "N", pa: "N", ro: "N", rr: "N", to: "N",
  al: "NE", ba: "NE", ce: "NE", ma: "NE", pb: "NE", pe: "NE", pi: "NE", rn: "NE", se: "NE",
  df: "CO", go: "CO", ms: "CO", mt: "CO",
  es: "SE", mg: "SE", rj: "SE", sp: "SE",
  pr: "S", rs: "S", sc: "S",
  zz: "EX",
};
export const REGIOES = ["N", "NE", "CO", "SE", "S"];
export const REGIAO_NOME = { N: "Norte", NE: "Nordeste", CO: "Centro-Oeste", SE: "Sudeste", S: "Sul", EX: "Exterior" };

// ---------- utilitários ----------
const sig = (x) => 1 / (1 + Math.exp(-x));
const logit = (p) => Math.log(p / (1 - p));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function rng(seed) {
  // mulberry32: determinístico (mesmo snapshot => mesma projeção; replay reproduzível)
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r) {
  // Box–Muller
  let u = 0;
  while (u === 0) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}
export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
const quantile = (sorted, q) => sorted[clamp(Math.floor(q * (sorted.length - 1)), 0, sorted.length - 1)];

// resolve (X'WX + Λ) β = X'Wy por eliminação gaussiana (k pequeno)
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    [M[i], M[p]] = [M[p], M[i]];
    const d = M[i][i] || 1e-12;
    for (let c = i; c <= n; c++) M[i][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = M[r][i];
      for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c];
    }
  }
  return M.map((row) => row[n]);
}
function wridge(X, y, w, ridge) {
  const k = X[0].length;
  const A = Array.from({ length: k }, () => new Array(k).fill(0));
  const b = new Array(k).fill(0);
  for (let i = 0; i < X.length; i++) {
    for (let a = 0; a < k; a++) {
      b[a] += w[i] * X[i][a] * y[i];
      for (let c = 0; c < k; c++) A[a][c] += w[i] * X[i][a] * X[i][c];
    }
  }
  const sw = w.reduce((s, v) => s + v, 0) || 1;
  for (let a = 1; a < k; a++) A[a][a] += ridge[a] * sw; // não penaliza o intercepto
  return solve(A, b);
}

// ---------- referência: perfil de cada município ----------
// ref: array de { key, uf, nome, elig, v1 (válidos da referência), z (logit A/(A+B) na referência), e (peso dos demais), z2? }
// A estrutura é montada por quem chama (replay.js / adapter.js) — o modelo não conhece candidatos nem endpoints.

/**
 * @param {object} snap  { t, munis: Map<key, {A,B,valid}>, ufs: Map<uf,{A,B,valid}>, status: Map<key,{final,st,ts}> }
 *                       munis = SÓ municípios finalizados com votos conhecidos; ufs = totais oficiais por UF (incluem parciais)
 * @param {object} ctx   { ref, features:[...], prior:{share,sd}|null, expectedRatio0, S, B, seed }
 */
export function project(snap, ctx) {
  const { ref, features = ["z"], prior = null, S = 2400, B = 120, selK = 0.18, ridgeZ = 0.02 } = ctx;
  const seed = ctx.seed ?? hashSeed(String(snap.t));
  const R = rng(seed);
  const byKey = new Map(ref.map((m, i) => [m.key, i]));
  const k = features.length + 1;
  const xOf = (m) => [1, ...features.map((f) => m[f] ?? 0)];

  // ----- município observado -----
  const obs = [];
  for (const [key, v] of snap.munis) {
    const i = byKey.get(key);
    if (i === undefined || v.A + v.B < 20) continue;
    const m = ref[i];
    obs.push({ i, uf: m.uf, x: xOf(m), y: logit((v.A + 0.5) / (v.A + v.B + 1)), w: Math.sqrt(v.A + v.B), V: v.valid || v.A + v.B, v1: m.v1 });
  }
  const obsSet = new Set(obs.map((o) => o.i));
  const ufsObs = [...new Set(obs.map((o) => o.uf))];

  // ----- totais observados (oficial) -----
  let Aobs = 0, Bobs = 0;
  const ufTot = new Map();
  for (const m of ref) if (!ufTot.has(m.uf)) ufTot.set(m.uf, { v1: 0, elig: 0 });
  for (const m of ref) {
    const t = ufTot.get(m.uf);
    t.v1 += m.v1;
    t.elig += m.elig;
  }
  const ufCount = new Map(); // votos válidos / A / B contados por UF (oficial; cai pra soma dos municípios finalizados)
  for (const uf of ufTot.keys()) ufCount.set(uf, { A: 0, B: 0, valid: 0 });
  for (const [uf, v] of snap.ufs || []) if (ufCount.has(uf)) ufCount.set(uf, { A: v.A, B: v.B, valid: v.valid ?? v.A + v.B });
  const fromMunis = new Map();
  for (const o of obs) {
    const f = fromMunis.get(o.uf) || { A: 0, B: 0, valid: 0 };
    const v = snap.munis.get(ref[o.i].key);
    f.A += v.A; f.B += v.B; f.valid += v.A + v.B;
    fromMunis.set(o.uf, f);
  }
  for (const [uf, f] of fromMunis) if (!(snap.ufs && snap.ufs.has(uf)) || ufCount.get(uf).valid < f.valid) ufCount.set(uf, f);
  for (const c of ufCount.values()) { Aobs += c.A; Bobs += c.B; }

  // ----- razão válidos(2T) / válidos(referência) observada, com encolhimento por UF -----
  const r0 = ctx.expectedRatio0 ?? 1;
  let sumV = 0, sumV1 = 0;
  const ufRat = new Map();
  for (const o of obs) {
    sumV += o.V; sumV1 += o.v1;
    const f = ufRat.get(o.uf) || { V: 0, v1: 0 };
    f.V += o.V; f.v1 += o.v1;
    ufRat.set(o.uf, f);
  }
  const rNat = sumV1 > 0 ? sumV / sumV1 : r0;
  const ratio = (uf) => {
    const f = ufRat.get(uf);
    if (!f) return rNat;
    const lam = clamp(f.v1 / (ufTot.get(uf).v1 * 0.5 + 1), 0, 1); // UF bem observada confia mais na própria razão
    return lam * (f.V / f.v1) + (1 - lam) * rNat;
  };

  // ----- ajuste β (+ bootstrap por UF) -----
  const nObs = obs.length;
  const countedValid = [...ufCount.values()].reduce((s, c) => s + c.valid, 0);
  const expectedValid = ref.reduce((s, m) => s + m.v1, 0) * rNat;
  const countedFrac = clamp(countedValid / Math.max(expectedValid, 1), 0, 1);
  const enough = nObs >= 40 && ufsObs.length >= 4;

  const ridge = [0, ...features.map((f) => (f === "z" || f === "z2" ? ridgeZ : 0.05))];
  const beta0 = [0, ...features.map((f) => (f === "z" || f === "z2" ? (features.filter((g) => g === "z" || g === "z2").length > 1 ? 0.5 : 1) : 0))];

  // prior (pesquisa): ajusta só o intercepto pra que a parcela nacional prevista bata com a pesquisa (peso decai rápido com a apuração)
  const natShareFor = (alpha, beta) => {
    let a = 0, t = 0;
    for (const m of ref) {
      const x = xOf(m);
      let eta = 0;
      for (let j = 1; j < k; j++) eta += beta[j] * x[j];
      const p = sig(alpha + eta);
      a += p * m.v1; t += m.v1;
    }
    return a / t;
  };
  let alphaPrior = 0;
  if (prior) {
    let lo = -3, hi = 3;
    for (let it = 0; it < 40; it++) {
      const mid = (lo + hi) / 2;
      if (natShareFor(mid, beta0) < prior.share) lo = mid; else hi = mid;
    }
    alphaPrior = (lo + hi) / 2;
  }
  const lambda = prior ? Math.exp(-countedFrac / 0.08) : 0; // peso do prior de pesquisa
  const alphaSD = prior ? (prior.sd ?? 0.03) / (prior.share * (1 - prior.share)) : 0;

  const fit = (rows) => {
    const X = rows.map((o) => o.x), y = rows.map((o) => o.y), w = rows.map((o) => o.w);
    const beta = wridge(X, y, w, ridge);
    // resíduos, ruído municipal e efeito de UF (encolhido)
    const res = rows.map((o, i) => o.y - X[i].reduce((s, v, j) => s + v * beta[j], 0));
    const sw = w.reduce((s, v) => s + v, 0);
    const sig2 = Math.max(0.03, rows.reduce((s, o, i) => s + w[i] * res[i] * res[i], 0) / sw);
    const g = new Map();
    rows.forEach((o, i) => {
      const e = g.get(o.uf) || { sw: 0, sr: 0, sw2: 0 };
      e.sw += w[i]; e.sr += w[i] * res[i]; e.sw2 += w[i] * w[i];
      g.set(o.uf, e);
    });
    const means = [...g.values()].map((e) => ({ m: e.sr / e.sw, neff: (e.sw * e.sw) / e.sw2 }));
    const bar = means.reduce((s, e) => s + e.m, 0) / (means.length || 1);
    const between = means.reduce((s, e) => s + (e.m - bar) ** 2, 0) / Math.max(1, means.length - 1);
    const noise = means.reduce((s, e) => s + sig2 / e.neff, 0) / (means.length || 1);
    const tau2 = clamp(between - noise, 0.01, 0.6);
    return { beta, sig2, tau2, g, bar };
  };
  const base = enough ? fit(obs) : { beta: beta0.slice(), sig2: 0.09, tau2: 0.05, g: new Map(), bar: 0 };
  if (!enough) base.beta[0] = alphaPrior;

  // réplicas bootstrap (reamostra UFs inteiras): incerteza de β que cresce quando há poucos estados observados
  const boots = [];
  const byUF = new Map();
  obs.forEach((o) => { (byUF.get(o.uf) || byUF.set(o.uf, []).get(o.uf)).push(o); });
  for (let b = 0; b < B; b++) {
    if (!enough) {
      const bt = base.beta.slice();
      bt[0] = alphaPrior + (prior ? alphaSD : 0.35) * gauss(R);
      for (let j = 1; j < k; j++) bt[j] += 0.15 * gauss(R);
      boots.push({ beta: bt, sig2: base.sig2, tau2: base.tau2 });
      continue;
    }
    const rows = [];
    for (let c = 0; c < ufsObs.length; c++) rows.push(...byUF.get(ufsObs[Math.floor(R() * ufsObs.length)]));
    const f = fit(rows);
    // mistura com o prior da pesquisa (decai com a apuração)
    if (prior && lambda > 0.002) f.beta[0] = lambda * (alphaPrior + alphaSD * gauss(R)) + (1 - lambda) * f.beta[0];
    boots.push(f);
  }
  if (prior && enough && lambda > 0.002) base.beta[0] = lambda * alphaPrior + (1 - lambda) * base.beta[0];

  // ----- municípios pendentes por UF -----
  const pend = new Map(); // uf -> { idx:[], eta0 per boot (computado depois), omega:[] }
  ref.forEach((m, i) => {
    if (obsSet.has(i)) return;
    const st = snap.status?.get(m.key);
    if (st?.final && snap.munis.has(m.key)) return;
    const e = pend.get(m.uf) || { idx: [], v1: 0 };
    e.idx.push(i); e.v1 += m.v1;
    pend.set(m.uf, e);
  });
  const ufList = [...pend.keys()];

  // remanescente esperado por UF
  const remUF = new Map();
  for (const uf of ufList) {
    const t = ufTot.get(uf);
    const Vhat = ratio(uf) * t.v1;
    const cnt = ufCount.get(uf)?.valid || 0;
    remUF.set(uf, Math.max(Vhat - cnt, 0));
  }
  // se a UF tem pendentes mas a conta sugere 0 restante, deixa uma fração mínima (urnas ainda por chegar)
  for (const uf of ufList) {
    const e = pend.get(uf), t = ufTot.get(uf);
    const minRem = 0.0025 * ratio(uf) * e.v1 * Math.min(1, e.idx.length / 3);
    if (remUF.get(uf) < minRem) remUF.set(uf, minRem);
    // nunca mais do que o esperado nos pendentes + folga de comparecimento
    const cap = ratio(uf) * e.v1 * 1.25 + 0.01 * t.v1;
    if (remUF.get(uf) > cap) remUF.set(uf, cap);
  }

  // η determinístico por réplica e UF
  const preEta = boots.map((bt) => {
    const per = new Map();
    for (const uf of ufList) {
      const e = pend.get(uf);
      const arr = new Float64Array(e.idx.length), om = new Float64Array(e.idx.length);
      e.idx.forEach((i, j) => {
        const x = xOf(ref[i]);
        let eta = 0;
        for (let q = 0; q < k; q++) eta += bt.beta[q] * x[q];
        arr[j] = eta;
        om[j] = ref[i].v1 / e.v1;
      });
      per.set(uf, { eta: arr, om });
    }
    return per;
  });
  // efeito de UF (condicional aos dados da própria UF) por réplica
  const uHat = boots.map((bt) => {
    const out = new Map();
    for (const uf of ufList) {
      const rows = byUF.get(uf);
      if (!rows) { out.set(uf, { m: 0, v: bt.tau2 }); continue; }
      let sw = 0, sr = 0, sw2 = 0;
      for (const o of rows) {
        const res = o.y - o.x.reduce((s, v, j) => s + v * bt.beta[j], 0);
        sw += o.w; sr += o.w * res; sw2 += o.w * o.w;
      }
      const neff = (sw * sw) / sw2, lam = bt.tau2 / (bt.tau2 + bt.sig2 / neff);
      out.set(uf, { m: lam * (sr / sw), v: lam * (bt.sig2 / neff) });
    }
    return out;
  });
  const sigmaR = 0.045, rhoR = 0.5;

  // ----- simulações -----
  const marg = new Float64Array(S), shareA = new Float64Array(S);
  let winA = 0;
  const ufMarg = new Map(ufList.map((u) => [u, new Float64Array(S)]));
  const regDraw = {};
  for (let s = 0; s < S; s++) {
    const b = s % B, bt = boots[b], pe = preEta[b], uh = uHat[b];
    for (const rg of [...REGIOES, "EX"]) regDraw[rg] = 0.6 * Math.sqrt(bt.tau2) * gauss(R);
    const zNat = gauss(R);
    // a ordem de chegada não é aleatória: o que já chegou pode diferir sistematicamente do que falta (cidades grandes, regiões lentas).
    // Choque nacional comum aos pendentes, que encolhe conforme a apuração avança (calibrado no replay do 1º turno).
    const selShock = selK * (1 - countedFrac) * gauss(R);
    let A = Aobs, Bv = Bobs;
    for (const uf of ufList) {
      const u = uh.get(uf);
      const uDraw = u.m + Math.sqrt(u.v) * gauss(R) + regDraw[REGIAO[uf] || "EX"] + selShock;
      const { eta, om } = pe.get(uf);
      let pbar = 0, v2 = 0;
      for (let j = 0; j < eta.length; j++) {
        const p = sig(eta[j] + uDraw);
        pbar += om[j] * p;
        v2 += om[j] * om[j] * (p * (1 - p)) ** 2 * bt.sig2; // ruído municipal agregado (independente entre municípios)
      }
      pbar = clamp(pbar + Math.sqrt(v2) * gauss(R), 0.005, 0.995);
      const zr = rhoR * zNat + Math.sqrt(1 - rhoR * rhoR) * gauss(R);
      const rem = remUF.get(uf) * Math.exp(sigmaR * zr);
      const mA = rem * pbar, mB = rem * (1 - pbar);
      A += mA; Bv += mB;
      ufMarg.get(uf)[s] = mA - mB;
    }
    marg[s] = A - Bv;
    shareA[s] = A / (A + Bv);
    if (A > Bv) winA++;
  }
  const sh = Array.from(shareA).sort((a, b) => a - b);
  const mg = Array.from(marg).sort((a, b) => a - b);
  const pA = winA / S;

  // incerteza por UF: desvio-padrão da margem remanescente (votos) e votos pendentes
  const incerteza = ufList
    .map((uf) => {
      const arr = ufMarg.get(uf);
      let m = 0;
      for (const v of arr) m += v;
      m /= S;
      let va = 0;
      for (const v of arr) va += (v - m) ** 2;
      return { uf, regiao: REGIAO[uf] || "EX", sd: Math.sqrt(va / S), pendentes: Math.round(remUF.get(uf)), margemEsperada: Math.round(m), municipiosPendentes: pend.get(uf).idx.length };
    })
    .sort((a, b) => b.sd - a.sd);

  // cobertura por região (válidos contados / esperados)
  const cobertura = {};
  for (const rg of REGIOES) {
    let c = 0, e = 0;
    for (const [uf, t] of ufTot) if (REGIAO[uf] === rg) { c += ufCount.get(uf)?.valid || 0; e += ratio(uf) * t.v1; }
    cobertura[rg] = e > 0 ? clamp(c / e, 0, 1) : 0;
  }

  // limite superior de votos que ainda podem entrar (eleitores nas seções não totalizadas): "matematicamente eleito"
  let maxRestante = 0;
  for (const uf of ufList) {
    for (const i of pend.get(uf).idx) {
      const m = ref[i], st = snap.status?.get(m.key);
      const frac = st && st.ts > 0 ? 1 - st.st / st.ts : 1;
      maxRestante += m.elig * clamp(frac, 0, 1);
    }
  }

  // cenários conservadores determinísticos (contra o líder): choque em todas as UFs pendentes + choque maior nas 2 maiores + mais votos
  const leaderIsA = pA >= 0.5; // quem a projeção dá como favorito
  const conservative = (shiftAll, shiftTop, scaleRem) => {
    const sorted = [...ufList].sort((a, b) => remUF.get(b) - remUF.get(a));
    const top = new Set(sorted.slice(0, 2));
    let A = Aobs, Bv = Bobs;
    for (const uf of ufList) {
      const { eta, om } = base_eta(uf);
      let pbar = 0;
      for (let j = 0; j < eta.length; j++) pbar += om[j] * sig(eta[j] + (uHatBase(uf)));
      const dir = leaderIsA ? -1 : 1; // desloca p contra o líder
      const shift = (shiftAll + (top.has(uf) ? shiftTop : 0)) * dir;
      pbar = clamp(pbar + shift, 0.005, 0.995);
      const rem = remUF.get(uf) * scaleRem;
      A += rem * pbar; Bv += rem * (1 - pbar);
    }
    return leaderIsA ? A - Bv : Bv - A; // margem do líder (>0 ainda vence)
  };
  // η/u centrais (ajuste base) pros cenários determinísticos
  const base_eta = (uf) => {
    const e = pend.get(uf);
    const eta = new Float64Array(e.idx.length), om = new Float64Array(e.idx.length);
    e.idx.forEach((i, j) => {
      const x = xOf(ref[i]);
      let v = 0;
      for (let q = 0; q < k; q++) v += base.beta[q] * x[q];
      eta[j] = v; om[j] = ref[i].v1 / e.v1;
    });
    return { eta, om };
  };
  const uHatBase = (uf) => {
    const rows = byUF.get(uf);
    if (!rows) return 0;
    let sw = 0, sr = 0, sw2 = 0;
    for (const o of rows) { const res = o.y - o.x.reduce((s, v, j) => s + v * base.beta[j], 0); sw += o.w; sr += o.w * res; sw2 += o.w * o.w; }
    const neff = (sw * sw) / sw2;
    return (base.tau2 / (base.tau2 + base.sig2 / neff)) * (sr / sw);
  };
  const stress = ufList.length
    ? { suave: conservative(0.02, 0.03, 1.1), forte: conservative(0.03, 0.08, 1.15) }
    : { suave: Aobs - Bobs, forte: Aobs - Bobs };
  if (!leaderIsA && !ufList.length) { stress.suave = Bobs - Aobs; stress.forte = Bobs - Aobs; }

  return {
    t: snap.t,
    A: Aobs, B: Bobs,
    pctA: Aobs + Bobs > 0 ? Aobs / (Aobs + Bobs) : null,
    contado: countedFrac, validosContados: countedValid, validosEsperados: Math.round(expectedValid),
    municipiosObservados: nObs, ufsObservadas: ufsObs.length, modeloAjustado: enough,
    probA: pA, probB: 1 - pA,
    parcelaA: { media: sh.reduce((s, v) => s + v, 0) / S, lo: quantile(sh, 0.05), hi: quantile(sh, 0.95), mediana: quantile(sh, 0.5) },
    margem: { mediana: quantile(mg, 0.5), lo: quantile(mg, 0.05), hi: quantile(mg, 0.95) },
    cobertura, incerteza, lambdaPesquisa: lambda,
    params: enough ? { beta: base.beta.map((v) => +v.toFixed(3)), sigma: +Math.sqrt(base.sig2).toFixed(3), tau: +Math.sqrt(base.tau2).toFixed(3) } : null,
    razaoValidos: rNat,
    maxRestante: Math.round(maxRestante),
    lider: leaderIsA ? "A" : "B",
    estresse: { suave: Math.round(stress.suave), forte: Math.round(stress.forte) },
    pendentes: Math.round([...remUF.values()].reduce((s, v) => s + v, 0)),
    matematico: Math.abs(Aobs - Bobs) > maxRestante && maxRestante >= 0 && Aobs + Bobs > 0 ? (Aobs > Bobs ? "A" : "B") : null,
  };
}

// ---------- classificação da chamada (máquina de estados com estabilidade) ----------
export const ESTADOS = {
  inicial: "Apuração inicial",
  aberto: "Resultado em aberto",
  favorito: "Favorito",
  forte: "Projeção forte",
  projetado: "Vencedor projetado",
  eleito: "Matematicamente eleito",
};

/**
 * Decide o estado de UM snapshot (sem histórico) e o candidato à frente na projeção.
 * `historico` = estados/probabilidades anteriores para exigir estabilidade nas chamadas fortes.
 */
export function classificar(pr, historico = [], cfg = {}) {
  const { minContado = 0.12, minRegiao = 0.05, minRegioesOk = 4, projContado = 0.35, projRegiao = 0.25, estavel = 3 } = cfg;
  const lead = pr.probA >= 0.5 ? "A" : "B";
  const p = Math.max(pr.probA, pr.probB);
  const regioesOk = REGIOES.filter((rg) => pr.cobertura[rg] >= minRegiao).length;
  if (pr.matematico) return { estado: "eleito", favorito: pr.matematico, prob: p, motivo: "A vantagem em votos supera todos os votos que ainda poderiam ser computados." };
  if (pr.contado < minContado || regioesOk < minRegioesOk || !pr.modeloAjustado)
    return { estado: "inicial", favorito: lead, prob: p, motivo: "Ainda há pouco voto contado e/ou poucas regiões representadas." };
  if (p <= 0.9) return { estado: "aberto", favorito: lead, prob: p, motivo: "Nenhum candidato passa de 90% de probabilidade." };
  if (p <= 0.99) return { estado: "favorito", favorito: lead, prob: p, motivo: "Probabilidade entre 90% e 99%." };
  if (p <= 0.995) return { estado: "forte", favorito: lead, prob: p, motivo: "Probabilidade entre 99% e 99,5%." };
  // > 99,5%: só chama se cumprir TODAS as salvaguardas
  const reg = REGIOES.every((rg) => pr.cobertura[rg] >= projRegiao);
  const cons = pr.estresse.suave > 0 && pr.estresse.forte > 0;
  const prev = historico.slice(-(estavel - 1));
  const estavelOk = prev.length >= estavel - 1 && prev.every((h) => h.favorito === lead && h.prob > 0.995 && h.estado !== "inicial" && h.estado !== "aberto" && h.estado !== "favorito");
  if (pr.contado >= projContado && reg && cons && (estavelOk || estavel <= 1))
    return { estado: "projetado", favorito: lead, prob: p, motivo: "Probabilidade acima de 99,5%, cobertura mínima em todas as regiões, vitória mantida nos cenários conservadores e estável nas últimas atualizações." };
  const falta = [!reg && "cobertura regional", !cons && "cenários conservadores", pr.contado < projContado && "cobertura total", !estavelOk && "estabilidade"].filter(Boolean).join(", ");
  return { estado: "forte", favorito: lead, prob: p, motivo: `Probabilidade acima de 99,5%, mas ainda falta: ${falta}.` };
}
