// Modelo estado-espaço 1-D (nível local / passeio aleatório) com filtro de Kalman
// + suavizador RTS. Substitui o LOESS: a tendência e a faixa saem da posteriori.
// Determinístico (forma fechada, sem RNG). Ver CLAUDE.md.
//
// Estado:  x_t = x_{t-1} + η,  η ~ N(0, q · Δdias)   (q = variância de evolução/dia, p.p.²)
// Obs:     z_i = x_{t_i} + ε,  ε ~ N(0, r_i)          (r_i = erro amostral da pesquisa i)
//
// Vantagem sobre o LOESS: pesquisa antiga informa menos o "hoje" automaticamente
// (o estado pode ter andado), e a incerteza CRESCE nas bordas em vez de a linha voar.

const clampNum = (v, a, b) => Math.max(a, Math.min(b, v));

// variância amostral de uma proporção, em pontos percentuais²
function sampleVar(pct, n, designEffect) {
  const p = clampNum((pct || 20) / 100, 0.02, 0.98);
  const nn = n && n > 0 ? n : 1200;
  return designEffect * (p * (1 - p) / nn) * 1e4;
}

// polls: [{ x:int(dia), y:%, n, ratingW? }]  (já sem house effect)
// gridDays: [0,1,...,D]
// opts: { q, designEffect, z, floorHalf, initVar }
export function trendKalman(polls, gridDays, opts = {}) {
  const {
    q = 0.03, // sd ~0.17 p.p./dia
    designEffect = 1.6,
    z = 1.64, // faixa ~90%
    floorHalf = 0.5, // piso do meio-intervalo (p.p.)
    sysHalf = 1.1, // erro sistemático do setor (todo mundo erra junto) — some em quadratura
    initVar = 30,
    maxGapDays = 45, // sem pesquisa nesse raio -> linha some
  } = opts;

  const D = gridDays.length;
  if (!polls.length || D === 0) return { line: new Array(D).fill(null), band: new Array(D).fill(null) };

  // observações agrupadas por dia (precisão-ponderadas quando há várias no mesmo dia)
  const obsByDay = new Map();
  for (const p of polls) {
    let r = sampleVar(p.y, p.n, designEffect);
    if (p.ratingW && p.ratingW > 0) r /= p.ratingW * p.ratingW; // casa melhor pesa mais
    const prec = 1 / r;
    const cur = obsByDay.get(p.x) || { sPrec: 0, sPrecY: 0 };
    cur.sPrec += prec;
    cur.sPrecY += prec * p.y;
    obsByDay.set(p.x, cur);
  }
  const obs = new Map(); // dia -> { z, r }
  for (const [d, o] of obsByDay) obs.set(d, { z: o.sPrecY / o.sPrec, r: 1 / o.sPrec });

  const days = [...obs.keys()].sort((a, b) => a - b);
  const firstDay = days[0];
  const lastDay = days[days.length - 1];

  // --- filtro para frente sobre a grade diária ---
  const xF = new Array(D);
  const PF = new Array(D);
  const xP = new Array(D);
  const PP = new Array(D);
  let x = obs.get(firstDay).z;
  let P = initVar;
  for (let t = 0; t < D; t++) {
    // predição (passo de 1 dia; grade é diária)
    const step = t === 0 ? 1 : gridDays[t] - gridDays[t - 1];
    xP[t] = x;
    PP[t] = P + q * step;
    x = xP[t];
    P = PP[t];
    // atualização
    const o = obs.get(gridDays[t]);
    if (o) {
      const K = P / (P + o.r);
      x = x + K * (o.z - x);
      P = (1 - K) * P;
    }
    xF[t] = x;
    PF[t] = P;
  }

  // --- suavizador RTS para trás ---
  const xS = new Array(D);
  const PS = new Array(D);
  xS[D - 1] = xF[D - 1];
  PS[D - 1] = PF[D - 1];
  for (let t = D - 2; t >= 0; t--) {
    const C = PF[t] / PP[t + 1];
    xS[t] = xF[t] + C * (xS[t + 1] - xP[t + 1]);
    PS[t] = PF[t] + C * C * (PS[t + 1] - PP[t + 1]);
  }

  // --- saída ---
  const line = new Array(D).fill(null);
  const band = new Array(D).fill(null);
  const xs = polls.map((p) => p.x);
  for (let t = 0; t < D; t++) {
    const gd = gridDays[t];
    if (gd < firstDay - 3 || gd > lastDay + 3) continue; // não extrapola além dos dados
    let near = false;
    for (const px of xs) if (Math.abs(px - gd) <= maxGapDays) { near = true; break; }
    if (!near) continue;
    const m = clampNum(xS[t], 0, 100);
    const half = Math.max(floorHalf, z * Math.sqrt(Math.max(PS[t], 0) + sysHalf * sysHalf));
    line[t] = m;
    band[t] = { lo: Math.max(0, m - half), hi: Math.min(100, m + half) };
  }
  return { line, band };
}
