// LOESS ponderado (grau 1, kernel tricúbico) + faixa por bootstrap.
// Determinístico via PRNG com seed. Ver CLAUDE.md.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clampNum = (x, a, b) => Math.max(a, Math.min(b, x));

function tricube(u) {
  const a = 1 - u * u * u;
  return a > 0 ? a * a * a : 0;
}

// regressão linear ponderada: y ~ a + b x  ; devolve valor previsto em x0
function wlinAt(pts, w, x0) {
  let sw = 0, swx = 0, swy = 0, swxx = 0, swxy = 0;
  for (let i = 0; i < pts.length; i++) {
    const wi = w[i];
    if (wi <= 0) continue;
    const x = pts[i].x, y = pts[i].y;
    sw += wi; swx += wi * x; swy += wi * y; swxx += wi * x * x; swxy += wi * x * y;
  }
  if (sw <= 0) return null;
  const denom = sw * swxx - swx * swx;
  if (Math.abs(denom) < 1e-9) return swy / sw; // sem espalhamento em x -> média ponderada
  const b = (sw * swxy - swx * swy) / denom;
  const a = (swy - b * swx) / sw;
  return a + b * x0;
}

// pts: [{x, y, base}]  (base = peso recência*amostra).  grid: [x...]
// devolve [y|null] no grid
export function loess(pts, grid, { span = 0.35, minPts = 6, minBandwidthX = 14, maxGapX = 30 } = {}) {
  const n = pts.length;
  const k = Math.max(minPts, Math.ceil(span * n));
  const xs = pts.map((p) => p.x);
  return grid.map((x0) => {
    // exige dado dos DOIS lados do ponto (senão vira extrapolação linear -> pico falso)
    let near = 0, left = 0, right = 0;
    for (const x of xs) {
      const dd = x - x0;
      if (Math.abs(dd) <= maxGapX) {
        near++;
        if (dd <= 2) left++;
        if (dd >= -2) right++;
      }
    }
    if (near < 2 || left < 1 || right < 1) return null;

    const d = xs.map((x) => Math.abs(x - x0)).sort((p, q) => p - q);
    let h = d[Math.min(k, n) - 1];
    if (!(h > 0) || h < minBandwidthX) h = Math.max(minBandwidthX, d[Math.min(k, n) - 1] || minBandwidthX);

    const w = new Array(n);
    for (let i = 0; i < n; i++) w[i] = tricube(Math.abs(xs[i] - x0) / h) * pts[i].base;
    const y = wlinAt(pts, w, x0);
    if (y == null) return null;
    return Math.min(100, Math.max(0, y));
  });
}

function quantileSorted(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// tendência + faixa. opts.rng obrigatório pra determinismo.
export function loessWithBand(pts, grid, opts) {
  const {
    bootstrap = 200,
    bandLo = 10,
    bandHi = 90,
    minBandPts = 0.4, // piso do meio-intervalo da faixa (p.p.)
    rng,
    ...loessOpts
  } = opts;

  const line = loess(pts, grid, loessOpts);
  const n = pts.length;
  const reps = [];
  for (let b = 0; b < bootstrap; b++) {
    const sample = new Array(n);
    for (let i = 0; i < n; i++) sample[i] = pts[(rng() * n) | 0];
    reps.push(loess(sample, grid, loessOpts));
  }

  // erro amostral local médio (meio-intervalo), pra não subestimar a faixa
  const band = grid.map((x0, gi) => {
    if (line[gi] == null) return null;
    const col = [];
    for (const r of reps) if (r[gi] != null) col.push(r[gi]);
    col.sort((p, q) => p - q);
    const qlo = quantileSorted(col, bandLo / 100);
    const qhi = quantileSorted(col, bandHi / 100);
    const half0 = qlo == null || qhi == null ? minBandPts : (qhi - qlo) / 2;
    // dobra o erro amostral local em quadratura
    let sw = 0, sme = 0;
    for (const p of pts) {
      const wk = tricube(Math.min(1, Math.abs(p.x - x0) / 30)) * p.base;
      sw += wk;
      sme += wk * (p.moeHalf || 1.0);
    }
    const meanMoeHalf = sw > 0 ? sme / sw : 1.0;
    // faixa simétrica em torno da linha da tendência; teto = 8 p.p.
    const half = clampNum(
      Math.sqrt(half0 * half0 + Math.pow(meanMoeHalf * 0.5, 2)),
      minBandPts,
      8
    );
    return {
      lo: Math.max(0, line[gi] - half),
      hi: Math.min(100, line[gi] + half),
    };
  });

  return { line, band };
}
